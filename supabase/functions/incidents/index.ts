import { loadFormality, msg } from "../_shared/formality.ts";
import { withSupabase } from "@supabase/server";
import { isRecord, isUuid, json, noContent } from "../_shared/http.ts";
import {
  MAX_COST_CENTS,
  MAX_OUTPUT_TOKENS,
  queueMinimalAiDraftRequest,
  resolveAiGovernance,
  validateAiBudget,
  validateAiPurpose,
} from "../_shared/ai-governance.ts";
import { generateKnowledgeDraft } from "../_shared/anthropic-knowledge-draft.ts";
import {
  loadDepartmentScope,
  resolveRecordDepartment,
} from "../_shared/department-scope.ts";
import { redactTicketText } from "../_shared/ticket-redaction.ts";
import { ticketIdsWithOpenSlaBreach } from "../_shared/sla-breach-gate.ts";
import {
  ACTIVE_FILTERS,
  articleSourceText,
  type Cause,
  CAUSE_LABELS,
  CAUSES,
  caseDescription,
  compareIncidents,
  encodeCursor,
  INCIDENT_ARTICLE_INSTRUCTIONS,
  incidentArticleTemplate,
  type IncidentFilter,
  parseCursor,
  ticketReplyText,
} from "./workflow.ts";

// «Störungen»: incidents from PRTG (migrations 0278, 0311). Signed-in agents
// of the incident team only (can_work_incidents under the caller's identity);
// reads and writes then go through the service role. Lists, tiles and the
// report are aggregated in SQL; devices, uplinks and network context come
// from the shared SQL resolver.

// deno-lint-ignore no-explicit-any
type Client = any;
type Row = Record<string, unknown>;

export { CAUSES };
export type { Cause, IncidentFilter };

const FILTERS: readonly IncidentFilter[] = [
  "active",
  "unacknowledged",
  "services",
  "recent",
  "resolved",
  "closed",
  "all",
];

type CloseOptions = {
  notifyTickets: boolean;
  ticketMessage: string | null;
  openCase: { title: string; includeRecurring: boolean } | null;
};

type Action =
  | {
    type: "list";
    tenantId: string;
    filter: IncidentFilter;
    search: string | null;
    cursor: { openedAt: string; id: string } | null;
  }
  | { type: "get"; tenantId: string; incidentId: string }
  | { type: "acknowledge"; tenantId: string; incidentId: string }
  | { type: "assign"; tenantId: string; incidentId: string; agentId: string | null }
  | { type: "note"; tenantId: string; incidentId: string; text: string }
  | ({ type: "close"; tenantId: string; incidentId: string; cause: Cause; note: string | null } & CloseOptions)
  | { type: "report"; tenantId: string; days: number }
  | { type: "linkTicket"; tenantId: string; incidentId: string; ticket: string }
  | { type: "unlinkTicket"; tenantId: string; incidentId: string; ticketId: string }
  | {
    type: "openCase";
    tenantId: string;
    incidentId: string;
    title: string;
    includeRecurring: boolean;
  }
  | { type: "draftArticle"; tenantId: string; incidentId: string }
  | { type: "ticketIncidents"; tenantId: string; ticketId: string };

class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

const notFound = () =>
  new HttpError(404, "incident_not_found", "Die Störung wurde nicht gefunden.");

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function caseTitle(value: unknown): string | null {
  const title = text(value);
  return title && title.length >= 3 && title.length <= 240 ? title : null;
}

export function parseAction(value: unknown): Action | null {
  if (!isRecord(value) || !isUuid(value.tenantId)) return null;
  const tenantId = value.tenantId;
  const incidentId = isUuid(value.incidentId) ? value.incidentId : null;
  switch (value.type) {
    case "list": {
      const filter = value.filter ?? "active";
      if (!(FILTERS as readonly unknown[]).includes(filter)) return null;
      const search = typeof value.search === "string" ? value.search.trim().slice(0, 120) : "";
      const cursor = value.cursor === undefined || value.cursor === null
        ? null
        : parseCursor(value.cursor);
      if (value.cursor !== undefined && value.cursor !== null && !cursor) return null;
      return { type: "list", tenantId, filter: filter as IncidentFilter, search: search || null, cursor };
    }
    case "get":
    case "acknowledge":
    case "draftArticle":
      return incidentId ? { type: value.type, tenantId, incidentId } : null;
    case "assign":
      return incidentId && (value.agentId === null || isUuid(value.agentId))
        ? { type: "assign", tenantId, incidentId, agentId: value.agentId as string | null }
        : null;
    case "note": {
      const note = typeof value.text === "string" ? value.text.trim() : "";
      return incidentId && note.length >= 1 && note.length <= 4000
        ? { type: "note", tenantId, incidentId, text: note }
        : null;
    }
    case "close": {
      const note = typeof value.note === "string" && value.note.trim() ? value.note.trim() : null;
      const message = typeof value.ticketMessage === "string" && value.ticketMessage.trim()
        ? value.ticketMessage.trim()
        : null;
      let openCase: CloseOptions["openCase"] = null;
      if (value.openCase !== undefined && value.openCase !== null) {
        if (!isRecord(value.openCase)) return null;
        const title = caseTitle(value.openCase.title);
        if (!title) return null;
        openCase = { title, includeRecurring: value.openCase.includeRecurring === true };
      }
      return incidentId && (CAUSES as readonly unknown[]).includes(value.cause) &&
          (note === null || note.length <= 4000) &&
          (message === null || message.length <= 10000) &&
          (value.notifyTickets === undefined || typeof value.notifyTickets === "boolean")
        ? {
          type: "close",
          tenantId,
          incidentId,
          cause: value.cause as Cause,
          note,
          // Older clients (and the API) do not send it: no replies then.
          notifyTickets: value.notifyTickets === true,
          ticketMessage: message,
          openCase,
        }
        : null;
    }
    case "report": {
      const days = value.days === 90 ? 90 : 30;
      return { type: "report", tenantId, days };
    }
    case "linkTicket": {
      const ticket = text(value.ticket);
      return incidentId && ticket && ticket.length <= 64
        ? { type: "linkTicket", tenantId, incidentId, ticket }
        : null;
    }
    case "unlinkTicket":
      return incidentId && isUuid(value.ticketId)
        ? { type: "unlinkTicket", tenantId, incidentId, ticketId: value.ticketId }
        : null;
    case "openCase": {
      const title = caseTitle(value.title);
      return incidentId && title
        ? {
          type: "openCase",
          tenantId,
          incidentId,
          title,
          includeRecurring: value.includeRecurring === true,
        }
        : null;
    }
    case "ticketIncidents":
      return isUuid(value.ticketId) ? { type: "ticketIncidents", tenantId, ticketId: value.ticketId } : null;
    default:
      return null;
  }
}

