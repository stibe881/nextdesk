import { withSupabase } from "@supabase/server";
import { isUuid, json, noContent } from "../_shared/http.ts";
import { createAgentToken, sha256Hex, tokenHint } from "../_shared/ipam-discovery.ts";
import { publicTarget } from "../_shared/monitoring-cloud.ts";
import { sensorKey } from "../_shared/monitoring-native.ts";
import { resolveTenantFeatureStates } from "../_shared/tenant-features.ts";
import { INTEGRATION_COLUMNS, processEvent } from "../monitoring-webhook/index.ts";
import {
  type Action,
  agentOnline,
  availability,
  bucketize,
  deviceState,
  type DisplayState,
  displayState,
  isOlderVersion,
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
    .select("id, asset_id, agent_id, kind, name, target, port, url, interval_seconds, timeout_ms, warning_above, warning_below, down_above, down_below, snmp_metric, snmp_oid, snmp_index, scale, unit, expect, cloud, failures_to_down, paused")
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
  return rows.map((row) => sensorView(row, statuses.get(String(row.id)), now));
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
    selectIn(admin, "asset_infrastructure", "asset_id, category, hostname, ip_address", tenantId, "asset_id", assetIds),
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
      hostname: text(infra?.hostname),
      ipAddress: text(infra?.ip_address),
      state: deviceState(own.map((sensor) => sensor.state)),
      counts,
      sensorCount: own.length,
      responseMs: primary && primary.state !== "unknown" && primary.state !== "down" ? primary.lastValue : null,
      lastCheckAt: own.map((sensor) => sensor.lastCheckAt).filter((value): value is string => !!value).sort().at(-1) ?? null,
      problem: problem
        ? { sensorId: problem.id, sensorName: problem.name, state: problem.state, since: problem.since, message: problem.lastMessage }
        : null,
      incident: incidents.get(id) ?? null,
    };
  }).sort((a, b) => rank[a.state] - rank[b.state] || a.name.localeCompare(b.name, "de"));
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
    admin.from("asset_infrastructure").select("category, hostname, ip_address, uplink_asset_id").eq("tenant_id", tenantId).eq("asset_id", assetId).maybeSingle(),
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
      hostname: text(infra.data?.hostname),
      ipAddress: text(infra.data?.ip_address),
      state: deviceState(sensors.map((sensor) => sensor.state)),
      services: services.map((row) => ({ id: String(row.id), name: String(row.name) })),
      uplink: uplink[0] ? { assetId: String(uplink[0].id), name: String(uplink[0].name) } : null,
      incident: incidents.get(assetId) ?? null,
    },
    sensors,
    agents,
    checkedAt: new Date().toISOString(),
  };
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

async function assetChoices(admin: Client, tenantId: string, query: string) {
  const columns = "asset_id, category, hostname, ip_address";
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
    assets: assets.flatMap((asset) => {
      if (asset.lifecycle_state === "retired" || asset.lifecycle_state === "disposed") return [];
      const row = rows.get(String(asset.id));
      return [{
        assetId: String(asset.id),
        name: String(asset.name),
        category: text(row?.category),
        hostname: text(row?.hostname),
        ipAddress: text(row?.ip_address),
        monitored: known.has(String(asset.id)),
      }];
    }).sort((x, y) => x.name.localeCompare(y.name, "de")).slice(0, 100),
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
    paused: sensor.paused,
    updated_at: new Date().toISOString(),
  };
  if (sensor.id) {
    const updated = await admin.from("monitoring_sensors").update(values)
      .eq("tenant_id", tenantId).eq("id", sensor.id).eq("asset_id", sensor.assetId).select("id").maybeSingle();
    if (updated.error) throw unavailable();
    if (!updated.data) throw new HttpError(404, "sensor_not_found", "Der Sensor wurde nicht gefunden.");
    if (sensor.paused) await closeSensorAlert(admin, tenantId, sensor.id, "Sensor pausiert");
    return { sensorId: sensor.id };
  }
  const count = await admin.from("monitoring_sensors").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("asset_id", sensor.assetId);
  if (count.error) throw unavailable();
  if ((count.count ?? 0) >= MAX_SENSORS_PER_DEVICE) {
    throw new HttpError(422, "too_many_sensors", `Ein Gerät kann höchstens ${MAX_SENSORS_PER_DEVICE} Sensoren haben.`);
  }
  const inserted = await admin.from("monitoring_sensors")
    .insert({ ...values, tenant_id: tenantId, asset_id: sensor.assetId, created_by: actorId }).select("id").single();
  if (inserted.error) throw unavailable();
  return { sensorId: String(inserted.data.id) };
}

/**
 * A sensor that is paused or deleted reports no «OK» any more. Its open
 * alert is ended through the incident logic (like an «OK» of the sensor), so
 * the service status is restored and the incident can resolve.
 */
async function closeSensorAlert(admin: Client, tenantId: string, sensorId: string, reason: string): Promise<void> {
  const key = sensorKey(sensorId);
  const open = await admin.from("monitoring_alerts").select("id, sensor_name, device_name")
    .eq("tenant_id", tenantId).eq("external_key", key).eq("state", "open").maybeSingle();
  if (open.error) throw unavailable();
  if (open.data) {
    const integration = await admin.from("monitoring_integrations").select(INTEGRATION_COLUMNS).eq("tenant_id", tenantId).maybeSingle();
    if (integration.error || !integration.data) throw unavailable();
    await processEvent(admin, integration.data, {
      device: text(open.data.device_name),
      host: null,
      sensor: text(open.data.sensor_name),
      status: "OK",
      kind: "up",
      message: reason,
      objectId: null,
      sensorId: null,
      deviceId: null,
      lastValue: null,
      dateTime: null,
      group: null,
      probe: null,
      down: null,
      priority: null,
      link: null,
      origin: "sensor",
    }, new Date(), { key, device: null });
  }
  await admin.from("monitoring_sensor_status")
    .update({ state: "unknown", consecutive_failures: 0, since: new Date().toISOString() })
    .eq("tenant_id", tenantId).eq("sensor_id", sensorId);
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
    case "createAgent":
      manage();
      return await createAgent(admin, action.tenantId, actorId, action.name);
    case "pauseDevice": {
      manage();
      const updated = await admin.from("monitoring_sensors")
        .update({ paused: action.paused, updated_at: new Date().toISOString() })
        .eq("tenant_id", action.tenantId).eq("asset_id", action.assetId).select("id");
      if (updated.error) throw unavailable();
      if (action.paused) {
        for (const row of (updated.data ?? []) as Row[]) {
          await closeSensorAlert(admin, action.tenantId, String(row.id), "Überwachung des Geräts pausiert");
        }
      }
      return { ok: true, sensors: (updated.data ?? []).length };
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
