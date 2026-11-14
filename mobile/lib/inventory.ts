import * as Crypto from "expo-crypto";

import { invokeNextDesk } from "@/lib/nextdesk-client";

type RecordValue = Record<string, unknown>;

export type MobileInventoryItem = {
  id: string;
  name: string;
  articleNumber: string | null;
  unit: string;
  serialTracked: boolean;
  physicalQuantity: number;
  reservedQuantity: number;
  availableQuantity: number;
  minQuantity: number;
  locationName: string | null;
  active: boolean;
  /** A private article photo exists (loaded via a short-lived signed URL). */
  hasPrimaryImage: boolean;
};

export type MobileInventoryLocation = {
  id: string;
  name: string;
  code: string | null;
};

export type MobileInventoryOverview = {
  items: MobileInventoryItem[];
  locations: MobileInventoryLocation[];
  canMove: boolean;
  lowStockIds: string[];
  criticalItemCount: number;
  openReservationCount: number;
  activeCountSessionCount: number;
};

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : 0;
}

function parseItem(value: unknown): MobileInventoryItem | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.name !== "string"
  ) {
    return null;
  }
  return {
    id: value.id,
    name: value.name,
    articleNumber:
      typeof value.articleNumber === "string" ? value.articleNumber : null,
    unit: typeof value.unit === "string" ? value.unit : "Stk",
    serialTracked: value.trackingMode === "serial",
    physicalQuantity: count(value.physicalQuantity),
    reservedQuantity: count(value.reservedQuantity),
    availableQuantity: count(value.availableQuantity),
    minQuantity: count(value.minQuantity),
    locationName:
      typeof value.locationName === "string" ? value.locationName : null,
    active: value.active !== false,
    hasPrimaryImage: value.hasPrimaryImage === true,
  };
}

/**
 * Read-only stock overview from the tenant-authorized inventory function. The
 * server remains authoritative for access; an unusable answer fails closed.
 */
export async function loadMobileInventory(
  tenantId: string,
): Promise<MobileInventoryOverview> {
  const response = await invokeNextDesk<unknown>("inventory", {
    type: "workspace",
    tenantId,
  });
  if (!isRecord(response) || !isRecord(response.data)) {
    throw new Error("Die Lagerantwort ist unvollständig.");
  }
  const data = response.data;
  if (!Array.isArray(data.items)) {
    throw new Error("Die Lagerantwort ist unvollständig.");
  }
  const items = data.items
    .map(parseItem)
    .filter((item): item is MobileInventoryItem => item !== null && item.active)
    .sort((left, right) => left.name.localeCompare(right.name, "de-CH"));
  const lowStockIds = Array.isArray(data.lowStockItems)
    ? data.lowStockItems.flatMap((entry) => {
        const item = parseItem(entry);
        return item ? [item.id] : [];
      })
    : [];
  const summary = isRecord(data.summary) ? data.summary : {};
  const locations = Array.isArray(data.locations)
    ? data.locations
        .flatMap((entry): MobileInventoryLocation[] =>
          isRecord(entry) &&
          typeof entry.id === "string" &&
          typeof entry.name === "string" &&
          entry.active !== false
            ? [
                {
                  id: entry.id,
                  name: entry.name,
                  code: typeof entry.code === "string" ? entry.code : null,
                },
              ]
            : [],
        )
        .sort((left, right) => left.name.localeCompare(right.name, "de-CH"))
    : [];
  const permissions = isRecord(data.permissions) ? data.permissions : {};
  return {
    items,
    locations,
    canMove: permissions.canMove === true,
    lowStockIds,
    criticalItemCount: count(summary.criticalItemCount),
    openReservationCount: count(summary.openReservationCount),
    activeCountSessionCount: count(summary.activeCountSessionCount),
  };
}

export function newInventoryRequestId(): string {
  return Crypto.randomUUID();
}

/**
 * Books a goods receipt. The request id stays the same for retries of one
 * booking so a lost response can never book the quantity twice.
 */
export async function postMobileInventoryReceipt(input: {
  tenantId: string;
  itemId: string;
  locationId: string;
  quantity: number;
  clientRequestId: string;
}): Promise<void> {
  await invokeNextDesk<unknown>("inventory", {
    type: "postMovement",
    tenantId: input.tenantId,
    movementType: "receipt",
    itemId: input.itemId,
    toLocationId: input.locationId,
    quantity: input.quantity,
    clientRequestId: input.clientRequestId,
  });
}

export { parseReceiptQuantity } from "./inventory-quantity";
