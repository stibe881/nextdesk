import { withSupabase } from "@supabase/server";
import { resolveTenantFeatureStates } from "../_shared/tenant-features.ts";

type Action =
  | { type: "heartbeat"; tenantId: string; ticketId: string; editing: boolean }
  | { type: "list"; tenantId: string; ticketId: string };
type PermissionCode = "ticket.read.assigned" | "ticket.read.department";

const APP_ORIGIN = "https://app.nextdesk.ch";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRESENCE_VISIBLE_FOR_MS = 90_000;
const PRESENCE_RETENTION_MS = 180_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function response(
  request: Request,
  body: Record<string, unknown>,
  status = 200,
): Response {
  const origin = request.headers.get("origin");
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: {
      "Access-Control-Allow-Origin": origin === APP_ORIGIN ? APP_ORIGIN : "",
      "Access-Control-Allow-Headers":
        "authorization, apikey, content-type, x-client-info",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Content-Type": "application/json; charset=utf-8",
      Vary: "Origin",
    },
  });
}

function parseAction(value: unknown): Action | null {
  if (!isRecord(value) || !isUuid(value.tenantId) || !isUuid(value.ticketId)) {
    return null;
  }
  if (value.type === "list") {
    return {
      type: value.type,
      tenantId: value.tenantId,
      ticketId: value.ticketId,
    };
  }
  if (value.type === "heartbeat" && typeof value.editing === "boolean") {
    return {
      type: value.type,
      tenantId: value.tenantId,
      ticketId: value.ticketId,
      editing: value.editing,
    };
  }
  return null;
}

