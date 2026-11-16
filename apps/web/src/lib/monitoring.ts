// Überwachung: Typen, Aufrufe der Edge Function `monitoring-sensors` und
// reine Hilfsfunktionen (Beschriftungen, Formatierung, Grafikpfade).

import { supabase } from "./supabase";

export type MonitoringState = "down" | "warning" | "up" | "unknown" | "paused";
export type SensorKind = "ping" | "tcp" | "http" | "snmp" | "cert" | "dns";
export type SnmpMetric = "uptime" | "traffic" | "value";

/** Further settings of a sensor (same fields in the draft). */
export type SensorExtras = {
  warningBelow: number | null;
  downAbove: number | null;
  downBelow: number | null;
  snmpMetric: SnmpMetric | null;
  snmpOid: string | null;
  snmpIndex: number | null;
  scale: number;
  /** Unit of the value; null means response time in ms. */
  unit: string | null;
  /** DNS: address the name must resolve to. */
  expect: string | null;
  /** Measured by nextDesk itself instead of a probe. */
  cloud: boolean;
};

/** Kinds nextDesk can measure without a probe. */
export const CLOUD_KINDS: readonly SensorKind[] = ["http", "cert", "dns"];

export type InterfaceRow = {
  index: number;
  name: string;
  alias: string | null;
  up: boolean;
  speedMbps: number | null;
};
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
  /** An installed version older than the published package. */
  updateAvailable?: boolean;
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
  /** Newest published installation package of the probe. */
  probePackage?: { version: string; builtAt: string; size: number } | null;
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
  lastValue2?: number | null;
  lastMessage: string | null;
} & SensorExtras;

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
  avg2?: number | null;
  max2?: number | null;
};

/** What hangs on a port: named by the device itself (LLDP) or seen in the MAC table. */
export type MonitoringLink = {
  source: "lldp" | "mac";
  name: string;
  port: string | null;
  address: string | null;
  mac: string | null;
  /** Device of the infrastructure, if the neighbour is one. */
  assetId: string | null;
  monitored: boolean;
};

export type MonitoringPort = {
  port: string;
  alias: string | null;
  up: boolean | null;
  speedMbps: number | null;
  link: MonitoringLink | null;
  /** MAC addresses seen behind the port; many mean an uplink or trunk. */
  deviceCount: number;
};

export type MonitoringConnections = {
  canManage: boolean;
  /** Last attempt of the probe to read the connections. */
  scannedAt: string | null;
  pending: boolean;
  error: string | null;
  ports: MonitoringPort[];
  /** Ports of other devices this device hangs on. */
  attachedTo: {
    assetId: string;
    name: string;
    port: string;
    source: "lldp" | "mac";
    monitored: boolean;
  }[];
};

/** Ports worth showing by default: something is connected or the link is up. */
export function connectedPorts(
  ports: readonly MonitoringPort[],
): MonitoringPort[] {
  return ports.filter(
    (port) => port.link !== null || (port.up === true && port.deviceCount > 0),
  );
}

/** «SOBE-DSW01 · Port 1/1/24» / «3 Geräte» / «42 Geräte (Uplink oder Trunk)» / «–». */
export function portLinkText(port: MonitoringPort): string {
  if (port.link) {
    const others =
      port.link.source === "mac" && port.deviceCount > 1
        ? `+${port.deviceCount - 1} weitere`
        : null;
    return [
      port.link.name,
      port.link.port ? `Port ${port.link.port}` : null,
      others,
    ]
      .filter(Boolean)
      .join(" · ");
  }
  if (port.deviceCount > 8)
    return `${port.deviceCount} Geräte (Uplink oder Trunk)`;
  return port.deviceCount > 0 ? `${port.deviceCount} unbekannte Geräte` : "–";
}

export const LINK_SOURCE_LABELS: Record<MonitoringLink["source"], string> = {
  lldp: "LLDP",
  mac: "MAC-Tabelle",
};

export type MonitoringSeries = {
  sensorId: string;
  range: MonitoringRange;
  unit?: string | null;
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

/** An address of the IP address management that is no device yet. */
export type MonitoringAddressChoice = {
  addressId: string;
  address: string;
  hostname: string | null;
  description: string | null;
  deviceType: string | null;
};

/**
 * Kind of a device guessed from its name and description (entries of the IP
 * address management carry no kind). Falls back to «other».
 */
export function guessCategory(...texts: (string | null | undefined)[]): string {
  const text = texts.filter(Boolean).join(" ").toLowerCase();
  const rules: [RegExp, string][] = [
    [/access.?point|\bap[-_ ]?\d|\bwlan|wifi/, "access_point"],
    [/firewall|\bfw[-_ ]?\d|\bfir\d|sophos|fortigate/, "firewall"],
    [/\busv\b|\bups\b|\bats\d|apc smart/, "ups"],
    [/switch|[acd]sw\d|\bsw[-_ ]?\d|aruba cx|procurve|catalyst/, "switch"],
    [/\bnas\b|storage|\bmsa\b|qnap|synology/, "storage"],
    [/\besx|vcenter|hyper-?v host|virtualisierungs/, "virtual_host"],
    [/router|gateway/, "router"],
    [/server|\bsrv|\bdc\d|\bs\d{2,4}\b|\bilo/, "server"],
  ];
  for (const [pattern, category] of rules) {
    if (pattern.test(text)) return category;
  }
  return "other";
}

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
} & SensorExtras;

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
  snmp: "SNMP",
  cert: "Zertifikat",
  dns: "DNS",
};

