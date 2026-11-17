import { withSupabase } from "@supabase/server";
import { isUuid, json, noContent } from "../_shared/http.ts";
import { createAgentToken, sha256Hex, tokenHint } from "../_shared/ipam-discovery.ts";
import { publicTarget } from "../_shared/monitoring-cloud.ts";
import { closeSensorAlert as closeSharedSensorAlert } from "../_shared/monitoring-pause.ts";
import {
  attachments,
  comparePorts,
  directory,
  type KnownAddress,
  type KnownDevice,
  normalizeMac,
  portFromRow,
  resolvePort,
} from "../_shared/monitoring-topology.ts";
import { resolveTenantFeatureStates } from "../_shared/tenant-features.ts";
import {
  type Action,
  agentOnline,
  availability,
  availabilityPlan,
  type AvailabilityRange,
  availabilityReport,
  eventFeed,
  type EventRange,
  type DeviceEdit,
  bucketize,
  deviceState,
  type DisplayState,
  displayState,
  isOlderVersion,
  matchesAddress,
  type NewDevice,
  parseAction,
  parseInterfaces,
  parseProbePackage,
  type ProbePackage,
  probeConfig,
  rangePlan,
} from "./logic.ts";

/**
 * «Überwachung» for the web app and the apps: devices with their sensors,
 * current state, history and the sensor administration.
 *
 * - Feature `monitoring.native`; reading needs `asset.read`, changing sensors
 *   `asset.manage` (the monitored devices are infrastructure assets).
 * - All tables are service-role only; this function checks the permission of
 *   the caller with the caller's own client and then reads with the admin
 *   client, always filtered by the tenant.
 * - Measuring is done by the on-prem probe (function `ipam-agent`), incidents
 *   by the incident logic of the monitoring webhook.
 */

// deno-lint-ignore no-explicit-any
type Client = any;
type Row = Record<string, unknown>;

const FEATURE = "monitoring.native";
const MAX_SENSORS = 5000;
const MAX_SENSORS_PER_DEVICE = 50;

class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

const unavailable = () =>
  new HttpError(503, "unavailable", "Die Überwachung ist gerade nicht verfügbar.");

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

async function selectIn(admin: Client, table: string, columns: string, tenantId: string, column: string, ids: string[]): Promise<Row[]> {
  const rows: Row[] = [];
  for (const part of chunks([...new Set(ids)], 100)) {
    const { data, error } = await admin.from(table).select(columns).eq("tenant_id", tenantId).in(column, part);
    if (error) throw unavailable();
    rows.push(...((data ?? []) as Row[]));
  }
  return rows;
}

async function permission(client: Client, tenantId: string, code: string): Promise<boolean> {
  const { data, error } = await client.rpc("has_tenant_permission", {
    p_tenant_id: tenantId,
    p_permission_code: code,
  });
  return !error && data === true;
}

function sensorView(sensor: Row, status: Row | undefined, now: number) {
  const view = {
    id: String(sensor.id),
    assetId: String(sensor.asset_id),
    agentId: text(sensor.agent_id),
    kind: String(sensor.kind),
    name: String(sensor.name),
    target: text(sensor.target),
    port: number(sensor.port),
    url: text(sensor.url),
    intervalSeconds: number(sensor.interval_seconds) ?? 60,
    timeoutMs: number(sensor.timeout_ms) ?? 5000,
    warningAbove: number(sensor.warning_above),
    warningBelow: number(sensor.warning_below),
    downAbove: number(sensor.down_above),
    downBelow: number(sensor.down_below),
    snmpMetric: text(sensor.snmp_metric),
    snmpOid: text(sensor.snmp_oid),
    snmpIndex: number(sensor.snmp_index),
    scale: number(sensor.scale) ?? 1,
    unit: text(sensor.unit),
    expect: text(sensor.expect),
    cloud: sensor.cloud === true,
    failuresToDown: number(sensor.failures_to_down) ?? 2,
    paused: sensor.paused === true,
    pausedReason: sensor.paused === true ? text(sensor.paused_reason) : null,
    pausedAt: sensor.paused === true ? text(sensor.paused_at) : null,
    pausedBy: sensor.paused === true ? text(sensor.paused_by) : null,
    serviceIds: Array.isArray(sensor.service_ids) ? (sensor.service_ids as unknown[]).filter(isUuid) : [],
    // Only while it runs.
    simulateUntil: text(sensor.simulate_until) && Date.parse(String(sensor.simulate_until)) > now
      ? String(sensor.simulate_until)
      : null,
  };
  const state: DisplayState = displayState(
    view,
    status ? { state: text(status.state), lastCheckAt: text(status.last_check_at) } : null,
    now,
  );
  return {
    ...view,
    state,
    since: text(status?.since),
    lastCheckAt: text(status?.last_check_at),
    lastValue: number(status?.last_value),
    lastValue2: number(status?.last_value2),
    lastMessage: text(status?.last_message),
  };
}

async function loadSensors(admin: Client, tenantId: string, assetId?: string) {
  let sensorQuery = admin.from("monitoring_sensors")
    .select("id, asset_id, agent_id, kind, name, target, port, url, interval_seconds, timeout_ms, warning_above, warning_below, down_above, down_below, snmp_metric, snmp_oid, snmp_index, scale, unit, expect, cloud, failures_to_down, paused, paused_reason, paused_by, paused_at, service_ids, simulate_until")
    .eq("tenant_id", tenantId).order("name").limit(MAX_SENSORS);
  if (assetId) sensorQuery = sensorQuery.eq("asset_id", assetId);
  const sensors = await sensorQuery;
  if (sensors.error) throw unavailable();
  const rows = (sensors.data ?? []) as Row[];
  const statusRows = assetId
    ? await selectIn(admin, "monitoring_sensor_status", "sensor_id, state, since, last_check_at, last_value, last_value2, last_message", tenantId, "sensor_id", rows.map((row) => String(row.id)))
    : await (async () => {
      const { data, error } = await admin.from("monitoring_sensor_status")
        .select("sensor_id, state, since, last_check_at, last_value, last_value2, last_message")
        .eq("tenant_id", tenantId).limit(MAX_SENSORS);
      if (error) throw unavailable();
      return (data ?? []) as Row[];
    })();
  const statuses = new Map(statusRows.map((row) => [String(row.sensor_id), row]));
  const now = Date.now();
  const names = await profileNames(admin, rows.map((row) => text(row.paused_by)));
  return rows.map((row) => {
    const view = sensorView(row, statuses.get(String(row.id)), now);
    return { ...view, pausedByName: view.pausedBy ? names.get(view.pausedBy) ?? null : null };
  });
}

/** Display names of people (e.g. who paused a sensor). */
async function profileNames(admin: Client, ids: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => !!id && isUuid(id)))];
  if (!unique.length) return new Map();
  const { data, error } = await admin.from("user_profiles").select("id, display_name").in("id", unique);
  if (error) return new Map();
  return new Map(((data ?? []) as Row[]).map((row) => [String(row.id), text(row.display_name) ?? "Unbekannte Person"]));
}

/**
 * Pauses or resumes whole devices and single sensors. Pausing needs a reason;
 * it is kept on each sensor and, like resuming, written to the activity log
 * shown under «Letzte Ereignisse». Only sensors whose state changes count.
 */
async function setPause(
  admin: Client,
  tenantId: string,
  actorId: string,
  input: { assetIds: string[]; sensorIds: string[]; paused: boolean; reason: string | null },
) {
  const rows: Row[] = [];
  for (const [column, ids] of [["asset_id", input.assetIds], ["id", input.sensorIds]] as const) {
    for (const part of chunks(ids, 100)) {
      const { data, error } = await admin.from("monitoring_sensors").select("id, asset_id, name, paused")
        .eq("tenant_id", tenantId).in(column, part);
      if (error) throw unavailable();
      rows.push(...((data ?? []) as Row[]));
    }
  }
  const unique = new Map(rows.map((row) => [String(row.id), row]));
  if (input.sensorIds.some((id) => !unique.has(id))) {
    throw new HttpError(404, "sensor_not_found", "Mindestens ein Sensor wurde nicht gefunden.");
  }
  const changed = [...unique.values()].filter((row) => (row.paused === true) !== input.paused);
  const now = new Date().toISOString();
  for (const part of chunks(changed.map((row) => String(row.id)), 100)) {
    const { error } = await admin.from("monitoring_sensors").update({
      paused: input.paused,
      paused_reason: input.paused ? input.reason : null,
      paused_by: input.paused ? actorId : null,
      paused_at: input.paused ? now : null,
      updated_at: now,
    }).eq("tenant_id", tenantId).in("id", part);
    if (error) throw unavailable();
  }
  if (input.paused) {
    for (const row of changed) {
      await closeSensorAlert(admin, tenantId, String(row.id), `Pausiert: ${input.reason}`);
    }
  }
  // Activity: one entry per device that was chosen as a whole, one per single sensor.
  const assetIds = [...new Set(changed.map((row) => String(row.asset_id)))];
  const assets = assetIds.length ? await selectIn(admin, "assets", "id, name", tenantId, "id", assetIds) : [];
  const assetName = new Map(assets.map((row) => [String(row.id), String(row.name)]));
  const wholeDevices = new Set(input.assetIds);
  const entries: Row[] = [];
  for (const assetId of assetIds) {
    if (!wholeDevices.has(assetId)) continue;
    entries.push({ asset_id: assetId, sensor_id: null, sensor_name: null });
  }
  for (const row of changed) {
    if (wholeDevices.has(String(row.asset_id))) continue;
    entries.push({ asset_id: String(row.asset_id), sensor_id: String(row.id), sensor_name: String(row.name) });
  }
  if (entries.length) {
    const { error } = await admin.from("monitoring_sensor_activity").insert(entries.map((entry) => ({
      ...entry,
      tenant_id: tenantId,
      device_name: assetName.get(String(entry.asset_id)) ?? "",
      action: input.paused ? "paused" : "resumed",
      reason: input.paused ? input.reason : null,
      actor_id: actorId,
    })));
    if (error) console.error("monitoring activity failed", error.code, error.message);
  }
  return { ok: true, sensors: changed.length };
}

