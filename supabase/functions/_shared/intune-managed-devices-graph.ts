const TOKEN_SCOPE = "https://graph.microsoft.com/.default";
const GRAPH_ORIGIN = "https://graph.microsoft.com";
const GRAPH_PATH = "/v1.0/deviceManagement/managedDevices";
const MAX_PAGES = 100;
const PAGE_SIZE = 100;
const REQUEST_TIMEOUT_MS = 15_000;

const COMPLIANCE_STATES = new Set([
  "unknown",
  "compliant",
  "noncompliant",
  "conflict",
  "error",
  "inGracePeriod",
  "configManager",
]);

const SELECT_FIELDS = [
  "id",
  "userId",
  "deviceName",
  "serialNumber",
  "manufacturer",
  "model",
  "operatingSystem",
  "osVersion",
  "complianceState",
  "isEncrypted",
  "lastSyncDateTime",
  "enrolledDateTime",
] as const;
const SELECT_QUERY_VALUE = SELECT_FIELDS.join(",");
// Netzwerkdaten nur für die IP-Adressverwaltung (MAC-Abgleich). Der reine
// Asset-Abgleich liest sie nie; ein gemeinsamer Abruf für beide Zwecke fragt
// sie zusätzlich ab (includeNetwork).
const NETWORK_FIELDS = [
  "wiFiMacAddress",
  "ethernetMacAddress",
  "userPrincipalName",
  "managementState",
] as const;
const NETWORK_SELECT_QUERY_VALUE = [...SELECT_FIELDS, ...NETWORK_FIELDS].join(
  ",",
);
const CONTINUATION_QUERY_KEYS = new Set(["$skiptoken", "$top", "$select"]);

export type IntuneManagedDevice = {
  external_device_id: string;
  primary_user_object_id: string | null;
  device_name: string | null;
  serial_number: string | null;
  manufacturer: string | null;
  model: string | null;
  operating_system: string | null;
  os_version: string | null;
  compliance_state: string | null;
  is_encrypted: boolean | null;
  last_sync_at: string | null;
  enrolled_at: string | null;
  /** Nur bei includeNetwork: Netzwerkdaten für die IP-Adressverwaltung. */
  network?: IntuneDeviceNetwork;
};

export type IntuneDeviceNetwork = {
  wifi_mac: string | null;
  ethernet_mac: string | null;
  user_principal_name: string | null;
  management_state: string | null;
};

export type ReadIntuneManagedDevicesOptions = {
  /** Zusätzlich MAC-Adressen, UPN und Verwaltungsstatus lesen (IPAM). */
  includeNetwork?: boolean;
};

export type IntuneGraphCredentials = {
  clientId: string;
  clientSecret: string;
};

export type FetchLike = typeof fetch;

export class IntuneGraphError extends Error {
  constructor(
    readonly code:
      | "provider_not_configured"
      | "provider_unavailable"
      | "provider_rate_limited"
      | "provider_payload_invalid",
  ) {
    super(code);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyEnv(value: string | undefined): string | null {
  if (!value || value.includes("\u0000") || !value.trim()) return null;
  return value.trim();
}

export function readIntuneGraphCredentials(
  environment: Record<string, string | undefined> = {
    INTUNE_MANAGED_DEVICES_CLIENT_ID: Deno.env.get(
      "INTUNE_MANAGED_DEVICES_CLIENT_ID",
    ),
    INTUNE_MANAGED_DEVICES_CLIENT_SECRET: Deno.env.get(
      "INTUNE_MANAGED_DEVICES_CLIENT_SECRET",
    ),
  },
): IntuneGraphCredentials | null {
  const clientId = nonEmptyEnv(environment.INTUNE_MANAGED_DEVICES_CLIENT_ID);
  const clientSecret = nonEmptyEnv(
    environment.INTUNE_MANAGED_DEVICES_CLIENT_SECRET,
  );
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

function validTenantId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  fetchImpl: FetchLike,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetchImpl(input, { ...init, signal: controller.signal });
  } catch {
    throw new IntuneGraphError("provider_unavailable");
  } finally {
    clearTimeout(timer);
  }
}

function optionalText(value: unknown, maximum: number): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || !value.isWellFormed()) {
    throw new IntuneGraphError("provider_payload_invalid");
  }
  const normalized = value.trim();
  if (!normalized) return null;
  if (
    Array.from(normalized).length > maximum ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    throw new IntuneGraphError("provider_payload_invalid");
  }
  return normalized;
}

