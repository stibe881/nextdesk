import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createServer as createTcpServer } from "node:net";
import { test } from "node:test";

import {
  type Check,
  parseChecks,
  runCheck,
  safeHost,
  Schedule,
} from "./monitor.ts";

const ID = "00000000-0000-4000-8000-0000000000a1";
const ID2 = "00000000-0000-4000-8000-0000000000a2";

function check(overrides: Partial<Check>): Check {
  return {
    id: ID,
    kind: "tcp",
    host: "127.0.0.1",
    port: 1,
    url: null,
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
