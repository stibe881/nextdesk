import { withSupabase } from "@supabase/server";

type Action =
  | { type: "getFormOptions"; tenantId: string; departmentId?: string }
  | { type: "getCategories"; tenantId: string; departmentId: string }
  | { type: "searchRequesters"; tenantId: string; query: string }
  | {
      type: "createRequester";
      tenantId: string;
      displayName: string;
      email?: string;
    }
  | {
      type: "createCategory";
      tenantId: string;
      departmentId: string;
      name: string;
      parentCategoryId?: string | null;
    }
  | { type: "getAssignableAgents"; tenantId: string; departmentId: string }
  | {
      type: "createTicket";
      tenantId: string;
      departmentId: string;
      subject: string;
      description: string;
      priorityKey: string;
      requesterContactId: string;
      categoryId?: string | null;
      subcategoryId?: string | null;
      assignedAgentId?: string | null;
    };

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

function isOptionalUuid(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || isUuid(value);
}

function isRequesterContactId(value: unknown): value is string {
  // Migration 0023 backfills md5-derived UUIDs; their version/variant bits need
  // not be those of RFC-generated v1-v5 IDs. PostgreSQL still stores valid UUIDs.
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function isRequesterName(value: string): boolean {
  const length = Array.from(value).length;
  return length >= 2 && length <= 160 && !/[\u0000-\u001f\u007f]/.test(value);
}

function normalizedRequesterEmail(value: unknown): string | null {
  if (typeof value !== "string" || /[^\x20-\x7e]/.test(value)) {
    return null;
  }
  const email = value.trim().toLowerCase();
  if (email.length > 254) return null;
  const parts = email.split("@");
  if (parts.length !== 2) return null;
  const [local, domain] = parts;
  if (
    local.length < 1 ||
    local.length > 64 ||
    !/^[a-z0-9!#$%&'*+/=?^_`{|}~.-]+$/.test(local) ||
    local.startsWith(".") ||
    local.endsWith(".") ||
    local.includes("..")
  )
    return null;
  const labels = domain.split(".");
  if (
    labels.length < 2 ||
    labels.some(
      (label) =>
        label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
    ) ||
    !/^(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/.test(labels[labels.length - 1])
  )
    return null;
  return email;
}

type RequesterOption = { id: string; displayName: string };

function publicRequester(row: {
  id: string;
  display_name: string;
}): RequesterOption {
  // Never expose email, user_id, tenant_id, or database error details.
  // Historical/profile names may themselves have been set to an email address.
  return {
    id: row.id,
    displayName: row.display_name.includes("@")
      ? "Anfragende Person"
      : row.display_name,
  };
}

function requesterError(
  request: Request,
  code: string,
  message: string,
  status: number,
): Response {
  return json(request, { error: { code, message } }, status);
}

function hasCurrentAzureSsoIdentity(context: unknown): boolean {
  if (!isRecord(context)) return false;

  const jwtClaims = context.jwtClaims;
  const userClaims = context.userClaims;
  const claimSources = [jwtClaims, userClaims].filter(isRecord);
  const hasAzureProvider = claimSources.some((claims) => {
    const appMetadata = claims.app_metadata;
    if (!isRecord(appMetadata)) return false;
    const provider = appMetadata.provider;
    const providers = appMetadata.providers;
    return (
      provider === "azure" ||
      (Array.isArray(providers) &&
        providers.some((candidate) => candidate === "azure"))
    );
  });
  const hasOAuthSession =
    isRecord(jwtClaims) &&
    Array.isArray(jwtClaims.amr) &&
    jwtClaims.amr.some((entry) => isRecord(entry) && entry.method === "oauth");

  return hasAzureProvider && hasOAuthSession;
}

type RequesterContext = {
  isInternal: boolean;
  departmentId?: string;
  departmentName?: string;
};

async function getRequesterContext(
  admin: any,
  context: unknown,
  userId: string,
  tenantId: string,
): Promise<{ requesterContext: RequesterContext; error: boolean }> {
  if (!hasCurrentAzureSsoIdentity(context)) {
    return { requesterContext: { isInternal: false }, error: false };
  }

  const { data: memberships, error } = await admin
    .from("department_memberships")
    .select("department_id, departments!inner(id, name)")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .eq("status", "active")
    .eq("departments.tenant_id", tenantId)
    .eq("departments.active", true);
  if (error) return { requesterContext: { isInternal: false }, error: true };

  const departments: Array<{ id: string; name: string }> = (
    memberships ?? []
  ).flatMap((membership: any) => {
    const department = Array.isArray(membership.departments)
      ? membership.departments[0]
      : membership.departments;
    if (
      !isRecord(department) ||
      !isUuid(department.id) ||
      typeof department.name !== "string"
    ) {
      return [];
    }
    return [{ id: department.id, name: department.name }];
  });
  departments.sort(
    (left, right) =>
      left.name.localeCompare(right.name, "de-CH", { sensitivity: "base" }) ||
      left.name.localeCompare(right.name, "de-CH") ||
      left.id.localeCompare(right.id),
  );
  const department = departments[0];
  if (!department) {
    return { requesterContext: { isInternal: false }, error: false };
  }

  return {
    requesterContext: {
      isInternal: true,
      departmentId: department.id,
      departmentName: department.name,
    },
    error: false,
  };
}

function json(request: Request, body: Record<string, unknown>, status = 200) {
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
  if (!isRecord(value) || !isUuid(value.tenantId)) return null;
  if (
    value.type === "getFormOptions" &&
    (value.departmentId === undefined || isUuid(value.departmentId))
  ) {
    return {
      type: value.type,
      tenantId: value.tenantId,
      ...(value.departmentId !== undefined
        ? { departmentId: value.departmentId }
        : {}),
    };
  }
  if (
    (value.type === "getAssignableAgents" || value.type === "getCategories") &&
    isUuid(value.departmentId)
  ) {
    return {
      type: value.type,
      tenantId: value.tenantId,
      departmentId: value.departmentId,
    };
  }
  if (value.type === "searchRequesters" && typeof value.query === "string") {
    return {
      type: value.type,
      tenantId: value.tenantId,
      query: value.query.trim(),
    };
  }
  if (
    value.type === "createRequester" &&
    typeof value.displayName === "string" &&
    (value.email === undefined || typeof value.email === "string")
  ) {
    return {
      type: value.type,
      tenantId: value.tenantId,
      displayName: value.displayName.trim(),
      ...(value.email !== undefined ? { email: value.email } : {}),
    };
  }
  if (
    value.type === "createCategory" &&
    isUuid(value.departmentId) &&
    typeof value.name === "string" &&
    isOptionalUuid(value.parentCategoryId)
  ) {
    return {
      type: value.type,
      tenantId: value.tenantId,
      departmentId: value.departmentId,
      name: value.name.trim(),
      ...(value.parentCategoryId !== undefined
        ? { parentCategoryId: value.parentCategoryId }
        : {}),
    };
  }
  const assignedAgentId = value.assignedAgentId;
  if (
    value.type === "createTicket" &&
    isUuid(value.departmentId) &&
    typeof value.subject === "string" &&
    typeof value.description === "string" &&
    typeof value.priorityKey === "string" &&
    isRequesterContactId(value.requesterContactId) &&
    isOptionalUuid(value.categoryId) &&
    isOptionalUuid(value.subcategoryId) &&
    (assignedAgentId === undefined ||
      assignedAgentId === null ||
      isUuid(assignedAgentId))
  ) {
    return {
      type: value.type,
      tenantId: value.tenantId,
      departmentId: value.departmentId,
      subject: value.subject.trim(),
      description: value.description.trim(),
      priorityKey: value.priorityKey.trim(),
      requesterContactId: value.requesterContactId,
      ...(value.categoryId !== undefined
        ? { categoryId: value.categoryId }
        : {}),
      ...(value.subcategoryId !== undefined
        ? { subcategoryId: value.subcategoryId }
        : {}),
      ...(assignedAgentId !== undefined ? { assignedAgentId } : {}),
    };
  }
  return null;
}
async function activeMember(admin: any, userId: string, tenantId: string) {
  const { data } = await admin
    .from("tenant_memberships")
    .select("tenant_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  return Boolean(data);
}

async function canManageRequesters(
  userClient: any,
  tenantId: string,
): Promise<PermissionResult> {
  // Match migration 0023, including tenant roles and effective permissions in
  // active departments. Service-role auth must not stand in for the caller.
  const { data, error } = await userClient.rpc("can_manage_ticket_requesters", {
    p_tenant_id: tenantId,
  });
  return { allowed: data === true, error: Boolean(error) };
}

type RequesterResult = { requester: RequesterOption | null; error: boolean };

async function ensureCurrentRequester(
  admin: any,
  context: unknown,
  userId: string,
  tenantId: string,
): Promise<RequesterResult> {
  const { data: self, error: selfError } = await admin
    .from("ticket_requesters")
    .select("id, display_name")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .maybeSingle();
  if (selfError) return { requester: null, error: true };
  if (self) return { requester: publicRequester(self), error: false };
  const { data: profile, error: profileError } = await admin
    .from("user_profiles")
    .select("display_name")
    .eq("id", userId)
    .maybeSingle();
  if (profileError) return { requester: null, error: true };
  const claims =
    isRecord(context) && isRecord(context.userClaims) ? context.userClaims : {};
  const metadata = isRecord(claims.userMetadata) ? claims.userMetadata : {};
  const name =
    [
      profile?.display_name,
      metadata.display_name,
      metadata.full_name,
      metadata.name,
    ]
      .find(
        (candidate): candidate is string =>
          typeof candidate === "string" &&
          isRequesterName(candidate.trim()) &&
          !candidate.includes("@") &&
          !isUuid(candidate.trim()),
      )
      ?.trim() ?? "Angemeldete Person";

  // The unique tenant+user index arbitrates concurrent first reads. Do not copy
  // auth email or relink an email contact: migration 0023 makes user_id immutable.
  const { data: created, error: createError } = await admin
    .from("ticket_requesters")
    .insert({
      tenant_id: tenantId,
      user_id: userId,
      display_name: name,
      email: null,
      source: "portal",
    })
    .select("id, display_name")
    .single();
  if (!createError && created) {
    return { requester: publicRequester(created), error: false };
  }
  if (createError?.code === "23505") {
    const { data: existing, error } = await admin
      .from("ticket_requesters")
      .select("id, display_name")
      .eq("tenant_id", tenantId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!error && existing) {
      return { requester: publicRequester(existing), error: false };
    }
  }
  return { requester: null, error: true };
}

async function createRequester(
  admin: any,
  tenantId: string,
  displayName: string,
  email: string | null,
): Promise<RequesterResult> {
  if (email !== null) {
    const { data: existing, error } = await admin
      .from("ticket_requesters")
      .select("id, display_name, user_id")
      .eq("tenant_id", tenantId)
      .eq("email", email)
      .maybeSingle();
    if (error) return { requester: null, error: true };
    if (existing) return { requester: publicRequester(existing), error: false };
  }
  const { data: created, error } = await admin
    .from("ticket_requesters")
    .insert({
      tenant_id: tenantId,
      display_name: displayName,
      email,
      user_id: null,
      source: "manual",
    })
    .select("id, display_name, user_id")
    .single();
  if (!error && created) {
    return { requester: publicRequester(created), error: false };
  }
  if (error?.code === "23505" && email !== null) {
    const { data: existing, error: lookupError } = await admin
      .from("ticket_requesters")
      .select("id, display_name, user_id")
      .eq("tenant_id", tenantId)
      .eq("email", email)
      .maybeSingle();
    if (!lookupError && existing) {
      return { requester: publicRequester(existing), error: false };
    }
  }
  return { requester: null, error: true };
}

function requesterSearchFilter(query: string): string {
  // Escape LIKE wildcards as well as PostgREST quoted-value delimiters. A user
  // query must never become another OR clause or a match-all wildcard.
  const pattern = `%${query.replace(/[\\%_*]/g, "\\$&")}%`;
  const quoted = `"${pattern.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  return `display_name.ilike.${quoted},email.ilike.${quoted}`;
}

type CategoryOption = { id: string; name: string; parentId: string | null };

function publicCategory(row: {
  id: string;
  name: string;
  parent_id: string | null;
}): CategoryOption {
  return { id: row.id, name: row.name, parentId: row.parent_id };
}

async function getCategories(
  userClient: any,
  tenantId: string,
  departmentId: string,
): Promise<{
  categories: CategoryOption[];
  departmentFound: boolean;
  error: boolean;
}> {
  // Use the caller's client: active tenant membership is also enforced by RLS.
  const { data: department, error: departmentError } = await userClient
    .from("departments")
    .select("id")
    .eq("id", departmentId)
    .eq("tenant_id", tenantId)
    .eq("active", true)
    .maybeSingle();
  if (departmentError || !department) {
    return {
      categories: [],
      departmentFound: false,
      error: Boolean(departmentError),
    };
  }

  const { data, error } = await userClient
    .from("ticket_categories")
    .select("id, name, parent_id")
    .eq("tenant_id", tenantId)
    .eq("department_id", departmentId)
    .eq("active", true)
    .order("name")
    .order("id");
  return {
    categories: (data ?? []).map(publicCategory),
    departmentFound: true,
    error: Boolean(error),
  };
}

type PermissionResult = { allowed: boolean; error: boolean };

async function canCreateCategory(
  userClient: any,
  tenantId: string,
  departmentId: string,
): Promise<PermissionResult> {
  // Match migration 0022, including tenant-scoped department managers who do
  // not need a membership in each individual department.
  const results = await Promise.all([
    userClient.rpc("has_ticket_permission", {
      p_tenant_id: tenantId,
      p_department_id: departmentId,
      p_permission_code: "ticket.update",
    }),
    userClient.rpc("has_ticket_permission", {
      p_tenant_id: tenantId,
      p_department_id: departmentId,
      p_permission_code: "department.manage",
    }),
    userClient.rpc("has_tenant_permission", {
      p_tenant_id: tenantId,
      p_permission_code: "department.manage",
    }),
  ]);
  return {
    allowed: results.some((result) => result.data === true),
    error: results.some((result) => Boolean(result.error)),
  };
}

async function hasTicketPermission(
  admin: any,
  userId: string,
  tenantId: string,
  departmentId: string,
  permissionCode: string,
): Promise<PermissionResult> {
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
    return (
      role?.tenant_id === tenantId &&
      role.active === true &&
      (role.scope === "tenant" ||
        (role.scope === "department" &&
          assignment.department_id === departmentId &&
          Boolean(departmentMembership))) &&
      (role.role_permissions ?? []).some(
        (item: any) => item.permission_code === permissionCode,
      )
    );
  });
  return { allowed, error: false };
}

type EligibleAgentIdsResult = { agentIds: string[]; error: boolean };

async function getEligibleAssignableAgentIds(
  admin: any,
  tenantId: string,
  departmentId: string,
): Promise<EligibleAgentIdsResult> {
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
    return { agentIds: [], error: true };
  }

  const activeTenantMemberIds = new Set(
    (tenantMemberships ?? []).map((membership: any) => membership.user_id),
  );
  const activeDepartmentMemberIds = new Set(
    (departmentMemberships ?? []).map((membership: any) => membership.user_id),
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
    if (role?.tenant_id !== tenantId || role.active !== true) {
      continue;
    }

    const canHandleAssignedTickets = (role.role_permissions ?? []).some(
      (permission: any) =>
        permission.permission_code === "ticket.read.assigned" ||
        permission.permission_code === "ticket.update",
    );
    if (!canHandleAssignedTickets) continue;

    const tenantScopedAgent = role.scope === "tenant";
    const departmentScopedAgent =
      role.scope === "department" &&
      assignment.department_id === departmentId &&
      activeDepartmentMemberIds.has(assignment.user_id);
    if (tenantScopedAgent || departmentScopedAgent) {
      agentIds.add(assignment.user_id);
    }
  }
  return { agentIds: [...agentIds], error: false };
}

async function getAssignableAgents(
  admin: any,
  tenantId: string,
  departmentId: string,
): Promise<{
  agents: Array<{ id: string; displayName: string | null }>;
  error: boolean;
}> {
  const eligible = await getEligibleAssignableAgentIds(
    admin,
    tenantId,
    departmentId,
  );
  if (eligible.error || eligible.agentIds.length === 0) {
    return { agents: [], error: eligible.error };
  }

  const { data: profiles, error } = await admin
    .from("user_profiles")
    .select("id, display_name")
    .in("id", eligible.agentIds);
  if (error) return { agents: [], error: true };

  const profileNames = new Map<string, string | null>();
  for (const profile of profiles ?? []) {
    if (!isUuid(profile.id)) continue;
    profileNames.set(
      profile.id,
      typeof profile.display_name === "string" ? profile.display_name : null,
    );
  }
  const agents = eligible.agentIds.map((id) => ({
    id,
    displayName: profileNames.get(id) ?? "Aktiver Agent",
  }));
  agents.sort(
    (left, right) =>
      (left.displayName ?? "").localeCompare(
        right.displayName ?? "",
        "de-CH",
      ) || left.id.localeCompare(right.id),
  );
  return { agents, error: false };
}
const handler = withSupabase({ auth: "user" }, async (request, context) => {
  if (request.method !== "POST") {
    return json(request, { error: { code: "method_not_allowed" } }, 405);
  }
  const input = await request.json().catch(() => null);
  const action = parseAction(input);
  const actorId = context.userClaims?.id;
  if (!action || typeof actorId !== "string") {
    if (isRecord(input) && input.type === "searchRequesters") {
      return requesterError(
        request,
        "invalid_requester_query",
        "Bitte geben Sie einen gültigen Suchbegriff mit 2 bis 120 Zeichen ein.",
        422,
      );
    }
    if (isRecord(input) && input.type === "createRequester") {
      return requesterError(
        request,
        "invalid_requester_input",
        "Bitte geben Sie einen gültigen Namen und gegebenenfalls eine gültige E-Mail-Adresse ein.",
        422,
      );
    }
    if (
      isRecord(input) &&
      input.type === "createTicket" &&
      !isRequesterContactId(input.requesterContactId)
    ) {
      return requesterError(
        request,
        "invalid_requester_contact",
        "Bitte wählen Sie eine gültige anfragende Person aus.",
        422,
      );
    }
    const invalidCategoryInput =
      isRecord(input) &&
      (input.type === "createCategory" ||
        (input.type === "createTicket" &&
          (!isOptionalUuid(input.categoryId) ||
            !isOptionalUuid(input.subcategoryId))));
    return json(
      request,
      {
        error: {
          code: invalidCategoryInput
            ? "invalid_category_input"
            : "invalid_request",
        },
      },
      invalidCategoryInput ? 422 : 400,
    );
  }
  if (!(await activeMember(context.supabaseAdmin, actorId, action.tenantId))) {
    return json(
      request,
      {
        error: {
          code: "tenant_membership_required",
          message:
            "Für diese Anfrage ist eine aktive Mandantenmitgliedschaft erforderlich.",
        },
      },
      403,
    );
  }
  if (action.type === "getFormOptions") {
    const requester = await getRequesterContext(
      context.supabaseAdmin,
      context,
      actorId,
      action.tenantId,
    );
    if (requester.error) {
      return json(
        request,
        {
          error: {
            code: "ticket_form_options_failed",
            message:
              "Die Angaben für die Ticketerstellung konnten nicht geladen werden.",
          },
        },
        500,
      );
    }
    const [
      { data: departments, error: departmentsError },
      { data: priorities, error: prioritiesError },
      categoryOptions,
      currentRequester,
    ] = await Promise.all([
      context.supabase
        .from("departments")
        .select("id, key, name, kind")
        .eq("tenant_id", action.tenantId)
        .eq("active", true)
        .order("name"),
      context.supabase
        .from("ticket_priorities")
        .select("key, label, sort_order")
        .eq("tenant_id", action.tenantId)
        .order("sort_order"),
      action.departmentId
        ? getCategories(context.supabase, action.tenantId, action.departmentId)
        : Promise.resolve({
            categories: [],
            departmentFound: true,
            error: false,
          }),
      ensureCurrentRequester(
        context.supabaseAdmin,
        context,
        actorId,
        action.tenantId,
      ),
    ]);
    if (
      departmentsError ||
      prioritiesError ||
      categoryOptions.error ||
      currentRequester.error ||
      !currentRequester.requester
    ) {
      return json(
        request,
        {
          error: {
            code: "ticket_form_options_failed",
            message:
              "Die Angaben für die Ticketerstellung konnten nicht geladen werden.",
          },
        },
        500,
      );
    }
    if (!categoryOptions.departmentFound) {
      return json(
        request,
        { error: { code: "ticket_reference_missing" } },
        422,
      );
    }
    return json(request, {
      data: {
        departments: departments ?? [],
        priorities: priorities ?? [],
        // No tenant-wide category list before a department has been selected.
        categories: categoryOptions.categories,
        requesterContext: requester.requesterContext,
        currentRequester: currentRequester.requester,
      },
    });
  }
  if (action.type === "searchRequesters" || action.type === "createRequester") {
    if (action.type === "searchRequesters") {
      const length = Array.from(action.query).length;
      if (
        length < 2 ||
        length > 120 ||
        /[\u0000-\u001f\u007f]/.test(action.query)
      ) {
        return requesterError(
          request,
          "invalid_requester_query",
          "Bitte geben Sie einen Suchbegriff mit 2 bis 120 Zeichen ein.",
          422,
        );
      }
    } else {
      if (!isRequesterName(action.displayName)) {
        return requesterError(
          request,
          "invalid_requester_name",
          "Der Name muss 2 bis 160 Zeichen lang sein und darf keine Steuerzeichen enthalten.",
          422,
        );
      }
      if (
        action.email !== undefined &&
        normalizedRequesterEmail(action.email) === null
      ) {
        return requesterError(
          request,
          "invalid_requester_email",
          "Bitte geben Sie eine gültige E-Mail-Adresse ein oder lassen Sie das Feld weg.",
          422,
        );
      }
    }
    const permission = await canManageRequesters(
      context.supabase,
      action.tenantId,
    );
    if (permission.error) {
      return requesterError(
        request,
        "requester_permission_check_failed",
        "Die Berechtigung für anfragende Personen konnte nicht geprüft werden.",
        500,
      );
    }
    if (!permission.allowed) {
      return requesterError(
        request,
        "requester_manage_denied",
        "Sie sind nicht berechtigt, anfragende Personen zu suchen oder anzulegen.",
        403,
      );
    }
    if (action.type === "searchRequesters") {
      const { data: requesters, error } = await context.supabaseAdmin
        .from("ticket_requesters")
        .select("id, display_name")
        .eq("tenant_id", action.tenantId)
        .or(requesterSearchFilter(action.query))
        .order("display_name")
        .order("id")
        .limit(30);
      if (error) {
        return requesterError(
          request,
          "requesters_lookup_failed",
          "Anfragende Personen konnten nicht gesucht werden.",
          500,
        );
      }
      return json(request, {
        data: { requesters: (requesters ?? []).map(publicRequester) },
      });
    }
    const result = await createRequester(
      context.supabaseAdmin,
      action.tenantId,
      action.displayName,
      action.email === undefined
        ? null
        : normalizedRequesterEmail(action.email),
    );
    if (result.error || !result.requester) {
      return requesterError(
        request,
        "requester_create_failed",
        "Die anfragende Person konnte nicht angelegt werden. Bitte versuchen Sie es erneut.",
        500,
      );
    }
    return json(request, { data: result.requester }, 201);
  }
  if (action.type === "getCategories") {
    const options = await getCategories(
      context.supabase,
      action.tenantId,
      action.departmentId,
    );
    if (options.error) {
      return json(
        request,
        {
          error: { code: "ticket_categories_lookup_failed" },
        },
        500,
      );
    }
    if (!options.departmentFound) {
      return json(
        request,
        { error: { code: "ticket_reference_missing" } },
        422,
      );
    }
    return json(request, { data: { categories: options.categories } });
  }
  if (action.type === "createCategory") {
    const nameLength = Array.from(action.name).length;
    if (nameLength < 2 || nameLength > 120 || action.name.includes("\0")) {
      return json(request, { error: { code: "invalid_category_name" } }, 422);
    }

    const { data: department, error: departmentError } = await context.supabase
      .from("departments")
      .select("id")
      .eq("id", action.departmentId)
      .eq("tenant_id", action.tenantId)
      .eq("active", true)
      .maybeSingle();
    if (departmentError) {
      return json(request, { error: { code: "category_create_failed" } }, 500);
    }
    if (!department) {
      return json(
        request,
        { error: { code: "ticket_reference_missing" } },
        422,
      );
    }

    const permission = await canCreateCategory(
      context.supabase,
      action.tenantId,
      action.departmentId,
    );
    if (permission.error) {
      return json(
        request,
        {
          error: { code: "category_permission_check_failed" },
        },
        500,
      );
    }
    if (!permission.allowed) {
      return json(request, { error: { code: "category_create_denied" } }, 403);
    }

    const parentId = action.parentCategoryId ?? null;
    if (parentId !== null) {
      const { data: parent, error: parentError } = await context.supabase
        .from("ticket_categories")
        .select("id")
        .eq("id", parentId)
        .eq("tenant_id", action.tenantId)
        .eq("department_id", action.departmentId)
        .eq("active", true)
        .is("parent_id", null)
        .maybeSingle();
      if (parentError) {
        return json(
          request,
          {
            error: { code: "ticket_categories_lookup_failed" },
          },
          500,
        );
      }
      if (!parent) {
        return json(
          request,
          { error: { code: "invalid_category_parent" } },
          422,
        );
      }
    }

    // The caller-scoped insert preserves both mutation RLS and audit auth.uid().
    const { data: category, error: categoryError } = await context.supabase
      .from("ticket_categories")
      .insert({
        tenant_id: action.tenantId,
        department_id: action.departmentId,
        name: action.name,
        parent_id: parentId,
        active: true,
      })
      .select("id, name, parent_id")
      .single();
    if (!categoryError && category) {
      return json(request, { data: publicCategory(category) }, 201);
    }

    if (categoryError?.code === "23505") {
      // A retry/concurrent insert returns the existing active row, without
      // reactivating an archived category or changing its parent/name.
      let existingQuery = context.supabase
        .from("ticket_categories")
        .select("id, name, parent_id")
        .eq("tenant_id", action.tenantId)
        .eq("department_id", action.departmentId)
        .eq("name", action.name)
        .eq("active", true);
      existingQuery =
        parentId === null
          ? existingQuery.is("parent_id", null)
          : existingQuery.eq("parent_id", parentId);
      const { data: existing, error: existingError } =
        await existingQuery.maybeSingle();
      if (existingError) {
        return json(
          request,
          { error: { code: "category_create_failed" } },
          500,
        );
      }
      if (existing) {
        return json(request, { data: publicCategory(existing) });
      }
      return json(request, { error: { code: "category_conflict" } }, 409);
    }
    if (categoryError?.code === "42501") {
      return json(request, { error: { code: "category_create_denied" } }, 403);
    }
    if (categoryError?.code === "23503" || categoryError?.code === "23514") {
      return json(request, { error: { code: "invalid_category_parent" } }, 422);
    }
    return json(request, { error: { code: "category_create_failed" } }, 500);
  }
  if (action.type === "getAssignableAgents") {
    const { data: department, error: departmentError } =
      await context.supabaseAdmin
        .from("departments")
        .select("id")
        .eq("id", action.departmentId)
        .eq("tenant_id", action.tenantId)
        .eq("active", true)
        .maybeSingle();
    if (departmentError) {
      return json(
        request,
        { error: { code: "ticket_agents_lookup_failed" } },
        500,
      );
    }
    if (!department) {
      return json(
        request,
        { error: { code: "ticket_reference_missing" } },
        422,
      );
    }

    const assignPermission = await hasTicketPermission(
      context.supabaseAdmin,
      actorId,
      action.tenantId,
      action.departmentId,
      "ticket.assign",
    );
    if (assignPermission.error) {
      return json(
        request,
        { error: { code: "ticket_agents_lookup_failed" } },
        500,
      );
    }
    if (!assignPermission.allowed) {
      return json(
        request,
        {
          error: {
            code: "ticket_assign_denied",
            message:
              "Sie sind nicht berechtigt, für diese Abteilung zuweisbare Personen abzurufen.",
          },
        },
        403,
      );
    }

    const assignableAgents = await getAssignableAgents(
      context.supabaseAdmin,
      action.tenantId,
      action.departmentId,
    );
    if (assignableAgents.error) {
      return json(
        request,
        {
          error: {
            code: "ticket_agents_lookup_failed",
            message: "Zuweisbare Personen konnten nicht geprüft werden.",
          },
        },
        500,
      );
    }
    return json(request, { data: { agents: assignableAgents.agents } });
  }
  if (
    action.subject.length < 3 ||
    action.subject.length > 240 ||
    action.description.length < 1 ||
    action.description.length > 50000
  ) {
    return json(request, { error: { code: "invalid_ticket_content" } }, 422);
  }
  const { data: department } = await context.supabaseAdmin
    .from("departments")
    .select("id, key")
    .eq("id", action.departmentId)
    .eq("tenant_id", action.tenantId)
    .eq("active", true)
    .maybeSingle();
  const { data: status } = await context.supabaseAdmin
    .from("ticket_statuses")
    .select("id")
    .eq("tenant_id", action.tenantId)
    .eq("key", "new")
    .maybeSingle();
  const { data: priority } = await context.supabaseAdmin
    .from("ticket_priorities")
    .select("id")
    .eq("tenant_id", action.tenantId)
    .eq("key", action.priorityKey)
    .maybeSingle();
  if (!department || !status || !priority) {
    return json(request, { error: { code: "ticket_reference_missing" } }, 422);
  }
  const { data: requesterContact, error: requesterContactError } =
    await context.supabaseAdmin
      .from("ticket_requesters")
      .select("id, user_id")
      .eq("tenant_id", action.tenantId)
      .eq("id", action.requesterContactId)
      .maybeSingle();
  if (requesterContactError) {
    return requesterError(
      request,
      "requesters_lookup_failed",
      "Die ausgewählte anfragende Person konnte nicht geprüft werden.",
      500,
    );
  }
  if (
    !requesterContact ||
    (requesterContact.user_id !== null && !isUuid(requesterContact.user_id))
  ) {
    return requesterError(
      request,
      "invalid_requester_contact",
      "Bitte wählen Sie eine gültige anfragende Person aus.",
      422,
    );
  }
  if (requesterContact.user_id !== actorId) {
    const updatePermission = await hasTicketPermission(
      context.supabaseAdmin,
      actorId,
      action.tenantId,
      action.departmentId,
      "ticket.update",
    );
    if (updatePermission.error) {
      return requesterError(
        request,
        "requester_permission_check_failed",
        "Die Berechtigung für die ausgewählte anfragende Person konnte nicht geprüft werden.",
        500,
      );
    }
    if (!updatePermission.allowed) {
      return requesterError(
        request,
        "requester_selection_denied",
        "Sie sind nicht berechtigt, ein Ticket für eine andere anfragende Person zu erstellen.",
        403,
      );
    }
  }
  const requesterId = requesterContact.user_id ?? actorId;
  const categoryId = action.categoryId ?? null;
  const subcategoryId = action.subcategoryId ?? null;
  if (subcategoryId !== null && categoryId === null) {
    return json(request, { error: { code: "invalid_ticket_category" } }, 422);
  }
  if (categoryId !== null) {
    const { data: category, error: categoryError } = await context.supabase
      .from("ticket_categories")
      .select("id")
      .eq("id", categoryId)
      .eq("tenant_id", action.tenantId)
      .eq("department_id", action.departmentId)
      .eq("active", true)
      .is("parent_id", null)
      .maybeSingle();
    if (categoryError) {
      return json(
        request,
        {
          error: { code: "ticket_categories_lookup_failed" },
        },
        500,
      );
    }
    if (!category) {
      return json(request, { error: { code: "invalid_ticket_category" } }, 422);
    }
  }
  if (subcategoryId !== null) {
    const { data: subcategory, error: subcategoryError } =
      await context.supabase
        .from("ticket_categories")
        .select("id")
        .eq("id", subcategoryId)
        .eq("tenant_id", action.tenantId)
        .eq("department_id", action.departmentId)
        .eq("active", true)
        .eq("parent_id", categoryId!)
        .maybeSingle();
    if (subcategoryError) {
      return json(
        request,
        {
          error: { code: "ticket_categories_lookup_failed" },
        },
        500,
      );
    }
    if (!subcategory) {
      return json(request, { error: { code: "invalid_ticket_category" } }, 422);
    }
  }
  if (action.assignedAgentId !== undefined && action.assignedAgentId !== null) {
    const assignPermission = await hasTicketPermission(
      context.supabaseAdmin,
      actorId,
      action.tenantId,
      action.departmentId,
      "ticket.assign",
    );
    if (assignPermission.error) {
      return json(
        request,
        {
          error: {
            code: "ticket_agents_lookup_failed",
            message: "Die Zuweisungsberechtigung konnte nicht geprüft werden.",
          },
        },
        500,
      );
    }
    if (!assignPermission.allowed) {
      return json(
        request,
        {
          error: {
            code: "ticket_assign_denied",
            message:
              "Sie sind nicht berechtigt, diesem Ticket eine Person zuzuweisen.",
          },
        },
        403,
      );
    }
    const eligibleAgents = await getEligibleAssignableAgentIds(
      context.supabaseAdmin,
      action.tenantId,
      action.departmentId,
    );
    if (eligibleAgents.error) {
      return json(
        request,
        {
          error: {
            code: "ticket_agents_lookup_failed",
            message: "Die ausgewählte Person konnte nicht geprüft werden.",
          },
        },
        500,
      );
    }
    if (!eligibleAgents.agentIds.includes(action.assignedAgentId)) {
      return json(
        request,
        {
          error: {
            code: "assigned_agent_invalid",
            message:
              "Die ausgewählte Person ist für die gewählte Abteilung nicht zuweisbar.",
          },
        },
        422,
      );
    }
  }
  await context.supabaseAdmin.from("user_profiles").upsert({ id: actorId });
  const { data: ticketNumber, error: numberError } =
    await context.supabaseAdmin.rpc("reserve_ticket_number", {
      p_tenant_id: action.tenantId,
      p_department_id: action.departmentId,
      p_prefix: department.key.slice(0, 8),
    });
  if (numberError || typeof ticketNumber !== "string") {
    return json(request, { error: { code: "ticket_number_failed" } }, 500);
  }
  const { data: ticket, error: ticketError } = await context.supabaseAdmin
    .from("tickets")
    .insert({
      tenant_id: action.tenantId,
      department_id: action.departmentId,
      ticket_number: ticketNumber,
      subject: action.subject,
      description: action.description,
      status_id: status.id,
      priority_id: priority.id,
      category_id: categoryId,
      subcategory_id: subcategoryId,
      requester_id: requesterId,
      requester_contact_id: action.requesterContactId,
      assigned_agent_id: action.assignedAgentId ?? null,
    })
    .select("id, ticket_number")
    .single();
  if (ticketError || !ticket) {
    return json(request, { error: { code: "ticket_create_failed" } }, 422);
  }
  await context.supabaseAdmin.from("ticket_events").insert({
    ticket_id: ticket.id,
    actor_id: actorId,
    event_type: "ticket.created",
    payload: {
      source: "web_portal",
      ...(action.assignedAgentId !== undefined
        ? { assigned_agent_id: action.assignedAgentId }
        : {}),
    },
  });
  return json(
    request,
    { data: { ticketId: ticket.id, ticketNumber: ticket.ticket_number } },
    201,
  );
});
export default {
  fetch(request: Request): Response | Promise<Response> {
    if (request.method === "OPTIONS") return json(request, {}, 204);
    return handler(request);
  },
};
