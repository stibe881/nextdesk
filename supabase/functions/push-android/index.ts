import { withSupabase } from "@supabase/server";
import { resolveTenantFeatureStates } from "../_shared/tenant-features.ts";

/**
 * Registrierung eines Android-Geräts für Push-Mitteilungen (Expo-Push-Token).
 * Aktionen (POST, JWT):
 *   register   { tenantId, token, deviceName?, appVersion? }
 *   unregister { tenantId, token }
 * iPhone-Geräte werden weiter über «push-notifications» registriert.
 */

const APP_ORIGIN = "https://app.nextdesk.ch";
const FEATURE = "notifications.push";
const TOKEN = /^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{10,200}\]$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Row = Record<string, unknown>;

function headers(request: Request): HeadersInit {
  const origin = request.headers.get("origin");
  return {
    "Access-Control-Allow-Origin": origin === APP_ORIGIN ? APP_ORIGIN : "",
    "Access-Control-Allow-Headers":
      "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    Vary: "Origin",
  };
}

const json = (request: Request, body: Row, status = 200) =>
  new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: headers(request),
  });
const fail = (request: Request, code: string, status = 422) =>
  json(request, { error: { code } }, status);
const isRecord = (value: unknown): value is Row =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function shortText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim().slice(0, max);
  return text || null;
}

const handler = withSupabase({ auth: "user" }, async (request, context) => {
  if (request.method !== "POST")
    return fail(request, "method_not_allowed", 405);
  const body: unknown = await request.json().catch(() => null);
  const actorId = context.userClaims?.id;
  if (
    !isRecord(body) ||
    (body.type !== "register" && body.type !== "unregister") ||
    typeof body.tenantId !== "string" ||
    !UUID.test(body.tenantId) ||
    typeof body.token !== "string" ||
    !TOKEN.test(body.token) ||
    typeof actorId !== "string" ||
    !UUID.test(actorId)
  ) {
    return fail(request, "invalid_request", 400);
  }
  const admin = context.supabaseAdmin;
  const tenantId = body.tenantId.toLowerCase();

  if (body.type === "unregister") {
    await admin
      .from("push_android_devices")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("user_id", actorId)
      .eq("expo_token", body.token);
    return json(request, { data: { ok: true } });
  }

  const { data: membership } = await admin
    .from("tenant_memberships")
    .select("user_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", actorId)
    .eq("status", "active")
    .maybeSingle();
  if (!membership) return fail(request, "tenant_membership_required", 403);
  const features = await resolveTenantFeatureStates(admin, tenantId, [FEATURE]);
  if (!features) return fail(request, "push_unavailable", 503);
  if (features[FEATURE] !== true)
    return fail(request, "push_feature_disabled", 409);

  const { error } = await admin.from("push_android_devices").upsert(
    {
      tenant_id: tenantId,
      user_id: actorId,
      expo_token: body.token,
      device_name: shortText(body.deviceName, 80),
      app_version: shortText(body.appVersion, 80),
      enabled: true,
      disabled_reason: null,
      last_registered_at: new Date().toISOString(),
    },
    { onConflict: "expo_token" },
  );
  if (error) return fail(request, "register_failed", 500);
  return json(request, { data: { ok: true } });
});

export default {
  fetch(request: Request): Response | Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: headers(request) });
    }
    return handler(request);
  },
};
