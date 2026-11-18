import { assert, assertEquals, assertFalse } from "jsr:@std/assert@1";

import {
  type AddressContext,
  agentIdFromToken,
  containsSecret,
  createAgentToken,
  dnsIssues,
  expandIpv6,
  forwardZoneFor,
  isUsefulAddress,
  mergeObservations,
  parseAgentConfig,
  parseContext,
  parseIp,
  parseReport,
  planDnsFindings,
  planObservations,
  relativeName,
  resolveMacLocations,
  reverseName,
  reverseNameToIp,
  reverseZoneFor,
  sameHost,
  sha256Hex,
  timingSafeEqualHex,
  validateJobPayload,
} from "./ipam-discovery.ts";

const AGENT_ID = "6f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f";
const ADDRESS_ID = "11111111-2222-4333-8444-555555555555";
const PREFIX_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

function context(overrides: Partial<AddressContext> & { address: string }): AddressContext {
  return {
    addressId: null,
    status: null,
    mac: null,
    hostname: null,
    vendor: null,
    switchName: null,
    switchPort: null,
    lastSeenAt: null,
    prefixId: PREFIX_ID,
    inDhcpRange: false,
    lease: null,
    observation: null,
    ...overrides,
  };
}

Deno.test("parseIp normalises IPv4 and IPv6 and rejects garbage", () => {
  assertEquals(parseIp("10.20.30.21"), { family: 4, address: "10.20.30.21" });
  assertEquals(parseIp("10.20.30.21/32"), { family: 4, address: "10.20.30.21" });
  assertEquals(parseIp("FD12:3456:789A:0:0:0:0:1"), { family: 6, address: "fd12:3456:789a::1" });
  assertEquals(parseIp("010.1.1.1"), null);
  assertEquals(parseIp("256.1.1.1"), null);
  assertEquals(parseIp("fe80::1%eth0"), null);
  assertEquals(parseIp("dru-01"), null);
  assertEquals(expandIpv6("fd12::1"), "fd120000000000000000000000000001");
  assertFalse(isUsefulAddress(parseIp("169.254.1.2")!));
  assertFalse(isUsefulAddress(parseIp("224.0.0.251")!));
  assertFalse(isUsefulAddress(parseIp("fe80::1")!));
  assert(isUsefulAddress(parseIp("fd12::1")!));
});

Deno.test("reverse names and zones", () => {
  assertEquals(reverseName("10.20.30.21"), "21.30.20.10.in-addr.arpa");
  assertEquals(reverseNameToIp("21.30.20.10.in-addr.arpa."), "10.20.30.21");
  const v6 = reverseName("fd12::1")!;
  assert(v6.endsWith(".ip6.arpa"));
  assertEquals(reverseNameToIp(v6), "fd12::1");
  assertEquals(reverseNameToIp("30.20.10.in-addr.arpa"), null);
  const zones = ["10.in-addr.arpa", "30.20.10.in-addr.arpa", "schule.local"];
  assertEquals(reverseZoneFor("10.20.30.21", zones), "30.20.10.in-addr.arpa");
  assertEquals(reverseZoneFor("10.99.1.1", zones), "10.in-addr.arpa");
  assertEquals(reverseZoneFor("192.0.2.1", zones), null);
  assertEquals(forwardZoneFor("dru-01.haus-a.schule.local", ["schule.local", "haus-a.schule.local"]), "haus-a.schule.local");
  assertEquals(relativeName("dru-01.schule.local", "schule.local"), "dru-01");
  assertEquals(relativeName("21.30.20.10.in-addr.arpa", "30.20.10.in-addr.arpa"), "21");
  assert(sameHost("DRU-01", "dru-01.schule.local."));
  assertFalse(sameHost("dru-01.a.local", "dru-01.b.local"));
});

