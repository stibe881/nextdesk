import { withSupabase } from "@supabase/server";

const ALLOWED_ORIGIN = "https://app.nextdesk.ch";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_SLA_MINUTES = 525600;
const MAX_ESCALATIONS = 100;
const MAX_RULES = 500;
const DEFAULT_ESCALATION_LIMIT = 50;
const DEFAULT_PRIORITY_KEY = "normal";
const DEFAULT_SERVICE_HOURS = {
  weekdays: [1, 2, 3, 4, 5],
  start: "08:00",
  end: "17:00",
};
const SLA_RULE_SELECT =
  "id, sla_profile_id, priority_key, response_minutes, resolution_minutes, ticket_sla_profiles!inner(id, tenant_id, name, active, service_hours, created_at, updated_at)";

type Action =
  | { type: "listRules"; tenantId: string }
  | {
      type: "saveRule";
      tenantId: string;
      ruleId?: string;
      name: string;
      priorityKey: string;
      departmentId: string | null;
      responseMinutes: number;
      resolutionMinutes: number;
      active: boolean;
    }
  | { type: "archiveRule"; tenantId: string; ruleId: string }
  | { type: "listEscalations"; tenantId: string; limit: number };

type PermissionScopes = {
  tenantWide: boolean;
  departmentIds: Set<string>;
};

type SlaProfile = {
  id: string;
  tenant_id: string;
  name: string;
  active: boolean;
  service_hours: unknown;
  created_at?: string;
  updated_at?: string;
};

type SlaRule = {
  id: string;
  sla_profile_id: string;
  priority_key: string;
  response_minutes: number;
  resolution_minutes: number;
  ticket_sla_profiles: SlaProfile | SlaProfile[] | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function textInRange(
  value: unknown,
  minimum: number,
  maximum: number,
): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length >= minimum && normalized.length <= maximum
    ? normalized
    : null;
}

function isMinutes(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= MAX_SLA_MINUTES
  );
}

function parseOptionalDepartmentId(
  value: Record<string, unknown>,
): string | null | undefined {
  if (!("departmentId" in value)) return undefined;
  if (value.departmentId === null) return null;
  return isUuid(value.departmentId) ? value.departmentId : undefined;
}

function parseOptionalPriorityKey(
  value: Record<string, unknown>,
): string | null | undefined {
  if (!("priorityKey" in value)) return undefined;
  if (value.priorityKey === null) return null;
  return textInRange(value.priorityKey, 1, 63) ?? undefined;
}

function parseAction(value: unknown): Action | null {
  if (
    !isRecord(value) ||
    !isUuid(value.tenantId) ||
    typeof value.type !== "string"
  ) {
    return null;
  }

  if (value.type === "listRules" && hasOnlyKeys(value, ["type", "tenantId"])) {
    return { type: "listRules", tenantId: value.tenantId };
  }

  if (
    value.type === "listEscalations" &&
    hasOnlyKeys(value, ["type", "tenantId", "limit"])
  ) {
    if (
      value.limit !== undefined &&
      (typeof value.limit !== "number" ||
        !Number.isInteger(value.limit) ||
        value.limit < 1 ||
        value.limit > MAX_ESCALATIONS)
    ) {
      return null;
    }
    return {
      type: "listEscalations",
      tenantId: value.tenantId,
      limit: (value.limit as number | undefined) ?? DEFAULT_ESCALATION_LIMIT,
    };
  }

  if (
    value.type === "archiveRule" &&
    hasOnlyKeys(value, ["type", "tenantId", "ruleId"]) &&
    isUuid(value.ruleId)
  ) {
    return {
      type: "archiveRule",
      tenantId: value.tenantId,
      ruleId: value.ruleId,
    };
  }

  if (
    value.type !== "saveRule" ||
    !hasOnlyKeys(value, [
      "type",
      "tenantId",
      "ruleId",
      "name",
      "priorityKey",
      "departmentId",
      "responseMinutes",
      "resolutionMinutes",
      "active",
    ])
  ) {
    return null;
  }

  const name = textInRange(value.name, 1, 160);
  const priorityKey = parseOptionalPriorityKey(value);
  const departmentId = parseOptionalDepartmentId(value);
  const hasPriorityKey = "priorityKey" in value;
  const hasDepartmentId = "departmentId" in value;
  if (
    name === null ||
    (hasPriorityKey && priorityKey === undefined) ||
    (hasDepartmentId && departmentId === undefined) ||
    !isMinutes(value.responseMinutes) ||
    !isMinutes(value.resolutionMinutes) ||
    typeof value.active !== "boolean" ||
    ("ruleId" in value && !isUuid(value.ruleId))
  ) {
    return null;
  }

  return {
    type: "saveRule",
    tenantId: value.tenantId,
    ...(isUuid(value.ruleId) ? { ruleId: value.ruleId } : {}),
    name,
    // A missing priority uses the tenant's standard priority, which is still
    // resolved and validated against ticket_priorities below.
    priorityKey: priorityKey ?? DEFAULT_PRIORITY_KEY,
    departmentId: departmentId ?? null,
    responseMinutes: value.responseMinutes,
    resolutionMinutes: value.resolutionMinutes,
    active: value.active,
  };
}

