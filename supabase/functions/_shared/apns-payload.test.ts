import {
  assertEquals,
  assertFalse,
  assertStringIncludes,
} from "jsr:@std/assert@1";

import { APNS_REQUESTER_REMINDER_CATEGORY, buildApnsPayload } from "./apns.ts";

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

Deno.test("requester reminder carries the action category and ticket route", () => {
  const payload = buildApnsPayload({
    kind: "requester_reminder",
    tenantId: "00000000-0000-4000-8000-000000000001",
    notificationId: "reminder-1",
    ticketId: "00000000-0000-4000-8000-000000000003",
    ticketNumber: "ICT-2026-000042",
  });
  const aps = payload.aps as Record<string, unknown>;
  const body = payload.body as Record<string, unknown>;
  const alert = aps.alert as Record<string, unknown>;
  assertEquals(aps.category, APNS_REQUESTER_REMINDER_CATEGORY);
  assertEquals(body.ticketId, "00000000-0000-4000-8000-000000000003");
  assertEquals(body.kind, "requester_reminder");
  assertStringIncludes(String(alert.body), "ICT-2026-000042");
  const other = buildApnsPayload({
    kind: "support_reply",
    tenantId: "00000000-0000-4000-8000-000000000001",
    notificationId: "reply-1",
    ticketId: "00000000-0000-4000-8000-000000000003",
  });
  assertFalse("category" in (other.aps as Record<string, unknown>));
});

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

