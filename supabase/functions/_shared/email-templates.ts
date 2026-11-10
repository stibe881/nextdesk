// Vorlagen der automatisch versendeten E-Mails: Standardtexte, Platzhalter und
// Auflösung der vom Mandanten angepassten Texte. Rein (keine Datenbank, kein
// Netzwerk), siehe email-templates.test.ts.

import { THANK_YOU_TEXT } from "./phishing-report-intake.ts";
import {
  CLICK_QUESTION_TEXT,
  SECURITY_VERDICTS,
  VERDICT_LABELS,
  VERDICT_RESULT_TEXT,
} from "./security-cases.ts";

export type EmailTemplateField = {
  key: string;
  label: string;
  /** Mehrzeiliger Text. */
  multiline?: boolean;
  /** Standardtext; darf Platzhalter enthalten. */
  default: string;
};

export const EMAIL_TEMPLATE_CATEGORIES = [
  "Tickets",
  "Phishing-Meldungen",
  "Interne Mitteilungen",
  "Statusseite",
] as const;
export type EmailTemplateCategory = (typeof EMAIL_TEMPLATE_CATEGORIES)[number];

export type EmailTemplateDefinition = {
  key: string;
  label: string;
  /** Gruppe in den Einstellungen. */
  category: EmailTemplateCategory;
  /** Wann wird diese E-Mail versendet? */
  description: string;
  audience: "customer" | "staff" | "subscriber";
  /** Platzhalter, die in den Texten verwendet werden dürfen. */
  placeholders: readonly { name: string; description: string }[];
  fields: readonly EmailTemplateField[];
};

const TICKET_PLACEHOLDERS = [
  { name: "ticketNumber", description: "Ticketnummer, z. B. NX-1042" },
  { name: "ticketSubject", description: "Betreff des Tickets" },
  { name: "portalName", description: "Name des Portals" },
] as const;

const REPLY_HINT =
  "Sie können direkt auf diese E-Mail antworten. Bitte lassen Sie die Ticketnummer im Betreff stehen.";

