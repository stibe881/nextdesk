import { assert, assertEquals } from "jsr:@std/assert@1";

import { TOKEN_PATTERN } from "../monitoring-webhook/prtg.ts";
import {
  generateToken,
  parseAction,
  parseConfig,
  webhookUrl,
} from "./index.ts";

const tenantId = "00000000-0000-4000-8000-000000000001";

Deno.test("config needs booleans and a known create-on value", () => {
  const config = parseConfig({
    enabled: true,
    teamId: "",
    createOn: "down_and_warning",
    setServiceStatus: false,
  });
  assertEquals(config?.teamId, null);
  assertEquals(
    parseConfig({
      enabled: true,
      teamId: "not-a-uuid",
      createOn: "down",
      autoResolve: true,
      setServiceStatus: false,
    }),
    null,
  );
  assertEquals(config?.createOn, "down_and_warning");
  assertEquals(
    parseConfig({
      enabled: true,
      createOn: "always",
      autoResolve: true,
      setServiceStatus: false,
    }),
    null,
  );
  assertEquals(
    parseAction({ type: "save", tenantId, config: { enabled: "yes" } }),
    null,
  );
  assertEquals(
    parseAction({ type: "rotateToken", tenantId })?.type,
    "rotateToken",
  );
  assertEquals(parseAction({ type: "drop", tenantId }), null);
});

Deno.test("old ticket settings are ignored, not required", () => {
  const config = parseConfig({
    enabled: true,
    departmentId: "00000000-0000-4000-8000-0000000000d1",
    createOn: "down",
    autoResolve: "egal",
    setServiceStatus: true,
    priorityKey: "high",
  });
  assertEquals(config !== null, true);
  assertEquals("departmentId" in (config ?? {}), false);
  assertEquals("autoResolve" in (config ?? {}), false);
  assertEquals("priorityKey" in (config ?? {}), false);
});

Deno.test("incident options default and are validated", () => {
  const base = {
    enabled: true,
    createOn: "down",
    autoResolve: true,
    setServiceStatus: true,
  };
  const defaults = parseConfig(base);
  assertEquals(defaults?.realertMinutes, 15);
  assertEquals(defaults?.groupDependencies, true);
  assertEquals(defaults?.suppressInMaintenance, true);
  const custom = parseConfig({
    ...base,
    realertMinutes: 0,
    groupDependencies: false,
    suppressInMaintenance: false,
  });
  assertEquals(custom?.realertMinutes, 0);
  assertEquals(custom?.groupDependencies, false);
  assertEquals(parseConfig({ ...base, realertMinutes: 5000 }), null);
  assertEquals(parseConfig({ ...base, groupDependencies: "ja" }), null);
});

Deno.test("tokens are url-safe and match the webhook pattern", () => {
  const token = generateToken();
  assert(TOKEN_PATTERN.test(token));
  assert(token !== generateToken());
  assertEquals(
    webhookUrl("https://abc.supabase.co/", "t0k"),
    "https://abc.supabase.co/functions/v1/monitoring-webhook?token=t0k",
  );
});

Deno.test("an alert is closed by its id", () => {
  const alertId = "00000000-0000-4000-8000-0000000000c1";
  assertEquals(
    parseAction({ type: "closeAlert", tenantId, alertId })?.type,
    "closeAlert",
  );
  assertEquals(parseAction({ type: "closeAlert", tenantId }), null);
  assertEquals(
    parseAction({ type: "closeAlert", tenantId, alertId: "x" }),
    null,
  );
});
