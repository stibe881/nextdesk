// License reclamation: Entra sign-in activity and Microsoft 365 license
// removal (Microsoft Graph, client credentials against the customer tenant,
// same Entra app as the Intune connection).
//
// Application permissions (admin consent in the customer tenant):
//   AuditLog.Read.All + User.Read.All   signInActivity of all users
//                                       (needs Entra ID P1 or P2)
//   LicenseAssignment.ReadWrite.All     optional: remove a Microsoft 365
//   (or User.ReadWrite.All)             license (POST /users/{id}/assignLicense)

import type { FetchLike } from "./intune-managed-devices-graph.ts";

const GRAPH = "https://graph.microsoft.com/v1.0";
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_USER_PAGES = 50;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const SIGN_IN_PERMISSION = "AuditLog.Read.All";
export const LICENSE_ASSIGNMENT_PERMISSION = "LicenseAssignment.ReadWrite.All";

export type EntraLicenseErrorCode =
  | "permission_missing"
  | "premium_required"
  | "user_not_found"
  | "license_not_assigned"
  | "rate_limited"
  | "provider_unavailable"
  | "invalid_request";

export class EntraLicenseError extends Error {
  constructor(
    readonly code: EntraLicenseErrorCode,
    readonly graphStatus: number | null = null,
  ) {
    super(code);
  }
}

export type SignInActivityRow = {
  entra_object_id: string;
  last_sign_in_at: string | null;
  account_enabled: boolean | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
    throw new EntraLicenseError("provider_unavailable");
  } finally {
    clearTimeout(timer);
  }
}

function validDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const time = Date.parse(value);
  // Graph reports "0001-01-01T00:00:00Z" for "never".
  if (!Number.isFinite(time) || time < Date.UTC(2000, 0, 1)) return null;
  return new Date(time).toISOString();
}

/**
 * Latest sign-in of a user from signInActivity: the newest of the
 * interactive and the non-interactive sign-in.
 */
export function latestSignIn(activity: unknown): string | null {
  if (!isRecord(activity)) return null;
  const candidates = [
    validDate(activity.lastSignInDateTime),
    validDate(activity.lastNonInteractiveSignInDateTime),
    validDate(activity.lastSuccessfulSignInDateTime),
  ].filter((value): value is string => value !== null);
  if (candidates.length === 0) return null;
  return candidates.sort().at(-1) ?? null;
}

export function mapSignInFailure(
  status: number,
  body: unknown,
): EntraLicenseErrorCode {
  const error = isRecord(body) && isRecord(body.error) ? body.error : null;
  const text = `${typeof error?.code === "string" ? error.code : ""} ${
    typeof error?.message === "string" ? error.message : ""
  }`;
  if (/premium|B2C|license/i.test(text) && status === 403) {
    return "premium_required";
  }
  if (status === 401 || status === 403) return "permission_missing";
  if (status === 429) return "rate_limited";
  if (status === 400) return "invalid_request";
  return "provider_unavailable";
}

/** GET /users?$select=id,accountEnabled,signInActivity (all pages). */
export async function fetchSignInActivity(
  accessToken: string,
  fetchImpl: FetchLike = fetch,
): Promise<SignInActivityRow[]> {
  const first = new URL(`${GRAPH}/users`);
  first.searchParams.set("$select", "id,accountEnabled,signInActivity");
  first.searchParams.set("$top", "500");
  let next: string | null = first.toString();
  const rows: SignInActivityRow[] = [];
  for (let page = 0; next && page < MAX_USER_PAGES; page += 1) {
    const url = new URL(next);
    if (url.origin !== "https://graph.microsoft.com") {
      throw new EntraLicenseError("provider_unavailable");
    }
    const response = await graphFetch(
      url.toString(),
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
      },
      fetchImpl,
    );
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      throw new EntraLicenseError(
        mapSignInFailure(response.status, payload),
        response.status,
      );
    }
    if (!isRecord(payload) || !Array.isArray(payload.value)) {
      throw new EntraLicenseError("provider_unavailable");
    }
    for (const user of payload.value.filter(isRecord)) {
      if (typeof user.id !== "string" || !GUID.test(user.id)) continue;
      rows.push({
        entra_object_id: user.id.toLowerCase(),
        last_sign_in_at: latestSignIn(user.signInActivity),
        account_enabled:
          typeof user.accountEnabled === "boolean" ? user.accountEnabled : null,
      });
    }
    next =
      typeof payload["@odata.nextLink"] === "string"
        ? payload["@odata.nextLink"]
        : null;
  }
  return rows;
}

