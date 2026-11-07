// Beschaffung (Rückstände aus dem Shop): Anfrageprüfung und reine Logik.
//
// Die verbindliche Zuteilung macht die Datenbank (shop_allocate_backorders,
// Migration 0224). planBackorderAllocation bildet dieselbe Regel nach, damit
// die Beschaffungsliste zeigen kann, welche Bedarfe der freie Bestand schon
// heute decken würde und wie viel noch fehlt.

export type BackorderStatus = "open" | "ordered" | "received" | "cancelled";

export type QueuedBackorder = {
  id: string;
  quantity: number;
  createdAt: string;
};

export type LocationStock = {
  locationId: string;
  name: string;
  available: number;
};

export type AllocationPlan = {
  /** Bedarf → Lagerort, in der Reihenfolge der Zuteilung. */
  allocations: { backorderId: string; locationId: string }[];
  /** Bedarfe, die weiter warten. */
  waiting: string[];
};

/**
 * Teilt freien Bestand den Bedarfen in der Reihenfolge ihrer Erfassung zu.
 * Wie shop_try_reserve_line wird jede Zeile ganz aus einem Lagerort bedient
 * (der mit dem meisten freien Bestand, bei Gleichstand alphabetisch). Ein
 * Bedarf, der nicht gedeckt werden kann, wartet; spätere Bedarfe dürfen den
 * verbleibenden Bestand nutzen.
 */
