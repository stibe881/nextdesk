import { withSupabase } from "@supabase/server";

const ALLOWED_ORIGIN = "https://app.nextdesk.ch";
const USER_MANAGE_PERMISSION = "user.manage";
const TENANT_SETTINGS_MANAGE_PERMISSION = "tenant.settings.manage";
const MAX_ORGANIZATION_NAME_LENGTH = 160;
const ORGANIZATION_SELECT =
  "id, tenant_id, name, ticket_access, active, created_at, updated_at";
const MEMBERSHIP_SELECT =
  "customer_organization_id, user_id, access, created_at";

type TicketAccess = "disabled" | "own" | "company";
type MemberAccess = "own" | "company";
type Action =
  | { type: "list"; tenantId: string }
  | {
      type: "save";
      tenantId: string;
      id?: string;
      name: string;
      ticketAccess: TicketAccess;
      active: boolean;
    }
  | { type: "archive"; tenantId: string; id: string }
  | { type: "listMembers"; tenantId: string; organizationId: string }
  | {
      type: "setMemberAccess";
      tenantId: string;
      organizationId: string;
      userId: string;
      access: MemberAccess;
    }
  | {
      type: "removeMember";
      tenantId: string;
      organizationId: string;
      userId: string;
    };

type AuthorizationResult =
  { ok: true } | { ok: false; status: 403 | 500; code: string };
type Organization = {
  id: string;
  tenant_id: string;
  name: string;
  ticket_access: TicketAccess;
  active: boolean;
  created_at?: string;
  updated_at?: string;
};
type CustomerMembership = {
  customer_organization_id: string;
  user_id: string;
  access: MemberAccess;
  created_at?: string;
};
type DefaultOrganizationStatus = "not_default" | "default" | "uncertain";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function requiredText(
  value: unknown,
  minLength: number,
  maxLength: number,
): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length >= minLength && trimmed.length <= maxLength
    ? trimmed
    : null;
}

function optionalUuid(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return isUuid(value) ? value : null;
}

function parseAction(value: unknown): Action | null {
  if (!isRecord(value) || !isUuid(value.tenantId)) return null;

  if (value.type === "list") {
    return { type: value.type, tenantId: value.tenantId };
  }

  if (value.type === "archive" && isUuid(value.id)) {
    return { type: value.type, tenantId: value.tenantId, id: value.id };
  }

  if (value.type === "listMembers" && isUuid(value.organizationId)) {
    return {
      type: value.type,
      tenantId: value.tenantId,
      organizationId: value.organizationId,
    };
  }

  if (value.type === "setMemberAccess") {
    if (
      !isUuid(value.organizationId) ||
      !isUuid(value.userId) ||
      (value.access !== "own" && value.access !== "company")
    ) {
      return null;
    }
    return {
      type: value.type,
      tenantId: value.tenantId,
      organizationId: value.organizationId,
      userId: value.userId,
      access: value.access,
    };
  }

  if (value.type === "removeMember") {
    if (!isUuid(value.organizationId) || !isUuid(value.userId)) return null;
    return {
      type: value.type,
      tenantId: value.tenantId,
      organizationId: value.organizationId,
      userId: value.userId,
    };
  }

  if (value.type === "save") {
    const id = optionalUuid(value.id);
    const name = requiredText(value.name, 1, MAX_ORGANIZATION_NAME_LENGTH);
    if (
      (value.id !== undefined && value.id !== null && id === null) ||
      name === null ||
      (value.ticketAccess !== "disabled" &&
        value.ticketAccess !== "own" &&
        value.ticketAccess !== "company") ||
      typeof value.active !== "boolean"
    ) {
      return null;
    }

    return {
      type: value.type,
      tenantId: value.tenantId,
      ...(typeof id === "string" ? { id } : {}),
      name,
      ticketAccess: value.ticketAccess,
      active: value.active,
    };
  }

  return null;
}

function corsHeaders(request: Request): Headers {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    Vary: "Origin",
  });
  if (request.headers.get("origin") === ALLOWED_ORIGIN) {
    headers.set("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
    headers.set(
      "Access-Control-Allow-Headers",
      "authorization, apikey, content-type, x-client-info",
    );
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  }
  return headers;
}