Deno.test("low-stock payload contains no item names or details", () => {
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
  for (
    const forbidden of [
      "Adapter",
      "A-42",
      "3 Stück",
      "Hauptlager",
      "Lieferant",
      "Beispiel AG",
    ]
  ) {
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
  assertEquals(
    (status.body as Record<string, unknown>).ticketId,
    "00000000-0000-4000-8000-000000000003",
  );
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

  const reminder = buildApnsPayload({
    kind: "requester_reminder",
    tenantId: "00000000-0000-4000-8000-000000000001",
    notificationId: "00000000-0000-4000-8000-000000000002",
    ticketId: "00000000-0000-4000-8000-000000000003",
  });
  assertEquals(
    (reminder.aps as Record<string, unknown>).category,
    "NEXTDESK_REQUESTER_REMINDER",
  );

  const reply = buildApnsPayload({
    kind: "support_reply",
    tenantId: "00000000-0000-4000-8000-000000000001",
    notificationId: "00000000-0000-4000-8000-000000000002",
    ticketId: "00000000-0000-4000-8000-000000000003",
  });
  assertFalse("category" in (reply.aps as Record<string, unknown>));

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

Deno.test("infrastructure reminders name device, reason and date", () => {
  const payload = buildApnsPayload({
    kind: "infrastructure",
    tenantId: "00000000-0000-4000-8000-000000000001",
    notificationId: "00000000-0000-4000-8000-000000000002",
    assetId: "00000000-0000-4000-8000-000000000003",
    assetName: "Core-Switch",
    infrastructureReason: "warranty",
    dueOn: "2999-03-31",
  });
  const aps = payload.aps as { alert: { title: string; body: string } };
  assertEquals(aps.alert.title, "Garantie läuft ab");
  assertEquals(aps.alert.body, "Core-Switch: Garantie endet am 31.03.2999.");
  assertEquals(
    (payload.body as Record<string, unknown>).assetId,
    "00000000-0000-4000-8000-000000000003",
  );
});

Deno.test("rule reminders name the rule and open the ticket", () => {
  const payload = buildApnsPayload({
    kind: "rule_reminder",
    tenantId: "00000000-0000-4000-8000-000000000001",
    notificationId: "00000000-0000-4000-8000-000000000002",
    ticketId: "00000000-0000-4000-8000-000000000003",
    ticketNumber: "ICT-42",
    ruleName: "Seit 4 h keine Antwort",
  });
  const aps = payload.aps as { alert: { title: string; body: string } };
  assertEquals(aps.alert.title, "Erinnerung: Seit 4 h keine Antwort");
  assertStringIncludes(aps.alert.body, "ICT-42");
  assertEquals(
    (payload.body as Record<string, unknown>).ticketId,
    "00000000-0000-4000-8000-000000000003",
  );
});

Deno.test("vendor reminders and finished child tickets open the ticket", () => {
  const reminder = buildApnsPayload({
    kind: "vendor_reminder",
    tenantId: "00000000-0000-4000-8000-000000000001",
    notificationId: "00000000-0000-4000-8000-000000000002",
    ticketId: "00000000-0000-4000-8000-000000000003",
    ticketNumber: "ICT-7",
    vendorName: "Swisscom",
  });
  const reminderAlert = (reminder.aps as { alert: { title: string; body: string } })
    .alert;
  assertEquals(reminderAlert.title, "Drittanbieter nachfassen");
  assertStringIncludes(reminderAlert.body, "Swisscom");
  assertStringIncludes(reminderAlert.body, "ICT-7");
  const done = buildApnsPayload({
    kind: "children_done",
    tenantId: "00000000-0000-4000-8000-000000000001",
    notificationId: "00000000-0000-4000-8000-000000000004",
    ticketId: "00000000-0000-4000-8000-000000000003",
    ticketNumber: "ICT-7",
  });
  const doneAlert = (done.aps as { alert: { title: string; body: string } }).alert;
  assertEquals(doneAlert.title, "Teil-Tickets erledigt");
  assertEquals(
    (done.body as Record<string, unknown>).ticketId,
    "00000000-0000-4000-8000-000000000003",
  );
});

Deno.test("customer praise names the requester and opens the ticket", () => {
  const payload = buildApnsPayload({
    kind: "kudos",
    tenantId: "00000000-0000-4000-8000-000000000001",
    notificationId: "00000000-0000-4000-8000-000000000002",
    ticketId: "00000000-0000-4000-8000-000000000003",
    ticketNumber: "ICT-9",
    kudosRequesterName: "Anna Muster",
    kudosScore: 5,
  });
  const alert = (payload.aps as { alert: { title: string; body: string } }).alert;
  assertEquals(alert.title, "Lob von Kund:innen");
  assertStringIncludes(alert.body, "Anna Muster");
  assertStringIncludes(alert.body, "ICT-9");
  assertStringIncludes(alert.body, "5/5");
  assertEquals(
    (payload.body as Record<string, unknown>).ticketId,
    "00000000-0000-4000-8000-000000000003",
  );
});

Deno.test("phishing reports alert the security team", () => {
  const payload = buildApnsPayload({
    kind: "security_report",
    tenantId: "00000000-0000-4000-8000-000000000001",
    notificationId: "00000000-0000-4000-8000-000000000005",
    ticketId: "00000000-0000-4000-8000-000000000006",
    ticketNumber: "SEC-3",
  });
  const alert = (payload.aps as { alert: { title: string; body: string } }).alert;
  assertEquals(alert.title, "Phishing-Meldung");
  assertStringIncludes(alert.body, "SEC-3");
});

Deno.test("IP address notifications open the address or the device", () => {
  const payload = buildApnsPayload({
    kind: "ipam",
    tenantId: "00000000-0000-4000-8000-000000000001",
    notificationId: "00000000-0000-4000-8000-000000000007",
    ipamEvent: "reservation_expiring",
    ipamNumber: "10.1.2.3",
    ipamAddress: "10.1.2.3",
    ipamTitle: "DRU-01",
    dueOn: "2026-11-14",
  });
  const alert = (payload.aps as { alert: { title: string; body: string } })
    .alert;
  assertEquals(alert.title, "Reservierung läuft ab");
  assertStringIncludes(alert.body, "14.11.2026");
  const body = payload.body as Record<string, unknown>;
  assertEquals(body.kind, "ipam");
  assertEquals(body.ipamAddress, "10.1.2.3");
  assertEquals(body.ticketId, undefined);

  const offline = buildApnsPayload({
    kind: "ipam",
    tenantId: "00000000-0000-4000-8000-000000000001",
    notificationId: "00000000-0000-4000-8000-000000000008",
    ipamEvent: "agent_offline",
    ipamAgentName: "Agent Baar",
  });
  assertEquals(
    (offline.aps as { alert: { title: string } }).alert.title,
    "Netzwerkagent offline",
  );
});

Deno.test("security cases, shop and inventory reminders have own texts", () => {
  const alert = (input: Parameters<typeof buildApnsPayload>[0]) =>
    (buildApnsPayload(input).aps as { alert: { title: string; body: string } })
      .alert;
  const base = {
    tenantId: "00000000-0000-4000-8000-000000000001",
    notificationId: "00000000-0000-4000-8000-000000000009",
  };
  assertEquals(
    alert({ ...base, kind: "security_report", securityEvent: "overdue", ticketNumber: "SEC-4" }).title,
    "Sicherheitsfall überfällig",
  );
  assertStringIncludes(
    alert({ ...base, kind: "security_report", securityEvent: "campaign", securityCount: 3 }).body,
    "3 Personen",
  );
  assertEquals(
    alert({ ...base, kind: "shop", shopEvent: "loan_due", orderNumber: "B-7" }).title,
    "Ausleihe endet bald",
  );
  assertEquals(
    alert({ ...base, kind: "shop", shopEvent: "loan_overdue", shopEscalated: true }).title,
    "Ausleihe im Team überfällig",
  );
  assertEquals(
    alert({ ...base, kind: "inventory_low_stock", inventoryEvent: "count_due" }).title,
    "Inventur fällig",
  );
});

Deno.test("payload carries the exact kind and the ids the app opens", () => {
  const base = {
    tenantId: "00000000-0000-4000-8000-000000000001",
    notificationId: "00000000-0000-4000-8000-000000000002",
  };
  const itemId = "00000000-0000-4000-8000-000000000010";
  const locationId = "00000000-0000-4000-8000-000000000011";
  const body = (input: Parameters<typeof buildApnsPayload>[0]) =>
    buildApnsPayload(input).body as Record<string, unknown>;

  const reorder = body({
    ...base,
    kind: "inventory_low_stock",
    notificationKind: "inventory.reorder",
    inventoryEvent: "reorder",
    inventoryItemId: itemId,
  });
  assertEquals(reorder.notificationKind, "inventory.reorder");
  assertEquals(reorder.inventoryItemId, itemId);
  assertFalse("inventoryLocationId" in reorder);

  const count = body({
    ...base,
    kind: "inventory_low_stock",
    notificationKind: "inventory.count_due",
    inventoryLocationId: locationId,
  });
  assertEquals(count.inventoryLocationId, locationId);

  // Only UUIDs and plain kinds, never names or paths.
  const invalid = body({
    ...base,
    kind: "inventory_low_stock",
    notificationKind: "Inventory Count",
    inventoryItemId: "../x",
  });
  assertFalse("inventoryItemId" in invalid);
  assertFalse("notificationKind" in invalid);

  const task = body({
    ...base,
    kind: "service_task",
    notificationKind: "service_task.overdue",
    occurrenceId: itemId,
  });
  assertEquals(task.occurrenceId, itemId);
  assertEquals(task.notificationKind, "service_task.overdue");

  const summary = body({
    ...base,
    kind: "summary",
    notificationKind: "ticket.assigned",
    summaryCount: 2,
  });
  assertFalse("notificationKind" in summary);
});

Deno.test("push texts follow the tenant's form of address", () => {
  const input = {
    kind: "approval" as const,
    tenantId: "00000000-0000-4000-8000-000000000001",
    notificationId: "event-1",
    ticketNumber: "NX-1",
  };
  const text = (formality?: "du" | "sie") =>
    (
      (formality
        ? buildApnsPayload(input, formality)
        : buildApnsPayload(input)
      ).aps as { alert: { body: string } }
    ).alert.body;

  assertEquals(text(), "Für NX-1 wird deine Freigabe benötigt.");
  assertEquals(text("du"), "Für NX-1 wird deine Freigabe benötigt.");
  assertEquals(text("sie"), "Für NX-1 wird Ihre Freigabe benötigt.");
});

Deno.test("Die Zahl auf dem App-Symbol (badge) wird nur für gültige Zahlen gesetzt", () => {
  const base = {
    kind: "test" as const,
    tenantId: "11111111-1111-4111-8111-111111111111",
    notificationId: "22222222-2222-4222-8222-222222222222",
  };
  const withBadge = buildApnsPayload({ ...base, badge: 7 }) as {
    aps: Record<string, unknown>;
  };
  if (withBadge.aps.badge !== 7) throw new Error("badge fehlt");
  const clamped = buildApnsPayload({ ...base, badge: 123456 }) as {
    aps: Record<string, unknown>;
  };
  if (clamped.aps.badge !== 9999) throw new Error("badge nicht begrenzt");
  for (const badge of [undefined, -1, 1.5, Number.NaN]) {
    const payload = buildApnsPayload({ ...base, badge }) as {
      aps: Record<string, unknown>;
    };
    if ("badge" in payload.aps) throw new Error("ungültiges badge gesetzt");
  }
});
