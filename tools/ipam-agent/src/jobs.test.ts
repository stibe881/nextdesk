import assert from "node:assert/strict";
import { test } from "node:test";

import { ConfigError, parseLocalConfig, snmpCredentialFor } from "./config.ts";
import { JobRejected, planWriteJob } from "./jobs.ts";
import { encodeScript } from "./powershell.ts";
import { buildReports } from "./reports.ts";
import { scanTargets, vrfFor } from "./scan.ts";

const servers = { dhcp: ["dc01.schule.local"], dns: ["dc01.schule.local"] };
const TOKEN = `ndip_${"a".repeat(32)}_${"B".repeat(43)}`;

test("write jobs are validated before PowerShell runs", () => {
  const reserve = planWriteJob(
    {
      id: "1",
      kind: "dhcp_reserve",
      payload: {
        server: "DC01.schule.local",
        scopeId: "10.20.30.0",
        address: "10.20.30.21",
        mac: "00-1E-0B-7A-41-C9",
        name: "dru-a2-kopie",
        description: "Kopierer A2 $(Stop-Computer) `whoami`",
      },
    },
    servers,
  );
  assert.equal(reserve.script, "dhcpReserve");
  assert.equal(reserve.params.mac, "00:1e:0b:7a:41:c9");
  assert.equal(
    reserve.params.description,
    "Kopierer A2 (Stop-Computer) whoami",
  );

  const ptr = planWriteJob(
    {
      id: "2",
      kind: "dns_upsert_ptr",
      payload: {
        server: "dc01.schule.local",
        zone: "30.20.10.in-addr.arpa",
        name: "21",
        target: "dru-a2-kopie.schule.local",
      },
    },
    servers,
  );
  assert.deepEqual(ptr.params, {
    server: "dc01.schule.local",
    zone: "30.20.10.in-addr.arpa",
    name: "21",
    target: "dru-a2-kopie.schule.local",
    replace: true,
    ttl: null,
  });

  assert.throws(
    () =>
      planWriteJob(
        {
          id: "3",
          kind: "dhcp_reserve",
          payload: {
            server: "evil.example.com",
            scopeId: "10.0.0.0",
            address: "10.0.0.5",
            mac: "00:1e:0b:00:00:01",
          },
        },
        servers,
      ),
    JobRejected,
  );
  assert.throws(
    () =>
      planWriteJob(
        {
          id: "4",
          kind: "dns_upsert_a",
          payload: {
            server: "dc01.schule.local",
            zone: "schule.local",
            name: "x; Remove-Item",
            address: "10.0.0.5",
          },
        },
        servers,
      ),
    JobRejected,
  );
  assert.throws(
    () =>
      planWriteJob(
        {
          id: "5",
          kind: "dns_upsert_a",
          payload: {
            server: "dc01.schule.local",
            zone: "schule.local",
            name: "x",
            type: "A",
            address: "fd12::1",
          },
        },
        servers,
      ),
    JobRejected,
  );
  assert.throws(
    () =>
      planWriteJob(
        { id: "6", kind: "format_c", payload: { server: "dc01.schule.local" } },
        servers,
      ),
    JobRejected,
  );
});

test("PowerShell script is passed as UTF-16LE Base64", () => {
  assert.equal(
    encodeScript("ab"),
    Buffer.from([0x61, 0, 0x62, 0]).toString("base64"),
  );
});

test("local config: HTTPS, token format, SNMP credentials", () => {
  const config = parseLocalConfig(
    {
      nextdeskUrl: "https://example.supabase.co/functions/v1/ipam-agent",
      agentToken: TOKEN,
      snmp: {
        default: {
          version: "v3",
          user: "nextdesk-ro",
          authProtocol: "sha256",
          authKey: "auth-key-123",
          privProtocol: "aes",
          privKey: "priv-key-123",
        },
        hosts: { "192.0.2.201": { version: "v2c", community: "ro-community" } },
      },
    },
    {},
  );
  assert.equal(snmpCredentialFor(config, "sw-a2-01", "v3")?.version, "v3");
  assert.equal(snmpCredentialFor(config, "192.0.2.201", "v2c")?.version, "v2c");
  assert.equal(snmpCredentialFor(config, "sw-a2-01", "v2c"), null);
  assert.equal(config.allowWrites, false);
  assert.throws(
    () =>
      parseLocalConfig(
        { nextdeskUrl: "http://example.com", agentToken: TOKEN },
        {},
      ),
    ConfigError,
  );
  assert.throws(
    () =>
      parseLocalConfig(
        { nextdeskUrl: "https://example.com", agentToken: "abc" },
        {},
      ),
    ConfigError,
  );
  assert.throws(
    () =>
      parseLocalConfig(
        {
          nextdeskUrl: "https://example.com",
          agentToken: TOKEN,
          snmp: {
            default: {
              version: "v3",
              user: "x",
              privProtocol: "aes",
              privKey: "12345678",
            },
          },
        },
        {},
      ),
    ConfigError,
  );
  const fromEnv = parseLocalConfig(
    {},
    { NEXTDESK_URL: "https://example.com/x", NEXTDESK_AGENT_TOKEN: TOKEN },
  );
  assert.equal(fromEnv.agentToken, TOKEN);
});

