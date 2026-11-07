// One-click answers from reminder e-mails (#ticket-aktion=<token>).

export type ReminderActionState =
  "open" | "done" | "used" | "expired" | "disabled" | "not_waiting";

export type ReminderActionPreview = {
  action: "resolved" | "need_help";
  state: ReminderActionState;
  ticketNumber: string | null;
  subject: string | null;
};

const HASH_PREFIX = "#ticket-aktion=";
const STATES: readonly ReminderActionState[] = [
  "open",
  "done",
  "used",
  "expired",
  "disabled",
  "not_waiting",
];

export function isReminderActionHash(hash: string): boolean {
  return hash.startsWith(HASH_PREFIX);
}

export function reminderActionTokenFromHash(hash: string): string | null {
  if (!isReminderActionHash(hash)) return null;
  let token: string;
  try {
    token = decodeURIComponent(hash.slice(HASH_PREFIX.length));
  } catch {
    return null;
  }
  return /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token) &&
    token.length <= 1024
    ? token
    : null;
}

function text(value: unknown, max: number): string | null {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, max)
    : null;
}

export function parseReminderActionResponse(
  value: unknown,
): ReminderActionPreview | null {
  if (typeof value !== "object" || value === null) return null;
  const data = (value as { data?: unknown }).data;
  if (typeof data !== "object" || data === null) return null;
  const row = data as Record<string, unknown>;
  if (row.action !== "resolved" && row.action !== "need_help") return null;
  if (
    typeof row.state !== "string" ||
    !(STATES as readonly string[]).includes(row.state)
  )
    return null;
  return {
    action: row.action,
    state: row.state as ReminderActionState,
    ticketNumber: text(row.ticketNumber, 64),
    subject: text(row.subject, 240),
  };
}

const MESSAGES: Record<string, string> = {
  token_invalid:
    "Dieser Link ist ungültig. Bitte melden Sie sich an und öffnen Sie das Ticket im Portal.",
  token_expired:
    "Dieser Link ist abgelaufen. Bitte melden Sie sich an und öffnen Sie das Ticket im Portal.",
  expired:
    "Dieser Link ist abgelaufen. Bitte melden Sie sich an und öffnen Sie das Ticket im Portal.",
  token_used: "Sie haben auf diese Erinnerung bereits geantwortet. Danke!",
  used: "Sie haben auf diese Erinnerung bereits geantwortet. Danke!",
  disabled:
    "Diese Aktion ist nicht mehr verfügbar. Bitte antworten Sie direkt auf die E-Mail.",
  actions_disabled:
    "Diese Aktion ist nicht mehr verfügbar. Bitte antworten Sie direkt auf die E-Mail.",
  not_waiting:
    "Das Ticket wartet nicht mehr auf Ihre Rückmeldung. Es ist keine Aktion nötig.",
  ticket_not_waiting:
    "Das Ticket wartet nicht mehr auf Ihre Rückmeldung. Es ist keine Aktion nötig.",
  status_rule:
    "Der Status kann gerade nicht geändert werden. Bitte antworten Sie direkt auf die E-Mail.",
};

export function reminderActionErrorText(code: string): string {
  return (
    MESSAGES[code] ??
    "Die Rückmeldung konnte nicht übermittelt werden. Bitte versuchen Sie es später erneut oder antworten Sie auf die E-Mail."
  );
}