export const EMAIL_TEMPLATES: readonly EmailTemplateDefinition[] = [
  {
    key: "acknowledgement",
    category: "Tickets",
    label: "Eingangsbestätigung",
    description:
      "Wird an die anfragende Person gesendet, sobald aus ihrer E-Mail ein Ticket entstanden ist.",
    audience: "customer",
    placeholders: TICKET_PLACEHOLDERS,
    fields: [
      {
        key: "subject",
        label: "Betreff",
        default: "[{{ticketNumber}}] {{ticketSubject}}",
      },
      {
        key: "eyebrow",
        label: "Kleine Überschrift",
        default: "Ticket erfasst",
      },
      {
        key: "intro",
        label: "Hervorgehobene Zeile",
        default: "Ihre Anfrage ist eingegangen.",
      },
      {
        key: "text",
        label: "Text",
        multiline: true,
        default:
          "Ihre Anfrage ist bei uns eingegangen und wurde als Ticket erfasst.",
      },
      { key: "hint", label: "Hinweis", multiline: true, default: REPLY_HINT },
    ],
  },
  {
    key: "agent_reply",
    category: "Tickets",
    label: "Antwort des Supports",
    description:
      "Wird gesendet, wenn eine Agentin oder ein Agent im Ticket öffentlich antwortet. Der Text der Antwort selbst bleibt unverändert.",
    audience: "customer",
    placeholders: TICKET_PLACEHOLDERS,
    fields: [
      {
        key: "subject",
        label: "Betreff",
        default: "AW: [{{ticketNumber}}] {{ticketSubject}}",
      },
      {
        key: "eyebrow",
        label: "Kleine Überschrift",
        default: "Neue Nachricht zu Ihrem Ticket",
      },
      {
        key: "intro",
        label: "Hervorgehobene Zeile",
        default: "Sie haben eine neue Antwort erhalten.",
      },
      { key: "hint", label: "Hinweis", multiline: true, default: REPLY_HINT },
    ],
  },
  {
    key: "resolution",
    category: "Tickets",
    label: "Ticket gelöst",
    description: "Wird gesendet, wenn ein Ticket als gelöst markiert wird.",
    audience: "customer",
    placeholders: TICKET_PLACEHOLDERS,
    fields: [
      {
        key: "subject",
        label: "Betreff",
        default: "[{{ticketNumber}}] {{ticketSubject}}",
      },
      { key: "eyebrow", label: "Kleine Überschrift", default: "Ticket gelöst" },
      {
        key: "intro",
        label: "Hervorgehobene Zeile",
        default: "Ihr Ticket wurde als gelöst markiert.",
      },
      {
        key: "text",
        label: "Text",
        multiline: true,
        default: "Ihr Ticket wurde als gelöst markiert.",
      },
      {
        key: "hint",
        label: "Hinweis",
        multiline: true,
        default:
          "Ist noch etwas offen? Antworten Sie direkt auf diese E-Mail. Bitte lassen Sie die Ticketnummer im Betreff stehen.",
      },
    ],
  },
  {
    key: "security_notice",
    category: "Phishing-Meldungen",
    label: "Phishing-Meldung: Gestaltung",
    description:
      "Rahmen aller Rückmeldungen an meldende Personen (Danke, Ergebnis, Rückfrage). Ausgeschaltet wird keine dieser Rückmeldungen versendet. Die Texte stellen Sie in den folgenden Vorlagen ein.",
    audience: "customer",
    placeholders: TICKET_PLACEHOLDERS,
    fields: [
      { key: "eyebrow", label: "Kleine Überschrift", default: "Sicherheit" },
      {
        key: "intro",
        label: "Hervorgehobene Zeile",
        default: "Nachricht zu Ihrer Phishing-Meldung",
      },
      {
        key: "hint",
        label: "Hinweis",
        multiline: true,
        default:
          "Bitte antworten Sie nicht auf diese E-Mail. Bei Fragen wenden Sie sich an den Support.",
      },
    ],
  },
  {
    key: "phishing_thanks",
    category: "Phishing-Meldungen",
    label: "Phishing-Meldung: Danke",
    description:
      "Geht an die Person, die eine verdächtige E-Mail gemeldet hat, sobald die Meldung eingegangen ist.",
    audience: "customer",
    placeholders: [
      { name: "ticketNumber", description: "Nummer des Sicherheitsfalls" },
    ],
    fields: [
      {
        key: "subject",
        label: "Betreff",
        default: "Danke für Ihre Phishing-Meldung",
      },
      {
        key: "text",
        label: "Text",
        multiline: true,
        default: THANK_YOU_TEXT,
      },
    ],
  },
  ...SECURITY_VERDICTS.map((verdict): EmailTemplateDefinition => ({
    key: `phishing_result_${verdict}`,
    label: `Phishing-Meldung: Ergebnis «${VERDICT_LABELS[verdict]}»`,
    description: `Geht einmalig an alle meldenden Personen, wenn das Sicherheitsteam die Meldung als «${VERDICT_LABELS[verdict]}» beurteilt hat.`,
    audience: "customer",
    placeholders: [
      {
        name: "originalSubject",
        description: "Betreff der gemeldeten E-Mail",
      },
    ],
    fields: [
      {
        key: "subject",
        label: "Betreff",
        default: "Ergebnis Ihrer Phishing-Meldung: «{{originalSubject}}»",
      },
      {
        key: "text",
        label: "Text",
        multiline: true,
        default: VERDICT_RESULT_TEXT[verdict],
      },
    ],
  })),
  {
    key: "phishing_click_question",
    category: "Phishing-Meldungen",
    label: "Phishing-Meldung: Rückfrage «geklickt?»",
    description:
      "Fragt meldende Personen, ob sie in der gemeldeten E-Mail etwas geöffnet oder eingegeben haben. Die Antwortknöpfe werden automatisch angefügt.",
    audience: "customer",
    placeholders: [],
    fields: [
      {
        key: "subject",
        label: "Betreff",
        default: "Kurze Rückfrage zu Ihrer Phishing-Meldung",
      },
      {
        key: "text",
        label: "Text",
        multiline: true,
        default: CLICK_QUESTION_TEXT,
      },
    ],
  },
  {
    key: "department_question",
    category: "Interne Mitteilungen",
    label: "Abteilungsrückfrage",
    description:
      "Geht an die Abteilungsleitung, wenn ein Ticket eine Rückfrage braucht.",
    audience: "staff",
    placeholders: TICKET_PLACEHOLDERS,
    fields: [
      {
        key: "text",
        label: "Einleitung",
        multiline: true,
        default: "Eine Abteilungsrückfrage benötigt Ihre Antwort:",
      },
    ],
  },
  {
    key: "department_answer",
    category: "Interne Mitteilungen",
    label: "Abteilungsantwort",
    description:
      "Geht an die fragende Person, wenn die Abteilungsleitung geantwortet hat.",
    audience: "staff",
    placeholders: TICKET_PLACEHOLDERS,
    fields: [
      {
        key: "text",
        label: "Einleitung",
        multiline: true,
        default: "Die Abteilungsleitung hat auf Ihre Rückfrage geantwortet:",
      },
    ],
  },
  {
    key: "notification",
    category: "Interne Mitteilungen",
    label: "Benachrichtigung an Mitarbeitende",
    description:
      "E-Mail-Variante der Benachrichtigungen (Zuweisung, Erwähnung, SLA, Shop …), sofern Mitarbeitende E-Mail dafür eingeschaltet haben. Die Titel der einzelnen Ereignisse bleiben unverändert.",
    audience: "staff",
    placeholders: [{ name: "portalName", description: "Name des Portals" }],
    fields: [
      {
        key: "subjectSuffix",
        label: "Betreff-Zusatz",
        default: "{{portalName}}",
      },
      {
        key: "eyebrow",
        label: "Kleine Überschrift",
        default: "Benachrichtigung",
      },
      {
        key: "button",
        label: "Beschriftung des Knopfs",
        default: "In {{portalName}} öffnen",
      },
      {
        key: "hint",
        label: "Hinweis (leer = Hinweis des Ereignisses)",
        multiline: true,
        default: "",
      },
    ],
  },
  {
    key: "status_confirmation",
    category: "Statusseite",
    label: "Statusseite: Anmeldung bestätigen",
    description:
      "Wird gesendet, wenn sich jemand für Meldungen der öffentlichen Statusseite anmeldet.",
    audience: "subscriber",
    placeholders: [{ name: "pageTitle", description: "Titel der Statusseite" }],
    fields: [
      {
        key: "subject",
        label: "Betreff",
        default: "Anmeldung bestätigen – {{pageTitle}}",
      },
      {
        key: "intro",
        label: "Hervorgehobene Zeile",
        default: "Bitte bestätigen Sie Ihre Anmeldung",
      },
      {
        key: "text",
        label: "Text",
        multiline: true,
        default:
          "Sie möchten per E-Mail informiert werden, wenn sich der Status eines Dienstes auf «{{pageTitle}}» ändert.\n\nBestätigen Sie die Anmeldung mit dem Knopf unten. Wenn Sie sich nicht angemeldet haben, können Sie diese E-Mail ignorieren.",
      },
      {
        key: "button",
        label: "Beschriftung des Knopfs",
        default: "Anmeldung bestätigen",
      },
    ],
  },
  {
    key: "status_change",
    category: "Statusseite",
    label: "Statusseite: Statusänderung",
    description:
      "Wird an bestätigte Abonnentinnen und Abonnenten gesendet, wenn sich der Status eines Dienstes ändert.",
    audience: "subscriber",
    placeholders: [
      { name: "service", description: "Name des Dienstes" },
      { name: "status", description: "Neuer Status" },
      { name: "pageTitle", description: "Titel der Statusseite" },
    ],
    fields: [
      { key: "subject", label: "Betreff", default: "{{service}}: {{status}}" },
      {
        key: "intro",
        label: "Hervorgehobene Zeile",
        default: "{{service}} – {{status}}",
      },
      {
        key: "button",
        label: "Beschriftung des Knopfs",
        default: "Systemstatus ansehen",
      },
      {
        key: "hint",
        label: "Hinweis",
        multiline: true,
        default:
          "Sie erhalten diese E-Mail, weil Sie den Systemstatus abonniert haben. Über «Abmelden» beenden Sie das Abo jederzeit.",
      },
    ],
  },
];

