import { withSupabase } from "@supabase/server";

const APP_ORIGIN = "https://app.nextdesk.ch";
const REQUESTER_ROLE = "Requester";
const SUPPORT_AGENT_ROLE = "Support agent";
const TENANT_ADMINISTRATOR_ROLE = "Tenant administrator";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type PersonPayload = {
  displayName: string | null;
  jobTitle: string | null;
  offer: string | null;
  departmentId: string | null;
  isAgent: boolean;
};

type Action =
  | ({ type: "inviteUser"; tenantId: string; email: string } & PersonPayload)
  | { type: "acceptMyInvitations" }
  | { type: "listUsers"; tenantId: string }
  | ({ type: "updatePerson"; tenantId: string; userId: string } & PersonPayload)
  | { type: "getMyTicketAccess"; tenantId: string }
  | { type: "removeUser"; tenantId: string; userId: string }
  | { type: "revokeInvitation"; tenantId: string; invitationId: string };

type Membership = {
  user_id: string;
  status: string;
  joined_at: string | null;
};

type DirectoryProfile = {
  user_id: string;
  department_id: string | null;
  job_title: string | null;
  offer: string | null;
};

type AssignmentRole = {
  name: string;
  scope: string;
  active: boolean;
  role_permissions?: Array<{ permission_code: string }> | null;
};

type Assignment = {
  user_id: string;
  starts_at: string;
  expires_at: string | null;
  roles: AssignmentRole | AssignmentRole[] | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function json(request: Request, body: Record<string, unknown>, status = 200) {
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

function nullableText(
  value: unknown,
  minimum: number,
  maximum: number,
): string | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) return null;
  const length = Array.from(normalized).length;
  return length >= minimum && length <= maximum ? normalized : undefined;
}

function parsePersonPayload(
  value: Record<string, unknown>,
): PersonPayload | null {
  const displayName = nullableText(value.displayName, 2, 160);
  const jobTitle = nullableText(value.jobTitle, 2, 160);
  const offer = nullableText(value.offer, 2, 160);
  const departmentId = value.departmentId;
  const isAgent = value.isAgent === undefined ? false : value.isAgent;
  if (
    displayName === undefined ||
    jobTitle === undefined ||
    offer === undefined ||
    (departmentId !== null &&
      departmentId !== undefined &&
      !isUuid(departmentId)) ||
    typeof isAgent !== "boolean"
  ) {
    return null;
  }
  const normalizedDepartmentId =
    typeof departmentId === "string" ? departmentId : null;
  if (isAgent && !normalizedDepartmentId) return null;
  return {
    displayName,
    jobTitle,
    offer,
    departmentId: normalizedDepartmentId,
    isAgent,
  };
}

function parseAction(value: unknown): Action | null {
  if (!isRecord(value) || typeof value.type !== "string") return null;
  if (value.type === "acceptMyInvitations") return { type: value.type };
  if (value.type === "getMyTicketAccess" && isUuid(value.tenantId)) {
    return { type: value.type, tenantId: value.tenantId };
  }
  if (value.type === "listUsers" && isUuid(value.tenantId)) {
    return { type: value.type, tenantId: value.tenantId };
  }
  if (
    value.type === "removeUser" &&
    isUuid(value.tenantId) &&
    isUuid(value.userId)
  ) {
    return { type: value.type, tenantId: value.tenantId, userId: value.userId };
  }
  if (
    value.type === "revokeInvitation" &&
    isUuid(value.tenantId) &&
    isUuid(value.invitationId)
  ) {
    return {
      type: value.type,
      tenantId: value.tenantId,
      invitationId: value.invitationId,
    };
  }
  if (
    value.type === "inviteUser" &&
    isUuid(value.tenantId) &&
    typeof value.email === "string" &&
    /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value.email)
  ) {
    const person = parsePersonPayload(value);
    return person
      ? {
          type: value.type,
          tenantId: value.tenantId,
          email: value.email.trim().toLowerCase(),
          ...person,
        }
      : null;
  }
  if (
    value.type === "updatePerson" &&
    isUuid(value.tenantId) &&
    isUuid(value.userId)
  ) {
    const person = parsePersonPayload(value);
    return person
      ? {
          type: value.type,
          tenantId: value.tenantId,
          userId: value.userId,
          ...person,
        }
      : null;
  }
  return null;
}

