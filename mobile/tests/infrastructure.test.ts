import { describe, expect, it } from "vitest";

import { dueItems, formatDay, type InfraDevice } from "../lib/infrastructure-model";

function device(patch: Partial<InfraDevice>): InfraDevice {
  return {
    id: "d1",
    name: "SW Core",
    assetTag: null,
    inventoryNumber: null,
    serialNumber: null,
    manufacturer: null,
    model: null,
    lifecycleState: "active",
    locationName: null,
    category: "switch",
    hostname: null,
    ipAddress: null,
    macAddress: null,
    firmwareVersion: null,
    rack: null,
    rackUnit: null,
    uplinkAssetId: null,
    uplinkName: null,
    uplinkPort: null,
    purchaseDate: null,
    purchasePrice: null,
    supplier: null,
    warrantyUntil: null,
    supportUntil: null,
    endOfLife: null,
    plannedReplacement: null,
    criticality: "medium",
    maintenanceIntervalMonths: null,
    lastMaintenanceOn: null,
    notes: null,
    ...patch,
  };
}

describe("infrastructure due items", () => {
  it("lists dates within 30 days and marks overdue ones", () => {
    const items = dueItems(
      device({
        warrantyUntil: "2026-11-20",
        supportUntil: "2026-11-01",
        endOfLife: "2027-06-30",
      }),
      "2026-11-07",
    );
    expect(items.map((item) => [item.reason, item.overdue])).toEqual([
      ["warranty", false],
      ["support", true],
    ]);
  });

  it("derives the next maintenance from the last one", () => {
    const items = dueItems(
      device({ maintenanceIntervalMonths: 6, lastMaintenanceOn: "2026-05-20" }),
      "2026-11-07",
    );
    expect(items).toEqual([
      {
        reason: "maintenance",
        label: "Wartung",
        dueOn: "2026-11-20",
        overdue: false,
      },
    ]);
  });

  it("ignores retired devices", () => {
    expect(
      dueItems(
        device({ lifecycleState: "retired", warrantyUntil: "2026-11-01" }),
        "2026-11-07",
      ),
    ).toEqual([]);
  });

  it("formats ISO days the Swiss way", () => {
    expect(formatDay("2028-03-31")).toBe("31.03.2028");
    expect(formatDay(null)).toBe("–");
  });
});