export function planBackorderAllocation(
  backorders: readonly QueuedBackorder[],
  locations: readonly LocationStock[],
): AllocationPlan {
  const stock = locations
    .filter((location) => location.available > 0)
    .map((location) => ({ ...location }));
  const queue = [...backorders].sort(
    (a, b) =>
      a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
  const allocations: AllocationPlan["allocations"] = [];
  const waiting: string[] = [];
  for (const backorder of queue) {
    let best: (typeof stock)[number] | null = null;
    for (const location of stock) {
      if (location.available < backorder.quantity) continue;
      if (
        !best ||
        location.available > best.available ||
        (location.available === best.available &&
          location.name.localeCompare(best.name) < 0)
      ) {
        best = location;
      }
    }
    if (!best) {
      waiting.push(backorder.id);
      continue;
    }
    best.available -= backorder.quantity;
    allocations.push({
      backorderId: backorder.id,
      locationId: best.locationId,
    });
  }
  return { allocations, waiting };
}

export type BackorderEntry = {
  id: string;
  itemId: string;
  quantity: number;
  status: "open" | "ordered";
  supplier: string | null;
  expectedOn: string | null;
  note: string | null;
  orderId: string;
  orderNumber: string | null;
  requesterName: string | null;
  createdAt: string;
  orderedAt: string | null;
};

export type BackorderItem = {
  id: string;
  name: string;
  articleNumber: string | null;
  unit: string;
  defaultSupplier: string | null;
};

export type BackorderGroup = {
  itemId: string;
  itemName: string;
  articleNumber: string | null;
  unit: string;
  /** Freier Bestand über alle aktiven Lagerorte. */
  available: number;
  /** Summe aller wartenden Bedarfe. */
  openQuantity: number;
  /** Was nach Abzug des freien Bestands noch beschafft werden muss. */
  missingQuantity: number;
  /** Bedarfe, die der freie Bestand heute schon decken würde. */
  servableNow: number;
  suppliers: {
    supplier: string | null;
    quantity: number;
    backorders: BackorderEntry[];
  }[];
};

/** Gruppiert Bedarfe nach Artikel und Lieferant (älteste Bedarfe zuerst). */
export function groupBackorders(
  backorders: readonly BackorderEntry[],
  items: ReadonlyMap<string, BackorderItem>,
  stock: ReadonlyMap<string, readonly LocationStock[]>,
): BackorderGroup[] {
  const byItem = new Map<string, BackorderEntry[]>();
  for (const backorder of backorders) {
    if (!items.has(backorder.itemId)) continue;
    const list = byItem.get(backorder.itemId) ?? [];
    list.push(backorder);
    byItem.set(backorder.itemId, list);
  }
  const groups: BackorderGroup[] = [];
  for (const [itemId, list] of byItem) {
    const item = items.get(itemId)!;
    list.sort(
      (a, b) =>
        a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    );
    const locations = stock.get(itemId) ?? [];
    const available = locations.reduce(
      (sum, location) => sum + Math.max(0, location.available),
      0,
    );
    const openQuantity = list.reduce((sum, entry) => sum + entry.quantity, 0);
    const plan = planBackorderAllocation(list, locations);
    const suppliers = new Map<string, BackorderGroup["suppliers"][number]>();
    for (const entry of list) {
      const supplier = entry.supplier ?? item.defaultSupplier;
      const key = supplier?.toLocaleLowerCase("de-CH") ?? "";
      const group = suppliers.get(key) ?? {
        supplier,
        quantity: 0,
        backorders: [],
      };
      group.quantity += entry.quantity;
      group.backorders.push(entry);
      suppliers.set(key, group);
    }
    groups.push({
      itemId,
      itemName: item.name,
      articleNumber: item.articleNumber,
      unit: item.unit,
      available,
      openQuantity,
      missingQuantity: Math.max(0, openQuantity - available),
      servableNow: plan.allocations.length,
      suppliers: [...suppliers.values()].sort((a, b) =>
        (a.supplier ?? "￿").localeCompare(b.supplier ?? "￿", "de-CH"),
      ),
    });
  }
  return groups.sort(
    (a, b) =>
      (a.suppliers[0]?.backorders[0]?.createdAt ?? "").localeCompare(
        b.suppliers[0]?.backorders[0]?.createdAt ?? "",
      ) || a.itemName.localeCompare(b.itemName, "de-CH"),
  );
}

// Anfragen
// --------
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BACKORDER_IDS = 200;

export type BackorderAction =
  | { type: "listBackorders"; tenantId: string }
  | {
      type: "manageBackorders";
      tenantId: string;
      operation: "order" | "cancel";
      backorderIds: string[];
      supplier: string | null;
      expectedOn: string | null;
      note: string | null;
    }
  | { type: "allocateBackorders"; tenantId: string; itemId: string };

type Row = Record<string, unknown>;

function isRecord(value: unknown): value is Row {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function hasOnlyKeys(value: Row, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function optionalText(value: unknown, max: number): string | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (text.length > max || /[\u0000-\u001f\u007f]/.test(text)) return undefined;
  return text === "" ? null : text;
}

function optionalDate(value: unknown): string | null | undefined {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return undefined;
  }
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
    ? undefined
    : value;
}

export function isBackorderActionType(value: unknown): boolean {
  return (
    isRecord(value) &&
    (value.type === "listBackorders" ||
      value.type === "manageBackorders" ||
      value.type === "allocateBackorders")
  );
}

export function parseBackorderAction(value: unknown): BackorderAction | null {
  if (!isRecord(value) || !isUuid(value.tenantId)) return null;
  const tenantId = value.tenantId.toLowerCase();
  if (value.type === "listBackorders") {
    return hasOnlyKeys(value, ["type", "tenantId"])
      ? { type: "listBackorders", tenantId }
      : null;
  }
  if (value.type === "allocateBackorders") {
    return hasOnlyKeys(value, ["type", "tenantId", "itemId"]) &&
      isUuid(value.itemId)
      ? {
          type: "allocateBackorders",
          tenantId,
          itemId: value.itemId.toLowerCase(),
        }
      : null;
  }
  if (value.type !== "manageBackorders") return null;
  if (
    !hasOnlyKeys(value, [
      "type",
      "tenantId",
      "operation",
      "backorderIds",
      "supplier",
      "expectedOn",
      "note",
    ]) ||
    (value.operation !== "order" && value.operation !== "cancel") ||
    !Array.isArray(value.backorderIds) ||
    value.backorderIds.length === 0 ||
    value.backorderIds.length > MAX_BACKORDER_IDS ||
    !value.backorderIds.every(isUuid)
  ) {
    return null;
  }
  const supplier = optionalText(value.supplier, 160);
  const note = optionalText(value.note, 1000);
  const expectedOn = optionalDate(value.expectedOn);
  if (
    supplier === undefined ||
    note === undefined ||
    expectedOn === undefined
  ) {
    return null;
  }
  if (
    value.operation === "cancel" &&
    (supplier !== null || expectedOn !== null)
  ) {
    return null;
  }
  return {
    type: "manageBackorders",
    tenantId,
    operation: value.operation,
    backorderIds: [
      ...new Set(value.backorderIds.map((id: string) => id.toLowerCase())),
    ],
    supplier,
    expectedOn,
    note,
  };
}
