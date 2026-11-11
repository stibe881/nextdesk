import { describe, expect, it } from "vitest";
import {
  deviceKind,
  deviceWhere,
  dhcpText,
  uplinkTree,
  type SiteDevice,
} from "./ipam-sites";

function device(
  assetId: string,
  name: string,
  category: string,
  uplinkAssetId: string | null = null,
): SiteDevice {
  return {
    assetId,
    name,
    category,
    ipAddress: null,
    model: null,
    manufacturer: null,
    serialNumber: null,
    locationNote: null,
    uplinkAssetId,
    uplinkName: null,
  };
}

describe("site helpers", () => {
  it("classifies devices", () => {
    expect(deviceKind({ name: "AP1", category: "Access Point" })).toBe("ap");
    expect(deviceKind({ name: "SW1", category: "Switch" })).toBe("switch");
    expect(deviceKind({ name: "FW", category: "Firewall" })).toBe("firewall");
    expect(deviceKind({ name: "X", category: null })).toBe("other");
  });

  it("builds the uplink tree with AP counts and survives cycles", () => {
    const tree = uplinkTree([
      device("sw2", "SW016", "Switch", "core"),
      device("ap1", "AP011", "Access Point", "sw2"),
      device("ap2", "AP012", "Access Point", "sw2"),
      device("core", "SW001", "Switch", "fw"),
      device("fw", "FW-NORD", "Firewall"),
      device("x", "Loop A", "Switch", "y"),
      device("y", "Loop B", "Switch", "x"),
    ]);
    expect(tree[0]!.device.name).toBe("FW-NORD");
    expect(tree[0]!.apCount).toBe(2);
    expect(tree[0]!.children[0]!.children[0]!.device.name).toBe("SW016");
    const names = JSON.stringify(tree);
    expect(names).toContain("Loop A");
    expect(names).toContain("Loop B");
  });

  it("formats DHCP ranges and locations", () => {
    expect(dhcpText("10.1.3.100", "10.1.3.199")).toBe(".100 – .199");
    expect(dhcpText("10.1.4.10", "10.1.5.250")).toBe("10.1.4.10 – 10.1.5.250");
    expect(dhcpText(null, null)).toBe("nein");
    expect(
      deviceWhere({
        ...device("a", "AP", "Access Point"),
        locationNote: "Garderobe",
        uplinkName: "SW016",
      }),
    ).toBe("Garderobe · an SW016");
  });
});
