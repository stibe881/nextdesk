import { assert, assertEquals } from "jsr:@std/assert@1";

import {
  buildEvent,
  classifyStatus,
  cleanValue,
  type DeviceCandidate,
  externalKey,
  matchDevice,
  opensAlert,
  parseBody,
  parseQuery,
  shouldComment,
  targetServiceStatus,
  ticketDescription,
  ticketSubject,
} from "./prtg.ts";

const devices: DeviceCandidate[] = [
  {
    assetId: "a1",
    name: "Core-Switch",
    hostname: "sw-core.example.local",
    ipAddress: "10.0.0.2",
    prtgObjectId: "2045",
    serviceId: "s1",
  },
  {
    assetId: "a2",
    name: "Firewall",
    hostname: "fw01",
    ipAddress: "10.0.0.1",
    prtgObjectId: null,
    serviceId: null,
  },
  {
    assetId: "a3",
    name: "AP Büro 1",
    hostname: null,
    ipAddress: null,
    prtgObjectId: null,
    serviceId: null,
  },
];

Deno.test("status texts map to kinds", () => {
  assertEquals(classifyStatus("Down"), "down");
  assertEquals(classifyStatus("Down (Acknowledged)"), "down");
  assertEquals(classifyStatus("Down (Partial)"), "down");
  assertEquals(classifyStatus("Warning"), "warning");
  assertEquals(classifyStatus("Unusual"), "warning");
  assertEquals(classifyStatus("Up"), "up");
  assertEquals(classifyStatus("Up (was: Down)"), "up");
  assertEquals(classifyStatus("Paused (paused by user)"), "ignore");
  assertEquals(classifyStatus("Gemischt"), null);
  assertEquals(classifyStatus(null), null);
});

Deno.test("form, JSON and query payloads are accepted", () => {
  const form = parseBody(
    "device=Core-Switch&host=10.0.0.2&sensor=Ping&status=Down&message=Timeout&sensorid=2046&lastvalue=%25lastvalue",
    "application/x-www-form-urlencoded",
  );
  assertEquals(form?.device, "Core-Switch");
  assertEquals(form?.sensorid, "2046");
  // Unreplaced placeholders are empty.
  assertEquals(form?.lastvalue, undefined);

  const json = parseBody(
    JSON.stringify({ "%device": "FW", Status: "Warning", objid: 17 }),
    "application/json",
  );
  assertEquals(json, { device: "FW", status: "Warning", objid: "17" });
  assertEquals(parseBody("[1]", "application/json"), null);
  assertEquals(parseBody("", null), {});

  const query = parseQuery(
    new URL("https://x.test/f?token=secret&device=AP&status=Up"),
  );
  assertEquals(query, { device: "AP", status: "Up" });
});

Deno.test("events need a status and an object", () => {
  assertEquals(buildEvent({}, { device: "AP" }), null);
  assertEquals(buildEvent({}, { status: "Down" }), null);
  const event = buildEvent(
    { status: "Up", device: "AP" },
    { status: "Down", sensor: "Ping" },
  );
  assertEquals(event?.kind, "down");
  assertEquals(event?.device, "AP");
  assertEquals(event?.sensor, "Ping");
  const viaDown = buildEvent({}, { down: "Down", device: "AP" });
  assertEquals(viaDown?.kind, "down");
});

Deno.test("external key prefers object id, else device and sensor", () => {
  const byId = buildEvent({}, { status: "Down", objid: "2046", device: "X" })!;
  assertEquals(externalKey(byId), "prtg:obj:2046");
  const bySensorId = buildEvent({}, { status: "Down", sensorid: "77" })!;
  assertEquals(externalKey(bySensorId), "prtg:obj:77");
  const byName = buildEvent(
    {},
    {
      status: "Down",
      device: "Core-Switch",
      sensor: "Ping",
    },
  )!;
  assertEquals(externalKey(byName), "prtg:dev:core-switch|sensor:ping");
});

Deno.test("device mapping: object id, then host, then name", () => {
  const byId = buildEvent(
    {},
    {
      status: "Down",
      deviceid: "2045",
      device: "Firewall",
    },
  )!;
  assertEquals(matchDevice(byId, devices)?.assetId, "a1");
  const byIp = buildEvent({}, { status: "Down", host: "10.0.0.1" })!;
  assertEquals(matchDevice(byIp, devices)?.assetId, "a2");
  const byHost = buildEvent(
    {},
    { status: "Down", host: "FW01.example.local" },
  )!;
  assertEquals(matchDevice(byHost, devices)?.assetId, "a2");
  const byName = buildEvent({}, { status: "Down", device: "ap büro 1" })!;
  assertEquals(matchDevice(byName, devices)?.assetId, "a3");
  const none = buildEvent({}, { status: "Down", device: "Unbekannt" })!;
  assertEquals(matchDevice(none, devices), null);
  const ambiguous = buildEvent({}, { status: "Down", device: "Twin" })!;
  assertEquals(
    matchDevice(ambiguous, [
      { ...devices[2], assetId: "t1", name: "Twin" },
      { ...devices[2], assetId: "t2", name: "Twin" },
    ]),
    null,
  );
});

Deno.test("subject and description carry the PRTG fields", () => {
  const event = buildEvent(
    {},
    {
      status: "Down",
      device: "Core-Switch",
      sensor: "Ping",
      message: "Zeitüberschreitung",
      group: "Netzwerk",
    },
  )!;
  assertEquals(ticketSubject(event), "PRTG: Core-Switch – Ping Down");
  const description = ticketDescription(event, "Core-Switch");
  assert(description.includes("Meldung: Zeitüberschreitung"));
  assert(description.includes("Gruppe: Netzwerk"));
  assert(ticketSubject({ ...event, device: "x".repeat(400) }).length <= 240);
});

Deno.test("comments on open alerts are throttled to 15 minutes", () => {
  const openedAt = "2026-11-07T10:00:00.000Z";
  const base = Date.parse(openedAt);
  assertEquals(
    shouldComment({
      lastCommentAt: null,
      openedAt,
      previousKind: "down",
      kind: "down",
      now: base + 5 * 60_000,
    }),
    false,
  );
  assertEquals(
    shouldComment({
      lastCommentAt: null,
      openedAt,
      previousKind: "down",
      kind: "down",
      now: base + 15 * 60_000,
    }),
    true,
  );
  assertEquals(
    shouldComment({
      lastCommentAt: openedAt,
      openedAt,
      previousKind: "warning",
      kind: "down",
      now: base + 60_000,
    }),
    true,
  );
});

Deno.test("alerts open on Down, Warning only when configured", () => {
  assertEquals(opensAlert("down", "down"), true);
  assertEquals(opensAlert("warning", "down"), false);
  assertEquals(opensAlert("warning", "down_and_warning"), true);
  assertEquals(opensAlert("up", "down_and_warning"), false);
});

Deno.test("service status never overrides maintenance or worse states", () => {
  assertEquals(targetServiceStatus("down", "operational"), "partial_outage");
  assertEquals(targetServiceStatus("warning", "operational"), "degraded");
  assertEquals(targetServiceStatus("down", "degraded"), "partial_outage");
  assertEquals(targetServiceStatus("warning", "partial_outage"), null);
  assertEquals(targetServiceStatus("down", "maintenance"), null);
  assertEquals(targetServiceStatus("down", "major_outage"), null);
});

Deno.test("clean values drop placeholders and control characters", () => {
  assertEquals(cleanValue("%objid"), null);
  assertEquals(cleanValue(" a\u0001b "), "a b");
  assertEquals(cleanValue(5), "5");
  assertEquals(cleanValue({}), null);
});
