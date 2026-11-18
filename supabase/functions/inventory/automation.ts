// Lager-Automatik (Migration 0314): Standard-Lagerort für Rücknahmen (pro
// Mandant und Abteilung), Nachbestellung bei Mindestbestand, Haltefrist von
// Reservationen, Inventur-Intervall pro Lagerort und Nachbestell-Aufgaben.
// Anfrageprüfung und Lese-/Schreiblogik; die Berechtigung (inventory.manage)
// prüft index.ts vor dem Aufruf.

// deno-lint-ignore no-explicit-any
type Admin = any;
type Row = Record<string, unknown>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_REORDER_REQUESTS = 500;

export type ReorderStatus = "open" | "ordered" | "done" | "dismissed";

export type AutomationSettings = {
  defaultReturnLocationId: string | null;
  reorderNotify: boolean;
  reorderCreateTask: boolean;
  reservationHoldDays: number | null;
};

export type AutomationAction =
  | { type: "getInventoryAutomation"; tenantId: string }
  | {
      type: "saveInventoryAutomation";
      tenantId: string;
      settings: AutomationSettings;
      departmentLocations: {
        departmentId: string;
        locationId: string | null;
      }[];
      countIntervals: { locationId: string; days: number | null }[];
    }
  | {
      type: "manageReorderRequest";
      tenantId: string;
      requestId: string;
      status: Exclude<ReorderStatus, "open">;
      note: string | null;
    };

