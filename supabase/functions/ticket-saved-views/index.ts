import { withSupabase } from "@supabase/server";

const APP_ORIGIN = "https://app.nextdesk.ch";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type TicketScope = "all" | "mine" | "unassigned" | "open" | "closed";
type TicketSortBy = "updated" | "agent" | "status" | "department" | "priority";
type TicketSortDirection = "asc" | "desc";
type Filters = {
  agent: "all" | "mine" | "unassigned" | string;
  department: string;
  priority: string;
  query: string;
  queue: string;
  sortBy: TicketSortBy;
  sortDirection: TicketSortDirection;
  status: string;
  ticketScope: TicketScope;
};
type Action =
  | { type: "listSavedViews"; tenantId: string }
  | {
      type: "saveSavedView";
      tenantId: string;
      viewId?: string;
      name: string;
      filters: Filters;
    }
  | { type: "deleteSavedView"; tenantId: string; viewId: string };

const selectColumns =
  "id, tenant_id, owner_id, name, visibility, filters, created_at, updated_at";

function headers(request: Request): HeadersInit {
  const origin = request.headers.get("origin");
  return {
    "Access-Control-Allow-Origin": origin === APP_ORIGIN ? APP_ORIGIN : "",
    "Access-Control-Allow-Headers":
      "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json; charset=utf-8",
    Vary: "Origin",
  };
}

function json(
  request: Request,
  body: Record<string, unknown>,
  status = 200,
): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: headers(request),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function parseFilters(value: unknown): Filters | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "query",
      "queue",
      "ticketScope",
      "agent",
      "status",
      "department",
      "priority",
      "sortBy",
      "sortDirection",
    ]) ||
    typeof value.query !== "string" ||
    typeof value.queue !== "string" ||
    !["all", "mine", "unassigned", "open", "closed"].includes(
      String(value.ticketScope),
    )
  ) {
    return null;
  }

  const query = value.query.trim();
  const queue = value.queue.trim();
  const agent = typeof value.agent === "string" ? value.agent.trim() : "all";
  const status = typeof value.status === "string" ? value.status.trim() : "all";
  const department =
    typeof value.department === "string" ? value.department.trim() : "all";
  const priority =
    typeof value.priority === "string" ? value.priority.trim() : "all";
  const sortBy = value.sortBy ?? "updated";
  const sortDirection = value.sortDirection ?? "desc";
  if (
    [...query].length > 240 ||
    [...queue].length < 1 ||
    [...queue].length > 120 ||
    (!["all", "mine", "unassigned"].includes(agent) && !isUuid(agent)) ||
    [...status].length > 120 ||
    [...department].length > 120 ||
    [...priority].length > 120 ||
    !["updated", "agent", "status", "department", "priority"].includes(
      String(sortBy),
    ) ||
    !["asc", "desc"].includes(String(sortDirection)) ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(query) ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(queue) ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(agent) ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(status) ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(department) ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(priority)
  ) {
    return null;
  }

  return {
    agent,
    department,
    priority,
    query,
    queue,
    sortBy: sortBy as TicketSortBy,
    sortDirection: sortDirection as TicketSortDirection,
    status,
    ticketScope: value.ticketScope as TicketScope,
  };
}

function parseAction(value: unknown): Action | null {
  if (!isRecord(value) || !isUuid(value.tenantId)) return null;
  if (
    value.type === "listSavedViews" &&
    hasOnlyKeys(value, ["type", "tenantId"])
  ) {
    return { type: value.type, tenantId: value.tenantId };
  }
  if (
    value.type === "saveSavedView" &&
    hasOnlyKeys(value, ["type", "tenantId", "viewId", "name", "filters"]) &&
    (value.viewId === undefined || isUuid(value.viewId)) &&
    typeof value.name === "string"
  ) {
    const name = value.name.trim();
    const filters = parseFilters(value.filters);
    if (
      !filters ||
      [...name].length < 1 ||
      [...name].length > 80 ||
      /[\u0000-\u001f\u007f-\u009f]/u.test(name)
    ) {
      return null;
    }
    return {
      type: value.type,
      tenantId: value.tenantId,
      ...(value.viewId === undefined ? {} : { viewId: value.viewId }),
      name,
      filters,
    };
  }
  if (
    value.type === "deleteSavedView" &&
    hasOnlyKeys(value, ["type", "tenantId", "viewId"]) &&
    isUuid(value.viewId)
  ) {
    return { type: value.type, tenantId: value.tenantId, viewId: value.viewId };
  }
  return null;
}

async function isActiveMember(admin: any, userId: string, tenantId: string) {
  const { data, error } = await admin
    .from("tenant_memberships")
    .select("tenant_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  return !error && Boolean(data);
}

function toResponse(view: any) {
  return {
    id: view.id,
    tenantId: view.tenant_id,
    ownerId: view.owner_id,
    name: view.name,
    visibility: "private",
    filters: view.filters,
    createdAt: view.created_at,
    updatedAt: view.updated_at,
  };
}

function auditData(view: any) {
  const filters = isRecord(view?.filters) ? view.filters : {};
  return {
    name: typeof view?.name === "string" ? view.name : "",
    ownerId: typeof view?.owner_id === "string" ? view.owner_id : "",
    visibility: "private",
    filterKeys: Object.keys(filters).sort(),
  };
}

async function audit(
  admin: any,
  tenantId: string,
  actorId: string,
  action: string,
  view: any,
  beforeData: Record<string, unknown> | null,
  afterData: Record<string, unknown> | null,
) {
  const { error } = await admin.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_id: actorId,
    action,
    entity_type: "saved_ticket_view",
    entity_id: view.id,
    severity: "info",
    before_data: beforeData,
    after_data: afterData,
    metadata: {
      ownerId: view.owner_id,
      visibility: "private",
      filterKeys: afterData?.filterKeys ?? beforeData?.filterKeys ?? [],
    },
  });
  return !error;
}

