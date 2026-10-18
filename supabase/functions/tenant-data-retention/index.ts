import { withSupabase } from "@supabase/server";

const ORIGIN = "https://app.nextdesk.ch";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Policy = {
  ticketRetentionDays: number;
  attachmentRetentionDays: number;
  auditRetentionDays: number;
  legalHold: boolean;
};
type Action =
  | { type: "get"; tenantId: string }
  | ({ type: "update"; tenantId: string } & Policy);
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function uuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}
function integer(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= minimum &&
    value <= maximum
  );
}
function parse(value: unknown): Action | null {
  if (!record(value) || !uuid(value.tenantId)) return null;
  if (
    value.type === "get" &&
    Object.keys(value).every((key) => key === "type" || key === "tenantId")
  )
    return { type: "get", tenantId: value.tenantId };
  if (
    value.type === "update" &&
    Object.keys(value).every((key) =>
      [
        "type",
        "tenantId",
        "ticketRetentionDays",
        "attachmentRetentionDays",
        "auditRetentionDays",
        "legalHold",
      ].includes(key),
    ) &&
    integer(value.ticketRetentionDays, 30, 3650) &&
    integer(value.attachmentRetentionDays, 30, 3650) &&
    integer(value.auditRetentionDays, 365, 3650) &&
    typeof value.legalHold === "boolean"
  )
    return {
      type: "update",
      tenantId: value.tenantId,
      ticketRetentionDays: value.ticketRetentionDays,
      attachmentRetentionDays: value.attachmentRetentionDays,
      auditRetentionDays: value.auditRetentionDays,
      legalHold: value.legalHold,
    };
  return null;
}
function cors(request: Request): HeadersInit {
  const origin = request.headers.get("origin");
  const headers: Record<string, string> = {
    Vary: "Origin",
    "Access-Control-Allow-Headers":
      "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json; charset=utf-8",
  };
  if (origin === ORIGIN) headers["Access-Control-Allow-Origin"] = ORIGIN;
  return headers;
}
function response(
  request: Request,
  value: Record<string, unknown>,
  status = 200,
) {
  return new Response(JSON.stringify(value), {
    status,
    headers: cors(request),
  });
}
async function isTenantAdmin(admin: any, userId: string, tenantId: string) {
  const [
    { data: membership, error: membershipError },
    { data: role, error: roleError },
  ] = await Promise.all([
    admin
      .from("tenant_memberships")
      .select("tenant_id")
      .eq("tenant_id", tenantId)
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle(),
    admin
      .from("roles")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("name", "Tenant administrator")
      .eq("scope", "tenant")
      .eq("active", true)
      .maybeSingle(),
  ]);
  if (membershipError || roleError || !membership || !role?.id)
    return membershipError || roleError ? null : false;
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("user_role_assignments")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .eq("role_id", role.id)
    .lte("starts_at", now)
    .or(`expires_at.is.null,expires_at.gt.${now}`)
    .maybeSingle();
  return error ? null : Boolean(data);
}
function toPolicy(row: Record<string, unknown>): Policy | null {
  return integer(row.ticket_retention_days, 30, 3650) &&
    integer(row.attachment_retention_days, 30, 3650) &&
    integer(row.audit_retention_days, 365, 3650) &&
    typeof row.legal_hold === "boolean"
    ? {
        ticketRetentionDays: row.ticket_retention_days,
        attachmentRetentionDays: row.attachment_retention_days,
        auditRetentionDays: row.audit_retention_days,
        legalHold: row.legal_hold,
      }
    : null;
}
const handler = withSupabase({ auth: "user" }, async (request, context) => {
  if (request.method !== "POST")
    return response(request, { error: { code: "method_not_allowed" } }, 405);
  const action = parse(await request.json().catch(() => null));
  const actorId = context.userClaims?.id;
  if (!action || !uuid(actorId))
    return response(request, { error: { code: "invalid_request" } }, 400);
  const permitted = await isTenantAdmin(
    context.supabaseAdmin,
    actorId,
    action.tenantId,
  );
  if (permitted === null)
    return response(
      request,
      { error: { code: "authorization_check_failed" } },
      500,
    );
  if (!permitted)
    return response(request, { error: { code: "tenant_admin_required" } }, 403);
  if (action.type === "get") {
    const { data, error } = await context.supabaseAdmin
      .from("tenant_data_retention_policies")
      .select(
        "ticket_retention_days, attachment_retention_days, audit_retention_days, legal_hold, deletion_mode, updated_at",
      )
      .eq("tenant_id", action.tenantId)
      .maybeSingle();
    const stored = data && record(data) ? data : null;
    const policy = stored ? toPolicy(stored) : null;
    return error || !policy || !stored
      ? response(request, { error: { code: "retention_read_failed" } }, 500)
      : response(request, {
          data: {
            policy,
            updatedAt: stored.updated_at,
            deletionMode: stored.deletion_mode,
          },
        });
  }
  const { error } = await context.supabaseAdmin
    .from("tenant_data_retention_policies")
    .upsert(
      {
        tenant_id: action.tenantId,
        ticket_retention_days: action.ticketRetentionDays,
        attachment_retention_days: action.attachmentRetentionDays,
        audit_retention_days: action.auditRetentionDays,
        legal_hold: action.legalHold,
        updated_by: actorId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "tenant_id" },
    );
  if (error)
    return response(
      request,
      { error: { code: "retention_update_failed" } },
      422,
    );
  const { error: auditError } = await context.supabaseAdmin
    .from("audit_logs")
    .insert({
      tenant_id: action.tenantId,
      actor_id: actorId,
      action: "tenant.data_retention.updated",
      entity_type: "tenant_data_retention_policy",
      entity_id: action.tenantId,
      severity: "security",
      metadata: {
        ticketRetentionDays: action.ticketRetentionDays,
        attachmentRetentionDays: action.attachmentRetentionDays,
        auditRetentionDays: action.auditRetentionDays,
        legalHold: action.legalHold,
        deletionMode: "manual_review",
      },
    });
  if (auditError)
    return response(
      request,
      { error: { code: "audit_log_write_failed" } },
      500,
    );
  return response(request, { data: { updated: true } });
});
export default {
  fetch(request: Request): Response | Promise<Response> {
    return request.method === "OPTIONS"
      ? new Response(null, { status: 204, headers: cors(request) })
      : handler(request);
  },
};
