import { assertEquals } from "jsr:@std/assert@1";

import { classifyStatus } from "../monitoring-webhook/prtg.ts";
import {
  formatValue,
  parseResults,
  parseTransitions,
  probeEvent,
  probeKey,
  sensorKey,
  type SensorTransition,
  transitionEvent,
} from "./monitoring-native.ts";

const SENSOR = "00000000-0000-4000-8000-0000000000a1";
const ASSET = "00000000-0000-4000-8000-0000000000b1";

Deno.test("results: unusable entries are dropped, values are bounded", () => {
  const parsed = parseResults([
    { id: SENSOR.toUpperCase(), at: "2026-11-16T10:00:00Z", ok: true, value: 1.2349, message: " ok \n fine " },
    { id: SENSOR, at: "2026-11-16T10:01:00Z", ok: false, value: -1 },
    { id: "kein-uuid", at: "2026-11-16T10:00:00Z", ok: true },
    { id: SENSOR, at: "gestern", ok: true },
    { id: SENSOR, at: "2026-11-16T10:00:00Z", ok: "ja" },
    "text",
  ]);
  assertEquals(parsed?.skipped, 4);
  assertEquals(parsed?.results, [
    { id: SENSOR, at: "2026-11-16T10:00:00.000Z", ok: true, value: 1.23, value2: null, message: "ok fine" },
    { id: SENSOR, at: "2026-11-16T10:01:00.000Z", ok: false, value: -1, value2: null, message: null },
  ]);
  assertEquals(parseResults({}), null);
  assertEquals(parseResults(new Array(5001).fill({})), null);
});

function transition(overrides: Partial<SensorTransition>): SensorTransition {
  return {
    sensorId: SENSOR,
    sensorName: "Ping",
    assetId: ASSET,
    kind: "ping",
    from: "up",
    to: "down",
    at: "2026-11-16T10:02:00Z",
    value: null,
    unit: null,
    message: null,
    ...overrides,
  };
}

Deno.test("transition event: statuses are classified like PRTG messages", () => {
  const device = { name: "sw-core", hostname: "sw-core.local", ipAddress: "10.0.0.2" };
  const down = transitionEvent(transition({}), device, "Sonde Baar");
  assertEquals(down?.kind, "down");
  assertEquals(down?.origin, "sensor");
  assertEquals(down?.host, "10.0.0.2");
  assertEquals(down?.message, "Keine Antwort");
  assertEquals(classifyStatus(down?.status ?? null), "down");

  const warning = transitionEvent(transition({ to: "warning", value: 312.4 }), device, "Sonde");
  assertEquals(warning?.kind, "warning");
  assertEquals(warning?.lastValue, "312 ms");
  assertEquals(classifyStatus(warning?.status ?? null), "warning");

  const up = transitionEvent(transition({ from: "down", to: "up", value: 1.26 }), null, "Sonde");
  assertEquals(up?.kind, "up");
  assertEquals(up?.message, "Wieder erreichbar (1.3 ms)");
  assertEquals(classifyStatus(up?.status ?? null), "up");
});

Deno.test("transition event: first OK and unknown need no event", () => {
  assertEquals(transitionEvent(transition({ from: "unknown", to: "up" }), null, "Sonde"), null);
  assertEquals(transitionEvent(transition({ to: "unknown" }), null, "Sonde"), null);
  assertEquals(transitionEvent(transition({ from: "unknown", to: "down" }), null, "Sonde")?.kind, "down");
});

Deno.test("transitions from the database and the sensor key", () => {
  assertEquals(
    parseTransitions({
      accepted: 2,
      transitions: [
        { sensorId: SENSOR, sensorName: "HTTP", assetId: ASSET, kind: "http", from: "up", to: "down", at: "2026-11-16T10:02:00Z", value: null, message: "HTTP 503" },
        { sensorId: SENSOR, to: "kaputt", assetId: ASSET, at: "x" },
        null,
      ],
    }).map((entry) => [entry.kind, entry.to, entry.message]),
    [["http", "down", "HTTP 503"]],
  );
  assertEquals(parseTransitions(null), []);
  assertEquals(sensorKey(SENSOR.toUpperCase()), `nd:sensor:${SENSOR}`);
  assertEquals(formatValue(null), null);
});

Deno.test("values are formatted by unit, threshold messages get the value", () => {
  assertEquals(formatValue(412.4), "412 ms");
  assertEquals(formatValue(91.26, "%"), "91 %");
  assertEquals(formatValue(1_240_000_000, "bit/s"), "1.2 Gbit/s");
  assertEquals(formatValue(38_400_000, "bit/s"), "38 Mbit/s");
  assertEquals(formatValue(120, "bit/s"), "120 bit/s");
  assertEquals(formatValue(12 * 86400 + 3 * 3600, "s"), "12 Tg. 3 Std.");
  assertEquals(formatValue(2 * 3600 + 300, "s"), "2 Std. 5 Min.");
  const event = transitionEvent(
    transition({ kind: "snmp", to: "down", value: 96, unit: "%", message: "Wert über der Ausfall-Schwelle" }),
    null,
    "Sonde",
  );
  assertEquals(event?.message, "Wert über der Ausfall-Schwelle (96 %)");
  assertEquals(event?.lastValue, "96 %");
  assertEquals(
    transitionEvent(transition({ kind: "snmp", from: "down", to: "up", value: 40, unit: "%" }), null, "Sonde")?.message,
    "Wieder in Ordnung (40 %)",
  );
  assertEquals(parseResults([{ id: SENSOR, at: "2026-11-16T10:00:00Z", ok: true, value: 5e6, value2: 1.5e6 }])?.results[0]?.value2, 1500000);
});

Deno.test("probe watchdog: events for a silent and a returning probe", () => {
  const now = Date.parse("2026-11-16T10:10:00Z");
  const down = probeEvent("down", { name: "Baar", lastSeenAt: "2026-11-16T10:03:00Z", sensors: 14 }, now);
  assertEquals(down.kind, "down");
  assertEquals(down.device, "Sonde «Baar»");
  assertEquals(down.message, "Seit 7 Minuten keine Meldung. 14 Sensoren werden nicht gemessen.");
  assertEquals(classifyStatus(down.status), "down");
  assertEquals(
    probeEvent("down", { name: "Neu", lastSeenAt: null, sensors: 1 }, now).message,
    "Noch nie gemeldet. 1 Sensor wird nicht gemessen.",
  );
  assertEquals(probeEvent("up", { name: "Baar", lastSeenAt: null, sensors: 0 }, now).kind, "up");
  assertEquals(probeKey("ABCDEF00-0000-4000-8000-000000000001"), "nd:probe:abcdef00-0000-4000-8000-000000000001");
});