const PACKAGE_BUCKET = "probe-packages";
const PACKAGE_CACHE_MS = 5 * 60 * 1000;
let packageCache: { at: number; info: ProbePackage | null } | null = null;

/** The newest published probe package (cached per isolate for five minutes). */
async function latestPackage(admin: Client, fresh = false): Promise<ProbePackage | null> {
  if (!fresh && packageCache && Date.now() - packageCache.at < PACKAGE_CACHE_MS) return packageCache.info;
  let info: ProbePackage | null = null;
  try {
    const { data, error } = await admin.storage.from(PACKAGE_BUCKET).download("latest.json");
    if (!error && data) info = parseProbePackage(JSON.parse(await data.text()));
  } catch {
    info = null;
  }
  packageCache = { at: Date.now(), info };
  return info;
}

async function probePackage(admin: Client) {
  const info = await latestPackage(admin, true);
  if (!info) {
    throw new HttpError(404, "package_missing", "Das Installationspaket der Sonde ist noch nicht veröffentlicht.");
  }
  const signed = await admin.storage.from(PACKAGE_BUCKET).createSignedUrl(info.file, 600, { download: info.file });
  if (signed.error || !signed.data?.signedUrl) throw unavailable();
  return {
    version: info.version,
    build: info.build,
    fileName: info.file,
    size: info.size,
    sha256: info.sha256,
    builtAt: info.builtAt,
    url: signed.data.signedUrl,
  };
}

async function loadAgents(admin: Client, tenantId: string) {
  const { data, error } = await admin.from("ipam_agents")
    .select("id, name, status, hostname, platform, version, last_seen_at")
    .eq("tenant_id", tenantId).neq("status", "revoked").order("name").limit(100);
  if (error) throw unavailable();
  const now = Date.now();
  return ((data ?? []) as Row[]).map((row) => ({
    id: String(row.id),
    name: String(row.name),
    active: row.status === "active",
    hostname: text(row.hostname),
    platform: text(row.platform),
    version: text(row.version),
    lastSeenAt: text(row.last_seen_at),
    online: row.status === "active" && agentOnline(text(row.last_seen_at), now),
  }));
}

async function activeIncidents(admin: Client, tenantId: string, assetIds: string[]) {
  const rows = await (async () => {
    const result: Row[] = [];
    for (const part of chunks([...new Set(assetIds)], 100)) {
      const { data, error } = await admin.from("monitoring_incidents")
        .select("id, number, title, severity, asset_id, opened_at, acknowledged_at, maintenance")
        .eq("tenant_id", tenantId).eq("state", "active").in("asset_id", part);
      if (error) throw unavailable();
      result.push(...((data ?? []) as Row[]));
    }
    return result;
  })();
  return new Map(rows.map((row) => [String(row.asset_id), {
    id: String(row.id),
    number: String(row.number),
    title: String(row.title),
    severity: String(row.severity),
    openedAt: text(row.opened_at),
    acknowledged: !!row.acknowledged_at,
    maintenance: row.maintenance === true,
  }]));
}

async function overview(admin: Client, tenantId: string, canManage: boolean) {
  const [sensors, agents, latest] = await Promise.all([
    loadSensors(admin, tenantId),
    loadAgents(admin, tenantId),
    latestPackage(admin),
  ]);
  const assetIds = [...new Set(sensors.map((sensor) => sensor.assetId))];
  const [assets, infrastructure, incidents] = await Promise.all([
    selectIn(admin, "assets", "id, name", tenantId, "id", assetIds),
    selectIn(admin, "asset_infrastructure", "asset_id, category, category_label, hostname, ip_address", tenantId, "asset_id", assetIds),
    activeIncidents(admin, tenantId, assetIds),
  ]);
  const infraByAsset = new Map(infrastructure.map((row) => [String(row.asset_id), row]));
  const sensorsByAsset = new Map<string, typeof sensors>();
  for (const sensor of sensors) {
    sensorsByAsset.set(sensor.assetId, [...(sensorsByAsset.get(sensor.assetId) ?? []), sensor]);
  }
  const rank: Record<DisplayState, number> = { down: 0, warning: 1, unknown: 2, up: 3, paused: 4 };
  const devices = assets.map((asset) => {
    const id = String(asset.id);
    const own = sensorsByAsset.get(id) ?? [];
    const infra = infraByAsset.get(id);
    const counts: Record<DisplayState, number> = { down: 0, warning: 0, up: 0, unknown: 0, paused: 0 };
    for (const sensor of own) counts[sensor.state] += 1;
    // Response time of the device: its ping sensor, else the first with a value.
    const primary = own.find((sensor) => sensor.kind === "ping" && sensor.state !== "paused") ??
      own.find((sensor) => !sensor.unit && sensor.kind !== "dns" && sensor.lastValue !== null && sensor.state !== "paused") ?? null;
    const problem = own.filter((sensor) => sensor.state === "down" || sensor.state === "warning")
      .sort((a, b) => rank[a.state] - rank[b.state])[0] ?? null;
    return {
      assetId: id,
      name: String(asset.name),
      category: text(infra?.category),
      categoryLabel: kindLabel(infra),
      hostname: text(infra?.hostname),
      ipAddress: text(infra?.ip_address),
      state: deviceState(own.map((sensor) => sensor.state)),
      counts,
      sensorCount: own.length,
      responseMs: primary && primary.state !== "unknown" && primary.state !== "down" ? primary.lastValue : null,
      lastCheckAt: own.map((sensor) => sensor.lastCheckAt).filter((value): value is string => !!value).sort().at(-1) ?? null,
      problem: problem
        ? {
          sensorId: problem.id,
          sensorName: problem.name,
          state: problem.state,
          since: problem.since,
          message: problem.lastMessage,
          services: [] as string[],
          serviceIds: problem.serviceIds,
        }
        : null,
      incident: incidents.get(id) ?? null,
      // Newest pause on the device: who, when and why.
      pause: (() => {
        const latest = own.filter((sensor) => sensor.paused && sensor.pausedAt)
          .sort((a, b) => String(b.pausedAt).localeCompare(String(a.pausedAt)))[0];
        return latest
          ? { reason: latest.pausedReason, by: latest.pausedByName, at: latest.pausedAt }
          : null;
      })(),
    };
  }).sort((a, b) => rank[a.state] - rank[b.state] || a.name.localeCompare(b.name, "de"));
  // Services affected by the active alarms: those of the sensor, else those
  // linked to the device.
  const alarmed = devices.filter((device) => device.problem);
  await Promise.all(alarmed.filter((device) => !device.problem!.serviceIds.length).slice(0, 50).map(async (device) => {
    const resolved = await admin.rpc("monitoring_resolve_asset", { p_tenant_id: tenantId, p_asset_id: device.assetId });
    if (!resolved.error && Array.isArray(resolved.data?.serviceIds)) {
      device.problem!.serviceIds = (resolved.data.serviceIds as unknown[]).filter(isUuid);
    }
  }));
  const alarmServiceIds = [...new Set(alarmed.flatMap((device) => device.problem!.serviceIds))];
  const alarmServices = new Map(
    (alarmServiceIds.length ? await selectIn(admin, "services", "id, name", tenantId, "id", alarmServiceIds) : [])
      .map((row) => [String(row.id), String(row.name)]),
  );
  for (const device of alarmed) {
    device.problem!.services = device.problem!.serviceIds.map((id) => alarmServices.get(id))
      .filter((name): name is string => !!name).sort((a, b) => a.localeCompare(b, "de"));
  }
  const totals: Record<DisplayState, number> = { down: 0, warning: 0, up: 0, unknown: 0, paused: 0 };
  for (const device of devices) totals[device.state] += 1;
  const sensorCounts = new Map<string, number>();
  for (const sensor of sensors) {
    if (sensor.agentId) sensorCounts.set(sensor.agentId, (sensorCounts.get(sensor.agentId) ?? 0) + 1);
  }
  return {
    canManage,
    totals,
    deviceCount: devices.length,
    sensorCount: sensors.length,
    devices,
    agents: agents.map((agent) => ({
      ...agent,
      sensorCount: sensorCounts.get(agent.id) ?? 0,
      updateAvailable: isOlderVersion(agent.version, latest?.version ?? null),
    })),
    probePackage: latest ? { version: latest.version, builtAt: latest.builtAt, size: latest.size } : null,
    checkedAt: new Date().toISOString(),
  };
}

