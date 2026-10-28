import { type SupabaseContext, withSupabase } from "@supabase/server";
import { resolveTenantFeatureStates } from "../_shared/tenant-features.ts";

const ALLOWED_ORIGIN = "https://app.nextdesk.ch";
const FEATURE = "inventory.management";
const ASSET_FEATURE = "assets.management";
const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_CODE_LENGTH = 200;
const MAX_QUANTITY = 1_000_000_000;
const MAX_ITEMS = 2_000;
const MAX_LOCATIONS = 1_000;
const MAX_BALANCES = 10_000;
const MAX_EVENTS = 50;
const MAX_EVENT_LINES = 100;
const MAX_RESERVATIONS = 2_000;
const MAX_ACTIVE_COUNTS = 1_000;
const MAX_LOOKUP_CANDIDATES = 20;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const INVENTORY_PERMISSIONS = [
  "inventory.read",
  "inventory.manage",
  "inventory.move",
  "inventory.adjust",
  "inventory.count.close",
] as const;
type InventoryPermission = (typeof INVENTORY_PERMISSIONS)[number];
type TenantPermission = InventoryPermission | "asset.manage";
const MOVEMENT_PERMISSIONS = {
  receipt: "inventory.move",
  issue: "inventory.move",
  transfer: "inventory.move",
  defect: "inventory.adjust",
  loss: "inventory.adjust",
  adjustment_in: "inventory.adjust",
  adjustment_out: "inventory.adjust",
} as const satisfies Record<string, InventoryPermission>;
type MovementType = keyof typeof MOVEMENT_PERMISSIONS;

/** The only service-command RPCs supplied by migration 0068. */
export const INVENTORY_RPC_NAMES = {
  upsertLocation: "upsert_inventory_location",
  upsertItem: "upsert_inventory_item",
  postMovement: "post_inventory_movement",
  createReservation: "create_inventory_reservation",
  releaseReservation: "release_inventory_reservation",
  startCount: "start_inventory_count",
  recordCountLine: "record_inventory_count_line",
  closeCount: "close_inventory_count",
} as const;

type TrackingMode = "quantity" | "serial";
type Row = Record<string, unknown>;
type CallerClient = SupabaseContext["supabase"];
type AdminClient = SupabaseContext["supabaseAdmin"];
type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export type InventoryPermissions = {
  canRead: true;
  canManage: boolean;
  canMove: boolean;
  canAdjust: boolean;
  canCloseInventoryCount: boolean;
};

export type WorkspaceItem = {
  id: string;
  name: string;
  articleNumber: string | null;
  unit: string;
  trackingMode: TrackingMode;
  physicalQuantity: number;
  reservedQuantity: number;
  availableQuantity: number;
  minQuantity: number;
  targetQuantity: number;
  locationName: string | null;
  active: boolean;
};

export type WorkspaceLocation = {
  id: string;
  name: string;
  code: string | null;
  active: boolean;
};

export type RecentEvent = {
  id: string;
  type: string;
  occurredAt: string;
  itemName: string;
  physicalDelta: number;
  reservedDelta: number;
  locationName: string | null;
};

export type InventoryWorkspace = {
  permissions: InventoryPermissions;
  summary: {
    criticalItemCount: number;
    openReservationCount: number;
    activeCountSessionCount: number;
  };
  items: WorkspaceItem[];
  locations: WorkspaceLocation[];
  recentEvents: RecentEvent[];
  recentEventsHasMore: boolean;
  lowStockItems: WorkspaceItem[];
};

export type OpenReservation = {
  id: string;
  itemName: string;
  locationName: string;
  quantity: number;
  createdAt: string;
};

export type ActiveInventoryCount = {
  id: string;
  locationName: string;
  status: "draft" | "counting";
  startedAt: string;
};

type LookupNamedResource = { id: string; name: string };
type LookupCandidate = LookupNamedResource & {
  kind: "inventory_item" | "asset";
};
export type LookupCodeResult =
  | { kind: "inventory_item"; item: LookupNamedResource }
  | { kind: "asset"; asset: LookupNamedResource }
  | { kind: "ambiguous"; candidates: LookupCandidate[] }
  | { kind: "not_found" };

type ItemValues = {
  articleNumber?: string;
  name?: string;
  category?: string;
  unit?: string;
  trackingMode?: TrackingMode;
  minimumStock?: number;
  targetStock?: number;
  manufacturer?: string | null;
  model?: string | null;
  supplier?: string | null;
  privateNote?: string | null;
  active?: boolean;
};

type LocationValues = {
  code?: string;
  name?: string;
  active?: boolean;
};

type ManageOperation = "create" | "update" | "archive";
type PostMovementAction = {
  type: "postMovement";
  tenantId: string;
  movementType: MovementType;
  clientRequestId: string;
  itemId?: string;
  quantity?: number;
  fromLocationId?: string;
  toLocationId?: string;
  /** Present only for a reservation-backed issue; never accepted with line data. */
  reservationId?: string;
};
type ResolvedPostMovementAction = PostMovementAction & {
  itemId: string;
  quantity: number;
  fromLocationId?: string;
  toLocationId?: string;
  serialUnitId?: string;
};

type Action =
  | { type: "workspace"; tenantId: string }
  | { type: "listOpenReservations"; tenantId: string }
  | { type: "listActiveCounts"; tenantId: string }
  | { type: "lookupCode"; tenantId: string; code: string }
  | {
      type: "manageItem";
      tenantId: string;
      operation: ManageOperation;
      itemId?: string;
      values?: ItemValues;
      clientRequestId: string;
    }
  | {
      type: "manageLocation";
      tenantId: string;
      operation: ManageOperation;
      locationId?: string;
      values?: LocationValues;
      clientRequestId: string;
    }
  | PostMovementAction
  | {
      type: "reserve";
      tenantId: string;
      itemId: string;
      locationId: string;
      quantity: number;
      ticketId?: string;
      serialUnitId?: string;
      clientRequestId: string;
    }
  | {
      type: "releaseReservation";
      tenantId: string;
      reservationId: string;
      clientRequestId: string;
    }
  | {
      type: "startCount";
      tenantId: string;
      locationId: string;
      clientRequestId: string;
    }
  | {
      type: "recordCountLine";
      tenantId: string;
      countId: string;
      itemId: string;
      countedQuantity: number;
      clientRequestId: string;
    }
  | {
      type: "closeCount";
      tenantId: string;
      countId: string;
      clientRequestId: string;
    };

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const INVALID = Symbol("invalid");

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

function validText(
  value: unknown,
  minimum: number,
  maximum: number,
): string | null {
  if (
    typeof value !== "string" ||
    value.includes("\u0000") ||
    !value.isWellFormed()
  ) {
    return null;
  }
  const normalized = value.trim();
  const length = Array.from(normalized).length;
  return length >= minimum && length <= maximum ? normalized : null;
}

function nullableText(
  value: unknown,
  minimum: number,
  maximum: number,
): string | null | undefined {
  if (value === null) return null;
  return validText(value, minimum, maximum) ?? undefined;
}

function hasThreeOrFewerDecimalPlaces(value: number): boolean {
  const scaled = value * 1_000;
  return (
    Number.isSafeInteger(Math.round(scaled)) && Math.round(scaled) === scaled
  );
}

function validNonNegativeQuantity(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= MAX_QUANTITY &&
    hasThreeOrFewerDecimalPlaces(value)
    ? value
    : null;
}

function validPositiveQuantity(value: unknown): number | null {
  const quantity = validNonNegativeQuantity(value);
  return quantity !== null && quantity > 0 ? quantity : null;
}

function validOptionalUuid(value: unknown): string | undefined | null {
  if (value === undefined) return undefined;
  return isUuid(value) ? value.toLowerCase() : null;
}

function parseItemValues(value: unknown): ItemValues | null {
  if (!isRecord(value)) return null;
  const keys = [
    "articleNumber",
    "name",
    "category",
    "unit",
    "trackingMode",
    "minimumStock",
    "targetStock",
    "manufacturer",
    "model",
    "supplier",
    "privateNote",
    "active",
  ] as const;
  // Inventory identifiers deliberately have no Edge command in migration 0068.
  // Barcode, QR and location assignment therefore cannot cross this boundary.
  if (!hasOnlyKeys(value, keys)) return null;

  const result: ItemValues = {};
  if (Object.hasOwn(value, "articleNumber")) {
    const articleNumber = validText(value.articleNumber, 1, 160)?.toLowerCase();
    if (
      !articleNumber ||
      !/^[a-z0-9][a-z0-9._/-]{0,159}$/.test(articleNumber)
    ) {
      return null;
    }
    result.articleNumber = articleNumber;
  }
  if (Object.hasOwn(value, "name")) {
    const name = validText(value.name, 1, 240);
    if (name === null) return null;
    result.name = name;
  }
  if (Object.hasOwn(value, "category")) {
    const category = validText(value.category, 1, 120);
    if (category === null) return null;
    result.category = category;
  }
  if (Object.hasOwn(value, "unit")) {
    const unit = validText(value.unit, 1, 32)?.toLowerCase();
    if (!unit || !/^[a-z][a-z0-9_-]{0,31}$/.test(unit)) return null;
    result.unit = unit;
  }
  if (Object.hasOwn(value, "trackingMode")) {
    if (value.trackingMode !== "quantity" && value.trackingMode !== "serial") {
      return null;
    }
    result.trackingMode = value.trackingMode;
  }
  for (const field of ["minimumStock", "targetStock"] as const) {
    if (!Object.hasOwn(value, field)) continue;
    const quantity = validNonNegativeQuantity(value[field]);
    if (quantity === null) return null;
    result[field] = quantity;
  }
  for (const field of ["manufacturer", "model", "supplier"] as const) {
    if (!Object.hasOwn(value, field)) continue;
    const text = nullableText(value[field], 1, 160);
    if (text === undefined) return null;
    result[field] = text;
  }
  if (Object.hasOwn(value, "privateNote")) {
    const note = nullableText(value.privateNote, 0, 2_000);
    if (note === undefined) return null;
    result.privateNote = note;
  }
  if (Object.hasOwn(value, "active")) {
    if (typeof value.active !== "boolean") return null;
    result.active = value.active;
  }
  return result;
}

