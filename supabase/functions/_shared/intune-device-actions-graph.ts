// Remote actions on Intune managed devices (Microsoft Graph).
//
// The same multi-tenant Entra app as the read-only device sync is used
// (INTUNE_MANAGED_DEVICES_CLIENT_ID / _SECRET, client credentials against the
// customer's Entra tenant). Remote actions additionally need the application
// permission DeviceManagementManagedDevices.PrivilegedOperations.All with
// admin consent in the customer tenant.
//
// Endpoints (all POST, no response body on success, 204):
//   v1.0  /deviceManagement/managedDevices/{id}/syncDevice
//   v1.0  /deviceManagement/managedDevices/{id}/rebootNow
//   v1.0  /deviceManagement/managedDevices/{id}/remoteLock
//   v1.0  /deviceManagement/managedDevices/{id}/resetPasscode
//   v1.0  /deviceManagement/managedDevices/{id}/windowsDefenderScan
//         body {"quickScan": true}
//   beta  /deviceManagement/managedDevices/{id}/rotateLocalAdminPassword
//         (Windows LAPS; only available in the beta endpoint)

import { msg } from "./formality.ts";
import type {
  FetchLike,
  IntuneGraphCredentials,
} from "./intune-managed-devices-graph.ts";

export const INTUNE_PRIVILEGED_OPERATIONS_PERMISSION =
  "DeviceManagementManagedDevices.PrivilegedOperations.All";

export const INTUNE_MISSING_PERMISSION_MESSAGE =
  "In Entra fehlt die Berechtigung DeviceManagementManagedDevices.PrivilegedOperations.All.";

const GRAPH_ORIGIN = "https://graph.microsoft.com";
const TOKEN_SCOPE = "https://graph.microsoft.com/.default";
const REQUEST_TIMEOUT_MS = 15_000;
const GUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const INTUNE_DEVICE_ACTIONS = [
  "syncDevice",
  "rebootNow",
  "remoteLock",
  "resetPasscode",
  "rotateLocalAdminPassword",
  "windowsDefenderScan",
] as const;

export type IntuneDeviceAction = (typeof INTUNE_DEVICE_ACTIONS)[number];

export type IntunePlatform = "windows" | "ios" | "macos" | "android" | "other";

/** Actions that change the device state and need a confirmation in the UI. */
export const CONFIRMATION_REQUIRED_ACTIONS: readonly IntuneDeviceAction[] = [
  "rebootNow",
  "remoteLock",
  "resetPasscode",
  "rotateLocalAdminPassword",
];

const ACTION_PLATFORMS: Record<IntuneDeviceAction, readonly IntunePlatform[]> =
  {
    syncDevice: ["windows", "ios", "macos", "android"],
    rebootNow: ["windows", "ios", "macos"],
    // Remote lock is not supported on Windows desktop devices.
    remoteLock: ["ios", "macos", "android"],
    // Passcode reset exists only for mobile devices. Windows has no password
    // reset; rotating the local admin password (LAPS) is offered instead.
    resetPasscode: ["ios", "android"],
    rotateLocalAdminPassword: ["windows"],
    windowsDefenderScan: ["windows"],
  };

const ACTION_API_VERSION: Record<IntuneDeviceAction, "v1.0" | "beta"> = {
  syncDevice: "v1.0",
  rebootNow: "v1.0",
  remoteLock: "v1.0",
  resetPasscode: "v1.0",
  rotateLocalAdminPassword: "beta",
  windowsDefenderScan: "v1.0",
};

export function isIntuneDeviceAction(
  value: unknown,
): value is IntuneDeviceAction {
  return (
    typeof value === "string" &&
    (INTUNE_DEVICE_ACTIONS as readonly string[]).includes(value)
  );
}

/** Platform from the Intune operatingSystem value ("Windows", "iOS", ...). */
export function intunePlatform(
  operatingSystem: string | null | undefined,
): IntunePlatform {
  const value = (operatingSystem ?? "").trim().toLowerCase();
  if (!value) return "other";
  if (value.startsWith("windows")) return "windows";
  if (value === "ios" || value === "ipados" || value.startsWith("iphone")) {
    return "ios";
  }
  if (value.startsWith("mac")) return "macos";
  if (value.startsWith("android")) return "android";
  return "other";
}

export function availableIntuneActions(
  operatingSystem: string | null | undefined,
): IntuneDeviceAction[] {
  const platform = intunePlatform(operatingSystem);
  return INTUNE_DEVICE_ACTIONS.filter((action) =>
    ACTION_PLATFORMS[action].includes(platform),
  );
}

export function intuneActionApiVersion(
  action: IntuneDeviceAction,
): "v1.0" | "beta" {
  return ACTION_API_VERSION[action];
}

export type IntuneActionErrorCode =
  | "provider_not_configured"
  | "consent_missing"
  | "permission_missing"
  | "device_not_found"
  | "action_not_supported"
  | "rate_limited"
  | "provider_unavailable"
  | "invalid_device";

export class IntuneActionError extends Error {
  constructor(
    readonly code: IntuneActionErrorCode,
    readonly graphStatus: number | null = null,
  ) {
    super(code);
  }
}

export type IntuneActionRequest = {
  url: string;
  init: RequestInit;
  apiVersion: "v1.0" | "beta";
};