/** POST /users/{id}/assignLicense removing one SKU. */
export async function removeUserLicense(
  accessToken: string,
  userObjectId: string,
  skuId: string,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  if (!GUID.test(userObjectId) || !GUID.test(skuId)) {
    throw new EntraLicenseError("invalid_request");
  }
  const response = await graphFetch(
    `${GRAPH}/users/${userObjectId.toLowerCase()}/assignLicense`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        addLicenses: [],
        removeLicenses: [skuId.toLowerCase()],
      }),
    },
    fetchImpl,
  );
  if (response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return;
  }
  const body: unknown = await response.json().catch(() => null);
  const error = isRecord(body) && isRecord(body.error) ? body.error : null;
  const message = typeof error?.message === "string" ? error.message : "";
  if (
    response.status === 400 &&
    /does not have|not assigned|invalid/i.test(message)
  ) {
    // The user does not hold this SKU (anymore): nothing to remove.
    throw new EntraLicenseError("license_not_assigned", 400);
  }
  if (response.status === 404) {
    throw new EntraLicenseError("user_not_found", 404);
  }
  throw new EntraLicenseError(
    mapSignInFailure(response.status, body),
    response.status,
  );
}

export function entraLicenseErrorMessage(code: EntraLicenseErrorCode): string {
  switch (code) {
    case "permission_missing":
      return "In Entra fehlt eine Berechtigung (AuditLog.Read.All bzw. LicenseAssignment.ReadWrite.All).";
    case "premium_required":
      return "Anmeldedaten aus Entra benötigen Entra ID P1 oder P2. Es wird die letzte nextDesk-Anmeldung verwendet.";
    case "user_not_found":
      return "Das Entra-Konto wurde nicht gefunden.";
    case "license_not_assigned":
      return "Die Microsoft-365-Lizenz ist dem Konto nicht (mehr) zugewiesen.";
    case "rate_limited":
      return "Microsoft Graph hat zu viele Anfragen erhalten. Bitte später erneut versuchen.";
    case "invalid_request":
      return "Die Angaben für Microsoft Graph sind ungültig.";
    default:
      return "Microsoft Graph ist derzeit nicht erreichbar.";
  }
}

// Pure helpers for the reclaim list ---------------------------------------

export type CostPeriod = "monthly" | "quarterly" | "yearly" | "one_time";

/** Monthly cost of one seat; one-time costs save nothing per month. */
export function monthlySeatCost(
  amount: number | null,
  period: CostPeriod | null,
): number | null {
  if (amount === null || !Number.isFinite(amount) || amount < 0) return null;
  switch (period) {
    case "monthly":
      return Math.round(amount * 100) / 100;
    case "quarterly":
      return Math.round((amount / 3) * 100) / 100;
    case "yearly":
      return Math.round((amount / 12) * 100) / 100;
    default:
      return 0;
  }
}

/** Sum of the monthly savings per currency. */
export function savingsByCurrency(
  candidates: { monthlySaving: number | null; currency: string }[],
): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const candidate of candidates) {
    if (candidate.monthlySaving === null) continue;
    totals[candidate.currency] =
      Math.round(
        ((totals[candidate.currency] ?? 0) + candidate.monthlySaving) * 100,
      ) / 100;
  }
  return totals;
}

export const RECLAIM_REASON_LABEL: Record<string, string> = {
  membership_inactive: "Kein aktives Mitglied mehr",
  entra_disabled: "Entra-Konto deaktiviert",
  offboarded: "Austritt abgeschlossen",
  inactive: "Keine Anmeldung",
};
