import { assertEquals } from "jsr:@std/assert@1";

import {
  agentOnline,
  availability,
  bucketize,
  deviceState,
  displayState,
  parseAction,
  parseDeviceEdit,
  parseInterfaces,
  isOlderVersion,
  matchesAddress,
  parseNewDevice,
  parseProbePackage,
  parseSensor,
  probeConfig,
  rangePlan,
  parseCategoryLabel,
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
    serviceIds: null,
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
  assertEquals(parseSensor({ assetId: ASSET, kind: "wmi" }), "Die Art des Sensors ist ungültig.");
  assertEquals(parseSensor({ kind: "ping" }), "Das Gerät fehlt.");
});

Deno.test("actions: tenant is required, validation message is passed on", () => {
  assertEquals(parseAction({ type: "overview", tenantId: TENANT }), { type: "overview", tenantId: TENANT });
  assertEquals(parseAction({ type: "overview" }), null);
  assertEquals(parseAction({ type: "summary", tenantId: TENANT }), { type: "summary", tenantId: TENANT });
  assertEquals(parseAction({ type: "deviceTicket", tenantId: TENANT, assetId: "nope" }), null);
  assertEquals(parseAction({ type: "series", tenantId: TENANT, sensorId: ASSET, range: "2y" }), null);
  assertEquals(parseAction({ type: "saveSensor", tenantId: TENANT, sensor: { assetId: ASSET, kind: "tcp" } }), "Der Port muss zwischen 1 und 65535 liegen.");
  assertEquals(parseAction({ type: "pauseDevice", tenantId: TENANT, assetId: ASSET, paused: "ja" }), null);
  assertEquals(parseAction({ type: "removeDevice", tenantId: TENANT, assetId: ASSET }), {
    type: "removeDevice",
    tenantId: TENANT,
    assetId: ASSET,
  });
  assertEquals(parseAction({ type: "removeDevice", tenantId: TENANT }), null);
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

Deno.test("snmp sensors: metric decides fields, unit and thresholds", () => {
  const pick = (value: unknown) => {
    const sensor = parseSensor(value);
    return typeof sensor === "string"
      ? sensor
      : [sensor.name, sensor.snmpMetric, sensor.snmpIndex, sensor.snmpOid, sensor.scale, sensor.unit];
  };
  assertEquals(pick({ assetId: ASSET, kind: "snmp", snmpMetric: "uptime" }), ["Laufzeit", "uptime", null, null, 1, "s"]);
  assertEquals(pick({ assetId: ASSET, kind: "snmp", snmpMetric: "traffic", snmpIndex: 49, name: "1/1/49 to_SW-CORE" }), [
    "1/1/49 to_SW-CORE",
    "traffic",
    49,
    null,
    1,
    "bit/s",
  ]);
  assertEquals(
    pick({ assetId: ASSET, kind: "snmp", snmpMetric: "value", snmpOid: ".1.3.6.1.4.1.318.1.1.1.2.2.1.0", scale: 0.1, unit: " % " }),
    ["SNMP 2.1.0", "value", null, "1.3.6.1.4.1.318.1.1.1.2.2.1.0", 0.1, "%"],
  );
  assertEquals(pick({ assetId: ASSET, kind: "snmp", snmpMetric: "traffic" }), "Der Port (ifIndex) fehlt.");
  assertEquals(
    pick({ assetId: ASSET, kind: "snmp", snmpMetric: "value", snmpOid: "sysUpTime.0" }),
    "Die OID muss aus Zahlen mit Punkten bestehen, z. B. 1.3.6.1.2.1.1.3.0.",
  );
  assertEquals(pick({ assetId: ASSET, kind: "snmp", snmpMetric: "walk" }), "Die Messart des SNMP-Sensors ist ungültig.");
  const battery = parseSensor({
    assetId: ASSET,
    kind: "snmp",
    snmpMetric: "value",
    snmpOid: "1.3.6.1.4.1.318.1.1.1.2.2.1.0",
    warningBelow: 50,
    downBelow: 20,
    warningAbove: 0,
  });
  assertEquals(
    typeof battery === "string" ? battery : [battery.warningBelow, battery.downBelow, battery.warningAbove, battery.downAbove],
    [50, 20, 0, null],
  );
  // Thresholds below zero or for values above a minute only exist for SNMP.
  assertEquals(parseSensor({ assetId: ASSET, kind: "ping", warningAbove: 0 }), "Die Warnschwelle muss zwischen 1 und 60000 ms liegen.");
  const ping = parseSensor({ assetId: ASSET, kind: "ping", downAbove: 5, warningBelow: 1 });
  assertEquals(typeof ping === "string" ? ping : [ping.downAbove, ping.warningBelow], [null, null]);
});

Deno.test("interfaces: job result of the probe is cleaned", () => {
  assertEquals(
    parseInterfaces({
      output: {
        interfaces: [
          { index: 49, name: " 1/1/49 ", alias: "to_SW\u0000-CORE", up: true, speedMbps: 10000 },
          { index: 1, name: "", alias: "", up: "ja", speedMbps: 0 },
          { index: 0, name: "ungültig" },
          "text",
        ],
      },
    }),
    [
      { index: 49, name: "1/1/49", alias: "to_SW-CORE", up: true, speedMbps: 10000 },
      { index: 1, name: "Port 1", alias: null, up: false, speedMbps: null },
    ],
  );
  assertEquals(parseInterfaces(null), []);
  assertEquals(parseAction({ type: "listInterfaces", tenantId: TENANT, assetId: ASSET, agentId: AGENT })?.constructor, Object);
  assertEquals(parseAction({ type: "interfaces", tenantId: TENANT, jobId: "x" }), null);
});

Deno.test("series: second value (outgoing traffic) is averaged too", () => {
  const base = Date.parse("2026-11-16T10:00:00Z");
  const points = bucketize([
    { at: base, checks: 1, checksOk: 1, avg: 100, min: 100, max: 100, avg2: 10, max2: 10 },
    { at: base + 60_000, checks: 1, checksOk: 1, avg: 300, min: 300, max: 300, avg2: 30, max2: 30 },
  ], 300_000);
  assertEquals(points, [{ t: "2026-11-16T10:00:00.000Z", avg: 200, min: 100, max: 300, ok: 1, avg2: 20, max2: 30 }]);
});

Deno.test("certificate and dns sensors, cloud only for http, cert and dns", () => {
  const cert = parseSensor({ assetId: ASSET, kind: "cert", target: "Intranet.Example.ch", cloud: true });
  assertEquals(
    typeof cert === "string" ? cert : [cert.name, cert.target, cert.port, cert.unit, cert.warningBelow, cert.downBelow, cert.cloud, cert.agentId],
    ["Zertifikat intranet.example.ch", "intranet.example.ch", 443, "Tg.", 30, 7, true, null],
  );
  // Explicitly emptied thresholds stay empty; own values are kept.
  const own = parseSensor({ assetId: ASSET, kind: "cert", target: "x.example.ch", port: 8443, warningBelow: 14, downBelow: null, agentId: AGENT });
  assertEquals(typeof own === "string" ? own : [own.port, own.warningBelow, own.downBelow, own.cloud], [8443, 14, null, false]);
  const dns = parseSensor({ assetId: ASSET, kind: "dns", target: "srv01.example.ch", expect: "10.0.1.141", agentId: AGENT });
  assertEquals(typeof dns === "string" ? dns : [dns.name, dns.expect, dns.unit], ["DNS srv01.example.ch", "10.0.1.141", null]);
  assertEquals(parseSensor({ assetId: ASSET, kind: "cert" }), "Bitte den Hostnamen angeben.");
  assertEquals(parseSensor({ assetId: ASSET, kind: "dns", target: "x.ch", expect: "srv" }), "Die erwartete Adresse muss eine IP-Adresse sein.");
  assertEquals(parseSensor({ assetId: ASSET, kind: "ping", cloud: true }), "Aus der Cloud lassen sich nur HTTP, Zertifikat und DNS messen.");
  assertEquals(
    parseSensor({ assetId: ASSET, kind: "http", url: "https://x.ch", cloud: true, agentId: AGENT }),
    "Ein Sensor wird entweder von einer Sonde oder aus der Cloud gemessen.",
  );
  const now = Date.parse("2026-11-16T10:00:00Z");
  const at = (seconds: number) => new Date(now - seconds * 1000).toISOString();
  const cloud = { paused: false, agentId: null, intervalSeconds: 60, cloud: true };
  assertEquals(displayState(cloud, { state: "up", lastCheckAt: at(250) }, now), "up");
  assertEquals(displayState(cloud, { state: "up", lastCheckAt: at(310) }, now), "unknown");
  assertEquals(displayState({ ...cloud, cloud: false }, { state: "up", lastCheckAt: at(10) }, now), "unknown");
});

Deno.test("new device: name, kind and address; search in the address management", () => {
  assertEquals(parseNewDevice({ name: "  AP  015 ", category: "access_point", address: "172.16.128.20", agentId: AGENT }), {
    name: "AP 015",
    category: "access_point",
    categoryLabel: null,
    ipAddress: "172.16.128.20",
    hostname: null,
    agentId: AGENT,
    ipamAddressId: null,
  });
  const byName = parseNewDevice({ name: "S108", category: "server", address: "S108.dom1.inst.", ipamAddressId: ASSET });
  assertEquals(typeof byName === "string" ? byName : [byName.ipAddress, byName.hostname, byName.ipamAddressId], [
    null,
    "s108.dom1.inst",
    ASSET,
  ]);
  assertEquals(parseNewDevice({ name: "", category: "server", address: "10.0.0.1" }), "Bitte einen Namen für das Gerät angeben.");
  assertEquals(parseNewDevice({ name: "x", category: "drucker", address: "10.0.0.1" }), "Die Geräteart ist ungültig.");
  assertEquals(parseNewDevice({ name: "x", category: "server", address: "" }), "Bitte IP-Adresse oder Hostname angeben.");
  assertEquals(parseNewDevice({ name: "x", category: "server", address: "-c 5 10.0.0.1" }), "Die Adresse muss eine IP-Adresse oder ein Hostname sein.");
  assertEquals(parseAction({ type: "addDevice", tenantId: TENANT, device: { name: "x", category: "server" } }), "Bitte IP-Adresse oder Hostname angeben.");
  const entry = { address: "10.0.1.108", hostname: "S108", description: "PRTG-Server" };
  assertEquals(matchesAddress(entry, "s10"), true);
  assertEquals(matchesAddress(entry, "0.1.108"), true);
  assertEquals(matchesAddress(entry, "prtg"), true);
  assertEquals(matchesAddress(entry, "s"), false);
  assertEquals(matchesAddress(entry, "exchange"), false);
});

Deno.test("device edit: name and kind required, addresses optional but valid", () => {
  assertEquals(parseDeviceEdit({ name: " SW 001 ", category: "switch", ipAddress: "10.0.0.11", hostname: "SW001.dom1.inst." }), {
    name: "SW 001",
    category: "switch",
    categoryLabel: null,
    ipAddress: "10.0.0.11",
    hostname: "sw001.dom1.inst",
  });
  assertEquals(parseDeviceEdit({ name: "SW001", category: "switch", ipAddress: "", hostname: "" }), {
    name: "SW001",
    category: "switch",
    categoryLabel: null,
    ipAddress: null,
    hostname: null,
  });
  assertEquals(parseDeviceEdit({ name: "SW001", category: "switch", ipAddress: "10.0.0" }), "Die IP-Adresse ist ungültig.");
  assertEquals(parseDeviceEdit({ name: "SW001", category: "switch", hostname: "a b" }), "Der Hostname ist ungültig.");
  assertEquals(parseDeviceEdit({ name: "", category: "switch" }), "Bitte einen Namen für das Gerät angeben.");
  assertEquals(parseAction({ type: "updateDevice", tenantId: TENANT, assetId: ASSET, device: { name: "x", category: "y" } }), "Die Geräteart ist ungültig.");
});

Deno.test("own device kind only counts for the category other", () => {
  assertEquals(parseCategoryLabel("other", "  iLO   Karte "), "iLO Karte");
  assertEquals(parseCategoryLabel("other", ""), null);
  assertEquals(parseCategoryLabel("switch", "iLO"), null);
  assertEquals(parseCategoryLabel("other", 5), null);
});

Deno.test("probe actions: rename, new token, remove with target", () => {
  assertEquals(parseAction({ type: "updateAgent", tenantId: TENANT, agentId: AGENT, name: "  RZ  Baar ", active: false }), {
    type: "updateAgent", tenantId: TENANT, agentId: AGENT, name: "RZ Baar", active: false,
  });
  assertEquals(parseAction({ type: "updateAgent", tenantId: TENANT, agentId: AGENT, name: "" }), "Bitte einen Namen für die Sonde angeben.");
  assertEquals(parseAction({ type: "updateAgent", tenantId: TENANT, agentId: AGENT, name: "x" }), null);
  assertEquals(parseAction({ type: "rotateAgentToken", tenantId: TENANT, agentId: AGENT }), {
    type: "rotateAgentToken", tenantId: TENANT, agentId: AGENT,
  });
  assertEquals(parseAction({ type: "removeAgent", tenantId: TENANT, agentId: AGENT }), {
    type: "removeAgent", tenantId: TENANT, agentId: AGENT, moveSensorsTo: null,
  });
  // Sensors cannot move to the probe that is removed.
  assertEquals(parseAction({ type: "removeAgent", tenantId: TENANT, agentId: AGENT, moveSensorsTo: AGENT }), null);
});

Deno.test("sensor services: optional, validated, without duplicates", () => {
  const base = { assetId: ASSET, agentId: AGENT, kind: "ping", name: "Ping" };
  const none = parseSensor(base);
  assertEquals(typeof none === "string" ? none : none.serviceIds, null);
  const some = parseSensor({ ...base, serviceIds: [TENANT, TENANT] });
  assertEquals(typeof some === "string" ? some : some.serviceIds, [TENANT]);
  assertEquals(parseSensor({ ...base, serviceIds: ["nope"] }), "Die betroffenen Dienste sind ungültig.");
});

Deno.test("simulation: device or sensor, at most an hour, 0 ends it", () => {
  assertEquals(parseAction({ type: "simulate", tenantId: TENANT, assetId: ASSET, minutes: 10 }), {
    type: "simulate", tenantId: TENANT, assetId: ASSET, sensorId: null, minutes: 10,
  });
  assertEquals(parseAction({ type: "simulate", tenantId: TENANT, assetId: ASSET, sensorId: AGENT, minutes: 0 }), {
    type: "simulate", tenantId: TENANT, assetId: ASSET, sensorId: AGENT, minutes: 0,
  });
  assertEquals(
    parseAction({ type: "simulate", tenantId: TENANT, assetId: ASSET, minutes: 600 }),
    "Die Dauer der Simulation muss zwischen 0 und 60 Minuten liegen.",
  );
});
