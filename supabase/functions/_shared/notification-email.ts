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
  /** Headline of the event (e.g. «Ticket zugewiesen»). */
  title: string;
  /** The message without the hint why the mail was sent. */
  message: string;
  /** Why the person receives this mail. */
  hint: string;
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
  loan_due: [
    "Ausleihe endet bald",
    "Ihre Ausleihe endet in zwei Tagen. Bitte geben Sie das Gerät rechtzeitig zurück.",
  ],
  loan_overdue: [
    "Ausleihe überfällig",
    "Ihre Ausleihe ist überfällig. Bitte geben Sie das Gerät zurück.",
  ],
  approval_reminder: [
    "Freigabe ausstehend",
    "Eine Bestellung wartet noch auf Ihre Freigabe.",
  ],
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
  "inventory.reorder": [
    "Nachbestellen",
    "Ein Artikel hat den Mindestbestand erreicht. Bitte nachbestellen.",
  ],
  "inventory.count_due": ["Inventur fällig", "Eine Inventur ist fällig."],
  "security.case_overdue": [
    "Sicherheitsfall überfällig",
    "Die Frist für das Urteil zu einem Sicherheitsfall ist abgelaufen. Bitte unter «Sicherheitsfälle» entscheiden.",
  ],
  "security.case_clicked": [
    "Melder hat geklickt",
    "Eine meldende Person hat angegeben, in der gemeldeten E-Mail einen Link oder Anhang geöffnet oder Daten eingegeben zu haben. Bitte Passwort zurücksetzen und Anmeldungen prüfen.",
  ],
  "security.campaign": [
    "Phishing-Kampagne",
    "Mehrere Personen haben dieselbe verdächtige E-Mail gemeldet.",
  ],
};

