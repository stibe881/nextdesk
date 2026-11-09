import { withSupabase } from "@supabase/server";
import { corsHeaders, isRecord, isUuid } from "../_shared/http.ts";

// Public endpoint (verify_jwt = false) for the «did you click?» question of a
// security case. The page /#sicherheit-antwort=<token> first asks for a
// preview (changes nothing, so mail scanners opening the link do no harm),
// then sends the answer the person chose:
//   POST { token }                      -> preview
//   POST { token, answer: "yes" | "no" } -> stores the answer (once)
// deno-lint-ignore no-explicit-any
type Admin = any;
type Row = Record<string, unknown>;
const MAX_BYTES = 4 * 1024;

function respond(request: Request, body: Record<string, unknown>, status = 200): Response {
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

function failure(request: Request, code: string, status: number): Response {
  const messages: Record<string, string> = {
    invalid_request: "Der Link ist ungültig.",
    token_invalid: "Der Link ist ungültig oder abgelaufen.",
    unavailable: "Die Antwort kann gerade nicht gespeichert werden. Bitte versuchen Sie es später erneut.",
  };
  return respond(request, { error: { code, message: messages[code] ?? messages.unavailable } }, status);
}

async function preview(admin: Admin, question: Row) {
  const report = await admin.from("phishing_reports").select("original_subject")
    .eq("ticket_id", question.ticket_id).order("created_at").limit(1).maybeSingle();
  return {
    state: question.answer ? "answered" : "open",
    answer: question.answer ?? null,
    subject: typeof report.data?.original_subject === "string" ? report.data.original_subject : null,
  };
}

const handler = withSupabase(
  { auth: "none", cors: "disabled", errors: { detailed: false } },
  async (request, context) => {
    const admin = context.supabaseAdmin;
    const text = await request.text().catch(() => "");
    if (text.length > MAX_BYTES) return failure(request, "invalid_request", 400);
    let body: unknown = null;
    try {
      body = JSON.parse(text);
    } catch {
      return failure(request, "invalid_request", 400);
    }
    if (!isRecord(body) || !isUuid(body.token)) return failure(request, "token_invalid", 404);
    const found = await admin.from("security_click_questions")
      .select("id, tenant_id, ticket_id, email, answer, created_at")
      .eq("token", body.token).maybeSingle();
    if (found.error) return failure(request, "unavailable", 503);
    const question = found.data as Row | null;
    // Links expire after 30 days.
    if (!question || Date.parse(String(question.created_at)) < Date.now() - 30 * 24 * 60 * 60_000) {
      return failure(request, "token_invalid", 404);
    }
    if (body.answer === undefined) {
      return respond(request, { data: await preview(admin, question) });
    }
    if (body.answer !== "yes" && body.answer !== "no") return failure(request, "invalid_request", 400);
    if (!question.answer) {
      const updated = await admin.from("security_click_questions")
        .update({ answer: body.answer, answered_at: new Date().toISOString() })
        .eq("id", question.id).is("answer", null).select("id");
      if (updated.error) return failure(request, "unavailable", 503);
      if (updated.data?.length) {
        const clicked = body.answer === "yes";
        const service = await admin.rpc("exchange_mail_get_service_identity").then(
          (result: { data: unknown }) => typeof result.data === "string" ? result.data : null,
          () => null,
        );
        const author = service ?? null;
        if (author) {
          await admin.from("ticket_comments").insert({
            ticket_id: question.ticket_id,
            author_id: author,
            visibility: "internal",
            body: clicked
              ? `⚠ ${question.email} hat angegeben, einen Link oder Anhang geöffnet oder Daten eingegeben zu haben. Bitte Passwort zurücksetzen und Anmeldungen prüfen.`
              : `${question.email} hat angegeben, nichts geöffnet oder eingegeben zu haben.`,
          });
        }
        await admin.from("ticket_events").insert({
          ticket_id: question.ticket_id,
          actor_id: author,
          event_type: "ticket.security_click_answer",
          payload: { answer: body.answer },
        });
        if (clicked) {
          // Someone clicked: the security team is alerted again.
          await admin.rpc("phishing_report_notify", {
            p_tenant_id: question.tenant_id,
            p_ticket_id: question.ticket_id,
            p_payload: {
              event: "clicked",
              reporterEmail: question.email,
              riskLevel: "high",
              riskLabel: "Melder hat geklickt",
            },
          }).then(() => undefined, () => undefined);
        }
      }
    }
    const fresh = await admin.from("security_click_questions")
      .select("ticket_id, answer").eq("id", question.id).maybeSingle();
    return respond(request, { data: await preview(admin, { ...question, ...(fresh.data ?? {}) }) });
  },
);

export default {
  fetch(request: Request): Response | Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }
    if (request.method !== "POST") return respond(request, { error: { code: "method_not_allowed" } }, 405);
    return handler(request);
  },
};