Deno.test("agent tokens carry the agent id and compare in constant time", async () => {
  const token = createAgentToken(AGENT_ID);
  assert(token.startsWith("ndip_6f1c2d3e4a5b4c6d8e9f0a1b2c3d4e5f_"));
  assertEquals(agentIdFromToken(token), AGENT_ID);
  assertEquals(agentIdFromToken("ndip_xyz"), null);
  const hash = await sha256Hex(token);
  assert(timingSafeEqualHex(hash, await sha256Hex(token)));
  assertFalse(timingSafeEqualHex(hash, await sha256Hex(`${token}x`)));
  assertFalse(timingSafeEqualHex(hash, hash.slice(1)));
});

Deno.test("agent config rejects credentials and validates targets", () => {
  assert(containsSecret({ snmpTargets: [{ host: "sw1", community: "public" }] }));
  const secret = parseAgentConfig({ snmpTargets: [{ host: "sw1", version: "v3", user: "nd", authKey: "x" }] });
  assertEquals(secret, { ok: false, code: "config_contains_secret" });
  const result = parseAgentConfig({
    scanAllActive: false,
    prefixIds: [PREFIX_ID],
    scheduleMinutes: 30,
    snmpTargets: [
      { host: "SOBE-BAAR-CSW01.schule.local", version: "v3", user: "nextdesk-ro", authProtocol: "sha256", privProtocol: "aes" },
      { host: "192.0.2.201", version: "v2c" },
    ],
    dhcpServers: ["dc01.schule.local"],
    dnsServers: ["dc01.schule.local"],
    dnsZones: ["schule.local", "30.20.10.in-addr.arpa"],
  });
  assert(result.ok);
  if (result.ok) {
    assertEquals(result.config.snmpTargets[0].host, "sobe-baar-csw01.schule.local");
    assertEquals(result.config.snmpTargets[1].user, null);
    assertEquals(result.config.allowWrites, false);
    assertEquals(result.config.scheduleMinutes, 30);
  }
  assertEquals(parseAgentConfig({ scheduleMinutes: 1 }), { ok: false, code: "config_schedule_invalid" });
  assertEquals(
    parseAgentConfig({ snmpTargets: [{ host: "sw1", version: "v3", user: "x", privProtocol: "aes" }] }),
    { ok: false, code: "config_snmp_protocol_invalid" },
  );
  assertEquals(parseAgentConfig({ dhcpServers: ["bad host!"] }), { ok: false, code: "config_servers_invalid" });
});

Deno.test("parseReport validates and skips unusable entries", () => {
  const result = parseReport({
    run: { key: "2026-11-11T08:00:00Z-1", trigger: "schedule", final: true, stats: { pinged: 254, bad: "x" } },
    observations: [
      { address: "10.20.30.21", mac: "00-1e-0b-7a-41-c9", source: "arp" },
      { address: "10.20.30.255", source: "telepathy" },
      { address: "fe80::1", source: "ndp" },
    ],
    macTable: [{ switchName: "SW-A2-01", port: "1/1/14", mac: "001e.0b7a.41c9", vlan: 30 }, { mac: "x" }],
    dhcp: [{
      server: "dc01.schule.local",
      scopes: [{ scopeId: "10.20.30.0", subnetMask: "255.255.255.0", inUse: 80, free: 20 }],
      leases: [
        { scopeId: "10.20.30.0", address: "10.20.30.150", clientId: "aa-bb-cc-00-00-01", state: "Active", expiresAt: "2026-11-12T08:00:00Z" },
        { scopeId: "10.20.30.0", address: "10.20.30.20", clientId: "aa-bb-cc-00-00-02", state: "ActiveReservation" },
        { scopeId: "10.99.0.0", address: "10.99.0.5" },
      ],
    }],
    dns: [{
      server: "dc01.schule.local",
      zone: "schule.local",
      records: [
        { name: "DRU-A2-KOPIE", type: "A", value: "10.20.30.21", ttl: 3600 },
        { name: "@", type: "A", value: "10.20.10.5" },
        { name: "www", type: "CNAME", value: "web01.schule.local." },
        { name: "bad", type: "A", value: "fd12::1" },
      ],
    }, {
      server: "dc01.schule.local",
      zone: "30.20.10.in-addr.arpa",
      records: [{ name: "21", type: "PTR", value: "dru-a2-kopie.schule.local." }],
    }],
  });
  assert(result.ok);
  if (!result.ok) return;
  const report = result.report;
  assertEquals(report.run.final, true);
  assertEquals(report.run.stats, { pinged: 254 });
  assertEquals(report.observations.length, 1);
  assertEquals(report.observations[0].mac, "00:1e:0b:7a:41:c9");
  assertEquals(report.macTable.length, 1);
  assertEquals(report.dhcp[0].leases.length, 2);
  assertEquals(report.dhcp[0].leases[0].mac, "aa:bb:cc:00:00:01");
  assertEquals(report.dhcp[0].leases[1].reservation, true);
  assertEquals(report.dns[0].records.map((record) => record.name), [
    "dru-a2-kopie.schule.local",
    "schule.local",
    "www.schule.local",
  ]);
  assertEquals(report.dns[1].records[0].address, "10.20.30.21");
  assertEquals(report.dns[1].records[0].value, "dru-a2-kopie.schule.local");
  assertEquals(report.skipped, 5);

  assertEquals(parseReport({ run: { key: "bad key!" } }), { ok: false, code: "invalid_run" });
  assertEquals(
    parseReport({ run: { key: "r1" }, observations: new Array(5001).fill({}) }),
    { ok: false, code: "too_many_observations" },
  );
});

