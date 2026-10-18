import { withSupabase } from "@supabase/server";

const APP_ORIGIN = "https://app.nextdesk.ch";
const MAX_ROWS = 100;
type ImportRow = {
  subject: string;
  description: string;
  priority: string;
  requesterName: string;
  requesterEmail: string;
};
type Action = {
  type: "preview" | "import";
  tenantId: string;
  departmentId: string;
  rows: ImportRow[];
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
function clean(value: unknown, maximum: number) {
  return typeof value === "string"
    ? value
        .trim()
        .replace(/[\u0000-\u001f\u007f]/g, " ")
        .slice(0, maximum)
    : "";
}
function email(value: string) {
  const normalized = value.trim().toLowerCase();
  return !normalized ||
    (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) && normalized.length <= 254)
    ? normalized
    : null;
}
function headers(request: Request): HeadersInit {
  const values: Record<string, string> = {
    "Access-Control-Allow-Headers":
      "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json; charset=utf-8",
    Vary: "Origin",
  };
  if (request.headers.get("origin") === APP_ORIGIN)
    values["Access-Control-Allow-Origin"] = APP_ORIGIN;
  return values;
}
function json(request: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: headers(request),
  });
}
function parseAction(value: unknown): Action | null {
  if (
    !isRecord(value) ||
    (value.type !== "preview" && value.type !== "import") ||
    !isUuid(value.tenantId) ||
    !isUuid(value.departmentId) ||
    !Array.isArray(value.rows) ||
    value.rows.length < 1 ||
    value.rows.length > MAX_ROWS ||
    !Object.keys(value).every((key) =>
      ["type", "tenantId", "departmentId", "rows"].includes(key),
    )
  )
    return null;
  const rows: ImportRow[] = [];
  for (const item of value.rows) {
    if (
      !isRecord(item) ||
      !Object.keys(item).every((key) =>
        [
          "subject",
          "description",
          "priority",
          "requesterName",
          "requesterEmail",
        ].includes(key),
      )
    )
      return null;
    rows.push({
      subject: clean(item.subject, 240),
      description: clean(item.description, 50_000),
      priority: clean(item.priority, 32).toLowerCase() || "normal",
      requesterName: clean(item.requesterName, 160),
      requesterEmail: clean(item.requesterEmail, 254),
    });
  }
  return {
    type: value.type,
    tenantId: value.tenantId,
    departmentId: value.departmentId,
    rows,
  };
}
function one(value: unknown): Record<string, unknown> | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  return isRecord(candidate) ? candidate : null;
}
async function hasImportPermission(
  admin: any,
  actorId: string,
  tenantId: string,
) {
  const now = new Date().toISOString();
  const [
    { data: membership, error: membershipError },
    { data: roles, error: roleError },
  ] = await Promise.all([
    admin
      .from("tenant_memberships")
      .select("tenant_id")
      .eq("tenant_id", tenantId)
      .eq("user_id", actorId)
      .eq("status", "active")
      .maybeSingle(),
    admin
      .from("user_role_assignments")
      .select(
        "roles!user_role_assignments_role_tenant_fk!inner(active, role_permissions!inner(permission_code))",
      )
      .eq("tenant_id", tenantId)
      .eq("user_id", actorId)
      .is("department_id", null)
      .lte("starts_at", now)
      .or(`expires_at.is.null,expires_at.gt.${now}`),
  ]);
  if (membershipError || roleError) return null;
  return (
    Boolean(membership) &&
    (roles ?? []).some((entry: any) => {
      const role = one(entry.roles);
      const permissions =
        role && Array.isArray(role.role_permissions)
          ? role.role_permissions
          : [];
      return (
        role?.active === true &&
        permissions.some(
          (permission) =>
            isRecord(permission) &&
            permission.permission_code === "ticket.export",
        )
      );
    })
  );
}
function validateRows(rows: ImportRow[]) {
  return rows.flatMap((row, index) => {
    const errors: string[] = [];
    if (row.subject.length < 3)
      errors.push("Betreff benötigt mindestens 3 Zeichen");
    if (row.description.length < 1) errors.push("Beschreibung fehlt");
    if (row.requesterName.length < 2)
      errors.push("Name der anfragenden Person fehlt");
    if (email(row.requesterEmail) === null)
      errors.push("E-Mail-Adresse ist ungültig");
    if (
      ![
        "low",
        "normal",
        "high",
        "urgent",
        "niedrig",
        "normal",
        "hoch",
        "dringend",
      ].includes(row.priority)
    )
      errors.push("Priorität muss niedrig, normal, hoch oder dringend sein");
    return errors.length ? [{ row: index + 1, errors }] : [];
  });
}
function priorityKey(value: string) {
  return (
    (
      {
        low: "low",
        normal: "normal",
        high: "high",
        urgent: "urgent",
        niedrig: "low",
        hoch: "high",
        dringend: "urgent",
      } as Record<string, string>
    )[value] ?? "normal"
  );
}

