import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  cidrCapacity,
  cidrLast,
  cidrRelation,
  compareAddressText,
  compareCidrText,
  containingPrefix,
  formatAddress,
  formatCidr,
  formatCount,
  ipv4Netmask,
  isGridPrefix,
  listAddresses,
  nestPrefixes,
  normalizeAddress,
  normalizeCidr,
  normalizeMac,
  parseAddress,
  parseCidr,
  parseCidrInput,
  splitCidr,
  usableRange,
  utilizationPercent,
} from "./ipam-cidr.ts";

Deno.test("parses and formats IPv4 addresses", () => {
  assertEquals(parseAddress("10.20.30.1"), { version: 4, value: 0x0a141e01n });
  assertEquals(parseAddress("256.1.1.1"), null);
  assertEquals(parseAddress("10.020.1.1"), null);
  assertEquals(parseAddress("10.1.1"), null);
  assertEquals(formatAddress({ version: 4, value: 0xc0a80001n }), "192.168.0.1");
});

Deno.test("parses and formats IPv6 addresses (RFC 5952)", () => {
  const value = parseAddress("FD12:3456:789A:0:0:0:0:1");
  assert(value);
  assertEquals(formatAddress(value), "fd12:3456:789a::1");
  assertEquals(normalizeAddress("2001:db8:0:0:1:0:0:1"), "2001:db8::1:0:0:1");
  assertEquals(normalizeAddress("::"), "::");
  assertEquals(normalizeAddress("::ffff:10.0.0.1"), "::ffff:a00:1");
  assertEquals(normalizeAddress("2001:db8::1/128"), "2001:db8::1");
  assertEquals(normalizeAddress("10.0.0.1/32"), "10.0.0.1");
  assertEquals(normalizeAddress("10.0.0.1/24"), null);
  assertEquals(parseAddress("1::2::3"), null);
  assertEquals(parseAddress("fe80::1%eth0"), null);
  assertEquals(parseAddress("1:2:3:4:5:6:7:8:9"), null);
});

Deno.test("parses prefixes and flags host bits", () => {
  assertEquals(normalizeCidr("10.20.30.0/24"), "10.20.30.0/24");
  assertEquals(normalizeCidr("10.20.30.5/24"), null);
  assertEquals(parseCidrInput("10.20.30.5/24")?.hostBitsSet, true);
  assertEquals(formatCidr(parseCidrInput("10.20.30.5/24")!.cidr), "10.20.30.0/24");
  assertEquals(normalizeCidr("fd12:3456:789a::/48"), "fd12:3456:789a::/48");
  assertEquals(normalizeCidr("10.0.0.0/33"), null);
  assertEquals(normalizeCidr("10.0.0.1"), "10.0.0.1/32");
  assertEquals(normalizeCidr("0.0.0.0/0"), "0.0.0.0/0");
});

Deno.test("capacity matches the SQL rules", () => {
  assertEquals(cidrCapacity(parseCidr("10.0.0.0/24")!), 254n);
  assertEquals(cidrCapacity(parseCidr("10.0.0.0/31")!), 2n);
  assertEquals(cidrCapacity(parseCidr("10.0.0.0/32")!), 1n);
  assertEquals(cidrCapacity(parseCidr("fd00::/64")!), 1n << 64n);
  const range = usableRange(parseCidr("10.0.0.0/24")!);
  assertEquals(formatAddress({ version: 4, value: range.first }), "10.0.0.1");
  assertEquals(formatAddress({ version: 4, value: range.last }), "10.0.0.254");
  assertEquals(formatAddress({ version: 4, value: cidrLast(parseCidr("10.0.0.0/22")!) }), "10.0.3.255");
});