function parseLocationValues(value: unknown): LocationValues | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ["code", "name", "active"])) {
    return null;
  }
  const result: LocationValues = {};
  if (Object.hasOwn(value, "code")) {
    const code = validText(value.code, 1, 63)?.toLowerCase();
    if (!code || !/^[a-z0-9][a-z0-9_-]{0,62}$/.test(code)) return null;
    result.code = code;
  }
  if (Object.hasOwn(value, "name")) {
    const name = validText(value.name, 1, 160);
    if (name === null) return null;
    result.name = name;
  }
  if (Object.hasOwn(value, "active")) {
    if (typeof value.active !== "boolean") return null;
    result.active = value.active;
  }
  return result;
}

function validItemCreate(values: ItemValues): boolean {
  return (
    Object.hasOwn(values, "articleNumber") &&
    Object.hasOwn(values, "name") &&
    Object.hasOwn(values, "category") &&
    Object.hasOwn(values, "unit") &&
    Object.hasOwn(values, "trackingMode") &&
    Object.hasOwn(values, "minimumStock") &&
    Object.hasOwn(values, "targetStock") &&
    values.targetStock! >= values.minimumStock!
  );
}

function parseManageAction(
  value: Row,
  type: "manageItem" | "manageLocation",
): Extract<Action, { type: "manageItem" | "manageLocation" }> | null {
  const idKey = type === "manageItem" ? "itemId" : "locationId";
  const operation = value.operation;
  if (
    operation !== "create" &&
    operation !== "update" &&
    operation !== "archive"
  ) {
    return null;
  }
  const expectedKeys = ["type", "tenantId", "operation", "clientRequestId"];
  if (operation !== "create") expectedKeys.push(idKey);
  if (operation !== "archive") expectedKeys.push("values");
  if (!hasOnlyKeys(value, expectedKeys) || !isUuid(value.clientRequestId)) {
    return null;
  }

  const tenantId = value.tenantId as string;
  const clientRequestId = value.clientRequestId.toLowerCase();
  const id = operation === "create" ? undefined : value[idKey];
  if (operation !== "create" && !isUuid(id)) return null;
  if (operation === "archive") {
    return type === "manageItem"
      ? {
          type,
          tenantId,
          operation,
          itemId: (id as string).toLowerCase(),
          clientRequestId,
        }
      : {
          type,
          tenantId,
          operation,
          locationId: (id as string).toLowerCase(),
          clientRequestId,
        };
  }

  const values =
    type === "manageItem"
      ? parseItemValues(value.values)
      : parseLocationValues(value.values);
  if (!values || Object.keys(values).length === 0) return null;
  if (
    operation === "create" &&
    (type === "manageItem"
      ? !validItemCreate(values as ItemValues)
      : !Object.hasOwn(values, "code") || !Object.hasOwn(values, "name"))
  ) {
    return null;
  }
  if (
    type === "manageItem" &&
    operation === "create" &&
    (values as ItemValues).trackingMode !== "quantity"
  ) {
    // There is currently no command that can securely create and book serial
    // units. New serial-tracked items must therefore not cross this boundary.
    return null;
  }
  return type === "manageItem"
    ? {
        type,
        tenantId,
        operation,
        ...(typeof id === "string" ? { itemId: id.toLowerCase() } : {}),
        values: values as ItemValues,
        clientRequestId,
      }
    : {
        type,
        tenantId,
        operation,
        ...(typeof id === "string" ? { locationId: id.toLowerCase() } : {}),
        values: values as LocationValues,
        clientRequestId,
      };
}

/** Parses only documented, allowlisted command shapes. */
export function parseAction(value: unknown): Action | null {
  if (
    !isRecord(value) ||
    !isUuid(value.tenantId) ||
    typeof value.type !== "string"
  ) {
    return null;
  }
  const tenantId = value.tenantId.toLowerCase();
  if (value.type === "workspace") {
    return hasOnlyKeys(value, ["type", "tenantId"])
      ? { type: value.type, tenantId }
      : null;
  }
  if (
    value.type === "listOpenReservations" ||
    value.type === "listActiveCounts"
  ) {
    return hasOnlyKeys(value, ["type", "tenantId"])
      ? { type: value.type, tenantId }
      : null;
  }
  if (value.type === "lookupCode") {
    if (!hasOnlyKeys(value, ["type", "tenantId", "code"])) return null;
    const code = validText(value.code, 1, MAX_CODE_LENGTH);
    return code === null
      ? null
      : { type: value.type, tenantId, code: code.toLowerCase() };
  }
  if (value.type === "manageItem" || value.type === "manageLocation") {
    return parseManageAction({ ...value, tenantId }, value.type);
  }
  if (value.type === "postMovement") {
    const movementType = value.movementType;
    if (
      typeof movementType !== "string" ||
      !Object.hasOwn(MOVEMENT_PERMISSIONS, movementType) ||
      !isUuid(value.clientRequestId)
    ) {
      return null;
    }
    if (Object.hasOwn(value, "reservationId")) {
      return movementType === "issue" &&
        hasOnlyKeys(value, [
          "type",
          "tenantId",
          "movementType",
          "reservationId",
          "clientRequestId",
        ]) &&
        isUuid(value.reservationId)
        ? {
            type: value.type,
            tenantId,
            movementType: "issue",
            reservationId: value.reservationId.toLowerCase(),
            clientRequestId: value.clientRequestId.toLowerCase(),
          }
        : null;
    }
    if (!isUuid(value.itemId)) return null;
    const quantity = validPositiveQuantity(value.quantity);
    const requiresFrom =
      movementType === "issue" ||
      movementType === "transfer" ||
      movementType === "defect" ||
      movementType === "loss" ||
      movementType === "adjustment_out";
    const requiresTo =
      movementType === "receipt" ||
      movementType === "transfer" ||
      movementType === "adjustment_in";
    const allowed = [
      "type",
      "tenantId",
      "itemId",
      "movementType",
      "quantity",
      "clientRequestId",
      ...(requiresFrom ? ["fromLocationId"] : []),
      ...(requiresTo ? ["toLocationId"] : []),
    ];
    // ticketId is intentionally not allowlisted: migration 0068 tracks a ticket
    // only on reservations, never on an arbitrary movement.
    if (!hasOnlyKeys(value, allowed)) return null;
    const fromLocationId = validOptionalUuid(value.fromLocationId);
    const toLocationId = validOptionalUuid(value.toLocationId);
    if (
      quantity === null ||
      fromLocationId === null ||
      toLocationId === null ||
      (requiresFrom && fromLocationId === undefined) ||
      (requiresTo && toLocationId === undefined) ||
      (movementType === "transfer" && fromLocationId === toLocationId)
    ) {
      return null;
    }
    return {
      type: value.type,
      tenantId,
      itemId: value.itemId.toLowerCase(),
      movementType: movementType as MovementType,
      quantity,
      ...(fromLocationId ? { fromLocationId } : {}),
      ...(toLocationId ? { toLocationId } : {}),
      clientRequestId: value.clientRequestId.toLowerCase(),
    };
  }
  if (value.type === "reserve") {
    if (
      !hasOnlyKeys(value, [
        "type",
        "tenantId",
        "itemId",
        "locationId",
        "quantity",
        "ticketId",
        "serialUnitId",
        "note",
        "clientRequestId",
      ]) ||
      !isUuid(value.itemId) ||
      !isUuid(value.locationId) ||
      !isUuid(value.clientRequestId)
    ) {
      return null;
    }
    const quantity = validPositiveQuantity(value.quantity);
    const ticketId = validOptionalUuid(value.ticketId);
    const serialUnitId = validOptionalUuid(value.serialUnitId);
    if (
      quantity === null ||
      ticketId === null ||
      serialUnitId === null ||
      (Object.hasOwn(value, "note") && validText(value.note, 0, 2_000) === null)
    ) {
      return null;
    }
    return {
      type: value.type,
      tenantId,
      itemId: value.itemId.toLowerCase(),
      locationId: value.locationId.toLowerCase(),
      quantity,
      ...(ticketId ? { ticketId } : {}),
      ...(serialUnitId ? { serialUnitId } : {}),
      clientRequestId: value.clientRequestId.toLowerCase(),
    };
  }
  if (value.type === "releaseReservation") {
    return hasOnlyKeys(value, [
      "type",
      "tenantId",
      "reservationId",
      "clientRequestId",
    ]) &&
      isUuid(value.reservationId) &&
      isUuid(value.clientRequestId)
      ? {
          type: value.type,
          tenantId,
          reservationId: value.reservationId.toLowerCase(),
          clientRequestId: value.clientRequestId.toLowerCase(),
        }
      : null;
  }
  if (value.type === "startCount") {
    return hasOnlyKeys(value, [
      "type",
      "tenantId",
      "locationId",
      "clientRequestId",
    ]) &&
      isUuid(value.locationId) &&
      isUuid(value.clientRequestId)
      ? {
          type: value.type,
          tenantId,
          locationId: value.locationId.toLowerCase(),
          clientRequestId: value.clientRequestId.toLowerCase(),
        }
      : null;
  }
  if (value.type === "recordCountLine") {
    const countedQuantity = validNonNegativeQuantity(value.countedQuantity);
    return hasOnlyKeys(value, [
      "type",
      "tenantId",
      "countId",
      "itemId",
      "countedQuantity",
      "clientRequestId",
    ]) &&
      isUuid(value.countId) &&
      isUuid(value.itemId) &&
      countedQuantity !== null &&
      isUuid(value.clientRequestId)
      ? {
          type: value.type,
          tenantId,
          countId: value.countId.toLowerCase(),
          itemId: value.itemId.toLowerCase(),
          countedQuantity,
          clientRequestId: value.clientRequestId.toLowerCase(),
        }
      : null;
  }
  if (value.type === "closeCount") {
    return hasOnlyKeys(value, [
      "type",
      "tenantId",
      "countId",
      "clientRequestId",
    ]) &&
      isUuid(value.countId) &&
      isUuid(value.clientRequestId)
      ? {
          type: value.type,
          tenantId,
          countId: value.countId.toLowerCase(),
          clientRequestId: value.clientRequestId.toLowerCase(),
        }
      : null;
  }
  return null;
}

