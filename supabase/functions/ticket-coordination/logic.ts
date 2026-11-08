import { isRecord, isUuid } from "../_shared/http.ts";

/**
 * Pure request parsing and validation for ticket-coordination (ticket split,
 * vendor cases, vendors, timeline overview). No I/O, so it is unit-tested.
 */

export const MAX_SPLIT_CHILDREN = 10;
export const SUBJECT_MIN = 3;
export const SUBJECT_MAX = 240;
export const DESCRIPTION_MAX = 50000;
export const NOTE_MAX = 2000;
export const CASE_NUMBER_MAX = 120;

export type SplitChild = {
  subject: string;
  description: string;
  departmentId: string;
  teamId: string | null;
  agentId: string | null;
};

export type VendorInput = {
  vendorId: string | null;
  name: string;
  contactEmail: string | null;
  contactPhone: string | null;
  reminderAfterHours: number;
  active: boolean;
};

export type Action =
  | { type: "overview"; tenantId: string; ticketId: string }
  | { type: "splitOptions"; tenantId: string; ticketId: string }
  | {
    type: "assignableAgents";
    tenantId: string;
    ticketId: string;
    departmentId: string;
    teamId: string | null;
  }
  | { type: "split"; tenantId: string; ticketId: string; children: SplitChild[] }
  | {
    type: "openVendorCase";
    tenantId: string;
    ticketId: string;
    vendorId: string;
    externalCaseNumber: string | null;
    note: string | null;
  }
  | {
    type: "recordVendorUpdate" | "closeVendorCase";
    tenantId: string;
    ticketId: string;
    caseId: string;
    note: string | null;
  }
  | { type: "listVendors"; tenantId: string }
  | { type: "saveVendor"; tenantId: string; vendor: VendorInput };

export type SplitChildError =
  | "subject"
  | "description"
  | "department"
  | "team"
  | "agent";

function onlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function optionalText(value: unknown, max: number): string | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? undefined : trimmed;
}

function optionalUuid(value: unknown): string | null | undefined {
  if (value === undefined || value === null || value === "") return null;
  return isUuid(value) ? value.toLowerCase() : undefined;
}

/** Errors of one split child; an empty list means the child is valid. */
export function splitChildErrors(value: unknown): SplitChildError[] {
  if (!isRecord(value)) return ["subject", "description", "department"];
  const errors: SplitChildError[] = [];
  const subject = typeof value.subject === "string" ? value.subject.trim() : "";
  if (subject.length < SUBJECT_MIN || subject.length > SUBJECT_MAX) {
    errors.push("subject");
  }
  const description = typeof value.description === "string"
    ? value.description.trim()
    : "";
  if (description.length < 1 || description.length > DESCRIPTION_MAX) {
    errors.push("description");
  }
  if (!isUuid(value.departmentId)) errors.push("department");
  if (optionalUuid(value.teamId) === undefined) errors.push("team");
  if (optionalUuid(value.agentId) === undefined) errors.push("agent");
  return errors;
}

/** Validated split children, or null when the list or one child is invalid. */
export function parseSplitChildren(value: unknown): SplitChild[] | null {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > MAX_SPLIT_CHILDREN
  ) {
    return null;
  }
  const children: SplitChild[] = [];
  for (const entry of value) {
    if (
      !isRecord(entry) ||
      !onlyKeys(entry, [
        "subject",
        "description",
        "departmentId",
        "teamId",
        "agentId",
      ]) ||
      splitChildErrors(entry).length > 0
    ) {
      return null;
    }
    children.push({
      subject: String(entry.subject).trim(),
      description: String(entry.description).trim(),
      departmentId: String(entry.departmentId).toLowerCase(),
      teamId: optionalUuid(entry.teamId) ?? null,
      agentId: optionalUuid(entry.agentId) ?? null,
    });
  }
  return children;
}

export function parseVendorInput(value: unknown): VendorInput | null {
  if (
    !isRecord(value) ||
    !onlyKeys(value, [
      "vendorId",
      "name",
      "contactEmail",
      "contactPhone",
      "reminderAfterHours",
      "active",
    ])
  ) {
    return null;
  }
  const vendorId = optionalUuid(value.vendorId);
  const name = typeof value.name === "string" ? value.name.trim() : "";
  const contactEmail = optionalText(value.contactEmail, 254);
  const contactPhone = optionalText(value.contactPhone, 40);
  const hours = value.reminderAfterHours === undefined
    ? 48
    : value.reminderAfterHours;
  if (
    vendorId === undefined ||
    name.length < 2 ||
    name.length > 160 ||
    contactEmail === undefined ||
    (contactEmail !== null &&
      !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contactEmail)) ||
    contactPhone === undefined ||
    (contactPhone !== null && contactPhone.length < 3) ||
    typeof hours !== "number" ||
    !Number.isInteger(hours) ||
    hours < 1 ||
    hours > 2160 ||
    (value.active !== undefined && typeof value.active !== "boolean")
  ) {
    return null;
  }
  return {
    vendorId,
    name,
    contactEmail,
    contactPhone,
    reminderAfterHours: hours,
    active: value.active !== false,
  };
}

