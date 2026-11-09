import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { notificationEmailText } from "./notification-email.ts";

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