/** CORS is intentionally pinned to the production application origin. */
export function corsHeaders(request: Request): Headers {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    Vary: "Origin",
  });
  if (request.headers.get("origin") === ALLOWED_ORIGIN) {
    headers.set("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    headers.set(
      "Access-Control-Allow-Headers",
      "authorization, apikey, content-type, x-client-info",
    );
  }
  return headers;
}

function json(request: Request, body: Row, status = 200): Response {
  const headers = corsHeaders(request);
  if (status === 405) headers.set("Allow", "POST, OPTIONS");
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers,
  });
}

function failure(request: Request, error: HttpError): Response {
  return json(
    request,
    { error: { code: error.code, message: error.message } },
    error.status,
  );
}

function databaseFailure(error: { code?: unknown } | null): never {
  const code = typeof error?.code === "string" ? error.code : "";
  if (["42P01", "42883", "PGRST202", "PGRST204", "PGRST205"].includes(code)) {
    throw new HttpError(
      503,
      "inventory_not_configured",
      "Das Lager-Modul ist noch nicht bereitgestellt.",
    );
  }
  if (code === "23505") {
    throw new HttpError(409, "conflict", "Der Eintrag besteht bereits.");
  }
  if (code === "P0002") {
    throw new HttpError(404, "not_found", "Der Eintrag wurde nicht gefunden.");
  }
  if (
    [
      "23503",
      "23514",
      "23502",
      "22001",
      "22021",
      "22023",
      "22P02",
      "22P05",
    ].includes(code)
  ) {
    throw new HttpError(
      422,
      "invalid_data",
      "Die Angaben sind nicht zulässig.",
    );
  }
  if (code === "42501") {
    throw new HttpError(
      403,
      "permission_denied",
      "Für diese Aktion fehlt die Berechtigung.",
    );
  }
  throw new HttpError(
    500,
    "operation_failed",
    "Die Aktion konnte nicht abgeschlossen werden.",
  );
}

async function requireActiveMembership(
  client: CallerClient,
  tenantId: string,
): Promise<void> {
  const result = await client.rpc("is_active_tenant_member", {
    p_tenant_id: tenantId,
  });
  if (result.error || typeof result.data !== "boolean") {
    throw new HttpError(
      503,
      "authorization_check_failed",
      "Die Mandantenmitgliedschaft konnte nicht geprüft werden.",
    );
  }
  if (!result.data) {
    throw new HttpError(
      403,
      "tenant_membership_required",
      "Eine aktive Mandantenmitgliedschaft ist erforderlich.",
    );
  }
}

async function permissionState(
  client: CallerClient,
  tenantId: string,
  permission: TenantPermission,
): Promise<boolean> {
  const result = await client.rpc("has_tenant_permission", {
    p_tenant_id: tenantId,
    p_permission_code: permission,
  });
  if (result.error || typeof result.data !== "boolean") {
    throw new HttpError(
      503,
      "authorization_check_failed",
      "Die Berechtigung konnte nicht geprüft werden.",
    );
  }
  return result.data;
}

/**
 * Asset candidates are an optional cross-module extension of an inventory
 * lookup. All three server-authorized states must be true before any asset
 * identifier or asset table query is allowed.
 */
export function shouldIncludeAssetCandidates(input: {
  inventoryRead: boolean;
  assetsManagementEnabled: boolean;
  assetManageGranted: boolean;
}): boolean {
  return (
    input.inventoryRead &&
    input.assetsManagementEnabled &&
    input.assetManageGranted
  );
}

async function canIncludeAssetCandidates(
  client: CallerClient,
  admin: AdminClient,
  tenantId: string,
): Promise<boolean> {
  const featureStates = await resolveTenantFeatureStates(admin, tenantId, [
    ASSET_FEATURE,
  ]);
  if (featureStates === null) {
    throw new HttpError(
      503,
      "tenant_feature_lookup_failed",
      "Die Funktionsfreigabe konnte nicht geprüft werden.",
    );
  }
  const assetsManagementEnabled = featureStates[ASSET_FEATURE] === true;
  const assetManageGranted = assetsManagementEnabled
    ? await permissionState(client, tenantId, "asset.manage")
    : false;
  return shouldIncludeAssetCandidates({
    inventoryRead: true,
    assetsManagementEnabled,
    assetManageGranted,
  });
}

async function requirePermission(
  client: CallerClient,
  tenantId: string,
  permission: InventoryPermission,
): Promise<void> {
  if (!(await permissionState(client, tenantId, permission))) {
    throw new HttpError(
      403,
      `${permission.replaceAll(".", "_")}_required`,
      "Für diese Aktion fehlt die Berechtigung.",
    );
  }
}

async function requireAnyPermission(
  client: CallerClient,
  tenantId: string,
  permissions: readonly InventoryPermission[],
  code: string,
): Promise<void> {
  const granted = await Promise.all(
    permissions.map((permission) =>
      permissionState(client, tenantId, permission),
    ),
  );
  if (!granted.some(Boolean)) {
    throw new HttpError(403, code, "Für diese Aktion fehlt die Berechtigung.");
  }
}

async function workspacePermissions(
  client: CallerClient,
  tenantId: string,
): Promise<{
  canRead: boolean;
  canManage: boolean;
  canMove: boolean;
  canAdjust: boolean;
  canCloseInventoryCount: boolean;
}> {
  const [canRead, canManage, canMove, canAdjust, canCloseInventoryCount] =
    await Promise.all(
      INVENTORY_PERMISSIONS.map((permission) =>
        permissionState(client, tenantId, permission),
      ),
    );
  return { canRead, canManage, canMove, canAdjust, canCloseInventoryCount };
}

async function requireEnabledInventory(
  client: CallerClient,
  admin: AdminClient,
  tenantId: string,
): Promise<void> {
  await requireActiveMembership(client, tenantId);
  const states = await resolveTenantFeatureStates(admin, tenantId, [FEATURE]);
  if (!states) {
    throw new HttpError(
      503,
      "tenant_feature_lookup_failed",
      "Die Funktionsfreigabe konnte nicht geprüft werden.",
    );
  }
  if (states[FEATURE] !== true) {
    throw new HttpError(
      403,
      "inventory_feature_disabled",
      "Das Lager-Modul ist für diesen Mandanten deaktiviert.",
    );
  }
}

async function serviceRpc(
  admin: AdminClient,
  name: string,
  params: Record<string, JsonValue>,
): Promise<unknown> {
  const result = await admin.rpc(name, params);
  if (result.error) databaseFailure(result.error);
  return result.data;
}

type QueryResult = { data: unknown; error: { code?: unknown } | null };
type CountQueryResult = QueryResult & { count?: unknown };

async function serviceRows(
  query: PromiseLike<QueryResult>,
): Promise<unknown[]> {
  const result = await query;
  if (result.error) databaseFailure(result.error);
  if (!Array.isArray(result.data)) {
    throw new HttpError(
      503,
      "inventory_contract_invalid",
      "Die Lagerdaten konnten nicht sicher gelesen werden.",
    );
  }
  return result.data;
}

async function serviceCount(
  query: PromiseLike<CountQueryResult>,
): Promise<number> {
  const result = await query;
  if (result.error) databaseFailure(result.error);
  return typeof result.count === "number" &&
    Number.isSafeInteger(result.count) &&
    result.count >= 0
    ? result.count
    : (() => {
        throw new HttpError(
          503,
          "inventory_contract_invalid",
          "Die Lagerdaten konnten nicht sicher gelesen werden.",
        );
      })();
}

function requiredUuid(value: unknown): string | typeof INVALID {
  return isUuid(value) ? value.toLowerCase() : INVALID;
}

function requiredText(
  value: unknown,
  minimum: number,
  maximum: number,
): string | typeof INVALID {
  return validText(value, minimum, maximum) ?? INVALID;
}

function requiredNullableText(
  value: unknown,
  minimum: number,
  maximum: number,
): string | null | typeof INVALID {
  if (value === null) return null;
  return requiredText(value, minimum, maximum);
}

function sourceNumber(
  value: unknown,
  nonNegative: boolean,
): number | typeof INVALID {
  const number =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(number) &&
    Math.abs(number) <= MAX_QUANTITY &&
    (!nonNegative || number >= 0)
    ? number
    : INVALID;
}

function sourceCount(value: unknown): number | typeof INVALID {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : INVALID;
}

type ItemSeed = {
  id: string;
  name: string;
  articleNumber: string | null;
  unit: string;
  trackingMode: TrackingMode;
  minQuantity: number;
  targetQuantity: number;
  active: boolean;
};

type BalanceSeed = {
  itemId: string;
  locationId: string;
  physicalQuantity: number;
  reservedQuantity: number;
};

type EventSeed = { id: string; eventType: string; occurredAt: string };
type EventLineSeed = {
  id: string;
  eventId: string;
  itemId: string;
  locationId: string;
  physicalDelta: number;
  reservedDelta: number;
};

function workspaceItemSeed(value: unknown): ItemSeed | typeof INVALID {
  if (!isRecord(value)) return INVALID;
  const id = requiredUuid(value.id);
  const name = requiredText(value.name, 1, 240);
  const articleNumber = requiredNullableText(value.article_number, 1, 160);
  const unit = requiredText(value.unit, 1, 32);
  const minQuantity = sourceNumber(value.minimum_quantity, true);
  const targetQuantity = sourceNumber(value.target_quantity, true);
  if (
    id === INVALID ||
    name === INVALID ||
    articleNumber === INVALID ||
    unit === INVALID ||
    minQuantity === INVALID ||
    targetQuantity === INVALID ||
    targetQuantity < minQuantity ||
    (value.tracking_mode !== "quantity" && value.tracking_mode !== "serial") ||
    typeof value.active !== "boolean"
  ) {
    return INVALID;
  }
  return {
    id,
    name,
    articleNumber,
    unit,
    trackingMode: value.tracking_mode,
    minQuantity,
    targetQuantity,
    active: value.active,
  };
}