export class AutomationError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function isRecord(value: unknown): value is Row {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function hasOnlyKeys(value: Row, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function optionalInteger(
  value: unknown,
  min: number,
  max: number,
): number | null | undefined {
  if (value === null) return null;
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= min &&
    value <= max
    ? value
    : undefined;
}

export function isAutomationActionType(value: unknown): boolean {
  return (
    isRecord(value) &&
    (value.type === "getInventoryAutomation" ||
      value.type === "saveInventoryAutomation" ||
      value.type === "manageReorderRequest")
  );
}

export function parseAutomationAction(value: unknown): AutomationAction | null {
  if (!isRecord(value) || !isUuid(value.tenantId)) return null;
  const tenantId = value.tenantId.toLowerCase();
  if (value.type === "getInventoryAutomation") {
    return hasOnlyKeys(value, ["type", "tenantId"])
      ? { type: value.type, tenantId }
      : null;
  }
  if (value.type === "manageReorderRequest") {
    if (
      !hasOnlyKeys(value, [
        "type",
        "tenantId",
        "requestId",
        "status",
        "note",
      ]) ||
      !isUuid(value.requestId) ||
      (value.status !== "ordered" &&
        value.status !== "done" &&
        value.status !== "dismissed")
    ) {
      return null;
    }
    let note: string | null = null;
    if (value.note !== undefined && value.note !== null) {
      if (typeof value.note !== "string") return null;
      const trimmed = value.note.trim();
      if (
        Array.from(trimmed).length > 1000 ||
        /[\u0000-\u001f\u007f]/.test(trimmed)
      )
        return null;
      note = trimmed || null;
    }
    return {
      type: value.type,
      tenantId,
      requestId: value.requestId.toLowerCase(),
      status: value.status,
      note,
    };
  }
  if (value.type !== "saveInventoryAutomation") return null;
  if (
    !hasOnlyKeys(value, [
      "type",
      "tenantId",
      "settings",
      "departmentLocations",
      "countIntervals",
    ]) ||
    !isRecord(value.settings) ||
    !hasOnlyKeys(value.settings, [
      "defaultReturnLocationId",
      "reorderNotify",
      "reorderCreateTask",
      "reservationHoldDays",
    ])
  ) {
    return null;
  }
  const settings = value.settings;
  const holdDays = optionalInteger(
    settings.reservationHoldDays ?? null,
    1,
    365,
  );
  if (
    (settings.defaultReturnLocationId !== null &&
      settings.defaultReturnLocationId !== undefined &&
      !isUuid(settings.defaultReturnLocationId)) ||
    typeof settings.reorderNotify !== "boolean" ||
    typeof settings.reorderCreateTask !== "boolean" ||
    holdDays === undefined
  ) {
    return null;
  }
  const departmentRows = value.departmentLocations ?? [];
  const intervalRows = value.countIntervals ?? [];
  if (
    !Array.isArray(departmentRows) ||
    departmentRows.length > 500 ||
    !Array.isArray(intervalRows) ||
    intervalRows.length > 1000
  ) {
    return null;
  }
  const departmentLocations: {
    departmentId: string;
    locationId: string | null;
  }[] = [];
  const seenDepartments = new Set<string>();
  for (const row of departmentRows) {
    if (
      !isRecord(row) ||
      !hasOnlyKeys(row, ["departmentId", "locationId"]) ||
      !isUuid(row.departmentId) ||
      (row.locationId !== null && !isUuid(row.locationId))
    ) {
      return null;
    }
    const departmentId = row.departmentId.toLowerCase();
    if (seenDepartments.has(departmentId)) return null;
    seenDepartments.add(departmentId);
    departmentLocations.push({
      departmentId,
      locationId: isUuid(row.locationId) ? row.locationId.toLowerCase() : null,
    });
  }
  const countIntervals: { locationId: string; days: number | null }[] = [];
  const seenLocations = new Set<string>();
  for (const row of intervalRows) {
    if (
      !isRecord(row) ||
      !hasOnlyKeys(row, ["locationId", "days"]) ||
      !isUuid(row.locationId)
    ) {
      return null;
    }
    const days = optionalInteger(row.days ?? null, 7, 730);
    const locationId = row.locationId.toLowerCase();
    if (days === undefined || seenLocations.has(locationId)) return null;
    seenLocations.add(locationId);
    countIntervals.push({ locationId, days });
  }
  return {
    type: "saveInventoryAutomation",
    tenantId,
    settings: {
      defaultReturnLocationId: isUuid(settings.defaultReturnLocationId)
        ? settings.defaultReturnLocationId.toLowerCase()
        : null,
      reorderNotify: settings.reorderNotify,
      reorderCreateTask: settings.reorderCreateTask,
      reservationHoldDays: holdDays,
    },
    departmentLocations,
    countIntervals,
  };
}

/** Nächste fällige Inventur eines Lagerorts (ISO-Datum) oder null. */
export function nextCountDue(
  lastCountedAt: string | null,
  createdAt: string,
  intervalDays: number | null,
): string | null {
  if (!intervalDays) return null;
  const base = Date.parse(lastCountedAt ?? createdAt);
  if (!Number.isFinite(base)) return null;
  return new Date(base + intervalDays * 86_400_000).toISOString().slice(0, 10);
}

function failure(error: unknown): never {
  if (error instanceof AutomationError) throw error;
  throw new AutomationError(
    503,
    "inventory_automation_unavailable",
    "Die Lager-Automatik ist derzeit nicht verfügbar.",
  );
}

async function rows(query: Promise<{ data: unknown; error: unknown }>) {
  const { data, error } = await query;
  if (error) failure(error);
  return (Array.isArray(data) ? data : []) as Row[];
}

export async function loadAutomation(admin: Admin, tenantId: string) {
  const [settingsRows, departmentRows, locationRows, departments, requests] =
    await Promise.all([
      rows(
        admin
          .from("inventory_automation_settings")
          .select(
            "default_return_location_id, reorder_notify, reorder_create_task, reservation_hold_days",
          )
          .eq("tenant_id", tenantId)
          .limit(1),
      ),
      rows(
        admin
          .from("inventory_department_return_locations")
          .select("department_id, location_id")
          .eq("tenant_id", tenantId)
          .limit(500),
      ),
      rows(
        admin
          .from("inventory_locations")
          .select("id, name, active, created_at, count_interval_days")
          .eq("tenant_id", tenantId)
          .order("name")
          .limit(1000),
      ),
      rows(
        admin
          .from("departments")
          .select("id, name")
          .eq("tenant_id", tenantId)
          .eq("active", true)
          .order("name")
          .limit(500),
      ),
      rows(
        admin
          .from("inventory_reorder_requests")
          .select(
            "id, item_id, suggested_quantity, status, note, created_at, handled_at",
          )
          .eq("tenant_id", tenantId)
          .in("status", ["open", "ordered"])
          .order("created_at", { ascending: false })
          .limit(MAX_REORDER_REQUESTS),
      ),
    ]);
  const locationIds = locationRows.map((row) => String(row.id));
  const itemIds = [...new Set(requests.map((row) => String(row.item_id)))];
  const [counts, items] = await Promise.all([
    locationIds.length
      ? rows(
          admin
            .from("inventory_counts")
            .select("location_id, closed_at")
            .eq("tenant_id", tenantId)
            .eq("status", "closed")
            .in("location_id", locationIds)
            .order("closed_at", { ascending: false })
            .limit(5000),
        )
      : Promise.resolve([] as Row[]),
    itemIds.length
      ? rows(
          admin
            .from("inventory_items")
            .select("id, name, article_number, unit, supplier")
            .eq("tenant_id", tenantId)
            .in("id", itemIds)
            .limit(itemIds.length),
        )
      : Promise.resolve([] as Row[]),
  ]);
  const lastCount = new Map<string, string>();
  for (const count of counts) {
    const id = String(count.location_id);
    if (!lastCount.has(id) && typeof count.closed_at === "string") {
      lastCount.set(id, count.closed_at);
    }
  }
  const itemsById = new Map(items.map((item) => [String(item.id), item]));
  const settings = settingsRows[0];
  return {
    settings: {
      defaultReturnLocationId: isUuid(settings?.default_return_location_id)
        ? settings.default_return_location_id
        : null,
      reorderNotify: settings ? settings.reorder_notify !== false : true,
      reorderCreateTask: settings?.reorder_create_task === true,
      reservationHoldDays:
        typeof settings?.reservation_hold_days === "number"
          ? settings.reservation_hold_days
          : null,
    } satisfies AutomationSettings,
    departments: departments.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      returnLocationId:
        (departmentRows.find((entry) => entry.department_id === row.id)
          ?.location_id as string | undefined) ?? null,
    })),
    locations: locationRows.map((row) => {
      const interval =
        typeof row.count_interval_days === "number"
          ? row.count_interval_days
          : null;
      const lastCountedAt = lastCount.get(String(row.id)) ?? null;
      return {
        id: String(row.id),
        name: String(row.name),
        active: row.active === true,
        countIntervalDays: interval,
        lastCountedAt,
        nextCountDue: nextCountDue(
          lastCountedAt,
          String(row.created_at),
          interval,
        ),
      };
    }),
    reorderRequests: requests.map((row) => {
      const item = itemsById.get(String(row.item_id));
      return {
        id: String(row.id),
        itemId: String(row.item_id),
        itemName: typeof item?.name === "string" ? item.name : "Artikel",
        articleNumber:
          typeof item?.article_number === "string" ? item.article_number : null,
        unit: typeof item?.unit === "string" ? item.unit : "each",
        supplier: typeof item?.supplier === "string" ? item.supplier : null,
        suggestedQuantity: Number(row.suggested_quantity),
        status: String(row.status) as ReorderStatus,
        note: typeof row.note === "string" ? row.note : null,
        createdAt: String(row.created_at),
      };
    }),
  };
}

