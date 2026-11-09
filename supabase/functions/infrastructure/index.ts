import { withSupabase } from "@supabase/server";
import { isRecord, isUuid, json, noContent } from "../_shared/http.ts";
import { resolveTenantFeatureStates, resolveUserFeatureStates } from "../_shared/tenant-features.ts";

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
  serviceIds: string[];
  maintenanceChecklist: ChecklistItem[];
  prtgObjectId: string | null;
};

/** One maintenance checklist point with an optional date the user sets
 * (when it was done or when it is due). Older rows store plain strings. */
export type ChecklistItem = { label: string; date: string | null };

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Stored checklist (strings or objects) → items; invalid entries dropped. */
export function checklistItems(value: unknown): ChecklistItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): ChecklistItem[] => {
    if (typeof entry === "string") {
      return entry.trim() ? [{ label: entry.trim(), date: null }] : [];
    }
    if (typeof entry !== "object" || entry === null) return [];
    const record = entry as Record<string, unknown>;
    const label = typeof record.label === "string" ? record.label.trim() : "";
    if (!label) return [];
    const date = typeof record.date === "string" && ISO_DAY.test(record.date) &&
        !Number.isNaN(Date.parse(record.date))
      ? record.date
      : null;
    return [{ label, date }];
  });
}

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
    performedTime: string | null;
    kind: (typeof MAINTENANCE_KINDS)[number];
    note: string;
  }
  | { type: "addLocation"; tenantId: string; name: string }
  | {
    type: "planMaintenance";
    tenantId: string;
    assetIds: string[];
    serviceIds: string[];
    title: string;
    description: string | null;
    startsAt: string;
    endsAt: string;
    publicEnabled: boolean;
  }
  | {
    type: "scheduleChecklist";
    tenantId: string;
    assetId: string;
    intervalMonths: number;
    startsOn: string;
    assigneeId: string | null;
  }
  | {
    type: "saveRack";
    tenantId: string;
    id: string | null;
    name: string;
    locationId: string | null;
    heightUnits: number;
    notes: string | null;
  }
  | { type: "deleteRack"; tenantId: string; id: string };

/** «12», «12-13», «HE 12» → highest occupied unit; null if unknown. */
export function topRackUnit(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const numbers = value.match(/\d{1,3}/g)?.map(Number) ?? [];
  const [first, second] = numbers;
  if (!first || first > 60) return null;
  return second && second >= first && second <= 60 ? second : first;
}

function uuidList(value: unknown, min: number, max: number): string[] | null {
  if (!Array.isArray(value) || value.length < min || value.length > max) return null;
  if (!value.every(isUuid)) return null;
  const ids = [...new Set(value.map((id) => (id as string).toLowerCase()))];
  return ids.length === value.length ? ids : null;
}

function isoMoment(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 40) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

/** Checklist items: trimmed, non-empty, at most 40 items of 300 characters. */
export function parseChecklist(value: unknown): ChecklistItem[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 40) return null;
  const items: ChecklistItem[] = [];
  for (const entry of value) {
    let label: string;
    let date: string | null = null;
    if (typeof entry === "string") {
      label = entry;
    } else if (typeof entry === "object" && entry !== null && !Array.isArray(entry)) {
      const record = entry as Record<string, unknown>;
      if (typeof record.label !== "string") return null;
      label = record.label;
      if (record.date !== undefined && record.date !== null && record.date !== "") {
        if (
          typeof record.date !== "string" || !ISO_DAY.test(record.date) ||
          Number.isNaN(Date.parse(record.date))
        ) {
          return null;
        }
        date = record.date;
      }
    } else {
      return null;
    }
    const item = label.trim();
    if (item.length > 300 || /[\u0000-\u001f]/.test(item)) return null;
    if (item) items.push({ label: item, date });
  }
  return items;
}

