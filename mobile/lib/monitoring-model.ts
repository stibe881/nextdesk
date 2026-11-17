// Überwachung: Typen und reine Hilfsfunktionen (Beschriftungen, Formatierung,
// Grafikpfade). Gleicher Inhalt wie apps/web/src/lib/monitoring.ts ohne den
// Aufruf der Edge Function; Änderungen an beiden Orten nachführen.


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
  /** Own name of the kind (category «other»). */
  categoryLabel?: string | null;
  hostname: string | null;
  ipAddress: string | null;
  state: MonitoringState;
  counts: Record<MonitoringState, number>;
  sensorCount: number;
  responseMs: number | null;
  lastCheckAt: string | null;
  /** Newest pause of the device's sensors (who, when, why). */
  pause?: {
    reason: string | null;
    by: string | null;
    at: string | null;
  } | null;
  problem: {
    sensorId: string;
    sensorName: string;
    state: MonitoringState;
    since: string | null;
    message: string | null;
    /** Names of the services affected (of the sensor, else of the device). */
    services?: string[];
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
  /** A simulated outage runs until then (test of the alerting chain). */
  simulateUntil?: string | null;
  /** Services this sensor affects instead of all services of its device. */
  serviceIds?: string[];
  paused: boolean;
  /** Why, when and by whom the sensor was paused (only while paused). */
  pausedReason?: string | null;
  pausedAt?: string | null;
  pausedByName?: string | null;
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
    categoryLabel?: string | null;
    hostname: string | null;
    ipAddress: string | null;
    state: MonitoringState;
    services: { id: string; name: string }[];
    uplink: { assetId: string; name: string } | null;
    incident: MonitoringIncident | null;
  };
  /** Services of the status page a sensor can be linked to. */
  serviceOptions?: { id: string; name: string }[];
  /** Own device kinds of the tenant (for editing). */
  kinds?: string[];
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

export type EventRange = "24h" | "7d";

export const EVENT_RANGE_LABELS: Record<EventRange, string> = {
  "24h": "24 Stunden",
  "7d": "7 Tage",
};

export type MonitoringEvent = {
  id: string;
  at: string;
  kind: "down" | "warning" | "up" | "paused" | "resumed";
  assetId: string | null;
  deviceName: string;
  /** Paused / resumed: who did it and why (pausing only). */
  actor?: string | null;
  reason?: string | null;
  sensorName: string | null;
  message: string | null;
  /** Up: how long the outage lasted. */
  durationSeconds: number | null;
  /** Down or warning that has not ended yet. */
  ongoing: boolean;
  services: string[];
  incident: { id: string; number: string } | null;
  /** From a simulated outage. */
  test: boolean;
};

/** Latest events of the sensors for the overview. */
export type MonitoringEvents = {
  range: EventRange;
  counts: { down: number; warning: number; up: number };
  /** A bar per hour (24 h) or day (7 d), oldest first: the worst event in it. */
  buckets: { from: string; level: "none" | "up" | "warning" | "down" }[];
  events: MonitoringEvent[];
};

/** «Ausfall dauerte 4 Min.» / «Keine Antwort auf Ping · dauert an» / «Ausfall». */
export function eventText(event: MonitoringEvent): string {
  if (event.kind === "paused") {
    const who = event.actor ? `Pausiert von ${event.actor}` : "Pausiert";
    return event.reason ? `${who}: ${event.reason}` : who;
  }
  if (event.kind === "resumed") {
    return event.actor ? `Fortgesetzt von ${event.actor}` : "Fortgesetzt";
  }
  if (event.kind === "up") {
    const lasted =
      event.durationSeconds === null
        ? null
        : `dauerte ${formatDowntime(event.durationSeconds)}`;
    return [event.message ?? "Wieder in Ordnung", lasted]
      .filter(Boolean)
      .join(" · ");
  }
  const fallback = event.kind === "down" ? "Ausfall" : "Warnung";
  return [event.message ?? fallback, event.ongoing ? "dauert an" : null]
    .filter(Boolean)
    .join(" · ");
}

/** «2 Ausfälle · 1 Warnung · 2 behoben», or «keine Ereignisse». */
export function eventCountsText(counts: MonitoringEvents["counts"]): string {
  const parts = [
    counts.down
      ? `${counts.down} ${counts.down === 1 ? "Ausfall" : "Ausfälle"}`
      : null,
    counts.warning
      ? `${counts.warning} ${counts.warning === 1 ? "Warnung" : "Warnungen"}`
      : null,
    counts.up ? `${counts.up} behoben` : null,
  ].filter(Boolean);
  return parts.join(" · ") || "keine Ereignisse";
}

