import { withSupabase } from "@supabase/server";
import { isRecord, isUuid, json, noContent } from "../_shared/http.ts";
import { resolveUserFeatureStates } from "../_shared/tenant-features.ts";

/**
 * Infrastruktur: access points, switches, servers, firewalls … as assets with
 * network data, rack position, uplink, purchase, warranty, vendor support,
 * end of life, maintenance and lifecycle history. Reading needs ticket work
 * or asset management; changes need asset.manage. Rows are read and written
 * with the service role after these checks.
 */

// deno-lint-ignore no-explicit-any
type Admin = any;
// deno-lint-ignore no-explicit-any
type Client = any;
type Row = Record<string, unknown>;

const MAX_REQUEST_BYTES = 32 * 1024;
export const CATEGORIES = [
  "server",
  "switch",
  "access_point",
  "firewall",
  "router",
  "storage",
  "ups",
  "virtual_host",
  "other",
] as const;
export const LIFECYCLE = [
  "ordered",
  "stock",
  "active",
  "repair",
  "retired",
  "disposed",
] as const;
const CRITICALITY = ["low", "medium", "high", "critical"] as const;
const MAINTENANCE_KINDS = [
  "maintenance",
  "firmware",
  "repair",
  "inspection",
  "other",
] as const;

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export type DeviceInput = {
  id: string | null;
  name: string;
  category: (typeof CATEGORIES)[number];
  lifecycleState: (typeof LIFECYCLE)[number];
  locationId: string | null;
  assetTag: string | null;
  inventoryNumber: string | null;
  serialNumber: string | null;
  manufacturer: string | null;
  model: string | null;
  hostname: string | null;
  ipAddress: string | null;
  macAddress: string | null;
  firmwareVersion: string | null;
  rack: string | null;
  rackUnit: string | null;
  uplinkAssetId: string | null;
  uplinkPort: string | null;
  purchaseDate: string | null;
  purchasePrice: number | null;
  supplier: string | null;
  warrantyUntil: string | null;
  supportUntil: string | null;
  endOfLife: string | null;
  plannedReplacement: string | null;
  criticality: (typeof CRITICALITY)[number];
  maintenanceIntervalMonths: number | null;
  notes: string | null;
};

type Action =
  | { type: "list"; tenantId: string }
  | { type: "detail"; tenantId: string; assetId: string }
  | { type: "save"; tenantId: string; device: DeviceInput }
  | {
    type: "setLifecycle";
    tenantId: string;
    assetId: string;
    state: (typeof LIFECYCLE)[number];
    reason: string | null;
  }
  | {
    type: "addMaintenance";
    tenantId: string;
    assetId: string;
    performedOn: string;
    kind: (typeof MAINTENANCE_KINDS)[number];
    note: string;
  }
  | { type: "addLocation"; tenantId: string; name: string };

function optionalText(value: unknown, max: number): string | null | undefined {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length <= max && !/[\u0000-\u001f]/.test(trimmed)
    ? trimmed
    : undefined;
}

function optionalDate(value: unknown): string | null | undefined {
  if (value === null || value === undefined || value === "") return null;
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
    ? value
    : undefined;
}

function oneOf<T extends readonly string[]>(
  list: T,
  value: unknown,
): T[number] | undefined {
  return typeof value === "string" && (list as readonly string[]).includes(value)
    ? (value as T[number])
    : undefined;
}

/** Light plausibility checks; the field is free text for VLAN/ranges notes. */
export function validIp(value: string | null): boolean {
  if (value === null) return true;
  const v4 = /^(\d{1,3})(\.\d{1,3}){3}(\/\d{1,2})?$/;
  if (v4.test(value)) {
    return value.split("/")[0].split(".").every((part) => Number(part) <= 255);
  }
  return /^[0-9a-f:]+(\/\d{1,3})?$/i.test(value) && value.includes(":");
}