/** PRTG object IDs are numeric; empty clears the mapping. */
export function parsePrtgObjectId(value: unknown): string | null | undefined {
  if (value === null || value === undefined || value === "") return null;
  const text = typeof value === "number" ? String(value) : value;
  if (typeof text !== "string") return undefined;
  const trimmed = text.trim();
  if (!trimmed) return null;
  return /^\d{1,12}$/.test(trimmed) ? trimmed : undefined;
}

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

/** «HH:MM» (24 h); empty means no time. */
function optionalTime(value: unknown): string | null | undefined {
  if (value === null || value === undefined || value === "") return null;
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
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
  // Several services per device; the old single «serviceId» is still read.
  const serviceIds = value.serviceIds === undefined || value.serviceIds === null
    ? value.serviceId === null || value.serviceId === undefined ||
        value.serviceId === ""
      ? []
      : isUuid(value.serviceId)
      ? [value.serviceId.toLowerCase()]
      : null
    : uuidList(value.serviceIds, 0, 30);
  const maintenanceChecklist = parseChecklist(value.maintenanceChecklist);
  const prtgObjectId = parsePrtgObjectId(value.prtgObjectId);
  if (
    serviceIds === null || maintenanceChecklist === null ||
    prtgObjectId === undefined
  ) return null;
  return {
    id,
    name,
    category,
    lifecycleState,
    locationId,
    serviceIds,
    maintenanceChecklist,
    prtgObjectId,
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
      const performedTime = optionalTime(value.performedTime);
      const kind = oneOf(MAINTENANCE_KINDS, value.kind ?? "maintenance");
      const note = optionalText(value.note, 2000);
      return isUuid(value.assetId) && performedOn &&
          performedTime !== undefined && kind && note
        ? {
          type: "addMaintenance",
          tenantId,
          assetId: value.assetId.toLowerCase(),
          performedOn,
          performedTime,
          kind,
          note,
        }
        : null;
    }
    case "addLocation": {
      const name = optionalText(value.name, 160);
      return name ? { type: "addLocation", tenantId, name } : null;
    }
    case "planMaintenance": {
      const assetIds = uuidList(value.assetIds, 1, 50);
      const serviceIds = uuidList(value.serviceIds, 1, 100);
      const title = optionalText(value.title, 180);
      const description = optionalText(value.description, 2000);
      const startsAt = isoMoment(value.startsAt);
      const endsAt = isoMoment(value.endsAt);
      if (
        !assetIds || !serviceIds || !title || title.length < 2 ||
        description === undefined || !startsAt || !endsAt ||
        Date.parse(endsAt) <= Date.parse(startsAt) ||
        typeof value.publicEnabled !== "boolean"
      ) {
        return null;
      }
      return {
        type: "planMaintenance",
        tenantId,
        assetIds,
        serviceIds,
        title,
        description,
        startsAt,
        endsAt,
        publicEnabled: value.publicEnabled,
      };
    }
    case "scheduleChecklist": {
      const interval = value.intervalMonths;
      const startsOn = optionalDate(value.startsOn);
      if (
        !isUuid(value.assetId) || typeof interval !== "number" ||
        !Number.isInteger(interval) || interval < 1 || interval > 60 ||
        !startsOn ||
        !(value.assigneeId === null || value.assigneeId === undefined ||
          isUuid(value.assigneeId))
      ) {
        return null;
      }
      return {
        type: "scheduleChecklist",
        tenantId,
        assetId: value.assetId.toLowerCase(),
        intervalMonths: interval,
        startsOn,
        assigneeId: isUuid(value.assigneeId) ? value.assigneeId.toLowerCase() : null,
      };
    }
    case "saveRack": {
      const name = optionalText(value.name, 80);
      const notes = optionalText(value.notes, 1000);
      const heightUnits = typeof value.heightUnits === "number" ? value.heightUnits : NaN;
      const locationId = value.locationId === null || value.locationId === undefined ||
          value.locationId === ""
        ? null
        : isUuid(value.locationId)
        ? value.locationId.toLowerCase()
        : undefined;
      const id = value.id === null || value.id === undefined
        ? null
        : isUuid(value.id)
        ? value.id.toLowerCase()
        : undefined;
      return name && notes !== undefined && locationId !== undefined && id !== undefined &&
          Number.isInteger(heightUnits) && heightUnits >= 1 && heightUnits <= 60
        ? { type: "saveRack", tenantId, id, name, locationId, heightUnits, notes }
        : null;
    }
    case "deleteRack":
      return isUuid(value.id)
        ? { type: "deleteRack", tenantId, id: value.id.toLowerCase() }
        : null;
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

function deviceFromRows(
  asset: Row,
  infra: Row,
  locations: Map<string, string>,
  names: Map<string, string>,
  linkedServiceIds: string[] = [],
) {
  const primary = typeof asset.service_id === "string" ? asset.service_id : null;
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
    serviceId: primary,
    serviceIds: [...new Set([...(primary ? [primary] : []), ...linkedServiceIds])],
    maintenanceChecklist: checklistItems(infra.maintenance_checklist),
    serviceTaskTemplateId: infra.service_task_template_id ?? null,
    prtgObjectId: infra.prtg_object_id ?? null,
  };
}