function corsHeaders(request: Request): Headers {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
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

function originIsAllowed(request: Request): boolean {
  const origin = request.headers.get("origin");
  return origin === null || origin === ALLOWED_ORIGIN;
}

function preflightResponse(request: Request): Response {
  if (request.headers.get("origin") !== ALLOWED_ORIGIN) {
    return new Response(null, { status: 403, headers: { Vary: "Origin" } });
  }
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

async function requireActiveTenantMembership(
  admin: any,
  actorId: string,
  tenantId: string,
): Promise<"allowed" | "forbidden" | "error"> {
  const { data, error } = await admin
    .from("tenant_memberships")
    .select("tenant_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", actorId)
    .eq("status", "active")
    .maybeSingle();
  if (error) return "error";
  return data ? "allowed" : "forbidden";
}

async function getPermissionScopes(
  admin: any,
  actorId: string,
  tenantId: string,
  permission: string,
): Promise<PermissionScopes | null> {
  const now = new Date().toISOString();
  const [assignmentsResult, departmentMembershipsResult] = await Promise.all([
    admin
      .from("user_role_assignments")
      .select(
        "department_id, roles!user_role_assignments_role_tenant_fk!inner(active, scope, role_permissions!inner(permission_code))",
      )
      .eq("tenant_id", tenantId)
      .eq("user_id", actorId)
      .lte("starts_at", now)
      .or(`expires_at.is.null,expires_at.gt.${now}`),
    admin
      .from("department_memberships")
      .select("department_id")
      .eq("tenant_id", tenantId)
      .eq("user_id", actorId)
      .eq("status", "active"),
  ]);
  if (assignmentsResult.error || departmentMembershipsResult.error) return null;

  const activeDepartmentIds = new Set<string>();
  for (const membership of departmentMembershipsResult.data ?? []) {
    if (isRecord(membership) && isUuid(membership.department_id)) {
      activeDepartmentIds.add(membership.department_id);
    }
  }
  const scopes: PermissionScopes = {
    tenantWide: false,
    departmentIds: new Set<string>(),
  };

  for (const assignment of assignmentsResult.data ?? []) {
    const role = assignment.roles as
      | {
          active?: boolean;
          scope?: string;
          role_permissions?: Array<{ permission_code?: string }>;
        }
      | undefined;
    if (
      !role?.active ||
      !role.role_permissions?.some(
        (item) => item.permission_code === permission,
      )
    ) {
      continue;
    }

    if (role.scope === "tenant") {
      scopes.tenantWide = true;
      continue;
    }
    const departmentId = assignment.department_id;
    if (
      role.scope === "department" &&
      isUuid(departmentId) &&
      activeDepartmentIds.has(departmentId)
    ) {
      scopes.departmentIds.add(departmentId as string);
    }
  }

  // A tenant-scoped role is valid for every department in which the user is
  // currently an active department member, matching has_ticket_permission.
  if (scopes.tenantWide) {
    for (const departmentId of activeDepartmentIds) {
      scopes.departmentIds.add(departmentId);
    }
  }
  return scopes;
}

function canAccessDepartment(
  scopes: PermissionScopes,
  departmentId: string | null,
): boolean {
  return departmentId === null
    ? scopes.tenantWide
    : scopes.departmentIds.has(departmentId);
}

function profileFromRule(rule: SlaRule): SlaProfile | null {
  const profile = rule.ticket_sla_profiles;
  if (Array.isArray(profile)) return profile[0] ?? null;
  return profile;
}

function departmentIdFromServiceHours(serviceHours: unknown): string | null {
  if (!isRecord(serviceHours)) return null;
  return isUuid(serviceHours.department_id) ? serviceHours.department_id : null;
}

function serviceHoursForDepartment(
  currentServiceHours: unknown,
  departmentId: string | null,
): Record<string, unknown> {
  const serviceHours: Record<string, unknown> = isRecord(currentServiceHours)
    ? { ...currentServiceHours }
    : { ...DEFAULT_SERVICE_HOURS };
  delete serviceHours.department_id;
  if (departmentId !== null) serviceHours.department_id = departmentId;
  return serviceHours;
}

function normalizeRule(rule: SlaRule) {
  const profile = profileFromRule(rule);
  if (!profile) return null;
  return {
    id: rule.id,
    name: profile.name,
    priorityKey: rule.priority_key,
    departmentId: departmentIdFromServiceHours(profile.service_hours),
    responseMinutes: rule.response_minutes,
    resolutionMinutes: rule.resolution_minutes,
    active: profile.active,
    createdAt: profile.created_at ?? null,
    updatedAt: profile.updated_at ?? null,
  };
}

function auditData(rule: SlaRule): Record<string, unknown> {
  const normalized = normalizeRule(rule);
  return normalized ?? { id: rule.id };
}

async function referencesAreValid(
  admin: any,
  tenantId: string,
  priorityKey: string,
  departmentId: string | null,
): Promise<boolean> {
  const priorityRequest = admin
    .from("ticket_priorities")
    .select("key")
    .eq("tenant_id", tenantId)
    .eq("key", priorityKey)
    .maybeSingle();
  const departmentRequest =
    departmentId === null
      ? Promise.resolve({ data: { id: null }, error: null })
      : admin
          .from("departments")
          .select("id")
          .eq("tenant_id", tenantId)
          .eq("id", departmentId)
          .eq("active", true)
          .maybeSingle();
  const [priorityResult, departmentResult] = await Promise.all([
    priorityRequest,
    departmentRequest,
  ]);
  return Boolean(
    !priorityResult.error &&
    priorityResult.data &&
    !departmentResult.error &&
    departmentResult.data,
  );
}

async function getRule(
  admin: any,
  tenantId: string,
  ruleId: string,
): Promise<{ data: SlaRule | null; error: boolean }> {
  const { data, error } = await admin
    .from("ticket_sla_rules")
    .select(SLA_RULE_SELECT)
    .eq("id", ruleId)
    .eq("ticket_sla_profiles.tenant_id", tenantId)
    .maybeSingle();
  return { data: (data as SlaRule | null) ?? null, error: Boolean(error) };
}

async function profileHasExactlyOneRule(
  admin: any,
  profileId: string,
): Promise<boolean | null> {
  const { data, error } = await admin
    .from("ticket_sla_rules")
    .select("id")
    .eq("sla_profile_id", profileId)
    .limit(2);
  if (error) return null;
  return (data ?? []).length === 1;
}

async function writeAudit(
  admin: any,
  tenantId: string,
  actorId: string,
  action: string,
  ruleId: string,
  beforeData: Record<string, unknown> | null,
  afterData: Record<string, unknown> | null,
): Promise<boolean> {
  const { error } = await admin.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_id: actorId,
    action,
    entity_type: "ticket_sla_rule",
    entity_id: ruleId,
    severity: "info",
    before_data: beforeData,
    after_data: afterData,
    metadata: { ruleId },
  });
  return !error;
}

