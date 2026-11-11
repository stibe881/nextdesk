import { describe, expect, it } from "vitest";
import {
  NO_SUBNET,
  parseOverlay,
  subnetBadge,
  subnetKey,
  subnetLegend,
  subnetsForDevices,
  type OverlayPrefix,
} from "./ipam-network-map";

const prefix = (
  id: string,
  text: string,
  vlanNumber: number | null,
  vrfId: string | null = null,
): OverlayPrefix => ({
  id,
  prefix: text,
  vrfId,
  description: null,
  securityZone: null,
  vlanId: vlanNumber ? `v${vlanNumber}` : null,
  vlanNumber,
  vlanName: vlanNumber ? `Netz ${vlanNumber}` : null,
  siteName: null,
});

describe("network map subnets", () => {
  const prefixes = [
    prefix("super", "10.20.0.0/16", null),
    prefix("srv", "10.20.10.0/24", 10),
    prefix("cli", "10.20.30.0/24", 30),
    prefix("guest", "192.168.100.0/22", 100, "vrf-guest"),
  ];

  it("matches devices to the most specific subnet", () => {
    const subnets = subnetsForDevices(
      [
        { id: "a", ipAddress: "10.20.10.5" },
        { id: "b", ipAddress: "10.20.99.1" },
        { id: "c", ipAddress: "192.168.101.7" },
        { id: "d", ipAddress: null },
        { id: "e", ipAddress: "8.8.8.8" },
      ],
      prefixes,
    );
    expect(subnets.get("a")?.prefixId).toBe("srv");
    expect(subnets.get("b")?.prefixId).toBe("super");
    expect(subnets.get("c")?.vlanNumber).toBe(100);
    expect(subnets.has("d")).toBe(false);
    expect(subnetKey(subnets.get("e"))).toBe(NO_SUBNET);
    expect(subnetBadge(subnets.get("a"))).toBe("VLAN 10 · 10.20.10.0/24");
    expect(subnetBadge(subnets.get("b"))).toBe("10.20.0.0/16");
  });

  it("builds a sorted legend with colors", () => {
    const subnets = subnetsForDevices(
      [
        { id: "a", ipAddress: "10.20.30.5" },
        { id: "b", ipAddress: "10.20.10.5" },
        { id: "c", ipAddress: "10.20.10.6" },
        { id: "d", ipAddress: null },
      ],
      prefixes,
    );
    expect(subnetLegend(["a", "b", "c", "d"], subnets)).toEqual([
      { key: "vlan:v10", label: "VLAN 10 · Netz 10", count: 2, color: 1 },
      { key: "vlan:v30", label: "VLAN 30 · Netz 30", count: 1, color: 2 },
      { key: NO_SUBNET, label: "Ohne Subnetz", count: 1, color: 0 },
    ]);
  });

  it("parses the overlay response defensively", () => {
    expect(parseOverlay(null)).toBeNull();
    expect(
      parseOverlay({ prefixes: [{ id: "x" }, prefixes[0]] })?.prefixes,
    ).toHaveLength(1);
  });
});
