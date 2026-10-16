import { withSupabase } from "@supabase/server";

const APP_ORIGIN = "https://app.nextdesk.ch";
const TENANT_ADMINISTRATOR_ROLE = "Tenant administrator";
const MANAGEMENT_PERMISSIONS = new Set([
  "tenant.settings.manage",
  "role.manage",
]);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Action =
  | { type: "listRoles"; tenantId: string }
  | { type: "listPermissions"; tenantId: string }
  | {
      type: "createRole";
      tenantId: string;
      name: string;
      permissionCodes: string[];
    }
  | {
      type: "updateRole";
      tenantId: string;
      roleId: string;
      name?: string;
      permissionCodes?: string[];
      active?: boolean;
    }
  | {
      type: "assignRole";
      tenantId: string;
      userId: string;
      roleId: string;
      departmentId: string | null;
      teamId: string | null;
    }
  | { type: "revokeRole"; tenantId: string; assignmentId: string };

type Role = {
  id: string;
  name: string;
  scope: string;
  is_system: boolean;
  active: boolean;
  created_at: string;
  updated_at: string;
  role_permissions?: Array<{ permission_code: string }> | null;
};

type AssignmentRole = {
  id: string;
  name: string;
  scope: string;
  active: boolean;
};

type Assignment = {
  id: string;
  user_id: string;
  role_id: string;
  department_id: string | null;
  team_id: string | null;
  starts_at: string;
  expires_at: string | null;
  roles: AssignmentRole | AssignmentRole[] | null;
};

function corsHeaders(request: Request): HeadersInit {
  const allowedOrigin =
    request.headers.get("origin") === APP_ORIGIN ? APP_ORIGIN : "";
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers":
      "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json; charset=utf-8",
    Vary: "Origin",
  };
}

function json(
  request: Request,
  body: Record<string, unknown>,
  status = 200,
): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: corsHeaders(request),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function normalizeRoleName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  const length = Array.from(name).length;
  return length >= 3 && length <= 120 ? name : null;
}

function parsePermissionCodes(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 200) return null;

  const codes: string[] = [];
  for (const rawCode of value) {
    if (typeof rawCode !== "string") return null;
    const code = rawCode.trim();
    if (code.length === 0 || code.length > 120) return null;
    if (!codes.includes(code)) codes.push(code);
  }
  return codes;
}

function optionalUuid(
  body: Record<string, unknown>,
  key: string,
): string | null | undefined {
  if (!hasOwn(body, key)) return null;
  const value = body[key];
  if (value === null) return null;
  return isUuid(value) ? value : undefined;
}

function parseAction(value: unknown): Action | null {
  if (!isRecord(value) || typeof value.type !== "string") return null;

  if (value.type === "listRoles" && isUuid(value.tenantId)) {
    return { type: value.type, tenantId: value.tenantId };
  }

  if (value.type === "listPermissions" && isUuid(value.tenantId)) {
    return { type: value.type, tenantId: value.tenantId };
  }

  if (
    value.type === "createRole" &&
    isUuid(value.tenantId) &&
    normalizeRoleName(value.name) !== null
  ) {
    const permissionCodes = parsePermissionCodes(value.permissionCodes);
    return permissionCodes === null
      ? null
      : {
          type: value.type,
          tenantId: value.tenantId,
          name: normalizeRoleName(value.name)!,
          permissionCodes,
        };
  }

  if (
    value.type === "updateRole" &&
    isUuid(value.tenantId) &&
    isUuid(value.roleId)
  ) {
    const updates: Omit<
      Extract<Action, { type: "updateRole" }>,
      "type" | "tenantId" | "roleId"
    > = {};

    if (hasOwn(value, "name")) {
      const name = normalizeRoleName(value.name);
      if (name === null) return null;
      updates.name = name;
    }
    if (hasOwn(value, "permissionCodes")) {
      const permissionCodes = parsePermissionCodes(value.permissionCodes);
      if (permissionCodes === null) return null;
      updates.permissionCodes = permissionCodes;
    }
    if (hasOwn(value, "active")) {
      if (typeof value.active !== "boolean") return null;
      updates.active = value.active;
    }

    if (
      updates.name === undefined &&
      updates.permissionCodes === undefined &&
      updates.active === undefined
    )
      return null;

    return {
      type: value.type,
      tenantId: value.tenantId,
      roleId: value.roleId,
      ...updates,
    };
  }

  if (
    value.type === "assignRole" &&
    isUuid(value.tenantId) &&
    isUuid(value.userId) &&
    isUuid(value.roleId)
  ) {
    const departmentId = optionalUuid(value, "departmentId");
    const teamId = optionalUuid(value, "teamId");
    if (departmentId === undefined || teamId === undefined) return null;
    return {
      type: value.type,
      tenantId: value.tenantId,
      userId: value.userId,
      roleId: value.roleId,
      departmentId,
      teamId,
    };
  }

  if (
    value.type === "revokeRole" &&
    isUuid(value.tenantId) &&
    isUuid(value.assignmentId)
  ) {
    return {
      type: value.type,
      tenantId: value.tenantId,
      assignmentId: value.assignmentId,
    };
  }

  return null;
}

