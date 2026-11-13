import { type Formality, tone } from "./formality.ts";

type ApnsEnvironment = "production" | "development";

/** Must match the category the mobile app registers (push-notification-bridge). */
export const APNS_REQUESTER_REMINDER_CATEGORY = "NEXTDESK_REQUESTER_REMINDER";

export type ApnsPayloadKind =
  | "assigned"
  | "requester_reply"
  | "support_reply"
  | "requester_reminder"
  | "mention"
  | "resolved"
  | "approval"
  | "department_question_asked"
  | "department_question_answered"
  | "supervisor_request"
  | "supervisor_answer"
  | "escalation"
  | "sla"
  | "follow_up"
  | "contract_deadline"
  | "inventory_low_stock"
  | "shop"
  | "service_task"
  | "infrastructure"
  | "watched"
  | "rule_reminder"
  | "vendor_reminder"
  | "children_done"
  | "kudos"
  | "security_report"
  | "incident"
  | "ipam"
  | "summary"
  | "test";

export type ApnsPayloadInput = {
  kind: ApnsPayloadKind;
  tenantId: string;
  notificationId: string;
  /**
   * Exact notification kind (e.g. «inventory.count_due»); the app uses it
   * together with the ids below to open the triggering object.
   */
  notificationKind?: string;
  ticketId?: string;
  contractId?: string;
  ticketNumber?: string;
  subject?: string | null;
  summaryCount?: number;
  shopEvent?: string;
  /** Shop reminder sent to the supervisor or stand-in (escalation). */
  shopEscalated?: boolean;
  /** Handover chosen when ordering: pickup at the support or to the desk. */
  shopDeliveryMethod?: string;
  shopDeliveryLocation?: string;
  orderId?: string;
  orderNumber?: string;
  serviceTaskEvent?: string;
  serviceTaskTitle?: string;
  occurrenceId?: string;
  /** Infrastructure reminder: device, reason and due date (YYYY-MM-DD). */
  assetId?: string;
  assetName?: string;
  infrastructureReason?: string;
  dueOn?: string;
  /** Watched ticket: status, assigned or comment. */
  watchEvent?: string;
  watchStatusLabel?: string;
  watchAssigneeName?: string;
  watchActorName?: string;
  watchInternal?: boolean;
  /** Reminder from a time-based ticket rule: the rule's name. */
  ruleName?: string;
  /** Vendor case reminder: name of the vendor. */
  vendorName?: string;
  /** Customer praise: display name of the requester (never e-mail) and score. */
  kudosRequesterName?: string;
  kudosScore?: number;
  /** Forwarded to a stand-in: name of the absent person. */
  delegatedFromName?: string;
  /** Incident («Störung») from monitoring. */
  incidentId?: string;
  incidentNumber?: string;
  incidentTitle?: string;
  incidentReason?: string;
  incidentSeverity?: string;
  /** «external»: status feed of a provider (Microsoft 365, GitHub, …). */
  incidentSource?: string;
  incidentProvider?: string;
  /** Latest text of the provider (updates of external incidents). */
  incidentMessage?: string;
  /**
   * Security case: a reporter said they clicked or entered data, the verdict
   * is overdue (optionally escalated to the team lead) or several people
   * reported the same campaign.
   */
  securityEvent?: "clicked" | "overdue" | "campaign";
  securityCount?: number;
  securityEscalated?: string;
  /** IP address management: finding, offline agent or expiring reservation. */
  ipamEvent?: "finding" | "agent_offline" | "reservation_expiring";
  ipamTitle?: string;
  ipamNumber?: string;
  ipamAddress?: string;
  ipamSeverity?: string;
  ipamAgentName?: string;
  /** Inventory reminders: reorder or stock count due. */
  inventoryEvent?: "reorder" | "count_due";
  inventoryName?: string;
  /** Opaque ids only (no names): article or storage location to open. */
  inventoryItemId?: string;
  inventoryLocationId?: string;
};

const PAYLOAD_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOTIFICATION_KIND = /^[a-z][a-z_.]{2,63}$/;

type ApnsConfiguration = {
  keyId: string;
  teamId: string;
  privateKey: string;
};