const handler = withSupabase({ auth: "user" }, async (request, context) => {
  if (request.method !== "POST")
    return json(request, { error: { code: "method_not_allowed" } }, 405);
  const action = parseAction(await request.json().catch(() => null));
  const actorId = context.userClaims?.id;
  if (!action || !isUuid(actorId))
    return json(request, { error: { code: "invalid_request" } }, 400);
  const allowed = await hasImportPermission(
    context.supabaseAdmin,
    actorId,
    action.tenantId,
  );
  if (allowed === null)
    return json(
      request,
      { error: { code: "authorization_check_failed" } },
      500,
    );
  if (!allowed)
    return json(request, { error: { code: "ticket_import_denied" } }, 403);
  const { data: department, error: departmentError } =
    await context.supabaseAdmin
      .from("departments")
      .select("id, key, name")
      .eq("id", action.departmentId)
      .eq("tenant_id", action.tenantId)
      .eq("active", true)
      .maybeSingle();
  if (departmentError)
    return json(request, { error: { code: "department_lookup_failed" } }, 500);
  if (!department)
    return json(request, { error: { code: "department_not_available" } }, 422);
  const issues = validateRows(action.rows);
  if (action.type === "preview")
    return json(request, {
      data: {
        accepted: action.rows.length - issues.length,
        rejected: issues.length,
        issues,
      },
    });
  if (issues.length)
    return json(
      request,
      { error: { code: "ticket_import_validation_failed", issues } },
      422,
    );

  const [
    { data: status, error: statusError },
    { data: priorities, error: prioritiesError },
  ] = await Promise.all([
    context.supabaseAdmin
      .from("ticket_statuses")
      .select("id")
      .eq("tenant_id", action.tenantId)
      .eq("key", "new")
      .maybeSingle(),
    context.supabaseAdmin
      .from("ticket_priorities")
      .select("id, key")
      .eq("tenant_id", action.tenantId),
  ]);
  if (statusError || prioritiesError || !status)
    return json(
      request,
      { error: { code: "ticket_reference_lookup_failed" } },
      500,
    );
  const prioritiesByKey = new Map(
    (priorities ?? []).filter(isRecord).map((row) => [row.key, row.id]),
  );
  const created: string[] = [];
  for (const row of action.rows) {
    const requesterEmail = email(row.requesterEmail);
    let requesterQuery = context.supabaseAdmin
      .from("ticket_requesters")
      .select("id")
      .eq("tenant_id", action.tenantId)
      .limit(1);
    requesterQuery = requesterEmail
      ? requesterQuery.eq("email", requesterEmail)
      : requesterQuery.eq("display_name", row.requesterName);
    let { data: requester, error: requesterError } =
      await requesterQuery.maybeSingle();
    if (requesterError)
      return json(
        request,
        { error: { code: "requester_lookup_failed", created } },
        500,
      );
    if (!requester) {
      const result = await context.supabaseAdmin
        .from("ticket_requesters")
        .insert({
          tenant_id: action.tenantId,
          display_name: row.requesterName,
          email: requesterEmail || null,
          source: "manual",
        })
        .select("id")
        .single();
      requester = result.data;
      requesterError = result.error;
    }
    if (requesterError || !requester)
      return json(
        request,
        { error: { code: "requester_create_failed", created } },
        422,
      );
    const { data: ticketNumber, error: numberError } =
      await context.supabaseAdmin.rpc("reserve_ticket_number", {
        p_tenant_id: action.tenantId,
        p_department_id: action.departmentId,
        p_prefix: String(department.key).slice(0, 8),
      });
    const priorityId = prioritiesByKey.get(priorityKey(row.priority));
    if (
      numberError ||
      typeof ticketNumber !== "string" ||
      typeof priorityId !== "string"
    )
      return json(
        request,
        { error: { code: "ticket_reference_create_failed", created } },
        500,
      );
    const { data: ticket, error: ticketError } = await context.supabaseAdmin
      .from("tickets")
      .insert({
        tenant_id: action.tenantId,
        department_id: action.departmentId,
        ticket_number: ticketNumber,
        subject: row.subject,
        description: row.description,
        status_id: status.id,
        priority_id: priorityId,
        requester_id: actorId,
        requester_contact_id: requester.id,
      })
      .select("id, ticket_number")
      .single();
    if (ticketError || !ticket)
      return json(
        request,
        { error: { code: "ticket_import_create_failed", created } },
        422,
      );
    created.push(ticket.ticket_number);
    const { error: eventError } = await context.supabaseAdmin
      .from("ticket_events")
      .insert({
        ticket_id: ticket.id,
        actor_id: actorId,
        event_type: "ticket.created",
        payload: { source: "portal_import" },
      });
    if (eventError)
      return json(
        request,
        { error: { code: "ticket_import_event_failed", created } },
        500,
      );
  }
  const { error: auditError } = await context.supabaseAdmin
    .from("audit_logs")
    .insert({
      tenant_id: action.tenantId,
      actor_id: actorId,
      action: "ticket.csv_imported",
      entity_type: "ticket_import",
      entity_id: null,
      severity: "info",
      metadata: { rows: created.length, departmentId: action.departmentId },
    });
  if (auditError)
    return json(
      request,
      { error: { code: "ticket_import_audit_failed", created } },
      500,
    );
  return json(request, { data: { created } });
});
export default {
  fetch(request: Request): Response | Promise<Response> {
    return request.method === "OPTIONS"
      ? new Response(null, { status: 204, headers: headers(request) })
      : handler(request);
  },
};
