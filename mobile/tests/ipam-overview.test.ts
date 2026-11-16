import { describe, expect, it } from "vitest";

import {
  compareIpamText,
  formatIpamCount,
  formatIpamPercent,
  groupIpamPrefixes,
  ipamAddressHref,
  ipamAddressMeta,
  ipamExactAddress,
  ipamHasMoreAddresses,
  ipamPrefixHref,
  ipamPrefixMeta,
  ipamSearchReady,
  ipamUsageLabel,
  ipamUsageTone,
  ipamV4Percent,
  isIpamAccessDenied,
  matchesIpamAddress,
  parseIpamOverview,
  parseIpamPrefixDetail,
  parseIpamSearch,
  type IpamPrefixRow,
} from "../lib/ipam-overview-model";

const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";
const P3 = "33333333-3333-4333-8333-333333333333";
const SITE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SITE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function prefixRow(overrides: Partial<IpamPrefixRow>): IpamPrefixRow {
  return {
    id: P1,
    prefix: "10.0.0.0/24",
    description: null,
    status: "active",
    siteId: null,
    vlanId: null,
    vrfId: null,
    gateway: null,
    dhcpStart: null,
    dhcpEnd: null,
    securityZone: null,
    warningPercent: 85,
    usage: null,
    parentId: null,
    depth: 0,
    ...overrides,
  };
}

