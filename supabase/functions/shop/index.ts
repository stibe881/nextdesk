import { withSupabase } from "@supabase/server";
import {
  resolveUserFeatureStates,
  userFeatureDepartments,
} from "../_shared/tenant-features.ts";
import {
  isRecord,
  isUuid,
  json,
  noContent,
  parseJsonObject,
} from "../_shared/http.ts";
import {
  applyDepartmentScope,
  type DepartmentScope,
  departmentVisible,
  resolveRecordDepartment,
  scopeDepartmentOptions,
} from "../_shared/department-scope.ts";

/**
 * Self-service shop.
 *
 * Employees browse the catalog, order or borrow items and follow their
 * orders. Managers approve orders that need approval. Agents (shop.fulfill)
 * process orders; handing out books the items out of the inventory ledger.
 * All mutations run in the database functions `shop_submit_order` and
 * `shop_update_order`, which enforce permissions and keep stock consistent.
 */

type Admin = any;
type Row = Record<string, unknown>;

const IMAGE_BUCKET = "inventory-item-images";
const IMAGE_TTL_SECONDS = 60 * 60;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const ORDER_SELECT =
  "id, order_number, reason, requester_id, placed_by, status, approver_id, approved_by, approved_at, handled_by, delivery_method, delivery_location, needed_by, loan_from, loan_until, comment, decision_reason, issued_at, returned_at, closed_at, created_at, updated_at";
const UPDATE_ACTIONS = new Set([
  "approve",
  "reject_approval",
  "accept",
  "ready",
  "issue",
  "return",
  "reject",
  "cancel",
  "note",
]);

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes("\u0000")) return null;
  return Array.from(trimmed).length <= max ? trimmed : null;
}

function isoDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) &&
    date.toISOString().slice(0, 10) === value
    ? value
    : null;
}

function int(value: unknown, min: number, max: number): number | null {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= min &&
    value <= max
    ? value
    : null;
}

/** Translates database errors into German messages for the apps. */
function databaseError(error: { code?: string; message?: string }): HttpError {
  const message = error.message ?? "";
  const stock = message.match(/^Not enough stock for (.+)$/);
  if (stock) {
    return new HttpError(
      409,
      "insufficient_stock",
      `Für «${stock[1]}» ist nicht genügend Bestand vorhanden.`,
    );
  }
  const serial = message.match(
    /^Serial number and location are required for (.+)$/,
  );
  if (serial) {
    return new HttpError(
      400,
      "serial_required",
      `Bitte für «${serial[1]}» Lagerort und Seriennummer wählen.`,
    );
  }
  if (/Loan period exceeds (\d+) days/.test(message)) {
    const days = message.match(/(\d+)/)?.[1];
    return new HttpError(
      400,
      "loan_too_long",
      `Die Ausleihe darf höchstens ${days} Tage dauern.`,
    );
  }
  if (message.startsWith("A loan needs a valid period")) {
    return new HttpError(
      400,
      "loan_period_required",
      "Bitte einen gültigen Ausleihzeitraum ab heute wählen.",
    );
  }
  if (message.startsWith("Invalid quantity")) {
    return new HttpError(
      400,
      "invalid_quantity",
      "Die gewünschte Menge ist für diesen Artikel nicht möglich.",
    );
  }
  if (message.startsWith("A reason is required")) {
    return new HttpError(400, "reason_required", "Bitte einen Grund angeben.");
  }
  if (message.startsWith("Catalog item is not available")) {
    return new HttpError(
      409,
      "catalog_item_unavailable",
      "Ein Artikel ist nicht mehr im Shop verfügbar.",
    );
  }
  if (message.startsWith("The requester is not an active member")) {
    return new HttpError(
      400,
      "requester_invalid",
      "Diese Person ist kein aktives Mitglied des Arbeitsbereichs.",
    );
  }
  if (message.startsWith("The shop is not enabled")) {
    return new HttpError(
      403,
      "shop_disabled",
      "Der Shop ist in diesem Arbeitsbereich nicht aktiviert.",
    );
  }
  switch (error.code) {
    case "42501":
      return new HttpError(
        403,
        "forbidden",
        "Für diese Aktion fehlt die Berechtigung.",
      );
    case "P0002":
      return new HttpError(
        404,
        "not_found",
        "Die Bestellung wurde nicht gefunden.",
      );
    case "23514":
      return new HttpError(
        409,
        "invalid_state",
        "Die Bestellung wurde inzwischen geändert. Bitte neu laden.",
      );
    case "22023":
      return new HttpError(
        400,
        "invalid_request",
        "Die Angaben sind ungültig.",
      );
    default:
      console.error("Shop database error", { code: error.code });
      return new HttpError(
        500,
        "shop_failed",
        "Der Shop ist gerade nicht erreichbar.",
      );
  }
}

async function permission(
  admin: Admin,
  actorId: string,
  tenantId: string,
  code: string,
): Promise<boolean> {
  const { data, error } = await admin.rpc("shop_has_permission", {
    p_user_id: actorId,
    p_tenant_id: tenantId,
    p_permission_code: code,
  });
  if (error) throw databaseError(error);
  return data === true;
}

const SHOP_FEATURE = "self_service.shop";

async function requireShop(admin: Admin, actorId: string, tenantId: string) {
  const [{ data: membership }, { data: enabled, error }] = await Promise.all([
    admin
      .from("tenant_memberships")
      .select("user_id")
      .eq("tenant_id", tenantId)
      .eq("user_id", actorId)
      .eq("status", "active")
      .maybeSingle(),
    admin.rpc("shop_feature_enabled", { p_tenant_id: tenantId }),
  ]);
  if (!membership) {
    throw new HttpError(
      403,
      "membership_required",
      "Kein Zugriff auf diesen Arbeitsbereich.",
    );
  }
  if (error || enabled !== true) {
    throw new HttpError(
      403,
      "shop_disabled",
      "Der Shop ist in diesem Arbeitsbereich nicht aktiviert.",
    );
  }
  // Ordering is open as long as the shop is on in at least one department;
  // fulfilling and managing need the shop to be on in one's own department.
  const [canOrder, canFulfill, canManage, anyDepartment, personal] =
    await Promise.all([
      permission(admin, actorId, tenantId, "shop.order"),
      permission(admin, actorId, tenantId, "shop.fulfill"),
      permission(admin, actorId, tenantId, "shop.manage"),
      resolveUserFeatureStates(admin, tenantId, actorId, [SHOP_FEATURE]),
      userFeatureDepartments(admin, tenantId, actorId, SHOP_FEATURE),
    ]);
  if (anyDepartment?.[SHOP_FEATURE] !== true) {
    throw new HttpError(
      403,
      "shop_disabled",
      "Der Shop ist in diesem Arbeitsbereich nicht aktiviert.",
    );
  }
  const ownDepartment = (personal?.length ?? 0) > 0;
  return {
    canOrder,
    canFulfill: canFulfill && ownDepartment,
    canManage: canManage && ownDepartment,
    // Own departments with the shop on: managers edit the articles of these
    // departments, agents handle the orders of their articles.
    scope: { departments: personal ?? [], scoped: true } as DepartmentScope,
  };
}

/**
 * Departments whose articles employees see: active departments in which the
 * shop is not switched off.
 */
async function shopDepartments(
  admin: Admin,
  tenantId: string,
): Promise<Set<string>> {
  const [{ data: departments, error }, { data: disabled, error: flagError }] =
    await Promise.all([
      admin
        .from("departments")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("active", true),
      admin
        .from("department_feature_flags")
        .select("department_id")
        .eq("tenant_id", tenantId)
        .eq("feature_key", SHOP_FEATURE)
        .eq("enabled", false),
    ]);
  if (error) throw databaseError(error);
  if (flagError) throw databaseError(flagError);
  const off = new Set(
    ((disabled ?? []) as Row[]).map((row) => String(row.department_id)),
  );
  return new Set(
    ((departments ?? []) as Row[])
      .map((row) => String(row.id))
      .filter((id) => !off.has(id)),
  );
}

/**
 * Loads an article a manager wants to change. Articles of other departments
 * are reported as not found. Returns the article's department.
 */
async function requireEditableCatalogItem(
  admin: Admin,
  tenantId: string,
  itemId: string,
  scope: DepartmentScope,
): Promise<string | null> {
  const { data, error } = await admin
    .from("shop_catalog_items")
    .select("id, department_id")
    .eq("tenant_id", tenantId)
    .eq("id", itemId)
    .maybeSingle();
  if (error) throw databaseError(error);
  if (!data || !departmentVisible(scope, (data as Row).department_id)) {
    throw new HttpError(404, "not_found", "Der Artikel wurde nicht gefunden.");
  }
  const department = (data as Row).department_id;
  return isUuid(department) ? department : null;
}

/** Department per catalog article (null: article for all departments). */
async function catalogDepartments(
  admin: Admin,
  tenantId: string,
  ids: unknown[],
): Promise<Map<string, string | null>> {
  const unique = [...new Set(ids.filter((id): id is string => isUuid(id)))];
  const result = new Map<string, string | null>();
  for (let index = 0; index < unique.length; index += 150) {
    const { data, error } = await admin
      .from("shop_catalog_items")
      .select("id, department_id")
      .eq("tenant_id", tenantId)
      .in("id", unique.slice(index, index + 150));
    if (error) throw databaseError(error);
    for (const row of (data ?? []) as Row[]) {
      result.set(
        String(row.id),
        isUuid(row.department_id) ? row.department_id : null,
      );
    }
  }
  return result;
}

