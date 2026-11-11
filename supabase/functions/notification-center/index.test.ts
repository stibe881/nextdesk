import { assertEquals } from "jsr:@std/assert@1";
import { parseAction } from "./index.ts";

const ID = "7f3e2a10-1234-4abc-8def-00000000ab12";

Deno.test("get resolves one notification by its opaque id", () => {
  assertEquals(parseAction({ type: "get", notificationId: ID }), {
    type: "get",
    notificationId: ID,
  });
});

Deno.test("get rejects other ids and extra fields", () => {
  assertEquals(parseAction({ type: "get", notificationId: "42" }), null);
  assertEquals(parseAction({ type: "get" }), null);
  assertEquals(
    parseAction({ type: "get", notificationId: ID, tenantId: ID }),
    null,
  );
});

Deno.test("existing actions keep their shape", () => {
  assertEquals(parseAction({ type: "list", tenantId: ID, limit: 20 }), {
    type: "list",
    tenantId: ID,
    limit: 20,
  });
  assertEquals(parseAction({ type: "markRead", notificationId: ID }), {
    type: "markRead",
    notificationId: ID,
  });
  assertEquals(parseAction({ type: "markAllRead", tenantId: ID }), {
    type: "markAllRead",
    tenantId: ID,
  });
});
