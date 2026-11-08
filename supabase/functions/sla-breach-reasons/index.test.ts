import { assertEquals } from "jsr:@std/assert@1";
import { parseAction } from "./index.ts";

const TENANT = "11111111-1111-4111-8111-111111111111";
const TICKET = "22222222-2222-4222-8222-222222222222";

Deno.test("parses list and record actions", () => {
  assertEquals(parseAction({ type: "list", tenantId: TENANT, ticketId: TICKET }), {
    type: "list",
    tenantId: TENANT,
    ticketId: TICKET,
  });
  assertEquals(
    parseAction({
      type: "record",
      tenantId: TENANT,
      ticketId: TICKET,
      reasonCode: "third_party",
      kinds: ["resolution", "resolution"],
      note: "  Swisscom   Störung ",
    }),
    {
      type: "record",
      tenantId: TENANT,
      ticketId: TICKET,
      kinds: ["resolution"],
      reasonCode: "third_party",
      note: "Swisscom Störung",
    },
  );
});

Deno.test("rejects invalid reasons", () => {
  const base = { type: "record", tenantId: TENANT, ticketId: TICKET };
  assertEquals(parseAction({ ...base, reasonCode: "lazy" }), null);
  // «Sonstiges» needs a note.
  assertEquals(parseAction({ ...base, reasonCode: "other" }), null);
  assertEquals(parseAction({ ...base, reasonCode: "other", note: "   " }), null);
  assertEquals(parseAction({ ...base, reasonCode: "capacity", kinds: [] }), null);
  assertEquals(parseAction({ ...base, reasonCode: "capacity", kinds: ["x"] }), null);
  assertEquals(
    parseAction({ ...base, reasonCode: "capacity", note: "x".repeat(501) }),
    null,
  );
  assertEquals(parseAction({ ...base, tenantId: "nope", reasonCode: "capacity" }), null);
});