/**
 * An agent handles an order when at least one line is an article of their
 * departments or an article without department (also a deleted article).
 */
function handlesLines(
  scope: DepartmentScope,
  lines: Row[],
  departments: Map<string, string | null>,
): boolean {
  if (lines.length === 0) return true;
  return lines.some((line) => {
    if (!isUuid(line.catalog_item_id)) return true;
    return departmentVisible(
      scope,
      departments.get(line.catalog_item_id) ?? null,
    );
  });
}

/** Keeps the orders (with embedded shop_order_lines) an agent handles. */
async function handledOrders(
  admin: Admin,
  tenantId: string,
  scope: DepartmentScope,
  rows: Row[],
): Promise<Row[]> {
  const linesOf = (row: Row): Row[] =>
    Array.isArray(row.shop_order_lines) ? (row.shop_order_lines as Row[]) : [];
  const departments = await catalogDepartments(
    admin,
    tenantId,
    rows.flatMap((row) => linesOf(row).map((line) => line.catalog_item_id)),
  );
  return rows.filter((row) => handlesLines(scope, linesOf(row), departments));
}

/** True when the agent handles the order (see handlesLines). */
async function handlesOrder(
  admin: Admin,
  tenantId: string,
  scope: DepartmentScope,
  orderId: string,
): Promise<boolean> {
  const { data, error } = await admin
    .from("shop_order_lines")
    .select("catalog_item_id")
    .eq("tenant_id", tenantId)
    .eq("order_id", orderId);
  if (error) throw databaseError(error);
  const lines = (data ?? []) as Row[];
  const departments = await catalogDepartments(
    admin,
    tenantId,
    lines.map((line) => line.catalog_item_id),
  );
  return handlesLines(scope, lines, departments);
}

async function names(admin: Admin, ids: (string | null | undefined)[]) {
  const unique = [...new Set(ids.filter((id): id is string => isUuid(id)))];
  const result = new Map<string, string>();
  if (unique.length === 0) return result;
  const rows: Row[] = [];
  for (let index = 0; index < unique.length; index += 150) {
    const { data } = await admin
      .from("user_profiles")
      .select("id, display_name")
      .in("id", unique.slice(index, index + 150));
    rows.push(...((data ?? []) as Row[]));
  }
  for (const row of rows) {
    if (typeof row.id === "string") {
      result.set(
        row.id,
        typeof row.display_name === "string" && row.display_name.trim()
          ? row.display_name.trim()
          : "Unbekannte Person",
      );
    }
  }
  // Fallback for people without a profile name (bounded to keep it fast).
  for (const id of unique.filter((id) => !result.has(id)).slice(0, 100)) {
    const { data: user } = await admin.auth.admin.getUserById(id);
    const metadataName = user?.user?.user_metadata?.full_name;
    result.set(
      id,
      typeof metadataName === "string" && metadataName.trim()
        ? metadataName.trim()
        : (user?.user?.email ?? "Unbekannte Person"),
    );
  }
  return result;
}

/** Available quantity per inventory item (all active locations). */
async function availability(admin: Admin, tenantId: string, itemIds: string[]) {
  const result = new Map<string, number>();
  if (itemIds.length === 0) return result;
  const { data } = await admin
    .from("inventory_stock_balances")
    .select("item_id, physical_quantity, reserved_quantity")
    .eq("tenant_id", tenantId)
    .in("item_id", itemIds);
  for (const row of (data ?? []) as Row[]) {
    const id = String(row.item_id);
    const free = Number(row.physical_quantity) - Number(row.reserved_quantity);
    result.set(id, (result.get(id) ?? 0) + Math.max(0, free));
  }
  return result;
}

/** Signed URLs for the shop's own article photos (path → URL). */
async function signedPaths(admin: Admin, paths: string[]) {
  const result = new Map<string, string>();
  if (paths.length === 0) return result;
  const { data: signed } = await admin.storage
    .from(IMAGE_BUCKET)
    .createSignedUrls(paths, IMAGE_TTL_SECONDS);
  paths.forEach((path, index) => {
    const url = signed?.[index]?.signedUrl;
    if (typeof url === "string") result.set(path, url);
  });
  return result;
}

function decodeImage(value: unknown): {
  bytes: Uint8Array;
  contentType: string;
} {
  if (
    !isRecord(value) ||
    typeof value.contentType !== "string" ||
    !IMAGE_TYPES[value.contentType] ||
    typeof value.data !== "string"
  ) {
    throw new HttpError(
      400,
      "image_invalid",
      "Bitte ein Foto im Format JPG, PNG oder WebP wählen.",
    );
  }
  let bytes: Uint8Array;
  try {
    const binary = atob(value.data);
    bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    throw new HttpError(400, "image_invalid", "Das Foto ist beschädigt.");
  }
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) {
    throw new HttpError(
      400,
      "image_too_large",
      "Das Foto darf höchstens 3 MB gross sein.",
    );
  }
  // The file content must match the declared type.
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png =
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47;
  const webp =
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  const matches =
    (value.contentType === "image/jpeg" && jpeg) ||
    (value.contentType === "image/png" && png) ||
    (value.contentType === "image/webp" && webp);
  if (!matches) {
    throw new HttpError(
      400,
      "image_invalid",
      "Bitte ein Foto im Format JPG, PNG oder WebP wählen.",
    );
  }
  return { bytes, contentType: value.contentType };
}

const MAX_IMAGES = 5;

/** Technische Angaben eines Artikels (Schlüssel → Freitext). */
const SPEC_KEYS = [
  "scope",
  "usage",
  "compatibility",
  "equipment",
  "connectivity",
  "properties",
] as const;

function cleanSpecifications(value: unknown): Record<string, string> | null {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) return null;
  const result: Record<string, string> = {};
  for (const key of SPEC_KEYS) {
    const entry = value[key];
    if (entry === undefined || entry === null || entry === "") continue;
    const clean = text(entry, 2000);
    if (!clean) return null;
    result[key] = clean;
  }
  return result;
}

/** File name (without extension) identifies a photo towards the apps. */
function imageId(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1).replace(/\.[a-z]+$/, "");
}

async function catalogItemPaths(
  admin: Admin,
  tenantId: string,
  itemId: string,
): Promise<string[]> {
  const { data: item, error } = await admin
    .from("shop_catalog_items")
    .select("id, image_paths")
    .eq("tenant_id", tenantId)
    .eq("id", itemId)
    .maybeSingle();
  if (error) throw databaseError(error);
  if (!item) {
    throw new HttpError(404, "not_found", "Der Artikel wurde nicht gefunden.");
  }
  const paths = (item as Row).image_paths;
  return Array.isArray(paths)
    ? paths.filter((path): path is string => typeof path === "string")
    : [];
}

