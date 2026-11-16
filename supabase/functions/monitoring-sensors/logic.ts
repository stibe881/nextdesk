/** Pure logic of the «Überwachung» endpoint: requests, states and series. */

export type SensorKind = "ping" | "tcp" | "http" | "snmp" | "cert" | "dns";
export type SnmpMetric = "uptime" | "traffic" | "value";
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
  warningBelow: number | null;
  downAbove: number | null;
  downBelow: number | null;
  snmpMetric: SnmpMetric | null;
  snmpOid: string | null;
  snmpIndex: number | null;
  scale: number;
  unit: string | null;
  /** DNS: address the name must resolve to. */
  expect: string | null;
  /** Measured by nextDesk itself instead of a probe (http, cert, dns). */
  cloud: boolean;
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
  | { type: "removeDevice"; tenantId: string; assetId: string }
  | { type: "updateDevice"; tenantId: string; assetId: string; device: DeviceEdit }
  | { type: "createAgent"; tenantId: string; name: string }
  | { type: "probePackage"; tenantId: string }
  | { type: "listInterfaces"; tenantId: string; assetId: string; agentId: string }
  | { type: "interfaces"; tenantId: string; jobId: string }
  | { type: "addDevice"; tenantId: string; device: NewDevice };

export const DEVICE_CATEGORIES = [
  "server",
  "switch",
  "access_point",
  "firewall",
  "router",
  "storage",
  "ups",
  "virtual_host",
  "other",
] as const;

/** A device that is not in the infrastructure yet. */
export type NewDevice = {
  name: string;
  category: (typeof DEVICE_CATEGORIES)[number];
  ipAddress: string | null;
  hostname: string | null;
  agentId: string | null;
  /** Entry of the IP address management the device was picked from. */
  ipamAddressId: string | null;
};

/** Validated new device or the German message why it is not valid. */
export function parseNewDevice(value: unknown): NewDevice | string {
  if (!isObject(value)) return "Die Angaben zum Gerät fehlen.";
  const name = typeof value.name === "string" ? value.name.replace(/\s+/g, " ").trim() : "";
  if (!name) return "Bitte einen Namen für das Gerät angeben.";
  if (name.length > 160) return "Der Name ist zu lang (höchstens 160 Zeichen).";
  if (!(DEVICE_CATEGORIES as readonly string[]).includes(String(value.category))) {
    return "Die Geräteart ist ungültig.";
  }
  const address = typeof value.address === "string" ? value.address.trim().replace(/\.$/, "").toLowerCase() : "";
  if (!address) return "Bitte IP-Adresse oder Hostname angeben.";
  const isIp = IPV4.test(address) || (address.includes(":") && IPV6.test(address));
  if (!isIp && !HOST.test(address)) return "Die Adresse muss eine IP-Adresse oder ein Hostname sein.";
  const agentId = value.agentId === null || value.agentId === undefined || value.agentId === ""
    ? null
    : uuid(value.agentId);
  if (value.agentId && !agentId) return "Die Sonde ist ungültig.";
  const ipamAddressId = value.ipamAddressId === null || value.ipamAddressId === undefined
    ? null
    : uuid(value.ipamAddressId);
  if (value.ipamAddressId && !ipamAddressId) return "Der Eintrag der IP-Adressverwaltung ist ungültig.";
  return {
    name,
    category: value.category as NewDevice["category"],
    ipAddress: isIp ? address : null,
    hostname: isIp ? null : address,
    agentId,
    ipamAddressId,
  };
}

/** Fields of a device that can be changed from the monitoring. */
export type DeviceEdit = {
  name: string;
  category: (typeof DEVICE_CATEGORIES)[number];
  ipAddress: string | null;
  hostname: string | null;
};

