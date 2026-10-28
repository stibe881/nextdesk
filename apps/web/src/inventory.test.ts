import { describe, expect, it } from "vitest";

import { parseInventoryWorkspace } from "./inventory";

const workspace = {
  data: {
    permissions: {
      canRead: true,
      canManage: false,
      canMove: true,
      canAdjust: false,
      canCloseInventoryCount: false,
    },
    summary: {
      criticalItemCount: 1,
      openReservationCount: 2,
      activeCountSessionCount: 0,
    },
    items: [
      {
        id: "item-1",
        name: "HDMI-Kabel",
        articleNumber: "HDMI-2M",
        unit: "Stück",
        trackingMode: "quantity",
        physicalQuantity: 8,
        reservedQuantity: 3,
        availableQuantity: 5,
        minQuantity: 4,
        targetQuantity: 12,
        locationName: "Hauptlager",
        active: true,
      },
    ],
    locations: [
      { id: "location-1", name: "Hauptlager", code: "A-01", active: true },
    ],
    recentEvents: [
      {
        id: "event-1",
        type: "receipt",
        occurredAt: "2026-10-28T12:00:00.000Z",
        itemName: "HDMI-Kabel",
        physicalDelta: 8,
        reservedDelta: 0,
        locationName: "Hauptlager",
      },
    ],
    lowStockItems: [],
  },
};

describe("parseInventoryWorkspace", () => {
  it("akzeptiert nur den datenminimalen serverautorisierten Lagervertrag", () => {
    expect(parseInventoryWorkspace(workspace)).toMatchObject({
      permissions: { canRead: true, canMove: true },
      summary: { criticalItemCount: 1 },
      items: [{ id: "item-1", availableQuantity: 5 }],
    });
  });

  it("weist fehlende Leseberechtigung, Zusatzfelder und inkonsistente Mengen zurück", () => {
    expect(
      parseInventoryWorkspace({
        data: { ...workspace.data, permissions: { ...workspace.data.permissions, canRead: false } },
      }),
    ).toBeNull();
    expect(
      parseInventoryWorkspace({
        data: {
          ...workspace.data,
          items: [{ ...workspace.data.items[0], reservedQuantity: 9 }],
        },
      }),
    ).toBeNull();
    expect(
      parseInventoryWorkspace({
        data: {
          ...workspace.data,
          items: [{ ...workspace.data.items[0], internalNote: "Nicht anzeigen" }],
        },
      }),
    ).toBeNull();
  });
});
