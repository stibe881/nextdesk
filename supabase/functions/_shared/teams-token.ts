// Graph-Token für Teams: eigene App (TEAMS_GRAPH_CLIENT_ID/-SECRET) oder, wenn
// nicht gesetzt, dieselbe Graph-App wie für Intune. Der Kundenmandant stammt
// aus der vertrauenswürdigen SSO-Konfiguration des nextDesk-Mandanten.

import {
  IntuneActionError,
  requestIntuneActionAccessToken,
} from "./intune-device-actions-graph.ts";
import { readIntuneGraphCredentials } from "./intune-managed-devices-graph.ts";
import { TeamsGraphError } from "./teams-graph.ts";

// deno-lint-ignore no-explicit-any
type Admin = any;

function credentials(): { clientId: string; clientSecret: string } | null {
  const clientId = Deno.env.get("TEAMS_GRAPH_CLIENT_ID")?.trim();
  const clientSecret = Deno.env.get("TEAMS_GRAPH_CLIENT_SECRET")?.trim();
  if (clientId && clientSecret) return { clientId, clientSecret };
  return readIntuneGraphCredentials();
}

export function teamsCredentialsConfigured(): boolean {
  return credentials() !== null;
}

/** Entra-Mandant des nextDesk-Mandanten oder null (SSO nicht eingerichtet). */
export async function teamsEntraTenant(
  admin: Admin,
  tenantId: string,
): Promise<string | null> {
  const { data, error } = await admin.rpc("trusted_entra_tenant_id_for_tenant", {
    p_tenant_id: tenantId,
  });
  return !error && typeof data === "string" ? data : null;
}

export async function teamsGraphToken(
  admin: Admin,
  tenantId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const app = credentials();
  const entraTenant = await teamsEntraTenant(admin, tenantId);
  if (!app || !entraTenant) {
    console.error(
      `teams-token not configured (app=${app ? "yes" : "no"}, entraTenant=${entraTenant ? "yes" : "no"})`,
    );
    throw new TeamsGraphError("invalid");
  }
  try {
    const token = await requestIntuneActionAccessToken(entraTenant, app, fetchImpl);
    logTokenClaims(token);
    return token;
  } catch (error) {
    if (error instanceof IntuneActionError) {
      console.error(`teams-token ${error.code} status=${error.graphStatus ?? ""}`);
      // 400/401 beim Token: Geheimnis falsch/abgelaufen oder App im Mandanten unbekannt.
      if (error.code === "consent_missing") {
        throw new TeamsGraphError("token_failed", error.graphStatus ?? 0);
      }
      if (error.code === "rate_limited") throw new TeamsGraphError("rate_limited");
    }
    throw new TeamsGraphError("unavailable");
  }
}

/**
 * Diagnose: App-Id und Anwendungsrollen des Tokens ins Protokoll (nur diese
 * Angaben, nie das Token selbst). So ist sichtbar, ob eine erteilte
 * Berechtigung schon im Token steht (Microsoft hält Tokens bis zu ~1 Stunde).
 */
export function logTokenClaims(token: string): void {
  try {
    const part = token.split(".")[1] ?? "";
    const json = atob(part.replaceAll("-", "+").replaceAll("_", "/"));
    const claims = JSON.parse(json) as { appid?: unknown; roles?: unknown };
    const roles = Array.isArray(claims.roles)
      ? claims.roles.filter((role): role is string => typeof role === "string")
      : [];
    const needed = ["Team.Create", "Group.Read.All", "TeamMember.ReadWrite.All"];
    console.log(
      `teams-token app=${String(claims.appid ?? "").slice(0, 36)} roles=${roles.length} missing=${needed.filter((role) => !roles.includes(role)).join(",") || "none"}`,
    );
  } catch {
    // Diagnose darf nie scheitern.
  }
}
