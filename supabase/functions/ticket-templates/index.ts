import { withSupabase } from "@supabase/server";

type ChecklistItem = { description: string };
type TemplateFields = {
  name: string;
  subjectTemplate: string;
  descriptionTemplate: string;
  priorityKey?: string | null;
  departmentId?: string | null;
  checklistItems?: ChecklistItem[];
};
type Action =
  | { type: "listTemplates"; tenantId: string }
  | ({ type: "createTemplate"; tenantId: string } & TemplateFields)
  | ({
      type: "updateTemplate";
      tenantId: string;
      templateId: string;
      active?: boolean;
    } & TemplateFields)
  | { type: "deleteTemplate"; tenantId: string; templateId: string };
type ManagementScopes = {
  tenantWide: boolean;
  departmentIds: Set<string>;
};

const ALLOWED_ORIGIN = "https://app.nextdesk.ch";
const TEMPLATE_SELECT =
  "id, tenant_id, department_id, name, subject_template, description_template, priority_key, active, created_by, created_at, updated_at, ticket_template_checklist_items(id, description, position)";
const SAFE_TEMPLATE_PLACEHOLDER =
  /\{\{(anfragende_person|abteilung|heute|ticket_nummer)\}\}/g;

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
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: corsHeaders(request),
  });
}

function requiredText(value: unknown, minLength: number, maxLength: number) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length >= minLength && trimmed.length <= maxLength
    ? trimmed
    : null;
}

function hasOnlySafeTemplatePlaceholders(value: string): boolean {
  return !/[{}]/.test(value.replace(SAFE_TEMPLATE_PLACEHOLDER, ""));
}

function optionalText(
  value: unknown,
  maxLength: number,
): { valid: true; value?: string | null } | { valid: false } {
  if (value === undefined || value === null) return { valid: true, value };
  const trimmed = requiredText(value, 1, maxLength);
  return trimmed === null ? { valid: false } : { valid: true, value: trimmed };
}

function optionalUuid(
  value: unknown,
): { valid: true; value?: string | null } | { valid: false } {
  if (value === undefined || value === null) return { valid: true, value };
  return isUuid(value) ? { valid: true, value } : { valid: false };
}

function parseChecklistItems(
  value: unknown,
): ChecklistItem[] | undefined | null {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 100) return null;

  const items: ChecklistItem[] = [];
  for (const item of value) {
    const description =
      typeof item === "string"
        ? requiredText(item, 1, 1000)
        : isRecord(item)
          ? requiredText(item.description, 1, 1000)
          : null;
    if (description === null) return null;
    items.push({ description });
  }
  return items;
}

function parseTemplateFields(
  value: Record<string, unknown>,
): TemplateFields | null {
  const name = requiredText(value.name, 1, 160);
  const subjectTemplate = requiredText(value.subjectTemplate, 1, 240);
  const descriptionTemplate = requiredText(value.descriptionTemplate, 1, 50000);
  const priority = optionalText(value.priorityKey, 63);
  const department = optionalUuid(value.departmentId);
  const checklistItems = parseChecklistItems(value.checklistItems);

  if (
    name === null ||
    subjectTemplate === null ||
    descriptionTemplate === null ||
    !hasOnlySafeTemplatePlaceholders(subjectTemplate) ||
    !hasOnlySafeTemplatePlaceholders(descriptionTemplate) ||
    !priority.valid ||
    !department.valid ||
    checklistItems === null
  )
    return null;

  return {
    name,
    subjectTemplate,
    descriptionTemplate,
    ...(priority.value !== undefined ? { priorityKey: priority.value } : {}),
    ...(department.value !== undefined
      ? { departmentId: department.value }
      : {}),
    ...(checklistItems !== undefined ? { checklistItems } : {}),
  };
}

