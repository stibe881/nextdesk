import { KNOWN_FEATURE_KEYS } from "./index.ts";

Deno.test(
  "tenant feature flags authorizes inventory.management for list responses",
  () => {
    if (!KNOWN_FEATURE_KEYS.has("inventory.management")) {
      throw new Error(
        "inventory.management must remain in the server-side feature allowlist",
      );
    }
  },
);

Deno.test("module keys the apps gate their navigation on are exposed", async () => {
  // A key missing here stays «disabled» in web and app although the tenant
  // switched the module on (happened with monitoring.native).
  const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  for (const key of ["assets.management", "ipam.management", "monitoring.native", "self_service.shop"]) {
    if (!source.includes(`"${key}"`)) throw new Error(`tenant-feature-flags does not expose ${key}`);
  }
});