let cachedToken: { value: string; expiresAt: number } | null = null;

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function utf8Base64url(value: string): string {
  return base64url(new TextEncoder().encode(value));
}

function normalizePrivateKey(value: string): string {
  return value.replaceAll("\\n", "\n").trim();
}

function pemToDer(pem: string): Uint8Array | null {
  const normalized = normalizePrivateKey(pem);
  const match = normalized.match(
    /^-----BEGIN PRIVATE KEY-----\s*([A-Za-z0-9+/=\s]+)\s*-----END PRIVATE KEY-----$/u,
  );
  if (!match) return null;
  try {
    const encoded = match[1].replace(/\s+/gu, "");
    const binary = atob(encoded);
    if (binary.length < 64) return null;
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

function readConfiguration(): ApnsConfiguration | null {
  const keyId = Deno.env.get("APNS_KEY_ID")?.trim() ?? "";
  const teamId = Deno.env.get("APNS_TEAM_ID")?.trim() ?? "";
  const privateKey = Deno.env.get("APNS_PRIVATE_KEY") ?? "";
  if (
    !/^[A-Za-z0-9]{10}$/u.test(keyId) ||
    !/^[A-Za-z0-9]{10}$/u.test(teamId) ||
    pemToDer(privateKey) === null
  ) {
    return null;
  }
  return { keyId, teamId, privateKey: normalizePrivateKey(privateKey) };
}

/** Returns no secret material; callers can safely expose this Boolean. */
export function isApnsConfigured(): boolean {
  return readConfiguration() !== null;
}

async function apnsJwt(configuration: ApnsConfiguration): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now) return cachedToken.value;

  const der = pemToDer(configuration.privateKey);
  if (!der) throw new Error("apns_private_key_invalid");
  const keyData = new ArrayBuffer(der.byteLength);
  new Uint8Array(keyData).set(der);
  const key = await crypto.subtle.importKey(
    "pkcs8",
    keyData,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const issuedAt = Math.floor(now / 1000);
  const unsigned = `${utf8Base64url(
    JSON.stringify({ alg: "ES256", kid: configuration.keyId }),
  )}.${utf8Base64url(
    JSON.stringify({ iss: configuration.teamId, iat: issuedAt }),
  )}`;
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      new TextEncoder().encode(unsigned),
    ),
  );
  // WebCrypto ECDSA output is the required IEEE-P1363 raw r||s representation.
  if (signature.byteLength !== 64) throw new Error("apns_signature_invalid");
  const token = `${unsigned}.${base64url(signature)}`;
  cachedToken = { value: token, expiresAt: now + 50 * 60 * 1000 };
  return token;
}

function truncateSubject(subject: string): string {
  const characters = Array.from(subject.trim());
  return characters.length <= 80
    ? characters.join("")
    : `${characters.slice(0, 79).join("")}…`;
}

