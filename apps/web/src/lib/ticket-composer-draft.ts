// Draft of "Ticket erfassen" in sessionStorage, per user and tenant, so that
// opening a suggested ticket or article does not lose what was typed.
// Attachments are never stored. Storage can be unavailable (private mode,
// blocked site data): every access is guarded and failures are ignored.

export type TicketComposerDraft = {
  subject: string;
  description: string;
  departmentId: string;
  categoryId: string;
  subcategoryId: string;
  priorityKey: string;
  templateId: string;
  assignedAgentId: string;
  requester: { id: string; displayName: string } | null;
};

const KEY_PREFIX = "nextdesk.ticketComposerDraft.v1";
const MAX_TEXT_LENGTH = 20_000;

function draftKey(userId: string | null, tenantId: string): string {
  return `${KEY_PREFIX}:${userId ?? "anonymous"}:${tenantId}`;
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function text(value: unknown, max = 200): string {
  return typeof value === "string" && value.length <= max ? value : "";
}

/** True when the draft holds something worth keeping. */
export function hasDraftContent(draft: TicketComposerDraft): boolean {
  return Boolean(
    draft.subject.trim() || draft.description.trim() || draft.templateId,
  );
}

export function parseTicketComposerDraft(
  value: unknown,
): TicketComposerDraft | null {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return null;
  const record = value as Record<string, unknown>;
  const requester =
    typeof record.requester === "object" && record.requester !== null
      ? (record.requester as Record<string, unknown>)
      : null;
  const draft: TicketComposerDraft = {
    subject: text(record.subject, MAX_TEXT_LENGTH),
    description: text(record.description, MAX_TEXT_LENGTH),
    departmentId: text(record.departmentId),
    categoryId: text(record.categoryId),
    subcategoryId: text(record.subcategoryId),
    priorityKey: text(record.priorityKey),
    templateId: text(record.templateId),
    assignedAgentId: text(record.assignedAgentId),
    requester:
      requester &&
      text(requester.id) &&
      typeof requester.displayName === "string" &&
      requester.displayName.length <= 500
        ? { id: text(requester.id), displayName: requester.displayName }
        : null,
  };
  return hasDraftContent(draft) ? draft : null;
}

export function readTicketComposerDraft(
  userId: string | null,
  tenantId: string,
): TicketComposerDraft | null {
  try {
    const raw = storage()?.getItem(draftKey(userId, tenantId));
    return raw ? parseTicketComposerDraft(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

/** Stores the draft, or removes it when it is empty. */
export function writeTicketComposerDraft(
  userId: string | null,
  tenantId: string,
  draft: TicketComposerDraft,
): boolean {
  try {
    const store = storage();
    if (!store) return false;
    if (!hasDraftContent(draft)) {
      store.removeItem(draftKey(userId, tenantId));
      return false;
    }
    store.setItem(draftKey(userId, tenantId), JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

export function clearTicketComposerDraft(
  userId: string | null,
  tenantId: string,
): void {
  try {
    storage()?.removeItem(draftKey(userId, tenantId));
  } catch {
    // Storage unavailable: nothing was stored either.
  }
}