Deno.test("resolveMacLocations ignores uplinks and prefers LLDP", () => {
  const macTable = [
    // Printer on an access port of SW-A2-01, also learned on the core uplink.
    { switchName: "SW-A2-01", port: "1/1/14", mac: "00:1e:0b:7a:41:c9", vlan: 30 },
    { switchName: "CORE", port: "1/1/48", mac: "00:1e:0b:7a:41:c9", vlan: 30 },
    { switchName: "SW-A2-01", port: "1/1/49", mac: "00:1e:0b:7a:41:c9", vlan: 30 },
    // Wireless client behind an access point.
    { switchName: "SW-A2-01", port: "1/1/22", mac: "f0:9f:c2:11:08:3a", vlan: 30 },
    { switchName: "SW-A2-01", port: "1/1/22", mac: "aa:aa:aa:00:00:01", vlan: 60 },
  ];
  const lldp = [
    { switchName: "SW-A2-01", localPort: "1/1/49", chassisMac: "88:3a:30:00:00:01", sysName: "CORE", portId: "1/1/48", mgmtAddress: null, capabilities: ["bridge", "router"] },
    { switchName: "CORE", localPort: "1/1/48", chassisMac: "88:3a:30:00:00:02", sysName: "SW-A2-01", portId: "1/1/49", mgmtAddress: "10.20.0.11", capabilities: ["bridge"] },
    { switchName: "SW-A2-01", localPort: "1/1/22", chassisMac: "20:4c:03:00:00:01", sysName: "AP-A2-02", portId: "eth0", mgmtAddress: "10.20.30.22", capabilities: ["bridge", "wlanAccessPoint"] },
  ];
  const { locations, ipHints } = resolveMacLocations(macTable, lldp);
  const byMac = new Map(locations.map((location) => [location.mac, location]));
  assertEquals(byMac.get("00:1e:0b:7a:41:c9")?.switchPort, "1/1/14");
  assertEquals(byMac.get("00:1e:0b:7a:41:c9")?.switchName, "SW-A2-01");
  assertEquals(byMac.get("f0:9f:c2:11:08:3a")?.switchPort, "1/1/22");
  assertEquals(byMac.get("20:4c:03:00:00:01")?.source, "lldp");
  assertFalse(byMac.has("88:3a:30:00:00:02"));
  assertEquals(ipHints, [{ address: "10.20.30.22", switchName: "SW-A2-01", switchPort: "1/1/22", hostname: "ap-a2-02" }]);

  // Ports with many MACs and no LLDP neighbour count as uplinks.
  const busy = Array.from({ length: 60 }, (_, index) => ({
    switchName: "OLD-PROCURVE",
    port: "A24",
    mac: `02:00:00:00:00:${index.toString(16).padStart(2, "0")}`,
    vlan: null,
  }));
  assertEquals(resolveMacLocations(busy, []).locations.length, 0);
});