function alertFor(
  input: ApnsPayloadInput,
  formality: Formality = "du",
): { title: string; body: string } {
  const ticketNumber = input.ticketNumber ?? "";
  const subject =
    typeof input.subject === "string" ? truncateSubject(input.subject) : null;

  switch (input.kind) {
    case "assigned":
      return {
        title: "Ticket zugewiesen",
        body: subject
          ? tone(
              formality,
              `${ticketNumber} wurde dir zugewiesen: ${subject}`,
              `${ticketNumber} wurde Ihnen zugewiesen: ${subject}`,
            )
          : tone(
              formality,
              `${ticketNumber} wurde dir zugewiesen.`,
              `${ticketNumber} wurde Ihnen zugewiesen.`,
            ),
      };
    case "requester_reply":
      return {
        title: "Neue Nachricht",
        body: subject
          ? `Neue Antwort der anfragenden Person in ${ticketNumber}: ${subject}`
          : `Neue Antwort der anfragenden Person in ${ticketNumber}.`,
      };
    case "support_reply":
      return {
        title: "Antwort vom Support",
        body: subject
          ? tone(
              formality,
              `Es gibt eine neue Antwort zu deinem Ticket ${ticketNumber}: ${subject}`,
              `Es gibt eine neue Antwort zu Ihrem Ticket ${ticketNumber}: ${subject}`,
            )
          : tone(
              formality,
              `Es gibt eine neue Antwort zu deinem Ticket ${ticketNumber}.`,
              `Es gibt eine neue Antwort zu Ihrem Ticket ${ticketNumber}.`,
            ),
      };
    case "requester_reminder":
      return {
        title: tone(
          formality,
          "Wir warten auf deine Antwort",
          "Wir warten auf Ihre Antwort",
        ),
        body: subject
          ? tone(
              formality,
              `${ticketNumber}: ${subject} – Ist dein Problem gelöst? Tippe hier zum Antworten.`,
              `${ticketNumber}: ${subject} – Ist Ihr Problem gelöst? Tippen Sie hier zum Antworten.`,
            )
          : tone(
              formality,
              `${ticketNumber} wartet auf deine Rückmeldung. Ist dein Problem gelöst?`,
              `${ticketNumber} wartet auf Ihre Rückmeldung. Ist Ihr Problem gelöst?`,
            ),
      };
    case "mention":
      return {
        title: tone(formality, "Du wurdest erwähnt", "Sie wurden erwähnt"),
        body: subject
          ? tone(
              formality,
              `Du wurdest in ${ticketNumber} in einer internen Notiz erwähnt: ${subject}`,
              `Sie wurden in ${ticketNumber} in einer internen Notiz erwähnt: ${subject}`,
            )
          : tone(
              formality,
              `Du wurdest in ${ticketNumber} in einer internen Notiz erwähnt.`,
              `Sie wurden in ${ticketNumber} in einer internen Notiz erwähnt.`,
            ),
      };
    case "resolved":
      return {
        title: "Ticket gelöst",
        body: subject
          ? `${ticketNumber} wurde gelöst: ${subject}`
          : `${ticketNumber} wurde gelöst. Bitte bestätige die Lösung.`,
      };
    case "approval":
      return {
        title: "Freigabe benötigt",
        body: subject
          ? tone(
              formality,
              `Für ${ticketNumber} wird deine Freigabe benötigt: ${subject}`,
              `Für ${ticketNumber} wird Ihre Freigabe benötigt: ${subject}`,
            )
          : tone(
              formality,
              `Für ${ticketNumber} wird deine Freigabe benötigt.`,
              `Für ${ticketNumber} wird Ihre Freigabe benötigt.`,
            ),
      };
    case "department_question_asked":
      return {
        title: "Abteilungsrückfrage",
        body: subject
          ? tone(
              formality,
              `Für ${ticketNumber} wird deine Antwort benötigt: ${subject}`,
              `Für ${ticketNumber} wird Ihre Antwort benötigt: ${subject}`,
            )
          : tone(
              formality,
              `Für ${ticketNumber} wird deine Antwort benötigt.`,
              `Für ${ticketNumber} wird Ihre Antwort benötigt.`,
            ),
      };
    case "department_question_answered":
      return {
        title: "Antwort der Abteilungsleitung",
        body: subject
          ? tone(
              formality,
              `Es gibt eine Antwort zu deiner Rückfrage in ${ticketNumber}: ${subject}`,
              `Es gibt eine Antwort zu Ihrer Rückfrage in ${ticketNumber}: ${subject}`,
            )
          : tone(
              formality,
              `Es gibt eine Antwort zu deiner Rückfrage in ${ticketNumber}.`,
              `Es gibt eine Antwort zu Ihrer Rückfrage in ${ticketNumber}.`,
            ),
      };
    case "supervisor_request":
      return {
        title: tone(formality, "Anfrage an dich", "Anfrage an Sie"),
        body: subject
          ? tone(
              formality,
              `Zu ${ticketNumber} wird deine Antwort benötigt: ${subject}`,
              `Zu ${ticketNumber} wird Ihre Antwort benötigt: ${subject}`,
            )
          : tone(
              formality,
              `Zu ${ticketNumber} wird deine Antwort benötigt.`,
              `Zu ${ticketNumber} wird Ihre Antwort benötigt.`,
            ),
      };
    case "supervisor_answer":
      return {
        title: tone(
          formality,
          "Antwort auf deine Anfrage",
          "Antwort auf Ihre Anfrage",
        ),
        body: subject
          ? tone(
              formality,
              `Deine Anfrage zu ${ticketNumber} wurde beantwortet: ${subject}`,
              `Ihre Anfrage zu ${ticketNumber} wurde beantwortet: ${subject}`,
            )
          : tone(
              formality,
              `Deine Anfrage zu ${ticketNumber} wurde beantwortet.`,
              `Ihre Anfrage zu ${ticketNumber} wurde beantwortet.`,
            ),
      };
    case "escalation":
      return {
        title: "Ticket eskaliert",
        body: subject
          ? `${ticketNumber} wurde eskaliert: ${subject}`
          : `${ticketNumber} wurde eskaliert.`,
      };
    case "sla":
      return {
        title: "SLA-Hinweis",
        body: subject
          ? `Für ${ticketNumber} ist eine SLA-Frist betroffen: ${subject}`
          : `Für ${ticketNumber} ist eine SLA-Frist betroffen.`,
      };
    case "rule_reminder": {
      const rule = input.ruleName ? truncateSubject(input.ruleName) : null;
      return {
        title: rule ? `Erinnerung: ${rule}` : "Erinnerung aus Regel",
        body: subject
          ? `${ticketNumber}: ${subject}`
          : `${ticketNumber} braucht Aufmerksamkeit.`,
      };
    }
    case "vendor_reminder": {
      const vendor = input.vendorName
        ? truncateSubject(input.vendorName)
        : "Der Drittanbieter";
      return {
        title: "Drittanbieter nachfassen",
        body: `${vendor} hat sich zu ${ticketNumber} noch nicht gemeldet.`,
      };
    }
    case "kudos": {
      const from = input.kudosRequesterName
        ? truncateSubject(input.kudosRequesterName)
        : "Eine meldende Person";
      const score = input.kudosScore ? ` (${input.kudosScore}/5)` : "";
      return {
        title: "Lob von Kund:innen",
        body: `${from} hat ${ticketNumber} sehr gut bewertet${score}. ${tone(formality, "Danke für deinen Einsatz!", "Danke für Ihren Einsatz!")}`,
      };
    }
    case "incident": {
      if (input.incidentSource === "external") {
        const provider =
          input.incidentProvider?.trim().slice(0, 60) || "Externer Dienst";
        const name = input.incidentTitle?.trim().slice(0, 120) || "Störung";
        const update = input.incidentMessage?.trim().slice(0, 140);
        return {
          title:
            input.incidentReason === "updated"
              ? `Update: ${provider}`
              : input.incidentReason === "resolved"
                ? `Behoben: ${provider}`
                : `Externe Störung: ${provider}`,
          body:
            input.incidentReason === "updated" && update
              ? `${name} – ${update}`
              : input.incidentNumber
                ? `${input.incidentNumber}: ${name}`
                : name,
        };
      }
      const what = input.incidentSeverity === "warning" ? "Warnung" : "Störung";
      const title =
        input.incidentReason === "realert"
          ? `Noch unbestätigt: ${what}`
          : input.incidentReason === "escalated"
            ? "Störung: jetzt Ausfall"
            : input.incidentReason === "reopened"
              ? `Erneut: ${what}`
              : what;
      const name = input.incidentTitle?.trim().slice(0, 120) || "Ein Gerät";
      return {
        title,
        body: input.incidentNumber ? `${input.incidentNumber}: ${name}` : name,
      };
    }
    case "security_report":
      if (input.securityEvent === "clicked") {
        return {
          title: "Melder hat geklickt",
          body: ticketNumber
            ? `Eine meldende Person hat in der Phishing-Mail geklickt oder Daten eingegeben (${ticketNumber}). Bitte Passwort zurücksetzen.`
            : "Eine meldende Person hat in der Phishing-Mail geklickt oder Daten eingegeben. Bitte Passwort zurücksetzen.",
        };
      }
      if (input.securityEvent === "overdue") {
        const about = ticketNumber ? ` ${ticketNumber}` : "";
        return {
          title: input.securityEscalated
            ? "Sicherheitsfall: Eskalation"
            : "Sicherheitsfall überfällig",
          body: input.securityEscalated
            ? `Der Sicherheitsfall${about} wartet seit über 24 Stunden nach Fristablauf auf ein Urteil.`
            : `Die Frist für das Urteil zum Sicherheitsfall${about} ist abgelaufen.`,
        };
      }
      if (input.securityEvent === "campaign") {
        const count =
          input.securityCount && input.securityCount > 1
            ? `${input.securityCount} Personen haben`
            : "Mehrere Personen haben";
        return {
          title: "Phishing-Kampagne",
          body: `${count} dieselbe verdächtige E-Mail gemeldet${ticketNumber ? ` (${ticketNumber})` : ""}.`,
        };
      }
      return {
        title: "Phishing-Meldung",
        body: subject
          ? `Verdächtige E-Mail gemeldet (${ticketNumber}): ${subject}`
          : `Eine verdächtige E-Mail wurde gemeldet (${ticketNumber}).`,
      };
    case "children_done":
      return {
        title: "Teil-Tickets erledigt",
        body: subject
          ? `Alle Teil-Tickets von ${ticketNumber} sind erledigt: ${subject}`
          : `Alle Teil-Tickets von ${ticketNumber} sind erledigt.`,
      };
    case "follow_up":
      return {
        title: "Wiedervorlage fällig",
        body: subject
          ? `Eine Wiedervorlage zu ${ticketNumber} ist fällig: ${subject}`
          : "Eine Wiedervorlage ist fällig.",
      };
    case "contract_deadline":
      return {
        title: "Vertragsfrist",
        body: tone(
          formality,
          "Eine Vertragsfrist erfordert deine Aufmerksamkeit.",
          "Eine Vertragsfrist erfordert Ihre Aufmerksamkeit.",
        ),
      };
    case "shop": {
      const number = input.orderNumber ? ` ${input.orderNumber}` : "";
      switch (input.shopEvent) {
        case "approval_requested":
          return {
            title: "Freigabe für Bestellung",
            body: tone(
              formality,
              `Bestellung${number} wartet auf deine Freigabe.`,
              `Bestellung${number} wartet auf Ihre Freigabe.`,
            ),
          };
        case "placed_for_you":
          return {
            title: tone(
              formality,
              "Bestellung für dich erfasst",
              "Bestellung für Sie erfasst",
            ),
            body: tone(
              formality,
              `Der Support hat Bestellung${number} für dich erfasst.`,
              `Der Support hat Bestellung${number} für Sie erfasst.`,
            ),
          };
        case "submitted":
          return {
            title: "Neue Bestellung",
            body: `Bestellung${number} ist eingegangen.`,
          };
        case "approved":
          return {
            title: "Bestellung freigegeben",
            body: `Bestellung${number} wurde freigegeben.`,
          };
        case "in_progress":
          return {
            title: "Bestellung in Bearbeitung",
            body: `Bestellung${number} wird vorbereitet.`,
          };
        case "ready":
          return input.shopDeliveryMethod === "desk"
            ? {
                title: "Bereit zur Lieferung",
                body: `${tone(
                  formality,
                  `Bestellung${number} wird an deinen Arbeitsplatz gebracht`,
                  `Bestellung${number} wird an Ihren Arbeitsplatz gebracht`,
                )}${input.shopDeliveryLocation ? `: ${input.shopDeliveryLocation.slice(0, 80)}` : ""}.`,
              }
            : {
                title: "Bereit zur Abholung",
                body: tone(
                  formality,
                  `Bestellung${number} liegt für dich bereit. Abholung beim Support.`,
                  `Bestellung${number} liegt für Sie bereit. Abholung beim Support.`,
                ),
              };
        case "issued":
          return {
            title: "Bestellung ausgegeben",
            body: `Bestellung${number} wurde ausgegeben.`,
          };
        case "loan_due":
          return {
            title: "Ausleihe endet bald",
            body: `Die Ausleihe${number} endet in zwei Tagen. Bitte rechtzeitig zurückgeben.`,
          };
        case "loan_overdue":
          return input.shopEscalated
            ? {
                title: "Ausleihe im Team überfällig",
                body: tone(
                  formality,
                  `Die Ausleihe${number} einer Person aus deinem Team ist seit mehreren Tagen überfällig.`,
                  `Die Ausleihe${number} einer Person aus Ihrem Team ist seit mehreren Tagen überfällig.`,
                ),
              }
            : {
                title: "Ausleihe überfällig",
                body: `Die Ausleihe${number} ist überfällig. Bitte zurückgeben.`,
              };
        case "approval_reminder":
          return {
            title: input.shopEscalated
              ? "Freigabe als Stellvertretung"
              : "Freigabe ausstehend",
            body: `Bestellung${number} wartet noch auf eine Freigabe.`,
          };
        case "returned":
          return {
            title: "Rückgabe bestätigt",
            body: `Die Ausleihe${number} wurde zurückgenommen.`,
          };
        case "rejected":
          return {
            title: "Bestellung abgelehnt",
            body: `Bestellung${number} wurde abgelehnt.`,
          };
        case "cancelled":
          return {
            title: "Bestellung storniert",
            body: `Bestellung${number} wurde storniert.`,
          };
        case "team_ready":
          return {
            title: tone(formality, "Dein Team ist bereit", "Ihr Team ist bereit"),
            body: "Das bestellte Microsoft-Teams-Team wurde angelegt.",
          };
        case "team_failed":
          return {
            title: "Team konnte nicht angelegt werden",
            body: "Beim Anlegen des bestellten Teams ist ein Fehler aufgetreten.",
          };
        case "team_expiring":
          return {
            title: tone(
              formality,
              "Dein Team läuft bald ab",
              "Ihr Team läuft bald ab",
            ),
            body: "Ein Team endet bald. Jetzt verlängern oder archivieren lassen.",
          };
        case "team_archived":
          return {
            title: "Team archiviert",
            body: "Ein Team ist abgelaufen und wurde archiviert.",
          };
        default:
          return { title: "Shop", body: `Neuigkeit zu Bestellung${number}.` };
      }
    }
    case "service_task": {
      const title =
        input.serviceTaskTitle?.trim().slice(0, 80) || "Eine Serviceaufgabe";
      return input.serviceTaskEvent === "overdue"
        ? {
            title: "Serviceaufgabe überfällig",
            body: `${title} ist überfällig.`,
          }
        : {
            title: "Serviceaufgabe heute fällig",
            body: `${title} ist heute fällig.`,
          };
    }
    case "infrastructure": {
      const device = input.assetName?.trim().slice(0, 80) || "Ein Gerät";
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.dueOn ?? "");
      const day = match ? `${match[3]}.${match[2]}.${match[1]}` : null;
      const overdue = Boolean(
        match && input.dueOn! < new Date().toISOString().slice(0, 10),
      );
      const on = day ? ` am ${day}` : "";
      const since = day ? ` seit ${day}` : "";
      switch (input.infrastructureReason) {
        case "warranty":
          return overdue
            ? {
                title: "Garantie abgelaufen",
                body: `${device}: Garantie abgelaufen${since}.`,
              }
            : {
                title: "Garantie läuft ab",
                body: `${device}: Garantie endet${on}.`,
              };
        case "support":
          return overdue
            ? {
                title: "Herstellersupport beendet",
                body: `${device}: Herstellersupport beendet${since}.`,
              }
            : {
                title: "Support läuft ab",
                body: `${device}: Herstellersupport endet${on}.`,
              };
        case "end_of_life":
          return {
            title: "End of Life",
            body: overdue
              ? `${device}: End of Life erreicht${since}. Ersatz planen.`
              : `${device}: End of Life${on}. Ersatz planen.`,
          };
        default:
          return overdue
            ? {
                title: "Wartung überfällig",
                body: `${device}: Wartung überfällig${since}.`,
              }
            : {
                title: "Wartung fällig",
                body: `${device}: Wartung fällig${on}.`,
              };
      }
    }
    case "watched": {
      const actor = input.watchActorName
        ? truncateSubject(input.watchActorName)
        : null;
      const about = subject ? `${ticketNumber}: ${subject}` : ticketNumber;
      if (input.watchEvent === "status") {
        const status = input.watchStatusLabel
          ? truncateSubject(input.watchStatusLabel)
          : "geändert";
        return {
          title: `Beobachtet: Status ${status}`,
          body: actor
            ? `${actor} hat den Status von ${about} geändert.`
            : `Der Status von ${about} wurde geändert.`,
        };
      }
      if (input.watchEvent === "assigned") {
        const assignee = input.watchAssigneeName
          ? truncateSubject(input.watchAssigneeName)
          : null;
        return {
          title: "Beobachtet: neue Zuweisung",
          body: assignee
            ? `${about} ist jetzt ${assignee} zugewiesen.`
            : `${about} ist nicht mehr zugewiesen.`,
        };
      }
      return {
        title: input.watchInternal
          ? "Beobachtet: interne Notiz"
          : "Beobachtet: neue Nachricht",
        body: actor ? `${actor} in ${about}` : `Neuer Eintrag in ${about}`,
      };
    }
    case "inventory_low_stock": {
      const name = input.inventoryName?.trim().slice(0, 80);
      if (input.inventoryEvent === "reorder") {
        return {
          title: "Nachbestellen",
          body: name
            ? `${name} hat den Mindestbestand erreicht. Bitte nachbestellen.`
            : "Ein Lagerartikel hat den Mindestbestand erreicht. Bitte nachbestellen.",
        };
      }
      if (input.inventoryEvent === "count_due") {
        return {
          title: "Inventur fällig",
          body: name
            ? `Die Inventur für ${name} ist fällig.`
            : "Eine Inventur ist fällig.",
        };
      }
      return {
        title: "Lagerunterbestand",
        body: "Ein Lagerartikel hat den Mindestbestand erreicht.",
      };
    }
    case "ipam": {
      const what = input.ipamTitle?.trim().slice(0, 120);
      const where =
        input.ipamNumber?.trim().slice(0, 60) ||
        input.ipamAddress?.trim().slice(0, 45);
      if (input.ipamEvent === "agent_offline") {
        const agent =
          input.ipamAgentName?.trim().slice(0, 80) ||
          where ||
          "Ein Netzwerkagent";
        return {
          title: "Netzwerkagent offline",
          body: `${agent} hat sich seit über zwei Stunden nicht gemeldet.`,
        };
      }
      if (input.ipamEvent === "reservation_expiring") {
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.dueOn ?? "");
        const day = match ? ` am ${match[3]}.${match[2]}.${match[1]}` : " bald";
        return {
          title: "Reservierung läuft ab",
          body: `${where ?? "Eine IP-Adresse"}${what ? ` (${what})` : ""}: Reservierung endet${day}.`,
        };
      }
      return {
        title:
          input.ipamSeverity === "critical"
            ? "IP-Adressverwaltung: kritischer Fund"
            : "IP-Adressverwaltung",
        body:
          where && what
            ? `${where}: ${what}`
            : (what ?? where ?? "Neuer Fund in der IP-Adressverwaltung."),
      };
    }
    case "summary":
      return {
        title: "nextDesk",
        body: `${Math.max(
          1,
          input.summaryCount ?? 1,
        )} neue Hinweise in nextDesk.`,
      };
    case "test":
      return {
        title: "nextDesk",
        body: "Testmitteilung: Push-Benachrichtigungen funktionieren.",
      };
  }
}