export function validMac(value: string | null): boolean {
  return value === null ||
    /^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i.test(value) ||
    /^[0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{4}$/i.test(value);
}

export function parseDevice(value: unknown): DeviceInput | null {
  if (!isRecord(value)) return null;
  const name = optionalText(value.name, 240);
  const category = oneOf(CATEGORIES, value.category);
  const lifecycleState = oneOf(LIFECYCLE, value.lifecycleState ?? "active");
  const criticality = oneOf(CRITICALITY, value.criticality ?? "medium");
  const texts = {
    assetTag: optionalText(value.assetTag, 160),
    inventoryNumber: optionalText(value.inventoryNumber, 160),
    serialNumber: optionalText(value.serialNumber, 160),
    manufacturer: optionalText(value.manufacturer, 160),
    model: optionalText(value.model, 160),
    hostname: optionalText(value.hostname, 253),
    ipAddress: optionalText(value.ipAddress, 64),
    macAddress: optionalText(value.macAddress, 32),
    firmwareVersion: optionalText(value.firmwareVersion, 120),
    rack: optionalText(value.rack, 80),
    rackUnit: optionalText(value.rackUnit, 20),
    uplinkPort: optionalText(value.uplinkPort, 40),
    supplier: optionalText(value.supplier, 160),
    notes: optionalText(value.notes, 4000),
  };
  const dates = {
    purchaseDate: optionalDate(value.purchaseDate),
    warrantyUntil: optionalDate(value.warrantyUntil),
    supportUntil: optionalDate(value.supportUntil),
    endOfLife: optionalDate(value.endOfLife),
    plannedReplacement: optionalDate(value.plannedReplacement),
  };
  const price = value.purchasePrice === null || value.purchasePrice === undefined ||
      value.purchasePrice === ""
    ? null
    : typeof value.purchasePrice === "number" && value.purchasePrice >= 0 &&
        value.purchasePrice < 10_000_000
    ? Math.round(value.purchasePrice * 100) / 100
    : undefined;
  const interval = value.maintenanceIntervalMonths === null ||
      value.maintenanceIntervalMonths === undefined ||
      value.maintenanceIntervalMonths === ""
    ? null
    : Number.isInteger(value.maintenanceIntervalMonths) &&
        Number(value.maintenanceIntervalMonths) >= 1 &&
        Number(value.maintenanceIntervalMonths) <= 120
    ? Number(value.maintenanceIntervalMonths)
    : undefined;
  const id = value.id === null || value.id === undefined
    ? null
    : isUuid(value.id)
    ? value.id.toLowerCase()
    : undefined;
  const locationId = value.locationId === null || value.locationId === undefined ||
      value.locationId === ""
    ? null
    : isUuid(value.locationId)
    ? value.locationId.toLowerCase()
    : undefined;
  const uplinkAssetId = value.uplinkAssetId === null ||
      value.uplinkAssetId === undefined || value.uplinkAssetId === ""
    ? null
    : isUuid(value.uplinkAssetId)
    ? value.uplinkAssetId.toLowerCase()
    : undefined;
  if (
    !name || !category || !lifecycleState || !criticality ||
    id === undefined || locationId === undefined || uplinkAssetId === undefined ||
    price === undefined || interval === undefined ||
    Object.values(texts).some((entry) => entry === undefined) ||
    Object.values(dates).some((entry) => entry === undefined) ||
    !validIp(texts.ipAddress as string | null) ||
    !validMac(texts.macAddress as string | null) ||
    (id !== null && uplinkAssetId === id)
  ) {
    return null;
  }
  return {
    id,
    name,
    category,
    lifecycleState,
    locationId,
    uplinkAssetId,
    purchasePrice: price,
    maintenanceIntervalMonths: interval,
    criticality,
    ...(texts as Record<keyof typeof texts, string | null>),
    ...(dates as Record<keyof typeof dates, string | null>),
  };
}

export function parseAction(value: unknown): Action | null {
  if (!isRecord(value) || !isUuid(value.tenantId)) return null;
  const tenantId = value.tenantId.toLowerCase();
  switch (value.type) {
    case "list":
      return { type: "list", tenantId };
    case "detail":
      return isUuid(value.assetId)
        ? { type: "detail", tenantId, assetId: value.assetId.toLowerCase() }
        : null;
    case "save": {
      const device = parseDevice(value.device);
      return device ? { type: "save", tenantId, device } : null;
    }
    case "setLifecycle": {
      const state = oneOf(LIFECYCLE, value.state);
      const reason = optionalText(value.reason, 2000);
      return isUuid(value.assetId) && state && reason !== undefined
        ? {
          type: "setLifecycle",
          tenantId,
          assetId: value.assetId.toLowerCase(),
          state,
          reason,
        }
        : null;
    }
    case "addMaintenance": {
      const performedOn = optionalDate(value.performedOn);
      const kind = oneOf(MAINTENANCE_KINDS, value.kind ?? "maintenance");
      const note = optionalText(value.note, 2000);
      return isUuid(value.assetId) && performedOn && kind && note
        ? {
          type: "addMaintenance",
          tenantId,
          assetId: value.assetId.toLowerCase(),
          performedOn,
          kind,
          note,
        }
        : null;
    }
    case "addLocation": {
      const name = optionalText(value.name, 160);
      return name ? { type: "addLocation", tenantId, name } : null;
    }
    default:
      return null;
  }
}

async function readBody(request: Request): Promise<unknown> {
  const body = await request.text().catch(() => null);
  if (body === null || new TextEncoder().encode(body).length > MAX_REQUEST_BYTES) {
    throw new HttpError(413, "payload_too_large", "Die Anfrage ist zu gross.");
  }
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function dbFailure(): HttpError {
  return new HttpError(500, "database_error", "Die Daten konnten nicht verarbeitet werden.");
}

async function permissions(client: Client, tenantId: string) {
  const [manage, work] = await Promise.all([
    client.rpc("has_tenant_permission", {
      p_tenant_id: tenantId,
      p_permission_code: "asset.manage",
    }),
    client.rpc("can_work_tickets_in_tenant", { p_tenant_id: tenantId }),
  ]);
  if (manage.error || work.error) {
    throw new HttpError(503, "permission_check_failed", "Die Berechtigung konnte nicht geprüft werden.");
  }
  return { canManage: manage.data === true, canRead: manage.data === true || work.data === true };
}

async function loadAsset(admin: Admin, tenantId: string, assetId: string) {
  const { data, error } = await admin
    .from("assets")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("id", assetId)
    .maybeSingle();
  if (error) throw dbFailure();
  if (!data) throw new HttpError(404, "device_not_found", "Das Gerät ist nicht verfügbar.");
}

function deviceFromRows(asset: Row, infra: Row, locations: Map<string, string>, names: Map<string, string>) {
  return {
    id: asset.id,
    name: asset.name,
    assetTag: asset.asset_tag ?? null,
    inventoryNumber: asset.inventory_number ?? null,
    serialNumber: asset.serial_number ?? null,
    manufacturer: asset.manufacturer ?? null,
    model: asset.model ?? null,
    lifecycleState: asset.lifecycle_state,
    lifecycleChangedAt: asset.lifecycle_changed_at,
    locationId: asset.location_id ?? null,
    locationName: typeof asset.location_id === "string"
      ? (locations.get(asset.location_id) ?? null)
      : null,
    category: infra.category,
    hostname: infra.hostname ?? null,
    ipAddress: infra.ip_address ?? null,
    macAddress: infra.mac_address ?? null,
    firmwareVersion: infra.firmware_version ?? null,
    rack: infra.rack ?? null,
    rackUnit: infra.rack_unit ?? null,
    uplinkAssetId: infra.uplink_asset_id ?? null,
    uplinkName: typeof infra.uplink_asset_id === "string"
      ? (names.get(infra.uplink_asset_id) ?? null)
      : null,
    uplinkPort: infra.uplink_port ?? null,
    purchaseDate: infra.purchase_date ?? null,
    purchasePrice: infra.purchase_price === null || infra.purchase_price === undefined
      ? null
      : Number(infra.purchase_price),
    supplier: infra.supplier ?? null,
    warrantyUntil: infra.warranty_until ?? null,
    supportUntil: infra.support_until ?? null,
    endOfLife: infra.end_of_life ?? null,
    plannedReplacement: infra.planned_replacement ?? null,
    criticality: infra.criticality,
    maintenanceIntervalMonths: infra.maintenance_interval_months ?? null,
    lastMaintenanceOn: infra.last_maintenance_on ?? null,
    notes: infra.notes ?? null,
  };
}

async function list(request: Request, admin: Admin, tenantId: string, canManage: boolean) {
  const [infra, locations] = await Promise.all([
    admin.from("asset_infrastructure").select("*").eq("tenant_id", tenantId).limit(5000),
    admin.from("asset_locations").select("id, name").eq("tenant_id", tenantId).eq("active", true)
      .order("name"),
  ]);
  if (infra.error || locations.error) throw dbFailure();
  const rows = (infra.data ?? []) as Row[];
  const ids = rows.map((row) => String(row.asset_id));
  const assets = ids.length
    ? await admin
      .from("assets")
      .select(
        "id, name, asset_tag, inventory_number, serial_number, manufacturer, model, lifecycle_state, lifecycle_changed_at, location_id",
      )
      .eq("tenant_id", tenantId)
      .in("id", ids)
    : { data: [], error: null };
  if (assets.error) throw dbFailure();
  const assetById = new Map(((assets.data ?? []) as Row[]).map((row) => [String(row.id), row]));
  const names = new Map(((assets.data ?? []) as Row[]).map((row) => [String(row.id), String(row.name)]));
  const locationNames = new Map(
    ((locations.data ?? []) as Row[]).map((row) => [String(row.id), String(row.name)]),
  );
  const devices = rows.flatMap((row) => {
    const asset = assetById.get(String(row.asset_id));
    return asset ? [deviceFromRows(asset, row, locationNames, names)] : [];
  }).sort((a, b) => String(a.name).localeCompare(String(b.name), "de-CH"));
  return json(request, {
    data: {
      canManage,
      devices,
      locations: ((locations.data ?? []) as Row[]).map((row) => ({ id: row.id, name: row.name })),
    },
  });
}

async function detail(request: Request, admin: Admin, tenantId: string, assetId: string) {
  await loadAsset(admin, tenantId, assetId);
  const [events, maintenance, connected, ticketLinks] = await Promise.all([
    admin.from("asset_lifecycle_events")
      .select("id, previous_state, next_state, reason, actor_id, occurred_at")
      .eq("tenant_id", tenantId).eq("asset_id", assetId)
      .order("occurred_at", { ascending: false }).limit(50),
    admin.from("asset_maintenance_log")
      .select("id, performed_on, kind, note, actor_id, created_at")
      .eq("tenant_id", tenantId).eq("asset_id", assetId)
      .order("performed_on", { ascending: false }).limit(100),
    admin.from("asset_infrastructure")
      .select("asset_id, uplink_port, category")
      .eq("tenant_id", tenantId).eq("uplink_asset_id", assetId).limit(500),
    admin.from("ticket_assets")
      .select("ticket_id")
      .eq("tenant_id", tenantId).eq("asset_id", assetId).limit(50),
  ]);
  if (events.error || maintenance.error || connected.error || ticketLinks.error) throw dbFailure();
  const connectedIds = ((connected.data ?? []) as Row[]).map((row) => String(row.asset_id));
  const ticketIds = ((ticketLinks.data ?? []) as Row[]).map((row) => String(row.ticket_id));
  const actorIds = [
    ...new Set(
      [...((events.data ?? []) as Row[]), ...((maintenance.data ?? []) as Row[])]
        .map((row) => row.actor_id)
        .filter(isUuid),
    ),
  ];
  const [connectedAssets, tickets, actors] = await Promise.all([
    connectedIds.length
      ? admin.from("assets").select("id, name, lifecycle_state").in("id", connectedIds)
      : { data: [], error: null },
    ticketIds.length
      ? admin.from("tickets")
        .select("id, ticket_number, subject, closed_at, resolved_at, created_at")
        .eq("tenant_id", tenantId).in("id", ticketIds)
        .order("created_at", { ascending: false })
      : { data: [], error: null },
    actorIds.length
      ? admin.from("user_profiles").select("id, display_name").in("id", actorIds)
      : { data: [], error: null },
  ]);
  if (connectedAssets.error || tickets.error || actors.error) throw dbFailure();
  const actorNames = new Map(
    ((actors.data ?? []) as Row[]).map((row) => [String(row.id), String(row.display_name ?? "Person")]),
  );
  const portOf = new Map(
    ((connected.data ?? []) as Row[]).map((row) => [String(row.asset_id), row]),
  );
  return json(request, {
    data: {
      lifecycle: ((events.data ?? []) as Row[]).map((row) => ({
        id: row.id,
        from: row.previous_state ?? null,
        to: row.next_state,
        reason: row.reason ?? null,
        actorName: typeof row.actor_id === "string" ? (actorNames.get(row.actor_id) ?? null) : null,
        at: row.occurred_at,
      })),
      maintenance: ((maintenance.data ?? []) as Row[]).map((row) => ({
        id: row.id,
        performedOn: row.performed_on,
        kind: row.kind,
        note: row.note,
        actorName: typeof row.actor_id === "string" ? (actorNames.get(row.actor_id) ?? null) : null,
      })),
      connected: ((connectedAssets.data ?? []) as Row[]).map((row) => ({
        id: row.id,
        name: row.name,
        lifecycleState: row.lifecycle_state,
        port: portOf.get(String(row.id))?.uplink_port ?? null,
        category: portOf.get(String(row.id))?.category ?? null,
      })),
      tickets: ((tickets.data ?? []) as Row[]).map((row) => ({
        id: row.id,
        ticketNumber: row.ticket_number,
        subject: row.subject,
        open: row.closed_at === null && row.resolved_at === null,
      })),
    },
  });
}

async function save(
  request: Request,
  admin: Admin,
  actorId: string,
  tenantId: string,
  device: DeviceInput,
) {
  if (device.locationId) {
    const { data, error } = await admin.from("asset_locations").select("id")
      .eq("tenant_id", tenantId).eq("id", device.locationId).maybeSingle();
    if (error) throw dbFailure();
    if (!data) throw new HttpError(422, "location_invalid", "Der Standort ist nicht verfügbar.");
  }
  if (device.uplinkAssetId) await loadAsset(admin, tenantId, device.uplinkAssetId);
  const assetValues = {
    name: device.name,
    kind: device.category,
    asset_tag: device.assetTag,
    inventory_number: device.inventoryNumber,
    serial_number: device.serialNumber,
    manufacturer: device.manufacturer,
    model: device.model,
    location_id: device.locationId,
  };
  let assetId = device.id;
  if (assetId) {
    await loadAsset(admin, tenantId, assetId);
    const { error } = await admin.from("assets").update(assetValues)
      .eq("tenant_id", tenantId).eq("id", assetId);
    if (error) {
      throw new HttpError(422, "device_save_failed", "Das Gerät konnte nicht gespeichert werden (Seriennummer oder Inventarnummer bereits vergeben?).");
    }
  } else {
    const { data, error } = await admin.from("assets")
      .insert({
        ...assetValues,
        tenant_id: tenantId,
        lifecycle_state: device.lifecycleState,
        lifecycle_changed_at: new Date().toISOString(),
      })
      .select("id").single();
    if (error || !data) {
      throw new HttpError(422, "device_save_failed", "Das Gerät konnte nicht gespeichert werden (Seriennummer oder Inventarnummer bereits vergeben?).");
    }
    assetId = String(data.id);
    await admin.from("asset_lifecycle_events")
      .update({ actor_id: actorId, reason: "Erfasst in Infrastruktur" })
      .eq("tenant_id", tenantId).eq("asset_id", assetId).is("actor_id", null);
  }
  const { error: infraError } = await admin.from("asset_infrastructure").upsert({
    asset_id: assetId,
    tenant_id: tenantId,
    category: device.category,
    hostname: device.hostname,
    ip_address: device.ipAddress,
    mac_address: device.macAddress,
    firmware_version: device.firmwareVersion,
    rack: device.rack,
    rack_unit: device.rackUnit,
    uplink_asset_id: device.uplinkAssetId === assetId ? null : device.uplinkAssetId,
    uplink_port: device.uplinkPort,
    purchase_date: device.purchaseDate,
    purchase_price: device.purchasePrice,
    supplier: device.supplier,
    warranty_until: device.warrantyUntil,
    support_until: device.supportUntil,
    end_of_life: device.endOfLife,
    planned_replacement: device.plannedReplacement,
    criticality: device.criticality,
    maintenance_interval_months: device.maintenanceIntervalMonths,
    notes: device.notes,
    updated_at: new Date().toISOString(),
  }, { onConflict: "asset_id" });
  if (infraError) throw dbFailure();
  await admin.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_id: actorId,
    action: device.id ? "infrastructure.device.updated" : "infrastructure.device.created",
    entity_type: "asset",
    entity_id: assetId,
    severity: "info",
    metadata: { category: device.category },
  });
  return json(request, { data: { assetId } }, device.id ? 200 : 201);
}