function workspaceLocation(value: unknown): WorkspaceLocation | typeof INVALID {
  if (!isRecord(value)) return INVALID;
  const id = requiredUuid(value.id);
  const name = requiredText(value.name, 1, 160);
  const code = requiredNullableText(value.code, 1, 63);
  if (
    id === INVALID ||
    name === INVALID ||
    code === INVALID ||
    typeof value.active !== "boolean"
  ) {
    return INVALID;
  }
  return { id, name, code, active: value.active };
}

function balanceSeed(value: unknown): BalanceSeed | typeof INVALID {
  if (!isRecord(value)) return INVALID;
  const itemId = requiredUuid(value.item_id);
  const locationId = requiredUuid(value.location_id);
  const physicalQuantity = sourceNumber(value.physical_quantity, true);
  const reservedQuantity = sourceNumber(value.reserved_quantity, true);
  if (
    itemId === INVALID ||
    locationId === INVALID ||
    physicalQuantity === INVALID ||
    reservedQuantity === INVALID ||
    reservedQuantity > physicalQuantity
  )
    return INVALID;
  return { itemId, locationId, physicalQuantity, reservedQuantity };
}

function eventSeed(value: unknown): EventSeed | typeof INVALID {
  if (!isRecord(value)) return INVALID;
  const id = requiredUuid(value.id);
  const occurredAt = requiredText(value.created_at, 1, 64);
  if (
    id === INVALID ||
    occurredAt === INVALID ||
    !Number.isFinite(Date.parse(occurredAt)) ||
    typeof value.event_type !== "string"
  )
    return INVALID;
  return { id, eventType: value.event_type, occurredAt };
}

function eventLineSeed(value: unknown): EventLineSeed | typeof INVALID {
  if (!isRecord(value)) return INVALID;
  const id = requiredUuid(value.id);
  const eventId = requiredUuid(value.event_id);
  const itemId = requiredUuid(value.item_id);
  const locationId = requiredUuid(value.location_id);
  const physicalDelta = sourceNumber(value.physical_delta, false);
  const reservedDelta = sourceNumber(value.reserved_delta, false);
  if (
    id === INVALID ||
    eventId === INVALID ||
    itemId === INVALID ||
    locationId === INVALID ||
    physicalDelta === INVALID ||
    reservedDelta === INVALID
  )
    return INVALID;
  return { id, eventId, itemId, locationId, physicalDelta, reservedDelta };
}

function safeArray<T>(
  value: unknown,
  mapper: (row: unknown) => T | typeof INVALID,
  maximum: number,
): T[] | typeof INVALID {
  if (!Array.isArray(value) || value.length > maximum) return INVALID;
  const mapped: T[] = [];
  for (const row of value) {
    const result = mapper(row);
    if (result === INVALID) return INVALID;
    mapped.push(result);
  }
  return mapped;
}

function publicEventType(value: string): string | null {
  const types: Record<string, string> = {
    movement_receipt: "receipt",
    movement_issue: "issue",
    movement_transfer: "transfer",
    movement_adjustment: "adjustment",
    reservation_hold: "reservation_hold",
    reservation_release: "reservation_release",
    count_adjustment: "inventory_count_post",
  };
  return types[value] ?? null;
}

/**
 * Final fail-closed mapper for the strict web/iOS workspace contract. Its input
 * may contain only service-role table projections; it never copies source rows.
 */
export function toWorkspaceContract(
  value: unknown,
  permissions: InventoryPermissions,
): InventoryWorkspace | null {
  if (!isRecord(value)) return null;
  const items = safeArray(value.items, workspaceItemSeed, MAX_ITEMS);
  const locations = safeArray(
    value.locations,
    workspaceLocation,
    MAX_LOCATIONS,
  );
  const balances = safeArray(value.balances, balanceSeed, MAX_BALANCES);
  const events = safeArray(value.events, eventSeed, MAX_EVENTS);
  const eventLines = safeArray(
    value.eventLines,
    eventLineSeed,
    MAX_EVENT_LINES,
  );
  const recentEventsHasMore = value.recentEventsHasMore;
  const openReservationCount = sourceCount(value.openReservationCount);
  const activeCountSessionCount = sourceCount(value.activeCountSessionCount);
  if (
    items === INVALID ||
    locations === INVALID ||
    balances === INVALID ||
    events === INVALID ||
    eventLines === INVALID ||
    openReservationCount === INVALID ||
    activeCountSessionCount === INVALID ||
    typeof recentEventsHasMore !== "boolean"
  )
    return null;

  const itemById = new Map(items.map((item) => [item.id, item]));
  const locationById = new Map(
    locations.map((location) => [location.id, location]),
  );
  const totals = new Map<
    string,
    {
      physicalQuantity: number;
      reservedQuantity: number;
      locations: Set<string>;
    }
  >();
  for (const balance of balances) {
    if (!itemById.has(balance.itemId) || !locationById.has(balance.locationId))
      return null;
    const total = totals.get(balance.itemId) ?? {
      physicalQuantity: 0,
      reservedQuantity: 0,
      locations: new Set<string>(),
    };
    total.physicalQuantity += balance.physicalQuantity;
    total.reservedQuantity += balance.reservedQuantity;
    if (
      !Number.isFinite(total.physicalQuantity) ||
      !Number.isFinite(total.reservedQuantity) ||
      total.reservedQuantity > total.physicalQuantity ||
      total.physicalQuantity > MAX_QUANTITY ||
      total.reservedQuantity > MAX_QUANTITY
    )
      return null;
    total.locations.add(balance.locationId);
    totals.set(balance.itemId, total);
  }

  const publicItems: WorkspaceItem[] = items.map((item) => {
    const total = totals.get(item.id);
    const physicalQuantity = total?.physicalQuantity ?? 0;
    const reservedQuantity = total?.reservedQuantity ?? 0;
    const locationId =
      total && total.locations.size === 1 ? [...total.locations][0] : undefined;
    return {
      id: item.id,
      name: item.name,
      articleNumber: item.articleNumber,
      unit: item.unit,
      trackingMode: item.trackingMode,
      physicalQuantity,
      reservedQuantity,
      availableQuantity: physicalQuantity - reservedQuantity,
      minQuantity: item.minQuantity,
      targetQuantity: item.targetQuantity,
      locationName: locationId
        ? (locationById.get(locationId)?.name ?? null)
        : null,
      active: item.active,
    };
  });
  const lowStockItems = publicItems.filter(
    (item) => item.active && item.availableQuantity <= item.minQuantity,
  );

  const eventById = new Map(events.map((event) => [event.id, event]));
  const publicEvents: Array<RecentEvent & { eventTime: number }> = [];
  for (const line of eventLines) {
    const event = eventById.get(line.eventId);
    const item = itemById.get(line.itemId);
    const location = locationById.get(line.locationId);
    const type = event ? publicEventType(event.eventType) : null;
    if (!event || !item || !location || !type) return null;
    publicEvents.push({
      id: line.id,
      type,
      occurredAt: event.occurredAt,
      itemName: item.name,
      physicalDelta: line.physicalDelta,
      reservedDelta: line.reservedDelta,
      locationName: location.name,
      eventTime: Date.parse(event.occurredAt),
    });
  }
  publicEvents.sort(
    (left, right) =>
      right.eventTime - left.eventTime || left.id.localeCompare(right.id),
  );
  const recentEvents: RecentEvent[] = publicEvents.map(
    ({ eventTime: _eventTime, ...event }) => event,
  );

  return {
    permissions: {
      canRead: true,
      canManage: permissions.canManage,
      canMove: permissions.canMove,
      canAdjust: permissions.canAdjust,
      canCloseInventoryCount: permissions.canCloseInventoryCount,
    },
    summary: {
      criticalItemCount: lowStockItems.length,
      openReservationCount,
      activeCountSessionCount,
    },
    items: publicItems,
    locations,
    recentEvents,
    recentEventsHasMore,
    lowStockItems,
  };
}

function lookupNamedResource(
  value: unknown,
): LookupNamedResource | typeof INVALID {
  if (!isRecord(value)) return INVALID;
  const id = requiredUuid(value.id);
  const name = requiredText(value.name, 1, 240);
  return id === INVALID || name === INVALID ? INVALID : { id, name };
}

/** Maps lookup data while excluding all scanned codes, notes and audit columns. */
export function toLookupCodeResult(value: unknown): LookupCodeResult | null {
  if (!isRecord(value) || typeof value.kind !== "string") return null;
  if (value.kind === "not_found") return { kind: "not_found" };
  if (value.kind === "inventory_item") {
    const item = lookupNamedResource(value.item);
    return item === INVALID ? null : { kind: "inventory_item", item };
  }
  if (value.kind === "asset") {
    const asset = lookupNamedResource(value.asset);
    return asset === INVALID ? null : { kind: "asset", asset };
  }
  if (value.kind === "ambiguous") {
    if (
      !Array.isArray(value.candidates) ||
      value.candidates.length === 0 ||
      value.candidates.length > 20
    )
      return null;
    const candidates: LookupCandidate[] = [];
    for (const candidate of value.candidates) {
      if (
        !isRecord(candidate) ||
        (candidate.kind !== "inventory_item" && candidate.kind !== "asset")
      )
        return null;
      const resource = lookupNamedResource(candidate);
      if (resource === INVALID) return null;
      candidates.push({ kind: candidate.kind, ...resource });
    }
    return { kind: "ambiguous", candidates };
  }
  return null;
}

type ReservationSeed = {
  id: string;
  itemId: string;
  locationId: string;
  quantity: number;
  createdAt: string;
};

type CountSeed = {
  id: string;
  locationId: string;
  status: "draft" | "counting";
  startedAt: string;
};

function reservationSeed(value: unknown): ReservationSeed | typeof INVALID {
  if (!isRecord(value)) return INVALID;
  const id = requiredUuid(value.id);
  const itemId = requiredUuid(value.item_id);
  const locationId = requiredUuid(value.location_id);
  const quantity = sourceNumber(value.quantity, true);
  const createdAt = requiredText(value.created_at, 1, 64);
  if (
    id === INVALID ||
    itemId === INVALID ||
    locationId === INVALID ||
    quantity === INVALID ||
    quantity <= 0 ||
    !hasThreeOrFewerDecimalPlaces(quantity) ||
    createdAt === INVALID ||
    !Number.isFinite(Date.parse(createdAt))
  )
    return INVALID;
  return { id, itemId, locationId, quantity, createdAt };
}

