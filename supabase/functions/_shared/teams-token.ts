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
  if (!app || !entraTenant) throw new TeamsGraphError("invalid");
  try {
    return await requestIntuneActionAccessToken(entraTenant, app, fetchImpl);
  } catch (error) {
    if (error instanceof IntuneActionError) {
      if (error.code === "consent_missing") {
        throw new TeamsGraphError("consent_missing");
      }
      if (error.code === "rate_limited") throw new TeamsGraphError("rate_limited");
    }
    throw new TeamsGraphError("unavailable");
  }
}
