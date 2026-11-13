import { tn } from "./formality";
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

/** Filters on active incidents (one page, sorted by urgency). */
export const ACTIVE_FILTERS: readonly IncidentFilter[] = [
  "active",
  "unacknowledged",
  "services",
];

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
  /** «external»: status feed of a provider (Microsoft 365, GitHub, …). */
  source: "prtg" | "external";
  externalProvider: string | null;
  externalUrl: string | null;
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

export type IncidentTicket = {
  id: string;
  number: string;
  subject: string;
  status: string;
  closed: boolean;
  source: "asset" | "service" | "text" | "manual";
  linkedAt: string;
  notifiedAt: string | null;
};

export type IncidentNeighbour = {
  assetId: string | null;
  name: string;
  address: string | null;
  switchName: string | null;
  port: string | null;
  state: "down" | "warning" | "ok" | "unknown";
  incidentId: string | null;
};

export type IncidentNetworkAddress = {
  address: string | null;
  hostname: string | null;
  prefix: string | null;
  gateway: string | null;
  vlanNumber: number | null;
  vlanName: string | null;
  site: string | null;
  switchName: string | null;
  switchPort: string | null;
  portSource: string | null;
};

export type IncidentNetwork = {
  addresses: IncidentNetworkAddress[];
  subnetNeighbours: IncidentNeighbour[];
  switchNeighbours: IncidentNeighbour[];
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
  network: IncidentNetwork | null;
  tickets: IncidentTicket[];
  hiddenTickets: number;
  problems: { id: string; title: string; status: string }[];
  recurrence: {
    sameDevice30d: number;
    sameCause30d: number;
    suggestCase: boolean;
  };
  permissions: { openCase: boolean; draftArticle: boolean };
  agents: { id: string; name: string }[];
};

export type IncidentCloseResult = {
  tickets: {
    notified: number;
    resolved: number;
    skipped: { ticketNumber: string; reason: string }[];
  } | null;
  problemId: string | null;
};

export const TICKET_SOURCE_LABELS: Record<IncidentTicket["source"], string> = {
  asset: "Gerät verknüpft",
  service: "Dienst verknüpft",
  text: "Gerät im Text",
  manual: "von Hand",
};

export const SKIP_REASON_LABELS: Record<string, string> = {
  already_done: "bereits gelöst",
  no_permission: "keine Berechtigung",
  comment_failed: "Antwort fehlgeschlagen",
  sla_reason_required: "SLA-Ursache fehlt",
  status_failed: "Status nicht geändert",
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
    source: row.source === "external" ? "external" : "prtg",
    externalProvider: str(row.externalProvider),
    externalUrl: str(row.externalUrl),
    children: list(row.children).flatMap((child) => {
      const parsed = summaryOf(child);
      return parsed ? [parsed] : [];
    }),
  };
}

export function parseIncidentList(value: unknown): {
  incidents: IncidentSummary[];
  stats: IncidentStats | null;
  nextCursor: string | null;
} | null {
  const body = data(value);
  if (!body) return null;
  const stats = isRecord(body.stats) ? body.stats : null;
  return {
    incidents: list(body.incidents).flatMap((row) => {
      const parsed = summaryOf(row);
      return parsed ? [parsed] : [];
    }),
    nextCursor: str(body.nextCursor),
    stats: stats
      ? {
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
        }
      : null,
  };
}

const TICKET_SOURCES = ["asset", "service", "text", "manual"] as const;
const NEIGHBOUR_STATES = ["down", "warning", "ok", "unknown"] as const;

function neighbourOf(row: Row): IncidentNeighbour {
  const state = str(row.state);
  return {
    assetId: str(row.assetId),
    name: str(row.name) ?? str(row.address) ?? "Gerät",
    address: str(row.address),
    switchName: str(row.switchName),
    port: str(row.port),
    state: NEIGHBOUR_STATES.find((entry) => entry === state) ?? "unknown",
    incidentId: str(row.incidentId),
  };
}

function networkOf(value: unknown): IncidentNetwork | null {
  if (!isRecord(value)) return null;
  return {
    addresses: list(value.addresses).map((row) => ({
      address: str(row.address),
      hostname: str(row.hostname),
      prefix: str(row.prefix),
      gateway: str(row.gateway),
      vlanNumber: nullableNum(row.vlanNumber),
      vlanName: str(row.vlanName),
      site: str(row.site),
      switchName: str(row.switchName),
      switchPort: str(row.switchPort),
      portSource: str(row.portSource),
    })),
    subnetNeighbours: list(value.subnetNeighbours).map(neighbourOf),
    switchNeighbours: list(value.switchNeighbours).map(neighbourOf),
  };
}

/** Result of closing (tickets informed, case opened), if any. */
export function parseCloseResult(value: unknown): IncidentCloseResult | null {
  const body = data(value);
  const result = body && isRecord(body.closeResult) ? body.closeResult : null;
  if (!result) return null;
  const tickets = isRecord(result.tickets) ? result.tickets : null;
  return {
    tickets: tickets
      ? {
          notified: num(tickets.notified),
          resolved: num(tickets.resolved),
          skipped: list(tickets.skipped).map((row) => ({
            ticketNumber: str(row.ticketNumber) ?? "",
            reason: str(row.reason) ?? "",
          })),
        }
      : null,
    problemId: str(result.problemId),
  };
}

