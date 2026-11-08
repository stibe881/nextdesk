/**
 * Antwortentwürfe geräteübergreifend: pure helpers deciding which reply draft
 * (browser copy or server copy from another device) is restored.
 */

export type StoredReplyDraft = { body: string; savedAt: string | null };
export type ServerReplyDraft = { body: string; updatedAt: string };
export type RestoredReplyDraft = {
  body: string;
  savedAt: string | null;
  source: "local" | "server";
};

export const MAX_REPLY_DRAFT_LENGTH = 50_000;
/** Same retention as the server cron: older drafts are not restored. */
export const REPLY_DRAFT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

function validBody(body: unknown): body is string {
  return (
    typeof body === "string" &&
    body.trim().length > 0 &&
    body.length <= MAX_REPLY_DRAFT_LENGTH &&
    !body.includes("\u0000")
  );
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

/** Parses the browser copy; older entries only stored `{ body }`. */
export function parseStoredReplyDraft(
  raw: string | null,
): StoredReplyDraft | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return null;
    const record = value as Record<string, unknown>;
    if (!validBody(record.body)) return null;
    return {
      body: record.body,
      savedAt: validTimestamp(record.savedAt) ? record.savedAt : null,
    };
  } catch {
    return null;
  }
}

export function serializeStoredReplyDraft(
  body: string,
  savedAt: string,
): string {
  return JSON.stringify({ body, savedAt });
}

/**
 * The newest non-empty draft wins. A local copy without timestamp (older
 * format) only wins when there is no server draft. Drafts past the retention
 * window are ignored.
 */
export function pickReplyDraftToRestore(
  local: StoredReplyDraft | null,
  server: ServerReplyDraft | null,
  now = Date.now(),
): RestoredReplyDraft | null {
  const fresh = (timestamp: string | null) =>
    timestamp === null ||
    now - Date.parse(timestamp) <= REPLY_DRAFT_RETENTION_MS;
  const localCandidate =
    local && validBody(local.body) && fresh(local.savedAt) ? local : null;
  const serverCandidate =
    server &&
    validBody(server.body) &&
    validTimestamp(server.updatedAt) &&
    fresh(server.updatedAt)
      ? server
      : null;
  if (!localCandidate && !serverCandidate) return null;
  if (!serverCandidate && localCandidate) {
    return { ...localCandidate, source: "local" };
  }
  if (serverCandidate && !localCandidate) {
    return {
      body: serverCandidate.body,
      savedAt: serverCandidate.updatedAt,
      source: "server",
    };
  }
  const l = localCandidate!;
  const s = serverCandidate!;
  if (l.body === s.body) {
    return { body: s.body, savedAt: s.updatedAt, source: "server" };
  }
  if (l.savedAt !== null && Date.parse(l.savedAt) > Date.parse(s.updatedAt)) {
    return { ...l, source: "local" };
  }
  return { body: s.body, savedAt: s.updatedAt, source: "server" };
}

const restoredFormatter = new Intl.DateTimeFormat("de-CH", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Zurich",
});

export function replyDraftRestoredLabel(savedAt: string | null): string {
  if (!savedAt || !Number.isFinite(Date.parse(savedAt))) {
    return "Entwurf wiederhergestellt.";
  }
  return `Entwurf vom ${restoredFormatter.format(new Date(savedAt))} wiederhergestellt.`;
}
