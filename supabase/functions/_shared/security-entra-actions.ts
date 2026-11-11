// Entra measures of a security case (migration 0313): sign out everywhere
// and force a password change at the next sign-in. Uses the existing Entra
// app of the Intune connection (client credentials against the customer's
// Entra tenant, see entra-graph-token.ts).
//
// Graph (v1.0):
//   POST  /users/{id}/revokeSignInSessions
//         application permission User.RevokeSessions.All (or User.ReadWrite.All)
//   PATCH /users/{id}  {"passwordProfile": {"forceChangePasswordNextSignIn": true}}
//         application permission User-PasswordProfile.ReadWrite.All (or
//         User.ReadWrite.All); accounts with administrator roles additionally
//         need a matching Entra role for the app, otherwise Graph answers 403.

import type { FetchLike } from "./intune-managed-devices-graph.ts";
import { accessTokenRoles } from "./intune-device-actions-graph.ts";

export type EntraSecurityAction = "revokeSessions" | "forcePasswordChange";

export type EntraActionErrorCode =
  | "provider_not_configured"
  | "consent_missing"
  | "permission_missing"
  | "user_not_found"
  | "rate_limited"
  | "provider_unavailable"
  | "invalid_user";

export class EntraActionError extends Error {
  constructor(
    readonly code: EntraActionErrorCode,
    readonly graphStatus: number | null = null,
  ) {
    super(code);
  }
}

/** Any of these application roles allows the action. */
export const ENTRA_ACTION_ROLES: Record<EntraSecurityAction, readonly string[]> = {
  revokeSessions: ["User.RevokeSessions.All", "User.ReadWrite.All", "Directory.ReadWrite.All"],
  forcePasswordChange: [
    "User-PasswordProfile.ReadWrite.All",
    "User.ReadWrite.All",
    "Directory.ReadWrite.All",
  ],
};

const GRAPH = "https://graph.microsoft.com/v1.0";
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIMEOUT_MS = 15_000;

export function buildEntraActionRequest(
  action: EntraSecurityAction,
  objectId: string,
  accessToken: string,
): { url: string; init: RequestInit } {
  if (!GUID.test(objectId)) throw new EntraActionError("invalid_user");
  const base = `${GRAPH}/users/${encodeURIComponent(objectId.toLowerCase())}`;
  const headers: Record<string, string> = { Authorization: `Bearer ${accessToken}` };
  if (action === "revokeSessions") {
    return { url: `${base}/revokeSignInSessions`, init: { method: "POST", redirect: "error", headers } };
  }
  return {
    url: base,
    init: {
      method: "PATCH",
      redirect: "error",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ passwordProfile: { forceChangePasswordNextSignIn: true } }),
    },
  };
}

export function mapEntraFailure(status: number): EntraActionErrorCode {
  if (status === 401 || status === 403) return "permission_missing";
  if (status === 404) return "user_not_found";
  if (status === 429) return "rate_limited";
  return "provider_unavailable";
}

export async function runEntraSecurityAction(
  action: EntraSecurityAction,
  objectId: string,
  accessToken: string,
  fetchImpl: FetchLike = fetch,
): Promise<{ graphStatus: number }> {
  const roles = accessTokenRoles(accessToken);
  if (roles && !ENTRA_ACTION_ROLES[action].some((role) => roles.includes(role))) {
    throw new EntraActionError("permission_missing");
  }
  const request = buildEntraActionRequest(action, objectId, accessToken);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetchImpl(request.url, { ...request.init, signal: controller.signal });
  } catch {
    throw new EntraActionError("provider_unavailable");
  } finally {
    clearTimeout(timer);
  }
  await response.body?.cancel().catch(() => undefined);
  if (response.ok) return { graphStatus: response.status };
  throw new EntraActionError(mapEntraFailure(response.status), response.status);
}

export const ENTRA_ACTION_LABELS: Record<EntraSecurityAction, string> = {
  revokeSessions: "Sitzungen widerrufen",
  forcePasswordChange: "Passwort-Reset erzwingen",
};

/** German, user-facing message; mentions the missing permission. */
export function entraActionErrorMessage(
  code: EntraActionErrorCode,
  action: EntraSecurityAction,
): string {
  switch (code) {
    case "provider_not_configured":
      return "Die Entra-Anbindung (Intune-Verbindung) ist für diesen Mandanten nicht eingerichtet. Bitte die Massnahme direkt im Entra Admin Center ausführen.";
    case "consent_missing":
      return "Die nextDesk-App ist im Entra-Mandanten nicht freigegeben (Administratorzustimmung fehlt).";
    case "permission_missing":
      return action === "revokeSessions"
        ? "In Entra fehlt die Anwendungsberechtigung User.RevokeSessions.All. Bitte die Sitzungen im Entra Admin Center widerrufen oder die Berechtigung erteilen."
        : "In Entra fehlt die Anwendungsberechtigung User-PasswordProfile.ReadWrite.All (bei Konten mit Administratorrolle zusätzlich eine passende Entra-Rolle der App). Bitte den Passwort-Reset im Entra Admin Center erzwingen.";
    case "user_not_found":
      return "Das Konto wurde in Entra nicht gefunden.";
    case "rate_limited":
      return "Microsoft Graph hat zu viele Anfragen erhalten. Bitte später erneut versuchen.";
    case "invalid_user":
      return "Für diese Person ist kein Entra-Konto bekannt.";
    default:
      return "Microsoft Entra ist gerade nicht erreichbar. Bitte später erneut versuchen.";
  }
}
