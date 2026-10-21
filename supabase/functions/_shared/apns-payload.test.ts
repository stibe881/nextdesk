import {
  assertEquals,
  assertFalse,
  assertStringIncludes,
} from "jsr:@std/assert@1";

import { buildApnsPayload } from "./apns.ts";

Deno.test(
  "contract deadline payload is neutral and carries only the opaque contract route",
  () => {
    const payload = buildApnsPayload({
      kind: "contract_deadline",
      tenantId: "00000000-0000-4000-8000-000000000001",
      notificationId: "event-1",
      contractId: "00000000-0000-4000-8000-000000000002",
      subject: "Gegenpartei oder Vertragsname darf nicht sichtbar sein",
    });
    const body = payload.body as Record<string, unknown>;
    const aps = payload.aps as Record<string, unknown>;
    const alert = aps.alert as Record<string, unknown>;

    assertEquals(body.kind, "contract_deadline");
    assertEquals(body.contractId, "00000000-0000-4000-8000-000000000002");
    assertFalse("ticketId" in body);
    assertStringIncludes(String(alert.title), "Vertragsfrist");
    assertFalse(String(alert.body).includes("Gegenpartei"));
    assertFalse(String(alert.body).includes("Vertragsname"));
  },
);

Deno.test("summary payload is source-neutral", () => {
  const payload = buildApnsPayload({
    kind: "summary",
    tenantId: "00000000-0000-4000-8000-000000000001",
    notificationId: "summary-1",
    summaryCount: 2,
  });
  const alert = (payload.aps as Record<string, unknown>).alert as Record<
    string,
    unknown
  >;
  assertStringIncludes(String(alert.body), "2 neue Hinweise");
  assertFalse(String(alert.body).toLowerCase().includes("ticket"));
});
