// Überwachung: Typen, Aufrufe der Edge Function `monitoring-sensors` und
// reine Hilfsfunktionen (Beschriftungen, Formatierung, Grafikpfade).

import { supabase } from "./supabase";

export type MonitoringState = "down" | "warning" | "up" | "unknown" | "paused";
export type SensorKind = "ping" | "tcp" | "http";
export type MonitoringRange = "24h" | "7d" | "30d" | "1y";

export type MonitoringIncident = {
  id: string;
  number: string;
  title: string;
  severity: string;
  openedAt: string | null;
  acknowledged: boolean;
  maintenance: boolean;
};

export type MonitoringAgent = {
  id: string;
  name: string;
  active: boolean;
  hostname: string | null;
  platform: string | null;
  version: string | null;
  lastSeenAt: string | null;
  online: boolean;
  sensorCount?: number;
};

export type MonitoringDeviceRow = {
  assetId: string;
  name: string;
  category: string | null;
  hostname: string | null;
  ipAddress: string | null;
  state: MonitoringState;
  counts: Record<MonitoringState, number>;
  sensorCount: number;
  responseMs: number | null;
  lastCheckAt: string | null;
  problem: {
    sensorId: string;
    sensorName: string;
    state: MonitoringState;
    since: string | null;
    message: string | null;
  } | null;
  incident: MonitoringIncident | null;
};

export type MonitoringOverview = {
  canManage: boolean;
  totals: Record<MonitoringState, number>;
  deviceCount: number;
  sensorCount: number;
  devices: MonitoringDeviceRow[];
  agents: MonitoringAgent[];
  checkedAt: string;
};

export type MonitoringSensor = {
  id: string;
  assetId: string;
  agentId: string | null;
  kind: SensorKind;
  name: string;
  target: string | null;
  port: number | null;
  url: string | null;
  intervalSeconds: number;
  timeoutMs: number;
  warningAbove: number | null;
  failuresToDown: number;
  paused: boolean;
  state: MonitoringState;
  since: string | null;
  lastCheckAt: string | null;
  lastValue: number | null;
  lastMessage: string | null;
};

export type MonitoringDeviceDetail = {
  canManage: boolean;
  device: {
    assetId: string;
    name: string;
    category: string | null;
    hostname: string | null;
    ipAddress: string | null;
    state: MonitoringState;
    services: { id: string; name: string }[];
    uplink: { assetId: string; name: string } | null;
    incident: MonitoringIncident | null;
  };
  sensors: MonitoringSensor[];
  agents: MonitoringAgent[];
  checkedAt: string;
};

export type MonitoringPoint = {
  t: string;
  avg: number | null;
  min: number | null;
  max: number | null;
  ok: number;
};

export type MonitoringSeries = {
  sensorId: string;
  range: MonitoringRange;
  from: string;
  bucketSeconds: number;
  points: MonitoringPoint[];
  availability: number | null;
};

export type MonitoringAssetChoice = {
  assetId: string;
  name: string;
  category: string | null;
  hostname: string | null;
  ipAddress: string | null;
  monitored: boolean;
};

export type SensorDraft = {
  id: string | null;
  assetId: string;
  agentId: string | null;
  kind: SensorKind;
  name: string;
  target: string | null;
  port: number | null;
  url: string | null;
  intervalSeconds: number;
  timeoutMs: number;
  warningAbove: number | null;
  failuresToDown: number;
  paused: boolean;
};