function isProtectedTenantAdministrator(
  role: Pick<Role, "name" | "scope">,
): boolean {
  return role.name === TENANT_ADMINISTRATOR_ROLE && role.scope === "tenant";
}

function relatedRole(value: Assignment["roles"]): AssignmentRole | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function isScopeCompatibleAssignment(assignment: Assignment): boolean {
  const role = relatedRole(assignment.roles);
  if (!role || !role.active) return false;

  if (role.scope === "tenant") {
    return assignment.department_id === null && assignment.team_id === null;
  }
  if (role.scope === "department") {
    return assignment.department_id !== null && assignment.team_id === null;
  }
  return role.scope === "team" && assignment.team_id !== null;
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

async function authorizeTenantAdministration(
  admin: any,
  actorId: string,
  tenantId: string,
): Promise<{ ok: true } | { ok: false; code: string; status: number }> {
  // Membership is deliberately checked before any role/permission data is read.
  const { data: membership, error: membershipError } = await admin
    .from("tenant_memberships")
    .select("tenant_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", actorId)
    .eq("status", "active")
    .maybeSingle();
  if (membershipError) {
    return { ok: false, code: "authorization_check_failed", status: 500 };
  }
  if (!membership) {
    return { ok: false, code: "tenant_membership_required", status: 403 };
  }

  const { data: tenant, error: tenantError } = await admin
    .from("tenants")
    .select("id")
    .eq("id", tenantId)
    .eq("status", "active")
    .maybeSingle();
  if (tenantError) {
    return { ok: false, code: "authorization_check_failed", status: 500 };
  }
  if (!tenant) {
    return { ok: false, code: "tenant_inactive_or_not_found", status: 403 };
  }

  const now = new Date().toISOString();
  const { data: assignments, error: assignmentError } = await admin
    .from("user_role_assignments")
    .select(
      "roles!user_role_assignments_role_tenant_fk!inner(active, scope, role_permissions!inner(permission_code))",
    )
    .eq("tenant_id", tenantId)
    .eq("user_id", actorId)
    .lte("starts_at", now)
    .or(`expires_at.is.null,expires_at.gt.${now}`);
  if (assignmentError) {
    return { ok: false, code: "authorization_check_failed", status: 500 };
  }

  const permitted = (assignments ?? []).some((assignment: any) => {
    const role = assignment.roles as {
      active?: boolean;
      scope?: string;
      role_permissions?: Array<{ permission_code?: string }>;
    } | null;
    return (
      role?.active === true &&
      role.scope === "tenant" &&
      Array.isArray(role.role_permissions) &&
      role.role_permissions.some(
        (permission) =>
          typeof permission.permission_code === "string" &&
          MANAGEMENT_PERMISSIONS.has(permission.permission_code),
      )
    );
  });

  return permitted
    ? { ok: true }
    : { ok: false, code: "tenant_role_management_forbidden", status: 403 };
}

async function validatePermissionCodes(
  admin: any,
  permissionCodes: string[],
): Promise<{ ok: true } | { ok: false; code: string; status: number }> {
  if (permissionCodes.length === 0) return { ok: true };

  const { data, error } = await admin
    .from("permissions")
    .select("code")
    .in("code", permissionCodes);
  if (error) {
    return { ok: false, code: "permission_validation_failed", status: 500 };
  }

  const found = new Set(
    (data ?? []).map((permission: { code: string }) => permission.code),
  );
  return permissionCodes.every((code) => found.has(code))
    ? { ok: true }
    : { ok: false, code: "invalid_permission_codes", status: 422 };
}

async function writeAudit(
  admin: any,
  tenantId: string,
  actorId: string,
  action: string,
  entityType: string,
  entityId: string,
  metadata: Record<string, unknown> = {},
): Promise<boolean> {
  const { error } = await admin.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_id: actorId,
    action,
    entity_type: entityType,
    entity_id: entityId,
    severity: "security",
    metadata,
  });
  return !error;
}

