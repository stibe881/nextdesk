import { withSupabase } from "@supabase/server";
import { runTeamsLifecycle } from "../_shared/teams-lifecycle.ts";
import { verifyDispatchSecret } from "../_shared/monitoring-admin.ts";

/**
 * Cron «nextdesk-teams-lifecycle» (0318, alle 5 Minuten, nur bei Arbeit):
 * Teams anlegen und fertigstellen, Owner 14/7/1 Tage vor dem Ende erinnern und
 * abgelaufene Teams archivieren. Kein Benutzer-JWT; geschützt mit dem
 * Dispatch-Geheimnis aus der Datenbank (verify_jwt = false).
 */
const handler = withSupabase(
  { auth: "none", cors: "disabled", errors: { detailed: false } },
  async (request, context) => {
    const admin = context.supabaseAdmin;
    if (
      request.method !== "POST" ||
      !(await verifyDispatchSecret(admin, request))
    ) {
      return new Response(null, { status: 401 });
    }
    try {
      const summary = await runTeamsLifecycle(admin);
      return new Response(JSON.stringify({ data: summary }), {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        },
      });
    } catch {
      return new Response(null, { status: 503 });
    }
  },
);

export default {
  fetch(request: Request): Response | Promise<Response> {
    if (request.method !== "POST") {
      return new Response(null, { status: 405, headers: { Allow: "POST" } });
    }
    return handler(request);
  },
};