/** Calls `monitoring-sensors`; throws an Error with the German message. */
export async function monitoringCall<T>(
  body: Record<string, unknown>,
): Promise<T> {
  if (!supabase) throw new Error("Die Verbindung ist nicht konfiguriert.");
  const { data, error } = await supabase.functions.invoke(
    "monitoring-sensors",
    { body },
  );
  if (error) {
    const context = (error as { context?: unknown }).context;
    if (context instanceof Response) {
      const payload = (await context.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      if (payload?.error?.message) throw new Error(payload.error.message);
    }
    throw new Error("Die Überwachung ist gerade nicht erreichbar.");
  }
  return (data as { data: T }).data;
}

export const STATE_LABELS: Record<MonitoringState, string> = {
  down: "Ausfall",
  warning: "Warnung",
  up: "OK",
  unknown: "Unbekannt",
  paused: "Pausiert",
};

export const STATE_ORDER: readonly MonitoringState[] = [
  "down",
  "warning",
  "up",
  "unknown",
  "paused",
];

export const KIND_LABELS: Record<SensorKind, string> = {
  ping: "Ping",
  tcp: "TCP-Port",
  http: "HTTP",
};

export const CATEGORY_LABELS: Record<string, string> = {
  server: "Server",
  switch: "Switch",
  access_point: "Access Point",
  firewall: "Firewall",
  router: "Router",
  storage: "Storage",
  ups: "USV",
  virtual_host: "Virtualisierungshost",
  other: "Gerät",
};

export const INTERVAL_OPTIONS: readonly { seconds: number; label: string }[] = [
  { seconds: 30, label: "30 Sekunden" },
  { seconds: 60, label: "1 Minute" },
  { seconds: 300, label: "5 Minuten" },
  { seconds: 600, label: "10 Minuten" },
  { seconds: 900, label: "15 Minuten" },
  { seconds: 1800, label: "30 Minuten" },
  { seconds: 3600, label: "1 Stunde" },
];

export const RANGE_LABELS: Record<MonitoringRange, string> = {
  "24h": "24 Std.",
  "7d": "7 Tage",
  "30d": "30 Tage",
  "1y": "1 Jahr",
};

export function intervalLabel(seconds: number): string {
  return (
    INTERVAL_OPTIONS.find((option) => option.seconds === seconds)?.label ??
    `${seconds} Sek.`
  );
}

export function formatMs(value: number | null): string {
  if (value === null) return "–";
  if (value < 10)
    return `${(Math.round(value * 10) / 10).toLocaleString("de-CH")} ms`;
  return `${Math.round(value).toLocaleString("de-CH")} ms`;
}

/** «vor 12 Sek.», «vor 4 Min.», «vor 3 Std.», «vor 2 Tagen». */
export function formatAgo(iso: string | null, now: number): string {
  const at = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(at)) return "noch nie";
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 60) return `vor ${seconds} Sek.`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `vor ${minutes} Min.`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `vor ${hours} Std.`;
  return `vor ${Math.round(hours / 24)} Tagen`;
}

/** «seit 14 Min.» for a state that began at `iso`. */
export function formatSince(iso: string | null, now: number): string {
  return iso ? formatAgo(iso, now).replace(/^vor /, "seit ") : "";
}

/** What a sensor measures, e.g. «10.0.0.2», «srv01:3389», the URL. */
export function sensorTarget(
  sensor: Pick<MonitoringSensor, "kind" | "target" | "port" | "url">,
  device: { ipAddress: string | null; hostname: string | null },
): string {
  if (sensor.kind === "http") return sensor.url ?? "";
  const host = sensor.target ?? device.ipAddress ?? device.hostname ?? "";
  return sensor.kind === "tcp" ? `${host}:${sensor.port}` : host;
}

export function sensorCountsText(
  counts: Record<MonitoringState, number>,
): string {
  const parts = STATE_ORDER.filter((state) => counts[state] > 0).map(
    (state) => `${counts[state]} ${STATE_LABELS[state]}`,
  );
  return parts.join(" · ") || "keine Sensoren";
}

export function matchesSearch(
  device: MonitoringDeviceRow,
  search: string,
): boolean {
  const term = search.trim().toLowerCase();
  if (!term) return true;
  return [
    device.name,
    device.hostname,
    device.ipAddress,
    device.problem?.sensorName,
  ].some((value) => value?.toLowerCase().includes(term));
}

export type ChartGeometry = {
  width: number;
  height: number;
  /** Line segments (a gap where no value was measured). */
  lines: string[];
  /** Min–max band per segment. */
  bands: string[];
  /** Buckets with failed checks: x position and width. */
  failures: { x: number; width: number; share: number }[];
  yTicks: { y: number; label: string }[];
  xTicks: { x: number; label: string }[];
  threshold: number | null;
};

const PAD = { left: 46, right: 10, top: 10, bottom: 22 };

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 5, 10]) {
    if (value <= step * magnitude) return step * magnitude;
  }
  return 10 * magnitude;
}