/** Time of an event: «09:42» today, else «16.11. 17:20». */
export function eventTime(iso: string, now: number): string {
  const at = new Date(iso);
  const time = at.toLocaleTimeString("de-CH", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const sameDay = at.toDateString() === new Date(now).toDateString();
  return sameDay
    ? time
    : `${at.toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit" })} ${time}`;
}

export type AvailabilityRange = "7d" | "30d" | "1y";

export const AVAILABILITY_RANGE_LABELS: Record<AvailabilityRange, string> = {
  "7d": "7 Tage",
  "30d": "30 Tage",
  "1y": "1 Jahr",
};

/** Availability of the monitored devices for the overview. */
export type MonitoringAvailability = {
  range: AvailabilityRange;
  /** Percent over all devices; null when nothing was monitored. */
  overall: number | null;
  devices: number;
  /** A bar per day (per week for a year), oldest first. */
  buckets: {
    from: string;
    level: "none" | "ok" | "warning" | "down";
    availability: number | null;
  }[];
  /** Devices that were down most, with the services affected. */
  worst: {
    assetId: string;
    name: string;
    availability: number;
    outages: number;
    downSeconds: number;
    services: string[];
  }[];
};

/** «99.62 %» with two decimals, Swiss style. */
export function formatPercent(value: number): string {
  return `${value.toFixed(2)} %`;
}

/** Duration of outages: «4 Min.», «10 Std.», «2 Tg. 14 Std.». */
export function formatDowntime(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} Min.`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} Std.`;
  const days = Math.floor(hours / 24);
  const rest = hours - days * 24;
  return rest ? `${days} Tg. ${rest} Std.` : `${days} Tg.`;
}

export type PortState = "linked" | "trunk" | "up" | "down" | "unknown";

/** State of a port for the matrix: what its colour says. */
export function portState(port: MonitoringPort): PortState {
  if (port.up === false) return "down";
  if (port.link) return "linked";
  if (port.deviceCount > 8) return "trunk";
  if (port.up === null) return "unknown";
  return "up";
}

export const PORT_STATE_LABELS: Record<PortState, string> = {
  linked: "Gegenstelle bekannt",
  trunk: "Uplink oder Trunk",
  up: "aktiv",
  down: "kein Link",
  unknown: "unbekannt",
};

export type PortGroup = {
  key: string;
  label: string;
  /** Physical ports of a unit, drawn as a front panel. */
  panel: boolean;
  ports: MonitoringPort[];
};

/** Last number of a port name: «1/1/24» → 24, «Trk1» → 1. */
export function portNumber(name: string): number | null {
  const match = /(\d+)\D*$/.exec(name);
  return match ? Number(match[1]) : null;
}

/**
 * Ports grouped like the device is built: per unit of a stack and module
 * («1/1/24» = unit 1, module 1, port 24; «2/12» = unit 2; «17» = port 17).
 * Everything else (VLANs, LAGs, management) is one group that is only worth
 * showing where something is connected.
 */
export function portGroups(ports: readonly MonitoringPort[]): PortGroup[] {
  const groups = new Map<string, PortGroup>();
  const add = (
    key: string,
    label: string,
    panel: boolean,
    port: MonitoringPort,
  ) => {
    const group = groups.get(key) ?? { key, label, panel, ports: [] };
    group.ports.push(port);
    groups.set(key, group);
  };
  for (const port of ports) {
    const name = port.port.trim();
    const three = /^(\d+)\/(\d+)\/(\d+)$/.exec(name);
    const two = /^(\d+)\/(\d+)$/.exec(name);
    if (three) {
      add(
        `${three[1]}/${three[2]}`,
        three[2] === "1"
          ? `Einheit ${three[1]}`
          : `Einheit ${three[1]} · Modul ${three[2]}`,
        true,
        port,
      );
    } else if (two) {
      add(`${two[1]}`, `Einheit ${two[1]}`, true, port);
    } else if (/^\d+$/.test(name)) {
      add("", "Ports", true, port);
    } else {
      add("~", "Weitere Schnittstellen", false, port);
    }
  }
  const order = (a: string, b: string) =>
    a.localeCompare(b, "de", { numeric: true });
  return [...groups.values()]
    .map((group) => ({
      ...group,
      ports: [...group.ports].sort(
        (a, b) =>
          (portNumber(a.port) ?? 0) - (portNumber(b.port) ?? 0) ||
          order(a.port, b.port),
      ),
    }))
    .sort((a, b) => Number(!a.panel) - Number(!b.panel) || order(a.key, b.key));
}