function json(
  request: Request,
  body: Record<string, unknown>,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders(request),
  });
}

function denyDisallowedOrigin(request: Request): Response | null {
  const origin = request.headers.get("origin");
  if (origin !== null && origin !== ALLOWED_ORIGIN) {
    return json(request, { error: { code: "origin_not_allowed" } }, 403);
  }
  return null;
}

async function isActiveTenantMember(
  admin: any,
  userId: string,
  tenantId: string,
): Promise<boolean | null> {
  const { data, error } = await admin
    .from("tenant_memberships")
    .select("tenant_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  if (error) return null;
  return Boolean(data);
}

async function hasManagementPermission(
  admin: any,
  userId: string,
  tenantId: string,
): Promise<boolean | null> {
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("user_role_assignments")
    .select(
      "roles!user_role_assignments_role_tenant_fk!inner(tenant_id, active, scope, role_permissions!inner(permission_code))",
    )
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .lte("starts_at", now)
    .or(`expires_at.is.null,expires_at.gt.${now}`);
  if (error) return null;

  return (data ?? []).some((assignment: any) => {
    const role = assignment?.roles;
    return (
      role?.tenant_id === tenantId &&
      role?.active === true &&
      role?.scope === "tenant" &&
      Array.isArray(role?.role_permissions) &&
      role.role_permissions.some(
        (permission: any) =>
          permission?.permission_code === USER_MANAGE_PERMISSION ||
          permission?.permission_code === TENANT_SETTINGS_MANAGE_PERMISSION,
      )
    );
  });
}

async function requireAuthorization(
  admin: any,
  userId: string,
  tenantId: string,
): Promise<AuthorizationResult> {
  const member = await isActiveTenantMember(admin, userId, tenantId);
  if (member === null) {
    return { ok: false, status: 500, code: "authorization_check_failed" };
  }
  if (!member) {
    return { ok: false, status: 403, code: "tenant_membership_required" };
  }

  const permitted = await hasManagementPermission(admin, userId, tenantId);
  if (permitted === null) {
    return { ok: false, status: 500, code: "authorization_check_failed" };
  }
  return permitted
    ? { ok: true }
    : { ok: false, status: 403, code: "customer_organization_manage_denied" };
}

function organizationAuditData(
  organization: Organization,
): Record<string, unknown> {
  return {
    id: organization.id,
    name: organization.name,
    ticket_access: organization.ticket_access,
    active: organization.active,
  };
}

function membershipAuditData(
  membership: CustomerMembership,
): Record<string, unknown> {
  return {
    customer_organization_id: membership.customer_organization_id,
    user_id: membership.user_id,
    access: membership.access,
  };
}

async function writeAudit(
  admin: any,
  tenantId: string,
  actorId: string,
  action: string,
  entityType: string,
  entityId: string,
  beforeData: Record<string, unknown> | null,
  afterData: Record<string, unknown> | null,
  metadata: Record<string, unknown>,
  severity: "info" | "security" = "info",
): Promise<boolean> {
  const { error } = await admin.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_id: actorId,
    action,
    entity_type: entityType,
    entity_id: entityId,
    severity,
    before_data: beforeData,
    after_data: afterData,
    metadata,
  });
  return !error;
}

async function getOrganization(
  admin: any,
  tenantId: string,
  organizationId: string,
): Promise<{ organization: Organization | null; error: boolean }> {
  const { data, error } = await admin
    .from("customer_organizations")
    .select(ORGANIZATION_SELECT)
    .eq("tenant_id", tenantId)
    .eq("id", organizationId)
    .maybeSingle();
  return {
    organization: (data as Organization | null) ?? null,
    error: Boolean(error),
  };
}

