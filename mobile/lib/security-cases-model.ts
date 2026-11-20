// Security cases (phishing reports handled as their own kind of case).
// Parsing of the security-cases edge function responses; pure.

export type SecurityVerdict = "harmless" | "spam" | "phishing" | "targeted";
export type SecurityCaseState = "triage" | "actions" | "closed";
export type SecurityStateFilter =
  | SecurityCaseState
  | "all"
  /** Tiles: reported today, decided (30 days), someone clicked (30 days). */
  | "today"
  | "decided"
  | "clicked";
export type RiskLevel = "low" | "medium" | "high";

export const VERDICTS: readonly SecurityVerdict[] = [
  "harmless",
  "spam",
  "phishing",
  "targeted",
];

export const VERDICT_LABELS: Record<SecurityVerdict, string> = {
  harmless: "Harmlos",
  spam: "Spam",
  phishing: "Phishing",
  targeted: "Gezielter Angriff",
};

export const STATE_LABELS: Record<SecurityCaseState, string> = {
  triage: "Zu beurteilen",
  actions: "Massnahmen",
  closed: "Abgeschlossen",
};

export const RISK_LABELS: Record<RiskLevel, string> = {
  low: "tief",
  medium: "mittel",
  high: "hoch",
};

export type SecurityCaseSummary = {
  ticketId: string;
  ticketNumber: string | null;
  subject: string | null;
  from: string | null;
  state: SecurityCaseState;
  verdict: SecurityVerdict | null;
  riskScore: number;
  riskLevel: RiskLevel;
  reports: number;
  reporters: number;
  firstReportedAt: string | null;
  decisionDueAt: string | null;
  overdue: boolean;
  teamName: string | null;
  assignedAgentId: string | null;
  assignedAgentName: string | null;
};

export type SecurityStats = {
  triage: number;
  triageHigh: number;
  overdue: number;
  actions: number;
  reportsToday: number;
  reportersToday: number;
  medianVerdictMinutes: number | null;
  clickAnswers: number;
  clickYes: number;
};

export type SecurityCaseDetail = {
  ticketId: string;
  ticketNumber: string | null;
  subject: string | null;
  description: string | null;
  teamName: string | null;
  assignedAgentId: string | null;
  assignedAgentName: string | null;
  createdAt: string | null;
  state: SecurityCaseState;
  verdict: SecurityVerdict | null;
  verdictBy: string | null;
  verdictAt: string | null;
  decisionDueAt: string | null;
  reportersNotifiedAt: string | null;
  closedAt: string | null;
  analysis: {
    score: number;
    level: RiskLevel;
    from: string | null;
    fromName: string | null;
    replyTo: string | null;
    returnPath: string | null;
    subject: string | null;
    date: string | null;
    sendingIp: string | null;
    auth: { spf: string; dkim: string; dmarc: string };
    findings: { severity: string; message: string }[];
    links: { href: string; text: string | null; host: string | null }[];
    attachments: {
      filename: string;
      contentType: string | null;
      size: number | null;
    }[];
  };
  reporters: {
    name: string;
    email: string | null;
    channel: string | null;
    reportedAt: string | null;
    asked: boolean;
    answer: "yes" | "no" | null;
  }[];
  actions: {
    id: string;
    label: string;
    doneAt: string | null;
    doneBy: string | null;
  }[];
  /** Someone answered «yes, I clicked» (case priority is high). */
  clickedAt: string | null;
  escalatedAt: string | null;
  campaign: {
    reports: number;
    reporters: number;
    caseCount: number;
    senderDomain: string | null;
  } | null;
  /** Known indicators (IOC list) found in this mail; values are defanged. */
  iocHits: { id: string; kind: string; value: string }[];
  measures: {
    id: string;
    label: string;
    target: string | null;
    status: "succeeded" | "failed";
    createdAt: string | null;
  }[];
  /** The reported mail as received (only stored for newer reports). */
  originalMail: {
    subject: string | null;
    from: string | null;
    to: string | null;
    cc: string | null;
    date: string | null;
    headers: { name: string; value: string }[];
    /** Readable text: the text part, else the HTML without markup. */
    text: string;
  } | null;
};

