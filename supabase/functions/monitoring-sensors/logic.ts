/** Pure logic of the «Überwachung» endpoint: requests, states and series. */

export type SensorKind = "ping" | "tcp" | "http";
export type DisplayState = "down" | "warning" | "up" | "unknown" | "paused";
export type Range = "24h" | "7d" | "30d" | "1y";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HOST =
  /^(?=.{1,253}$)[a-z0-9_]([a-z0-9_-]{0,62}[a-z0-9_])?(\.[a-z0-9_]([a-z0-9_-]{0,62}[a-z0-9_])?)*$/i;
const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const IPV6 = /^[0-9a-f:]{2,39}$/i;

export const INTERVALS = [30, 60, 300, 600, 900, 1800, 3600] as const;
export const RANGES: readonly Range[] = ["24h", "7d", "30d", "1y"];

type Row = Record<string, unknown>;

function isObject(value: unknown): value is Row {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function uuid(value: unknown): string | null {
  return typeof value === "string" && UUID.test(value) ? value.toLowerCase() : null;
}

export type SensorInput = {
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

export type Action =
  | { type: "overview"; tenantId: string }
  | { type: "device"; tenantId: string; assetId: string }
  | { type: "series"; tenantId: string; sensorId: string; range: Range }
  | { type: "assets"; tenantId: string; query: string }
  | { type: "saveSensor"; tenantId: string; sensor: SensorInput }
  | { type: "deleteSensor"; tenantId: string; sensorId: string }
  | { type: "pauseDevice"; tenantId: string; assetId: string; paused: boolean }
  | { type: "createAgent"; tenantId: string; name: string }
  | { type: "probePackage"; tenantId: string };

export function defaultName(kind: SensorKind, port: number | null, url: string | null): string {
  if (kind === "ping") return "Ping";
  if (kind === "tcp") return `Port ${port}`;
  try {
    return `HTTP ${new URL(url ?? "").host}`.slice(0, 120);
  } catch {
    return "HTTP";
  }
}

/** Validated sensor or the German message why it is not valid. */
export function parseSensor(value: unknown): SensorInput | string {
  if (!isObject(value)) return "Die Angaben zum Sensor fehlen.";
  const assetId = uuid(value.assetId);
  if (!assetId) return "Das Gerät fehlt.";
  const kind = value.kind;
  if (kind !== "ping" && kind !== "tcp" && kind !== "http") return "Die Art des Sensors ist ungültig.";
  const id = value.id === null || value.id === undefined ? null : uuid(value.id);
  if (value.id && !id) return "Der Sensor ist ungültig.";
  const agentId = value.agentId === null || value.agentId === undefined || value.agentId === ""
    ? null
    : uuid(value.agentId);
  if (value.agentId && !agentId) return "Die Sonde ist ungültig.";

  let target: string | null = null;
  if (typeof value.target === "string" && value.target.trim()) {
    target = value.target.trim().replace(/\.$/, "").toLowerCase();
    if (!IPV4.test(target) && !(target.includes(":") && IPV6.test(target)) && !HOST.test(target)) {
      return "Das Ziel muss eine IP-Adresse oder ein Hostname sein.";
    }
  }
  let port: number | null = null;
  let url: string | null = null;
  if (kind === "tcp") {
    port = typeof value.port === "number" && Number.isInteger(value.port) ? value.port : NaN;
    if (!(port >= 1 && port <= 65535)) return "Der Port muss zwischen 1 und 65535 liegen.";
  }
  if (kind === "http") {
    try {
      const parsed = new URL(String(value.url ?? "").trim());
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("protocol");
      if (parsed.username || parsed.password) {
        return "Die Adresse darf keine Zugangsdaten enthalten.";
      }
      url = parsed.href;
    } catch {
      return "Die Adresse muss mit http:// oder https:// beginnen.";
    }
    if (url.length > 500) return "Die Adresse ist zu lang.";
    target = null;
  }
  const intervalSeconds = typeof value.intervalSeconds === "number" ? value.intervalSeconds : 60;
  if (!(INTERVALS as readonly number[]).includes(intervalSeconds)) return "Das Intervall ist ungültig.";
  const timeoutMs = typeof value.timeoutMs === "number" && Number.isInteger(value.timeoutMs)
    ? value.timeoutMs
    : 5000;
  if (timeoutMs < 500 || timeoutMs > 30000) return "Das Zeitlimit muss zwischen 0,5 und 30 Sekunden liegen.";
  let warningAbove: number | null = null;
  if (value.warningAbove !== null && value.warningAbove !== undefined && value.warningAbove !== "") {
    if (typeof value.warningAbove !== "number" || !(value.warningAbove > 0) || value.warningAbove > 60000) {
      return "Die Warnschwelle muss zwischen 1 und 60000 ms liegen.";
    }
    warningAbove = value.warningAbove;
  }
  const failuresToDown = typeof value.failuresToDown === "number" && Number.isInteger(value.failuresToDown)
    ? value.failuresToDown
    : 2;
  if (failuresToDown < 1 || failuresToDown > 10) return "Die Anzahl Fehlversuche muss zwischen 1 und 10 liegen.";
  const rawName = typeof value.name === "string" ? value.name.replace(/\s+/g, " ").trim() : "";
  if (rawName.length > 120) return "Der Name ist zu lang (höchstens 120 Zeichen).";
  return {
    id,
    assetId,
    agentId,
    kind,
    name: rawName || defaultName(kind, port, url),
    target,
    port,
    url,
    intervalSeconds,
    timeoutMs,
    warningAbove,
    failuresToDown,
    paused: value.paused === true,
  };
}

export function parseAction(value: unknown): Action | string | null {
  if (!isObject(value)) return null;
  const tenantId = uuid(value.tenantId);
  if (!tenantId) return null;
  switch (value.type) {
    case "overview":
      return { type: "overview", tenantId };
    case "device": {
      const assetId = uuid(value.assetId);
      return assetId ? { type: "device", tenantId, assetId } : null;
    }
    case "series": {
      const sensorId = uuid(value.sensorId);
      const range = RANGES.includes(value.range as Range) ? (value.range as Range) : null;
      return sensorId && range ? { type: "series", tenantId, sensorId, range } : null;
    }
    case "assets":
      return {
        type: "assets",
        tenantId,
        query: typeof value.query === "string" ? value.query.trim().slice(0, 80) : "",
      };
    case "saveSensor": {
      const sensor = parseSensor(value.sensor);
      return typeof sensor === "string" ? sensor : { type: "saveSensor", tenantId, sensor };
    }
    case "deleteSensor": {
      const sensorId = uuid(value.sensorId);
      return sensorId ? { type: "deleteSensor", tenantId, sensorId } : null;
    }
    case "pauseDevice": {
      const assetId = uuid(value.assetId);
      return assetId && typeof value.paused === "boolean"
        ? { type: "pauseDevice", tenantId, assetId, paused: value.paused }
        : null;
    }
    case "probePackage":
      return { type: "probePackage", tenantId };
    case "createAgent": {
      const name = typeof value.name === "string" ? value.name.replace(/\s+/g, " ").trim() : "";
      if (!name) return "Bitte einen Namen für die Sonde angeben.";
      if (name.length > 120) return "Der Name ist zu lang (höchstens 120 Zeichen).";
      return { type: "createAgent", tenantId, name };
    }
    default:
      return null;
  }
}

/**
 * The config.json of a new probe: everything it needs to connect. Secrets
 * for later sensor types (SNMP) are added locally on the server.
 */
export function probeConfig(functionsUrl: string, token: string): string {
  return `${JSON.stringify({
    nextdeskUrl: `${functionsUrl.replace(/\/+$/, "")}/ipam-agent`,
    agentToken: token,
    logLevel: "info",
  }, null, 2)}\n`;
}

/** A probe counts as online while it reported within the last three minutes. */
export function agentOnline(lastSeenAt: string | null, now: number): boolean {
  const seen = lastSeenAt ? Date.parse(lastSeenAt) : NaN;
  return Number.isFinite(seen) && now - seen <= 3 * 60 * 1000;
}

/**
 * State shown for a sensor. A stored state is only trusted while results
 * keep coming: without a probe, or without a result for three intervals
 * (at least three minutes), the sensor is «unbekannt».
 */
export function displayState(
  sensor: { paused: boolean; agentId: string | null; intervalSeconds: number },
  status: { state: string | null; lastCheckAt: string | null } | null,
  now: number,
): DisplayState {
  if (sensor.paused) return "paused";
  if (!sensor.agentId || !status?.lastCheckAt) return "unknown";
  const last = Date.parse(status.lastCheckAt);
  const limit = Math.max(sensor.intervalSeconds * 3, 180) * 1000;
  if (!Number.isFinite(last) || now - last > limit) return "unknown";
  return status.state === "down" || status.state === "warning" || status.state === "up"
    ? status.state
    : "unknown";
}

const ORDER: DisplayState[] = ["down", "warning", "unknown", "up", "paused"];

/** Worst state of the sensors of a device (all paused → paused). */
export function deviceState(states: readonly DisplayState[]): DisplayState {
  for (const state of ORDER) if (states.includes(state)) return state;
  return "unknown";
}

export type Point = {
  t: string;
  avg: number | null;
  min: number | null;
  max: number | null;
  /** Share of successful checks (0–1). */
  ok: number;
};

export function rangePlan(range: Range, now: number): { source: "raw" | "hourly" | "daily"; from: string; bucketMs: number } {
  const hour = 3600_000;
  switch (range) {
    case "24h":
      return { source: "raw", from: new Date(now - 24 * hour).toISOString(), bucketMs: 5 * 60_000 };
    case "7d":
      return { source: "hourly", from: new Date(now - 7 * 24 * hour).toISOString(), bucketMs: hour };
    case "30d":
      return { source: "hourly", from: new Date(now - 30 * 24 * hour).toISOString(), bucketMs: 4 * hour };
    default:
      return { source: "daily", from: new Date(now - 365 * 24 * hour).toISOString(), bucketMs: 24 * hour };
  }
}

/**
 * Groups measurements into buckets of `bucketMs`. Each entry is already an
 * aggregate (`checks` measurements); raw samples have checks = 1.
 */
export function bucketize(
  entries: readonly { at: number; checks: number; checksOk: number; avg: number | null; min: number | null; max: number | null }[],
  bucketMs: number,
): Point[] {
  const buckets = new Map<number, { checks: number; ok: number; sum: number; weight: number; min: number | null; max: number | null }>();
  for (const entry of entries) {
    if (!Number.isFinite(entry.at) || entry.checks <= 0) continue;
    const key = Math.floor(entry.at / bucketMs) * bucketMs;
    const bucket = buckets.get(key) ?? { checks: 0, ok: 0, sum: 0, weight: 0, min: null, max: null };
    bucket.checks += entry.checks;
    bucket.ok += entry.checksOk;
    if (entry.avg !== null) {
      // Only successful checks carry a value.
      const weight = Math.max(entry.checksOk, 1);
      bucket.sum += entry.avg * weight;
      bucket.weight += weight;
    }
    if (entry.min !== null) bucket.min = bucket.min === null ? entry.min : Math.min(bucket.min, entry.min);
    if (entry.max !== null) bucket.max = bucket.max === null ? entry.max : Math.max(bucket.max, entry.max);
    buckets.set(key, bucket);
  }
  const round = (value: number | null) => value === null ? null : Math.round(value * 100) / 100;
  return [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([key, bucket]) => ({
    t: new Date(key).toISOString(),
    avg: round(bucket.weight ? bucket.sum / bucket.weight : null),
    min: round(bucket.min),
    max: round(bucket.max),
    ok: Math.round((bucket.ok / bucket.checks) * 10000) / 10000,
  }));
}

/** Availability in percent over the points (null without measurements). */
export function availability(points: readonly Point[]): number | null {
  if (!points.length) return null;
  const sum = points.reduce((total, point) => total + point.ok, 0);
  return Math.round((sum / points.length) * 10000) / 100;
}

export type ProbePackage = {
  version: string;
  build: string;
  file: string;
  size: number;
  sha256: string;
  builtAt: string;
};

/** latest.json of the bucket «probe-packages» (written by the publish workflow). */
export function parseProbePackage(value: unknown): ProbePackage | null {
  if (!isObject(value)) return null;
  const { version, build, file, size, sha256, builtAt } = value;
  if (
    typeof version !== "string" || !/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(version) ||
    typeof build !== "string" || !/^[0-9A-Za-z._-]{1,40}$/.test(build) ||
    typeof file !== "string" || !/^nextdesk-sonde-[0-9A-Za-z._-]{1,80}\.zip$/.test(file) ||
    typeof size !== "number" || !(size > 0) ||
    typeof sha256 !== "string" || !/^[0-9a-f]{64}$/.test(sha256) ||
    typeof builtAt !== "string" || !Number.isFinite(Date.parse(builtAt))
  ) {
    return null;
  }
  return { version, build, file, size, sha256, builtAt };
}

/** True when `installed` (e.g. «1.0.0») is older than `latest`. */
export function isOlderVersion(installed: string | null, latest: string | null): boolean {
  if (!installed || !latest) return false;
  const parts = (text: string) => /^(\d+)\.(\d+)\.(\d+)/.exec(text)?.slice(1).map(Number) ?? null;
  const a = parts(installed);
  const b = parts(latest);
  if (!a || !b) return false;
  for (let index = 0; index < 3; index += 1) {
    if (a[index]! !== b[index]!) return a[index]! < b[index]!;
  }
  return false;
}
