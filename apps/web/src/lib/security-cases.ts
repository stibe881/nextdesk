// Security cases (phishing reports handled as their own kind of case).
// Parsing of the security-cases edge function responses; pure.

export type SecurityVerdict = "harmless" | "spam" | "phishing" | "targeted";
export type SecurityCaseState = "triage" | "actions" | "closed";
export type SecurityStateFilter = SecurityCaseState | "all";
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
