import { withSupabase } from "@supabase/server";
import { resolveTenantFeatureStates } from "../_shared/tenant-features.ts";

type Action =
  | { type: "list"; tenantId: string; ticketId: string }
  | { type: "listForDepartment"; tenantId: string; departmentId: string }
  | {
      type: "assign";
      tenantId: string;
      ticketId: string;
      assignedAgentId: string | null;
    };

type PermissionCode =
  "ticket.assign" | "ticket.read.assigned" | "ticket.update";

type TicketAgent = {
  id: string;
  displayName: string;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isUuid = (value: unknown): value is string =>
  typeof value === "string" && UUID_PATTERN.test(value);

function response(
  request: Request,
  body: Record<string, unknown>,
  status = 200,
): Response {
  const origin = request.headers.get("origin");
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: {
      "Access-Control-Allow-Origin":
        origin === "https://app.nextdesk.ch" ? origin : "",
      "Access-Control-Allow-Headers":
        "authorization, apikey, content-type, x-client-info",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Content-Type": "application/json; charset=utf-8",
      Vary: "Origin",
    },
  });
}

function parseAction(value: unknown): Action | null {
  if (!isRecord(value) || !isUuid(value.tenantId)) {
    return null;
  }
  if (value.type === "list" && isUuid(value.ticketId)) {
    return {
      type: value.type,
      tenantId: value.tenantId,
      ticketId: value.ticketId,
    };
  }
  if (value.type === "listForDepartment" && isUuid(value.departmentId)) {
    return {
      type: value.type,
      tenantId: value.tenantId,
      departmentId: value.departmentId,
    };
  }
  if (
    value.type === "assign" &&
    isUuid(value.ticketId) &&
    (value.assignedAgentId === null || isUuid(value.assignedAgentId))
  ) {
    return {
      type: value.type,
      tenantId: value.tenantId,
      ticketId: value.ticketId,
      assignedAgentId: value.assignedAgentId,
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
): Promise<{ allowed: boolean; error: boolean }> {
  const now = new Date().toISOString();
  const [
    { data: departmentMembership, error: departmentMembershipError },
    { data: roleAssignments, error: roleAssignmentsError },
  ] = await Promise.all([
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
  if (departmentMembershipError || roleAssignmentsError) {
    return { allowed: false, error: true };
  }

  const allowed = (roleAssignments ?? []).some((assignment: any) => {
    const role = Array.isArray(assignment.roles)
      ? assignment.roles[0]
      : assignment.roles;
    const roleApplies =
      role?.scope === "tenant" ||
      (role?.scope === "department" &&
        assignment.department_id === departmentId &&
        Boolean(departmentMembership));
    return (
      role?.tenant_id === tenantId &&
      role.active === true &&
      roleApplies &&
      (role.role_permissions ?? []).some(
        (item: any) => item.permission_code === permission,
      )
    );
  });
  return { allowed, error: false };
}

async function listAssignableAgents(
  admin: any,
  tenantId: string,
  departmentId: string,
): Promise<{ agents: TicketAgent[]; error: boolean }> {
  const now = new Date().toISOString();
  const [
    { data: tenantMemberships, error: tenantMembershipsError },
    { data: departmentMemberships, error: departmentMembershipsError },
    { data: roleAssignments, error: roleAssignmentsError },
  ] = await Promise.all([
    admin
      .from("tenant_memberships")
      .select("user_id")
      .eq("tenant_id", tenantId)
      .eq("status", "active"),
    admin
      .from("department_memberships")
      .select("user_id")
      .eq("tenant_id", tenantId)
      .eq("department_id", departmentId)
      .eq("status", "active"),
    admin
      .from("user_role_assignments")
      .select(
        "user_id, department_id, roles!user_role_assignments_role_tenant_fk!inner(tenant_id, active, scope, role_permissions!inner(permission_code))",
      )
      .eq("tenant_id", tenantId)
      .lte("starts_at", now)
      .or(`expires_at.is.null,expires_at.gt.${now}`),
  ]);
  if (
    tenantMembershipsError ||
    departmentMembershipsError ||
    roleAssignmentsError
  ) {
    return { agents: [], error: true };
  }

  const activeTenantMemberIds = new Set(
    (tenantMemberships ?? []).flatMap((membership: any) =>
      isUuid(membership.user_id) ? [membership.user_id] : [],
    ),
  );
  const activeDepartmentMemberIds = new Set(
    (departmentMemberships ?? []).flatMap((membership: any) =>
      isUuid(membership.user_id) ? [membership.user_id] : [],
    ),
  );
  const agentIds = new Set<string>();
  for (const assignment of roleAssignments ?? []) {
    if (
      !isUuid(assignment.user_id) ||
      !activeTenantMemberIds.has(assignment.user_id)
    ) {
      continue;
    }
    const role = Array.isArray(assignment.roles)
      ? assignment.roles[0]
      : assignment.roles;
    const canHandleAssignedTickets = (role?.role_permissions ?? []).some(
      (permission: any) =>
        permission.permission_code === "ticket.read.assigned" ||
        permission.permission_code === "ticket.update",
    );
    const tenantScopedAgent =
      role?.tenant_id === tenantId &&
      role?.active === true &&
      role.scope === "tenant";
    const departmentScopedAgent =
      role?.tenant_id === tenantId &&
      role?.active === true &&
      role.scope === "department" &&
      assignment.department_id === departmentId &&
      activeDepartmentMemberIds.has(assignment.user_id);
    if (
      canHandleAssignedTickets &&
      (tenantScopedAgent || departmentScopedAgent)
    ) {
      agentIds.add(assignment.user_id);
    }
  }
  if (agentIds.size === 0) return { agents: [], error: false };

  const { data: profiles, error: profilesError } = await admin
    .from("user_profiles")
    .select("id, display_name")
    .in("id", [...agentIds]);
  if (profilesError) return { agents: [], error: true };

  const profileNames = new Map<string, string>();
  for (const profile of profiles ?? []) {
    if (!isUuid(profile.id)) continue;
    if (
      typeof profile.display_name === "string" &&
      profile.display_name.trim()
    ) {
      profileNames.set(profile.id, profile.display_name.trim());
    }
  }
  const agents = [...agentIds].map((id) => ({
    id,
    displayName: profileNames.get(id) ?? "Aktiver Agent",
  }));
  agents.sort(
    (left, right) =>
      left.displayName.localeCompare(right.displayName, "de-CH", {
        sensitivity: "base",
      }) || left.id.localeCompare(right.id),
  );
  return { agents, error: false };
}

const handler = withSupabase({ auth: "user" }, async (request, context) => {
  if (request.method !== "POST") {
    return response(request, { error: { code: "method_not_allowed" } }, 405);
  }
  const action = parseAction(await request.json().catch(() => null));
  const actorId = context.userClaims?.id;
  if (!action || typeof actorId !== "string") {
    return response(request, { error: { code: "invalid_request" } }, 400);
  }
  if (
    !(await isActiveTenantMember(
      context.supabaseAdmin,
      actorId,
      action.tenantId,
    ))
  ) {
    return response(
      request,
      { error: { code: "tenant_membership_required" } },
      403,
    );
  }

  if (action.type !== "listForDepartment") {
    const featureStates = await resolveTenantFeatureStates(
      context.supabaseAdmin,
      action.tenantId,
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
  }

  if (action.type === "listForDepartment") {
    const { data: department, error: departmentError } =
      await context.supabaseAdmin
        .from("departments")
        .select("id")
        .eq("id", action.departmentId)
        .eq("tenant_id", action.tenantId)
        .eq("active", true)
        .maybeSingle();
    if (departmentError) {
      return response(
        request,
        { error: { code: "ticket_agents_lookup_failed" } },
        500,
      );
    }
    if (!department) {
      return response(
        request,
        { error: { code: "ticket_reference_missing" } },
        422,
      );
    }

    const canAssign = await hasTicketPermission(
      context.supabaseAdmin,
      actorId,
      action.tenantId,
      action.departmentId,
      "ticket.assign",
    );
    if (canAssign.error) {
      return response(
        request,
        { error: { code: "ticket_agents_lookup_failed" } },
        500,
      );
    }
    if (!canAssign.allowed) {
      return response(
        request,
        { error: { code: "ticket_assign_denied" } },
        403,
      );
    }

    const candidates = await listAssignableAgents(
      context.supabaseAdmin,
      action.tenantId,
      action.departmentId,
    );
    if (candidates.error) {
      return response(
        request,
        { error: { code: "ticket_agents_lookup_failed" } },
        500,
      );
    }
    return response(request, { data: { agents: candidates.agents } });
  }

  const { data: ticket, error: ticketError } = await context.supabaseAdmin
    .from("tickets")
    .select("id, tenant_id, department_id, assigned_agent_id")
    .eq("id", action.ticketId)
    .eq("tenant_id", action.tenantId)
    .maybeSingle();
  if (ticketError) {
    return response(request, { error: { code: "ticket_lookup_failed" } }, 500);
  }
  if (!ticket) {
    return response(request, { error: { code: "ticket_not_found" } }, 404);
  }

  const canAssign = await hasTicketPermission(
    context.supabaseAdmin,
    actorId,
    ticket.tenant_id,
    ticket.department_id,
    "ticket.assign",
  );
  if (canAssign.error) {
    return response(
      request,
      { error: { code: "ticket_agents_lookup_failed" } },
      500,
    );
  }
  if (!canAssign.allowed) {
    return response(request, { error: { code: "ticket_assign_denied" } }, 403);
  }

  const candidates = await listAssignableAgents(
    context.supabaseAdmin,
    ticket.tenant_id,
    ticket.department_id,
  );
  if (candidates.error) {
    return response(
      request,
      { error: { code: "ticket_agents_lookup_failed" } },
      500,
    );
  }
  if (action.type === "list") {
    return response(request, { data: { agents: candidates.agents } });
  }

  if (
    action.assignedAgentId !== null &&
    !candidates.agents.some((agent) => agent.id === action.assignedAgentId)
  ) {
    return response(
      request,
      { error: { code: "assigned_agent_invalid" } },
      422,
    );
  }
  if (action.assignedAgentId === (ticket.assigned_agent_id ?? null)) {
    return response(request, { data: { updated: false } });
  }

  const { error: updateError } = await context.supabaseAdmin
    .from("tickets")
    .update({ assigned_agent_id: action.assignedAgentId })
    .eq("id", ticket.id)
    .eq("tenant_id", ticket.tenant_id)
    // Lets the push trigger recognise the acting person behind service writes.
    .setHeader(
      "x-nextdesk-actor-id",
      typeof actorId === "string" ? actorId : "",
    );
  if (updateError) {
    return response(request, { error: { code: "ticket_update_failed" } }, 422);
  }
  const { error: eventError } = await context.supabaseAdmin
    .from("ticket_events")
    .insert({
      ticket_id: ticket.id,
      actor_id: actorId,
      event_type: "ticket.updated",
      payload: {
        changedFields: ["assignedAgent"],
        previousAssignedAgentId: ticket.assigned_agent_id ?? null,
        assignedAgentId: action.assignedAgentId,
      },
    });
  if (eventError) {
    return response(request, { error: { code: "ticket_audit_failed" } }, 500);
  }
  return response(request, {
    data: { updated: true, assignedAgentId: action.assignedAgentId },
  });
});

export default {
  fetch(request: Request): Response | Promise<Response> {
    if (request.method === "OPTIONS") return response(request, {}, 204);
    return handler(request);
  },
};
