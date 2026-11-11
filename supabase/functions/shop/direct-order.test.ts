import { assertEquals } from "jsr:@std/assert@1";
import { parseDirectOrder } from "./direct-order.ts";

const REQUEST = "11111111-1111-4111-8111-111111111111";
const PERSON = "22222222-2222-4222-8222-222222222222";
const ITEM = "33333333-3333-4333-8333-333333333333";
const CASE = "44444444-4444-4444-8444-444444444444";

Deno.test("direct order: replacement device from a security case", () => {
  const parsed = parseDirectOrder({
    type: "placeOrderWithoutApproval",
    tenantId: "55555555-5555-4555-8555-555555555555",
    clientRequestId: REQUEST,
    requesterId: PERSON,
    lines: [{ catalogItemId: ITEM, quantity: 1 }],
    reason: "Ersatzgerät nach Phishing",
    deliveryMethod: "desk",
    deliveryLocation: "Büro 2.14",
    source: { type: "security_case", id: CASE, reference: "SEC-2026-000123" },
  });
  assertEquals(parsed, {
    clientRequestId: REQUEST,
    requesterId: PERSON,
    entraObjectId: null,
    lines: [
      { catalog_item_id: ITEM, quantity: 1, loan_from: null, loan_until: null },
    ],
    reason: "Ersatzgerät nach Phishing",
    comment: null,
    deliveryMethod: "desk",
    deliveryLocation: "Büro 2.14",
    neededBy: null,
    source: { type: "security_case", id: CASE, reference: "SEC-2026-000123" },
  });
});

Deno.test("direct order: Entra person and loan period", () => {
  const parsed = parseDirectOrder({
    clientRequestId: REQUEST,
    requesterId: `entra:${PERSON.toUpperCase()}`,
    lines: [
      {
        catalogItemId: ITEM,
        quantity: 1,
        loanFrom: "2026-11-12",
        loanUntil: "2026-11-20",
      },
    ],
    reason: "Leihgerät",
  });
  assertEquals(parsed?.entraObjectId, PERSON);
  assertEquals(parsed?.lines[0].loan_until, "2026-11-20");
  assertEquals(parsed?.deliveryMethod, "pickup");
});

Deno.test("direct order: invalid requests are rejected", () => {
  const base = {
    clientRequestId: REQUEST,
    requesterId: PERSON,
    lines: [{ catalogItemId: ITEM, quantity: 1 }],
    reason: "Ersatzgerät",
  };
  assertEquals(parseDirectOrder({ ...base, reason: "x" }), null);
  assertEquals(parseDirectOrder({ ...base, requesterId: "nobody" }), null);
  assertEquals(parseDirectOrder({ ...base, lines: [] }), null);
  assertEquals(
    parseDirectOrder({
      ...base,
      lines: [
        { catalogItemId: ITEM, quantity: 1 },
        { catalogItemId: ITEM, quantity: 2 },
      ],
    }),
    null,
  );
  assertEquals(
    parseDirectOrder({
      ...base,
      lines: [{ catalogItemId: ITEM, quantity: 0 }],
    }),
    null,
  );
  assertEquals(
    parseDirectOrder({ ...base, source: { type: "ticket", id: CASE } }),
    null,
  );
  assertEquals(
    parseDirectOrder({
      ...base,
      source: { type: "security_case", id: CASE, reference: "x".repeat(61) },
    }),
    null,
  );
  assertEquals(parseDirectOrder({ ...base, neededBy: "2026-02-30" }), null);
});