function activeCountSeed(value: unknown): CountSeed | typeof INVALID {
  if (!isRecord(value)) return INVALID;
  const id = requiredUuid(value.id);
  const locationId = requiredUuid(value.location_id);
  const startedAt = requiredText(value.started_at, 1, 64);
  if (
    id === INVALID ||
    locationId === INVALID ||
    startedAt === INVALID ||
    (value.status !== "draft" && value.status !== "counting") ||
    !Number.isFinite(Date.parse(startedAt))
  )
    return INVALID;
  return { id, locationId, status: value.status, startedAt };
}

function namedResourceMap(
  value: unknown,
  maximum: number,
): Map<string, LookupNamedResource> | typeof INVALID {
  const rows = safeArray(value, lookupNamedResource, maximum);
  if (rows === INVALID) return INVALID;
  const resources = new Map<string, LookupNamedResource>();
  for (const row of rows) {
    if (resources.has(row.id)) return INVALID;
    resources.set(row.id, row);
  }
  return resources;
}

/** Maps tenant-filtered reservation rows without tickets, notes, scans or audit data. */
export function toOpenReservationsContract(
  value: unknown,
): OpenReservation[] | null {
  if (!isRecord(value)) return null;
  const reservations = safeArray(
    value.reservations,
    reservationSeed,
    MAX_RESERVATIONS,
  );
  const items = namedResourceMap(value.items, MAX_RESERVATIONS);
  const locations = namedResourceMap(value.locations, MAX_RESERVATIONS);
  if (reservations === INVALID || items === INVALID || locations === INVALID) {
    return null;
  }
  const itemIds = new Set(
    reservations.map((reservation) => reservation.itemId),
  );
  const locationIds = new Set(
    reservations.map((reservation) => reservation.locationId),
  );
  if (items.size !== itemIds.size || locations.size !== locationIds.size) {
    return null;
  }
  const result: OpenReservation[] = [];
  for (const reservation of reservations) {
    const item = items.get(reservation.itemId);
    const location = locations.get(reservation.locationId);
    if (!item || !location) return null;
    result.push({
      id: reservation.id,
      itemName: item.name,
      locationName: location.name,
      quantity: reservation.quantity,
      createdAt: reservation.createdAt,
    });
  }
  return result;
}

/** Maps tenant-filtered active counts to the exact UI contract, excluding count lines and audit data. */
export function toActiveCountsContract(
  value: unknown,
): ActiveInventoryCount[] | null {
  if (!isRecord(value)) return null;
  const counts = safeArray(value.counts, activeCountSeed, MAX_ACTIVE_COUNTS);
  const locations = namedResourceMap(value.locations, MAX_LOCATIONS);
  if (counts === INVALID || locations === INVALID) return null;
  const locationIds = new Set(counts.map((count) => count.locationId));
  if (locations.size !== locationIds.size) return null;
  const result: ActiveInventoryCount[] = [];
  for (const count of counts) {
    const location = locations.get(count.locationId);
    if (!location) return null;
    result.push({
      id: count.id,
      locationName: location.name,
      status: count.status,
      startedAt: count.startedAt,
    });
  }
  return result;
}

function mutationReceipt(value: unknown): Row {
  if (isUuid(value)) return { accepted: true, id: value.toLowerCase() };
  if (isRecord(value) && isUuid(value.id)) {
    return { accepted: true, id: value.id.toLowerCase() };
  }
  return { accepted: true };
}

async function workspace(
  request: Request,
  client: CallerClient,
  admin: AdminClient,
  action: Extract<Action, { type: "workspace" }>,
): Promise<Response> {
  const states = await workspacePermissions(client, action.tenantId);
  if (!states.canRead) {
    throw new HttpError(
      403,
      "inventory_read_required",
      "Für diese Aktion fehlt die Berechtigung.",
    );
  }
  const permissions: InventoryPermissions = { ...states, canRead: true };
  const [
    items,
    locations,
    balances,
    eventRows,
    itemCount,
    locationCount,
    balanceCount,
    openReservationCount,
    activeCountSessionCount,
  ] = await Promise.all([
    serviceRows(
      admin
        .from("inventory_items")
        .select(
          "id,name,article_number,unit,tracking_mode,minimum_quantity,target_quantity,active",
        )
        .eq("tenant_id", action.tenantId)
        .order("name", { ascending: true })
        .limit(MAX_ITEMS + 1),
    ),
    serviceRows(
      admin
        .from("inventory_locations")
        .select("id,name,code,active")
        .eq("tenant_id", action.tenantId)
        .order("name", { ascending: true })
        .limit(MAX_LOCATIONS + 1),
    ),
    serviceRows(
      admin
        .from("inventory_stock_balances")
        .select("item_id,location_id,physical_quantity,reserved_quantity")
        .eq("tenant_id", action.tenantId)
        .limit(MAX_BALANCES + 1),
    ),
    serviceRows(
      admin
        .from("inventory_events")
        .select("id,event_type,created_at")
        .eq("tenant_id", action.tenantId)
        .order("created_at", {
          ascending: false,
        })
        .limit(MAX_EVENTS + 1),
    ),
    serviceCount(
      admin
        .from("inventory_items")
        .select("id", {
          count: "exact",
          head: true,
        })
        .eq("tenant_id", action.tenantId),
    ),
    serviceCount(
      admin
        .from("inventory_locations")
        .select("id", {
          count: "exact",
          head: true,
        })
        .eq("tenant_id", action.tenantId),
    ),
    serviceCount(
      admin
        .from("inventory_stock_balances")
        .select("item_id", {
          count: "exact",
          head: true,
        })
        .eq("tenant_id", action.tenantId),
    ),
    serviceCount(
      admin
        .from("inventory_reservations")
        .select("id", {
          count: "exact",
          head: true,
        })
        .eq("tenant_id", action.tenantId)
        .eq("status", "open"),
    ),
    serviceCount(
      admin
        .from("inventory_counts")
        .select("id", {
          count: "exact",
          head: true,
        })
        .eq("tenant_id", action.tenantId)
        .in("status", ["draft", "counting"]),
    ),
  ]);
  if (
    itemCount > MAX_ITEMS ||
    items.length > MAX_ITEMS ||
    locationCount > MAX_LOCATIONS ||
    locations.length > MAX_LOCATIONS ||
    balanceCount > MAX_BALANCES ||
    balances.length > MAX_BALANCES ||
    openReservationCount > MAX_RESERVATIONS ||
    activeCountSessionCount > MAX_ACTIVE_COUNTS
  ) {
    throw new HttpError(
      422,
      "inventory_workspace_limit_exceeded",
      "Die Lagerdaten können nicht sicher vollständig geladen werden.",
    );
  }
  const recentEventsHasMore = eventRows.length > MAX_EVENTS;
  const events = eventRows.slice(0, MAX_EVENTS);
  const eventIds = events.flatMap((event) =>
    isRecord(event) && isUuid(event.id) ? [event.id.toLowerCase()] : [],
  );
  if (eventIds.length !== events.length) {
    throw new HttpError(
      503,
      "inventory_contract_invalid",
      "Die Lagerdaten konnten nicht sicher gelesen werden.",
    );
  }
  const eventLines =
    eventIds.length === 0
      ? []
      : await serviceRows(
          admin
            .from("inventory_event_lines")
            .select(
              "id,event_id,item_id,location_id,physical_delta,reserved_delta",
            )
            .eq("tenant_id", action.tenantId)
            .in("event_id", eventIds)
            .limit(MAX_EVENT_LINES + 1),
        );
  const recentEventLinesHasMore = eventLines.length > MAX_EVENT_LINES;
  const data = toWorkspaceContract(
    {
      items: items.slice(0, MAX_ITEMS),
      locations: locations.slice(0, MAX_LOCATIONS),
      balances: balances.slice(0, MAX_BALANCES),
      events,
      eventLines: eventLines.slice(0, MAX_EVENT_LINES),
      recentEventsHasMore: recentEventsHasMore || recentEventLinesHasMore,
      openReservationCount,
      activeCountSessionCount,
    },
    permissions,
  );
  if (!data) {
    throw new HttpError(
      503,
      "inventory_contract_invalid",
      "Die Lagerdaten konnten nicht sicher gelesen werden.",
    );
  }
  return json(request, { data });
}

async function listOpenReservations(
  request: Request,
  admin: AdminClient,
  action: Extract<Action, { type: "listOpenReservations" }>,
): Promise<Response> {
  const reservationCount = await serviceCount(
    admin
      .from("inventory_reservations")
      .select("id", {
        count: "exact",
        head: true,
      })
      .eq("tenant_id", action.tenantId)
      .eq("status", "open"),
  );
  if (reservationCount > MAX_RESERVATIONS) {
    throw new HttpError(
      422,
      "inventory_list_limit_exceeded",
      "Die Lagerdaten können nicht sicher vollständig geladen werden.",
    );
  }
  const reservations = await serviceRows(
    admin
      .from("inventory_reservations")
      .select("id,item_id,location_id,quantity,created_at")
      .eq("tenant_id", action.tenantId)
      .eq("status", "open")
      .order("created_at", { ascending: true })
      .limit(MAX_RESERVATIONS + 1),
  );
  if (reservations.length > MAX_RESERVATIONS) {
    throw new HttpError(
      422,
      "inventory_list_limit_exceeded",
      "Die Lagerdaten können nicht sicher vollständig geladen werden.",
    );
  }
  const seeds: ReservationSeed[] = [];
  for (const reservation of reservations) {
    const seed = reservationSeed(reservation);
    if (seed === INVALID) {
      throw new HttpError(
        503,
        "inventory_contract_invalid",
        "Die Reservationen konnten nicht sicher gelesen werden.",
      );
    }
    seeds.push(seed);
  }
  const itemIds = [...new Set(seeds.map((seed) => seed.itemId))];
  const locationIds = [...new Set(seeds.map((seed) => seed.locationId))];
  const [items, locations] = await Promise.all([
    itemIds.length === 0
      ? Promise.resolve([] as unknown[])
      : serviceRows(
          admin
            .from("inventory_items")
            .select("id,name")
            .eq("tenant_id", action.tenantId)
            .in("id", itemIds)
            .limit(MAX_RESERVATIONS),
        ),
    locationIds.length === 0
      ? Promise.resolve([] as unknown[])
      : serviceRows(
          admin
            .from("inventory_locations")
            .select("id,name")
            .eq("tenant_id", action.tenantId)
            .in("id", locationIds)
            .limit(MAX_RESERVATIONS),
        ),
  ]);
  const data = toOpenReservationsContract({ reservations, items, locations });
  if (!data) {
    throw new HttpError(
      503,
      "inventory_contract_invalid",
      "Die Reservationen konnten nicht sicher gelesen werden.",
    );
  }
  return json(request, { data: { reservations: data } });
}

