import { withSupabase } from "@supabase/server";

const ALLOWED_ORIGIN = "https://app.nextdesk.ch";
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NOTIFICATION_SELECT =
  "id, tenant_id, user_id, ticket_id, kind, payload, read_at, created_at";

type Action =
  | {
      type: "list";
      tenantId?: string;
      unreadOnly?: boolean;
      limit: number;
    }
  | { type: "markRead"; notificationId: string }
  | { type: "markAllRead"; tenantId: string };

type NotificationRow = {
  id: string;
  tenant_id: string;
  user_id: string;
  ticket_id: string | null;
  kind: string;
  payload: unknown;
  read_at: string | null;
  created_at: string;
};

type TicketRow = {
  id: string;
  tenant_id: string;
  ticket_number: string;
  subject: string;
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

function isLimit(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= MAX_LIMIT
  );
}

function parseAction(value: unknown): Action | null {
  if (!isRecord(value) || typeof value.type !== "string") return null;

  if (
    value.type === "list" &&
    hasOnlyKeys(value, ["type", "tenantId", "unreadOnly", "limit"])
  ) {
    if (
      (value.tenantId !== undefined && !isUuid(value.tenantId)) ||
      (value.unreadOnly !== undefined &&
        typeof value.unreadOnly !== "boolean") ||
      (value.limit !== undefined && !isLimit(value.limit))
    ) {
      return null;
    }

    return {
      type: "list",
      ...(value.tenantId !== undefined ? { tenantId: value.tenantId } : {}),
      ...(value.unreadOnly !== undefined
        ? { unreadOnly: value.unreadOnly }
        : {}),
      limit: value.limit === undefined ? DEFAULT_LIMIT : value.limit,
    };
  }

  if (
    value.type === "markRead" &&
    hasOnlyKeys(value, ["type", "notificationId"]) &&
    isUuid(value.notificationId)
  ) {
    return { type: "markRead", notificationId: value.notificationId };
  }

  if (
    value.type === "markAllRead" &&
    hasOnlyKeys(value, ["type", "tenantId"]) &&
    isUuid(value.tenantId)
  ) {
    return { type: "markAllRead", tenantId: value.tenantId };
  }

  return null;
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

function hasDisallowedOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return origin !== null && origin !== ALLOWED_ORIGIN;
}