export const INDICATOR_LABELS: Record<string, string> = {
  domain: "Domain",
  url: "URL",
  ip: "IP",
  sender: "Absender",
};

type Row = Record<string, unknown>;

function isRecord(value: unknown): value is Row {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}
function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function list(value: unknown): Row[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}
function state(value: unknown): SecurityCaseState {
  return value === "actions" || value === "closed" ? value : "triage";
}
function verdict(value: unknown): SecurityVerdict | null {
  return VERDICTS.includes(value as SecurityVerdict)
    ? (value as SecurityVerdict)
    : null;
}
function risk(value: unknown): RiskLevel {
  return value === "high" || value === "medium" ? value : "low";
}

function data(value: unknown): Row | null {
  return isRecord(value) && isRecord(value.data) ? value.data : null;
}

export function parseSecurityList(
  value: unknown,
): { cases: SecurityCaseSummary[]; stats: SecurityStats } | null {
  const body = data(value);
  if (!body) return null;
  const stats = isRecord(body.stats) ? body.stats : {};
  return {
    cases: list(body.cases).flatMap((row) => {
      const ticketId = str(row.ticketId);
      if (!ticketId) return [];
      return [
        {
          ticketId,
          ticketNumber: str(row.ticketNumber),
          subject: str(row.subject),
          from: str(row.from),
          state: state(row.state),
          verdict: verdict(row.verdict),
          riskScore: num(row.riskScore),
          riskLevel: risk(row.riskLevel),
          reports: num(row.reports),
          reporters: num(row.reporters),
          firstReportedAt: str(row.firstReportedAt),
          decisionDueAt: str(row.decisionDueAt),
          overdue: row.overdue === true,
          teamName: str(row.teamName),
          assignedAgentId: str(row.assignedAgentId),
          assignedAgentName: str(row.assignedAgentName),
        },
      ];
    }),
    stats: {
      triage: num(stats.triage),
      triageHigh: num(stats.triageHigh),
      overdue: num(stats.overdue),
      actions: num(stats.actions),
      reportsToday: num(stats.reportsToday),
      reportersToday: num(stats.reportersToday),
      medianVerdictMinutes:
        typeof stats.medianVerdictMinutes === "number"
          ? stats.medianVerdictMinutes
          : null,
      clickAnswers: num(stats.clickAnswers),
      clickYes: num(stats.clickYes),
    },
  };
}

