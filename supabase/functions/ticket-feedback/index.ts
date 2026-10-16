import { withSupabase } from "@supabase/server";

const ALLOWED_ORIGIN = "https://app.nextdesk.ch";
const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

type GetAction = {
  type: "get";
  tenantId: string;
  ticketId: string;
};
type SubmitAction = {
  type: "submit";
  tenantId: string;
  ticketId: string;
  score: number;
  comment?: string;
};
type Action = GetAction | SubmitAction;

type SatisfactionRow = {
  ticket_id: string;
  score: number | null;
  comment: string | null;
  submitted_by: string | null;
  submitted_at: string;
};

type TicketStatus = {
  id: string;
  key: string;
  label: string;
  is_closed: boolean;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isUuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );

const hasOnlyKeys = (value: Record<string, unknown>, keys: string[]) => {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
};

function parseAction(value: unknown): Action | null {
  if (!isRecord(value) || !isUuid(value.tenantId) || !isUuid(value.ticketId))
    return null;

  if (
    value.type === "get" &&
    hasOnlyKeys(value, ["type", "tenantId", "ticketId"])
  ) {
    return { type: "get", tenantId: value.tenantId, ticketId: value.ticketId };
  }

  if (
    value.type === "submit" &&
    hasOnlyKeys(value, ["type", "tenantId", "ticketId", "score", "comment"]) &&
    typeof value.score === "number" &&
    Number.isInteger(value.score) &&
    value.score >= 1 &&
    value.score <= 5 &&
    (value.comment === undefined || typeof value.comment === "string")
  ) {
    const comment = value.comment?.trim();
    if (
      comment !== undefined &&
      ([...comment].length > 3000 || comment.includes("\u0000"))
    )
      return null;

    return {
      type: "submit",
      tenantId: value.tenantId,
      ticketId: value.ticketId,
      score: value.score,
      comment,
    };
  }

  return null;
}