export async function saveAutomation(
  admin: Admin,
  actorId: string,
  action: Extract<AutomationAction, { type: "saveInventoryAutomation" }>,
) {
  const tenantId = action.tenantId;
  const locationIds = [
    ...new Set(
      [
        action.settings.defaultReturnLocationId,
        ...action.departmentLocations.map((row) => row.locationId),
        ...action.countIntervals.map((row) => row.locationId),
      ].filter((id): id is string => typeof id === "string"),
    ),
  ];
  if (locationIds.length) {
    const known = await rows(
      admin
        .from("inventory_locations")
        .select("id")
        .eq("tenant_id", tenantId)
        .in("id", locationIds)
        .limit(locationIds.length),
    );
    if (known.length !== locationIds.length) {
      throw new AutomationError(
        422,
        "inventory_location_invalid",
        "Mindestens ein Lagerort ist nicht mehr verfügbar.",
      );
    }
  }
  const departmentIds = action.departmentLocations.map(
    (row) => row.departmentId,
  );
  if (departmentIds.length) {
    const known = await rows(
      admin
        .from("departments")
        .select("id")
        .eq("tenant_id", tenantId)
        .in("id", departmentIds)
        .limit(departmentIds.length),
    );
    if (known.length !== departmentIds.length) {
      throw new AutomationError(
        422,
        "department_invalid",
        "Mindestens eine Abteilung ist nicht mehr verfügbar.",
      );
    }
  }
  const now = new Date().toISOString();
  const { error: settingsError } = await admin
    .from("inventory_automation_settings")
    .upsert(
      {
        tenant_id: tenantId,
        default_return_location_id: action.settings.defaultReturnLocationId,
        reorder_notify: action.settings.reorderNotify,
        reorder_create_task: action.settings.reorderCreateTask,
        reservation_hold_days: action.settings.reservationHoldDays,
        updated_by: actorId,
        updated_at: now,
      },
      { onConflict: "tenant_id" },
    );
  if (settingsError) failure(settingsError);
  const assigned = action.departmentLocations.filter((row) => row.locationId);
  const cleared = action.departmentLocations
    .filter((row) => !row.locationId)
    .map((row) => row.departmentId);
  if (assigned.length) {
    const { error } = await admin
      .from("inventory_department_return_locations")
      .upsert(
        assigned.map((row) => ({
          tenant_id: tenantId,
          department_id: row.departmentId,
          location_id: row.locationId,
          updated_at: now,
        })),
        { onConflict: "tenant_id,department_id" },
      );
    if (error) failure(error);
  }
  if (cleared.length) {
    const { error } = await admin
      .from("inventory_department_return_locations")
      .delete()
      .eq("tenant_id", tenantId)
      .in("department_id", cleared);
    if (error) failure(error);
  }
  for (const row of action.countIntervals) {
    const { error } = await admin
      .from("inventory_locations")
      .update({ count_interval_days: row.days })
      .eq("tenant_id", tenantId)
      .eq("id", row.locationId);
    if (error) failure(error);
  }
  await admin.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_id: actorId,
    action: "inventory.automation.updated",
    entity_type: "inventory_automation_settings",
    entity_id: tenantId,
    severity: "info",
    metadata: {
      reorder_notify: action.settings.reorderNotify,
      reorder_create_task: action.settings.reorderCreateTask,
      reservation_hold_days: action.settings.reservationHoldDays,
      departments: action.departmentLocations.length,
      count_intervals: action.countIntervals.length,
    },
  });
}

export async function manageReorderRequest(
  admin: Admin,
  actorId: string,
  action: Extract<AutomationAction, { type: "manageReorderRequest" }>,
) {
  const { data, error } = await admin
    .from("inventory_reorder_requests")
    .update({
      status: action.status,
      note: action.note,
      handled_by: actorId,
      handled_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", action.tenantId)
    .eq("id", action.requestId)
    .in("status", action.status === "ordered" ? ["open"] : ["open", "ordered"])
    .select("id");
  if (error) failure(error);
  if (!Array.isArray(data) || data.length !== 1) {
    throw new AutomationError(
      404,
      "reorder_request_not_found",
      "Die Nachbestellung wurde nicht gefunden oder ist bereits erledigt.",
    );
  }
}