function optionalTimestamp(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || !value.trim()) {
    throw new IntuneGraphError("provider_payload_invalid");
  }
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    throw new IntuneGraphError("provider_payload_invalid");
  }
  return new Date(timestamp).toISOString();
}

function optionalPrimaryUserObjectId(value: unknown): string | null {
  // `userId` is the Entra object ID documented on a managedDevice. It is the
  // only person-related Graph field permitted here. An unrecognised optional
  // value must never prevent a technical inventory sync, nor become a fallback
  // identity such as a UPN or e-mail address.
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || !value.isWellFormed()) return null;
  const normalized = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    normalized,
  )
    ? normalized.toLowerCase()
    : null;
}

/** «AABBCCDDEEFF», «aa-bb-…», «aa:bb:…» → «aa:bb:cc:dd:ee:ff» oder null. */
export function normalizeMacAddress(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const hex = value.replace(/[\s:.-]/g, "").toLowerCase();
  if (!/^[0-9a-f]{12}$/.test(hex)) return null;
  if (hex === "000000000000" || hex === "ffffffffffff") return null;
  return hex.match(/.{2}/g)!.join(":");
}

function lenientText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || /[\u0000-\u001f\u007f]/.test(trimmed)) return null;
  return Array.from(trimmed).slice(0, max).join("");
}

// Netzwerkfelder sind optional: ein unbekannter Wert verhindert den Abgleich
// nie, er wird einfach nicht übernommen.
function parseNetwork(value: Record<string, unknown>): IntuneDeviceNetwork {
  return {
    wifi_mac: normalizeMacAddress(value.wiFiMacAddress),
    ethernet_mac: normalizeMacAddress(value.ethernetMacAddress),
    user_principal_name: lenientText(value.userPrincipalName, 320),
    management_state: lenientText(value.managementState, 40),
  };
}

function parseDevice(value: unknown): IntuneManagedDevice {
  if (!isRecord(value)) throw new IntuneGraphError("provider_payload_invalid");
  const externalDeviceId = optionalText(value.id, 200);
  if (!externalDeviceId) throw new IntuneGraphError("provider_payload_invalid");
  const complianceState = optionalText(value.complianceState, 32);
  if (complianceState && !COMPLIANCE_STATES.has(complianceState)) {
    throw new IntuneGraphError("provider_payload_invalid");
  }
  if (
    value.isEncrypted !== null &&
    value.isEncrypted !== undefined &&
    typeof value.isEncrypted !== "boolean"
  ) {
    throw new IntuneGraphError("provider_payload_invalid");
  }
  return {
    external_device_id: externalDeviceId.toLowerCase(),
    primary_user_object_id: optionalPrimaryUserObjectId(value.userId),
    device_name: optionalText(value.deviceName, 240),
    serial_number: optionalText(value.serialNumber, 160),
    manufacturer: optionalText(value.manufacturer, 160),
    model: optionalText(value.model, 160),
    operating_system: optionalText(value.operatingSystem, 120),
    os_version: optionalText(value.osVersion, 120),
    compliance_state: complianceState,
    is_encrypted:
      typeof value.isEncrypted === "boolean" ? value.isEncrypted : null,
    last_sync_at: optionalTimestamp(value.lastSyncDateTime),
    enrolled_at: optionalTimestamp(value.enrolledDateTime),
  };
}

function initialGraphUrl(select: string): URL {
  const url = new URL(`${GRAPH_ORIGIN}${GRAPH_PATH}`);
  url.searchParams.set("$select", select);
  url.searchParams.set("$top", String(PAGE_SIZE));
  return url;
}

function validateNextLink(value: unknown, select: string): URL | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || value.length > 8_192) {
    throw new IntuneGraphError("provider_payload_invalid");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new IntuneGraphError("provider_payload_invalid");
  }
  const skipTokens = url.searchParams.getAll("$skiptoken");
  const pageSizes = url.searchParams.getAll("$top");
  const selectValues = url.searchParams.getAll("$select");
  if (
    url.protocol !== "https:" ||
    url.origin !== GRAPH_ORIGIN ||
    url.pathname !== GRAPH_PATH ||
    [...url.searchParams.keys()].some(
      (key) => !CONTINUATION_QUERY_KEYS.has(key),
    ) ||
    skipTokens.length !== 1 ||
    !skipTokens[0].trim() ||
    pageSizes.length !== 1 ||
    !/^\d+$/.test(pageSizes[0]) ||
    Number(pageSizes[0]) < 1 ||
    Number(pageSizes[0]) > PAGE_SIZE ||
    selectValues.length !== 1 ||
    selectValues[0] !== select
  ) {
    throw new IntuneGraphError("provider_payload_invalid");
  }
  return url;
}

