import { assertEquals } from "jsr:@std/assert@1";

import {
  agentOnline,
  availability,
  bucketize,
  deviceState,
  displayState,
  parseAction,
  isOlderVersion,
  parseProbePackage,
  parseSensor,
  probeConfig,
  rangePlan,
} from "./logic.ts";

const TENANT = "00000000-0000-4000-8000-000000000001";
const ASSET = "00000000-0000-4000-8000-0000000000b1";
const AGENT = "00000000-0000-4000-8000-0000000000c1";

Deno.test("sensor: defaults, names and validation per kind", () => {
  assertEquals(parseSensor({ assetId: ASSET, kind: "ping", agentId: AGENT }), {
    id: null,
    assetId: ASSET,
    agentId: AGENT,
    kind: "ping",
    name: "Ping",
    target: null,
    port: null,
    url: null,
    intervalSeconds: 60,
    timeoutMs: 5000,
    warningAbove: null,
    failuresToDown: 2,
    paused: false,
  });
  const tcp = parseSensor({ assetId: ASSET, kind: "tcp", port: 3389, target: " SRV01.dom.local. ", intervalSeconds: 300 });
  assertEquals(typeof tcp === "string" ? tcp : [tcp.name, tcp.target, tcp.intervalSeconds], ["Port 3389", "srv01.dom.local", 300]);
  const http = parseSensor({ assetId: ASSET, kind: "http", url: "https://intranet.example.ch/health", target: "ignored", warningAbove: 800 });
  assertEquals(typeof http === "string" ? http : [http.name, http.target, http.url, http.warningAbove], [
    "HTTP intranet.example.ch",
    null,
    "https://intranet.example.ch/health",
    800,
  ]);
  assertEquals(parseSensor({ assetId: ASSET, kind: "tcp" }), "Der Port muss zwischen 1 und 65535 liegen.");
  assertEquals(parseSensor({ assetId: ASSET, kind: "http", url: "ftp://x" }), "Die Adresse muss mit http:// oder https:// beginnen.");
  assertEquals(parseSensor({ assetId: ASSET, kind: "http", url: "https://user:pw@x.ch" }), "Die Adresse darf keine Zugangsdaten enthalten.");
  assertEquals(parseSensor({ assetId: ASSET, kind: "ping", target: "-c 5 10.0.0.1" }), "Das Ziel muss eine IP-Adresse oder ein Hostname sein.");
  assertEquals(parseSensor({ assetId: ASSET, kind: "ping", intervalSeconds: 5 }), "Das Intervall ist ungültig.");
  assertEquals(parseSensor({ assetId: ASSET, kind: "snmp" }), "Die Art des Sensors ist ungültig.");
  assertEquals(parseSensor({ kind: "ping" }), "Das Gerät fehlt.");
});

Deno.test("actions: tenant is required, validation message is passed on", () => {
  assertEquals(parseAction({ type: "overview", tenantId: TENANT }), { type: "overview", tenantId: TENANT });
  assertEquals(parseAction({ type: "overview" }), null);
  assertEquals(parseAction({ type: "series", tenantId: TENANT, sensorId: ASSET, range: "2y" }), null);
  assertEquals(parseAction({ type: "saveSensor", tenantId: TENANT, sensor: { assetId: ASSET, kind: "tcp" } }), "Der Port muss zwischen 1 und 65535 liegen.");
  assertEquals(parseAction({ type: "pauseDevice", tenantId: TENANT, assetId: ASSET, paused: "ja" }), null);
  assertEquals(parseAction({ type: "löschen", tenantId: TENANT }), null);
});

