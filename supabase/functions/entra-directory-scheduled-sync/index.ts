import { withSupabase } from "@supabase/server";
import { verifyDispatchSecret } from "../_shared/monitoring-admin.ts";
import { runDirectorySync } from "../entra-directory-sync/index.ts";

/**
 * Nächtlicher Abgleich des Entra-Verzeichnisses (Cron
 * «nextdesk-entra-directory-sync», 0372).
 *
 * Für jeden Mandanten mit aktivem, gespeichertem Connector läuft derselbe
 * Abgleich wie beim manuellen Start, im Namen einer Person mit
 * «Mandanteneinstellungen verwalten». Der Lauf erscheint in der Historie als
 * automatischer Abgleich.
 *
 * Kein Benutzer-JWT: der Aufruf ist mit dem Dispatch-Geheimnis aus der
 * Datenbank geschützt (verify_jwt = false).
 */

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Target = { tenantId: string; actorId: string };

export function parseTargets(value: unknown): Target[] {
  if (!Array.isArray(value)) return [];
  const targets: Target[] = [];
  for (const row of value) {
    if (typeof row !== "object" || row === null) continue;
    const record = row as Record<string, unknown>;
    const tenantId = record.tenant_id;
    const actorId = record.actor_id;
    if (
      typeof tenantId === "string" &&
      UUID_PATTERN.test(tenantId) &&
      typeof actorId === "string" &&
      UUID_PATTERN.test(actorId)
    ) {
      targets.push({ tenantId, actorId });
    }
  }
  return targets;
}

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
    const { data, error } = await admin.rpc(
      "entra_directory_scheduled_sync_targets",
    );
    if (error) return new Response(null, { status: 503 });
    const outcomes: { tenantId: string; status: string; code?: string }[] = [];
    for (const target of parseTargets(data)) {
      try {
        const result = await runDirectorySync(
          admin,
          target.actorId,
          target.tenantId,
          "scheduled",
        );
        outcomes.push(
          result.ok
            ? { tenantId: target.tenantId, status: "synchronized" }
            : {
                tenantId: target.tenantId,
                status: "failed",
                code: result.code,
              },
        );
      } catch {
        outcomes.push({
          tenantId: target.tenantId,
          status: "failed",
          code: "directory_sync_failed",
        });
      }
    }
    return new Response(
      JSON.stringify({
        data: {
          tenants: outcomes.length,
          synchronized: outcomes.filter((row) => row.status === "synchronized")
            .length,
          failed: outcomes.filter((row) => row.status === "failed").length,
          outcomes,
        },
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        },
      },
    );
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