/** Kategorien für Antwort-Knöpfe; müssen mit der App übereinstimmen. */
export const APNS_TICKET_CATEGORY = "NEXTDESK_TICKET";
export const APNS_SERVICE_TASK_CATEGORY = "NEXTDESK_SERVICE_TASK";

/** Ticket-Mitteilungen an Bearbeitende, die die Antwort-Knöpfe bekommen. */
const APNS_AGENT_TICKET_KINDS: ReadonlySet<ApnsPayloadKind> = new Set([
  "assigned",
  "requester_reply",
  "mention",
  "escalation",
  "sla",
  "follow_up",
  "watched",
  "rule_reminder",
  "vendor_reminder",
  "children_done",
]);

/** Builds only the APNs JSON body; no device token or secret enters this payload. */
export function buildApnsPayload(
  input: ApnsPayloadInput,
  formality: Formality = "du",
): Record<string, unknown> {
  const baseAlert = alertFor(input, formality);
  const delegatedFrom = input.delegatedFromName
    ? truncateSubject(input.delegatedFromName)
    : null;
  const alert = delegatedFrom
    ? { ...baseAlert, title: `Vertretung ${delegatedFrom}: ${baseAlert.title}` }
    : baseAlert;
  const data: Record<string, unknown> = {
    nextdeskV: 1,
    tenantId: input.tenantId,
    notificationId: input.notificationId,
    kind: input.kind,
  };
  if (
    input.ticketId &&
    input.kind !== "summary" &&
    input.kind !== "test" &&
    input.kind !== "inventory_low_stock"
  ) {
    data.ticketId = input.ticketId;
  }
  if (input.kind === "incident" && input.incidentId) {
    data.incidentId = input.incidentId;
  }
  if (input.contractId && input.kind === "contract_deadline") {
    data.contractId = input.contractId;
  }
  if (input.kind === "shop" && input.orderId) {
    data.orderId = input.orderId;
  }
  if (input.kind === "service_task" && input.occurrenceId) {
    data.occurrenceId = input.occurrenceId;
  }
  if (input.kind === "infrastructure" && input.assetId) {
    data.assetId = input.assetId;
  }
  if (input.kind === "ipam") {
    if (input.ipamEvent) data.ipamEvent = input.ipamEvent;
    if (input.ipamAddress) data.ipamAddress = input.ipamAddress;
    if (input.assetId) data.assetId = input.assetId;
  }
  // Inventory: only the opaque id of the article or location, never names.
  if (input.kind === "inventory_low_stock") {
    if (input.inventoryItemId && PAYLOAD_UUID.test(input.inventoryItemId)) {
      data.inventoryItemId = input.inventoryItemId;
    } else if (
      input.inventoryLocationId &&
      PAYLOAD_UUID.test(input.inventoryLocationId)
    ) {
      data.inventoryLocationId = input.inventoryLocationId;
    }
  }
  if (
    input.notificationKind &&
    input.kind !== "summary" &&
    input.kind !== "test" &&
    NOTIFICATION_KIND.test(input.notificationKind)
  ) {
    data.notificationKind = input.notificationKind;
  }
  const aps: Record<string, unknown> = {
    alert,
    sound: "default",
  };
  // iOS shows «Problem ist gelöst» / «Ich brauche noch Hilfe» as notification
  // actions; both open the ticket in the app, where the person confirms.
  if (input.kind === "requester_reminder" && input.ticketId) {
    aps.category = APNS_REQUESTER_REMINDER_CATEGORY;
  }
  if (
    input.ticketId &&
    input.kind !== "summary" &&
    input.kind !== "test" &&
    input.kind !== "inventory_low_stock"
  ) {
    aps["thread-id"] = input.ticketId;
    // Antwort-Knöpfe direkt in der Mitteilung (iPhone und Apple Watch); die
    // App registriert die Kategorie in lib/notification-actions.ts. Nur für
    // Mitteilungen an Bearbeitende, nicht an Anfragende.
    if (APNS_AGENT_TICKET_KINDS.has(input.kind)) {
      aps.category = APNS_TICKET_CATEGORY;
    }
  } else if (input.kind === "service_task" && input.occurrenceId) {
    aps.category = APNS_SERVICE_TASK_CATEGORY;
  }
  return { aps, body: data };
}

