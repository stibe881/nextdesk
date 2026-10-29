import { invokeNextDesk } from "@/lib/nextdesk-client";

type RecordValue = Record<string, unknown>;

export type MobileInventoryItem = {
  id: string;
  name: string;
  articleNumber: string | null;
  unit: string;
  physicalQuantity: number;
  reservedQuantity: number;
  availableQuantity: number;
  minQuantity: number;
  locationName: string | null;
  active: boolean;
};

export type MobileInventoryOverview = {
  items: MobileInventoryItem[];
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
    physicalQuantity: count(value.physicalQuantity),
    reservedQuantity: count(value.reservedQuantity),
    availableQuantity: count(value.availableQuantity),
    minQuantity: count(value.minQuantity),
    locationName:
      typeof value.locationName === "string" ? value.locationName : null,
    active: value.active !== false,
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
  return {
    items,
    lowStockIds,
    criticalItemCount: count(summary.criticalItemCount),
    openReservationCount: count(summary.openReservationCount),
    activeCountSessionCount: count(summary.activeCountSessionCount),
  };
}
