import { withSupabase } from "@supabase/server";
import {
  buildEvent,
  candidateObjectIds,
  classifyStatus,
  type DeviceCandidate,
  externalKey,
  MAX_BODY_BYTES,
  opensAlert,
  parseBody,
  parseQuery,
  type PrtgEvent,
  type ServiceStatus,
  shouldComment,
  targetServiceStatus,
  TOKEN_PATTERN,
} from "./prtg.ts";
import { shortSensorName } from "./prtg-text.ts";

/**
 * PRTG monitoring webhook («Execute HTTP Action»).
 *
 * - Deploy with `[functions.monitoring-webhook] verify_jwt = false`: PRTG
 *   cannot send a Supabase JWT. The caller authenticates with the per-tenant
 *   token (`?token=…` or header `x-nextdesk-token`), which is stored only as
 *   SHA-256 hash in `monitoring_integrations.token_hash`.
 * - Down (and Warning if configured) opens an alert per sensor and an
 *   incident («Störung») per device. No tickets are created: everything is
 *   handled in the «Störungen» module. Devices behind a failed device (uplinks
 *   in the infrastructure) become follow-up incidents without own alert. Up
 *   resolves the alert, sets the incident to «resolved» once all its sensors
 *   are OK again (an agent closes it with a cause) and restores the service
 *   status.
 * - Device, services and uplink chain come from one SQL resolver
 *   (monitoring_resolve_device), shared with the incidents function.
 */

// deno-lint-ignore no-explicit-any
type Admin = any;
type Row = Record<string, unknown>;

type Integration = {
  id: string;
  tenant_id: string;
  enabled: boolean;
  team_id: string | null;
  create_on: "down" | "down_and_warning";
  set_service_status: boolean;
  group_dependencies: boolean;
  suppress_in_maintenance: boolean;
};

/** A resolved device with its uplink chain (nearest first, at most 20). */
export type ResolvedDevice = DeviceCandidate & { uplinks: string[] };

/** Settings the webhook reads (no ticket settings: incidents have none). */
export const INTEGRATION_COLUMNS =
  "id, tenant_id, enabled, team_id, create_on, set_service_status, group_dependencies, suppress_in_maintenance";

type Alert = {
  id: string;
  incident_id: string | null;
  ticket_id: string | null;
  service_id: string | null;
  service_ids: string[] | null;
  service_statuses: Record<string, string> | null;
  asset_id: string | null;
  last_status: string | null;
  last_comment_at: string | null;
  opened_at: string;
  event_count: number;
  service_status_applied: "degraded" | "partial_outage" | null;
};

/** A device that is OK again and fails within this time reopens its incident. */
const REOPEN_WINDOW_MS = 10 * 60 * 1000;
const encoder = new TextEncoder();

function reply(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", encoder.encode(value)),
  );
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

/** Parses the result of the SQL function monitoring_resolve_device. */
export function parseResolvedDevice(value: unknown): ResolvedDevice | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const row = value as Row;
  const assetId = asString(row.assetId);
  if (!assetId) return null;
  return {
    assetId,
    name: asString(row.name) ?? "",
    hostname: asString(row.hostname),
    ipAddress: asString(row.ipAddress),
    prtgObjectId: asString(row.prtgObjectId),
    serviceIds: stringList(row.serviceIds),
    uplinks: stringList(row.uplinks),
  };
}

/**
 * The device of a message, resolved in SQL (PRTG object id, host, name, IP
 * address management) with its services and uplink chain: only the rows
 * needed, not the whole inventory of the tenant.
 */
async function resolveDevice(
  admin: Admin,
  tenantId: string,
  event: PrtgEvent,
): Promise<ResolvedDevice | null> {
  const { data, error } = await admin.rpc("monitoring_resolve_device", {
    p_tenant_id: tenantId,
    p_object_ids: candidateObjectIds(event),
    p_host: event.host,
    p_name: event.device,
  });
  if (error) throw new Error("device_lookup_failed");
  return parseResolvedDevice(data);
}

