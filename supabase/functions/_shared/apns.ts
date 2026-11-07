type ApnsEnvironment = "production" | "development";

export type ApnsPayloadKind =
  | "assigned"
  | "requester_reply"
  | "support_reply"
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
  | "summary"
  | "test";

export type ApnsPayloadInput = {
  kind: ApnsPayloadKind;
  tenantId: string;
  notificationId: string;
  ticketId?: string;
  contractId?: string;
  ticketNumber?: string;
  subject?: string | null;
  summaryCount?: number;
  shopEvent?: string;
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
  /** Forwarded to a stand-in: name of the absent person. */
  delegatedFromName?: string;
};

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
  const unsigned = `${
    utf8Base64url(JSON.stringify({ alg: "ES256", kid: configuration.keyId }))
  }.${
    utf8Base64url(JSON.stringify({ iss: configuration.teamId, iat: issuedAt }))
  }`;
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

function alertFor(input: ApnsPayloadInput): { title: string; body: string } {
  const ticketNumber = input.ticketNumber ?? "";
  const subject = typeof input.subject === "string"
    ? truncateSubject(input.subject)
    : null;

  switch (input.kind) {
    case "assigned":
      return {
        title: "Ticket zugewiesen",
        body: subject
          ? `${ticketNumber} wurde dir zugewiesen: ${subject}`
          : `${ticketNumber} wurde dir zugewiesen.`,
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
          ? `Es gibt eine neue Antwort zu deinem Ticket ${ticketNumber}: ${subject}`
          : `Es gibt eine neue Antwort zu deinem Ticket ${ticketNumber}.`,
      };
    case "mention":
      return {
        title: "Du wurdest erwähnt",
        body: subject
          ? `Du wurdest in ${ticketNumber} in einer internen Notiz erwähnt: ${subject}`
          : `Du wurdest in ${ticketNumber} in einer internen Notiz erwähnt.`,
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
          ? `Für ${ticketNumber} wird deine Freigabe benötigt: ${subject}`
          : `Für ${ticketNumber} wird deine Freigabe benötigt.`,
      };
    case "department_question_asked":
      return {
        title: "Abteilungsrückfrage",
        body: subject
          ? `Für ${ticketNumber} wird Ihre Antwort benötigt: ${subject}`
          : `Für ${ticketNumber} wird Ihre Antwort benötigt.`,
      };
    case "department_question_answered":
      return {
        title: "Antwort der Abteilungsleitung",
        body: subject
          ? `Es gibt eine Antwort zu Ihrer Rückfrage in ${ticketNumber}: ${subject}`
          : `Es gibt eine Antwort zu Ihrer Rückfrage in ${ticketNumber}.`,
      };
    case "supervisor_request":
      return {
        title: "Anfrage an dich",
        body: subject
          ? `Zu ${ticketNumber} wird deine Antwort benötigt: ${subject}`
          : `Zu ${ticketNumber} wird deine Antwort benötigt.`,
      };
    case "supervisor_answer":
      return {
        title: "Antwort auf deine Anfrage",
        body: subject
          ? `Deine Anfrage zu ${ticketNumber} wurde beantwortet: ${subject}`
          : `Deine Anfrage zu ${ticketNumber} wurde beantwortet.`,
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
        body: "Eine Vertragsfrist erfordert deine Aufmerksamkeit.",
      };
    case "shop": {
      const number = input.orderNumber ? ` ${input.orderNumber}` : "";
      switch (input.shopEvent) {
        case "approval_requested":
          return {
            title: "Freigabe für Bestellung",
            body: `Bestellung${number} wartet auf deine Freigabe.`,
          };
        case "placed_for_you":
          return {
            title: "Bestellung für dich erfasst",
            body: `Der Support hat Bestellung${number} für dich erfasst.`,
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
          return {
            title: "Bereit zur Abholung",
            body: `Bestellung${number} liegt für dich bereit.`,
          };
        case "issued":
          return {
            title: "Bestellung ausgegeben",
            body: `Bestellung${number} wurde ausgegeben.`,
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
        default:
          return { title: "Shop", body: `Neuigkeit zu Bestellung${number}.` };
      }
    }
    case "service_task": {
      const title = input.serviceTaskTitle?.trim().slice(0, 80) ||
        "Eine Serviceaufgabe";
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
    case "inventory_low_stock":
      return {
        title: "Lagerunterbestand",
        body: "Ein Lagerartikel hat den Mindestbestand erreicht.",
      };
    case "summary":
      return {
        title: "nextDesk",
        body: `${
          Math.max(1, input.summaryCount ?? 1)
        } neue Hinweise in nextDesk.`,
      };
    case "test":
      return {
        title: "nextDesk",
        body: "Testmitteilung: Push-Benachrichtigungen funktionieren.",
      };
  }
}

/** Builds only the APNs JSON body; no device token or secret enters this payload. */
export function buildApnsPayload(
  input: ApnsPayloadInput,
): Record<string, unknown> {
  const baseAlert = alertFor(input);
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
  const aps: Record<string, unknown> = {
    alert,
    sound: "default",
  };
  if (
    input.ticketId &&
    input.kind !== "summary" &&
    input.kind !== "test" &&
    input.kind !== "inventory_low_stock"
  ) {
    aps["thread-id"] = input.ticketId;
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
    const host = environment === "development"
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
