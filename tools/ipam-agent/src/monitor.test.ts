import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createServer as createTcpServer } from "node:net";
import { test } from "node:test";

import {
  type Check,
  parseChecks,
  runCheck,
  safeHost,
  daysUntil,
  Schedule,
  snmpNumber,
  trafficRate,
} from "./monitor.ts";
import { mapInterfaces } from "./snmp.ts";

const ID = "00000000-0000-4000-8000-0000000000a1";
const ID2 = "00000000-0000-4000-8000-0000000000a2";

function check(overrides: Partial<Check>): Check {
  return {
    id: ID,
    kind: "tcp",
    host: "127.0.0.1",
    port: 1,
    url: null,
    snmpMetric: null,
    snmpOid: null,
    snmpIndex: null,
    scale: 1,
    expect: null,
    intervalSeconds: 60,
    timeoutMs: 2000,
    ...overrides,
  };
}

test("parseChecks: nur brauchbare Prüfungen, sichere Ziele", () => {
  const checks = parseChecks([
    {
      id: ID,
      kind: "ping",
      host: " 10.0.0.1 ",
      intervalSeconds: 30,
      timeoutMs: 1000,
    },
    { id: ID2, kind: "tcp", host: "srv01.example.ch.", port: 443 },
    {
      id: "00000000-0000-4000-8000-0000000000a3",
      kind: "http",
      url: "https://example.ch/health",
    },
    {
      id: "00000000-0000-4000-8000-0000000000a4",
      kind: "ping",
      host: "-c 100 10.0.0.1",
    },
    {
      id: "00000000-0000-4000-8000-0000000000a5",
      kind: "tcp",
      host: "10.0.0.1",
      port: 70000,
    },
    {
      id: "00000000-0000-4000-8000-0000000000a6",
      kind: "http",
      url: "file:///etc/passwd",
    },
    { id: "00000000-0000-4000-8000-0000000000a7", kind: "ping", host: null },
    { id: "kein-uuid", kind: "ping", host: "10.0.0.1" },
  ]);
  assert.deepEqual(
    checks.map((entry) => [entry.kind, entry.host ?? entry.url, entry.port]),
    [
      ["ping", "10.0.0.1", null],
      ["tcp", "srv01.example.ch", 443],
      ["http", "https://example.ch/health", null],
    ],
  );
  assert.equal(checks[0]!.intervalSeconds, 30);
  assert.equal(checks[1]!.intervalSeconds, 60);
  assert.equal(checks[1]!.timeoutMs, 5000);
  assert.deepEqual(parseChecks(null), []);
  assert.equal(safeHost("fe80::1"), "fe80::1");
  assert.equal(safeHost("a b"), null);
});

test("Schedule: verteilt den Start, hält das Intervall, entfernt Gelöschtes", () => {
  const schedule = new Schedule(() => 0.5);
  schedule.update(
    [check({ id: ID }), check({ id: ID2, intervalSeconds: 300 })],
    0,
  );
  assert.deepEqual(schedule.due(0, 10), []);
  // 60 s Intervall → Start nach 15 s, 300 s Intervall → Start nach 15 s (max. 30 s Streuung).
  assert.deepEqual(
    schedule.due(15_000, 10).map((entry) => entry.id),
    [ID, ID2],
  );
  // Läuft noch: nicht doppelt starten.
  assert.deepEqual(schedule.due(80_000, 10), []);
  schedule.done(ID);
  schedule.done(ID2);
  assert.deepEqual(schedule.due(74_999, 10), []);
  assert.deepEqual(
    schedule.due(75_000, 10).map((entry) => entry.id),
    [ID],
  );
  schedule.done(ID);
  // Nach langer Pause werden verpasste Läufe nicht nachgeholt.
  assert.deepEqual(
    schedule.due(1_000_000, 1).map((entry) => entry.id),
    [ID],
  );
  schedule.done(ID);
  assert.deepEqual(
    schedule.due(1_000_001, 10).map((entry) => entry.id),
    [ID2],
  );
  schedule.update([check({ id: ID2, intervalSeconds: 300 })], 1_000_001);
  assert.equal(schedule.size, 1);
});