describe("Übersicht IP-Adressen: Antworten lesen", () => {
  it("liest Subnetze, Standorte, VLANs, VRFs und Kennzahlen", () => {
    const overview = parseIpamOverview({
      data: {
        canManage: false,
        vrfs: [{ id: "vrf1", name: "Schule" }, { id: "vrf2" }],
        sites: [{ id: SITE_A, name: "Baar", code: "BA" }, { name: "ohne Id" }],
        vlans: [
          { id: "v1", vlanNumber: 30, name: "WLAN" },
          { id: "v2", vlanNumber: "x", name: "kaputt" },
        ],
        prefixes: [
          {
            id: P1,
            prefix: "10.20.30.0/24",
            vrfId: "vrf1",
            siteId: SITE_A,
            vlanId: "v1",
            status: "active",
            description: "WLAN Schüler",
            gateway: "10.20.30.1",
            utilizationWarningPercent: 80,
            usage: { used: 59, capacity: "254", percent: 23.2, dhcpSize: 100 },
            parentId: null,
            depth: 0,
          },
          { id: P2, prefix: "10.0.0.0/8", status: "erfunden", usage: "kaputt" },
          { prefix: "10.9.9.0/24" },
          "Text",
        ],
        kpis: {
          prefixCount: 2,
          addressCount: 59,
          usedV4: 59,
          capacityV4: "254",
          overWarning: 0,
          openFindings: 3,
          conflicts: -1,
        },
      },
    });
    expect(overview).not.toBeNull();
    expect(overview!.prefixes).toHaveLength(2);
    expect(overview!.prefixes[0]).toMatchObject({
      prefix: "10.20.30.0/24",
      description: "WLAN Schüler",
      warningPercent: 80,
      usage: { used: 59, capacity: "254", percent: 23.2, dhcpSize: 100 },
    });
    // Unknown status falls back to active, broken usage to null.
    expect(overview!.prefixes[1]).toMatchObject({
      status: "active",
      usage: null,
      warningPercent: 85,
    });
    expect(overview!.vrfs).toEqual([{ id: "vrf1", name: "Schule" }]);
    expect(overview!.sites).toEqual([{ id: SITE_A, name: "Baar", code: "BA" }]);
    expect(overview!.vlans).toEqual([{ id: "v1", number: 30, name: "WLAN" }]);
    expect(overview!.kpis).toEqual({
      prefixCount: 2,
      addressCount: 59,
      usedV4: 59,
      capacityV4: "254",
      overWarning: 0,
      openFindings: 3,
      conflicts: 0,
    });
  });

  it("lehnt unerwartete Antworten ab (fail closed)", () => {
    expect(parseIpamOverview(null)).toBeNull();
    expect(parseIpamOverview({ data: {} })).toBeNull();
    expect(parseIpamOverview({ data: { prefixes: "x" } })).toBeNull();
    expect(parseIpamOverview({ prefixes: [] })).toBeNull();
    expect(parseIpamSearch({ data: { addresses: [] } })).toBeNull();
    expect(parseIpamPrefixDetail({ data: { addresses: [] } })).toBeNull();
    expect(
      parseIpamPrefixDetail({ data: { prefix: { id: P1 }, addresses: [] } }),
    ).toBeNull();
  });

  it("liest Suchtreffer mit Adressen und Subnetzen", () => {
    const result = parseIpamSearch({
      data: {
        addresses: [
          {
            id: "a1",
            address: "10.20.30.22",
            status: "reserved",
            hostname: "AP-A2-02",
            dnsName: "ap-a2-02.schule.test",
            macAddress: "f0:9f:c2:11:08:3a",
            prefixId: P1,
          },
          { id: "a2" },
        ],
        prefixes: [{ id: P1, prefix: "10.20.30.0/24", usage: null }],
      },
    });
    expect(result?.addresses).toEqual([
      {
        id: "a1",
        address: "10.20.30.22",
        status: "reserved",
        hostname: "AP-A2-02",
        dnsName: "ap-a2-02.schule.test",
        macAddress: "f0:9f:c2:11:08:3a",
        description: null,
        prefixId: P1,
        lastSeenAt: null,
      },
    ]);
    expect(result?.prefixes.map((row) => row.prefix)).toEqual([
      "10.20.30.0/24",
    ]);
  });

  it("liest ein Subnetz mit Seiten und erkennt weitere Adressen", () => {
    const detail = parseIpamPrefixDetail({
      data: {
        prefix: { id: P1, prefix: "10.20.0.0/16", status: "active" },
        vlan: { id: "v1", vlanNumber: 20, name: "Verwaltung" },
        site: { id: SITE_A, name: "Baar" },
        vrf: null,
        addresses: [{ id: "a1", address: "10.20.0.5" }],
        total: 450,
        page: 0,
        pageSize: 200,
        nextFree: "10.20.0.6",
      },
    });
    expect(detail).toMatchObject({
      total: 450,
      page: 0,
      pageSize: 200,
      nextFree: "10.20.0.6",
      vlan: { number: 20, name: "Verwaltung" },
      site: { name: "Baar" },
      vrf: null,
    });
    expect(ipamHasMoreAddresses(detail!, 200)).toBe(true);
    expect(ipamHasMoreAddresses(detail!, 450)).toBe(false);
    // Grid prefixes come in one answer (pageSize null).
    expect(ipamHasMoreAddresses({ pageSize: null, total: 900 }, 10)).toBe(
      false,
    );
    // total never below the delivered addresses.
    const short = parseIpamPrefixDetail({
      data: {
        prefix: { id: P1, prefix: "10.0.0.0/30" },
        addresses: [
          { id: "a1", address: "10.0.0.1" },
          { id: "a2", address: "10.0.0.2" },
        ],
        total: "kaputt",
        pageSize: null,
      },
    });
    expect(short).toMatchObject({ total: 2, pageSize: null });
  });
});

describe("Übersicht IP-Adressen: Zugriff", () => {
  it("erkennt fehlendes Recht und ausgeschaltetes Modul", () => {
    expect(isIpamAccessDenied({ code: "feature_disabled", status: 403 })).toBe(
      true,
    );
    expect(isIpamAccessDenied({ code: "access_denied", status: 403 })).toBe(
      true,
    );
    expect(isIpamAccessDenied({ code: null, status: 403 })).toBe(true);
    const error = Object.assign(new Error("Für die IP-Adressverwaltung …"), {
      code: "access_denied",
      status: 403,
    });
    expect(isIpamAccessDenied(error)).toBe(true);
  });

  it("behandelt andere Fehler als Fehler", () => {
    expect(isIpamAccessDenied({ code: "manage_denied", status: 403 })).toBe(
      false,
    );
    expect(isIpamAccessDenied({ code: "internal_error", status: 500 })).toBe(
      false,
    );
    expect(isIpamAccessDenied(new Error("offline"))).toBe(false);
    expect(isIpamAccessDenied(null)).toBe(false);
    expect(isIpamAccessDenied("access_denied")).toBe(false);
  });
});

