// Star rating from the «ticket resolved» e-mail (#ticket-bewertung=<token>).

export type RatingLinkState = "open" | "done" | "rated" | "not_ratable";

export type RatingLinkPreview = {
  score: number;
  state: RatingLinkState;
  ticketNumber: string | null;
  subject: string | null;
  existingScore: number | null;
};

const HASH_PREFIX = "#ticket-bewertung=";
const STATES: readonly RatingLinkState[] = [
  "open",
  "done",
  "rated",
  "not_ratable",
];

export function isRatingLinkHash(hash: string): boolean {
  return hash.startsWith(HASH_PREFIX);
}

export function ratingLinkTokenFromHash(hash: string): string | null {
  if (!isRatingLinkHash(hash)) return null;
  let token: string;
  try {
    token = decodeURIComponent(hash.slice(HASH_PREFIX.length));
  } catch {
    return null;
  }
  return /^r1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token) &&
    token.length <= 1024
    ? token
    : null;
}

function text(value: unknown, max: number): string | null {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, max)
    : null;
}

export function parseRatingLinkResponse(
  value: unknown,
): RatingLinkPreview | null {
  if (typeof value !== "object" || value === null) return null;
  const data = (value as { data?: unknown }).data;
  if (typeof data !== "object" || data === null) return null;
  const row = data as Record<string, unknown>;
  if (
    typeof row.score !== "number" ||
    !Number.isInteger(row.score) ||
    row.score < 1 ||
    row.score > 5
  )
    return null;
  if (
    typeof row.state !== "string" ||
    !(STATES as readonly string[]).includes(row.state)
  )
    return null;
  const existing =
    typeof row.existingScore === "number" &&
    Number.isInteger(row.existingScore) &&
    row.existingScore >= 1 &&
    row.existingScore <= 5
      ? row.existingScore
      : null;
  return {
    score: row.score,
    state: row.state as RatingLinkState,
    ticketNumber: text(row.ticketNumber, 64),
    subject: text(row.subject, 240),
    existingScore: existing,
  };
}

const MESSAGES: Record<string, string> = {
  token_invalid:
    "Dieser Link ist ungültig. Bitte melden Sie sich an und bewerten Sie das Ticket im Portal.",
  token_expired:
    "Dieser Link ist abgelaufen. Bitte melden Sie sich an und bewerten Sie das Ticket im Portal.",
  ticket_not_available: "Das Ticket ist nicht verfügbar.",
  comment_too_long: "Der Kommentar ist zu lang (höchstens 3000 Zeichen).",
  rated: "Dieses Ticket wurde bereits bewertet. Danke!",
  not_ratable:
    "Dieses Ticket kann noch nicht bewertet werden. Es ist noch nicht gelöst.",
};

export function ratingLinkErrorText(code: string): string {
  return (
    MESSAGES[code] ??
    "Die Bewertung konnte nicht übermittelt werden. Bitte versuchen Sie es später erneut."
  );
}
