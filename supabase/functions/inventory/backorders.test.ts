import {
  type BackorderEntry,
  type BackorderItem,
  groupBackorders,
  isBackorderActionType,
  parseBackorderAction,
  planBackorderAllocation,
} from "./backorders.ts";

const TENANT_ID = "00000000-0000-4000-8000-000000000001";
const ITEM_A = "00000000-0000-4000-8000-0000000000a1";
const ITEM_B = "00000000-0000-4000-8000-0000000000b1";
const BACKORDER_1 = "00000000-0000-4000-8000-000000000101";
const BACKORDER_2 = "00000000-0000-4000-8000-000000000102";

function assert(
  condition: unknown,
  message = "Assertion failed",
): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  assert(
    actualJson === expectedJson,
    `Expected ${expectedJson}, received ${actualJson}`,
  );
}

Deno.test("allocation serves backorders in order of creation", () => {
  const plan = planBackorderAllocation(
    [
      { id: "late", quantity: 1, createdAt: "2026-11-03T08:00:00Z" },
      { id: "early", quantity: 2, createdAt: "2026-11-01T08:00:00Z" },
    ],
    [{ locationId: "l1", name: "Lager", available: 2 }],
  );
  assertEquals(plan, {
    allocations: [{ backorderId: "early", locationId: "l1" }],
    waiting: ["late"],
  });
});

Deno.test(
  "a backorder that cannot be served does not block smaller later ones",
  () => {
    const plan = planBackorderAllocation(
      [
        { id: "big", quantity: 5, createdAt: "2026-11-01T08:00:00Z" },
        { id: "small", quantity: 1, createdAt: "2026-11-02T08:00:00Z" },
      ],
      [{ locationId: "l1", name: "Lager", available: 3 }],
    );
    assertEquals(plan.allocations, [
      { backorderId: "small", locationId: "l1" },
    ]);
    assertEquals(plan.waiting, ["big"]);
  },
);

Deno.test(
  "each line is served from one location with the most free stock",
  () => {
    const plan = planBackorderAllocation(
      [
        { id: "a", quantity: 2, createdAt: "2026-11-01T08:00:00Z" },
        { id: "b", quantity: 2, createdAt: "2026-11-01T09:00:00Z" },
        { id: "c", quantity: 2, createdAt: "2026-11-01T10:00:00Z" },
      ],
      [
        { locationId: "l1", name: "Zentrallager", available: 3 },
        { locationId: "l2", name: "Aussenlager", available: 3 },
      ],
    );
    // Tie on free stock: alphabetical (Aussenlager first). Afterwards one unit
    // remains in each location, which is not enough for the third line.
    assertEquals(plan.allocations, [
      { backorderId: "a", locationId: "l2" },
      { backorderId: "b", locationId: "l1" },
    ]);
    assertEquals(plan.waiting, ["c"]);
  },
);

Deno.test(
  "allocation does not mutate the given stock and ignores empty locations",
  () => {
    const locations = [
      { locationId: "l1", name: "Lager", available: 0 },
      { locationId: "l2", name: "Regal", available: 1 },
    ];
    const plan = planBackorderAllocation(
      [{ id: "a", quantity: 1, createdAt: "2026-11-01T08:00:00Z" }],
      locations,
    );
    assertEquals(plan.allocations, [{ backorderId: "a", locationId: "l2" }]);
    assertEquals(locations[1].available, 1);
  },
);

function entry(overrides: Partial<BackorderEntry>): BackorderEntry {
  return {
    id: BACKORDER_1,
    itemId: ITEM_A,
    quantity: 1,
    status: "open",
    supplier: null,
    expectedOn: null,
    note: null,
    orderId: "o1",
    orderNumber: "B-2026-000001",
    requesterName: "Erika Muster",
    createdAt: "2026-11-01T08:00:00Z",
    orderedAt: null,
    ...overrides,
  };
}