export const MAX_FIELD_LENGTH = 4000;

export type StoredEmailTemplate = {
  enabled: boolean;
  fields: Record<string, string>;
};

export function emailTemplateDefinition(
  key: string,
): EmailTemplateDefinition | undefined {
  return EMAIL_TEMPLATES.find((template) => template.key === key);
}

/** Ersetzt {{name}}; unbekannte Platzhalter bleiben als leerer Text. */
export function fillEmailTemplate(
  template: string,
  values: Record<string, string | null | undefined>,
): string {
  return template.replace(/\{\{\s*([a-zA-Z]+)\s*\}\}/g, (_match, name) =>
    String(values[name] ?? ""),
  );
}

/** Nur bekannte Felder, nur Text, begrenzt; für das Speichern. */
export function sanitizeTemplateFields(
  key: string,
  input: unknown,
): Record<string, string> | null {
  const definition = emailTemplateDefinition(key);
  if (!definition || typeof input !== "object" || input === null) return null;
  const result: Record<string, string> = {};
  for (const field of definition.fields) {
    const value = (input as Record<string, unknown>)[field.key];
    if (typeof value !== "string") continue;
    const cleaned = value
      .replace(/\r\n/g, "\n")
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
      .trim()
      .slice(0, MAX_FIELD_LENGTH);
    // Einzeilige Felder (Betreff, Überschriften) dürfen keine Zeilenumbrüche
    // enthalten, sonst entstünde ein Header-Injection-Risiko im Betreff.
    const single = field.multiline
      ? cleaned
      : cleaned.replace(/\s*\n\s*/g, " ");
    // Leer oder gleich dem Standard: nichts speichern, es gilt der Standard.
    if (single && single !== field.default.trim()) result[field.key] = single;
  }
  return result;
}

export type ResolvedEmailTemplate = {
  enabled: boolean;
  /** Text eines Feldes: angepasst oder Standard, Platzhalter ersetzt. */
  text: (
    field: string,
    values: Record<string, string | null | undefined>,
  ) => string;
};

export function resolveEmailTemplate(
  key: string,
  stored: StoredEmailTemplate | null | undefined,
): ResolvedEmailTemplate {
  const definition = emailTemplateDefinition(key);
  return {
    enabled: stored ? stored.enabled !== false : true,
    text: (field, values) => {
      const custom = stored?.fields?.[field];
      const fallback =
        definition?.fields.find((entry) => entry.key === field)?.default ?? "";
      const chosen =
        typeof custom === "string" && custom.trim() ? custom : fallback;
      return fillEmailTemplate(chosen, values);
    },
  };
}
