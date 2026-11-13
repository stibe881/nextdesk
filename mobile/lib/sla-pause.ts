/**
 * SLA-Pause: Tickets in einem Wartestatus («Wartend auf Kunde» usw.) halten
 * die SLA an (tickets.sla_paused_at, Migration 0324). Statt einer Frist
 * zeigt die App, seit wann die SLA pausiert ist.
 */

const ZURICH = "Europe/Zurich";

function zurichDay(value: Date): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: ZURICH,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

/** «SLA pausiert seit 14:30» (heute) bzw. «… seit 10.11.2026, 09:05». */
export function slaPausedLabel(
  pausedAt: string | null | undefined,
  now: number = Date.now(),
): string | null {
  if (!pausedAt) return null;
  const parsed = Date.parse(pausedAt);
  if (!Number.isFinite(parsed)) return "SLA pausiert";
  const date = new Date(parsed);
  const time = new Intl.DateTimeFormat("de-CH", {
    timeZone: ZURICH,
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
  if (zurichDay(date) === zurichDay(new Date(now))) {
    return `SLA pausiert seit ${time}`;
  }
  const day = new Intl.DateTimeFormat("de-CH", {
    timeZone: ZURICH,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
  return `SLA pausiert seit ${day}, ${time}`;
}

/** Pause start of an open ticket; null when the SLA runs or it is closed. */
export function openSlaPause(
  pausedAt: unknown,
  resolved: boolean,
): string | null {
  return !resolved && typeof pausedAt === "string" && pausedAt
    ? pausedAt
    : null;
}
