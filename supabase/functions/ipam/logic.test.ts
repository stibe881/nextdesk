import { msg } from "../_shared/formality.ts";
import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  changedFields,
  csvCell,
  csvDocument,
  forecastUtilization,
  InputError,
  parseAction,
  parseAddressInput,
  parseCustomFields,
  parsePrefix,
  READ_ACTIONS,
  sophosCsv,
  sophosName,
  sophosObjects,
  sophosXml,
  textMentionsAddress,
} from "./logic.ts";

const TENANT = "10000000-0000-4000-8000-000000000001";
const PREFIX = "20000000-0000-4000-8000-000000000002";

Deno.test("parses read and write actions", () => {
  assertEquals(parseAction({ type: "overview", tenantId: TENANT }), { type: "overview", tenantId: TENANT });
  assertEquals(parseAction({ type: "nextFreePrefix", tenantId: TENANT, parentId: PREFIX, length: "24" }), {
    type: "nextFreePrefix",
    tenantId: TENANT,
    parentId: PREFIX,
    length: 24,
  });
  const reserve = parseAction({
    type: "reserveAddress",
    tenantId: TENANT,
    reservation: { prefixId: PREFIX, address: " 10.20.30.47 ", hostname: "DRU-A2", reservedUntil: "2026-12-31" },
  });
  assert(reserve.type === "reserveAddress");
  assertEquals(reserve.reservation.address, "10.20.30.47");
  assertEquals(reserve.reservation.reservedUntil, "2026-12-31");
  assertEquals(
    parseAction({ type: "exportSophos", tenantId: TENANT }),
    { type: "exportSophos", tenantId: TENANT, format: "xml", prefixIds: null, includeHosts: true, includeGroups: true },
  );
  assertThrows(() => parseAction({ type: "overview", tenantId: "x" }), InputError);
  assertThrows(() => parseAction({ type: "nope", tenantId: TENANT }), InputError);
  assert(READ_ACTIONS.has("networkMapOverlay"));
  assert(!READ_ACTIONS.has("reserveAddress"));
});

Deno.test("validates prefixes, gateway and DHCP range", () => {
  const prefix = parsePrefix({
    prefix: "10.20.30.0/24",
    gateway: "10.20.30.1",
    dhcpStart: "10.20.30.100",
    dhcpEnd: "10.20.30.199",
    tags: ["Clients", "Clients"],
  });
  assertEquals(prefix.prefix, "10.20.30.0/24");
  assertEquals(prefix.status, "active");
  assertEquals(prefix.utilizationWarningPercent, 85);
  assertEquals(prefix.tags, ["Clients"]);
  const message = (input: Record<string, unknown>) => {
    try {
      parsePrefix(input);
      return null;
    } catch (error) {
      return (error as Error).message;
    }
  };
  assertEquals(message({ prefix: "10.20.30.5/24" }), msg("«10.20.30.5/24» ist keine Netzadresse. Meintest du 10.20.30.0/24?", "«10.20.30.5/24» ist keine Netzadresse. Meinten Sie 10.20.30.0/24?"));
  assertEquals(message({ prefix: "10.20.30.0" }), msg("Bitte gib die Präfixlänge an (z. B. 10.20.30.0/24).", "Bitte geben Sie die Präfixlänge an (z. B. 10.20.30.0/24)."));
  assert(message({ prefix: "10.20.30.0/24", gateway: "10.20.31.1" })?.includes("liegt nicht im Subnetz"));
  assert(message({ prefix: "10.20.30.0/24", dhcpStart: "10.20.30.10" })?.includes("Beginn und Ende"));
  assert(message({ prefix: "10.20.30.0/24", dhcpStart: "10.20.30.20", dhcpEnd: "10.20.30.10" })?.includes("nach dessen Ende"));
  assert(
    message({ prefix: "10.20.30.0/24", gateway: "10.20.30.15", dhcpStart: "10.20.30.10", dhcpEnd: "10.20.30.20" })
      ?.includes("im DHCP-Bereich"),
  );
  assert(message({ prefix: "10.0.0.0/24", utilizationWarningPercent: 40 })?.includes("Warnschwelle"));
  assertEquals(parsePrefix({ prefix: "FD12:3456:789A::/48" }).prefix, "fd12:3456:789a::/48");
});

Deno.test("validates address input and own fields", () => {
  const address = parseAddressInput({
    address: "10.20.30.21",
    macAddress: "00-1E-0B-7A-41-C9",
    deviceType: "printer",
    customFields: { "Inventarnr.": "INV-2024-118", leer: "" },
  });
  assertEquals(address.macAddress, "00:1e:0b:7a:41:c9");
  assertEquals(address.customFields, { "Inventarnr.": "INV-2024-118" });
  assertThrows(() => parseAddressInput({ address: "10.20.30.300" }), InputError);
  assertThrows(() => parseAddressInput({ address: "10.0.0.1", macAddress: "zz" }), InputError);
  assertThrows(() => parseAddressInput({ address: "10.0.0.1", deviceType: "toaster" }), InputError);
  assertThrows(() => parseCustomFields({ x: "a".repeat(501) }), InputError);
});

