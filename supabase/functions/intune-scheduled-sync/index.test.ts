import { assert, assertEquals, assertMatch } from "jsr:@std/assert@1";
import { dailyRequestId, parseTargets } from "./index.ts";

const TENANT = "11111111-1111-4111-8111-111111111111";
const ACTOR = "22222222-2222-4222-8222-222222222222";

Deno.test(
  "scheduled Intune sync: one stable request per tenant and day",
  async () => {
    const first = await dailyRequestId(TENANT, "2026-11-11");
    assertMatch(
      first,
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    assertEquals(first, await dailyRequestId(TENANT, "2026-11-11"));
    assert(first !== (await dailyRequestId(TENANT, "2026-11-12")));
  },
);

Deno.test("scheduled Intune sync: targets are parsed defensively", () => {
  assertEquals(
    parseTargets([
      { tenant_id: TENANT, actor_id: ACTOR, ipam_enabled: true },
      { tenant_id: TENANT.toUpperCase(), actor_id: null, ipam_enabled: null },
      { tenant_id: "kaputt" },
    ]),
    [
      { tenantId: TENANT, actorId: ACTOR, ipamEnabled: true },
      { tenantId: TENANT, actorId: null, ipamEnabled: false },
    ],
  );
  assertEquals(parseTargets(null), []);
});

Deno.test(
  "scheduled Intune sync: protected by the dispatch secret only",
  async () => {
    const source = await Deno.readTextFile(
      new URL("./index.ts", import.meta.url),
    );
    for (const required of [
      "verifyDispatchSecret",
      'auth: "none"',
      "intune_scheduled_sync_targets",
      "runIntuneAssetSync",
      "includeNetwork",
    ]) {
      assert(source.includes(required), `missing ${required}`);
    }
    assert(!source.includes("console.log"));
  },
);
