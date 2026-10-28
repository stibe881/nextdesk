import { KNOWN_FEATURE_KEYS } from "./index.ts";

Deno.test("tenant feature flags authorizes inventory.management for list responses", () => {
  if (!KNOWN_FEATURE_KEYS.has("inventory.management")) {
    throw new Error(
      "inventory.management must remain in the server-side feature allowlist",
    );
  }
});
