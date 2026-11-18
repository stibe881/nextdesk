import { assertEquals } from "jsr:@std/assert@1";
import { maintenanceOver, maintenancePauseReason } from "./monitoring-pause.ts";

const now = "2026-11-17T10:00:00.000Z";

Deno.test("maintenance pause reason names the window", () => {
  assertEquals(maintenancePauseReason("Server  Update"), "Wartungsfenster «Server Update» (automatisch)");
  assertEquals(maintenancePauseReason(""), "Wartungsfenster «Wartung» (automatisch)");
  assertEquals(maintenancePauseReason("x".repeat(400)).length <= 300, true);
});

Deno.test("maintenance is over when time ran out, ended or deleted", () => {
  assertEquals(maintenanceOver({ state: "active", ends_at: "2026-11-17T11:00:00+00:00" }, now), false);
  assertEquals(maintenanceOver({ state: "active", ends_at: "2026-11-17T09:59:00+00:00" }, now), true);
  assertEquals(maintenanceOver({ state: "completed", ends_at: "2026-11-17T11:00:00+00:00" }, now), true);
  assertEquals(maintenanceOver({ state: "cancelled", ends_at: "2026-11-17T11:00:00+00:00" }, now), true);
  assertEquals(maintenanceOver(null, now), true);
});
