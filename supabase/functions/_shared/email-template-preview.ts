// Vorschau einer E-Mail-Vorlage mit Beispieldaten. Verwendet dieselbe
// Darstellung wie der Versand, damit die Vorschau dem echten Ergebnis entspricht.
import {
  renderCustomerTicketEmail,
  type CustomerTicketEmailBrand,
  type CustomerTicketEmailKind,
} from "./customer-ticket-email-template.ts";
import {
  emailTemplateDefinition,
  resolveEmailTemplate,
  sanitizeTemplateFields,
} from "./email-templates.ts";
import { internalNoticeHtmlTemplate } from "./exchange-mail-processing.ts";

const SAMPLE = {
  ticketNumber: "NX-1042",
  ticketSubject: "Drucker im 2. Stock funktioniert nicht",
  originalSubject: "Ihre Rechnung ist überfällig",
  pageTitle: "Systemstatus",
  service: "E-Mail",
  status: "Teilausfall",
};
const APP = "https://app.nextdesk.ch";

export type TemplatePreview = { subject: string; html: string };

export function renderTemplatePreview(input: {
  key: string;
  /** Entwurf der Felder (auch nicht gespeichert). */
  fields: Record<string, string>;
  /** Gespeicherte Felder der Vorlage «security_notice» (Rahmen der Phishing-Mails). */
  frameFields: Record<string, string>;
  branding: CustomerTicketEmailBrand;
  portalName: string;
}): TemplatePreview | null {
  const definition = emailTemplateDefinition(input.key);
  if (!definition) return null;
  const draft = sanitizeTemplateFields(input.key, input.fields) ?? {};
  const template = resolveEmailTemplate(input.key, {
    enabled: true,
    fields: draft,
  });
  const values = { ...SAMPLE, portalName: input.portalName };
  const text = (field: string) => template.text(field, values);
  const frame = resolveEmailTemplate("security_notice", {
    enabled: true,
    fields: input.frameFields,
  });
  const base = {
    branding: input.branding,
    attachmentNotice: false,
    ticketNumber: SAMPLE.ticketNumber,
    subject: SAMPLE.ticketSubject,
  };
  const ticketSubject = `[${SAMPLE.ticketNumber}] ${SAMPLE.ticketSubject}`;
  const customer = (
    kind: CustomerTicketEmailKind,
    body: string,
    subject: string,
  ): TemplatePreview => ({
    subject,
    html: renderCustomerTicketEmail({
      ...base,
      kind,
      text: body,
      // Die gelöst-Mail enthält Sternlinks zur Bewertung (Beispiel-Links).
      ...(kind === "resolution"
        ? {
            ratingLinks: [1, 2, 3, 4, 5].map((score) => ({
              score,
              url: APP,
            })),
          }
        : {}),
      eyebrow: text("eyebrow") || undefined,
      intro: text("intro") || undefined,
      replyHint: text("hint") || undefined,
    }),
  });

  switch (input.key) {
    case "acknowledgement":
    case "resolution":
      return customer(
        input.key as CustomerTicketEmailKind,
        text("text"),
        text("subject") || ticketSubject,
      );
    case "agent_reply":
      return customer(
        "agent_reply",
        "Guten Tag\n\nWir haben den Drucker neu gestartet und den Treiber aktualisiert. Bitte testen Sie, ob der Ausdruck wieder funktioniert.\n\nFreundliche Grüsse\nIhr Support-Team\n\n(Beispieltext: Hier steht die Antwort, die Ihre Agentin oder Ihr Agent schreibt.)",
        text("subject") || `AW: ${ticketSubject}`,
      );
    case "security_notice":
      return customer(
        "security_notice",
        "(Beispieltext: Hier steht die jeweilige Rückmeldung, z. B. das Ergebnis der Prüfung.)",
        `[${SAMPLE.ticketNumber}] Rückmeldung zu Ihrer Phishing-Meldung`,
      );
    case "phishing_thanks":
    case "phishing_click_question":
    case "phishing_result_harmless":
    case "phishing_result_spam":
    case "phishing_result_phishing":
    case "phishing_result_targeted": {
      const subject = text("subject")
        .replace(/\s*:?\s*«\s*»/g, "")
        .trim();
      return {
        subject: `[${SAMPLE.ticketNumber}] ${subject}`,
        html: renderCustomerTicketEmail({
          ...base,
          kind: "security_notice",
          text: text("text"),
          eyebrow: frame.text("eyebrow", values) || undefined,
          intro: frame.text("intro", values) || undefined,
          replyHint: frame.text("hint", values) || undefined,
          actions:
            input.key === "phishing_click_question"
              ? [
                  { label: "Nein, nichts geöffnet", url: APP, primary: true },
                  { label: "Ja, ich habe etwas geöffnet", url: APP },
                ]
              : [],
        }),
      };
    }
    case "department_question":
    case "department_answer": {
      const isQuestion = input.key === "department_question";
      return {
        subject: ticketSubject,
        html: internalNoticeHtmlTemplate({
          text: `${text("text")}\n\n${isQuestion ? "Können wir dem Kunden eine Ersatzlieferung zusagen?" : "Ja, die Ersatzlieferung ist freigegeben."}`,
          ticketNumber: SAMPLE.ticketNumber,
          subject: SAMPLE.ticketSubject,
          portalName: input.portalName,
          attachmentNotice: false,
        }),
      };
    }
    case "notification":
      return {
        subject: `Ticket zugewiesen – ${text("subjectSuffix").trim() || input.portalName}`,
        html: renderCustomerTicketEmail({
          ...base,
          kind: "notification",
          intro: "Ticket zugewiesen",
          text: "Ihnen wurde ein Ticket zugewiesen.\n\nTicket: NX-1042 · Drucker im 2. Stock funktioniert nicht",
          eyebrow: text("eyebrow") || undefined,
          replyHint:
            text("hint").trim() ||
            "Sie erhalten diese E-Mail, weil Sie Benachrichtigungen per E-Mail eingeschaltet haben.",
          actions: [{ label: text("button"), url: APP, primary: true }],
        }),
      };
    case "status_confirmation":
      return {
        subject: text("subject"),
        html: renderCustomerTicketEmail({
          ...base,
          kind: "notification",
          ticketNumber: null,
          subject: SAMPLE.pageTitle,
          intro: text("intro"),
          text: text("text"),
          replyHint:
            "Sie erhalten diese E-Mail, weil Sie den Systemstatus abonniert haben. Über «Abmelden» beenden Sie das Abo jederzeit.",
          actions: [
            { label: text("button"), url: APP, primary: true },
            { label: "Abmelden", url: APP },
          ],
        }),
      };
    case "status_change":
      return {
        subject: text("subject"),
        html: renderCustomerTicketEmail({
          ...base,
          kind: "notification",
          ticketNumber: null,
          subject: SAMPLE.pageTitle,
          intro: text("intro"),
          text: "Der Status von «E-Mail» hat sich von «In Betrieb» zu «Teilausfall» geändert.\n\nGeändert am 10.11.2026, 09:15.",
          replyHint: text("hint"),
          actions: [
            { label: text("button"), url: APP, primary: true },
            { label: "Abmelden", url: APP },
          ],
        }),
      };
  }
  return null;
}
