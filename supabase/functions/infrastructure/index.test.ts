import { assertEquals } from "jsr:@std/assert@1";

import {
  parseAction,
  checklistItems,
  parseChecklist,
  parseDevice,
  parsePrtgObjectId,
  validIp,
  validMac,
} from "./index.ts";

const tenantId = "00000000-0000-4000-8000-000000000001";

Deno.test("ip and mac checks accept common notations", () => {
  assertEquals(validIp("10.0.0.21"), true);
  assertEquals(validIp("10.0.0.0/24"), true);
  assertEquals(validIp("10.0.0.300"), false);
  assertEquals(validIp("fe80::1"), true);
  assertEquals(validMac("00:1A:2b:3C:4d:5E"), true);
  assertEquals(validMac("001a.2b3c.4d5e"), true);
  assertEquals(validMac("001a2b3c4d5e"), false);
});

Deno.test("device needs a name and a known category", () => {
  assertEquals(parseDevice({ name: "", category: "switch" }), null);
  assertEquals(parseDevice({ name: "SW1", category: "toaster" }), null);
  const device = parseDevice({
    name: "AP Büro 1",
    category: "access_point",
    ipAddress: "10.0.0.21",
    warrantyUntil: "2028-03-31",
    maintenanceIntervalMonths: 12,
    purchasePrice: 349.9,
  });
  assertEquals(device?.category, "access_point");
  assertEquals(device?.lifecycleState, "active");
  assertEquals(device?.criticality, "medium");
  assertEquals(device?.purchasePrice, 349.9);
});

Deno.test("invalid dates and lifecycle states are rejected", () => {
  assertEquals(
    parseDevice({ name: "SRV", category: "server", warrantyUntil: "31.03.2028" }),
    null,
  );
  assertEquals(
    parseAction({
      type: "setLifecycle",
      tenantId,
      assetId: tenantId,
      state: "sold",
    }),
    null,
  );
});

Deno.test("maintenance windows need devices, services and a valid period", () => {
  const assetId = "00000000-0000-4000-8000-0000000000a1";
  const serviceId = "00000000-0000-4000-8000-0000000000b1";
  const base = {
    type: "planMaintenance",
    tenantId,
    assetIds: [assetId],
    serviceIds: [serviceId],
    title: "Firmware Core-Switch",
    startsAt: "2026-11-10T19:00:00Z",
    endsAt: "2026-11-10T21:00:00Z",
    publicEnabled: true,
  };
  assertEquals(parseAction(base)?.type, "planMaintenance");
  assertEquals(parseAction({ ...base, endsAt: "2026-11-10T18:00:00Z" }), null);
  assertEquals(parseAction({ ...base, serviceIds: [] }), null);
});

Deno.test("checklist items are trimmed and limited", () => {
  assertEquals(parseChecklist([" Firmware prüfen ", "", "Backup testen"]), [
    { label: "Firmware prüfen", date: null },
    { label: "Backup testen", date: null },
  ]);
  assertEquals(
    parseChecklist([{ label: "Konfiguration sichern", date: "2026-11-30" }]),
    [{ label: "Konfiguration sichern", date: "2026-11-30" }],
  );
  assertEquals(parseChecklist([{ label: "x", date: "30.11.2026" }]), null);
  assertEquals(
    checklistItems(["Alt", { label: "Neu", date: "2026-01-02" }, 3]),
    [{ label: "Alt", date: null }, { label: "Neu", date: "2026-01-02" }],
  );
  assertEquals(parseChecklist(new Array(41).fill("x")), null);
  assertEquals(
    parseAction({
      type: "scheduleChecklist",
      tenantId,
      assetId: tenantId,
      intervalMonths: 6,
      startsOn: "2026-12-01",
    })?.type,
    "scheduleChecklist",
  );
});

Deno.test("PRTG object id is optional and numeric", () => {
  assertEquals(parsePrtgObjectId(""), null);
  assertEquals(parsePrtgObjectId(" 2045 "), "2045");
  assertEquals(parsePrtgObjectId(2045), "2045");
  assertEquals(parsePrtgObjectId("abc"), undefined);
  assertEquals(
    parseDevice({ name: "SW1", category: "switch", prtgObjectId: "1234" })
      ?.prtgObjectId,
    "1234",
  );
  assertEquals(parseDevice({ name: "SW1", category: "switch" })?.prtgObjectId, null);
  assertEquals(
    parseDevice({ name: "SW1", category: "switch", prtgObjectId: "12a" }),
    null,
  );
});

Deno.test("a device takes several services, the old single one still works", () => {
  const a = "00000000-0000-4000-8000-0000000000b1";
  const b = "00000000-0000-4000-8000-0000000000b2";
  const device = {
    name: "Core-Switch",
    category: "switch",
    lifecycleState: "active",
    criticality: "medium",
    maintenanceChecklist: [],
  };
  assertEquals(parseDevice({ ...device, serviceIds: [a, b] })?.serviceIds, [a, b]);
  assertEquals(parseDevice({ ...device, serviceId: a })?.serviceIds, [a]);
  assertEquals(parseDevice(device)?.serviceIds, []);
  assertEquals(parseDevice({ ...device, serviceIds: [a, a] }), null);
  assertEquals(parseDevice({ ...device, serviceIds: ["x"] }), null);
});

Deno.test("a maintenance entry takes an optional time of day", () => {
  const base = {
    type: "addMaintenance",
    tenantId,
    assetId: "00000000-0000-4000-8000-0000000000a1",
    performedOn: "2026-11-10",
    note: "Firmware eingespielt",
  };
  assertEquals(parseAction(base)?.type, "addMaintenance");
  assertEquals(
    (parseAction({ ...base, performedTime: "21:30" }) as { performedTime: string })
      .performedTime,
    "21:30",
  );
  assertEquals(parseAction({ ...base, performedTime: "" }) !== null, true);
  assertEquals(parseAction({ ...base, performedTime: "25:00" }), null);
  assertEquals(parseAction({ ...base, performedTime: "9:5" }), null);
});
