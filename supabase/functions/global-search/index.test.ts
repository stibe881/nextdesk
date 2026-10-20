import { assert, assertEquals } from "jsr:@std/assert@1";

const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
const migration = await Deno.readTextFile(
  new URL(
    "../../migrations/0092_global_workspace_fulltext_search.sql",
    import.meta.url,
  ),
);

Deno.test("global search is JWT protected, bounded, and caller scoped", () => {
  assert(source.includes('auth: "user"'));
  assert(source.includes("MAX_REQUEST_BYTES"));
  assert(source.includes("MAX_QUERY_LENGTH"));
  assert(source.includes("is_active_tenant_member"));
  assert(source.includes("search_global_workspace"));
  assert(source.includes("p_limit: 40"));
  assert(migration.includes("v_knowledge_feature_enabled"));
  assert(migration.includes("v_experience_feature_enabled"));
  assert(migration.includes("entry.manager_user_id = auth.uid()"));
  assert(migration.includes("entry.ict_responsible_user_id = auth.uid()"));
  assert(!source.includes("supabaseAdmin"));
});

Deno.test(
  "global search exposes only a finite navigation result contract",
  () => {
    const resultTypes = [
      "ticket",
      "follow_up",
      "knowledge",
      "event_space",
      "onboarding",
    ];
    assertEquals(
      resultTypes.every((type) => source.includes(`"${type}"`)),
      true,
    );
    assert(source.includes("ticketId"));
    assert(source.includes("global_search_response_invalid"));
  },
);
