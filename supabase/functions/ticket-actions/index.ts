import { withSupabase } from "@supabase/server";

type Action =
  | { type: "getFormOptions"; tenantId: string }
  | {
      type: "createTicket";
      tenantId: string;
      departmentId: string;
      subject: string;
      description: string;
      priorityKey: string;
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
  if (value.type === "getFormOptions")
    return { type: value.type, tenantId: value.tenantId };
  if (
    value.type === "createTicket" &&
    isUuid(value.departmentId) &&
    typeof value.subject === "string" &&
    typeof value.description === "string" &&
    typeof value.priorityKey === "string"
  )
    return {
      type: value.type,
      tenantId: value.tenantId,
      departmentId: value.departmentId,
      subject: value.subject.trim(),
      description: value.description.trim(),
      priorityKey: value.priorityKey.trim(),
    };
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
const handler = withSupabase({ auth: "user" }, async (request, context) => {
  if (request.method !== "POST")
    return json(request, { error: { code: "method_not_allowed" } }, 405);
  const action = parseAction(await request.json().catch(() => null));
  const actorId = context.userClaims?.id;
  if (!action || typeof actorId !== "string")
    return json(request, { error: { code: "invalid_request" } }, 400);
  if (!(await activeMember(context.supabaseAdmin, actorId, action.tenantId)))
    return json(
      request,
      { error: { code: "tenant_membership_required" } },
      403,
    );
  if (action.type === "getFormOptions") {
    const [
      { data: departments, error: departmentsError },
      { data: priorities, error: prioritiesError },
    ] = await Promise.all([
      context.supabaseAdmin
        .from("departments")
        .select("id, key, name, kind")
        .eq("tenant_id", action.tenantId)
        .eq("active", true)
        .order("name"),
      context.supabaseAdmin
        .from("ticket_priorities")
        .select("key, label, sort_order")
        .eq("tenant_id", action.tenantId)
        .order("sort_order"),
    ]);
    if (departmentsError || prioritiesError)
      return json(
        request,
        { error: { code: "ticket_form_options_failed" } },
        500,
      );
    return json(request, {
      data: { departments: departments ?? [], priorities: priorities ?? [] },
    });
  }
  if (
    action.subject.length < 3 ||
    action.subject.length > 240 ||
    action.description.length < 1 ||
    action.description.length > 50000
  )
    return json(request, { error: { code: "invalid_ticket_content" } }, 422);
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
  if (!department || !status || !priority)
    return json(request, { error: { code: "ticket_reference_missing" } }, 422);
  await context.supabaseAdmin.from("user_profiles").upsert({ id: actorId });
  const { data: ticketNumber, error: numberError } =
    await context.supabaseAdmin.rpc("reserve_ticket_number", {
      p_tenant_id: action.tenantId,
      p_department_id: action.departmentId,
      p_prefix: department.key.slice(0, 8),
    });
  if (numberError || typeof ticketNumber !== "string")
    return json(request, { error: { code: "ticket_number_failed" } }, 500);
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
      requester_id: actorId,
    })
    .select("id, ticket_number")
    .single();
  if (ticketError || !ticket)
    return json(request, { error: { code: "ticket_create_failed" } }, 422);
  await context.supabaseAdmin.from("ticket_events").insert({
    ticket_id: ticket.id,
    actor_id: actorId,
    event_type: "ticket.created",
    payload: { source: "web_portal" },
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