async function getDefaultOrganizationStatus(
  admin: any,
  tenantId: string,
  organizationId: string,
): Promise<DefaultOrganizationStatus> {
  const { data: tenant, error: tenantError } = await admin
    .from("tenants")
    .select("name")
    .eq("id", tenantId)
    .maybeSingle();
  const tenantName = tenant?.name;
  if (
    tenantError ||
    typeof tenantName !== "string" ||
    tenantName.trim().length === 0
  ) {
    return "uncertain";
  }

  // The tenant trigger creates the default organization with this exact name.
  // If that invariant cannot be observed, fail closed rather than deactivating
  // an organization that may be the tenant default.
  const { data: defaultOrganization, error: defaultError } = await admin
    .from("customer_organizations")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("name", tenantName)
    .maybeSingle();
  if (defaultError || !isUuid(defaultOrganization?.id)) return "uncertain";

  return defaultOrganization.id === organizationId ? "default" : "not_default";
}

async function ensureOrganizationCanBeDeactivated(
  admin: any,
  request: Request,
  tenantId: string,
  organizationId: string,
): Promise<Response | null> {
  const status = await getDefaultOrganizationStatus(
    admin,
    tenantId,
    organizationId,
  );
  if (status === "default") {
    return json(
      request,
      {
        error: { code: "default_customer_organization_cannot_be_deactivated" },
      },
      409,
    );
  }
  if (status === "uncertain") {
    return json(
      request,
      {
        error: { code: "default_customer_organization_verification_required" },
      },
      409,
    );
  }
  return null;
}

