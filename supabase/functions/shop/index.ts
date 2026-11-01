import { withSupabase } from "@supabase/server";
import {
  isRecord,
  isUuid,
  json,
  noContent,
  parseJsonObject,
} from "../_shared/http.ts";

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
const ORDER_SELECT =
  "id, order_number, requester_id, placed_by, status, approver_id, approved_by, approved_at, handled_by, delivery_method, delivery_location, needed_by, loan_from, loan_until, comment, decision_reason, issued_at, returned_at, closed_at, created_at, updated_at";
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
  const [canOrder, canFulfill, canManage] = await Promise.all([
    permission(admin, actorId, tenantId, "shop.order"),
    permission(admin, actorId, tenantId, "shop.fulfill"),
    permission(admin, actorId, tenantId, "shop.manage"),
  ]);
  return { canOrder, canFulfill, canManage };
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

async function listCatalog(
  admin: Admin,
  tenantId: string,
  includeInactive: boolean,
  exact: boolean,
) {
  let query = admin
    .from("shop_catalog_items")
    .select(
      "id, inventory_item_id, name, description, category, kind, requires_approval, max_quantity, max_loan_days, active, sort_order",
    )
    .eq("tenant_id", tenantId)
    .order("category")
    .order("sort_order")
    .order("name");
  if (!includeInactive) query = query.eq("active", true);
  const { data, error } = await query;
  if (error) throw databaseError(error);
  const rows = (data ?? []) as Row[];
  const itemIds = rows
    .map((row) => row.inventory_item_id)
    .filter((id): id is string => isUuid(id));
  const [stock, images] = await Promise.all([
    availability(admin, tenantId, itemIds),
    imageUrls(admin, tenantId, itemIds),
  ]);
  return rows.map((row) => {
    const itemId = isUuid(row.inventory_item_id) ? row.inventory_item_id : null;
    const available = itemId ? stock.get(itemId) : undefined;
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      category: row.category,
      kind: row.kind,
      requiresApproval: row.requires_approval === true,
      maxQuantity: row.max_quantity,
      maxLoanDays: row.max_loan_days,
      active: row.active === true,
      sortOrder: row.sort_order,
      inventoryItemId: itemId,
      imageUrl: itemId ? (images.get(itemId) ?? null) : null,
      stockLevel: stockLevel(available, itemId !== null),
      availableQuantity: exact && itemId ? (available ?? 0) : null,
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
) {
  let query = admin
    .from("shop_orders")
    .select(`${ORDER_SELECT}, shop_order_lines(item_name, quantity, kind)`)
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(200);
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
  const rows = (data ?? []) as Row[];
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
  canFulfill: boolean,
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
  const isRequester = row.requester_id === actorId;
  const isApprover =
    row.status === "pending_approval" &&
    !isRequester &&
    (row.approver_id === actorId || (row.approver_id === null && canFulfill));
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
        "id, catalog_item_id, inventory_item_id, item_name, kind, quantity, status, location_id, serial_unit_id, issued_at, returned_at",
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
      inventoryItemId: line.inventory_item_id,
      locationId: line.location_id,
      serialUnitId: line.serial_unit_id,
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

async function saveCatalogItem(
  admin: Admin,
  tenantId: string,
  actorId: string,
  input: Row,
) {
  const name = text(input.name, 160);
  const category = text(input.category, 80) ?? "Allgemein";
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
  const inventoryItemId =
    input.inventoryItemId === null || input.inventoryItemId === undefined
      ? null
      : isUuid(input.inventoryItemId)
        ? input.inventoryItemId
        : undefined;
  if (
    !name ||
    Array.from(name).length < 2 ||
    Array.from(category).length < 2 ||
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
  const values = {
    tenant_id: tenantId,
    name,
    description,
    category,
    kind,
    requires_approval: input.requiresApproval,
    max_quantity: maxQuantity,
    max_loan_days: kind === "loan" ? maxLoanDays : null,
    inventory_item_id: inventoryItemId,
    active: input.active,
    sort_order: int(input.sortOrder, -1000, 1000) ?? 0,
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
          const [
            { count: approvals },
            { count: openOrders },
            { data: managerLabel },
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
            access.canFulfill
              ? admin
                  .from("shop_orders")
                  .select("id", { count: "exact", head: true })
                  .eq("tenant_id", tenantId)
                  .in("status", ["submitted", "in_progress", "ready"])
              : Promise.resolve({ count: 0 }),
            admin.rpc("shop_manager_label", {
              p_tenant_id: tenantId,
              p_user_id: actorId,
            }),
          ]);
          return json(request, {
            data: {
              ...access,
              pendingApprovals: approvals ?? 0,
              openOrders: openOrders ?? 0,
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
          const id = await saveCatalogItem(admin, tenantId, actorId, body.item);
          return json(request, { data: { id } });
        }
        case "listInventoryItems": {
          if (!access.canManage) {
            throw new HttpError(
              403,
              "forbidden",
              "Für diese Aktion fehlt die Berechtigung.",
            );
          }
          const { data, error } = await admin
            .from("inventory_items")
            .select("id, article_number, name, tracking_mode, category")
            .eq("tenant_id", tenantId)
            .eq("active", true)
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