async function applyServiceStatus(
  admin: Admin,
  tenantId: string,
  serviceId: string,
  kind: PrtgEvent["kind"],
): Promise<"degraded" | "partial_outage" | null> {
  const { data, error } = await admin
    .from("services")
    .select("status")
    .eq("tenant_id", tenantId)
    .eq("id", serviceId)
    .maybeSingle();
  if (error || !data) return null;
  const target = targetServiceStatus(kind, data.status as ServiceStatus);
  if (!target) return null;
  // The services_status_history trigger records the status event.
  const updated = await admin
    .from("services")
    .update({ status: target })
    .eq("tenant_id", tenantId)
    .eq("id", serviceId)
    .eq("status", data.status);
  return updated.error ? null : target;
}

/** Services of an alert: the stored list, else the legacy single service. */
function alertServiceIds(alert: Alert): string[] {
  const ids = alert.service_ids ?? [];
  return ids.length ? ids : alert.service_id ? [alert.service_id] : [];
}

/** Status monitoring applied per service; the legacy single value is kept. */
function alertServiceStatuses(alert: Alert): Record<string, string> {
  const stored = alert.service_statuses ?? {};
  if (Object.keys(stored).length) return { ...stored };
  return alert.service_id && alert.service_status_applied
    ? { [alert.service_id]: alert.service_status_applied }
    : {};
}

async function applyServiceStatuses(
  admin: Admin,
  tenantId: string,
  serviceIds: string[],
  kind: PrtgEvent["kind"],
  current: Record<string, string>,
): Promise<Record<string, string>> {
  const next = { ...current };
  for (const serviceId of serviceIds) {
    const applied = await applyServiceStatus(admin, tenantId, serviceId, kind);
    if (applied) next[serviceId] = applied;
  }
  return next;
}

async function restoreServiceStatus(
  admin: Admin,
  tenantId: string,
  serviceId: string,
  resolvedAlertId: string,
): Promise<void> {
  const others = await admin
    .from("monitoring_alerts")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("state", "open")
    .not(`service_statuses->>${serviceId}`, "is", null)
    .neq("id", resolvedAlertId)
    .limit(1);
  if (others.error || (others.data ?? []).length > 0) return;
  // Only undo what monitoring set; manual outages and maintenance stay.
  await admin
    .from("services")
    .update({ status: "operational" })
    .eq("tenant_id", tenantId)
    .eq("id", serviceId)
    .in("status", ["degraded", "partial_outage"]);
}

async function findOpenAlert(
  admin: Admin,
  tenantId: string,
  key: string,
): Promise<Alert | null> {
  const { data, error } = await admin
    .from("monitoring_alerts")
    .select(
      "id, incident_id, ticket_id, service_id, service_ids, service_statuses, asset_id, last_status, last_comment_at, opened_at, event_count, service_status_applied",
    )
    .eq("tenant_id", tenantId)
    .eq("external_key", key)
    .eq("state", "open")
    .maybeSingle();
  if (error) throw new Error("alert_lookup_failed");
  return (data as Alert | null) ?? null;
}

type Incident = {
  id: string;
  number: string;
  severity: "down" | "warning";
  state: "active" | "resolved" | "closed";
  parent_incident_id: string | null;
  maintenance: boolean;
};

const INCIDENT_COLUMNS =
  "id, number, severity, state, parent_incident_id, maintenance";

function incidentKey(event: PrtgEvent, device: ResolvedDevice | null, key: string): string {
  if (device) return `asset:${device.assetId}`;
  return `dev:${(event.device ?? event.host ?? key).toLowerCase()}`.slice(0, 300);
}

function incidentTitle(event: PrtgEvent, device: ResolvedDevice | null): string {
  const name = device?.name ?? event.device ?? event.host ?? "Unbekanntes Gerät";
  // Without the sensor type PRTG appends in brackets («Ping (Ping)»).
  const sensorName = shortSensorName(event.sensor);
  const sensor = sensorName ? ` – ${sensorName}` : "";
  const title = `${name}${sensor}`.replace(/\s+/g, " ").trim();
  return title.length > 300 ? `${title.slice(0, 299)}…` : title;
}

