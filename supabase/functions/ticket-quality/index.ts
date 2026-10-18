import { withSupabase } from "@supabase/server";

const ALLOWED_ORIGIN = "https://app.nextdesk.ch";
const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_NOTES_LENGTH = 3000;

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
  notes: string | null;
};

type Action = GetAction | SubmitAction;

type TicketStatus = {
  is_closed: boolean;
};

type CallerTicket = {
  id: string;
  tenant_id: string;
  department_id: string;
  status: TicketStatus | TicketStatus[] | null;
};

type OwnReview = {
  score: number;
  notes: string | null;
  createdAt: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isUuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );

const isScore = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= 1 &&
  value <= 5;

const hasOnlyKeys = (value: Record<string, unknown>, keys: string[]) => {
  const allowedKeys = new Set(keys);
  return Object.keys(value).every((key) => allowedKeys.has(key));
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
    hasOnlyKeys(value, ["type", "tenantId", "ticketId", "score", "notes"]) &&
    isScore(value.score) &&
    (value.notes === undefined || typeof value.notes === "string")
  ) {
    const notes = value.notes?.trim();
    if (
      notes !== undefined &&
      ([...notes].length > MAX_NOTES_LENGTH || notes.includes("\u0000"))
    )
      return null;

    return {
      type: "submit",
      tenantId: value.tenantId,
      ticketId: value.ticketId,
      score: value.score,
      notes: notes || null,
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

function error(
  request: Request,
  status: number,
  code: string,
  message: string,
): Response {
  return json(request, { error: { code, message } }, status);
}

function isDisallowedOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return origin !== null && origin !== ALLOWED_ORIGIN;
}

function contentTypeIsJson(request: Request): boolean {
  const contentType = request.headers.get("content-type");
  return contentType?.toLowerCase().startsWith("application/json") ?? false;
}

function ticketStatus(ticket: CallerTicket): TicketStatus | null {
  const status = Array.isArray(ticket.status)
    ? (ticket.status[0] ?? null)
    : ticket.status;
  if (!isRecord(status) || typeof status.is_closed !== "boolean") return null;
  return { is_closed: status.is_closed };
}

function isWithinChangeWindow(createdAt: string): boolean {
  const createdAtMs = Date.parse(createdAt);
  const now = Date.now();
  return (
    Number.isFinite(createdAtMs) &&
    createdAtMs <= now &&
    now - createdAtMs <= FOURTEEN_DAYS_MS
  );
}

function parseOwnReview(value: unknown): OwnReview | null {
  if (
    !isRecord(value) ||
    !isScore(value.score) ||
    (value.notes !== null && typeof value.notes !== "string") ||
    typeof value.created_at !== "string" ||
    !Number.isFinite(Date.parse(value.created_at))
  )
    return null;

  return {
    score: value.score,
    notes: value.notes,
    createdAt: value.created_at,
  };
}

function publicOwnReview(review: OwnReview | null) {
  if (!review) return null;
  return {
    score: review.score,
    notes: review.notes,
    createdAt: review.createdAt,
  };
}

async function getCallerTicket(
  client: any,
  tenantId: string,
  ticketId: string,
): Promise<{ ticket: CallerTicket | null; failed: boolean }> {
  // Deliberately caller-scoped: ticket and tenant RLS form the authorization
  // boundary before the service-role client may read review aggregates.
  const { data, error: ticketError } = await client
    .from("tickets")
    .select(
      "id, tenant_id, department_id, status:ticket_statuses!inner(is_closed)",
    )
    .eq("id", ticketId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (ticketError) return { ticket: null, failed: true };
  if (
    !isRecord(data) ||
    !isUuid(data.id) ||
    !isUuid(data.tenant_id) ||
    !isUuid(data.department_id)
  )
    return { ticket: null, failed: false };

  return { ticket: data as CallerTicket, failed: false };
}

async function hasReviewPermission(
  client: any,
  tenantId: string,
  departmentId: string,
): Promise<{ allowed: boolean; failed: boolean }> {
  // This RPC is also caller-scoped. has_ticket_permission evaluates auth.uid()
  // from the authenticated caller's JWT rather than from the service role.
  const { data, error: permissionError } = await client.rpc(
    "has_ticket_permission",
    {
      p_tenant_id: tenantId,
      p_department_id: departmentId,
      p_permission_code: "ticket.quality.review",
    },
  );

  if (permissionError || typeof data !== "boolean")
    return { allowed: false, failed: true };
  return { allowed: data, failed: false };
}

async function getOwnReview(
  admin: any,
  ticketId: string,
  reviewerId: string,
): Promise<{ review: OwnReview | null; failed: boolean }> {
  const { data, error: reviewError } = await admin
    .from("ticket_quality_reviews")
    .select("score, notes, created_at")
    .eq("ticket_id", ticketId)
    .eq("reviewer_id", reviewerId)
    .limit(2);

  if (reviewError || !Array.isArray(data) || data.length > 1)
    return { review: null, failed: true };
  if (data.length === 0) return { review: null, failed: false };

  const review = parseOwnReview(data[0]);
  return review ? { review, failed: false } : { review: null, failed: true };
}

function withNullableTextMatch(
  query: any,
  column: string,
  value: string | null,
) {
  return value === null ? query.is(column, null) : query.eq(column, value);
}

async function writeAudit(
  admin: any,
  input: {
    tenantId: string;
    ticketId: string;
    actorId: string;
    action: "ticket.quality.review.submitted" | "ticket.quality.review.updated";
    score: number;
    previousScore?: number;
    hasNotes: boolean;
  },
): Promise<boolean> {
  // Notes are intentionally excluded from the audit record; they can contain
  // arbitrary user content and are not needed to prove the state transition.
  const { error: auditError } = await admin.from("audit_logs").insert({
    tenant_id: input.tenantId,
    actor_id: input.actorId,
    action: input.action,
    entity_type: "ticket_quality_review",
    entity_id: input.ticketId,
    severity: "info",
    before_data:
      input.previousScore === undefined ? null : { score: input.previousScore },
    after_data: { score: input.score },
    metadata: { hasNotes: input.hasNotes },
  });
  return !auditError;
}

async function rollbackCreatedReview(
  admin: any,
  ticketId: string,
  reviewerId: string,
  createdAt: string,
): Promise<void> {
  await admin
    .from("ticket_quality_reviews")
    .delete()
    .eq("ticket_id", ticketId)
    .eq("reviewer_id", reviewerId)
    .eq("created_at", createdAt);
}

const handler = withSupabase({ auth: "user" }, async (request, context) => {
  if (request.method !== "POST")
    return error(
      request,
      405,
      "method_not_allowed",
      "Diese HTTP-Methode ist nicht erlaubt.",
    );
  if (!contentTypeIsJson(request))
    return error(
      request,
      415,
      "content_type_required",
      "Der Inhaltstyp muss application/json sein.",
    );

  const action = parseAction(await request.json().catch(() => null));
  const actorId = context.userClaims?.id;
  if (!action || typeof actorId !== "string" || !isUuid(actorId))
    return error(request, 400, "invalid_request", "Die Anfrage ist ungültig.");

  const callerTicket = await getCallerTicket(
    context.supabase,
    action.tenantId,
    action.ticketId,
  );
  if (callerTicket.failed)
    return error(
      request,
      500,
      "ticket_lookup_failed",
      "Das Ticket kann derzeit nicht geprüft werden.",
    );
  if (!callerTicket.ticket)
    return error(
      request,
      403,
      "ticket_access_denied",
      "Das Ticket ist nicht verfügbar.",
    );

  const status = ticketStatus(callerTicket.ticket);
  if (!status)
    return error(
      request,
      422,
      "ticket_status_invalid",
      "Der Ticketstatus ist ungültig.",
    );

  if (action.type === "get") {
    const permission = await hasReviewPermission(
      context.supabase,
      action.tenantId,
      callerTicket.ticket.department_id,
    );

    if (permission.failed)
      return error(
        request,
        500,
        "permission_check_failed",
        "Die Berechtigung kann derzeit nicht geprüft werden.",
      );
    if (!permission.allowed)
      return json(request, {
        data: {
          canRead: false,
          canReview: false,
          count: 0,
          averageScore: null,
          ownReview: null,
        },
      });

    const [scoresResult, ownResult] = await Promise.all([
      context.supabaseAdmin
        .from("ticket_quality_reviews")
        .select("score")
        .eq("ticket_id", callerTicket.ticket.id),
      getOwnReview(context.supabaseAdmin, callerTicket.ticket.id, actorId),
    ]);
    if (
      scoresResult.error ||
      !Array.isArray(scoresResult.data) ||
      ownResult.failed
    )
      return error(
        request,
        500,
        "review_lookup_failed",
        "Die Qualitätsbewertungen können derzeit nicht geladen werden.",
      );

    let total = 0;
    for (const row of scoresResult.data) {
      if (!isRecord(row) || !isScore(row.score))
        return error(
          request,
          500,
          "review_data_invalid",
          "Die Qualitätsbewertungen sind derzeit nicht verfügbar.",
        );
      total += row.score;
    }

    const count = scoresResult.data.length;
    const averageScore =
      count === 0 ? null : Number((total / count).toFixed(2));
    const canReview =
      status.is_closed &&
      permission.allowed &&
      (!ownResult.review || isWithinChangeWindow(ownResult.review.createdAt));

    return json(request, {
      data: {
        canRead: true,
        count,
        averageScore,
        ownReview: publicOwnReview(ownResult.review),
        canReview,
      },
    });
  }

  if (!status.is_closed)
    return error(
      request,
      422,
      "ticket_not_closed",
      "Eine Qualitätsbewertung ist erst für geschlossene Tickets möglich.",
    );

  const permission = await hasReviewPermission(
    context.supabase,
    action.tenantId,
    callerTicket.ticket.department_id,
  );
  if (permission.failed)
    return error(
      request,
      500,
      "permission_check_failed",
      "Die Berechtigung kann derzeit nicht geprüft werden.",
    );
  if (!permission.allowed)
    return error(
      request,
      403,
      "ticket_quality_review_denied",
      "Sie sind nicht berechtigt, diese Qualitätsbewertung abzugeben.",
    );

  const existingResult = await getOwnReview(
    context.supabaseAdmin,
    callerTicket.ticket.id,
    actorId,
  );
  if (existingResult.failed)
    return error(
      request,
      500,
      "review_lookup_failed",
      "Die Qualitätsbewertung kann derzeit nicht geprüft werden.",
    );

  const existing = existingResult.review;
  if (existing) {
    if (!isWithinChangeWindow(existing.createdAt))
      return error(
        request,
        422,
        "review_change_window_expired",
        "Eine Qualitätsbewertung kann nur während 14 Tagen geändert werden.",
      );

    let updateQuery = context.supabaseAdmin
      .from("ticket_quality_reviews")
      .update({ score: action.score, notes: action.notes })
      .eq("ticket_id", callerTicket.ticket.id)
      .eq("reviewer_id", actorId)
      .eq("created_at", existing.createdAt)
      .eq("score", existing.score);
    updateQuery = withNullableTextMatch(updateQuery, "notes", existing.notes);

    const { data: updatedData, error: updateError } = await updateQuery
      .select("score, notes, created_at")
      .maybeSingle();
    if (updateError)
      return error(
        request,
        422,
        "review_update_failed",
        "Die Qualitätsbewertung konnte nicht geändert werden.",
      );

    const updated = parseOwnReview(updatedData);
    if (!updated)
      return error(
        request,
        409,
        "review_changed_concurrently",
        "Die Qualitätsbewertung wurde zwischenzeitlich geändert. Bitte laden Sie sie neu.",
      );

    const audited = await writeAudit(context.supabaseAdmin, {
      tenantId: action.tenantId,
      ticketId: callerTicket.ticket.id,
      actorId,
      action: "ticket.quality.review.updated",
      score: updated.score,
      previousScore: existing.score,
      hasNotes: updated.notes !== null,
    });
    if (!audited) {
      let rollbackQuery = context.supabaseAdmin
        .from("ticket_quality_reviews")
        .update({ score: existing.score, notes: existing.notes })
        .eq("ticket_id", callerTicket.ticket.id)
        .eq("reviewer_id", actorId)
        .eq("created_at", existing.createdAt)
        .eq("score", updated.score);
      rollbackQuery = withNullableTextMatch(
        rollbackQuery,
        "notes",
        updated.notes,
      );
      await rollbackQuery;
      return error(
        request,
        500,
        "review_audit_failed",
        "Die Qualitätsbewertung konnte nicht vollständig gespeichert werden.",
      );
    }

    return json(request, { data: { ownReview: publicOwnReview(updated) } });
  }

  const { data: createdData, error: createError } = await context.supabaseAdmin
    .from("ticket_quality_reviews")
    .insert({
      ticket_id: callerTicket.ticket.id,
      reviewer_id: actorId,
      score: action.score,
      notes: action.notes,
    })
    .select("score, notes, created_at")
    .maybeSingle();

  if (createError) {
    if (createError.code === "23505")
      return error(
        request,
        409,
        "review_already_exists",
        "Für dieses Ticket besteht bereits eine eigene Qualitätsbewertung.",
      );
    return error(
      request,
      422,
      "review_create_failed",
      "Die Qualitätsbewertung konnte nicht gespeichert werden.",
    );
  }

  const created = parseOwnReview(createdData);
  if (!created)
    return error(
      request,
      422,
      "review_create_failed",
      "Die Qualitätsbewertung konnte nicht gespeichert werden.",
    );

  const audited = await writeAudit(context.supabaseAdmin, {
    tenantId: action.tenantId,
    ticketId: callerTicket.ticket.id,
    actorId,
    action: "ticket.quality.review.submitted",
    score: created.score,
    hasNotes: created.notes !== null,
  });
  if (!audited) {
    await rollbackCreatedReview(
      context.supabaseAdmin,
      callerTicket.ticket.id,
      actorId,
      created.createdAt,
    );
    return error(
      request,
      500,
      "review_audit_failed",
      "Die Qualitätsbewertung konnte nicht vollständig gespeichert werden.",
    );
  }

  return json(request, { data: { ownReview: publicOwnReview(created) } }, 201);
});

export default {
  fetch(request: Request): Response | Promise<Response> {
    if (request.method === "OPTIONS") {
      if (request.headers.get("origin") !== ALLOWED_ORIGIN)
        return error(
          request,
          403,
          "cross_origin_not_allowed",
          "Anfragen von dieser Herkunft sind nicht erlaubt.",
        );
      return json(request, {}, 204);
    }

    if (isDisallowedOrigin(request))
      return error(
        request,
        403,
        "cross_origin_not_allowed",
        "Anfragen von dieser Herkunft sind nicht erlaubt.",
      );

    return handler(request);
  },
};
