import { assertEquals } from "jsr:@std/assert@1";

import { parseAction, parseDevice, validIp, validMac } from "./index.ts";

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
