/**
 * Pure parsing and mapping logic for PRTG «Execute HTTP Action»
 * notifications. PRTG replaces placeholders such as %device, %host, %sensor,
 * %sensorid, %deviceid, %status, %down, %message, %lastvalue, %datetime,
 * %group, %probe in the URL or the postdata; unknown placeholders stay as
 * literal text (e.g. "%objid") and are treated as empty here.
 */

export const MAX_BODY_BYTES = 16 * 1024;
export const COMMENT_THROTTLE_MS = 15 * 60 * 1000;
const MAX_FIELD_LENGTH = 2000;

import { germanPrtgMessage } from "./prtg-text.ts";

export type StatusKind = "down" | "warning" | "up" | "ignore";

export type PrtgEvent = {
  device: string | null;
  host: string | null;
  sensor: string | null;
  status: string;
  kind: StatusKind;
  message: string | null;
  objectId: string | null;
  sensorId: string | null;
  deviceId: string | null;
  lastValue: string | null;
  dateTime: string | null;
  group: string | null;
  probe: string | null;
  down: string | null;
  priority: string | null;
  link: string | null;
};

/** Field aliases (normalised: lower case, no "%", "_", "-" or spaces). */
const ALIASES: Record<keyof Omit<PrtgEvent, "kind">, string[]> = {
  device: ["device", "devicename", "name"],
  host: ["host", "hostname", "ip", "ipaddress", "address"],
  sensor: ["sensor", "sensorname"],
  status: ["status", "state", "laststatus"],
  message: ["message", "lastmessage", "msg", "text"],
  objectId: ["objid", "objectid", "id"],
  sensorId: ["sensorid"],
  deviceId: ["deviceid"],
  lastValue: ["lastvalue", "value"],
  dateTime: ["datetime", "date", "time"],
  group: ["group", "groupname"],
  probe: ["probe", "probename"],
  down: ["down", "downtime"],
  priority: ["priority", "prio"],
  link: ["linksensor", "link", "linkdevice"],
};

function normalizeKey(key: string): string {
  return key
    .trim()
    .toLowerCase()
    .replace(/[%_\-\s]/g, "");
}

/** Values that are empty, unreplaced placeholders or control characters only. */
export function cleanValue(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value !== "string") return null;
  const text = value
    .replace(/\u0000/g, "")
    .replace(/[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .trim();
  if (!text || /^%[a-z_]+$/i.test(text)) return null;
  return text.length > MAX_FIELD_LENGTH
    ? text.slice(0, MAX_FIELD_LENGTH)
    : text;
}

/**
 * Reads a request body as JSON object, form data (PRTG default for postdata)
 * or plain «key=value» text. Returns a flat map of normalised keys.
 */
export function parseBody(
  body: string,
  contentType: string | null,
): Record<string, string> | null {
  const trimmed = body.trim();
  if (!trimmed) return {};
  const type = (contentType ?? "").toLowerCase();
  const looksJson = trimmed.startsWith("{");
  if (type.includes("json") || looksJson) {
    try {
      const value: unknown = JSON.parse(trimmed);
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return null;
      }
      const flat: Record<string, string> = {};
      for (const [key, entry] of Object.entries(value)) {
        const cleaned = cleanValue(entry);
        if (cleaned !== null) flat[normalizeKey(key)] = cleaned;
      }
      return flat;
    } catch {
      if (type.includes("json")) return null;
    }
  }
  const flat: Record<string, string> = {};
  const params = new URLSearchParams(trimmed.replace(/\r?\n/g, "&"));
  for (const [key, entry] of params) {
    const cleaned = cleanValue(entry);
    if (cleaned !== null) flat[normalizeKey(key)] = cleaned;
  }
  return flat;
}

/** Query parameters, without the secret token. */
export function parseQuery(url: URL): Record<string, string> {
  const flat: Record<string, string> = {};
  for (const [key, entry] of url.searchParams) {
    const normalized = normalizeKey(key);
    if (normalized === "token") continue;
    const cleaned = cleanValue(entry);
    if (cleaned !== null) flat[normalized] = cleaned;
  }
  return flat;
}

/**
 * PRTG status texts follow the PRTG server language. English: "Up", "Down",
 * "Warning", "Unusual", "Paused (paused by user)", "Down (Acknowledged)",
 * "Down (Partial)", "Up (was: Down)", "Unknown". German: "OK", "Fehler",
 * "Warnung", "Ungewöhnlich", "Pausiert", "Fehler (Teilweise)", "Unbekannt".
 * Recovery texts: "Down ended (now: Up)" / "Fehler beendet (jetzt: OK)".
 */
