// Formatierung für das IPAM-Redesign: Prognose, Änderungsprotokoll,
// Agentenstatus, Funde und Verlaufsdiagramm (reine Logik).

import type {
  AgentStatus,
  ChangeLogEntry,
  ChangeSource,
  Forecast,
  ObjectType,
  UtilizationHistory,
} from "./ipam-redesign-types";

export const SOURCE_LABEL: Record<ChangeSource, string> = {
  user: "Person",
  cleanup: "Bereinigung",
  planner: "Planer",
  template: "Standort-Vorlage",
  discovery: "Discovery",
  intune: "Intune-Abgleich",
  prtg: "PRTG-Abgleich",
  import: "Import",
  api: "API",
  system: "System",
};

export const OBJECT_TYPE_LABEL: Record<ObjectType, string> = {
  prefix: "Netze",
  vlan: "VLANs",
  site: "Standorte",
  address: "Adressen",
  template: "Vorlagen",
};

export const ACTION_LABEL: Record<ChangeLogEntry["action"], string> = {
  create: "hat angelegt",
  update: "hat geändert",
  delete: "hat entfernt",
};

export const AGENT_STATUS_LABEL: Record<AgentStatus, string> = {
  online: "Online",
  late: "Verspätet",
  offline: "Offline",
  disabled: "Deaktiviert",
};

export const AGENT_STATUS_TONE: Record<
  AgentStatus,
  "success" | "warning" | "danger" | "neutral"
> = {
  online: "success",
  late: "warning",
  offline: "danger",
  disabled: "neutral",
};

/** Who made the change: the person, or the automatic source. */
export function changeActor(
  entry: Pick<ChangeLogEntry, "actorName" | "source">,
): string {
  if (entry.source === "user") return entry.actorName ?? "Unbekannte Person";
  const label = SOURCE_LABEL[entry.source] ?? entry.source;
  return entry.actorName ? `${label} (${entry.actorName})` : label;
}

/** Before → after list of a change, e.g. «Status: Aktiv → Container». */
export function changeDiff(entry: Pick<ChangeLogEntry, "changes" | "summary">) {
  if (!entry.changes.length) return entry.summary;
  return entry.changes
    .slice(0, 4)
    .map(
      (change) =>
        `${change.label}: ${change.before ?? "–"} → ${change.after ?? "–"}`,
    )
    .join(" · ");
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** «heute 14:02», «gestern 16:40», «09.11. 08:30», «09.11.2025». */
export function formatChangeTime(at: string, now = new Date()): string {
  const time = new Date(at);
  if (Number.isNaN(time.getTime())) return at;
  const clock = `${pad(time.getHours())}:${pad(time.getMinutes())}`;
  const startOfDay = (date: Date) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(time)) / 86_400_000);
  if (days === 0) return `heute ${clock}`;
  if (days === 1) return `gestern ${clock}`;
  if (time.getFullYear() === now.getFullYear()) {
    return `${pad(time.getDate())}.${pad(time.getMonth() + 1)}. ${clock}`;
  }
  return `${pad(time.getDate())}.${pad(time.getMonth() + 1)}.${time.getFullYear()}`;
}

/** «3 Tagen», «2 Monaten», «1 Jahr» – for «in ca. …». */
export function durationText(days: number): string {
  const rounded = Math.max(0, Math.round(days));
  if (rounded <= 1) return "1 Tag";
  if (rounded < 45) return `${rounded} Tagen`;
  const months = Math.round(rounded / 30);
  if (months < 24) return `${months} Monaten`;
  const years = Math.round(rounded / 365);
  return years === 1 ? "1 Jahr" : `${years} Jahren`;
}

export type ForecastLabel = {
  text: string;
  tone: "danger" | "warning" | "neutral";
};

/**
 * Short forecast for tables («voll in ca. 18 Tagen»). Danger when full in
 * 30 days or less, warning when the threshold or full is within 90 days.
 */
export function forecastLabel(
  forecast: Forecast | null | undefined,
): ForecastLabel {
  if (!forecast) return { text: "–", tone: "neutral" };
  const { daysToFull, daysToWarning, trend } = forecast;
  if (daysToFull !== null && daysToFull <= 0)
    return { text: "voll", tone: "danger" };
  if (daysToFull !== null) {
    return {
      text: `voll in ca. ${durationText(daysToFull)}`,
      tone:
        daysToFull <= 30 ? "danger" : daysToFull <= 90 ? "warning" : "neutral",
    };
  }
  if (daysToWarning !== null && daysToWarning > 0) {
    return {
      text: `Warnschwelle in ca. ${durationText(daysToWarning)}`,
      tone: daysToWarning <= 90 ? "warning" : "neutral",
    };
  }
  if (trend === "rising") return { text: "steigt", tone: "neutral" };
  if (trend === "falling") return { text: "sinkt", tone: "neutral" };
  if (trend === "stable") return { text: "stabil", tone: "neutral" };
  return { text: "zu wenig Verlauf", tone: "neutral" };
}