function headers(request: Request): HeadersInit {
  const responseHeaders: Record<string, string> = {
    "Access-Control-Allow-Headers":
      "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json; charset=utf-8",
    Vary: "Origin",
  };
  if (request.headers.get("origin") === ALLOWED_ORIGIN)
    responseHeaders["Access-Control-Allow-Origin"] = ALLOWED_ORIGIN;
  return responseHeaders;
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

function getStatus(value: unknown): TicketStatus | null {
  const status = Array.isArray(value) ? (value[0] ?? null) : value;
  if (
    !isRecord(status) ||
    !isUuid(status.id) ||
    typeof status.key !== "string" ||
    typeof status.label !== "string" ||
    typeof status.is_closed !== "boolean"
  )
    return null;
  return {
    id: status.id,
    key: status.key,
    label: status.label,
    is_closed: status.is_closed,
  };
}

function isWithinChangeWindow(submittedAt: string): boolean {
  const timestamp = Date.parse(submittedAt);
  return (
    Number.isFinite(timestamp) &&
    timestamp <= Date.now() &&
    Date.now() - timestamp <= FOURTEEN_DAYS_MS
  );
}

function publicSatisfaction(row: SatisfactionRow | null) {
  if (!row) return null;
  return {
    score: row.score,
    comment: row.comment,
  };
}

async function hasAlreadyChanged(
  admin: any,
  tenantId: string,
  ticketId: string,
  actorId: string,
): Promise<boolean | null> {
  const { data, error } = await admin
    .from("audit_logs")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("actor_id", actorId)
    .eq("entity_type", "ticket_satisfaction")
    .eq("entity_id", ticketId)
    .eq("action", "ticket.satisfaction.updated")
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return Boolean(data);
}

async function writeAudit(
  admin: any,
  input: {
    tenantId: string;
    ticketId: string;
    actorId: string;
    action: "ticket.satisfaction.submitted" | "ticket.satisfaction.updated";
    score: number;
    hadComment: boolean;
    previousScore?: number | null;
  },
): Promise<boolean> {
  const { error } = await admin.from("audit_logs").insert({
    tenant_id: input.tenantId,
    actor_id: input.actorId,
    action: input.action,
    entity_type: "ticket_satisfaction",
    entity_id: input.ticketId,
    severity: "info",
    before_data:
      input.previousScore === undefined ? null : { score: input.previousScore },
    after_data: { score: input.score },
    metadata: { hadComment: input.hadComment },
  });
  return !error;
}

const handler = withSupabase({ auth: "user" }, async (request, context) => {
  if (request.method !== "POST")
    return json(request, { error: { code: "method_not_allowed" } }, 405);

  const action = parseAction(await request.json().catch(() => null));
  const actorId = context.userClaims?.id;
  if (!action || typeof actorId !== "string")
    return json(request, { error: { code: "invalid_request" } }, 400);

  // This query intentionally uses the caller-scoped client. It is the common
  // authorization boundary for both actions: ticket RLS and tenant RLS apply.
  const { data: callerTicket, error: callerTicketError } =
    await context.supabase
      .from("tickets")
      .select(
        "id, tenant_id, requester_id, affected_user_id, status:ticket_statuses!inner(id, key, label, is_closed)",
      )
      .eq("id", action.ticketId)
      .eq("tenant_id", action.tenantId)
      .maybeSingle();

  if (callerTicketError)
    return json(request, { error: { code: "ticket_lookup_failed" } }, 500);
  if (!callerTicket)
    return json(request, { error: { code: "ticket_access_denied" } }, 403);

  const status = getStatus(callerTicket.status);
  if (!status)
    return json(request, { error: { code: "ticket_status_missing" } }, 422);

  const actorCanRate =
    callerTicket.requester_id === actorId ||
    callerTicket.affected_user_id === actorId;

  if (action.type === "get") {
    // Select through the caller-scoped client; submitted_by is read only to
    // calculate canRate and is deliberately never returned to the client.
    const { data, error } = await context.supabase
      .from("ticket_satisfaction")
      .select("ticket_id, score, comment, submitted_by, submitted_at")
      .eq("ticket_id", callerTicket.id)
      .maybeSingle();
    if (error)
      return json(
        request,
        { error: { code: "ticket_satisfaction_lookup_failed" } },
        500,
      );

    const satisfaction = (data ?? null) as SatisfactionRow | null;
    let canRate = status.is_closed && actorCanRate;
    if (satisfaction) {
      canRate =
        canRate &&
        satisfaction.submitted_by === actorId &&
        isWithinChangeWindow(satisfaction.submitted_at);
      if (canRate) {
        const alreadyChanged = await hasAlreadyChanged(
          context.supabaseAdmin,
          action.tenantId,
          callerTicket.id,
          actorId,
        );
        if (alreadyChanged === null)
          return json(
            request,
            { error: { code: "ticket_satisfaction_audit_check_failed" } },
            500,
          );
        canRate = !alreadyChanged;
      }
    }

    return json(request, {
      data: {
        satisfaction: publicSatisfaction(satisfaction),
        canRate,
        ticket: {
          status: {
            key: status.key,
            label: status.label,
            isClosed: status.is_closed,
          },
        },
      },
    });
  }

  if (!status.is_closed)
    return json(request, { error: { code: "ticket_not_closed" } }, 422);
  if (!actorCanRate)
    return json(
      request,
      { error: { code: "ticket_feedback_not_allowed" } },
      403,
    );

  const comment = action.comment || null;
  const { data: existingData, error: existingError } =
    await context.supabaseAdmin
      .from("ticket_satisfaction")
      .select("ticket_id, score, comment, submitted_by, submitted_at")
      .eq("ticket_id", callerTicket.id)
      .maybeSingle();
  if (existingError)
    return json(
      request,
      { error: { code: "ticket_satisfaction_lookup_failed" } },
      500,
    );
  const existing = (existingData ?? null) as SatisfactionRow | null;

  if (existing) {
    if (existing.submitted_by !== actorId)
      return json(
        request,
        { error: { code: "ticket_feedback_owned_by_another_user" } },
        403,
      );
    if (!isWithinChangeWindow(existing.submitted_at))
      return json(
        request,
        { error: { code: "ticket_feedback_change_window_expired" } },
        422,
      );

    const alreadyChanged = await hasAlreadyChanged(
      context.supabaseAdmin,
      action.tenantId,
      callerTicket.id,
      actorId,
    );
    if (alreadyChanged === null)
      return json(
        request,
        { error: { code: "ticket_satisfaction_audit_check_failed" } },
        500,
      );
    if (alreadyChanged)
      return json(
        request,
        { error: { code: "ticket_feedback_already_changed" } },
        409,
      );

    const { data: updatedData, error: updateError } =
      await context.supabaseAdmin
        .from("ticket_satisfaction")
        .update({ score: action.score, comment })
        .eq("ticket_id", callerTicket.id)
        .eq("submitted_by", actorId)
        .eq("submitted_at", existing.submitted_at)
        .select("ticket_id, score, comment, submitted_by, submitted_at")
        .maybeSingle();
    if (updateError)
      return json(
        request,
        { error: { code: "ticket_feedback_update_failed" } },
        422,
      );
    if (!updatedData)
      return json(
        request,
        { error: { code: "ticket_feedback_changed_concurrently" } },
        409,
      );

    const updated = updatedData as SatisfactionRow;
    const audited = await writeAudit(context.supabaseAdmin, {
      tenantId: action.tenantId,
      ticketId: callerTicket.id,
      actorId,
      action: "ticket.satisfaction.updated",
      score: action.score,
      hadComment: comment !== null,
      previousScore: existing.score,
    });
    if (!audited) {
      await context.supabaseAdmin
        .from("ticket_satisfaction")
        .update({ score: existing.score, comment: existing.comment })
        .eq("ticket_id", callerTicket.id)
        .eq("submitted_by", actorId)
        .eq("submitted_at", existing.submitted_at);
      return json(
        request,
        { error: { code: "ticket_feedback_audit_failed" } },
        500,
      );
    }

    return json(request, {
      data: { satisfaction: publicSatisfaction(updated) },
    });
  }

  const { error: profileError } = await context.supabaseAdmin
    .from("user_profiles")
    .upsert({ id: actorId });
  if (profileError)
    return json(
      request,
      { error: { code: "ticket_feedback_profile_failed" } },
      500,
    );

  const { data: createdData, error: createError } = await context.supabaseAdmin
    .from("ticket_satisfaction")
    .insert({
      ticket_id: callerTicket.id,
      score: action.score,
      comment,
      submitted_by: actorId,
    })
    .select("ticket_id, score, comment, submitted_by, submitted_at")
    .maybeSingle();

  if (createError) {
    if (createError.code === "23505")
      return json(
        request,
        { error: { code: "ticket_feedback_changed_concurrently" } },
        409,
      );
    return json(
      request,
      { error: { code: "ticket_feedback_create_failed" } },
      422,
    );
  }
  if (!createdData)
    return json(
      request,
      { error: { code: "ticket_feedback_create_failed" } },
      422,
    );

  const created = createdData as SatisfactionRow;
  const audited = await writeAudit(context.supabaseAdmin, {
    tenantId: action.tenantId,
    ticketId: callerTicket.id,
    actorId,
    action: "ticket.satisfaction.submitted",
    score: action.score,
    hadComment: comment !== null,
  });
  if (!audited) {
    await context.supabaseAdmin
      .from("ticket_satisfaction")
      .delete()
      .eq("ticket_id", callerTicket.id)
      .eq("submitted_by", actorId)
      .eq("submitted_at", created.submitted_at);
    return json(
      request,
      { error: { code: "ticket_feedback_audit_failed" } },
      500,
    );
  }

  return json(
    request,
    { data: { satisfaction: publicSatisfaction(created) } },
    201,
  );
});

export default {
  fetch(request: Request): Response | Promise<Response> {
    if (request.method === "OPTIONS") return json(request, {}, 204);
    return handler(request);
  },
};