async function savePaths(
  admin: Admin,
  tenantId: string,
  itemId: string,
  paths: string[],
) {
  const { error } = await admin
    .from("shop_catalog_items")
    .update({ image_paths: paths, updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId)
    .eq("id", itemId);
  if (error) throw databaseError(error);
}

/** Adds one photo (max. 5 per article). */
async function addCatalogItemImage(
  admin: Admin,
  tenantId: string,
  actorId: string,
  itemId: string,
  image: unknown,
) {
  const paths = await catalogItemPaths(admin, tenantId, itemId);
  if (paths.length >= MAX_IMAGES) {
    throw new HttpError(
      409,
      "too_many_images",
      `Pro Artikel sind höchstens ${MAX_IMAGES} Fotos möglich.`,
    );
  }
  const { bytes, contentType } = decodeImage(image);
  const path = `${tenantId}/shop/${itemId}/${crypto.randomUUID()}.${IMAGE_TYPES[contentType]}`;
  const { error: uploadError } = await admin.storage
    .from(IMAGE_BUCKET)
    .upload(path, bytes, { contentType, upsert: false });
  if (uploadError) {
    console.error("Shop image upload failed");
    throw new HttpError(
      500,
      "image_upload_failed",
      "Das Foto konnte nicht gespeichert werden.",
    );
  }
  try {
    await savePaths(admin, tenantId, itemId, [...paths, path]);
  } catch (error) {
    await admin.storage.from(IMAGE_BUCKET).remove([path]);
    throw error;
  }
  await audit(admin, tenantId, actorId, "shop.catalog.image_added", itemId);
  return imageId(path);
}

/** Removes one photo by its id. */
async function removeCatalogItemImage(
  admin: Admin,
  tenantId: string,
  actorId: string,
  itemId: string,
  id: string,
) {
  const paths = await catalogItemPaths(admin, tenantId, itemId);
  const target = paths.find((path) => imageId(path) === id);
  if (!target) return;
  await savePaths(
    admin,
    tenantId,
    itemId,
    paths.filter((path) => path !== target),
  );
  await admin.storage.from(IMAGE_BUCKET).remove([target]);
  await audit(admin, tenantId, actorId, "shop.catalog.image_removed", itemId);
}

async function imageUrls(admin: Admin, tenantId: string, itemIds: string[]) {
  const result = new Map<string, string>();
  if (itemIds.length === 0) return result;
  const { data } = await admin
    .from("inventory_item_images")
    .select("item_id, storage_object_path")
    .eq("tenant_id", tenantId)
    .in("item_id", itemIds);
  const rows = (data ?? []) as Row[];
  if (rows.length === 0) return result;
  const { data: signed } = await admin.storage
    .from(IMAGE_BUCKET)
    .createSignedUrls(
      rows.map((row) => String(row.storage_object_path)),
      IMAGE_TTL_SECONDS,
    );
  rows.forEach((row, index) => {
    const url = signed?.[index]?.signedUrl;
    if (typeof url === "string") result.set(String(row.item_id), url);
  });
  return result;
}

function stockLevel(available: number | undefined, linked: boolean) {
  if (!linked) return "on_request";
  if (!available || available <= 0) return "out_of_stock";
  return available <= 2 ? "low" : "in_stock";
}

/** Aktuell ausgeliehene oder reservierte Stücke je Katalogartikel. */
async function borrowedQuantities(
  admin: Admin,
  tenantId: string,
  itemIds: string[],
) {
  const result = new Map<string, number>();
  if (itemIds.length === 0) return result;
  const { data } = await admin
    .from("shop_order_lines")
    .select("catalog_item_id, quantity")
    .eq("tenant_id", tenantId)
    .eq("kind", "loan")
    .in("status", ["open", "reserved", "issued"])
    .in("catalog_item_id", itemIds);
  for (const row of (data ?? []) as Row[]) {
    const id = String(row.catalog_item_id);
    result.set(id, (result.get(id) ?? 0) + Number(row.quantity));
  }
  return result;
}

async function listCatalog(
  admin: Admin,
  tenantId: string,
  includeInactive: boolean,
  exact: boolean,
  editor: { canManage: boolean; scope: DepartmentScope },
) {
  let query = admin
    .from("shop_catalog_items")
    .select(
      "id, inventory_item_id, image_paths, name, description, category, category_id, article_number, supplier_url, kind, requires_approval, max_quantity, max_loan_days, active, sort_order, option_item_ids, specifications, category_ids, loan_quantity, department_id",
    )
    .eq("tenant_id", tenantId)
    .order("category")
    .order("sort_order")
    .order("name");
  if (!includeInactive) query = query.eq("active", true);
  const [{ data, error }, shopOn] = await Promise.all([
    query,
    shopDepartments(admin, tenantId),
  ]);
  if (error) throw databaseError(error);
  // Articles of departments in which the shop is off are not offered.
  const rows = ((data ?? []) as Row[]).filter(
    (row) => !isUuid(row.department_id) || shopOn.has(row.department_id),
  );
  const itemIds = rows
    .map((row) => row.inventory_item_id)
    .filter((id): id is string => isUuid(id));
  const pathsOf = (row: Row): string[] =>
    Array.isArray(row.image_paths)
      ? row.image_paths.filter(
          (path): path is string => typeof path === "string",
        )
      : [];
  const ownPaths = rows.flatMap(pathsOf);
  // Ausleihartikel mit eigenem Bestand (ohne Lageranbindung).
  const ownStockIds = rows
    .filter(
      (row) =>
        row.kind === "loan" &&
        row.inventory_item_id === null &&
        typeof row.loan_quantity === "number",
    )
    .map((row) => String(row.id));
  const [stock, images, ownImages, { data: categoryRows }, borrowed] =
    await Promise.all([
      availability(admin, tenantId, itemIds),
      imageUrls(admin, tenantId, itemIds),
      signedPaths(admin, ownPaths),
      admin
        .from("shop_categories")
        .select("id, name")
        .eq("tenant_id", tenantId),
      borrowedQuantities(admin, tenantId, ownStockIds),
    ]);
  const categoryNameById = new Map<string, string>(
    ((categoryRows ?? []) as Row[]).map((row) => [
      String(row.id),
      String(row.name),
    ]),
  );
  const listedIds = new Set(rows.map((row) => String(row.id)));
  return rows.map((row) => {
    const itemId = isUuid(row.inventory_item_id) ? row.inventory_item_id : null;
    const ownStock =
      row.kind === "loan" &&
      itemId === null &&
      typeof row.loan_quantity === "number";
    const available = ownStock
      ? Math.max(
          0,
          (row.loan_quantity as number) - (borrowed.get(String(row.id)) ?? 0),
        )
      : itemId
        ? stock.get(itemId)
        : undefined;
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      category: row.category,
      categoryId: row.category_id ?? null,
      ...(() => {
        const ids = (
          Array.isArray(row.category_ids) && row.category_ids.length > 0
            ? row.category_ids
            : isUuid(row.category_id)
              ? [row.category_id]
              : []
        ).filter((id): id is string => isUuid(id));
        const names = ids.flatMap((id) => {
          const name = categoryNameById.get(id);
          return name ? [name] : [];
        });
        return {
          categoryIds: ids,
          categoryNames: names.length > 0 ? names : [String(row.category)],
        };
      })(),
      // Internal details are only sent to agents (exact = may process/manage).
      ...(exact
        ? {
            articleNumber: row.article_number ?? null,
            supplierUrl: row.supplier_url ?? null,
          }
        : {}),
      kind: row.kind,
      requiresApproval: row.requires_approval === true,
      maxQuantity: row.max_quantity,
      maxLoanDays: row.max_loan_days,
      active: row.active === true,
      sortOrder: row.sort_order,
      // Optionen nur, soweit sie in dieser Liste stehen (im Shop: aktive).
      optionItemIds: (Array.isArray(row.option_item_ids)
        ? row.option_item_ids
        : []
      ).filter((id): id is string => isUuid(id) && listedIds.has(id)),
      specifications: cleanSpecifications(row.specifications) ?? {},
      inventoryItemId: itemId,
      departmentId: isUuid(row.department_id) ? row.department_id : null,
      // Managers edit only the articles of their own departments.
      canEdit:
        editor.canManage && departmentVisible(editor.scope, row.department_id),
      // The shop's own photos win over the inventory photo.
      ...(() => {
        const own = pathsOf(row).flatMap((path) => {
          const url = ownImages.get(path);
          return url ? [{ id: imageId(path), url }] : [];
        });
        const fallback = itemId ? (images.get(itemId) ?? null) : null;
        return {
          images: own,
          imageUrls: own.length
            ? own.map((image) => image.url)
            : fallback
              ? [fallback]
              : [],
          imageUrl: own[0]?.url ?? fallback,
        };
      })(),
      loanQuantity: ownStock ? row.loan_quantity : null,
      stockLevel: stockLevel(available, itemId !== null || ownStock),
      // Eigener Ausleihbestand ist für alle sichtbar, Lagerbestand nur für Agenten.
      availableQuantity: ownStock
        ? (available ?? 0)
        : exact && itemId
          ? (available ?? 0)
          : null,
    };
  });
}