function tickLabel(time: number, range: MonitoringRange): string {
  const date = new Date(time);
  if (range === "24h") {
    return date.toLocaleTimeString("de-CH", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return date.toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit" });
}

/** Geometry of the history chart (pure, so it can be tested without a DOM). */
export function chartGeometry(
  series: Pick<MonitoringSeries, "points" | "from" | "range" | "bucketSeconds">,
  now: number,
  warningAbove: number | null,
  width = 640,
  height = 220,
): ChartGeometry {
  const start = Date.parse(series.from);
  const span = Math.max(now - start, 1);
  const innerWidth = width - PAD.left - PAD.right;
  const innerHeight = height - PAD.top - PAD.bottom;
  const values = series.points.flatMap((point) =>
    point.max !== null ? [point.max] : point.avg !== null ? [point.avg] : [],
  );
  const top = niceMax(Math.max(...values, warningAbove ?? 0, 1));
  const x = (time: number) =>
    PAD.left + Math.min(Math.max((time - start) / span, 0), 1) * innerWidth;
  const y = (value: number) =>
    PAD.top + (1 - Math.min(value / top, 1)) * innerHeight;
  const round = (value: number) => Math.round(value * 10) / 10;
  const bucketMs = series.bucketSeconds * 1000;

  const lines: string[] = [];
  const bands: string[] = [];
  let segment: MonitoringPoint[] = [];
  const flush = () => {
    if (!segment.length) return;
    const at = (point: MonitoringPoint) =>
      round(x(Date.parse(point.t) + bucketMs / 2));
    lines.push(
      segment
        .map(
          (point, index) =>
            `${index ? "L" : "M"}${at(point)},${round(y(point.avg ?? 0))}`,
        )
        .join(" "),
    );
    if (segment.some((point) => point.max !== point.min)) {
      const upper = segment.map(
        (point, index) =>
          `${index ? "L" : "M"}${at(point)},${round(y(point.max ?? point.avg ?? 0))}`,
      );
      const lower = [...segment]
        .reverse()
        .map(
          (point) => `L${at(point)},${round(y(point.min ?? point.avg ?? 0))}`,
        );
      bands.push(`${upper.join(" ")} ${lower.join(" ")} Z`);
    }
    segment = [];
  };
  let previous: number | null = null;
  for (const point of series.points) {
    const time = Date.parse(point.t);
    if (
      point.avg === null ||
      (previous !== null && time - previous > bucketMs * 1.5)
    )
      flush();
    if (point.avg !== null) segment.push(point);
    previous = time;
  }
  flush();

  const failures = series.points
    .filter((point) => point.ok < 1)
    .map((point) => ({
      x: round(x(Date.parse(point.t))),
      width: Math.max(round((bucketMs / span) * innerWidth), 2),
      share: 1 - point.ok,
    }));
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((share) => ({
    y: round(y(top * share)),
    label: formatMs(top * share).replace(" ms", ""),
  }));
  const xTicks = [0, 0.25, 0.5, 0.75, 1].map((share) => ({
    x: round(PAD.left + share * innerWidth),
    label: tickLabel(start + share * span, series.range),
  }));
  return {
    width,
    height,
    lines,
    bands,
    failures,
    yTicks,
    xTicks,
    threshold:
      warningAbove !== null && warningAbove <= top
        ? round(y(warningAbove))
        : null,
  };
}

export function emptyDraft(
  assetId: string,
  agentId: string | null,
): SensorDraft {
  return {
    id: null,
    assetId,
    agentId,
    kind: "ping",
    name: "",
    target: null,
    port: null,
    url: null,
    intervalSeconds: 60,
    timeoutMs: 5000,
    warningAbove: null,
    failuresToDown: 2,
    paused: false,
  };
}

export function draftFromSensor(sensor: MonitoringSensor): SensorDraft {
  return {
    id: sensor.id,
    assetId: sensor.assetId,
    agentId: sensor.agentId,
    kind: sensor.kind,
    name: sensor.name,
    target: sensor.target,
    port: sensor.port,
    url: sensor.url,
    intervalSeconds: sensor.intervalSeconds,
    timeoutMs: sensor.timeoutMs,
    warningAbove: sensor.warningAbove,
    failuresToDown: sensor.failuresToDown,
    paused: sensor.paused,
  };
}
