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
    departmentId: "",
    teamId: "",
    createOn: "down_and_warning",
    autoResolve: true,
    setServiceStatus: false,
    priorityKey: "high",
  });
  assertEquals(config?.departmentId, null);
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