/** Devices in «Ausfall» and «Warnung» for the menu badge (same rules as the overview). */
async function summary(admin: Client, tenantId: string) {
  const sensors = await loadSensors(admin, tenantId);
  const byAsset = new Map<string, DisplayState[]>();
  for (const sensor of sensors) {
    byAsset.set(sensor.assetId, [...(byAsset.get(sensor.assetId) ?? []), sensor.state]);
  }
  let down = 0;
  let warning = 0;
  for (const states of byAsset.values()) {
    const state = deviceState(states);
    if (state === "down") down += 1;
    else if (state === "warning") warning += 1;
  }
  return { down, warning };
}

/**
 * Ticket for a device, e.g. from an outage: subject and description name the
 * failing sensors, the device is linked, the ticket goes to the alarm team of
 * the monitoring settings and is attached to the device's active incident.
 */
async function deviceTicket(admin: Client, client: Client, tenantId: string, actorId: string, assetId: string) {
  const agent = await client.rpc("is_tenant_ticket_agent", { p_tenant_id: tenantId });
  if (agent.error || agent.data !== true) {
    throw new HttpError(403, "forbidden", "Nur Agenten können Tickets erstellen.");
  }
  const asset = await requireAsset(admin, tenantId, assetId);
  const [sensors, infraRows, integration, incident, assetRow] = await Promise.all([
    loadSensors(admin, tenantId, assetId),
    selectIn(admin, "asset_infrastructure", "asset_id, category, category_label, hostname, ip_address", tenantId, "asset_id", [assetId]),
    admin.from("monitoring_integrations").select("team_id").eq("tenant_id", tenantId).maybeSingle(),
    admin.from("monitoring_incidents").select("id, number").eq("tenant_id", tenantId).eq("asset_id", assetId)
      .eq("state", "active").is("parent_incident_id", null).order("opened_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("assets").select("department_id").eq("tenant_id", tenantId).eq("id", assetId).maybeSingle(),
  ]);
  const infra = infraRows[0] ?? null;
  const problems = sensors.filter((sensor) => sensor.state === "down" || sensor.state === "warning")
    .sort((a, b) => (a.state === b.state ? 0 : a.state === "down" ? -1 : 1));
  const state = deviceState(sensors.map((sensor) => sensor.state));
  const name = String(asset.name);
  const address = text(infra?.ip_address) ?? text(infra?.hostname);

  // Team of the monitoring settings (only while active); its department wins.
  let teamId: string | null = null;
  let teamDepartment: string | null = null;
  const configuredTeam = text(integration.data?.team_id);
  if (configuredTeam) {
    const { data } = await admin.from("teams").select("id, department_id, active").eq("tenant_id", tenantId)
      .eq("id", configuredTeam).maybeSingle();
    if (data?.active) {
      teamId = String(data.id);
      teamDepartment = text(data.department_id);
    }
  }
  let department: Row | null = null;
  for (const id of [teamDepartment, text(assetRow.data?.department_id)]) {
    if (!id) continue;
    const { data } = await admin.from("departments").select("id, key").eq("tenant_id", tenantId)
      .eq("id", id).eq("active", true).maybeSingle();
    if (data) {
      department = data as Row;
      break;
    }
  }
  if (!department) {
    const { data } = await admin.from("departments").select("id, key").eq("tenant_id", tenantId)
      .eq("active", true).order("key").limit(1).maybeSingle();
    department = (data as Row | null) ?? null;
  }
  const [status, priorities] = await Promise.all([
    admin.from("ticket_statuses").select("id").eq("tenant_id", tenantId).eq("key", "new").maybeSingle(),
    admin.from("ticket_priorities").select("id, key").eq("tenant_id", tenantId),
  ]);
  const priorityRows = (priorities.data ?? []) as Row[];
  const preferred = state === "down" ? ["high", "urgent", "normal"] : ["normal", "low"];
  const priority = preferred.map((key) => priorityRows.find((row) => row.key === key)).find(Boolean) ??
    priorityRows[0];
  if (!department || !status.data || !priority) {
    throw new HttpError(422, "ticket_defaults_unavailable", "Für Tickets fehlen Abteilung, Status oder Priorität.");
  }
  const number = await admin.rpc("reserve_ticket_number", {
    p_tenant_id: tenantId,
    p_department_id: department.id,
    p_prefix: String(department.key).slice(0, 8),
  });
  if (number.error || typeof number.data !== "string") throw unavailable();

  const lead = problems[0] ?? null;
  const subject = lead
    ? `${lead.state === "down" ? "Ausfall" : "Warnung"}: ${name} · ${lead.name}`
    : `Überwachung: ${name}`;
  const description = [
    `Gerät: ${name}${address ? ` (${address})` : ""}`,
    ...problems.map((sensor) =>
      `- ${sensor.state === "down" ? "Ausfall" : "Warnung"} ${sensor.name}` +
      `${sensor.lastMessage ? `: ${sensor.lastMessage}` : ""}` +
      `${sensor.since ? ` (seit ${new Date(sensor.since).toLocaleString("de-CH", { timeZone: "Europe/Zurich" })})` : ""}`
    ),
    incident.data ? `Störung: ${String(incident.data.number)}` : null,
    "",
    "Erstellt aus der Überwachung.",
  ].filter((line) => line !== null).join("\n");

  await admin.from("user_profiles").upsert({ id: actorId });
  const ticket = await admin.from("tickets").insert({
    tenant_id: tenantId,
    department_id: department.id,
    ticket_number: number.data,
    subject: subject.slice(0, 240),
    description: description.slice(0, 50_000),
    status_id: status.data.id,
    priority_id: priority.id,
    requester_id: actorId,
    assigned_team_id: teamId,
  }).select("id, ticket_number").single().setHeader("x-nextdesk-actor-id", actorId);
  if (ticket.error || !ticket.data) {
    console.error("monitoring ticket failed", ticket.error?.code, ticket.error?.message);
    throw new HttpError(422, "ticket_create_failed", "Das Ticket konnte nicht erstellt werden.");
  }
  const ticketId = String(ticket.data.id);
  await admin.from("ticket_events").insert({
    ticket_id: ticketId,
    actor_id: actorId,
    event_type: "ticket.created",
    payload: { source: "monitoring", assetId },
  });
  await admin.from("ticket_assets").insert({ tenant_id: tenantId, ticket_id: ticketId, asset_id: assetId, linked_by: actorId });
  if (incident.data) {
    await admin.from("monitoring_incident_tickets").upsert({
      incident_id: incident.data.id,
      ticket_id: ticketId,
      tenant_id: tenantId,
      source: "manual",
      linked_by: actorId,
      removed_at: null,
      removed_by: null,
    }, { onConflict: "incident_id,ticket_id" });
  }
  await admin.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_id: actorId,
    action: "monitoring.ticket.created",
    entity_type: "ticket",
    entity_id: ticketId,
    severity: "info",
    metadata: { assetId, ticketNumber: ticket.data.ticket_number },
  });
  return { ticketId, ticketNumber: String(ticket.data.ticket_number) };
}

async function requireAsset(admin: Client, tenantId: string, assetId: string): Promise<Row> {
  const { data, error } = await admin.from("assets").select("id, name").eq("tenant_id", tenantId).eq("id", assetId).maybeSingle();
  if (error) throw unavailable();
  if (!data) throw new HttpError(404, "device_not_found", "Das Gerät wurde nicht gefunden.");
  return data as Row;
}

async function device(admin: Client, tenantId: string, assetId: string, canManage: boolean) {
  const asset = await requireAsset(admin, tenantId, assetId);
  const [sensors, agents, infra, incidents, resolved] = await Promise.all([
    loadSensors(admin, tenantId, assetId),
    loadAgents(admin, tenantId),
    admin.from("asset_infrastructure").select("category, category_label, hostname, ip_address, uplink_asset_id").eq("tenant_id", tenantId).eq("asset_id", assetId).maybeSingle(),
    activeIncidents(admin, tenantId, [assetId]),
    admin.rpc("monitoring_resolve_asset", { p_tenant_id: tenantId, p_asset_id: assetId }),
  ]);
  if (infra.error || resolved.error) throw unavailable();
  const serviceIds = Array.isArray(resolved.data?.serviceIds)
    ? (resolved.data.serviceIds as unknown[]).filter(isUuid)
    : [];
  const uplinkId = text(infra.data?.uplink_asset_id);
  const [services, uplink] = await Promise.all([
    serviceIds.length ? selectIn(admin, "services", "id, name", tenantId, "id", serviceIds) : Promise.resolve([]),
    uplinkId ? selectIn(admin, "assets", "id, name", tenantId, "id", [uplinkId]) : Promise.resolve([]),
  ]);
  return {
    canManage,
    device: {
      assetId,
      name: String(asset.name),
      category: text(infra.data?.category),
      categoryLabel: kindLabel(infra.data),
      hostname: text(infra.data?.hostname),
      ipAddress: text(infra.data?.ip_address),
      state: deviceState(sensors.map((sensor) => sensor.state)),
      services: services.map((row) => ({ id: String(row.id), name: String(row.name) })),
      uplink: uplink[0] ? { assetId: String(uplink[0].id), name: String(uplink[0].name) } : null,
      incident: incidents.get(assetId) ?? null,
    },
    sensors,
    agents,
    kinds: canManage ? await customKinds(admin, tenantId) : [],
    serviceOptions: await serviceOptions(admin, tenantId),
    checkedAt: new Date().toISOString(),
  };
}

