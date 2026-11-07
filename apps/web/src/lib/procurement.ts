// Beschaffung (Rückstände aus dem Shop): Antwort der Edge Function
// «inventory» (listBackorders) prüfen und für die Ansicht aufbereiten.

export type ProcurementBackorder = {
  id: string;
  quantity: number;
  status: "open" | "ordered";
  supplier: string | null;
  expectedOn: string | null;
  note: string | null;
  orderNumber: string | null;
  requesterName: string | null;
  createdAt: string;
  orderedAt: string | null;
};

export type ProcurementSupplierGroup = {
  supplier: string | null;
  quantity: number;
  backorders: ProcurementBackorder[];
};

export type ProcurementGroup = {
  itemId: string;
  itemName: string;
  articleNumber: string | null;
  unit: string;
  available: number;
  openQuantity: number;
  missingQuantity: number;
  servableNow: number;
  suppliers: ProcurementSupplierGroup[];
};

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function parseBackorder(value: unknown): ProcurementBackorder | null {
  if (!isRecord(value)) return null;
  const quantity = count(value.quantity);
  if (
    typeof value.id !== "string" ||
    quantity === null ||
    (value.status !== "open" && value.status !== "ordered") ||
    typeof value.createdAt !== "string"
  ) {
    return null;
  }
  return {
    id: value.id,
    quantity,
    status: value.status,
    supplier: text(value.supplier),
    expectedOn: text(value.expectedOn),
    note: text(value.note),
    orderNumber: text(value.orderNumber),
    requesterName: text(value.requesterName),
    createdAt: value.createdAt,
    orderedAt: text(value.orderedAt),
  };
}

function parseGroup(value: unknown): ProcurementGroup | null {
  if (!isRecord(value) || !Array.isArray(value.suppliers)) return null;
  const available = count(value.available);
  const openQuantity = count(value.openQuantity);
  const missingQuantity = count(value.missingQuantity);
  const servableNow = count(value.servableNow);
  if (
    typeof value.itemId !== "string" ||
    typeof value.itemName !== "string" ||
    available === null ||
    openQuantity === null ||
    missingQuantity === null ||
    servableNow === null
  ) {
    return null;
  }
  const suppliers: ProcurementSupplierGroup[] = [];
  for (const supplier of value.suppliers) {
    if (!isRecord(supplier) || !Array.isArray(supplier.backorders)) return null;
    const backorders = supplier.backorders.map(parseBackorder);
    if (backorders.some((backorder) => backorder === null)) return null;
    suppliers.push({
      supplier: text(supplier.supplier),
      quantity: count(supplier.quantity) ?? 0,
      backorders: backorders as ProcurementBackorder[],
    });
  }
  return {
    itemId: value.itemId,
    itemName: value.itemName,
    articleNumber: text(value.articleNumber),
    unit: typeof value.unit === "string" ? value.unit : "each",
    available,
    openQuantity,
    missingQuantity,
    servableNow,
    suppliers,
  };
}

/** Prüft die Antwort { data: { groups } }; null bei unvollständigen Daten. */
export function parseProcurementGroups(
  value: unknown,
): ProcurementGroup[] | null {
  if (!isRecord(value) || !isRecord(value.data)) return null;
  const groups = value.data.groups;
  if (!Array.isArray(groups)) return null;
  const parsed = groups.map(parseGroup);
  return parsed.some((group) => group === null)
    ? null
    : (parsed as ProcurementGroup[]);
}

/** Kennzahlen für den Kopf der Beschaffungsansicht. */
export function procurementSummary(groups: readonly ProcurementGroup[]): {
  open: number;
  ordered: number;
  items: number;
} {
  let open = 0;
  let ordered = 0;
  for (const group of groups) {
    for (const supplier of group.suppliers) {
      for (const backorder of supplier.backorders) {
        if (backorder.status === "ordered") ordered += 1;
        else open += 1;
      }
    }
  }
  return { open, ordered, items: groups.length };
}

/** Bedarfe einer Lieferantengruppe, die noch nicht bestellt sind. */
export function unorderedBackorderIds(
  supplier: ProcurementSupplierGroup,
): string[] {
  return supplier.backorders
    .filter((backorder) => backorder.status === "open")
    .map((backorder) => backorder.id);
}
