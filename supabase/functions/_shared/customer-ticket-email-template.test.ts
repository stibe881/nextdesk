import {
  normalizeCustomerTicketEmailBranding,
  renderCustomerTicketEmail,
  type CustomerTicketEmailBrand,
  type CustomerTicketEmailKind,
} from "./customer-ticket-email-template.ts";

const branding: CustomerTicketEmailBrand = {
  accentColor: "#1C8276",
  displayName: "Verein SONNENBERG Baar",
  logoContentId: "nextdesk-tenant-brand-logo",
  primaryColor: "#1B67C9",
  secondaryColor: "#15365F",
};

function render(kind: CustomerTicketEmailKind, text = "Bitte kurz testen.") {
  return renderCustomerTicketEmail({
    attachmentNotice: false,
    branding,
    kind,
    subject: "VPN einrichten",
    text,
    ticketNumber: "ICT-2026-000011",
  });
}

Deno.test(
  "Kundschafts-E-Mail verwendet Mandantenfarben und eine sichere Textmarke",
  () => {
    const html = renderCustomerTicketEmail({
      attachmentNotice: false,
      branding: { ...branding, logoContentId: null },
      kind: "agent_reply",
      subject: "VPN einrichten",
      text: "Kannst du es bitte kurz <testen>?",
      ticketNumber: "ICT-2026-000011",
    });
    for (const required of [
      "Neue Nachricht zu Ihrem Ticket",
      "VPN einrichten",
      "Ticket ICT-2026-000011",
      "Verein SONNENBERG Baar · Ticketbenachrichtigung über nextDesk",
      "#1B67C9",
      "#15365F",
      "#1C8276",
      "Kannst du es bitte kurz &lt;testen&gt;?",
      'role="presentation" width="640"',
    ]) {
      if (!html.includes(required))
        throw new Error(`Fehlendes E-Mail-Element: ${required}`);
    }
    if (html.includes("<testen>")) {
      throw new Error("Nachrichtentext wurde nicht HTML-escaped.");
    }
    if (
      html.includes("cid:") ||
      html.includes("https://") ||
      html.includes("http://")
    ) {
      throw new Error(
        "Die Thread-Antwort darf keine externe oder CID-Ressource laden.",
      );
    }
  },
);

Deno.test(
  "Neue Kundschafts-Mails können ein eingebettetes Mandantenlogo anzeigen",
  () => {
    const html = render("acknowledgement");
    if (!html.includes("cid:nextdesk-tenant-brand-logo")) {
      throw new Error(
        "Das sichere CID-Logo fehlt in einer neuen Kundschafts-Mail.",
      );
    }
  },
);

Deno.test(
  "Kundschafts-E-Mail escaped Ticketnummer, Betreff und Markenbezeichnung",
  () => {
    const html = renderCustomerTicketEmail({
      attachmentNotice: false,
      branding: { ...branding, displayName: "Support <Portal>" },
      kind: "agent_reply",
      subject: "VPN & <Test>",
      text: "Antwort",
      ticketNumber: "ICT-2026-<000011>",
    });
    for (const required of [
      "ICT-2026-&lt;000011&gt; · VPN &amp; &lt;Test&gt;",
      "Support &lt;Portal&gt; · Ticketbenachrichtigung über nextDesk",
    ]) {
      if (!html.includes(required)) {
        throw new Error(`Wert wurde nicht HTML-escaped: ${required}`);
      }
    }
  },
);

Deno.test(
  "Kundschafts-E-Mail unterscheidet Bestätigung, Lösung und Testmail",
  () => {
    const expectations: Array<[CustomerTicketEmailKind, string]> = [
      ["acknowledgement", "Ihre Anfrage ist eingegangen."],
      ["resolution", "Ihr Ticket wurde als gelöst markiert."],
      ["test", "Testmail erfolgreich versendet."],
    ];
    for (const [kind, text] of expectations) {
      if (!render(kind).includes(text)) {
        throw new Error(`Falscher Text für ${kind}.`);
      }
    }
  },
);

Deno.test("Kundschafts-E-Mail weist auf grosse Anhänge hin", () => {
  const html = renderCustomerTicketEmail({
    attachmentNotice: true,
    branding,
    kind: "agent_reply",
    subject: "VPN einrichten",
    text: "Antwort",
    ticketNumber: "ICT-2026-000011",
  });
  if (!html.includes("Einige Anhänge sind für den E-Mail-Versand zu gross.")) {
    throw new Error("Der Hinweis zu grossen Anhängen fehlt.");
  }
});

Deno.test(
  "Ungültige Brandingwerte fallen auf sichere Darstellung zurück",
  () => {
    const normalized = normalizeCustomerTicketEmailBranding({
      accentColor: "url(javascript:alert(1))",
      displayName: "",
      logoContentId: "cid:extern",
      primaryColor: "blue",
      secondaryColor: "#12",
    });
    if (
      normalized.primaryColor !== "#2563EB" ||
      normalized.secondaryColor !== "#0F172A" ||
      normalized.accentColor !== "#14B8A6" ||
      normalized.logoContentId !== null ||
      normalized.displayName !== "nextDesk"
    ) {
      throw new Error(
        "Ungültige Brandingwerte wurden nicht sicher normalisiert.",
      );
    }
  },
);