/** Validated changes of a device or the German message why they are not valid. */
export function parseDeviceEdit(value: unknown): DeviceEdit | string {
  if (!isObject(value)) return "Die Angaben zum Gerät fehlen.";
  const name = typeof value.name === "string" ? value.name.replace(/\s+/g, " ").trim() : "";
  if (!name) return "Bitte einen Namen für das Gerät angeben.";
  if (name.length > 160) return "Der Name ist zu lang (höchstens 160 Zeichen).";
  if (!(DEVICE_CATEGORIES as readonly string[]).includes(String(value.category))) {
    return "Die Geräteart ist ungültig.";
  }
  const clean = (raw: unknown) => typeof raw === "string" ? raw.trim().replace(/\.$/, "").toLowerCase() : "";
  const ipAddress = clean(value.ipAddress);
  if (ipAddress && !IPV4.test(ipAddress) && !(ipAddress.includes(":") && IPV6.test(ipAddress))) {
    return "Die IP-Adresse ist ungültig.";
  }
  const hostname = clean(value.hostname);
  if (hostname && !HOST.test(hostname)) return "Der Hostname ist ungültig.";
  return {
    name,
    category: value.category as DeviceEdit["category"],
    ipAddress: ipAddress || null,
    hostname: hostname || null,
  };
}

/** Whether an entry of the IP address management matches the search text. */
export function matchesAddress(
  entry: { address: string; hostname: string | null; description: string | null },
  query: string,
): boolean {
  const term = query.trim().toLowerCase();
  if (term.length < 2) return false;
  return [entry.address, entry.hostname, entry.description].some((text) => text?.toLowerCase().includes(term));
}

