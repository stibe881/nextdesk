import { withSupabase } from "@supabase/server";
import { resolveTenantFeatureStates } from "../_shared/tenant-features.ts";

const ORIGIN = "https://app.nextdesk.ch";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuid = (value: unknown): value is string =>
  typeof value === "string" && UUID.test(value);

function headers(request: Request) {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    Vary: "Origin",
  });
  if (request.headers.get("origin") === ORIGIN) {
    headers.set("Access-Control-Allow-Origin", ORIGIN);
    headers.set(
      "Access-Control-Allow-Headers",
      "authorization, apikey, content-type, x-client-info",
    );
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  }
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
function fail(request: Request, code: string, status: number) {
  return response(request, { error: { code } }, status);
}
function action(value: unknown) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const input = value as Record<string, unknown>;
  return uuid(input.tenantId) &&
    uuid(input.ticketId) &&
    uuid(input.departmentId)
    ? {
        tenantId: input.tenantId,
        ticketId: input.ticketId,
        departmentId: input.departmentId,
      }
    : null;
}

const handler = withSupabase({ auth: "user" }, async (request, context) => {
  if (request.method !== "POST") {
    return fail(request, "method_not_allowed", 405);
  }
  const input = action(await request.json().catch(() => null));
  const actorId = context.userClaims?.id;
  if (!input || !uuid(actorId)) return fail(request, "invalid_request", 422);

  const { data: membership, error: membershipError } =
    await context.supabaseAdmin
      .from("tenant_memberships")
      .select("tenant_id")
      .eq("tenant_id", input.tenantId)
      .eq("user_id", actorId)
      .eq("status", "active")
      .maybeSingle();
  if (membershipError) return fail(request, "authorization_check_failed", 500);
  if (!membership) return fail(request, "tenant_membership_required", 403);

  const featureStates = await resolveTenantFeatureStates(
    context.supabaseAdmin,
    input.tenantId,
    ["ticketing.detail"],
  );
  if (!featureStates) return fail(request, "tenant_feature_lookup_failed", 503);
  if (featureStates["ticketing.detail"] !== true)
    return fail(request, "ticket_feature_disabled", 403);

  const [
    { data: ticket, error: ticketError },
    { data: targetDepartment, error: departmentError },
  ] = await Promise.all([
    context.supabaseAdmin
      .from("tickets")
      .select("id,tenant_id,department_id,assigned_agent_id")
      .eq("id", input.ticketId)
      .eq("tenant_id", input.tenantId)
      .maybeSingle(),
    context.supabaseAdmin
      .from("departments")
      .select("id,name")
      .eq("id", input.departmentId)
      .eq("tenant_id", input.tenantId)
      .eq("active", true)
      .maybeSingle(),
  ]);
  if (ticketError || departmentError) {
    return fail(request, "ticket_department_change_failed", 500);
  }
  if (!ticket) return fail(request, "ticket_not_found", 404);
  if (!targetDepartment) return fail(request, "ticket_department_invalid", 422);
  if (ticket.department_id === targetDepartment.id) {
    return response(request, { data: { changed: false } });
  }

  const canUpdate = async (departmentId: string) => {
    const { data, error } = await context.supabase.rpc(
      "has_ticket_permission",
      {
        p_tenant_id: input.tenantId,
        p_department_id: departmentId,
        p_permission_code: "ticket.update",
      },
    );
    return error ? null : data === true;
  };
  const [canUpdateCurrent, canUpdateTarget] = await Promise.all([
    canUpdate(ticket.department_id),
    canUpdate(targetDepartment.id),
  ]);
  if (canUpdateCurrent === null || canUpdateTarget === null) {
    return fail(request, "authorization_check_failed", 500);
  }
  if (!canUpdateCurrent || !canUpdateTarget) {
    return fail(request, "ticket_department_change_denied", 403);
  }

  const { error: updateError } = await context.supabaseAdmin
    .from("tickets")
    .update({
      department_id: targetDepartment.id,
      category_id: null,
      subcategory_id: null,
      assigned_agent_id: null,
    })
    .eq("id", ticket.id)
    .eq("tenant_id", input.tenantId);
  if (updateError) return fail(request, "ticket_department_change_failed", 422);

  await Promise.all([
    context.supabaseAdmin.from("ticket_events").insert({
      ticket_id: ticket.id,
      actor_id: actorId,
      event_type: "ticket.department_changed",
      payload: {
        previous_department_id: ticket.department_id,
        department_id: targetDepartment.id,
        assigned_agent_cleared: ticket.assigned_agent_id !== null,
      },
    }),
    context.supabaseAdmin.from("audit_logs").insert({
      tenant_id: input.tenantId,
      actor_id: actorId,
      action: "ticket.department_changed",
      entity_type: "ticket",
      entity_id: ticket.id,
      metadata: {
        previous_department_id: ticket.department_id,
        department_id: targetDepartment.id,
      },
    }),
  ]);
  return response(request, {
    data: {
      changed: true,
      department: { id: targetDepartment.id, name: targetDepartment.name },
    },
  });
});

export default {
  fetch(request: Request): Response | Promise<Response> {
    const origin = request.headers.get("origin");
    if (origin !== null && origin !== ORIGIN) {
      return fail(request, "origin_not_allowed", 403);
    }
    if (request.method === "OPTIONS") {
      return origin === ORIGIN
        ? new Response(null, { status: 204, headers: headers(request) })
        : fail(request, "origin_not_allowed", 403);
    }
    return handler(request);
  },
};