const IPAM_TITLES: Record<string, string> = {
  "ipam.finding": "IP-Adressverwaltung",
  "monitoring.ipam_finding": "IP-Adressverwaltung",
  "ipam.agent_offline": "Netzwerkagent offline",
  "ipam.reservation_expiring": "Reservierung läuft ab",
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
    // Eskalationen (0314): an Vorgesetzte bzw. Stellvertretung.
    if (kind === "shop.order.loan_overdue" && payload.audience === "manager") {
      lines = [
        "Eine Ausleihe einer Person aus Ihrem Team ist seit mehreren Tagen überfällig.",
      ];
    } else if (
      kind === "shop.order.approval_reminder" &&
      (payload.audience === "deputy" || payload.audience === "manager")
    ) {
      lines = [
        "Eine Bestellung wartet seit mehreren Tagen auf Freigabe. Sie erhalten diese Erinnerung als Stellvertretung.",
      ];
    }
  } else if (kind.startsWith("service_task.")) {
    const task = text(payload.title) ?? "Eine Serviceaufgabe";
    const overdue = kind === "service_task.overdue";
    const handedOver = overdue && payload.handover === "team";
    title = handedOver
      ? "Serviceaufgabe ans Team übergeben"
      : overdue
        ? "Serviceaufgabe überfällig"
        : "Serviceaufgabe fällig";
    lines = [
      handedOver
        ? `${task} ist überfällig und wurde ans Team übergeben.`
        : overdue
          ? `${task} ist überfällig.`
          : `${task} ist heute fällig.`,
    ];
  } else if (kind === "infrastructure.due") {
    const device = text(payload.assetName) ?? "Ein Gerät";
    const what = INFRASTRUCTURE_REASONS[String(payload.reason)] ?? "Eine Frist";
    const due = day(payload.dueOn);
    title = `Infrastruktur: ${device}`;
    lines = [`${what} von ${device} ist fällig${due ? ` (${due})` : ""}.`];
  } else if (IPAM_TITLES[kind]) {
    const where = text(payload.number, 60) ?? text(payload.address, 45);
    const what = text(payload.title, 200);
    title = IPAM_TITLES[kind]!;
    if (kind === "ipam.agent_offline") {
      const agent = text(payload.agentName) ?? where ?? "Ein Netzwerkagent";
      lines = [
        `${agent} hat sich seit über zwei Stunden nicht gemeldet.`,
        "Bitte prüfen Sie den Dienst auf dem Server. Details unter «IP-Adressen → Discovery».",
      ];
    } else if (kind === "ipam.reservation_expiring") {
      const until = day(payload.reservedUntil);
      title = where ? `${title}: ${where}` : title;
      lines = [
        `Die Reservierung${where ? ` von ${where}` : ""}${what ? ` (${what})` : ""} endet${until ? ` am ${until}` : " bald"}. Danach wird die Adresse automatisch freigegeben.`,
        "Verlängern oder freigeben unter «IP-Adressen».",
      ];
    } else {
      if (payload.severity === "critical") title = `${title}: kritischer Fund`;
      lines = [
        `${where ? `${where}: ` : ""}${what ?? "Neuer Fund in der IP-Adressverwaltung"}.`,
        "Details unter «IP-Adressen → Funde».",
      ];
    }
  } else if (kind.startsWith("monitoring.")) {
    const number = text(payload.number, 40);
    const name = text(payload.title, 200) ?? "Ein Gerät";
    const warning = payload.severity === "warning";
    const what = warning ? "Warnung" : "Störung";
    title =
      payload.reason === "realert"
        ? `Noch unbestätigt: ${what}`
        : payload.reason === "escalated"
          ? "Störung: jetzt Ausfall"
          : payload.reason === "reopened"
            ? `Erneut: ${what}`
            : what;
    if (number) title = `${title} ${number}`;
    lines = [
      `${warning ? "PRTG meldet eine Warnung" : "PRTG meldet einen Ausfall"}: ${name}.`,
      payload.reason === "realert"
        ? "Die Störung ist noch von niemandem bestätigt. Bitte unter «Störungen» bestätigen."
        : "Details und Bestätigen unter «Störungen».",
    ];
  } else if (kind === "ticket.sla.supervisor_no_response") {
    const agent = text(payload.agentName, 200);
    title = "Team: Ticket ohne Antwort";
    lines = [
      `Die Frist für die erste Antwort ist abgelaufen${agent ? ` (zuständig: ${agent})` : " (nicht zugewiesen)"}.`,
    ];
  } else if (kind === "ticket.sla.supervisor_risk") {
    const agent = text(payload.agentName, 200);
    title = "Team: SLA in Gefahr";
    lines = [
      `Das Ticket verletzt in weniger als einer Stunde die Lösungsfrist${agent ? ` (zuständig: ${agent})` : " (nicht zugewiesen)"}.`,
    ];
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
    if (kind === "security.campaign") {
      const count = payload.reporterCount ?? payload.count;
      if (typeof count === "number" && Number.isInteger(count) && count > 1) {
        lines = [`${count} Personen haben dieselbe verdächtige E-Mail gemeldet.`];
      }
    }
    if (
      kind === "security.case_overdue" &&
      (payload.stage === "supervisor" || payload.escalated === true)
    ) {
      title = "Sicherheitsfall: Eskalation";
      lines = [
        "Ein Sicherheitsfall wartet seit über 24 Stunden nach Fristablauf auf ein Urteil.",
      ];
    }
    if (kind === "ticket.security_report") {
      if (payload.event === "clicked") {
        title = "Melder hat geklickt";
        const reporter = text(payload.reporterEmail, 200);
        lines = [
          `${reporter ?? "Eine meldende Person"} hat angegeben, in der gemeldeten E-Mail einen Link oder Anhang geöffnet oder Daten eingegeben zu haben.`,
          "Bitte Passwort zurücksetzen und Anmeldungen prüfen.",
        ];
      } else {
        const risk = text(payload.riskLabel, 40);
        const score =
          typeof payload.riskScore === "number" ? ` (${payload.riskScore})` : "";
        lines = [
          "Eine verdächtige E-Mail wurde gemeldet. Sie wartet unter «Sicherheitsfälle» auf Ihr Urteil.",
          ...(risk ? [`Automatische Risikoeinschätzung: ${risk}${score}`] : []),
        ];
      }
    }
  }

  const message = lines.join("\n\n");
  if (ticket) lines.push(`Ticket: ${ticket}`);
  const hint =
    "Sie erhalten diese E-Mail, weil Sie diese Benachrichtigung in nextDesk unter «Persönliche Einstellungen → Benachrichtigungen» per E-Mail eingeschaltet haben.";
  lines.push(hint);
  return {
    subject: input.ticketNumber ? `[${input.ticketNumber}] ${title}` : title,
    body: lines.join("\n\n"),
    title,
    message,
    hint,
  };
}
