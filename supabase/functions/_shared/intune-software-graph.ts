// Software distribution through Intune (Microsoft Graph).
//
// Uses the same multi-tenant Entra app as the device sync and the remote
// actions (INTUNE_MANAGED_DEVICES_CLIENT_ID / _SECRET, client credentials
// against the customer's Entra tenant). Application permissions needed in the
// customer tenant (admin consent):
//   GroupMember.ReadWrite.All                   add members to the target group
//   DeviceManagementApps.Read.All               list Intune apps (admin UI)
//   DeviceManagementApps.ReadWrite.All          only with "ensure app assignment"
//   DeviceManagementManagedDevices.Read.All     only for device groups
//   Device.Read.All                             only for device groups
//
// Preferred setup: an Entra security group has the app assigned in Intune
// ("Required" or "Available"). nextDesk adds the requester (user_group) or
// the requester's Intune devices (device_group) to that group:
//   POST /v1.0/groups/{groupId}/members/$ref
//        {"@odata.id": "https://graph.microsoft.com/v1.0/directoryObjects/{id}"}
// Optionally nextDesk creates the app assignment to the group itself:
//   POST /v1.0/deviceAppManagement/mobileApps/{appId}/assignments

import type { FetchLike } from "./intune-managed-devices-graph.ts";

const GRAPH = "https://graph.microsoft.com/v1.0";
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_APP_PAGES = 10;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const SOFTWARE_GROUP_PERMISSION = "GroupMember.ReadWrite.All";

export type SoftwareAssignmentMode = "user_group" | "device_group";

export type SoftwareDeployErrorCode =
  | "provider_not_configured"
  | "consent_missing"
  | "permission_missing"
  | "user_not_linked"
  | "group_not_found"
  | "app_not_found"
  | "no_managed_device"
  | "rate_limited"
  | "provider_unavailable"
  | "invalid_request";

export class SoftwareDeployError extends Error {
  constructor(
    readonly code: SoftwareDeployErrorCode,
    readonly graphStatus: number | null = null,
  ) {
    super(code);
  }
}

export type SoftwareDeploymentPlan = {
  appId: string;
  mode: SoftwareAssignmentMode;
  groupId: string;
  ensureAppAssignment: boolean;
  /** Entra object id of the requester (directory sync). */
  userObjectId: string | null;
};

export type SoftwareDeploymentResult = {
  /** Directory objects added to the group (0 when all were members already). */
  membersAdded: number;
  /** Directory objects (user or devices) that are now members. */
  memberIds: string[];
  appAssignmentCreated: boolean;
};

export type IntuneMobileApp = {
  id: string;
  displayName: string;
  publisher: string | null;
  appType: string | null;
  isAssigned: boolean | null;
};

export type EntraGroupInfo = {
  id: string;
  displayName: string;
  securityEnabled: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isGuid(value: unknown): value is string {
  return typeof value === "string" && GUID.test(value);
}

async function graphFetch(
  url: string,
  init: RequestInit,
  fetchImpl: FetchLike,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetchImpl(url, {
      redirect: "error",
      ...init,
      signal: controller.signal,
    });
  } catch {
    throw new SoftwareDeployError("provider_unavailable");
  } finally {
    clearTimeout(timer);
  }
}

function authHeaders(token: string, json = false): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}

/** Maps a failed Graph response; `notFound` names what a 404 means. */
export function mapSoftwareGraphFailure(
  status: number,
  notFound: SoftwareDeployErrorCode,
): SoftwareDeployErrorCode {
  if (status === 401 || status === 403) return "permission_missing";
  if (status === 404) return notFound;
  if (status === 429) return "rate_limited";
  if (status === 400) return "invalid_request";
  return "provider_unavailable";
}

async function failure(
  response: Response,
  notFound: SoftwareDeployErrorCode,
): Promise<never> {
  await response.body?.cancel().catch(() => undefined);
  throw new SoftwareDeployError(
    mapSoftwareGraphFailure(response.status, notFound),
    response.status,
  );
}

/** True when Graph reports that the member is already in the group. */
export function isAlreadyMemberResponse(
  status: number,
  body: unknown,
): boolean {
  if (status !== 400) return false;
  const error = isRecord(body) && isRecord(body.error) ? body.error : null;
  const message = typeof error?.message === "string" ? error.message : "";
  return /already exist/i.test(message);
}

/** POST /groups/{id}/members/$ref. Returns false when already a member. */
export async function addGroupMember(
  accessToken: string,
  groupId: string,
  directoryObjectId: string,
  fetchImpl: FetchLike = fetch,
): Promise<boolean> {
  if (!isGuid(groupId) || !isGuid(directoryObjectId)) {
    throw new SoftwareDeployError("invalid_request");
  }
  const response = await graphFetch(
    `${GRAPH}/groups/${groupId.toLowerCase()}/members/$ref`,
    {
      method: "POST",
      headers: authHeaders(accessToken, true),
      body: JSON.stringify({
        "@odata.id": `${GRAPH}/directoryObjects/${directoryObjectId.toLowerCase()}`,
      }),
    },
    fetchImpl,
  );
  if (response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return true;
  }
  const body: unknown = await response.json().catch(() => null);
  if (isAlreadyMemberResponse(response.status, body)) return false;
  throw new SoftwareDeployError(
    mapSoftwareGraphFailure(response.status, "group_not_found"),
    response.status,
  );
}

