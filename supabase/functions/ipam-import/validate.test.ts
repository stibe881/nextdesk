import { assertEquals } from "jsr:@std/assert@1";

import {
  changedFields,
  containingPrefix,
  formatCidr,
  matchUplink,
  MAX_ROWS,
  normalizeAddress,
  normalizeMac,
  parseCidr,
  parseRequest,
  validateRows,
} from "./validate.ts";

const tenantId = "00000000-0000-4000-8000-000000000001";

Deno.test("addresses and prefixes are normalized", () => {
  assertEquals(normalizeAddress("10.0.0.8"), "10.0.0.8");
  assertEquals(normalizeAddress("10.0.0.8/32"), "10.0.0.8");
  assertEquals(normalizeAddress("10.0.0.8/24"), null);
  assertEquals(normalizeAddress("10.0.0.256"), null);
  assertEquals(normalizeAddress("2001:DB8:0:0::1"), "2001:db8::1");
  assertEquals(formatCidr(parseCidr("192.0.2.0/24")!), "192.0.2.0/24");
  assertEquals(parseCidr("192.0.2.5/24")!.hostBits, true);
  assertEquals(parseCidr("192.0.2.0"), null);
  assertEquals(normalizeMac("482F6BCF52A8"), "48:2f:6b:cf:52:a8");
  assertEquals(normalizeMac("48-2f-6b-cf-52-a8"), "48:2f:6b:cf:52:a8");
  assertEquals(normalizeMac("nope"), null);
});

Deno.test("most specific prefix contains the address", () => {
  const prefixes = [
    { prefix: "10.0.0.0/8", id: 1 },
    { prefix: "10.1.0.0/16", id: 2 },
    { prefix: "10.1.2.0/24", id: 3 },
  ];
  assertEquals(containingPrefix(prefixes, "10.1.2.9")?.id, 3);
  assertEquals(containingPrefix(prefixes, "10.9.0.1")?.id, 1);
  assertEquals(containingPrefix(prefixes, "192.0.2.1"), null);
});

Deno.test("request needs tenant, action, kind and 1–500 rows", () => {
  assertEquals(parseRequest({ action: "context", tenantId })?.type, "context");
  assertEquals(
    parseRequest({ action: "apply", tenantId, kind: "prefixes", rows: [] }),
    null,
  );
  assertEquals(
    parseRequest({ action: "apply", tenantId, kind: "racks", rows: [{}] }),
    null,
  );
  assertEquals(
    parseRequest({
      action: "apply",
      tenantId,
      kind: "sites",
      rows: Array(MAX_ROWS + 1).fill({}),
    }),
    null,
  );
  assertEquals(
    parseRequest({
      action: "apply",
      tenantId,
      kind: "sites",
      rows: [{}],
      options: { vrfId: "x" },
    }),
    null,
  );
  const parsed = parseRequest({
    action: "preview",
    tenantId,
    kind: "addresses",
    rows: [{ key: "a" }],
    options: { mode: "skip", createLocations: true },
    source: "netbox",
  });
  assertEquals(parsed?.type, "preview");
  if (parsed && parsed.type !== "context") {
    assertEquals(parsed.options, {
      vrfId: null,
      departmentId: null,
      mode: "skip",
      createLocations: true,
    });
    assertEquals(parsed.source, "netbox");
  }
});

Deno.test("prefix rows: gateway and DHCP range must lie inside", () => {
  const { valid, failures } = validateRows("prefixes", [
    {
      key: "p1",
      prefix: "192.0.2.0/24",
      status: "active",
      gateway: "192.0.2.1",
      dhcpStart: "192.0.2.100",
      dhcpEnd: "192.0.2.199",
      tags: ["Alt"],
    },
    { key: "p2", prefix: "192.0.2.0/24", gateway: "198.51.100.1" },
    { key: "p3", prefix: "192.0.2.7/24" },
    { key: "p4", prefix: "198.51.100.0/24", dhcpStart: "198.51.100.10" },
    { key: "p5", prefix: "198.51.100.0/24", status: "unknown" },
    { key: "p1", prefix: "203.0.113.0/24" },
  ]);
  assertEquals(
    valid.map((row) => row.key),
    ["p1"],
  );
  assertEquals(valid[0]!.tags, ["alt"]);
  assertEquals(
    failures.map((failure) => failure.key),
    ["p2", "p3", "p4", "p5", "p1"],
  );
});

Deno.test("address and device rows are validated", () => {
  const addresses = validateRows("addresses", [
    {
      key: "a1",
      address: "192.0.2.10",
      status: "reserved",
      macAddress: "00:11:22:33:44:55",
      deviceType: "printer",
    },
    { key: "a2", address: "192.0.2.300" },
    { key: "a3", address: "192.0.2.11", deviceType: "toaster" },
    { key: "a4", address: "192.0.2.12", customFields: { "bad key": "x" } },
  ]);
  assertEquals(addresses.valid.length, 1);
  assertEquals(addresses.valid[0]!.macAddress, "00:11:22:33:44:55");
  assertEquals(addresses.failures.length, 3);
  const devices = validateRows("devices", [
    {
      key: "d1",
      name: "AP001",
      category: "access_point",
      macAddress: "001122334455",
      serialNumber: "SN1",
    },
    { key: "d2", name: "", category: "switch" },
    { key: "d3", name: "X", category: "toaster" },
  ]);
  assertEquals(
    devices.valid.map((row) => row.key),
    ["d1"],
  );
  assertEquals(devices.valid[0]!.lifecycleState, "active");
  assertEquals(devices.failures.length, 2);
});

Deno.test("changed fields never clear stored values and merge tags", () => {
  const existing = {
    hostname: "srv1",
    description: "Alt",
    tags: ["a"],
    custom_fields: { x: "1" },
    gateway: "192.0.2.1/32",
  };
  assertEquals(
    changedFields(existing, {
      hostname: null,
      description: "Alt",
      tags: ["a"],
      custom_fields: { x: "1" },
    }),
    {},
  );
  assertEquals(
    changedFields(existing, {
      hostname: "srv2",
      tags: ["b"],
      custom_fields: { y: "2" },
    }),
    { hostname: "srv2", tags: ["a", "b"], custom_fields: { x: "1", y: "2" } },
  );
  assertEquals(
    changedFields(
      existing,
      { gateway: "192.0.2.1" },
      { gateway: (value) => normalizeAddress(String(value)) ?? value },
    ),
    {},
  );
});

Deno.test("uplink text matches a device name", () => {
  const names = new Map([
    ["sw016", "id-16"],
    ["core-1", "id-core"],
  ]);
  assertEquals(matchUplink("WG6 SW016", names), "id-16");
  assertEquals(matchUplink("core-1", names), "id-core");
  assertEquals(matchUplink("SW099", names), null);
  assertEquals(matchUplink(null, names), null);
});
