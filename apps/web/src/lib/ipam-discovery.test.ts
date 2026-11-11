import { describe, expect, it } from "vitest";

import {
  configToForm,
  connectionLabel,
  dnsActionOperation,
  EMPTY_CONFIG,
  emptySnmpRow,
  formToConfig,
  jobSummary,
  parseDhcpDns,
  parseOverview,
  relativeTime,
  runDuration,
  runSummary,
  scopeUtilization,
  splitList,
  utilizationTone,
} from "./ipam-discovery";

describe("ipam-discovery helpers", () => {
  it("parses the overview defensively", () => {
    const overview = parseOverview({
      data: {
        canManage: true,
        agents: [
          {
            id: "a1",
            name: "Agent Baar",
            status: "active",
            connection: "online",
            config: {
              scheduleMinutes: 30,
              snmpTargets: [{ host: "sw1", version: "v2c" }, { version: "v3" }],
            },
          },
          { id: "broken" },
        ],
        runs: [
          {
            id: "r1",
            agentId: "a1",
            trigger: "manual",
            startedAt: "2026-11-11T08:00:00Z",
            stats: { pinged: 254, alive: 112, bad: "x" },
          },
        ],
        jobs: [
          {
            id: "j1",
            agentId: "a1",
            kind: "scan_now",
            status: "queued",
            createdAt: "2026-11-11T08:00:00Z",
          },
          { id: "j2", kind: "format", status: "queued" },
        ],
        prefixes: [{ id: "p1", prefix: "10.20.30.0/24" }],
      },
    });
    expect(overview?.agents).toHaveLength(1);
    expect(overview?.agents[0]?.config.scheduleMinutes).toBe(30);
    expect(overview?.agents[0]?.config.snmpTargets).toEqual([
      {
        host: "sw1",
        version: "v2c",
        user: null,
        authProtocol: null,
        privProtocol: null,
        collect: ["arp", "fdb", "lldp"],
      },
    ]);
    expect(overview?.runs[0]?.stats).toEqual({ pinged: 254, alive: 112 });
    expect(overview?.jobs.map((job) => job.id)).toEqual(["j1"]);
    expect(parseOverview({})).toBeNull();
  });

  it("parses DHCP/DNS data and maps diff actions to operations", () => {
    const data = parseDhcpDns({
      data: {
        scopes: [
          {
            id: "s1",
            server: "dc01",
            scopeId: "10.20.30.0",
            inUse: 80,
            free: 15,
            reserved: 5,
          },
        ],
        leases: [{ id: "l1", address: "10.20.30.150", reservation: true }],
        zones: [{ server: "dc01", zone: "schule.local", records: 120 }],
        diff: [
          {
            addressId: "x",
            address: "10.20.30.21",
            expectedName: "dru.schule.local",
            issue: "missing_ptr",
            current: [],
            action: "create_ptr",
          },
          {
            addressId: "y",
            address: "10.20.30.22",
            expectedName: "ap",
            issue: "nonsense",
            action: "create_ptr",
          },
        ],
      },
    });
    expect(data?.diff).toHaveLength(1);
    expect(data?.leases[0]?.reservation).toBe(true);
    expect(dnsActionOperation("create_ptr")).toBe("dns_create_ptr");
    expect(dnsActionOperation("fix_a")).toBe("dns_fix_a");
    expect(dnsActionOperation("create_a")).toBe("dns_create");
    expect(scopeUtilization(data!.scopes[0]!)).toBe(85);
    expect(utilizationTone(85)).toBe("warning");
    expect(utilizationTone(97)).toBe("danger");
    expect(utilizationTone(null)).toBe("neutral");
    expect(scopeUtilization({ inUse: null, free: 3, reserved: 0 })).toBeNull();
  });

  it("formats times, runs and jobs", () => {
    const now = Date.parse("2026-11-11T10:00:00Z");
    expect(relativeTime(null, now)).toBe("noch nie");
    expect(relativeTime("2026-11-11T09:56:00Z", now)).toBe("vor 4 Min.");
    expect(relativeTime("2026-11-08T10:00:00Z", now)).toBe("vor 3 Tagen");
    expect(
      runDuration({
        startedAt: "2026-11-11T09:00:00Z",
        finishedAt: "2026-11-11T09:01:05Z",
      }),
    ).toBe("1 min 5 s");
    expect(
      runDuration({ startedAt: "2026-11-11T09:00:00Z", finishedAt: null }),
    ).toBe("läuft");
    expect(
      runSummary({
        stats: { pinged: 254, alive: 112, snmpTargets: 3, snmpOk: 2 },
      }),
    ).toBe("112 von 254 Adressen antworten · SNMP 2/3");
    expect(
      jobSummary({
        id: "j",
        agentId: "a",
        kind: "dns_upsert_a",
        status: "queued",
        payload: {
          fqdn: "dru.schule.local",
          address: "10.20.30.21",
          createPtr: true,
        },
        error: null,
        addressId: null,
        createdAt: "",
        finishedAt: null,
      }),
    ).toBe("dru.schule.local → 10.20.30.21 mit PTR");
    expect(connectionLabel({ connection: "offline" })).toEqual({
      label: "Offline",
      tone: "danger",
    });
  });

  it("converts the configuration form", () => {
    const form = configToForm(EMPTY_CONFIG);
    expect(splitList("dc01.schule.local, dc02\n dc01.schule.local")).toEqual([
      "dc01.schule.local",
      "dc02",
    ]);
    const ok = formToConfig({
      ...form,
      scheduleMinutes: "30",
      snmp: [
        { ...emptySnmpRow(), host: "sw-a2-01", user: "nextdesk-ro" },
        { ...emptySnmpRow(), host: "" },
      ],
      dhcpServers: "dc01.schule.local",
      dnsZones: "Schule.local.",
    });
    expect(ok).toEqual({
      ok: true,
      config: {
        scanAllActive: true,
        prefixIds: [],
        scheduleMinutes: 30,
        snmpTargets: [
          {
            host: "sw-a2-01",
            version: "v3",
            user: "nextdesk-ro",
            authProtocol: "sha256",
            privProtocol: "aes",
            collect: ["arp", "fdb", "lldp"],
          },
        ],
        dhcpServers: ["dc01.schule.local"],
        dnsServers: [],
        dnsZones: ["schule.local"],
        dnsDefaultZone: null,
        allowWrites: false,
        vrfId: null,
      },
    });
    expect(formToConfig({ ...form, scheduleMinutes: "2" }).ok).toBe(false);
    expect(
      formToConfig({ ...form, scanAllActive: false, prefixIds: [] }).ok,
    ).toBe(false);
    expect(
      formToConfig({
        ...form,
        snmp: [{ ...emptySnmpRow(), host: "sw1", user: "" }],
      }).ok,
    ).toBe(false);
    expect(
      formToConfig({
        ...form,
        snmp: [{ ...emptySnmpRow(), host: "sw1", user: "x", authProtocol: "" }],
      }).ok,
    ).toBe(false);
  });
});