async function listRules(
  admin: any,
  request: Request,
  tenantId: string,
  scopes: PermissionScopes,
): Promise<Response> {
  const { data, error } = await admin
    .from("ticket_sla_rules")
    .select(SLA_RULE_SELECT)
    .eq("ticket_sla_profiles.tenant_id", tenantId)
    .order("name", { foreignTable: "ticket_sla_profiles", ascending: true })
    .limit(MAX_RULES);
  if (error) {
    return json(request, { error: { code: "sla_rule_list_failed" } }, 500);
  }

  const rules = ((data ?? []) as SlaRule[])
    .filter((rule) => {
      const profile = profileFromRule(rule);
      return (
        profile !== null &&
        canAccessDepartment(
          scopes,
          departmentIdFromServiceHours(profile.service_hours),
        )
      );
    })
    .map(normalizeRule)
    .filter((rule): rule is NonNullable<typeof rule> => rule !== null);
  return json(request, {
    data: { rules, truncated: (data ?? []).length === MAX_RULES },
  });
}

async function saveRule(
  admin: any,
  request: Request,
  action: Extract<Action, { type: "saveRule" }>,
  actorId: string,
  scopes: PermissionScopes,
): Promise<Response> {
  if (!canAccessDepartment(scopes, action.departmentId)) {
    return json(request, { error: { code: "ticket_sla_manage_denied" } }, 403);
  }
  if (
    !(await referencesAreValid(
      admin,
      action.tenantId,
      action.priorityKey,
      action.departmentId,
    ))
  ) {
    return json(
      request,
      { error: { code: "sla_rule_reference_invalid" } },
      422,
    );
  }

  if (!action.ruleId) {
    const { data: profile, error: profileError } = await admin
      .from("ticket_sla_profiles")
      .insert({
        tenant_id: action.tenantId,
        name: action.name,
        active: action.active,
        service_hours: serviceHoursForDepartment(null, action.departmentId),
      })
      .select("id")
      .single();
    if (profileError || !profile?.id) {
      return json(
        request,
        { error: { code: "sla_profile_create_failed" } },
        422,
      );
    }

    const { data: created, error: createError } = await admin
      .from("ticket_sla_rules")
      .insert({
        sla_profile_id: profile.id,
        priority_key: action.priorityKey,
        response_minutes: action.responseMinutes,
        resolution_minutes: action.resolutionMinutes,
      })
      .select("id")
      .single();
    if (createError || !created?.id) {
      // A profile without its rule has no usable SLA behaviour, so clean it up.
      await admin.from("ticket_sla_profiles").delete().eq("id", profile.id);
      return json(request, { error: { code: "sla_rule_create_failed" } }, 422);
    }

    const result = await getRule(admin, action.tenantId, created.id);
    if (result.error || !result.data) {
      return json(request, { error: { code: "sla_rule_read_failed" } }, 500);
    }
    if (
      !(await writeAudit(
        admin,
        action.tenantId,
        actorId,
        "ticket.sla_rule.created",
        created.id,
        null,
        auditData(result.data),
      ))
    ) {
      return json(request, { error: { code: "sla_rule_audit_failed" } }, 500);
    }
    return json(request, { data: { rule: normalizeRule(result.data) } }, 201);
  }

  const existingResult = await getRule(admin, action.tenantId, action.ruleId);
  if (existingResult.error) {
    return json(request, { error: { code: "sla_rule_read_failed" } }, 500);
  }
  if (!existingResult.data) {
    return json(request, { error: { code: "sla_rule_not_found" } }, 404);
  }
  const existingProfile = profileFromRule(existingResult.data);
  if (!existingProfile) {
    return json(request, { error: { code: "sla_rule_read_failed" } }, 500);
  }
  if (
    !canAccessDepartment(
      scopes,
      departmentIdFromServiceHours(existingProfile.service_hours),
    )
  ) {
    return json(request, { error: { code: "ticket_sla_manage_denied" } }, 403);
  }

  // The schema stores lifecycle and name on a profile. Do not mutate a shared
  // profile, as that would silently alter sibling rules outside this request.
  const singleRule = await profileHasExactlyOneRule(admin, existingProfile.id);
  if (singleRule === null) {
    return json(request, { error: { code: "sla_rule_read_failed" } }, 500);
  }
  if (!singleRule) {
    return json(request, { error: { code: "sla_rule_profile_shared" } }, 409);
  }

  const { error: ruleUpdateError } = await admin
    .from("ticket_sla_rules")
    .update({
      priority_key: action.priorityKey,
      response_minutes: action.responseMinutes,
      resolution_minutes: action.resolutionMinutes,
    })
    .eq("id", action.ruleId)
    .eq("sla_profile_id", existingProfile.id);
  if (ruleUpdateError) {
    return json(request, { error: { code: "sla_rule_update_failed" } }, 422);
  }

  const { error: profileUpdateError } = await admin
    .from("ticket_sla_profiles")
    .update({
      name: action.name,
      active: action.active,
      service_hours: serviceHoursForDepartment(
        existingProfile.service_hours,
        action.departmentId,
      ),
      updated_at: new Date().toISOString(),
    })
    .eq("id", existingProfile.id)
    .eq("tenant_id", action.tenantId);
  if (profileUpdateError) {
    return json(request, { error: { code: "sla_profile_update_failed" } }, 422);
  }

  const result = await getRule(admin, action.tenantId, action.ruleId);
  if (result.error || !result.data) {
    return json(request, { error: { code: "sla_rule_read_failed" } }, 500);
  }
  if (
    !(await writeAudit(
      admin,
      action.tenantId,
      actorId,
      "ticket.sla_rule.updated",
      action.ruleId,
      auditData(existingResult.data),
      auditData(result.data),
    ))
  ) {
    return json(request, { error: { code: "sla_rule_audit_failed" } }, 500);
  }
  return json(request, { data: { rule: normalizeRule(result.data) } });
}