Deno.test(
  "backorders are grouped by item and supplier with missing quantity",
  () => {
    const items = new Map<string, BackorderItem>([
      [
        ITEM_A,
        {
          id: ITEM_A,
          name: "Toner",
          articleNumber: "toner",
          unit: "each",
          defaultSupplier: "Office AG",
        },
      ],
      [
        ITEM_B,
        {
          id: ITEM_B,
          name: "Maus",
          articleNumber: null,
          unit: "each",
          defaultSupplier: null,
        },
      ],
    ]);
    const groups = groupBackorders(
      [
        entry({ id: "1", quantity: 2 }),
        entry({
          id: "2",
          quantity: 3,
          supplier: "Büro Shop",
          status: "ordered",
          createdAt: "2026-11-02T08:00:00Z",
        }),
        entry({ id: "3", quantity: 1, createdAt: "2026-11-03T08:00:00Z" }),
        entry({ id: "4", itemId: ITEM_B, createdAt: "2026-11-04T08:00:00Z" }),
        entry({ id: "5", itemId: "unknown-item" }),
      ],
      items,
      new Map([[ITEM_A, [{ locationId: "l1", name: "Lager", available: 1 }]]]),
    );
    assertEquals(
      groups.map((group) => group.itemName),
      ["Toner", "Maus"],
    );
    const toner = groups[0];
    assertEquals(toner.openQuantity, 6);
    assertEquals(toner.available, 1);
    assertEquals(toner.missingQuantity, 5);
    assertEquals(toner.servableNow, 1);
    assertEquals(
      toner.suppliers.map((supplier) => [supplier.supplier, supplier.quantity]),
      [
        ["Büro Shop", 3],
        ["Office AG", 3],
      ],
    );
    assertEquals(groups[1].suppliers[0].supplier, null);
    assertEquals(groups[1].missingQuantity, 1);
  },
);

Deno.test("backorder actions are validated strictly", () => {
  assertEquals(
    parseBackorderAction({ type: "listBackorders", tenantId: TENANT_ID }),
    { type: "listBackorders", tenantId: TENANT_ID },
  );
  assert(
    parseBackorderAction({
      type: "listBackorders",
      tenantId: TENANT_ID,
      x: 1,
    }) === null,
  );
  assertEquals(
    parseBackorderAction({
      type: "manageBackorders",
      tenantId: TENANT_ID,
      operation: "order",
      backorderIds: [BACKORDER_1, BACKORDER_2.toUpperCase(), BACKORDER_1],
      supplier: "  Office AG ",
      expectedOn: "2026-11-20",
    }),
    {
      type: "manageBackorders",
      tenantId: TENANT_ID,
      operation: "order",
      backorderIds: [BACKORDER_1, BACKORDER_2],
      supplier: "Office AG",
      expectedOn: "2026-11-20",
      note: null,
    },
  );
  for (const invalid of [
    { operation: "order", backorderIds: [] },
    { operation: "order", backorderIds: ["nope"] },
    { operation: "delete", backorderIds: [BACKORDER_1] },
    {
      operation: "order",
      backorderIds: [BACKORDER_1],
      expectedOn: "2026-02-30",
    },
    {
      operation: "order",
      backorderIds: [BACKORDER_1],
      supplier: "x".repeat(161),
    },
    {
      operation: "cancel",
      backorderIds: [BACKORDER_1],
      expectedOn: "2026-11-20",
    },
  ]) {
    assert(
      parseBackorderAction({
        type: "manageBackorders",
        tenantId: TENANT_ID,
        ...invalid,
      }) === null,
      JSON.stringify(invalid),
    );
  }
  assertEquals(
    parseBackorderAction({
      type: "allocateBackorders",
      tenantId: TENANT_ID,
      itemId: ITEM_A,
    }),
    { type: "allocateBackorders", tenantId: TENANT_ID, itemId: ITEM_A },
  );
  assert(isBackorderActionType({ type: "manageBackorders" }));
  assert(!isBackorderActionType({ type: "workspace" }));
});