describe("Übersicht IP-Adressen: Adressen und Routen", () => {
  it("erkennt vollständige IPv4- und IPv6-Adressen", () => {
    expect(ipamExactAddress(" 10.20.30.22 ")).toBe("10.20.30.22");
    expect(ipamExactAddress("10.20.30.256")).toBeNull();
    expect(ipamExactAddress("10.20.30")).toBeNull();
    expect(ipamExactAddress("10.20.30.0/24")).toBeNull();
    expect(ipamExactAddress("2001:DB8::1")).toBe("2001:db8::1");
    expect(ipamExactAddress("::ffff:10.0.0.1")).toBe("::ffff:10.0.0.1");
    expect(ipamExactAddress("1:2:3:4:5:6:7:8:9")).toBeNull();
    expect(ipamExactAddress("drucker-3og")).toBeNull();
    expect(ipamExactAddress("f0:9f:c2:11:08:3a")).toBeNull();
  });

  it("baut Routen nur für gültige Werte", () => {
    expect(ipamAddressHref("10.20.30.22")).toBe("/ipam/10.20.30.22");
    expect(ipamAddressHref("10.20.30.22/32")).toBe("/ipam/10.20.30.22");
    expect(ipamAddressHref("2001:db8::1")).toBe("/ipam/2001%3Adb8%3A%3A1");
    expect(ipamAddressHref("../geheim")).toBeNull();
    expect(ipamPrefixHref(P1.toUpperCase())).toBe(`/ipam/prefix/${P1}`);
    expect(ipamPrefixHref("../x")).toBeNull();
  });

  it("sucht ab zwei Zeichen", () => {
    expect(ipamSearchReady(" 1 ")).toBe(false);
    expect(ipamSearchReady("10")).toBe(true);
  });

  it("sortiert numerisch, IPv4 vor IPv6", () => {
    const sorted = [
      "2001:db8::/64",
      "10.0.10.0/24",
      "10.0.2.0/24",
      "Text",
      "10.0.2.0/23",
    ].sort(compareIpamText);
    expect(sorted).toEqual([
      "10.0.2.0/23",
      "10.0.2.0/24",
      "10.0.10.0/24",
      "2001:db8::/64",
      "Text",
    ]);
  });

  it("filtert geladene Adressen nach IP, Hostname und MAC", () => {
    const row = {
      id: "a1",
      address: "10.20.30.22",
      status: "active",
      hostname: "AP-A2-02",
      dnsName: null,
      macAddress: "f0:9f:c2:11:08:3a",
      description: null,
      prefixId: null,
      lastSeenAt: null,
    };
    expect(matchesIpamAddress(row, "")).toBe(true);
    expect(matchesIpamAddress(row, "30.22")).toBe(true);
    expect(matchesIpamAddress(row, "ap-a2")).toBe(true);
    expect(matchesIpamAddress(row, "F09F.C211")).toBe(true);
    expect(matchesIpamAddress(row, "drucker")).toBe(false);
    expect(ipamAddressMeta(row)).toBe("AP-A2-02 · f0:9f:c2:11:08:3a");
    expect(ipamAddressMeta({ ...row, hostname: null, macAddress: null })).toBe(
      "Ohne Hostname",
    );
  });
});

