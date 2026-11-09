// Text of e-mail notifications (same events as push notifications).
// Pure: no database or network access, see notification-email.test.ts.

type Payload = Record<string, unknown>;

export type NotificationEmailInput = {
  kind: string;
  payload: Payload;
  ticketNumber: string | null;
  ticketSubject: string | null;
};

export type NotificationEmailText = {
  /** Mail subject (without portal name). */
  subject: string;
  /** Plain text body, one or more paragraphs. */
  body: string;
};

function text(value: unknown, max = 120): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  if (!cleaned) return null;
  const characters = Array.from(cleaned);
  return characters.length <= max
    ? cleaned
    : `${characters.slice(0, max - 1).join("")}…`;
}

function day(value: unknown): string | null {
  const match =
    typeof value === "string" ? /^(\d{4})-(\d{2})-(\d{2})/.exec(value) : null;
  return match ? `${match[3]}.${match[2]}.${match[1]}` : null;
}

const SHOP_EVENTS: Record<string, [string, string]> = {
  approval_requested: [
    "Freigabe für Bestellung",
    "Eine Bestellung wartet auf Ihre Freigabe.",
  ],
  placed_for_you: [
    "Bestellung für Sie erfasst",
    "Der Support hat eine Bestellung für Sie erfasst.",
  ],
  submitted: ["Neue Bestellung", "Eine Bestellung ist eingegangen."],
  approved: ["Bestellung freigegeben", "Ihre Bestellung wurde freigegeben."],
  in_progress: [
    "Bestellung in Bearbeitung",
    "Ihre Bestellung wird vorbereitet.",
  ],
  ready: ["Bereit zur Abholung", "Ihre Bestellung liegt für Sie bereit."],
  issued: ["Bestellung ausgegeben", "Ihre Bestellung wurde ausgegeben."],
  returned: ["Rückgabe bestätigt", "Die Ausleihe wurde zurückgenommen."],
  rejected: ["Bestellung abgelehnt", "Ihre Bestellung wurde abgelehnt."],
  cancelled: ["Bestellung storniert", "Die Bestellung wurde storniert."],
};

const INFRASTRUCTURE_REASONS: Record<string, string> = {
  warranty: "Die Garantie",
  support: "Der Herstellersupport",
  end_of_life: "Das End of Life",
  maintenance: "Die Wartung",
  replacement: "Der geplante Ersatz",
};

const TICKET_EVENTS: Record<string, [string, string]> = {
  "ticket.assigned": [
    "Ticket zugewiesen",
    "Ihnen wurde ein Ticket zugewiesen.",
  ],
  "ticket.requester_reply": [
    "Neue Nachricht",
    "Die anfragende Person hat auf ein Ticket geantwortet.",
  ],
  "ticket.support_reply": [
    "Antwort vom Support",
    "Der Support hat auf Ihr Ticket geantwortet.",
  ],
  "ticket.requester_reminder": [
    "Wir warten auf Ihre Antwort",
    "Der Support braucht noch eine Rückmeldung von Ihnen.",
  ],
  "ticket.mention": [
    "Sie wurden erwähnt",
    "Sie wurden in einem Ticket erwähnt.",
  ],
  "ticket.supervisor_request": [
    "Anfrage an Sie",
    "Zu einem Ticket wird Ihre Einschätzung benötigt.",
  ],
  "ticket.supervisor_answer": [
    "Antwort auf Ihre Anfrage",
    "Ihre Rückfrage zu einem Ticket wurde beantwortet.",
  ],
  "ticket.resolved": ["Ticket gelöst", "Ein Ticket wurde als gelöst markiert."],
  "ticket.kudos": [
    "Lob von Kund:innen",
    "Ein Ticket wurde sehr gut bewertet. Danke für Ihren Einsatz!",
  ],
  "ticket.approval.requested": [
    "Freigabe benötigt",
    "Eine Freigabe wartet auf Ihre Entscheidung.",
  ],
  "ticket.follow_up_due": [
    "Wiedervorlage fällig",
    "Eine Wiedervorlage ist fällig.",
  ],
  "ticket.rule_reminder": [
    "Erinnerung",
    "Ein Ticket braucht Ihre Aufmerksamkeit.",
  ],
  "ticket.vendor_reminder": [
    "Drittanbieter nachfassen",
    "Der Drittanbieter hat sich zu einem Ticket noch nicht gemeldet.",
  ],
  "ticket.children_done": [
    "Teil-Tickets erledigt",
    "Alle Teil-Tickets sind erledigt.",
  ],
  "ticket.escalation_opened": [
    "Ticket eskaliert",
    "Ein Ticket wurde eskaliert.",
  ],
  "ticket.security_report": [
    "Phishing-Meldung",
    "Eine verdächtige E-Mail wurde gemeldet.",
  ],
  "contract.deadline": [
    "Vertragsfrist",
    "Eine Vertragsfrist erfordert Ihre Aufmerksamkeit.",
  ],
  "inventory.low_stock": [
    "Lagerunterbestand",
    "Ein Artikel hat den Mindestbestand erreicht.",
  ],
};

