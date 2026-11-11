import { assertEquals } from "jsr:@std/assert@1";
import {
  isAutomationActionType,
  nextCountDue,
  parseAutomationAction,
} from "./automation.ts";

const TENANT = "11111111-1111-4111-8111-111111111111";
const LOCATION = "22222222-2222-4222-8222-222222222222";
const DEPARTMENT = "33333333-3333-4333-8333-333333333333";
const REQUEST = "44444444-4444-4444-8444-444444444444";

Deno.test("automation: action types are recognised", () => {
  assertEquals(
    isAutomationActionType({ type: "getInventoryAutomation" }),
    true,
  );
  assertEquals(isAutomationActionType({ type: "workspace" }), false);
  assertEquals(
    parseAutomationAction({ type: "getInventoryAutomation", tenantId: TENANT }),
    { type: "getInventoryAutomation", tenantId: TENANT },
  );
  assertEquals(
    parseAutomationAction({
      type: "getInventoryAutomation",
      tenantId: TENANT,
      extra: 1,
    }),
    null,
  );
});

Deno.test("automation: settings are validated", () => {
  const valid = {
    type: "saveInventoryAutomation",
    tenantId: TENANT,
    settings: {
      defaultReturnLocationId: LOCATION,
      reorderNotify: true,
      reorderCreateTask: false,
      reservationHoldDays: 14,
    },
    departmentLocations: [{ departmentId: DEPARTMENT, locationId: null }],
    countIntervals: [{ locationId: LOCATION, days: 90 }],
  };
  assertEquals(parseAutomationAction(valid), {
    type: "saveInventoryAutomation",
    tenantId: TENANT,
    settings: {
      defaultReturnLocationId: LOCATION,
      reorderNotify: true,
      reorderCreateTask: false,
      reservationHoldDays: 14,
    },
    departmentLocations: [{ departmentId: DEPARTMENT, locationId: null }],
    countIntervals: [{ locationId: LOCATION, days: 90 }],
  });
  assertEquals(
    parseAutomationAction({
      ...valid,
      settings: { ...valid.settings, reservationHoldDays: 0 },
    }),
    null,
  );
  assertEquals(
    parseAutomationAction({
      ...valid,
      countIntervals: [{ locationId: LOCATION, days: 3 }],
    }),
    null,
  );
  assertEquals(
    parseAutomationAction({
      ...valid,
      departmentLocations: [
        { departmentId: DEPARTMENT, locationId: LOCATION },
        { departmentId: DEPARTMENT, locationId: null },
      ],
    }),
    null,
  );
});

Deno.test("automation: reorder requests and count due dates", () => {
  assertEquals(
    parseAutomationAction({
      type: "manageReorderRequest",
      tenantId: TENANT,
      requestId: REQUEST,
      status: "ordered",
      note: "  Bei Lieferant bestellt ",
    }),
    {
      type: "manageReorderRequest",
      tenantId: TENANT,
      requestId: REQUEST,
      status: "ordered",
      note: "Bei Lieferant bestellt",
    },
  );
  assertEquals(
    parseAutomationAction({
      type: "manageReorderRequest",
      tenantId: TENANT,
      requestId: REQUEST,
      status: "open",
    }),
    null,
  );
  assertEquals(
    nextCountDue("2026-01-10T08:00:00Z", "2025-01-01T00:00:00Z", 30),
    "2026-02-09",
  );
  assertEquals(nextCountDue(null, "2026-01-01T00:00:00Z", 7), "2026-01-08");
  assertEquals(nextCountDue(null, "2026-01-01T00:00:00Z", null), null);
});