function parseAction(value: unknown): Action | null {
  if (!isRecord(value) || !isUuid(value.tenantId)) return null;
  if (value.type === "listTemplates")
    return { type: value.type, tenantId: value.tenantId };

  if (value.type === "deleteTemplate" && isUuid(value.templateId))
    return {
      type: value.type,
      tenantId: value.tenantId,
      templateId: value.templateId,
    };

  if (value.type === "createTemplate") {
    const fields = parseTemplateFields(value);
    return fields
      ? { type: value.type, tenantId: value.tenantId, ...fields }
      : null;
  }

  if (value.type === "updateTemplate" && isUuid(value.templateId)) {
    const fields = parseTemplateFields(value);
    if (
      !fields ||
      (value.active !== undefined && typeof value.active !== "boolean")
    )
      return null;
    return {
      type: value.type,
      tenantId: value.tenantId,
      templateId: value.templateId,
      ...fields,
      ...(value.active !== undefined ? { active: value.active } : {}),
    };
  }

  return null;
}

async function isActiveTenantMember(
  admin: any,
  userId: string,
  tenantId: string,
): Promise<boolean> {
  const { data } = await admin
    .from("tenant_memberships")
    .select("tenant_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  return Boolean(data);
}

async function getManagementScopes(
  admin: any,
  userId: string,
  tenantId: string,
): Promise<ManagementScopes | null> {
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("user_role_assignments")
    .select(
      "department_id, roles!user_role_assignments_role_tenant_fk!inner(active, scope, role_permissions!inner(permission_code))",
    )
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .lte("starts_at", now)
    .or(`expires_at.is.null,expires_at.gt.${now}`);
  if (error) return null;

  const scopes: ManagementScopes = {
    tenantWide: false,
    departmentIds: new Set<string>(),
  };
  for (const assignment of data ?? []) {
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
        (permission) => permission.permission_code === "ticket.template.manage",
      )
    )
      continue;

    if (role.scope === "tenant") scopes.tenantWide = true;
    if (role.scope === "department" && isUuid(assignment.department_id))
      scopes.departmentIds.add(assignment.department_id);
  }
  return scopes;
}

function canManageTemplate(
  scopes: ManagementScopes,
  departmentId: string | null,
): boolean {
  return (
    scopes.tenantWide ||
    (departmentId !== null && scopes.departmentIds.has(departmentId))
  );
}

async function referencesAreValid(
  admin: any,
  tenantId: string,
  priorityKey: string | null | undefined,
  departmentId: string | null | undefined,
): Promise<boolean> {
  const checks: PromiseLike<{ data: unknown; error: unknown }>[] = [];
  if (priorityKey !== undefined && priorityKey !== null)
    checks.push(
      admin
        .from("ticket_priorities")
        .select("key")
        .eq("tenant_id", tenantId)
        .eq("key", priorityKey)
        .maybeSingle(),
    );
  if (departmentId !== undefined && departmentId !== null)
    checks.push(
      admin
        .from("departments")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("id", departmentId)
        .maybeSingle(),
    );
  if (checks.length === 0) return true;

  const results = await Promise.all(checks);
  return results.every((result) => !result.error && Boolean(result.data));
}

async function getTemplate(admin: any, tenantId: string, templateId: string) {
  const { data, error } = await admin
    .from("ticket_templates")
    .select(TEMPLATE_SELECT)
    .eq("tenant_id", tenantId)
    .eq("id", templateId)
    .maybeSingle();
  return { data, error };
}

function normalizeTemplate(template: any) {
  const { ticket_template_checklist_items: checklistItems, ...fields } =
    template;
  return {
    ...fields,
    checklistItems: Array.isArray(checklistItems)
      ? [...checklistItems].sort(
          (left, right) =>
            Number(left.position) - Number(right.position) ||
            String(left.id).localeCompare(String(right.id)),
        )
      : [],
  };
}

function auditData(template: any) {
  const normalized = normalizeTemplate(template);
  return {
    name: normalized.name,
    subjectTemplate: normalized.subject_template,
    priorityKey: normalized.priority_key,
    departmentId: normalized.department_id,
    active: normalized.active,
    checklistItemCount: normalized.checklistItems.length,
  };
}

async function writeAudit(
  admin: any,
  tenantId: string,
  actorId: string,
  action: string,
  templateId: string,
  beforeData: Record<string, unknown> | null,
  afterData: Record<string, unknown> | null,
) {
  return await admin.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_id: actorId,
    action,
    entity_type: "ticket_template",
    entity_id: templateId,
    severity: "info",
    before_data: beforeData,
    after_data: afterData,
    metadata: { templateId },
  });
}

