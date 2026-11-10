import { withSupabase } from "@supabase/server";
import { isRecord, isUuid, json, noContent } from "../_shared/http.ts";

// «Störungen»: incidents from PRTG (migration 0278). Signed-in agents of the
// tenant only (is_tenant_ticket_agent under the caller's identity); reads and
// writes then go through the service role.

// deno-lint-ignore no-explicit-any
type Client = any;
type Row = Record<string, unknown>;

export type IncidentFilter =
  | "active"
  | "unacknowledged"
  | "services"
  | "recent"
  | "resolved"
  | "closed"
  | "all";
const FILTERS: readonly IncidentFilter[] = [
  "active",
  "unacknowledged",
  "services",
  "recent",
  "resolved",
  "closed",
  "all",
];
export const CAUSES = [
  "power",
  "network",
  "hardware",
  "software",
  "maintenance",
  "external",
  "unknown",
] as const;
export type Cause = (typeof CAUSES)[number];

type Action =
  | { type: "list"; tenantId: string; filter: IncidentFilter }
  | { type: "get"; tenantId: string; incidentId: string }
  | { type: "acknowledge"; tenantId: string; incidentId: string }
  | { type: "assign"; tenantId: string; incidentId: string; agentId: string | null }
  | { type: "note"; tenantId: string; incidentId: string; text: string }
  | { type: "close"; tenantId: string; incidentId: string; cause: Cause; note: string | null }
  | { type: "report"; tenantId: string; days: number };

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

export function parseAction(value: unknown): Action | null {
  if (!isRecord(value) || !isUuid(value.tenantId)) return null;
  const tenantId = value.tenantId;
  const incidentId = isUuid(value.incidentId) ? value.incidentId : null;
  switch (value.type) {
    case "list": {
      const filter = value.filter ?? "active";
      return (FILTERS as readonly unknown[]).includes(filter)
        ? { type: "list", tenantId, filter: filter as IncidentFilter }
        : null;
    }
    case "get":
    case "acknowledge":
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
      return incidentId && (CAUSES as readonly unknown[]).includes(value.cause) &&
          (note === null || note.length <= 4000)
        ? { type: "close", tenantId, incidentId, cause: value.cause as Cause, note }
        : null;
    }
    case "report": {
      const days = value.days === 90 ? 90 : 30;
      return { type: "report", tenantId, days };
    }
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
  const { data, error } = await client.rpc("is_tenant_ticket_agent", { p_tenant_id: tenantId });
  if (error || data !== true) {
    throw new HttpError(403, "forbidden", "Störungen sind nur für Agenten sichtbar.");
  }
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
  };
}

const INCIDENT_SELECT =
  "id, number, title, device_name, asset_id, severity, state, parent_incident_id, maintenance, acknowledged_at, acknowledged_by, assigned_agent_id, opened_at, resolved_at, closed_at, cause, service_ids, realert_count, team_id";

