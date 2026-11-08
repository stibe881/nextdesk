/**
 * Pure logic for SLA breach reasons and customer praise. Used by the edge
 * functions sla-breach-reasons and team-supervision.
 */

export const SLA_BREACH_REASON_CODES = [
  "third_party",
  "wrong_routing",
  "missing_requester_info",
  "capacity",
  "complexity",
  "other",
] as const;
export type SlaBreachReasonCode = (typeof SLA_BREACH_REASON_CODES)[number];
export type SlaBreachKind = "response" | "resolution";

export const SLA_BREACH_REASON_LABELS: Record<SlaBreachReasonCode, string> = {
  third_party: "Drittanbieter",
  wrong_routing: "Falsches Team / Weiterleitung",
  missing_requester_info: "Fehlende Infos von meldender Person",
  capacity: "Kapazität / Überlastung",
  complexity: "Komplexität",
  other: "Sonstiges",
};

export const SLA_BREACH_NOTE_MAX = 500;

export function isSlaBreachReasonCode(
  value: unknown,
): value is SlaBreachReasonCode {
  return typeof value === "string" &&
    (SLA_BREACH_REASON_CODES as readonly string[]).includes(value);
}

export type SlaTicketTimes = {
  responseDueAt: string | null;
  firstRespondedAt: string | null;
  resolutionDueAt: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
};

export type DetectedBreach = { kind: SlaBreachKind; dueAt: string };

const time = (value: string | null) =>
  typeof value === "string" ? Date.parse(value) : NaN;

/**
 * Breached targets of a ticket. Sources: recorded SLA events (written by
 * sla-automation) and the ticket's own timestamps, so a target missed between
 * two automation runs (e.g. resolved late) still counts.
 */
export function detectBreaches(
  ticket: SlaTicketTimes,
  eventTypes: Iterable<string> = [],
  now = Date.now(),
): DetectedBreach[] {
  const events = new Set(eventTypes);
  const breaches: DetectedBreach[] = [];
  const responseDue = time(ticket.responseDueAt);
  if (Number.isFinite(responseDue)) {
    const responded = time(ticket.firstRespondedAt);
    const missed = Number.isFinite(responded)
      ? responded > responseDue
      : responseDue < now;
    if (missed || events.has("response_breached")) {
      breaches.push({ kind: "response", dueAt: ticket.responseDueAt as string });
    }
  }
  const resolutionDue = time(ticket.resolutionDueAt);
  if (Number.isFinite(resolutionDue)) {
    const resolved = time(ticket.resolvedAt ?? ticket.closedAt);
    const missed = Number.isFinite(resolved)
      ? resolved > resolutionDue
      : resolutionDue < now;
    if (missed || events.has("resolution_breached")) {
      breaches.push({
        kind: "resolution",
        dueAt: ticket.resolutionDueAt as string,
      });
    }
  }
  return breaches;
}

/** Top band of the 1–5 survey: a 5, or a 4 with a written comment. */
export function isPraise(score: number | null, comment: string | null): boolean {
  if (score === 5) return true;
  return score === 4 && typeof comment === "string" && comment.trim() !== "";
}

export type BreachForReport = {
  departmentId: string;
  teamId: string | null;
  kind: SlaBreachKind;
  reasonCode: SlaBreachReasonCode | null;
};

export type CauseSummary = {
  total: number;
  withoutReason: number;
  withoutReasonPercent: number | null;
  causes: { code: SlaBreachReasonCode; label: string; count: number; percent: number }[];
};

/** Counts per reason, sorted by frequency (share of breaches with a reason). */
export function summarizeCauses(breaches: BreachForReport[]): CauseSummary {
  const counts = new Map<SlaBreachReasonCode, number>();
  let withoutReason = 0;
  for (const breach of breaches) {
    if (!breach.reasonCode) withoutReason += 1;
    else counts.set(breach.reasonCode, (counts.get(breach.reasonCode) ?? 0) + 1);
  }
  const withReason = breaches.length - withoutReason;
  return {
    total: breaches.length,
    withoutReason,
    withoutReasonPercent: breaches.length
      ? Math.round((withoutReason / breaches.length) * 100)
      : null,
    causes: [...counts.entries()]
      .map(([code, count]) => ({
        code,
        label: SLA_BREACH_REASON_LABELS[code],
        count,
        percent: Math.round((count / withReason) * 100),
      }))
      .sort((a, b) =>
        b.count - a.count ||
        SLA_BREACH_REASON_CODES.indexOf(a.code) -
          SLA_BREACH_REASON_CODES.indexOf(b.code)
      ),
  };
}

/** Month key (YYYY-MM) in Swiss time for a timestamp. */
export function zurichMonth(value: string): string | null {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Zurich",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date(parsed));
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  return year && month ? `${year}-${month}` : null;
}

/** Month bounds in UTC with a margin; filter exactly with zurichMonth. */
export function monthQueryRange(month: string): { from: string; to: string } {
  const [year, value] = month.split("-").map(Number);
  const from = new Date(Date.UTC(year, value - 1, 1) - 3 * 3_600_000);
  const to = new Date(Date.UTC(year, value, 1) + 3 * 3_600_000);
  return { from: from.toISOString(), to: to.toISOString() };
}

/** First characters of a praise comment, cut on a word boundary. */
export function praiseExcerpt(comment: string | null, max = 500): string | null {
  const text = comment?.replace(/\s+/g, " ").trim();
  if (!text) return null;
  if ([...text].length <= max) return text;
  const cut = [...text].slice(0, max - 1).join("");
  const space = cut.lastIndexOf(" ");
  return `${space > max * 0.6 ? cut.slice(0, space) : cut}…`;
}
