export const INFRA_CATEGORIES = [
  "server",
  "switch",
  "access_point",
  "firewall",
  "router",
  "storage",
  "ups",
  "virtual_host",
  "other",
] as const;
export type InfraCategory = (typeof INFRA_CATEGORIES)[number];

export const INFRA_LIFECYCLE = [
  "ordered",
  "stock",
  "active",
  "repair",
  "retired",
  "disposed",
] as const;
export type InfraLifecycle = (typeof INFRA_LIFECYCLE)[number];

export const MAINTENANCE_KINDS = [
  "maintenance",
  "firmware",
  "repair",
  "inspection",
  "other",
] as const;
export type MaintenanceKind = (typeof MAINTENANCE_KINDS)[number];

export const categoryLabels: Record<InfraCategory, string> = {
  server: "Server",
  switch: "Switch",
  access_point: "Access Point",
  firewall: "Firewall",
  router: "Router",
  storage: "Storage",
  ups: "USV",
  virtual_host: "Virtualisierung",
  other: "Sonstiges",
};

export const categoryIcons: Record<InfraCategory, string> = {
  server: "server-outline",
  switch: "git-network-outline",
  access_point: "wifi-outline",
  firewall: "shield-checkmark-outline",
  router: "swap-horizontal-outline",
  storage: "albums-outline",
  ups: "battery-charging-outline",
  virtual_host: "layers-outline",
  other: "hardware-chip-outline",
};

export const lifecycleLabels: Record<InfraLifecycle, string> = {
  ordered: "Bestellt",
  stock: "An Lager",
  active: "In Betrieb",
  repair: "In Reparatur",
  retired: "Ausser Betrieb",
  disposed: "Entsorgt",
};

export const maintenanceLabels: Record<MaintenanceKind, string> = {
  maintenance: "Wartung",
  firmware: "Firmware-Update",
  repair: "Reparatur",
  inspection: "Prüfung",
  other: "Sonstiges",
};

export const criticalityLabels: Record<string, string> = {
  low: "Niedrig",
  medium: "Mittel",
  high: "Hoch",
  critical: "Kritisch",
};

export type InfraDevice = {
  id: string;
  name: string;
  assetTag: string | null;
  inventoryNumber: string | null;
  serialNumber: string | null;
  manufacturer: string | null;
  model: string | null;
  lifecycleState: InfraLifecycle;
  locationName: string | null;
  category: InfraCategory;
  hostname: string | null;
  ipAddress: string | null;
  macAddress: string | null;
  firmwareVersion: string | null;
  rack: string | null;
  rackUnit: string | null;
  uplinkAssetId: string | null;
  uplinkName: string | null;
  uplinkPort: string | null;
  purchaseDate: string | null;
  purchasePrice: number | null;
  supplier: string | null;
  warrantyUntil: string | null;
  supportUntil: string | null;
  endOfLife: string | null;
  plannedReplacement: string | null;
  criticality: string;
  maintenanceIntervalMonths: number | null;
  lastMaintenanceOn: string | null;
  notes: string | null;
};

export type InfraDetail = {
  lifecycle: {
    id: string;
    from: string | null;
    to: string;
    reason: string | null;
    actorName: string | null;
    at: string;
  }[];
  maintenance: {
    id: string;
    performedOn: string;
    kind: string;
    note: string;
    actorName: string | null;
  }[];
  connected: {
    id: string;
    name: string;
    lifecycleState: string;
    port: string | null;
    category: string | null;
  }[];
  tickets: {
    id: string;
    ticketNumber: number | string | null;
    subject: string;
    open: boolean;
  }[];
};

/** ISO-Datum (YYYY-MM-DD) als Schweizer Datum. */
export function formatDay(value: string | null): string {
  if (!value) return "–";
  const [year, month, day] = value.slice(0, 10).split("-");
  return year && month && day ? `${day}.${month}.${year}` : value;
}

export function todayIso(now = new Date()): string {
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function addMonths(isoDay: string, months: number): string {
  const [y, m, d] = isoDay.split("-").map(Number);
  const date = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1 + months, d ?? 1));
  return date.toISOString().slice(0, 10);
}

export type DueItem = {
  reason: "warranty" | "support" | "end_of_life" | "maintenance";
  label: string;
  dueOn: string;
  overdue: boolean;
};

const dueLabels: Record<DueItem["reason"], string> = {
  warranty: "Garantie",
  support: "Support",
  end_of_life: "End of Life",
  maintenance: "Wartung",
};

/** Fristen, die innerhalb von 30 Tagen fällig oder überfällig sind. */
export function dueItems(device: InfraDevice, today = todayIso()): DueItem[] {
  if (!["stock", "active", "repair"].includes(device.lifecycleState)) return [];
  const horizon = new Date(`${today}T00:00:00Z`);
  horizon.setUTCDate(horizon.getUTCDate() + 30);
  const horizonIso = horizon.toISOString().slice(0, 10);
  const candidates: [DueItem["reason"], string | null][] = [
    ["warranty", device.warrantyUntil],
    ["support", device.supportUntil],
    ["end_of_life", device.endOfLife],
  ];
  if (device.lifecycleState === "active" && device.maintenanceIntervalMonths) {
    candidates.push([
      "maintenance",
      addMonths(
        device.lastMaintenanceOn ?? device.purchaseDate ?? today,
        device.maintenanceIntervalMonths,
      ),
    ]);
  }
  return candidates
    .filter((entry): entry is [DueItem["reason"], string] =>
      Boolean(entry[1] && entry[1].slice(0, 10) <= horizonIso),
    )
    .map(([reason, dueOn]) => ({
      reason,
      label: dueLabels[reason],
      dueOn,
      overdue: dueOn.slice(0, 10) < today,
    }));
}
