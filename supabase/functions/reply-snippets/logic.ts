// Pure helpers of the reply-snippets function (input parsing, name split).

import { isRecord, isUuid } from "../_shared/http.ts";

export type SaveAction = {
  type: "save";
  tenantId: string;
  id: string | null;
  name: string;
  shortcut: string | null;
  body: string;
  departmentId: string | null;
  shared: boolean;
};

export type Action =
  | { type: "list"; tenantId: string }
  | { type: "listForTicket"; tenantId: string; ticketId: string }
  | SaveAction
  | { type: "archive"; tenantId: string; id: string };

export const MAX_NAME_LENGTH = 120;
export const MAX_BODY_LENGTH = 10_000;
const SHORTCUT_PATTERN = /^[a-z0-9][a-z0-9_-]{0,39}$/;

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  if (value.includes("\u0000") || /\p{Cs}/u.test(value)) return null;
  const trimmed = value.trim();
  return trimmed && [...trimmed].length <= max ? trimmed : null;
}

/** «/Gruss» → «gruss»; "" or null → null; undefined when invalid. */
export function parseShortcut(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().replace(/^\/+/, "").toLowerCase();
  if (!normalized) return null;
  return SHORTCUT_PATTERN.test(normalized) ? normalized : undefined;
}

export function parseAction(value: unknown): Action | null {
  if (!isRecord(value) || !isUuid(value.tenantId)) return null;
  const tenantId = value.tenantId.toLowerCase();
  switch (value.type) {
    case "list":
      return { type: "list", tenantId };
    case "listForTicket":
      return isUuid(value.ticketId)
        ? { type: "listForTicket", tenantId, ticketId: value.ticketId.toLowerCase() }
        : null;
    case "archive":
      return isUuid(value.id) ? { type: "archive", tenantId, id: value.id.toLowerCase() } : null;
    case "save": {
      const id = value.id === undefined || value.id === null
        ? null
        : isUuid(value.id)
        ? value.id.toLowerCase()
        : undefined;
      const name = cleanText(value.name, MAX_NAME_LENGTH);
      const body = cleanText(value.body, MAX_BODY_LENGTH);
      const shortcut = parseShortcut(value.shortcut);
      const departmentId = value.departmentId === undefined || value.departmentId === null ||
          value.departmentId === ""
        ? null
        : isUuid(value.departmentId)
        ? value.departmentId.toLowerCase()
        : undefined;
      if (
        id === undefined || !name || !body || shortcut === undefined ||
        departmentId === undefined || typeof value.shared !== "boolean"
      ) {
        return null;
      }
      return { type: "save", tenantId, id, name, shortcut, body, departmentId, shared: value.shared };
    }
    default:
      return null;
  }
}

type SnippetRow = {
  id: string;
  name: string;
  shortcut: string | null;
  body: string;
  department_id: string | null;
  owner_id: string | null;
};

/** Who may change a snippet: the owner, or for shared ones a template manager. */
export function canEditSnippet(
  row: Pick<SnippetRow, "owner_id">,
  actorId: string,
  canManageShared: boolean,
): boolean {
  return row.owner_id === null ? canManageShared : row.owner_id === actorId;
}

export function snippetResponse(
  row: SnippetRow,
  actorId: string,
  canManageShared: boolean,
  departmentNames: Map<string, string>,
) {
  return {
    id: row.id,
    name: row.name,
    shortcut: row.shortcut,
    body: row.body,
    departmentId: row.department_id,
    departmentName: row.department_id ? departmentNames.get(row.department_id) ?? null : null,
    personal: row.owner_id !== null,
    canEdit: canEditSnippet(row, actorId, canManageShared),
  };
}
