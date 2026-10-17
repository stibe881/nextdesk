import { invokeNextDesk } from "@/lib/nextdesk-client";

type RecordValue = Record<string, unknown>;

export type MobileAsset = {
  id: string;
  name: string;
  assetTag: string | null;
  inventoryNumber: string | null;
  serialNumber: string | null;
  manufacturer: string | null;
  model: string | null;
  operatingSystem: string | null;
  kind: string;
  status: string;
  lifecycleState: string;
  active: boolean;
  complianceState: string | null;
  encrypted: boolean | null;
  lastSeenAt: string | null;
  updatedAt: string;
};

export type MobileAssetDetail = {
  asset: MobileAsset;
  location: { id: string; name: string } | null;
  integration: RecordValue | null;
  lifecycle: Array<{
    id: string;
    previous_state: string | null;
    next_state: string;
    occurred_at: string;
  }>;
};

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nullableText(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function parseAsset(value: unknown): MobileAsset {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.name !== "string"
  ) {
    throw new Error("Die Assetdaten sind unvollständig.");
  }
  const kind = value.kind;
  const status = value.status;
  const lifecycleState = value.lifecycle_state;
  const updatedAt = value.updated_at;
  if (
    typeof kind !== "string" ||
    typeof status !== "string" ||
    typeof lifecycleState !== "string" ||
    typeof updatedAt !== "string" ||
    typeof value.active !== "boolean"
  ) {
    throw new Error("Die Assetdaten sind unvollständig.");
  }
  return {
    id: value.id,
    name: value.name,
    assetTag: nullableText(value.asset_tag),
    inventoryNumber: nullableText(value.inventory_number),
    serialNumber: nullableText(value.serial_number),
    manufacturer: nullableText(value.manufacturer),
    model: nullableText(value.model),
    operatingSystem: nullableText(value.operating_system),
    kind,
    status,
    lifecycleState,
    active: value.active,
    complianceState: nullableText(value.intune_compliance_state),
    encrypted:
      typeof value.intune_encrypted === "boolean"
        ? value.intune_encrypted
        : null,
    lastSeenAt: nullableText(value.intune_last_seen_at),
    updatedAt,
  };
}

function dataFromEnvelope(value: unknown): RecordValue {
  if (!isRecord(value) || !isRecord(value.data)) {
    throw new Error("Die Assetantwort ist unvollständig.");
  }
  return value.data;
}

function parseDetail(value: unknown): MobileAssetDetail {
  const data = dataFromEnvelope(value);
  const asset = parseAsset(data.asset);
  const location =
    isRecord(data.location) &&
    typeof data.location.id === "string" &&
    typeof data.location.name === "string"
      ? { id: data.location.id, name: data.location.name }
      : null;
  const lifecycle = Array.isArray(data.lifecycle)
    ? data.lifecycle.flatMap((entry) =>
        isRecord(entry) &&
        typeof entry.id === "string" &&
        typeof entry.next_state === "string" &&
        typeof entry.occurred_at === "string"
          ? [
              {
                id: entry.id,
                previous_state: nullableText(entry.previous_state),
                next_state: entry.next_state,
                occurred_at: entry.occurred_at,
              },
            ]
          : [],
      )
    : [];
  return {
    asset,
    location,
    integration: isRecord(data.integration) ? data.integration : null,
    lifecycle,
  };
}

export async function listMobileAssets(
  tenantId: string,
  query = "",
): Promise<MobileAsset[]> {
  const data = dataFromEnvelope(
    await invokeNextDesk<unknown>("asset-registry", {
      type: "listAssets",
      tenantId,
      query,
    }),
  );
  if (!Array.isArray(data.assets))
    throw new Error("Die Assetliste ist unvollständig.");
  return data.assets.map(parseAsset);
}

export async function getMobileAsset(
  tenantId: string,
  assetId: string,
): Promise<MobileAssetDetail> {
  return parseDetail(
    await invokeNextDesk<unknown>("asset-registry", {
      type: "getAsset",
      tenantId,
      assetId,
    }),
  );
}

export async function lookupMobileAsset(
  tenantId: string,
  code: string,
): Promise<MobileAssetDetail> {
  return parseDetail(
    await invokeNextDesk<unknown>("asset-registry", {
      type: "lookupAsset",
      tenantId,
      code,
    }),
  );
}

export async function transitionMobileAssetLifecycle(
  tenantId: string,
  assetId: string,
  lifecycleState:
    | "ordered"
    | "stock"
    | "active"
    | "repair"
    | "retired"
    | "disposed",
): Promise<MobileAsset> {
  const data = dataFromEnvelope(
    await invokeNextDesk<unknown>("asset-registry", {
      type: "transitionLifecycle",
      tenantId,
      assetId,
      lifecycleState,
    }),
  );
  return parseAsset(data.asset);
}