function mutationError(request: Request, error: any) {
  const duplicate = error?.code === "23505";
  return json(
    request,
    {
      error: {
        code: duplicate ? "saved_view_name_conflict" : "saved_view_save_failed",
      },
    },
    duplicate ? 409 : 422,
  );
}

const handler = withSupabase({ auth: "user" }, async (request, context) => {
  if (request.method !== "POST") {
    return json(request, { error: { code: "method_not_allowed" } }, 405);
  }

  const action = parseAction(await request.json().catch(() => null));
  const actorId = context.userClaims?.id;
  if (!action || !isUuid(actorId)) {
    return json(request, { error: { code: "invalid_request" } }, 400);
  }
  if (
    !(await isActiveMember(context.supabaseAdmin, actorId, action.tenantId))
  ) {
    return json(
      request,
      { error: { code: "saved_view_tenant_access_denied" } },
      403,
    );
  }

  if (action.type === "listSavedViews") {
    const { data, error } = await context.supabaseAdmin
      .from("saved_ticket_views")
      .select(selectColumns)
      .eq("tenant_id", action.tenantId)
      .eq("owner_id", actorId)
      .order("updated_at", { ascending: false });
    if (error) {
      return json(request, { error: { code: "saved_view_list_failed" } }, 500);
    }
    return json(request, {
      data: {
        savedViews: (data ?? []).map(toResponse),
      },
    });
  }

  if (action.type === "saveSavedView") {
    if (!action.viewId) {
      const { data: savedView, error } = await context.supabaseAdmin
        .from("saved_ticket_views")
        .insert({
          tenant_id: action.tenantId,
          owner_id: actorId,
          name: action.name,
          visibility: "private",
          filters: action.filters,
        })
        .select(selectColumns)
        .single();
      if (error) return mutationError(request, error);
      if (
        !(await audit(
          context.supabaseAdmin,
          action.tenantId,
          actorId,
          "ticket.saved_view.created",
          savedView,
          null,
          auditData(savedView),
        ))
      ) {
        await context.supabaseAdmin
          .from("saved_ticket_views")
          .delete()
          .eq("id", savedView.id)
          .eq("tenant_id", action.tenantId);
        return json(
          request,
          { error: { code: "saved_view_audit_failed" } },
          500,
        );
      }
      return json(request, { data: { savedView: toResponse(savedView) } }, 201);
    }

    const { data: previous, error: previousError } = await context.supabaseAdmin
      .from("saved_ticket_views")
      .select(selectColumns)
      .eq("id", action.viewId)
      .eq("tenant_id", action.tenantId)
      .maybeSingle();
    if (previousError) {
      return json(
        request,
        { error: { code: "saved_view_lookup_failed" } },
        500,
      );
    }
    if (!previous) {
      return json(request, { error: { code: "saved_view_not_found" } }, 404);
    }
    if (previous.owner_id !== actorId) {
      return json(
        request,
        { error: { code: "saved_view_manage_denied" } },
        403,
      );
    }

    const { data: savedView, error } = await context.supabaseAdmin
      .from("saved_ticket_views")
      .update({
        name: action.name,
        visibility: "private",
        filters: action.filters,
      })
      .eq("id", previous.id)
      .eq("tenant_id", action.tenantId)
      .select(selectColumns)
      .single();
    if (error) return mutationError(request, error);
    if (
      !(await audit(
        context.supabaseAdmin,
        action.tenantId,
        actorId,
        "ticket.saved_view.updated",
        savedView,
        auditData(previous),
        auditData(savedView),
      ))
    ) {
      await context.supabaseAdmin
        .from("saved_ticket_views")
        .update({
          name: previous.name,
          visibility: previous.visibility,
          filters: previous.filters,
        })
        .eq("id", previous.id)
        .eq("tenant_id", action.tenantId);
      return json(request, { error: { code: "saved_view_audit_failed" } }, 500);
    }
    return json(request, { data: { savedView: toResponse(savedView) } });
  }

  const { data: previous, error: previousError } = await context.supabaseAdmin
    .from("saved_ticket_views")
    .select(selectColumns)
    .eq("id", action.viewId)
    .eq("tenant_id", action.tenantId)
    .maybeSingle();
  if (previousError) {
    return json(request, { error: { code: "saved_view_lookup_failed" } }, 500);
  }
  if (!previous) {
    return json(request, { error: { code: "saved_view_not_found" } }, 404);
  }
  if (previous.owner_id !== actorId) {
    return json(request, { error: { code: "saved_view_manage_denied" } }, 403);
  }

  const { data: deletedView, error } = await context.supabaseAdmin
    .from("saved_ticket_views")
    .delete()
    .eq("id", previous.id)
    .eq("tenant_id", action.tenantId)
    .select(selectColumns)
    .maybeSingle();
  if (error || !deletedView) {
    return json(request, { error: { code: "saved_view_delete_failed" } }, 422);
  }
  if (
    !(await audit(
      context.supabaseAdmin,
      action.tenantId,
      actorId,
      "ticket.saved_view.deleted",
      deletedView,
      auditData(previous),
      null,
    ))
  ) {
    await context.supabaseAdmin.from("saved_ticket_views").insert(previous);
    return json(request, { error: { code: "saved_view_audit_failed" } }, 500);
  }
  return json(request, { data: { deleted: true, viewId: deletedView.id } });
});

export default {
  fetch(request: Request): Response | Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: headers(request) });
    }
    return handler(request);
  },
};