Deno.test("planObservations: ghost, foreign MAC, conflict, outside prefix", () => {
  const observations = mergeObservations(
    [
      { address: "10.20.30.22", family: 4, mac: "f0:9f:c2:11:08:3a", source: "arp", hostname: null, vendor: null, vrfId: null, switchName: null, switchPort: null, vlan: null },
      { address: "10.20.30.22", family: 4, mac: null, source: "ping", hostname: null, vendor: null, vrfId: null, switchName: null, switchPort: null, vlan: null },
      { address: "10.20.30.23", family: 4, mac: "02:11:22:33:44:55", source: "arp", hostname: "vm-test-77", vendor: null, vrfId: null, switchName: null, switchPort: null, vlan: null },
      { address: "10.20.30.150", family: 4, mac: "00:50:56:00:00:01", source: "arp", hostname: null, vendor: null, vrfId: null, switchName: null, switchPort: null, vlan: null },
      { address: "10.20.30.40", family: 4, mac: "00:15:5d:00:00:01", source: "arp", hostname: null, vendor: null, vrfId: null, switchName: null, switchPort: null, vlan: null },
      { address: "10.20.30.40", family: 4, mac: "00:15:5d:00:00:02", source: "snmp", hostname: null, vendor: null, vrfId: null, switchName: null, switchPort: null, vlan: null },
      { address: "192.0.2.9", family: 4, mac: null, source: "ping", hostname: null, vendor: null, vrfId: null, switchName: null, switchPort: null, vlan: null },
    ],
  );
  assertEquals(observations.find((item) => item.address === "10.20.30.22")?.sources, ["ping", "arp"]);
  const plan = planObservations({
    vrfId: null,
    runKey: "run-1",
    observations,
    contexts: [
      context({ address: "10.20.30.22", addressId: ADDRESS_ID, status: "reserved", mac: "20:4c:03:00:00:01", hostname: "AP-A2-02", lastSeenAt: "2026-11-01T00:00:00Z" }),
      context({ address: "10.20.30.23" }),
      context({ address: "10.20.30.150", inDhcpRange: true }),
      context({ address: "10.20.30.40" }),
      context({ address: "192.0.2.9", prefixId: null }),
    ],
    macLocations: [{ mac: "f0:9f:c2:11:08:3a", switchName: "SW-A2-01", switchPort: "1/1/22", vlan: 30, source: "fdb" }],
  });
  const opened = plan.open.map((finding) => `${finding.address}:${finding.kind}:${finding.severity}`).sort();
  assertEquals(opened, [
    "10.20.30.22:foreign_mac:critical",
    "10.20.30.23:ghost:warning",
    "10.20.30.40:conflict:critical",
    "10.20.30.40:ghost:warning",
    "192.0.2.9:outside_prefix:info",
  ]);
  const foreign = plan.open.find((finding) => finding.kind === "foreign_mac")!;
  assertEquals(foreign.details.observedMac, "f0:9f:c2:11:08:3a");
  assertEquals(foreign.details.vendor, "Ubiquiti");
  assertEquals(foreign.details.switchPort, "1/1/22");
  // Reserved address keeps its MAC and port; only «last seen» is updated.
  assertEquals(plan.addressUpdates, [{ addressId: ADDRESS_ID, source: "ping,arp" }]);
  const ghost = plan.open.find((finding) => finding.address === "10.20.30.23")!;
  assertEquals(ghost.details.hostname, "vm-test-77");
  assertEquals(ghost.details.vendor, "Private MAC (zufällig)");
  // In the DHCP range → no ghost.
  assert(plan.resolve.some((entry) => entry.address === "10.20.30.150" && entry.kinds.includes("ghost")));
  // Observation row for the reserved address carries the switch port.
  const row = plan.observations.find((entry) => entry.address === "10.20.30.22")!;
  assertEquals(row.switch_port, "1/1/22");
  assertEquals(row.source, "ping");
});