/** Case opened from the incident (openCase action), if any. */
export function parseCaseResult(value: unknown): string | null {
  const body = data(value);
  return body && isRecord(body.caseResult)
    ? str(body.caseResult.problemId)
    : null;
}

/** Article draft created from an incident. */
export function parseArticleDraft(
  value: unknown,
): { articleId: string; title: string; aiUsed: boolean } | null {
  const body = data(value);
  const articleId = body ? str(body.articleId) : null;
  return body && articleId
    ? { articleId, title: str(body.title) ?? "", aiUsed: body.aiUsed === true }
    : null;
}

export type TicketIncidentLink = {
  id: string;
  number: string;
  title: string;
  state: "active" | "resolved" | "closed";
  severity: "down" | "warning";
};

/** Incidents a ticket belongs to (hint in the ticket view). */
export function parseTicketIncidents(value: unknown): {
  incidents: TicketIncidentLink[];
  canOpen: boolean;
} {
  const body = data(value);
  return {
    incidents: list(body?.incidents).flatMap((row) => {
      const id = str(row.id);
      const number = str(row.number);
      return id && number
        ? [
            {
              id,
              number,
              title: str(row.title) ?? number,
              state:
                row.state === "resolved" || row.state === "closed"
                  ? row.state
                  : "active",
              severity: row.severity === "warning" ? "warning" : "down",
            },
          ]
        : [];
    }),
    canOpen: body?.canOpen === true,
  };
}

/**
 * Reply to the linked tickets when the incident is closed (prefilled in the
 * close dialog, the server uses the same text when none is sent).
 */
export function ticketReplyText(
  incident: { number: string; title: string; deviceName: string | null },
  cause: IncidentCause,
  note: string | null,
): string {
  const device = incident.deviceName ?? incident.title;
  return [
    tn("Hallo", "Guten Tag"),
    "",
    tn(
      `Deine Meldung hängt mit einer Störung zusammen (${incident.number}, ${device}). Die Störung ist behoben.`,
      `Ihre Meldung hängt mit einer Störung zusammen (${incident.number}, ${device}). Die Störung ist behoben.`,
    ),
    "",
    `Ursache: ${CAUSE_LABELS[cause]}${note ? `\n${note}` : ""}`,
    "",
    tn(
      "Wir setzen dein Ticket deshalb auf «Gelöst». Besteht das Problem weiterhin, antworte bitte auf diese Nachricht.",
      "Wir setzen Ihr Ticket deshalb auf «Gelöst». Besteht das Problem weiterhin, antworten Sie bitte auf diese Nachricht.",
    ),
    "",
    "Freundliche Grüsse",
  ].join("\n");
}

export function parseIncidentDetail(value: unknown): IncidentDetail | null {
  const body = data(value);
  const base = body ? summaryOf(body) : null;
  if (!body || !base) return null;
  const device = isRecord(body.device) ? body.device : null;
  const parent = isRecord(body.parent) ? body.parent : null;
  const dependencies = isRecord(body.dependencies) ? body.dependencies : {};
  const history = isRecord(body.history) ? body.history : {};
  const recurrence = isRecord(body.recurrence) ? body.recurrence : {};
  const permissions = isRecord(body.permissions) ? body.permissions : {};
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
    network: networkOf(body.network),
    tickets: list(body.tickets).flatMap((row) => {
      const ticketId = str(row.id);
      const number = str(row.number);
      const source = str(row.source);
      return ticketId && number
        ? [
            {
              id: ticketId,
              number,
              subject: str(row.subject) ?? "",
              status: str(row.status) ?? "",
              closed: row.closed === true,
              source:
                TICKET_SOURCES.find((entry) => entry === source) ?? "manual",
              linkedAt: str(row.linkedAt) ?? "",
              notifiedAt: str(row.notifiedAt),
            },
          ]
        : [];
    }),
    hiddenTickets: num(body.hiddenTickets),
    problems: list(body.problems).flatMap((row) => {
      const problemId = str(row.id);
      return problemId
        ? [
            {
              id: problemId,
              title: str(row.title) ?? "",
              status: str(row.status) ?? "",
            },
          ]
        : [];
    }),
    recurrence: {
      sameDevice30d: num(recurrence.sameDevice30d),
      sameCause30d: num(recurrence.sameCause30d),
      suggestCase: recurrence.suggestCase === true,
    },
    permissions: {
      openCase: permissions.openCase === true,
      draftArticle: permissions.draftArticle === true,
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
  external: "Update vom Anbieter",
};

export type SensorTone = "down" | "warning" | "ok";

/**
 * Current state of a sensor for the status badge: «Fehler» (red), «Warnung»
 * (yellow) or «OK» (green). PRTG texts such as «Warnung beendet (jetzt:
 * Fehler)» name the current state in brackets.
 */
export function sensorTone(sensor: {
  state: string;
  status: string | null;
}): SensorTone {
  if (sensor.state !== "open") return "ok";
  const text = (sensor.status ?? "").toLowerCase();
  const current = /\((?:jetzt|now)\s*:\s*([^)]+)\)/.exec(text)?.[1] ?? text;
  if (/^\s*(ok|up)\b/.test(current)) return "ok";
  if (/warn|ungewöhnlich|unusual/.test(current)) return "warning";
  return "down";
}

export const SENSOR_TONE_LABELS: Record<SensorTone, string> = {
  down: "Fehler",
  warning: "Warnung",
  ok: "OK",
};