async function list(admin: Client, client: Client, action: Extract<Action, { type: "list" }>) {
  await requireAgent(client, action.tenantId);
  const now = Date.now();
  const thirtyDays = new Date(now - 30 * 24 * 60 * 60_000).toISOString();
  // Active and recent incidents for the tiles; older ones only for «all/closed».
  const recentQuery = admin.from("monitoring_incidents").select(INCIDENT_SELECT)
    .eq("tenant_id", action.tenantId)
    .or(`state.eq.active,opened_at.gte.${thirtyDays},resolved_at.gte.${thirtyDays}`)
    .order("opened_at", { ascending: false }).limit(1000);
  const [recent, monitored] = await Promise.all([
    recentQuery,
    admin.from("asset_infrastructure").select("asset_id", { count: "exact", head: true })
      .eq("tenant_id", action.tenantId).not("prtg_object_id", "is", null),
  ]);
  if (recent.error) throw new HttpError(503, "unavailable", "Die Störungen sind gerade nicht verfügbar.");
  let rows = (recent.data ?? []) as Row[];
  if (action.filter === "all" || action.filter === "closed") {
    const older = await admin.from("monitoring_incidents").select(INCIDENT_SELECT)
      .eq("tenant_id", action.tenantId).eq("state", "closed")
      .order("opened_at", { ascending: false }).limit(300);
    const known = new Set(rows.map((row) => String(row.id)));
    rows = [...rows, ...((older.data ?? []) as Row[]).filter((row) => !known.has(String(row.id)))];
  }
  const people = await names(admin, rows.flatMap((row) => [text(row.acknowledged_by), text(row.assigned_agent_id)]));
  const services = await serviceNames(admin, action.tenantId, rows.flatMap((row) =>
    Array.isArray(row.service_ids) ? row.service_ids as string[] : []
  ));
  const devices = await deviceInfo(admin, action.tenantId, rows.map((row) => text(row.asset_id))
    .filter((id): id is string => id !== null));
  const all = rows.map((row) => summary(row, people, services, devices, now));

  const roots = all.filter((entry) => !entry.parentId);
  const activeRoots = roots.filter((entry) => entry.state === "active");
  const activeServices = new Map<string, string>();
  for (const entry of all.filter((item) => item.state === "active")) {
    for (const service of entry.services) activeServices.set(service.id, service.name);
  }
  const resolvedRecent = all.filter((entry) =>
    entry.resolvedAt && Date.parse(entry.resolvedAt) >= Date.parse(thirtyDays)
  );
  const deviceCount = Number(monitored.count ?? 0) ||
    new Set(all.map((entry) => entry.assetId).filter(Boolean)).size;
  const stats = {
    active: activeRoots.length,
    activeDown: activeRoots.filter((entry) => entry.severity === "down").length,
    activeWarning: activeRoots.filter((entry) => entry.severity === "warning").length,
    unacknowledged: activeRoots.filter((entry) => !entry.acknowledgedAt && !entry.maintenance).length,
    oldestUnacknowledgedAt: activeRoots.filter((entry) => !entry.acknowledgedAt)
      .map((entry) => entry.openedAt).sort()[0] ?? null,
    affectedServices: [...activeServices.values()].sort((a, b) => a.localeCompare(b, "de-CH")),
    medianResolveMinutes: median(resolvedRecent.map((entry) => entry.durationMinutes)),
    availability: availability(
      rows.map((row) => ({
        severity: String(row.severity),
        opened_at: String(row.opened_at),
        resolved_at: text(row.resolved_at),
      })),
      deviceCount,
      Date.parse(thirtyDays),
      now,
    ),
    monitoredDevices: deviceCount,
  };

  const matches = (entry: (typeof all)[number]) => {
    switch (action.filter) {
      case "active":
        return entry.state === "active";
      case "unacknowledged":
        return entry.state === "active" && !entry.acknowledgedAt;
      case "services":
        return entry.state === "active" && entry.services.length > 0;
      case "recent":
        return !!entry.resolvedAt && Date.parse(entry.resolvedAt) >= Date.parse(thirtyDays);
      case "resolved":
        return entry.state === "resolved";
      case "closed":
        return entry.state === "closed";
      default:
        return true;
    }
  };
  const byParent = new Map<string, typeof all>();
  for (const entry of all) {
    if (entry.parentId) byParent.set(entry.parentId, [...(byParent.get(entry.parentId) ?? []), entry]);
  }
  const listed = roots.filter(matches).map((entry) => ({
    ...entry,
    children: (byParent.get(entry.id) ?? []).filter((child) =>
      action.filter === "all" || action.filter === "closed" || child.state !== "closed"
    ),
  }));
  // Children whose parent is not listed (e.g. parent already closed) stand alone.
  const listedIds = new Set(listed.map((entry) => entry.id));
  const orphans = all.filter((entry) => entry.parentId && !listedIds.has(entry.parentId) && matches(entry))
    .map((entry) => ({ ...entry, children: [] }));
  const severityRank = (entry: { severity: string }) => entry.severity === "down" ? 0 : 1;
  const cases = [...listed, ...orphans].sort((a, b) =>
    a.state === "active" && b.state === "active"
      ? Number(!!a.acknowledgedAt) - Number(!!b.acknowledgedAt) || severityRank(a) - severityRank(b) ||
        a.openedAt.localeCompare(b.openedAt)
      : b.openedAt.localeCompare(a.openedAt)
  );
  return { incidents: cases.slice(0, 300), stats };
}

async function loadIncident(admin: Client, tenantId: string, incidentId: string): Promise<Row> {
  const { data } = await admin.from("monitoring_incidents").select("*")
    .eq("tenant_id", tenantId).eq("id", incidentId).maybeSingle();
  if (!data) throw notFound();
  return data as Row;
}