async function isActiveTenantMember(
  admin: any,
  userId: string,
  tenantId: string,
): Promise<boolean> {
  const { data, error } = await admin
    .from("tenant_memberships")
    .select("user_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  return !error && Boolean(data);
}

async function hasTicketPermission(
  admin: any,
  userId: string,
  tenantId: string,
  departmentId: string,
  permission: PermissionCode,
): Promise<boolean> {
  const now = new Date().toISOString();
  const [{ data: departmentMembership }, { data: assignments, error }] =
    await Promise.all([
      admin
        .from("department_memberships")
        .select("user_id")
        .eq("tenant_id", tenantId)
        .eq("department_id", departmentId)
        .eq("user_id", userId)
        .eq("status", "active")
        .maybeSingle(),
      admin
        .from("user_role_assignments")
        .select(
          "department_id, roles!user_role_assignments_role_tenant_fk!inner(tenant_id, active, scope, role_permissions!inner(permission_code))",
        )
        .eq("tenant_id", tenantId)
        .eq("user_id", userId)
        .lte("starts_at", now)
        .or(`expires_at.is.null,expires_at.gt.${now}`),
    ]);
  if (error) return false;

  return (assignments ?? []).some((assignment: any) => {
    const role = Array.isArray(assignment.roles)
      ? assignment.roles[0]
      : assignment.roles;
    const applies =
      role?.scope === "tenant" ||
      (role?.scope === "department" &&
        assignment.department_id === departmentId &&
        Boolean(departmentMembership));
    return (
      role?.tenant_id === tenantId &&
      role?.active === true &&
      applies &&
      (role.role_permissions ?? []).some(
        (entry: any) => entry.permission_code === permission,
      )
    );
  });
}

async function canReadTicket(admin: any, userId: string, ticket: any) {
  if (!(await isActiveTenantMember(admin, userId, ticket.tenant_id))) {
    return false;
  }
  if (ticket.requester_id === userId || ticket.affected_user_id === userId) {
    return true;
  }
  if (
    ticket.assigned_agent_id === userId &&
    (await hasTicketPermission(
      admin,
      userId,
      ticket.tenant_id,
      ticket.department_id,
      "ticket.read.assigned",
    ))
  ) {
    return true;
  }
  if (
    await hasTicketPermission(
      admin,
      userId,
      ticket.tenant_id,
      ticket.department_id,
      "ticket.read.department",
    )
  ) {
    return true;
  }
  if (!ticket.customer_organization_id) return false;

  const { data } = await admin
    .from("customer_memberships")
    .select("access, customer_organizations!inner(active, ticket_access)")
    .eq("customer_organization_id", ticket.customer_organization_id)
    .eq("user_id", userId)
    .maybeSingle();
  return Boolean(
    data?.access === "company" &&
    data.customer_organizations?.active &&
    data.customer_organizations?.ticket_access !== "disabled",
  );
}

const handler = withSupabase({ auth: "user" }, async (request, context) => {
  if (request.method !== "POST") {
    return response(request, { error: { code: "method_not_allowed" } }, 405);
  }
  const action = parseAction(await request.json().catch(() => null));
  const actorId = context.userClaims?.id;
  if (!action || !isUuid(actorId)) {
    return response(request, { error: { code: "invalid_request" } }, 400);
  }

  const admin = context.supabaseAdmin;
  const { data: ticket, error: ticketError } = await admin
    .from("tickets")
    .select(
      "id, tenant_id, department_id, assigned_team_id, requester_id, affected_user_id, assigned_agent_id, customer_organization_id",
    )
    .eq("id", action.ticketId)
    .eq("tenant_id", action.tenantId)
    .maybeSingle();
  if (ticketError) {
    return response(
      request,
      {
        error: { code: "ticket_presence_lookup_failed" },
      },
      500,
    );
  }
  if (!ticket || !(await canReadTicket(admin, actorId, ticket))) {
    return response(request, { error: { code: "ticket_not_found" } }, 404);
  }
  if (ticket.assigned_team_id) {
    const { data: teamAllowed, error: teamAllowedError } =
      await context.supabase.rpc("can_access_ticket_team", {
        p_ticket_id: ticket.id,
      });
    if (teamAllowedError || teamAllowed !== true)
      return response(request, { error: { code: "ticket_not_found" } }, 404);
  }

  const featureStates = await resolveTenantFeatureStates(
    admin,
    ticket.tenant_id,
    ["ticketing.detail"],
  );
  if (!featureStates)
    return response(
      request,
      { error: { code: "tenant_feature_lookup_failed" } },
      503,
    );
  if (featureStates["ticketing.detail"] !== true)
    return response(
      request,
      { error: { code: "ticket_feature_disabled" } },
      403,
    );

  const now = new Date();
  const visibleSince = new Date(
    now.getTime() - PRESENCE_VISIBLE_FOR_MS,
  ).toISOString();
  const expiresBefore = new Date(
    now.getTime() - PRESENCE_RETENTION_MS,
  ).toISOString();

  if (action.type === "heartbeat") {
    const [{ error: cleanupError }, { error: heartbeatError }] =
      await Promise.all([
        admin
          .from("ticket_presence_sessions")
          .delete()
          .eq("ticket_id", ticket.id)
          .lt("last_seen_at", expiresBefore),
        admin.from("ticket_presence_sessions").upsert(
          {
            ticket_id: ticket.id,
            tenant_id: ticket.tenant_id,
            user_id: actorId,
            is_editing: action.editing,
            last_seen_at: now.toISOString(),
          },
          { onConflict: "ticket_id,user_id" },
        ),
      ]);
    if (cleanupError || heartbeatError) {
      return response(
        request,
        { error: { code: "ticket_presence_save_failed" } },
        500,
      );
    }
    return response(request, { data: { active: true } });
  }

  const { data: sessions, error: sessionError } = await admin
    .from("ticket_presence_sessions")
    .select("user_id, is_editing, last_seen_at")
    .eq("ticket_id", ticket.id)
    .eq("tenant_id", ticket.tenant_id)
    .neq("user_id", actorId)
    .gte("last_seen_at", visibleSince)
    .order("is_editing", { ascending: false })
    .order("last_seen_at", { ascending: false })
    .limit(20);
  if (sessionError) {
    return response(
      request,
      {
        error: { code: "ticket_presence_lookup_failed" },
      },
      500,
    );
  }
  const userIds = (sessions ?? [])
    .map((session: any) => session.user_id)
    .filter(isUuid);
  const { data: profiles, error: profileError } = userIds.length
    ? await admin
        .from("user_profiles")
        .select("id, display_name")
        .in("id", userIds)
    : { data: [], error: null };
  if (profileError) {
    return response(
      request,
      {
        error: { code: "ticket_presence_lookup_failed" },
      },
      500,
    );
  }
  const names = new Map(
    (profiles ?? [])
      .filter((profile: any) => isUuid(profile.id))
      .map((profile: any) => [
        profile.id,
        typeof profile.display_name === "string" && profile.display_name.trim()
          ? profile.display_name.trim()
          : "Aktives Benutzerkonto",
      ]),
  );
  const people = (sessions ?? []).flatMap((session: any) => {
    if (!isUuid(session.user_id)) return [];
    const displayName = names.get(session.user_id);
    if (!displayName) return [];
    return [
      {
        displayName,
        editing: session.is_editing === true,
        lastSeenAt: session.last_seen_at,
      },
    ];
  });
  return response(request, { data: { people } });
});

export default {
  fetch(request: Request): Response | Promise<Response> {
    if (request.method === "OPTIONS") return response(request, {}, 204);
    return handler(request);
  },
};
