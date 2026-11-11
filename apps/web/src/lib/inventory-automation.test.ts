import { describe, expect, it } from "vitest";

import {
  draftFromAutomation,
  parseDays,
  parseInventoryAutomation,
  saveRequest,
} from "./inventory-automation";

const response = {
  data: {
    settings: {
      defaultReturnLocationId: "loc-1",
      reorderNotify: true,
      reorderCreateTask: false,
      reservationHoldDays: 14,
    },
    departments: [{ id: "dep-1", name: "ICT", returnLocationId: null }],
    locations: [
      {
        id: "loc-1",
        name: "Lager",
        active: true,
        countIntervalDays: 90,
        lastCountedAt: null,
        nextCountDue: "2026-12-01",
      },
    ],
    reorderRequests: [
      {
        id: "req-1",
        itemId: "item-1",
        itemName: "Kabel",
        articleNumber: "kabel",
        unit: "each",
        supplier: null,
        suggestedQuantity: 7,
        status: "open",
        note: null,
        createdAt: "2026-11-10T08:00:00Z",
      },
      { id: "req-2", itemId: "item-2", suggestedQuantity: 1, status: "done" },
    ],
  },
};

describe("inventory automation", () => {
  it("parses the server response", () => {
    const parsed = parseInventoryAutomation(response);
    expect(parsed?.settings.reservationHoldDays).toBe(14);
    expect(parsed?.locations[0]?.nextCountDue).toBe("2026-12-01");
    expect(parsed?.reorderRequests.map((row) => row.id)).toEqual(["req-1"]);
    expect(parseInventoryAutomation({ data: {} })).toBeNull();
  });

  it("validates day fields", () => {
    expect(parseDays("", 1, 365)).toBeNull();
    expect(parseDays(" 30 ", 7, 730)).toBe(30);
    expect(parseDays("3", 7, 730)).toBeUndefined();
    expect(parseDays("1.5", 1, 365)).toBeUndefined();
  });

  it("builds the save request from the draft", () => {
    const parsed = parseInventoryAutomation(response);
    if (!parsed) throw new Error("parse failed");
    const draft = draftFromAutomation(parsed);
    draft.departmentLocations["dep-1"] = "loc-1";
    draft.countIntervals["loc-1"] = "";
    expect(saveRequest("tenant", draft)).toEqual({
      body: {
        type: "saveInventoryAutomation",
        tenantId: "tenant",
        settings: {
          defaultReturnLocationId: "loc-1",
          reorderNotify: true,
          reorderCreateTask: false,
          reservationHoldDays: 14,
        },
        departmentLocations: [{ departmentId: "dep-1", locationId: "loc-1" }],
        countIntervals: [{ locationId: "loc-1", days: null }],
      },
    });
    draft.reservationHoldDays = "0";
    expect(saveRequest("tenant", draft)).toHaveProperty("error");
  });
});
