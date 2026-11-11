import { withSupabase, type SupabaseContext } from "@supabase/server";
import type { IntuneManagedDevice } from "../_shared/intune-managed-devices-graph.ts";
import {
  refreshIntuneDevices,
  toIntuneMacDevice,
} from "../_shared/ipam-integrations.ts";
import { verifyDispatchSecret } from "../_shared/monitoring-admin.ts";
import { HttpError, runIntuneAssetSync } from "../intune-asset-sync/runner.ts";

/**
 * Täglicher Intune-Abgleich (Cron «nextdesk-intune-scheduled-sync», 0314).
 *
 * Für jeden Mandanten mit aktiver Intune-Anbindung und eingerichtetem
 * Abgleich läuft derselbe Asset-Abgleich wie beim manuellen Start
 * (intune-asset-sync), im Namen einer Person mit asset.integration.manage.
 * Ist die IP-Adressverwaltung aktiv, liefert derselbe Graph-Abruf auch die
 * MAC-Adressen (ein gemeinsamer Geräteabruf statt zwei).
 *
 * Kein Benutzer-JWT: der Aufruf ist mit dem Dispatch-Geheimnis aus der
 * Datenbank geschützt (verify_jwt = false).
 */

type Row = Record<string, unknown>;
type AdminClient = SupabaseContext["supabaseAdmin"];

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ScheduledTarget = {
  tenantId: string;
  actorId: string | null;
  ipamEnabled: boolean;
};

export type TenantOutcome = {
  tenantId: string;
  status: "synchronized" | "reused" | "skipped" | "failed";
  code?: string;
  ipam?: string;
};

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function parseTargets(value: unknown): ScheduledTarget[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) =>
    typeof row === "object" && row !== null && isUuid((row as Row).tenant_id)
      ? [
          {
            tenantId: String((row as Row).tenant_id).toLowerCase(),
            actorId: isUuid((row as Row).actor_id)
              ? String((row as Row).actor_id).toLowerCase()
              : null,
            ipamEnabled: (row as Row).ipam_enabled === true,
          },
        ]
      : [],
  );
}

/**
 * Stabile Anfrage-ID pro Mandant und Tag (UUID-Form, Version 5): ein
 * zweiter Aufruf am selben Tag verwendet den bestehenden Lauf wieder.
 */
export async function dailyRequestId(
  tenantId: string,
  day: string,
): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(
        `nextdesk:intune-scheduled-sync:${tenantId}:${day}`,
      ),
    ),
  ).slice(0, 16);
  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = [...digest].map((byte) => byte.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join(""),
  ].join("-");
}

async function syncTenant(
  admin: AdminClient,
  target: ScheduledTarget,
  day: string,
): Promise<TenantOutcome> {
  if (!target.actorId) {
    return {
      tenantId: target.tenantId,
      status: "skipped",
      code: "no_integration_manager",
    };
  }
  const networkDevices: IntuneManagedDevice[] = [];
  try {
    const result = await runIntuneAssetSync(
      admin,
      target.actorId,
      {
        tenantId: target.tenantId,
        mode: "synchronize",
        clientRequestId: await dailyRequestId(target.tenantId, day),
        retryOfRunId: null,
      },
      {
        includeNetwork: target.ipamEnabled,
        onNetworkDevices: (devices) => networkDevices.push(...devices),
      },
    );
    if (result.reused) {
      return { tenantId: target.tenantId, status: "reused" };
    }
    const outcome: TenantOutcome = {
      tenantId: target.tenantId,
      status: "synchronized",
    };
    if (target.ipamEnabled) {
      // Dieselben Geräte für den MAC-Abgleich speichern (kein zweiter Abruf).
      const refreshed = await refreshIntuneDevices(
        admin,
        target.tenantId,
        null,
        "cron",
        fetch,
        { devices: networkDevices.map(toIntuneMacDevice) },
      );
      outcome.ipam = refreshed.status;
      if (refreshed.status === "ok") {
        await admin.rpc("ipam_reconcile_intune", {
          p_tenant_id: target.tenantId,
          p_actor_id: null,
          p_trigger: "cron",
        });
      }
    }
    return outcome;
  } catch (error) {
    return {
      tenantId: target.tenantId,
      status: "failed",
      code: error instanceof HttpError ? error.code : "intune_sync_failed",
    };
  }
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
    const { data, error } = await admin.rpc("intune_scheduled_sync_targets");
    if (error) return new Response(null, { status: 503 });
    const day = new Date().toISOString().slice(0, 10);
    const outcomes: TenantOutcome[] = [];
    for (const target of parseTargets(data)) {
      outcomes.push(await syncTenant(admin, target, day));
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