async function detail(admin: Client, client: Client, tenantId: string, incidentId: string) {
  await requireAgent(client, tenantId);
  const now = Date.now();
  const incident = await loadIncident(admin, tenantId, incidentId);
  const assetId = text(incident.asset_id);
  const dayAgo = new Date(now - 24 * 60 * 60_000).toISOString();
  const weekAgo = new Date(now - 7 * 24 * 60 * 60_000).toISOString();
  const [events, children, alerts, history, parent, agentsResult] = await Promise.all([
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
  ]);
  const eventRows = (events.data ?? []) as Row[];
  const childRows = (children.data ?? []) as Row[];
  // Agents to assign: active members with agent rights.
  const agentIds: string[] = [];
  for (const row of (agentsResult.data ?? []) as Row[]) {
    const userId = String(row.user_id);
    const check = await admin.rpc("user_is_ticket_agent", { p_tenant_id: tenantId, p_user_id: userId });
    if (check.data === true) agentIds.push(userId);
  }
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

  // Dependencies: uplink chain upwards, and failed devices below.
  const uplinks = new Map<string, string>();
  const infra = await admin.from("asset_infrastructure").select("asset_id, uplink_asset_id")
    .eq("tenant_id", tenantId).not("uplink_asset_id", "is", null).limit(5000);
  for (const row of (infra.data ?? []) as Row[]) uplinks.set(String(row.asset_id), String(row.uplink_asset_id));
  const ancestors: string[] = [];
  if (assetId) {
    let current = uplinks.get(assetId);
    while (current && !ancestors.includes(current) && ancestors.length < 10) {
      ancestors.push(current);
      current = uplinks.get(current);
    }
  }
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
    history: { segments, weekCount },
    agents: agentIds.map((id) => ({ id, name: people.get(id) ?? "Agent" }))
      .sort((a, b) => a.name.localeCompare(b.name, "de-CH")),
  };
}

async function addEvent(admin: Client, tenantId: string, incidentId: string, kind: string, actorId: string, message: string | null) {
  await admin.from("monitoring_incident_events").insert({
    tenant_id: tenantId,
    incident_id: incidentId,
    kind,
    actor_id: actorId,
    message: message?.slice(0, 4000) ?? null,
  });
}

const CAUSE_LABELS: Record<Cause, string> = {
  power: "Strom",
  network: "Netzwerk",
  hardware: "Hardware",
  software: "Software",
  maintenance: "Wartung",
  external: "Extern",
  unknown: "Unbekannt",
};

