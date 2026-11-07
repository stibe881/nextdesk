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

Deno.test("low-stock payload contains no item data or deep link", () => {
  const payload = buildApnsPayload({
    kind: "inventory_low_stock",
    tenantId: "00000000-0000-4000-8000-000000000001",
    notificationId: "00000000-0000-4000-8000-000000000002",
    ticketId: "00000000-0000-4000-8000-000000000003",
    subject: "Adapter A-42 · 3 Stück · Hauptlager · Lieferant Beispiel AG",
  });
  const body = payload.body as Record<string, unknown>;
  const aps = payload.aps as Record<string, unknown>;
  const alert = aps.alert as Record<string, unknown>;

  assertEquals(body.kind, "inventory_low_stock");
  assertEquals(Object.keys(body).sort(), [
    "kind",
    "nextdeskV",
    "notificationId",
    "tenantId",
  ]);
  assertFalse("ticketId" in body);
  assertFalse("contractId" in body);
  assertFalse("thread-id" in aps);
  const serialized = JSON.stringify(payload);
  for (const forbidden of [
    "Adapter",
    "A-42",
    "3 Stück",
    "Hauptlager",
    "Lieferant",
    "Beispiel AG",
  ]) {
    assertFalse(serialized.includes(forbidden));
  }
  assertStringIncludes(String(alert.title), "Lagerunterbestand");
});

Deno.test("watched ticket payload names the change and opens the ticket", () => {
  const status = buildApnsPayload({
    kind: "watched",
    tenantId: "00000000-0000-4000-8000-000000000001",
    notificationId: "n-1",
    ticketId: "00000000-0000-4000-8000-000000000003",
    ticketNumber: "ICT-2026-000028",
    subject: "Drucker",
    watchEvent: "status",
    watchStatusLabel: "In Bearbeitung",
    watchActorName: "Pascal",
  });
  const statusAlert = (status.aps as Record<string, unknown>).alert as Record<
    string,
    unknown
  >;
  assertEquals((status.body as Record<string, unknown>).ticketId,
    "00000000-0000-4000-8000-000000000003");
  assertStringIncludes(String(statusAlert.title), "In Bearbeitung");
  assertStringIncludes(String(statusAlert.body), "Pascal");

  const note = buildApnsPayload({
    kind: "watched",
    tenantId: "00000000-0000-4000-8000-000000000001",
    notificationId: "n-2",
    ticketNumber: "ICT-2026-000028",
    watchEvent: "comment",
    watchInternal: true,
  });
  const noteAlert = (note.aps as Record<string, unknown>).alert as Record<
    string,
    unknown
  >;
  assertStringIncludes(String(noteAlert.title), "interne Notiz");
});

Deno.test("ticket payloads carry the action category for watch and lock screen", () => {
  const payload = buildApnsPayload({
    kind: "assigned",
    tenantId: "00000000-0000-4000-8000-000000000001",
    notificationId: "00000000-0000-4000-8000-000000000002",
    ticketId: "00000000-0000-4000-8000-000000000003",
    subject: "Drucker",
  });
  const aps = payload.aps as Record<string, unknown>;
  assertEquals(aps.category, "NEXTDESK_TICKET");
  assertEquals(aps["thread-id"], "00000000-0000-4000-8000-000000000003");

  const summary = buildApnsPayload({
    kind: "summary",
    tenantId: "00000000-0000-4000-8000-000000000001",
    notificationId: "summary-1",
    summaryCount: 2,
  });
  assertFalse("category" in (summary.aps as Record<string, unknown>));

  const task = buildApnsPayload({
    kind: "service_task",
    tenantId: "00000000-0000-4000-8000-000000000001",
    notificationId: "00000000-0000-4000-8000-000000000002",
    occurrenceId: "00000000-0000-4000-8000-000000000004",
    subject: "Backup prüfen",
  });
  assertEquals(
    (task.aps as Record<string, unknown>).category,
    "NEXTDESK_SERVICE_TASK",
  );
});