export async function requestIntuneGraphAccessToken(
  tenantId: string,
  credentials: IntuneGraphCredentials,
  fetchImpl: FetchLike = fetch,
): Promise<string> {
  if (!validTenantId(tenantId)) {
    throw new IntuneGraphError("provider_payload_invalid");
  }
  const body = new URLSearchParams({
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    grant_type: "client_credentials",
    scope: TOKEN_SCOPE,
  });
  const response = await fetchWithTimeout(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      redirect: "error",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    },
    fetchImpl,
  );
  if (!response.ok) throw new IntuneGraphError("provider_unavailable");
  const payload: unknown = await response.json().catch(() => null);
  if (!isRecord(payload) || typeof payload.access_token !== "string") {
    throw new IntuneGraphError("provider_payload_invalid");
  }
  const token = payload.access_token.trim();
  if (!token || token.length > 16_384 || /[\u0000-\u001f\u007f]/.test(token)) {
    throw new IntuneGraphError("provider_payload_invalid");
  }
  return token;
}

/**
 * Liest alle verwalteten Geräte seitenweise. Gemeinsamer Abruf für den
 * Asset-Abgleich und (mit includeNetwork) den MAC-Abgleich der
 * IP-Adressverwaltung, damit Graph pro Lauf nur einmal abgefragt wird.
 */
export async function readIntuneManagedDevices(
  accessToken: string,
  onPage: (devices: IntuneManagedDevice[]) => Promise<void>,
  fetchImpl: FetchLike = fetch,
  beforePage?: () => Promise<void>,
  options: ReadIntuneManagedDevicesOptions = {},
): Promise<number> {
  const select = options.includeNetwork
    ? NETWORK_SELECT_QUERY_VALUE
    : SELECT_QUERY_VALUE;
  let url: URL | null = initialGraphUrl(select);
  let pages = 0;
  let total = 0;
  const seenIds = new Set<string>();
  while (url) {
    pages += 1;
    if (pages > MAX_PAGES) {
      throw new IntuneGraphError("provider_payload_invalid");
    }
    if (beforePage) await beforePage();
    const response = await fetchWithTimeout(
      url,
      {
        method: "GET",
        redirect: "error",
        headers: { Authorization: `Bearer ${accessToken}` },
      },
      fetchImpl,
    );
    if (response.status === 429) {
      throw new IntuneGraphError("provider_rate_limited");
    }
    if (!response.ok) throw new IntuneGraphError("provider_unavailable");
    const payload: unknown = await response.json().catch(() => null);
    if (!isRecord(payload) || !Array.isArray(payload.value)) {
      throw new IntuneGraphError("provider_payload_invalid");
    }
    if (payload.value.length > PAGE_SIZE) {
      throw new IntuneGraphError("provider_payload_invalid");
    }
    const devices = payload.value.map((entry: unknown) => {
      const device = parseDevice(entry);
      return options.includeNetwork && isRecord(entry)
        ? { ...device, network: parseNetwork(entry) }
        : device;
    });
    for (const device of devices) {
      if (seenIds.has(device.external_device_id)) {
        throw new IntuneGraphError("provider_payload_invalid");
      }
      seenIds.add(device.external_device_id);
    }
    await onPage(devices);
    total += devices.length;
    url = validateNextLink(payload["@odata.nextLink"], select);
  }
  return total;
}

export const INTUNE_MANAGED_DEVICE_SELECT = SELECT_FIELDS;
export const INTUNE_MANAGED_DEVICE_NETWORK_SELECT = NETWORK_FIELDS;

/** Gerät ohne Netzwerkdaten (für das Staging des Asset-Abgleichs). */
export function withoutNetwork(
  device: IntuneManagedDevice,
): IntuneManagedDevice {
  const { network: _network, ...asset } = device;
  return asset;
}