async function requireTenantEntity(
  admin: any,
  table: "departments" | "teams",
  id: string,
  tenantId: string,
): Promise<
  { ok: true; data: any } | { ok: false; code: string; status: number }
> {
  const { data, error } = await admin
    .from(table)
    .select(table === "teams" ? "id, department_id" : "id")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) return { ok: false, code: "scope_validation_failed", status: 500 };
  return data
    ? { ok: true, data }
    : { ok: false, code: `${table.slice(0, -1)}_not_in_tenant`, status: 422 };
}

const handler = withSupabase({ auth: "user" }, async (request, context) => {
  if (request.method !== "POST") {
    return json(request, { error: { code: "method_not_allowed" } }, 405);
  }

  const action = parseAction(await request.json().catch(() => null));
  const actorId = context.userClaims?.id;
  if (!action || !isUuid(actorId)) {
    return json(request, { error: { code: "invalid_request" } }, 400);
  }

  const authorization = await authorizeTenantAdministration(
    context.supabaseAdmin,
    actorId,
    action.tenantId,
  );
  if (!authorization.ok) {
    return json(
      request,
      { error: { code: authorization.code } },
      authorization.status,
    );
  }

  if (action.type === "listRoles") {
    const { data, error } = await context.supabaseAdmin
      .from("roles")
      .select(
        "id, name, scope, is_system, active, created_at, updated_at, role_permissions(permission_code)",
      )
      .eq("tenant_id", action.tenantId)
      .order("name", { ascending: true })
      .limit(200);
    if (error) {
      return json(request, { error: { code: "role_list_failed" } }, 500);
    }

    const roles = ((data ?? []) as Role[]).map((role) => ({
      id: role.id,
      name: role.name,
      scope: role.scope,
      isSystem: role.is_system,
      active: role.active,
      createdAt: role.created_at,
      updatedAt: role.updated_at,
      permissionCodes: (role.role_permissions ?? [])
        .map((permission) => permission.permission_code)
        .sort(),
    }));

    const now = new Date().toISOString();
    const { data: assignmentData, error: assignmentError } =
      await context.supabaseAdmin
        .from("user_role_assignments")
        .select(
          "id, user_id, role_id, department_id, team_id, starts_at, expires_at, roles!user_role_assignments_role_tenant_fk!inner(id, name, scope, active)",
        )
        .eq("tenant_id", action.tenantId)
        .eq("roles.tenant_id", action.tenantId)
        .eq("roles.active", true)
        .lte("starts_at", now)
        .or(`expires_at.is.null,expires_at.gt.${now}`)
        .order("starts_at", { ascending: false })
        .limit(200);
    if (assignmentError) {
      return json(
        request,
        { error: { code: "role_assignment_list_failed" } },
        500,
      );
    }

    const candidateAssignments = (assignmentData ?? []) as Assignment[];
    const candidateUserIds = [
      ...new Set(candidateAssignments.map((assignment) => assignment.user_id)),
    ];
    const { data: membershipData, error: membershipError } =
      candidateUserIds.length === 0
        ? { data: [], error: null }
        : await context.supabaseAdmin
            .from("tenant_memberships")
            .select("user_id")
            .eq("tenant_id", action.tenantId)
            .eq("status", "active")
            .in("user_id", candidateUserIds)
            .limit(200);
    if (membershipError) {
      return json(
        request,
        { error: { code: "role_assignment_list_failed" } },
        500,
      );
    }

    const activeUserIds = new Set(
      ((membershipData ?? []) as Array<{ user_id: string }>).map(
        (membership) => membership.user_id,
      ),
    );
    const activeAssignments = candidateAssignments.filter(
      (assignment) =>
        activeUserIds.has(assignment.user_id) &&
        isScopeCompatibleAssignment(assignment),
    );
    const assignedUserIds = [
      ...new Set(activeAssignments.map((assignment) => assignment.user_id)),
    ];
    const { data: profileData, error: profileError } =
      assignedUserIds.length === 0
        ? { data: [], error: null }
        : await context.supabaseAdmin
            .from("user_profiles")
            .select("id, display_name")
            .in("id", assignedUserIds)
            .limit(200);
    if (profileError) {
      return json(
        request,
        { error: { code: "role_assignment_list_failed" } },
        500,
      );
    }

    const displayNames = new Map(
      (
        (profileData ?? []) as Array<{
          id: string;
          display_name: string | null;
        }>
      ).map((profile) => [profile.id, profile.display_name]),
    );
    const users = new Map(
      await Promise.all(
        assignedUserIds.map(async (userId) => {
          const { data: authData, error: authError } =
            await context.supabaseAdmin.auth.admin.getUserById(userId);
          const user = authError ? null : authData.user;
          const metadataName = user?.user_metadata?.full_name;
          return [
            userId,
            {
              displayName:
                displayNames.get(userId) ??
                (typeof metadataName === "string" ? metadataName : null),
              email: user?.email ?? null,
            },
          ] as const;
        }),
      ),
    );

    const roleAssignments = activeAssignments.map((assignment) => {
      const role = relatedRole(assignment.roles)!;
      const user = users.get(assignment.user_id) ?? {
        displayName: null,
        email: null,
      };
      return {
        id: assignment.id,
        user_id: assignment.user_id,
        role_id: assignment.role_id,
        department_id: assignment.department_id,
        team_id: assignment.team_id,
        starts_at: assignment.starts_at,
        expires_at: assignment.expires_at,
        roleName: role.name,
        user: {
          id: assignment.user_id,
          displayName: user.displayName,
          email: user.email,
        },
      };
    });

    return json(request, { data: { roles, roleAssignments } });
  }

  if (action.type === "listPermissions") {
    const { data, error } = await context.supabaseAdmin
      .from("permissions")
      .select("code, description, is_sensitive")
      .order("code", { ascending: true })
      .limit(500);
    if (error) {
      return json(request, { error: { code: "permission_list_failed" } }, 500);
    }
    return json(request, { data: { permissions: data ?? [] } });
  }

  if (action.type === "createRole") {
    if (action.name === TENANT_ADMINISTRATOR_ROLE) {
      return json(
        request,
        { error: { code: "tenant_administrator_role_protected" } },
        422,
      );
    }

    const permissionValidation = await validatePermissionCodes(
      context.supabaseAdmin,
      action.permissionCodes,
    );
    if (!permissionValidation.ok) {
      return json(
        request,
        { error: { code: permissionValidation.code } },
        permissionValidation.status,
      );
    }

    const { data: role, error: roleError } = await context.supabaseAdmin
      .from("roles")
      .insert({
        tenant_id: action.tenantId,
        name: action.name,
        scope: "tenant",
        is_system: false,
        active: true,
      })
      .select("id, name, scope, is_system, active, created_at, updated_at")
      .single();
    if (roleError || !role) {
      return json(request, { error: { code: "role_create_failed" } }, 422);
    }

    if (action.permissionCodes.length > 0) {
      const { error: permissionInsertError } = await context.supabaseAdmin
        .from("role_permissions")
        .insert(
          action.permissionCodes.map((permissionCode) => ({
            role_id: role.id,
            permission_code: permissionCode,
          })),
        );
      if (permissionInsertError) {
        await context.supabaseAdmin
          .from("roles")
          .delete()
          .eq("id", role.id)
          .eq("tenant_id", action.tenantId);
        return json(
          request,
          { error: { code: "role_permission_create_failed" } },
          500,
        );
      }
    }

    const audited = await writeAudit(
      context.supabaseAdmin,
      action.tenantId,
      actorId,
      "tenant.role.created",
      "role",
      role.id,
      { permission_count: action.permissionCodes.length },
    );
    if (!audited) {
      return json(request, { error: { code: "audit_log_failed" } }, 500);
    }

    return json(
      request,
      {
        data: {
          role: {
            id: role.id,
            name: role.name,
            scope: role.scope,
            isSystem: role.is_system,
            active: role.active,
            createdAt: role.created_at,
            updatedAt: role.updated_at,
            permissionCodes: action.permissionCodes,
          },
        },
      },
      201,
    );
  }

  if (action.type === "updateRole") {
    const { data: existingRole, error: existingRoleError } =
      await context.supabaseAdmin
        .from("roles")
        .select(
          "id, name, scope, is_system, active, created_at, updated_at, role_permissions(permission_code)",
        )
        .eq("id", action.roleId)
        .eq("tenant_id", action.tenantId)
        .maybeSingle();
    if (existingRoleError) {
      return json(request, { error: { code: "role_lookup_failed" } }, 500);
    }
    if (!existingRole) {
      return json(request, { error: { code: "role_not_found" } }, 404);
    }

    const role = existingRole as Role;
    if (
      isProtectedTenantAdministrator(role) &&
      (action.name !== undefined ||
        action.permissionCodes !== undefined ||
        action.active !== undefined)
    ) {
      return json(
        request,
        { error: { code: "tenant_administrator_role_protected" } },
        422,
      );
    }
    if (action.name === TENANT_ADMINISTRATOR_ROLE) {
      return json(
        request,
        { error: { code: "tenant_administrator_role_protected" } },
        422,
      );
    }

    if (action.permissionCodes !== undefined) {
      const permissionValidation = await validatePermissionCodes(
        context.supabaseAdmin,
        action.permissionCodes,
      );
      if (!permissionValidation.ok) {
        return json(
          request,
          { error: { code: permissionValidation.code } },
          permissionValidation.status,
        );
      }
    }

    const roleUpdate: Record<string, unknown> = {};
    if (action.name !== undefined) roleUpdate.name = action.name;
    if (action.active !== undefined) roleUpdate.active = action.active;

    let updatedRole = role;
    if (Object.keys(roleUpdate).length > 0) {
      const { data, error } = await context.supabaseAdmin
        .from("roles")
        .update(roleUpdate)
        .eq("id", action.roleId)
        .eq("tenant_id", action.tenantId)
        .select("id, name, scope, is_system, active, created_at, updated_at")
        .maybeSingle();
      if (error || !data) {
        return json(request, { error: { code: "role_update_failed" } }, 422);
      }
      updatedRole = {
        ...data,
        role_permissions: role.role_permissions,
      } as Role;
    }

    if (action.permissionCodes !== undefined) {
      const { error: permissionDeleteError } = await context.supabaseAdmin
        .from("role_permissions")
        .delete()
        .eq("role_id", action.roleId);
      if (permissionDeleteError) {
        return json(
          request,
          { error: { code: "role_permission_update_failed" } },
          500,
        );
      }

      if (action.permissionCodes.length > 0) {
        const { error: permissionInsertError } = await context.supabaseAdmin
          .from("role_permissions")
          .insert(
            action.permissionCodes.map((permissionCode) => ({
              role_id: action.roleId,
              permission_code: permissionCode,
            })),
          );
        if (permissionInsertError) {
          return json(
            request,
            { error: { code: "role_permission_update_failed" } },
            500,
          );
        }
      }
    }

    const changed = [
      action.name !== undefined ? "name" : null,
      action.permissionCodes !== undefined ? "permissions" : null,
      action.active !== undefined ? "active" : null,
    ].filter((field): field is string => field !== null);
    const audited = await writeAudit(
      context.supabaseAdmin,
      action.tenantId,
      actorId,
      "tenant.role.updated",
      "role",
      action.roleId,
      { changed },
    );
    if (!audited) {
      return json(request, { error: { code: "audit_log_failed" } }, 500);
    }

    return json(request, {
      data: {
        role: {
          id: updatedRole.id,
          name: updatedRole.name,
          scope: updatedRole.scope,
          isSystem: updatedRole.is_system,
          active: updatedRole.active,
          createdAt: updatedRole.created_at,
          updatedAt: updatedRole.updated_at,
          permissionCodes:
            action.permissionCodes ??
            (role.role_permissions ?? [])
              .map((permission) => permission.permission_code)
              .sort(),
        },
      },
    });
  }

  if (action.type === "assignRole") {
    const { data: roleData, error: roleError } = await context.supabaseAdmin
      .from("roles")
      .select("id, name, scope, is_system, active, created_at, updated_at")
      .eq("id", action.roleId)
      .eq("tenant_id", action.tenantId)
      .maybeSingle();
    if (roleError) {
      return json(request, { error: { code: "role_lookup_failed" } }, 500);
    }
    if (!roleData) {
      return json(request, { error: { code: "role_not_found" } }, 404);
    }
    const role = roleData as Role;
    if (!role.active) {
      return json(request, { error: { code: "role_inactive" } }, 422);
    }

    if (
      (role.scope === "tenant" &&
        (action.departmentId !== null || action.teamId !== null)) ||
      (role.scope === "department" &&
        (action.departmentId === null || action.teamId !== null)) ||
      (role.scope === "team" && action.teamId === null) ||
      !["tenant", "department", "team"].includes(role.scope)
    ) {
      return json(request, { error: { code: "invalid_role_scope" } }, 422);
    }

    const { data: membership, error: membershipError } =
      await context.supabaseAdmin
        .from("tenant_memberships")
        .select("tenant_id")
        .eq("tenant_id", action.tenantId)
        .eq("user_id", action.userId)
        .eq("status", "active")
        .maybeSingle();
    if (membershipError) {
      return json(
        request,
        { error: { code: "membership_validation_failed" } },
        500,
      );
    }
    if (!membership) {
      return json(
        request,
        { error: { code: "assignee_membership_required" } },
        422,
      );
    }

    let teamDepartmentId: string | null = null;
    if (action.departmentId !== null) {
      const department = await requireTenantEntity(
        context.supabaseAdmin,
        "departments",
        action.departmentId,
        action.tenantId,
      );
      if (!department.ok) {
        return json(
          request,
          { error: { code: department.code } },
          department.status,
        );
      }
    }
    if (action.teamId !== null) {
      const team = await requireTenantEntity(
        context.supabaseAdmin,
        "teams",
        action.teamId,
        action.tenantId,
      );
      if (!team.ok) {
        return json(request, { error: { code: team.code } }, team.status);
      }
      teamDepartmentId = team.data.department_id as string | null;
    }
    if (
      action.departmentId !== null &&
      teamDepartmentId !== null &&
      action.departmentId !== teamDepartmentId
    ) {
      return json(
        request,
        { error: { code: "team_department_mismatch" } },
        422,
      );
    }

    const now = new Date().toISOString();
    let duplicateQuery = context.supabaseAdmin
      .from("user_role_assignments")
      .select("id")
      .eq("tenant_id", action.tenantId)
      .eq("user_id", action.userId)
      .eq("role_id", action.roleId)
      .lte("starts_at", now)
      .or(`expires_at.is.null,expires_at.gt.${now}`)
      .limit(1);
    duplicateQuery =
      action.departmentId === null
        ? duplicateQuery.is("department_id", null)
        : duplicateQuery.eq("department_id", action.departmentId);
    duplicateQuery =
      action.teamId === null
        ? duplicateQuery.is("team_id", null)
        : duplicateQuery.eq("team_id", action.teamId);
    const { data: duplicate, error: duplicateError } = await duplicateQuery;
    if (duplicateError) {
      return json(
        request,
        { error: { code: "assignment_lookup_failed" } },
        500,
      );
    }
    if ((duplicate ?? []).length > 0) {
      return json(request, { error: { code: "role_already_assigned" } }, 409);
    }

    const { data: assignment, error: assignmentError } =
      await context.supabaseAdmin
        .from("user_role_assignments")
        .insert({
          tenant_id: action.tenantId,
          user_id: action.userId,
          role_id: action.roleId,
          department_id: action.departmentId,
          team_id: action.teamId,
          assigned_by: actorId,
        })
        .select(
          "id, user_id, role_id, department_id, team_id, starts_at, expires_at",
        )
        .single();
    if (assignmentError || !assignment) {
      return json(request, { error: { code: "role_assignment_failed" } }, 422);
    }

    const audited = await writeAudit(
      context.supabaseAdmin,
      action.tenantId,
      actorId,
      "tenant.role.assigned",
      "user_role_assignment",
      assignment.id,
      {
        user_id: action.userId,
        role_id: action.roleId,
        ...(action.departmentId === null
          ? {}
          : { department_id: action.departmentId }),
        ...(action.teamId === null ? {} : { team_id: action.teamId }),
      },
    );
    if (!audited) {
      return json(request, { error: { code: "audit_log_failed" } }, 500);
    }

    return json(request, { data: { assignment } }, 201);
  }

  const { data: assignmentData, error: assignmentError } =
    await context.supabaseAdmin
      .from("user_role_assignments")
      .select(
        "id, user_id, role_id, department_id, team_id, starts_at, expires_at, roles!user_role_assignments_role_tenant_fk!inner(id, name, scope, active)",
      )
      .eq("id", action.assignmentId)
      .eq("tenant_id", action.tenantId)
      .maybeSingle();
  if (assignmentError) {
    return json(request, { error: { code: "assignment_lookup_failed" } }, 500);
  }
  if (!assignmentData) {
    return json(request, { error: { code: "assignment_not_found" } }, 404);
  }

  const assignment = assignmentData as Assignment;
  const assignmentRole = relatedRole(assignment.roles);
  const now = new Date().toISOString();
  if (!isEffectiveAssignment(assignment, now)) {
    return json(request, { error: { code: "assignment_not_active" } }, 422);
  }

  if (
    assignment.user_id === actorId &&
    assignmentRole &&
    isProtectedTenantAdministrator(assignmentRole) &&
    assignmentRole.active
  ) {
    const { count, error: countError } = await context.supabaseAdmin
      .from("user_role_assignments")
      .select(
        "id, roles!user_role_assignments_role_tenant_fk!inner(name, scope, active)",
        {
          count: "exact",
          head: true,
        },
      )
      .eq("tenant_id", action.tenantId)
      .eq("user_id", actorId)
      .eq("roles.name", TENANT_ADMINISTRATOR_ROLE)
      .eq("roles.scope", "tenant")
      .eq("roles.active", true)
      .lte("starts_at", now)
      .or(`expires_at.is.null,expires_at.gt.${now}`);
    if (countError) {
      return json(request, { error: { code: "assignment_count_failed" } }, 500);
    }
    if ((count ?? 0) <= 1) {
      return json(
        request,
        { error: { code: "last_tenant_administrator_assignment" } },
        422,
      );
    }
  }

  const { error: revokeError } = await context.supabaseAdmin
    .from("user_role_assignments")
    .update({ expires_at: now })
    .eq("id", action.assignmentId)
    .eq("tenant_id", action.tenantId)
    .lte("starts_at", now)
    .or(`expires_at.is.null,expires_at.gt.${now}`);
  if (revokeError) {
    return json(request, { error: { code: "role_revoke_failed" } }, 422);
  }

  const audited = await writeAudit(
    context.supabaseAdmin,
    action.tenantId,
    actorId,
    "tenant.role.revoked",
    "user_role_assignment",
    action.assignmentId,
    { user_id: assignment.user_id, role_id: assignment.role_id },
  );
  if (!audited) {
    return json(request, { error: { code: "audit_log_failed" } }, 500);
  }

  return json(request, { data: { revoked: true } });
});

export default {
  fetch(request: Request): Response | Promise<Response> {
    if (request.method === "OPTIONS") return json(request, {}, 204);
    return handler(request);
  },
};