Deno.test("planObservations: first sighting, MAC change on DHCP address, resolves", () => {
  const observations = mergeObservations([
    { address: "10.20.30.21", family: 4, mac: "00:1e:0b:7a:41:c9", source: "arp", hostname: null, vendor: null, vrfId: null, switchName: null, switchPort: null, vlan: null },
    { address: "10.20.30.120", family: 4, mac: "3c:52:82:00:00:02", source: "arp", hostname: null, vendor: null, vrfId: null, switchName: null, switchPort: null, vlan: null },
  ]);
  const plan = planObservations({
    vrfId: null,
    runKey: "run-2",
    observations,
    contexts: [
      context({ address: "10.20.30.21", addressId: ADDRESS_ID, status: "active", hostname: "DRU-A2-KOPIE" }),
      context({
        address: "10.20.30.120",
        addressId: "22222222-2222-4333-8444-555555555555",
        status: "dhcp",
        mac: "3c:52:82:00:00:01",
        lastSeenAt: "2026-11-10T00:00:00Z",
        // Earlier chunk of the same run saw another MAC → conflict.
        observation: { mac: "3c:52:82:00:00:01", runKey: "run-2", runMacs: ["3c:52:82:00:00:01"] },
      }),
    ],
    macLocations: [{ mac: "00:1e:0b:7a:41:c9", switchName: "SW-A2-01", switchPort: "1/1/14", vlan: 30, source: "fdb" }],
  });
  assertEquals(plan.addressUpdates[0], {
    addressId: ADDRESS_ID,
    source: "arp",
    mac: "00:1e:0b:7a:41:c9",
    vendor: "Hewlett Packard (HP)",
    switchName: "SW-A2-01",
    switchPort: "1/1/14",
    event: {
      kind: "seen",
      details: { first: true, mac: "00:1e:0b:7a:41:c9", vendor: "Hewlett Packard (HP)", sources: ["arp"] },
    },
  });
  const dhcp = plan.addressUpdates[1];
  assertEquals(dhcp.mac, "3c:52:82:00:00:02");
  assertEquals(dhcp.event?.kind, "mac_changed");
  assertEquals(plan.open.map((finding) => finding.kind), ["conflict"]);
  assertEquals(plan.observations[1].run_macs, ["3c:52:82:00:00:01", "3c:52:82:00:00:02"]);
  const resolved = plan.resolve.find((entry) => entry.address === "10.20.30.21")!;
  assertEquals(resolved.kinds.sort(), ["conflict", "foreign_mac", "ghost", "outside_prefix"]);
});

Deno.test("parseContext reads the SQL context", () => {
  const parsed = parseContext({
    addresses: [{
      address: "10.20.30.22",
      addressId: ADDRESS_ID,
      status: "reserved",
      mac: "20:4c:03:00:00:01",
      prefixId: PREFIX_ID,
      inDhcpRange: false,
      lease: { mac: "20:4c:03:00:00:01", hostname: "ap", reservation: true, active: true },
      observation: { mac: null, runKey: "r", runMacs: ["20:4c:03:00:00:01", "bad"] },
    }],
    macLocations: [{ mac: "20:4c:03:00:00:01", switchName: "SW", switchPort: "1", vlan: 30, source: "lldp" }],
  });
  assertEquals(parsed.addresses[0].status, "reserved");
  assertEquals(parsed.addresses[0].observation?.runMacs, ["20:4c:03:00:00:01"]);
  assertEquals(parsed.macLocations[0].source, "lldp");
});