/** Own name of the device kind; only counts for the category «other». */
function kindLabel(row: Row | null | undefined): string | null {
  return row?.category === "other" ? text(row.category_label) : null;
}

/** Services of the status page a sensor can be linked to. */
async function serviceOptions(admin: Client, tenantId: string): Promise<{ id: string; name: string }[]> {
  const { data, error } = await admin.from("services").select("id, name")
    .eq("tenant_id", tenantId).eq("active", true).order("name").limit(500);
  if (error) throw unavailable();
  return ((data ?? []) as Row[]).map((row) => ({ id: String(row.id), name: String(row.name) }));
}

/** Own device kinds of the tenant, as they are used on its devices. */
async function customKinds(admin: Client, tenantId: string): Promise<string[]> {
  const { data, error } = await admin.from("asset_infrastructure").select("category_label")
    .eq("tenant_id", tenantId).eq("category", "other").not("category_label", "is", null).limit(2000);
  if (error) throw unavailable();
  const labels = new Map<string, string>();
  for (const row of (data ?? []) as Row[]) {
    const label = text(row.category_label);
    if (label && !labels.has(label.toLowerCase())) labels.set(label.toLowerCase(), label);
  }
  return [...labels.values()].sort((a, b) => a.localeCompare(b, "de"));
}

async function series(admin: Client, tenantId: string, sensorId: string, range: "24h" | "7d" | "30d" | "1y") {
  const sensor = await admin.from("monitoring_sensors").select("id, unit").eq("tenant_id", tenantId).eq("id", sensorId).maybeSingle();
  if (sensor.error) throw unavailable();
  if (!sensor.data) throw new HttpError(404, "sensor_not_found", "Der Sensor wurde nicht gefunden.");
  const plan = rangePlan(range, Date.now());
  type Entry = Parameters<typeof bucketize>[0][number];
  const entries: Entry[] = [];
  if (plan.source === "raw") {
    // 24 h at the shortest interval (30 s) are 2880 rows.
    for (let offset = 0; offset < 4000; offset += 1000) {
      const { data, error } = await admin.from("monitoring_samples").select("at, ok, value, value2")
        .eq("sensor_id", sensorId).gte("at", plan.from).order("at").range(offset, offset + 999);
      if (error) throw unavailable();
      for (const row of (data ?? []) as Row[]) {
        const value = number(row.value);
        const second = number(row.value2);
        entries.push({
          at: Date.parse(String(row.at)),
          checks: 1,
          checksOk: row.ok === true ? 1 : 0,
          avg: value,
          min: value,
          max: value,
          avg2: second,
          max2: second,
        });
      }
      if ((data ?? []).length < 1000) break;
    }
  } else {
    const table = plan.source === "hourly" ? "monitoring_samples_hourly" : "monitoring_samples_daily";
    const from = plan.source === "daily" ? plan.from.slice(0, 10) : plan.from;
    const { data, error } = await admin.from(table).select("bucket, checks, checks_ok, value_avg, value_min, value_max, value2_avg, value2_max")
      .eq("sensor_id", sensorId).gte("bucket", from).order("bucket").limit(1000);
    if (error) throw unavailable();
    for (const row of (data ?? []) as Row[]) {
      entries.push({
        at: Date.parse(String(row.bucket)),
        checks: number(row.checks) ?? 0,
        checksOk: number(row.checks_ok) ?? 0,
        avg: number(row.value_avg),
        min: number(row.value_min),
        max: number(row.value_max),
        avg2: number(row.value2_avg),
        max2: number(row.value2_max),
      });
    }
  }
  const points = bucketize(entries, plan.bucketMs);
  const checks = entries.reduce((total, entry) => total + entry.checks, 0);
  const ok = entries.reduce((total, entry) => total + entry.checksOk, 0);
  return {
    sensorId,
    range,
    unit: text(sensor.data.unit),
    from: plan.from,
    bucketSeconds: plan.bucketMs / 1000,
    points,
    availability: checks ? Math.round((ok / checks) * 10000) / 100 : availability(points),
  };
}

/**
 * Entries of the IP address management that are not linked to a device yet:
 * hosts nextDesk knows by address but not as infrastructure device.
 */
async function addressChoices(admin: Client, tenantId: string, query: string) {
  if (query.trim().length < 2) return [];
  const { data, error } = await admin.from("ipam_addresses")
    .select("id, address, hostname, description, device_type")
    .eq("tenant_id", tenantId).is("asset_id", null).limit(5000);
  // The module may be off or empty: then there is simply nothing to offer.
  if (error) return [];
  return ((data ?? []) as Row[]).flatMap((row) => {
    const address = String(row.address ?? "").split("/")[0] ?? "";
    const entry = { address, hostname: text(row.hostname), description: text(row.description) };
    if (!address || !matchesAddress(entry, query)) return [];
    return [{ addressId: String(row.id), ...entry, deviceType: text(row.device_type) }];
  }).sort((x, y) => (x.hostname ?? x.address).localeCompare(y.hostname ?? y.address, "de")).slice(0, 30);
}

/**
 * Creates a device in the infrastructure (like «Infrastruktur → Gerät
 * erfassen», with the fields monitoring needs) and its ping sensor.
 */
async function addDevice(admin: Client, tenantId: string, actorId: string, device: NewDevice) {
  if (device.agentId) {
    const agent = await admin.from("ipam_agents").select("id").eq("tenant_id", tenantId).eq("id", device.agentId).neq("status", "revoked").maybeSingle();
    if (agent.error) throw unavailable();
    if (!agent.data) throw new HttpError(422, "agent_not_found", "Die Sonde wurde nicht gefunden.");
  }
  const inserted = await admin.from("assets").insert({
    tenant_id: tenantId,
    name: device.name,
    kind: device.category,
    lifecycle_state: "active",
    lifecycle_changed_at: new Date().toISOString(),
  }).select("id").single();
  if (inserted.error || !inserted.data) {
    throw new HttpError(422, "device_save_failed", "Das Gerät konnte nicht gespeichert werden.");
  }
  const assetId = String(inserted.data.id);
  await admin.from("asset_lifecycle_events")
    .update({ actor_id: actorId, reason: "Erfasst in der Überwachung" })
    .eq("tenant_id", tenantId).eq("asset_id", assetId).is("actor_id", null);
  const infra = await admin.from("asset_infrastructure").insert({
    asset_id: assetId,
    tenant_id: tenantId,
    category: device.category,
    category_label: device.categoryLabel,
    hostname: device.hostname,
    ip_address: device.ipAddress,
  });
  if (infra.error) {
    // Do not leave a device behind that is no infrastructure device.
    await admin.from("assets").delete().eq("tenant_id", tenantId).eq("id", assetId);
    throw unavailable();
  }
  if (device.ipamAddressId) {
    // Link the address to the new device; a failure here is not fatal.
    await admin.from("ipam_addresses").update({ asset_id: assetId, change_actor: actorId, change_source: "user" })
      .eq("tenant_id", tenantId).eq("id", device.ipamAddressId).is("asset_id", null);
  }
  await admin.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_id: actorId,
    action: "infrastructure.device.created",
    entity_type: "asset",
    entity_id: assetId,
    severity: "info",
    metadata: { category: device.category, source: "monitoring" },
  });
  const sensor = await admin.from("monitoring_sensors").insert({
    tenant_id: tenantId,
    asset_id: assetId,
    agent_id: device.agentId,
    kind: "ping",
    name: "Ping",
    created_by: actorId,
  }).select("id").single();
  if (sensor.error) throw unavailable();
  return { assetId, sensorId: String(sensor.data.id) };
}

/** Changes name, kind and address of a monitored device (also in the infrastructure). */
async function updateDevice(admin: Client, tenantId: string, actorId: string, assetId: string, device: DeviceEdit) {
  await requireAsset(admin, tenantId, assetId);
  const asset = await admin.from("assets").update({ name: device.name, kind: device.category })
    .eq("tenant_id", tenantId).eq("id", assetId);
  if (asset.error) {
    throw new HttpError(422, "device_save_failed", "Das Gerät konnte nicht gespeichert werden.");
  }
  const infra = await admin.from("asset_infrastructure").update({
    category: device.category,
    category_label: device.categoryLabel,
    ip_address: device.ipAddress,
    hostname: device.hostname,
    updated_at: new Date().toISOString(),
  }).eq("tenant_id", tenantId).eq("asset_id", assetId).select("asset_id").maybeSingle();
  if (infra.error) throw unavailable();
  if (!infra.data) {
    throw new HttpError(422, "not_infrastructure", "Das Gerät ist kein Infrastruktur-Gerät.");
  }
  await admin.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_id: actorId,
    action: "infrastructure.device.updated",
    entity_type: "asset",
    entity_id: assetId,
    severity: "info",
    metadata: { category: device.category, source: "monitoring" },
  });
  return { assetId };
}

