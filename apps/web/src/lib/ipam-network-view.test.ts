import { describe, expect, it } from "vitest";
import {
  addressStatusLabel,
  addressStatusTone,
  findingLabel,
  lastSeenLabel,
  linkOptions,
  networkContextLine,
  parseNetworkLookup,
} from "./ipam-network-view";

describe("linkOptions", () => {
  it("zeigt Gerät und Dienste mit Verknüpfungsstand", () => {
    const lookup = parseNetworkLookup({
      addresses: [
        {
          id: "a1",
          address: "10.20.30.22",
          asset: { id: "as1", name: "SRV-01" },
          services: [
            { id: "sv1", name: "Mail" },
            { id: "sv2", name: "" },
          ],
        },
      ],
      prefixes: [],
      linkedAssetIds: ["as1"],
      linkedServiceIds: [],
    })!;
    expect(linkOptions(lookup.addresses[0]!, lookup)).toEqual({
      asset: { id: "as1", name: "SRV-01", linked: true },
      services: [{ id: "sv1", name: "Mail", linked: false }],
    });
    expect(findingLabel("coverage")).toBe("Nicht in PRTG überwacht");
  });
});

describe("parseNetworkLookup", () => {
  it("liest Adressen, Subnetze und Funde", () => {
    const result = parseNetworkLookup({
      addresses: [
        {
          id: "a1",
          address: "10.20.30.22",
          status: "reserved",
          hostname: "AP-A2-02",
          mac_address: "f0:9f:c2:11:08:3a",
          switch_name: "SW-A2-01",
          switch_port: "Gi1/0/22",
          last_seen_at: "2026-11-11T08:41:00Z",
          asset: { id: "as1", name: "AP-A2-02", asset_tag: "IT-0042" },
          prefix: { id: "p1", prefix: "10.20.30.0/24", gateway: "10.20.30.1" },
          vlan: { id: "v1", number: 30, name: "WLAN" },
          site: { id: "s1", name: "Baar" },
          matched_by: ["ip", 3],
          findings: [
            { id: "f1", kind: "foreign_mac", severity: "critical" },
            { id: "f2", kind: "ghost", severity: "loud" },
          ],
        },
        { id: "", address: "10.0.0.1" },
      ],
      prefixes: [
        {
          id: "p2",
          prefix: "10.20.40.0/24",
          matched: "10.20.40.9",
          used: 100,
          dhcp_size: 100,
          capacity: 254,
        },
      ],
    });
    expect(result?.addresses).toHaveLength(1);
    const [address] = result!.addresses;
    expect(address).toMatchObject({
      address: "10.20.30.22",
      status: "reserved",
      switchPort: "Gi1/0/22",
      asset: { id: "as1", name: "AP-A2-02", assetTag: "IT-0042" },
      vlan: { number: 30, name: "WLAN" },
      site: "Baar",
      matchedBy: ["ip"],
    });
    expect(address!.findings).toEqual([
      {
        id: "f1",
        kind: "foreign_mac",
        severity: "critical",
        firstSeenAt: null,
      },
    ]);
    expect(result?.prefixes[0]).toMatchObject({
      matched: "10.20.40.9",
      percent: 79,
    });
    expect(parseNetworkLookup({ foo: 1 })).toBeNull();
  });
});

describe("Texte", () => {
  it("beschriftet Status, Funde und Zeitpunkte", () => {
    expect(addressStatusLabel("deprecated")).toBe("Veraltet");
    expect(addressStatusTone("active")).toBe("success");
    expect(addressStatusTone("unknown")).toBe("neutral");
    expect(findingLabel("conflict")).toBe("IP-Konflikt");
    expect(findingLabel("neu")).toBe("neu");
    const now = Date.parse("2026-11-11T12:00:00Z");
    expect(lastSeenLabel(null, now)).toBe("nie");
    expect(lastSeenLabel("2026-11-11T11:59:30Z", now)).toBe("gerade eben");
    expect(lastSeenLabel("2026-11-11T11:15:00Z", now)).toBe("vor 45 Min.");
    expect(lastSeenLabel("2026-11-11T09:00:00Z", now)).toBe("vor 3 Std.");
    expect(lastSeenLabel("2026-11-07T12:00:00Z", now)).toBe("vor 4 Tagen");
    expect(
      networkContextLine({
        vlan: { number: 67, name: "Drucker" },
        prefix: { prefix: "10.20.67.0/24" },
        site: "Baar",
      }),
    ).toBe("VLAN 67 Drucker · 10.20.67.0/24 · Baar");
  });
});
