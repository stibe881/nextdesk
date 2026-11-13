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
  clickedAt: string | null;
  escalatedAt: string | null;
  campaign: SecurityCampaign | null;
  iocHits: SecurityIocHit[];
  measures: SecurityMeasureLog[];
};

export type IndicatorKind = "domain" | "url" | "ip" | "sender";
export const INDICATOR_LABELS: Record<IndicatorKind, string> = {
  domain: "Domain",
  url: "URL",
  ip: "IP",
  sender: "Absender",
};

export type SecurityCampaign = {
  id: string;
  senderDomain: string | null;
  subjectKey: string | null;
  linkDomains: string[];
  reports: number;
  reporters: number;
  caseCount: number;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  cases: {
    ticketId: string;
    ticketNumber: string | null;
    state: SecurityCaseState;
    verdict: SecurityVerdict | null;
  }[];
};

export type SecurityIocHit = {
  id: string;
  kind: IndicatorKind;
  value: string;
  verdict: string;
  caseCount: number;
};

export type SecurityMeasureLog = {
  id: string;
  label: string;
  target: string | null;
  status: "succeeded" | "failed";
  message: string | null;
  actorName: string | null;
  createdAt: string | null;
};

export type SecurityIoc = {
  id: string;
  kind: IndicatorKind;
  value: string;
  verdict: string;
  status: "active" | "harmless";
  sourceTicketId: string | null;
  sourceTicketNumber: string | null;
  caseCount: number;
  hitCount: number;
  lastSeenAt: string | null;
  lastHitAt: string | null;
};

export type MeasureKind =
  | "intune_sync"
  | "intune_defender_scan"
  | "entra_revoke_sessions"
  | "entra_force_password_change";

export const MEASURE_LABELS: Record<MeasureKind, string> = {
  intune_sync: "Gerät synchronisieren",
  intune_defender_scan: "Defender-Schnellscan",
  entra_revoke_sessions: "Sitzungen widerrufen",
  entra_force_password_change: "Passwort-Reset erzwingen",
};

/** What the confirmation dialog says before a measure runs. */
export const MEASURE_CONFIRM_TEXT: Record<MeasureKind, string> = {
  intune_sync:
    "Das Gerät wird über Intune angewiesen, sich sofort zu synchronisieren (Richtlinien, Apps, Compliance).",
  intune_defender_scan:
    "Microsoft Defender startet auf dem Gerät einen Schnellscan. Die Person kann weiterarbeiten.",
  entra_revoke_sessions:
    "Alle Anmeldesitzungen und Aktualisierungstoken der Person werden in Microsoft Entra widerrufen. Die Person muss sich auf allen Geräten neu anmelden.",
  entra_force_password_change:
    "Die Person muss bei der nächsten Anmeldung ein neues Passwort festlegen.",
};

export type SecurityContextDevice = {
  id: string;
  name: string;
  assetTag: string | null;
  operatingSystem: string | null;
  complianceState: string | null;
  lastSyncAt: string | null;
  network: {
    address: string | null;
    hostname: string | null;
    prefix: string | null;
    vlan: string | null;
    site: string | null;
    switchName: string | null;
    switchPort: string | null;
  }[];
  intuneActions: ("syncDevice" | "windowsDefenderScan")[];
};

export type SecurityContextPerson = {
  key: string;
  name: string;
  email: string | null;
  userId: string | null;
  entraObjectId: string | null;
  jobTitle: string | null;
  department: string | null;
  managerName: string | null;
  lastSignInAt: string | null;
  accountEnabled: boolean | null;
  clicked: boolean;
  found: boolean;
  devicesVisible: boolean;
  devices: SecurityContextDevice[];
};

export type SecurityIndicatorMatch = {
  match: string | null;
  prefix: string | null;
  vlan: string | null;
  site: string | null;
  hostname: string | null;
  assetName: string | null;
};

export type SecurityContext = {
  people: SecurityContextPerson[];
  indicators: {
    value: string;
    kind: "ip" | "host";
    privateAddress: boolean;
    match: SecurityIndicatorMatch | null;
  }[];
  measures: { intuneMessage: string | null; entraMessage: string | null };
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
    campaign: parseCampaign(body.campaign),
    iocHits: list(body.iocHits).flatMap((row) => {
      const id = str(row.id);
      const value = str(row.value);
      const kind = indicatorKind(row.kind);
      return id && value && kind
        ? [
            {
              id,
              kind,
              value,
              verdict: str(row.verdict) ?? "phishing",
              caseCount: num(row.caseCount, 1),
            },
          ]
        : [];
    }),
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
              message: str(row.message),
              actorName: str(row.actorName),
              createdAt: str(row.createdAt),
            },
          ]
        : [];
    }),
  };
}