export function parseSecurityDetail(value: unknown): SecurityCaseDetail | null {
  const body = data(value);
  const ticketId = str(body?.ticketId);
  if (!body || !ticketId) return null;
  const analysis = isRecord(body.analysis) ? body.analysis : {};
  const auth = isRecord(analysis.auth) ? analysis.auth : {};
  return {
    ticketId,
    ticketNumber: str(body.ticketNumber),
    subject: str(body.subject),
    description: str(body.description),
    teamName: str(body.teamName),
    assignedAgentId: str(body.assignedAgentId),
    assignedAgentName: str(body.assignedAgentName),
    createdAt: str(body.createdAt),
    state: state(body.state),
    verdict: verdict(body.verdict),
    verdictBy: str(body.verdictBy),
    verdictAt: str(body.verdictAt),
    decisionDueAt: str(body.decisionDueAt),
    reportersNotifiedAt: str(body.reportersNotifiedAt),
    closedAt: str(body.closedAt),
    analysis: {
      score: num(analysis.score),
      level: risk(analysis.level),
      from: str(analysis.from),
      fromName: str(analysis.fromName),
      replyTo: str(analysis.replyTo),
      returnPath: str(analysis.returnPath),
      subject: str(analysis.subject),
      date: str(analysis.date),
      sendingIp: str(analysis.sendingIp),
      auth: {
        spf: str(auth.spf) ?? "unknown",
        dkim: str(auth.dkim) ?? "unknown",
        dmarc: str(auth.dmarc) ?? "unknown",
      },
      findings: list(analysis.findings).flatMap((row) => {
        const message = str(row.message);
        return message
          ? [{ severity: str(row.severity) ?? "info", message }]
          : [];
      }),
      links: list(analysis.links).flatMap((row) => {
        const href = str(row.href);
        return href ? [{ href, text: str(row.text), host: str(row.host) }] : [];
      }),
      attachments: list(analysis.attachments).map((row) => ({
        filename: str(row.filename) ?? "Anhang",
        contentType: str(row.contentType),
        size: typeof row.size === "number" ? row.size : null,
      })),
    },
    reporters: list(body.reporters).map((row) => ({
      name: str(row.name) ?? "Unbekannt",
      email: str(row.email),
      channel: str(row.channel),
      reportedAt: str(row.reportedAt),
      asked: row.asked === true,
      answer: row.answer === "yes" || row.answer === "no" ? row.answer : null,
    })),
    actions: list(body.actions).flatMap((row) => {
      const id = str(row.id);
      const label = str(row.label);
      return id && label
        ? [{ id, label, doneAt: str(row.doneAt), doneBy: str(row.doneBy) }]
        : [];
    }),
    clickedAt: str(body.clickedAt),
    escalatedAt: str(body.escalatedAt),
    campaign: isRecord(body.campaign)
      ? {
          reports: num(body.campaign.reports),
          reporters: num(body.campaign.reporters),
          caseCount: num(body.campaign.caseCount),
          senderDomain: str(body.campaign.senderDomain),
        }
      : null,
    iocHits: list(body.iocHits).flatMap((row) => {
      const id = str(row.id);
      const value = str(row.value);
      const kind = str(row.kind);
      return id && value && kind && INDICATOR_LABELS[kind]
        ? [{ id, kind, value }]
        : [];
    }),
    originalMail: isRecord(body.originalMail)
      ? {
          subject: str(body.originalMail.subject),
          from: str(body.originalMail.from),
          to: str(body.originalMail.to),
          cc: str(body.originalMail.cc),
          date: str(body.originalMail.date),
          headers: list(body.originalMail.headers).flatMap((row) => {
            const name = str(row.name);
            return name
              ? [
                  {
                    name,
                    value: typeof row.value === "string" ? row.value : "",
                  },
                ]
              : [];
          }),
          text: readableMailText(
            typeof body.originalMail.text === "string"
              ? body.originalMail.text
              : "",
            typeof body.originalMail.html === "string"
              ? body.originalMail.html
              : "",
          ),
        }
      : null,
    measures: list(body.measures).flatMap((row) => {
      const id = str(row.id);
      return id
        ? [
            {
              id,
              label: str(row.label) ?? "Massnahme",
              target: str(row.target),
              status:
                row.status === "succeeded"
                  ? ("succeeded" as const)
                  : ("failed" as const),
              createdAt: str(row.createdAt),
            },
          ]
        : [];
    }),
  };
}

export function parseTemplates(
  value: unknown,
): { templates: Record<SecurityVerdict, string[]>; custom: boolean } | null {
  const body = data(value);
  if (!body || !isRecord(body.templates)) return null;
  const source = body.templates;
  const templates = {} as Record<SecurityVerdict, string[]>;
  for (const entry of VERDICTS) {
    const items = source[entry];
    templates[entry] = Array.isArray(items)
      ? items.filter((item): item is string => typeof item === "string")
      : [];
  }
  return { templates, custom: body.custom === true };
}

/** «18 min», «3 h 20 min», «2 Tage». */
export function formatMinutes(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "–";
  const minutes = Math.max(0, Math.round(value));
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 24 * 60) {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest ? `${hours} h ${rest} min` : `${hours} h`;
  }
  const days = Math.round(minutes / (24 * 60));
  return days === 1 ? "1 Tag" : `${days} Tage`;
}

