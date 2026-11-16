import { assertEquals } from "jsr:@std/assert@1";
import {
  attachments,
  comparePorts,
  directory,
  normalizeMac,
  parseTopology,
  resolvePort,
  shortName,
  type StoredPort,
} from "./monitoring-topology.ts";

const port = (overrides: Partial<StoredPort>): StoredPort => ({
  port: "1/1/1",
  index: 1,
  alias: null,
  up: true,
  speedMbps: 1000,
  lldpName: null,
  lldpPort: null,
  lldpAddress: null,
  lldpMac: null,
  macs: [],
  macCount: 0,
  ...overrides,
});

const known = directory(
  [
    { assetId: "a-core", name: "DSW01", hostname: "dsw01.muster.local", ipAddress: "10.0.0.2", mac: null, monitored: true },
    { assetId: "a-srv", name: "SRV-PRINT", hostname: null, ipAddress: "10.0.1.55", mac: "aa:bb:cc:00:00:55", monitored: false },
    { assetId: "a-self", name: "ASW01", hostname: null, ipAddress: "10.0.0.11", mac: null, monitored: true },
  ],
  [
    { mac: "aa:bb:cc:00:00:77", address: "10.0.1.77", hostname: "pc-empfang", assetId: null },
  ],
);

Deno.test("normalizeMac accepts common notations", () => {
  assertEquals(normalizeMac("AA-BB-CC-00-11-22"), "aa:bb:cc:00:11:22");
  assertEquals(normalizeMac("aabb.cc00.1122"), "aa:bb:cc:00:11:22");
  assertEquals(normalizeMac("00:00:00:00:00:00"), null);
  assertEquals(normalizeMac("nope"), null);
});

Deno.test("shortName strips the domain and ignores addresses", () => {
  assertEquals(shortName("SW01.muster.local"), "sw01");
  assertEquals(shortName("10.0.0.1"), null);
});

Deno.test("parseTopology cleans the probe result", () => {
  const parsed = parseTopology({
    sysName: " asw01 ",
    ports: [
      { port: "1/1/1", index: 1, up: true, speedMbps: 1000, lldp: { name: "dsw01", port: "1/1/24", address: "10.0.0.2", mac: "AA-BB-CC-00-00-01" }, macs: [], macCount: 0 },
      { port: "1/1/1", index: 9 },
      { port: "1/1/2", macs: ["aa:bb:cc:00:00:77", "bad"], macCount: 0, up: "yes" },
      { nope: true },
    ],
  });
  assertEquals(parsed.sysName, "asw01");
  assertEquals(parsed.ports.length, 2);
  assertEquals(parsed.ports[0]!.lldpMac, "aa:bb:cc:00:00:01");
  assertEquals(parsed.ports[1]!.macs, ["aa:bb:cc:00:00:77"]);
  assertEquals(parsed.ports[1]!.macCount, 1);
  assertEquals(parsed.ports[1]!.up, null);
});

Deno.test("LLDP neighbour is matched by address, then by name", () => {
  const byAddress = resolvePort(port({ lldpName: "something", lldpAddress: "10.0.0.2", lldpPort: "1/1/24" }), known, "a-self");
  assertEquals(byAddress.link, {
    source: "lldp", name: "DSW01", port: "1/1/24", address: "10.0.0.2", mac: null, assetId: "a-core", monitored: true,
  });
  const byName = resolvePort(port({ lldpName: "DSW01.muster.local" }), known, "a-self");
  assertEquals(byName.link?.assetId, "a-core");
  const unknown = resolvePort(port({ lldpName: "ap-lobby" }), known, "a-self");
  assertEquals(unknown.link?.name, "ap-lobby");
  assertEquals(unknown.link?.assetId, null);
});

Deno.test("MAC table: access port resolves, trunk port does not", () => {
  const device = resolvePort(port({ macs: ["aa:bb:cc:00:00:55"], macCount: 1 }), known, "a-self");
  assertEquals(device.link?.name, "SRV-PRINT");
  assertEquals(device.link?.assetId, "a-srv");
  const address = resolvePort(port({ macs: ["aa:bb:cc:00:00:77"], macCount: 1 }), known, "a-self");
  assertEquals(address.link?.name, "pc-empfang");
  assertEquals(address.link?.address, "10.0.1.77");
  const bare = resolvePort(port({ macs: ["aa:bb:cc:00:00:99"], macCount: 1 }), known, "a-self");
  assertEquals(bare.link?.name, "aa:bb:cc:00:00:99");
  const trunk = resolvePort(port({ macs: ["aa:bb:cc:00:00:55"], macCount: 40 }), known, "a-self");
  assertEquals(trunk.link, null);
  assertEquals(trunk.deviceCount, 40);
});

Deno.test("attachments: where a device hangs", () => {
  const rows = [
    { ...port({ port: "1/1/7", macs: ["aa:bb:cc:00:00:55"], macCount: 1 }), assetId: "a-self" },
    { ...port({ port: "1/1/24", macs: ["aa:bb:cc:00:00:55"], macCount: 60 }), assetId: "a-core" },
  ];
  const result = attachments(rows, {
    assetId: "a-srv", name: "SRV-PRINT", hostname: null, ipAddress: "10.0.1.55", macs: ["aa:bb:cc:00:00:55"],
  }, known);
  assertEquals(result, [{ assetId: "a-self", name: "ASW01", port: "1/1/7", source: "mac", monitored: true }]);
});

Deno.test("comparePorts sorts naturally", () => {
  assertEquals(["1/1/10", "1/1/2", "1/1/1"].sort(comparePorts), ["1/1/1", "1/1/2", "1/1/10"]);
});