async function assetChoices(admin: Client, tenantId: string, query: string) {
  const columns = "asset_id, category, category_label, hostname, ip_address";
  let request = admin.from("asset_infrastructure").select(columns).eq("tenant_id", tenantId).limit(400);
  const safe = query.replace(/[^\p{L}\p{N} ._:-]/gu, "");
  if (safe) request = request.or(`hostname.ilike.%${safe}%,ip_address.ilike.%${safe}%`);
  const byInfra = await request;
  if (byInfra.error) throw unavailable();
  const rows = new Map<string, Row>(((byInfra.data ?? []) as Row[]).map((row) => [String(row.asset_id), row]));
  if (safe) {
    // Also by device name (the name lives on the asset, not on the infrastructure row).
    const named = await admin.from("assets").select("id").eq("tenant_id", tenantId).ilike("name", `%${safe}%`).limit(200);
    if (named.error) throw unavailable();
    const missing = ((named.data ?? []) as Row[]).map((row) => String(row.id)).filter((id) => !rows.has(id));
    for (const row of await selectIn(admin, "asset_infrastructure", columns, tenantId, "asset_id", missing)) {
      rows.set(String(row.asset_id), row);
    }
  }
  const [assets, monitored] = await Promise.all([
    selectIn(admin, "assets", "id, name, lifecycle_state", tenantId, "id", [...rows.keys()]),
    admin.from("monitoring_sensors").select("asset_id").eq("tenant_id", tenantId).limit(MAX_SENSORS),
  ]);
  if (monitored.error) throw unavailable();
  const known = new Set(((monitored.data ?? []) as Row[]).map((row) => String(row.asset_id)));
  return {
    addresses: await addressChoices(admin, tenantId, query),
    kinds: await customKinds(admin, tenantId),
    assets: assets.flatMap((asset) => {
      if (asset.lifecycle_state === "retired" || asset.lifecycle_state === "disposed") return [];
      const row = rows.get(String(asset.id));
      return [{
        assetId: String(asset.id),
        name: String(asset.name),
        category: text(row?.category),
        categoryLabel: kindLabel(row),
        hostname: text(row?.hostname),
        ipAddress: text(row?.ip_address),
        monitored: known.has(String(asset.id)),
      }];
      // Devices with an address first: they can be monitored right away.
    }).sort((x, y) =>
      Number(!(x.ipAddress || x.hostname)) - Number(!(y.ipAddress || y.hostname)) ||
      x.name.localeCompare(y.name, "de")
    ).slice(0, 100),
  };
}

async function saveSensor(admin: Client, tenantId: string, actorId: string, action: Extract<Action, { type: "saveSensor" }>) {
  const sensor = action.sensor;
  await requireAsset(admin, tenantId, sensor.assetId);
  const infra = await admin.from("asset_infrastructure").select("hostname, ip_address").eq("tenant_id", tenantId).eq("asset_id", sensor.assetId).maybeSingle();
  if (infra.error) throw unavailable();
  if (!infra.data) {
    throw new HttpError(422, "not_infrastructure", "Überwacht werden Geräte aus der Infrastruktur. Bitte das Gerät dort erfassen.");
  }
  if (sensor.kind !== "http" && !sensor.target && !text(infra.data.ip_address) && !text(infra.data.hostname)) {
    throw new HttpError(422, "target_missing", "Das Gerät hat weder IP-Adresse noch Hostname. Bitte ein Ziel angeben oder das Gerät ergänzen.");
  }
  if (sensor.cloud && sensor.kind !== "dns") {
    // Refuse internal targets when saving, not only when measuring.
    const host = sensor.kind === "http" ? new URL(sensor.url ?? "").hostname : sensor.target ?? "";
    const reachable = await publicTarget(host).catch(() => "Der Name lässt sich nicht auflösen.");
    if (typeof reachable === "string") throw new HttpError(422, "cloud_target", reachable);
  }
  if (sensor.serviceIds?.length) {
    const known = await selectIn(admin, "services", "id", tenantId, "id", sensor.serviceIds);
    if (known.length !== sensor.serviceIds.length) {
      throw new HttpError(422, "service_not_found", "Ein gewählter Dienst wurde nicht gefunden.");
    }
  }
  if (sensor.agentId) {
    const agent = await admin.from("ipam_agents").select("id").eq("tenant_id", tenantId).eq("id", sensor.agentId).neq("status", "revoked").maybeSingle();
    if (agent.error) throw unavailable();
    if (!agent.data) throw new HttpError(422, "agent_not_found", "Die Sonde wurde nicht gefunden.");
  }
  const values = {
    agent_id: sensor.agentId,
    kind: sensor.kind,
    name: sensor.name,
    target: sensor.target,
    port: sensor.port,
    url: sensor.url,
    interval_seconds: sensor.intervalSeconds,
    timeout_ms: sensor.timeoutMs,
    warning_above: sensor.warningAbove,
    warning_below: sensor.warningBelow,
    down_above: sensor.downAbove,
    down_below: sensor.downBelow,
    snmp_metric: sensor.snmpMetric,
    snmp_oid: sensor.snmpOid,
    snmp_index: sensor.snmpIndex,
    scale: sensor.scale,
    unit: sensor.unit,
    expect: sensor.expect,
    cloud: sensor.cloud,
    failures_to_down: sensor.failuresToDown,
    // Pausing goes through pauseDevice/pauseSensor/pauseMany (with a reason).
    updated_at: new Date().toISOString(),
    // Only when the client sent them (older apps do not know the field).
    ...(sensor.serviceIds === null ? {} : { service_ids: sensor.serviceIds }),
  };
  if (sensor.id) {
    const updated = await admin.from("monitoring_sensors").update(values)
      .eq("tenant_id", tenantId).eq("id", sensor.id).eq("asset_id", sensor.assetId).select("id").maybeSingle();
    if (updated.error) throw unavailable();
    if (!updated.data) throw new HttpError(404, "sensor_not_found", "Der Sensor wurde nicht gefunden.");
    return { sensorId: sensor.id };
  }
  const count = await admin.from("monitoring_sensors").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("asset_id", sensor.assetId);
  if (count.error) throw unavailable();
  if ((count.count ?? 0) >= MAX_SENSORS_PER_DEVICE) {
    throw new HttpError(422, "too_many_sensors", `Ein Gerät kann höchstens ${MAX_SENSORS_PER_DEVICE} Sensoren haben.`);
  }
  const inserted = await admin.from("monitoring_sensors")
    .insert({ ...values, paused: false, tenant_id: tenantId, asset_id: sensor.assetId, created_by: actorId }).select("id").single();
  if (inserted.error) throw unavailable();
  return { sensorId: String(inserted.data.id) };
}

async function closeSensorAlert(admin: Client, tenantId: string, sensorId: string, reason: string): Promise<void> {
  try {
    await closeSharedSensorAlert(admin, tenantId, sensorId, reason);
  } catch {
    throw unavailable();
  }
}

/** Asks the probe for the interfaces of a device (answer within about a minute). */
async function listInterfaces(admin: Client, tenantId: string, actorId: string, assetId: string, agentId: string) {
  await requireAsset(admin, tenantId, assetId);
  const [infra, agent] = await Promise.all([
    admin.from("asset_infrastructure").select("hostname, ip_address").eq("tenant_id", tenantId).eq("asset_id", assetId).maybeSingle(),
    admin.from("ipam_agents").select("id, status").eq("tenant_id", tenantId).eq("id", agentId).maybeSingle(),
  ]);
  if (infra.error || agent.error) throw unavailable();
  const host = text(infra.data?.ip_address) ?? text(infra.data?.hostname);
  if (!host) {
    throw new HttpError(422, "target_missing", "Das Gerät hat weder IP-Adresse noch Hostname.");
  }
  if (!agent.data || agent.data.status !== "active") {
    throw new HttpError(422, "agent_not_found", "Die Sonde ist nicht aktiv.");
  }
  const inserted = await admin.from("ipam_agent_jobs").insert({
    tenant_id: tenantId,
    agent_id: agentId,
    kind: "snmp_interfaces",
    payload: { host: host.trim().toLowerCase(), assetId },
    status: "queued",
    created_by: actorId,
  }).select("id").single();
  if (inserted.error) throw unavailable();
  return { jobId: String(inserted.data.id) };
}