Deno.test("relations: nesting, equal, disjoint", () => {
  const parent = parseCidr("10.20.0.0/16")!;
  const child = parseCidr("10.20.30.0/24")!;
  const other = parseCidr("10.30.0.0/16")!;
  assertEquals(cidrRelation(parent, child), "contains");
  assertEquals(cidrRelation(child, parent), "within");
  assertEquals(cidrRelation(parent, parent), "equal");
  assertEquals(cidrRelation(parent, other), "disjoint");
  assertEquals(cidrRelation(parent, parseCidr("fd00::/8")!), "disjoint");
});

Deno.test("lists grid addresses and splits prefixes", () => {
  const list = listAddresses(parseCidr("10.0.0.0/24")!);
  assertEquals(list?.length, 256);
  assertEquals(formatAddress(list![255]!), "10.0.0.255");
  assertEquals(listAddresses(parseCidr("10.0.0.0/16")!), null);
  assertEquals(isGridPrefix(parseCidr("10.0.0.0/22")!), true);
  assertEquals(isGridPrefix(parseCidr("10.0.0.0/21")!), false);
  assertEquals(isGridPrefix(parseCidr("fd00::/120")!), false);
  assertEquals(
    splitCidr(parseCidr("10.20.0.0/23")!, 24)?.map(formatCidr),
    ["10.20.0.0/24", "10.20.1.0/24"],
  );
  assertEquals(splitCidr(parseCidr("10.0.0.0/8")!, 24), null);
  assertEquals(splitCidr(parseCidr("10.0.0.0/24")!, 24), null);
  assertEquals(splitCidr(parseCidr("fd00::/48")!, 50)?.map(formatCidr), [
    "fd00::/50",
    "fd00:0:0:4000::/50",
    "fd00:0:0:8000::/50",
    "fd00:0:0:c000::/50",
  ]);
});

Deno.test("sorts addresses and prefixes numerically", () => {
  assertEquals(
    ["10.0.0.10", "fd00::1", "10.0.0.9", "x"].sort(compareAddressText),
    ["10.0.0.9", "10.0.0.10", "fd00::1", "x"],
  );
  assertEquals(
    ["10.20.30.0/24", "10.20.0.0/16", "10.3.0.0/16"].sort(compareCidrText),
    ["10.3.0.0/16", "10.20.0.0/16", "10.20.30.0/24"],
  );
});

Deno.test("nests prefixes per VRF and finds the containing prefix", () => {
  const items = [
    { id: "c", prefix: "10.20.30.0/24", vrfId: null },
    { id: "a", prefix: "10.20.0.0/16", vrfId: null },
    { id: "d", prefix: "10.30.0.0/16", vrfId: null },
    { id: "g", prefix: "10.20.30.0/24", vrfId: "guest" },
    { id: "b", prefix: "10.20.30.128/25", vrfId: null },
  ];
  assertEquals(
    nestPrefixes(items).map((entry) => [entry.item.id, entry.parentId, entry.depth]),
    [
      ["a", null, 0],
      ["c", "a", 1],
      ["b", "c", 2],
      ["d", null, 0],
      ["g", null, 0],
    ],
  );
  assertEquals(containingPrefix(items.slice(0, 3), "10.20.30.200")?.id, "c");
  assertEquals(containingPrefix(items, "192.168.1.1"), null);
});

Deno.test("formats helpers", () => {
  assertEquals(ipv4Netmask(24), "255.255.255.0");
  assertEquals(ipv4Netmask(0), "0.0.0.0");
  assertEquals(normalizeMac("00-1E-0B-7A-41-C9"), "00:1e:0b:7a:41:c9");
  assertEquals(normalizeMac("001e.0b7a.41c9"), "00:1e:0b:7a:41:c9");
  assertEquals(normalizeMac("00:1E:0B:7A:41"), null);
  assertEquals(formatCount(1842n), "1’842");
  assertEquals(formatCount(1n << 64n), "2^64");
  assertEquals(utilizationPercent(112n, 254n), 44);
  assertEquals(utilizationPercent(5n, 0n), 0);
});