async function archiveRule(
  admin: any,
  request: Request,
  action: Extract<Action, { type: "archiveRule" }>,
  actorId: string,
  scopes: PermissionScopes,
): Promise<Response> {
  const existingResult = await getRule(admin, action.tenantId, action.ruleId);
  if (existingResult.error) {
    return json(request, { error: { code: "sla_rule_read_failed" } }, 500);
  }
  if (!existingResult.data) {
    return json(request, { error: { code: "sla_rule_not_found" } }, 404);
  }
  const profile = profileFromRule(existingResult.data);
  if (
    !profile ||
    !canAccessDepartment(
      scopes,
      departmentIdFromServiceHours(profile.service_hours),
    )
  ) {
    return json(request, { error: { code: "ticket_sla_manage_denied" } }, 403);
  }

  const singleRule = await profileHasExactlyOneRule(admin, profile.id);
  if (singleRule === null) {
    return json(request, { error: { code: "sla_rule_read_failed" } }, 500);
  }
  if (!singleRule) {
    return json(request, { error: { code: "sla_rule_profile_shared" } }, 409);
  }

  const { error: updateError } = await admin
    .from("ticket_sla_profiles")
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq("id", profile.id)
    .eq("tenant_id", action.tenantId);
  if (updateError) {
    return json(request, { error: { code: "sla_rule_archive_failed" } }, 422);
  }

  const result = await getRule(admin, action.tenantId, action.ruleId);
  if (result.error || !result.data) {
    return json(request, { error: { code: "sla_rule_read_failed" } }, 500);
  }
  if (
    !(await writeAudit(
      admin,
      action.tenantId,
      actorId,
      "ticket.sla_rule.archived",
      action.ruleId,
      auditData(existingResult.data),
      auditData(result.data),
    ))
  ) {
    return json(request, { error: { code: "sla_rule_audit_failed" } }, 500);
  }
  return json(request, {
    data: { archived: true, rule: normalizeRule(result.data) },
  });
}

