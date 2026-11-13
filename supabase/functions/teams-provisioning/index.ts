import { withSupabase } from "@supabase/server";
import {
  advanceRequest,
  REQUEST_COLUMNS,
  type TeamRequestRow,
  zurichToday,
} from "../_shared/teams-lifecycle.ts";
import {
  addMonths,
  daysBetween,
  isExtensionMonths,
  TEAM_LIMITS,
  validateTeamRequest,
} from "../_shared/teams-model.ts";
import {
  teamsCredentialsConfigured,
  teamsEntraTenant,
} from "../_shared/teams-token.ts";
import { loadTeamsSettings, TEAMS_FEATURE } from "../_shared/teams-settings.ts";
import { resolveTenantFeatureStates } from "../_shared/tenant-features.ts";

/**
 * Shop-Artikel «Microsoft Teams: neues Team» (Wizard, Bestellung, Verlängern).
 * Aktionen (POST, JWT):
 *   getContext   { tenantId }
 *   searchPeople { tenantId, query }
 *   createRequest{ tenantId, request }
 *   listMine     { tenantId }
 *   extend       { tenantId, requestId, months }
 * Angelegt wird das Team über Microsoft Graph (teams-lifecycle / Sofortlauf).
 */

const APP_ORIGIN = "https://app.nextdesk.ch";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHOP_FEATURE = "self_service.shop";

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

function json(request: Request, body: Row, status = 200): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: headers(request),
  });
}

function fail(request: Request, code: string, status = 422, extra: Row = {}) {
  return json(request, { error: { code, ...extra } }, status);
}

function isRecord(value: unknown): value is Row {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

async function canOrder(
  admin: Admin,
  actorId: string,
  tenantId: string,
): Promise<boolean> {
  const { data, error } = await admin.rpc("shop_has_permission", {
    p_user_id: actorId,
    p_tenant_id: tenantId,
    p_permission_code: "shop.order",
  });
  return !error && data === true;
}

/** Entra-Objekt-Id der Person (für «bin ich Owner?»). */
async function ownEntraIds(
  admin: Admin,
  tenantId: string,
  actorId: string,
): Promise<string[]> {
  const { data } = await admin
    .from("tenant_entra_directory_people")
    .select("entra_object_id")
    .eq("tenant_id", tenantId)
    .eq("local_user_id", actorId);
  return ((data ?? []) as Row[])
    .map((row) => row.entra_object_id)
    .filter((id): id is string => typeof id === "string");
}

function present(row: Row, owners: Map<string, string>) {
  const ownerIds = Array.isArray(row.owner_ids) ? (row.owner_ids as string[]) : [];
  const today = zurichToday();
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    visibility: row.visibility,
    allowGuests: row.allow_guests === true,
    status: row.status,
    startDate: row.start_date,
    endDate: row.end_date,
    daysLeft:
      row.status === "ready" ? daysBetween(today, String(row.end_date)) : null,
    owners: ownerIds.map((id) => owners.get(id) ?? "Unbekannt"),
    memberCount: Array.isArray(row.member_ids) ? row.member_ids.length : 0,
    guestCount: Array.isArray(row.guest_emails) ? row.guest_emails.length : 0,
    channelCount: Array.isArray(row.channels) ? row.channels.length : 0,
    warningCount: Array.isArray(row.warnings) ? row.warnings.length : 0,
    failed: row.status === "failed",
    createdAt: row.created_at,
  };
}

async function directoryNames(
  admin: Admin,
  tenantId: string,
  ids: string[],
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (ids.length === 0) return names;
  const { data } = await admin
    .from("tenant_entra_directory_people")
    .select("entra_object_id, display_name")
    .eq("tenant_id", tenantId)
    .in("entra_object_id", ids);
  for (const person of (data ?? []) as Row[]) {
    if (typeof person.entra_object_id === "string") {
      names.set(person.entra_object_id, String(person.display_name ?? ""));
    }
  }
  return names;
}