test("scan targets and VRF assignment", () => {
  const local = parseLocalConfig(
    { nextdeskUrl: "https://example.com", agentToken: TOKEN },
    {},
  );
  const targets = scanTargets(local, [
    {
      prefixId: "p1",
      prefix: "10.20.0.0/16",
      vrfId: null,
      family: 4,
      sweep: true,
    },
    {
      prefixId: "p2",
      prefix: "10.20.30.0/24",
      vrfId: "v1",
      family: 4,
      sweep: true,
    },
    {
      prefixId: "p3",
      prefix: "fd12:3456::/48",
      vrfId: null,
      family: 6,
      sweep: false,
    },
  ]);
  assert.equal(targets.length, 3);
  assert.deepEqual(vrfFor(targets, "10.20.30.5"), { known: true, vrfId: "v1" });
  assert.deepEqual(vrfFor(targets, "10.20.31.5"), { known: true, vrfId: null });
  assert.deepEqual(vrfFor(targets, "192.0.2.1"), { known: false, vrfId: null });
  assert.equal(
    scanTargets(
      local,
      [
        {
          prefixId: "p1",
          prefix: "10.20.0.0/16",
          vrfId: null,
          family: 4,
          sweep: true,
        },
      ],
      ["p9"],
    ).length,
    0,
  );
});

test("reports respect limits and end with a final report", () => {
  const observations = Array.from({ length: 4500 }, (_, index) => ({
    address: `10.20.${Math.floor(index / 250)}.${(index % 250) + 1}`,
    source: "ping" as const,
  }));
  const macTable = [
    { switchName: "SW1", port: "1", mac: "00:1e:0b:00:00:01", vlan: 1 },
    { switchName: "SW2", port: "1", mac: "00:1e:0b:00:00:02", vlan: 1 },
    { switchName: "SW2", port: "2", mac: "00:1e:0b:00:00:03", vlan: 1 },
  ];
  const { reports, truncated } = buildReports(
    { key: "run-1", trigger: "schedule", jobId: null },
    {
      observations,
      macTable,
      lldp: [],
      dhcp: [{ server: "dc01", scopes: [], leases: new Array(5).fill({}) }],
      dns: [
        { server: "dc01", zone: "a.local", records: new Array(3).fill({}) },
        { server: "dc01", zone: "b.local", records: new Array(3).fill({}) },
      ],
    },
    { alive: 4500 },
    ["SNMP sw3: timeout"],
    { observations: 5000, macTable: 2, lldp: 10, dhcpLeases: 3, dnsRecords: 5 },
  );
  // topology: SW1 alone, SW2 (2 entries) in its own report
  assert.equal(reports[0]!.macTable!.length, 1);
  assert.equal(reports[1]!.macTable!.length, 2);
  // observations in chunks of 2000
  assert.deepEqual(
    reports
      .filter((report) => report.observations)
      .map((report) => report.observations!.length),
    [2000, 2000, 500],
  );
  assert.equal(
    reports.find((report) => report.dhcp)!.dhcp![0]!.leases.length,
    3,
  );
  assert.equal(reports.filter((report) => report.dns).length, 2);
  const final = reports.at(-1)!;
  assert.equal(final.run.final, true);
  assert.deepEqual(final.run.stats, { alive: 4500 });
  assert.equal(final.run.errors?.[0], "SNMP sw3: timeout");
  assert.equal(truncated.length, 1);
  assert.ok(reports.slice(0, -1).every((report) => report.run.final === false));
});
