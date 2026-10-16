import { withSupabase } from "@supabase/server";

type BillingKind = "internal" | "billable" | "goodwill";
type Action =
  | { type: "getTicket"; tenantId: string; ticketId: string }
  | {
      type: "updateTicket";
      tenantId: string;
      ticketId: string;
      statusKey?: string;
      priorityKey?: string;
      assignedAgentId?: string | null;
      assignedTeamId?: string | null;
    }
  | {
      type: "addComment";
      tenantId: string;
      ticketId: string;
      body: string;
      visibility: "internal" | "external";
    }
  | {
      type: "toggleWatch";
      tenantId: string;
      ticketId: string;
      watching: boolean;
    }
  | {
      type: "addChecklistItem";
      tenantId: string;
      ticketId: string;
      description: string;
    }
  | {
      type: "toggleChecklistItem";
      tenantId: string;
      ticketId: string;
      itemId: string;
      completed: boolean;
    }
  | {
      type: "addTimeEntry";
      tenantId: string;
      ticketId: string;
      minutes: number;
      billingKind: BillingKind;
      note?: string;
      startedAt?: string;
    };

const originHeaders = (request: Request) => ({
  "Access-Control-Allow-Origin":
    request.headers.get("origin") === "https://app.nextdesk.ch"
      ? "https://app.nextdesk.ch"
      : "",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
  Vary: "Origin",
});
const response = (
  request: Request,
  body: Record<string, unknown>,
  status = 200,
) =>
  new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: originHeaders(request),
  });
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isUuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );

function parseAction(value: unknown): Action | null {
  if (!isRecord(value) || !isUuid(value.tenantId) || !isUuid(value.ticketId))
    return null;
  if (value.type === "getTicket")
    return {
      type: value.type,
      tenantId: value.tenantId,
      ticketId: value.ticketId,
    };
  if (
    value.type === "addComment" &&
    typeof value.body === "string" &&
    (value.visibility === "internal" || value.visibility === "external")
  )
    return {
      type: value.type,
      tenantId: value.tenantId,
      ticketId: value.ticketId,
      body: value.body.trim(),
      visibility: value.visibility,
    };
  if (value.type === "toggleWatch" && typeof value.watching === "boolean")
    return {
      type: value.type,
      tenantId: value.tenantId,
      ticketId: value.ticketId,
      watching: value.watching,
    };
  if (
    value.type === "addChecklistItem" &&
    typeof value.description === "string"
  )
    return {
      type: value.type,
      tenantId: value.tenantId,
      ticketId: value.ticketId,
      description: value.description.trim(),
    };
  if (
    value.type === "toggleChecklistItem" &&
    isUuid(value.itemId) &&
    typeof value.completed === "boolean"
  )
    return {
      type: value.type,
      tenantId: value.tenantId,
      ticketId: value.ticketId,
      itemId: value.itemId,
      completed: value.completed,
    };
  if (
    value.type === "addTimeEntry" &&
    typeof value.minutes === "number" &&
    Number.isInteger(value.minutes) &&
    value.minutes >= 1 &&
    value.minutes <= 1440 &&
    (value.billingKind === "internal" ||
      value.billingKind === "billable" ||
      value.billingKind === "goodwill") &&
    (value.note === undefined ||
      (typeof value.note === "string" && value.note.length <= 3000)) &&
    (value.startedAt === undefined || typeof value.startedAt === "string")
  )
    return {
      type: value.type,
      tenantId: value.tenantId,
      ticketId: value.ticketId,
      minutes: value.minutes,
      billingKind: value.billingKind,
      note: value.note,
      startedAt: value.startedAt,
    };
  if (value.type === "updateTicket")
    return {
      type: value.type,
      tenantId: value.tenantId,
      ticketId: value.ticketId,
      statusKey:
        typeof value.statusKey === "string" ? value.statusKey : undefined,
      priorityKey:
        typeof value.priorityKey === "string" ? value.priorityKey : undefined,
      assignedAgentId:
        value.assignedAgentId === null || isUuid(value.assignedAgentId)
          ? value.assignedAgentId
          : undefined,
      assignedTeamId:
        value.assignedTeamId === null || isUuid(value.assignedTeamId)
          ? value.assignedTeamId
          : undefined,
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
async function hasPermission(
  admin: any,
  userId: string,
  tenantId: string,
  departmentId: string,
  permission: string,
) {
  const now = new Date().toISOString();
  const { data } = await admin
    .from("user_role_assignments")
    .select(
      "role_id, department_id, roles!inner(active, role_permissions!inner(permission_code))",
    )
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .lte("starts_at", now)
    .or(`expires_at.is.null,expires_at.gt.${now}`);
  return (data ?? []).some((assignment: any) =>
    assignment.department_id === null ||
    assignment.department_id === departmentId
      ? assignment.roles?.active &&
        (assignment.roles.role_permissions ?? []).some(
          (item: any) => item.permission_code === permission,
        )
      : false,
  );
}
async function canRead(admin: any, userId: string, ticket: any) {
  if (!(await activeMember(admin, userId, ticket.tenant_id))) return false;
  if (ticket.requester_id === userId || ticket.affected_user_id === userId)
    return true;
  if (
    ticket.assigned_agent_id === userId &&
    (await hasPermission(
      admin,
      userId,
      ticket.tenant_id,
      ticket.department_id,
      "ticket.read.assigned",
    ))
  )
    return true;
  if (
    await hasPermission(
      admin,
      userId,
      ticket.tenant_id,
      ticket.department_id,
      "ticket.read.department",
    )
  )
    return true;
  if (ticket.customer_organization_id) {
    const { data } = await admin
      .from("customer_memberships")
      .select("access, customer_organizations!inner(active, ticket_access)")
      .eq("customer_organization_id", ticket.customer_organization_id)
      .eq("user_id", userId)
      .maybeSingle();
    return Boolean(
      data?.access === "company" &&
      data.customer_organizations?.active &&
      data.customer_organizations?.ticket_access !== "disabled",
    );
  }
  return false;
}
async function getTicket(admin: any, tenantId: string, ticketId: string) {
  const { data } = await admin
    .from("tickets")
    .select("*")
    .eq("id", ticketId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  return data;
}

const handler = withSupabase({ auth: "user" }, async (request, context) => {
  if (request.method !== "POST")
    return response(request, { error: { code: "method_not_allowed" } }, 405);
  const action = parseAction(await request.json().catch(() => null));
  const actorId = context.userClaims?.id;
  if (!action || typeof actorId !== "string")
    return response(request, { error: { code: "invalid_request" } }, 400);
  const ticket = await getTicket(
    context.supabaseAdmin,
    action.tenantId,
    action.ticketId,
  );
  if (!ticket || !(await canRead(context.supabaseAdmin, actorId, ticket)))
    return response(request, { error: { code: "ticket_access_denied" } }, 403);
  const internal = await hasPermission(
    context.supabaseAdmin,
    actorId,
    ticket.tenant_id,
    ticket.department_id,
    "ticket.internal_notes.read",
  );

  if (action.type === "getTicket") {
    const [
      { data: comments },
      { data: events },
      { data: statuses },
      { data: priorities },
      { data: teams },
      { data: watchers },
      { data: checklistItems },
      { data: timeEntries },
    ] = await Promise.all([
      context.supabaseAdmin
        .from("ticket_comments")
        .select("id, author_id, visibility, body, created_at, updated_at")
        .eq("ticket_id", ticket.id)
        .order("created_at"),
      context.supabaseAdmin
        .from("ticket_events")
        .select("id, event_type, payload, created_at")
        .eq("ticket_id", ticket.id)
        .order("created_at", { ascending: false })
        .limit(100),
      context.supabaseAdmin
        .from("ticket_statuses")
        .select("id, key, label, is_closed, sort_order")
        .eq("tenant_id", ticket.tenant_id)
        .order("sort_order"),
      context.supabaseAdmin
        .from("ticket_priorities")
        .select("id, key, label, sort_order")
        .eq("tenant_id", ticket.tenant_id)
        .order("sort_order"),
      context.supabaseAdmin
        .from("teams")
        .select("id, name")
        .eq("tenant_id", ticket.tenant_id)
        .eq("active", true)
        .order("name"),
      context.supabaseAdmin
        .from("ticket_watchers")
        .select("user_id")
        .eq("ticket_id", ticket.id)
        .eq("user_id", actorId)
        .maybeSingle(),
      context.supabaseAdmin
        .from("ticket_checklist_items")
        .select(
          "id, ticket_id, description, position, completed_at, completed_by, created_by, created_at",
        )
        .eq("ticket_id", ticket.id)
        .order("position")
        .order("created_at"),
      context.supabaseAdmin
        .from("ticket_time_entries")
        .select(
          "id, author_id, minutes, billing_kind, note, started_at, created_at",
        )
        .eq("ticket_id", ticket.id)
        .order("created_at", { ascending: false }),
    ]);
    const filteredComments = internal
      ? (comments ?? [])
      : (comments ?? []).filter(
          (comment: any) => comment.visibility === "external",
        );
    const authorIds = [
      ...new Set(filteredComments.map((comment: any) => comment.author_id)),
    ];
    const { data: profiles } = authorIds.length
      ? await context.supabaseAdmin
          .from("user_profiles")
          .select("id, display_name")
          .in("id", authorIds)
      : { data: [] };
    const profileNames = Object.fromEntries(
      (profiles ?? []).map((profile: any) => [
        profile.id,
        profile.display_name,
      ]),
    );
    return response(request, {
      data: {
        ticket,
        comments: filteredComments.map((comment: any) => ({
          ...comment,
          authorName: profileNames[comment.author_id] ?? "nextDesk Benutzer",
        })),
        events: events ?? [],
        statuses: statuses ?? [],
        priorities: priorities ?? [],
        teams: teams ?? [],
        watching: Boolean(watchers),
        checklistItems: checklistItems ?? [],
        timeEntries: internal ? (timeEntries ?? []) : [],
        canUpdate: await hasPermission(
          context.supabaseAdmin,
          actorId,
          ticket.tenant_id,
          ticket.department_id,
          "ticket.update",
        ),
        canAssign: await hasPermission(
          context.supabaseAdmin,
          actorId,
          ticket.tenant_id,
          ticket.department_id,
          "ticket.assign",
        ),
        canTrackTime: await hasPermission(
          context.supabaseAdmin,
          actorId,
          ticket.tenant_id,
          ticket.department_id,
          "ticket.time.track",
        ),
        canUseInternalNotes: internal,
      },
    });
  }

  if (action.type === "addTimeEntry") {
    if (
      !(await hasPermission(
        context.supabaseAdmin,
        actorId,
        ticket.tenant_id,
        ticket.department_id,
        "ticket.time.track",
      ))
    )
      return response(
        request,
        { error: { code: "ticket_time_track_denied" } },
        403,
      );
    const { data: timeEntry, error } = await context.supabaseAdmin
      .from("ticket_time_entries")
      .insert({
        ticket_id: ticket.id,
        author_id: actorId,
        minutes: action.minutes,
        billing_kind: action.billingKind,
        note: action.note ?? null,
        started_at: action.startedAt ?? null,
      })
      .select(
        "id, author_id, minutes, billing_kind, note, started_at, created_at",
      )
      .single();
    if (error)
      return response(
        request,
        { error: { code: "time_entry_create_failed" } },
        422,
      );
    await context.supabaseAdmin.from("ticket_events").insert({
      ticket_id: ticket.id,
      actor_id: actorId,
      event_type: "time_entry.added",
      payload: {
        timeEntryId: timeEntry.id,
        minutes: timeEntry.minutes,
        billingKind: timeEntry.billing_kind,
        startedAt: timeEntry.started_at,
      },
    });
    return response(request, { data: { timeEntry } }, 201);
  }

  if (action.type === "addComment") {
    if (action.body.length < 1 || action.body.length > 50000)
      return response(request, { error: { code: "invalid_comment" } }, 422);
    if (
      action.visibility === "internal" &&
      !(await hasPermission(
        context.supabaseAdmin,
        actorId,
        ticket.tenant_id,
        ticket.department_id,
        "ticket.internal_notes.write",
      ))
    )
      return response(
        request,
        { error: { code: "internal_note_denied" } },
        403,
      );
    const { error } = await context.supabaseAdmin
      .from("ticket_comments")
      .insert({
        ticket_id: ticket.id,
        author_id: actorId,
        visibility: action.visibility,
        body: action.body,
      });
    if (error)
      return response(
        request,
        { error: { code: "comment_create_failed" } },
        422,
      );
    await context.supabaseAdmin.from("ticket_events").insert({
      ticket_id: ticket.id,
      actor_id: actorId,
      event_type:
        action.visibility === "internal"
          ? "comment.internal_added"
          : "comment.external_added",
      payload: {},
    });
    if (action.visibility === "external" && !ticket.first_responded_at)
      await context.supabaseAdmin
        .from("tickets")
        .update({ first_responded_at: new Date().toISOString() })
        .eq("id", ticket.id);
    return response(request, { data: { created: true } }, 201);
  }

  if (action.type === "toggleWatch") {
    if (action.watching)
      await context.supabaseAdmin
        .from("ticket_watchers")
        .upsert({ ticket_id: ticket.id, user_id: actorId });
    else
      await context.supabaseAdmin
        .from("ticket_watchers")
        .delete()
        .eq("ticket_id", ticket.id)
        .eq("user_id", actorId);
    return response(request, { data: { watching: action.watching } });
  }

  if (
    action.type === "addChecklistItem" ||
    action.type === "toggleChecklistItem"
  ) {
    if (
      !(await hasPermission(
        context.supabaseAdmin,
        actorId,
        ticket.tenant_id,
        ticket.department_id,
        "ticket.update",
      ))
    )
      return response(
        request,
        { error: { code: "ticket_update_denied" } },
        403,
      );

    if (action.type === "addChecklistItem") {
      if (action.description.length < 1 || action.description.length > 1000)
        return response(
          request,
          { error: { code: "invalid_checklist_item" } },
          422,
        );
      const { data: item, error } = await context.supabaseAdmin
        .from("ticket_checklist_items")
        .insert({
          ticket_id: ticket.id,
          description: action.description,
          created_by: actorId,
        })
        .select(
          "id, ticket_id, description, position, completed_at, completed_by, created_by, created_at",
        )
        .single();
      if (error)
        return response(
          request,
          { error: { code: "checklist_item_create_failed" } },
          422,
        );
      await context.supabaseAdmin.from("ticket_events").insert({
        ticket_id: ticket.id,
        actor_id: actorId,
        event_type: "checklist.item_added",
        payload: { itemId: item.id, description: item.description },
      });
      return response(request, { data: { item } }, 201);
    }

    const completedAt = action.completed ? new Date().toISOString() : null;
    const { data: item, error } = await context.supabaseAdmin
      .from("ticket_checklist_items")
      .update({
        completed_at: completedAt,
        completed_by: action.completed ? actorId : null,
      })
      .eq("id", action.itemId)
      .eq("ticket_id", ticket.id)
      .select(
        "id, ticket_id, description, position, completed_at, completed_by, created_by, created_at",
      )
      .maybeSingle();
    if (error)
      return response(
        request,
        { error: { code: "checklist_item_update_failed" } },
        422,
      );
    if (!item)
      return response(
        request,
        { error: { code: "checklist_item_not_found" } },
        404,
      );
    await context.supabaseAdmin.from("ticket_events").insert({
      ticket_id: ticket.id,
      actor_id: actorId,
      event_type: action.completed
        ? "checklist.item_completed"
        : "checklist.item_reopened",
      payload: { itemId: item.id, completed: action.completed },
    });
    return response(request, { data: { item } });
  }

  if (
    !(await hasPermission(
      context.supabaseAdmin,
      actorId,
      ticket.tenant_id,
      ticket.department_id,
      "ticket.update",
    ))
  )
    return response(request, { error: { code: "ticket_update_denied" } }, 403);
  const update: Record<string, unknown> = {};
  const payload: Record<string, unknown> = {};
  if (action.statusKey) {
    const { data: status } = await context.supabaseAdmin
      .from("ticket_statuses")
      .select("id, key, is_closed")
      .eq("tenant_id", ticket.tenant_id)
      .eq("key", action.statusKey)
      .maybeSingle();
    if (!status)
      return response(request, { error: { code: "status_invalid" } }, 422);
    if (
      status.is_closed &&
      !(await hasPermission(
        context.supabaseAdmin,
        actorId,
        ticket.tenant_id,
        ticket.department_id,
        "ticket.close",
      ))
    )
      return response(request, { error: { code: "ticket_close_denied" } }, 403);
    update.status_id = status.id;
    update.closed_at = status.is_closed ? new Date().toISOString() : null;
    update.resolved_at =
      status.key === "resolved" ? new Date().toISOString() : ticket.resolved_at;
    update.waiting_since = status.key.startsWith("waiting")
      ? new Date().toISOString()
      : null;
    payload.status = status.key;
  }
  if (action.priorityKey) {
    const { data: priority } = await context.supabaseAdmin
      .from("ticket_priorities")
      .select("id, key")
      .eq("tenant_id", ticket.tenant_id)
      .eq("key", action.priorityKey)
      .maybeSingle();
    if (!priority)
      return response(request, { error: { code: "priority_invalid" } }, 422);
    update.priority_id = priority.id;
    payload.priority = priority.key;
  }
  if (
    action.assignedAgentId !== undefined ||
    action.assignedTeamId !== undefined
  ) {
    if (
      !(await hasPermission(
        context.supabaseAdmin,
        actorId,
        ticket.tenant_id,
        ticket.department_id,
        "ticket.assign",
      ))
    )
      return response(
        request,
        { error: { code: "ticket_assign_denied" } },
        403,
      );
    if (action.assignedAgentId !== undefined)
      update.assigned_agent_id = action.assignedAgentId;
    if (action.assignedTeamId !== undefined)
      update.assigned_team_id = action.assignedTeamId;
    payload.assignment = true;
  }
  if (Object.keys(update).length === 0)
    return response(request, { error: { code: "no_change" } }, 422);
  const { error } = await context.supabaseAdmin
    .from("tickets")
    .update(update)
    .eq("id", ticket.id);
  if (error)
    return response(request, { error: { code: "ticket_update_failed" } }, 422);
  await context.supabaseAdmin.from("ticket_events").insert({
    ticket_id: ticket.id,
    actor_id: actorId,
    event_type: "ticket.updated",
    payload,
  });
  return response(request, { data: { updated: true } });
});
export default {
  fetch(request: Request): Response | Promise<Response> {
    if (request.method === "OPTIONS") return response(request, {}, 204);
    return handler(request);
  },
};
