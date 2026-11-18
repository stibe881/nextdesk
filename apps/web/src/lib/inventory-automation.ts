// Lager-Automatik: Antwort der Aktion getInventoryAutomation prüfen und die
// Speicher-Anfrage bauen (Edge Function inventory, Migration 0314).

export type ReorderStatus = "open" | "ordered" | "done" | "dismissed";

export type InventoryAutomationSettings = {
  defaultReturnLocationId: string | null;
  reorderNotify: boolean;
  reorderCreateTask: boolean;
  reservationHoldDays: number | null;
};

export type InventoryAutomationDepartment = {
  id: string;
  name: string;
  returnLocationId: string | null;
};

export type InventoryAutomationLocation = {
  id: string;
  name: string;
  active: boolean;
  countIntervalDays: number | null;
  lastCountedAt: string | null;
  nextCountDue: string | null;
};

export type InventoryReorderRequest = {
  id: string;
  itemId: string;
  itemName: string;
  articleNumber: string | null;
  unit: string;
  supplier: string | null;
  suggestedQuantity: number;
  status: ReorderStatus;
  note: string | null;
  createdAt: string;
};

export type InventoryAutomation = {
  settings: InventoryAutomationSettings;
  departments: InventoryAutomationDepartment[];
  locations: InventoryAutomationLocation[];
  reorderRequests: InventoryReorderRequest[];
};

type Row = Record<string, unknown>;

function isRecord(value: unknown): value is Row {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

export function parseInventoryAutomation(
  value: unknown,
): InventoryAutomation | null {
  const data = isRecord(value) && isRecord(value.data) ? value.data : null;
  if (
    !data ||
    !isRecord(data.settings) ||
    !Array.isArray(data.departments) ||
    !Array.isArray(data.locations) ||
    !Array.isArray(data.reorderRequests)
  ) {
    return null;
  }
  const settings = data.settings;
  if (
    typeof settings.reorderNotify !== "boolean" ||
    typeof settings.reorderCreateTask !== "boolean"
  ) {
    return null;
  }
  return {
    settings: {
      defaultReturnLocationId: text(settings.defaultReturnLocationId),
      reorderNotify: settings.reorderNotify,
      reorderCreateTask: settings.reorderCreateTask,
      reservationHoldDays: count(settings.reservationHoldDays),
    },
    departments: data.departments.filter(isRecord).flatMap((row) =>
      typeof row.id === "string" && typeof row.name === "string"
        ? [
            {
              id: row.id,
              name: row.name,
              returnLocationId: text(row.returnLocationId),
            },
          ]
        : [],
    ),
    locations: data.locations.filter(isRecord).flatMap((row) =>
      typeof row.id === "string" && typeof row.name === "string"
        ? [
            {
              id: row.id,
              name: row.name,
              active: row.active === true,
              countIntervalDays: count(row.countIntervalDays),
              lastCountedAt: text(row.lastCountedAt),
              nextCountDue: text(row.nextCountDue),
            },
          ]
        : [],
    ),
    reorderRequests: data.reorderRequests.filter(isRecord).flatMap((row) =>
      typeof row.id === "string" &&
      typeof row.itemId === "string" &&
      typeof row.suggestedQuantity === "number" &&
      (row.status === "open" || row.status === "ordered")
        ? [
            {
              id: row.id,
              itemId: row.itemId,
              itemName: text(row.itemName) ?? "Artikel",
              articleNumber: text(row.articleNumber),
              unit: text(row.unit) ?? "each",
              supplier: text(row.supplier),
              suggestedQuantity: row.suggestedQuantity,
              status: row.status,
              note: text(row.note),
              createdAt: text(row.createdAt) ?? "",
            },
          ]
        : [],
    ),
  };
}

/** Leeres Feld = keine Angabe; sonst eine ganze Zahl im Bereich. */
export function parseDays(
  value: string,
  min: number,
  max: number,
): number | null | undefined {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\d+$/.test(trimmed)) return undefined;
  const days = Number(trimmed);
  return days >= min && days <= max ? days : undefined;
}

export type AutomationDraft = {
  defaultReturnLocationId: string;
  reorderNotify: boolean;
  reorderCreateTask: boolean;
  reservationHoldDays: string;
  departmentLocations: Record<string, string>;
  countIntervals: Record<string, string>;
};

export function draftFromAutomation(
  value: InventoryAutomation,
): AutomationDraft {
  return {
    defaultReturnLocationId: value.settings.defaultReturnLocationId ?? "",
    reorderNotify: value.settings.reorderNotify,
    reorderCreateTask: value.settings.reorderCreateTask,
    reservationHoldDays:
      value.settings.reservationHoldDays === null
        ? ""
        : String(value.settings.reservationHoldDays),
    departmentLocations: Object.fromEntries(
      value.departments.map((row) => [row.id, row.returnLocationId ?? ""]),
    ),
    countIntervals: Object.fromEntries(
      value.locations.map((row) => [
        row.id,
        row.countIntervalDays === null ? "" : String(row.countIntervalDays),
      ]),
    ),
  };
}

/** Speicher-Anfrage oder eine Fehlermeldung für das Formular. */
export function saveRequest(
  tenantId: string,
  draft: AutomationDraft,
): { body: Record<string, unknown> } | { error: string } {
  const holdDays = parseDays(draft.reservationHoldDays, 1, 365);
  if (holdDays === undefined) {
    return {
      error:
        "Die Haltefrist für Reservationen muss zwischen 1 und 365 Tagen liegen.",
    };
  }
  const countIntervals: { locationId: string; days: number | null }[] = [];
  for (const [locationId, raw] of Object.entries(draft.countIntervals)) {
    const days = parseDays(raw, 7, 730);
    if (days === undefined) {
      return {
        error: "Das Inventur-Intervall muss zwischen 7 und 730 Tagen liegen.",
      };
    }
    countIntervals.push({ locationId, days });
  }
  return {
    body: {
      type: "saveInventoryAutomation",
      tenantId,
      settings: {
        defaultReturnLocationId: draft.defaultReturnLocationId || null,
        reorderNotify: draft.reorderNotify,
        reorderCreateTask: draft.reorderCreateTask,
        reservationHoldDays: holdDays,
      },
      departmentLocations: Object.entries(draft.departmentLocations).map(
        ([departmentId, locationId]) => ({
          departmentId,
          locationId: locationId || null,
        }),
      ),
      countIntervals,
    },
  };
}
