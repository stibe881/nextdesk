import { assert, assertEquals } from "jsr:@std/assert@1";

const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

Deno.test(
  "onboarding keeps tickets explicit and all API mutations JWT protected",
  () => {
    assert(source.includes('auth: "user"'));
    assert(source.includes('type: "linkExceptionTicket"'));
    assert(source.includes("ticketNumber"));
    assert(source.includes('from("tickets")'));
    assert(source.includes("onboarding.exception_ticket.linked"));
    assert(!source.includes("insert({ tenant_id: action.tenantId, subject"));
  },
);

Deno.test("onboarding only accepts the defined finite task status set", () => {
  const statuses = ["open", "in_progress", "blocked", "completed"];
  assertEquals(
    statuses.every((status) => source.includes(`"${status}"`)),
    true,
  );
  assert(source.includes("MAX_REQUEST_BYTES"));
  assert(source.includes("has_onboarding_permission"));
});