function indicatorKind(value: unknown): IndicatorKind | null {
  return value === "domain" ||
    value === "url" ||
    value === "ip" ||
    value === "sender"
    ? value
    : null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

export function parseCampaign(value: unknown): SecurityCampaign | null {
  if (!isRecord(value)) return null;
  const id = str(value.id);
  if (!id) return null;
  return {
    id,
    senderDomain: str(value.senderDomain),
    subjectKey: str(value.subjectKey),
    linkDomains: strings(value.linkDomains),
    reports: num(value.reports),
    reporters: num(value.reporters),
    caseCount: num(value.caseCount),
    firstSeenAt: str(value.firstSeenAt),
    lastSeenAt: str(value.lastSeenAt),
    cases: list(value.cases).flatMap((row) => {
      const ticketId = str(row.ticketId);
      return ticketId
        ? [
            {
              ticketId,
              ticketNumber: str(row.ticketNumber),
              state: state(row.state),
              verdict: verdict(row.verdict),
            },
          ]
        : [];
    }),
  };
}

export function parseCampaignList(value: unknown): SecurityCampaign[] | null {
  const body = data(value);
  if (!body) return null;
  return list(body.campaigns).flatMap((row) => {
    const campaign = parseCampaign(row);
    return campaign ? [campaign] : [];
  });
}

export function parseIocList(value: unknown): SecurityIoc[] | null {
  const body = data(value);
  if (!body) return null;
  return list(body.iocs).flatMap((row) => {
    const id = str(row.id);
    const text = str(row.value);
    const kind = indicatorKind(row.kind);
    if (!id || !text || !kind) return [];
    return [
      {
        id,
        kind,
        value: text,
        verdict: str(row.verdict) ?? "phishing",
        status:
          row.status === "harmless"
            ? ("harmless" as const)
            : ("active" as const),
        sourceTicketId: str(row.sourceTicketId),
        sourceTicketNumber: str(row.sourceTicketNumber),
        caseCount: num(row.caseCount),
        hitCount: num(row.hitCount),
        lastSeenAt: str(row.lastSeenAt),
        lastHitAt: str(row.lastHitAt),
      },
    ];
  });
}

function indicatorMatch(value: unknown): SecurityIndicatorMatch | null {
  if (!isRecord(value)) return null;
  return {
    match: str(value.match),
    prefix: str(value.prefix),
    vlan: str(value.vlan),
    site: str(value.site),
    hostname: str(value.hostname),
    assetName: str(value.assetName),
  };
}

function contextDevice(device: Row): SecurityContextDevice[] {
  const id = str(device.id);
  if (!id) return [];
  return [
    {
      id,
      name: str(device.name) ?? "Gerät",
      assetTag: str(device.assetTag),
      operatingSystem: str(device.operatingSystem),
      complianceState: str(device.complianceState),
      lastSyncAt: str(device.lastSyncAt),
      network: list(device.network).map((entry) => ({
        address: str(entry.address),
        hostname: str(entry.hostname),
        prefix: str(entry.prefix),
        vlan: str(entry.vlan),
        site: str(entry.site),
        switchName: str(entry.switchName),
        switchPort: str(entry.switchPort),
      })),
      intuneActions: strings(device.intuneActions).filter(
        (entry): entry is "syncDevice" | "windowsDefenderScan" =>
          entry === "syncDevice" || entry === "windowsDefenderScan",
      ),
    },
  ];
}

export function parseSecurityContext(value: unknown): SecurityContext | null {
  const body = data(value);
  if (!body) return null;
  const measures = isRecord(body.measures) ? body.measures : {};
  return {
    people: list(body.people).flatMap((row) => {
      const key = str(row.key);
      if (!key) return [];
      return [
        {
          key,
          name: str(row.name) ?? "Unbekannte Person",
          email: str(row.email),
          userId: str(row.userId),
          entraObjectId: str(row.entraObjectId),
          jobTitle: str(row.jobTitle),
          department: str(row.department),
          managerName: str(row.managerName),
          lastSignInAt: str(row.lastSignInAt),
          accountEnabled:
            typeof row.accountEnabled === "boolean" ? row.accountEnabled : null,
          clicked: row.clicked === true,
          found: row.found === true,
          devicesVisible: row.devicesVisible === true,
          devices: list(row.devices).flatMap(contextDevice),
        },
      ];
    }),
    indicators: list(body.indicators).flatMap((row) => {
      const text = str(row.value);
      if (!text) return [];
      return [
        {
          value: text,
          kind: row.kind === "host" ? ("host" as const) : ("ip" as const),
          privateAddress: row.privateAddress === true,
          match: indicatorMatch(row.match),
        },
      ];
    }),
    measures: {
      intuneMessage: str(measures.intuneMessage),
      entraMessage: str(measures.entraMessage),
    },
  };
}

/** «Subnetz 10.1.2.0/24 · VLAN 20 Verwaltung · Standort Haus A». */
export function internalIndicatorLabel(
  indicator: SecurityContext["indicators"][number],
): string {
  const match = indicator.match;
  if (!match) return "Private Adresse (nicht öffentlich erreichbar)";
  if (match.match === "address") {
    return [
      "Bekannte Adresse der IP-Verwaltung",
      match.hostname,
      match.assetName ? `Gerät ${match.assetName}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
  }
  return [
    `Subnetz ${match.prefix ?? "?"}`,
    match.vlan ? `VLAN ${match.vlan}` : null,
    match.site ? `Standort ${match.site}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Intune measures a device offers (only what Intune supports there). */
export function deviceMeasures(device: SecurityContextDevice): MeasureKind[] {
  const result: MeasureKind[] = [];
  if (device.intuneActions.includes("syncDevice")) result.push("intune_sync");
  if (device.intuneActions.includes("windowsDefenderScan")) {
    result.push("intune_defender_scan");
  }
  return result;
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
