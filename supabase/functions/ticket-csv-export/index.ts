import { withSupabase } from "@supabase/server";

const APP_ORIGIN = "https://app.nextdesk.ch";
const PAGE_SIZE = 500;
const MAX_EXPORT_ROWS = 10_000;

type Action = { type: "exportCsv"; tenantId: string };

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
function headers(request: Request): HeadersInit {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers":
      "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json; charset=utf-8",
    Vary: "Origin",
  };
  if (request.headers.get("origin") === APP_ORIGIN)
    headers["Access-Control-Allow-Origin"] = APP_ORIGIN;
  return headers;
}
function response(
  request: Request,
  body: Record<string, unknown>,
  status = 200,
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: headers(request),
  });
}
function parseAction(value: unknown): Action | null {
  if (!isRecord(value) || value.type !== "exportCsv" || !isUuid(value.tenantId))
    return null;
  if (!Object.keys(value).every((key) => key === "type" || key === "tenantId"))
    return null;
  return { type: "exportCsv", tenantId: value.tenantId };
}
function related<T extends Record<string, unknown>>(value: unknown): T | null {
  const result = Array.isArray(value) ? value[0] : value;
  return isRecord(result) ? (result as T) : null;
}
function safeText(value: unknown): string {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim()
    : "";
}

async function canExport(client: any, actorId: string, tenantId: string) {
  const now = new Date().toISOString();
  const { data, error } = await client
    .from("user_role_assignments")
    .select(
      "roles!user_role_assignments_role_tenant_fk!inner(active, role_permissions!inner(permission_code))",
    )
    .eq("tenant_id", tenantId)
    .eq("user_id", actorId)
    .is("department_id", null)
    .lte("starts_at", now)
    .or(`expires_at.is.null,expires_at.gt.${now}`);
  if (error) return null;
  return (data ?? []).some((assignment: any) => {
    const role = related<{ active?: unknown; role_permissions?: unknown }>(
      assignment.roles,
    );
    const permissions =
      role && Array.isArray(role.role_permissions) ? role.role_permissions : [];
    return (
      role?.active === true &&
      permissions.some(
        (permission) =>
          isRecord(permission) &&
          permission.permission_code === "ticket.export",
      )
    );
  });
}

const handler = withSupabase({ auth: "user" }, async (request, context) => {
  if (request.method !== "POST")
    return response(request, { error: { code: "method_not_allowed" } }, 405);
  const action = parseAction(await request.json().catch(() => null));
  const actorId = context.userClaims?.id;
  if (!action || !isUuid(actorId))
    return response(request, { error: { code: "invalid_request" } }, 400);
  const [membershipResult, permission] = await Promise.all([
    context.supabaseAdmin
      .from("tenant_memberships")
      .select("tenant_id")
      .eq("tenant_id", action.tenantId)
      .eq("user_id", actorId)
      .eq("status", "active")
      .maybeSingle(),
    canExport(context.supabaseAdmin, actorId, action.tenantId),
  ]);
  if (membershipResult.error || permission === null)
    return response(
      request,
      { error: { code: "authorization_check_failed" } },
      500,
    );
  if (!membershipResult.data || !permission)
    return response(request, { error: { code: "ticket_export_denied" } }, 403);

  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await context.supabaseAdmin
      .from("tickets")
      .select(
        "id, ticket_number, subject, created_at, updated_at, status:ticket_statuses(label), priority:ticket_priorities(label), department:departments(name)",
      )
      .eq("tenant_id", action.tenantId)
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (error)
      return response(
        request,
        { error: { code: "ticket_export_query_failed" } },
        500,
      );
    rows.push(...(data ?? []));
    if (rows.length > MAX_EXPORT_ROWS)
      return response(
        request,
        { error: { code: "ticket_export_row_limit" } },
        413,
      );
    if (!data || data.length < PAGE_SIZE) break;
  }

  const exportedAt = new Date().toISOString();
  const { error: auditError } = await context.supabaseAdmin
    .from("audit_logs")
    .insert({
      tenant_id: action.tenantId,
      actor_id: actorId,
      action: "ticket.csv_exported",
      entity_type: "ticket_export",
      entity_id: null,
      severity: "info",
      metadata: { rows: rows.length, exportedAt },
    });
  if (auditError)
    return response(
      request,
      { error: { code: "ticket_export_audit_failed" } },
      500,
    );

  return response(request, {
    data: {
      exportedAt,
      tickets: rows.map((row) => ({
        ticketNumber: safeText(row.ticket_number),
        subject: safeText(row.subject),
        status: safeText(related<{ label?: unknown }>(row.status)?.label),
        priority: safeText(related<{ label?: unknown }>(row.priority)?.label),
        department: safeText(related<{ name?: unknown }>(row.department)?.name),
        createdAt: safeText(row.created_at),
        updatedAt: safeText(row.updated_at),
      })),
    },
  });
});

export default {
  fetch(request: Request): Response | Promise<Response> {
    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers: headers(request) });
    return handler(request);
  },
};
