// Pausing sensors of nextDesk's own monitoring: closing the open alert of a
// paused sensor, and pausing the devices of a maintenance window for its
// duration (run each minute by the cron path of «ipam-agent»).

import { sensorKey } from "./monitoring-native.ts";
import { INTEGRATION_COLUMNS, processEvent } from "../monitoring-webhook/index.ts";

// deno-lint-ignore no-explicit-any
type Client = any;
type Row = Record<string, unknown>;

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value : null;

/**
 * A sensor that is paused or deleted reports no «OK» any more. Its open
 * alert is ended through the incident logic (like an «OK» of the sensor), so
 * the service status is restored and the incident can resolve.
 */
export async function closeSensorAlert(
  admin: Client,
  tenantId: string,
  sensorId: string,
  reason: string,
): Promise<void> {
  const key = sensorKey(sensorId);
  const open = await admin.from("monitoring_alerts").select("id, sensor_name, device_name")
    .eq("tenant_id", tenantId).eq("external_key", key).eq("state", "open").maybeSingle();
  if (open.error) throw new Error("monitoring_alert_lookup_failed");
  if (open.data) {
    const integration = await admin.from("monitoring_integrations").select(INTEGRATION_COLUMNS)
      .eq("tenant_id", tenantId).maybeSingle();
    if (integration.error || !integration.data) throw new Error("monitoring_integration_missing");
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

/** Reason stored on sensors paused by a maintenance window. */
export function maintenancePauseReason(title: unknown): string {
  const name = (text(title) ?? "Wartung").replace(/\s+/g, " ").trim().slice(0, 240);
  return `Wartungsfenster «${name}» (automatisch)`;
}

/** A window is over when its time ran out, it was ended or it was deleted. */
export function maintenanceOver(window: Row | null | undefined, nowIso: string): boolean {
  if (!window) return true;
  if (["completed", "cancelled"].includes(String(window.state))) return true;
  return new Date(String(window.ends_at)).getTime() <= new Date(nowIso).getTime();
}

/**
 * Pauses the sensors of the devices of running maintenance windows and
 * resumes them when the window ends (time over, completed or cancelled).
 * Sensors that were already paused by hand are left alone, and a sensor that
 * someone paused again with another reason during the window stays paused.
 */
export async function maintenancePauses(admin: Client, now = new Date()): Promise<Record<string, number>> {
  const nowIso = now.toISOString();
  let paused = 0;
  let resumed = 0;

  // Start: running windows with devices.
  const windows = await admin.from("service_status_maintenances")
    .select("id, tenant_id, title, created_by, updated_by")
    .in("state", ["scheduled", "active"]).lte("starts_at", nowIso).gt("ends_at", nowIso)
    .limit(200);
  if (windows.error) throw new Error("maintenance_lookup_failed");
  for (const window of (windows.data ?? []) as Row[]) {
    const tenantId = String(window.tenant_id);
    const maintenanceId = String(window.id);
    const links = await admin.from("service_status_maintenance_assets").select("asset_id")
      .eq("tenant_id", tenantId).eq("maintenance_id", maintenanceId);
    if (links.error) throw new Error("maintenance_assets_failed");
    const assetIds = ((links.data ?? []) as Row[]).map((row) => String(row.asset_id));
    if (!assetIds.length) continue;
    const [sensors, done] = await Promise.all([
      admin.from("monitoring_sensors").select("id, asset_id, paused")
        .eq("tenant_id", tenantId).in("asset_id", assetIds),
      admin.from("monitoring_maintenance_pauses").select("sensor_id")
        .eq("maintenance_id", maintenanceId),
    ]);
    if (sensors.error || done.error) throw new Error("maintenance_sensors_failed");
    const recorded = new Set(((done.data ?? []) as Row[]).map((row) => String(row.sensor_id)));
    const todo = ((sensors.data ?? []) as Row[])
      .filter((row) => row.paused !== true && !recorded.has(String(row.id)));
    if (!todo.length) continue;
    const reason = maintenancePauseReason(window.title);
    const actor = text(window.updated_by) ?? text(window.created_by);
    const ids = todo.map((row) => String(row.id));
    const update = await admin.from("monitoring_sensors").update({
      paused: true,
      paused_reason: reason,
      paused_by: actor,
      paused_at: nowIso,
      updated_at: nowIso,
    }).eq("tenant_id", tenantId).in("id", ids).eq("paused", false).select("id");
    if (update.error) throw new Error("maintenance_pause_failed");
    const changed = new Set(((update.data ?? []) as Row[]).map((row) => String(row.id)));
    if (!changed.size) continue;
    await admin.from("monitoring_maintenance_pauses").insert([...changed].map((sensorId) => ({
      tenant_id: tenantId,
      maintenance_id: maintenanceId,
      sensor_id: sensorId,
      reason,
      paused_at: nowIso,
    })));
    for (const sensorId of changed) {
      try {
        await closeSensorAlert(admin, tenantId, sensorId, reason);
      } catch (failure) {
        console.error("maintenance_close_alert_failed", failure instanceof Error ? failure.message : "");
      }
    }
    const devices = [...new Set(todo.filter((row) => changed.has(String(row.id))).map((row) => String(row.asset_id)))];
    const names = await admin.from("assets").select("id, name").eq("tenant_id", tenantId).in("id", devices);
    const nameOf = new Map(((names.data ?? []) as Row[]).map((row) => [String(row.id), String(row.name)]));
    await admin.from("monitoring_sensor_activity").insert(devices.map((assetId) => ({
      tenant_id: tenantId,
      asset_id: assetId,
      sensor_id: null,
      device_name: nameOf.get(assetId) ?? "",
      action: "paused",
      reason,
      actor_id: null,
    })));
    paused += changed.size;
  }

  // End: pauses of windows that are over (or deleted).
  const open = await admin.from("monitoring_maintenance_pauses")
    .select("id, maintenance_id, sensor_id, tenant_id, reason, service_status_maintenances(state, ends_at)")
    .is("resumed_at", null).limit(1000);
  if (open.error) throw new Error("maintenance_pauses_failed");
  const rows = (open.data ?? []) as Row[];
  const finished = rows.filter((row) => maintenanceOver(row.service_status_maintenances as Row | null, nowIso));
  const resumedDevices = new Map<string, Set<string>>();
  for (const row of finished) {
    const tenantId = String(row.tenant_id);
    const sensorId = String(row.sensor_id);
    {
      // Only a pause that is still the one of this window is resumed: a
      // sensor paused again by hand (another reason) stays paused.
      const update = await admin.from("monitoring_sensors").update({
        paused: false,
        paused_reason: null,
        paused_by: null,
        paused_at: null,
        updated_at: nowIso,
      }).eq("tenant_id", tenantId).eq("id", sensorId).eq("paused", true)
        .eq("paused_reason", String(row.reason)).select("asset_id");
      if (update.error) throw new Error("maintenance_resume_failed");
      for (const sensor of (update.data ?? []) as Row[]) {
        const set = resumedDevices.get(tenantId) ?? new Set<string>();
        set.add(String(sensor.asset_id));
        resumedDevices.set(tenantId, set);
        resumed += 1;
      }
    }
    await admin.from("monitoring_maintenance_pauses").update({ resumed_at: nowIso }).eq("id", String(row.id));
  }
  for (const [tenantId, devices] of resumedDevices) {
    const names = await admin.from("assets").select("id, name").eq("tenant_id", tenantId).in("id", [...devices]);
    const nameOf = new Map(((names.data ?? []) as Row[]).map((row) => [String(row.id), String(row.name)]));
    await admin.from("monitoring_sensor_activity").insert([...devices].map((assetId) => ({
      tenant_id: tenantId,
      asset_id: assetId,
      sensor_id: null,
      device_name: nameOf.get(assetId) ?? "",
      action: "resumed",
      reason: "Wartungsfenster beendet (automatisch)",
      actor_id: null,
    })));
  }
  return { maintenancePaused: paused, maintenanceResumed: resumed };
}