Deno.test("state: a stored state is only shown while results keep coming", () => {
  const now = Date.parse("2026-11-16T10:00:00Z");
  const sensor = { paused: false, agentId: AGENT, intervalSeconds: 60 };
  const at = (seconds: number) => new Date(now - seconds * 1000).toISOString();
  assertEquals(displayState(sensor, { state: "up", lastCheckAt: at(30) }, now), "up");
  assertEquals(displayState(sensor, { state: "down", lastCheckAt: at(170) }, now), "down");
  // Three intervals without a result: the probe is silent, the state unknown.
  assertEquals(displayState(sensor, { state: "up", lastCheckAt: at(181) }, now), "unknown");
  assertEquals(displayState({ ...sensor, intervalSeconds: 600 }, { state: "up", lastCheckAt: at(1700) }, now), "up");
  assertEquals(displayState({ ...sensor, agentId: null }, { state: "up", lastCheckAt: at(10) }, now), "unknown");
  assertEquals(displayState({ ...sensor, paused: true }, { state: "down", lastCheckAt: at(10) }, now), "paused");
  assertEquals(displayState(sensor, null, now), "unknown");
  assertEquals(deviceState(["up", "paused", "warning"]), "warning");
  assertEquals(deviceState(["up", "unknown"]), "unknown");
  assertEquals(deviceState(["paused", "paused"]), "paused");
  assertEquals(deviceState([]), "unknown");
  assertEquals(agentOnline(at(100), now), true);
  assertEquals(agentOnline(at(200), now), false);
  assertEquals(agentOnline(null, now), false);
});

Deno.test("series: buckets weight averages and keep extremes", () => {
  const base = Date.parse("2026-11-16T10:00:00Z");
  const points = bucketize([
    { at: base, checks: 1, checksOk: 1, avg: 10, min: 10, max: 10 },
    { at: base + 60_000, checks: 1, checksOk: 1, avg: 30, min: 30, max: 30 },
    { at: base + 120_000, checks: 1, checksOk: 0, avg: null, min: null, max: null },
    { at: base + 300_000, checks: 60, checksOk: 60, avg: 5, min: 1, max: 40 },
  ], 300_000);
  assertEquals(points, [
    { t: "2026-11-16T10:00:00.000Z", avg: 20, min: 10, max: 30, ok: 0.6667 },
    { t: "2026-11-16T10:05:00.000Z", avg: 5, min: 1, max: 40, ok: 1 },
  ]);
  assertEquals(availability(points), 83.34);
  assertEquals(availability([]), null);
  assertEquals(rangePlan("24h", base).source, "raw");
  assertEquals(rangePlan("7d", base).source, "hourly");
  assertEquals(rangePlan("1y", base), { source: "daily", from: "2025-11-16T10:00:00.000Z", bucketMs: 86_400_000 });
});

Deno.test("probe: name is required, config.json is complete", () => {
  assertEquals(parseAction({ type: "createAgent", tenantId: TENANT, name: "  Sonde   Baar " }), {
    type: "createAgent",
    tenantId: TENANT,
    name: "Sonde Baar",
  });
  assertEquals(parseAction({ type: "createAgent", tenantId: TENANT, name: " " }), "Bitte einen Namen für die Sonde angeben.");
  assertEquals(JSON.parse(probeConfig("https://abc.supabase.co/functions/v1/", "ndip_x")), {
    nextdeskUrl: "https://abc.supabase.co/functions/v1/ipam-agent",
    agentToken: "ndip_x",
    logLevel: "info",
  });
});

Deno.test("probe package: latest.json is validated, versions are compared", () => {
  const latest = {
    version: "1.1.0",
    build: "abc1234",
    file: "nextdesk-sonde-1.1.0-abc1234.zip",
    size: 8237661,
    sha256: "e".repeat(64),
    builtAt: "2026-11-16T10:00:00.000Z",
  };
  assertEquals(parseProbePackage({ ...latest, extra: 1 }), latest);
  assertEquals(parseProbePackage({ ...latest, file: "../secrets.zip" }), null);
  assertEquals(parseProbePackage({ ...latest, file: "other/nextdesk-sonde-1.zip" }), null);
  assertEquals(parseProbePackage({ ...latest, version: "neu" }), null);
  assertEquals(parseProbePackage({ ...latest, sha256: "kurz" }), null);
  assertEquals(parseProbePackage(null), null);
  assertEquals(isOlderVersion("1.0.0", "1.1.0"), true);
  assertEquals(isOlderVersion("1.9.0", "1.10.0"), true);
  assertEquals(isOlderVersion("1.1.0", "1.1.0"), false);
  assertEquals(isOlderVersion("2.0.0", "1.9.9"), false);
  assertEquals(isOlderVersion(null, "1.1.0"), false);
  assertEquals(isOlderVersion("dev", "1.1.0"), false);
  assertEquals(parseAction({ type: "probePackage", tenantId: TENANT }), { type: "probePackage", tenantId: TENANT });
});
