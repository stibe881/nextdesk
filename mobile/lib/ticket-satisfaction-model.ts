/**
 * Satisfaction rating by the requester (Function `ticket-feedback`). The
 * requester may rate once the ticket is resolved («Gelöst») or closed; a
 * rating can be changed once within 14 days.
 */
export type TicketSatisfaction = {
  score: number | null;
  comment: string | null;
};

export type TicketFeedback = {
  satisfaction: TicketSatisfaction | null;
  canRate: boolean;
  isRatable: boolean;
};

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function satisfaction(value: unknown): TicketSatisfaction | null | undefined {
  if (value === null) return null;
  const item = record(value);
  if (!item) return undefined;
  const score = item.score;
  const comment = item.comment;
  if (
    !(
      score === null ||
      (typeof score === "number" &&
        Number.isInteger(score) &&
        score >= 1 &&
        score <= 5)
    ) ||
    !(comment === null || typeof comment === "string")
  ) {
    return undefined;
  }
  return { score, comment };
}

export function parseTicketFeedback(value: unknown): TicketFeedback {
  const data = record(record(value)?.data);
  const status = record(record(data?.ticket)?.status);
  const parsed = satisfaction(data?.satisfaction ?? null);
  if (
    !data ||
    parsed === undefined ||
    typeof data.canRate !== "boolean" ||
    typeof status?.isClosed !== "boolean"
  ) {
    throw new Error("Die Bewertung konnte nicht gelesen werden.");
  }
  return {
    satisfaction: parsed,
    canRate: data.canRate,
    isRatable:
      typeof status.isRatable === "boolean"
        ? status.isRatable
        : status.isClosed,
  };
}

/** Resolved or closed tickets can be rated (mirrors the Function). */
export function isRatableTicketStatus(
  status: { key: string; is_closed: boolean } | null | undefined,
): boolean {
  return Boolean(status && (status.is_closed || status.key === "resolved"));
}

export function feedbackCommentError(comment: string): string | null {
  return [...comment].length > 3000 || comment.includes("\u0000")
    ? "Der Kommentar darf höchstens 3000 Zeichen lang sein."
    : null;
}
