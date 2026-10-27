import {
  renderCustomerTicketEmail,
  type CustomerTicketEmailKind,
} from "./customer-ticket-email-template.ts";

function render(kind: CustomerTicketEmailKind, text = "Bitte kurz testen.") {
  return renderCustomerTicketEmail({
    attachmentNotice: false,
    kind,
    portalName: "Sonnenberg Support",
    subject: "VPN einrichten",
    text,
    ticketNumber: "ICT-2026-000011",
  });
}

Deno.test("Kundschafts-E-Mail stellt eine Antwort klar und sicher dar", () => {
  const html = render("agent_reply", "Kannst du es bitte kurz <testen>?");
  for (const required of [
    "Antwort zu Ihrem Ticket",
    "Neue Nachricht",
    "ICT-2026-000011 · VPN einrichten",
    "Sie können direkt auf diese E-Mail antworten.",
    "Kannst du es bitte kurz &lt;testen&gt;?",
    'style="padding:24px 32px;background:#245fd5;"',
    'role="presentation" width="640"',
  ]) {
    if (!html.includes(required))
      throw new Error(`Fehlendes E-Mail-Element: ${required}`);
  }
  if (html.includes("<testen>")) {
    throw new Error("Nachrichtentext wurde nicht HTML-escaped.");
  }
});

Deno.test("Kundschafts-E-Mail escaped Ticketnummer und Betreff", () => {
  const html = renderCustomerTicketEmail({
    attachmentNotice: false,
    kind: "agent_reply",
    portalName: "Sonnenberg Support",
    subject: "VPN & <Test>",
    text: "Antwort",
    ticketNumber: "ICT-2026-<000011>",
  });
  if (!html.includes("ICT-2026-&lt;000011&gt; · VPN &amp; &lt;Test&gt;")) {
    throw new Error("Ticketnummer oder Betreff wurden nicht HTML-escaped.");
  }
});

Deno.test(
  "Kundschafts-E-Mail unterscheidet Bestätigung, Lösung und Testmail",
  () => {
    const expectations: Array<[CustomerTicketEmailKind, string]> = [
      ["acknowledgement", "Ihre Anfrage ist eingegangen"],
      ["resolution", "Ihr Ticket wurde als gelöst markiert"],
      ["test", "Testmail erfolgreich versendet"],
    ];
    for (const [kind, heading] of expectations) {
      if (!render(kind).includes(heading)) {
        throw new Error(`Falsche Überschrift für ${kind}.`);
      }
    }
  },
);

Deno.test(
  "Kundschafts-E-Mail rendert keine externen Ressourcen und weist auf grosse Anhänge hin",
  () => {
    const html = renderCustomerTicketEmail({
      attachmentNotice: true,
      kind: "agent_reply",
      portalName: "Support <Portal>",
      subject: "VPN einrichten",
      text: "Antwort",
      ticketNumber: "ICT-2026-000011",
    });
    if (
      !html.includes("Einige Anhänge sind für den E-Mail-Versand zu gross.")
    ) {
      throw new Error("Der Hinweis zu grossen Anhängen fehlt.");
    }
    if (html.includes("https://") || html.includes("http://")) {
      throw new Error("Die Vorlage darf keine externen Ressourcen laden.");
    }
    if (!html.includes("Support &lt;Portal&gt;")) {
      throw new Error("Der Portalname wurde nicht HTML-escaped.");
    }
  },
);
