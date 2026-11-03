import { supabase } from "./supabase";

/** Client for the `shop` Edge Function (self-service shop). */

export type ShopContext = {
  canOrder: boolean;
  canFulfill: boolean;
  canManage: boolean;
  pendingApprovals: number;
  openOrders: number;
  managerName: string | null;
};

/** Technische Angaben eines Artikels: Schlüssel und Bezeichnung. */
export const SPEC_FIELDS = [
  { key: "scope", label: "Lieferumfang" },
  { key: "usage", label: "Anwendungsbereich" },
  { key: "compatibility", label: "Kompatibilität" },
  { key: "equipment", label: "Ausstattung" },
  { key: "connectivity", label: "Konnektivität" },
  { key: "properties", label: "Eigenschaften" },
] as const;

export type StockLevel = "in_stock" | "low" | "out_of_stock" | "on_request";
export type ItemKind = "order" | "loan";

export type CatalogItem = {
  id: string;
  name: string;
  description: string | null;
  category: string;
  categoryId?: string | null;
  /** Internal, only sent to agents. */
  articleNumber?: string | null;
  /** Internal, only sent to agents. */
  supplierUrl?: string | null;
  kind: ItemKind;
  requiresApproval: boolean;
  maxQuantity: number;
  maxLoanDays: number | null;
  active: boolean;
  sortOrder: number;
  inventoryItemId: string | null;
  /** Technische Angaben (Lieferumfang, Anwendungsbereich, …). */
  specifications?: Record<string, string>;
  /** Artikel, die beim Bestellen dieses Artikels dazugewählt werden können. */
  optionItemIds?: string[];
  imageUrl: string | null;
  /** All photos to show (own photos, else the inventory photo). */
  imageUrls?: string[];
  /** The shop's own photos (max. 5), editable by agents. */
  images?: { id: string; url: string }[];
  stockLevel: StockLevel;
  availableQuantity: number | null;
};

export type ShopCategory = {
  id: string;
  name: string;
  itemCount: number;
};

export type InventoryOption = {
  id: string;
  articleNumber: string;
  name: string;
  trackingMode: "quantity" | "serial";
  category: string;
};

export type OrderStatus =
  | "pending_approval"
  | "submitted"
  | "in_progress"
  | "ready"
  | "issued"
  | "loaned"
  | "returned"
  | "rejected"
  | "cancelled";

export type OrderSummary = {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  overdue: boolean;
  requesterId: string;
  requesterName: string | null;
  placedByName: string | null;
  approverName: string | null;
  handledByName: string | null;
  deliveryMethod: "pickup" | "desk";
  deliveryLocation: string | null;
  neededBy: string | null;
  loanFrom: string | null;
  loanUntil: string | null;
  comment: string | null;
  decisionReason: string | null;
  /** Grund der Bestellung (ältere Bestellungen: leer). */
  reason?: string | null;
  lineCount: number;
  itemsLabel?: string;
  createdAt: string;
  updatedAt: string;
};

export type ShopPerson = {
  id: string;
  name: string;
  jobTitle: string | null;
};

export type OrderLine = {
  id: string;
  itemName: string;
  kind: ItemKind;
  quantity: number;
  status:
    "open" | "reserved" | "backorder" | "issued" | "returned" | "cancelled";
  inventoryItemId: string | null;
  /** Cover photo of the article, if any. */
  imageUrl?: string | null;
  /** Internal, only sent to agents. */
  articleNumber?: string | null;
  /** Internal, only sent to agents. */
  supplierUrl?: string | null;
  locationId: string | null;
  serialUnitId: string | null;
  stock: {
    trackingMode: "quantity" | "serial";
    locations: { id: string; name: string; available: number }[];
    serialUnits: { id: string; serialNumber: string }[];
  } | null;
};

export type OrderDetail = OrderSummary & {
  approvedByName: string | null;
  approvedAt: string | null;
  issuedAt: string | null;
  returnedAt: string | null;
  lines: OrderLine[];
  events: {
    id: string;
    type: string;
    note: string | null;
    internal: boolean;
    actorName: string | null;
    createdAt: string;
  }[];
  permissions: {
    canApprove: boolean;
    canCancel: boolean;
    canProcess: boolean;
    isRequester: boolean;
  };
};

export type OrderAction =
  | "approve"
  | "reject_approval"
  | "accept"
  | "ready"
  | "issue"
  | "return"
  | "reject"
  | "cancel"
  | "note";

async function call<T>(body: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error("nextDesk ist nicht konfiguriert.");
  const { data, error } = await supabase.functions.invoke("shop", { body });
  if (error) {
    const context =
      typeof error === "object" && error !== null && "context" in error
        ? (error as { context?: unknown }).context
        : undefined;
    if (context instanceof Response) {
      const payload = (await context
        .clone()
        .json()
        .catch(() => null)) as { error?: { message?: unknown } } | null;
      if (typeof payload?.error?.message === "string") {
        throw new Error(payload.error.message);
      }
    }
    throw new Error("Der Shop ist gerade nicht erreichbar.");
  }
  return (data as { data: T }).data;
}