/**
 * Entra device object ids of the user's Intune managed devices:
 * managedDevices (userId) -> azureADDeviceId -> /devices (deviceId) -> id.
 */
export async function userDeviceObjectIds(
  accessToken: string,
  userObjectId: string,
  fetchImpl: FetchLike = fetch,
): Promise<string[]> {
  if (!isGuid(userObjectId)) throw new SoftwareDeployError("user_not_linked");
  // Spaces in $filter as %20 (URLSearchParams would write "+").
  const devicesUrl = `${GRAPH}/deviceManagement/managedDevices?$filter=${encodeURIComponent(
    `userId eq '${userObjectId.toLowerCase()}'`,
  )}&$select=id,azureADDeviceId&$top=50`;
  const response = await graphFetch(
    devicesUrl,
    { method: "GET", headers: authHeaders(accessToken) },
    fetchImpl,
  );
  if (!response.ok) await failure(response, "no_managed_device");
  const payload: unknown = await response.json().catch(() => null);
  const azureIds = [
    ...new Set(
      (isRecord(payload) && Array.isArray(payload.value) ? payload.value : [])
        .filter(isRecord)
        .map((device) => device.azureADDeviceId)
        .filter(
          (id): id is string =>
            isGuid(id) && id !== "00000000-0000-0000-0000-000000000000",
        )
        .map((id) => id.toLowerCase()),
    ),
  ];
  const objectIds: string[] = [];
  for (const azureId of azureIds.slice(0, 20)) {
    const url = `${GRAPH}/devices?$filter=${encodeURIComponent(
      `deviceId eq '${azureId}'`,
    )}&$select=id`;
    const lookup = await graphFetch(
      url,
      { method: "GET", headers: authHeaders(accessToken) },
      fetchImpl,
    );
    if (!lookup.ok) await failure(lookup, "no_managed_device");
    const body: unknown = await lookup.json().catch(() => null);
    const id =
      isRecord(body) && Array.isArray(body.value) && isRecord(body.value[0])
        ? body.value[0].id
        : null;
    if (isGuid(id)) objectIds.push(id.toLowerCase());
  }
  return objectIds;
}

/**
 * Makes sure the app is assigned to the group (intent "required"). Returns
 * true when the assignment was created.
 */
export async function ensureAppGroupAssignment(
  accessToken: string,
  appId: string,
  groupId: string,
  fetchImpl: FetchLike = fetch,
): Promise<boolean> {
  if (!isGuid(appId) || !isGuid(groupId)) {
    throw new SoftwareDeployError("invalid_request");
  }
  const base = `${GRAPH}/deviceAppManagement/mobileApps/${appId.toLowerCase()}/assignments`;
  const existing = await graphFetch(
    base,
    { method: "GET", headers: authHeaders(accessToken) },
    fetchImpl,
  );
  if (!existing.ok) await failure(existing, "app_not_found");
  const payload: unknown = await existing.json().catch(() => null);
  const assigned = (
    isRecord(payload) && Array.isArray(payload.value) ? payload.value : []
  )
    .filter(isRecord)
    .some(
      (assignment) =>
        isRecord(assignment.target) &&
        typeof assignment.target.groupId === "string" &&
        assignment.target.groupId.toLowerCase() === groupId.toLowerCase(),
    );
  if (assigned) return false;
  const created = await graphFetch(
    base,
    {
      method: "POST",
      headers: authHeaders(accessToken, true),
      body: JSON.stringify({
        "@odata.type": "#microsoft.graph.mobileAppAssignment",
        intent: "required",
        target: {
          "@odata.type": "#microsoft.graph.groupAssignmentTarget",
          groupId: groupId.toLowerCase(),
        },
      }),
    },
    fetchImpl,
  );
  if (!created.ok) await failure(created, "app_not_found");
  await created.body?.cancel().catch(() => undefined);
  return true;
}

/** Runs one deployment. Throws SoftwareDeployError on failure. */
export async function deploySoftware(
  plan: SoftwareDeploymentPlan,
  accessToken: string,
  fetchImpl: FetchLike = fetch,
): Promise<SoftwareDeploymentResult> {
  if (!isGuid(plan.appId) || !isGuid(plan.groupId)) {
    throw new SoftwareDeployError("invalid_request");
  }
  if (!isGuid(plan.userObjectId)) {
    throw new SoftwareDeployError("user_not_linked");
  }
  const appAssignmentCreated = plan.ensureAppAssignment
    ? await ensureAppGroupAssignment(
        accessToken,
        plan.appId,
        plan.groupId,
        fetchImpl,
      )
    : false;
  const memberIds =
    plan.mode === "device_group"
      ? await userDeviceObjectIds(accessToken, plan.userObjectId, fetchImpl)
      : [plan.userObjectId.toLowerCase()];
  if (memberIds.length === 0) {
    throw new SoftwareDeployError("no_managed_device");
  }
  let membersAdded = 0;
  for (const memberId of memberIds) {
    if (await addGroupMember(accessToken, plan.groupId, memberId, fetchImpl)) {
      membersAdded += 1;
    }
  }
  return { membersAdded, memberIds, appAssignmentCreated };
}