async function listActiveCounts(
  request: Request,
  admin: AdminClient,
  action: Extract<Action, { type: "listActiveCounts" }>,
): Promise<Response> {
  const activeCountSessionCount = await serviceCount(
    admin
      .from("inventory_counts")
      .select("id", {
        count: "exact",
        head: true,
      })
      .eq("tenant_id", action.tenantId)
      .in("status", ["draft", "counting"]),
  );
  if (activeCountSessionCount > MAX_ACTIVE_COUNTS) {
    throw new HttpError(
      422,
      "inventory_list_limit_exceeded",
      "Die Lagerdaten können nicht sicher vollständig geladen werden.",
    );
  }
  const counts = await serviceRows(
    admin
      .from("inventory_counts")
      .select("id,location_id,status,started_at")
      .eq("tenant_id", action.tenantId)
      .in("status", ["draft", "counting"])
      .order("started_at", { ascending: false })
      .limit(MAX_ACTIVE_COUNTS + 1),
  );
  if (counts.length > MAX_ACTIVE_COUNTS) {
    throw new HttpError(
      422,
      "inventory_list_limit_exceeded",
      "Die Lagerdaten können nicht sicher vollständig geladen werden.",
    );
  }
  const seeds: CountSeed[] = [];
  for (const count of counts) {
    const seed = activeCountSeed(count);
    if (seed === INVALID) {
      throw new HttpError(
        503,
        "inventory_contract_invalid",
        "Die Inventuren konnten nicht sicher gelesen werden.",
      );
    }
    seeds.push(seed);
  }
  const locationIds = [...new Set(seeds.map((seed) => seed.locationId))];
  const locations =
    locationIds.length === 0
      ? ([] as unknown[])
      : await serviceRows(
          admin
            .from("inventory_locations")
            .select("id,name")
            .eq("tenant_id", action.tenantId)
            .in("id", locationIds)
            .limit(MAX_LOCATIONS),
        );
  const data = toActiveCountsContract({ counts, locations });
  if (!data) {
    throw new HttpError(
      503,
      "inventory_contract_invalid",
      "Die Inventuren konnten nicht sicher gelesen werden.",
    );
  }
  return json(request, { data: { activeCounts: data } });
}

function lookupCandidateFromRows(
  kind: "inventory_item" | "asset",
  rows: unknown[],
): LookupCandidate[] | null {
  const result: LookupCandidate[] = [];
  for (const row of rows) {
    const resource = lookupNamedResource(row);
    if (resource === INVALID) return null;
    result.push({ kind, ...resource });
  }
  return result;
}

function lookupResourceIds(rows: unknown[], idColumn: string): string[] | null {
  const ids: string[] = [];
  for (const row of rows) {
    if (!isRecord(row) || !isUuid(row[idColumn])) return null;
    ids.push((row[idColumn] as string).toLowerCase());
  }
  return [...new Set(ids)];
}

async function lookupCode(
  request: Request,
  client: CallerClient,
  admin: AdminClient,
  action: Extract<Action, { type: "lookupCode" }>,
): Promise<Response> {
  await requirePermission(client, action.tenantId, "inventory.read");
  const includeAssetCandidates = await canIncludeAssetCandidates(
    client,
    admin,
    action.tenantId,
  );
  const [itemIdentifiers, articleItems, serialUnits, assetIdentifiers] =
    await Promise.all([
      serviceRows(
        admin
          .from("inventory_item_identifiers")
          .select("item_id")
          .eq("tenant_id", action.tenantId)
          .eq("canonical_value", action.code)
          .limit(MAX_LOOKUP_CANDIDATES + 1),
      ),
      serviceRows(
        admin
          .from("inventory_items")
          .select("id")
          .eq("tenant_id", action.tenantId)
          .eq("article_number", action.code)
          .limit(MAX_LOOKUP_CANDIDATES + 1),
      ),
      serviceRows(
        admin
          .from("inventory_serial_units")
          .select("item_id")
          .eq("tenant_id", action.tenantId)
          .eq("serial_number", action.code)
          .limit(MAX_LOOKUP_CANDIDATES + 1),
      ),
      includeAssetCandidates
        ? serviceRows(
            admin
              .from("asset_identifiers")
              .select("asset_id")
              .eq("tenant_id", action.tenantId)
              .eq("canonical_value", action.code)
              .limit(MAX_LOOKUP_CANDIDATES + 1),
          )
        : Promise.resolve([] as unknown[]),
    ]);
  const identifierItemIds = lookupResourceIds(itemIdentifiers, "item_id");
  const articleItemIds = lookupResourceIds(articleItems, "id");
  const serialItemIds = lookupResourceIds(serialUnits, "item_id");
  const assetIds = lookupResourceIds(assetIdentifiers, "asset_id");
  if (!identifierItemIds || !articleItemIds || !serialItemIds || !assetIds) {
    throw new HttpError(
      503,
      "inventory_contract_invalid",
      "Der Scan konnte nicht sicher ausgewertet werden.",
    );
  }
  const itemIds = [
    ...new Set([...identifierItemIds, ...articleItemIds, ...serialItemIds]),
  ];
  if (itemIds.length + assetIds.length > MAX_LOOKUP_CANDIDATES) {
    throw new HttpError(
      422,
      "lookup_ambiguous",
      "Der Scan ist nicht eindeutig.",
    );
  }
  const [itemRows, assetRows] = await Promise.all([
    itemIds.length === 0
      ? Promise.resolve([] as unknown[])
      : serviceRows(
          admin
            .from("inventory_items")
            .select("id,name")
            .eq("tenant_id", action.tenantId)
            .in("id", itemIds)
            .limit(MAX_LOOKUP_CANDIDATES),
        ),
    !includeAssetCandidates || assetIds.length === 0
      ? Promise.resolve([] as unknown[])
      : serviceRows(
          admin
            .from("assets")
            .select("id,name")
            .eq("tenant_id", action.tenantId)
            .in("id", assetIds)
            .limit(MAX_LOOKUP_CANDIDATES),
        ),
  ]);
  const itemCandidates = lookupCandidateFromRows("inventory_item", itemRows);
  const assetCandidates = lookupCandidateFromRows("asset", assetRows);
  if (
    !itemCandidates ||
    !assetCandidates ||
    itemCandidates.length !== itemIds.length ||
    assetCandidates.length !== assetIds.length
  ) {
    throw new HttpError(
      503,
      "inventory_contract_invalid",
      "Der Scan konnte nicht sicher ausgewertet werden.",
    );
  }
  const candidates = [...itemCandidates, ...assetCandidates];
  const data =
    candidates.length === 0
      ? { kind: "not_found" as const }
      : candidates.length === 1 && candidates[0].kind === "inventory_item"
        ? {
            kind: "inventory_item" as const,
            item: { id: candidates[0].id, name: candidates[0].name },
          }
        : candidates.length === 1
          ? {
              kind: "asset" as const,
              asset: { id: candidates[0].id, name: candidates[0].name },
            }
          : { kind: "ambiguous" as const, candidates };
  const safeData = toLookupCodeResult(data);
  if (!safeData) {
    throw new HttpError(
      503,
      "inventory_contract_invalid",
      "Der Scan konnte nicht sicher ausgewertet werden.",
    );
  }
  return json(request, { data: safeData });
}

type StoredItem = {
  articleNumber: string;
  name: string;
  category: string;
  unit: string;
  trackingMode: TrackingMode;
  minimumStock: number;
  targetStock: number;
  manufacturer: string | null;
  model: string | null;
  supplier: string | null;
  privateNote: string | null;
  active: boolean;
};

type StoredLocation = { code: string; name: string; active: boolean };

function storedItem(value: unknown): StoredItem | null {
  if (!isRecord(value)) return null;
  const parsed = parseItemValues({
    articleNumber: value.article_number,
    name: value.name,
    category: value.category,
    unit: value.unit,
    trackingMode: value.tracking_mode,
    minimumStock:
      typeof value.minimum_quantity === "string"
        ? Number(value.minimum_quantity)
        : value.minimum_quantity,
    targetStock:
      typeof value.target_quantity === "string"
        ? Number(value.target_quantity)
        : value.target_quantity,
    manufacturer: value.manufacturer,
    model: value.model,
    supplier: value.supplier,
    privateNote: value.note,
    active: value.active,
  });
  return parsed && validItemCreate(parsed)
    ? {
        articleNumber: parsed.articleNumber!,
        name: parsed.name!,
        category: parsed.category!,
        unit: parsed.unit!,
        trackingMode: parsed.trackingMode!,
        minimumStock: parsed.minimumStock!,
        targetStock: parsed.targetStock!,
        manufacturer: parsed.manufacturer ?? null,
        model: parsed.model ?? null,
        supplier: parsed.supplier ?? null,
        privateNote: parsed.privateNote ?? null,
        active: parsed.active!,
      }
    : null;
}

function storedLocation(value: unknown): StoredLocation | null {
  if (!isRecord(value)) return null;
  const parsed = parseLocationValues({
    code: value.code,
    name: value.name,
    active: value.active,
  });
  return parsed &&
    Object.hasOwn(parsed, "code") &&
    Object.hasOwn(parsed, "name") &&
    Object.hasOwn(parsed, "active")
    ? { code: parsed.code!, name: parsed.name!, active: parsed.active! }
    : null;
}

