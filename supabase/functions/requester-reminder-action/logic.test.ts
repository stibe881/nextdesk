import { assertEquals } from "jsr:@std/assert@1";
import { reminderActionError } from "./logic.ts";

Deno.test("known codes keep their status", () => {
  assertEquals(reminderActionError("token_used").status, 409);
  assertEquals(reminderActionError("token_expired").status, 410);
  assertEquals(reminderActionError("token_invalid").code, "token_invalid");
});

Deno.test("status rule hints are reported as status_rule", () => {
  const error = reminderActionError("ticket_assignee_required");
  assertEquals(error.code, "status_rule");
  assertEquals(error.status, 409);
});

Deno.test("unknown codes reveal nothing", () => {
  const error = reminderActionError("relation tickets does not exist");
  assertEquals(error.code, "failed");
  assertEquals(error.status, 500);
});