async function interfaces(admin: Client, tenantId: string, jobId: string) {
  const { data, error } = await admin.from("ipam_agent_jobs").select("status, result, error")
    .eq("tenant_id", tenantId).eq("id", jobId).eq("kind", "snmp_interfaces").maybeSingle();
  if (error) throw unavailable();
  if (!data) throw new HttpError(404, "job_not_found", "Die Abfrage wurde nicht gefunden.");
  const done = data.status === "done";
  return {
    status: done ? "done" : data.status === "failed" || data.status === "cancelled" ? "failed" : "pending",
    error: done ? null : text(data.error),
    interfaces: done ? parseInterfaces(data.result) : [],
  };
}

/**
 * Latest events of the sensors for the overview: outages, warnings and
 * recoveries with device, services affected and incident.
 */
async function eventsOverview(admin: Client, tenantId: string, range: EventRange) {
  const now = Date.now();
  const from = new Date(now - (range === "24h" ? 24 : 7 * 24) * 3_600_000).toISOString();
  const alerts = await admin.from("monitoring_alerts")
    .select("id, asset_id, device_name, sensor_name, opened_at, resolved_at, was_down, simulated, last_message, service_ids, service_id, incident_id")
    .eq("tenant_id", tenantId).like("external_key", "nd:sensor:%")
    .or(`opened_at.gte.${from},resolved_at.gte.${from}`)
    .order("opened_at", { ascending: false }).limit(1000);
  if (alerts.error) throw unavailable();
  const rows = (alerts.data ?? []) as Row[];
  const feed = eventFeed({
    now,
    range,
    alerts: rows.map((row) => ({
      id: String(row.id),
      assetId: text(row.asset_id),
      sensorName: text(row.sensor_name),
      openedAt: Date.parse(String(row.opened_at)),
      resolvedAt: row.resolved_at ? Date.parse(String(row.resolved_at)) : null,
      wasDown: row.was_down === true,
      simulated: row.simulated === true,
      lastMessage: text(row.last_message),
      serviceIds: Array.isArray(row.service_ids) && row.service_ids.length
        ? (row.service_ids as unknown[]).filter(isUuid)
        : isUuid(row.service_id) ? [row.service_id] : [],
      incidentId: text(row.incident_id),
    })),
  });
  const deviceNames = new Map(rows.map((row) => [String(row.asset_id), text(row.device_name)]));
  const assetIds = [...new Set(feed.events.map((event) => event.assetId).filter((id): id is string => !!id))];
  const serviceIds = [...new Set(feed.events.flatMap((event) => event.serviceIds))];
  const incidentIds = [...new Set(feed.events.map((event) => event.incidentId).filter((id): id is string => !!id))];
  const [assets, services, incidents] = await Promise.all([
    assetIds.length ? selectIn(admin, "assets", "id, name", tenantId, "id", assetIds) : Promise.resolve([]),
    serviceIds.length ? selectIn(admin, "services", "id, name", tenantId, "id", serviceIds) : Promise.resolve([]),
    incidentIds.length ? selectIn(admin, "monitoring_incidents", "id, number", tenantId, "id", incidentIds) : Promise.resolve([]),
  ]);
  const assetName = new Map(assets.map((row) => [String(row.id), String(row.name)]));
  const serviceName = new Map(services.map((row) => [String(row.id), String(row.name)]));
  const incidentNumber = new Map(incidents.map((row) => [String(row.id), String(row.number)]));
  // Paused / resumed by people (activity log), mixed into the feed by time.
  const activity = await admin.from("monitoring_sensor_activity")
    .select("id, asset_id, device_name, sensor_name, action, reason, actor_id, created_at")
    .eq("tenant_id", tenantId).gte("created_at", from)
    .order("created_at", { ascending: false }).limit(100);
  const activityRows = activity.error ? [] : (activity.data ?? []) as Row[];
  const actors = await profileNames(admin, activityRows.map((row) => text(row.actor_id)));
  const activityEvents = activityRows.map((row) => ({
    id: `activity:${String(row.id)}`,
    at: String(row.created_at),
    kind: String(row.action) === "paused" ? "paused" as const : "resumed" as const,
    assetId: text(row.asset_id),
    deviceName: text(row.device_name) || "Gerät",
    sensorName: text(row.sensor_name),
    message: null,
    durationSeconds: null,
    ongoing: false,
    services: [] as string[],
    incident: null,
    test: false,
    actor: text(row.actor_id) ? actors.get(String(row.actor_id)) ?? "Unbekannte Person" : null,
    reason: text(row.reason),
  }));
  return {
    range,
    counts: feed.counts,
    buckets: feed.buckets,
    events: [...feed.events.map((event) => ({
      id: event.id,
      at: event.at,
      kind: event.kind,
      assetId: event.assetId,
      deviceName: (event.assetId ? assetName.get(event.assetId) ?? deviceNames.get(event.assetId) : null) ?? "Gerät",
      sensorName: event.sensorName,
      message: event.message,
      durationSeconds: event.durationSeconds,
      ongoing: event.ongoing,
      services: event.serviceIds.map((id) => serviceName.get(id)).filter((name): name is string => !!name)
        .sort((a, b) => a.localeCompare(b, "de")),
      incident: event.incidentId && incidentNumber.has(event.incidentId)
        ? { id: event.incidentId, number: incidentNumber.get(event.incidentId)! }
        : null,
      test: event.test,
      actor: null as string | null,
      reason: null as string | null,
    })), ...activityEvents]
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 60),
  };
}

/**
 * Availability of the monitored devices for the overview: overall value, a
 * bar per day (week), and the devices that were down most, with the services
 * affected. Computed from the outages of nextDesk's own sensors; simulated
 * outages and warnings do not count.
 */
async function availabilityOverview(admin: Client, tenantId: string, range: AvailabilityRange) {
  const now = Date.now();
  const plan = availabilityPlan(range);
  const from = new Date(now - plan.buckets * plan.bucketMs).toISOString();
  const [sensors, alerts] = await Promise.all([
    admin.from("monitoring_sensors").select("asset_id, created_at").eq("tenant_id", tenantId).limit(MAX_SENSORS),
    admin.from("monitoring_alerts").select("asset_id, opened_at, resolved_at, service_ids, service_id")
      .eq("tenant_id", tenantId).like("external_key", "nd:sensor:%")
      .eq("was_down", true).eq("simulated", false).not("asset_id", "is", null)
      .or(`resolved_at.is.null,resolved_at.gte.${from}`)
      .order("opened_at", { ascending: false }).limit(5000),
  ]);
  if (sensors.error || alerts.error) throw unavailable();
  const devices = new Map<string, number>();
  for (const row of (sensors.data ?? []) as Row[]) {
    const assetId = String(row.asset_id);
    const since = Date.parse(String(row.created_at));
    if (Number.isFinite(since)) devices.set(assetId, Math.min(devices.get(assetId) ?? since, since));
  }
  const report = availabilityReport({
    now,
    range,
    devices,
    outages: ((alerts.data ?? []) as Row[]).map((row) => ({
      assetId: String(row.asset_id),
      from: Date.parse(String(row.opened_at)),
      to: row.resolved_at ? Date.parse(String(row.resolved_at)) : now,
      serviceIds: Array.isArray(row.service_ids) && row.service_ids.length
        ? (row.service_ids as unknown[]).filter(isUuid)
        : isUuid(row.service_id) ? [row.service_id] : [],
    })),
  });
  // Devices whose outages named no service: the services linked to them now.
  const linked = new Map<string, string[]>();
  await Promise.all(report.worst.filter((entry) => !entry.serviceIds.length).map(async (entry) => {
    const resolved = await admin.rpc("monitoring_resolve_asset", { p_tenant_id: tenantId, p_asset_id: entry.assetId });
    if (!resolved.error && Array.isArray(resolved.data?.serviceIds)) {
      linked.set(entry.assetId, (resolved.data.serviceIds as unknown[]).filter(isUuid));
    }
  }));
  const serviceIds = [...new Set(report.worst.flatMap((entry) => [...entry.serviceIds, ...(linked.get(entry.assetId) ?? [])]))];
  const [names, services] = await Promise.all([
    report.worst.length
      ? selectIn(admin, "assets", "id, name", tenantId, "id", report.worst.map((entry) => entry.assetId))
      : Promise.resolve([]),
    serviceIds.length ? selectIn(admin, "services", "id, name", tenantId, "id", serviceIds) : Promise.resolve([]),
  ]);
  const assetName = new Map(names.map((row) => [String(row.id), String(row.name)]));
  const serviceName = new Map(services.map((row) => [String(row.id), String(row.name)]));
  return {
    range,
    overall: report.overall,
    devices: report.devices,
    buckets: report.buckets,
    worst: report.worst.map((entry) => ({
      assetId: entry.assetId,
      name: assetName.get(entry.assetId) ?? "Gerät",
      availability: entry.availability,
      outages: entry.outages,
      downSeconds: entry.downSeconds,
      services: (entry.serviceIds.length ? entry.serviceIds : linked.get(entry.assetId) ?? [])
        .map((id) => serviceName.get(id)).filter((name): name is string => !!name).sort((a, b) => a.localeCompare(b, "de")),
    })),
  };
}

/**
 * Starts (minutes > 0) or ends (0) a simulated outage of one sensor or of all
 * sensors of a device. While it runs, the measured results count as failed;
 * everything that follows is real: incident, alerting, service status, notice.
 */