describe("Übersicht IP-Adressen: Gruppen und Formatierung", () => {
  it("gruppiert Blatt-Subnetze nach Standort, ohne Veraltete", () => {
    const groups = groupIpamPrefixes({
      sites: [
        { id: SITE_B, name: "Zug", code: null },
        { id: SITE_A, name: "Baar", code: null },
      ],
      prefixes: [
        prefixRow({
          id: P1,
          prefix: "10.0.0.0/16",
          siteId: SITE_A,
          status: "container",
        }),
        prefixRow({
          id: P2,
          prefix: "10.0.10.0/24",
          siteId: SITE_A,
          parentId: P1,
        }),
        prefixRow({
          id: P3,
          prefix: "10.0.2.0/24",
          siteId: SITE_A,
          parentId: P1,
        }),
        prefixRow({ id: "z1", prefix: "10.1.0.0/24", siteId: SITE_B }),
        prefixRow({
          id: "z2",
          prefix: "10.1.1.0/24",
          siteId: SITE_B,
          status: "deprecated",
        }),
        prefixRow({ id: "n1", prefix: "192.168.1.0/24" }),
        prefixRow({ id: "n2", prefix: "192.168.2.0/24", siteId: "unsichtbar" }),
      ],
    });
    expect(
      groups.map((group) => [
        group.label,
        group.prefixes.map((prefix) => prefix.prefix),
      ]),
    ).toEqual([
      ["Baar", ["10.0.2.0/24", "10.0.10.0/24"]],
      ["Zug", ["10.1.0.0/24"]],
      ["Ohne Standort", ["192.168.1.0/24", "192.168.2.0/24"]],
    ]);
  });

  it("nennt die einzige Gruppe ohne Standorte «Subnetze»", () => {
    const groups = groupIpamPrefixes({
      sites: [],
      prefixes: [prefixRow({})],
    });
    expect(groups.map((group) => group.label)).toEqual(["Subnetze"]);
    expect(groupIpamPrefixes({ sites: [], prefixes: [] })).toEqual([]);
  });

  it("formatiert Zahlen, Prozente und Auslastung", () => {
    expect(formatIpamCount(0)).toBe("0");
    expect(formatIpamCount(1234567)).toBe("1’234’567");
    expect(formatIpamCount("65534")).toBe("65’534");
    expect(formatIpamCount(-3)).toBe("0");
    expect(formatIpamCount("18446744073709551616")).toBe("2^64");
    expect(formatIpamPercent(4.56)).toBe("4.6 %");
    expect(formatIpamPercent(23.2)).toBe("23 %");
    expect(formatIpamPercent(150)).toBe("100 %");
    expect(
      ipamUsageLabel({ used: 59, capacity: "254", percent: 23.2, dhcpSize: 0 }),
    ).toBe("59 von 254 belegt · 23 %");
    expect(ipamUsageLabel(null)).toBe("Keine Auslastung");
    expect(ipamV4Percent({ usedV4: 50, capacityV4: "200" })).toBe(25);
    expect(ipamV4Percent({ usedV4: 0, capacityV4: "0" })).toBeNull();
  });

  it("färbt die Auslastung ab Warnschwelle und ab 95 %", () => {
    expect(ipamUsageTone(null, 85)).toBe("none");
    expect(ipamUsageTone(50, 85)).toBe("ok");
    expect(ipamUsageTone(85, 85)).toBe("warning");
    expect(ipamUsageTone(95, 85)).toBe("danger");
    expect(ipamUsageTone(96, 98)).toBe("ok");
  });

  it("zeigt CIDR, VLAN, VRF und Zone in der zweiten Zeile", () => {
    expect(
      ipamPrefixMeta(
        prefixRow({ description: "WLAN", securityZone: "Gäste" }),
        { id: "v1", number: 30, name: "WLAN" },
        { id: "vrf1", name: "Schule" },
      ),
    ).toBe("10.0.0.0/24 · VLAN 30 · WLAN · VRF Schule · Gäste");
    expect(ipamPrefixMeta(prefixRow({}), null, null)).toBe("");
  });
});