export function defaultName(
  kind: SensorKind,
  port: number | null,
  url: string | null,
  snmp: { metric: SnmpMetric | null; index: number | null; oid: string | null; host?: string | null } = {
    metric: null,
    index: null,
    oid: null,
  },
): string {
  if (kind === "ping") return "Ping";
  if (kind === "cert") return `Zertifikat ${snmp.host ?? ""}`.trim().slice(0, 120);
  if (kind === "dns") return `DNS ${snmp.host ?? ""}`.trim().slice(0, 120);
  if (kind === "snmp") {
    if (snmp.metric === "uptime") return "Laufzeit";
    if (snmp.metric === "traffic") return `Port ${snmp.index} Traffic`;
    return `SNMP ${(snmp.oid ?? "").split(".").slice(-3).join(".")}`;
  }
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
  const kind = value.kind as SensorKind;
  if (!["ping", "tcp", "http", "snmp", "cert", "dns"].includes(String(kind))) {
    return "Die Art des Sensors ist ungültig.";
  }
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
  let expect: string | null = null;
  const cloud = value.cloud === true;
  if (cloud) {
    if (kind !== "http" && kind !== "cert" && kind !== "dns") {
      return "Aus der Cloud lassen sich nur HTTP, Zertifikat und DNS messen.";
    }
    if (agentId) return "Ein Sensor wird entweder von einer Sonde oder aus der Cloud gemessen.";
  }
  if (kind === "cert" || kind === "dns") {
    if (!target) return "Bitte den Hostnamen angeben.";
    if (kind === "cert") {
      port = value.port === null || value.port === undefined || value.port === ""
        ? 443
        : typeof value.port === "number" && Number.isInteger(value.port)
        ? value.port
        : NaN;
      if (!(port >= 1 && port <= 65535)) return "Der Port muss zwischen 1 und 65535 liegen.";
    } else if (typeof value.expect === "string" && value.expect.trim()) {
      expect = value.expect.trim().toLowerCase();
      if (!IPV4.test(expect) && !(expect.includes(":") && IPV6.test(expect))) {
        return "Die erwartete Adresse muss eine IP-Adresse sein.";
      }
    }
  }
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
  let snmpMetric: SnmpMetric | null = null;
  let snmpOid: string | null = null;
  let snmpIndex: number | null = null;
  let scale = 1;
  let unit: string | null = null;
  if (kind === "snmp") {
    if (value.snmpMetric !== "uptime" && value.snmpMetric !== "traffic" && value.snmpMetric !== "value") {
      return "Die Messart des SNMP-Sensors ist ungültig.";
    }
    snmpMetric = value.snmpMetric;
    if (snmpMetric === "traffic") {
      snmpIndex = typeof value.snmpIndex === "number" && Number.isInteger(value.snmpIndex) ? value.snmpIndex : NaN;
      if (!(snmpIndex >= 1 && snmpIndex <= 2147483647)) return "Der Port (ifIndex) fehlt.";
      unit = "bit/s";
    } else if (snmpMetric === "uptime") {
      unit = "s";
    } else {
      snmpOid = typeof value.snmpOid === "string" ? value.snmpOid.trim().replace(/^\./, "") : "";
      if (!/^1(\.[0-9]{1,10}){2,60}$/.test(snmpOid)) {
        return "Die OID muss aus Zahlen mit Punkten bestehen, z. B. 1.3.6.1.2.1.1.3.0.";
      }
      if (value.scale !== null && value.scale !== undefined && value.scale !== "") {
        if (typeof value.scale !== "number" || !(value.scale > 0) || value.scale > 1e12) {
          return "Der Faktor muss grösser als 0 sein.";
        }
        scale = value.scale;
      }
      const rawUnit = typeof value.unit === "string" ? value.unit.trim() : "";
      if (rawUnit.length > 12) return "Die Einheit ist zu lang (höchstens 12 Zeichen).";
      unit = rawUnit || null;
    }
  }
  // Response times are limited to a minute; SNMP values and days are free.
  const free = kind === "snmp" || kind === "cert";
  if (kind === "cert") unit = "Tg.";
  const limit = free ? 1e15 : 60000;
  const threshold = (raw: unknown, label: string): number | null | string => {
    if (raw === null || raw === undefined || raw === "") return null;
    if (typeof raw !== "number" || !Number.isFinite(raw) || Math.abs(raw) > limit || (!free && raw <= 0)) {
      return free
        ? `${label} muss eine Zahl sein.`
        : `${label} muss zwischen 1 und 60000 ms liegen.`;
    }
    return raw;
  };
  const warningAbove = threshold(value.warningAbove, "Die Warnschwelle");
  if (typeof warningAbove === "string") return warningAbove;
  // A new certificate sensor warns 30 days and fails 7 days before expiry.
  const certDefault = (raw: unknown, days: number) => kind === "cert" && raw === undefined ? days : raw;
  const warningBelow = free ? threshold(certDefault(value.warningBelow, 30), "Die untere Warnschwelle") : null;
  if (typeof warningBelow === "string") return warningBelow;
  const downAbove = free ? threshold(value.downAbove, "Die Ausfall-Schwelle") : null;
  if (typeof downAbove === "string") return downAbove;
  const downBelow = free ? threshold(certDefault(value.downBelow, 7), "Die untere Ausfall-Schwelle") : null;
  if (typeof downBelow === "string") return downBelow;
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
    name: rawName || defaultName(kind, port, url, { metric: snmpMetric, index: snmpIndex, oid: snmpOid, host: target }),
    target,
    port,
    url,
    intervalSeconds,
    timeoutMs,
    warningAbove,
    warningBelow,
    downAbove,
    downBelow,
    snmpMetric,
    snmpOid,
    snmpIndex,
    scale,
    unit,
    expect,
    cloud,
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
    case "updateDevice": {
      const assetId = uuid(value.assetId);
      if (!assetId) return null;
      const device = parseDeviceEdit(value.device);
      return typeof device === "string" ? device : { type: "updateDevice", tenantId, assetId, device };
    }
    case "removeDevice": {
      const assetId = uuid(value.assetId);
      return assetId ? { type: "removeDevice", tenantId, assetId } : null;
    }
    case "pauseDevice": {
      const assetId = uuid(value.assetId);
      return assetId && typeof value.paused === "boolean"
        ? { type: "pauseDevice", tenantId, assetId, paused: value.paused }
        : null;
    }
    case "probePackage":
      return { type: "probePackage", tenantId };
    case "listInterfaces": {
      const assetId = uuid(value.assetId);
      const agentId = uuid(value.agentId);
      return assetId && agentId ? { type: "listInterfaces", tenantId, assetId, agentId } : null;
    }
    case "interfaces": {
      const jobId = uuid(value.jobId);
      return jobId ? { type: "interfaces", tenantId, jobId } : null;
    }
    case "addDevice": {
      const device = parseNewDevice(value.device);
      return typeof device === "string" ? device : { type: "addDevice", tenantId, device };
    }
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
  sensor: { paused: boolean; agentId: string | null; intervalSeconds: number; cloud?: boolean },
  status: { state: string | null; lastCheckAt: string | null } | null,
  now: number,
): DisplayState {
  if (sensor.paused) return "paused";
  if ((!sensor.agentId && !sensor.cloud) || !status?.lastCheckAt) return "unknown";
  const last = Date.parse(status.lastCheckAt);
  // Cloud checks run from a job once a minute, so they get more slack.
  const limit = Math.max(sensor.intervalSeconds * 3, sensor.cloud ? 300 : 180) * 1000;
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
  /** Second value (outgoing traffic), when the sensor has one. */
  avg2?: number | null;
  max2?: number | null;
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
  entries: readonly {
    at: number;
    checks: number;
    checksOk: number;
    avg: number | null;
    min: number | null;
    max: number | null;
    avg2?: number | null;
    max2?: number | null;
  }[],
  bucketMs: number,
): Point[] {
  const buckets = new Map<number, {
    checks: number;
    ok: number;
    sum: number;
    weight: number;
    min: number | null;
    max: number | null;
    sum2: number;
    weight2: number;
    max2: number | null;
  }>();
  for (const entry of entries) {
    if (!Number.isFinite(entry.at) || entry.checks <= 0) continue;
    const key = Math.floor(entry.at / bucketMs) * bucketMs;
    const bucket = buckets.get(key) ??
      { checks: 0, ok: 0, sum: 0, weight: 0, min: null, max: null, sum2: 0, weight2: 0, max2: null };
    bucket.checks += entry.checks;
    bucket.ok += entry.checksOk;
    if (entry.avg !== null) {
      // Only successful checks carry a value.
      const weight = Math.max(entry.checksOk, 1);
      bucket.sum += entry.avg * weight;
      bucket.weight += weight;
    }
    if (entry.avg2 !== null && entry.avg2 !== undefined) {
      const weight = Math.max(entry.checksOk, 1);
      bucket.sum2 += entry.avg2 * weight;
      bucket.weight2 += weight;
      const top = entry.max2 ?? entry.avg2;
      bucket.max2 = bucket.max2 === null ? top : Math.max(bucket.max2, top);
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
    ...(bucket.weight2 ? { avg2: round(bucket.sum2 / bucket.weight2), max2: round(bucket.max2) } : {}),
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

export type InterfaceRow = { index: number; name: string; alias: string | null; up: boolean; speedMbps: number | null };

/** Interfaces from the result of a «snmp_interfaces» job (untrusted input from the probe). */
export function parseInterfaces(result: unknown): InterfaceRow[] {
  const output = isObject(result) && isObject(result.output) ? result.output : result;
  const list = isObject(output) && Array.isArray(output.interfaces) ? output.interfaces : [];
  const clean = (text: unknown) =>
    typeof text === "string" ? text.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 80) : "";
  return list.flatMap((entry) => {
    if (!isObject(entry) || typeof entry.index !== "number" || !Number.isInteger(entry.index) || entry.index < 1) {
      return [];
    }
    return [{
      index: entry.index,
      name: clean(entry.name) || `Port ${entry.index}`,
      alias: clean(entry.alias) || null,
      up: entry.up === true,
      speedMbps: typeof entry.speedMbps === "number" && entry.speedMbps > 0 ? entry.speedMbps : null,
    }];
  }).slice(0, 600);
}
