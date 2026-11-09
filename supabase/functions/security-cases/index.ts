import { withSupabase } from "@supabase/server";
import { isRecord, isUuid, json, noContent } from "../_shared/http.ts";
import { defang } from "../_shared/phishing-analysis.ts";
import {
  caseReporterEmails,
  CLICK_QUESTION_TEXT,
  DEFAULT_ACTIONS,
  isSecurityVerdict,
  queueSecurityNotice,
  SECURITY_VERDICTS,
  type SecurityVerdict,
  VERDICT_LABELS,
  VERDICT_RESULT_TEXT,
} from "../_shared/security-cases.ts";

// «Sicherheitsfälle»: phishing reports handled as their own kind of case
// (migration 0261). Signed-in agents only; every case is checked with
// security_case_ticket_ids (can_read_ticket) under the caller's identity,
// writes then go through the service role.

// deno-lint-ignore no-explicit-any
type Client = any;
type Row = Record<string, unknown>;
// The tabs (state) and the tiles: reported today, decided in the last 30
// days, someone said they clicked (last 30 days).
type StateFilter =
  | "triage"
  | "actions"
  | "closed"
  | "all"
  | "today"
  | "decided"
  | "clicked";
const STATE_FILTERS: readonly StateFilter[] = [
  "triage",
  "actions",
  "closed",
  "all",
  "today",
  "decided",
  "clicked",
];

type Action =
  | { type: "list"; tenantId: string; state: StateFilter }
  | { type: "get"; tenantId: string; ticketId: string }
  | { type: "setVerdict"; tenantId: string; ticketId: string; verdict: SecurityVerdict }
  | { type: "toggleAction"; tenantId: string; ticketId: string; actionId: string; done: boolean }
  | { type: "askClicked"; tenantId: string; ticketId: string }
  | { type: "close"; tenantId: string; ticketId: string }
  | { type: "getTemplates"; tenantId: string }
  | { type: "saveTemplates"; tenantId: string; templates: Record<SecurityVerdict, string[]> };

class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

const forbidden = () =>
  new HttpError(403, "forbidden", "Dafür fehlt Ihnen die Berechtigung.");
const notFound = () =>
  new HttpError(404, "case_not_found", "Der Sicherheitsfall wurde nicht gefunden.");

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function parseAction(value: unknown): Action | null {
  if (!isRecord(value) || !isUuid(value.tenantId)) return null;
  const tenantId = value.tenantId;
  switch (value.type) {
    case "list": {
      const state = value.state ?? "triage";
      return (STATE_FILTERS as readonly unknown[]).includes(state)
        ? { type: "list", tenantId, state: state as StateFilter }
        : null;
    }
    case "get":
    case "askClicked":
    case "close":
      return isUuid(value.ticketId) ? { type: value.type, tenantId, ticketId: value.ticketId } : null;
    case "setVerdict":
      return isUuid(value.ticketId) && isSecurityVerdict(value.verdict)
        ? { type: "setVerdict", tenantId, ticketId: value.ticketId, verdict: value.verdict }
        : null;
    case "toggleAction":
      return isUuid(value.ticketId) && isUuid(value.actionId) && typeof value.done === "boolean"
        ? {
          type: "toggleAction",
          tenantId,
          ticketId: value.ticketId,
          actionId: value.actionId,
          done: value.done,
        }
        : null;
    case "getTemplates":
      return { type: "getTemplates", tenantId };
    case "saveTemplates": {
      if (!isRecord(value.templates)) return null;
      const templates = {} as Record<SecurityVerdict, string[]>;
      for (const verdict of SECURITY_VERDICTS) {
        const list = value.templates[verdict];
        if (!Array.isArray(list) || list.length > 20) return null;
        const labels = list.map((entry) => typeof entry === "string" ? entry.trim() : "")
          .filter((entry) => entry.length > 0);
        if (labels.some((entry) => entry.length > 200)) return null;
        templates[verdict] = labels;
      }
      return { type: "saveTemplates", tenantId, templates };
    }
    default:
      return null;
  }
}

