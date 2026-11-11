import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AlertTriangle,
  Archive,
  ArrowLeftRight,
  CircleCheck,
  ClipboardList,
  MapPin,
  PackageCheck,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Trash2,
} from "lucide-react";

import {
  AssetLabelDialog,
  LabelSelectionBar,
  type LabelBranding,
} from "./asset-label-dialog";
import { FormField, FormGrid } from "./form-kit";
import { inventoryLabelItem } from "./lib/asset-labels";
import { InventoryProcurement } from "./inventory-procurement";
import { functionErrorMessage } from "./lib/function-error";
import { CatalogEditor, type EditorRequest, type StockEditor } from "./shop";
import { shopApi } from "./lib/shop";
import { supabase } from "./lib/supabase";

type TrackingMode = "quantity" | "serial";
type InventorySection =
  | "Übersicht"
  | "Artikel"
  | "Lagerorte"
  | "Bewegungen"
  | "Reservationen"
  | "Inventur"
  | "Beschaffung";

type InventoryPermissions = {
  canAdjust: boolean;
  canCloseInventoryCount: boolean;
  canManage: boolean;
  canMove: boolean;
  canRead: true;
};

type InventorySummary = {
  activeCountSessionCount: number;
  criticalItemCount: number;
  openReservationCount: number;
};

export type InventoryItemSummary = {
  active: boolean;
  articleNumber: string | null;
  availableQuantity: number;
  /** Department of the item; null for items shared by all departments. */
  departmentId: string | null;
  hasPrimaryImage: boolean;
  id: string;
  /** Handed out and returned; the shop offers it as a loan article. */
  loanItem?: boolean;
  locationName: string | null;
  minQuantity: number;
  name: string;
  physicalQuantity: number;
  reservedQuantity: number;
  targetQuantity: number;
  trackingMode: TrackingMode;
  unit: string;
};

type InventoryLocation = {
  active: boolean;
  code: string | null;
  id: string;
  name: string;
};

type InventoryEvent = {
  id: string;
  itemName: string;
  locationName: string | null;
  occurredAt: string;
  physicalDelta: number;
  reservedDelta: number;
  type: string;
};

type OpenReservation = {
  id: string;
  itemName: string;
  locationName: string;
  quantity: number;
  createdAt: string;
};

type ActiveInventoryCount = {
  id: string;
  locationName: string;
  status: "draft" | "counting";
  startedAt: string;
};

type SourceReservationEquipmentKey =
  | "projector"
  | "connections"
  | "display"
  | "audio"
  | "videocall"
  | "microphones";
type SourceReservationRule =
  | {
      id: string;
      sourceKind: "event_space_equipment";
      equipmentKey: SourceReservationEquipmentKey;
      itemId: string;
      locationId: string;
      quantity: number;
      enabled: boolean;
    }
  | {
      id: string;
      sourceKind: "onboarding_template_task";
      templateId: string;
      templateTaskId: string;
      itemId: string;
      locationId: string;
      quantity: number;
      enabled: boolean;
    };
type OnboardingTemplateTaskOption = {
  templateId: string;
  templateTitle: string;
  templateTaskId: string;
  templateTaskTitle: string;
};
type SourceReservationRules = {
  canManageEventRules: boolean;
  canManageOnboardingRules: boolean;
  rules: readonly SourceReservationRule[];
  onboardingTemplateTasks: readonly OnboardingTemplateTaskOption[];
};
type SourceReservationRuleValues =
  | {
      sourceKind: "event_space_equipment";
      equipmentKey: SourceReservationEquipmentKey;
      itemId: string;
      locationId: string;
      quantity: number;
      enabled: boolean;
    }
  | {
      sourceKind: "onboarding_template_task";
      templateId: string;
      templateTaskId: string;
      itemId: string;
      locationId: string;
      quantity: number;
      enabled: boolean;
    };

type InventoryMutationReceipt = {
  accepted: true;
  id: string;
};

export type InventoryDepartment = { id: string; name: string };

export type InventoryWorkspace = {
  /** Departments the user may assign to new items. */
  departments: readonly InventoryDepartment[];
  items: readonly InventoryItemSummary[];
  locations: readonly InventoryLocation[];
  lowStockItems: readonly InventoryItemSummary[];
  permissions: InventoryPermissions;
  recentEvents: readonly InventoryEvent[];
  recentEventsHasMore: boolean;
  summary: InventorySummary;
};

type RecordValue = Record<string, unknown>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_ID_STORAGE_PREFIX = "nextdesk:inventory:request:";
const INVENTORY_ITEM_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const INVENTORY_ITEM_IMAGE_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const SOURCE_RESERVATION_EQUIPMENT_OPTIONS = [
  { value: "projector", label: "Projektor" },
  { value: "connections", label: "Anschlüsse" },
  { value: "display", label: "Display" },
  { value: "audio", label: "Audio" },
  { value: "videocall", label: "Videokonferenz" },
  { value: "microphones", label: "Mikrofone" },
] as const satisfies readonly {
  value: SourceReservationEquipmentKey;
  label: string;
}[];

type InventoryMovementType =
  | "receipt"
  | "issue"
  | "transfer"
  | "defect"
  | "loss"
  | "adjustment_in"
  | "adjustment_out";

type InventoryAction =
  | {
      type: "manageLocation";
      tenantId: string;
      operation: "create";
      values: { code: string; name: string };
      clientRequestId: string;
    }
  | {
      type: "manageLocation";
      tenantId: string;
      locationId: string;
      operation: "update";
      values: { code?: string; name?: string; active?: boolean };
      clientRequestId: string;
    }
  | {
      type: "manageLocation";
      tenantId: string;
      locationId: string;
      operation: "archive";
      clientRequestId: string;
    }
  | {
      type: "manageItem";
      tenantId: string;
      operation: "create";
      values: {
        articleNumber: string;
        name: string;
        category: string;
        unit: string;
        trackingMode: "quantity";
        minimumStock: number;
        targetStock: number;
        loanItem?: boolean;
        departmentId?: string;
      };
      clientRequestId: string;
    }
  | {
      type: "manageItem";
      tenantId: string;
      operation: "update";
      itemId: string;
      values: { departmentId: string };
      clientRequestId: string;
    }
  | {
      type: "manageItem";
      tenantId: string;
      operation: "update";
      itemId: string;
      values: {
        articleNumber?: string;
        name?: string;
        category?: string;
        unit?: string;
        minimumStock?: number;
        targetStock?: number;
        loanItem?: boolean;
      };
      clientRequestId: string;
    }
  | {
      type: "postMovement";
      tenantId: string;
      itemId: string;
      movementType: InventoryMovementType;
      quantity: number;
      fromLocationId?: string;
      toLocationId?: string;
      clientRequestId: string;
    }
  | {
      type: "postMovement";
      tenantId: string;
      movementType: "issue";
      reservationId: string;
      clientRequestId: string;
    }
  | {
      type: "reserve";
      tenantId: string;
      itemId: string;
      locationId: string;
      quantity: number;
      clientRequestId: string;
    }
  | {
      type: "releaseReservation";
      tenantId: string;
      reservationId: string;
      clientRequestId: string;
    }
  | {
      type: "startCount";
      tenantId: string;
      locationId: string;
      clientRequestId: string;
    }
  | {
      type: "recordCountLine";
      tenantId: string;
      countId: string;
      itemId: string;
      countedQuantity: number;
      clientRequestId: string;
    }
  | {
      type: "closeCount";
      tenantId: string;
      countId: string;
      clientRequestId: string;
    }
  | {
      type: "manageSourceReservationRule";
      tenantId: string;
      operation: "create";
      values: SourceReservationRuleValues;
    }
  | {
      type: "manageSourceReservationRule";
      tenantId: string;
      operation: "update";
      ruleId: string;
      values: SourceReservationRuleValues;
    };

type InventoryChangedHandler = (
  action: InventoryAction,
  successMessage: string,
) => Promise<InventoryMutationReceipt | null>;

const sections: readonly InventorySection[] = [
  "Übersicht",
  "Artikel",
  "Lagerorte",
  "Bewegungen",
  "Reservationen",
  "Inventur",
  "Beschaffung",
];

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: RecordValue, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function nonnegativeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nullableText(value: unknown): string | null {
  return typeof value === "string" ? value : value === null ? null : null;
}

function parseItem(value: unknown): InventoryItemSummary | null {
  if (!isRecord(value)) return null;
  if (
    !hasOnlyKeys(value, [
      "id",
      "name",
      "hasPrimaryImage",
      "articleNumber",
      "unit",
      "trackingMode",
      "physicalQuantity",
      "reservedQuantity",
      "availableQuantity",
      "minQuantity",
      "targetQuantity",
      "locationName",
      "active",
      "loanItem",
      "departmentId",
    ])
  )
    return null;
  if (value.loanItem !== undefined && typeof value.loanItem !== "boolean")
    return null;
  if (
    value.departmentId !== undefined &&
    value.departmentId !== null &&
    !isUuid(value.departmentId)
  )
    return null;
  const physicalQuantity = nonnegativeNumber(value.physicalQuantity);
  const reservedQuantity = nonnegativeNumber(value.reservedQuantity);
  const availableQuantity = nonnegativeNumber(value.availableQuantity);
  const minQuantity = nonnegativeNumber(value.minQuantity);
  const targetQuantity = nonnegativeNumber(value.targetQuantity);
  if (
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    typeof value.hasPrimaryImage !== "boolean" ||
    typeof value.unit !== "string" ||
    typeof value.active !== "boolean" ||
    (value.trackingMode !== "quantity" && value.trackingMode !== "serial") ||
    physicalQuantity === null ||
    reservedQuantity === null ||
    availableQuantity === null ||
    minQuantity === null ||
    targetQuantity === null ||
    reservedQuantity > physicalQuantity ||
    availableQuantity > physicalQuantity
  ) {
    return null;
  }
  return {
    active: value.active,
    articleNumber: nullableText(value.articleNumber),
    availableQuantity,
    departmentId:
      typeof value.departmentId === "string" ? value.departmentId : null,
    hasPrimaryImage: value.hasPrimaryImage,
    id: value.id,
    loanItem: value.loanItem === true,
    locationName: nullableText(value.locationName),
    minQuantity,
    name: value.name,
    physicalQuantity,
    reservedQuantity,
    targetQuantity,
    trackingMode: value.trackingMode,
    unit: value.unit,
  };
}

function parseDepartment(value: unknown): InventoryDepartment | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ["id", "name"])) return null;
  return isUuid(value.id) &&
    typeof value.name === "string" &&
    value.name.length > 0
    ? { id: value.id, name: value.name }
    : null;
}

function parseLocation(value: unknown): InventoryLocation | null {
  if (!isRecord(value)) return null;
  if (!hasOnlyKeys(value, ["id", "name", "code", "active"])) return null;
  return typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.active === "boolean" &&
    (typeof value.code === "string" || value.code === null)
    ? {
        active: value.active,
        code: nullableText(value.code),
        id: value.id,
        name: value.name,
      }
    : null;
}

function parseEvent(value: unknown): InventoryEvent | null {
  if (!isRecord(value)) return null;
  if (
    !hasOnlyKeys(value, [
      "id",
      "type",
      "itemName",
      "occurredAt",
      "physicalDelta",
      "reservedDelta",
      "locationName",
    ])
  )
    return null;
  const physicalDelta = finiteNumber(value.physicalDelta);
  const reservedDelta = finiteNumber(value.reservedDelta);
  return typeof value.id === "string" &&
    typeof value.type === "string" &&
    typeof value.itemName === "string" &&
    typeof value.occurredAt === "string" &&
    physicalDelta !== null &&
    reservedDelta !== null &&
    (typeof value.locationName === "string" || value.locationName === null)
    ? {
        id: value.id,
        itemName: value.itemName,
        locationName: nullableText(value.locationName),
        occurredAt: value.occurredAt,
        physicalDelta,
        reservedDelta,
        type: value.type,
      }
    : null;
}

function parseList<T>(
  value: unknown,
  parse: (item: unknown) => T | null,
): T[] | null {
  if (!Array.isArray(value)) return null;
  const parsed = value.map(parse);
  return parsed.every((item): item is T => item !== null) ? parsed : null;
}

function parseOpenReservation(value: unknown): OpenReservation | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "id",
      "itemName",
      "locationName",
      "quantity",
      "createdAt",
    ])
  )
    return null;
  const amount = nonnegativeNumber(value.quantity);
  return isUuid(value.id) &&
    typeof value.itemName === "string" &&
    value.itemName.length > 0 &&
    typeof value.locationName === "string" &&
    value.locationName.length > 0 &&
    amount !== null &&
    amount > 0 &&
    typeof value.createdAt === "string" &&
    Number.isFinite(Date.parse(value.createdAt))
    ? {
        id: value.id.toLowerCase(),
        itemName: value.itemName,
        locationName: value.locationName,
        quantity: amount,
        createdAt: value.createdAt,
      }
    : null;
}