/** Minutes between two timestamps (end defaults to now). */
export function minutesBetween(start: string, end: string | null, now = Date.now()): number {
  const from = Date.parse(start);
  const to = end ? Date.parse(end) : now;
  return Number.isFinite(from) && Number.isFinite(to) ? Math.max(0, (to - from) / 60_000) : 0;
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Availability over a period: 1 − (outage minutes of «down» incidents inside
 * the period) / (monitored devices × period). Null without monitored devices.
 * Reference for the SQL aggregation (monitoring_incident_stats/report).
 */
export function availability(
  incidents: { severity: string; opened_at: string; resolved_at: string | null }[],
  devices: number,
  periodStart: number,
  now = Date.now(),
): number | null {
  if (devices <= 0) return null;
  let down = 0;
  for (const incident of incidents) {
    if (incident.severity !== "down") continue;
    const start = Math.max(Date.parse(incident.opened_at), periodStart);
    const end = incident.resolved_at ? Date.parse(incident.resolved_at) : now;
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) down += end - start;
  }
  const total = devices * (now - periodStart);
  return total > 0 ? Math.max(0, 1 - down / total) : null;
}

async function requireAgent(client: Client, tenantId: string): Promise<void> {
  // Only the alarm team of the PRTG settings (all agents without one).
  const { data, error } = await client.rpc("can_work_incidents", { p_tenant_id: tenantId });
  if (error || data !== true) {
    throw new HttpError(403, "forbidden", "Störungen sind nur für das zuständige Team sichtbar.");
  }
}

/**
 * Of the given agents, those with access to the incident module: members of
 * the alarm team of the PRTG settings (all agents when no team is set), as
 * in can_work_incidents.
 */
async function incidentModuleAgents(
  admin: Client,
  tenantId: string,
  agentIds: string[],
): Promise<string[]> {
  if (!agentIds.length) return [];
  const integration = await admin.from("monitoring_integrations")
    .select("team_id").eq("tenant_id", tenantId)
    .not("team_id", "is", null).limit(1).maybeSingle();
  if (integration.error) {
    throw new HttpError(503, "agents_unavailable", "Die Agenten konnten nicht geladen werden.");
  }
  const teamId = text((integration.data as Row | null)?.team_id);
  if (!teamId) return agentIds;
  const members = await admin.from("team_memberships")
    .select("user_id").eq("team_id", teamId).in("user_id", agentIds);
  if (members.error) {
    throw new HttpError(503, "agents_unavailable", "Die Agenten konnten nicht geladen werden.");
  }
  const allowed = new Set(((members.data ?? []) as Row[]).map((row) => String(row.user_id)));
  return agentIds.filter((id) => allowed.has(id));
}

async function hasTenantPermission(client: Client, tenantId: string, code: string): Promise<boolean> {
  const { data, error } = await client.rpc("has_tenant_permission", {
    p_tenant_id: tenantId,
    p_permission_code: code,
  });
  return !error && data === true;
}

async function names(admin: Client, ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => !!id))];
  if (!unique.length) return new Map();
  const { data } = await admin.from("user_profiles").select("id, display_name").in("id", unique);
  return new Map(((data ?? []) as Row[]).map((row) => [String(row.id), text(row.display_name) ?? "Unbekannt"]));
}

async function serviceNames(admin: Client, tenantId: string, ids: string[]): Promise<Map<string, Row>> {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Map();
  const { data } = await admin.from("services").select("id, name, status")
    .eq("tenant_id", tenantId).in("id", unique);
  return new Map(((data ?? []) as Row[]).map((row) => [String(row.id), row]));
}

async function deviceInfo(admin: Client, tenantId: string, assetIds: string[]) {
  const unique = [...new Set(assetIds)];
  const result = new Map<string, Row>();
  if (!unique.length) return result;
  const [assets, infra] = await Promise.all([
    admin.from("assets").select("id, name, kind, manufacturer, model, location_id")
      .eq("tenant_id", tenantId).in("id", unique),
    admin.from("asset_infrastructure")
      .select("asset_id, category, hostname, ip_address, rack, rack_unit, prtg_object_id, uplink_asset_id")
      .eq("tenant_id", tenantId).in("asset_id", unique),
  ]);
  const locationIds = ((assets.data ?? []) as Row[]).map((row) => text(row.location_id))
    .filter((id): id is string => id !== null);
  const locations = locationIds.length
    ? ((await admin.from("asset_locations").select("id, name").in("id", locationIds)).data ?? []) as Row[]
    : [];
  const locationName = new Map(locations.map((row) => [String(row.id), text(row.name)]));
  const infraById = new Map(((infra.data ?? []) as Row[]).map((row) => [String(row.asset_id), row]));
  for (const asset of (assets.data ?? []) as Row[]) {
    const extra = infraById.get(String(asset.id)) ?? {};
    result.set(String(asset.id), {
      ...asset,
      ...extra,
      location_name: locationName.get(text(asset.location_id) ?? "") ?? null,
    });
  }
  return result;
}