async function list(request: Request, admin: Admin, tenantId: string, canManage: boolean) {
  const [infra, locations, services, alerts, serviceLinks, racks] = await Promise.all([
    admin.from("asset_infrastructure").select("*").eq("tenant_id", tenantId).limit(5000),
    admin.from("asset_locations").select("id, name").eq("tenant_id", tenantId).eq("active", true)
      .order("name"),
    admin.from("services").select("id, name").eq("tenant_id", tenantId).order("name").limit(1000),
    // Live monitoring state (PRTG) for the network map.
    admin.from("monitoring_alerts")
      .select("asset_id, sensor_name, last_status, last_message, last_event_at")
      .eq("tenant_id", tenantId).eq("state", "open").not("asset_id", "is", null).limit(2000),
    admin.from("asset_services").select("asset_id, service_id").eq("tenant_id", tenantId).limit(20000),
    admin.from("infrastructure_racks").select("id, name, location_id, height_units, notes")
      .eq("tenant_id", tenantId).order("name").limit(1000),
  ]);
  if (
    infra.error || locations.error || services.error || alerts.error || serviceLinks.error ||
    racks.error
  ) {
    throw dbFailure();
  }
  const linkedServices = new Map<string, string[]>();
  for (const link of (serviceLinks.data ?? []) as Row[]) {
    const key = String(link.asset_id);
    linkedServices.set(key, [...(linkedServices.get(key) ?? []), String(link.service_id)]);
  }
  const rows = (infra.data ?? []) as Row[];
  const ids = rows.map((row) => String(row.asset_id));
  const assets = ids.length
    ? await admin
      .from("assets")
      .select(
        "id, name, asset_tag, inventory_number, serial_number, manufacturer, model, lifecycle_state, lifecycle_changed_at, location_id, service_id",
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
    return asset
      ? [deviceFromRows(asset, row, locationNames, names, linkedServices.get(String(asset.id)))]
      : [];
  }).sort((a, b) => String(a.name).localeCompare(String(b.name), "de-CH"));
  const monitoring: Record<string, { sensor: string | null; status: string | null; message: string | null; at: string }[]> = {};
  for (const alert of (alerts.data ?? []) as Row[]) {
    const key = String(alert.asset_id);
    (monitoring[key] ??= []).push({
      sensor: (alert.sensor_name as string | null) ?? null,
      status: (alert.last_status as string | null) ?? null,
      message: (alert.last_message as string | null) ?? null,
      at: String(alert.last_event_at),
    });
  }
  return json(request, {
    data: {
      canManage,
      devices,
      monitoring,
      locations: ((locations.data ?? []) as Row[]).map((row) => ({ id: row.id, name: row.name })),
      racks: ((racks.data ?? []) as Row[]).map((row) => ({
        id: row.id,
        name: row.name,
        locationId: row.location_id ?? null,
        locationName: row.location_id ? (locationNames.get(String(row.location_id)) ?? null) : null,
        heightUnits: row.height_units,
        notes: row.notes ?? null,
      })),
      services: ((services.data ?? []) as Row[]).map((row) => ({ id: row.id, name: row.name })),
    },
  });
}