async function addIncidentEvent(
  admin: Admin,
  tenantId: string,
  incidentId: string,
  kind: string,
  event: PrtgEvent | null,
  message?: string | null,
): Promise<void> {
  await admin.from("monitoring_incident_events").insert({
    tenant_id: tenantId,
    incident_id: incidentId,
    kind,
    status: event?.status?.slice(0, 120) ?? null,
    sensor_name: event?.sensor?.slice(0, 300) ?? null,
    message: (message ?? event?.message ?? null)?.slice(0, 4000) ?? null,
  });
}

async function notifyIncident(
  admin: Admin,
  incident: Incident,
  reason: string,
): Promise<void> {
  if (incident.parent_incident_id || incident.maintenance) return;
  await admin.rpc("monitoring_incident_notify", {
    p_incident_id: incident.id,
    p_reason: reason,
  });
}

/** Devices behind a device (their uplink chain contains it). */
async function downstreamAssets(
  admin: Admin,
  tenantId: string,
  assetId: string,
): Promise<string[]> {
  const { data, error } = await admin.rpc("monitoring_downstream_assets", {
    p_tenant_id: tenantId,
    p_asset_id: assetId,
  });
  return error ? [] : stringList(data);
}

async function inMaintenance(
  admin: Admin,
  tenantId: string,
  serviceIds: string[],
): Promise<boolean> {
  if (!serviceIds.length) return false;
  const { data } = await admin
    .from("services")
    .select("id")
    .eq("tenant_id", tenantId)
    .in("id", serviceIds)
    .eq("status", "maintenance")
    .limit(1);
  return ((data ?? []) as Row[]).length > 0;
}

/**
 * The incident of a device: the active one, a just resolved one (reopened)
 * or a new one. New incidents behind a failed device become follow-ups;
 * failed devices behind a new incident become its follow-ups.
 */