async function setLifecycle(
  request: Request,
  admin: Admin,
  actorId: string,
  action: Extract<Action, { type: "setLifecycle" }>,
) {
  await loadAsset(admin, action.tenantId, action.assetId);
  const { error } = await admin.from("assets")
    .update({ lifecycle_state: action.state, lifecycle_changed_at: new Date().toISOString() })
    .eq("tenant_id", action.tenantId).eq("id", action.assetId);
  if (error) throw dbFailure();
  // The trigger recorded the change without person and reason.
  const { data: latest } = await admin.from("asset_lifecycle_events").select("id")
    .eq("tenant_id", action.tenantId).eq("asset_id", action.assetId)
    .order("occurred_at", { ascending: false }).limit(1).maybeSingle();
  if (latest?.id) {
    await admin.from("asset_lifecycle_events")
      .update({ actor_id: actorId, reason: action.reason })
      .eq("id", latest.id);
  }
  return json(request, { data: { updated: true } });
}

async function addMaintenance(
  request: Request,
  admin: Admin,
  actorId: string,
  action: Extract<Action, { type: "addMaintenance" }>,
) {
  await loadAsset(admin, action.tenantId, action.assetId);
  const { error } = await admin.from("asset_maintenance_log").insert({
    tenant_id: action.tenantId,
    asset_id: action.assetId,
    performed_on: action.performedOn,
    kind: action.kind,
    note: action.note,
    actor_id: actorId,
  });
  if (error) throw dbFailure();
  if (action.kind !== "repair" && action.kind !== "other") {
    const { data: infra } = await admin.from("asset_infrastructure")
      .select("last_maintenance_on").eq("asset_id", action.assetId).maybeSingle();
    if (!infra?.last_maintenance_on || String(infra.last_maintenance_on) < action.performedOn) {
      await admin.from("asset_infrastructure")
        .update({ last_maintenance_on: action.performedOn })
        .eq("asset_id", action.assetId);
    }
  }
  return json(request, { data: { added: true } }, 201);
}