Deno.test("forecast: linear trend reaches warning and full", () => {
  const points = Array.from({ length: 10 }, (_, index) => ({
    day: `2026-10-${String(index + 1).padStart(2, "0")}`,
    used: 100 + index * 2,
    total: 254,
  }));
  const forecast = forecastUtilization(points, 85);
  assertEquals(forecast.perDay, 2);
  // 85 % of 254 = 215.9 → day index 58 (2026-10-01 + 58 days).
  assertEquals(forecast.warningOn, "2026-11-28");
  assertEquals(forecast.fullOn, "2026-12-17");
  assertEquals(forecastUtilization(points.slice(0, 3), 85).warningOn, null);
  const flat = points.map((point) => ({ ...point, used: 120 }));
  assertEquals(forecastUtilization(flat, 85).fullOn, null);
  const full = points.map((point) => ({ ...point, used: 254 }));
  assertEquals(forecastUtilization(full, 85).fullOn, "2026-10-10");
});

Deno.test("csv cells are quoted and protected against formulas", () => {
  assertEquals(csvCell("a;b"), '"a;b"');
  assertEquals(csvCell('Sag "Hallo"'), '"Sag ""Hallo"""');
  assertEquals(csvCell("=HYPERLINK()"), "'=HYPERLINK()");
  assertEquals(csvCell("-5"), "-5");
  assertEquals(csvCell(["a", "b"]), '"a, b"');
  assertEquals(csvDocument(["A"], [[1]]), "﻿A\r\n1\r\n");
});

Deno.test("sophos export: names, networks, hosts, groups", () => {
  assertEquals(sophosName("Drucker Haus Ä/2 <test>"), "Drucker Haus Ae_2 _test");
  assertEquals(sophosName("///"), "Objekt");
  const objects = sophosObjects(
    [
      { id: "p1", prefix: "10.20.30.0/24", description: "Clients Haus A", vlanNumber: 30 },
      { id: "p2", prefix: "fd12:3456:789a::/48", description: null, vlanNumber: null },
    ],
    [
      { prefixId: "p1", address: "10.20.30.21", hostname: "DRU-A2-KOPIE", description: "Kopierer" },
      { prefixId: "p1", address: "10.20.30.22", hostname: "DRU-A2-KOPIE", description: null },
    ],
    { includeHosts: true, includeGroups: true },
  );
  assertEquals(objects.map((object) => object.name), [
    "NET_Clients Haus A",
    "NET_fd12_3456_789a_48",
    "H_DRU-A2-KOPIE",
    "H_DRU-A2-KOPIE_2",
    "GRP_Clients Haus A",
  ]);
  const xml = sophosXml(objects);
  assert(xml.includes("<HostType>Network</HostType>\n    <IPAddress>10.20.30.0</IPAddress>\n    <Subnet>255.255.255.0</Subnet>"));
  assert(xml.includes("<Subnet>48</Subnet>"));
  assert(xml.includes("<HostType>IP</HostType>\n    <IPAddress>10.20.30.21</IPAddress>"));
  assert(xml.includes("<Host>H_DRU-A2-KOPIE_2</Host>"));
  assert(xml.indexOf("<IPHostGroup") > xml.lastIndexOf("<IPHost "));
  const csv = sophosCsv(objects);
  assert(csv.includes("GRP_Clients Haus A;HostGroup;IPv4;;;\"H_DRU-A2-KOPIE, H_DRU-A2-KOPIE_2\""));
  assertEquals(
    sophosObjects([{ id: "p1", prefix: "10.0.0.0/24", description: null, vlanNumber: null }], [], {
      includeHosts: false,
      includeGroups: true,
    }).length,
    1,
  );
});

Deno.test("ticket text mentions an address only as a whole word", () => {
  assert(textMentionsAddress("Drucker 10.20.30.21 druckt nicht", "10.20.30.21"));
  assert(textMentionsAddress("IP: 10.20.30.21.", "10.20.30.21"));
  assert(!textMentionsAddress("Drucker 10.20.30.211", "10.20.30.21"));
  assert(!textMentionsAddress("110.20.30.21", "10.20.30.21"));
  assert(textMentionsAddress("Server fd00::1 down", "fd00::1"));
  assert(!textMentionsAddress("Server fd00::12", "fd00::1"));
});

Deno.test("changed fields for the history", () => {
  assertEquals(
    changedFields({ hostname: "a", tags: ["x"], status: "active" }, { hostname: "b", tags: ["x"], status: "active" }),
    { hostname: { from: "a", to: "b" } },
  );
});
