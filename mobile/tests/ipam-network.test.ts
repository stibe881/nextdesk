import { describe, expect, it } from "vitest";

import {
  mobileAddressStatusLabel,
  mobileFindingLabel,
  mobileLastSeenLabel,
  mobileNetworkRows,
  parseMobileAssetNetwork,
} from "../lib/ipam-network-model";

const NOW = Date.parse("2026-11-11T12:00:00Z");

describe("Netzwerk im Assetdetail", () => {
  it("liest Adressen mit VLAN, Subnetz, Switch-Port und Funden", () => {
    const addresses = parseMobileAssetNetwork({
      data: {
        addresses: [
          {
            id: "a1",
            address: "10.20.30.22",
            status: "reserved",
            hostname: "AP-A2-02",
            dns_name: "ap-a2-02.schule.test",
            mac_address: "f0:9f:c2:11:08:3a",
            switch_name: "SW-A2-01",
            switch_port: "Gi1/0/22",
            last_seen_at: "2026-11-11T08:41:00Z",
            prefix: {
              id: "p1",
              prefix: "10.20.30.0/24",
              gateway: "10.20.30.1",
            },
            vlan: { id: "v1", number: 30, name: "WLAN" },
            site: { id: "s1", name: "Baar" },
            findings: [
              { id: "f1", kind: "foreign_mac", severity: "critical" },
              { id: "f2", kind: "ghost", severity: "laut" },
            ],
          },
          { id: "a2" },
        ],
        prefixes: [],
      },
    });
    expect(addresses).toHaveLength(1);
    const [entry] = addresses!;
    expect(entry!.findings).toEqual([
      { id: "f1", kind: "foreign_mac", severity: "critical" },
    ]);
    expect(mobileNetworkRows(entry!, NOW)).toEqual([
      ["IP-Adresse", "10.20.30.22"],
      ["Status", "Reserviert"],
      ["Hostname", "AP-A2-02"],
      ["DNS-Name", "ap-a2-02.schule.test"],
      ["VLAN", "30 · WLAN"],
      ["Subnetz", "10.20.30.0/24"],
      ["Gateway", "10.20.30.1"],
      ["Standort", "Baar"],
      ["Switch-Port", "SW-A2-01 Gi1/0/22"],
      ["MAC", "f0:9f:c2:11:08:3a"],
      ["Zuletzt gesehen", "vor 3 Std."],
    ]);
  });

  it("lässt leere Werte weg und lehnt fremde Antworten ab", () => {
    const [entry] = parseMobileAssetNetwork({
      data: { addresses: [{ id: "a", address: "10.0.0.9" }] },
    })!;
    expect(mobileNetworkRows(entry!, NOW)).toEqual([
      ["IP-Adresse", "10.0.0.9"],
      ["Status", "Aktiv"],
      ["Zuletzt gesehen", "nie"],
    ]);
    expect(parseMobileAssetNetwork({ data: {} })).toBeNull();
    expect(parseMobileAssetNetwork(null)).toBeNull();
  });

  it("beschriftet Status, Funde und Zeitpunkte", () => {
    expect(mobileAddressStatusLabel("dhcp")).toBe("DHCP");
    expect(mobileFindingLabel("stale")).toBe("Lange nicht gesehen");
    expect(mobileLastSeenLabel("2026-11-11T11:59:30Z", NOW)).toBe(
      "gerade eben",
    );
    expect(mobileLastSeenLabel("2026-11-07T12:00:00Z", NOW)).toBe(
      "vor 4 Tagen",
    );
  });
});