async function hasActiveTargetTenantMembership(
  admin: any,
  tenantId: string,
  userId: string,
): Promise<boolean | null> {
  const { data, error } = await admin
    .from("tenant_memberships")
    .select("user_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  if (error) return null;
  return Boolean(data);
}

const handler = withSupabase({ auth: "user" }, async (request, context) => {
  const originDenied = denyDisallowedOrigin(request);
  if (originDenied) return originDenied;
  if (request.method !== "POST") {
    return json(request, { error: { code: "method_not_allowed" } }, 405);
  }

  const action = parseAction(await request.json().catch(() => null));
  const actorId = context.userClaims?.id;
  if (!action || !isUuid(actorId)) {
    return json(request, { error: { code: "invalid_request" } }, 400);
  }

  const admin = context.supabaseAdmin;
  const authorization = await requireAuthorization(
    admin,
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

  if (action.type === "list") {
    const { data, error } = await admin
      .from("customer_organizations")
      .select(ORGANIZATION_SELECT)
      .eq("tenant_id", action.tenantId)
      .order("name", { ascending: true })
      .limit(500);
    if (error) {
      return json(
        request,
        { error: { code: "organization_list_failed" } },
        500,
      );
    }
    return json(request, { data: { organizations: data ?? [] } });
  }

  if (action.type === "listMembers") {
    const result = await getOrganization(
      admin,
      action.tenantId,
      action.organizationId,
    );
    if (result.error) {
      return json(
        request,
        { error: { code: "organization_read_failed" } },
        500,
      );
    }
    if (!result.organization) {
      return json(request, { error: { code: "organization_not_found" } }, 404);
    }

    const { data: memberships, error } = await admin
      .from("customer_memberships")
      .select(MEMBERSHIP_SELECT)
      .eq("customer_organization_id", result.organization.id)
      .order("created_at", { ascending: true })
      .limit(500);
    if (error) {
      return json(request, { error: { code: "member_list_failed" } }, 500);
    }
    return json(request, {
      data: { organization: result.organization, members: memberships ?? [] },
    });
  }

  if (action.type === "save") {
    if (!action.id) {
      // A missing default organization is an inconsistent tenant state. Do not
      // allow an inactive organization bearing the tenant name to become one.
      if (!action.active) {
        const { data: tenant, error: tenantError } = await admin
          .from("tenants")
          .select("name")
          .eq("id", action.tenantId)
          .maybeSingle();
        if (
          tenantError ||
          typeof tenant?.name !== "string" ||
          tenant.name.trim().length === 0 ||
          action.name === tenant.name
        ) {
          return json(
            request,
            {
              error: {
                code: "default_customer_organization_verification_required",
              },
            },
            409,
          );
        }
      }

      const { data: organization, error } = await admin
        .from("customer_organizations")
        .insert({
          tenant_id: action.tenantId,
          name: action.name,
          ticket_access: action.ticketAccess,
          active: action.active,
        })
        .select(ORGANIZATION_SELECT)
        .single();
      if (error || !organization) {
        return json(
          request,
          {
            error: {
              code:
                error?.code === "23505"
                  ? "organization_name_conflict"
                  : "organization_create_failed",
            },
          },
          error?.code === "23505" ? 409 : 422,
        );
      }

      if (
        !(await writeAudit(
          admin,
          action.tenantId,
          actorId,
          "customer.organization.created",
          "customer_organization",
          organization.id,
          null,
          organizationAuditData(organization as Organization),
          { organization_id: organization.id },
        ))
      ) {
        return json(
          request,
          { error: { code: "audit_log_write_failed" } },
          500,
        );
      }
      return json(request, { data: { organization } }, 201);
    }

    const existingResult = await getOrganization(
      admin,
      action.tenantId,
      action.id,
    );
    if (existingResult.error) {
      return json(
        request,
        { error: { code: "organization_read_failed" } },
        500,
      );
    }
    if (!existingResult.organization) {
      return json(request, { error: { code: "organization_not_found" } }, 404);
    }
    if (!action.active) {
      const prevented = await ensureOrganizationCanBeDeactivated(
        admin,
        request,
        action.tenantId,
        existingResult.organization.id,
      );
      if (prevented) return prevented;
    }

    const { data: organization, error } = await admin
      .from("customer_organizations")
      .update({
        name: action.name,
        ticket_access: action.ticketAccess,
        active: action.active,
      })
      .eq("tenant_id", action.tenantId)
      .eq("id", existingResult.organization.id)
      .select(ORGANIZATION_SELECT)
      .maybeSingle();
    if (error) {
      return json(
        request,
        {
          error: {
            code:
              error.code === "23505"
                ? "organization_name_conflict"
                : "organization_update_failed",
          },
        },
        error.code === "23505" ? 409 : 422,
      );
    }
    if (!organization) {
      return json(
        request,
        { error: { code: "organization_update_conflict" } },
        409,
      );
    }

    if (
      !(await writeAudit(
        admin,
        action.tenantId,
        actorId,
        "customer.organization.updated",
        "customer_organization",
        organization.id,
        organizationAuditData(existingResult.organization),
        organizationAuditData(organization as Organization),
        { organization_id: organization.id },
      ))
    ) {
      return json(request, { error: { code: "audit_log_write_failed" } }, 500);
    }
    return json(request, { data: { organization } });
  }

  if (action.type === "archive") {
    const existingResult = await getOrganization(
      admin,
      action.tenantId,
      action.id,
    );
    if (existingResult.error) {
      return json(
        request,
        { error: { code: "organization_read_failed" } },
        500,
      );
    }
    if (!existingResult.organization) {
      return json(request, { error: { code: "organization_not_found" } }, 404);
    }

    const prevented = await ensureOrganizationCanBeDeactivated(
      admin,
      request,
      action.tenantId,
      existingResult.organization.id,
    );
    if (prevented) return prevented;
    if (!existingResult.organization.active) {
      return json(request, {
        data: { organization: existingResult.organization },
      });
    }

    const { data: organization, error } = await admin
      .from("customer_organizations")
      .update({ active: false })
      .eq("tenant_id", action.tenantId)
      .eq("id", existingResult.organization.id)
      .eq("active", true)
      .select(ORGANIZATION_SELECT)
      .maybeSingle();
    if (error) {
      return json(
        request,
        { error: { code: "organization_archive_failed" } },
        422,
      );
    }
    if (!organization) {
      return json(
        request,
        { error: { code: "organization_archive_conflict" } },
        409,
      );
    }

    if (
      !(await writeAudit(
        admin,
        action.tenantId,
        actorId,
        "customer.organization.archived",
        "customer_organization",
        organization.id,
        organizationAuditData(existingResult.organization),
        organizationAuditData(organization as Organization),
        { organization_id: organization.id },
      ))
    ) {
      return json(request, { error: { code: "audit_log_write_failed" } }, 500);
    }
    return json(request, { data: { organization } });
  }

  const organizationResult = await getOrganization(
    admin,
    action.tenantId,
    action.organizationId,
  );
  if (organizationResult.error) {
    return json(request, { error: { code: "organization_read_failed" } }, 500);
  }
  if (!organizationResult.organization) {
    return json(request, { error: { code: "organization_not_found" } }, 404);
  }

  if (action.type === "setMemberAccess") {
    const targetIsMember = await hasActiveTargetTenantMembership(
      admin,
      action.tenantId,
      action.userId,
    );
    if (targetIsMember === null) {
      return json(
        request,
        { error: { code: "target_tenant_membership_check_failed" } },
        500,
      );
    }
    if (!targetIsMember) {
      return json(
        request,
        { error: { code: "active_tenant_membership_required" } },
        422,
      );
    }

    const { data: beforeMembership, error: beforeError } = await admin
      .from("customer_memberships")
      .select(MEMBERSHIP_SELECT)
      .eq("customer_organization_id", organizationResult.organization.id)
      .eq("user_id", action.userId)
      .maybeSingle();
    if (beforeError) {
      return json(request, { error: { code: "member_read_failed" } }, 500);
    }

    const { data: membership, error } = await admin
      .from("customer_memberships")
      .upsert(
        {
          customer_organization_id: organizationResult.organization.id,
          user_id: action.userId,
          access: action.access,
        },
        { onConflict: "customer_organization_id,user_id" },
      )
      .select(MEMBERSHIP_SELECT)
      .single();
    if (error || !membership) {
      return json(
        request,
        { error: { code: "member_access_save_failed" } },
        422,
      );
    }

    const before = beforeMembership as CustomerMembership | null;
    const after = membership as CustomerMembership;
    if (
      !(await writeAudit(
        admin,
        action.tenantId,
        actorId,
        before
          ? "customer.membership.access_updated"
          : "customer.membership.created",
        "customer_membership",
        organizationResult.organization.id,
        before ? membershipAuditData(before) : null,
        membershipAuditData(after),
        {
          organization_id: organizationResult.organization.id,
          user_id: action.userId,
        },
        "security",
      ))
    ) {
      return json(request, { error: { code: "audit_log_write_failed" } }, 500);
    }
    return json(request, { data: { membership } });
  }

  const { data: existingMembership, error: membershipReadError } = await admin
    .from("customer_memberships")
    .select(MEMBERSHIP_SELECT)
    .eq("customer_organization_id", organizationResult.organization.id)
    .eq("user_id", action.userId)
    .maybeSingle();
  if (membershipReadError) {
    return json(request, { error: { code: "member_read_failed" } }, 500);
  }
  if (!existingMembership) {
    return json(request, { error: { code: "member_not_found" } }, 404);
  }

  const { data: deletedMembership, error: deleteError } = await admin
    .from("customer_memberships")
    .delete()
    .eq("customer_organization_id", organizationResult.organization.id)
    .eq("user_id", action.userId)
    .select(MEMBERSHIP_SELECT)
    .maybeSingle();
  if (deleteError) {
    return json(request, { error: { code: "member_remove_failed" } }, 422);
  }
  if (!deletedMembership) {
    return json(request, { error: { code: "member_remove_conflict" } }, 409);
  }

  if (
    !(await writeAudit(
      admin,
      action.tenantId,
      actorId,
      "customer.membership.removed",
      "customer_membership",
      organizationResult.organization.id,
      membershipAuditData(existingMembership as CustomerMembership),
      null,
      {
        organization_id: organizationResult.organization.id,
        user_id: action.userId,
      },
      "security",
    ))
  ) {
    return json(request, { error: { code: "audit_log_write_failed" } }, 500);
  }
  return json(request, { data: { removed: true } });
});

export default {
  fetch(request: Request): Response | Promise<Response> {
    if (request.method === "OPTIONS") {
      if (request.headers.get("origin") !== ALLOWED_ORIGIN) {
        return new Response(null, { status: 403, headers: { Vary: "Origin" } });
      }
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }
    return handler(request);
  },
};