async function listEscalations(
  admin: any,
  request: Request,
  tenantId: string,
  limit: number,
  scopes: PermissionScopes,
): Promise<Response> {
  if (scopes.departmentIds.size === 0) {
    return json(request, { data: { escalations: [] } });
  }

  let query = admin
    .from("ticket_escalations")
    .select(
      "id, ticket_id, level, kind, reason, opened_by, resolved_by, opened_at, resolved_at, tickets!inner(id, tenant_id, department_id, ticket_number, subject)",
    )
    .eq("tickets.tenant_id", tenantId)
    .order("opened_at", { ascending: false })
    .limit(limit);
  query = query.in("tickets.department_id", [...scopes.departmentIds]);

  const { data, error } = await query;
  if (error) {
    return json(
      request,
      { error: { code: "ticket_escalation_list_failed" } },
      500,
    );
  }
  const ticketIds = (data ?? [])
    .map((escalation: any) => escalation.ticket_id)
    .filter(isUuid);
  const slaEventsResult =
    ticketIds.length === 0
      ? { data: [], error: null }
      : await admin
          .from("ticket_sla_events")
          .select(
            "id, ticket_id, event_type, occurred_at, metadata, tickets!inner(tenant_id)",
          )
          .in("ticket_id", ticketIds)
          .eq("tickets.tenant_id", tenantId)
          .order("occurred_at", { ascending: false })
          .limit(Math.min(MAX_RULES, limit * 10));
  if (slaEventsResult.error) {
    return json(
      request,
      { error: { code: "ticket_sla_event_list_failed" } },
      500,
    );
  }
  const slaEventsByTicket = new Map<string, Array<Record<string, unknown>>>();
  for (const event of slaEventsResult.data ?? []) {
    if (!isUuid(event.ticket_id)) continue;
    const events = slaEventsByTicket.get(event.ticket_id) ?? [];
    events.push({
      id: event.id,
      eventType: event.event_type,
      occurredAt: event.occurred_at,
      metadata: event.metadata,
    });
    slaEventsByTicket.set(event.ticket_id, events);
  }
  const escalations = (data ?? []).map((escalation: any) => ({
    id: escalation.id,
    ticketId: escalation.ticket_id,
    level: escalation.level,
    kind: escalation.kind,
    reason: escalation.reason,
    openedBy: escalation.opened_by,
    resolvedBy: escalation.resolved_by,
    openedAt: escalation.opened_at,
    resolvedAt: escalation.resolved_at,
    ticket: escalation.tickets
      ? {
          id: escalation.tickets.id,
          departmentId: escalation.tickets.department_id,
          ticketNumber: escalation.tickets.ticket_number,
          subject: escalation.tickets.subject,
        }
      : null,
    slaEvents: slaEventsByTicket.get(escalation.ticket_id) ?? [],
  }));
  return json(request, {
    data: { escalations, truncated: escalations.length === limit },
  });
}