function locationLabel(device: Row | undefined): string | null {
  if (!device) return null;
  const parts = [
    text(device.location_name),
    text(device.rack),
    text(device.rack_unit) ? `HE ${text(device.rack_unit)}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

function summary(
  row: Row,
  people: Map<string, string>,
  services: Map<string, Row>,
  devices: Map<string, Row>,
  now: number,
) {
  const serviceIds = Array.isArray(row.service_ids) ? (row.service_ids as string[]) : [];
  return {
    id: String(row.id),
    number: String(row.number),
    title: String(row.title),
    deviceName: text(row.device_name),
    assetId: text(row.asset_id),
    severity: String(row.severity),
    state: String(row.state),
    parentId: text(row.parent_incident_id),
    maintenance: row.maintenance === true,
    acknowledgedAt: text(row.acknowledged_at),
    acknowledgedBy: people.get(text(row.acknowledged_by) ?? "") ?? null,
    assignedAgentId: text(row.assigned_agent_id),
    assignedAgentName: people.get(text(row.assigned_agent_id) ?? "") ?? null,
    openedAt: String(row.opened_at),
    resolvedAt: text(row.resolved_at),
    closedAt: text(row.closed_at),
    cause: text(row.cause),
    durationMinutes: Math.round(minutesBetween(String(row.opened_at), text(row.resolved_at), now)),
    services: serviceIds.flatMap((id) => {
      const service = services.get(id);
      return service ? [{ id, name: String(service.name), status: String(service.status) }] : [];
    }),
    location: locationLabel(devices.get(text(row.asset_id) ?? "")),
    realertCount: Number(row.realert_count ?? 0),
    // «external»: status feed of a provider (Microsoft 365, GitHub, …).
    source: row.source === "external" ? "external" : "prtg",
    externalProvider: text(row.external_provider),
    externalUrl: text(row.external_url),
  };
}

const INCIDENT_SELECT =
  "id, number, title, device_name, asset_id, severity, state, parent_incident_id, maintenance, acknowledged_at, acknowledged_by, assigned_agent_id, opened_at, resolved_at, closed_at, cause, service_ids, realert_count, team_id, source, external_provider, external_url";

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : Number(value ?? 0) || 0;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function list(admin: Client, client: Client, action: Extract<Action, { type: "list" }>) {
  await requireAgent(client, action.tenantId);
  const now = Date.now();
  const activeOnly = ACTIVE_FILTERS.includes(action.filter);
  // Active incidents fit on one page (sorted by urgency); history is paged.
  const limit = activeOnly ? 200 : 50;
  const [page, statsResult] = await Promise.all([
    admin.rpc("monitoring_incident_page", {
      p_tenant_id: action.tenantId,
      p_filter: action.filter,
      p_search: action.search,
      p_before_opened_at: action.cursor?.openedAt ?? null,
      p_before_id: action.cursor?.id ?? null,
      p_limit: limit,
    }),
    action.cursor ? Promise.resolve({ data: null, error: null }) : admin.rpc("monitoring_incident_stats", {
      p_tenant_id: action.tenantId,
    }),
  ]);
  if (page.error || statsResult.error) {
    throw new HttpError(503, "unavailable", "Die Störungen sind gerade nicht verfügbar.");
  }
  const rows = (page.data ?? []) as Row[];
  const listedIds = rows.map((row) => String(row.id));
  const childResult = listedIds.length
    ? await admin.from("monitoring_incidents").select(INCIDENT_SELECT)
      .eq("tenant_id", action.tenantId).in("parent_incident_id", listedIds)
      .order("opened_at").limit(500)
    : { data: [] };
  const showClosedChildren = action.filter === "all" || action.filter === "closed";
  const childRows = ((childResult.data ?? []) as Row[])
    .filter((row) => showClosedChildren || row.state !== "closed");
  const all = [...rows, ...childRows];
  const people = await names(admin, all.flatMap((row) => [text(row.acknowledged_by), text(row.assigned_agent_id)]));
  const services = await serviceNames(admin, action.tenantId, all.flatMap((row) =>
    Array.isArray(row.service_ids) ? row.service_ids as string[] : []
  ));
  const devices = await deviceInfo(admin, action.tenantId, all.map((row) => text(row.asset_id))
    .filter((id): id is string => id !== null));
  // Latest public message on the status page per incident.
  const notices = listedIds.length
    ? await admin.from("service_incident_notices")
      .select("monitoring_incident_id, status, updated_at")
      .eq("tenant_id", action.tenantId).eq("public_enabled", true)
      .in("monitoring_incident_id", listedIds)
      .order("updated_at", { ascending: false }).limit(1000)
    : { data: [] };
  const statusPage = new Map<string, { state: string; updatedAt: string }>();
  for (const notice of (notices.data ?? []) as Row[]) {
    const incidentId = text(notice.monitoring_incident_id);
    if (incidentId && !statusPage.has(incidentId)) {
      statusPage.set(incidentId, {
        state: String(notice.status),
        updatedAt: String(notice.updated_at),
      });
    }
  }
  const byParent = new Map<string, ReturnType<typeof summary>[]>();
  for (const row of childRows) {
    const parentId = String(row.parent_incident_id);
    byParent.set(parentId, [...(byParent.get(parentId) ?? []), summary(row, people, services, devices, now)]);
  }
  const incidents = rows.map((row) => ({
    ...summary(row, people, services, devices, now),
    statusPage: statusPage.get(String(row.id)) ?? null,
    children: byParent.get(String(row.id)) ?? [],
  }));
  if (activeOnly) incidents.sort(compareIncidents);
  const last = rows[rows.length - 1];
  const nextCursor = rows.length === limit && last
    ? encodeCursor(new Date(String(last.opened_at)).toISOString(), String(last.id))
    : null;
  const stats = isRecord(statsResult.data) ? statsResult.data : null;
  return {
    incidents,
    nextCursor,
    stats: stats
      ? {
        active: num(stats.active),
        activeDown: num(stats.activeDown),
        activeWarning: num(stats.activeWarning),
        unacknowledged: num(stats.unacknowledged),
        oldestUnacknowledgedAt: text(stats.oldestUnacknowledgedAt),
        affectedServices: Array.isArray(stats.affectedServices)
          ? (stats.affectedServices as unknown[]).filter((entry): entry is string => typeof entry === "string")
          : [],
        medianResolveMinutes: nullableNumber(stats.medianResolveMinutes),
        availability: nullableNumber(stats.availability),
        monitoredDevices: num(stats.monitoredDevices),
      }
      : null,
  };
}

async function loadIncident(admin: Client, tenantId: string, incidentId: string): Promise<Row> {
  const { data } = await admin.from("monitoring_incidents").select("*")
    .eq("tenant_id", tenantId).eq("id", incidentId).maybeSingle();
  if (!data) throw notFound();
  return data as Row;
}

/** Incident and its follow-ups (links of follow-ups count for the incident). */
async function familyIds(admin: Client, tenantId: string, incidentId: string): Promise<string[]> {
  const { data } = await admin.from("monitoring_incidents").select("id")
    .eq("tenant_id", tenantId).eq("parent_incident_id", incidentId).limit(200);
  return [incidentId, ...((data ?? []) as Row[]).map((row) => String(row.id))];
}

/** Linked tickets the caller may read (row-level security of the tickets). */
async function linkedTickets(admin: Client, client: Client, tenantId: string, incidentIds: string[]) {
  const { data: links } = await admin.from("monitoring_incident_tickets")
    .select("incident_id, ticket_id, source, created_at, notified_at")
    .eq("tenant_id", tenantId).in("incident_id", incidentIds).is("removed_at", null)
    .order("created_at").limit(300);
  const linkRows = (links ?? []) as Row[];
  if (!linkRows.length) return { tickets: [], hidden: 0 };
  const ids = [...new Set(linkRows.map((row) => String(row.ticket_id)))];
  const { data } = await client.from("tickets")
    .select("id, ticket_number, subject, status:ticket_statuses(key, label, is_closed)")
    .eq("tenant_id", tenantId).in("id", ids).is("deleted_at", null);
  const visible = new Map(((data ?? []) as Row[]).map((row) => [String(row.id), row]));
  const tickets = ids.flatMap((id) => {
    const ticket = visible.get(id);
    const link = linkRows.find((row) => String(row.ticket_id) === id)!;
    if (!ticket) return [];
    const statusRelation = ticket.status as Row | Row[] | null;
    const status = Array.isArray(statusRelation) ? statusRelation[0] : statusRelation;
    return [{
      id,
      number: String(ticket.ticket_number),
      subject: text(ticket.subject) ?? "",
      status: text(status?.label) ?? text(status?.key) ?? "",
      closed: status?.is_closed === true || status?.key === "resolved",
      source: String(link.source),
      linkedAt: String(link.created_at),
      notifiedAt: text(link.notified_at),
    }];
  });
  return { tickets, hidden: ids.length - tickets.length };
}

async function linkedProblems(admin: Client, tenantId: string, incidentIds: string[], assetId: string | null) {
  const [direct, recurring] = await Promise.all([
    admin.from("problem_monitoring_incidents").select("problem_id")
      .eq("tenant_id", tenantId).in("incident_id", incidentIds),
    assetId
      ? admin.from("monitoring_recurring_problems").select("problem_id")
        .eq("tenant_id", tenantId).eq("asset_id", assetId)
      : Promise.resolve({ data: [] }),
  ]);
  const ids = [...new Set([...(direct.data ?? []), ...(recurring.data ?? [])].map((row: Row) => String(row.problem_id)))];
  if (!ids.length) return [];
  const { data } = await admin.from("problems").select("id, title, status")
    .eq("tenant_id", tenantId).in("id", ids);
  return ((data ?? []) as Row[]).map((row) => ({
    id: String(row.id),
    title: String(row.title),
    status: String(row.status),
  }));
}

async function detail(admin: Client, client: Client, tenantId: string, incidentId: string) {
  await requireAgent(client, tenantId);
  const now = Date.now();
  const incident = await loadIncident(admin, tenantId, incidentId);
  const assetId = text(incident.asset_id);
  const weekAgo = new Date(now - 7 * 24 * 60 * 60_000).toISOString();
  const [events, children, alerts, history, parent, agentsResult, chain, network, recurrence, canCase, canArticle] =
    await Promise.all([
      admin.from("monitoring_incident_events")
        .select("id, kind, status, sensor_name, message, actor_id, created_at")
        .eq("incident_id", incidentId).order("created_at", { ascending: true }).limit(500),
      admin.from("monitoring_incidents").select(INCIDENT_SELECT)
        .eq("tenant_id", tenantId).eq("parent_incident_id", incidentId)
        .order("opened_at").limit(200),
      admin.from("monitoring_alerts")
        .select("sensor_name, last_status, state, last_event_at, last_message")
        .eq("incident_id", incidentId).order("last_event_at", { ascending: false }).limit(100),
      admin.from("monitoring_incidents").select("id, severity, opened_at, resolved_at")
        .eq("tenant_id", tenantId).eq("incident_key", String(incident.incident_key))
        .or(`resolved_at.is.null,resolved_at.gte.${weekAgo}`)
        .gte("opened_at", new Date(now - 8 * 24 * 60 * 60_000).toISOString())
        .order("opened_at").limit(200),
      text(incident.parent_incident_id)
        ? admin.from("monitoring_incidents").select("id, number, title, state")
          .eq("id", String(incident.parent_incident_id)).maybeSingle()
        : Promise.resolve({ data: null }),
      admin.from("tenant_memberships").select("user_id")
        .eq("tenant_id", tenantId).eq("status", "active").limit(500),
      assetId
        ? admin.rpc("monitoring_uplink_chain", { p_tenant_id: tenantId, p_asset_id: assetId, p_max_depth: 20 })
        : Promise.resolve({ data: [] }),
      assetId
        ? admin.rpc("monitoring_incident_network", { p_tenant_id: tenantId, p_asset_id: assetId })
        : Promise.resolve({ data: null }),
      admin.rpc("monitoring_incident_recurrence", { p_incident_id: incidentId }),
      hasTenantPermission(client, tenantId, "asset.manage"),
      hasTenantPermission(client, tenantId, "knowledge.manage"),
    ]);
  const eventRows = (events.data ?? []) as Row[];
  const childRows = (children.data ?? []) as Row[];
  // Agents to assign: active members with agent rights and access to the
  // incident module.
  const memberIds = ((agentsResult.data ?? []) as Row[]).map((row) => String(row.user_id));
  let agentIds: string[] = [];
  for (let start = 0; start < memberIds.length; start += 25) {
    const chunk = memberIds.slice(start, start + 25);
    const checks = await Promise.all(chunk.map((userId) =>
      admin.rpc("user_is_ticket_agent", { p_tenant_id: tenantId, p_user_id: userId })
    ));
    chunk.forEach((userId, index) => {
      if (checks[index]?.data === true) agentIds.push(userId);
    });
  }
  agentIds = await incidentModuleAgents(admin, tenantId, agentIds);
  const people = await names(admin, [
    text(incident.acknowledged_by),
    text(incident.assigned_agent_id),
    text(incident.closed_by),
    ...eventRows.map((row) => text(row.actor_id)),
    ...childRows.map((row) => text(row.assigned_agent_id)),
    ...agentIds,
  ]);
  const serviceIds = Array.isArray(incident.service_ids) ? incident.service_ids as string[] : [];
  const services = await serviceNames(admin, tenantId, [
    ...serviceIds,
    ...childRows.flatMap((row) => Array.isArray(row.service_ids) ? row.service_ids as string[] : []),
  ]);

  // Dependencies: uplink chain upwards (SQL, max. 20), failed devices below.
  const ancestors = Array.isArray(chain.data)
    ? (chain.data as unknown[]).filter((id): id is string => typeof id === "string")
    : [];
  const devices = await deviceInfo(admin, tenantId, [
    ...(assetId ? [assetId] : []),
    ...ancestors,
    ...childRows.map((row) => text(row.asset_id)).filter((id): id is string => id !== null),
  ]);
  const activeKeys = ancestors.length
    ? ((await admin.from("monitoring_incidents").select("incident_key")
      .eq("tenant_id", tenantId).eq("state", "active")
      .in("incident_key", ancestors.map((id) => `asset:${id}`))).data ?? []) as Row[]
    : [];
  const failing = new Set(activeKeys.map((row) => String(row.incident_key)));
  const device = assetId ? devices.get(assetId) : undefined;

  // Last 24 hours: outage segments of this device.
  const segments = ((history.data ?? []) as Row[]).flatMap((row) => {
    const start = Math.max(Date.parse(String(row.opened_at)), now - 24 * 60 * 60_000);
    const end = text(row.resolved_at) ? Date.parse(String(row.resolved_at)) : now;
    return end > start ? [{ start: new Date(start).toISOString(), end: new Date(end).toISOString(), severity: String(row.severity) }] : [];
  });
  const weekCount = ((history.data ?? []) as Row[]).filter((row) =>
    Date.parse(String(row.opened_at)) >= Date.parse(weekAgo)
  ).length;

  const family = [incidentId, ...childRows.map((row) => String(row.id))];
  const [ticketLinks, problems] = await Promise.all([
    linkedTickets(admin, client, tenantId, family),
    linkedProblems(admin, tenantId, family, assetId),
  ]);
  const recurrenceRow = isRecord(recurrence.data) ? recurrence.data : {};
  const sameDevice = num(recurrenceRow.sameDevice30d);
  const sameCause = num(recurrenceRow.sameCause30d);
  const networkRow = isRecord(network.data) ? network.data : null;

  return {
    ...summary(incident, people, services, devices, now),
    teamId: text(incident.team_id),
    closedBy: people.get(text(incident.closed_by) ?? "") ?? null,
    closingNote: text(incident.closing_note),
    parent: parent.data
      ? { id: String(parent.data.id), number: String(parent.data.number), title: String(parent.data.title), state: String(parent.data.state) }
      : null,
    children: childRows.map((row) => summary(row, people, services, devices, now)),
    sensors: ((alerts.data ?? []) as Row[]).map((row) => ({
      name: text(row.sensor_name) ?? "Sensor",
      status: text(row.last_status),
      state: String(row.state),
      lastEventAt: text(row.last_event_at),
      message: text(row.last_message),
    })),
    events: eventRows.map((row) => ({
      id: String(row.id),
      kind: String(row.kind),
      status: text(row.status),
      sensor: text(row.sensor_name),
      message: text(row.message),
      actor: people.get(text(row.actor_id) ?? "") ?? null,
      at: String(row.created_at),
    })),
    device: device
      ? {
        name: text(device.name),
        category: text(device.category) ?? text(device.kind),
        manufacturer: text(device.manufacturer),
        model: text(device.model),
        hostname: text(device.hostname),
        ipAddress: text(device.ip_address),
        prtgObjectId: text(device.prtg_object_id),
        location: locationLabel(device),
      }
      : null,
    dependencies: {
      upstream: ancestors.map((id) => ({
        assetId: id,
        name: text(devices.get(id)?.name) ?? "Gerät",
        failing: failing.has(`asset:${id}`),
      })).reverse(),
    },
    network: networkRow
      ? {
        addresses: Array.isArray(networkRow.addresses) ? networkRow.addresses : [],
        subnetNeighbours: Array.isArray(networkRow.subnetNeighbours) ? networkRow.subnetNeighbours : [],
        switchNeighbours: Array.isArray(networkRow.switchNeighbours) ? networkRow.switchNeighbours : [],
      }
      : null,
    history: { segments, weekCount },
    tickets: ticketLinks.tickets,
    hiddenTickets: ticketLinks.hidden,
    problems,
    recurrence: {
      sameDevice30d: sameDevice,
      sameCause30d: sameCause,
      suggestCase: (sameDevice >= 3 || sameCause >= 3) && problems.every((problem) => problem.status === "resolved"),
    },
    permissions: { openCase: canCase, draftArticle: canArticle },
    agents: agentIds.map((id) => ({ id, name: people.get(id) ?? "Agent" }))
      .sort((a, b) => a.name.localeCompare(b.name, "de-CH")),
  };
}

async function addEvent(admin: Client, tenantId: string, incidentId: string, kind: string, actorId: string | null, message: string | null) {
  await admin.from("monitoring_incident_events").insert({
    tenant_id: tenantId,
    incident_id: incidentId,
    kind,
    actor_id: actorId,
    message: message?.slice(0, 4000) ?? null,
  });
}

async function report(admin: Client, client: Client, tenantId: string, days: number) {
  await requireAgent(client, tenantId);
  const { data, error } = await admin.rpc("monitoring_incident_report", { p_tenant_id: tenantId, p_days: days });
  if (error || !isRecord(data)) {
    throw new HttpError(503, "unavailable", "Die Auswertung ist gerade nicht verfügbar.");
  }
  const causes = Array.isArray(data.causes) ? (data.causes as unknown[]).filter(isRecord) : [];
  const devices = Array.isArray(data.devices) ? (data.devices as unknown[]).filter(isRecord) : [];
  return {
    days: num(data.days) || days,
    total: num(data.total),
    medianResolveMinutes: nullableNumber(data.medianResolveMinutes),
    availability: nullableNumber(data.availability),
    causes: causes.map((row) => {
      const cause = String(row.cause);
      return {
        cause,
        label: cause === "open" ? "Noch ohne Ursache" : CAUSE_LABELS[cause as Cause] ?? cause,
        count: num(row.count),
      };
    }),
    devices: devices.map((row) => ({
      name: text(row.name) ?? "Gerät",
      count: num(row.count),
      minutes: num(row.minutes),
    })),
  };
}

type TicketNotifyResult = {
  notified: number;
  resolved: number;
  skipped: { ticketNumber: string; reason: string }[];
};

/**
 * Public reply with the cause to every open linked ticket and status
 * «Gelöst» – the same tables and RPC as the ticket view (mails to the
 * requesters through the normal channel). Each ticket is checked with the
 * caller's own rights; tickets without them are skipped.
 */
async function notifyLinkedTickets(
  admin: Client,
  client: Client,
  actorId: string,
  tenantId: string,
  incidentIds: string[],
  body: string,
): Promise<TicketNotifyResult> {
  const result: TicketNotifyResult = { notified: 0, resolved: 0, skipped: [] };
  const { data: links } = await admin.from("monitoring_incident_tickets")
    .select("incident_id, ticket_id")
    .eq("tenant_id", tenantId).in("incident_id", incidentIds)
    .is("removed_at", null).is("notified_at", null).limit(200);
  const ticketIds = [...new Set(((links ?? []) as Row[]).map((row) => String(row.ticket_id)))];
  if (!ticketIds.length) return result;
  const [{ data: tickets }, { data: resolvedStatus }, breaches] = await Promise.all([
    client.from("tickets")
      .select("id, ticket_number, department_id, requester_id, first_responded_at, status:ticket_statuses(key, is_closed)")
      .eq("tenant_id", tenantId).in("id", ticketIds).is("deleted_at", null),
    admin.from("ticket_statuses").select("id, key").eq("tenant_id", tenantId).eq("key", "resolved").maybeSingle(),
    ticketIdsWithOpenSlaBreach(admin, tenantId, ticketIds),
  ]);
  const breached = new Set(breaches ?? ticketIds);
  const permissionCache = new Map<string, boolean>();
  const may = async (departmentId: string, code: string) => {
    const key = `${departmentId}:${code}`;
    if (!permissionCache.has(key)) {
      const { data, error } = await client.rpc("has_ticket_permission", {
        p_tenant_id: tenantId,
        p_department_id: departmentId,
        p_permission_code: code,
      });
      permissionCache.set(key, !error && data === true);
    }
    return permissionCache.get(key) === true;
  };
  const now = new Date().toISOString();
  for (const ticket of (tickets ?? []) as Row[]) {
    const id = String(ticket.id);
    const number = String(ticket.ticket_number);
    const statusRelation = ticket.status as Row | Row[] | null;
    const status = Array.isArray(statusRelation) ? statusRelation[0] : statusRelation;
    if (status?.is_closed === true || status?.key === "resolved") {
      result.skipped.push({ ticketNumber: number, reason: "already_done" });
      continue;
    }
    const departmentId = String(ticket.department_id);
    if (!(await may(departmentId, "ticket.comment.external"))) {
      result.skipped.push({ ticketNumber: number, reason: "no_permission" });
      continue;
    }
    const { data: comment, error } = await admin.from("ticket_comments").insert({
      ticket_id: id,
      author_id: actorId,
      visibility: "external",
      body,
    }).select("id").single();
    if (error || !comment) {
      result.skipped.push({ ticketNumber: number, reason: "comment_failed" });
      continue;
    }
    result.notified += 1;
    await admin.from("ticket_events").insert({
      ticket_id: id,
      actor_id: actorId,
      event_type: "comment.external_added",
      payload: { source: "monitoring_incident" },
    });
    if (!ticket.first_responded_at && actorId !== ticket.requester_id) {
      const { data: first } = await admin.from("tickets").update({ first_responded_at: now })
        .eq("id", id).eq("tenant_id", tenantId).is("first_responded_at", null)
        .select("id").maybeSingle();
      if (first) {
        await admin.from("ticket_sla_events").insert({
          ticket_id: id,
          event_type: "first_response",
          occurred_at: now,
          metadata: { actor_id: actorId, comment_id: comment.id, comment_visibility: "external" },
        });
      }
    }
    await admin.from("monitoring_incident_tickets").update({ notified_at: now })
      .in("incident_id", incidentIds).eq("ticket_id", id);
    if (!resolvedStatus) continue;
    if (breached.has(id)) {
      result.skipped.push({ ticketNumber: number, reason: "sla_reason_required" });
      continue;
    }
    // Same RPC as the bulk status change: checks ticket.update/close itself.
    const { error: statusError } = await admin.rpc("bulk_update_ticket_statuses", {
      p_actor_id: actorId,
      p_tenant_id: tenantId,
      p_ticket_ids: [id],
      p_status_key: "resolved",
      p_confirm_close: true,
    });
    if (statusError) result.skipped.push({ ticketNumber: number, reason: "status_failed" });
    else result.resolved += 1;
  }
  return result;
}

/** Opens a case (problem) from the incident and links tickets and services. */
async function openCase(
  admin: Client,
  client: Client,
  actorId: string,
  tenantId: string,
  incident: Row,
  title: string,
  includeRecurring: boolean,
): Promise<string> {
  if (!(await hasTenantPermission(client, tenantId, "asset.manage"))) {
    throw new HttpError(403, "case_manage_required", msg("Für Fälle fehlt dir die Berechtigung.", msg("Für Fälle fehlt dir die Berechtigung.", "Für Fälle fehlt Ihnen die Berechtigung.")));
  }
  const incidentId = String(incident.id);
  let incidentIds = await familyIds(admin, tenantId, incidentId);
  if (includeRecurring) {
    const { data } = await admin.rpc("monitoring_incident_recurrence", { p_incident_id: incidentId });
    const recurring = isRecord(data) && Array.isArray(data.incidentIds)
      ? (data.incidentIds as unknown[]).filter((id): id is string => typeof id === "string")
      : [];
    incidentIds = [...new Set([...incidentIds, ...recurring])];
  }
  const [{ data: incidentRows }, { data: links }] = await Promise.all([
    admin.from("monitoring_incidents").select("id, number, service_ids")
      .eq("tenant_id", tenantId).in("id", incidentIds),
    admin.from("monitoring_incident_tickets").select("ticket_id")
      .eq("tenant_id", tenantId).in("incident_id", incidentIds).is("removed_at", null),
  ]);
  const ticketIds = [...new Set(((links ?? []) as Row[]).map((row) => String(row.ticket_id)))];
  const { data: visible } = ticketIds.length
    ? await client.from("tickets").select("id, department_id").eq("tenant_id", tenantId).in("id", ticketIds)
    : { data: [] };
  const visibleRows = (visible ?? []) as Row[];
  const departments = new Set(visibleRows.map((row) => row.department_id));
  const serviceIds = [...new Set(((incidentRows ?? []) as Row[]).flatMap((row) =>
    Array.isArray(row.service_ids) ? row.service_ids as string[] : []
  ))];
  const services = await serviceNames(admin, tenantId, serviceIds);
  const { data: problem, error } = await admin.from("problems").insert({
    tenant_id: tenantId,
    title,
    description: caseDescription({
      incident: {
        number: String(incident.number),
        title: String(incident.title),
        deviceName: text(incident.device_name),
        cause: (text(incident.cause) as Cause | null) ?? null,
        closingNote: text(incident.closing_note),
      },
      incidentNumbers: ((incidentRows ?? []) as Row[]).map((row) => String(row.number)).sort(),
      services: [...services.values()].map((row) => String(row.name)),
    }),
    status: "investigating",
    owner_id: actorId,
    created_by: actorId,
    department_id: departments.size === 1 && typeof [...departments][0] === "string" ? [...departments][0] : null,
  }).select("id").single();
  if (error || !problem) {
    throw new HttpError(500, "problem_create_failed", "Der Fall konnte nicht erstellt werden.");
  }
  const problemId = String(problem.id);
  await Promise.all([
    admin.from("problem_monitoring_incidents").insert(incidentIds.map((id) => ({
      problem_id: problemId,
      incident_id: id,
      tenant_id: tenantId,
      linked_by: actorId,
    }))),
    visibleRows.length
      ? admin.from("problem_tickets").insert(visibleRows.map((row) => ({
        tenant_id: tenantId,
        problem_id: problemId,
        ticket_id: row.id,
        linked_by: actorId,
      })))
      : Promise.resolve(null),
    serviceIds.length
      ? admin.from("problem_services").insert(serviceIds.map((serviceId) => ({
        tenant_id: tenantId,
        problem_id: problemId,
        service_id: serviceId,
      })))
      : Promise.resolve(null),
  ]);
  await addEvent(admin, tenantId, incidentId, "note", actorId, `Fall eröffnet: ${title}`);
  await admin.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_id: actorId,
    action: "problem.created_from_incident",
    entity_type: "problem",
    entity_id: problemId,
    severity: "info",
    metadata: { incidentId, incidents: incidentIds.length, tickets: visibleRows.length },
  });
  return problemId;
}

function articleSlug(title: string): string {
  const base = title
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 180);
  return `${base || "article"}-${crypto.randomUUID().slice(0, 8)}`;
}

/** AI draft when the tenant approved it, otherwise null (template instead). */
async function aiArticleDraft(
  admin: Client,
  tenantId: string,
  actorId: string,
  source: string,
): Promise<{ title: string; bodyMarkdown: string } | null> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY")?.trim();
  const model = Deno.env.get("ANTHROPIC_MODEL")?.trim();
  if (!apiKey || !model) return null;
  const governance = await resolveAiGovernance(admin, tenantId);
  if (!governance.ok) return null;
  if (validateAiPurpose(governance.policy, "knowledge_article_draft")) return null;
  if (validateAiBudget(governance.policy, MAX_OUTPUT_TOKENS, MAX_COST_CENTS)) return null;
  const rawContent = redactTicketText(source);
  const queued = await queueMinimalAiDraftRequest(admin, {
    tenantId,
    actorId,
    purpose: "knowledge_article_draft",
    object: { type: "none", id: null },
    inputCharacterCount: Math.max(1, Array.from(rawContent).length),
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    maxCostCents: MAX_COST_CENTS,
    externalArticleContent: false,
  });
  if (!queued.ok) return null;
  try {
    return await generateKnowledgeDraft({
      apiKey,
      model,
      rawContent,
      maxTokens: MAX_OUTPUT_TOKENS,
      extraInstructions: INCIDENT_ARTICLE_INSTRUCTIONS,
    });
  } catch {
    return null;
  }
}

/**
 * Internal knowledge article draft from a closed incident with a cause (like
 * «Artikel aus Ticket»): with the AI where the tenant approved it, otherwise
 * from the facts of the incident. Always a draft a person reviews.
 */
async function draftArticle(admin: Client, client: Client, actorId: string, tenantId: string, incidentId: string) {
  await requireAgent(client, tenantId);
  const incident = await loadIncident(admin, tenantId, incidentId);
  const cause = text(incident.cause) as Cause | null;
  if (incident.state !== "closed" || !cause || !(CAUSES as readonly string[]).includes(cause)) {
    throw new HttpError(422, "incident_not_closed",
      msg("Einen Artikel erstellst du aus einer abgeschlossenen Störung mit Ursache.", msg("Einen Artikel erstellst du aus einer abgeschlossenen Störung mit Ursache.", "Einen Artikel erstellen Sie aus einer abgeschlossenen Störung mit Ursache.")));
  }
  if (!(await hasTenantPermission(client, tenantId, "knowledge.manage"))) {
    throw new HttpError(403, "article_manage_denied",
      msg("Für einen Wissensartikel fehlt dir die Berechtigung zur Wissensverwaltung.", msg("Für einen Wissensartikel fehlt dir die Berechtigung zur Wissensverwaltung.", "Für einen Wissensartikel fehlt Ihnen die Berechtigung zur Wissensverwaltung.")));
  }
  const scope = await loadDepartmentScope(admin, tenantId, actorId, "knowledge.base");
  if (!scope) throw new HttpError(503, "department_scope_lookup_failed", "Die Abteilungen konnten nicht geladen werden.");
  let requested: string | undefined;
  if (text(incident.team_id)) {
    const { data: team } = await admin.from("teams").select("department_id")
      .eq("tenant_id", tenantId).eq("id", String(incident.team_id)).maybeSingle();
    const departmentId = text(team?.department_id);
    if (departmentId && scope.departments.includes(departmentId)) requested = departmentId;
  }
  const resolved = resolveRecordDepartment(scope, requested);
  const departmentId = "error" in resolved ? scope.departments[0] ?? null : resolved.departmentId;

  const now = Date.now();
  const [events, alerts, devices, services] = await Promise.all([
    admin.from("monitoring_incident_events").select("kind, message")
      .eq("incident_id", incidentId).eq("kind", "note").order("created_at").limit(30),
    admin.from("monitoring_alerts").select("sensor_name").eq("incident_id", incidentId).limit(30),
    deviceInfo(admin, tenantId, text(incident.asset_id) ? [String(incident.asset_id)] : []),
    serviceNames(admin, tenantId, Array.isArray(incident.service_ids) ? incident.service_ids as string[] : []),
  ]);
  const source = {
    number: String(incident.number),
    title: String(incident.title),
    deviceName: text(incident.device_name),
    location: locationLabel(devices.get(text(incident.asset_id) ?? "")),
    services: [...services.values()].map((row) => String(row.name)),
    cause: cause as Cause,
    closingNote: text(incident.closing_note),
    openedAt: String(incident.opened_at),
    resolvedAt: text(incident.resolved_at),
    durationMinutes: minutesBetween(String(incident.opened_at), text(incident.resolved_at), now),
    sensors: [...new Set(((alerts.data ?? []) as Row[]).map((row) => text(row.sensor_name)).filter((name): name is string => !!name))],
    // Automatic notes (ticket links, cases) are no solution steps.
    notes: ((events.data ?? []) as Row[]).map((row) => text(row.message))
      .filter((message): message is string =>
        !!message && !/^(Ticket .* (automatisch|von Hand) zugeordnet|Fall eröffnet|Wissensartikel-Entwurf)/.test(message)
      ).slice(0, 10),
  };
  const ai = await aiArticleDraft(admin, tenantId, actorId, articleSourceText(source));
  const draft = ai ?? incidentArticleTemplate(source);
  const { data: article, error } = await admin.from("knowledge_articles").insert({
    tenant_id: tenantId,
    department_id: departmentId,
    title: draft.title,
    slug: articleSlug(draft.title),
    visibility: "internal",
    status: "draft",
    current_revision: 1,
    created_by: actorId,
    updated_at: new Date().toISOString(),
  }).select("id, title").single();
  if (error || !article) {
    throw new HttpError(422, "article_create_failed", "Der Artikelentwurf konnte nicht erstellt werden.");
  }
  const revision = await admin.from("knowledge_article_revisions").insert({
    article_id: article.id,
    revision: 1,
    title_snapshot: draft.title,
    body: draft.bodyMarkdown,
    author_id: actorId,
  });
  if (revision.error) {
    await admin.from("knowledge_articles").delete().eq("tenant_id", tenantId).eq("id", article.id);
    throw new HttpError(500, "article_revision_create_failed", "Der Artikelentwurf konnte nicht erstellt werden.");
  }
  await addEvent(admin, tenantId, incidentId, "note", actorId, `Wissensartikel-Entwurf erstellt: ${draft.title}`);
  await admin.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_id: actorId,
    action: "knowledge.article.created",
    entity_type: "knowledge_article",
    entity_id: article.id,
    severity: "info",
    metadata: { source: "monitoring_incident", incident_id: incidentId, ai: ai !== null },
  });
  return { articleId: String(article.id), title: String(article.title), aiUsed: ai !== null };
}

async function findTicket(client: Client, tenantId: string, reference: string): Promise<Row> {
  const query = client.from("tickets").select("id, ticket_number").eq("tenant_id", tenantId).is("deleted_at", null);
  const byId = /^[0-9a-f-]{36}$/i.test(reference) && isUuid(reference);
  const pattern = reference.replace(/[%_\\]/g, (match: string) => `\\${match}`);
  const { data } = byId
    ? await query.eq("id", reference).maybeSingle()
    : await query.ilike("ticket_number", pattern).maybeSingle();
  if (!data) throw new HttpError(404, "ticket_not_found", "Das Ticket wurde nicht gefunden.");
  return data as Row;
}

async function ticketIncidents(admin: Client, client: Client, tenantId: string, ticketId: string) {
  const { data: agent } = await client.rpc("is_tenant_ticket_agent", { p_tenant_id: tenantId });
  if (agent !== true) throw new HttpError(403, "forbidden", "Nur für Agenten.");
  const { data: ticket } = await client.from("tickets").select("id")
    .eq("tenant_id", tenantId).eq("id", ticketId).maybeSingle();
  if (!ticket) return { incidents: [], canOpen: false };
  const { data: links } = await admin.from("monitoring_incident_tickets").select("incident_id")
    .eq("tenant_id", tenantId).eq("ticket_id", ticketId).is("removed_at", null);
  const ids = ((links ?? []) as Row[]).map((row) => String(row.incident_id));
  if (!ids.length) return { incidents: [], canOpen: false };
  const [{ data: rows }, canWork] = await Promise.all([
    admin.from("monitoring_incidents").select("id, number, title, state, severity")
      .eq("tenant_id", tenantId).in("id", ids).order("opened_at", { ascending: false }),
    client.rpc("can_work_incidents", { p_tenant_id: tenantId }),
  ]);
  return {
    incidents: ((rows ?? []) as Row[]).map((row) => ({
      id: String(row.id),
      number: String(row.number),
      title: String(row.title),
      state: String(row.state),
      severity: String(row.severity),
    })),
    canOpen: canWork.data === true,
  };
}

async function handle(admin: Client, client: Client, actorId: string, action: Action) {
  switch (action.type) {
    case "list":
      return await list(admin, client, action);
    case "get":
      return await detail(admin, client, action.tenantId, action.incidentId);
    case "report":
      return await report(admin, client, action.tenantId, action.days);
    case "ticketIncidents":
      return await ticketIncidents(admin, client, action.tenantId, action.ticketId);
    case "draftArticle":
      return await draftArticle(admin, client, actorId, action.tenantId, action.incidentId);
    case "acknowledge": {
      await requireAgent(client, action.tenantId);
      const incident = await loadIncident(admin, action.tenantId, action.incidentId);
      if (!incident.acknowledged_at) {
        // Whoever confirms takes the incident over.
        const takesOver = incident.assigned_agent_id !== actorId;
        await admin.from("monitoring_incidents").update({
          acknowledged_at: new Date().toISOString(),
          acknowledged_by: actorId,
          assigned_agent_id: actorId,
        }).eq("id", action.incidentId);
        await addEvent(admin, action.tenantId, action.incidentId, "acknowledged", actorId, "Bestätigt: wird bearbeitet.");
        if (takesOver) {
          const people = await names(admin, [actorId]);
          await addEvent(admin, action.tenantId, action.incidentId, "assigned", actorId,
            `Zugewiesen an ${people.get(actorId) ?? "Agent"}.`);
        }
      }
      return await detail(admin, client, action.tenantId, action.incidentId);
    }
    case "assign": {
      await requireAgent(client, action.tenantId);
      const current = await loadIncident(admin, action.tenantId, action.incidentId);
      if (action.agentId) {
        const check = await admin.rpc("user_is_ticket_agent", {
          p_tenant_id: action.tenantId,
          p_user_id: action.agentId,
        });
        if (
          check.data !== true ||
          !(await incidentModuleAgents(admin, action.tenantId, [action.agentId])).length
        ) {
          throw new HttpError(422, "agent_invalid", "Diese Person kann keine Störungen bearbeiten.");
        }
      }
      // Assigning someone confirms the incident (stops the re-alerting).
      const confirms = Boolean(action.agentId) && !current.acknowledged_at;
      await admin.from("monitoring_incidents").update({
        assigned_agent_id: action.agentId,
        ...(confirms ? { acknowledged_at: new Date().toISOString(), acknowledged_by: actorId } : {}),
      }).eq("id", action.incidentId);
      const people = await names(admin, [action.agentId]);
      await addEvent(admin, action.tenantId, action.incidentId, "assigned", actorId,
        action.agentId ? `Zugewiesen an ${people.get(action.agentId) ?? "Agent"}.` : "Zuweisung entfernt.");
      if (confirms) {
        await addEvent(admin, action.tenantId, action.incidentId, "acknowledged", actorId,
          "Bestätigt durch die Zuweisung.");
      }
      return await detail(admin, client, action.tenantId, action.incidentId);
    }
    case "note": {
      await requireAgent(client, action.tenantId);
      await loadIncident(admin, action.tenantId, action.incidentId);
      await addEvent(admin, action.tenantId, action.incidentId, "note", actorId, action.text);
      return await detail(admin, client, action.tenantId, action.incidentId);
    }
    case "linkTicket": {
      await requireAgent(client, action.tenantId);
      await loadIncident(admin, action.tenantId, action.incidentId);
      const ticket = await findTicket(client, action.tenantId, action.ticket);
      const { error } = await admin.from("monitoring_incident_tickets").upsert({
        incident_id: action.incidentId,
        ticket_id: ticket.id,
        tenant_id: action.tenantId,
        source: "manual",
        linked_by: actorId,
        removed_at: null,
        removed_by: null,
      }, { onConflict: "incident_id,ticket_id" });
      if (error) throw new HttpError(500, "link_failed", "Das Ticket konnte nicht zugeordnet werden.");
      await addEvent(admin, action.tenantId, action.incidentId, "note", actorId,
        `Ticket ${String(ticket.ticket_number)} von Hand zugeordnet.`);
      return await detail(admin, client, action.tenantId, action.incidentId);
    }
    case "unlinkTicket": {
      await requireAgent(client, action.tenantId);
      await loadIncident(admin, action.tenantId, action.incidentId);
      const ids = await familyIds(admin, action.tenantId, action.incidentId);
      const { data: removed } = await admin.from("monitoring_incident_tickets")
        .update({ removed_at: new Date().toISOString(), removed_by: actorId })
        .eq("tenant_id", action.tenantId).in("incident_id", ids).eq("ticket_id", action.ticketId)
        .is("removed_at", null).select("ticket_id");
      if (((removed ?? []) as Row[]).length) {
        const { data: ticket } = await admin.from("tickets").select("ticket_number")
          .eq("tenant_id", action.tenantId).eq("id", action.ticketId).maybeSingle();
        const number = text(ticket?.ticket_number);
        await addEvent(admin, action.tenantId, action.incidentId, "note", actorId,
          number ? `Ticket ${number} von der Störung gelöst.` : "Ticket von der Störung gelöst.");
      }
      return await detail(admin, client, action.tenantId, action.incidentId);
    }
    case "openCase": {
      await requireAgent(client, action.tenantId);
      const incident = await loadIncident(admin, action.tenantId, action.incidentId);
      const problemId = await openCase(admin, client, actorId, action.tenantId, incident, action.title,
        action.includeRecurring);
      return { ...(await detail(admin, client, action.tenantId, action.incidentId)), caseResult: { problemId } };
    }
    case "close": {
      await requireAgent(client, action.tenantId);
      const incident = await loadIncident(admin, action.tenantId, action.incidentId);
      const ids = await familyIds(admin, action.tenantId, action.incidentId);
      if (incident.state === "closed") {
        // Closed automatically before 0311: the cause can be added afterwards.
        if (incident.cause) {
          throw new HttpError(409, "incident_closed", "Die Störung ist bereits abgeschlossen.");
        }
        await admin.from("monitoring_incidents").update({
          closed_by: actorId,
          cause: action.cause,
          closing_note: action.note ?? incident.closing_note ?? null,
        }).eq("id", action.incidentId);
        await addEvent(admin, action.tenantId, action.incidentId, "note", actorId,
          `Ursache nachgetragen: ${CAUSE_LABELS[action.cause]}${action.note ? ` · ${action.note}` : ""}`);
      } else {
        const now = new Date().toISOString();
        const open = ids.length > 1
          ? ((await admin.from("monitoring_incidents").select("id").in("id", ids).neq("state", "closed")).data ?? [])
            .map((row: Row) => String(row.id))
          : [action.incidentId];
        await admin.from("monitoring_incidents").update({
          state: "closed",
          closed_at: now,
          closed_by: actorId,
          cause: action.cause,
          closing_note: action.note,
        }).in("id", open);
        // Still-open sensors of a manually closed incident stop counting.
        await admin.from("monitoring_incidents").update({ resolved_at: now })
          .in("id", open).is("resolved_at", null);
        await admin.from("monitoring_alerts").update({ state: "resolved", resolved_at: now })
          .in("incident_id", open).eq("state", "open");
        for (const id of open) {
          await addEvent(admin, action.tenantId, id, "closed", actorId,
            `Abgeschlossen · Ursache: ${CAUSE_LABELS[action.cause]}${action.note ? ` · ${action.note}` : ""}`);
        }
      }
      let tickets: TicketNotifyResult | null = null;
      if (action.notifyTickets) {
        tickets = await notifyLinkedTickets(
          admin,
          client,
          actorId,
          action.tenantId,
          ids,
          action.ticketMessage ?? ticketReplyText({
            number: String(incident.number),
            title: String(incident.title),
            deviceName: text(incident.device_name),
          }, action.cause, action.note, await loadFormality(admin, action.tenantId)),
        );
        if (tickets.notified) {
          await addEvent(admin, action.tenantId, action.incidentId, "note", actorId,
            `${tickets.notified} ${tickets.notified === 1 ? "Ticket" : "Tickets"} informiert, ${tickets.resolved} auf «Gelöst» gesetzt.`);
        }
      }
      let problemId: string | null = null;
      if (action.openCase) {
        const current = await loadIncident(admin, action.tenantId, action.incidentId);
        problemId = await openCase(admin, client, actorId, action.tenantId, current, action.openCase.title,
          action.openCase.includeRecurring);
      }
      return {
        ...(await detail(admin, client, action.tenantId, action.incidentId)),
        closeResult: { tickets, problemId },
      };
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
      console.error("incidents_failed", error instanceof Error ? error.message : "");
      return json(request, { error: { code: "internal_error", message: "Die Störungen sind gerade nicht verfügbar." } }, 500);
    }
  },
);

export default {
  fetch(request: Request): Response | Promise<Response> {
    if (request.method === "OPTIONS") return noContent(request);
    return handler(request);
  },
};