export function buildIntuneActionRequest(
  action: IntuneDeviceAction,
  managedDeviceId: string,
  accessToken: string,
): IntuneActionRequest {
  if (!GUID_PATTERN.test(managedDeviceId)) {
    throw new IntuneActionError("invalid_device");
  }
  const apiVersion = ACTION_API_VERSION[action];
  const url = `${GRAPH_ORIGIN}/${apiVersion}/deviceManagement/managedDevices/${encodeURIComponent(
    managedDeviceId.toLowerCase(),
  )}/${action}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
  };
  let body: string | undefined;
  if (action === "windowsDefenderScan") {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify({ quickScan: true });
  }
  return {
    url,
    apiVersion,
    init: {
      method: "POST",
      redirect: "error",
      headers,
      ...(body === undefined ? {} : { body }),
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  fetchImpl: FetchLike,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetchImpl(input, { ...init, signal: controller.signal });
  } catch {
    throw new IntuneActionError("provider_unavailable");
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Application roles of a client-credentials access token (the `roles`
 * claim). Returns null when the token cannot be read; the Graph response is
 * then authoritative.
 */
export function accessTokenRoles(accessToken: string): string[] | null {
  const parts = accessToken.split(".");
  if (parts.length !== 3) return null;
  try {
    const base64 = parts[1].replaceAll("-", "+").replaceAll("_", "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const payload: unknown = JSON.parse(
      new TextDecoder().decode(
        Uint8Array.from(atob(padded), (character) => character.charCodeAt(0)),
      ),
    );
    if (!isRecord(payload) || !Array.isArray(payload.roles)) return null;
    return payload.roles.filter(
      (role): role is string => typeof role === "string",
    );
  } catch {
    return null;
  }
}

export async function requestIntuneActionAccessToken(
  entraTenantId: string,
  credentials: IntuneGraphCredentials,
  fetchImpl: FetchLike = fetch,
): Promise<string> {
  if (!GUID_PATTERN.test(entraTenantId)) {
    throw new IntuneActionError("provider_not_configured");
  }
  const response = await fetchWithTimeout(
    `https://login.microsoftonline.com/${entraTenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      redirect: "error",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        grant_type: "client_credentials",
        scope: TOKEN_SCOPE,
      }),
    },
    fetchImpl,
  );
  if (response.status === 400 || response.status === 401) {
    // Typically AADSTS700016 / AADSTS7000215: the app is not consented in the
    // customer tenant or the secret is wrong.
    throw new IntuneActionError("consent_missing", response.status);
  }
  if (response.status === 429) {
    throw new IntuneActionError("rate_limited", 429);
  }
  if (!response.ok) {
    throw new IntuneActionError("provider_unavailable", response.status);
  }
  const payload: unknown = await response.json().catch(() => null);
  const token =
    isRecord(payload) && typeof payload.access_token === "string"
      ? payload.access_token.trim()
      : "";
  if (!token || token.length > 16_384 || /[\u0000-\u001f\u007f]/.test(token)) {
    throw new IntuneActionError("provider_unavailable", response.status);
  }
  return token;
}

/** Maps a non-successful Graph response to an action error code. */
export function mapGraphActionFailure(
  status: number,
  body: unknown,
): IntuneActionErrorCode {
  const error = isRecord(body) && isRecord(body.error) ? body.error : null;
  const code = typeof error?.code === "string" ? error.code : "";
  const message = typeof error?.message === "string" ? error.message : "";
  if (status === 401 || status === 403) {
    return "permission_missing";
  }
  if (status === 404) return "device_not_found";
  if (status === 429) return "rate_limited";
  if ([400, 405, 409, 501].includes(status)) return "action_not_supported";
  if (
    status < 500 &&
    /notsupported|not supported|unsupported/i.test(`${code} ${message}`)
  ) {
    return "action_not_supported";
  }
  return "provider_unavailable";
}

export type IntuneActionResult = {
  graphStatus: number;
  apiVersion: "v1.0" | "beta";
};

/**
 * Runs one remote action. Throws IntuneActionError on failure; the error
 * carries the Graph HTTP status when Graph answered.
 */
export async function runIntuneDeviceAction(
  action: IntuneDeviceAction,
  managedDeviceId: string,
  accessToken: string,
  fetchImpl: FetchLike = fetch,
): Promise<IntuneActionResult> {
  const roles = accessTokenRoles(accessToken);
  if (roles && !roles.includes(INTUNE_PRIVILEGED_OPERATIONS_PERMISSION)) {
    throw new IntuneActionError("permission_missing");
  }
  const request = buildIntuneActionRequest(
    action,
    managedDeviceId,
    accessToken,
  );
  const response = await fetchWithTimeout(request.url, request.init, fetchImpl);
  if (response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return { graphStatus: response.status, apiVersion: request.apiVersion };
  }
  const body: unknown = await response.json().catch(() => null);
  throw new IntuneActionError(
    mapGraphActionFailure(response.status, body),
    response.status,
  );
}

/** German, user-facing message for an action error code. */
export function intuneActionErrorMessage(code: IntuneActionErrorCode): string {
  switch (code) {
    case "provider_not_configured":
      return "Die Intune-Anbindung ist für diesen Mandanten nicht eingerichtet.";
    case "consent_missing":
      return "Die nextDesk-App ist im Entra-Mandanten nicht freigegeben (Administratorzustimmung fehlt).";
    case "permission_missing":
      return INTUNE_MISSING_PERMISSION_MESSAGE;
    case "device_not_found":
      return "Das Gerät wurde in Intune nicht gefunden.";
    case "action_not_supported":
      return "Diese Aktion wird für das Gerät nicht unterstützt.";
    case "rate_limited":
      return msg(
        "Microsoft Intune hat zu viele Anfragen erhalten. Bitte versuche es später erneut.",
        "Microsoft Intune hat zu viele Anfragen erhalten. Bitte versuchen Sie es später erneut.",
      );
    case "invalid_device":
      return "Die Intune-Geräte-ID ist ungültig.";
    default:
      return "Microsoft Intune ist derzeit nicht erreichbar.";
  }
}