export function classifyStatus(status: string | null): StatusKind | null {
  if (!status) return null;
  const head = status.trim().toLowerCase();
  // Recovery texts: «Fehler beendet (jetzt: OK)», «Down ended (now: Up)». The
  // state in brackets is the new one; without it the problem simply ended.
  if (/\b(beendet|ended)\b/.test(head)) {
    const now = /\((?:jetzt|now):\s*([^)]+)\)/.exec(head);
    return (now ? classifyStatus(now[1]!) : null) ?? "up";
  }
  if (/^(up|ok|ended|resolved|behoben|in ordnung)\b/.test(head)) return "up";
  if (
    /^(down|error|critical|failed|fehler|ausfall|st[öo]rung|kritisch|teilweiser fehler)/
      .test(head)
  ) {
    return "down";
  }
  if (
    /^(warning|unusual|degraded|warnung|ungew[öo]hnlich|eingeschr[äa]nkt)/
      .test(head)
  ) {
    return "warning";
  }
  if (
    /^(paused|unknown|none|collecting|simulated|pausiert|unbekannt|keine|simuliert)/
      .test(head)
  ) {
    return "ignore";
  }
  return null;
}

function pick(
  fields: Record<string, string>,
  aliases: string[],
): string | null {
  for (const alias of aliases) {
    const value = fields[alias];
    if (value) return value;
  }
  return null;
}

/**
 * Builds an event from query and body fields (body wins). Returns null when
 * the payload cannot be used: no recognisable status or nothing identifying
 * the monitored object.
 */
export function buildEvent(
  query: Record<string, string>,
  body: Record<string, string>,
): PrtgEvent | null {
  const fields = { ...query, ...body };
  const value = (key: keyof typeof ALIASES) => pick(fields, ALIASES[key]);
  const status = value("status");
  const kind =
    classifyStatus(status) ??
    // %down carries the down text ("Down", "Sensor is Down") for down events.
    (value("down") && classifyStatus(value("down")) === "down" ? "down" : null);
  if (!kind) return null;
  const event: PrtgEvent = {
    device: value("device"),
    host: value("host"),
    sensor: value("sensor"),
    status: status ?? value("down") ?? kind,
    kind,
    // Short German text (PRTG partly reports in English, with error codes).
    message: germanPrtgMessage(value("message")),
    objectId: value("objectId"),
    sensorId: value("sensorId"),
    deviceId: value("deviceId"),
    lastValue: value("lastValue"),
    dateTime: value("dateTime"),
    group: value("group"),
    probe: value("probe"),
    down: value("down"),
    priority: value("priority"),
    link: value("link"),
  };
  if (
    !event.device &&
    !event.host &&
    !event.sensor &&
    !event.objectId &&
    !event.sensorId &&
    !event.deviceId
  ) {
    return null;
  }
  return event;
}

/**
 * Stable key of the monitored object: the PRTG object/sensor ID when PRTG
 * sends one, else device (or host) plus sensor.
 */
export function externalKey(event: PrtgEvent): string {
  const id = event.objectId ?? event.sensorId;
  if (id) return `prtg:obj:${id.toLowerCase()}`.slice(0, 300);
  const device = (
    event.device ??
    event.host ??
    event.deviceId ??
    ""
  ).toLowerCase();
  const sensor = (event.sensor ?? "").toLowerCase();
  return `prtg:dev:${device}|sensor:${sensor}`.slice(0, 300);
}

/** IDs to compare with asset_infrastructure.prtg_object_id. */
export function candidateObjectIds(event: PrtgEvent): string[] {
  return [
    ...new Set(
      [event.objectId, event.deviceId, event.sensorId].filter(
        (entry): entry is string => !!entry && /^\d{1,12}$/.test(entry),
      ),
    ),
  ];
}

export type DeviceCandidate = {
  assetId: string;
  name: string;
  hostname: string | null;
  ipAddress: string | null;
  prtgObjectId: string | null;
  serviceIds: string[];
};

function unique(matches: DeviceCandidate[]): DeviceCandidate | null {
  const ids = new Set(matches.map((match) => match.assetId));
  return ids.size === 1 ? matches[0] : null;
}

/**
 * Maps the event to one device: explicit PRTG object ID first, then hostname
 * or IP address = %host (case-insensitive), then device name = %device.
 * Ambiguous matches on a level map to nothing.
 */