export function parseAction(value: unknown): Action | null {
  if (!isRecord(value) || !isUuid(value.tenantId)) return null;
  const tenantId = value.tenantId.toLowerCase();
  if (value.type === "listVendors") {
    return onlyKeys(value, ["type", "tenantId"])
      ? { type: "listVendors", tenantId }
      : null;
  }
  if (value.type === "saveVendor") {
    if (!onlyKeys(value, ["type", "tenantId", "vendor"])) return null;
    const vendor = parseVendorInput(value.vendor);
    return vendor ? { type: "saveVendor", tenantId, vendor } : null;
  }
  if (!isUuid(value.ticketId)) return null;
  const ticketId = value.ticketId.toLowerCase();
  switch (value.type) {
    case "overview":
    case "splitOptions":
      return onlyKeys(value, ["type", "tenantId", "ticketId"])
        ? { type: value.type, tenantId, ticketId }
        : null;
    case "assignableAgents": {
      const teamId = optionalUuid(value.teamId);
      if (
        !onlyKeys(value, [
          "type",
          "tenantId",
          "ticketId",
          "departmentId",
          "teamId",
        ]) ||
        !isUuid(value.departmentId) ||
        teamId === undefined
      ) {
        return null;
      }
      return {
        type: "assignableAgents",
        tenantId,
        ticketId,
        departmentId: value.departmentId.toLowerCase(),
        teamId,
      };
    }
    case "split": {
      if (!onlyKeys(value, ["type", "tenantId", "ticketId", "children"])) {
        return null;
      }
      const children = parseSplitChildren(value.children);
      return children ? { type: "split", tenantId, ticketId, children } : null;
    }
    case "openVendorCase": {
      const externalCaseNumber = optionalText(
        value.externalCaseNumber,
        CASE_NUMBER_MAX,
      );
      const note = optionalText(value.note, NOTE_MAX);
      if (
        !onlyKeys(value, [
          "type",
          "tenantId",
          "ticketId",
          "vendorId",
          "externalCaseNumber",
          "note",
        ]) ||
        !isUuid(value.vendorId) ||
        externalCaseNumber === undefined ||
        note === undefined
      ) {
        return null;
      }
      return {
        type: "openVendorCase",
        tenantId,
        ticketId,
        vendorId: value.vendorId.toLowerCase(),
        externalCaseNumber,
        note,
      };
    }
    case "recordVendorUpdate":
    case "closeVendorCase": {
      const note = optionalText(value.note, NOTE_MAX);
      if (
        !onlyKeys(value, ["type", "tenantId", "ticketId", "caseId", "note"]) ||
        !isUuid(value.caseId) ||
        note === undefined
      ) {
        return null;
      }
      return {
        type: value.type,
        tenantId,
        ticketId,
        caseId: value.caseId.toLowerCase(),
        note,
      };
    }
    default:
      return null;
  }
}

/**
 * Error code for a PostgreSQL error of the coordination RPCs. The functions
 * put a stable code in the hint; everything else stays generic.
 */
export function rpcErrorCode(
  error: { code?: unknown; hint?: unknown } | null | undefined,
  fallback: string,
): { code: string; status: number } {
  const hint = typeof error?.hint === "string" ? error.hint : "";
  switch (hint) {
    case "ticket_split_parent_closed":
    case "vendor_case_ticket_closed":
      return { code: hint, status: 409 };
    case "vendor_case_exists":
      return { code: hint, status: 409 };
    case "ticket_split_department_invalid":
    case "ticket_split_invalid":
    case "vendor_invalid":
      return { code: hint, status: 422 };
  }
  if (error?.code === "P0002") return { code: "not_found", status: 404 };
  if (error?.code === "23514") {
    return { code: "ticket_split_assignment_invalid", status: 422 };
  }
  return { code: fallback, status: 500 };
}

const EVENT_PAYLOAD_KEYS = [
  "changedFields",
  "statusTransition",
  "relationType",
  "relatedTicketId",
  "source",
  "parentTicketNumber",
  "children",
  "childCount",
  "lastChildTicketNumber",
  "vendorName",
  "externalCaseNumber",
  "note",
  "silentSince",
  "kind",
  "level",
] as const;

/** Only the payload fields the timeline needs leave the function. */
export function timelineEventPayload(payload: unknown): Record<string, unknown> {
  if (!isRecord(payload)) return {};
  const result: Record<string, unknown> = {};
  for (const key of EVENT_PAYLOAD_KEYS) {
    if (!(key in payload)) continue;
    const value = payload[key];
    if (key === "statusTransition") {
      if (isRecord(value)) {
        result.statusTransition = {
          toStatusKey: typeof value.toStatusKey === "string"
            ? value.toStatusKey
            : null,
          isClosed: value.isClosed === true,
        };
      }
      continue;
    }
    if (key === "children") {
      if (Array.isArray(value)) {
        result.children = value
          .filter(isRecord)
          .map((child) => String(child.ticketNumber ?? ""))
          .filter(Boolean)
          .slice(0, MAX_SPLIT_CHILDREN);
      }
      continue;
    }
    if (key === "changedFields") {
      if (Array.isArray(value)) {
        result.changedFields = value.filter(
          (field): field is string => typeof field === "string",
        );
      }
      continue;
    }
    if (typeof value === "string") {
      result[key] = value.slice(0, NOTE_MAX);
    } else if (typeof value === "number" || typeof value === "boolean") {
      result[key] = value;
    }
  }
  return result;
}
