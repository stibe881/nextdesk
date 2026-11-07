import { withSupabase } from "@supabase/server";
import { corsHeaders, isRecord } from "../_shared/http.ts";
import { verifyRequesterActionToken } from "../_shared/requester-action-token.ts";
import { reminderActionError } from "./logic.ts";

// Public endpoint (verify_jwt = false) for the one-click links in reminder
// e-mails. The caller is identified only by the signed, single-use token;
// the web page /#ticket-aktion=… first asks for a preview, then confirms.
//   POST { token }                     -> preview (changes nothing)
//   POST { token, confirm: true, message? } -> answers the reminder
const MAX_BYTES = 16 * 1024;

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
  const error = reminderActionError(code);
  return respond(
    request,
    { error: { code: error.code, message: error.message } },
    error.status,
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
    const verified = await verifyRequesterActionToken(body.token, secret.data);
    if (!verified.ok)
      return failure(
        request,
        verified.reason === "expired" ? "token_expired" : "token_invalid",
      );
    const { claims } = verified;

    if (body.confirm !== true) {
      const preview = await admin.rpc("ticket_requester_reminder_preview", {
        p_reminder_id: claims.reminderId,
        p_ticket_id: claims.ticketId,
      });
      if (preview.error || !isRecord(preview.data))
        return failure(request, "unavailable");
      if (preview.data.state === "invalid")
        return failure(request, "token_invalid");
      return respond(request, {
        data: {
          action: claims.action,
          state: preview.data.state,
          ticketNumber: preview.data.ticketNumber ?? null,
          subject: preview.data.subject ?? null,
          usedAction: preview.data.usedAction ?? null,
        },
      });
    }

    let message: string | null = null;
    if (claims.action === "need_help" && typeof body.message === "string") {
      const trimmed = body.message.trim();
      if (trimmed.length > 5000 || trimmed.includes("\u0000"))
        return failure(request, "message_too_long");
      message = trimmed || null;
    }
    const result = await admin.rpc("ticket_requester_respond", {
      p_tenant_id: claims.tenantId,
      p_ticket_id: claims.ticketId,
      p_actor_id: null,
      p_response: claims.action,
      p_channel: "email",
      p_reminder_id: claims.reminderId,
      p_message: message,
    });
    if (result.error) {
      const hint = typeof (result.error as { hint?: unknown }).hint === "string"
        ? (result.error as { hint: string }).hint
        : "";
      return failure(
        request,
        hint || (result.error.code === "23514" ? "status_rule" : "failed"),
      );
    }
    return respond(request, {
      data: {
        action: claims.action,
        state: "done",
        ticketNumber: isRecord(result.data) ? result.data.ticketNumber : null,
      },
    });
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
