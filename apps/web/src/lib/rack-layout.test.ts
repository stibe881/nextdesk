import { describe, expect, it } from "vitest";
import { buildRacks, parseRackUnits } from "./rack-layout";

const device = (id: string, rack: string | null, rackUnit: string | null) => ({
  id,
  name: id,
  category: "switch",
  rack,
  rackUnit,
  locationName: "Serverraum",
  uplinkAssetId: null,
});

describe("rack layout", () => {
  it("parses height units", () => {
    expect(parseRackUnits("12")).toEqual({ start: 12, height: 1 });
    expect(parseRackUnits("HE 10-11")).toEqual({ start: 10, height: 2 });
    expect(parseRackUnits("U3–U5")).toEqual({ start: 3, height: 3 });
    expect(parseRackUnits("oben")).toBeNull();
  });
  it("groups devices per rack and picks a standard height", () => {
    const racks = buildRacks([
      device("sw1", "R1", "40"),
      device("srv", "R1", "10-11"),
      device("ups", "R1", null),
      device("ap", null, null),
    ]);
    expect(racks).toHaveLength(1);
    expect(racks[0]!.units).toBe(42);
    expect(racks[0]!.placed.map((entry) => entry.device.id)).toEqual([
      "sw1",
      "srv",
    ]);
    expect(racks[0]!.unplaced.map((entry) => entry.id)).toEqual(["ups"]);
  });
});

describe("buildRacks with recorded racks", () => {
  const device = {
    id: "d1",
    name: "SW-01",
    category: "switch",
    rack: "rack 01",
    rackUnit: "12-14",
    locationName: "Baar",
    uplinkAssetId: null,
  };
  it("uses the recorded height and shows empty racks", () => {
    const racks = buildRacks(
      [device],
      [
        {
          id: "r1",
          name: "Rack 01",
          locationId: "l1",
          locationName: "Baar",
          heightUnits: 20,
          notes: "UG",
        },
        {
          id: "r2",
          name: "Rack 02",
          locationId: null,
          locationName: null,
          heightUnits: 12,
          notes: null,
        },
      ],
    );
    expect(
      racks.map((rack) => [rack.name, rack.units, rack.placed.length]),
    ).toEqual([
      ["Rack 01", 20, 1],
      ["Rack 02", 12, 0],
    ]);
    expect(racks[0]?.definition?.id).toBe("r1");
  });
});
