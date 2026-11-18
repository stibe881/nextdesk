import { withSupabase } from "@supabase/server";
import { verifyNoticeLinkToken } from "../_shared/notice-link-token.ts";
import { APP_ORIGIN, noticeTargetUrl } from "../_shared/requester-notices.ts";

/**
 * Zählerlink der Hinweise in Ticket-Mails (öffentlich, verify_jwt = false):
 * GET ?t=<signierter Token> zählt einen Klick (nur Anzahl, keine Person) und
 * leitet auf das Ziel des Hinweises weiter. Bei ungültigem Token oder
 * unbekanntem Hinweis geht es auf die Startseite.
 */
function redirect(location: string): Response {
  return new Response(null, {
    status: 302,
    headers: {
      Location: location,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}

const handler = withSupabase(
  { auth: "none", cors: "disabled", errors: { detailed: false } },
  async (request, context) => {
    const admin = context.supabaseAdmin;
    const token = new URL(request.url).searchParams.get("t");
    try {
      const secret = await admin.rpc("ticket_requester_action_secret");
      if (secret.error || typeof secret.data !== "string") return redirect(APP_ORIGIN);
      const verified = await verifyNoticeLinkToken(token, secret.data);
      if (!verified.ok) return redirect(APP_ORIGIN);
      const { data: notice } = await admin
        .from("requester_notices")
        .select("id, link_kind, link_target")
        .eq("id", verified.claims.noticeId)
        .eq("tenant_id", verified.claims.tenantId)
        .maybeSingle();
      if (!notice) return redirect(APP_ORIGIN);
      const target = noticeTargetUrl(notice.link_kind, notice.link_target);
      if (!target) return redirect(APP_ORIGIN);
      await admin.rpc("requester_notice_count", {
        p_notice_id: notice.id,
        p_channel: "mail",
        p_event: "click",
      });
      return redirect(target);
    } catch {
      return redirect(APP_ORIGIN);
    }
  },
);

export default {
  fetch(request: Request): Response | Promise<Response> {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
    }
    return handler(request);
  },
};