/** «vor 26 min», «vor 3 h», «vor 2 Tagen». */
export function formatAgo(value: string | null, now = Date.now()): string {
  if (!value) return "";
  const minutes = Math.max(0, Math.round((now - Date.parse(value)) / 60_000));
  if (!Number.isFinite(minutes)) return "";
  if (minutes < 1) return "gerade eben";
  if (minutes < 60) return `vor ${minutes} min`;
  if (minutes < 24 * 60) return `vor ${Math.floor(minutes / 60)} h`;
  const days = Math.floor(minutes / (24 * 60));
  return days === 1 ? "vor 1 Tag" : `vor ${days} Tagen`;
}

export const AUTH_LABELS: Record<string, string> = {
  pass: "bestanden",
  fail: "fehlgeschlagen",
  softfail: "unsicher",
  neutral: "neutral",
  none: "fehlt",
  temperror: "Fehler",
  permerror: "Fehler",
  unknown: "unbekannt",
};

export function authTone(value: string): "ok" | "bad" | "warn" {
  if (value === "pass") return "ok";
  if (value === "fail" || value === "permerror") return "bad";
  return "warn";
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/**
 * The mail body as plain text for the app. Links are shown defanged, so the
 * text can be read safely and nothing in it is tappable.
 */
export function readableMailText(text: string, html: string): string {
  let body = text.trim();
  if (!body && html) {
    body = html
      .replace(/<(script|style|head)\b[\s\S]*?<\/\1\s*>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|tr|li|h[1-6]|table)\s*>/gi, "\n")
      .replace(/<li\b[^>]*>/gi, "• ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (entity, code: string) => {
        if (code.startsWith("#x"))
          return String.fromCodePoint(parseInt(code.slice(2), 16) || 32);
        if (code.startsWith("#"))
          return String.fromCodePoint(parseInt(code.slice(1), 10) || 32);
        return ENTITIES[code.toLowerCase()] ?? entity;
      });
  }
  return defangUrls(
    body
      .replace(/\r\n?/g, "\n")
      .replace(/[ \t\u00a0]+/g, " ")
      .replace(/ *\n */g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  ).slice(0, 20000);
}

