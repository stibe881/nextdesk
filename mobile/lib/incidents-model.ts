// «Störungen» (incidents from PRTG): parsing of the incidents edge function
// responses and small formatting helpers; pure.

export type IncidentFilter =
  | "active"
  | "unacknowledged"
  | "services"
  | "recent"
  | "resolved"
  | "closed"
  | "all";

export type IncidentCause =
  | "power"
  | "network"
  | "hardware"
  | "software"
  | "maintenance"
  | "external"
  | "unknown";

export const CAUSE_LABELS: Record<IncidentCause, string> = {
  power: "Strom",
  network: "Netzwerk",
  hardware: "Hardware",
  software: "Software",
  maintenance: "Wartung",
  external: "Extern (Provider, Lieferant)",
  unknown: "Unbekannt",
};
export const CAUSES = Object.keys(CAUSE_LABELS) as IncidentCause[];

export const STATE_LABELS: Record<string, string> = {
  active: "Aktiv",
  resolved: "Behoben",
  closed: "Abgeschlossen",
};

export type IncidentService = { id: string; name: string; status: string };

export type IncidentSummary = {
  id: string;
  number: string;
  title: string;
  deviceName: string | null;
  assetId: string | null;
  severity: "down" | "warning";
  state: "active" | "resolved" | "closed";
  parentId: string | null;
  maintenance: boolean;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  assignedAgentId: string | null;
  assignedAgentName: string | null;
  openedAt: string;
  resolvedAt: string | null;
  closedAt: string | null;
  cause: IncidentCause | null;
  durationMinutes: number;
  services: IncidentService[];
  location: string | null;
  realertCount: number;
  children: IncidentSummary[];
};

export type IncidentStats = {
  active: number;
  activeDown: number;
  activeWarning: number;
  unacknowledged: number;
  oldestUnacknowledgedAt: string | null;
  affectedServices: string[];
  medianResolveMinutes: number | null;
  availability: number | null;
  monitoredDevices: number;
};

export type IncidentEvent = {
  id: string;
  kind: string;
  status: string | null;
  sensor: string | null;
  message: string | null;
  actor: string | null;
  at: string;
};

export type IncidentDetail = IncidentSummary & {
  closedBy: string | null;
  closingNote: string | null;
  parent: { id: string; number: string; title: string; state: string } | null;
  sensors: {
    name: string;
    status: string | null;
    state: string;
    lastEventAt: string | null;
    message: string | null;
  }[];
  events: IncidentEvent[];
  device: {
    name: string | null;
    category: string | null;
    manufacturer: string | null;
    model: string | null;
    hostname: string | null;
    ipAddress: string | null;
    prtgObjectId: string | null;
    location: string | null;
  } | null;
  dependencies: {
    upstream: { assetId: string; name: string; failing: boolean }[];
  };
  history: {
    segments: { start: string; end: string; severity: string }[];
    weekCount: number;
  };
  agents: { id: string; name: string }[];
};

export type IncidentReport = {
  days: number;
  total: number;
  medianResolveMinutes: number | null;
  availability: number | null;
  causes: { cause: string; label: string; count: number }[];
  devices: { name: string; count: number; minutes: number }[];
};

type Row = Record<string, unknown>;
const isRecord = (value: unknown): value is Row =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value : null;
const num = (value: unknown, fallback = 0): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;
const nullableNum = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
const list = (value: unknown): Row[] =>
  Array.isArray(value) ? value.filter(isRecord) : [];
const data = (value: unknown): Row | null =>
  isRecord(value) && isRecord(value.data) ? value.data : null;

function summaryOf(row: Row): IncidentSummary | null {
  const id = str(row.id);
  const number = str(row.number);
  if (!id || !number) return null;
  const cause = str(row.cause);
  return {
    id,
    number,
    title: str(row.title) ?? number,
    deviceName: str(row.deviceName),
    assetId: str(row.assetId),
    severity: row.severity === "warning" ? "warning" : "down",
    state:
      row.state === "resolved" || row.state === "closed" ? row.state : "active",
    parentId: str(row.parentId),
    maintenance: row.maintenance === true,
    acknowledgedAt: str(row.acknowledgedAt),
    acknowledgedBy: str(row.acknowledgedBy),
    assignedAgentId: str(row.assignedAgentId),
    assignedAgentName: str(row.assignedAgentName),
    openedAt: str(row.openedAt) ?? new Date(0).toISOString(),
    resolvedAt: str(row.resolvedAt),
    closedAt: str(row.closedAt),
    cause: cause && cause in CAUSE_LABELS ? (cause as IncidentCause) : null,
    durationMinutes: num(row.durationMinutes),
    services: list(row.services).flatMap((service) => {
      const serviceId = str(service.id);
      const name = str(service.name);
      return serviceId && name
        ? [{ id: serviceId, name, status: str(service.status) ?? "" }]
        : [];
    }),
    location: str(row.location),
    realertCount: num(row.realertCount),
    children: list(row.children).flatMap((child) => {
      const parsed = summaryOf(child);
      return parsed ? [parsed] : [];
    }),
  };
}

