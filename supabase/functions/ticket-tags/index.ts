import { withSupabase } from "@supabase/server";

type Action =
  | { type: "addTag"; tenantId: string; ticketId: string; name: string }
  | { type: "assignTag"; tenantId: string; ticketId: string; tagId: string }
  | { type: "removeTag"; tenantId: string; ticketId: string; tagId: string };

type TicketTag = { id: string; name: string };

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

function normalizeTagName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.normalize("NFKC").trim();
  if (
    [...name].length < 1 ||
    [...name].length > 48 ||
    /[\u0000-\u001f\u007f]/.test(name)
  ) {
    return null;
  }
  return name;
}

function parseAction(value: unknown): Action | null {
  if (!isRecord(value) || !isUuid(value.tenantId) || !isUuid(value.ticketId)) {
    return null;
  }
  if (value.type === "addTag") {
    const name = normalizeTagName(value.name);
    return name
      ? {
          type: value.type,
          tenantId: value.tenantId,
          ticketId: value.ticketId,
          name,
        }
      : null;
  }
  if (
    (value.type === "assignTag" || value.type === "removeTag") &&
    isUuid(value.tagId)
  ) {
    return {
      type: value.type,
      tenantId: value.tenantId,
      ticketId: value.ticketId,
      tagId: value.tagId,
    };
  }
  return null;
}

function headers(request: Request) {
  return {
    "Access-Control-Allow-Origin":
      request.headers.get("origin") === "https://app.nextdesk.ch"
        ? "https://app.nextdesk.ch"
        : "",
    "Access-Control-Allow-Headers":
      "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json; charset=utf-8",
    Vary: "Origin",
  };
}

function json(request: Request, body: Record<string, unknown>, status = 200) {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: headers(request),
  });
}

async function canUpdateTicket(
  admin: any,
  userId: string,
  tenantId: string,
  departmentId: string,
): Promise<{ allowed: boolean; error: boolean }> {
  const now = new Date().toISOString();
  const [
    { data: membership, error: membershipError },
    { data: assignments, error: assignmentsError },
  ] = await Promise.all([
    admin
      .from("tenant_memberships")
      .select("tenant_id")
      .eq("tenant_id", tenantId)
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle(),
    admin
      .from("user_role_assignments")
      .select(
        "department_id, roles!user_role_assignments_role_tenant_fk!inner(active, role_permissions!inner(permission_code))",
      )
      .eq("tenant_id", tenantId)
      .eq("user_id", userId)
      .lte("starts_at", now)
      .or(`expires_at.is.null,expires_at.gt.${now}`),
  ]);
  if (membershipError || assignmentsError) {
    return { allowed: false, error: true };
  }
  if (!membership) return { allowed: false, error: false };
  const allowed = (assignments ?? []).some((assignment: any) => {
    if (
      assignment.department_id !== null &&
      assignment.department_id !== departmentId
    )
      return false;
    const role = Array.isArray(assignment.roles)
      ? assignment.roles[0]
      : assignment.roles;
    return Boolean(
      role?.active &&
      (role.role_permissions ?? []).some(
        (permission: any) => permission.permission_code === "ticket.update",
      ),
    );
  });
  return { allowed, error: false };
}

async function findTenantTag(
  admin: any,
  tenantId: string,
  tagId: string,
): Promise<TicketTag | null> {
  const { data, error } = await admin
    .from("ticket_tags")
    .select("id, name")
    .eq("tenant_id", tenantId)
    .eq("id", tagId)
    .maybeSingle();
  if (error || !data || !isUuid(data.id) || typeof data.name !== "string") {
    return null;
  }
  return { id: data.id, name: data.name };
}

async function findOrCreateTenantTag(
  admin: any,
  tenantId: string,
  actorId: string,
  name: string,
): Promise<{ tag: TicketTag | null; error: boolean }> {
  const { data: exact, error: exactError } = await admin
    .from("ticket_tags")
    .select("id, name")
    .eq("tenant_id", tenantId)
    .eq("name", name)
    .maybeSingle();
  if (exactError) return { tag: null, error: true };
  if (exact && isUuid(exact.id) && typeof exact.name === "string") {
    return { tag: { id: exact.id, name: exact.name }, error: false };
  }

  const { data: created, error: createError } = await admin
    .from("ticket_tags")
    .insert({ tenant_id: tenantId, name, created_by: actorId })
    .select("id, name")
    .single();
  if (
    !createError &&
    created &&
    isUuid(created.id) &&
    typeof created.name === "string"
  ) {
    return { tag: { id: created.id, name: created.name }, error: false };
  }
  if (createError?.code !== "23505") return { tag: null, error: true };

  const { data: candidates, error: candidatesError } = await admin
    .from("ticket_tags")
    .select("id, name")
    .eq("tenant_id", tenantId)
    .limit(500);
  if (candidatesError) return { tag: null, error: true };
  const normalized = name.toLocaleLowerCase("de-CH");
  const match = (candidates ?? []).find(
    (candidate: any) =>
      isUuid(candidate.id) &&
      typeof candidate.name === "string" &&
      candidate.name.toLocaleLowerCase("de-CH") === normalized,
  );
  return match
    ? { tag: { id: match.id, name: match.name }, error: false }
    : { tag: null, error: true };
}

