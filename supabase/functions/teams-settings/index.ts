import { withSupabase } from "@supabase/server";
import { loadTeamsSettings } from "../_shared/teams-settings.ts";
import {
  teamsClientId,
  teamsCredentialsConfigured,
  teamsEntraTenant,
  teamsGraphToken,
  TEAMS_GUEST_ROLE,
  TEAMS_REQUIRED_ROLES,
  tokenRoles,
} from "../_shared/teams-token.ts";
import { TeamsGraphError } from "../_shared/teams-graph.ts";

/**
 * Einstellungen der Funktion «Microsoft Teams im Shop» (Einstellungen →
 * Funktionen), nur für die Mandanten-Administration. Aktionen (POST, JWT):
 *   get                                  -> Einstellungen und Voraussetzungen
 *   save  { maxLifetimeMonths, allowGuests }
 *   check                                -> Verbindung und Rechte prüfen
 * Der Ein-/Ausschalter selbst ist der Funktionsschalter «teams.provisioning».
 */

const APP_ORIGIN = "https://app.nextdesk.ch";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// deno-lint-ignore no-explicit-any
type Admin = any;
type Row = Record<string, unknown>;

function headers(request: Request): HeadersInit {
  const origin = request.headers.get("origin");
  return {
    "Access-Control-Allow-Origin": origin === APP_ORIGIN ? APP_ORIGIN : "",
    "Access-Control-Allow-Headers":
      "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    Vary: "Origin",
  };
}

const json = (request: Request, body: Row, status = 200) =>
  new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: headers(request),
  });
const fail = (request: Request, code: string, status = 422) =>
  json(request, { error: { code } }, status);
const isRecord = (value: unknown): value is Row =>
  typeof value === "object" && value !== null && !Array.isArray(value);

async function isTenantAdministrator(
  admin: Admin,
  actorId: string,
  tenantId: string,
): Promise<boolean> {
  const { data: role } = await admin
    .from("roles")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("name", "Tenant administrator")
    .eq("scope", "tenant")
    .eq("active", true)
    .maybeSingle();
  if (!role?.id) return false;
  const now = new Date().toISOString();
  const { data: assignment } = await admin
    .from("user_role_assignments")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("user_id", actorId)
    .eq("role_id", role.id)
    .lte("starts_at", now)
    .or(`expires_at.is.null,expires_at.gt.${now}`)
    .maybeSingle();
  return Boolean(assignment);
}

function consentUrl(entraTenant: string | null, clientId: string | null) {
  return entraTenant && clientId
    ? `https://login.microsoftonline.com/${entraTenant}/adminconsent?client_id=${clientId}`
    : null;
}

const handler = withSupabase({ auth: "user" }, async (request, context) => {
  if (request.method !== "POST") return fail(request, "method_not_allowed", 405);
  const body: unknown = await request.json().catch(() => null);
  const actorId = context.userClaims?.id;
  if (
    !isRecord(body) ||
    typeof body.type !== "string" ||
    typeof body.tenantId !== "string" ||
    !UUID.test(body.tenantId) ||
    typeof actorId !== "string" ||
    !UUID.test(actorId)
  ) {
    return fail(request, "invalid_request", 400);
  }
  const admin = context.supabaseAdmin;
  const tenantId = body.tenantId.toLowerCase();
  if (!(await isTenantAdministrator(admin, actorId, tenantId))) {
    return fail(request, "tenant_admin_required", 403);
  }

  if (body.type === "get") {
    const entraTenant = await teamsEntraTenant(admin, tenantId);
    return json(request, {
      data: {
        settings: await loadTeamsSettings(admin, tenantId),
        platformConfigured: teamsCredentialsConfigured(),
        ssoConfigured: entraTenant !== null,
        consentUrl: consentUrl(entraTenant, teamsClientId()),
        requiredRoles: [...TEAMS_REQUIRED_ROLES],
        guestRole: TEAMS_GUEST_ROLE,
      },
    });
  }

  if (body.type === "save") {
    const months = body.maxLifetimeMonths;
    if (
      typeof months !== "number" ||
      !Number.isInteger(months) ||
      months < 1 ||
      months > 60 ||
      typeof body.allowGuests !== "boolean"
    ) {
      return fail(request, "invalid_request", 400);
    }
    const { error } = await admin.from("tenant_teams_settings").upsert(
      {
        tenant_id: tenantId,
        max_lifetime_months: months,
        allow_guests: body.allowGuests,
        updated_by: actorId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "tenant_id" },
    );
    if (error) return fail(request, "teams_settings_failed", 500);
    await admin.from("audit_logs").insert({
      tenant_id: tenantId,
      actor_id: actorId,
      action: "teams.settings.updated",
      entity_type: "tenant_teams_settings",
      entity_id: tenantId,
      severity: "info",
      before_data: null,
      after_data: { maxLifetimeMonths: months, allowGuests: body.allowGuests },
      metadata: {},
    });
    return json(request, { data: { saved: true } });
  }

  if (body.type === "check") {
    const entraTenant = await teamsEntraTenant(admin, tenantId);
    const clientId = teamsClientId();
    const link = consentUrl(entraTenant, clientId);
    const base = { consentUrl: link, requiredRoles: [...TEAMS_REQUIRED_ROLES] };
    if (!teamsCredentialsConfigured()) {
      return json(request, { data: { ...base, state: "platform_not_configured", missingRoles: [] } });
    }
    if (!entraTenant) {
      return json(request, { data: { ...base, state: "sso_missing", missingRoles: [] } });
    }
    try {
      const roles = tokenRoles(await teamsGraphToken(admin, tenantId));
      const missing = TEAMS_REQUIRED_ROLES.filter((role) => !roles.includes(role));
      const settings = await loadTeamsSettings(admin, tenantId);
      const guestMissing = settings.allowGuests && !roles.includes(TEAMS_GUEST_ROLE);
      return json(request, {
        data: {
          ...base,
          state: missing.length === 0 ? (guestMissing ? "guest_role_missing" : "ok") : "roles_missing",
          missingRoles: guestMissing ? [...missing, TEAMS_GUEST_ROLE] : missing,
        },
      });
    } catch (error) {
      const code = error instanceof TeamsGraphError ? error.code : "unavailable";
      return json(request, {
        data: {
          ...base,
          // 400/401 beim Token: App im Mandanten noch nicht freigegeben.
          state: code === "token_failed" ? "not_consented" : code,
          missingRoles: [],
        },
      });
    }
  }

  return fail(request, "invalid_request", 400);
});

export default {
  fetch(request: Request): Response | Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: headers(request) });
    }
    return handler(request);
  },
};
