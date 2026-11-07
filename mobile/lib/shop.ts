import { useSyncExternalStore } from "react";
import * as Crypto from "expo-crypto";

import { invokeNextDesk } from "@/lib/nextdesk-client";
import { SOFTWARE_EVENT_LABEL, type LineSoftware } from "@/lib/shop-software";

/** Client for the `shop` Edge Function and the in-memory shopping cart. */

export type ShopContext = {
  canOrder: boolean;
  canFulfill: boolean;
  canManage: boolean;
  pendingApprovals: number;
  openOrders: number;
  managerName: string | null;
};

export type StockLevel = "in_stock" | "low" | "out_of_stock" | "on_request";

export type CatalogItem = {
  id: string;
  name: string;
  description: string | null;
  category: string;
  kind: "order" | "loan";
  requiresApproval: boolean;
  maxQuantity: number;
  maxLoanDays: number | null;
  inventoryItemId: string | null;
  imageUrl: string | null;
  /** All photos of the article (max. 5). */
  imageUrls?: string[];
  stockLevel: StockLevel;
  availableQuantity: number | null;
  /** Software: wird nach der Freigabe über Intune zugewiesen. */
  isSoftware?: boolean;
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

export type ShopPerson = {
  id: string;
  name: string;
  jobTitle: string | null;
};

export type OrderSummary = {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  overdue: boolean;
  requesterName: string | null;
  placedByName?: string | null;
  itemsLabel?: string;
  loanUntil: string | null;
  createdAt: string;
};

export type OrderDetail = OrderSummary & {
  approverName: string | null;
  approvedByName: string | null;
  deliveryMethod: "pickup" | "desk";
  deliveryLocation: string | null;
  neededBy: string | null;
  loanFrom: string | null;
  comment: string | null;
  decisionReason: string | null;
  /** Grund der Bestellung (ältere Bestellungen: leer). */
  reason?: string | null;
  lines: {
    id: string;
    itemName: string;
    /** Cover photo of the article, if any. */
    imageUrl?: string | null;
    /** Internal, only sent to agents. */
    articleNumber?: string | null;
    /** Internal, only sent to agents. */
    supplierUrl?: string | null;
    kind: "order" | "loan";
    quantity: number;
    status: string;
    /** Beschaffungsstand, wenn die Zeile nicht an Lager ist. */
    procurement?: LineProcurement | null;
    /** Intune-Zuweisung (Software-Artikel nach der Freigabe). */
    software?: LineSoftware | null;
    locationId: string | null;
    stock: {
      trackingMode: "quantity" | "serial";
      locations: { id: string; name: string; available: number }[];
      serialUnits: { id: string; serialNumber: string }[];
    } | null;
  }[];
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
  const response = await invokeNextDesk<{ data: T }>("shop", body);
  return response.data;
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
  catalog: (tenantId: string) =>
    call<{ items: CatalogItem[] }>({ type: "listCatalog", tenantId }).then(
      (data) => sortCatalogByName(data.items),
    ),
  people: (tenantId: string) =>
    call<{ people: ShopPerson[] }>({ type: "listRequesters", tenantId }).then(
      (data) => data.people,
    ),
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
      ...(status ? { status } : {}),
    }).then((data) => data.orders),
  order: (tenantId: string, orderId: string) =>
    call<{ order: OrderDetail }>({ type: "getOrder", tenantId, orderId }).then(
      (data) => data.order,
    ),
  retrySoftware: (tenantId: string, deploymentId: string) =>
    call<{ retried: true }>({
      type: "retrySoftwareDeployment",
      tenantId,
      deploymentId,
    }),
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
  backordered: "Nicht an Lager – wird beschafft",
  backorder_ordered: "Beim Lieferanten bestellt",
  backorder_received: "Ware eingetroffen und reserviert",
  backorder_cancelled: "Beschaffung storniert",
  ...SOFTWARE_EVENT_LABEL,
};

/** Beschaffungsstand einer Bestellzeile, die nicht an Lager ist. */
export type LineProcurement = {
  status: "open" | "ordered";
  /** Voraussichtliches Lieferdatum (YYYY-MM-DD), sobald bestellt. */
  expectedOn: string | null;
};

/**
 * Hinweis für eine Bestellzeile im Rückstand, z. B.
 * «Wird beschafft, voraussichtlich am 20.11.2026».
 */
export function procurementLabel(line: {
  status: string;
  procurement?: LineProcurement | null;
}): string | null {
  if (line.status !== "backorder") return null;
  const expectedOn = line.procurement?.expectedOn ?? null;
  if (!expectedOn) return "Wird beschafft";
  const formatted = formatDate(expectedOn);
  return formatted === "–"
    ? "Wird beschafft"
    : `Wird beschafft, voraussichtlich am ${formatted}`;
}

export function newRequestId(): string {
  return Crypto.randomUUID();
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

// Cart (kept in memory per app session and tenant)
export type CartLine = { item: CatalogItem; quantity: number };
type CartState = { tenantId: string | null; lines: CartLine[] };

let cart: CartState = { tenantId: null, lines: [] };
const listeners = new Set<() => void>();

function setCart(next: CartState) {
  cart = next;
  listeners.forEach((listener) => listener());
}

export const shopCart = {
  add(tenantId: string, item: CatalogItem) {
    const lines = cart.tenantId === tenantId ? cart.lines : [];
    const existing = lines.find((line) => line.item.id === item.id);
    setCart({
      tenantId,
      lines: existing
        ? lines.map((line) =>
            line.item.id === item.id
              ? {
                  ...line,
                  quantity: Math.min(item.maxQuantity, line.quantity + 1),
                }
              : line,
          )
        : [...lines, { item, quantity: 1 }],
    });
  },
  setQuantity(itemId: string, quantity: number) {
    setCart({
      ...cart,
      lines:
        quantity <= 0
          ? cart.lines.filter((line) => line.item.id !== itemId)
          : cart.lines.map((line) =>
              line.item.id === itemId
                ? {
                    ...line,
                    quantity: Math.min(line.item.maxQuantity, quantity),
                  }
                : line,
            ),
    });
  },
  clear() {
    setCart({ tenantId: cart.tenantId, lines: [] });
  },
};

export function useShopCart(tenantId: string | null): CartLine[] {
  const state = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => cart,
  );
  return state.tenantId === tenantId ? state.lines : [];
}