/** Artikel immer alphabetisch nach Name (Gross-/Kleinschreibung egal). */
export function sortCatalogByName<T extends { name: string }>(items: T[]): T[] {
  return [...items].sort((left, right) =>
    left.name.localeCompare(right.name, "de", {
      numeric: true,
      sensitivity: "base",
    }),
  );
}

export const shopApi = {
  context: (tenantId: string) =>
    call<ShopContext>({ type: "getContext", tenantId }),
  catalog: (tenantId: string, includeInactive = false) =>
    call<{ items: CatalogItem[] }>({
      type: "listCatalog",
      tenantId,
      includeInactive,
    }).then((data) => sortCatalogByName(data.items)),
  inventoryItems: (tenantId: string) =>
    call<{ items: InventoryOption[] }>({
      type: "listInventoryItems",
      tenantId,
    }).then((data) => data.items),
  saveItem: (tenantId: string, item: Record<string, unknown>) =>
    call<{ id: string }>({ type: "saveCatalogItem", tenantId, item }),
  people: (tenantId: string) =>
    call<{ people: ShopPerson[] }>({ type: "listRequesters", tenantId }).then(
      (data) => data.people,
    ),
  categories: (tenantId: string) =>
    call<{ categories: ShopCategory[] }>({
      type: "listCategories",
      tenantId,
    }).then((data) => data.categories),
  saveCategory: (tenantId: string, category: { id?: string; name: string }) =>
    call<{ category: { id: string; name: string } }>({
      type: "saveCategory",
      tenantId,
      category,
    }).then((data) => data.category),
  deleteCategory: (tenantId: string, categoryId: string) =>
    call<{ deleted: true }>({ type: "deleteCategory", tenantId, categoryId }),
  addImage: (
    tenantId: string,
    itemId: string,
    image: { data: string; contentType: string },
  ) =>
    call<{ id: string }>({
      type: "addCatalogItemImage",
      tenantId,
      itemId,
      image,
    }),
  removeImage: (tenantId: string, itemId: string, imageId: string) =>
    call<{ removed: true }>({
      type: "removeCatalogItemImage",
      tenantId,
      itemId,
      imageId,
    }),
  submit: (tenantId: string, order: Record<string, unknown>) =>
    call<{ orderId: string }>({ type: "submitOrder", tenantId, ...order }),
  orders: (
    tenantId: string,
    scope: "mine" | "approvals" | "all",
    status?: string,
  ) =>
    call<{ orders: OrderSummary[] }>({
      type: "listOrders",
      tenantId,
      scope,
      status,
    }).then((data) => data.orders),
  order: (tenantId: string, orderId: string) =>
    call<{ order: OrderDetail }>({ type: "getOrder", tenantId, orderId }).then(
      (data) => data.order,
    ),
  update: (
    tenantId: string,
    orderId: string,
    action: OrderAction,
    extra: Record<string, unknown> = {},
  ) =>
    call<{ status: OrderStatus }>({
      type: "updateOrder",
      tenantId,
      orderId,
      action,
      ...extra,
    }),
};

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  pending_approval: "Wartet auf Freigabe",
  submitted: "Eingegangen",
  in_progress: "In Bearbeitung",
  ready: "Bereit zur Abholung",
  issued: "Ausgegeben",
  loaned: "Ausgeliehen",
  returned: "Zurückgegeben",
  rejected: "Abgelehnt",
  cancelled: "Storniert",
};

export const STOCK_LABEL: Record<StockLevel, string> = {
  in_stock: "An Lager",
  low: "Nur noch wenige",
  out_of_stock: "Zurzeit nicht an Lager",
  on_request: "Wird beschafft",
};

export const EVENT_LABEL: Record<string, string> = {
  submitted: "Bestellung aufgegeben",
  placed_on_behalf: "Im Auftrag erfasst",
  approval_requested: "Freigabe angefragt",
  approved: "Freigegeben",
  approval_rejected: "Freigabe abgelehnt",
  accepted: "In Bearbeitung genommen",
  ready: "Bereitgestellt",
  issued: "Ausgegeben",
  returned: "Zurückgenommen",
  rejected: "Abgelehnt",
  cancelled: "Storniert",
  note: "Notiz",
};

export function newRequestId(): string {
  return crypto.randomUUID();
}

export function formatDate(value: string | null): string {
  if (!value) return "–";
  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(date.getTime())) return "–";
  return new Intl.DateTimeFormat("de-CH", {
    dateStyle: "medium",
    ...(value.length > 10 ? { timeStyle: "short" } : {}),
  }).format(date);
}