export function matchDevice(
  event: PrtgEvent,
  devices: DeviceCandidate[],
): DeviceCandidate | null {
  const ids = candidateObjectIds(event);
  // The sensor/object ID is the most specific, then the device ID.
  for (const id of ids) {
    const byId = devices.filter((device) => device.prtgObjectId === id);
    if (byId.length) return unique(byId);
  }
  const host = event.host?.trim().toLowerCase();
  if (host) {
    const byHost = devices.filter(
      (device) =>
        device.hostname?.trim().toLowerCase() === host ||
        device.ipAddress?.trim().toLowerCase() === host ||
        // "srv01.example.local" in PRTG vs "srv01" in nextDesk and vice versa.
        (device.hostname &&
          host.split(".")[0] ===
            device.hostname.trim().toLowerCase().split(".")[0] &&
          !/^\d+$/.test(host.split(".")[0])),
    );
    if (byHost.length) return unique(byHost);
  }
  const name = event.device?.trim().toLowerCase();
  if (name) {
    const byName = devices.filter(
      (device) => device.name.trim().toLowerCase() === name,
    );
    if (byName.length) return unique(byName);
  }
  return null;
}

export function ticketSubject(event: PrtgEvent): string {
  const device = event.device ?? event.host ?? "Unbekanntes Gerät";
  const sensor = event.sensor ? ` – ${event.sensor}` : "";
  const subject = `PRTG: ${device}${sensor} ${event.status}`.replace(
    /\s+/g,
    " ",
  );
  return subject.length > 240 ? `${subject.slice(0, 237)}…` : subject;
}

const LABELS: [keyof PrtgEvent, string][] = [
  ["status", "Status"],
  ["device", "Gerät"],
  ["host", "Host"],
  ["sensor", "Sensor"],
  ["message", "Meldung"],
  ["lastValue", "Letzter Wert"],
  ["down", "Ausfall"],
  ["dateTime", "Zeitpunkt (PRTG)"],
  ["group", "Gruppe"],
  ["probe", "Probe"],
  ["objectId", "Objekt-ID"],
  ["sensorId", "Sensor-ID"],
  ["deviceId", "Geräte-ID"],
  ["priority", "PRTG-Priorität"],
  ["link", "Link"],
];

export function eventDetails(event: PrtgEvent): string {
  return LABELS.flatMap(([key, label]) => {
    const value = event[key];
    return typeof value === "string" && value ? [`${label}: ${value}`] : [];
  }).join("\n");
}

export function ticketDescription(
  event: PrtgEvent,
  deviceName: string | null,
): string {
  const intro = deviceName
    ? `PRTG meldet eine Störung am Gerät «${deviceName}».`
    : "PRTG meldet eine Störung. Das Gerät konnte keinem Infrastruktur-Gerät zugeordnet werden.";
  return `${intro}\n\n${eventDetails(event)}`;
}

export function updateComment(event: PrtgEvent): string {
  if (event.kind === "up") {
    return `Wieder erreichbar (PRTG).\n\n${eventDetails(event)}`;
  }
  return `Neue PRTG-Meldung: ${event.status}\n\n${eventDetails(event)}`;
}

/**
 * Another comment on an open alert only after 15 minutes, unless the status
 * kind changed (e.g. Warning → Down).
 */
export function shouldComment(input: {
  lastCommentAt: string | null;
  openedAt: string;
  previousKind: StatusKind | null;
  kind: StatusKind;
  now: number;
}): boolean {
  if (input.previousKind !== input.kind) return true;
  const last = Date.parse(input.lastCommentAt ?? input.openedAt);
  return !Number.isFinite(last) || input.now - last >= COMMENT_THROTTLE_MS;
}

/** Whether an event opens a new alert for the given setting. */
export function opensAlert(
  kind: StatusKind,
  createOn: "down" | "down_and_warning",
): boolean {
  return (
    kind === "down" || (kind === "warning" && createOn === "down_and_warning")
  );
}

export type ServiceStatus =
  | "operational"
  | "degraded"
  | "partial_outage"
  | "major_outage"
  | "maintenance";

/**
 * Service status for the status page: Down → partial outage, Warning →
 * degraded. Never overrides maintenance, a major outage or a worse status.
 */
export function targetServiceStatus(
  kind: StatusKind,
  current: ServiceStatus,
): "degraded" | "partial_outage" | null {
  const target =
    kind === "down" ? "partial_outage" : kind === "warning" ? "degraded" : null;
  if (!target) return null;
  if (current === "operational") return target;
  if (current === "degraded" && target === "partial_outage") return target;
  return null;
}

export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
