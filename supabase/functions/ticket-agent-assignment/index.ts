import { withSupabase } from "@supabase/server";
import { resolveTenantFeatureStates } from "../_shared/tenant-features.ts";
import { listAssignableAgents } from "../_shared/assignable-agents.ts";

type Action =
  | { type: "list"; tenantId: string; ticketId: string }
  | { type: "listForDepartment"; tenantId: string; departmentId: string }
  | {
      type: "listForTenant";
      includeAgents: boolean;
      tenantId: string;
      ticketIds: string[];
    }
  | {
      type: "assign";
      tenantId: string;
      ticketId: string;
      assignedAgentId: string | null;
    };

type PermissionCode =
  | "ticket.assign"
  | "ticket.read.assigned"
  | "ticket.read.department"
  | "ticket.update";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isUuid = (value: unknown): value is string =>
  typeof value === "string" && UUID_PATTERN.test(value);

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
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
    value.type === "listForTenant" &&
    hasOnlyKeys(value, ["type", "tenantId", "ticketIds", "includeAgents"]) &&
    Array.isArray(value.ticketIds) &&
    value.ticketIds.length <= 50 &&
    value.ticketIds.every(isUuid) &&
    new Set(value.ticketIds).size === value.ticketIds.length &&
    typeof value.includeAgents === "boolean"
  ) {
    return {
      includeAgents: value.includeAgents,
      type: value.type,
      tenantId: value.tenantId,
      ticketIds: value.ticketIds,
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
  const [
    { data: membership, error: membershipError },
    { data: tenant, error: tenantError },
  ] = await Promise.all([
    admin
      .from("tenant_memberships")
      .select("user_id")
      .eq("tenant_id", tenantId)
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle(),
    admin
      .from("tenants")
      .select("id")
      .eq("id", tenantId)
      .eq("status", "active")
      .maybeSingle(),
  ]);
  return (
    !membershipError && !tenantError && Boolean(membership) && Boolean(tenant)
  );
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
      Boolean(departmentMembership) &&
      (role?.scope === "tenant" ||
        (role?.scope === "department" &&
          assignment.department_id === departmentId));
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

  if (action.type === "listForTenant") {
    const departmentIds: string[] = [];
    const departmentPageSize = 250;
    for (let offset = 0; ; offset += departmentPageSize) {
      const { data: departments, error: departmentsError } =
        await context.supabaseAdmin
          .from("departments")
          .select("id")
          .eq("tenant_id", action.tenantId)
          .eq("active", true)
          .order("id", { ascending: true })
          .range(offset, offset + departmentPageSize - 1);
      if (departmentsError) {
        return response(
          request,
          { error: { code: "ticket_agents_lookup_failed" } },
          500,
        );
      }
      for (const department of departments ?? []) {
        if (isUuid(department.id)) departmentIds.push(department.id);
      }
      if ((departments ?? []).length < departmentPageSize) break;
    }
    const departmentAccess = new Map<string, boolean>();
    for (const departmentId of departmentIds) {
      const canRead = await hasTicketPermission(
        context.supabaseAdmin,
        actorId,
        action.tenantId,
        departmentId,
        "ticket.read.department",
      );
      if (canRead.error) {
        return response(
          request,
          { error: { code: "ticket_agents_lookup_failed" } },
          500,
        );
      }
      departmentAccess.set(departmentId, canRead.allowed);
    }

    const readableDepartmentIds = departmentIds.filter(
      (departmentId) => departmentAccess.get(departmentId) === true,
    );
    const agentsById = new Map<string, { id: string; displayName: string }>();
    if (action.includeAgents) {
      const candidateResults = await Promise.all(
        readableDepartmentIds.map((departmentId) =>
          listAssignableAgents(
            context.supabaseAdmin,
            action.tenantId,
            departmentId,
          ),
        ),
      );
      if (candidateResults.some((result) => result.error)) {
        return response(
          request,
          { error: { code: "ticket_agents_lookup_failed" } },
          500,
        );
      }
      for (const result of candidateResults) {
        for (const agent of result.agents) agentsById.set(agent.id, agent);
      }
    }

    const { data: tickets, error: ticketsError } =
      action.ticketIds.length > 0
        ? await context.supabaseAdmin
            .from("tickets")
            .select(
              "id, tenant_id, department_id, assigned_team_id, assigned_agent_id",
            )
            .eq("tenant_id", action.tenantId)
            .in("id", action.ticketIds)
        : { data: [], error: null };
    if (ticketsError) {
      return response(
        request,
        { error: { code: "ticket_agents_lookup_failed" } },
        500,
      );
    }
    const { data: teamMemberships, error: teamMembershipsError } =
      await context.supabaseAdmin
        .from("team_memberships")
        .select("team_id")
        .eq("tenant_id", action.tenantId)
        .eq("user_id", actorId);
    if (teamMembershipsError) {
      return response(
        request,
        { error: { code: "ticket_agents_lookup_failed" } },
        500,
      );
    }
    const teamMembershipIds = new Set(
      (teamMemberships ?? []).map((entry: any) => entry.team_id).filter(isUuid),
    );
    const assignedAgentIds = [
      ...new Set(
        (tickets ?? []).flatMap((ticket: any) =>
          ticket.tenant_id === action.tenantId &&
          departmentAccess.get(ticket.department_id) === true &&
          (ticket.assigned_team_id === null ||
            typeof ticket.assigned_team_id !== "string" ||
            teamMembershipIds.has(ticket.assigned_team_id)) &&
          isUuid(ticket.assigned_agent_id)
            ? [ticket.assigned_agent_id]
            : [],
        ),
      ),
    ];
    const assignedAgentNames: Record<string, string> = {};
    if (assignedAgentIds.length > 0) {
      const { data: profiles, error: profilesError } =
        await context.supabaseAdmin
          .from("user_profiles")
          .select("id, display_name")
          .in("id", assignedAgentIds);
      if (profilesError) {
        return response(
          request,
          { error: { code: "ticket_agents_lookup_failed" } },
          500,
        );
      }
      for (const profile of profiles ?? []) {
        if (
          isUuid(profile.id) &&
          typeof profile.display_name === "string" &&
          profile.display_name.trim()
        ) {
          assignedAgentNames[profile.id] = profile.display_name.trim();
        }
      }
    }

    const agents = [...agentsById.values()].sort(
      (left, right) =>
        left.displayName.localeCompare(right.displayName, "de-CH", {
          sensitivity: "base",
        }) || left.id.localeCompare(right.id),
    );
    return response(request, { data: { agents, assignedAgentNames } });
  }

  const { data: ticket, error: ticketError } = await context.supabaseAdmin
    .from("tickets")
    .select("id, tenant_id, department_id, assigned_team_id, assigned_agent_id")
    .eq("id", action.ticketId)
    .eq("tenant_id", action.tenantId)
    .maybeSingle();
  if (ticketError) {
    return response(request, { error: { code: "ticket_lookup_failed" } }, 500);
  }
  if (!ticket) {
    return response(request, { error: { code: "ticket_not_found" } }, 404);
  }
  const { data: readable, error: readableError } = await context.supabase.rpc(
    "can_read_ticket",
    { p_ticket_id: ticket.id },
  );
  if (readableError) {
    return response(
      request,
      { error: { code: "authorization_check_failed" } },
      500,
    );
  }
  if (readable !== true) {
    return response(request, { error: { code: "ticket_access_denied" } }, 403);
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

  const canUpdate = await hasTicketPermission(
    context.supabaseAdmin,
    actorId,
    ticket.tenant_id,
    ticket.department_id,
    "ticket.update",
  );
  if (canUpdate.error) {
    return response(
      request,
      { error: { code: "ticket_agents_lookup_failed" } },
      500,
    );
  }
  if (!canUpdate.allowed) {
    return response(request, { error: { code: "ticket_update_denied" } }, 403);
  }

  const candidates = await listAssignableAgents(
    context.supabaseAdmin,
    ticket.tenant_id,
    ticket.department_id,
    typeof ticket.assigned_team_id === "string"
      ? ticket.assigned_team_id
      : null,
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
