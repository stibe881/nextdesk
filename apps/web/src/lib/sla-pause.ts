/**
 * SLA-Pause: tickets in a status with «Hält die SLA an» (e.g. «Wartend auf
 * Kunde») stop their SLA clock (tickets.sla_paused_at, migration 0324).
 * Instead of a countdown the lists show since when the SLA is paused.
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

/** «14:30» today, otherwise «12.11.2026, 14:30» (Swiss time). */
export function formatPauseStart(
  pausedAt: string,
  now: number = Date.now(),
): string | null {
  const parsed = Date.parse(pausedAt);
  if (!Number.isFinite(parsed)) return null;
  const date = new Date(parsed);
  const time = new Intl.DateTimeFormat("de-CH", {
    timeZone: ZURICH,
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
  if (zurichDay(date) === zurichDay(new Date(now))) return time;
  const day = new Intl.DateTimeFormat("de-CH", {
    timeZone: ZURICH,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
  return `${day}, ${time}`;
}

/** «SLA pausiert seit 14:30»; null when the SLA is running. */
export function slaPausedLabel(
  pausedAt: string | null | undefined,
  now: number = Date.now(),
): string | null {
  if (!pausedAt) return null;
  const start = formatPauseStart(pausedAt, now);
  return start ? `SLA pausiert seit ${start}` : "SLA pausiert";
}

/** Paused service time: «45 Min.», «2 Std. 15 Min.» */
export function formatPausedServiceMinutes(minutes: number): string {
  const rounded = Math.max(0, Math.round(minutes));
  if (rounded < 60) return `${rounded} Min.`;
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  return rest ? `${hours} Std. ${rest} Min.` : `${hours} Std.`;
}

export type SlaStatusSetting = {
  id: string;
  key: string;
  label: string;
  isClosed: boolean;
  pausesSla: boolean;
};

/** Statuses from sla-management listRules (data.statuses); [] if missing. */
export function parseSlaStatuses(value: unknown): SlaStatusSetting[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry: unknown) => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as Record<string, unknown>;
    if (
      typeof row.id !== "string" ||
      typeof row.key !== "string" ||
      typeof row.label !== "string"
    ) {
      return [];
    }
    return [
      {
        id: row.id,
        key: row.key,
        label: row.label,
        isClosed: row.isClosed === true,
        pausesSla: row.pausesSla === true && row.isClosed !== true,
      },
    ];
  });
}

/**
 * History labels of the events ticket.sla.paused / ticket.sla.resumed
 * (written by the database trigger); null for any other event.
 */
export function slaPauseEventLabel(
  eventType: string,
  payload?: Record<string, unknown> | null,
): string | null {
  const status =
    typeof payload?.statusLabel === "string" && payload.statusLabel.trim()
      ? payload.statusLabel.trim()
      : null;
  if (eventType === "ticket.sla.paused") {
    if (payload?.reason === "setting") {
      return status
        ? `SLA pausiert (Einstellung für «${status}» geändert)`
        : "SLA pausiert";
    }
    return status ? `SLA pausiert («${status}»)` : "SLA pausiert";
  }
  if (eventType === "ticket.sla.resumed") {
    const minutes =
      typeof payload?.pausedServiceMinutes === "number"
        ? payload.pausedServiceMinutes
        : typeof payload?.pausedServiceMinutes === "string"
          ? Number(payload.pausedServiceMinutes)
          : NaN;
    const moved =
      Number.isFinite(minutes) && minutes >= 1
        ? `, Fristen um ${formatPausedServiceMinutes(minutes)} Servicezeit verschoben`
        : "";
    if (payload?.reason === "closed")
      return `SLA-Pause beendet (abgeschlossen)${moved}`;
    return `SLA fortgesetzt${moved}`;
  }
  return null;
}