async function auditTagEvent(
  admin: any,
  ticketId: string,
  actorId: string,
  eventType: "ticket.tag_added" | "ticket.tag_removed",
  tag: TicketTag,
): Promise<boolean> {
  const { error } = await admin.from("ticket_events").insert({
    ticket_id: ticketId,
    actor_id: actorId,
    event_type: eventType,
    payload: { tag_id: tag.id, tag_name: tag.name },
  });
  return !error;
}

const handler = withSupabase({ auth: "user" }, async (request, context) => {
  if (request.method !== "POST") {
    return json(request, { error: { code: "method_not_allowed" } }, 405);
  }
  const action = parseAction(await request.json().catch(() => null));
  const actorId = context.userClaims?.id;
  if (!action || typeof actorId !== "string") {
    return json(request, { error: { code: "invalid_request" } }, 400);
  }

  const { data: ticket, error: ticketError } = await context.supabaseAdmin
    .from("tickets")
    .select("id, tenant_id, department_id")
    .eq("id", action.ticketId)
    .eq("tenant_id", action.tenantId)
    .maybeSingle();
  if (ticketError) {
    return json(request, { error: { code: "ticket_lookup_failed" } }, 500);
  }
  if (!ticket) {
    return json(request, { error: { code: "ticket_not_found" } }, 404);
  }

  const permission = await canUpdateTicket(
    context.supabaseAdmin,
    actorId,
    ticket.tenant_id,
    ticket.department_id,
  );
  if (permission.error) {
    return json(
      request,
      { error: { code: "authorization_check_failed" } },
      500,
    );
  }
  if (!permission.allowed) {
    return json(request, { error: { code: "permission_denied" } }, 403);
  }

  const { error: profileError } = await context.supabaseAdmin
    .from("user_profiles")
    .upsert({ id: actorId });
  if (profileError) {
    return json(request, { error: { code: "profile_sync_failed" } }, 500);
  }

  if (action.type === "removeTag") {
    const tag = await findTenantTag(
      context.supabaseAdmin,
      action.tenantId,
      action.tagId,
    );
    if (!tag) {
      return json(request, { error: { code: "ticket_tag_not_found" } }, 404);
    }
    const { data: assignment, error: assignmentError } =
      await context.supabaseAdmin
        .from("ticket_tag_assignments")
        .select("tag_id")
        .eq("tenant_id", action.tenantId)
        .eq("ticket_id", action.ticketId)
        .eq("tag_id", action.tagId)
        .maybeSingle();
    if (assignmentError) {
      return json(
        request,
        { error: { code: "ticket_tag_lookup_failed" } },
        500,
      );
    }
    if (!assignment) return json(request, { data: { tag, removed: false } });
    const { error: deleteError } = await context.supabaseAdmin
      .from("ticket_tag_assignments")
      .delete()
      .eq("tenant_id", action.tenantId)
      .eq("ticket_id", action.ticketId)
      .eq("tag_id", action.tagId);
    if (deleteError) {
      return json(
        request,
        { error: { code: "ticket_tag_remove_failed" } },
        500,
      );
    }
    if (
      !(await auditTagEvent(
        context.supabaseAdmin,
        action.ticketId,
        actorId,
        "ticket.tag_removed",
        tag,
      ))
    ) {
      return json(request, { error: { code: "ticket_tag_audit_failed" } }, 500);
    }
    return json(request, { data: { tag, removed: true } });
  }

  const tagResult =
    action.type === "addTag"
      ? await findOrCreateTenantTag(
          context.supabaseAdmin,
          action.tenantId,
          actorId,
          action.name,
        )
      : {
          tag: await findTenantTag(
            context.supabaseAdmin,
            action.tenantId,
            action.tagId,
          ),
          error: false,
        };
  if (tagResult.error) {
    return json(request, { error: { code: "ticket_tag_create_failed" } }, 500);
  }
  if (!tagResult.tag) {
    return json(request, { error: { code: "ticket_tag_not_found" } }, 404);
  }
  const tag = tagResult.tag;

  const { data: existing, error: existingError } = await context.supabaseAdmin
    .from("ticket_tag_assignments")
    .select("tag_id")
    .eq("tenant_id", action.tenantId)
    .eq("ticket_id", action.ticketId)
    .eq("tag_id", tag.id)
    .maybeSingle();
  if (existingError) {
    return json(request, { error: { code: "ticket_tag_lookup_failed" } }, 500);
  }
  if (existing) return json(request, { data: { tag, assigned: false } });

  const { error: insertError } = await context.supabaseAdmin
    .from("ticket_tag_assignments")
    .insert({
      tenant_id: action.tenantId,
      ticket_id: action.ticketId,
      tag_id: tag.id,
      added_by: actorId,
    });
  if (insertError?.code === "23505") {
    return json(request, { data: { tag, assigned: false } });
  }
  if (insertError) {
    return json(request, { error: { code: "ticket_tag_assign_failed" } }, 500);
  }
  if (
    !(await auditTagEvent(
      context.supabaseAdmin,
      action.ticketId,
      actorId,
      "ticket.tag_added",
      tag,
    ))
  ) {
    return json(request, { error: { code: "ticket_tag_audit_failed" } }, 500);
  }
  return json(request, { data: { tag, assigned: true } }, 201);
});

export default {
  fetch(request: Request): Response | Promise<Response> {
    if (request.method === "OPTIONS") return json(request, {}, 204);
    return handler(request);
  },
};
