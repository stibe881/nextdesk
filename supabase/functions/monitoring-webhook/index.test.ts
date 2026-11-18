import { assertEquals } from "jsr:@std/assert@1";

import { INTEGRATION_COLUMNS, parseResolvedDevice } from "./index.ts";

Deno.test("resolver result: device with services and uplink chain", () => {
  assertEquals(
    parseResolvedDevice({
      assetId: "00000000-0000-4000-8000-0000000000a1",
      name: "SW-CORE",
      hostname: "sw-core.local",
      ipAddress: null,
      prtgObjectId: "2041",
      serviceIds: ["00000000-0000-4000-8000-0000000000b1", 7],
      uplinks: ["00000000-0000-4000-8000-0000000000a2"],
    }),
    {
      assetId: "00000000-0000-4000-8000-0000000000a1",
      name: "SW-CORE",
      hostname: "sw-core.local",
      ipAddress: null,
      prtgObjectId: "2041",
      serviceIds: ["00000000-0000-4000-8000-0000000000b1"],
      uplinks: ["00000000-0000-4000-8000-0000000000a2"],
    },
  );
  assertEquals(parseResolvedDevice(null), null);
  assertEquals(parseResolvedDevice({ name: "ohne Id" }), null);
  assertEquals(parseResolvedDevice([]), null);
});

Deno.test("webhook reads no ticket settings any more", () => {
  for (const column of ["department_id", "auto_resolve", "priority_key"]) {
    assertEquals(INTEGRATION_COLUMNS.includes(column), false, column);
  }
});