export type LinkDiagram = {
  width: number;
  height: number;
  ports: { port: string; alias: string | null; y: number }[];
  neighbours: {
    key: string;
    name: string;
    detail: string | null;
    assetId: string | null;
    monitored: boolean;
    y: number;
  }[];
  links: { key: string; path: string; source: MonitoringLink["source"] }[];
  /** Connections left out because the diagram is full. */
  hidden: number;
};

const DIAGRAM = { width: 720, row: 30, left: 170, right: 500 };

/**
 * Diagram of the connections: the ports of the device on the left, the
 * devices they lead to on the right, a line for every connection. Only
 * neighbours with a name count (LLDP, known device or address); bare MAC
 * addresses stay in the list.
 */
export function linkDiagram(
  ports: readonly MonitoringPort[],
  max = 36,
): LinkDiagram {
  const named = ports.filter(
    (port) =>
      port.link !== null &&
      (port.link.source === "lldp" ||
        port.link.assetId !== null ||
        port.link.address !== null),
  );
  const shown = named.slice(0, max);
  const keyOf = (link: MonitoringLink) =>
    link.assetId ?? link.name.trim().toLowerCase();
  const neighbours = new Map<
    string,
    Omit<LinkDiagram["neighbours"][number], "y">
  >();
  for (const port of shown) {
    const link = port.link!;
    if (!neighbours.has(keyOf(link))) {
      neighbours.set(keyOf(link), {
        key: keyOf(link),
        name: link.name,
        detail: link.address,
        assetId: link.assetId,
        monitored: link.monitored,
      });
    }
  }
  const rows = Math.max(shown.length, neighbours.size, 1);
  const height = rows * DIAGRAM.row;
  const spread = (count: number, index: number) =>
    ((index + 0.5) * height) / Math.max(count, 1);
  const left = shown.map((port, index) => ({
    port: port.port,
    alias: port.alias,
    y: spread(shown.length, index),
  }));
  const right = [...neighbours.values()].map((entry, index) => ({
    ...entry,
    y: spread(neighbours.size, index),
  }));
  const rightY = new Map(right.map((entry) => [entry.key, entry.y]));
  const middle = (DIAGRAM.left + DIAGRAM.right) / 2;
  return {
    width: DIAGRAM.width,
    height,
    ports: left,
    neighbours: right,
    links: shown.map((port, index) => {
      const y1 = left[index]!.y;
      const y2 = rightY.get(keyOf(port.link!)) ?? y1;
      return {
        key: port.port,
        path: `M${DIAGRAM.left},${y1} C${middle},${y1} ${middle},${y2} ${DIAGRAM.right},${y2}`,
        source: port.link!.source,
      };
    }),
    hidden: named.length - shown.length,
  };
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
  /** Own name of the kind (category «other»). */
  categoryLabel?: string | null;
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
  serviceIds?: string[];
  paused: boolean;
} & SensorExtras;

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

/** Kind of a device as shown: the own name for «other», else the fixed label. */
export function categoryText(
  category: string | null | undefined,
  label?: string | null,
): string {
  if (category === "other" && label) return label;
  return CATEGORY_LABELS[category ?? ""] ?? "Gerät";
}

const CUSTOM_KIND = "custom:";

/** One value for a select: a fixed kind, or an own kind as «custom:<name>». */
export function kindValue(
  category: string | null | undefined,
  label?: string | null,
): string {
  return category === "other" && label
    ? `${CUSTOM_KIND}${label}`
    : (category ?? "other");
}

/** Fields of a device for a value of `kindValue`. */
export function kindFields(value: string): {
  category: string;
  categoryLabel: string | null;
} {
  if (!value.startsWith(CUSTOM_KIND)) {
    return { category: value, categoryLabel: null };
  }
  const label = value.slice(CUSTOM_KIND.length).replace(/\s+/g, " ").trim();
  return { category: "other", categoryLabel: label || null };
}

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
    serviceIds: [],
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
    serviceIds: sensor.serviceIds ?? [],
  };
}