/** Intune apps for the admin UI (GET /deviceAppManagement/mobileApps). */
export async function listIntuneMobileApps(
  accessToken: string,
  fetchImpl: FetchLike = fetch,
): Promise<IntuneMobileApp[]> {
  const first = new URL(`${GRAPH}/deviceAppManagement/mobileApps`);
  first.searchParams.set("$select", "id,displayName,publisher,isAssigned");
  first.searchParams.set("$top", "100");
  let next: string | null = first.toString();
  const apps: IntuneMobileApp[] = [];
  for (let page = 0; next && page < MAX_APP_PAGES; page += 1) {
    const url = new URL(next);
    if (url.origin !== "https://graph.microsoft.com") {
      throw new SoftwareDeployError("provider_unavailable");
    }
    const response = await graphFetch(
      url.toString(),
      { method: "GET", headers: authHeaders(accessToken) },
      fetchImpl,
    );
    if (!response.ok) await failure(response, "app_not_found");
    const payload: unknown = await response.json().catch(() => null);
    if (!isRecord(payload) || !Array.isArray(payload.value)) {
      throw new SoftwareDeployError("provider_unavailable");
    }
    for (const entry of payload.value.filter(isRecord)) {
      if (!isGuid(entry.id) || typeof entry.displayName !== "string") continue;
      const type = entry["@odata.type"];
      apps.push({
        id: entry.id.toLowerCase(),
        displayName: entry.displayName.trim().slice(0, 240) || entry.id,
        publisher:
          typeof entry.publisher === "string" && entry.publisher.trim()
            ? entry.publisher.trim().slice(0, 160)
            : null,
        appType:
          typeof type === "string"
            ? type.replace("#microsoft.graph.", "").slice(0, 80)
            : null,
        isAssigned:
          typeof entry.isAssigned === "boolean" ? entry.isAssigned : null,
      });
    }
    next =
      typeof payload["@odata.nextLink"] === "string"
        ? payload["@odata.nextLink"]
        : null;
  }
  return apps.sort((left, right) =>
    left.displayName.localeCompare(right.displayName, "de"),
  );
}

/** Name of a group, to confirm a manually entered group id. */
export async function getEntraGroup(
  accessToken: string,
  groupId: string,
  fetchImpl: FetchLike = fetch,
): Promise<EntraGroupInfo> {
  if (!isGuid(groupId)) throw new SoftwareDeployError("invalid_request");
  const url = new URL(`${GRAPH}/groups/${groupId.toLowerCase()}`);
  url.searchParams.set("$select", "id,displayName,securityEnabled");
  const response = await graphFetch(
    url.toString(),
    { method: "GET", headers: authHeaders(accessToken) },
    fetchImpl,
  );
  if (!response.ok) await failure(response, "group_not_found");
  const payload: unknown = await response.json().catch(() => null);
  if (!isRecord(payload) || !isGuid(payload.id)) {
    throw new SoftwareDeployError("provider_unavailable");
  }
  return {
    id: payload.id.toLowerCase(),
    displayName:
      typeof payload.displayName === "string"
        ? payload.displayName.slice(0, 240)
        : payload.id,
    securityEnabled: payload.securityEnabled === true,
  };
}

/** German message for the order timeline and the admin UI. */
export function softwareDeployErrorMessage(
  code: SoftwareDeployErrorCode,
): string {
  switch (code) {
    case "provider_not_configured":
      return "Die Intune-Anbindung ist für diesen Mandanten nicht eingerichtet.";
    case "consent_missing":
      return "Die nextDesk-App ist im Entra-Mandanten nicht freigegeben (Administratorzustimmung fehlt).";
    case "permission_missing":
      return `In Entra fehlt eine Berechtigung (z. B. ${SOFTWARE_GROUP_PERMISSION}).`;
    case "user_not_linked":
      return "Für die bestellende Person ist kein Entra-Konto bekannt (Verzeichnis-Synchronisation prüfen).";
    case "group_not_found":
      return "Die Entra-Gruppe wurde nicht gefunden.";
    case "app_not_found":
      return "Die Intune-App wurde nicht gefunden.";
    case "no_managed_device":
      return "Für die bestellende Person ist kein Intune-Gerät registriert.";
    case "rate_limited":
      return "Microsoft Graph hat zu viele Anfragen erhalten. Bitte später erneut versuchen.";
    case "invalid_request":
      return "Die Intune-Angaben des Artikels sind ungültig.";
    default:
      return "Microsoft Intune ist derzeit nicht erreichbar.";
  }
}

/** Status label shown in web and app («Wird installiert» …). */
export function softwareStatusLabel(status: string): string {
  if (status === "assigned") return "Zugewiesen";
  if (status === "failed") return "Fehler";
  return "Wird installiert";
}