export async function sendApns(
  token: string,
  environment: ApnsEnvironment,
  payload: Record<string, unknown>,
  collapseId: string,
): Promise<{ status: number; reason?: string }> {
  const configuration = readConfiguration();
  if (!configuration) return { status: 0, reason: "apns_not_configured" };
  try {
    const authorization = await apnsJwt(configuration);
    const host =
      environment === "development"
        ? "https://api.sandbox.push.apple.com"
        : "https://api.push.apple.com";
    const response = await fetch(`${host}/3/device/${token}`, {
      method: "POST",
      headers: {
        authorization: `bearer ${authorization}`,
        "apns-topic": "ch.grossict.nextdesk",
        "apns-push-type": "alert",
        "apns-priority": "10",
        "apns-expiration": String(Math.floor(Date.now() / 1000) + 24 * 60 * 60),
        "apns-collapse-id": collapseId.slice(0, 64),
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    let reason: string | undefined;
    try {
      const parsed: unknown = await response.json();
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        "reason" in parsed &&
        typeof parsed.reason === "string"
      ) {
        reason = parsed.reason;
      }
    } catch {
      // APNs may return an empty response body; status remains authoritative.
    }
    return reason
      ? { status: response.status, reason }
      : { status: response.status };
  } catch {
    return { status: 0, reason: "network_error" };
  }
}