async function hasActiveTenantMembership(
  admin: any,
  userId: string,
  tenantId: string,
): Promise<boolean | null> {
  const { data, error } = await admin
    .from("tenant_memberships")
    .select("tenant_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();

  if (error) return null;
  return Boolean(data);
}

async function listNotifications(
  request: Request,
  admin: any,
  client: any,
  actorId: string,
  action: Extract<Action, { type: "list" }>,
): Promise<Response> {
  if (action.tenantId) {
    const membership = await hasActiveTenantMembership(
      admin,
      actorId,
      action.tenantId,
    );
    if (membership === null)
      return json(
        request,
        { error: { code: "authorization_check_failed" } },
        500,
      );
    if (!membership)
      return json(
        request,
        { error: { code: "tenant_membership_required" } },
        403,
      );
  }

  let query = admin
    .from("ticket_notifications")
    .select(NOTIFICATION_SELECT)
    .eq("user_id", actorId)
    .order("created_at", { ascending: false })
    .limit(action.limit);

  if (action.tenantId) query = query.eq("tenant_id", action.tenantId);
  if (action.unreadOnly) query = query.is("read_at", null);

  const { data, error } = await query;
  if (error)
    return json(request, { error: { code: "notification_list_failed" } }, 500);

  const notifications = (data ?? []) as NotificationRow[];
  const tenantIds = [
    ...new Set(notifications.map((notification) => notification.tenant_id)),
  ];
  const { data: memberships, error: membershipError } = tenantIds.length
    ? await client
        .from("tenant_memberships")
        .select("tenant_id")
        .eq("user_id", actorId)
        .eq("status", "active")
        .in("tenant_id", tenantIds)
    : { data: [], error: null };
  if (membershipError)
    return json(
      request,
      { error: { code: "authorization_check_failed" } },
      500,
    );
  const activeTenantIds = new Set(
    (memberships ?? []).map((membership: any) => membership.tenant_id),
  );
  const membershipVisibleNotifications = notifications.filter((notification) =>
    activeTenantIds.has(notification.tenant_id),
  );
  const ticketIds = [
    ...new Set(
      membershipVisibleNotifications
        .map((notification) => notification.ticket_id)
        .filter((ticketId): ticketId is string => ticketId !== null),
    ),
  ];

  const ticketsById = new Map<string, TicketRow>();
  if (ticketIds.length > 0) {
    const { data: tickets, error: ticketError } = await client
      .from("tickets")
      .select("id, tenant_id, ticket_number, subject")
      .in("id", ticketIds);
    if (ticketError)
      return json(
        request,
        { error: { code: "notification_ticket_reference_failed" } },
        500,
      );
    for (const ticket of (tickets ?? []) as TicketRow[]) {
      ticketsById.set(ticket.id, ticket);
    }
  }
  const visibleNotifications = membershipVisibleNotifications.filter(
    (notification) =>
      notification.ticket_id === null ||
      ticketsById.has(notification.ticket_id),
  );

  return json(request, {
    data: {
      notifications: visibleNotifications.map((notification) => {
        const ticket = notification.ticket_id
          ? ticketsById.get(notification.ticket_id)
          : undefined;
        const ticketReference =
          ticket && ticket.tenant_id === notification.tenant_id
            ? {
                id: ticket.id,
                ticketNumber: ticket.ticket_number,
                subject: ticket.subject,
              }
            : null;

        return {
          id: notification.id,
          tenantId: notification.tenant_id,
          kind: notification.kind,
          payload: notification.payload,
          readAt: notification.read_at,
          createdAt: notification.created_at,
          ticket: ticketReference,
        };
      }),
    },
  });
}

async function markRead(
  request: Request,
  admin: any,
  actorId: string,
  notificationId: string,
): Promise<Response> {
  const { data: notification, error: notificationError } = await admin
    .from("ticket_notifications")
    .select("id, tenant_id")
    .eq("id", notificationId)
    .eq("user_id", actorId)
    .maybeSingle();

  if (notificationError)
    return json(request, { error: { code: "notification_read_failed" } }, 500);
  if (!notification)
    return json(request, { error: { code: "notification_not_found" } }, 404);

  const membership = await hasActiveTenantMembership(
    admin,
    actorId,
    notification.tenant_id,
  );
  if (membership === null)
    return json(
      request,
      { error: { code: "authorization_check_failed" } },
      500,
    );
  if (!membership)
    return json(
      request,
      { error: { code: "tenant_membership_required" } },
      403,
    );

  const readAt = new Date().toISOString();
  const { data: updated, error: updateError } = await admin
    .from("ticket_notifications")
    .update({ read_at: readAt })
    .eq("id", notificationId)
    .eq("user_id", actorId)
    .eq("tenant_id", notification.tenant_id)
    .is("read_at", null)
    .select("id")
    .maybeSingle();

  if (updateError)
    return json(request, { error: { code: "notification_read_failed" } }, 500);

  return json(request, {
    data: {
      notificationId,
      read: true,
      changed: Boolean(updated),
    },
  });
}

async function markAllRead(
  request: Request,
  admin: any,
  actorId: string,
  tenantId: string,
): Promise<Response> {
  const membership = await hasActiveTenantMembership(admin, actorId, tenantId);
  if (membership === null)
    return json(
      request,
      { error: { code: "authorization_check_failed" } },
      500,
    );
  if (!membership)
    return json(
      request,
      { error: { code: "tenant_membership_required" } },
      403,
    );

  const { count, error: countError } = await admin
    .from("ticket_notifications")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("user_id", actorId)
    .is("read_at", null);
  if (countError)
    return json(request, { error: { code: "notification_count_failed" } }, 500);

  const readAt = new Date().toISOString();
  const { error: updateError } = await admin
    .from("ticket_notifications")
    .update({ read_at: readAt })
    .eq("tenant_id", tenantId)
    .eq("user_id", actorId)
    .is("read_at", null);
  if (updateError)
    return json(
      request,
      { error: { code: "notification_mark_all_read_failed" } },
      500,
    );

  const markedReadCount = count ?? 0;
  const { error: auditError } = await admin.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_id: actorId,
    action: "notification.center.mark_all_read",
    entity_type: "ticket_notification",
    entity_id: null,
    severity: "info",
    after_data: { readAt, markedReadCount },
    metadata: {
      operation: "markAllRead",
      notificationUserId: actorId,
      markedReadCount,
    },
  });
  if (auditError)
    return json(request, { error: { code: "notification_audit_failed" } }, 500);

  return json(request, {
    data: {
      tenantId,
      markedReadCount,
    },
  });
}

const handler = withSupabase({ auth: "user" }, async (request, context) => {
  if (request.method !== "POST")
    return json(request, { error: { code: "method_not_allowed" } }, 405);

  const action = parseAction(await request.json().catch(() => null));
  const actorId = context.userClaims?.id;
  if (!action || typeof actorId !== "string" || !isUuid(actorId))
    return json(request, { error: { code: "invalid_request" } }, 400);

  const admin = context.supabaseAdmin;
  if (action.type === "list")
    return await listNotifications(
      request,
      admin,
      context.supabase,
      actorId,
      action,
    );
  if (action.type === "markRead")
    return await markRead(request, admin, actorId, action.notificationId);
  return await markAllRead(request, admin, actorId, action.tenantId);
});

export default {
  fetch(request: Request): Response | Promise<Response> {
    if (request.method === "OPTIONS") {
      if (request.headers.get("origin") !== ALLOWED_ORIGIN)
        return new Response(null, { status: 403, headers: { Vary: "Origin" } });
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }
    if (hasDisallowedOrigin(request))
      return json(request, { error: { code: "cors_origin_not_allowed" } }, 403);
    return handler(request);
  },
};