async function report(admin: Client, client: Client, tenantId: string, days: number) {
  await requireAgent(client, tenantId);
  const now = Date.now();
  const since = new Date(now - days * 24 * 60 * 60_000).toISOString();
  const [rows, monitored] = await Promise.all([
    admin.from("monitoring_incidents")
      .select("id, title, device_name, asset_id, severity, state, cause, opened_at, resolved_at, parent_incident_id")
      .eq("tenant_id", tenantId)
      .or(`state.eq.active,opened_at.gte.${since},resolved_at.gte.${since}`)
      .limit(5000),
    admin.from("asset_infrastructure").select("asset_id", { count: "exact", head: true })
      .eq("tenant_id", tenantId).not("prtg_object_id", "is", null),
  ]);
  const incidents = ((rows.data ?? []) as Row[]).filter((row) => !row.parent_incident_id);
  const byCause = new Map<string, number>();
  const byDevice = new Map<string, { name: string; count: number; minutes: number }>();
  for (const row of incidents) {
    const cause = text(row.cause) ?? "open";
    byCause.set(cause, (byCause.get(cause) ?? 0) + 1);
    const key = text(row.asset_id) ?? text(row.device_name) ?? String(row.title);
    const entry = byDevice.get(key) ?? { name: text(row.device_name) ?? String(row.title), count: 0, minutes: 0 };
    entry.count += 1;
    entry.minutes += minutesBetween(String(row.opened_at), text(row.resolved_at), now);
    byDevice.set(key, entry);
  }
  const resolved = incidents.filter((row) => text(row.resolved_at));
  const deviceCount = Number(monitored.count ?? 0) ||
    new Set(incidents.map((row) => text(row.asset_id)).filter(Boolean)).size;
  return {
    days,
    total: incidents.length,
    medianResolveMinutes: median(resolved.map((row) => minutesBetween(String(row.opened_at), text(row.resolved_at), now))),
    availability: availability(
      incidents.map((row) => ({ severity: String(row.severity), opened_at: String(row.opened_at), resolved_at: text(row.resolved_at) })),
      deviceCount,
      Date.parse(since),
      now,
    ),
    causes: [...byCause.entries()].map(([cause, count]) => ({
      cause,
      label: cause === "open" ? "Noch ohne Ursache" : CAUSE_LABELS[cause as Cause] ?? cause,
      count,
    })).sort((a, b) => b.count - a.count),
    devices: [...byDevice.values()].map((entry) => ({ ...entry, minutes: Math.round(entry.minutes) }))
      .sort((a, b) => b.count - a.count || b.minutes - a.minutes).slice(0, 10),
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
    case "acknowledge": {
      await requireAgent(client, action.tenantId);
      const incident = await loadIncident(admin, action.tenantId, action.incidentId);
      if (!incident.acknowledged_at) {
        await admin.from("monitoring_incidents").update({
          acknowledged_at: new Date().toISOString(),
          acknowledged_by: actorId,
          ...(incident.assigned_agent_id ? {} : { assigned_agent_id: actorId }),
        }).eq("id", action.incidentId);
        await addEvent(admin, action.tenantId, action.incidentId, "acknowledged", actorId, "Bestätigt: wird bearbeitet.");
      }
      return await detail(admin, client, action.tenantId, action.incidentId);
    }
    case "assign": {
      await requireAgent(client, action.tenantId);
      await loadIncident(admin, action.tenantId, action.incidentId);
      if (action.agentId) {
        const check = await admin.rpc("user_is_ticket_agent", {
          p_tenant_id: action.tenantId,
          p_user_id: action.agentId,
        });
        if (check.data !== true) {
          throw new HttpError(422, "agent_invalid", "Diese Person kann keine Störungen bearbeiten.");
        }
      }
      await admin.from("monitoring_incidents").update({ assigned_agent_id: action.agentId })
        .eq("id", action.incidentId);
      const people = await names(admin, [action.agentId]);
      await addEvent(admin, action.tenantId, action.incidentId, "assigned", actorId,
        action.agentId ? `Zugewiesen an ${people.get(action.agentId) ?? "Agent"}.` : "Zuweisung entfernt.");
      return await detail(admin, client, action.tenantId, action.incidentId);
    }
    case "note": {
      await requireAgent(client, action.tenantId);
      await loadIncident(admin, action.tenantId, action.incidentId);
      await addEvent(admin, action.tenantId, action.incidentId, "note", actorId, action.text);
      return await detail(admin, client, action.tenantId, action.incidentId);
    }
    case "close": {
      await requireAgent(client, action.tenantId);
      const incident = await loadIncident(admin, action.tenantId, action.incidentId);
      if (incident.state === "closed") {
        throw new HttpError(409, "incident_closed", "Die Störung ist bereits abgeschlossen.");
      }
      const now = new Date().toISOString();
      const ids = [action.incidentId];
      const children = await admin.from("monitoring_incidents").select("id")
        .eq("parent_incident_id", action.incidentId).neq("state", "closed");
      for (const row of (children.data ?? []) as Row[]) ids.push(String(row.id));
      await admin.from("monitoring_incidents").update({
        state: "closed",
        closed_at: now,
        closed_by: actorId,
        cause: action.cause,
        closing_note: action.note,
      }).in("id", ids);
      // Still-open sensors of a manually closed incident stop counting.
      await admin.from("monitoring_incidents").update({ resolved_at: now })
        .in("id", ids).is("resolved_at", null);
      await admin.from("monitoring_alerts").update({ state: "resolved", resolved_at: now })
        .in("incident_id", ids).eq("state", "open");
      for (const id of ids) {
        await addEvent(admin, action.tenantId, id, "closed", actorId,
          `Abgeschlossen · Ursache: ${CAUSE_LABELS[action.cause]}${action.note ? ` · ${action.note}` : ""}`);
      }
      return await detail(admin, client, action.tenantId, action.incidentId);
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
