/**
 * nextDesk's own monitoring: pure helpers for the results the on-prem probe
 * (`tools/ipam-agent`) reports and for turning a state change of a sensor
 * into the event the incident logic of the PRTG webhook understands.
 */

import type { PrtgEvent, StatusKind } from "../monitoring-webhook/prtg.ts";

export const MONITORING_FEATURE = "monitoring.native";
export const MAX_RESULTS = 5000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SensorKind = "ping" | "tcp" | "http";
export type SensorState = "unknown" | "up" | "warning" | "down";

export type SensorResult = {
  id: string;
  at: string;
  ok: boolean;
  value: number | null;
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
    const number =
      typeof entry.value === "number" &&
      Number.isFinite(entry.value) &&
      entry.value >= 0 &&
      entry.value < 1e9
        ? Math.round(entry.value * 100) / 100
        : null;
    results.push({
      id: entry.id.toLowerCase(),
      at: new Date(at).toISOString(),
      ok: entry.ok,
      value: number,
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
      kind: (["ping", "tcp", "http"].includes(String(entry.kind))
        ? entry.kind
        : "ping") as SensorKind,
      from: (states.includes(String(entry.from)) ? entry.from : "unknown") as SensorState,
      to: entry.to as SensorState,
      at: entry.at,
      value: typeof entry.value === "number" ? entry.value : null,
      message: typeof entry.message === "string" ? entry.message : null,
    }];
  });
}

/** Key of a sensor in monitoring_alerts / monitoring_sensor_states. */
export function sensorKey(sensorId: string): string {
  return `nd:sensor:${sensorId.toLowerCase()}`;
}

export function formatValue(value: number | null): string | null {
  if (value === null) return null;
  return `${value < 10 ? Math.round(value * 10) / 10 : Math.round(value)} ms`;
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
  const value = formatValue(transition.value);
  const fallback = transition.to === "down"
    ? "Keine Antwort"
    : transition.to === "warning"
    ? `Antwortzeit über dem Schwellenwert${value ? ` (${value})` : ""}`
    : `Wieder erreichbar${value ? ` (${value})` : ""}`;
  return {
    device: device?.name ?? null,
    host: device?.ipAddress ?? device?.hostname ?? null,
    sensor: transition.sensorName,
    status,
    kind,
    message: transition.message ?? fallback,
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