export function notificationEmailText(
  input: NotificationEmailInput,
): NotificationEmailText {
  const { kind, payload } = input;
  const ticket = input.ticketNumber
    ? `${input.ticketNumber}${input.ticketSubject ? ` · ${text(input.ticketSubject)}` : ""}`
    : null;
  let title: string;
  let lines: string[];

  if (kind.startsWith("shop.order.")) {
    const [shopTitle, shopBody] = SHOP_EVENTS[
      kind.slice("shop.order.".length)
    ] ?? ["Shop", "Es gibt eine Neuigkeit zu einer Bestellung."];
    const number = text(payload.orderNumber, 40);
    title = number ? `${shopTitle}: ${number}` : shopTitle;
    lines = [shopBody];
  } else if (kind.startsWith("service_task.")) {
    const task = text(payload.title) ?? "Eine Serviceaufgabe";
    const overdue = kind === "service_task.overdue";
    title = overdue ? "Serviceaufgabe überfällig" : "Serviceaufgabe fällig";
    lines = [overdue ? `${task} ist überfällig.` : `${task} ist heute fällig.`];
  } else if (kind === "infrastructure.due") {
    const device = text(payload.assetName) ?? "Ein Gerät";
    const what = INFRASTRUCTURE_REASONS[String(payload.reason)] ?? "Eine Frist";
    const due = day(payload.dueOn);
    title = `Infrastruktur: ${device}`;
    lines = [`${what} von ${device} ist fällig${due ? ` (${due})` : ""}.`];
  } else if (kind.startsWith("ticket.sla.")) {
    title = "SLA-Hinweis";
    lines = ["Eine SLA-Frist eines Tickets ist betroffen."];
  } else if (kind.startsWith("ticket.watch.")) {
    title = "Änderung an beobachtetem Ticket";
    lines = ["An einem Ticket, das Sie beobachten, hat sich etwas geändert."];
  } else {
    const [eventTitle, eventBody] = TICKET_EVENTS[kind] ?? [
      "Benachrichtigung",
      "Es gibt eine Neuigkeit in nextDesk.",
    ];
    title = eventTitle;
    lines = [eventBody];
    const rule =
      kind === "ticket.rule_reminder" ? text(payload.ruleName) : null;
    if (rule) title = `Erinnerung: ${rule}`;
    const vendor =
      kind === "ticket.vendor_reminder" ? text(payload.vendorName) : null;
    if (vendor) {
      lines = [`${vendor} hat sich zu einem Ticket noch nicht gemeldet.`];
    }
  }

  if (ticket) lines.push(`Ticket: ${ticket}`);
  lines.push(
    "Sie erhalten diese E-Mail, weil Sie diese Benachrichtigung in nextDesk unter «Persönliche Einstellungen → Benachrichtigungen» per E-Mail eingeschaltet haben.",
  );
  return {
    subject: input.ticketNumber ? `[${input.ticketNumber}] ${title}` : title,
    body: lines.join("\n\n"),
  };
}