export const SNMP_LABELS: Record<SnmpMetric, string> = {
  traffic: "SNMP Port-Traffic",
  uptime: "SNMP Laufzeit",
  value: "SNMP Wert",
};

export function kindLabel(sensor: {
  kind: SensorKind;
  snmpMetric: SnmpMetric | null;
}): string {
  return sensor.kind === "snmp" && sensor.snmpMetric
    ? SNMP_LABELS[sensor.snmpMetric]
    : KIND_LABELS[sensor.kind];
}

/** Heading of the history chart by unit. */
export function valueLabel(unit: string | null | undefined): string {
  if (!unit) return "Antwortzeit";
  if (unit === "bit/s") return "Datenverkehr";
  if (unit === "s") return "Laufzeit";
  if (unit === "Tg.") return "Restlaufzeit";
  return "Messwert";
}

/** «412 ms», «91 %», «1.2 Gbit/s», «12 Tg. 3 Std.» (unit null = ms). */
export function formatValue(
  value: number | null | undefined,
  unit: string | null | undefined,
): string {
  if (value === null || value === undefined) return "–";
  if (!unit) return formatMs(value);
  const short = (number: number) =>
    (Math.abs(number) < 10
      ? Math.round(number * 10) / 10
      : Math.round(number)
    ).toLocaleString("de-CH");
  if (unit === "bit/s") {
    const steps: [number, string][] = [
      [1e9, "Gbit/s"],
      [1e6, "Mbit/s"],
      [1e3, "kbit/s"],
    ];
    for (const [size, label] of steps) {
      if (Math.abs(value) >= size) return `${short(value / size)} ${label}`;
    }
    return `${short(value)} bit/s`;
  }
  if (unit === "s") {
    const days = Math.floor(value / 86400);
    const hours = Math.floor((value % 86400) / 3600);
    return days > 0
      ? `${days} Tg. ${hours} Std.`
      : `${hours} Std. ${Math.floor((value % 3600) / 60)} Min.`;
  }
  return `${short(value)} ${unit}`;
}

/** Current value of a sensor; traffic shows both directions. */
export function sensorValueText(
  sensor: Pick<
    MonitoringSensor,
    "lastValue" | "lastValue2" | "unit" | "snmpMetric"
  >,
): string {
  if (sensor.snmpMetric === "traffic") {
    if (sensor.lastValue === null) return "wird ermittelt";
    return `ein ${formatValue(sensor.lastValue, sensor.unit)} · aus ${formatValue(sensor.lastValue2, sensor.unit)}`;
  }
  return formatValue(sensor.lastValue, sensor.unit);
}

