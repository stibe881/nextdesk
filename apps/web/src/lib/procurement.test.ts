import { describe, expect, it } from "vitest";
import {
  parseProcurementGroups,
  procurementSummary,
  unorderedBackorderIds,
} from "./procurement";
import { procurementLabel } from "./shop";

const backorder = (overrides: Record<string, unknown> = {}) => ({
  id: "b1",
  quantity: 2,
  status: "open",
  supplier: null,
  expectedOn: null,
  note: null,
  orderNumber: "B-2026-000001",
  requesterName: "Erika Muster",
  createdAt: "2026-11-01T08:00:00Z",
  orderedAt: null,
  ...overrides,
});

const response = {
  data: {
    groups: [
      {
        itemId: "i1",
        itemName: "Toner",
        articleNumber: "toner",
        unit: "each",
        available: 0,
        openQuantity: 3,
        missingQuantity: 3,
        servableNow: 0,
        suppliers: [
          {
            supplier: "Office AG",
            quantity: 3,
            backorders: [
              backorder(),
              backorder({
                id: "b2",
                quantity: 1,
                status: "ordered",
                expectedOn: "2026-11-20",
              }),
            ],
          },
        ],
      },
    ],
  },
};

describe("procurement list", () => {
  it("parses the grouped backorders", () => {
    const groups = parseProcurementGroups(response);
    expect(groups).not.toBeNull();
    const supplier = groups?.[0]?.suppliers[0];
    expect(supplier?.backorders.map((entry) => entry.id)).toEqual(["b1", "b2"]);
    expect(procurementSummary(groups!)).toEqual({
      open: 1,
      ordered: 1,
      items: 1,
    });
    expect(supplier && unorderedBackorderIds(supplier)).toEqual(["b1"]);
  });

  it("rejects incomplete answers", () => {
    expect(parseProcurementGroups(null)).toBeNull();
    expect(parseProcurementGroups({ data: {} })).toBeNull();
    expect(
      parseProcurementGroups({
        data: {
          groups: [
            {
              ...response.data.groups[0],
              suppliers: [
                {
                  supplier: null,
                  quantity: 1,
                  backorders: [backorder({ status: "received" })],
                },
              ],
            },
          ],
        },
      }),
    ).toBeNull();
  });
});

describe("procurement label on shop order lines", () => {
  it("shows the expected delivery date when known", () => {
    expect(
      procurementLabel({
        status: "backorder",
        procurement: { status: "ordered", expectedOn: "2026-11-20" },
      }),
    ).toBe("Wird beschafft, voraussichtlich am 20.11.2026");
  });

  it("falls back to «Wird beschafft» without a date", () => {
    expect(
      procurementLabel({
        status: "backorder",
        procurement: { status: "open", expectedOn: null },
      }),
    ).toBe("Wird beschafft");
    expect(procurementLabel({ status: "backorder" })).toBe("Wird beschafft");
  });

  it("is empty for lines in stock", () => {
    expect(
      procurementLabel({
        status: "reserved",
        procurement: { status: "ordered", expectedOn: "2026-11-20" },
      }),
    ).toBeNull();
  });
});