Deno.test("dnsIssues and planDnsFindings", () => {
  const base = { addressId: ADDRESS_ID, vrfId: null, status: "active" };
  const ok = dnsIssues({
    ...base,
    address: "10.20.30.21",
    hostname: "DRU-A2-KOPIE",
    dnsName: null,
    aNames: ["dru-a2-kopie.schule.local"],
    ptrTargets: ["dru-a2-kopie.schule.local"],
    nameTargets: ["10.20.30.21"],
  });
  assertEquals(ok, []);
  const missingPtr = dnsIssues({
    ...base,
    address: "10.20.30.21",
    hostname: "DRU-A2-KOPIE",
    dnsName: null,
    aNames: ["dru-a2-kopie.schule.local"],
    ptrTargets: [],
    nameTargets: ["10.20.30.21"],
  });
  assertEquals(missingPtr.map((issue) => `${issue.issue}:${issue.action}`), ["missing_ptr:create_ptr"]);
  const wrong = {
    ...base,
    address: "10.20.10.15",
    hostname: "SRV-NEU-01",
    dnsName: "srv-neu-01.schule.local",
    aNames: [],
    ptrTargets: ["srv-alt-01.schule.local"],
    nameTargets: ["10.20.10.16"],
  };
  assertEquals(dnsIssues(wrong).map((issue) => issue.issue), ["a_mismatch", "ptr_mismatch"]);
  const plan = planDnsFindings([wrong, { ...wrong, addressId: "x", address: "10.20.10.17", ptrTargets: [], nameTargets: [], aNames: [] }]);
  assertEquals(plan.open.length, 1);
  assertEquals(plan.open[0].kind, "dns_mismatch");
  assertEquals(plan.resolveOtherKinds, ["dns_mismatch"]);
});

Deno.test("validateJobPayload builds safe DHCP/DNS payloads", () => {
  const reserve = validateJobPayload("dhcp_reserve", {
    server: "DC01.schule.local",
    scopeId: "10.20.30.0",
    address: "10.20.30.21",
    mac: "00-1E-0B-7A-41-C9",
    name: "DRU-A2-KOPIE",
    description: 'Kopierer "A2"; $(Remove-Item)',
  });
  assert(reserve.ok);
  if (reserve.ok) {
    assertEquals(reserve.payload.mac, "00:1e:0b:7a:41:c9");
    assertEquals(reserve.payload.description, "Kopierer A2; (Remove-Item)");
  }
  const a = validateJobPayload("dns_upsert_a", {
    server: "dc01",
    zone: "schule.local",
    fqdn: "dru-a2-kopie.schule.local",
    address: "10.20.30.21",
    createPtr: true,
    reverseZone: "30.20.10.in-addr.arpa",
  });
  assert(a.ok);
  if (a.ok) assertEquals(a.payload.name, "dru-a2-kopie");
  const ptr = validateJobPayload("dns_upsert_ptr", {
    server: "dc01",
    zone: "30.20.10.in-addr.arpa",
    address: "10.20.30.21",
    target: "dru-a2-kopie.schule.local",
  });
  assert(ptr.ok);
  if (ptr.ok) assertEquals(ptr.payload.name, "21");
  assertEquals(
    validateJobPayload("dns_upsert_ptr", { server: "dc01", zone: "40.20.10.in-addr.arpa", address: "10.20.30.21", target: "x.schule.local" }),
    { ok: false, code: "reverse_zone_invalid" },
  );
  assertEquals(
    validateJobPayload("dns_upsert_a", { server: "dc01", zone: "schule.local", fqdn: "x.other.local", address: "10.20.30.21" }),
    { ok: false, code: "name_invalid" },
  );
  assertEquals(validateJobPayload("dhcp_reserve", { server: "dc01; rm", scopeId: "10.20.30.0" }), { ok: false, code: "server_missing" });
});