function parseActiveInventoryCount(
  value: unknown,
): ActiveInventoryCount | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["id", "locationName", "status", "startedAt"])
  )
    return null;
  return isUuid(value.id) &&
    typeof value.locationName === "string" &&
    value.locationName.length > 0 &&
    (value.status === "draft" || value.status === "counting") &&
    typeof value.startedAt === "string" &&
    Number.isFinite(Date.parse(value.startedAt))
    ? {
        id: value.id.toLowerCase(),
        locationName: value.locationName,
        status: value.status,
        startedAt: value.startedAt,
      }
    : null;
}

function parseOpenReservations(value: unknown): OpenReservation[] | null {
  if (
    !isRecord(value) ||
    !isRecord(value.data) ||
    !hasOnlyKeys(value.data, ["reservations"])
  )
    return null;
  return parseList(value.data.reservations, parseOpenReservation);
}

function parseActiveCounts(value: unknown): ActiveInventoryCount[] | null {
  if (
    !isRecord(value) ||
    !isRecord(value.data) ||
    !hasOnlyKeys(value.data, ["activeCounts"])
  )
    return null;
  return parseList(value.data.activeCounts, parseActiveInventoryCount);
}

function positiveThreeDecimalQuantity(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= 1_000_000_000 &&
    Number.isSafeInteger(Math.round(value * 1_000)) &&
    Math.round(value * 1_000) === value * 1_000
    ? value
    : null;
}

function sourceReservationEquipmentKey(
  value: unknown,
): SourceReservationEquipmentKey | null {
  return typeof value === "string" &&
    SOURCE_RESERVATION_EQUIPMENT_OPTIONS.some(
      (option) => option.value === value,
    )
    ? (value as SourceReservationEquipmentKey)
    : null;
}

function parseSourceReservationRule(
  value: unknown,
): SourceReservationRule | null {
  if (!isRecord(value) || !isUuid(value.id)) return null;
  const itemId = isUuid(value.itemId) ? value.itemId.toLowerCase() : null;
  const locationId = isUuid(value.locationId)
    ? value.locationId.toLowerCase()
    : null;
  const quantity = positiveThreeDecimalQuantity(value.quantity);
  if (
    !itemId ||
    !locationId ||
    quantity === null ||
    typeof value.enabled !== "boolean"
  ) {
    return null;
  }
  if (value.sourceKind === "event_space_equipment") {
    const equipmentKey = sourceReservationEquipmentKey(value.equipmentKey);
    return hasOnlyKeys(value, [
      "id",
      "sourceKind",
      "equipmentKey",
      "itemId",
      "locationId",
      "quantity",
      "enabled",
    ]) && equipmentKey
      ? {
          id: value.id.toLowerCase(),
          sourceKind: value.sourceKind,
          equipmentKey,
          itemId,
          locationId,
          quantity,
          enabled: value.enabled,
        }
      : null;
  }
  if (value.sourceKind === "onboarding_template_task") {
    return hasOnlyKeys(value, [
      "id",
      "sourceKind",
      "templateId",
      "templateTaskId",
      "itemId",
      "locationId",
      "quantity",
      "enabled",
    ]) &&
      isUuid(value.templateId) &&
      isUuid(value.templateTaskId)
      ? {
          id: value.id.toLowerCase(),
          sourceKind: value.sourceKind,
          templateId: value.templateId.toLowerCase(),
          templateTaskId: value.templateTaskId.toLowerCase(),
          itemId,
          locationId,
          quantity,
          enabled: value.enabled,
        }
      : null;
  }
  return null;
}

function parseOnboardingTemplateTaskOption(
  value: unknown,
): OnboardingTemplateTaskOption | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "templateId",
      "templateTitle",
      "templateTaskId",
      "templateTaskTitle",
    ]) ||
    !isUuid(value.templateId) ||
    !isUuid(value.templateTaskId) ||
    typeof value.templateTitle !== "string" ||
    value.templateTitle.trim().length < 2 ||
    value.templateTitle.length > 120 ||
    typeof value.templateTaskTitle !== "string" ||
    value.templateTaskTitle.trim().length < 2 ||
    value.templateTaskTitle.length > 240
  ) {
    return null;
  }
  return {
    templateId: value.templateId.toLowerCase(),
    templateTitle: value.templateTitle,
    templateTaskId: value.templateTaskId.toLowerCase(),
    templateTaskTitle: value.templateTaskTitle,
  };
}

export function parseSourceReservationRules(
  value: unknown,
): SourceReservationRules | null {
  if (
    !isRecord(value) ||
    !isRecord(value.data) ||
    !hasOnlyKeys(value.data, [
      "canManageEventRules",
      "canManageOnboardingRules",
      "rules",
      "onboardingTemplateTasks",
    ]) ||
    typeof value.data.canManageEventRules !== "boolean" ||
    typeof value.data.canManageOnboardingRules !== "boolean"
  ) {
    return null;
  }
  const canManageEventRules = value.data.canManageEventRules;
  const canManageOnboardingRules = value.data.canManageOnboardingRules;
  const rules = parseList(value.data.rules, parseSourceReservationRule);
  const onboardingTemplateTasks = parseList(
    value.data.onboardingTemplateTasks,
    parseOnboardingTemplateTaskOption,
  );
  if (
    !rules ||
    !onboardingTemplateTasks ||
    rules.some(
      (rule) =>
        (rule.sourceKind === "event_space_equipment" && !canManageEventRules) ||
        (rule.sourceKind === "onboarding_template_task" &&
          !canManageOnboardingRules),
    ) ||
    (!canManageOnboardingRules && onboardingTemplateTasks.length > 0)
  ) {
    return null;
  }
  return {
    canManageEventRules,
    canManageOnboardingRules,
    rules,
    onboardingTemplateTasks,
  };
}

function parseMutationReceipt(value: unknown): InventoryMutationReceipt | null {
  if (
    !isRecord(value) ||
    !isRecord(value.data) ||
    !hasOnlyKeys(value.data, ["accepted", "id"])
  )
    return null;
  return value.data.accepted === true && isUuid(value.data.id)
    ? { accepted: true, id: value.data.id.toLowerCase() }
    : null;
}

type InventoryItemImageUpload = {
  itemId: string;
  storageObjectPath: string;
  signedUrl: string;
  contentType: "image/jpeg" | "image/png" | "image/webp";
  byteSize: number;
  expiresIn: number;
};

function isInventoryItemImagePath(
  value: unknown,
  tenantId: string,
  itemId: string,
): value is string {
  if (typeof value !== "string") return false;
  const prefix = `${tenantId}/${itemId}/`;
  if (!value.startsWith(prefix)) return false;
  const objectId = value.slice(prefix.length);
  return objectId === objectId.toLowerCase() && isUuid(objectId);
}

function signedStorageUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length < 1 || value.length > 8_192) {
    return null;
  }
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") &&
      !url.username &&
      !url.password
      ? value
      : null;
  } catch {
    return null;
  }
}

function validImageResponseExpiry(
  value: unknown,
  maximum: number,
): number | null {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= maximum
    ? value
    : null;
}

export function parseInventoryItemImageUpload(
  value: unknown,
  tenantId: string,
  itemId: string,
): InventoryItemImageUpload | null {
  if (
    !isRecord(value) ||
    !isRecord(value.data) ||
    !hasOnlyKeys(value.data, [
      "itemId",
      "storageObjectPath",
      "signedUrl",
      "contentType",
      "byteSize",
      "expiresIn",
    ]) ||
    value.data.itemId !== itemId ||
    !isInventoryItemImagePath(value.data.storageObjectPath, tenantId, itemId)
  ) {
    return null;
  }
  const signedUrl = signedStorageUrl(value.data.signedUrl);
  const contentType = value.data.contentType;
  const byteSize = value.data.byteSize;
  const expiresIn = validImageResponseExpiry(value.data.expiresIn, 15 * 60);
  return signedUrl &&
    (contentType === "image/jpeg" ||
      contentType === "image/png" ||
      contentType === "image/webp") &&
    typeof byteSize === "number" &&
    Number.isSafeInteger(byteSize) &&
    byteSize >= 1 &&
    byteSize <= INVENTORY_ITEM_IMAGE_MAX_BYTES &&
    expiresIn !== null
    ? {
        itemId,
        storageObjectPath: value.data.storageObjectPath,
        signedUrl,
        contentType,
        byteSize,
        expiresIn,
      }
    : null;
}

export function parseInventoryItemImageDownloadUrl(
  value: unknown,
  itemId: string,
): { itemId: string; signedUrl: string; expiresIn: number } | null {
  if (
    !isRecord(value) ||
    !isRecord(value.data) ||
    !hasOnlyKeys(value.data, ["itemId", "signedUrl", "expiresIn"]) ||
    value.data.itemId !== itemId
  ) {
    return null;
  }
  const signedUrl = signedStorageUrl(value.data.signedUrl);
  const expiresIn = validImageResponseExpiry(value.data.expiresIn, 10 * 60);
  return signedUrl && expiresIn !== null
    ? { itemId, signedUrl, expiresIn }
    : null;
}

function parseInventoryItemImageCompletion(
  value: unknown,
  itemId: string,
): boolean {
  return (
    isRecord(value) &&
    isRecord(value.data) &&
    hasOnlyKeys(value.data, ["itemId", "hasPrimaryImage"]) &&
    value.data.itemId === itemId &&
    value.data.hasPrimaryImage === true
  );
}

function parseInventoryItemImageDeletion(
  value: unknown,
  itemId: string,
): boolean {
  return (
    isRecord(value) &&
    isRecord(value.data) &&
    hasOnlyKeys(value.data, ["itemId", "deleted"]) &&
    value.data.itemId === itemId &&
    value.data.deleted === true
  );
}

export function inventoryItemImageFileError(
  file: Pick<File, "type" | "size">,
): string | null {
  const contentType = file.type.trim().toLowerCase();
  if (!INVENTORY_ITEM_IMAGE_CONTENT_TYPES.has(contentType)) {
    return "Wähle ein JPEG-, PNG- oder WebP-Bild aus.";
  }
  if (!Number.isSafeInteger(file.size) || file.size < 1) {
    return "Das Bild darf nicht leer sein.";
  }
  if (file.size > INVENTORY_ITEM_IMAGE_MAX_BYTES) {
    return "Das Bild darf höchstens 5 MiB gross sein.";
  }
  return null;
}

function clientRequestStorageKey(tenantId: string, operation: string): string {
  return `${REQUEST_ID_STORAGE_PREFIX}${encodeURIComponent(tenantId)}:${encodeURIComponent(
    operation,
  )}`;
}

function requestIdForOperation(tenantId: string, operation: string): string {
  const key = clientRequestStorageKey(tenantId, operation);
  try {
    const stored = window.sessionStorage.getItem(key);
    if (isUuid(stored)) return stored.toLowerCase();
    if (stored !== null) window.sessionStorage.removeItem(key);
    const id = crypto.randomUUID().toLowerCase();
    window.sessionStorage.setItem(key, id);
    return id;
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts. The
    // submission still receives one browser-generated UUID in this case.
    return crypto.randomUUID().toLowerCase();
  }
}

function discardRequestIdForOperation(
  tenantId: string,
  operation: string,
): void {
  try {
    window.sessionStorage.removeItem(
      clientRequestStorageKey(tenantId, operation),
    );
  } catch {
    // A blocked sessionStorage must not prevent a permitted mutation.
  }
}

function useClientRequestId(tenantId: string, operation: string) {
  const requestId = useCallback(
    () => requestIdForOperation(tenantId, operation),
    [operation, tenantId],
  );
  const discard = useCallback(
    () => discardRequestIdForOperation(tenantId, operation),
    [operation, tenantId],
  );
  return { discard, requestId };
}

export function parseInventoryWorkspace(
  value: unknown,
): InventoryWorkspace | null {
  if (!isRecord(value) || !isRecord(value.data)) return null;
  const data = value.data;
  if (
    !hasOnlyKeys(data, [
      "permissions",
      "summary",
      "items",
      "locations",
      "recentEvents",
      "recentEventsHasMore",
      "lowStockItems",
      "departments",
    ])
  )
    return null;
  if (!isRecord(data.permissions) || !isRecord(data.summary)) return null;
  const permissions = data.permissions;
  const summary = data.summary;
  if (
    !hasOnlyKeys(permissions, [
      "canRead",
      "canManage",
      "canMove",
      "canAdjust",
      "canCloseInventoryCount",
    ]) ||
    !hasOnlyKeys(summary, [
      "criticalItemCount",
      "openReservationCount",
      "activeCountSessionCount",
    ])
  )
    return null;
  if (
    permissions.canRead !== true ||
    typeof permissions.canManage !== "boolean" ||
    typeof permissions.canMove !== "boolean" ||
    typeof permissions.canAdjust !== "boolean" ||
    typeof permissions.canCloseInventoryCount !== "boolean" ||
    nonnegativeNumber(summary.criticalItemCount) === null ||
    nonnegativeNumber(summary.openReservationCount) === null ||
    nonnegativeNumber(summary.activeCountSessionCount) === null ||
    (data.recentEventsHasMore !== undefined &&
      typeof data.recentEventsHasMore !== "boolean")
  ) {
    return null;
  }
  const items = parseList(data.items, parseItem);
  const locations = parseList(data.locations, parseLocation);
  const recentEvents = parseList(data.recentEvents, parseEvent);
  const lowStockItems = parseList(data.lowStockItems, parseItem);
  const departments =
    data.departments === undefined
      ? []
      : parseList(data.departments, parseDepartment);
  if (!items || !locations || !recentEvents || !lowStockItems || !departments)
    return null;
  return {
    departments,
    items,
    locations,
    lowStockItems,
    permissions: {
      canAdjust: permissions.canAdjust,
      canCloseInventoryCount: permissions.canCloseInventoryCount,
      canManage: permissions.canManage,
      canMove: permissions.canMove,
      canRead: true,
    },
    recentEvents,
    recentEventsHasMore: data.recentEventsHasMore ?? false,
    summary: {
      activeCountSessionCount: summary.activeCountSessionCount as number,
      criticalItemCount: summary.criticalItemCount as number,
      openReservationCount: summary.openReservationCount as number,
    },
  };
}