async function addLocation(request: Request, admin: Admin, tenantId: string, name: string) {
  const { data, error } = await admin.from("asset_locations")
    .upsert({ tenant_id: tenantId, name, active: true }, { onConflict: "tenant_id,name" })
    .select("id, name").single();
  if (error || !data) throw dbFailure();
  return json(request, { data: { location: data } }, 201);
}

const handler = withSupabase(
  { auth: "user", errors: { detailed: false } },
  async (request, context) => {
    try {
      if (request.method !== "POST") {
        return json(request, { error: { code: "method_not_allowed" } }, 405);
      }
      const actorId = context.userClaims?.id;
      if (!isUuid(actorId)) return json(request, { error: { code: "unauthorized" } }, 401);
      const action = parseAction(await readBody(request));
      if (!action) {
        return json(
          request,
          { error: { code: "invalid_request", message: "Die Angaben sind unvollständig oder ungültig." } },
          422,
        );
      }
      const admin = context.supabaseAdmin;
      const features = await resolveUserFeatureStates(admin, action.tenantId, actorId, [
        "assets.management",
      ]);
      if (features?.["assets.management"] !== true) {
        throw new HttpError(403, "feature_disabled", "Die Infrastruktur ist für Sie nicht eingeschaltet.");
      }
      const access = await permissions(context.supabase, action.tenantId);
      if (!access.canRead) {
        throw new HttpError(403, "access_denied", "Für die Infrastruktur fehlt Ihnen die Berechtigung.");
      }
      if (action.type === "list") return await list(request, admin, action.tenantId, access.canManage);
      if (action.type === "detail") return await detail(request, admin, action.tenantId, action.assetId);
      if (!access.canManage) {
        throw new HttpError(403, "manage_denied", "Änderungen erfordern die Berechtigung zur Asset-Verwaltung.");
      }
      switch (action.type) {
        case "save":
          return await save(request, admin, actorId, action.tenantId, action.device);
        case "setLifecycle":
          return await setLifecycle(request, admin, actorId, action);
        case "addMaintenance":
          return await addMaintenance(request, admin, actorId, action);
        case "addLocation":
          return await addLocation(request, admin, action.tenantId, action.name);
      }
    } catch (error) {
      if (error instanceof HttpError) {
        return json(
          request,
          { error: { code: error.code, message: error.message } },
          error.status,
        );
      }
      console.error("infrastructure_failed", error);
      return json(request, { error: { code: "internal_error" } }, 500);
    }
  },
);

export default {
  fetch(request: Request): Response | Promise<Response> {
    if (request.method === "OPTIONS") return noContent(request);
    return handler(request);
  },
};