function orderSummary(
  row: Row,
  people: Map<string, string>,
  lineCount: number,
) {
  const loanUntil = typeof row.loan_until === "string" ? row.loan_until : null;
  const today = new Date().toISOString().slice(0, 10);
  return {
    id: row.id,
    orderNumber: row.order_number,
    status: row.status,
    overdue: row.status === "loaned" && loanUntil !== null && loanUntil < today,
    requesterId: row.requester_id,
    requesterName: people.get(String(row.requester_id)) ?? null,
    placedByName: row.placed_by
      ? (people.get(String(row.placed_by)) ?? null)
      : null,
    approverName: row.approver_id
      ? (people.get(String(row.approver_id)) ?? null)
      : null,
    handledByName: row.handled_by
      ? (people.get(String(row.handled_by)) ?? null)
      : null,
    deliveryMethod: row.delivery_method,
    deliveryLocation: row.delivery_location,
    neededBy: row.needed_by,
    loanFrom: row.loan_from,
    loanUntil,
    comment: row.comment,
    decisionReason: row.decision_reason,
    reason: typeof row.reason === "string" ? row.reason : null,
    lineCount,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Active members an agent can order for, sorted by name. */
async function listRequesters(admin: Admin, tenantId: string) {
  const { data, error } = await admin
    .from("tenant_memberships")
    .select("user_id")
    .eq("tenant_id", tenantId)
    .eq("status", "active")
    .limit(2000);
  if (error) throw databaseError(error);
  const ids = ((data ?? []) as Row[])
    .map((row) => row.user_id)
    .filter((id): id is string => isUuid(id));
  const [people, { data: directory }] = await Promise.all([
    names(admin, ids),
    ids.length > 0
      ? admin
          .from("tenant_member_directory")
          .select("user_id, job_title")
          .eq("tenant_id", tenantId)
          .in("user_id", ids)
      : Promise.resolve({ data: [] }),
  ]);
  const titles = new Map<string, string>();
  for (const row of (directory ?? []) as Row[]) {
    if (typeof row.user_id === "string" && typeof row.job_title === "string") {
      titles.set(row.user_id, row.job_title);
    }
  }
  return ids
    .map((id) => ({
      id,
      name: people.get(id) ?? "Unbekannte Person",
      jobTitle: titles.get(id) ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "de"));
}

async function listOrders(
  admin: Admin,
  tenantId: string,
  actorId: string,
  scope: string,
  canFulfill: boolean,
  status: string | null,
  departments: DepartmentScope,
) {
  // All orders (agents): only those with articles of the agent's departments,
  // so more rows are read and filtered down to 200.
  const filterByDepartment = scope !== "mine" && scope !== "approvals";
  let query = admin
    .from("shop_orders")
    .select(
      `${ORDER_SELECT}, shop_order_lines(item_name, quantity, kind, catalog_item_id)`,
    )
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(filterByDepartment ? 1000 : 200);
  if (scope === "mine") {
    query = query.eq("requester_id", actorId);
  } else if (scope === "approvals") {
    query = query.eq("status", "pending_approval");
    query = canFulfill
      ? query.or(`approver_id.eq.${actorId},approver_id.is.null`)
      : query.eq("approver_id", actorId);
    query = query.neq("requester_id", actorId);
  } else if (!canFulfill) {
    throw new HttpError(
      403,
      "forbidden",
      "Für diese Ansicht fehlt die Berechtigung.",
    );
  }
  if (status === "open") {
    query = query.in("status", [
      "pending_approval",
      "submitted",
      "in_progress",
      "ready",
    ]);
  } else if (status === "loaned") {
    query = query.eq("status", "loaned");
  } else if (status === "closed") {
    query = query.in("status", ["issued", "returned", "rejected", "cancelled"]);
  } else if (status) {
    query = query.eq("status", status);
  }
  const { data, error } = await query;
  if (error) throw databaseError(error);
  const rows = filterByDepartment
    ? (
        await handledOrders(admin, tenantId, departments, (data ?? []) as Row[])
      ).slice(0, 200)
    : ((data ?? []) as Row[]);
  const people = await names(
    admin,
    rows.flatMap(
      (row) =>
        [
          row.requester_id,
          row.placed_by,
          row.approver_id,
          row.handled_by,
        ] as string[],
    ),
  );
  return rows.map((row) => {
    const lines = Array.isArray(row.shop_order_lines)
      ? (row.shop_order_lines as Row[])
      : [];
    return {
      ...orderSummary(row, people, lines.length),
      itemsLabel: lines
        .map((line) => `${line.quantity}× ${line.item_name}`)
        .join(", "),
    };
  });
}

async function getOrder(
  admin: Admin,
  tenantId: string,
  actorId: string,
  orderId: string,
  canFulfillAny: boolean,
  departments: DepartmentScope,
) {
  const { data: order, error } = await admin
    .from("shop_orders")
    .select(ORDER_SELECT)
    .eq("tenant_id", tenantId)
    .eq("id", orderId)
    .maybeSingle();
  if (error) throw databaseError(error);
  if (!order)
    throw new HttpError(
      404,
      "not_found",
      "Die Bestellung wurde nicht gefunden.",
    );
  const row = order as Row;
  // Agents process only orders with articles of their departments; approving
  // stays as before.
  const canFulfill =
    canFulfillAny &&
    (await handlesOrder(admin, tenantId, departments, orderId));
  const isRequester = row.requester_id === actorId;
  const isApprover =
    row.status === "pending_approval" &&
    !isRequester &&
    (row.approver_id === actorId ||
      (row.approver_id === null && canFulfillAny));
  const wasApprover = row.approver_id === actorId;
  if (!isRequester && !canFulfill && !isApprover && !wasApprover) {
    throw new HttpError(
      404,
      "not_found",
      "Die Bestellung wurde nicht gefunden.",
    );
  }

  const [{ data: lines }, { data: events }] = await Promise.all([
    admin
      .from("shop_order_lines")
      .select(
        "id, catalog_item_id, inventory_item_id, item_name, kind, quantity, status, location_id, serial_unit_id, issued_at, returned_at, loan_from, loan_until",
      )
      .eq("order_id", orderId)
      .order("created_at"),
    admin
      .from("shop_order_events")
      .select("id, actor_id, event_type, note, internal, created_at")
      .eq("order_id", orderId)
      .order("created_at"),
  ]);
  const lineRows = (lines ?? []) as Row[];
  const eventRows = ((events ?? []) as Row[]).filter(
    (event) => canFulfill || event.internal !== true,
  );
  const people = await names(admin, [
    row.requester_id,
    row.placed_by,
    row.approver_id,
    row.approved_by,
    row.handled_by,
    ...eventRows.map((event) => event.actor_id),
  ] as string[]);

  // Article details per line: cover photo for everyone, article number and
  // supplier link only for agents.
  const articleDetails = new Map<string, Row>();
  const lineImages = new Map<string, string>();
  const catalogIds = lineRows
    .map((line) => line.catalog_item_id)
    .filter((id): id is string => isUuid(id));
  if (catalogIds.length > 0) {
    const { data: catalogRows } = await admin
      .from("shop_catalog_items")
      .select(
        "id, inventory_item_id, image_paths, article_number, supplier_url",
      )
      .eq("tenant_id", tenantId)
      .in("id", catalogIds);
    const rows = (catalogRows ?? []) as Row[];
    for (const catalogRow of rows) {
      articleDetails.set(String(catalogRow.id), catalogRow);
    }
    const coverPaths = rows.flatMap((catalogRow) =>
      Array.isArray(catalogRow.image_paths) &&
      typeof catalogRow.image_paths[0] === "string"
        ? [catalogRow.image_paths[0] as string]
        : [],
    );
    const inventoryIds = rows
      .filter(
        (catalogRow) =>
          !(
            Array.isArray(catalogRow.image_paths) &&
            catalogRow.image_paths.length > 0
          ) && isUuid(catalogRow.inventory_item_id),
      )
      .map((catalogRow) => catalogRow.inventory_item_id as string);
    const [covers, inventoryCovers] = await Promise.all([
      signedPaths(admin, coverPaths),
      imageUrls(admin, tenantId, inventoryIds),
    ]);
    for (const catalogRow of rows) {
      const cover =
        Array.isArray(catalogRow.image_paths) &&
        typeof catalogRow.image_paths[0] === "string"
          ? covers.get(catalogRow.image_paths[0] as string)
          : isUuid(catalogRow.inventory_item_id)
            ? inventoryCovers.get(catalogRow.inventory_item_id)
            : undefined;
      if (cover) lineImages.set(String(catalogRow.id), cover);
    }
  }

  // Stock options for agents: locations with free stock and free serial units.
  const options = new Map<string, unknown>();
  const itemIds = lineRows
    .map((line) => line.inventory_item_id)
    .filter((id): id is string => isUuid(id));
  if (canFulfill && itemIds.length > 0) {
    const [{ data: items }, { data: balances }, { data: serials }] =
      await Promise.all([
        admin
          .from("inventory_items")
          .select("id, tracking_mode")
          .in("id", itemIds),
        admin
          .from("inventory_stock_balances")
          .select(
            "item_id, location_id, physical_quantity, reserved_quantity, inventory_locations(name)",
          )
          .eq("tenant_id", tenantId)
          .in("item_id", itemIds),
        admin
          .from("inventory_serial_units")
          .select("id, item_id, serial_number, active")
          .eq("tenant_id", tenantId)
          .in("item_id", itemIds)
          .eq("active", true)
          .limit(500),
      ]);
    for (const itemId of itemIds) {
      const item = ((items ?? []) as Row[]).find(
        (candidate) => candidate.id === itemId,
      );
      options.set(itemId, {
        trackingMode: item?.tracking_mode ?? "quantity",
        locations: ((balances ?? []) as Row[])
          .filter((balance) => balance.item_id === itemId)
          .map((balance) => {
            const location = Array.isArray(balance.inventory_locations)
              ? (balance.inventory_locations[0] as Row | undefined)
              : (balance.inventory_locations as Row | null);
            return {
              id: balance.location_id,
              name: location?.name ?? "Lagerort",
              available: Math.max(
                0,
                Number(balance.physical_quantity) -
                  Number(balance.reserved_quantity),
              ),
            };
          }),
        serialUnits: ((serials ?? []) as Row[])
          .filter((serial) => serial.item_id === itemId)
          .map((serial) => ({
            id: serial.id,
            serialNumber: serial.serial_number,
          })),
      });
    }
  }

  const status = String(row.status);
  return {
    ...orderSummary(row, people, lineRows.length),
    approvedByName: row.approved_by
      ? (people.get(String(row.approved_by)) ?? null)
      : null,
    approvedAt: row.approved_at,
    issuedAt: row.issued_at,
    returnedAt: row.returned_at,
    lines: lineRows.map((line) => ({
      id: line.id,
      itemName: line.item_name,
      kind: line.kind,
      quantity: line.quantity,
      status: line.status,
      loanFrom: line.loan_from ?? null,
      loanUntil: line.loan_until ?? null,
      inventoryItemId: line.inventory_item_id,
      locationId: line.location_id,
      serialUnitId: line.serial_unit_id,
      imageUrl: lineImages.get(String(line.catalog_item_id)) ?? null,
      ...(canFulfill
        ? {
            articleNumber:
              articleDetails.get(String(line.catalog_item_id))
                ?.article_number ?? null,
            supplierUrl:
              articleDetails.get(String(line.catalog_item_id))?.supplier_url ??
              null,
          }
        : {}),
      stock: isUuid(line.inventory_item_id)
        ? (options.get(line.inventory_item_id) ?? null)
        : null,
    })),
    events: eventRows.map((event) => ({
      id: event.id,
      type: event.event_type,
      note: event.note,
      internal: event.internal === true,
      actorName: event.actor_id
        ? (people.get(String(event.actor_id)) ?? null)
        : null,
      createdAt: event.created_at,
    })),
    permissions: {
      canApprove: isApprover,
      canCancel:
        (isRequester || canFulfill) &&
        ["pending_approval", "submitted", "in_progress", "ready"].includes(
          status,
        ),
      canProcess: canFulfill,
      isRequester,
    },
  };
}

/** Supplier links must be plain http(s) URLs. */
function supplierLink(value: unknown): string | null {
  const link = text(value, 1000);
  if (!link) return null;
  try {
    const url = new URL(link);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function categoryName(value: unknown): string | null {
  const name = text(value, 80);
  return name && Array.from(name).length >= 2
    ? name.replace(/\s+/g, " ")
    : null;
}

async function listCategories(admin: Admin, tenantId: string) {
  const [{ data, error }, { data: items }] = await Promise.all([
    admin
      .from("shop_categories")
      .select("id, name, sort_order")
      .eq("tenant_id", tenantId)
      .order("sort_order")
      .order("name"),
    admin
      .from("shop_catalog_items")
      .select("category_id, category_ids")
      .eq("tenant_id", tenantId),
  ]);
  if (error) throw databaseError(error);
  const counts = new Map<string, number>();
  for (const item of (items ?? []) as Row[]) {
    const ids = new Set<string>(
      (Array.isArray(item.category_ids) ? item.category_ids : []).filter(
        (id): id is string => typeof id === "string",
      ),
    );
    if (typeof item.category_id === "string") ids.add(item.category_id);
    for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return ((data ?? []) as Row[]).map((row) => ({
    id: row.id,
    name: row.name,
    itemCount: counts.get(String(row.id)) ?? 0,
  }));
}

/** Finds a category by name (case-insensitive) or creates it. */
async function ensureCategory(
  admin: Admin,
  tenantId: string,
  actorId: string,
  name: string,
): Promise<{ id: string; name: string }> {
  const { data: existing, error } = await admin
    .from("shop_categories")
    .select("id, name")
    .eq("tenant_id", tenantId)
    .ilike(
      "name",
      name.replace(/[\\%_]/g, (match) => `\\${match}`),
    );
  if (error) throw databaseError(error);
  const match = ((existing ?? []) as Row[]).find(
    (row) => String(row.name).toLowerCase() === name.toLowerCase(),
  );
  if (match) return { id: String(match.id), name: String(match.name) };
  const { data: created, error: insertError } = await admin
    .from("shop_categories")
    .insert({ tenant_id: tenantId, name, created_by: actorId })
    .select("id, name")
    .single();
  if (insertError) {
    if (insertError.code === "23505") {
      return ensureCategory(admin, tenantId, actorId, name);
    }
    throw databaseError(insertError);
  }
  return { id: String(created.id), name: String(created.name) };
}

/** Category of an article: an existing id or a (new) name. */
async function resolveCategory(
  admin: Admin,
  tenantId: string,
  actorId: string,
  input: Row,
): Promise<{ id: string; name: string }> {
  if (isUuid(input.categoryId)) {
    const { data, error } = await admin
      .from("shop_categories")
      .select("id, name")
      .eq("tenant_id", tenantId)
      .eq("id", input.categoryId)
      .maybeSingle();
    if (error) throw databaseError(error);
    if (!data) {
      throw new HttpError(
        400,
        "category_unknown",
        "Die Kategorie wurde nicht gefunden.",
      );
    }
    return { id: String(data.id), name: String(data.name) };
  }
  const name = categoryName(input.category) ?? "Allgemein";
  return ensureCategory(admin, tenantId, actorId, name);
}

/** Alle Kategorien eines Artikels (die erste ist die Hauptkategorie). */
async function resolveCategories(
  admin: Admin,
  tenantId: string,
  actorId: string,
  input: Row,
): Promise<{ id: string; name: string }[]> {
  if (Array.isArray(input.categoryIds) && input.categoryIds.length > 0) {
    const ids = [
      ...new Set(input.categoryIds.filter((id): id is string => isUuid(id))),
    ];
    if (ids.length !== input.categoryIds.length || ids.length > 10) {
      throw new HttpError(
        400,
        "category_unknown",
        "Die Kategorien sind ungültig.",
      );
    }
    const { data, error } = await admin
      .from("shop_categories")
      .select("id, name")
      .eq("tenant_id", tenantId)
      .in("id", ids);
    if (error) throw databaseError(error);
    const byId = new Map<string, string>(
      ((data ?? []) as Row[]).map((row) => [String(row.id), String(row.name)]),
    );
    if (ids.some((id) => !byId.has(id))) {
      throw new HttpError(
        400,
        "category_unknown",
        "Eine Kategorie wurde nicht gefunden.",
      );
    }
    return ids.map((id) => ({ id, name: byId.get(id) as string }));
  }
  return [await resolveCategory(admin, tenantId, actorId, input)];
}

async function saveCategory(
  admin: Admin,
  tenantId: string,
  actorId: string,
  input: Row,
) {
  const name = categoryName(input.name);
  if (!name) {
    throw new HttpError(
      400,
      "invalid_request",
      "Der Kategoriename muss 2 bis 80 Zeichen lang sein.",
    );
  }
  if (!isUuid(input.id)) {
    return ensureCategory(admin, tenantId, actorId, name);
  }
  const { data, error } = await admin
    .from("shop_categories")
    .update({ name })
    .eq("tenant_id", tenantId)
    .eq("id", input.id)
    .select("id, name")
    .maybeSingle();
  if (error) {
    if (error.code === "23505") {
      throw new HttpError(
        409,
        "category_exists",
        "Eine Kategorie mit diesem Namen gibt es bereits.",
      );
    }
    throw databaseError(error);
  }
  if (!data) {
    throw new HttpError(
      404,
      "not_found",
      "Die Kategorie wurde nicht gefunden.",
    );
  }
  // Keep the denormalised name on the articles in sync.
  await admin
    .from("shop_catalog_items")
    .update({ category: name })
    .eq("tenant_id", tenantId)
    .eq("category_id", input.id);
  return { id: String(data.id), name: String(data.name) };
}

async function deleteCategory(admin: Admin, tenantId: string, id: string) {
  const { count, error } = await admin
    .from("shop_catalog_items")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .or(`category_id.eq.${id},category_ids.cs.{${id}}`);
  if (error) throw databaseError(error);
  if ((count ?? 0) > 0) {
    throw new HttpError(
      409,
      "category_in_use",
      "Die Kategorie wird noch von Artikeln verwendet.",
    );
  }
  const { error: deleteError } = await admin
    .from("shop_categories")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("id", id);
  if (deleteError) throw databaseError(deleteError);
}

/**
 * Deletes an article. Orders keep their history (each line stores the article
 * name). An article with open order lines cannot be deleted; it can be hidden.
 */
async function deleteCatalogItem(
  admin: Admin,
  tenantId: string,
  actorId: string,
  itemId: string,
) {
  const paths = await catalogItemPaths(admin, tenantId, itemId);
  const { count, error: openError } = await admin
    .from("shop_order_lines")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("catalog_item_id", itemId)
    .in("status", ["open", "reserved", "backorder"]);
  if (openError) throw databaseError(openError);
  if ((count ?? 0) > 0) {
    throw new HttpError(
      409,
      "item_has_open_orders",
      "Der Artikel hat offene Bestellungen. Blende ihn aus, bis sie erledigt sind.",
    );
  }
  // Outstanding loans keep the article until the device is back.
  const { count: loans, error: loanError } = await admin
    .from("shop_order_lines")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("catalog_item_id", itemId)
    .eq("kind", "loan")
    .eq("status", "issued");
  if (loanError) throw databaseError(loanError);
  if ((loans ?? 0) > 0) {
    throw new HttpError(
      409,
      "item_on_loan",
      "Der Artikel ist noch ausgeliehen. Blende ihn aus, bis er zurück ist.",
    );
  }
  // Drop it from the "Dazu bestellen" lists of other articles.
  const { data: referencing, error: refError } = await admin
    .from("shop_catalog_items")
    .select("id, option_item_ids")
    .eq("tenant_id", tenantId)
    .contains("option_item_ids", [itemId]);
  if (refError) throw databaseError(refError);
  for (const row of (referencing ?? []) as Row[]) {
    const ids = Array.isArray(row.option_item_ids) ? row.option_item_ids : [];
    const { error } = await admin
      .from("shop_catalog_items")
      .update({
        option_item_ids: ids.filter((id: unknown) => id !== itemId),
      })
      .eq("tenant_id", tenantId)
      .eq("id", row.id);
    if (error) throw databaseError(error);
  }
  const { error } = await admin
    .from("shop_catalog_items")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("id", itemId);
  if (error) throw databaseError(error);
  if (paths.length > 0) {
    await admin.storage.from(IMAGE_BUCKET).remove(paths);
  }
  await audit(admin, tenantId, actorId, "shop.catalog.item_deleted", itemId);
}

async function saveCatalogItem(
  admin: Admin,
  tenantId: string,
  actorId: string,
  input: Row,
  scope: DepartmentScope,
) {
  // Department: required choice for new articles (when there are several),
  // optional change for existing ones; always one of the own departments.
  let departmentId: string | null;
  if (isUuid(input.id)) {
    const current = await requireEditableCatalogItem(
      admin,
      tenantId,
      input.id,
      scope,
    );
    if (
      input.departmentId === undefined ||
      input.departmentId === null ||
      input.departmentId === ""
    ) {
      departmentId = current;
    } else {
      const resolved = resolveRecordDepartment(scope, input.departmentId);
      if ("error" in resolved) {
        throw new HttpError(422, "invalid_department", resolved.error);
      }
      departmentId = resolved.departmentId;
    }
  } else {
    const resolved = resolveRecordDepartment(scope, input.departmentId);
    if ("error" in resolved) {
      throw new HttpError(422, "invalid_department", resolved.error);
    }
    departmentId = resolved.departmentId;
  }
  const name = text(input.name, 160);
  const categories = await resolveCategories(admin, tenantId, actorId, input);
  const category = categories[0];
  const articleNumber =
    input.articleNumber === null ||
    input.articleNumber === undefined ||
    input.articleNumber === ""
      ? null
      : text(input.articleNumber, 80);
  const supplierUrl =
    input.supplierUrl === null ||
    input.supplierUrl === undefined ||
    input.supplierUrl === ""
      ? null
      : supplierLink(input.supplierUrl);
  const description =
    input.description === null ||
    input.description === undefined ||
    input.description === ""
      ? null
      : text(input.description, 2000);
  const kind =
    input.kind === "loan" ? "loan" : input.kind === "order" ? "order" : null;
  const maxQuantity = int(input.maxQuantity, 1, 100);
  const maxLoanDays =
    input.maxLoanDays === null || input.maxLoanDays === undefined
      ? null
      : int(input.maxLoanDays, 1, 365);
  let inventoryItemId =
    input.inventoryItemId === null || input.inventoryItemId === undefined
      ? null
      : isUuid(input.inventoryItemId)
        ? input.inventoryItemId
        : undefined;
  const createInventoryItem =
    input.createInventoryItem === true && inventoryItemId === null;
  const rawOptions =
    input.optionItemIds === undefined || input.optionItemIds === null
      ? []
      : input.optionItemIds;
  const optionItemIds = Array.isArray(rawOptions)
    ? [...new Set(rawOptions.filter((id): id is string => isUuid(id)))]
    : null;
  const loanQuantity =
    kind === "loan" &&
    inventoryItemId === null &&
    input.loanQuantity !== undefined &&
    input.loanQuantity !== null
      ? int(input.loanQuantity, 0, 10000)
      : null;
  if (
    kind === "loan" &&
    inventoryItemId === null &&
    (input.loanQuantity === undefined ||
      input.loanQuantity === null ||
      loanQuantity === null)
  ) {
    throw new HttpError(
      400,
      "loan_quantity_required",
      "Bitte angeben, wie viele Stück zum Ausleihen vorhanden sind.",
    );
  }
  const specifications = cleanSpecifications(input.specifications);
  if (specifications === null) {
    throw new HttpError(
      400,
      "invalid_request",
      "Die technischen Angaben sind ungültig (höchstens 2000 Zeichen je Feld).",
    );
  }
  if (
    optionItemIds === null ||
    (Array.isArray(rawOptions) &&
      optionItemIds.length !== new Set(rawOptions).size) ||
    optionItemIds.length > 10 ||
    (isUuid(input.id) && optionItemIds.includes(input.id))
  ) {
    throw new HttpError(
      400,
      "invalid_request",
      "Die Optionen des Artikels sind ungültig.",
    );
  }
  if (optionItemIds.length > 0) {
    const { data: found, error: optionError } = await admin
      .from("shop_catalog_items")
      .select("id")
      .eq("tenant_id", tenantId)
      .in("id", optionItemIds);
    if (optionError) throw databaseError(optionError);
    if ((found ?? []).length !== optionItemIds.length) {
      throw new HttpError(
        400,
        "option_item_unknown",
        "Eine gewählte Option wurde nicht gefunden.",
      );
    }
  }
  if (
    !name ||
    Array.from(name).length < 2 ||
    (articleNumber === null && input.articleNumber) ||
    (supplierUrl === null && input.supplierUrl) ||
    (description === null && input.description) ||
    !kind ||
    maxQuantity === null ||
    (input.maxLoanDays !== null &&
      input.maxLoanDays !== undefined &&
      maxLoanDays === null) ||
    inventoryItemId === undefined ||
    typeof input.requiresApproval !== "boolean" ||
    typeof input.active !== "boolean"
  ) {
    throw new HttpError(
      400,
      "invalid_request",
      "Bitte die Angaben zum Artikel prüfen.",
    );
  }
  if (inventoryItemId) {
    const { data: item } = await admin
      .from("inventory_items")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("id", inventoryItemId)
      .maybeSingle();
    if (!item) {
      throw new HttpError(
        400,
        "inventory_item_unknown",
        "Der Lagerartikel wurde nicht gefunden.",
      );
    }
  }
  if (createInventoryItem && name) {
    inventoryItemId = await ensureInventoryItem(admin, tenantId, {
      name,
      articleNumber,
      category: category.name,
      departmentId,
    });
  }
  const values = {
    tenant_id: tenantId,
    name,
    description,
    category: category.name,
    category_id: category.id,
    category_ids: categories.map((entry) => entry.id),
    article_number: articleNumber,
    supplier_url: supplierUrl,
    kind,
    requires_approval: input.requiresApproval,
    max_quantity: maxQuantity,
    max_loan_days: kind === "loan" ? maxLoanDays : null,
    inventory_item_id: inventoryItemId,
    option_item_ids: optionItemIds,
    loan_quantity: loanQuantity,
    specifications,
    active: input.active,
    sort_order: int(input.sortOrder, -1000, 1000) ?? 0,
    department_id: departmentId,
    updated_at: new Date().toISOString(),
  };
  if (isUuid(input.id)) {
    const { data, error } = await admin
      .from("shop_catalog_items")
      .update(values)
      .eq("tenant_id", tenantId)
      .eq("id", input.id)
      .select("id")
      .maybeSingle();
    if (error) throw databaseError(error);
    if (!data)
      throw new HttpError(
        404,
        "not_found",
        "Der Artikel wurde nicht gefunden.",
      );
    await audit(admin, tenantId, actorId, "shop.catalog.updated", input.id);
    return input.id;
  }
  const { data, error } = await admin
    .from("shop_catalog_items")
    .insert({ ...values, created_by: actorId })
    .select("id")
    .single();
  if (error) throw databaseError(error);
  await audit(admin, tenantId, actorId, "shop.catalog.created", data.id);
  return data.id;
}

/**
 * Stock article for a shop article: reuses the stock article with the same
 * article number, otherwise creates one. Returns its id.
 */
async function ensureInventoryItem(
  admin: Admin,
  tenantId: string,
  input: {
    name: string;
    articleNumber: string | null;
    category: string;
    departmentId: string | null;
  },
): Promise<string> {
  const normalized = input.articleNumber
    ? input.articleNumber.trim().toLowerCase()
    : "";
  const validNumber = /^[a-z0-9][a-z0-9._/-]{0,159}$/u.test(normalized)
    ? normalized
    : null;
  if (validNumber) {
    const { data: existing, error } = await admin
      .from("inventory_items")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("article_number", validNumber)
      .maybeSingle();
    if (error) throw databaseError(error);
    if (existing) return String((existing as Row).id);
  }
  const articleNumber =
    validNumber ?? `shop-${crypto.randomUUID().slice(0, 8)}`;
  const { data, error } = await admin
    .from("inventory_items")
    .insert({
      tenant_id: tenantId,
      article_number: articleNumber,
      name: input.name.slice(0, 240),
      category: input.category.slice(0, 120),
      // A new stock article belongs to the department of the shop article.
      department_id: input.departmentId,
    })
    .select("id")
    .single();
  if (error) throw databaseError(error);
  return String((data as Row).id);
}

/** Offers a stock article in the shop (or returns the shop article it has). */
async function offerInventoryItem(
  admin: Admin,
  tenantId: string,
  actorId: string,
  inventoryItemId: string,
  scope: DepartmentScope,
): Promise<{ id: string; created: boolean }> {
  const { data: stock, error } = await admin
    .from("inventory_items")
    .select("id, name, article_number, category, tracking_mode, department_id")
    .eq("tenant_id", tenantId)
    .eq("id", inventoryItemId)
    .maybeSingle();
  if (error) throw databaseError(error);
  // Only stock articles of the own departments (or without department).
  if (!stock || !departmentVisible(scope, (stock as Row).department_id)) {
    throw new HttpError(
      404,
      "inventory_item_unknown",
      "Der Lagerartikel wurde nicht gefunden.",
    );
  }
  const { data: linked, error: linkedError } = await admin
    .from("shop_catalog_items")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("inventory_item_id", inventoryItemId)
    .limit(1)
    .maybeSingle();
  if (linkedError) throw databaseError(linkedError);
  if (linked) return { id: String((linked as Row).id), created: false };
  const row = stock as Row;
  const stockCategory = categoryName(row.category);
  const category = await ensureCategory(
    admin,
    tenantId,
    actorId,
    stockCategory && stockCategory.toLowerCase() !== "general"
      ? stockCategory
      : "Allgemein",
  );
  const name = String(row.name).slice(0, 160).trim();
  // The shop article takes the department of the stock article; without one,
  // the manager's only department (several: for all departments).
  const departmentId = isUuid(row.department_id)
    ? row.department_id
    : scope.departments.length === 1
      ? (scope.departments[0] ?? null)
      : null;
  const { data, error: insertError } = await admin
    .from("shop_catalog_items")
    .insert({
      tenant_id: tenantId,
      name: Array.from(name).length >= 2 ? name : `Artikel ${name}`,
      category: category.name,
      category_id: category.id,
      category_ids: [category.id],
      article_number: row.article_number,
      kind: row.tracking_mode === "serial" ? "loan" : "order",
      max_loan_days: row.tracking_mode === "serial" ? 30 : null,
      inventory_item_id: inventoryItemId,
      department_id: departmentId,
      created_by: actorId,
    })
    .select("id")
    .single();
  if (insertError) throw databaseError(insertError);
  const id = String((data as Row).id);
  await audit(admin, tenantId, actorId, "shop.catalog.created", id);
  return { id, created: true };
}

async function audit(
  admin: Admin,
  tenantId: string,
  actorId: string,
  action: string,
  entityId: string,
) {
  await admin.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_id: actorId,
    action,
    entity_type: "shop_catalog_item",
    entity_id: entityId,
    severity: "info",
    metadata: {},
  });
}

const securedHandler = withSupabase(
  { auth: "user" },
  async (request, context) => {
    if (request.method !== "POST") {
      return json(request, { error: { code: "method_not_allowed" } }, 405);
    }
    const body = await parseJsonObject(request);
    const actorId = context.userClaims?.id;
    if (
      !body ||
      typeof body.type !== "string" ||
      !isUuid(actorId) ||
      !isUuid(body.tenantId)
    ) {
      return json(request, { error: { code: "invalid_request" } }, 400);
    }
    const tenantId = body.tenantId.toLowerCase();
    const admin = context.supabaseAdmin;
    try {
      const access = await requireShop(admin, actorId, tenantId);

      switch (body.type) {
        case "getContext": {
          const { scope, ...permissions } = access;
          const [
            { count: approvals },
            agentOrders,
            { data: managerLabel },
            departments,
          ] = await Promise.all([
            (() => {
              let query = admin
                .from("shop_orders")
                .select("id", { count: "exact", head: true })
                .eq("tenant_id", tenantId)
                .eq("status", "pending_approval")
                .neq("requester_id", actorId);
              query = access.canFulfill
                ? query.or(`approver_id.eq.${actorId},approver_id.is.null`)
                : query.eq("approver_id", actorId);
              return query;
            })(),
            // Open orders with articles of the agent's departments.
            access.canFulfill
              ? (async () => {
                  const { data, error } = await admin
                    .from("shop_orders")
                    .select("id, status, shop_order_lines(catalog_item_id)")
                    .eq("tenant_id", tenantId)
                    .in("status", ["submitted", "in_progress", "ready"])
                    .limit(2000);
                  if (error) throw databaseError(error);
                  return await handledOrders(
                    admin,
                    tenantId,
                    scope,
                    (data ?? []) as Row[],
                  );
                })()
              : Promise.resolve([] as Row[]),
            admin.rpc("shop_manager_label", {
              p_tenant_id: tenantId,
              p_user_id: actorId,
            }),
            // Department choice for the article editor.
            access.canManage
              ? scopeDepartmentOptions(admin, tenantId, scope)
              : Promise.resolve([]),
          ]);
          return json(request, {
            data: {
              ...permissions,
              departments,
              pendingApprovals: approvals ?? 0,
              openOrders: agentOrders.length,
              // New orders nobody has taken on yet (navigation badge).
              newOrders: agentOrders.filter(
                (order) => order.status === "submitted",
              ).length,
              managerName:
                typeof managerLabel === "string" ? managerLabel : null,
            },
          });
        }
        case "listCatalog": {
          const includeInactive =
            body.includeInactive === true && access.canManage;
          return json(request, {
            data: {
              items: await listCatalog(
                admin,
                tenantId,
                includeInactive,
                access.canFulfill || access.canManage,
                access,
              ),
            },
          });
        }
        case "saveCatalogItem": {
          if (!access.canManage || !isRecord(body.item)) {
            throw new HttpError(
              403,
              "forbidden",
              "Für diese Aktion fehlt die Berechtigung.",
            );
          }
          const id = await saveCatalogItem(
            admin,
            tenantId,
            actorId,
            body.item,
            access.scope,
          );
          return json(request, { data: { id } });
        }
        case "offerInventoryItem": {
          if (!access.canManage || !isUuid(body.inventoryItemId)) {
            throw new HttpError(
              403,
              "forbidden",
              "Für diese Aktion fehlt die Berechtigung.",
            );
          }
          return json(request, {
            data: await offerInventoryItem(
              admin,
              tenantId,
              actorId,
              body.inventoryItemId.toLowerCase(),
              access.scope,
            ),
          });
        }
        case "deleteCatalogItem": {
          if (!access.canManage || !isUuid(body.itemId)) {
            throw new HttpError(
              403,
              "forbidden",
              "Für diese Aktion fehlt die Berechtigung.",
            );
          }
          await requireEditableCatalogItem(
            admin,
            tenantId,
            body.itemId.toLowerCase(),
            access.scope,
          );
          await deleteCatalogItem(
            admin,
            tenantId,
            actorId,
            body.itemId.toLowerCase(),
          );
          return json(request, { data: { deleted: true } });
        }
        case "listCategories": {
          return json(request, {
            data: { categories: await listCategories(admin, tenantId) },
          });
        }
        case "saveCategory":
        case "deleteCategory": {
          if (!access.canManage) {
            throw new HttpError(
              403,
              "forbidden",
              "Für diese Aktion fehlt die Berechtigung.",
            );
          }
          if (body.type === "saveCategory") {
            const category = await saveCategory(
              admin,
              tenantId,
              actorId,
              isRecord(body.category) ? body.category : {},
            );
            return json(request, { data: { category } });
          }
          if (!isUuid(body.categoryId)) {
            throw new HttpError(
              400,
              "invalid_request",
              "Die Kategorie ist ungültig.",
            );
          }
          await deleteCategory(admin, tenantId, body.categoryId.toLowerCase());
          return json(request, { data: { deleted: true } });
        }
        case "addCatalogItemImage":
        case "removeCatalogItemImage": {
          if (!access.canManage || !isUuid(body.itemId)) {
            throw new HttpError(
              403,
              "forbidden",
              "Für diese Aktion fehlt die Berechtigung.",
            );
          }
          const itemId = body.itemId.toLowerCase();
          await requireEditableCatalogItem(
            admin,
            tenantId,
            itemId,
            access.scope,
          );
          if (body.type === "addCatalogItemImage") {
            const imageIdValue = await addCatalogItemImage(
              admin,
              tenantId,
              actorId,
              itemId,
              body.image,
            );
            return json(request, { data: { id: imageIdValue } }, 201);
          }
          if (!isUuid(body.imageId)) {
            throw new HttpError(
              400,
              "invalid_request",
              "Das Foto ist ungültig.",
            );
          }
          await removeCatalogItemImage(
            admin,
            tenantId,
            actorId,
            itemId,
            body.imageId.toLowerCase(),
          );
          return json(request, { data: { removed: true } });
        }
        case "listInventoryItems": {
          if (!access.canManage) {
            throw new HttpError(
              403,
              "forbidden",
              "Für diese Aktion fehlt die Berechtigung.",
            );
          }
          // Stock articles of the own departments (or without department).
          const { data, error } = await applyDepartmentScope(
            admin
              .from("inventory_items")
              .select("id, article_number, name, tracking_mode, category")
              .eq("tenant_id", tenantId)
              .eq("active", true),
            access.scope,
          )
            .order("name")
            .limit(1000);
          if (error) throw databaseError(error);
          return json(request, {
            data: {
              items: ((data ?? []) as Row[]).map((item) => ({
                id: item.id,
                articleNumber: item.article_number,
                name: item.name,
                trackingMode: item.tracking_mode,
                category: item.category,
              })),
            },
          });
        }
        case "submitOrder": {
          if (!isUuid(body.clientRequestId) || !Array.isArray(body.lines)) {
            throw new HttpError(
              400,
              "invalid_request",
              "Der Warenkorb ist leer.",
            );
          }
          const lines = body.lines.filter(isRecord).map((line) => ({
            catalog_item_id: isUuid(line.catalogItemId)
              ? line.catalogItemId
              : null,
            quantity: int(line.quantity, 1, 100),
            // Zeitraum pro Ausleihartikel (ältere Clients senden ihn für die
            // ganze Bestellung, siehe loanFrom/loanUntil unten).
            loan_from: isoDate(line.loanFrom),
            loan_until: isoDate(line.loanUntil),
          }));
          if (
            lines.length === 0 ||
            lines.length > 30 ||
            lines.some((line) => !line.catalog_item_id || !line.quantity)
          ) {
            throw new HttpError(
              400,
              "invalid_request",
              "Bitte den Warenkorb prüfen.",
            );
          }
          // Der Grund ist Pflicht, ausser es werden nur Artikel zum Ausleihen
          // bestellt (dort ist er freiwillig).
          const reasonText = text(body.reason, 500);
          const reason =
            reasonText && Array.from(reasonText).length >= 3
              ? reasonText
              : null;
          // Ausleihartikel mit eigenem Bestand: nicht mehr ausleihen als frei.
          {
            const wanted = new Map<string, number>();
            for (const line of lines) {
              wanted.set(
                line.catalog_item_id as string,
                (wanted.get(line.catalog_item_id as string) ?? 0) +
                  (line.quantity as number),
              );
            }
            const [{ data: stocked }, shopOn] = await Promise.all([
              admin
                .from("shop_catalog_items")
                .select(
                  "id, name, kind, inventory_item_id, loan_quantity, department_id",
                )
                .eq("tenant_id", tenantId)
                .in("id", [...wanted.keys()]),
              shopDepartments(admin, tenantId),
            ]);
            const stockedRows = (stocked ?? []) as Row[];
            // Articles of departments in which the shop is off cannot be
            // ordered (they are not shown in the catalog either).
            const unavailable = stockedRows.find(
              (row) =>
                isUuid(row.department_id) && !shopOn.has(row.department_id),
            );
            if (unavailable) {
              throw new HttpError(
                409,
                "item_unavailable",
                `«${unavailable.name}» kann zurzeit nicht bestellt werden.`,
              );
            }
            const onlyLoans =
              stockedRows.length > 0 &&
              stockedRows.every((row) => row.kind === "loan");
            if (!reason && !onlyLoans) {
              throw new HttpError(
                400,
                "reason_required",
                "Bitte den Grund der Bestellung angeben.",
              );
            }
            // Ausleihe ab / Rückgabe bis sind für jeden Ausleihartikel Pflicht.
            for (const row of stockedRows) {
              if (row.kind !== "loan") continue;
              const line = lines.find(
                (candidate) => candidate.catalog_item_id === row.id,
              );
              const from = line?.loan_from ?? isoDate(body.loanFrom);
              const until = line?.loan_until ?? isoDate(body.loanUntil);
              if (!from || !until) {
                throw new HttpError(
                  400,
                  "loan_period_required",
                  `Bitte für «${row.name}» Ausleihe ab und Rückgabe bis angeben.`,
                );
              }
            }
            const limited = stockedRows.filter(
              (row) =>
                row.kind === "loan" &&
                row.inventory_item_id === null &&
                typeof row.loan_quantity === "number",
            );
            const borrowed = await borrowedQuantities(
              admin,
              tenantId,
              limited.map((row) => String(row.id)),
            );
            for (const row of limited) {
              const free = Math.max(
                0,
                (row.loan_quantity as number) -
                  (borrowed.get(String(row.id)) ?? 0),
              );
              if ((wanted.get(String(row.id)) ?? 0) > free) {
                throw new HttpError(
                  409,
                  "insufficient_stock",
                  `Für «${row.name}» sind nur noch ${free} Stück zum Ausleihen frei.`,
                );
              }
            }
          }
          // Agents may order on behalf of an employee.
          const requesterId =
            isUuid(body.requesterId) && body.requesterId !== actorId
              ? body.requesterId.toLowerCase()
              : actorId;
          if (requesterId !== actorId && !access.canFulfill) {
            throw new HttpError(
              403,
              "forbidden",
              "Nur Agenten können für andere Personen bestellen.",
            );
          }
          const { data, error } = await admin.rpc("shop_submit_order_for", {
            p_actor_id: actorId,
            p_tenant_id: tenantId,
            p_requester_id: requesterId,
            p_client_request_id: body.clientRequestId,
            p_lines: lines,
            p_delivery_method:
              body.deliveryMethod === "desk" ? "desk" : "pickup",
            p_delivery_location: text(body.deliveryLocation, 200),
            p_needed_by: isoDate(body.neededBy),
            p_loan_from: isoDate(body.loanFrom),
            p_loan_until: isoDate(body.loanUntil),
            p_comment: text(body.comment, 2000),
          });
          if (error) throw databaseError(error);
          // Der Grund wird nach dem Anlegen an der Bestellung gespeichert. Ein
          // Fehler hier macht die bereits angelegte Bestellung nicht ungültig.
          if (isUuid(data) && reason) {
            const { error: reasonError } = await admin
              .from("shop_orders")
              .update({ reason })
              .eq("tenant_id", tenantId)
              .eq("id", data);
            if (reasonError) console.error("Shop order reason not saved");
          }
          return json(request, { data: { orderId: data } }, 201);
        }
        case "listRequesters": {
          if (!access.canFulfill) {
            throw new HttpError(
              403,
              "forbidden",
              "Für diese Aktion fehlt die Berechtigung.",
            );
          }
          return json(request, {
            data: { people: await listRequesters(admin, tenantId) },
          });
        }
        case "listOrders": {
          const scope =
            body.scope === "all" || body.scope === "approvals"
              ? body.scope
              : "mine";
          const status =
            typeof body.status === "string" ? text(body.status, 30) : null;
          return json(request, {
            data: {
              orders: await listOrders(
                admin,
                tenantId,
                actorId,
                scope,
                access.canFulfill,
                status,
                access.scope,
              ),
            },
          });
        }
        case "getOrder": {
          if (!isUuid(body.orderId)) {
            throw new HttpError(
              400,
              "invalid_request",
              "Die Bestellung ist ungültig.",
            );
          }
          return json(request, {
            data: {
              order: await getOrder(
                admin,
                tenantId,
                actorId,
                body.orderId,
                access.canFulfill,
                access.scope,
              ),
            },
          });
        }
        case "updateOrder": {
          if (
            !isUuid(body.orderId) ||
            typeof body.action !== "string" ||
            !UPDATE_ACTIONS.has(body.action)
          ) {
            throw new HttpError(
              400,
              "invalid_request",
              "Die Aktion ist ungültig.",
            );
          }
          const lines = Array.isArray(body.lines)
            ? body.lines.filter(isRecord).map((line) => ({
                line_id: isUuid(line.lineId) ? line.lineId : null,
                location_id: isUuid(line.locationId) ? line.locationId : null,
                serial_unit_id: isUuid(line.serialUnitId)
                  ? line.serialUnitId
                  : null,
              }))
            : [];
          // Agents process only orders with articles of their departments.
          // Approving and the requester's own cancel or note stay open.
          if (
            access.canFulfill &&
            body.action !== "approve" &&
            body.action !== "reject_approval"
          ) {
            const { data: target, error: targetError } = await admin
              .from("shop_orders")
              .select("requester_id")
              .eq("tenant_id", tenantId)
              .eq("id", body.orderId)
              .maybeSingle();
            if (targetError) throw databaseError(targetError);
            const ownRequest =
              target?.requester_id === actorId &&
              (body.action === "cancel" || body.action === "note");
            if (
              target &&
              !ownRequest &&
              !(await handlesOrder(admin, tenantId, access.scope, body.orderId))
            ) {
              throw new HttpError(
                404,
                "not_found",
                "Die Bestellung wurde nicht gefunden.",
              );
            }
          }
          if (body.action === "ready") {
            // "Ready for pickup" only exists when the person picks it up.
            const { data: target } = await admin
              .from("shop_orders")
              .select("delivery_method")
              .eq("tenant_id", tenantId)
              .eq("id", body.orderId)
              .maybeSingle();
            if (target && target.delivery_method !== "pickup") {
              throw new HttpError(
                409,
                "not_pickup",
                "Diese Bestellung wird an den Arbeitsplatz geliefert, nicht abgeholt.",
              );
            }
          }
          const { data, error } = await admin.rpc("shop_update_order", {
            p_actor_id: actorId,
            p_tenant_id: tenantId,
            p_order_id: body.orderId,
            p_action: body.action,
            p_payload: {
              reason: text(body.reason, 1000),
              note: text(body.note, 2000),
              internal: body.internal !== false,
              lines: lines.filter((line) => line.line_id),
            },
          });
          if (error) throw databaseError(error);
          return json(request, { data: { status: data } });
        }
        default:
          return json(request, { error: { code: "invalid_request" } }, 400);
      }
    } catch (error) {
      if (error instanceof HttpError) {
        return json(
          request,
          { error: { code: error.code, message: error.message } },
          error.status,
        );
      }
      console.error("Shop request failed");
      return json(
        request,
        {
          error: {
            code: "shop_failed",
            message: "Der Shop ist gerade nicht erreichbar.",
          },
        },
        500,
      );
    }
  },
);

export default {
  fetch(request: Request): Response | Promise<Response> {
    return request.method === "OPTIONS"
      ? noContent(request)
      : securedHandler(request);
  },
};