export function parseIncidentList(
  value: unknown,
): { incidents: IncidentSummary[]; stats: IncidentStats } | null {
  const body = data(value);
  if (!body) return null;
  const stats = isRecord(body.stats) ? body.stats : {};
  return {
    incidents: list(body.incidents).flatMap((row) => {
      const parsed = summaryOf(row);
      return parsed ? [parsed] : [];
    }),
    stats: {
      active: num(stats.active),
      activeDown: num(stats.activeDown),
      activeWarning: num(stats.activeWarning),
      unacknowledged: num(stats.unacknowledged),
      oldestUnacknowledgedAt: str(stats.oldestUnacknowledgedAt),
      affectedServices: Array.isArray(stats.affectedServices)
        ? stats.affectedServices.filter(
            (entry): entry is string => typeof entry === "string",
          )
        : [],
      medianResolveMinutes: nullableNum(stats.medianResolveMinutes),
      availability: nullableNum(stats.availability),
      monitoredDevices: num(stats.monitoredDevices),
    },
  };
}

export function parseIncidentDetail(value: unknown): IncidentDetail | null {
  const body = data(value);
  const base = body ? summaryOf(body) : null;
  if (!body || !base) return null;
  const device = isRecord(body.device) ? body.device : null;
  const parent = isRecord(body.parent) ? body.parent : null;
  const dependencies = isRecord(body.dependencies) ? body.dependencies : {};
  const history = isRecord(body.history) ? body.history : {};
  return {
    ...base,
    closedBy: str(body.closedBy),
    closingNote: str(body.closingNote),
    parent:
      parent && str(parent.id)
        ? {
            id: String(parent.id),
            number: str(parent.number) ?? "",
            title: str(parent.title) ?? "",
            state: str(parent.state) ?? "",
          }
        : null,
    sensors: list(body.sensors).map((row) => ({
      name: str(row.name) ?? "Sensor",
      status: str(row.status),
      state: str(row.state) ?? "open",
      lastEventAt: str(row.lastEventAt),
      message: str(row.message),
    })),
    events: list(body.events).flatMap((row) => {
      const id = str(row.id);
      const at = str(row.at);
      return id && at
        ? [
            {
              id,
              kind: str(row.kind) ?? "prtg",
              status: str(row.status),
              sensor: str(row.sensor),
              message: str(row.message),
              actor: str(row.actor),
              at,
            },
          ]
        : [];
    }),
    device: device
      ? {
          name: str(device.name),
          category: str(device.category),
          manufacturer: str(device.manufacturer),
          model: str(device.model),
          hostname: str(device.hostname),
          ipAddress: str(device.ipAddress),
          prtgObjectId: str(device.prtgObjectId),
          location: str(device.location),
        }
      : null,
    dependencies: {
      upstream: list(dependencies.upstream).flatMap((row) => {
        const assetId = str(row.assetId);
        return assetId
          ? [
              {
                assetId,
                name: str(row.name) ?? "Gerät",
                failing: row.failing === true,
              },
            ]
          : [];
      }),
    },
    history: {
      segments: list(history.segments).flatMap((row) => {
        const start = str(row.start);
        const end = str(row.end);
        return start && end
          ? [{ start, end, severity: str(row.severity) ?? "down" }]
          : [];
      }),
      weekCount: num(history.weekCount),
    },
    agents: list(body.agents).flatMap((row) => {
      const agentId = str(row.id);
      return agentId ? [{ id: agentId, name: str(row.name) ?? "Agent" }] : [];
    }),
  };
}

export function parseIncidentReport(value: unknown): IncidentReport | null {
  const body = data(value);
  if (!body) return null;
  return {
    days: num(body.days, 30),
    total: num(body.total),
    medianResolveMinutes: nullableNum(body.medianResolveMinutes),
    availability: nullableNum(body.availability),
    causes: list(body.causes).map((row) => ({
      cause: str(row.cause) ?? "",
      label: str(row.label) ?? "",
      count: num(row.count),
    })),
    devices: list(body.devices).map((row) => ({
      name: str(row.name) ?? "Gerät",
      count: num(row.count),
      minutes: num(row.minutes),
    })),
  };
}

/** «12 min», «3 h 20 min», «2 T 4 h». */
export function formatDuration(minutes: number | null): string {
  if (minutes === null || !Number.isFinite(minutes)) return "–";
  const total = Math.max(0, Math.round(minutes));
  if (total < 60) return `${total} min`;
  if (total < 24 * 60) {
    const hours = Math.floor(total / 60);
    const rest = total % 60;
    return rest ? `${hours} h ${rest} min` : `${hours} h`;
  }
  const days = Math.floor(total / (24 * 60));
  const hours = Math.floor((total % (24 * 60)) / 60);
  return hours ? `${days} T ${hours} h` : `${days} T`;
}

/** Minutes from a start until now (or the end). */
export function liveMinutes(
  start: string,
  end: string | null,
  now = Date.now(),
): number {
  const from = Date.parse(start);
  const to = end ? Date.parse(end) : now;
  return Number.isFinite(from) && Number.isFinite(to)
    ? Math.max(0, (to - from) / 60_000)
    : 0;
}

export function formatAvailability(value: number | null): string {
  if (value === null) return "–";
  return `${(Math.floor(value * 10000) / 100).toLocaleString("de-CH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} %`;
}

export const EVENT_LABELS: Record<string, string> = {
  prtg: "PRTG",
  opened: "Störung geöffnet",
  reopened: "Erneut gestört",
  resolved: "Behoben",
  closed: "Abgeschlossen",
  acknowledged: "Bestätigt",
  assigned: "Zuweisung",
  note: "Notiz",
  realert: "Erneut alarmiert",
  child: "Folgestörung",
  maintenance: "Wartung",
};
