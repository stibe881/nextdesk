/**
 * nextDesk's own monitoring: pure helpers for the results the on-prem probe
 * (`tools/ipam-agent`) reports and for turning a state change of a sensor
 * into the event the incident logic of the PRTG webhook understands.
 */

import type { PrtgEvent, StatusKind } from "../monitoring-webhook/prtg.ts";

export const MONITORING_FEATURE = "monitoring.native";
export const MAX_RESULTS = 5000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SensorKind = "ping" | "tcp" | "http" | "snmp";
export type SensorState = "unknown" | "up" | "warning" | "down";

export type SensorResult = {
  id: string;
  at: string;
  ok: boolean;
  value: number | null;
  value2: number | null;
  message: string | null;
};

export type SensorTransition = {
  sensorId: string;
  sensorName: string;
  assetId: string;
  kind: SensorKind;
  from: SensorState;
  to: SensorState;
  at: string;
  value: number | null;
  /** Unit of the value; null means response time in ms. */
  unit: string | null;
  message: string | null;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Results of a `monitorReport`. Unusable entries are dropped (and counted),
 * so one broken check never blocks the others.
 */
export function parseResults(
  value: unknown,
): { results: SensorResult[]; skipped: number } | null {
  if (!Array.isArray(value) || value.length > MAX_RESULTS) return null;
  const results: SensorResult[] = [];
  let skipped = 0;
  for (const entry of value) {
    if (!isObject(entry)) {
      skipped += 1;
      continue;
    }
    const at = typeof entry.at === "string" ? Date.parse(entry.at) : NaN;
    if (
      typeof entry.id !== "string" ||
      !UUID.test(entry.id) ||
      !Number.isFinite(at) ||
      typeof entry.ok !== "boolean"
    ) {
      skipped += 1;
      continue;
    }
    const bounded = (raw: unknown) =>
      typeof raw === "number" && Number.isFinite(raw) && Math.abs(raw) < 1e15
        ? Math.round(raw * 100) / 100
        : null;
    const number = bounded(entry.value);
    results.push({
      id: entry.id.toLowerCase(),
      at: new Date(at).toISOString(),
      ok: entry.ok,
      value: number,
      value2: bounded(entry.value2),
      message:
        typeof entry.message === "string" && entry.message.trim()
          ? entry.message.replace(/\s+/g, " ").trim().slice(0, 500)
          : null,
    });
  }
  return { results, skipped };
}

/** State changes returned by `monitoring_ingest_results`. */
export function parseTransitions(value: unknown): SensorTransition[] {
  const list = isObject(value) && Array.isArray(value.transitions)
    ? value.transitions
    : [];
  const states = ["unknown", "up", "warning", "down"];
  return list.flatMap((entry) => {
    if (
      !isObject(entry) ||
      typeof entry.sensorId !== "string" ||
      typeof entry.assetId !== "string" ||
      typeof entry.at !== "string" ||
      !states.includes(String(entry.to))
    ) {
      return [];
    }
    return [{
      sensorId: entry.sensorId,
      sensorName: typeof entry.sensorName === "string" ? entry.sensorName : "Sensor",
      assetId: entry.assetId,
      kind: (["ping", "tcp", "http", "snmp"].includes(String(entry.kind))
        ? entry.kind
        : "ping") as SensorKind,
      from: (states.includes(String(entry.from)) ? entry.from : "unknown") as SensorState,
      to: entry.to as SensorState,
      at: entry.at,
      value: typeof entry.value === "number" ? entry.value : null,
      unit: typeof entry.unit === "string" && entry.unit ? entry.unit : null,
      message: typeof entry.message === "string" ? entry.message : null,
    }];
  });
}

/** Key of a sensor in monitoring_alerts / monitoring_sensor_states. */
export function sensorKey(sensorId: string): string {
  return `nd:sensor:${sensorId.toLowerCase()}`;
}

/** «412 ms», «91 %», «1.2 Gbit/s», «12 Tg. 3 Std.» (unit null = ms). */
export function formatValue(value: number | null, unit: string | null = null): string | null {
  if (value === null) return null;
  const short = (number: number) => `${Math.abs(number) < 10 ? Math.round(number * 10) / 10 : Math.round(number)}`;
  if (unit === "bit/s") {
    const steps: [number, string][] = [[1e9, "Gbit/s"], [1e6, "Mbit/s"], [1e3, "kbit/s"]];
    for (const [size, label] of steps) if (Math.abs(value) >= size) return `${short(value / size)} ${label}`;
    return `${short(value)} bit/s`;
  }
  if (unit === "s") {
    const days = Math.floor(value / 86400);
    const hours = Math.floor((value % 86400) / 3600);
    return days > 0 ? `${days} Tg. ${hours} Std.` : `${hours} Std. ${Math.floor((value % 3600) / 60)} Min.`;
  }
  return `${short(value)} ${unit ?? "ms"}`;
}

const STATUS: Record<Exclude<SensorState, "unknown">, { status: string; kind: StatusKind }> = {
  down: { status: "Fehler", kind: "down" },
  warning: { status: "Warnung", kind: "warning" },
  up: { status: "OK", kind: "up" },
};

/**
 * The event for the incident logic, or null when the change needs none
 * (a sensor measured for the first time and found OK).
 */
export function transitionEvent(
  transition: SensorTransition,
  device: { name: string; hostname: string | null; ipAddress: string | null } | null,
  probeName: string,
): PrtgEvent | null {
  if (transition.to === "unknown") return null;
  if (transition.to === "up" && transition.from === "unknown") return null;
  const { status, kind } = STATUS[transition.to];
  const value = formatValue(transition.value, transition.unit);
  const suffix = value ? ` (${value})` : "";
  const fallback = transition.to === "down"
    ? "Keine Antwort"
    : transition.to === "warning"
    ? `Antwortzeit über dem Schwellenwert${suffix}`
    : transition.kind === "snmp"
    ? `Wieder in Ordnung${suffix}`
    : `Wieder erreichbar${suffix}`;
  // Threshold messages from the database carry no value yet.
  const message = transition.message && /Schwelle$/.test(transition.message)
    ? `${transition.message}${suffix}`
    : transition.message;
  return {
    device: device?.name ?? null,
    host: device?.ipAddress ?? device?.hostname ?? null,
    sensor: transition.sensorName,
    status,
    kind,
    message: message ?? fallback,
    objectId: null,
    sensorId: null,
    deviceId: null,
    lastValue: value,
    dateTime: transition.at,
    group: null,
    probe: probeName,
    down: null,
    priority: null,
    link: null,
    origin: "sensor",
  };
}

/** Event for a probe that stopped (or resumed) reporting. */
export function probeEvent(
  action: "down" | "up",
  probe: { name: string; lastSeenAt: string | null; sensors: number },
  now: number,
): PrtgEvent {
  const seen = probe.lastSeenAt ? Date.parse(probe.lastSeenAt) : NaN;
  const minutes = Number.isFinite(seen) ? Math.max(1, Math.round((now - seen) / 60000)) : null;
  return {
    device: `Sonde «${probe.name}»`,
    host: null,
    sensor: "Verbindung zu nextDesk",
    status: action === "down" ? "Fehler" : "OK",
    kind: action,
    message: action === "down"
      ? `${minutes === null ? "Noch nie gemeldet" : `Seit ${minutes} Minuten keine Meldung`}. ${probe.sensors} ${probe.sensors === 1 ? "Sensor wird" : "Sensoren werden"} nicht gemessen.`
      : "Die Sonde meldet sich wieder.",
    objectId: null,
    sensorId: null,
    deviceId: null,
    lastValue: null,
    dateTime: new Date(now).toISOString(),
    group: null,
    probe: probe.name,
    down: null,
    priority: null,
    link: null,
    origin: "sensor",
  };
}

export function probeKey(agentId: string): string {
  return `nd:probe:${agentId.toLowerCase()}`;
}