async function detail(request: Request, admin: Admin, tenantId: string, assetId: string) {
  await loadAsset(admin, tenantId, assetId);
  const [events, maintenance, connected, ticketLinks, windowLinks] = await Promise.all([
    admin.from("asset_lifecycle_events")
      .select("id, previous_state, next_state, reason, actor_id, occurred_at")
      .eq("tenant_id", tenantId).eq("asset_id", assetId)
      .order("occurred_at", { ascending: false }).limit(50),
    admin.from("asset_maintenance_log")
      .select("id, performed_on, performed_time, kind, note, actor_id, created_at")
      .eq("tenant_id", tenantId).eq("asset_id", assetId)
      .order("performed_on", { ascending: false })
      .order("performed_time", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false }).limit(100),
    admin.from("asset_infrastructure")
      .select("asset_id, uplink_port, category")
      .eq("tenant_id", tenantId).eq("uplink_asset_id", assetId).limit(500),
    admin.from("ticket_assets")
      .select("ticket_id")
      .eq("tenant_id", tenantId).eq("asset_id", assetId).limit(50),
    admin.from("service_status_maintenance_assets")
      .select("maintenance_id")
      .eq("tenant_id", tenantId).eq("asset_id", assetId).limit(100),
  ]);
  if (
    events.error || maintenance.error || connected.error || ticketLinks.error ||
    windowLinks.error
  ) {
    throw dbFailure();
  }
  const windowIds = ((windowLinks.data ?? []) as Row[]).map((row) => String(row.maintenance_id));
  const windows = windowIds.length
    ? await admin.from("service_status_maintenances")
      .select("id, title, description, starts_at, ends_at, state, public_enabled")
      .eq("tenant_id", tenantId).in("id", windowIds)
      .gte("ends_at", new Date(Date.now() - 30 * 86_400_000).toISOString())
      .order("starts_at", { ascending: true })
    : { data: [], error: null };
  if (windows.error) throw dbFailure();
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
        performedTime: typeof row.performed_time === "string"
          ? row.performed_time.slice(0, 5)
          : null,
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
      windows: ((windows.data ?? []) as Row[]).map((row) => ({
        id: row.id,
        title: row.title,
        description: row.description ?? null,
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        state: row.state,
        publicEnabled: row.public_enabled === true,
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
  if (device.serviceIds.length) {
    const { data, error } = await admin.from("services").select("id")
      .eq("tenant_id", tenantId).in("id", device.serviceIds);
    if (error) throw dbFailure();
    if ((data ?? []).length !== device.serviceIds.length) {
      throw new HttpError(422, "service_invalid", "Ein Dienst ist nicht verfügbar.");
    }
  }
  const assetValues = {
    // The first service stays the primary one for modules that know only one.
    service_id: device.serviceIds[0] ?? null,
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
    maintenance_checklist: device.maintenanceChecklist,
    prtg_object_id: device.prtgObjectId,
    updated_at: new Date().toISOString(),
  }, { onConflict: "asset_id" });
  if (infraError) throw dbFailure();
  const cleared = await admin.from("asset_services").delete()
    .eq("tenant_id", tenantId).eq("asset_id", assetId);
  if (cleared.error) throw dbFailure();
  if (device.serviceIds.length) {
    const linked = await admin.from("asset_services").insert(
      device.serviceIds.map((serviceId) => ({
        tenant_id: tenantId,
        asset_id: assetId,
        service_id: serviceId,
      })),
    );
    if (linked.error) throw dbFailure();
  }
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
    performed_time: action.performedTime,
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

/** Devices of a rack: same rack name (case-insensitive) and location. */
async function devicesInRack(
  admin: Admin,
  tenantId: string,
  name: string,
  locationId: string | null,
): Promise<{ assetId: string; name: string; top: number | null }[]> {
  const { data: rows, error } = await admin.from("asset_infrastructure")
    .select("asset_id, rack, rack_unit").eq("tenant_id", tenantId)
    .not("rack", "is", null).limit(5000);
  if (error) throw dbFailure();
  const wanted = name.trim().toLocaleLowerCase("de-CH");
  const matches = ((rows ?? []) as Row[]).filter((row) =>
    typeof row.rack === "string" && row.rack.trim().toLocaleLowerCase("de-CH") === wanted
  );
  if (matches.length === 0) return [];
  const { data: assets, error: assetError } = await admin.from("assets")
    .select("id, name, location_id").eq("tenant_id", tenantId)
    .in("id", matches.map((row) => String(row.asset_id)));
  if (assetError) throw dbFailure();
  const assetById = new Map(((assets ?? []) as Row[]).map((row) => [String(row.id), row]));
  return matches.flatMap((row) => {
    const asset = assetById.get(String(row.asset_id));
    if (!asset || (asset.location_id ?? null) !== locationId) return [];
    return [{ assetId: String(asset.id), name: String(asset.name), top: topRackUnit(row.rack_unit) }];
  });
}

async function saveRack(
  request: Request,
  admin: Admin,
  actorId: string,
  action: Extract<Action, { type: "saveRack" }>,
) {
  if (action.locationId) {
    const { data, error } = await admin.from("asset_locations").select("id")
      .eq("tenant_id", action.tenantId).eq("id", action.locationId).maybeSingle();
    if (error) throw dbFailure();
    if (!data) throw new HttpError(422, "location_invalid", "Der Standort ist nicht verfügbar.");
  }
  let previous: { name: string; locationId: string | null } | null = null;
  if (action.id) {
    const { data, error } = await admin.from("infrastructure_racks")
      .select("name, location_id").eq("tenant_id", action.tenantId).eq("id", action.id)
      .maybeSingle();
    if (error) throw dbFailure();
    if (!data) throw new HttpError(404, "rack_not_found", "Das Rack ist nicht verfügbar.");
    previous = { name: String(data.name), locationId: (data.location_id as string | null) ?? null };
  }
  // Devices that move with the rack: those of the saved rack, or for a new
  // rack the devices that already name it.
  const members = await devicesInRack(
    admin,
    action.tenantId,
    previous?.name ?? action.name,
    previous ? previous.locationId : action.locationId,
  );
  const tooHigh = members.find((device) => device.top !== null && device.top > action.heightUnits);
  if (tooHigh) {
    throw new HttpError(
      422,
      "rack_too_small",
      `«${tooHigh.name}» belegt HE ${tooHigh.top}. Das Rack braucht mindestens ${tooHigh.top} HE.`,
    );
  }
  const values = {
    tenant_id: action.tenantId,
    name: action.name,
    location_id: action.locationId,
    height_units: action.heightUnits,
    notes: action.notes,
    updated_at: new Date().toISOString(),
  };
  const result = action.id
    ? await admin.from("infrastructure_racks").update(values)
      .eq("tenant_id", action.tenantId).eq("id", action.id).select("id").single()
    : await admin.from("infrastructure_racks").insert({ ...values, created_by: actorId })
      .select("id").single();
  if (result.error) {
    if (result.error.code === "23505") {
      throw new HttpError(409, "rack_exists", "Ein Rack mit diesem Namen gibt es am Standort bereits.");
    }
    throw dbFailure();
  }
  const ids = members.map((device) => device.assetId);
  if (previous && ids.length) {
    if (previous.name !== action.name) {
      const { error } = await admin.from("asset_infrastructure").update({ rack: action.name })
        .eq("tenant_id", action.tenantId).in("asset_id", ids);
      if (error) throw dbFailure();
    }
    if (previous.locationId !== action.locationId) {
      // The devices are in the rack: they move with it.
      const { error } = await admin.from("assets").update({ location_id: action.locationId })
        .eq("tenant_id", action.tenantId).in("id", ids);
      if (error) throw dbFailure();
    }
  }
  return json(request, { data: { rackId: result.data.id, movedDevices: previous ? ids.length : 0 } });
}

async function deleteRack(
  request: Request,
  admin: Admin,
  action: Extract<Action, { type: "deleteRack" }>,
) {
  const { data, error } = await admin.from("infrastructure_racks")
    .select("name, location_id").eq("tenant_id", action.tenantId).eq("id", action.id)
    .maybeSingle();
  if (error) throw dbFailure();
  if (!data) throw new HttpError(404, "rack_not_found", "Das Rack ist nicht verfügbar.");
  const members = await devicesInRack(
    admin,
    action.tenantId,
    String(data.name),
    (data.location_id as string | null) ?? null,
  );
  if (members.length) {
    throw new HttpError(
      409,
      "rack_not_empty",
      `Im Rack sind noch ${members.length} Geräte. Entfernen Sie zuerst die Geräte aus dem Rack.`,
    );
  }
  const { error: deleteError } = await admin.from("infrastructure_racks").delete()
    .eq("tenant_id", action.tenantId).eq("id", action.id);
  if (deleteError) throw dbFailure();
  return json(request, { data: { deleted: true } });
}

async function addLocation(request: Request, admin: Admin, tenantId: string, name: string) {
  const { data, error } = await admin.from("asset_locations")
    .upsert({ tenant_id: tenantId, name, active: true }, { onConflict: "tenant_id,name" })
    .select("id, name").single();
  if (error || !data) throw dbFailure();
  return json(request, { data: { location: data } }, 201);
}

async function planMaintenance(
  request: Request,
  admin: Admin,
  actorId: string,
  action: Extract<Action, { type: "planMaintenance" }>,
) {
  for (const assetId of action.assetIds) await loadAsset(admin, action.tenantId, assetId);
  const { data, error } = await admin.rpc("save_service_status_maintenance", {
    p_actor_id: actorId,
    p_tenant_id: action.tenantId,
    p_maintenance_id: null,
    p_title: action.title,
    p_description: action.description,
    p_starts_at: action.startsAt,
    p_ends_at: action.endsAt,
    p_state: "scheduled",
    p_public_enabled: action.publicEnabled,
    p_service_ids: action.serviceIds,
  });
  if (error?.code === "42501") {
    throw new HttpError(
      403,
      "publication_denied",
      "Öffentliche Wartungsfenster erfordern die Berechtigung für Mandanteneinstellungen.",
    );
  }
  if (error || !isUuid(data)) {
    throw new HttpError(422, "maintenance_invalid", "Das Wartungsfenster konnte nicht gespeichert werden.");
  }
  const { error: linkError } = await admin.from("service_status_maintenance_assets").insert(
    action.assetIds.map((assetId) => ({
      tenant_id: action.tenantId,
      maintenance_id: data,
      asset_id: assetId,
    })),
  );
  if (linkError) throw dbFailure();
  return json(request, { data: { maintenanceId: data } }, 201);
}

function addDays(isoDay: string, days: number): string {
  const date = new Date(`${isoDay}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function scheduleChecklist(
  request: Request,
  admin: Admin,
  actorId: string,
  action: Extract<Action, { type: "scheduleChecklist" }>,
) {
  const features = await resolveTenantFeatureStates(admin, action.tenantId, ["service.tasks"]);
  if (features?.["service.tasks"] !== true) {
    throw new HttpError(403, "service_tasks_disabled", "Serviceaufgaben sind für diesen Mandanten nicht eingeschaltet.");
  }
  const [{ data: asset, error: assetError }, { data: infra, error: infraError }] = await Promise.all([
    admin.from("assets").select("id, name, inventory_number, serial_number, department_id")
      .eq("tenant_id", action.tenantId).eq("id", action.assetId).maybeSingle(),
    admin.from("asset_infrastructure")
      .select("hostname, ip_address, rack, criticality, maintenance_checklist, service_task_template_id")
      .eq("tenant_id", action.tenantId).eq("asset_id", action.assetId).maybeSingle(),
  ]);
  if (assetError || infraError) throw dbFailure();
  if (!asset || !infra) throw new HttpError(404, "device_not_found", "Das Gerät ist nicht verfügbar.");
  const checklist = checklistItems(infra.maintenance_checklist).map((item) => item.label);
  if (checklist.length === 0) {
    throw new HttpError(422, "checklist_empty", "Erfassen Sie zuerst die Punkte der Wartungscheckliste.");
  }
  if (action.assigneeId) {
    const { data: member, error } = await admin.from("tenant_memberships").select("user_id")
      .eq("tenant_id", action.tenantId).eq("user_id", action.assigneeId).eq("status", "active")
      .maybeSingle();
    if (error) throw dbFailure();
    if (!member) throw new HttpError(422, "assignee_invalid", "Die gewählte Person ist nicht verfügbar.");
  }
  const day = Number(action.startsOn.slice(8, 10));
  const values = {
    tenant_id: action.tenantId,
    department_id: asset.department_id ?? null,
    title: `Wartung: ${String(asset.name)}`.slice(0, 160),
    instructions: [
      "Wiederkehrende Wartung gemäss Checkliste aus der Infrastruktur.",
      infra.hostname ? `Hostname: ${infra.hostname}` : null,
      infra.ip_address ? `IP-Adresse: ${infra.ip_address}` : null,
      infra.rack ? `Rack: ${infra.rack}` : null,
    ].filter(Boolean).join("\n"),
    category: "Infrastruktur",
    priority: infra.criticality === "critical" ? "high" : "normal",
    assignee_id: action.assigneeId,
    reference_label: [asset.name, asset.inventory_number ?? asset.serial_number]
      .filter(Boolean).join(" · ").slice(0, 200),
    recurrence: {
      frequency: "monthly",
      interval: action.intervalMonths,
      monthlyMode: "day",
      dayOfMonth: Math.min(28, Math.max(1, day)),
      skipNonWorkdays: true,
    },
    starts_on: action.startsOn,
    lead_days: 7,
    checklist: checklist.map((label, index) => ({ id: `w${index + 1}`, label })),
    require_note: false,
    remind: true,
    active: true,
    // Rebuild future occurrences from the (possibly changed) rule.
    generated_until: addDays(action.startsOn, -1),
    updated_by: actorId,
    updated_at: new Date().toISOString(),
  };
  let templateId = infra.service_task_template_id as string | null;
  if (templateId) {
    const { data, error } = await admin.from("service_task_templates").update(values)
      .eq("tenant_id", action.tenantId).eq("id", templateId).select("id").maybeSingle();
    if (error) throw dbFailure();
    if (!data) templateId = null;
  }
  if (!templateId) {
    const { data, error } = await admin.from("service_task_templates")
      .insert({ ...values, created_by: actorId }).select("id").single();
    if (error || !data) throw dbFailure();
    templateId = String(data.id);
  }
  const { error: linkError } = await admin.from("asset_infrastructure")
    .update({
      service_task_template_id: templateId,
      maintenance_interval_months: action.intervalMonths,
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", action.tenantId).eq("asset_id", action.assetId);
  if (linkError) throw dbFailure();
  return json(request, { data: { templateId } });
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
        case "planMaintenance":
          return await planMaintenance(request, admin, actorId, action);
        case "scheduleChecklist":
          return await scheduleChecklist(request, admin, actorId, action);
        case "saveRack":
          return await saveRack(request, admin, actorId, action);
        case "deleteRack":
          return await deleteRack(request, admin, action);
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