async function simulate(admin: Client, tenantId: string, assetId: string, sensorId: string | null, minutes: number) {
  await requireAsset(admin, tenantId, assetId);
  const until = minutes > 0 ? new Date(Date.now() + minutes * 60_000).toISOString() : null;
  let update = admin.from("monitoring_sensors")
    .update({ simulate_until: until, updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId).eq("asset_id", assetId);
  if (sensorId) update = update.eq("id", sensorId);
  // Starting skips paused sensors (they are not measured); ending clears all.
  if (until) update = update.eq("paused", false);
  const updated = await update.select("id");
  if (updated.error) throw unavailable();
  const count = (updated.data ?? []).length;
  if (until && !count) {
    throw new HttpError(422, "nothing_to_simulate", "Kein aktiver Sensor gefunden. Pausierte Sensoren lassen sich nicht simulieren.");
  }
  return { ok: true, sensors: count, until };
}

/** A request for connections counts as running for this long. */
const TOPOLOGY_PENDING_MS = 10 * 60 * 1000;

/**
 * Connections of a device: its ports with what hangs on them, and the ports
 * of other devices it hangs on. Read by the probe via SNMP (LLDP, MAC table).
 */
async function connections(admin: Client, tenantId: string, assetId: string, canManage: boolean) {
  const asset = await requireAsset(admin, tenantId, assetId);
  const [status, ports, infra, monitored, ownAddresses] = await Promise.all([
    admin.from("monitoring_topology_status").select("requested_at, scanned_at, error, sys_name")
      .eq("tenant_id", tenantId).eq("asset_id", assetId).maybeSingle(),
    admin.from("monitoring_device_ports")
      .select("port, if_index, alias, up, speed_mbps, neighbor_name, neighbor_port, neighbor_address, neighbor_mac, macs, mac_count")
      .eq("tenant_id", tenantId).eq("asset_id", assetId).order("position").limit(600),
    admin.from("asset_infrastructure").select("asset_id, hostname, ip_address, mac_address")
      .eq("tenant_id", tenantId).limit(5000),
    admin.from("monitoring_sensors").select("asset_id").eq("tenant_id", tenantId).limit(MAX_SENSORS),
    admin.from("ipam_addresses").select("mac_address").eq("tenant_id", tenantId).eq("asset_id", assetId)
      .not("mac_address", "is", null).limit(50),
  ]);
  if (status.error || ports.error || infra.error || monitored.error || ownAddresses.error) throw unavailable();
  const stored = ((ports.data ?? []) as Row[]).map(portFromRow);
  const infraRows = (infra.data ?? []) as Row[];
  const names = new Map(
    (await selectIn(admin, "assets", "id, name", tenantId, "id", infraRows.map((row) => String(row.asset_id))))
      .map((row) => [String(row.id), String(row.name)]),
  );
  const monitoredIds = new Set(((monitored.data ?? []) as Row[]).map((row) => String(row.asset_id)));
  const devices: KnownDevice[] = infraRows.filter((row) => names.has(String(row.asset_id))).map((row) => ({
    assetId: String(row.asset_id),
    name: names.get(String(row.asset_id))!,
    hostname: text(row.hostname),
    ipAddress: text(row.ip_address),
    mac: normalizeMac(row.mac_address),
    monitored: monitoredIds.has(String(row.asset_id)),
  }));
  const self = devices.find((device) => device.assetId === assetId);
  const ownMacs = [
    ...new Set([
      self?.mac ?? null,
      ...((ownAddresses.data ?? []) as Row[]).map((row) => normalizeMac(row.mac_address)),
    ].filter((mac): mac is string => mac !== null)),
  ];

  // Ports of other devices that may lead to this one.
  const select = "asset_id, port, if_index, alias, up, speed_mbps, neighbor_name, neighbor_port, neighbor_address, neighbor_mac, macs, mac_count";
  const others = () => admin.from("monitoring_device_ports").select(select).eq("tenant_id", tenantId).neq("asset_id", assetId).limit(50);
  const lookups = [];
  if (self?.ipAddress) lookups.push(others().eq("neighbor_address", self.ipAddress.trim().toLowerCase()));
  if (ownMacs.length) {
    lookups.push(others().in("neighbor_mac", ownMacs));
    lookups.push(others().overlaps("macs", ownMacs));
  }
  for (const name of new Set([String(asset.name), self?.hostname ?? null])) {
    // Exact name or name with domain; the pure matching decides.
    const short = name?.trim().split(".")[0]?.replace(/[%_\\,()]/g, "");
    if (short && short.length >= 2) lookups.push(others().ilike("neighbor_name", `${short}%`));
  }
  const reverse = new Map<string, Row>();
  for (const result of await Promise.all(lookups)) {
    if (result.error) throw unavailable();
    for (const row of (result.data ?? []) as Row[]) reverse.set(`${row.asset_id}|${row.port}`, row);
  }

  const macs = [...new Set(stored.flatMap((port) => [...port.macs, ...(port.lldpMac ? [port.lldpMac] : [])]))].slice(0, 2000);
  const addresses: KnownAddress[] = (macs.length
    ? await selectIn(admin, "ipam_addresses", "mac_address, address, hostname, asset_id", tenantId, "mac_address", macs)
    : []).flatMap((row) => {
      const mac = normalizeMac(row.mac_address);
      const address = text(row.address)?.split("/")[0] ?? null;
      return mac && address ? [{ mac, address, hostname: text(row.hostname), assetId: text(row.asset_id) }] : [];
    });
  const known = directory(devices, addresses);

  const requestedAt = text(status.data?.requested_at);
  const scannedAt = text(status.data?.scanned_at);
  const pending = requestedAt !== null && (scannedAt === null || Date.parse(scannedAt) < Date.parse(requestedAt)) &&
    Date.now() - Date.parse(requestedAt) < TOPOLOGY_PENDING_MS;
  return {
    canManage,
    scannedAt,
    pending,
    error: pending ? null : text(status.data?.error),
    ports: stored.map((port) => resolvePort(port, known, assetId)).sort((a, b) => comparePorts(a.port, b.port)),
    attachedTo: attachments(
      [...reverse.values()].map((row) => ({ ...portFromRow(row), assetId: String(row.asset_id) })),
      { assetId, name: String(asset.name), hostname: self?.hostname ?? null, ipAddress: self?.ipAddress ?? null, macs: ownMacs },
      known,
    ),
  };
}

/** Asks the probe that monitors the device to read its connections now. */
async function refreshConnections(admin: Client, tenantId: string, actorId: string, assetId: string) {
  await requireAsset(admin, tenantId, assetId);
  const [infra, sensors, running] = await Promise.all([
    admin.from("asset_infrastructure").select("hostname, ip_address").eq("tenant_id", tenantId).eq("asset_id", assetId).maybeSingle(),
    admin.from("monitoring_sensors").select("agent_id, kind").eq("tenant_id", tenantId).eq("asset_id", assetId)
      .not("agent_id", "is", null).limit(200),
    admin.from("ipam_agent_jobs").select("id").eq("tenant_id", tenantId).eq("kind", "snmp_topology")
      .in("status", ["queued", "running"]).contains("payload", { assetId }).limit(1),
  ]);
  if (infra.error || sensors.error || running.error) throw unavailable();
  const host = text(infra.data?.ip_address) ?? text(infra.data?.hostname);
  if (!host) throw new HttpError(422, "target_missing", "Das Gerät hat weder IP-Adresse noch Hostname.");
  const rows = (sensors.data ?? []) as Row[];
  const agentIds = [...new Set(rows.sort((a, b) => Number(b.kind === "snmp") - Number(a.kind === "snmp")).map((row) => String(row.agent_id)))];
  const agents = agentIds.length ? await selectIn(admin, "ipam_agents", "id, status", tenantId, "id", agentIds) : [];
  const agentId = agentIds.find((id) => agents.some((agent) => agent.id === id && agent.status === "active"));
  if (!agentId) {
    throw new HttpError(422, "agent_not_found", "Kein Sensor dieses Geräts wird von einer aktiven Sonde gemessen.");
  }
  const now = new Date().toISOString();
  if (!(running.data ?? []).length) {
    const inserted = await admin.from("ipam_agent_jobs").insert({
      tenant_id: tenantId,
      agent_id: agentId,
      kind: "snmp_topology",
      payload: { host: host.trim().toLowerCase(), assetId },
      status: "queued",
      created_by: actorId,
    });
    if (inserted.error) throw unavailable();
  }
  const status = await admin.from("monitoring_topology_status").upsert(
    { asset_id: assetId, tenant_id: tenantId, agent_id: agentId, requested_at: now },
    { onConflict: "asset_id" },
  );
  if (status.error) throw unavailable();
  return { ok: true };
}

/**
 * Creates a probe and returns its token once, together with the ready-made
 * config.json. Only the SHA-256 of the token is stored.
 */
async function createAgent(admin: Client, tenantId: string, actorId: string, name: string) {
  const base = Deno.env.get("SUPABASE_URL");
  if (!base) throw unavailable();
  const id = crypto.randomUUID();
  const token = createAgentToken(id);
  const { error } = await admin.from("ipam_agents").insert({
    id,
    tenant_id: tenantId,
    name,
    token_hash: await sha256Hex(token),
    token_hint: tokenHint(token),
    // A probe created for monitoring measures sensors only. Without this the
    // defaults of the IP address management apply: a ping sweep of every
    // active subnet each hour. Discovery is switched on under IP-Adressen.
    config: { scanAllActive: false, prefixIds: [] },
    created_by: actorId,
  });
  if (error) {
    if (error.code === "23505") {
      throw new HttpError(409, "agent_exists", "Eine Sonde mit diesem Namen existiert bereits.");
    }
    throw unavailable();
  }
  return {
    agent: { id, name },
    config: probeConfig(`${base}/functions/v1`, token),
  };
}

async function requireAgent(admin: Client, tenantId: string, agentId: string): Promise<Row> {
  const { data, error } = await admin.from("ipam_agents").select("id, name, status")
    .eq("tenant_id", tenantId).eq("id", agentId).neq("status", "revoked").maybeSingle();
  if (error) throw unavailable();
  if (!data) throw new HttpError(404, "agent_not_found", "Die Sonde wurde nicht gefunden.");
  return data as Row;
}

/** Name of a probe and whether it is active (a deactivated probe is not served). */
async function updateAgent(admin: Client, tenantId: string, agentId: string, name: string, active: boolean) {
  await requireAgent(admin, tenantId, agentId);
  const { error } = await admin.from("ipam_agents")
    .update({ name, status: active ? "active" : "disabled", updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId).eq("id", agentId);
  if (error) {
    if (error.code === "23505") {
      throw new HttpError(409, "agent_exists", "Eine Sonde mit diesem Namen existiert bereits.");
    }
    throw unavailable();
  }
  return { ok: true };
}

/** New token for a probe; the old one stops working at once. Shown only here. */
async function rotateAgentToken(admin: Client, tenantId: string, agentId: string) {
  const agent = await requireAgent(admin, tenantId, agentId);
  const token = createAgentToken(agentId);
  const now = new Date().toISOString();
  const { error } = await admin.from("ipam_agents")
    .update({ token_hash: await sha256Hex(token), token_hint: tokenHint(token), token_rotated_at: now, updated_at: now })
    .eq("tenant_id", tenantId).eq("id", agentId);
  if (error) throw unavailable();
  return { agent: { id: agentId, name: String(agent.name) }, token };
}

/**
 * Removes a probe: its token is revoked. Its sensors move to another probe
 * or stay without one (then they are not measured until one is chosen).
 */
async function removeAgent(admin: Client, tenantId: string, agentId: string, moveSensorsTo: string | null) {
  await requireAgent(admin, tenantId, agentId);
  if (moveSensorsTo) {
    const target = await requireAgent(admin, tenantId, moveSensorsTo);
    if (target.status !== "active") {
      throw new HttpError(422, "agent_not_found", "Die Sonde für die Sensoren ist nicht aktiv.");
    }
  }
  const moved = await admin.from("monitoring_sensors")
    .update({ agent_id: moveSensorsTo, updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId).eq("agent_id", agentId).select("id");
  if (moved.error) throw unavailable();
  if (!moveSensorsTo) {
    // Nobody measures them any more: open alerts end, the state is unknown.
    for (const row of (moved.data ?? []) as Row[]) {
      await closeSensorAlert(admin, tenantId, String(row.id), "Sonde entfernt");
    }
  }
  const revoked = await admin.from("ipam_agents")
    .update({ status: "revoked", updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId).eq("id", agentId);
  if (revoked.error) throw unavailable();
  return { ok: true, sensors: (moved.data ?? []).length };
}

async function handle(admin: Client, client: Client, actorId: string, action: Action) {
  const features = await resolveTenantFeatureStates(admin, action.tenantId, [FEATURE]);
  if (!features) throw unavailable();
  if (features[FEATURE] !== true) {
    throw new HttpError(403, "feature_disabled", "Die Überwachung ist für diesen Mandanten nicht aktiviert.");
  }
  const canManage = await permission(client, action.tenantId, "asset.manage");
  if (!canManage && !(await permission(client, action.tenantId, "asset.read"))) {
    throw new HttpError(403, "forbidden", "Für die Überwachung fehlt die Berechtigung.");
  }
  const manage = () => {
    if (!canManage) throw new HttpError(403, "forbidden", "Zum Ändern von Sensoren fehlt die Berechtigung.");
  };
  switch (action.type) {
    case "overview":
      return await overview(admin, action.tenantId, canManage);
    case "summary":
      return await summary(admin, action.tenantId);
    case "deviceTicket":
      return await deviceTicket(admin, client, action.tenantId, actorId, action.assetId);
    case "device":
      return await device(admin, action.tenantId, action.assetId, canManage);
    case "series":
      return await series(admin, action.tenantId, action.sensorId, action.range);
    case "assets":
      manage();
      return await assetChoices(admin, action.tenantId, action.query);
    case "saveSensor":
      manage();
      return await saveSensor(admin, action.tenantId, actorId, action);
    case "deleteSensor": {
      manage();
      await closeSensorAlert(admin, action.tenantId, action.sensorId, "Sensor gelöscht");
      const removed = await admin.from("monitoring_sensors").delete().eq("tenant_id", action.tenantId).eq("id", action.sensorId);
      if (removed.error) throw unavailable();
      return { ok: true };
    }
    case "probePackage":
      manage();
      return await probePackage(admin);
    case "listInterfaces":
      manage();
      return await listInterfaces(admin, action.tenantId, actorId, action.assetId, action.agentId);
    case "interfaces":
      manage();
      return await interfaces(admin, action.tenantId, action.jobId);
    case "availability":
      return await availabilityOverview(admin, action.tenantId, action.range);
    case "events":
      return await eventsOverview(admin, action.tenantId, action.range);
    case "simulate":
      manage();
      return await simulate(admin, action.tenantId, action.assetId, action.sensorId, action.minutes);
    case "connections":
      return await connections(admin, action.tenantId, action.assetId, canManage);
    case "refreshConnections":
      manage();
      return await refreshConnections(admin, action.tenantId, actorId, action.assetId);
    case "addDevice":
      manage();
      return await addDevice(admin, action.tenantId, actorId, action.device);
    case "createAgent":
      manage();
      return await createAgent(admin, action.tenantId, actorId, action.name);
    case "updateAgent":
      manage();
      return await updateAgent(admin, action.tenantId, action.agentId, action.name, action.active);
    case "rotateAgentToken":
      manage();
      return await rotateAgentToken(admin, action.tenantId, action.agentId);
    case "removeAgent":
      manage();
      return await removeAgent(admin, action.tenantId, action.agentId, action.moveSensorsTo);
    case "updateDevice":
      manage();
      return await updateDevice(admin, action.tenantId, actorId, action.assetId, action.device);
    case "removeDevice": {
      // Ends the monitoring of a device: its sensors and their history are
      // deleted, open alerts end. The device stays in the infrastructure.
      manage();
      const sensors = await admin.from("monitoring_sensors").select("id")
        .eq("tenant_id", action.tenantId).eq("asset_id", action.assetId);
      if (sensors.error) throw unavailable();
      for (const row of (sensors.data ?? []) as Row[]) {
        await closeSensorAlert(admin, action.tenantId, String(row.id), "Gerät aus der Überwachung entfernt");
      }
      const removed = await admin.from("monitoring_sensors").delete()
        .eq("tenant_id", action.tenantId).eq("asset_id", action.assetId);
      if (removed.error) throw unavailable();
      return { ok: true, sensors: (sensors.data ?? []).length };
    }
    case "pauseDevice":
      manage();
      return await setPause(admin, action.tenantId, actorId, {
        assetIds: [action.assetId], sensorIds: [], paused: action.paused, reason: action.reason,
      });
    case "pauseSensor":
      manage();
      return await setPause(admin, action.tenantId, actorId, {
        assetIds: [], sensorIds: [action.sensorId], paused: action.paused, reason: action.reason,
      });
    case "pauseMany":
      manage();
      return await setPause(admin, action.tenantId, actorId, action);
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
      if (!action || typeof action === "string") {
        return json(request, { error: { code: "invalid_request", message: action ?? "Die Anfrage ist ungültig." } }, 422);
      }
      const data = await handle(context.supabaseAdmin, context.supabase, actorId, action);
      return json(request, { data: data as Record<string, unknown> });
    } catch (error) {
      if (error instanceof HttpError) {
        return json(request, { error: { code: error.code, message: error.message } }, error.status);
      }
      console.error("monitoring_sensors_failed", error instanceof Error ? error.message : "");
      return json(request, { error: { code: "internal_error", message: "Die Überwachung ist gerade nicht verfügbar." } }, 500);
    }
  },
);

export default {
  fetch(request: Request): Response | Promise<Response> {
    if (request.method === "OPTIONS") return noContent(request);
    return handler(request);
  },
};