const handler = withSupabase({ auth: "user" }, async (request, context) => {
  if (request.method !== "POST")
    return json(request, { error: { code: "method_not_allowed" } }, 405);

  const action = parseAction(await request.json().catch(() => null));
  const actorId = context.userClaims?.id;
  if (!action || typeof actorId !== "string")
    return json(request, { error: { code: "invalid_request" } }, 400);

  const admin = context.supabaseAdmin;
  if (!(await isActiveTenantMember(admin, actorId, action.tenantId)))
    return json(
      request,
      { error: { code: "tenant_membership_required" } },
      403,
    );

  const scopes = await getManagementScopes(admin, actorId, action.tenantId);
  if (!scopes)
    return json(
      request,
      { error: { code: "authorization_check_failed" } },
      500,
    );
  if (!scopes.tenantWide && scopes.departmentIds.size === 0)
    return json(
      request,
      { error: { code: "ticket_template_manage_denied" } },
      403,
    );

  if (action.type === "listTemplates") {
    let query = admin
      .from("ticket_templates")
      .select(TEMPLATE_SELECT)
      .eq("tenant_id", action.tenantId)
      .order("name")
      .limit(500);
    if (!scopes.tenantWide)
      query = query.in("department_id", [...scopes.departmentIds]);
    const { data, error } = await query;
    if (error)
      return json(
        request,
        { error: { code: "ticket_template_list_failed" } },
        500,
      );
    return json(request, {
      data: { templates: (data ?? []).map(normalizeTemplate) },
    });
  }

  if (action.type === "createTemplate") {
    const departmentId = action.departmentId ?? null;
    if (!canManageTemplate(scopes, departmentId))
      return json(
        request,
        { error: { code: "ticket_template_manage_denied" } },
        403,
      );
    if (
      !(await referencesAreValid(
        admin,
        action.tenantId,
        action.priorityKey,
        action.departmentId,
      ))
    )
      return json(
        request,
        { error: { code: "ticket_template_reference_invalid" } },
        422,
      );

    const { data: created, error: createError } = await admin
      .from("ticket_templates")
      .insert({
        tenant_id: action.tenantId,
        department_id: departmentId,
        name: action.name,
        subject_template: action.subjectTemplate,
        description_template: action.descriptionTemplate,
        priority_key: action.priorityKey ?? null,
        created_by: actorId,
      })
      .select("id")
      .single();
    if (createError || !created)
      return json(
        request,
        { error: { code: "ticket_template_create_failed" } },
        422,
      );

    if (action.checklistItems && action.checklistItems.length > 0) {
      const { error: checklistError } = await admin
        .from("ticket_template_checklist_items")
        .insert(
          action.checklistItems.map((item, position) => ({
            template_id: created.id,
            tenant_id: action.tenantId,
            description: item.description,
            position,
          })),
        );
      if (checklistError) {
        await admin.from("ticket_templates").delete().eq("id", created.id);
        return json(
          request,
          { error: { code: "ticket_template_checklist_create_failed" } },
          500,
        );
      }
    }

    const { data: template, error: templateError } = await getTemplate(
      admin,
      action.tenantId,
      created.id,
    );
    if (templateError || !template)
      return json(
        request,
        { error: { code: "ticket_template_read_failed" } },
        500,
      );
    const { error: auditError } = await writeAudit(
      admin,
      action.tenantId,
      actorId,
      "ticket.template.created",
      created.id,
      null,
      auditData(template),
    );
    if (auditError)
      return json(
        request,
        { error: { code: "ticket_template_audit_failed" } },
        500,
      );
    return json(
      request,
      { data: { template: normalizeTemplate(template) } },
      201,
    );
  }

  const { data: existing, error: existingError } = await getTemplate(
    admin,
    action.tenantId,
    action.templateId,
  );
  if (existingError)
    return json(
      request,
      { error: { code: "ticket_template_read_failed" } },
      500,
    );
  if (!existing)
    return json(request, { error: { code: "ticket_template_not_found" } }, 404);
  if (!canManageTemplate(scopes, existing.department_id))
    return json(
      request,
      { error: { code: "ticket_template_manage_denied" } },
      403,
    );

  if (action.type === "deleteTemplate") {
    const { data: archived, error: archiveError } = await admin
      .from("ticket_templates")
      .update({ active: false, updated_at: new Date().toISOString() })
      .eq("tenant_id", action.tenantId)
      .eq("id", action.templateId)
      .select("id")
      .maybeSingle();
    if (archiveError)
      return json(
        request,
        { error: { code: "ticket_template_archive_failed" } },
        500,
      );
    if (!archived)
      return json(
        request,
        { error: { code: "ticket_template_not_found" } },
        404,
      );
    const { error: auditError } = await writeAudit(
      admin,
      action.tenantId,
      actorId,
      "ticket.template.archived",
      action.templateId,
      auditData(existing),
      { ...auditData(existing), active: false },
    );
    if (auditError)
      return json(
        request,
        { error: { code: "ticket_template_audit_failed" } },
        500,
      );
    return json(request, { data: { archived: true } });
  }

  const nextDepartmentId =
    action.departmentId === undefined
      ? existing.department_id
      : action.departmentId;
  if (!canManageTemplate(scopes, nextDepartmentId))
    return json(
      request,
      { error: { code: "ticket_template_manage_denied" } },
      403,
    );
  if (
    !(await referencesAreValid(
      admin,
      action.tenantId,
      action.priorityKey,
      action.departmentId,
    ))
  )
    return json(
      request,
      { error: { code: "ticket_template_reference_invalid" } },
      422,
    );

  const updates: Record<string, unknown> = {
    name: action.name,
    subject_template: action.subjectTemplate,
    description_template: action.descriptionTemplate,
    updated_at: new Date().toISOString(),
  };
  if (action.priorityKey !== undefined)
    updates.priority_key = action.priorityKey;
  if (action.departmentId !== undefined)
    updates.department_id = action.departmentId;
  if (action.active !== undefined) updates.active = action.active;

  const { error: updateError } = await admin
    .from("ticket_templates")
    .update(updates)
    .eq("tenant_id", action.tenantId)
    .eq("id", action.templateId);
  if (updateError)
    return json(
      request,
      { error: { code: "ticket_template_update_failed" } },
      500,
    );

  if (action.checklistItems !== undefined) {
    const { error: deleteChecklistError } = await admin
      .from("ticket_template_checklist_items")
      .delete()
      .eq("template_id", action.templateId);
    if (deleteChecklistError)
      return json(
        request,
        { error: { code: "ticket_template_checklist_replace_failed" } },
        500,
      );
    if (action.checklistItems.length > 0) {
      const { error: insertChecklistError } = await admin
        .from("ticket_template_checklist_items")
        .insert(
          action.checklistItems.map((item, position) => ({
            template_id: action.templateId,
            tenant_id: action.tenantId,
            description: item.description,
            position,
          })),
        );
      if (insertChecklistError)
        return json(
          request,
          { error: { code: "ticket_template_checklist_replace_failed" } },
          500,
        );
    }
  }

  const { data: template, error: templateError } = await getTemplate(
    admin,
    action.tenantId,
    action.templateId,
  );
  if (templateError || !template)
    return json(
      request,
      { error: { code: "ticket_template_read_failed" } },
      500,
    );
  const { error: auditError } = await writeAudit(
    admin,
    action.tenantId,
    actorId,
    "ticket.template.updated",
    action.templateId,
    auditData(existing),
    auditData(template),
  );
  if (auditError)
    return json(
      request,
      { error: { code: "ticket_template_audit_failed" } },
      500,
    );
  return json(request, { data: { template: normalizeTemplate(template) } });
});

export default {
  fetch(request: Request): Response | Promise<Response> {
    if (request.method === "OPTIONS") {
      if (request.headers.get("origin") !== ALLOWED_ORIGIN)
        return new Response(null, { status: 403, headers: { Vary: "Origin" } });
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }
    return handler(request);
  },
};