/** Thresholds of a sensor as text, e.g. «Warnung über 250 ms». */
export function thresholdText(
  sensor: Pick<
    MonitoringSensor,
    "warningAbove" | "warningBelow" | "downAbove" | "downBelow" | "unit"
  >,
): string {
  const parts: string[] = [];
  const value = (number: number) => formatValue(number, sensor.unit);
  if (sensor.warningAbove !== null)
    parts.push(`Warnung über ${value(sensor.warningAbove)}`);
  if (sensor.warningBelow !== null)
    parts.push(`Warnung unter ${value(sensor.warningBelow)}`);
  if (sensor.downAbove !== null)
    parts.push(`Ausfall über ${value(sensor.downAbove)}`);
  if (sensor.downBelow !== null)
    parts.push(`Ausfall unter ${value(sensor.downBelow)}`);
  return parts.join(" · ");
}

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
  sensor: Pick<MonitoringSensor, "kind" | "target" | "port" | "url"> &
    Partial<Pick<MonitoringSensor, "snmpMetric" | "snmpIndex" | "snmpOid">>,
  device: { ipAddress: string | null; hostname: string | null },
): string {
  if (sensor.kind === "http") return sensor.url ?? "";
  const host = sensor.target ?? device.ipAddress ?? device.hostname ?? "";
  if (sensor.kind === "cert") return `${host}:${sensor.port ?? 443}`;
  if (sensor.kind === "dns") return host;
  if (sensor.kind === "snmp") {
    if (sensor.snmpMetric === "traffic")
      return `${host} · Port ${sensor.snmpIndex}`;
    if (sensor.snmpMetric === "value") return `${host} · ${sensor.snmpOid}`;
    return host;
  }
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

export type DeviceSortKey =
  "state" | "name" | "sensors" | "response" | "lastCheck";
export type DeviceSort = { key: DeviceSortKey; descending: boolean };

/** Worst first: what needs attention is at the top. */
const STATE_RANK: Record<MonitoringState, number> = {
  down: 0,
  warning: 1,
  unknown: 2,
  paused: 3,
  up: 4,
};

/**
 * Devices sorted by a column. Devices without a value (no response time,
 * never checked) stay at the end in both directions; ties go by name.
 */
export function sortDevices(
  devices: readonly MonitoringDeviceRow[],
  sort: DeviceSort,
): MonitoringDeviceRow[] {
  const byName = (a: MonitoringDeviceRow, b: MonitoringDeviceRow) =>
    a.name.localeCompare(b.name, "de", { numeric: true, sensitivity: "base" });
  const value = (device: MonitoringDeviceRow): number | null => {
    switch (sort.key) {
      case "state":
        return STATE_RANK[device.state];
      case "sensors":
        return device.sensorCount;
      case "response":
        return device.responseMs;
      case "lastCheck":
        return device.lastCheckAt ? Date.parse(device.lastCheckAt) : null;
      case "name":
        return 0;
    }
  };
  const direction = sort.descending ? -1 : 1;
  return [...devices].sort((a, b) => {
    if (sort.key === "name") return direction * byName(a, b);
    const left = value(a);
    const right = value(b);
    if (left === null || right === null) {
      if (left === right) return byName(a, b);
      return left === null ? 1 : -1;
    }
    return direction * (left - right) || byName(a, b);
  });
}

export type ChartGeometry = {
  width: number;
  height: number;
  /** Line segments (a gap where no value was measured). */
  lines: string[];
  /** Second value (outgoing traffic), when present. */
  lines2: string[];
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
  series: Pick<
    MonitoringSeries,
    "points" | "from" | "range" | "bucketSeconds"
  > & {
    unit?: string | null;
  },
  now: number,
  warningAbove: number | null,
  width = 640,
  height = 220,
): ChartGeometry {
  const start = Date.parse(series.from);
  const span = Math.max(now - start, 1);
  const innerWidth = width - PAD.left - PAD.right;
  const innerHeight = height - PAD.top - PAD.bottom;
  const values = series.points.flatMap((point) => [
    ...(point.max !== null
      ? [point.max]
      : point.avg !== null
        ? [point.avg]
        : []),
    ...(point.max2 !== null && point.max2 !== undefined
      ? [point.max2]
      : point.avg2 !== null && point.avg2 !== undefined
        ? [point.avg2]
        : []),
  ]);
  const top = niceMax(Math.max(...values, warningAbove ?? 0, 1));
  const x = (time: number) =>
    PAD.left + Math.min(Math.max((time - start) / span, 0), 1) * innerWidth;
  const y = (value: number) =>
    PAD.top + (1 - Math.min(value / top, 1)) * innerHeight;
  const round = (value: number) => Math.round(value * 10) / 10;
  const bucketMs = series.bucketSeconds * 1000;

  const lines: string[] = [];
  const lines2: string[] = [];
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
    const second = segment.filter(
      (point) => point.avg2 !== null && point.avg2 !== undefined,
    );
    if (second.length) {
      lines2.push(
        second
          .map(
            (point, index) =>
              `${index ? "L" : "M"}${at(point)},${round(y(point.avg2 ?? 0))}`,
          )
          .join(" "),
      );
    }
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
    label: series.unit
      ? formatValue(top * share, series.unit)
      : formatMs(top * share).replace(" ms", ""),
  }));
  const xTicks = [0, 0.25, 0.5, 0.75, 1].map((share) => ({
    x: round(PAD.left + share * innerWidth),
    label: tickLabel(start + share * span, series.range),
  }));
  return {
    width,
    height,
    lines,
    lines2,
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
    warningBelow: null,
    downAbove: null,
    downBelow: null,
    snmpMetric: null,
    snmpOid: null,
    snmpIndex: null,
    scale: 1,
    unit: null,
    expect: null,
    cloud: false,
    failuresToDown: 2,
    paused: false,
  };
}

/** Draft of a traffic sensor for a port read from the device. */
export function trafficDraft(
  assetId: string,
  agentId: string,
  port: InterfaceRow,
  intervalSeconds: number,
): SensorDraft {
  const name = [port.name, port.alias].filter(Boolean).join(" ");
  return {
    ...emptyDraft(assetId, agentId),
    kind: "snmp",
    snmpMetric: "traffic",
    snmpIndex: port.index,
    unit: "bit/s",
    name: `${name} Traffic`.slice(0, 120),
    intervalSeconds,
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
    warningBelow: sensor.warningBelow,
    downAbove: sensor.downAbove,
    downBelow: sensor.downBelow,
    snmpMetric: sensor.snmpMetric,
    snmpOid: sensor.snmpOid,
    snmpIndex: sensor.snmpIndex,
    scale: sensor.scale,
    unit: sensor.unit,
    expect: sensor.expect,
    cloud: sensor.cloud,
    failuresToDown: sensor.failuresToDown,
    paused: sensor.paused,
  };
}