function mergedItem(
  existing: StoredItem | undefined,
  values: ItemValues | undefined,
  archive: boolean,
): StoredItem | null {
  if (!existing && (!values || !validItemCreate(values))) return null;
  const pick = <K extends keyof StoredItem>(key: K): StoredItem[K] =>
    values && Object.hasOwn(values, key)
      ? (values[key as keyof ItemValues] as StoredItem[K])
      : (existing?.[key] as StoredItem[K]);
  const result: StoredItem = {
    articleNumber: pick("articleNumber"),
    name: pick("name"),
    category: pick("category"),
    unit: pick("unit"),
    trackingMode: pick("trackingMode"),
    minimumStock: pick("minimumStock"),
    targetStock: pick("targetStock"),
    manufacturer: pick("manufacturer"),
    model: pick("model"),
    supplier: pick("supplier"),
    privateNote: pick("privateNote"),
    active: archive
      ? false
      : values && Object.hasOwn(values, "active")
        ? values.active!
        : (existing?.active ?? true),
  };
  return result.targetStock >= result.minimumStock ? result : null;
}

function mergedLocation(
  existing: StoredLocation | undefined,
  values: LocationValues | undefined,
  archive: boolean,
): StoredLocation | null {
  if (
    !existing &&
    (!values ||
      !Object.hasOwn(values, "code") ||
      !Object.hasOwn(values, "name"))
  )
    return null;
  return {
    code:
      values && Object.hasOwn(values, "code") ? values.code! : existing!.code,
    name:
      values && Object.hasOwn(values, "name") ? values.name! : existing!.name,
    active: archive
      ? false
      : values && Object.hasOwn(values, "active")
        ? values.active!
        : (existing?.active ?? true),
  };
}

async function loadManagedItem(
  admin: AdminClient,
  tenantId: string,
  itemId: string,
): Promise<StoredItem> {
  const result = await admin
    .from("inventory_items")
    .select(
      "article_number,name,category,unit,tracking_mode,minimum_quantity,target_quantity,manufacturer,model,supplier,note,active",
    )
    .eq("tenant_id", tenantId)
    .eq("id", itemId)
    .maybeSingle();
  if (result.error) databaseFailure(result.error);
  const item = storedItem(result.data);
  if (!item) {
    throw new HttpError(404, "not_found", "Der Eintrag wurde nicht gefunden.");
  }
  return item;
}

async function loadManagedLocation(
  admin: AdminClient,
  tenantId: string,
  locationId: string,
): Promise<StoredLocation> {
  const result = await admin
    .from("inventory_locations")
    .select("code,name,active")
    .eq("tenant_id", tenantId)
    .eq("id", locationId)
    .maybeSingle();
  if (result.error) databaseFailure(result.error);
  const location = storedLocation(result.data);
  if (!location) {
    throw new HttpError(404, "not_found", "Der Eintrag wurde nicht gefunden.");
  }
  return location;
}

export function upsertItemRpcParameters(
  actorId: string,
  tenantId: string,
  clientRequestId: string,
  itemId: string | null,
  item: StoredItem,
): Record<string, JsonValue> {
  return {
    p_actor_id: actorId,
    p_tenant_id: tenantId,
    p_client_request_id: clientRequestId,
    p_item_id: itemId,
    p_article_number: item.articleNumber,
    p_name: item.name,
    p_category: item.category,
    p_unit: item.unit,
    p_tracking_mode: item.trackingMode,
    p_minimum_quantity: item.minimumStock,
    p_target_quantity: item.targetStock,
    p_manufacturer: item.manufacturer,
    p_model: item.model,
    p_supplier: item.supplier,
    p_note: item.privateNote,
    p_active: item.active,
  };
}

export function upsertLocationRpcParameters(
  actorId: string,
  tenantId: string,
  clientRequestId: string,
  locationId: string | null,
  location: StoredLocation,
): Record<string, JsonValue> {
  return {
    p_actor_id: actorId,
    p_tenant_id: tenantId,
    p_client_request_id: clientRequestId,
    p_location_id: locationId,
    p_code: location.code,
    p_name: location.name,
    p_active: location.active,
  };
}

async function manage(
  request: Request,
  admin: AdminClient,
  actorId: string,
  action: Extract<Action, { type: "manageItem" | "manageLocation" }>,
): Promise<Response> {
  if (action.type === "manageItem") {
    const existing =
      action.operation === "create"
        ? undefined
        : await loadManagedItem(admin, action.tenantId, action.itemId!);
    const item = mergedItem(
      existing,
      action.values,
      action.operation === "archive",
    );
    if (!item) {
      throw new HttpError(
        422,
        "invalid_data",
        "Die Angaben sind nicht zulässig.",
      );
    }
    if (
      (item.trackingMode === "serial" && existing?.trackingMode !== "serial") ||
      (existing?.trackingMode === "serial" && item.trackingMode !== "serial")
    ) {
      throw new HttpError(
        422,
        "serial_tracking_unavailable",
        "Seriengeführte Artikel können derzeit nicht neu angelegt oder umgestellt werden.",
      );
    }
    const raw = await serviceRpc(
      admin,
      INVENTORY_RPC_NAMES.upsertItem,
      upsertItemRpcParameters(
        actorId,
        action.tenantId,
        action.clientRequestId,
        action.operation === "create" ? null : action.itemId!,
        item,
      ),
    );
    return json(
      request,
      { data: mutationReceipt(raw) },
      action.operation === "create" ? 201 : 200,
    );
  }

  const existing =
    action.operation === "create"
      ? undefined
      : await loadManagedLocation(admin, action.tenantId, action.locationId!);
  const location = mergedLocation(
    existing,
    action.values,
    action.operation === "archive",
  );
  if (!location) {
    throw new HttpError(
      422,
      "invalid_data",
      "Die Angaben sind nicht zulässig.",
    );
  }
  const raw = await serviceRpc(
    admin,
    INVENTORY_RPC_NAMES.upsertLocation,
    upsertLocationRpcParameters(
      actorId,
      action.tenantId,
      action.clientRequestId,
      action.operation === "create" ? null : action.locationId!,
      location,
    ),
  );
  return json(
    request,
    { data: mutationReceipt(raw) },
    action.operation === "create" ? 201 : 200,
  );
}

export function movementRpcPayload(action: ResolvedPostMovementAction): {
  movementType: "receipt" | "issue" | "transfer" | "adjustment";
  lines: JsonValue[];
} {
  const base = {
    item_id: action.itemId,
    ...(action.serialUnitId ? { serial_unit_id: action.serialUnitId } : {}),
  };
  if (action.movementType === "receipt") {
    return {
      movementType: "receipt",
      lines: [
        {
          ...base,
          location_id: action.toLocationId!,
          quantity: action.quantity,
        },
      ],
    };
  }
  if (action.movementType === "issue") {
    return {
      movementType: "issue",
      lines: [
        {
          ...base,
          location_id: action.fromLocationId!,
          quantity: action.quantity,
        },
      ],
    };
  }
  if (action.movementType === "transfer") {
    return {
      movementType: "transfer",
      lines: [
        {
          ...base,
          from_location_id: action.fromLocationId!,
          to_location_id: action.toLocationId!,
          quantity: action.quantity,
        },
      ],
    };
  }
  const isPositive = action.movementType === "adjustment_in";
  return {
    movementType: "adjustment",
    lines: [
      {
        ...base,
        location_id: isPositive ? action.toLocationId! : action.fromLocationId!,
        physical_delta: isPositive ? action.quantity : -action.quantity,
      },
    ],
  };
}

function resolvedClientMovement(
  action: PostMovementAction,
): ResolvedPostMovementAction {
  if (!action.itemId || action.quantity === undefined || action.reservationId) {
    throw new HttpError(
      422,
      "invalid_data",
      "Die Angaben sind nicht zulässig.",
    );
  }
  return { ...action, itemId: action.itemId, quantity: action.quantity };
}

async function resolvedReservationIssue(
  admin: AdminClient,
  action: PostMovementAction,
): Promise<ResolvedPostMovementAction> {
  if (!action.reservationId || action.movementType !== "issue") {
    throw new HttpError(
      422,
      "invalid_data",
      "Die Angaben sind nicht zulässig.",
    );
  }
  const result = await admin
    .from("inventory_reservations")
    .select("id,item_id,location_id,serial_unit_id,quantity")
    .eq("tenant_id", action.tenantId)
    .eq("id", action.reservationId)
    .eq("status", "open")
    .maybeSingle();
  if (result.error) databaseFailure(result.error);
  const row = result.data;
  if (!isRecord(row)) {
    throw new HttpError(
      404,
      "not_found",
      "Die offene Reservation wurde nicht gefunden.",
    );
  }
  const id = requiredUuid(row.id);
  const itemId = requiredUuid(row.item_id);
  const locationId = requiredUuid(row.location_id);
  const quantity = sourceNumber(row.quantity, true);
  const serialUnitId =
    row.serial_unit_id === null ? undefined : requiredUuid(row.serial_unit_id);
  if (
    id === INVALID ||
    id !== action.reservationId ||
    itemId === INVALID ||
    locationId === INVALID ||
    quantity === INVALID ||
    quantity <= 0 ||
    !hasThreeOrFewerDecimalPlaces(quantity) ||
    serialUnitId === INVALID
  ) {
    throw new HttpError(
      503,
      "inventory_contract_invalid",
      "Die Reservation konnte nicht sicher verarbeitet werden.",
    );
  }
  return {
    ...action,
    itemId,
    quantity,
    fromLocationId: locationId,
    ...(serialUnitId ? { serialUnitId } : {}),
  };
}

/** Creates the migration RPC payload only after all line values are server-validated. */
export function movementRpcParameters(
  actorId: string,
  action: ResolvedPostMovementAction,
): Record<string, JsonValue> {
  const movement = movementRpcPayload(action);
  return {
    p_actor_id: actorId,
    p_tenant_id: action.tenantId,
    p_client_request_id: action.clientRequestId,
    p_movement_type: movement.movementType,
    p_lines: movement.lines,
    p_reservation_id: action.reservationId ?? null,
  };
}