function quantity(value: number, unit: string): string {
  return (
    new Intl.NumberFormat("de-CH", {
      maximumFractionDigits: 2,
    }).format(value) + ` ${unit}`
  );
}

function dateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Unbekannt"
    : new Intl.DateTimeFormat("de-CH", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
}

function eventLabel(type: string): string {
  const labels: Record<string, string> = {
    adjustment: "Korrektur",
    inventory_count_post: "Inventurkorrektur",
    issue: "Ausgabe",
    receipt: "Wareneingang",
    reservation_hold: "Reservation",
    reservation_release: "Reservation aufgehoben",
    return: "Rückgabe",
    transfer: "Umlagerung",
    writeoff: "Defekt oder Verlust",
  };
  return labels[type] ?? "Bestandsbewegung";
}

function deltaLabel(value: number, unit: string): string {
  if (value === 0) return "—";
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${quantity(value, unit)}`;
}

export function Inventory({
  createRequestId,
  focusItemId,
  labelBranding,
  onCreateRequestConsumed,
  onFocusConsumed,
  tenantId,
}: {
  createRequestId?: number | undefined;
  /** Opens the article list showing only this article (QR label link). */
  focusItemId?: string | undefined;
  /** Tenant name and logo for printed labels. */
  labelBranding?: LabelBranding | undefined;
  onCreateRequestConsumed?: (requestId: number) => void;
  /** Called once the focus link was applied, so it does not apply again. */
  onFocusConsumed?: () => void;
  tenantId: string;
}) {
  const [activeSection, setActiveSection] =
    useState<InventorySection>("Übersicht");
  // "+" menu: show the articles with the create form open.
  const [itemCreateRequestId, setItemCreateRequestId] = useState<
    number | undefined
  >(undefined);
  useEffect(() => {
    if (createRequestId === undefined) return;
    setActiveSection("Artikel");
    setItemCreateRequestId(createRequestId);
    onCreateRequestConsumed?.(createRequestId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createRequestId]);
  const [workspace, setWorkspace] = useState<InventoryWorkspace | null>(null);
  const [openReservations, setOpenReservations] = useState<OpenReservation[]>(
    [],
  );
  const [activeCounts, setActiveCounts] = useState<ActiveInventoryCount[]>([]);
  const [sourceReservationRules, setSourceReservationRules] =
    useState<SourceReservationRules | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<"error" | "success">("error");

  const readOpenReservations = useCallback(async (): Promise<
    OpenReservation[]
  > => {
    if (!supabase) {
      throw new Error("Die Verbindung zu nextDesk ist nicht konfiguriert.");
    }
    const { data, error } = await supabase.functions.invoke<unknown>(
      "inventory",
      {
        body: { tenantId, type: "listOpenReservations" },
      },
    );
    if (error) throw error;
    const parsed = parseOpenReservations(data);
    if (!parsed) {
      throw new Error(
        "Die Reservationsantwort ist unvollständig oder nicht autorisiert.",
      );
    }
    return parsed;
  }, [tenantId]);

  const readActiveCounts = useCallback(async (): Promise<
    ActiveInventoryCount[]
  > => {
    if (!supabase) {
      throw new Error("Die Verbindung zu nextDesk ist nicht konfiguriert.");
    }
    const { data, error } = await supabase.functions.invoke<unknown>(
      "inventory",
      {
        body: { tenantId, type: "listActiveCounts" },
      },
    );
    if (error) throw error;
    const parsed = parseActiveCounts(data);
    if (!parsed) {
      throw new Error(
        "Die Inventurantwort ist unvollständig oder nicht autorisiert.",
      );
    }
    return parsed;
  }, [tenantId]);

  const readSourceReservationRules =
    useCallback(async (): Promise<SourceReservationRules> => {
      if (!supabase) {
        throw new Error("Die Verbindung zu nextDesk ist nicht konfiguriert.");
      }
      const { data, error } = await supabase.functions.invoke<unknown>(
        "inventory",
        {
          body: { tenantId, type: "listSourceReservationRules" },
        },
      );
      if (error) throw error;
      const parsed = parseSourceReservationRules(data);
      if (!parsed) {
        throw new Error(
          "Die Regeln für automatische Reservationen sind unvollständig oder nicht autorisiert.",
        );
      }
      return parsed;
    }, [tenantId]);

  const load = useCallback(async (): Promise<boolean> => {
    if (!supabase) {
      setWorkspace(null);
      setOpenReservations([]);
      setActiveCounts([]);
      setSourceReservationRules(null);
      setLoading(false);
      setMessageKind("error");
      setMessage("Die Verbindung zu nextDesk ist nicht konfiguriert.");
      return false;
    }
    setLoading(true);
    setMessage("");
    try {
      // The three follow-up reads do not depend on the workspace response, so
      // they start together with it instead of one full round trip later.
      // Denied reads are discarded below according to the workspace
      // permissions.
      const workspacePromise = supabase.functions.invoke<unknown>("inventory", {
        body: { tenantId, type: "workspace" },
      });
      const followUps = Promise.allSettled([
        readOpenReservations(),
        readActiveCounts(),
        readSourceReservationRules(),
      ]);
      const { data, error } = await workspacePromise;
      if (error) throw error;
      const parsed = parseInventoryWorkspace(data);
      if (!parsed) {
        throw new Error(
          "Die Lagerantwort ist unvollständig oder nicht autorisiert.",
        );
      }
      const [reservationsResult, countsResult, sourceRulesResult] =
        await followUps;
      const unwrap = <T,>(
        wanted: boolean,
        result: PromiseSettledResult<T>,
        empty: T,
      ): T => {
        if (!wanted) return empty;
        if (result.status === "rejected") throw result.reason;
        return result.value;
      };
      const reservations = unwrap(
        parsed.permissions.canMove,
        reservationsResult,
        [] as OpenReservation[],
      );
      const counts = unwrap(
        parsed.permissions.canManage ||
          parsed.permissions.canCloseInventoryCount,
        countsResult,
        [] as ActiveInventoryCount[],
      );
      const sourceRules = unwrap(
        parsed.permissions.canManage,
        sourceRulesResult,
        null as SourceReservationRules | null,
      );
      setWorkspace(parsed);
      setOpenReservations(reservations);
      setActiveCounts(counts);
      setSourceReservationRules(sourceRules);
      return true;
    } catch (error) {
      setOpenReservations([]);
      setActiveCounts([]);
      setSourceReservationRules(null);
      setMessageKind("error");
      setMessage(
        await functionErrorMessage(
          error,
          "Das Lager konnte nicht geladen werden.",
        ),
      );
      return false;
    } finally {
      setLoading(false);
    }
  }, [
    readActiveCounts,
    readOpenReservations,
    readSourceReservationRules,
    tenantId,
  ]);

  useEffect(() => {
    setWorkspace(null);
    setOpenReservations([]);
    setActiveCounts([]);
    setSourceReservationRules(null);
    void load();
  }, [load]);

  // QR label link: show only this article until «Alle Artikel» is chosen.
  const [focusId, setFocusId] = useState<string | undefined>(focusItemId);
  useEffect(() => {
    if (!focusItemId) return;
    setFocusId(focusItemId);
    setActiveSection("Artikel");
    onFocusConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusItemId]);
  const currentItems = useMemo(
    () =>
      workspace?.items.filter(
        (item) => item.active && (!focusId || item.id === focusId),
      ) ?? [],
    [focusId, workspace],
  );

  const onChanged = useCallback<InventoryChangedHandler>(
    async (action, successMessage) => {
      if (!supabase) {
        setMessageKind("error");
        setMessage("Die Verbindung zu nextDesk ist nicht konfiguriert.");
        return null;
      }
      setMessage("");
      try {
        const { data, error } = await supabase.functions.invoke<unknown>(
          "inventory",
          {
            body: action,
          },
        );
        if (error) throw error;
        const receipt = parseMutationReceipt(data);
        if (!receipt) {
          throw new Error(
            "Die Lagerantwort hat keinen bestätigten Vorgang enthalten.",
          );
        }

        const refreshed = await load();
        if (refreshed) {
          setMessageKind("success");
          setMessage(successMessage);
        } else {
          setMessageKind("error");
          setMessage(
            "Die Aktion wurde gespeichert, aber die Lageransicht konnte nicht aktualisiert werden.",
          );
        }
        return receipt;
      } catch (error) {
        setMessageKind("error");
        setMessage(
          await functionErrorMessage(
            error,
            "Die Lageraktion konnte nicht abgeschlossen werden.",
          ),
        );
        return null;
      }
    },
    [load],
  );

  return (
    <section className="inventory" aria-labelledby="inventory-heading">
      <header className="inventory__header panel">
        <div>
          <span className="eyebrow">LAGER</span>
          <h1 id="inventory-heading">Bestände sicher bewirtschaften</h1>
          <p>
            Bestände, Reservationen und Inventuren werden serverseitig geprüft
            und nachvollziehbar als Bewegungen festgehalten.
          </p>
        </div>
      </header>

      <div
        className="inventory__tabs"
        role="tablist"
        aria-label="Lagerbereiche"
      >
        {sections
          // Beschaffung nur für die Lagerverwaltung.
          .filter(
            (section) =>
              section !== "Beschaffung" ||
              workspace?.permissions.canManage === true,
          )
          .map((section) => (
            <button
              aria-selected={activeSection === section}
              key={section}
              onClick={() => setActiveSection(section)}
              role="tab"
              type="button"
            >
              {section}
            </button>
          ))}
      </div>

      {loading ? (
        <p className="inventory__state">Lager wird geladen …</p>
      ) : null}
      {message ? (
        <div
          className={`inventory__state${
            messageKind === "error" ? " inventory__state--error" : ""
          }`}
          role={messageKind === "error" ? "alert" : "status"}
        >
          {messageKind === "error" ? (
            <AlertTriangle aria-hidden="true" size={18} />
          ) : (
            <ShieldCheck aria-hidden="true" size={18} />
          )}
          <span>{message}</span>
        </div>
      ) : null}

      {!loading && workspace ? (
        <div className="inventory__content" role="tabpanel">
          {activeSection === "Übersicht" ? (
            <InventoryOverview workspace={workspace} />
          ) : null}
          {activeSection === "Artikel" ? (
            <InventoryItems
              canManage={workspace.permissions.canManage}
              createOpenRequestId={itemCreateRequestId}
              departments={workspace.departments}
              focused={Boolean(focusId)}
              items={currentItems}
              labelBranding={labelBranding}
              locations={workspace.locations}
              onShowAll={() => setFocusId(undefined)}
              onChanged={onChanged}
              onImagesChanged={load}
              tenantId={tenantId}
            />
          ) : null}
          {activeSection === "Lagerorte" ? (
            <InventoryLocations
              canManage={workspace.permissions.canManage}
              locations={workspace.locations}
              onChanged={onChanged}
              tenantId={tenantId}
            />
          ) : null}
          {activeSection === "Bewegungen" ? (
            <InventoryEvents
              canAdjust={workspace.permissions.canAdjust}
              canMove={workspace.permissions.canMove}
              events={workspace.recentEvents}
              hasMore={workspace.recentEventsHasMore}
              items={workspace.items}
              locations={workspace.locations}
              onChanged={onChanged}
              tenantId={tenantId}
            />
          ) : null}
          {activeSection === "Reservationen" ? (
            <InventoryReservations
              canMove={workspace.permissions.canMove}
              items={workspace.items}
              locations={workspace.locations}
              onChanged={onChanged}
              openReservations={openReservations}
              openReservationCount={workspace.summary.openReservationCount}
              sourceReservationRules={sourceReservationRules}
              tenantId={tenantId}
            />
          ) : null}
          {activeSection === "Beschaffung" &&
          workspace.permissions.canManage ? (
            <InventoryProcurement tenantId={tenantId} />
          ) : null}
          {activeSection === "Inventur" ? (
            <InventoryCounts
              activeCountSessionCount={
                workspace.summary.activeCountSessionCount
              }
              activeCounts={activeCounts}
              canClose={workspace.permissions.canCloseInventoryCount}
              canManage={workspace.permissions.canManage}
              items={workspace.items}
              locations={workspace.locations}
              onChanged={onChanged}
              tenantId={tenantId}
            />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function InventoryOverview({ workspace }: { workspace: InventoryWorkspace }) {
  return (
    <>
      <div className="inventory__metrics">
        <article
          className={`inventory__metric ${
            workspace.summary.criticalItemCount > 0
              ? "inventory__metric--attention"
              : "inventory__metric--ok"
          }`}
        >
          {workspace.summary.criticalItemCount > 0 ? (
            <AlertTriangle aria-hidden="true" size={19} />
          ) : (
            <CircleCheck aria-hidden="true" size={19} />
          )}
          <span>Unterbestand</span>
          <strong>{workspace.summary.criticalItemCount}</strong>
          <small>
            {workspace.summary.criticalItemCount > 0
              ? "Artikel benötigen Aufmerksamkeit"
              : "Alles im grünen Bereich"}
          </small>
        </article>
        <article className="inventory__metric">
          <PackageCheck aria-hidden="true" size={19} />
          <span>Offene Reservationen</span>
          <strong>{workspace.summary.openReservationCount}</strong>
          <small>reduzieren den verfügbaren Bestand</small>
        </article>
        <article className="inventory__metric">
          <ClipboardList aria-hidden="true" size={19} />
          <span>Laufende Inventuren</span>
          <strong>{workspace.summary.activeCountSessionCount}</strong>
          <small>werden erst bewusst abgeschlossen</small>
        </article>
      </div>
      <div className="inventory__grid">
        <section className="inventory__panel panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">HANDLUNGSBEDARF</span>
              <h2>Unter Mindestbestand</h2>
            </div>
            <AlertTriangle aria-hidden="true" size={20} />
          </div>
          {workspace.lowStockItems.length ? (
            <ul className="inventory__list">
              {workspace.lowStockItems.map((item) => (
                <li key={item.id}>
                  <div>
                    <strong>{item.name}</strong>
                    <small>
                      {item.locationName ?? "Ohne Lagerort"} · Mindestbestand{" "}
                      {quantity(item.minQuantity, item.unit)}
                    </small>
                  </div>
                  <b>{quantity(item.availableQuantity, item.unit)}</b>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyInventoryState text="Alle sichtbaren Artikel liegen über dem Mindestbestand." />
          )}
        </section>
        <section className="inventory__panel panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">VERLAUF</span>
              <h2>Letzte Bewegungen</h2>
            </div>
            <ArrowLeftRight aria-hidden="true" size={20} />
          </div>
          <InventoryEventList
            events={workspace.recentEvents.slice(0, 6)}
            items={workspace.items}
          />
        </section>
      </div>
    </>
  );
}

async function inventoryInvoke(body: Record<string, unknown>) {
  if (!supabase) {
    throw new Error("Die Verbindung zu nextDesk ist nicht konfiguriert.");
  }
  const { data, error } = await supabase.functions.invoke<unknown>(
    "inventory",
    { body },
  );
  if (error) {
    throw new Error(
      await functionErrorMessage(
        error,
        "Die Lageraktion konnte nicht abgeschlossen werden.",
      ),
    );
  }
  return data;
}

/** Lagerzugriffe des gemeinsamen Artikelformulars (siehe shop.tsx). */
function inventoryEditorApi(tenantId: string): StockEditor["api"] {
  return {
    saveItem: async (values, itemId) => {
      const data = await inventoryInvoke(
        itemId
          ? {
              type: "manageItem",
              tenantId,
              operation: "update",
              itemId,
              values,
              clientRequestId: crypto.randomUUID(),
            }
          : {
              type: "manageItem",
              tenantId,
              operation: "create",
              values: { ...values, trackingMode: "quantity" },
              clientRequestId: crypto.randomUUID(),
            },
      );
      const receipt = parseMutationReceipt(data);
      const id = receipt?.id ?? itemId;
      if (!id) {
        throw new Error(
          "Die Lagerantwort hat keinen bestätigten Vorgang enthalten.",
        );
      }
      return id;
    },
    postStock: async ({ itemId, locationId, delta }) => {
      await inventoryInvoke({
        type: "postMovement",
        tenantId,
        itemId,
        movementType: delta > 0 ? "receipt" : "adjustment_out",
        quantity: Math.abs(delta),
        ...(delta > 0
          ? { toLocationId: locationId }
          : { fromLocationId: locationId }),
        clientRequestId: crypto.randomUUID(),
      });
    },
    moveStock: async ({ itemId, fromLocationId, toLocationId, quantity }) => {
      await inventoryInvoke({
        type: "postMovement",
        tenantId,
        itemId,
        movementType: "transfer",
        quantity,
        fromLocationId,
        toLocationId,
        clientRequestId: crypto.randomUUID(),
      });
    },
    uploadImage: (itemId, file) =>
      uploadInventoryItemImageFile(tenantId, itemId, file),
    deleteImage: async (itemId) => {
      const data = await inventoryInvoke({ type: "delete", tenantId, itemId });
      if (!parseInventoryItemImageDeletion(data, itemId)) {
        throw new Error("Ungültige Löschantwort.");
      }
    },
    deleteItem: async (itemId) => {
      const data = await inventoryInvoke({
        type: "deleteItem",
        tenantId,
        itemId,
      });
      const deleted =
        isRecord(data) && isRecord(data.data) ? data.data.deleted : undefined;
      if (deleted === true) return "deleted";
      if (deleted === false) return "in_use";
      throw new Error("Ungültige Löschantwort.");
    },
    archiveItem: async (itemId) => {
      await inventoryInvoke({
        type: "manageItem",
        tenantId,
        operation: "archive",
        itemId,
        clientRequestId: crypto.randomUUID(),
      });
    },
    loadImageUrl: async (itemId) => {
      const data = await inventoryInvoke({
        type: "createDownloadUrl",
        tenantId,
        itemId,
      });
      return (
        parseInventoryItemImageDownloadUrl(data, itemId)?.signedUrl ?? null
      );
    },
  };
}

function InventoryItems({
  canManage,
  createOpenRequestId,
  departments,
  focused,
  items,
  labelBranding,
  locations,
  onChanged,
  onImagesChanged,
  onShowAll,
  tenantId,
}: {
  canManage: boolean;
  /** Opens the create form (key) when set by the "+" menu. */
  createOpenRequestId?: number | undefined;
  departments: readonly InventoryDepartment[];
  /** Only one article is shown (QR label link). */
  focused: boolean;
  items: readonly InventoryItemSummary[];
  labelBranding?: LabelBranding | undefined;
  locations: readonly InventoryLocation[];
  onShowAll: () => void;
  onChanged: InventoryChangedHandler;
  onImagesChanged: () => Promise<boolean>;
  tenantId: string;
}) {
  // Die Abteilung wird nur gezeigt, wenn mehrere zur Auswahl stehen.
  const showDepartment = departments.length > 1;
  const departmentNames = new Map(
    departments.map((department) => [department.id, department.name]),
  );
  // Shop-Verknüpfung: welcher Lagerartikel im Shop angeboten wird.
  const [shop, setShop] = useState<{
    canManage: boolean;
    linked: Map<string, { name: string; active: boolean; kind: string }>;
  } | null>(null);
  const [shopNotice, setShopNotice] = useState("");
  const [shopError, setShopError] = useState("");
  const [offering, setOffering] = useState<string | null>(null);
  // Artikelformular (gleiche Felder wie im Shop) für Erfassen und Bearbeiten.
  const [editorRequest, setEditorRequest] = useState<EditorRequest | null>(
    null,
  );
  const [editorStock, setEditorStock] = useState<StockEditor | null>(null);
  // Etiketten: ausgewählte Artikel und Druckdialog.
  const [labelSelection, setLabelSelection] = useState<Set<string>>(
    () => new Set(),
  );
  const [labelDialogOpen, setLabelDialogOpen] = useState(false);
  const labelItems = items.filter((item) => labelSelection.has(item.id));
  const openEditor = useCallback(
    (item: InventoryItemSummary | null) => {
      const activeLocations = locations
        .filter((location) => location.active)
        .map((location) => ({ id: location.id, name: location.name }));
      setEditorStock({
        item: item
          ? {
              id: item.id,
              name: item.name,
              articleNumber: item.articleNumber,
              unit: item.unit,
              minQuantity: item.minQuantity,
              targetQuantity: item.targetQuantity,
              loanItem: item.loanItem === true,
              physicalQuantity: item.physicalQuantity,
              locationId: item.locationName
                ? (locations.find(
                    (location) => location.name === item.locationName,
                  )?.id ?? null)
                : null,
              hasPrimaryImage: item.hasPrimaryImage,
              departmentId: item.departmentId,
            }
          : null,
        locations: activeLocations,
        api: inventoryEditorApi(tenantId),
      });
      setEditorRequest({ kind: "stock", nonce: Date.now() });
    },
    [locations, tenantId],
  );
  const openedCreateRequest = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (
      canManage &&
      createOpenRequestId !== undefined &&
      openedCreateRequest.current !== createOpenRequestId
    ) {
      openedCreateRequest.current = createOpenRequestId;
      openEditor(null);
    }
  }, [canManage, createOpenRequestId, openEditor]);
  const loadShop = useCallback(async () => {
    try {
      const context = await shopApi.context(tenantId);
      const catalog = await shopApi.catalog(tenantId, context.canManage);
      const linked = new Map<
        string,
        { name: string; active: boolean; kind: string }
      >();
      for (const entry of catalog) {
        if (entry.inventoryItemId) {
          linked.set(entry.inventoryItemId, {
            name: entry.name,
            active: entry.active,
            kind: entry.kind,
          });
        }
      }
      setShop({ canManage: context.canManage, linked });
    } catch {
      // Ohne Shop-Modul bleibt die Spalte leer.
      setShop(null);
    }
  }, [tenantId]);
  useEffect(() => {
    void loadShop();
  }, [loadShop]);
  const offer = async (item: InventoryItemSummary) => {
    setOffering(item.id);
    setShopError("");
    setShopNotice("");
    try {
      const result = await shopApi.offerInventoryItem(tenantId, item.id);
      setShopNotice(
        result.created
          ? `«${item.name}» ist jetzt im Shop.`
          : `«${item.name}» war schon im Shop.`,
      );
      await loadShop();
    } catch (nextError) {
      setShopError(
        nextError instanceof Error
          ? nextError.message
          : "Der Artikel konnte nicht in den Shop übernommen werden.",
      );
    } finally {
      setOffering(null);
    }
  };
  return (
    <section className="inventory__panel panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">ARTIKEL</span>
          <h2>Bestand nach Artikel</h2>
          <p>
            Physischer und reservierter Bestand stammen aus dem serverseitigen
            Bewegungsbuch.
          </p>
        </div>
        {canManage ? (
          <span className="inventory__permission">
            Artikelverwaltung erlaubt
          </span>
        ) : null}
      </div>
      {canManage ? (
        <div className="inventory__create-row">
          <button
            className="primary-button"
            onClick={() => openEditor(null)}
            type="button"
          >
            <Plus aria-hidden="true" size={16} /> Artikel erfassen
          </button>
        </div>
      ) : null}
      {canManage && editorStock ? (
        <CatalogEditor
          departments={[...departments]}
          onDone={(message) => {
            setEditorRequest(null);
            if (message) {
              setShopNotice(message);
              void onImagesChanged();
              void loadShop();
            }
          }}
          request={editorRequest}
          stock={editorStock}
          tenantId={tenantId}
        />
      ) : null}
      {focused ? (
        <p className="inventory__focus-note" role="status">
          Es wird nur der Artikel aus dem Etiketten-Link angezeigt.{" "}
          <button className="text-button" onClick={onShowAll} type="button">
            Alle Artikel anzeigen
          </button>
        </p>
      ) : null}
      {shopNotice ? (
        <p className="form-success" role="status">
          {shopNotice}
        </p>
      ) : null}
      {items.length > 0 ? (
        <LabelSelectionBar
          onClear={() => setLabelSelection(new Set())}
          onPrint={() => setLabelDialogOpen(true)}
          onSelectVisible={() =>
            setLabelSelection(new Set(items.map((item) => item.id)))
          }
          selectedCount={labelItems.length}
          visibleCount={items.length}
        />
      ) : null}
      {labelDialogOpen ? (
        <AssetLabelDialog
          branding={labelBranding}
          buildItems={(_mode, baseUrl) =>
            labelItems.map((item) =>
              inventoryLabelItem(
                {
                  id: item.id,
                  name: item.name,
                  articleNumber: item.articleNumber,
                  locationName: item.locationName,
                },
                baseUrl,
              ),
            )
          }
          count={labelItems.length}
          onClose={() => setLabelDialogOpen(false)}
          webOnly
        />
      ) : null}
      {shopError ? (
        <p className="form-error" role="alert">
          {shopError}
        </p>
      ) : null}
      {items.length ? (
        <div className="inventory__table-wrap">
          <table className="inventory__table">
            <thead>
              <tr>
                <th>Artikel</th>
                <th>Bild</th>
                {showDepartment ? <th>Abteilung</th> : null}
                <th>Lagerort</th>
                <th>Physisch</th>
                <th>Reserviert</th>
                <th>Verfügbar</th>
                <th>Mindestbestand</th>
                {shop ? <th>Shop</th> : null}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <label className="asset-label-check">
                      <input
                        checked={labelSelection.has(item.id)}
                        onChange={(event) => {
                          const checked = event.target.checked;
                          setLabelSelection((current) => {
                            const next = new Set(current);
                            if (checked) next.add(item.id);
                            else next.delete(item.id);
                            return next;
                          });
                        }}
                        type="checkbox"
                      />
                      Für Etikett auswählen
                    </label>
                    <strong>{item.name}</strong>
                    <small>
                      {item.articleNumber ?? "Ohne Artikelnummer"} ·{" "}
                      {item.trackingMode === "serial"
                        ? "Serienführung"
                        : item.loanItem
                          ? "Ausleihartikel"
                          : "Mengenartikel"}
                    </small>
                    {canManage ? (
                      <button
                        className="secondary-button inventory__item-edit"
                        onClick={() => openEditor(item)}
                        type="button"
                      >
                        Bearbeiten
                      </button>
                    ) : null}
                  </td>
                  <td>
                    {/* Bilder werden nur im Artikelformular geändert. */}
                    <InventoryItemImage
                      canManage={false}
                      item={item}
                      onImagesChanged={onImagesChanged}
                      tenantId={tenantId}
                    />
                  </td>
                  {showDepartment ? (
                    <td>
                      {canManage ? (
                        <InventoryItemDepartmentSelect
                          departments={departments}
                          item={item}
                          onChanged={onChanged}
                          tenantId={tenantId}
                        />
                      ) : item.departmentId ? (
                        (departmentNames.get(item.departmentId) ??
                        "Andere Abteilung")
                      ) : (
                        "Alle Abteilungen"
                      )}
                    </td>
                  ) : null}
                  <td>{item.locationName ?? "Nicht zugeordnet"}</td>
                  <td>{quantity(item.physicalQuantity, item.unit)}</td>
                  <td>{quantity(item.reservedQuantity, item.unit)}</td>
                  <td
                    className={
                      item.availableQuantity <= item.minQuantity
                        ? "inventory__value--attention"
                        : undefined
                    }
                  >
                    {quantity(item.availableQuantity, item.unit)}
                  </td>
                  <td>
                    {item.loanItem ? (
                      <span className="inventory__muted">–</span>
                    ) : (
                      quantity(item.minQuantity, item.unit)
                    )}
                  </td>
                  {shop ? (
                    <td>
                      {shop.linked.has(item.id) ? (
                        <span
                          className={`inventory__shop-badge${shop.linked.get(item.id)?.active ? "" : " inventory__shop-badge--hidden"}`}
                        >
                          {shop.linked.get(item.id)?.active
                            ? "Im Shop"
                            : "Im Shop · ausgeblendet"}
                          {" · "}
                          {shop.linked.get(item.id)?.kind === "loan"
                            ? "Ausleihartikel"
                            : "Bestellartikel"}
                        </span>
                      ) : shop.canManage ? (
                        <button
                          className="secondary-button inventory__shop-offer"
                          disabled={offering !== null}
                          onClick={() => void offer(item)}
                          type="button"
                        >
                          {offering === item.id
                            ? "Wird übernommen …"
                            : "Im Shop anbieten"}
                        </button>
                      ) : (
                        <span className="inventory__muted">–</span>
                      )}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyInventoryState
          text={
            canManage
              ? "Noch keine Artikel. Erfasse zuerst einen Lagerartikel über die Lagerverwaltung."
              : "Für deine Rolle sind keine aktiven Lagerartikel sichtbar."
          }
        />
      )}
    </section>
  );
}

/** Uploads the primary image of an item: signed upload URL, PUT, completion. */
async function uploadInventoryItemImageFile(
  tenantId: string,
  itemId: string,
  file: File,
): Promise<void> {
  if (!supabase) {
    throw new Error("Die Verbindung zu nextDesk ist nicht konfiguriert.");
  }
  const contentType = file.type.trim().toLowerCase() as
    "image/jpeg" | "image/png" | "image/webp";
  const { data: createData, error: createError } =
    await supabase.functions.invoke<unknown>("inventory", {
      body: {
        type: "createUpload",
        tenantId,
        itemId,
        contentType,
        byteSize: file.size,
      },
    });
  if (createError) throw createError;
  const upload = parseInventoryItemImageUpload(createData, tenantId, itemId);
  if (
    !upload ||
    upload.contentType !== contentType ||
    upload.byteSize !== file.size
  ) {
    throw new Error("Ungültige Upload-Antwort.");
  }
  const uploadResponse = await fetch(upload.signedUrl, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: file,
  });
  if (!uploadResponse.ok) throw new Error("Bild-Upload fehlgeschlagen.");
  const { data: completeData, error: completeError } =
    await supabase.functions.invoke<unknown>("inventory", {
      body: {
        type: "completeUpload",
        tenantId,
        itemId,
        storageObjectPath: upload.storageObjectPath,
        contentType,
        byteSize: file.size,
      },
    });
  if (completeError) throw completeError;
  if (!parseInventoryItemImageCompletion(completeData, itemId)) {
    throw new Error("Ungültige Bildabschluss-Antwort.");
  }
}

function InventoryItemImage({
  canManage,
  item,
  onImagesChanged,
  tenantId,
}: {
  canManage: boolean;
  item: InventoryItemSummary;
  onImagesChanged: () => Promise<boolean>;
  tenantId: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [loadingImage, setLoadingImage] = useState(false);
  const [pending, setPending] = useState<"upload" | "delete" | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [imageRevision, setImageRevision] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setImageUrl(null);
    if (!item.hasPrimaryImage)
      return () => {
        cancelled = true;
      };
    setLoadingImage(true);
    void (async () => {
      try {
        if (!supabase) {
          throw new Error("Die Verbindung zu nextDesk ist nicht konfiguriert.");
        }
        const { data, error: functionError } =
          await supabase.functions.invoke<unknown>("inventory", {
            body: { type: "createDownloadUrl", tenantId, itemId: item.id },
          });
        if (functionError) throw functionError;
        const parsed = parseInventoryItemImageDownloadUrl(data, item.id);
        if (!parsed) throw new Error("Ungültige Bildantwort.");
        if (!cancelled) setImageUrl(parsed.signedUrl);
      } catch {
        if (!cancelled) {
          setError("Das private Artikelbild konnte nicht geladen werden.");
        }
      } finally {
        if (!cancelled) setLoadingImage(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [imageRevision, item.hasPrimaryImage, item.id, tenantId]);

  useEffect(
    () => () => {
      if (localPreviewUrl) URL.revokeObjectURL(localPreviewUrl);
    },
    [localPreviewUrl],
  );

  function clearSelectedFile() {
    setSelectedFile(null);
    setLocalPreviewUrl(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  function selectFile(file: File | null) {
    setError("");
    setNotice("");
    if (!file) {
      clearSelectedFile();
      return;
    }
    const validationError = inventoryItemImageFileError(file);
    if (validationError) {
      setError(validationError);
      clearSelectedFile();
      return;
    }
    const previewUrl = URL.createObjectURL(file);
    setSelectedFile(file);
    setLocalPreviewUrl((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return previewUrl;
    });
  }

  async function uploadImage() {
    if (!selectedFile || pending) return;
    const file = selectedFile;
    const validationError = inventoryItemImageFileError(file);
    if (validationError) {
      setError(validationError);
      return;
    }
    if (!supabase) {
      setError("Die Verbindung zu nextDesk ist nicht konfiguriert.");
      return;
    }
    setPending("upload");
    setError("");
    setNotice("");
    try {
      await uploadInventoryItemImageFile(tenantId, item.id, file);
      clearSelectedFile();
      setImageUrl(null);
      setImageRevision((revision) => revision + 1);
      const refreshed = await onImagesChanged();
      setNotice(
        refreshed
          ? "Das primäre Artikelbild wurde gespeichert."
          : "Das Artikelbild wurde gespeichert, aber die Ansicht konnte nicht aktualisiert werden.",
      );
    } catch (nextError) {
      setError(
        await functionErrorMessage(
          nextError,
          "Das Artikelbild konnte nicht gespeichert werden.",
        ),
      );
    } finally {
      setPending(null);
    }
  }

  async function deleteImage() {
    if (!item.hasPrimaryImage || pending) return;
    if (!supabase) {
      setError("Die Verbindung zu nextDesk ist nicht konfiguriert.");
      return;
    }
    setPending("delete");
    setError("");
    setNotice("");
    try {
      const { data, error: functionError } =
        await supabase.functions.invoke<unknown>("inventory", {
          body: { type: "delete", tenantId, itemId: item.id },
        });
      if (functionError) throw functionError;
      if (!parseInventoryItemImageDeletion(data, item.id)) {
        throw new Error("Ungültige Löschantwort.");
      }
      clearSelectedFile();
      setImageUrl(null);
      setImageRevision((revision) => revision + 1);
      const refreshed = await onImagesChanged();
      setNotice(
        refreshed
          ? "Das primäre Artikelbild wurde entfernt."
          : "Das Artikelbild wurde entfernt, aber die Ansicht konnte nicht aktualisiert werden.",
      );
    } catch (nextError) {
      setError(
        await functionErrorMessage(
          nextError,
          "Das Artikelbild konnte nicht entfernt werden.",
        ),
      );
    } finally {
      setPending(null);
    }
  }

  const visibleImageUrl = localPreviewUrl ?? imageUrl;
  return (
    <div className="inventory__item-image">
      {visibleImageUrl ? (
        <img
          alt={localPreviewUrl ? `Lokale Vorschau: ${item.name}` : item.name}
          onError={() => {
            if (!localPreviewUrl) {
              setImageUrl(null);
              setError("Das private Artikelbild ist nicht mehr verfügbar.");
            }
          }}
          src={visibleImageUrl}
        />
      ) : loadingImage ? (
        <span className="inventory__item-image-placeholder">
          Bild wird geladen …
        </span>
      ) : (
        <span className="inventory__item-image-placeholder">Kein Bild</span>
      )}
      {canManage ? (
        <div className="inventory__item-image-actions">
          <label>
            <span className="sr-only">
              Primäres Bild für {item.name} wählen
            </span>
            <input
              accept="image/jpeg,image/png,image/webp"
              disabled={pending !== null}
              onChange={(event) => selectFile(event.target.files?.[0] ?? null)}
              ref={inputRef}
              type="file"
            />
          </label>
          {selectedFile ? (
            <button
              disabled={pending !== null}
              onClick={() => void uploadImage()}
              type="button"
            >
              {pending === "upload" ? "Speichert …" : "Bild speichern"}
            </button>
          ) : null}
          {item.hasPrimaryImage ? (
            <button
              className="inventory__item-image-delete"
              disabled={pending !== null}
              onClick={() => void deleteImage()}
              type="button"
            >
              {pending === "delete" ? "Entfernt …" : "Bild entfernen"}
            </button>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <small className="inventory__item-image-error">{error}</small>
      ) : null}
      {notice ? (
        <small className="inventory__item-image-notice">{notice}</small>
      ) : null}
    </div>
  );
}

function InventoryLocations({
  canManage,
  locations,
  onChanged,
  tenantId,
}: {
  canManage: boolean;
  locations: readonly InventoryLocation[];
  onChanged: InventoryChangedHandler;
  tenantId: string;
}) {
  return (
    <section className="inventory__panel panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">LAGERORTE</span>
          <h2>Orte und Fächer</h2>
          <p>Lagerorte sind unabhängig von Assetstandorten und Raumplanung.</p>
        </div>
        <MapPin aria-hidden="true" size={21} />
      </div>
      {canManage ? (
        <InventoryLocationCreateForm
          onChanged={onChanged}
          tenantId={tenantId}
        />
      ) : null}
      {locations.length ? (
        <ul className="inventory__location-grid">
          {locations.map((location) => (
            <InventoryLocationRow
              canManage={canManage}
              key={location.id}
              location={location}
              onChanged={onChanged}
              tenantId={tenantId}
            />
          ))}
        </ul>
      ) : (
        <EmptyInventoryState
          text={
            canManage
              ? "Noch keine Lagerorte. Erfasse zuerst einen Lagerort, bevor Bestand gebucht wird."
              : "Es sind keine aktiven Lagerorte sichtbar."
          }
        />
      )}
    </section>
  );
}

/** Ein Lagerort mit Bearbeiten, Löschen (archivieren) und Reaktivieren. */
function InventoryLocationRow({
  canManage,
  location,
  onChanged,
  tenantId,
}: {
  canManage: boolean;
  location: InventoryLocation;
  onChanged: InventoryChangedHandler;
  tenantId: string;
}) {
  const [editing, setEditing] = useState(false);
  const [code, setCode] = useState(location.code ?? "");
  const [name, setName] = useState(location.name);
  const [saving, setSaving] = useState(false);
  const request = useClientRequestId(tenantId, `location-${location.id}`);

  const run = async (
    body:
      | {
          operation: "update";
          values: { code?: string; name?: string; active?: boolean };
        }
      | { operation: "archive" },
    message: string,
  ): Promise<boolean> => {
    setSaving(true);
    const base = {
      type: "manageLocation" as const,
      tenantId,
      locationId: location.id,
      clientRequestId: request.requestId(),
    };
    const saved = await onChanged(
      body.operation === "archive"
        ? { ...base, operation: "archive" }
        : { ...base, operation: "update", values: body.values },
      message,
    );
    request.discard();
    setSaving(false);
    return Boolean(saved);
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!code.trim() || !name.trim() || saving) return;
    const saved = await run(
      {
        operation: "update",
        values: { code: code.trim(), name: name.trim() },
      },
      "Der Lagerort wurde gespeichert.",
    );
    if (saved) setEditing(false);
  };

  const archive = async () => {
    if (
      !window.confirm(
        `Lagerort «${location.name}» löschen? Er steht danach nicht mehr zur Auswahl. Bisherige Buchungen bleiben erhalten; ein vorhandener Bestand sollte vorher umgebucht werden.`,
      )
    )
      return;
    await run({ operation: "archive" }, "Der Lagerort wurde gelöscht.");
  };

  const reactivate = () =>
    run(
      { operation: "update", values: { active: true } },
      "Der Lagerort ist wieder aktiv.",
    );

  if (editing) {
    return (
      <li className="inventory__location-edit">
        <form onSubmit={(event) => void save(event)}>
          <FormGrid cols={2}>
            <FormField label="Ortscode" required>
              <input
                autoComplete="off"
                onChange={(event) => setCode(event.target.value)}
                required
                value={code}
              />
            </FormField>
            <FormField label="Bezeichnung" required>
              <input
                autoComplete="off"
                onChange={(event) => setName(event.target.value)}
                required
                value={name}
              />
            </FormField>
          </FormGrid>
          <div className="inventory__location-actions">
            <button
              className="secondary-button"
              disabled={saving}
              onClick={() => {
                setCode(location.code ?? "");
                setName(location.name);
                setEditing(false);
              }}
              type="button"
            >
              Abbrechen
            </button>
            <button
              disabled={saving || !code.trim() || !name.trim()}
              type="submit"
            >
              {saving ? "Wird gespeichert …" : "Speichern"}
            </button>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className={location.active ? undefined : "is-inactive"}>
      <MapPin aria-hidden="true" size={18} />
      <div>
        <strong>{location.name}</strong>
        <small>{location.code ?? "Ohne Ortscode"}</small>
      </div>
      {!location.active ? <span>Gelöscht</span> : null}
      {canManage ? (
        <span className="inventory__location-buttons">
          {location.active ? (
            <>
              <button
                aria-label={`${location.name} bearbeiten`}
                className="icon-button"
                disabled={saving}
                onClick={() => setEditing(true)}
                title="Bearbeiten"
                type="button"
              >
                <Pencil aria-hidden="true" size={15} />
              </button>
              <button
                aria-label={`${location.name} löschen`}
                className="icon-button"
                disabled={saving}
                onClick={() => void archive()}
                title="Löschen"
                type="button"
              >
                <Trash2 aria-hidden="true" size={15} />
              </button>
            </>
          ) : (
            <button
              aria-label={`${location.name} wieder aktivieren`}
              className="icon-button"
              disabled={saving}
              onClick={() => void reactivate()}
              title="Wieder aktivieren"
              type="button"
            >
              <RotateCcw aria-hidden="true" size={15} />
            </button>
          )}
        </span>
      ) : null}
    </li>
  );
}

function InventoryEvents({
  canAdjust,
  canMove,
  events,
  hasMore,
  items,
  locations,
  onChanged,
  tenantId,
}: {
  canAdjust: boolean;
  canMove: boolean;
  events: readonly InventoryEvent[];
  hasMore: boolean;
  items: readonly InventoryItemSummary[];
  locations: readonly InventoryLocation[];
  onChanged: InventoryChangedHandler;
  tenantId: string;
}) {
  return (
    <section className="inventory__panel panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">BEWEGUNGEN</span>
          <h2>Nachvollziehbares Bestandsbuch</h2>
          <p>
            Jede Korrektur wird als neue Gegenbuchung erstellt. Bestehende
            Bewegungen werden nie überschrieben.
          </p>
        </div>
        <Archive aria-hidden="true" size={21} />
      </div>
      {canMove || canAdjust ? (
        <>
          <p className="inventory__notice">
            <ShieldCheck aria-hidden="true" size={16} /> Buchungen werden erst
            nach einer serverseitigen Bestands- und Berechtigungsprüfung
            gespeichert.
          </p>
          <InventoryMovementForm
            canAdjust={canAdjust}
            canMove={canMove}
            items={items}
            locations={locations}
            onChanged={onChanged}
            tenantId={tenantId}
          />
        </>
      ) : null}
      <p className="inventory__muted">
        Begrenzte Bewegungshistorie
        {hasMore ? "; weitere Bewegungen sind vorhanden." : "."}
      </p>
      <InventoryEventList events={events} items={items} />
    </section>
  );
}

function InventoryEventList({
  events,
  items,
}: {
  events: readonly InventoryEvent[];
  items: readonly InventoryItemSummary[];
}) {
  const unitsByItemName = new Map(items.map((item) => [item.name, item.unit]));
  return events.length ? (
    <ul className="inventory__list inventory__list--events">
      {events.map((event) => {
        const unit = unitsByItemName.get(event.itemName) ?? "Stück";
        return (
          <li key={event.id}>
            <div>
              <strong>
                {eventLabel(event.type)} · {event.itemName}
              </strong>
              <small>
                {event.locationName ?? "Ohne Lagerort"} ·{" "}
                {dateTime(event.occurredAt)}
              </small>
            </div>
            <div className="inventory__deltas">
              <span>{deltaLabel(event.physicalDelta, unit)}</span>
              {event.reservedDelta !== 0 ? (
                <small>
                  Reserviert {deltaLabel(event.reservedDelta, unit)}
                </small>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  ) : (
    <EmptyInventoryState text="Noch keine Bewegungen. Der Bestand bleibt bis zur bewussten ersten Buchung unverändert." />
  );
}

function InventoryReservations({
  canMove,
  items,
  locations,
  onChanged,
  openReservations,
  openReservationCount,
  sourceReservationRules,
  tenantId,
}: {
  canMove: boolean;
  items: readonly InventoryItemSummary[];
  locations: readonly InventoryLocation[];
  onChanged: InventoryChangedHandler;
  openReservations: readonly OpenReservation[];
  openReservationCount: number;
  sourceReservationRules: SourceReservationRules | null;
  tenantId: string;
}) {
  return (
    <section className="inventory__panel panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">RESERVATIONEN</span>
          <h2>Material verbindlich vormerken</h2>
          <p>
            Reservationen reduzieren nur den verfügbaren Bestand. Eine Ausgabe
            wird erst durch eine separate Buchung ausgelöst.
          </p>
        </div>
        <PackageCheck aria-hidden="true" size={21} />
      </div>
      <p className="inventory__statement">
        <strong>{openReservationCount}</strong> offene Reservationen
      </p>
      <p className="inventory__muted">
        {canMove
          ? "Reservationen werden bei jeder Änderung atomar gegen den aktuellen verfügbaren Bestand geprüft."
          : "Für Reservationen benötigt deine Rolle die Berechtigung zur Lagerbewegung."}
      </p>
      {canMove ? (
        <>
          <InventoryOpenReservationList
            onChanged={onChanged}
            reservations={openReservations}
            tenantId={tenantId}
          />
          <InventoryReservationForm
            items={items}
            locations={locations}
            onChanged={onChanged}
            tenantId={tenantId}
          />
        </>
      ) : null}
      {sourceReservationRules &&
      (sourceReservationRules.canManageEventRules ||
        sourceReservationRules.canManageOnboardingRules) ? (
        <InventorySourceReservationRules
          items={items}
          locations={locations}
          onChanged={onChanged}
          sourceReservationRules={sourceReservationRules}
          tenantId={tenantId}
        />
      ) : null}
    </section>
  );
}

function equipmentLabel(key: SourceReservationEquipmentKey): string {
  return (
    SOURCE_RESERVATION_EQUIPMENT_OPTIONS.find((option) => option.value === key)
      ?.label ?? "Raum-Ausstattung"
  );
}

function InventorySourceReservationRules({
  items,
  locations,
  onChanged,
  sourceReservationRules,
  tenantId,
}: {
  items: readonly InventoryItemSummary[];
  locations: readonly InventoryLocation[];
  onChanged: InventoryChangedHandler;
  sourceReservationRules: SourceReservationRules;
  tenantId: string;
}) {
  const itemById = new Map(items.map((item) => [item.id, item]));
  const locationById = new Map(
    locations.map((location) => [location.id, location]),
  );
  const taskById = new Map(
    sourceReservationRules.onboardingTemplateTasks.map((task) => [
      task.templateTaskId,
      task,
    ]),
  );
  const sourceLabel = (rule: SourceReservationRule): string => {
    if (rule.sourceKind === "event_space_equipment") {
      return `Raum-Ausstattung: ${equipmentLabel(rule.equipmentKey)}`;
    }
    const task = taskById.get(rule.templateTaskId);
    return task && task.templateId === rule.templateId
      ? `Onboarding: ${task.templateTitle} · ${task.templateTaskTitle}`
      : "Onboarding-Vorlagenaufgabe";
  };
  const permittedSources =
    sourceReservationRules.canManageEventRules &&
    sourceReservationRules.canManageOnboardingRules
      ? "Raum-Ausstattung oder Onboarding-Vorlagenaufgaben"
      : sourceReservationRules.canManageEventRules
        ? "Raum-Ausstattung"
        : "Onboarding-Vorlagenaufgaben";

  return (
    <section
      aria-labelledby="inventory-source-reservation-rules-heading"
      className="inventory__panel panel"
    >
      <div className="panel-heading">
        <div>
          <span className="eyebrow">AUTOMATISCH RESERVIEREN</span>
          <h2 id="inventory-source-reservation-rules-heading">
            Regeln für künftige Quellen
          </h2>
          <p>
            Regeln sind standardmässig deaktiviert. Sie greifen nur bei künftig
            erzeugter {permittedSources}.
          </p>
        </div>
        <ShieldCheck aria-hidden="true" size={21} />
      </div>
      <p className="inventory__muted">
        Bestehende Reservationen werden hier weder angezeigt noch als Ausgabe
        verbraucht.
      </p>
      <SourceReservationRuleForm
        items={items}
        locations={locations}
        onChanged={onChanged}
        sourceReservationRules={sourceReservationRules}
        tenantId={tenantId}
      />
      {sourceReservationRules.rules.length ? (
        <ul className="inventory__list">
          {sourceReservationRules.rules.map((rule) => {
            const item = itemById.get(rule.itemId);
            const location = locationById.get(rule.locationId);
            return (
              <li key={rule.id}>
                <div>
                  <strong>{sourceLabel(rule)}</strong>
                  <small>
                    {rule.enabled ? "Aktiv" : "Deaktiviert"} ·{" "}
                    {item?.name ?? "Artikel nicht verfügbar"} ·{" "}
                    {location?.name ?? "Lagerort nicht verfügbar"} ·{" "}
                    {quantity(rule.quantity, item?.unit ?? "Einheiten")}
                  </small>
                </div>
                <SourceReservationRuleForm
                  items={items}
                  locations={locations}
                  onChanged={onChanged}
                  rule={rule}
                  sourceReservationRules={sourceReservationRules}
                  tenantId={tenantId}
                />
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyInventoryState text="Noch keine Regel für automatische Reservationen eingerichtet." />
      )}
    </section>
  );
}

function SourceReservationRuleForm({
  items,
  locations,
  onChanged,
  rule,
  sourceReservationRules,
  tenantId,
}: {
  items: readonly InventoryItemSummary[];
  locations: readonly InventoryLocation[];
  onChanged: InventoryChangedHandler;
  rule?: SourceReservationRule;
  sourceReservationRules: SourceReservationRules;
  tenantId: string;
}) {
  const availableSourceKinds = [
    ...(sourceReservationRules.canManageEventRules
      ? (["event_space_equipment"] as const)
      : []),
    ...(sourceReservationRules.canManageOnboardingRules
      ? (["onboarding_template_task"] as const)
      : []),
  ];
  const initialSourceKind = rule?.sourceKind ?? availableSourceKinds[0];
  const [sourceKind, setSourceKind] = useState<
    "event_space_equipment" | "onboarding_template_task"
  >(initialSourceKind ?? "event_space_equipment");
  const [equipmentKey, setEquipmentKey] =
    useState<SourceReservationEquipmentKey>(
      rule?.sourceKind === "event_space_equipment"
        ? rule.equipmentKey
        : SOURCE_RESERVATION_EQUIPMENT_OPTIONS[0].value,
    );
  const [templateTaskId, setTemplateTaskId] = useState(
    rule?.sourceKind === "onboarding_template_task"
      ? rule.templateTaskId
      : (sourceReservationRules.onboardingTemplateTasks[0]?.templateTaskId ??
          ""),
  );
  const [itemId, setItemId] = useState(rule?.itemId ?? "");
  const [locationId, setLocationId] = useState(rule?.locationId ?? "");
  const [amount, setAmount] = useState(rule ? String(rule.quantity) : "");
  const [enabled, setEnabled] = useState(rule?.enabled ?? false);
  const [saving, setSaving] = useState(false);
  const selectedSourceKind = availableSourceKinds.includes(sourceKind)
    ? sourceKind
    : availableSourceKinds[0];
  const selectedTemplateTask =
    sourceReservationRules.onboardingTemplateTasks.find(
      (task) => task.templateTaskId === templateTaskId,
    );
  const eligibleItems = items.filter(
    (item) => item.active && item.trackingMode === "quantity",
  );
  const activeLocations = locations.filter((location) => location.active);
  const amountNumber = Number(amount);
  const complete =
    selectedSourceKind !== undefined &&
    itemId.length > 0 &&
    locationId.length > 0 &&
    amount !== "" &&
    positiveThreeDecimalQuantity(amountNumber) !== null &&
    (selectedSourceKind === "event_space_equipment" ||
      selectedTemplateTask !== undefined);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!complete || saving || !selectedSourceKind) return;
    const values: SourceReservationRuleValues =
      selectedSourceKind === "event_space_equipment"
        ? {
            sourceKind: selectedSourceKind,
            equipmentKey,
            itemId,
            locationId,
            quantity: amountNumber,
            enabled,
          }
        : {
            sourceKind: selectedSourceKind,
            templateId: selectedTemplateTask!.templateId,
            templateTaskId: selectedTemplateTask!.templateTaskId,
            itemId,
            locationId,
            quantity: amountNumber,
            enabled,
          };
    setSaving(true);
    const saved = await onChanged(
      rule
        ? {
            type: "manageSourceReservationRule",
            tenantId,
            operation: "update",
            ruleId: rule.id,
            values,
          }
        : {
            type: "manageSourceReservationRule",
            tenantId,
            operation: "create",
            values,
          },
      rule
        ? "Die Regel für automatische Reservationen wurde aktualisiert."
        : "Die Regel für automatische Reservationen wurde angelegt und bleibt standardmässig deaktiviert.",
    );
    setSaving(false);
    if (saved && !rule) {
      setItemId("");
      setLocationId("");
      setAmount("");
      setEnabled(false);
    }
  };

  if (availableSourceKinds.length === 0) return null;
  return (
    <details className="inventory__form" open={!rule}>
      <summary>
        {rule ? "Einstellungen bearbeiten" : "Neue Regel anlegen"}
      </summary>
      <form onSubmit={(event) => void submit(event)}>
        {availableSourceKinds.length > 1 ? (
          <label>
            Regeltyp
            <select
              onChange={(event) => {
                const nextSourceKind = event.target.value as
                  "event_space_equipment" | "onboarding_template_task";
                setSourceKind(nextSourceKind);
              }}
              value={selectedSourceKind}
            >
              {sourceReservationRules.canManageEventRules ? (
                <option value="event_space_equipment">Raum-Ausstattung</option>
              ) : null}
              {sourceReservationRules.canManageOnboardingRules ? (
                <option value="onboarding_template_task">
                  Onboarding-Vorlagenaufgabe
                </option>
              ) : null}
            </select>
          </label>
        ) : null}
        {selectedSourceKind === "event_space_equipment" ? (
          <label>
            Raum-Ausstattung
            <select
              onChange={(event) =>
                setEquipmentKey(
                  event.target.value as SourceReservationEquipmentKey,
                )
              }
              value={equipmentKey}
            >
              {SOURCE_RESERVATION_EQUIPMENT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label>
            Onboarding-Vorlagenaufgabe
            <select
              onChange={(event) => setTemplateTaskId(event.target.value)}
              required
              value={templateTaskId}
            >
              <option value="">Vorlagenaufgabe wählen</option>
              {sourceReservationRules.onboardingTemplateTasks.map((task) => (
                <option key={task.templateTaskId} value={task.templateTaskId}>
                  {task.templateTitle} · {task.templateTaskTitle}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Artikel
          <select
            onChange={(event) => setItemId(event.target.value)}
            required
            value={itemId}
          >
            <option value="">Artikel wählen</option>
            {eligibleItems.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Lagerort
          <select
            onChange={(event) => setLocationId(event.target.value)}
            required
            value={locationId}
          >
            <option value="">Lagerort wählen</option>
            {activeLocations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Menge
          <input
            min="0.001"
            onChange={(event) => setAmount(event.target.value)}
            required
            step="0.001"
            type="number"
            value={amount}
          />
        </label>
        <label>
          <input
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
            type="checkbox"
          />
          Regel aktivieren
        </label>
        <button disabled={!complete || saving} type="submit">
          {saving
            ? "Regel wird gespeichert …"
            : rule
              ? "Regel aktualisieren"
              : "Regel speichern"}
        </button>
      </form>
    </details>
  );
}

function InventoryOpenReservationList({
  onChanged,
  reservations,
  tenantId,
}: {
  onChanged: InventoryChangedHandler;
  reservations: readonly OpenReservation[];
  tenantId: string;
}) {
  return reservations.length ? (
    <ul className="inventory__list">
      {reservations.map((reservation) => (
        <li key={reservation.id}>
          <div>
            <strong>{reservation.itemName}</strong>
            <small>
              {reservation.locationName} ·{" "}
              {quantity(reservation.quantity, "Stück")} · erstellt{" "}
              {dateTime(reservation.createdAt)}
            </small>
          </div>
          <InventoryReservationActions
            onChanged={onChanged}
            reservation={reservation}
            tenantId={tenantId}
          />
        </li>
      ))}
    </ul>
  ) : (
    <EmptyInventoryState text="Keine offenen Reservationen für deinen Mandanten." />
  );
}

function InventoryReservationActions({
  onChanged,
  reservation,
  tenantId,
}: {
  onChanged: InventoryChangedHandler;
  reservation: OpenReservation;
  tenantId: string;
}) {
  const releaseRequest = useClientRequestId(
    tenantId,
    `reservation-release:${reservation.id}`,
  );
  const consumeRequest = useClientRequestId(
    tenantId,
    `reservation-consume:${reservation.id}`,
  );
  const [consumeConfirmed, setConsumeConfirmed] = useState(false);
  const [saving, setSaving] = useState<"release" | "consume" | null>(null);

  const release = async () => {
    if (saving) return;
    setSaving("release");
    const receipt = await onChanged(
      {
        type: "releaseReservation",
        tenantId,
        reservationId: reservation.id,
        clientRequestId: releaseRequest.requestId(),
      },
      "Die Reservation wurde freigegeben und die Ansicht aktualisiert.",
    );
    setSaving(null);
    if (receipt) releaseRequest.discard();
  };

  const consume = async () => {
    if (!consumeConfirmed || saving) return;
    setSaving("consume");
    const receipt = await onChanged(
      {
        type: "postMovement",
        tenantId,
        movementType: "issue",
        reservationId: reservation.id,
        clientRequestId: consumeRequest.requestId(),
      },
      "Die Reservation wurde bewusst als Ausgabe verbraucht und die Ansicht aktualisiert.",
    );
    setSaving(null);
    if (receipt) {
      consumeRequest.discard();
      setConsumeConfirmed(false);
    }
  };

  return (
    <div>
      <button
        disabled={saving !== null}
        onClick={() => void release()}
        type="button"
      >
        {saving === "release" ? "Freigabe läuft …" : "Freigeben"}
      </button>
      <label>
        <input
          checked={consumeConfirmed}
          disabled={saving !== null}
          onChange={(event) => setConsumeConfirmed(event.target.checked)}
          type="checkbox"
        />
        Ausgabe bestätigen
      </label>
      <button
        disabled={!consumeConfirmed || saving !== null}
        onClick={() => void consume()}
        type="button"
      >
        {saving === "consume" ? "Ausgabe läuft …" : "Als Ausgabe verbrauchen"}
      </button>
    </div>
  );
}

function InventoryCounts({
  activeCountSessionCount,
  activeCounts,
  canClose,
  canManage,
  items,
  locations,
  onChanged,
  tenantId,
}: {
  activeCountSessionCount: number;
  activeCounts: readonly ActiveInventoryCount[];
  canClose: boolean;
  canManage: boolean;
  items: readonly InventoryItemSummary[];
  locations: readonly InventoryLocation[];
  onChanged: InventoryChangedHandler;
  tenantId: string;
}) {
  const [selectedCountId, setSelectedCountId] = useState("");
  const selectCount = (countId: string) => {
    setSelectedCountId(
      activeCounts.some((count) => count.id === countId) ? countId : "",
    );
  };

  return (
    <section className="inventory__panel panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">INVENTUR</span>
          <h2>Bestand bewusst abgleichen</h2>
          <p>
            Gezählte Mengen überschreiben nie direkt den Bestand. Erst ein
            bewusster Abschluss erzeugt dokumentierte Differenzbuchungen.
          </p>
        </div>
        <ClipboardList aria-hidden="true" size={21} />
      </div>
      <p className="inventory__statement">
        <strong>{activeCountSessionCount}</strong> laufende Inventuren
      </p>
      <p className="inventory__muted">
        {canClose
          ? "Du darfst Inventuren abschliessen. Differenzen werden dabei unter Sperre geprüft und als eigene Bewegungen gebucht."
          : "Das Abschliessen einer Inventur benötigt eine gesonderte Berechtigung."}
      </p>
      {canManage || canClose ? (
        <InventoryActiveCountList
          counts={activeCounts}
          onSelectCount={selectCount}
          selectedCountId={selectedCountId}
        />
      ) : null}
      {canManage ? (
        <>
          <InventoryCountStartForm
            locations={locations}
            onChanged={onChanged}
            onStarted={selectCount}
            tenantId={tenantId}
          />
          <InventoryCountLineForm
            activeCounts={activeCounts}
            items={items}
            onChanged={onChanged}
            onSelectCount={selectCount}
            selectedCountId={selectedCountId}
            tenantId={tenantId}
          />
        </>
      ) : null}
      {canClose ? (
        <InventoryCountCloseForm
          activeCounts={activeCounts}
          onChanged={onChanged}
          onSelectCount={selectCount}
          selectedCountId={selectedCountId}
          tenantId={tenantId}
        />
      ) : null}
    </section>
  );
}

function InventoryActiveCountList({
  counts,
  onSelectCount,
  selectedCountId,
}: {
  counts: readonly ActiveInventoryCount[];
  onSelectCount: (countId: string) => void;
  selectedCountId: string;
}) {
  return counts.length ? (
    <ul className="inventory__list">
      {counts.map((count) => (
        <li key={count.id}>
          <div>
            <strong>{count.locationName}</strong>
            <small>
              {count.status === "counting" ? "In Zählung" : "Entwurf"} ·
              gestartet {dateTime(count.startedAt)}
            </small>
          </div>
          <button
            aria-pressed={selectedCountId === count.id}
            onClick={() => onSelectCount(count.id)}
            type="button"
          >
            {selectedCountId === count.id ? "Ausgewählt" : "Auswählen"}
          </button>
        </li>
      ))}
    </ul>
  ) : (
    <EmptyInventoryState text="Keine aktiven Inventuren." />
  );
}

function InventoryLocationCreateForm({
  onChanged,
  tenantId,
}: {
  onChanged: InventoryChangedHandler;
  tenantId: string;
}) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const clientRequest = useClientRequestId(tenantId, "location-create");
  const complete = code.trim().length > 0 && name.trim().length > 0;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!complete || saving) return;
    setSaving(true);
    const saved = await onChanged(
      {
        type: "manageLocation",
        tenantId,
        operation: "create",
        values: { code, name },
        clientRequestId: clientRequest.requestId(),
      },
      "Der Lagerort wurde erfasst und die Ansicht aktualisiert.",
    );
    setSaving(false);
    if (saved) {
      clientRequest.discard();
      setCode("");
      setName("");
    }
  };

  return (
    <details className="inventory__form">
      <summary>Lagerort erfassen</summary>
      <form
        onChange={clientRequest.discard}
        onSubmit={(event) => void submit(event)}
      >
        <FormGrid cols={2}>
          <FormField label="Ortscode" required>
            <input
              autoComplete="off"
              onChange={(event) => setCode(event.target.value)}
              required
              value={code}
            />
          </FormField>
          <FormField label="Bezeichnung" required>
            <input
              autoComplete="off"
              onChange={(event) => setName(event.target.value)}
              required
              value={name}
            />
          </FormField>
        </FormGrid>
        <button disabled={!complete || saving} type="submit">
          {saving ? "Lagerort wird erfasst …" : "Lagerort erfassen"}
        </button>
      </form>
    </details>
  );
}

function InventoryItemDepartmentSelect({
  departments,
  item,
  onChanged,
  tenantId,
}: {
  departments: readonly InventoryDepartment[];
  item: InventoryItemSummary;
  onChanged: InventoryChangedHandler;
  tenantId: string;
}) {
  const [saving, setSaving] = useState(false);
  const clientRequest = useClientRequestId(
    tenantId,
    `item-department-${item.id}`,
  );
  const current = item.departmentId ?? "";
  const known = departments.some((department) => department.id === current);

  const change = async (departmentId: string) => {
    if (saving || departmentId === "" || departmentId === current) return;
    // Jede neue Wahl ist ein eigener Auftrag.
    clientRequest.discard();
    setSaving(true);
    const saved = await onChanged(
      {
        type: "manageItem",
        tenantId,
        operation: "update",
        itemId: item.id,
        values: { departmentId },
        clientRequestId: clientRequest.requestId(),
      },
      `Die Abteilung von «${item.name}» wurde geändert.`,
    );
    setSaving(false);
    if (saved) clientRequest.discard();
  };

  return (
    <select
      aria-label={`Abteilung von ${item.name}`}
      disabled={saving}
      onChange={(event) => void change(event.target.value)}
      value={current}
    >
      {!known ? (
        <option disabled value={current}>
          {current ? "Andere Abteilung" : "Alle Abteilungen"}
        </option>
      ) : null}
      {departments.map((department) => (
        <option key={department.id} value={department.id}>
          {department.name}
        </option>
      ))}
    </select>
  );
}

function InventoryMovementForm({
  canAdjust,
  canMove,
  items,
  locations,
  onChanged,
  tenantId,
}: {
  canAdjust: boolean;
  canMove: boolean;
  items: readonly InventoryItemSummary[];
  locations: readonly InventoryLocation[];
  onChanged: InventoryChangedHandler;
  tenantId: string;
}) {
  const options = [
    ...(canMove
      ? [
          { value: "receipt" as const, label: "Wareneingang" },
          { value: "issue" as const, label: "Ausgabe" },
          { value: "transfer" as const, label: "Umlagerung" },
        ]
      : []),
    ...(canAdjust
      ? [
          { value: "defect" as const, label: "Defekt" },
          { value: "loss" as const, label: "Verlust" },
          { value: "adjustment_in" as const, label: "Korrektur Zugang" },
          { value: "adjustment_out" as const, label: "Korrektur Abgang" },
        ]
      : []),
  ];
  const [movementType, setMovementType] = useState<InventoryMovementType>(
    options[0]?.value ?? "receipt",
  );
  const [itemId, setItemId] = useState("");
  const [fromLocationId, setFromLocationId] = useState("");
  const [toLocationId, setToLocationId] = useState("");
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const clientRequest = useClientRequestId(tenantId, "movement");
  const selectedType = options.some((option) => option.value === movementType)
    ? movementType
    : options[0]!.value;
  const requiresFrom =
    selectedType === "issue" ||
    selectedType === "transfer" ||
    selectedType === "defect" ||
    selectedType === "loss" ||
    selectedType === "adjustment_out";
  const requiresTo =
    selectedType === "receipt" ||
    selectedType === "transfer" ||
    selectedType === "adjustment_in";
  const amountNumber = Number(amount);
  const complete =
    itemId.length > 0 &&
    amount !== "" &&
    Number.isFinite(amountNumber) &&
    amountNumber > 0 &&
    (!requiresFrom || fromLocationId.length > 0) &&
    (!requiresTo || toLocationId.length > 0);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!complete || saving) return;
    setSaving(true);
    const saved = await onChanged(
      {
        type: "postMovement",
        tenantId,
        itemId,
        movementType: selectedType,
        quantity: amountNumber,
        ...(requiresFrom ? { fromLocationId } : {}),
        ...(requiresTo ? { toLocationId } : {}),
        clientRequestId: clientRequest.requestId(),
      },
      "Die Buchung wurde gespeichert und die Ansicht aktualisiert.",
    );
    setSaving(false);
    if (saved) {
      clientRequest.discard();
      setItemId("");
      setFromLocationId("");
      setToLocationId("");
      setAmount("");
    }
  };

  return (
    <details className="inventory__form">
      <summary>Bestandsbewegung buchen</summary>
      <form
        onChange={clientRequest.discard}
        onSubmit={(event) => void submit(event)}
      >
        <FormGrid cols={2}>
          <FormField label="Buchungsart">
            <select
              onChange={(event) =>
                setMovementType(event.target.value as InventoryMovementType)
              }
              value={selectedType}
            >
              {options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Artikel" required>
            <select
              onChange={(event) => setItemId(event.target.value)}
              required
              value={itemId}
            >
              <option value="">Artikel wählen</option>
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </FormField>
          {requiresFrom ? (
            <FormField label="Quelllagerort" required>
              <select
                onChange={(event) => setFromLocationId(event.target.value)}
                required
                value={fromLocationId}
              >
                <option value="">Lagerort wählen</option>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
            </FormField>
          ) : null}
          {requiresTo ? (
            <FormField label="Ziellagerort" required>
              <select
                onChange={(event) => setToLocationId(event.target.value)}
                required
                value={toLocationId}
              >
                <option value="">Lagerort wählen</option>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
            </FormField>
          ) : null}
          <FormField label="Menge" required>
            <input
              min="0.001"
              onChange={(event) => setAmount(event.target.value)}
              required
              step="0.001"
              type="number"
              value={amount}
            />
          </FormField>
        </FormGrid>
        <button disabled={!complete || saving} type="submit">
          {saving ? "Buchung wird gespeichert …" : "Buchung speichern"}
        </button>
      </form>
    </details>
  );
}

function InventoryReservationForm({
  items,
  locations,
  onChanged,
  tenantId,
}: {
  items: readonly InventoryItemSummary[];
  locations: readonly InventoryLocation[];
  onChanged: InventoryChangedHandler;
  tenantId: string;
}) {
  const [itemId, setItemId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const clientRequest = useClientRequestId(tenantId, "reservation-create");
  const amountNumber = Number(amount);
  const complete =
    itemId.length > 0 &&
    locationId.length > 0 &&
    amount !== "" &&
    Number.isFinite(amountNumber) &&
    amountNumber > 0;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!complete || saving) return;
    setSaving(true);
    const saved = await onChanged(
      {
        type: "reserve",
        tenantId,
        itemId,
        locationId,
        quantity: amountNumber,
        clientRequestId: clientRequest.requestId(),
      },
      "Die Reservation wurde gespeichert und die Ansicht aktualisiert.",
    );
    setSaving(false);
    if (saved) {
      clientRequest.discard();
      setItemId("");
      setLocationId("");
      setAmount("");
    }
  };

  return (
    <details className="inventory__form">
      <summary>Reservation anlegen</summary>
      <form
        onChange={clientRequest.discard}
        onSubmit={(event) => void submit(event)}
      >
        <FormGrid cols={2}>
          <FormField label="Artikel" required>
            <select
              onChange={(event) => setItemId(event.target.value)}
              required
              value={itemId}
            >
              <option value="">Artikel wählen</option>
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Lagerort" required>
            <select
              onChange={(event) => setLocationId(event.target.value)}
              required
              value={locationId}
            >
              <option value="">Lagerort wählen</option>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Menge" required>
            <input
              min="0.001"
              onChange={(event) => setAmount(event.target.value)}
              required
              step="0.001"
              type="number"
              value={amount}
            />
          </FormField>
        </FormGrid>
        <button disabled={!complete || saving} type="submit">
          {saving ? "Reservation wird gespeichert …" : "Reservation speichern"}
        </button>
      </form>
    </details>
  );
}

function InventoryCountStartForm({
  locations,
  onChanged,
  onStarted,
  tenantId,
}: {
  locations: readonly InventoryLocation[];
  onChanged: InventoryChangedHandler;
  onStarted: (countId: string) => void;
  tenantId: string;
}) {
  const [locationId, setLocationId] = useState("");
  const [saving, setSaving] = useState(false);
  const [startedCountId, setStartedCountId] = useState<string | null>(null);
  const clientRequest = useClientRequestId(tenantId, "count-start");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!locationId || saving) return;
    setSaving(true);
    const saved = await onChanged(
      {
        type: "startCount",
        tenantId,
        locationId,
        clientRequestId: clientRequest.requestId(),
      },
      "Die Inventur wurde gestartet und die Ansicht aktualisiert.",
    );
    setSaving(false);
    if (saved) {
      clientRequest.discard();
      setStartedCountId(saved.id);
      onStarted(saved.id);
      setLocationId("");
    }
  };

  return (
    <details className="inventory__form">
      <summary>Inventur starten</summary>
      <form
        onChange={clientRequest.discard}
        onSubmit={(event) => void submit(event)}
      >
        <label>
          Lagerort
          <select
            onChange={(event) => setLocationId(event.target.value)}
            required
            value={locationId}
          >
            <option value="">Lagerort wählen</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
        </label>
        <button disabled={!locationId || saving} type="submit">
          {saving ? "Inventur wird gestartet …" : "Inventur starten"}
        </button>
      </form>
      {startedCountId ? (
        <p role="status">
          Inventur gestartet. Count-ID: <code>{startedCountId}</code>
        </p>
      ) : null}
    </details>
  );
}

function InventoryCountLineForm({
  activeCounts,
  items,
  onChanged,
  onSelectCount,
  selectedCountId,
  tenantId,
}: {
  activeCounts: readonly ActiveInventoryCount[];
  items: readonly InventoryItemSummary[];
  onChanged: InventoryChangedHandler;
  onSelectCount: (countId: string) => void;
  selectedCountId: string;
  tenantId: string;
}) {
  const [itemId, setItemId] = useState("");
  const [countedQuantity, setCountedQuantity] = useState("");
  const [saving, setSaving] = useState(false);
  const clientRequest = useClientRequestId(
    tenantId,
    `count-line:${selectedCountId || "unselected"}:${itemId || "unselected"}`,
  );
  const countedQuantityNumber = Number(countedQuantity);
  const complete =
    selectedCountId.length > 0 &&
    itemId.length > 0 &&
    countedQuantity !== "" &&
    Number.isFinite(countedQuantityNumber) &&
    countedQuantityNumber >= 0;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!complete || saving) return;
    setSaving(true);
    const saved = await onChanged(
      {
        type: "recordCountLine",
        tenantId,
        countId: selectedCountId,
        itemId,
        countedQuantity: countedQuantityNumber,
        clientRequestId: clientRequest.requestId(),
      },
      "Die Zähllinie wurde gespeichert und die Ansicht aktualisiert.",
    );
    setSaving(false);
    if (saved) {
      clientRequest.discard();
      setItemId("");
      setCountedQuantity("");
    }
  };

  return (
    <details className="inventory__form">
      <summary>Zähllinie erfassen</summary>
      <form
        onChange={clientRequest.discard}
        onSubmit={(event) => void submit(event)}
      >
        <label>
          Aktive Inventur
          <select
            onChange={(event) => onSelectCount(event.target.value)}
            required
            value={selectedCountId}
          >
            <option value="">Inventur wählen</option>
            {activeCounts.map((count) => (
              <option key={count.id} value={count.id}>
                {count.locationName} · {dateTime(count.startedAt)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Artikel
          <select
            onChange={(event) => setItemId(event.target.value)}
            required
            value={itemId}
          >
            <option value="">Artikel wählen</option>
            {items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Gezählte Menge
          <input
            min="0"
            onChange={(event) => setCountedQuantity(event.target.value)}
            required
            step="0.001"
            type="number"
            value={countedQuantity}
          />
        </label>
        <button disabled={!complete || saving} type="submit">
          {saving ? "Zähllinie wird gespeichert …" : "Zähllinie speichern"}
        </button>
      </form>
    </details>
  );
}

function InventoryCountCloseForm({
  activeCounts,
  onChanged,
  onSelectCount,
  selectedCountId,
  tenantId,
}: {
  activeCounts: readonly ActiveInventoryCount[];
  onChanged: InventoryChangedHandler;
  onSelectCount: (countId: string) => void;
  selectedCountId: string;
  tenantId: string;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const clientRequest = useClientRequestId(
    tenantId,
    `count-close:${selectedCountId || "unselected"}`,
  );
  const complete = selectedCountId.length > 0 && confirmed;

  const selectCount = (countId: string) => {
    clientRequest.discard();
    setConfirmed(false);
    onSelectCount(countId);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!complete || saving) return;
    setSaving(true);
    const saved = await onChanged(
      {
        type: "closeCount",
        tenantId,
        countId: selectedCountId,
        clientRequestId: clientRequest.requestId(),
      },
      "Die Inventur wurde abgeschlossen und die Ansicht aktualisiert.",
    );
    setSaving(false);
    if (saved) {
      clientRequest.discard();
      onSelectCount("");
      setConfirmed(false);
    }
  };

  return (
    <details className="inventory__form">
      <summary>Inventur abschliessen</summary>
      <form onSubmit={(event) => void submit(event)}>
        <label>
          Aktive Inventur
          <select
            onChange={(event) => selectCount(event.target.value)}
            required
            value={selectedCountId}
          >
            <option value="">Inventur wählen</option>
            {activeCounts.map((count) => (
              <option key={count.id} value={count.id}>
                {count.locationName} · {dateTime(count.startedAt)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <input
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
            type="checkbox"
          />
          Ich bestätige den bewussten Abschluss dieser Inventur.
        </label>
        <button disabled={!complete || saving} type="submit">
          {saving ? "Inventur wird abgeschlossen …" : "Inventur abschliessen"}
        </button>
      </form>
    </details>
  );
}

function EmptyInventoryState({ text }: { text: string }) {
  return <p className="inventory__empty">{text}</p>;
}