function relatedRole(value: Assignment["roles"]): AssignmentRole | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function isEffectiveAssignment(
  assignment: Pick<Assignment, "starts_at" | "expires_at">,
  now: string,
): boolean {
  return (
    assignment.starts_at <= now &&
    (assignment.expires_at === null || assignment.expires_at > now)
  );
}

function roleCanWorkTickets(role: AssignmentRole | null): boolean {
  if (!role?.active) return false;
  const permissions = new Set(
    (role.role_permissions ?? [])
      .map((permission) => permission.permission_code)
      .filter((code): code is string => typeof code === "string"),
  );
  return (
    permissions.has("ticket.read.department") ||
    permissions.has("ticket.read.assigned") ||
    permissions.has("ticket.update")
  );
}

async function isTenantAdministrator(
  admin: any,
  userId: string,
  tenantId: string,
) {
  const { data: membership } = await admin
    .from("tenant_memberships")
    .select("tenant_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  if (!membership) return false;
  const { data: role } = await admin
    .from("roles")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("name", TENANT_ADMINISTRATOR_ROLE)
    .eq("scope", "tenant")
    .eq("active", true)
    .maybeSingle();
  if (!role) return false;
  const now = new Date().toISOString();
  const { data: assignment } = await admin
    .from("user_role_assignments")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .eq("role_id", role.id)
    .lte("starts_at", now)
    .or(`expires_at.is.null,expires_at.gt.${now}`)
    .maybeSingle();
  return Boolean(assignment);
}

async function requireTenantAdministrator(
  admin: any,
  request: Request,
  actorId: string,
  tenantId: string,
) {
  if (!(await isTenantAdministrator(admin, actorId, tenantId))) {
    return json(request, { error: { code: "tenant_admin_required" } }, 403);
  }
  return null;
}

async function validateDepartment(
  admin: any,
  tenantId: string,
  departmentId: string | null,
) {
  if (!departmentId) return { ok: true as const };
  const { data, error } = await admin
    .from("departments")
    .select("id")
    .eq("id", departmentId)
    .eq("tenant_id", tenantId)
    .eq("active", true)
    .maybeSingle();
  if (error) {
    return {
      ok: false as const,
      code: "department_lookup_failed",
      status: 500,
    };
  }
  return data
    ? { ok: true as const }
    : { ok: false as const, code: "department_not_in_tenant", status: 422 };
}

async function ensureDepartmentMembership(
  admin: any,
  tenantId: string,
  userId: string,
  departmentId: string | null,
) {
  if (!departmentId) return true;
  const { error } = await admin.from("department_memberships").upsert(
    {
      tenant_id: tenantId,
      department_id: departmentId,
      user_id: userId,
      status: "active",
    },
    { onConflict: "department_id,user_id" },
  );
  return !error;
}

async function setSupportAgentAccess(
  admin: any,
  tenantId: string,
  userId: string,
  departmentId: string | null,
  enabled: boolean,
  actorId: string,
) {
  const now = new Date().toISOString();
  const { data: role, error: roleError } = await admin
    .from("roles")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("name", SUPPORT_AGENT_ROLE)
    .eq("scope", "department")
    .eq("active", true)
    .maybeSingle();
  if (roleError) {
    return {
      ok: false as const,
      code: "agent_role_lookup_failed",
      status: 500,
    };
  }
  if (!role) {
    return { ok: false as const, code: "agent_role_not_found", status: 422 };
  }

  const { error: revokeError } = await admin
    .from("user_role_assignments")
    .update({ expires_at: now })
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .eq("role_id", role.id)
    .lte("starts_at", now)
    .or(`expires_at.is.null,expires_at.gt.${now}`);
  if (revokeError) {
    return {
      ok: false as const,
      code: "agent_role_update_failed",
      status: 500,
    };
  }
  if (!enabled) return { ok: true as const };
  if (!departmentId) {
    return {
      ok: false as const,
      code: "agent_department_required",
      status: 422,
    };
  }

  const { error: insertError } = await admin
    .from("user_role_assignments")
    .insert({
      tenant_id: tenantId,
      user_id: userId,
      role_id: role.id,
      department_id: departmentId,
      assigned_by: actorId,
    });
  return insertError
    ? { ok: false as const, code: "agent_role_update_failed", status: 422 }
    : { ok: true as const };
}

async function writeAudit(
  admin: any,
  tenantId: string,
  actorId: string,
  action: string,
  entityId: string,
  metadata: Record<string, unknown>,
) {
  const { error } = await admin.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_id: actorId,
    action,
    entity_type: "tenant_member",
    entity_id: entityId,
    severity: "security",
    metadata,
  });
  return !error;
}