async function incidentForAlert(
  admin: Admin,
  integration: Integration,
  event: PrtgEvent,
  device: ResolvedDevice | null,
  key: string,
  now: Date,
): Promise<{ incident: Incident; created: boolean }> {
  const tenantId = integration.tenant_id;
  const deviceKey = incidentKey(event, device, key);
  const severity: "down" | "warning" = event.kind === "down" ? "down" : "warning";

  const active = await admin
    .from("monitoring_incidents")
    .select(INCIDENT_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("incident_key", deviceKey)
    .eq("state", "active")
    .maybeSingle();
  if (active.data) {
    const incident = active.data as Incident;
    await addIncidentEvent(admin, tenantId, incident.id, "prtg", event);
    if (severity === "down" && incident.severity === "warning") {
      await admin.from("monitoring_incidents").update({ severity: "down" }).eq("id", incident.id);
      incident.severity = "down";
      await notifyIncident(admin, incident, "escalated");
    }
    await admin
      .from("monitoring_incidents")
      .update({ last_event_at: now.toISOString() })
      .eq("id", incident.id);
    return { incident, created: false };
  }

  // Flapping: OK for a few minutes only, then down again → same incident.
  const recent = await admin
    .from("monitoring_incidents")
    .select(INCIDENT_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("incident_key", deviceKey)
    // Resolved by an «Up» (before 0311: closed automatically), never one an
    // agent closed.
    .in("state", ["resolved", "closed"])
    .is("closed_by", null)
    .gte("resolved_at", new Date(now.getTime() - REOPEN_WINDOW_MS).toISOString())
    .order("resolved_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (recent.data) {
    const incident = recent.data as Incident;
    const reopened = await admin
      .from("monitoring_incidents")
      .update({
        state: "active",
        resolved_at: null,
        closed_at: null,
        closing_note: null,
        severity,
        last_event_at: now.toISOString(),
      })
      .eq("id", incident.id)
      .in("state", ["resolved", "closed"])
      .is("closed_by", null)
      .select(INCIDENT_COLUMNS)
      .maybeSingle();
    if (reopened.data) {
      const current = reopened.data as Incident;
      await addIncidentEvent(admin, tenantId, current.id, "reopened", event,
        "Nach kurzer Erholung erneut gestört.");
      await notifyIncident(admin, current, "reopened");
      return { incident: current, created: false };
    }
  }

  const grouping = integration.group_dependencies && device !== null;
  let parent: { id: string; number: string } | null = null;
  if (device && grouping) {
    const ancestors = device.uplinks;
    if (ancestors.length) {
      const { data } = await admin
        .from("monitoring_incidents")
        .select("id, number, incident_key")
        .eq("tenant_id", tenantId)
        .eq("state", "active")
        .in("incident_key", ancestors.map((id) => `asset:${id}`));
      const byKey = new Map(((data ?? []) as Row[]).map((row) => [String(row.incident_key), row]));
      for (const ancestor of ancestors) {
        const found = byKey.get(`asset:${ancestor}`);
        if (found) {
          // Follow the chain to the root cause.
          parent = { id: String(found.id), number: String(found.number) };
          break;
        }
      }
    }
  }
  const maintenance = integration.suppress_in_maintenance &&
    await inMaintenance(admin, tenantId, device?.serviceIds ?? []);
  const number = await admin.rpc("monitoring_next_incident_number", { p_tenant_id: tenantId });
  if (number.error || typeof number.data !== "string") throw new Error("incident_number_failed");
  const inserted = await admin
    .from("monitoring_incidents")
    .insert({
      tenant_id: tenantId,
      number: number.data,
      incident_key: deviceKey,
      asset_id: device?.assetId ?? null,
      device_name: device?.name ?? event.device ?? event.host,
      title: incidentTitle(event, device),
      severity,
      state: "active",
      parent_incident_id: parent?.id ?? null,
      team_id: integration.team_id,
      service_ids: device?.serviceIds ?? [],
      maintenance,
      opened_at: now.toISOString(),
      last_event_at: now.toISOString(),
    })
    .select(INCIDENT_COLUMNS)
    .single();
  if (inserted.error) {
    // A concurrent message of the same device created it first.
    if (inserted.error.code === "23505") {
      const again = await admin
        .from("monitoring_incidents")
        .select(INCIDENT_COLUMNS)
        .eq("tenant_id", tenantId)
        .eq("incident_key", deviceKey)
        .eq("state", "active")
        .maybeSingle();
      if (again.data) return { incident: again.data as Incident, created: false };
    }
    throw new Error("incident_create_failed");
  }
  const incident = inserted.data as Incident;
  await addIncidentEvent(admin, tenantId, incident.id, "opened", event);
  if (parent) {
    await addIncidentEvent(admin, tenantId, incident.id, "child", null,
      `Folgestörung von ${parent.number}: das vorgelagerte Gerät ist gestört.`);
  }
  if (maintenance) {
    await addIncidentEvent(admin, tenantId, incident.id, "maintenance", null,
      "Betroffener Dienst ist in Wartung: keine Alarmierung.");
  }
  await notifyIncident(admin, incident, "opened");

  // Devices behind this one that already failed become its follow-ups.
  if (device && grouping && !parent) {
    const descendants = await downstreamAssets(admin, tenantId, device.assetId);
    if (descendants.length) {
      const { data } = await admin
        .from("monitoring_incidents")
        .update({ parent_incident_id: incident.id })
        .eq("tenant_id", tenantId)
        .eq("state", "active")
        .is("parent_incident_id", null)
        .is("acknowledged_at", null)
        .in("incident_key", descendants.map((id) => `asset:${id}`))
        .select("id");
      for (const row of (data ?? []) as Row[]) {
        await addIncidentEvent(admin, tenantId, String(row.id), "child", null,
          `Folgestörung von ${incident.number}: das vorgelagerte Gerät ist gestört.`);
      }
    }
  }
  return { incident, created: true };
}

async function resolveIncidentIfClear(
  admin: Admin,
  tenantId: string,
  incidentId: string,
  event: PrtgEvent,
  now: Date,
): Promise<boolean> {
  await addIncidentEvent(admin, tenantId, incidentId, "prtg", event);
  const open = await admin
    .from("monitoring_alerts")
    .select("id")
    .eq("incident_id", incidentId)
    .eq("state", "open")
    .limit(1);
  if (open.error || ((open.data ?? []) as Row[]).length > 0) return false;
  const updated = await admin
    .from("monitoring_incidents")
    // Back to OK: closed automatically, nobody has to confirm or close it.
    // The cause can be added afterwards (incidents «close» on a closed one).
    .update({
      state: "closed",
      resolved_at: now.toISOString(),
      closed_at: now.toISOString(),
      closing_note: "Automatisch abgeschlossen: PRTG meldet wieder OK.",
      last_event_at: now.toISOString(),
    })
    .eq("id", incidentId)
    .eq("state", "active")
    .select("id");
  if (((updated.data ?? []) as Row[]).length) {
    await addIncidentEvent(admin, tenantId, incidentId, "resolved", null,
      "PRTG meldet alle Sensoren wieder OK. Störung automatisch abgeschlossen.");
    return true;
  }
  return false;
}

/**
 * Records the message as the sensor's latest state. False when a newer
 * message for the same sensor was already received (PRTG bursts are handled
 * in parallel, so an older «Fehler» can come after its «OK»).
 */
async function recordSensorState(
  admin: Admin,
  tenantId: string,
  key: string,
  event: PrtgEvent,
  receivedAt: Date,
): Promise<boolean> {
  const { data, error } = await admin.rpc("monitoring_record_sensor_state", {
    p_tenant_id: tenantId,
    p_external_key: key,
    p_kind: event.kind,
    p_status: event.status,
    p_received_at: receivedAt.toISOString(),
  });
  // Without the record the message is still handled.
  return error ? true : data !== false;
}

async function latestSensorKind(admin: Admin, tenantId: string, key: string) {
  const { data } = await admin
    .from("monitoring_sensor_states")
    .select("kind")
    .eq("tenant_id", tenantId)
    .eq("external_key", key)
    .maybeSingle();
  return typeof data?.kind === "string" ? data.kind : null;
}

async function resolveAlert(
  admin: Admin,
  tenantId: string,
  alert: Alert,
  event: PrtgEvent,
  now: Date,
) {
  await admin
    .from("monitoring_alerts")
    .update({
      state: "resolved",
      resolved_at: now.toISOString(),
      last_status: event.status.slice(0, 80),
      last_message: event.message,
      last_event_at: now.toISOString(),
      last_comment_at: now.toISOString(),
      event_count: alert.event_count + 1,
    })
    .eq("id", alert.id)
    .eq("state", "open");
  for (const serviceId of Object.keys(alertServiceStatuses(alert))) {
    await restoreServiceStatus(admin, tenantId, serviceId, alert.id);
  }
  if (alert.incident_id) {
    await resolveIncidentIfClear(admin, tenantId, alert.incident_id, event, now);
  }
}

/**
 * After a «Fehler» was handled: an «OK» for the same sensor may have been
 * handled meanwhile (and found no open alert yet). Then close it now.
 */
async function settleAfterDown(
  admin: Admin,
  tenantId: string,
  key: string,
  incidentId: string,
  event: PrtgEvent,
  now: Date,
) {
  if ((await latestSensorKind(admin, tenantId, key)) === "up") {
    const open = await findOpenAlert(admin, tenantId, key);
    if (open) {
      await resolveAlert(admin, tenantId, open, {
        ...event,
        kind: "up",
        status: "OK",
        message: "Die OK-Meldung von PRTG kam vor dem Fehler an.",
      }, now);
      return;
    }
  }
  // The alert was resolved before it was linked to the incident.
  const stillOpen = await admin
    .from("monitoring_alerts")
    .select("id")
    .eq("incident_id", incidentId)
    .eq("state", "open")
    .limit(1);
  if (!stillOpen.error && ((stillOpen.data ?? []) as Row[]).length === 0) {
    await admin
      .from("monitoring_incidents")
      .update({
        state: "closed",
        resolved_at: now.toISOString(),
        closed_at: now.toISOString(),
        closing_note: "Automatisch abgeschlossen: PRTG meldet wieder OK.",
      })
      .eq("id", incidentId)
      .eq("state", "active");
  }
}

export async function processEvent(
  admin: Admin,
  integration: Integration,
  event: PrtgEvent,
  receivedAt: Date = new Date(),
): Promise<string> {
  if (event.kind === "ignore") return "ignored";
  const tenantId = integration.tenant_id;
  const key = externalKey(event);
  const now = new Date();
  if (!(await recordSensorState(admin, tenantId, key, event, receivedAt))) {
    return "stale";
  }
  let alert = await findOpenAlert(admin, tenantId, key);

  if (!alert) {
    if (!opensAlert(event.kind, integration.create_on)) return "ignored";
    const device = await resolveDevice(admin, tenantId, event);
    // The alert is claimed first: the partial unique index makes a second,
    // concurrent Down for the same object fall through to the update path.
    const inserted = await admin
      .from("monitoring_alerts")
      .insert({
        tenant_id: tenantId,
        integration_id: integration.id,
        external_key: key,
        device_name: event.device ?? event.host,
        sensor_name: event.sensor,
        asset_id: device?.assetId ?? null,
        service_id: device?.serviceIds[0] ?? null,
        service_ids: device?.serviceIds ?? [],
        state: "open",
        last_status: event.status.slice(0, 80),
        last_message: event.message,
        opened_at: now.toISOString(),
        last_event_at: now.toISOString(),
        last_comment_at: now.toISOString(),
      })
      .select("id")
      .single();
    if (inserted.error) {
      if (inserted.error.code !== "23505") throw new Error("alert_create_failed");
      alert = await findOpenAlert(admin, tenantId, key);
      if (!alert) return "ignored";
    } else {
      const alertId = String(inserted.data.id);
      let incident: { incident: Incident; created: boolean };
      try {
        incident = await incidentForAlert(admin, integration, event, device, key, now);
      } catch (failure) {
        // Release the claim so the next message retries.
        await admin
          .from("monitoring_alerts")
          .update({ state: "resolved", resolved_at: now.toISOString() })
          .eq("id", alertId);
        throw failure;
      }
      const statuses = integration.set_service_status
        ? await applyServiceStatuses(admin, tenantId, device?.serviceIds ?? [], event.kind, {})
        : {};
      await admin
        .from("monitoring_alerts")
        .update({
          incident_id: incident.incident.id,
          service_statuses: statuses,
          service_status_applied: Object.values(statuses)[0] ?? null,
        })
        .eq("id", alertId);
      await settleAfterDown(admin, tenantId, key, incident.incident.id, event, now);
      return incident.created ? "incident_opened" : "incident_updated";
    }
  }

  if (event.kind === "up") {
    await resolveAlert(admin, tenantId, alert, event, now);
    return "resolved";
  }

  // Older open alerts without an incident get one now.
  if (!alert.incident_id) {
    const device = await resolveDevice(admin, tenantId, event);
    const incident = await incidentForAlert(admin, integration, event, device, key, now);
    alert.incident_id = incident.incident.id;
    await admin.from("monitoring_alerts").update({ incident_id: alert.incident_id }).eq("id", alert.id);
  }

  const previousKind = classifyStatus(alert.last_status);
  const logged = shouldComment({
    lastCommentAt: alert.last_comment_at,
    openedAt: alert.opened_at,
    previousKind,
    kind: event.kind,
    now: now.getTime(),
  });
  if (logged) {
    await addIncidentEvent(admin, tenantId, alert.incident_id, "prtg", event);
  }
  if (event.kind === "down" && previousKind === "warning") {
    const { data } = await admin
      .from("monitoring_incidents")
      .update({ severity: "down" })
      .eq("id", alert.incident_id)
      .eq("severity", "warning")
      .eq("state", "active")
      .select(INCIDENT_COLUMNS)
      .maybeSingle();
    if (data) await notifyIncident(admin, data as Incident, "escalated");
  }
  await admin
    .from("monitoring_incidents")
    .update({ last_event_at: now.toISOString() })
    .eq("id", alert.incident_id);
  let statuses = alertServiceStatuses(alert);
  if (integration.set_service_status) {
    statuses = await applyServiceStatuses(admin, tenantId, alertServiceIds(alert), event.kind, statuses);
  }
  await admin
    .from("monitoring_alerts")
    .update({
      last_status: event.status.slice(0, 80),
      last_message: event.message,
      last_event_at: now.toISOString(),
      event_count: alert.event_count + 1,
      service_statuses: statuses,
      service_status_applied: Object.values(statuses)[0] ?? null,
      ...(logged ? { last_comment_at: now.toISOString() } : {}),
    })
    .eq("id", alert.id);
  return "updated";
}

function runInBackground(work: Promise<unknown>): boolean {
  // deno-lint-ignore no-explicit-any
  const runtime = (globalThis as any).EdgeRuntime;
  if (runtime && typeof runtime.waitUntil === "function") {
    runtime.waitUntil(work);
    return true;
  }
  return false;
}

const handler = withSupabase(
  { auth: "none", cors: "disabled" },
  async (request, context) => {
    // Order of arrival decides which message is the newest per sensor.
    const receivedAt = new Date();
    if (request.method !== "POST" && request.method !== "GET") {
      return new Response(null, {
        status: 405,
        headers: { Allow: "GET, POST" },
      });
    }
    const url = new URL(request.url);
    const token =
      request.headers.get("x-nextdesk-token")?.trim() ||
      url.searchParams.get("token")?.trim() ||
      "";
    if (!TOKEN_PATTERN.test(token)) {
      return reply({ ok: false, error: "unauthorized" }, 401);
    }
    const length = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(length) && length > MAX_BODY_BYTES) {
      return reply({ ok: false, error: "payload_too_large" }, 413);
    }
    const body =
      request.method === "POST" ? await request.text().catch(() => null) : "";
    if (body === null || encoder.encode(body).length > MAX_BODY_BYTES) {
      return reply({ ok: false, error: "payload_too_large" }, 413);
    }

    const admin = context.supabaseAdmin;
    const { data: integration, error } = await admin
      .from("monitoring_integrations")
      .select(INTEGRATION_COLUMNS)
      .eq("token_hash", await sha256Hex(token))
      .maybeSingle();
    if (error) return reply({ ok: false, error: "unavailable" }, 503);
    if (!integration) return reply({ ok: false, error: "unauthorized" }, 401);

    const fields = parseBody(body, request.headers.get("content-type"));
    const event = fields ? buildEvent(parseQuery(url), fields) : null;
    if (!event) return reply({ ok: false, error: "unusable_payload" }, 422);
    if (!(integration as Integration).enabled) {
      return reply({ ok: true, ignored: "disabled" });
    }

    await admin
      .from("monitoring_integrations")
      .update({ last_received_at: new Date().toISOString() })
      .eq("id", integration.id);

    const work = processEvent(admin, integration as Integration, event, receivedAt).catch(
      (failure) => {
        console.error(
          "monitoring_webhook_failed",
          failure instanceof Error ? failure.message : typeof failure,
        );
        return "failed";
      },
    );
    if (runInBackground(work)) return reply({ ok: true });
    const result = await work;
    return result === "failed"
      ? reply({ ok: false, error: "processing_failed" }, 500)
      : reply({ ok: true, result });
  },
);

export default { fetch: handler };