/** «https://evil.com» → «hxxps://evil[.]com»: readable, never a link. */
export function defangUrls(value: string): string {
  return value.replace(
    /\b(h)(tt)(ps?:\/\/)([^\s<>"']+)/gi,
    (_m, h, _tt, rest, target: string) =>
      `${h}xx${rest}${target.replace(/\./g, "[.]")}`,
  );
}

function refang(value: string): string {
  return value.replace(/\[\.\]/g, ".").replace(/^hxxp/i, "http");
}

function hostOfLink(href: string): string | null {
  const match = /^[a-z]+:\/\/([^/?#:]+)/i.exec(refang(href).trim());
  return match ? match[1]!.toLowerCase() : null;
}

/** Last two labels (three for co.uk-like endings): the registrable domain. */
function baseDomain(host: string | null): string | null {
  if (!host) return null;
  const labels = host.toLowerCase().replace(/\.$/, "").split(".");
  if (labels.length < 2) return null;
  const second = labels[labels.length - 2]!;
  const take =
    labels.length > 2 &&
    ["co", "com", "org", "net", "ac", "gv"].includes(second)
      ? 3
      : 2;
  return labels.slice(-take).join(".");
}

function domainOfAddress(address: string | null): string | null {
  const at = address?.lastIndexOf("@") ?? -1;
  return address && at > 0 ? address.slice(at + 1).toLowerCase() : null;
}

const INTERNAL_ROLE =
  /\b(?:hr|human resources|personal(?:abteilung|dienst|wesen)?|lohn(?:buchhaltung|abteilung)?|payroll|buchhaltung|finanz(?:en|abteilung)?|it(?:-abteilung|-support|-service)?|helpdesk|service ?desk|support|informatik|admin(?:istrator)?|postmaster|geschäftsleitung|geschäftsführung|direktion|ceo|sekretariat)\b/i;

export type CaseAssessment = {
  /** Suggested verdict; null when the facts do not point anywhere. */
  suggestion: SecurityVerdict | null;
  headline: string;
  /** Plain reasons, strongest first. */
  reasons: { tone: "bad" | "warn" | "ok"; text: string }[];
};

/**
 * A plain-language assessment for the verdict: what speaks for phishing and
 * what speaks against it, from the analysis, the known indicators and the
 * domains of the reporting people (their own organisation).
 */
export function assessCase(detail: SecurityCaseDetail): CaseAssessment {
  const reasons: CaseAssessment["reasons"] = [];
  const analysis = detail.analysis;
  const ownDomains = new Set(
    detail.reporters
      .map((reporter) => baseDomain(domainOfAddress(reporter.email)))
      .filter((domain): domain is string => Boolean(domain)),
  );
  const senderDomain = domainOfAddress(analysis.from);
  const senderBase = baseDomain(senderDomain);
  const external = Boolean(
    senderBase && ownDomains.size && !ownDomains.has(senderBase),
  );
  let strong = 0;
  let weak = 0;

  if (detail.iocHits.length) {
    strong += 2;
    reasons.push({
      tone: "bad",
      text: `Enthält ${detail.iocHits.length === 1 ? "einen Indikator" : `${detail.iocHits.length} Indikatoren`} aus früheren, bestätigten Fällen (${detail.iocHits
        .slice(0, 2)
        .map((hit) => `${INDICATOR_LABELS[hit.kind] ?? hit.kind} ${hit.value}`)
        .join(", ")}).`,
    });
  }
  const label = `${analysis.fromName ?? ""} ${(analysis.from ?? "").split("@")[0]?.replace(/[._-]+/g, " ") ?? ""}`;
  if (
    external &&
    (INTERNAL_ROLE.test(label) || /\bihre?\s+\S*abteilung\b/i.test(label))
  ) {
    strong += 1;
    reasons.push({
      tone: "bad",
      text: `Gibt sich als interne Stelle aus («${(analysis.fromName ?? analysis.from ?? "").slice(0, 60)}»), kommt aber von der fremden Domain ${senderDomain}.`,
    });
  } else if (external && senderDomain) {
    reasons.push({
      tone: "warn",
      text: `Absender von ausserhalb (${senderDomain}).`,
    });
  }
  if (
    analysis.replyTo &&
    senderBase &&
    baseDomain(domainOfAddress(analysis.replyTo)) !== senderBase
  ) {
    strong += 1;
    reasons.push({
      tone: "bad",
      text: `Antworten gehen an eine andere Adresse (${analysis.replyTo}).`,
    });
  }
  const linkHosts = [
    ...new Set(
      analysis.links
        .map((link) => hostOfLink(link.href))
        .filter((host): host is string => Boolean(host)),
    ),
  ];
  const foreignLinks = linkHosts.filter((host) => {
    const base = baseDomain(host);
    return base && base !== senderBase && !ownDomains.has(base);
  });
  const fakeEnding = linkHosts.find((host) => {
    const base = baseDomain(host) ?? "";
    const match = /\.(ch|li|de|at|com)(?=-)/.exec(host);
    return (
      match &&
      match.index < host.length - base.length &&
      !base.endsWith(`.${match[1]}`)
    );
  });
  if (fakeEnding) {
    strong += 1;
    reasons.push({
      tone: "bad",
      text: `Link täuscht eine Schweizer oder bekannte Adresse vor: ${fakeEnding.replace(/\./g, "[.]")} gehört in Wirklichkeit zu ${(baseDomain(fakeEnding) ?? "").replace(/\./g, "[.]")}.`,
    });
  } else if (foreignLinks.length) {
    weak += 1;
    reasons.push({
      tone: "warn",
      text: `Links führen auf ${foreignLinks.length === 1 ? "eine fremde Domain" : `${foreignLinks.length} fremde Domains`} (${foreignLinks
        .slice(0, 2)
        .map((host) => (baseDomain(host) ?? host).replace(/\./g, "[.]"))
        .join(", ")}).`,
    });
  }
  if (
    analysis.links.some((link) =>
      /(login|signin|verif|konto|passw|anmeld|formular|update|secure)/i.test(
        refang(link.href),
      ),
    )
  ) {
    weak += 1;
    reasons.push({
      tone: "warn",
      text: "Ein Link führt zu einer Anmelde-, Formular- oder Bestätigungsseite: typisch für das Abgreifen von Zugangsdaten.",
    });
  }
  const failed = (["spf", "dkim", "dmarc"] as const).filter((key) =>
    ["fail", "permerror", "softfail"].includes(analysis.auth[key]),
  );
  if (failed.length) {
    weak += 1;
    reasons.push({
      tone: "warn",
      text: `${failed.map((key) => key.toUpperCase()).join(", ")} fehlgeschlagen: Der Absender ist technisch nicht sauber bestätigt.`,
    });
  } else if (
    analysis.auth.spf === "pass" &&
    analysis.auth.dkim === "pass" &&
    analysis.auth.dmarc === "pass"
  ) {
    reasons.push({
      tone: external ? "warn" : "ok",
      text: external
        ? "SPF, DKIM und DMARC bestanden. Das bestätigt nur, dass die Mail wirklich von dieser Domain kommt, nicht, dass sie vertrauenswürdig ist."
        : "SPF, DKIM und DMARC bestanden.",
    });
  }
  const riskyAttachments = analysis.attachments.filter((file) =>
    /\.(exe|scr|js|vbs|hta|iso|img|lnk|html?|zip|rar|7z|docm|xlsm|one|svg)$/i.test(
      file.filename,
    ),
  );
  if (riskyAttachments.length) {
    strong += 1;
    reasons.push({
      tone: "bad",
      text: `Riskanter Anhang: ${riskyAttachments
        .slice(0, 2)
        .map((file) => file.filename)
        .join(", ")}.`,
    });
  }
  if (detail.campaign && detail.campaign.reporters > 1) {
    weak += 1;
    reasons.push({
      tone: "warn",
      text: `Von ${detail.campaign.reporters} Personen gemeldet (${detail.campaign.reports} Meldungen): eine Kampagne.`,
    });
  }
  const unsubscribe = detail.originalMail?.headers.some(
    (entry) => entry.name.toLowerCase() === "list-unsubscribe",
  );
  if (unsubscribe && strong === 0) {
    reasons.push({
      tone: "ok",
      text: "Enthält einen Abmeldelink (Newsletter- oder Werbeversand).",
    });
  }
  if (
    !external &&
    senderBase &&
    ownDomains.has(senderBase) &&
    failed.length === 0
  ) {
    reasons.push({
      tone: "ok",
      text: `Absender aus der eigenen Organisation (${senderDomain}).`,
    });
  }

  const highFindings = analysis.findings.filter(
    (finding) => finding.severity === "high",
  ).length;
  let suggestion: SecurityVerdict | null;
  let headline: string;
  if (strong >= 2 || (strong >= 1 && (weak >= 1 || highFindings > 0))) {
    suggestion = "phishing";
    headline = "Wahrscheinlich Phishing";
  } else if (strong === 1 || weak >= 2 || analysis.level === "high") {
    suggestion = "phishing";
    headline = "Verdächtig, eher Phishing";
  } else if (unsubscribe || (external && weak <= 1)) {
    suggestion = "spam";
    headline = unsubscribe ? "Eher Werbung (Spam)" : "Unklar, eher Spam";
  } else if (reasons.every((reason) => reason.tone === "ok")) {
    suggestion = "harmless";
    headline = "Keine Hinweise auf Phishing";
  } else {
    suggestion = null;
    headline = "Unklar: bitte die Mail ansehen";
  }
  reasons.sort(
    (left, right) =>
      ["bad", "warn", "ok"].indexOf(left.tone) -
      ["bad", "warn", "ok"].indexOf(right.tone),
  );
  return { suggestion, headline, reasons };
}