const handler = withSupabase({ auth: "user" }, async (request, context) => {
  if (!originIsAllowed(request)) {
    return json(request, { error: { code: "origin_not_allowed" } }, 403);
  }
  if (request.method !== "POST") {
    return json(request, { error: { code: "method_not_allowed" } }, 405);
  }

  const action = parseAction(await request.json().catch(() => null));
  const actorId = context.userClaims?.id;
  if (!action || !isUuid(actorId)) {
    return json(request, { error: { code: "invalid_request" } }, 400);
  }

  const admin = context.supabaseAdmin;
  const membership = await requireActiveTenantMembership(
    admin,
    actorId,
    action.tenantId,
  );
  if (membership === "error") {
    return json(
      request,
      { error: { code: "authorization_check_failed" } },
      500,
    );
  }
  if (membership === "forbidden") {
    return json(
      request,
      { error: { code: "tenant_membership_required" } },
      403,
    );
  }

  const permission =
    action.type === "listRules" || action.type === "listEscalations"
      ? "ticket.read.department"
      : "ticket.sla.manage";
  const scopes = await getPermissionScopes(
    admin,
    actorId,
    action.tenantId,
    permission,
  );
  if (!scopes) {
    return json(
      request,
      { error: { code: "authorization_check_failed" } },
      500,
    );
  }
  if (!scopes.tenantWide && scopes.departmentIds.size === 0) {
    return json(
      request,
      {
        error: {
          code:
            permission === "ticket.sla.manage"
              ? "ticket_sla_manage_denied"
              : "ticket_read_department_denied",
        },
      },
      403,
    );
  }

  if (action.type === "listRules") {
    return listRules(admin, request, action.tenantId, scopes);
  }
  if (action.type === "listEscalations") {
    return listEscalations(
      admin,
      request,
      action.tenantId,
      action.limit,
      scopes,
    );
  }
  if (action.type === "saveRule") {
    return saveRule(admin, request, action, actorId, scopes);
  }
  return archiveRule(admin, request, action, actorId, scopes);
});

export default {
  fetch(request: Request): Response | Promise<Response> {
    if (request.method === "OPTIONS") return preflightResponse(request);
    if (!originIsAllowed(request)) {
      return json(request, { error: { code: "origin_not_allowed" } }, 403);
    }
    return handler(request);
  },
};
