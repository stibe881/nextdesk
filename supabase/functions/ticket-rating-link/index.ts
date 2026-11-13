import { withSupabase } from "@supabase/server";
import { msg } from "../_shared/formality.ts";
import { corsHeaders, isRecord } from "../_shared/http.ts";
import { verifyRatingLinkToken } from "../_shared/rating-link-token.ts";
import { resolveTenantFeatureStates } from "../_shared/tenant-features.ts";

// Public endpoint (verify_jwt = false) for the star links in the «ticket
// resolved» e-mail. The caller is identified only by the signed token (ticket
// and score). The web page /#ticket-bewertung=… first asks for a preview,
// then confirms, so mail scanners that open links never rate on a person's behalf.
//   POST { token }                          -> preview (changes nothing)
//   POST { token, confirm: true, comment? } -> saves the rating
const MAX_BYTES = 16 * 1024;
const MAX_COMMENT = 3000;

const ERRORS: Record<string, { status: number; message: string }> = {
  invalid_request: { status: 400, message: "Die Anfrage ist ungültig." },
  token_invalid: {
    status: 400,
    message: msg(
      "Dieser Link ist ungültig. Bitte öffne das Ticket im Portal.",
      "Dieser Link ist ungültig. Bitte öffnen Sie das Ticket im Portal.",
    ),
  },
  token_expired: {
    status: 410,
    message: msg(
      "Dieser Link ist abgelaufen. Bitte öffne das Ticket im Portal.",
      "Dieser Link ist abgelaufen. Bitte öffnen Sie das Ticket im Portal.",
    ),
  },
  ticket_not_available: {
    status: 404,
    message: "Das Ticket ist nicht verfügbar.",
  },
  comment_too_long: { status: 422, message: "Der Kommentar ist zu lang." },
  unavailable: {
    status: 503,
    message: "Die Bewertung ist gerade nicht möglich. Bitte später erneut versuchen.",
  },
  failed: {
    status: 500,
    message: "Die Bewertung konnte nicht gespeichert werden.",
  },
};

function respond(
  request: Request,
  body: Record<string, unknown>,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(request),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}

function failure(request: Request, code: string): Response {
  const error = ERRORS[code] ?? ERRORS.failed!;
  return respond(
    request,
    { error: { code: ERRORS[code] ? code : "failed", message: error.message } },
    error.status,
  );
}

type TicketRow = {
  id: string;
  ticket_number: string | null;
  subject: string | null;
  requester_id: string | null;
  status: unknown;
};

function ratable(status: unknown): boolean {
  const row = Array.isArray(status) ? status[0] : status;
  return (
    isRecord(row) && (row.is_closed === true || row.key === "resolved")
  );
}

const handler = withSupabase(
  { auth: "none", cors: "disabled", errors: { detailed: false } },
  async (request, context) => {
    const admin = context.supabaseAdmin;
    const length = request.headers.get("content-length");
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES))
      return failure(request, "invalid_request");
    const text = await request.text().catch(() => "");
    if (text.length > MAX_BYTES) return failure(request, "invalid_request");
    let body: unknown = null;
    try {
      body = JSON.parse(text);
    } catch {
      return failure(request, "invalid_request");
    }
    if (!isRecord(body) || typeof body.token !== "string")
      return failure(request, "invalid_request");

    const secret = await admin.rpc("ticket_requester_action_secret");
    if (secret.error || typeof secret.data !== "string")
      return failure(request, "unavailable");
    const verified = await verifyRatingLinkToken(body.token, secret.data);
    if (!verified.ok)
      return failure(
        request,
        verified.reason === "expired" ? "token_expired" : "token_invalid",
      );
    const { claims } = verified;

    const features = await resolveTenantFeatureStates(admin, claims.tenantId, [
      "ticketing.detail",
    ]);
    if (!features) return failure(request, "unavailable");
    if (features["ticketing.detail"] !== true)
      return failure(request, "ticket_not_available");

    const { data: ticketData, error: ticketError } = await admin
      .from("tickets")
      .select(
        "id, ticket_number, subject, requester_id, status:ticket_statuses!inner(key, is_closed)",
      )
      .eq("id", claims.ticketId)
      .eq("tenant_id", claims.tenantId)
      .is("deleted_at", null)
      .maybeSingle();
    if (ticketError) return failure(request, "unavailable");
    const ticket = ticketData as TicketRow | null;
    if (!ticket) return failure(request, "ticket_not_available");

    const { data: existing, error: existingError } = await admin
      .from("ticket_satisfaction")
      .select("score")
      .eq("ticket_id", ticket.id)
      .maybeSingle();
    if (existingError) return failure(request, "unavailable");

    const state = existing
      ? "rated"
      : ratable(ticket.status)
        ? "open"
        : "not_ratable";
    const summary = {
      score: claims.score,
      state,
      ticketNumber: ticket.ticket_number ?? null,
      subject: ticket.subject ?? null,
      existingScore:
        existing && typeof existing.score === "number" ? existing.score : null,
    };

    if (body.confirm !== true) return respond(request, { data: summary });
    if (state !== "open") return respond(request, { data: summary });

    let comment: string | null = null;
    if (typeof body.comment === "string") {
      const trimmed = body.comment.trim();
      if ([...trimmed].length > MAX_COMMENT || trimmed.includes("\u0000"))
        return failure(request, "comment_too_long");
      comment = trimmed || null;
    }
    // The page lets the person adjust the stars before confirming.
    const score =
      typeof body.score === "number" &&
      Number.isInteger(body.score) &&
      body.score >= 1 &&
      body.score <= 5
        ? body.score
        : claims.score;
    const { error: insertError } = await admin
      .from("ticket_satisfaction")
      .insert({
        ticket_id: ticket.id,
        score,
        comment,
        submitted_by: ticket.requester_id,
      });
    if (insertError) {
      // A parallel click already saved a rating.
      if (insertError.code === "23505")
        return respond(request, { data: { ...summary, state: "rated" } });
      return failure(request, "failed");
    }
    await admin.from("audit_logs").insert({
      tenant_id: claims.tenantId,
      actor_id: ticket.requester_id,
      action: "ticket.satisfaction.submitted",
      entity_type: "ticket_satisfaction",
      entity_id: ticket.id,
      severity: "info",
      before_data: null,
      after_data: { score },
      metadata: { hadComment: comment !== null, channel: "email" },
    });
    return respond(request, { data: { ...summary, score, state: "done" } });
  },
);

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }
    if (request.method !== "POST") {
      return new Response(null, {
        status: 405,
        headers: { ...corsHeaders(request), Allow: "POST, OPTIONS" },
      });
    }
    try {
      return await handler(request);
    } catch {
      return failure(request, "failed");
    }
  },
};