async function readableCaseIds(client: Client, tenantId: string): Promise<Set<string>> {
  const { data, error } = await client.rpc("security_case_ticket_ids", { p_tenant_id: tenantId });
  if (error) throw forbidden();
  const ids = (Array.isArray(data) ? data : []).map((entry: unknown) =>
    typeof entry === "string" ? entry : isRecord(entry) ? text(entry.security_case_ticket_ids) : null
  ).filter((entry: string | null): entry is string => entry !== null);
  return new Set(ids);
}

async function requireAgent(client: Client, tenantId: string): Promise<void> {
  const { data, error } = await client.rpc("is_tenant_ticket_agent", { p_tenant_id: tenantId });
  if (error || data !== true) throw forbidden();
}

async function requireCase(client: Client, tenantId: string, ticketId: string): Promise<void> {
  const ids = await readableCaseIds(client, tenantId);
  if (!ids.has(ticketId)) throw notFound();
}

async function canManageSettings(client: Client, tenantId: string): Promise<boolean> {
  const { data, error } = await client.rpc("has_tenant_permission", {
    p_tenant_id: tenantId,
    p_permission_code: "tenant.settings.manage",
  });
  return !error && data === true;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function levelRank(level: unknown): number {
  return level === "high" ? 3 : level === "medium" ? 2 : level === "low" ? 1 : 0;
}

async function statusId(admin: Client, tenantId: string, key: string): Promise<string | null> {
  const { data } = await admin.from("ticket_statuses").select("id")
    .eq("tenant_id", tenantId).eq("key", key).maybeSingle();
  return text((data as Row | null)?.id);
}

async function templatesFor(admin: Client, tenantId: string) {
  const { data } = await admin.from("security_action_templates")
    .select("verdict, label, sort_order").eq("tenant_id", tenantId)
    .order("sort_order").limit(200);
  const rows = (data ?? []) as Row[];
  const custom = rows.length > 0;
  const templates = {} as Record<SecurityVerdict, string[]>;
  for (const verdict of SECURITY_VERDICTS) {
    templates[verdict] = custom
      ? rows.filter((row) => row.verdict === verdict).map((row) => String(row.label))
      : [...DEFAULT_ACTIONS[verdict]];
  }
  return { templates, custom };
}

async function reportsByCase(admin: Client, tenantId: string, ids: string[]) {
  const map = new Map<string, Row[]>();
  for (let index = 0; index < ids.length; index += 200) {
    const { data } = await admin.from("phishing_reports")
      .select("ticket_id, reporter_id, reporter_email, channel, risk_score, risk_level, original_subject, original_from, created_at")
      .eq("tenant_id", tenantId).in("ticket_id", ids.slice(index, index + 200))
      .order("created_at").limit(5000);
    for (const row of (data ?? []) as Row[]) {
      const key = String(row.ticket_id);
      map.set(key, [...(map.get(key) ?? []), row]);
    }
  }
  return map;
}

async function list(admin: Client, client: Client, action: Extract<Action, { type: "list" }>) {
  await requireAgent(client, action.tenantId);
  const ids = [...await readableCaseIds(client, action.tenantId)];
  if (!ids.length) {
    return { cases: [], stats: emptyStats() };
  }
  const { data } = await admin.from("security_cases")
    .select("ticket_id, state, verdict, verdict_at, decision_due_at, created_at, tickets(ticket_number, subject, assigned_team_id, assigned_agent_id)")
    .eq("tenant_id", action.tenantId).in("ticket_id", ids.slice(0, 1000))
    .order("created_at", { ascending: false }).limit(1000);
  const rows = (data ?? []) as Row[];
  const reports = await reportsByCase(admin, action.tenantId, rows.map((row) => String(row.ticket_id)));
  const teamIds = [...new Set(rows.map((row) => {
    const ticket = (Array.isArray(row.tickets) ? row.tickets[0] : row.tickets) as Row | null;
    return text(ticket?.assigned_team_id);
  }).filter((id): id is string => id !== null))];
  const teams = teamIds.length
    ? ((await admin.from("teams").select("id, name").in("id", teamIds)).data ?? []) as Row[]
    : [];
  const teamName = new Map(teams.map((team) => [String(team.id), String(team.name)]));
  const agentIds = [...new Set(rows.map((row) => {
    const ticket = (Array.isArray(row.tickets) ? row.tickets[0] : row.tickets) as Row | null;
    return text(ticket?.assigned_agent_id);
  }).filter((id): id is string => id !== null))];
  const agents = agentIds.length
    ? ((await admin.from("user_profiles").select("id, display_name").in("id", agentIds)).data ?? []) as Row[]
    : [];
  const agentName = new Map(agents.map((agent) => [String(agent.id), text(agent.display_name)]));

  const now = Date.now();
  // Start of today in Swiss time (the function runs in UTC).
  const zurichNow = new Date(new Date(now).toLocaleString("en-US", { timeZone: "Europe/Zurich" }));
  const zurichOffset = zurichNow.getTime() - now;
  const dayStart = new Date(zurichNow);
  dayStart.setHours(0, 0, 0, 0);
  dayStart.setTime(dayStart.getTime() - zurichOffset);
  const all = rows.map((row) => {
    const ticket = (Array.isArray(row.tickets) ? row.tickets[0] : row.tickets) as Row | null;
    const caseReports = reports.get(String(row.ticket_id)) ?? [];
    const top = caseReports.reduce<Row | null>(
      (best, entry) => !best || Number(entry.risk_score ?? 0) > Number(best.risk_score ?? 0) ? entry : best,
      null,
    );
    const reporters = new Set(caseReports.map((entry) =>
      text(entry.reporter_id) ?? text(entry.reporter_email)?.toLowerCase() ?? ""
    ).filter(Boolean));
    return {
      ticketId: String(row.ticket_id),
      ticketNumber: text(ticket?.ticket_number),
      subject: text(top?.original_subject) ?? text(ticket?.subject),
      from: text(top?.original_from),
      state: String(row.state),
      verdict: isSecurityVerdict(row.verdict) ? row.verdict : null,
      riskScore: Number(top?.risk_score ?? 0),
      riskLevel: text(top?.risk_level) ?? "low",
      reports: caseReports.length,
      reporters: reporters.size,
      firstReportedAt: text(caseReports[0]?.created_at) ?? text(row.created_at),
      decisionDueAt: text(row.decision_due_at),
      overdue: row.state === "triage" && !!row.decision_due_at &&
        Date.parse(String(row.decision_due_at)) < now,
      teamName: teamName.get(text(ticket?.assigned_team_id) ?? "") ?? null,
      assignedAgentId: text(ticket?.assigned_agent_id),
      assignedAgentName: agentName.get(text(ticket?.assigned_agent_id) ?? "") ?? null,
    };
  });

  const thirtyDays = now - 30 * 24 * 60 * 60_000;
  const verdictMinutes = rows.filter((row) =>
    row.verdict_at && Date.parse(String(row.created_at)) >= thirtyDays
  ).map((row) => (Date.parse(String(row.verdict_at)) - Date.parse(String(row.created_at))) / 60_000);
  const todayReports = [...reports.values()].flat().filter((entry) =>
    Date.parse(String(entry.created_at)) >= dayStart.getTime()
  );
  const clicks = await admin.from("security_click_questions").select("ticket_id, answer")
    .eq("tenant_id", action.tenantId).in("ticket_id", ids.slice(0, 1000)).not("answer", "is", null)
    .gte("created_at", new Date(thirtyDays).toISOString()).limit(5000);
  const answers = ((clicks.data ?? []) as Row[]).map((row) => row.answer);
  const stats = {
    triage: all.filter((entry) => entry.state === "triage").length,
    triageHigh: all.filter((entry) => entry.state === "triage" && entry.riskLevel === "high").length,
    overdue: all.filter((entry) => entry.overdue).length,
    actions: all.filter((entry) => entry.state === "actions").length,
    reportsToday: todayReports.length,
    reportersToday: new Set(todayReports.map((entry) =>
      text(entry.reporter_id) ?? text(entry.reporter_email) ?? ""
    )).size,
    medianVerdictMinutes: median(verdictMinutes),
    clickAnswers: answers.length,
    clickYes: answers.filter((answer) => answer === "yes").length,
  };
  const clickedCases = new Set(((clicks.data ?? []) as Row[])
    .filter((row) => row.answer === "yes").map((row) => String(row.ticket_id)));
  const todayCases = new Set(todayReports.map((entry) => String(entry.ticket_id)));
  const decidedCases = new Set(rows.filter((row) =>
    row.verdict_at && Date.parse(String(row.verdict_at)) >= thirtyDays
  ).map((row) => String(row.ticket_id)));
  const cases = all.filter((entry) => {
    switch (action.state) {
      case "all":
        return true;
      case "today":
        return todayCases.has(entry.ticketId);
      case "decided":
        return decidedCases.has(entry.ticketId);
      case "clicked":
        return clickedCases.has(entry.ticketId);
      default:
        return entry.state === action.state;
    }
  });
  cases.sort((a, b) =>
    a.state === "triage" && b.state === "triage"
      ? levelRank(b.riskLevel) - levelRank(a.riskLevel) || b.reporters - a.reporters ||
        String(a.firstReportedAt).localeCompare(String(b.firstReportedAt))
      : String(b.firstReportedAt).localeCompare(String(a.firstReportedAt))
  );
  return { cases: cases.slice(0, 300), stats };
}

function emptyStats() {
  return {
    triage: 0,
    triageHigh: 0,
    overdue: 0,
    actions: 0,
    reportsToday: 0,
    reportersToday: 0,
    medianVerdictMinutes: null,
    clickAnswers: 0,
    clickYes: 0,
  };
}

function safeAnalysis(value: unknown) {
  const analysis = isRecord(value) ? value : {};
  const headers = isRecord(analysis.headers) ? analysis.headers : {};
  const auth = isRecord(headers.auth) ? headers.auth : {};
  const findings = (Array.isArray(analysis.findings) ? analysis.findings : [])
    .filter(isRecord).slice(0, 40).map((entry) => ({
      severity: text(entry.severity) ?? "info",
      message: text(entry.message) ?? "",
    })).filter((entry) => entry.message);
  const links = (Array.isArray(analysis.links) ? analysis.links : [])
    .filter(isRecord).slice(0, 30).map((entry) => ({
      // Never hand out a clickable address.
      href: defang(text(entry.href) ?? ""),
      text: text(entry.text),
      host: text(entry.host) ? defang(String(entry.host)) : null,
    }));
  const attachments = (Array.isArray(analysis.attachments) ? analysis.attachments : [])
    .filter(isRecord).slice(0, 30).map((entry) => ({
      filename: text(entry.filename) ?? "Anhang",
      contentType: text(entry.contentType),
      size: typeof entry.size === "number" ? entry.size : null,
    }));
  return {
    score: typeof analysis.score === "number" ? analysis.score : 0,
    level: text(analysis.level) ?? "low",
    from: text(headers.fromAddress),
    fromName: text(headers.fromName),
    replyTo: text(headers.replyTo),
    returnPath: text(headers.returnPath),
    subject: text(headers.subject),
    date: text(headers.date),
    sendingIp: text(headers.sendingIp),
    auth: { spf: text(auth.spf) ?? "unknown", dkim: text(auth.dkim) ?? "unknown", dmarc: text(auth.dmarc) ?? "unknown" },
    findings,
    links,
    attachments,
  };
}

async function detail(admin: Client, client: Client, tenantId: string, ticketId: string) {
  await requireCase(client, tenantId, ticketId);
  const [caseResult, ticketResult, reportResult, actionsResult, clicksResult] = await Promise.all([
    admin.from("security_cases").select("*").eq("ticket_id", ticketId).eq("tenant_id", tenantId).maybeSingle(),
    admin.from("tickets").select("ticket_number, subject, description, assigned_team_id, assigned_agent_id, created_at")
      .eq("id", ticketId).eq("tenant_id", tenantId).maybeSingle(),
    admin.from("phishing_reports").select("reporter_id, reporter_email, channel, risk_score, analysis, created_at")
      .eq("tenant_id", tenantId).eq("ticket_id", ticketId).order("created_at").limit(500),
    admin.from("security_case_actions").select("id, label, sort_order, done_at, done_by")
      .eq("ticket_id", ticketId).order("sort_order"),
    admin.from("security_click_questions").select("email, answer, answered_at, created_at")
      .eq("ticket_id", ticketId),
  ]);
  const securityCase = caseResult.data as Row | null;
  const ticket = ticketResult.data as Row | null;
  if (!securityCase || !ticket) throw notFound();
  const reports = (reportResult.data ?? []) as Row[];
  const top = reports.reduce<Row | null>(
    (best, entry) => !best || Number(entry.risk_score ?? 0) > Number(best.risk_score ?? 0) ? entry : best,
    null,
  );
  const userIds = [...new Set([
    ...reports.map((entry) => text(entry.reporter_id)),
    text(securityCase.verdict_by),
    text(ticket?.assigned_agent_id),
    ...((actionsResult.data ?? []) as Row[]).map((entry) => text(entry.done_by)),
  ].filter((id): id is string => id !== null))];
  const profiles = userIds.length
    ? ((await admin.from("user_profiles").select("id, display_name").in("id", userIds)).data ?? []) as Row[]
    : [];
  const names = new Map(profiles.map((row) => [String(row.id), text(row.display_name)]));
  const emails = new Map<string, string>();
  for (const id of userIds.slice(0, 100)) {
    if (reports.some((entry) => entry.reporter_id === id && !entry.reporter_email)) {
      const user = await admin.auth.admin.getUserById(id);
      const email = text(user.data?.user?.email)?.toLowerCase();
      if (email) emails.set(id, email);
    }
  }
  const clicks = new Map(((clicksResult.data ?? []) as Row[]).map((row) => [String(row.email).toLowerCase(), row]));
  const reporters = reports.map((entry) => {
    const id = text(entry.reporter_id);
    const email = text(entry.reporter_email)?.toLowerCase() ?? (id ? emails.get(id) ?? null : null);
    const click = email ? clicks.get(email) : undefined;
    return {
      name: (id ? names.get(id) : null) ?? email ?? "Unbekannt",
      email,
      channel: text(entry.channel),
      reportedAt: text(entry.created_at),
      asked: !!click,
      answer: text(click?.answer),
    };
  });
  const teamId = text(ticket.assigned_team_id);
  const team = teamId
    ? ((await admin.from("teams").select("name").eq("id", teamId).maybeSingle()).data as Row | null)
    : null;
  return {
    ticketId,
    ticketNumber: text(ticket.ticket_number),
    subject: text(ticket.subject),
    description: text(ticket.description),
    teamName: text(team?.name),
    assignedAgentId: text(ticket.assigned_agent_id),
    assignedAgentName: names.get(text(ticket.assigned_agent_id) ?? "") ?? null,
    createdAt: text(ticket.created_at),
    state: String(securityCase.state),
    verdict: isSecurityVerdict(securityCase.verdict) ? securityCase.verdict : null,
    verdictBy: names.get(text(securityCase.verdict_by) ?? "") ?? null,
    verdictAt: text(securityCase.verdict_at),
    decisionDueAt: text(securityCase.decision_due_at),
    reportersNotifiedAt: text(securityCase.reporters_notified_at),
    closedAt: text(securityCase.closed_at),
    analysis: safeAnalysis(top?.analysis),
    reporters,
    actions: ((actionsResult.data ?? []) as Row[]).map((row) => ({
      id: String(row.id),
      label: String(row.label),
      doneAt: text(row.done_at),
      doneBy: names.get(text(row.done_by) ?? "") ?? null,
    })),
  };
}

async function setVerdict(
  admin: Client,
  client: Client,
  actorId: string,
  action: Extract<Action, { type: "setVerdict" }>,
) {
  await requireCase(client, action.tenantId, action.ticketId);
  const current = await admin.from("security_cases").select("state, reporters_notified_at")
    .eq("ticket_id", action.ticketId).eq("tenant_id", action.tenantId).maybeSingle();
  if (!current.data) throw notFound();
  if (current.data.state === "closed") {
    throw new HttpError(409, "case_closed", "Der Fall ist bereits abgeschlossen.");
  }
  const existing = await admin.from("security_case_actions").select("id", { count: "exact", head: true })
    .eq("ticket_id", action.ticketId);
  let actionCount = Number(existing.count ?? 0);
  if (actionCount === 0) {
    const { templates } = await templatesFor(admin, action.tenantId);
    const labels = templates[action.verdict];
    if (labels.length) {
      await admin.from("security_case_actions").insert(labels.map((label, index) => ({
        tenant_id: action.tenantId,
        ticket_id: action.ticketId,
        label,
        sort_order: index,
      })));
    }
    actionCount = labels.length;
  }
  const now = new Date().toISOString();
  const state = actionCount > 0 ? "actions" : "closed";
  await admin.from("security_cases").update({
    verdict: action.verdict,
    verdict_by: actorId,
    verdict_at: now,
    state,
    closed_at: state === "closed" ? now : null,
  }).eq("ticket_id", action.ticketId).eq("tenant_id", action.tenantId);
  const status = await statusId(admin, action.tenantId, state === "closed" ? "closed" : "in_progress");
  if (status) {
    await admin.from("tickets").update({ status_id: status })
      .eq("id", action.ticketId).eq("tenant_id", action.tenantId)
      .setHeader("x-nextdesk-actor-id", actorId);
  }
  await admin.from("ticket_events").insert({
    ticket_id: action.ticketId,
    actor_id: actorId,
    event_type: "ticket.security_verdict",
    payload: { verdict: action.verdict, label: VERDICT_LABELS[action.verdict] },
  });
  // Every reporter learns the result once (automatic).
  let notified = 0;
  if (!current.data.reporters_notified_at) {
    const subjectRow = await admin.from("phishing_reports").select("original_subject")
      .eq("ticket_id", action.ticketId).order("created_at").limit(1).maybeSingle();
    const original = text(subjectRow.data?.original_subject);
    const recipients = await caseReporterEmails(admin, action.tenantId, action.ticketId);
    const result = await queueSecurityNotice(admin, {
      tenantId: action.tenantId,
      ticketId: action.ticketId,
      authorId: actorId,
      subject: original
        ? `Ergebnis Ihrer Phishing-Meldung: «${original.slice(0, 120)}»`
        : "Ergebnis Ihrer Phishing-Meldung",
      body: VERDICT_RESULT_TEXT[action.verdict],
      recipients,
      note: `Ergebnis «${VERDICT_LABELS[action.verdict]}» an ${recipients.length} meldende Person(en):`,
    });
    notified = result.queued;
    await admin.from("security_cases").update({ reporters_notified_at: now })
      .eq("ticket_id", action.ticketId).eq("tenant_id", action.tenantId);
  }
  return { notified };
}

async function askClicked(admin: Client, client: Client, actorId: string, tenantId: string, ticketId: string) {
  await requireCase(client, tenantId, ticketId);
  const all = await caseReporterEmails(admin, tenantId, ticketId);
  const asked = await admin.from("security_click_questions").select("email").eq("ticket_id", ticketId);
  const known = new Set(((asked.data ?? []) as Row[]).map((row) => String(row.email).toLowerCase()));
  const recipients = all.filter((email) => !known.has(email));
  if (!recipients.length) return { asked: 0 };
  const result = await queueSecurityNotice(admin, {
    tenantId,
    ticketId,
    authorId: actorId,
    subject: "Kurze Rückfrage zu Ihrer Phishing-Meldung",
    body: CLICK_QUESTION_TEXT,
    recipients,
    note: `Rückfrage «geklickt?» an ${recipients.length} meldende Person(en):`,
    beforeQueue: async (commentId) => {
      await admin.from("security_click_questions").insert(recipients.map((email) => ({
        tenant_id: tenantId,
        ticket_id: ticketId,
        comment_id: commentId,
        email,
      })));
    },
  });
  return { asked: result.queued };
}

async function handle(admin: Client, client: Client, actorId: string, action: Action) {
  switch (action.type) {
    case "list":
      return await list(admin, client, action);
    case "get":
      return await detail(admin, client, action.tenantId, action.ticketId);
    case "setVerdict": {
      const result = await setVerdict(admin, client, actorId, action);
      return { ...await detail(admin, client, action.tenantId, action.ticketId), notified: result.notified };
    }
    case "toggleAction": {
      await requireCase(client, action.tenantId, action.ticketId);
      await admin.from("security_case_actions").update({
        done_at: action.done ? new Date().toISOString() : null,
        done_by: action.done ? actorId : null,
      }).eq("id", action.actionId).eq("ticket_id", action.ticketId).eq("tenant_id", action.tenantId);
      return await detail(admin, client, action.tenantId, action.ticketId);
    }
    case "askClicked": {
      const result = await askClicked(admin, client, actorId, action.tenantId, action.ticketId);
      return { ...await detail(admin, client, action.tenantId, action.ticketId), asked: result.asked };
    }
    case "close": {
      await requireCase(client, action.tenantId, action.ticketId);
      const now = new Date().toISOString();
      await admin.from("security_cases").update({ state: "closed", closed_at: now })
        .eq("ticket_id", action.ticketId).eq("tenant_id", action.tenantId);
      const status = await statusId(admin, action.tenantId, "closed");
      if (status) {
        await admin.from("tickets").update({ status_id: status })
          .eq("id", action.ticketId).eq("tenant_id", action.tenantId)
          .setHeader("x-nextdesk-actor-id", actorId);
      }
      await admin.from("ticket_events").insert({
        ticket_id: action.ticketId,
        actor_id: actorId,
        event_type: "ticket.security_closed",
        payload: {},
      });
      return await detail(admin, client, action.tenantId, action.ticketId);
    }
    case "getTemplates": {
      if (!(await canManageSettings(client, action.tenantId))) throw forbidden();
      return await templatesFor(admin, action.tenantId);
    }
    case "saveTemplates": {
      if (!(await canManageSettings(client, action.tenantId))) throw forbidden();
      await admin.from("security_action_templates").delete().eq("tenant_id", action.tenantId);
      const rows = SECURITY_VERDICTS.flatMap((verdict) =>
        action.templates[verdict].map((label, index) => ({
          tenant_id: action.tenantId,
          verdict,
          label,
          sort_order: index,
        }))
      );
      // Without any stored row the default checklists apply.
      if (rows.length) {
        const inserted = await admin.from("security_action_templates").insert(rows);
        if (inserted.error) {
          throw new HttpError(503, "unavailable", "Die Checklisten konnten nicht gespeichert werden.");
        }
      }
      return await templatesFor(admin, action.tenantId);
    }
  }
}

const handler = withSupabase(
  { auth: "user", errors: { detailed: false } },
  async (request, context) => {
    try {
      if (request.method !== "POST") return json(request, { error: { code: "method_not_allowed" } }, 405);
      const actorId = context.userClaims?.id;
      if (!isUuid(actorId)) return json(request, { error: { code: "unauthorized" } }, 401);
      let body: unknown = null;
      try {
        body = JSON.parse(await request.text());
      } catch {
        body = null;
      }
      const action = parseAction(body);
      if (!action) {
        return json(request, { error: { code: "invalid_request", message: "Die Anfrage ist ungültig." } }, 422);
      }
      const data = await handle(context.supabaseAdmin, context.supabase, actorId, action);
      return json(request, { data: data as Record<string, unknown> });
    } catch (error) {
      if (error instanceof HttpError) {
        return json(request, { error: { code: error.code, message: error.message } }, error.status);
      }
      console.error("security_cases_failed", error instanceof Error ? error.message : "");
      return json(request, { error: { code: "internal_error", message: "Die Sicherheitsfälle sind gerade nicht verfügbar." } }, 500);
    }
  },
);

export default {
  fetch(request: Request): Response | Promise<Response> {
    if (request.method === "OPTIONS") return noContent(request);
    return handler(request);
  },
};