const handler = withSupabase({ auth: "user" }, async (request, context) => {
  if (request.method !== "POST") return fail(request, "method_not_allowed", 405);
  const body: unknown = await request.json().catch(() => null);
  const actorId = context.userClaims?.id;
  if (
    !isRecord(body) ||
    typeof body.type !== "string" ||
    !isUuid(body.tenantId) ||
    !isUuid(actorId)
  ) {
    return fail(request, "invalid_request", 400);
  }
  const admin = context.supabaseAdmin;
  const tenantId = body.tenantId.toLowerCase();

  const { data: membership } = await admin
    .from("tenant_memberships")
    .select("user_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", actorId)
    .eq("status", "active")
    .maybeSingle();
  if (!membership) return fail(request, "teams_tenant_access_denied", 403);

  const features = await resolveTenantFeatureStates(admin, tenantId, [
    SHOP_FEATURE,
    TEAMS_FEATURE,
  ]);
  if (!features) return fail(request, "teams_unavailable", 503);
  const shopEnabled = features[SHOP_FEATURE] === true;
  const teamsEnabled = features[TEAMS_FEATURE] === true;
  const settings = await loadTeamsSettings(admin, tenantId);

  if (body.type === "getContext") {
    const ordering =
      shopEnabled && teamsEnabled && (await canOrder(admin, actorId, tenantId));
    const configured =
      teamsCredentialsConfigured() &&
      (await teamsEntraTenant(admin, tenantId)) !== null;
    const { data: self } = await admin
      .from("tenant_entra_directory_people")
      .select("entra_object_id, display_name, email")
      .eq("tenant_id", tenantId)
      .eq("local_user_id", actorId)
      .eq("account_enabled", true)
      .is("inactive_at", null)
      .limit(1)
      .maybeSingle();
    return json(request, {
      data: {
        me: self
          ? {
              id: self.entra_object_id,
              displayName: self.display_name,
              email: self.email ?? null,
            }
          : null,
        available: ordering && configured,
        reason: !shopEnabled || !teamsEnabled
          ? "feature_disabled"
          : !ordering
            ? "denied"
            : !configured
              ? "not_configured"
              : null,
        today: zurichToday(),
        maxLifetimeMonths: settings.maxLifetimeMonths,
        allowGuests: settings.allowGuests,
        limits: TEAM_LIMITS,
      },
    });
  }

  if (!shopEnabled || !teamsEnabled) {
    return fail(request, "feature_disabled", 403);
  }

  if (body.type === "searchPeople") {
    if (!(await canOrder(admin, actorId, tenantId))) {
      return fail(request, "teams_order_denied", 403);
    }
    const query =
      typeof body.query === "string"
        ? body.query.replace(/[%_\\,()]/g, " ").trim().slice(0, 80)
        : "";
    if ([...query].length < 2) return json(request, { data: { people: [] } });
    const { data, error } = await admin
      .from("tenant_entra_directory_people")
      .select("entra_object_id, display_name, email, job_title")
      .eq("tenant_id", tenantId)
      .eq("account_enabled", true)
      .is("inactive_at", null)
      .or(`display_name.ilike.%${query}%,email.ilike.%${query}%`)
      .order("display_name", { ascending: true })
      .limit(15);
    if (error) return fail(request, "teams_search_failed", 500);
    return json(request, {
      data: {
        people: ((data ?? []) as Row[]).map((person) => ({
          id: person.entra_object_id,
          displayName: person.display_name,
          email: person.email ?? null,
          jobTitle: person.job_title ?? null,
        })),
      },
    });
  }

  if (body.type === "createRequest") {
    if (!(await canOrder(admin, actorId, tenantId))) {
      return fail(request, "teams_order_denied", 403);
    }
    const today = zurichToday();
    const parsed = validateTeamRequest(body.request, today, {
      maxLifetimeMonths: settings.maxLifetimeMonths,
      allowGuests: settings.allowGuests,
    });
    if (!parsed.ok) {
      return fail(request, parsed.code, 422, { field: parsed.field ?? null });
    }
    const value = parsed.value;
    const people = [...new Set([...value.owners, ...value.members])];
    const { data: known } = await admin
      .from("tenant_entra_directory_people")
      .select("entra_object_id")
      .eq("tenant_id", tenantId)
      .eq("account_enabled", true)
      .is("inactive_at", null)
      .in("entra_object_id", people);
    if ((known ?? []).length !== people.length) {
      return fail(request, "person_unknown", 422, { field: "members" });
    }
    if (!(await teamsEntraTenant(admin, tenantId)) || !teamsCredentialsConfigured()) {
      return fail(request, "teams_not_configured", 503);
    }
    const { data: created, error } = await admin
      .from("teams_requests")
      .insert({
        tenant_id: tenantId,
        requested_by: actorId,
        name: value.name,
        description: value.description,
        visibility: value.visibility,
        allow_guests: value.allowGuests,
        channels: value.channels,
        owner_ids: value.owners,
        member_ids: value.members,
        guest_emails: value.guests,
        start_date: value.startDate,
        end_date: value.endDate,
      })
      .select(REQUEST_COLUMNS)
      .single();
    if (error || !created) return fail(request, "teams_request_failed", 500);
    await admin.from("audit_logs").insert({
      tenant_id: tenantId,
      actor_id: actorId,
      action: "teams.request.created",
      entity_type: "teams_request",
      entity_id: created.id,
      severity: "info",
      before_data: null,
      after_data: {
        name: value.name,
        visibility: value.visibility,
        startDate: value.startDate,
        endDate: value.endDate,
      },
      metadata: {},
    });
    // Beginnt das Team heute, wird es sofort angelegt (im Hintergrund).
    if (value.startDate <= today) {
      const work = advanceRequest(admin, created as TeamRequestRow, {
        inline: true,
      }).catch(() => undefined);
      // deno-lint-ignore no-explicit-any
      const runtime = (globalThis as any).EdgeRuntime;
      if (runtime?.waitUntil) runtime.waitUntil(work);
    }
    return json(
      request,
      { data: { id: created.id, status: created.status } },
      201,
    );
  }

  if (body.type === "listMine") {
    const entraIds = await ownEntraIds(admin, tenantId, actorId);
    const filters = [`requested_by.eq.${actorId}`];
    if (entraIds.length > 0) {
      filters.push(`owner_ids.ov.{${entraIds.join(",")}}`);
    }
    const { data, error } = await admin
      .from("teams_requests")
      .select(
        "id, name, description, visibility, allow_guests, status, start_date, end_date, owner_ids, member_ids, guest_emails, channels, warnings, created_at",
      )
      .eq("tenant_id", tenantId)
      .or(filters.join(","))
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) return fail(request, "teams_list_failed", 500);
    const rows = (data ?? []) as Row[];
    const owners = await directoryNames(
      admin,
      tenantId,
      [...new Set(rows.flatMap((row) => (row.owner_ids as string[]) ?? []))],
    );
    return json(request, {
      data: { requests: rows.map((row) => present(row, owners)) },
    });
  }

  if (body.type === "extend") {
    if (!isUuid(body.requestId) || !isExtensionMonths(body.months)) {
      return fail(request, "invalid_request", 400);
    }
    const { data: row } = await admin
      .from("teams_requests")
      .select(REQUEST_COLUMNS)
      .eq("id", body.requestId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (!row) return fail(request, "teams_request_not_found", 404);
    const entraIds = await ownEntraIds(admin, tenantId, actorId);
    const isOwner =
      row.requested_by === actorId ||
      (row.owner_ids as string[]).some((id) => entraIds.includes(id));
    if (!isOwner) return fail(request, "teams_extend_denied", 403);
    if (row.status !== "ready") {
      return fail(request, "teams_extend_not_possible", 409);
    }
    const next = addMonths(row.end_date, body.months);
    // Eine Verlängerung ist eine neue Prüfung: Obergrenze nur der Horizont, nicht die Bestelldauer.
    const limit = addMonths(zurichToday(), TEAM_LIMITS.extensionHorizonMonths);
    if (!next || !limit || next > limit) {
      return fail(request, "lifetime_too_long", 422);
    }
    const { error } = await admin
      .from("teams_requests")
      .update({
        end_date: next,
        reminded_14_at: null,
        reminded_7_at: null,
        reminded_1_at: null,
      })
      .eq("id", row.id)
      .eq("status", "ready");
    if (error) return fail(request, "teams_extend_failed", 500);
    await admin.from("audit_logs").insert({
      tenant_id: tenantId,
      actor_id: actorId,
      action: "teams.request.extended",
      entity_type: "teams_request",
      entity_id: row.id,
      severity: "info",
      before_data: { endDate: row.end_date },
      after_data: { endDate: next },
      metadata: { months: body.months },
    });
    return json(request, { data: { endDate: next } });
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