const handler = withSupabase({ auth: "user" }, async (request, context) => {
  if (request.method !== "POST") {
    return json(request, { error: { code: "method_not_allowed" } }, 405);
  }
  const action = parseAction(await request.json().catch(() => null));
  const actorId = context.userClaims?.id;
  if (!action || typeof actorId !== "string") {
    return json(request, { error: { code: "invalid_request" } }, 400);
  }

  if (action.type === "getMyTicketAccess") {
    const { data: membership, error: membershipError } =
      await context.supabaseAdmin
        .from("tenant_memberships")
        .select("tenant_id")
        .eq("tenant_id", action.tenantId)
        .eq("user_id", actorId)
        .eq("status", "active")
        .maybeSingle();
    if (membershipError) {
      return json(request, { error: { code: "access_lookup_failed" } }, 500);
    }
    if (!membership) {
      return json(
        request,
        { error: { code: "tenant_membership_required" } },
        403,
      );
    }

    const now = new Date().toISOString();
    const { data: assignments, error: assignmentError } =
      await context.supabaseAdmin
        .from("user_role_assignments")
        .select(
          "user_id, starts_at, expires_at, roles!user_role_assignments_role_tenant_fk!inner(name, scope, active, role_permissions(permission_code))",
        )
        .eq("tenant_id", action.tenantId)
        .eq("user_id", actorId)
        .lte("starts_at", now)
        .or(`expires_at.is.null,expires_at.gt.${now}`)
        .limit(50);
    if (assignmentError) {
      return json(request, { error: { code: "access_lookup_failed" } }, 500);
    }
    const effectiveRoles = (assignments ?? []) as Assignment[];
    const canWorkTickets = effectiveRoles.some(
      (assignment) =>
        isEffectiveAssignment(assignment, now) &&
        roleCanWorkTickets(relatedRole(assignment.roles)),
    );
    const isTenantAdmin = effectiveRoles.some((assignment) => {
      const role = relatedRole(assignment.roles);
      return (
        role?.active === true &&
        role.name === TENANT_ADMINISTRATOR_ROLE &&
        role.scope === "tenant"
      );
    });
    return json(request, { data: { canWorkTickets, isTenantAdmin } });
  }

  if (action.type === "listUsers") {
    const denied = await requireTenantAdministrator(
      context.supabaseAdmin,
      request,
      actorId,
      action.tenantId,
    );
    if (denied) return denied;

    const [
      membershipsResult,
      invitationsResult,
      directoryResult,
      departmentsResult,
      assignmentsResult,
    ] = await Promise.all([
      context.supabaseAdmin
        .from("tenant_memberships")
        .select("user_id, status, joined_at")
        .eq("tenant_id", action.tenantId)
        .order("created_at", { ascending: true })
        .limit(500),
      context.supabaseAdmin
        .from("tenant_user_invitations")
        .select(
          "id, email, status, expires_at, created_at, display_name, job_title, offer, department_id, wants_agent",
        )
        .eq("tenant_id", action.tenantId)
        .in("status", ["sent", "accepted"])
        .order("created_at", { ascending: false })
        .limit(500),
      context.supabaseAdmin
        .from("tenant_member_directory")
        .select("user_id, department_id, job_title, offer")
        .eq("tenant_id", action.tenantId)
        .limit(500),
      context.supabaseAdmin
        .from("departments")
        .select("id, name, active")
        .eq("tenant_id", action.tenantId)
        .order("name", { ascending: true })
        .limit(200),
      context.supabaseAdmin
        .from("user_role_assignments")
        .select(
          "user_id, starts_at, expires_at, roles!user_role_assignments_role_tenant_fk!inner(name, scope, active, role_permissions(permission_code))",
        )
        .eq("tenant_id", action.tenantId)
        .limit(1000),
    ]);
    if (
      membershipsResult.error ||
      invitationsResult.error ||
      directoryResult.error ||
      departmentsResult.error ||
      assignmentsResult.error
    ) {
      return json(request, { error: { code: "user_list_failed" } }, 500);
    }

    const directories = new Map(
      ((directoryResult.data ?? []) as DirectoryProfile[]).map((profile) => [
        profile.user_id,
        profile,
      ]),
    );
    const departmentNames = new Map(
      (departmentsResult.data ?? []).map((department: any) => [
        department.id,
        department.name,
      ]),
    );
    const now = new Date().toISOString();
    const rolesByUser = new Map<
      string,
      { isAgent: boolean; isTenantAdmin: boolean }
    >();
    for (const assignment of (assignmentsResult.data ?? []) as Assignment[]) {
      if (!isEffectiveAssignment(assignment, now)) continue;
      const role = relatedRole(assignment.roles);
      if (!role?.active) continue;
      const current = rolesByUser.get(assignment.user_id) ?? {
        isAgent: false,
        isTenantAdmin: false,
      };
      current.isAgent ||= roleCanWorkTickets(role);
      current.isTenantAdmin ||=
        role.name === TENANT_ADMINISTRATOR_ROLE && role.scope === "tenant";
      rolesByUser.set(assignment.user_id, current);
    }

    const memberships = (membershipsResult.data ?? []) as Membership[];
    const members = await Promise.all(
      memberships.map(async (membership) => {
        const [authResult, profileResult] = await Promise.all([
          context.supabaseAdmin.auth.admin.getUserById(membership.user_id),
          context.supabaseAdmin
            .from("user_profiles")
            .select("display_name")
            .eq("id", membership.user_id)
            .maybeSingle(),
        ]);
        const user = authResult.data.user;
        const directory = directories.get(membership.user_id);
        const access = rolesByUser.get(membership.user_id) ?? {
          isAgent: false,
          isTenantAdmin: false,
        };
        const metadataName = user?.user_metadata?.full_name;
        return {
          id: membership.user_id,
          email: user?.email ?? "Unbekannte Adresse",
          displayName:
            profileResult.data?.display_name ??
            (typeof metadataName === "string" ? metadataName : null),
          status: membership.status,
          joinedAt: membership.joined_at,
          departmentId: directory?.department_id ?? null,
          departmentName: directory?.department_id
            ? (departmentNames.get(directory.department_id) ?? null)
            : null,
          jobTitle: directory?.job_title ?? null,
          offer: directory?.offer ?? null,
          isAgent: access.isAgent,
          isTenantAdmin: access.isTenantAdmin,
        };
      }),
    );
    const invitations = (invitationsResult.data ?? []).map(
      (invitation: any) => ({
        id: invitation.id,
        email: invitation.email,
        status: invitation.status,
        expires_at: invitation.expires_at,
        created_at: invitation.created_at,
        displayName: invitation.display_name ?? null,
        jobTitle: invitation.job_title ?? null,
        offer: invitation.offer ?? null,
        departmentId: invitation.department_id ?? null,
        departmentName: invitation.department_id
          ? (departmentNames.get(invitation.department_id) ?? null)
          : null,
        isAgent: invitation.wants_agent === true,
      }),
    );
    const departments = (departmentsResult.data ?? []).map(
      (department: any) => ({
        id: department.id,
        name: department.name,
        active: department.active === true,
      }),
    );
    return json(request, { data: { members, invitations, departments } });
  }

  if (action.type === "acceptMyInvitations") {
    const email =
      typeof context.userClaims?.email === "string"
        ? context.userClaims.email.toLowerCase()
        : null;
    if (!email) {
      return json(request, { error: { code: "email_claim_required" } }, 403);
    }
    const { data: invitations, error: invitationsError } =
      await context.supabaseAdmin
        .from("tenant_user_invitations")
        .select(
          "id, tenant_id, invited_by, role_name, display_name, job_title, offer, department_id, wants_agent",
        )
        .eq("email", email)
        .eq("status", "sent")
        .gt("expires_at", new Date().toISOString())
        .limit(50);
    if (invitationsError) {
      return json(
        request,
        { error: { code: "invitation_lookup_failed" } },
        500,
      );
    }

    for (const invitation of invitations ?? []) {
      const profilePayload: Record<string, unknown> = { id: actorId };
      if (
        typeof invitation.display_name === "string" &&
        invitation.display_name.trim()
      ) {
        profilePayload.display_name = invitation.display_name.trim();
      }
      await context.supabaseAdmin.from("user_profiles").upsert(profilePayload);
      await context.supabaseAdmin.from("tenant_memberships").upsert(
        {
          tenant_id: invitation.tenant_id,
          user_id: actorId,
          status: "active",
          joined_at: new Date().toISOString(),
        },
        { onConflict: "tenant_id,user_id" },
      );
      await context.supabaseAdmin.from("tenant_member_directory").upsert(
        {
          tenant_id: invitation.tenant_id,
          user_id: actorId,
          department_id: invitation.department_id ?? null,
          job_title: invitation.job_title ?? null,
          offer: invitation.offer ?? null,
        },
        { onConflict: "tenant_id,user_id" },
      );
      if (
        !(await ensureDepartmentMembership(
          context.supabaseAdmin,
          invitation.tenant_id,
          actorId,
          invitation.department_id ?? null,
        ))
      ) {
        return json(
          request,
          {
            error: { code: "department_membership_failed" },
          },
          500,
        );
      }

      const roleName =
        typeof invitation.role_name === "string"
          ? invitation.role_name
          : REQUESTER_ROLE;
      const { data: requestedRole } = await context.supabaseAdmin
        .from("roles")
        .select("id")
        .eq("tenant_id", invitation.tenant_id)
        .eq("name", roleName)
        .eq("scope", "tenant")
        .eq("active", true)
        .maybeSingle();
      if (requestedRole) {
        const { data: assignment } = await context.supabaseAdmin
          .from("user_role_assignments")
          .select("id")
          .eq("tenant_id", invitation.tenant_id)
          .eq("user_id", actorId)
          .eq("role_id", requestedRole.id)
          .is("expires_at", null)
          .maybeSingle();
        if (!assignment) {
          await context.supabaseAdmin.from("user_role_assignments").insert({
            tenant_id: invitation.tenant_id,
            user_id: actorId,
            role_id: requestedRole.id,
            assigned_by: invitation.invited_by,
          });
        }
      }
      if (invitation.wants_agent === true) {
        const agentResult = await setSupportAgentAccess(
          context.supabaseAdmin,
          invitation.tenant_id,
          actorId,
          invitation.department_id ?? null,
          true,
          invitation.invited_by,
        );
        if (!agentResult.ok) {
          return json(
            request,
            { error: { code: agentResult.code } },
            agentResult.status,
          );
        }
      }
      await context.supabaseAdmin
        .from("tenant_user_invitations")
        .update({ status: "accepted", accepted_at: new Date().toISOString() })
        .eq("id", invitation.id);
    }
    return json(request, { data: { accepted: invitations?.length ?? 0 } });
  }

  const targetTenantId = action.tenantId;
  const denied = await requireTenantAdministrator(
    context.supabaseAdmin,
    request,
    actorId,
    targetTenantId,
  );
  if (denied) return denied;

  if (action.type === "removeUser") {
    if (action.userId === actorId) {
      return json(request, { error: { code: "self_removal_forbidden" } }, 422);
    }
    const now = new Date().toISOString();
    const { error: membershipError } = await context.supabaseAdmin
      .from("tenant_memberships")
      .update({ status: "removed" })
      .eq("tenant_id", action.tenantId)
      .eq("user_id", action.userId)
      .eq("status", "active");
    if (membershipError) {
      return json(request, { error: { code: "user_remove_failed" } }, 422);
    }
    await Promise.all([
      context.supabaseAdmin
        .from("user_role_assignments")
        .update({ expires_at: now })
        .eq("tenant_id", action.tenantId)
        .eq("user_id", action.userId)
        .is("expires_at", null),
      writeAudit(
        context.supabaseAdmin,
        action.tenantId,
        actorId,
        "tenant.user.removed",
        action.userId,
        { userId: action.userId },
      ),
    ]);
    return json(request, { data: { removed: true } });
  }

  if (action.type === "revokeInvitation") {
    const { error } = await context.supabaseAdmin
      .from("tenant_user_invitations")
      .update({ status: "revoked" })
      .eq("id", action.invitationId)
      .eq("tenant_id", action.tenantId)
      .eq("status", "sent");
    if (error) {
      return json(
        request,
        { error: { code: "invitation_revoke_failed" } },
        422,
      );
    }
    return json(request, { data: { revoked: true } });
  }

  const departmentValidation = await validateDepartment(
    context.supabaseAdmin,
    action.tenantId,
    action.departmentId,
  );
  if (!departmentValidation.ok) {
    return json(
      request,
      { error: { code: departmentValidation.code } },
      departmentValidation.status,
    );
  }

  if (action.type === "inviteUser") {
    const expiresAt = new Date(
      Date.now() + 7 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const invitationValues = {
      tenant_id: action.tenantId,
      email: action.email,
      invited_by: actorId,
      expires_at: expiresAt,
      role_name: REQUESTER_ROLE,
      display_name: action.displayName,
      job_title: action.jobTitle,
      offer: action.offer,
      department_id: action.departmentId,
      wants_agent: action.isAgent,
    };
    const { data: existing, error: existingError } = await context.supabaseAdmin
      .from("tenant_user_invitations")
      .select("id")
      .eq("tenant_id", action.tenantId)
      .eq("email", action.email)
      .eq("status", "sent")
      .maybeSingle();
    if (existingError) {
      return json(
        request,
        { error: { code: "invitation_lookup_failed" } },
        500,
      );
    }
    if (existing) {
      const { error } = await context.supabaseAdmin
        .from("tenant_user_invitations")
        .update(invitationValues)
        .eq("id", existing.id);
      if (error) {
        return json(
          request,
          { error: { code: "invitation_create_failed" } },
          422,
        );
      }
    } else {
      const { error } = await context.supabaseAdmin
        .from("tenant_user_invitations")
        .insert(invitationValues);
      if (error) {
        return json(
          request,
          { error: { code: "invitation_create_failed" } },
          422,
        );
      }
    }
    const { error: mailError } = await context.supabaseAdmin.auth.signInWithOtp(
      {
        email: action.email,
        options: {
          shouldCreateUser: true,
          emailRedirectTo: "https://app.nextdesk.ch/",
          data: action.displayName
            ? { full_name: action.displayName }
            : undefined,
        },
      },
    );
    if (mailError) {
      return json(request, { error: { code: "invitation_email_failed" } }, 502);
    }
    if (
      !(await writeAudit(
        context.supabaseAdmin,
        action.tenantId,
        actorId,
        "tenant.user.invited",
        action.email,
        {
          email: action.email,
          departmentId: action.departmentId,
          isAgent: action.isAgent,
        },
      ))
    )
      return json(request, { error: { code: "audit_log_failed" } }, 500);
    return json(request, { data: { sent: true, expiresAt } }, 201);
  }

  if (action.type === "updatePerson") {
    const { data: membership, error: membershipError } =
      await context.supabaseAdmin
        .from("tenant_memberships")
        .select("user_id")
        .eq("tenant_id", action.tenantId)
        .eq("user_id", action.userId)
        .eq("status", "active")
        .maybeSingle();
    if (membershipError) {
      return json(request, { error: { code: "person_lookup_failed" } }, 500);
    }
    if (!membership) {
      return json(
        request,
        { error: { code: "person_not_active_member" } },
        422,
      );
    }

    if (action.displayName) {
      const { error } = await context.supabaseAdmin
        .from("user_profiles")
        .upsert({ id: action.userId, display_name: action.displayName });
      if (error) {
        return json(
          request,
          {
            error: { code: "person_profile_update_failed" },
          },
          422,
        );
      }
    }
    const { error: directoryError } = await context.supabaseAdmin
      .from("tenant_member_directory")
      .upsert(
        {
          tenant_id: action.tenantId,
          user_id: action.userId,
          department_id: action.departmentId,
          job_title: action.jobTitle,
          offer: action.offer,
        },
        { onConflict: "tenant_id,user_id" },
      );
    if (directoryError) {
      return json(
        request,
        { error: { code: "person_profile_update_failed" } },
        422,
      );
    }
    if (
      !(await ensureDepartmentMembership(
        context.supabaseAdmin,
        action.tenantId,
        action.userId,
        action.departmentId,
      ))
    ) {
      return json(
        request,
        { error: { code: "department_membership_failed" } },
        500,
      );
    }
    const agentResult = await setSupportAgentAccess(
      context.supabaseAdmin,
      action.tenantId,
      action.userId,
      action.departmentId,
      action.isAgent,
      actorId,
    );
    if (!agentResult.ok) {
      return json(
        request,
        { error: { code: agentResult.code } },
        agentResult.status,
      );
    }
    if (
      !(await writeAudit(
        context.supabaseAdmin,
        action.tenantId,
        actorId,
        "tenant.person.updated",
        action.userId,
        {
          departmentId: action.departmentId,
          jobTitle: action.jobTitle,
          offer: action.offer,
          isAgent: action.isAgent,
        },
      ))
    )
      return json(request, { error: { code: "audit_log_failed" } }, 500);
    return json(request, { data: { updated: true } });
  }

  return json(request, { error: { code: "invalid_request" } }, 400);
});

export default {
  fetch(request: Request): Response | Promise<Response> {
    if (request.method === "OPTIONS") return json(request, {}, 204);
    return handler(request);
  },
};
