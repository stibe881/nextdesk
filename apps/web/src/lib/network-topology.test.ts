import { describe, expect, it } from "vitest";
import { buildTopology } from "./network-topology";

describe("buildTopology", () => {
  it("centres parents over their children", () => {
    const { nodes, columns, depth } = buildTopology([
      { id: "fw", name: "Firewall", uplinkAssetId: null },
      { id: "sw1", name: "Switch A", uplinkAssetId: "fw" },
      { id: "sw2", name: "Switch B", uplinkAssetId: "fw" },
      { id: "ap", name: "AP", uplinkAssetId: "sw1" },
    ]);
    const node = (id: string) => nodes.find((entry) => entry.device.id === id)!;
    expect(columns).toBe(2);
    expect(depth).toBe(2);
    expect(node("ap").depth).toBe(2);
    expect(node("fw").x).toBe(0.5);
    expect(node("sw1").parentId).toBe("fw");
  });
  it("survives uplink loops and unknown uplinks", () => {
    const { nodes } = buildTopology([
      { id: "a", name: "A", uplinkAssetId: "b" },
      { id: "b", name: "B", uplinkAssetId: "a" },
      { id: "c", name: "C", uplinkAssetId: "missing" },
    ]);
    expect(nodes).toHaveLength(3);
  });
});