async function postMovement(
  request: Request,
  admin: AdminClient,
  actorId: string,
  action: Extract<Action, { type: "postMovement" }>,
): Promise<Response> {
  const resolved = action.reservationId
    ? await resolvedReservationIssue(admin, action)
    : resolvedClientMovement(action);
  const raw = await serviceRpc(admin, INVENTORY_RPC_NAMES.postMovement, {
    ...movementRpcParameters(actorId, resolved),
  });
  return json(request, { data: mutationReceipt(raw) }, 201);
}

async function reserve(
  request: Request,
  admin: AdminClient,
  actorId: string,
  action: Extract<Action, { type: "reserve" }>,
): Promise<Response> {
  const raw = await serviceRpc(admin, INVENTORY_RPC_NAMES.createReservation, {
    p_actor_id: actorId,
    p_tenant_id: action.tenantId,
    p_client_request_id: action.clientRequestId,
    p_item_id: action.itemId,
    p_location_id: action.locationId,
    p_quantity: action.quantity,
    p_ticket_id: action.ticketId ?? null,
    p_serial_unit_id: action.serialUnitId ?? null,
  });
  return json(request, { data: mutationReceipt(raw) }, 201);
}

async function releaseReservation(
  request: Request,
  admin: AdminClient,
  actorId: string,
  action: Extract<Action, { type: "releaseReservation" }>,
): Promise<Response> {
  const raw = await serviceRpc(admin, INVENTORY_RPC_NAMES.releaseReservation, {
    p_actor_id: actorId,
    p_tenant_id: action.tenantId,
    p_client_request_id: action.clientRequestId,
    p_reservation_id: action.reservationId,
  });
  return json(request, { data: mutationReceipt(raw) });
}

async function startCount(
  request: Request,
  admin: AdminClient,
  actorId: string,
  action: Extract<Action, { type: "startCount" }>,
): Promise<Response> {
  const raw = await serviceRpc(admin, INVENTORY_RPC_NAMES.startCount, {
    p_actor_id: actorId,
    p_tenant_id: action.tenantId,
    p_client_request_id: action.clientRequestId,
    p_location_id: action.locationId,
  });
  return json(request, { data: mutationReceipt(raw) }, 201);
}

async function recordCountLine(
  request: Request,
  admin: AdminClient,
  actorId: string,
  action: Extract<Action, { type: "recordCountLine" }>,
): Promise<Response> {
  const raw = await serviceRpc(
    admin,
    INVENTORY_RPC_NAMES.recordCountLine,
    recordCountLineRpcParameters(actorId, action),
  );
  return json(request, { data: mutationReceipt(raw) });
}

export function recordCountLineRpcParameters(
  actorId: string,
  action: Extract<Action, { type: "recordCountLine" }>,
): Record<string, JsonValue> {
  return {
    p_actor_id: actorId,
    p_tenant_id: action.tenantId,
    p_client_request_id: action.clientRequestId,
    p_count_id: action.countId,
    p_item_id: action.itemId,
    p_counted_quantity: action.countedQuantity,
  };
}

async function closeCount(
  request: Request,
  admin: AdminClient,
  actorId: string,
  action: Extract<Action, { type: "closeCount" }>,
): Promise<Response> {
  const raw = await serviceRpc(admin, INVENTORY_RPC_NAMES.closeCount, {
    p_actor_id: actorId,
    p_tenant_id: action.tenantId,
    p_client_request_id: action.clientRequestId,
    p_count_id: action.countId,
  });
  return json(request, { data: mutationReceipt(raw) });
}

const securedHandler = withSupabase(
  { auth: "user", cors: "disabled", errors: { detailed: false } },
  async (request, context) => {
    try {
      const actorId = context.userClaims?.id;
      if (!isUuid(actorId)) {
        throw new HttpError(
          401,
          "authentication_required",
          "Eine gültige Benutzeranmeldung ist erforderlich.",
        );
      }
      const action = parseAction(await request.json().catch(() => null));
      if (!action) {
        throw new HttpError(
          400,
          "invalid_request",
          "Die Anfrage enthält ungültige oder unbekannte Felder.",
        );
      }
      await requireEnabledInventory(
        context.supabase,
        context.supabaseAdmin,
        action.tenantId,
      );
      if (action.type === "workspace") {
        return await workspace(
          request,
          context.supabase,
          context.supabaseAdmin,
          action,
        );
      }
      if (action.type === "listOpenReservations") {
        await requirePermission(
          context.supabase,
          action.tenantId,
          "inventory.move",
        );
        return await listOpenReservations(
          request,
          context.supabaseAdmin,
          action,
        );
      }
      if (action.type === "listActiveCounts") {
        await requireAnyPermission(
          context.supabase,
          action.tenantId,
          ["inventory.manage", "inventory.count.close"],
          "inventory_count_access_required",
        );
        return await listActiveCounts(request, context.supabaseAdmin, action);
      }
      if (action.type === "lookupCode") {
        return await lookupCode(
          request,
          context.supabase,
          context.supabaseAdmin,
          action,
        );
      }
      if (action.type === "manageItem" || action.type === "manageLocation") {
        await requirePermission(
          context.supabase,
          action.tenantId,
          "inventory.manage",
        );
        return await manage(
          request,
          context.supabaseAdmin,
          actorId.toLowerCase(),
          action,
        );
      }
      if (action.type === "postMovement") {
        await requirePermission(
          context.supabase,
          action.tenantId,
          MOVEMENT_PERMISSIONS[action.movementType],
        );
        return await postMovement(
          request,
          context.supabaseAdmin,
          actorId.toLowerCase(),
          action,
        );
      }
      if (action.type === "reserve" || action.type === "releaseReservation") {
        await requirePermission(
          context.supabase,
          action.tenantId,
          "inventory.move",
        );
        return action.type === "reserve"
          ? await reserve(
              request,
              context.supabaseAdmin,
              actorId.toLowerCase(),
              action,
            )
          : await releaseReservation(
              request,
              context.supabaseAdmin,
              actorId.toLowerCase(),
              action,
            );
      }
      if (action.type === "startCount" || action.type === "recordCountLine") {
        await requirePermission(
          context.supabase,
          action.tenantId,
          "inventory.manage",
        );
        return action.type === "startCount"
          ? await startCount(
              request,
              context.supabaseAdmin,
              actorId.toLowerCase(),
              action,
            )
          : await recordCountLine(
              request,
              context.supabaseAdmin,
              actorId.toLowerCase(),
              action,
            );
      }
      await requirePermission(
        context.supabase,
        action.tenantId,
        "inventory.count.close",
      );
      return await closeCount(
        request,
        context.supabaseAdmin,
        actorId.toLowerCase(),
        action,
      );
    } catch (error) {
      return failure(
        request,
        error instanceof HttpError
          ? error
          : new HttpError(
              500,
              "operation_failed",
              "Die Aktion konnte nicht abgeschlossen werden.",
            ),
      );
    }
  },
);

async function boundedRequest(request: Request): Promise<Request> {
  const contentLength = request.headers.get("content-length");
  if (
    contentLength !== null &&
    (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_REQUEST_BYTES)
  ) {
    throw new HttpError(413, "request_too_large", "Die Anfrage ist zu gross.");
  }
  if (!request.body) {
    throw new HttpError(
      400,
      "invalid_request",
      "Ein JSON-Objekt ist erforderlich.",
    );
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_REQUEST_BYTES) {
        await reader.cancel();
        throw new HttpError(
          413,
          "request_too_large",
          "Die Anfrage ist zu gross.",
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    throw new HttpError(
      400,
      "invalid_request",
      "Gültiges UTF-8-JSON ist erforderlich.",
    );
  }
  return new Request(request.url, {
    method: "POST",
    headers: request.headers,
    body,
    signal: request.signal,
  });
}

export default {
  async fetch(request: Request): Promise<Response> {
    const origin = request.headers.get("origin");
    if (origin !== null && origin !== ALLOWED_ORIGIN) {
      return failure(
        request,
        new HttpError(
          403,
          "origin_not_allowed",
          "Dieser Ursprung ist nicht erlaubt.",
        ),
      );
    }
    if (request.method === "OPTIONS") {
      if (origin !== ALLOWED_ORIGIN) {
        return failure(
          request,
          new HttpError(
            403,
            "origin_not_allowed",
            "Dieser Ursprung ist nicht erlaubt.",
          ),
        );
      }
      const requestedMethod = request.headers.get(
        "access-control-request-method",
      );
      if (requestedMethod !== null && requestedMethod !== "POST") {
        return failure(
          request,
          new HttpError(
            405,
            "method_not_allowed",
            "Nur POST-Anfragen sind erlaubt.",
          ),
        );
      }
      return json(request, {}, 204);
    }
    if (request.method !== "POST") {
      return failure(
        request,
        new HttpError(
          405,
          "method_not_allowed",
          "Nur POST-Anfragen sind erlaubt.",
        ),
      );
    }
    if (
      request.headers
        .get("content-type")
        ?.split(";")[0]
        .trim()
        .toLowerCase() !== "application/json"
    ) {
      return failure(
        request,
        new HttpError(
          415,
          "unsupported_media_type",
          "Content-Type application/json ist erforderlich.",
        ),
      );
    }
    try {
      const result = await securedHandler(await boundedRequest(request));
      if (result.headers.has("x-supabase-server-error")) {
        if (result.status === 401) {
          return failure(
            request,
            new HttpError(
              401,
              "authentication_required",
              "Eine gültige Benutzeranmeldung ist erforderlich.",
            ),
          );
        }
        if (result.status === 403) {
          return failure(
            request,
            new HttpError(
              403,
              "permission_denied",
              "Für diese Aktion fehlt die Berechtigung.",
            ),
          );
        }
        return failure(
          request,
          new HttpError(
            503,
            "authentication_unavailable",
            "Die Anmeldung konnte derzeit nicht geprüft werden.",
          ),
        );
      }
      return new Response(result.body, {
        status: result.status,
        headers: corsHeaders(request),
      });
    } catch (error) {
      return failure(
        request,
        error instanceof HttpError
          ? error
          : new HttpError(
              500,
              "operation_failed",
              "Die Aktion konnte nicht abgeschlossen werden.",
            ),
      );
    }
  },
};
