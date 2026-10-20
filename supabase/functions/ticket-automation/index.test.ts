import { assert, assertEquals } from "jsr:@std/assert@1";

const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

Deno.test(
  "ticket automation executes only the server-held current confirmation",
  () => {
    assert(source.includes('type: "executeAutoClose"'));
    assert(source.includes('"execute_ticket_automation_auto_close"'));
    assert(!source.includes("action.ticketIds"));
    assert(!source.includes("confirmationId"));
    assert(!source.includes("confirmed: true"));
  },
);

Deno.test(
  "ticket automation creates a bound confirmation only for the eight previewed tickets",
  () => {
    assert(source.includes("autoClose.examples.map((ticket) => ticket.id)"));
    assert(source.includes('"prepare_ticket_automation_auto_close"'));
    assert(source.includes("autoClose.requirePreview"));
    assert(!source.includes("id: row.confirmation_id"));
  },
);

Deno.test("ticket automation records only aggregate preview history", () => {
  assert(source.includes("safePreviewSummary"));
  assert(source.includes("candidateCount"));
  assertEquals(source.includes("result: { previews }"), false);
});

Deno.test(
  "ticket automation never allows auto-close to disable preview confirmation",
  () => {
    assert(source.includes('action.policyKey === "auto_close" ? true'));
    assert(source.includes('row.policy_key === "auto_close" ? true'));
  },
);

Deno.test("ticket automation requires a tenant-scoped automation role", () => {
  assert(source.includes("active, scope, role_permissions"));
  assert(source.includes('role?.scope === "tenant"'));
});