test("runCheck: TCP offen und geschlossen", async () => {
  const server = createTcpServer((socket) => socket.end());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  try {
    const open = await runCheck("linux", check({ port }));
    assert.equal(open.ok, true);
    assert.equal(typeof open.value, "number");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  const closed = await runCheck("linux", check({ port }));
  assert.equal(closed.ok, false);
  assert.equal(closed.message, `Port ${port} geschlossen`);
});

test("runCheck: HTTP 200 ist OK, 503 ist ein Fehler", async () => {
  const server = createServer((request, response) => {
    response.statusCode = request.url === "/down" ? 503 : 200;
    response.end("ok");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  try {
    const up = await runCheck(
      "linux",
      check({
        kind: "http",
        host: null,
        port: null,
        url: `http://127.0.0.1:${port}/`,
      }),
    );
    assert.deepEqual([up.ok, up.message], [true, "HTTP 200"]);
    const down = await runCheck(
      "linux",
      check({
        kind: "http",
        host: null,
        port: null,
        url: `http://127.0.0.1:${port}/down`,
      }),
    );
    assert.deepEqual([down.ok, down.message], [false, "HTTP 503"]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("parseChecks: SNMP-Sensoren je Messart", () => {
  const checks = parseChecks([
    {
      id: ID,
      kind: "snmp",
      host: "10.0.0.2",
      snmpMetric: "traffic",
      snmpIndex: 49,
    },
    {
      id: ID2,
      kind: "snmp",
      host: "10.0.0.2",
      snmpMetric: "value",
      snmpOid: "1.3.6.1.4.1.318.1.1.1.2.2.1.0",
      scale: 0.1,
    },
    {
      id: "00000000-0000-4000-8000-0000000000a3",
      kind: "snmp",
      host: "10.0.0.2",
      snmpMetric: "uptime",
    },
    {
      id: "00000000-0000-4000-8000-0000000000a4",
      kind: "snmp",
      host: "10.0.0.2",
      snmpMetric: "traffic",
    },
    {
      id: "00000000-0000-4000-8000-0000000000a5",
      kind: "snmp",
      host: "10.0.0.2",
      snmpMetric: "value",
      snmpOid: "1.3;rm",
    },
    {
      id: "00000000-0000-4000-8000-0000000000a6",
      kind: "snmp",
      host: "10.0.0.2",
      snmpMetric: "walk",
    },
  ]);
  assert.deepEqual(
    checks.map((entry) => [
      entry.snmpMetric,
      entry.snmpIndex,
      entry.snmpOid,
      entry.scale,
    ]),
    [
      ["traffic", 49, null, 1],
      ["value", null, "1.3.6.1.4.1.318.1.1.1.2.2.1.0", 0.1],
      ["uptime", null, null, 1],
    ],
  );
});

test("snmpNumber: Zahl, Counter64, Zahlentext", () => {
  assert.equal(snmpNumber({ oid: "1", value: 42, type: 2 }), 42);
  assert.equal(
    snmpNumber({
      oid: "1",
      value: Buffer.from([0x01, 0x00, 0x00, 0x00, 0x00]),
      type: 70,
    }),
    2 ** 32,
  );
  assert.equal(
    snmpNumber({ oid: "1", value: Buffer.from("23.5"), type: 4 }),
    23.5,
  );
  assert.equal(
    snmpNumber({ oid: "1", value: Buffer.from("Aruba 6300"), type: 4 }),
    null,
  );
  assert.equal(snmpNumber(null), null);
});

test("trafficRate: Bit pro Sekunde, Überlauf, Neustart", () => {
  const first = { at: 0, input: 1_000_000, output: 500_000, bits: 64 as const };
  assert.equal(trafficRate(undefined, first), null);
  // 60 s später 7.5 MB bzw. 750 kB mehr → 1 Mbit/s bzw. 100 kbit/s.
  assert.deepEqual(
    trafficRate(first, {
      at: 60_000,
      input: 8_500_000,
      output: 1_250_000,
      bits: 64,
    }),
    { input: 1_000_000, output: 100_000 },
  );
  // 64-Bit-Zähler fällt: Gerät neu gestartet, kein Wert.
  assert.equal(
    trafficRate(first, { at: 60_000, input: 10, output: 10, bits: 64 }),
    null,
  );
  // 32-Bit-Zähler läuft über.
  assert.deepEqual(
    trafficRate(
      { at: 0, input: 2 ** 32 - 1000, output: 0, bits: 32 },
      { at: 8000, input: 1000, output: 0, bits: 32 },
    ),
    { input: 2000, output: 0 },
  );
  // Wechsel der Zählerart oder zu grosser Abstand: kein Wert.
  assert.equal(
    trafficRate(first, {
      at: 60_000,
      input: 2_000_000,
      output: 600_000,
      bits: 32,
    }),
    null,
  );
  assert.equal(
    trafficRate(first, {
      at: 7 * 3600_000,
      input: 2_000_000,
      output: 600_000,
      bits: 64,
    }),
    null,
  );
});

test("mapInterfaces: Name, Beschreibung, Status und Tempo je Port", () => {
  const text = (value: string) => Buffer.from(value);
  const interfaces = mapInterfaces({
    descr: [
      { oid: "1.3.6.1.2.1.2.2.1.2.1", value: text("GigabitEthernet1/0/1") },
      { oid: "1.3.6.1.2.1.2.2.1.2.49", value: text("TenGigabitEthernet1/1/1") },
    ],
    name: [{ oid: "1.3.6.1.2.1.31.1.1.1.1.1", value: text("1/1/1") }],
    alias: [{ oid: "1.3.6.1.2.1.31.1.1.1.18.49", value: text("to_SW-CORE") }],
    operStatus: [
      { oid: "1.3.6.1.2.1.2.2.1.8.1", value: 2 },
      { oid: "1.3.6.1.2.1.2.2.1.8.49", value: 1 },
    ],
    highSpeed: [{ oid: "1.3.6.1.2.1.31.1.1.1.15.49", value: 10000 }],
  });
  assert.deepEqual(interfaces, [
    { index: 1, name: "1/1/1", alias: null, up: false, speedMbps: null },
    {
      index: 49,
      name: "TenGigabitEthernet1/1/1",
      alias: "to_SW-CORE",
      up: true,
      speedMbps: 10000,
    },
  ]);
});

test("parseChecks und daysUntil: Zertifikat und DNS", () => {
  const checks = parseChecks([
    { id: ID, kind: "cert", host: "intranet.example.ch" },
    { id: ID2, kind: "dns", host: "srv01.example.ch", expect: "10.0.1.141" },
    {
      id: "00000000-0000-4000-8000-0000000000a3",
      kind: "dns",
      host: "x.example.ch",
      expect: "kein-ip",
    },
  ]);
  assert.deepEqual(
    checks.map((entry) => [entry.kind, entry.host, entry.port, entry.expect]),
    [
      ["cert", "intranet.example.ch", 443, null],
      ["dns", "srv01.example.ch", null, "10.0.1.141"],
      ["dns", "x.example.ch", null, null],
    ],
  );
  const now = Date.parse("2026-11-16T10:00:00Z");
  assert.equal(daysUntil("Nov 28 09:00:00 2026 GMT", now), 11);
  assert.equal(daysUntil("Nov 15 10:00:00 2026 GMT", now), -1);
  assert.equal(daysUntil("kaputt", now), null);
});

test("runCheck: DNS ohne Antwort ist ein Fehler", async () => {
  const result = await runCheck(
    "linux",
    check({ kind: "dns", host: "gibt-es-nicht.invalid", port: null }),
  );
  assert.deepEqual(
    [result.ok, result.message],
    [false, "Der Name lässt sich nicht auflösen."],
  );
});