/** Sentence for the subnet detail («Warnschwelle 85 % in ca. 14 Monaten»). */
export function forecastSentence(
  forecast: Forecast | null | undefined,
  warningPercent: number,
): string {
  if (!forecast || forecast.trend === "unknown") {
    return "Noch zu wenig Verlauf für eine Prognose.";
  }
  if (forecast.daysToWarning !== null && forecast.daysToWarning > 0) {
    return `Warnschwelle ${warningPercent} % in ca. ${durationText(forecast.daysToWarning)}`;
  }
  if (forecast.daysToFull !== null) {
    return forecast.daysToFull <= 0
      ? "Das Subnetz ist voll."
      : `Voll in ca. ${durationText(forecast.daysToFull)}`;
  }
  if (forecast.trend === "falling") return "Auslastung sinkt.";
  if (forecast.trend === "rising") return "Auslastung steigt langsam.";
  return "Auslastung stabil.";
}

const FINDING_SHORT: Record<string, [string, string]> = {
  conflict: ["Konflikt", "Konflikte"],
  foreign_mac: ["fremde MAC", "fremde MACs"],
  ghost: ["Ghost-IP", "Ghost-IPs"],
  dns_mismatch: ["DNS", "DNS"],
  stale: ["veraltet", "veraltet"],
  utilization: ["Auslastung", "Auslastung"],
  outside_prefix: ["ausserhalb", "ausserhalb"],
};

/** «2 Konflikte · 4 Ghost-IPs · 1 DNS» from findingsByKind. */
export function findingsSummary(byKind: Record<string, number>): string {
  return Object.entries(byKind)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([kind, count]) => {
      const label = FINDING_SHORT[kind];
      return `${count} ${label ? (count === 1 ? label[0] : label[1]) : kind}`;
    })
    .join(" · ");
}

/** Tone of a utilization percent (warning threshold default 85 %). */
export function percentTone(
  percent: number | null | undefined,
  warningPercent = 85,
): "ok" | "warning" | "danger" | "none" {
  if (percent === null || percent === undefined) return "none";
  if (percent >= Math.max(95, warningPercent)) return "danger";
  if (percent >= warningPercent) return "warning";
  return "ok";
}

/** Whole percent text («41 %», «–» for null). */
export function percentText(percent: number | null | undefined): string {
  if (percent === null || percent === undefined) return "–";
  return `${Math.round(percent)} %`;
}

// ---------------------------------------------------------------------------
// History chart

export type HistoryChart = {
  width: number;
  height: number;
  /** «x,y x,y …» of the measured line. */
  measured: string;
  /** Dashed forecast line from the last point, or null. */
  forecast: { x1: number; y1: number; x2: number; y2: number } | null;
  last: { x: number; y: number } | null;
  warningY: number;
  gridLines: { y: number; label: string }[];
  startLabel: string;
  endLabel: string | null;
  description: string;
};

/**
 * SVG model of the utilization history (left 55 % measured, right part
 * forecast up to the threshold or «full» when a date is known).
 */
export function historyChart(
  history: UtilizationHistory,
  days: number,
  width = 640,
  height = 220,
): HistoryChart {
  const left = 40;
  const right = width - 10;
  const top = 20;
  const bottom = height - 20;
  const y = (percent: number) =>
    bottom - (Math.min(100, Math.max(0, percent)) / 100) * (bottom - top);
  const { forecast, points, warningPercent } = history;
  const target =
    forecast.daysToWarning !== null && forecast.daysToWarning > 0
      ? { days: forecast.daysToWarning, percent: warningPercent }
      : forecast.daysToFull !== null && forecast.daysToFull > 0
        ? { days: forecast.daysToFull, percent: 100 }
        : null;
  const measuredRight = target ? left + (right - left) * 0.55 : right;
  const step =
    points.length > 1 ? (measuredRight - left) / (points.length - 1) : 0;
  const coords = points.map((point, index) => ({
    x: Math.round((left + index * step) * 10) / 10,
    y: Math.round(y(point.percent) * 10) / 10,
  }));
  const last = coords[coords.length - 1] ?? null;
  const first = points[0];
  const lastPoint = points[points.length - 1];
  const description = lastPoint
    ? `Auslastung der letzten ${days} Tage${first ? ` von ${Math.round(first.percent)} auf ${Math.round(lastPoint.percent)} Prozent` : ""}. ${forecastSentence(forecast, warningPercent)}`
    : "Noch kein Verlauf vorhanden.";
  return {
    width,
    height,
    measured: coords.map((point) => `${point.x},${point.y}`).join(" "),
    forecast:
      target && last
        ? { x1: last.x, y1: last.y, x2: right, y2: y(target.percent) }
        : null,
    last,
    warningY: y(warningPercent),
    gridLines: [100, 75, 50, 25].map((value) => ({
      y: y(value),
      label: `${value} %`,
    })),
    startLabel: `vor ${days} Tagen`,
    endLabel: target ? `in ca. ${durationText(target.days)}` : null,
    description,
  };
}
