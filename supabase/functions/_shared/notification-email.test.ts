import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import {
  notificationEmailText,
  notificationLinkUrl,
} from "./notification-email.ts";

Deno.test("ticket notification mails name the ticket", () => {
  const mail = notificationEmailText({
    kind: "ticket.assigned",
    payload: {},
    ticketNumber: "ICT-2026-000041",
    ticketSubject: "Laptop startet nicht",
  });
  assertEquals(mail.subject, "[ICT-2026-000041] Ticket zugewiesen");
  assertStringIncludes(mail.body, "Ihnen wurde ein Ticket zugewiesen.");
  assertStringIncludes(mail.body, "ICT-2026-000041 · Laptop startet nicht");
});

Deno.test("shop, infrastructure and unknown events", () => {
  assertEquals(
    notificationEmailText({
      kind: "shop.order.ready",
      payload: { orderNumber: "B-0042" },
      ticketNumber: null,
      ticketSubject: null,
    }).subject,
    "Bereit zur Abholung: B-0042",
  );
  assertStringIncludes(
    notificationEmailText({
      kind: "infrastructure.due",
      payload: {
        assetName: "SW-CORE-01",
        reason: "warranty",
        dueOn: "2026-12-31",
      },
      ticketNumber: null,
      ticketSubject: null,
    }).body,
    "Die Garantie von SW-CORE-01 ist fällig (31.12.2026).",
  );
  assertEquals(
    notificationEmailText({
      kind: "something.new",
      payload: {},
      ticketNumber: null,
      ticketSubject: null,
    }).subject,
    "Benachrichtigung",
  );
});

Deno.test("Phishing: eigene Texte für neue Meldung und «Melder hat geklickt»", () => {
  const reported = notificationEmailText({
    kind: "ticket.security_report",
    payload: { riskLabel: "hoch", riskScore: 82 },
    ticketNumber: "ICT-1",
    ticketSubject: "Phishing-Meldung: Test",
  });
  if (!reported.message.includes("Sicherheitsfälle") || !reported.message.includes("hoch (82)")) {
    throw new Error(`Meldungstext falsch: ${reported.message}`);
  }
  const clicked = notificationEmailText({
    kind: "ticket.security_report",
    payload: { event: "clicked", reporterEmail: "anna@muster.ch" },
    ticketNumber: "ICT-1",
    ticketSubject: "Phishing-Meldung: Test",
  });
  if (clicked.title !== "Melder hat geklickt" || !clicked.message.includes("anna@muster.ch")) {
    throw new Error(`Klicktext falsch: ${clicked.title} ${clicked.message}`);
  }
  if (clicked.message.includes("Sie erhalten diese E-Mail") || !clicked.body.includes("Sie erhalten diese E-Mail")) {
    throw new Error("Hinweis gehört nur in body/hint");
  }
});

Deno.test("IP address management mails are not incidents", () => {
  const finding = notificationEmailText({
    kind: "ipam.finding",
    payload: {
      number: "10.20.30.0/24",
      title: "Subnetz zu 92 % belegt",
      severity: "warning",
    },
    ticketNumber: null,
    ticketSubject: null,
  });
  assertEquals(finding.title, "IP-Adressverwaltung");
  assertStringIncludes(finding.message, "10.20.30.0/24: Subnetz zu 92 % belegt");
  const legacy = notificationEmailText({
    kind: "monitoring.ipam_finding",
    payload: { number: "10.1.1.5", title: "IP-Konflikt", severity: "critical" },
    ticketNumber: null,
    ticketSubject: null,
  });
  assertEquals(legacy.title, "IP-Adressverwaltung: kritischer Fund");
  assertStringIncludes(
    notificationEmailText({
      kind: "ipam.reservation_expiring",
      payload: { number: "10.1.1.6", reservedUntil: "2026-11-14" },
      ticketNumber: null,
      ticketSubject: null,
    }).message,
    "14.11.2026",
  );
});

Deno.test("security, shop and inventory reminders", () => {
  const text = (kind: string, payload: Record<string, unknown> = {}) =>
    notificationEmailText({ kind, payload, ticketNumber: null, ticketSubject: null });
  assertEquals(text("security.case_overdue").title, "Sicherheitsfall überfällig");
  assertStringIncludes(
    text("security.campaign", { reporterCount: 5 }).message,
    "5 Personen",
  );
  assertEquals(text("shop.order.loan_overdue").title, "Ausleihe überfällig");
  assertEquals(text("inventory.count_due").title, "Inventur fällig");
});

Deno.test("notification mail button opens the notification", () => {
  assertEquals(
    notificationLinkUrl(
      "https://app.nextdesk.ch",
      "7F3E2A10-0000-4000-8000-00000000AB12",
    ),
    "https://app.nextdesk.ch/?benachrichtigung=7f3e2a10-0000-4000-8000-00000000ab12",
  );
  // Only an opaque id; anything else falls back to the start page.
  assertEquals(
    notificationLinkUrl("https://app.nextdesk.ch", "../tickets?x=1"),
    "https://app.nextdesk.ch/",
  );
  assertEquals(
    notificationLinkUrl("https://app.nextdesk.ch", null),
    "https://app.nextdesk.ch/",
  );
});

Deno.test("Teams-Bestellung: Texte für bereit, bald ablaufend und archiviert", () => {
  const base = { ticketNumber: null, ticketSubject: null };
  const expiring = notificationEmailText({
    ...base,
    kind: "shop.order.team_expiring",
    payload: { teamName: "Projekt Neubau", endDate: "2027-11-30", daysLeft: 7 },
  });
  assertEquals(expiring.title, "Team läuft in 7 Tagen ab: Projekt Neubau");
  assertStringIncludes(expiring.message, "30.11.2027");
  assertStringIncludes(expiring.message, "1, 3, 6 oder 12 Monate");

  const tomorrow = notificationEmailText({
    ...base,
    kind: "shop.order.team_expiring",
    payload: { teamName: "X", daysLeft: 1 },
  });
  assertStringIncludes(tomorrow.title, "morgen");

  const ready = notificationEmailText({
    ...base,
    kind: "shop.order.team_ready",
    payload: { teamName: "Projekt Neubau", warnings: 2 },
  });
  assertStringIncludes(ready.message, "nicht ergänzt");

  const archived = notificationEmailText({
    ...base,
    kind: "shop.order.team_archived",
    payload: { teamName: "Projekt Neubau" },
  });
  assertStringIncludes(archived.message, "archiviert");
});
