import { withSupabase } from "@supabase/server";
import {
  buildBroadcastPayload,
  isApnsConfigured,
  sendApns,
} from "../_shared/apns.ts";
import { sendExpoPush, type ExpoMessage } from "../_shared/expo-push.ts";
import {
  type Audience,
  parseAudience,
  resolveAudienceUsers,
} from "../_shared/push-audience.ts";
import { resolveTenantFeatureStates } from "../_shared/tenant-features.ts";

/**
 * Push-Mitteilungen, die Administratoren selbst verfassen (Einstellungen →
 * Funktionen → Push-Benachrichtigungen). Nur Mandanten-Administration.
 * Aktionen (POST, JWT):
 *   getContext                       -> Abteilungen, Rollen, Geräte, Apple-Versand bereit?
 *   preview { audience }             -> Zahl der Personen und Geräte
 *   send { title, body, audience }   -> versendet an iPhone (Apple) und Android (Expo)
 *   list                             -> Verlauf
 */

const APP_ORIGIN = "https://app.nextdesk.ch";
const FEATURE = "notifications.push";
const TITLE_MAX = 60;
const BODY_MAX = 200;
const MIN_SECONDS_BETWEEN_SENDS = 15;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// deno-lint-ignore no-explicit-any
type Admin = any;
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

async function isTenantAdministrator(
  admin: Admin,
  actorId: string,
  tenantId: string,
): Promise<boolean> {
  const { data: role } = await admin
    .from("roles")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("name", "Tenant administrator")
    .eq("scope", "tenant")
    .eq("active", true)
    .maybeSingle();
  if (!role?.id) return false;
  const now = new Date().toISOString();
  const { data: assignment } = await admin
    .from("user_role_assignments")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("user_id", actorId)
    .eq("role_id", role.id)
    .lte("starts_at", now)
    .or(`expires_at.is.null,expires_at.gt.${now}`)
    .maybeSingle();
  return Boolean(assignment);
}

type IosDevice = {
  id: string;
  user_id: string;
  apns_token: string;
  apns_environment: "production" | "development";
};
type AndroidDevice = { id: string; user_id: string; expo_token: string };

async function devicesFor(
  admin: Admin,
  tenantId: string,
  userIds: string[],
): Promise<{ ios: IosDevice[]; android: AndroidDevice[] }> {
  if (userIds.length === 0) return { ios: [], android: [] };
  const ios: IosDevice[] = [];
  const android: AndroidDevice[] = [];
  // In Paketen, damit die Abfrage bei grossen Mandanten nicht zu lang wird.
  for (let index = 0; index < userIds.length; index += 200) {
    const slice = userIds.slice(index, index + 200);
    const [iosRows, androidRows] = await Promise.all([
      admin
        .from("push_devices")
        .select("id, user_id, apns_token, apns_environment")
        .eq("tenant_id", tenantId)
        .eq("enabled", true)
        .in("user_id", slice),
      admin
        .from("push_android_devices")
        .select("id, user_id, expo_token")
        .eq("tenant_id", tenantId)
        .eq("enabled", true)
        .in("user_id", slice),
    ]);
    ios.push(...((iosRows.data ?? []) as IosDevice[]));
    android.push(...((androidRows.data ?? []) as AndroidDevice[]));
  }
  return { ios, android };
}

async function reach(admin: Admin, tenantId: string, audience: Audience) {
  const users = await resolveAudienceUsers(admin, tenantId, audience);
  const devices = await devicesFor(admin, tenantId, users);
  const reachable = new Set([
    ...devices.ios.map((device) => device.user_id),
    ...devices.android.map((device) => device.user_id),
  ]);
  return {
    users,
    devices,
    summary: {
      people: users.length,
      peopleReachable: reachable.size,
      iosDevices: devices.ios.length,
      androidDevices: devices.android.length,
    },
  };
}

function cleanText(value: unknown, max: number): string {
  return typeof value === "string"
    ? [...value.replace(/\s+/g, " ").trim()].slice(0, max).join("")
    : "";
}

const handler = withSupabase({ auth: "user" }, async (request, context) => {
  if (request.method !== "POST")
    return fail(request, "method_not_allowed", 405);
  const body: unknown = await request.json().catch(() => null);
  const actorId = context.userClaims?.id;
  if (
    !isRecord(body) ||
    typeof body.type !== "string" ||
    typeof body.tenantId !== "string" ||
    !UUID.test(body.tenantId) ||
    typeof actorId !== "string" ||
    !UUID.test(actorId)
  ) {
    return fail(request, "invalid_request", 400);
  }
  const admin = context.supabaseAdmin;
  const tenantId = body.tenantId.toLowerCase();
  if (!(await isTenantAdministrator(admin, actorId, tenantId))) {
    return fail(request, "tenant_admin_required", 403);
  }
  const features = await resolveTenantFeatureStates(admin, tenantId, [FEATURE]);
  if (!features) return fail(request, "push_unavailable", 503);
  if (features[FEATURE] !== true)
    return fail(request, "push_feature_disabled", 409);

  if (body.type === "getContext") {
    const [
      { data: departments },
      { data: roles },
      { count: iosCount },
      { count: androidCount },
    ] = await Promise.all([
      admin
        .from("departments")
        .select("id, name")
        .eq("tenant_id", tenantId)
        .eq("active", true)
        .order("name"),
      admin
        .from("roles")
        .select("id, name")
        .eq("tenant_id", tenantId)
        .eq("active", true)
        .order("name"),
      admin
        .from("push_devices")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("enabled", true),
      admin
        .from("push_android_devices")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("enabled", true),
    ]);
    return json(request, {
      data: {
        departments: departments ?? [],
        roles: roles ?? [],
        iosDevices: iosCount ?? 0,
        androidDevices: androidCount ?? 0,
        apnsConfigured: isApnsConfigured(),
        limits: { title: TITLE_MAX, body: BODY_MAX },
      },
    });
  }

  if (body.type === "list") {
    const { data: rows } = await admin
      .from("push_broadcasts")
      .select(
        "id, title, body, audience_kind, audience_ids, status, recipient_count, ios_devices, android_devices, delivered_count, failed_count, created_at, created_by",
      )
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(30);
    const list = (rows ?? []) as Row[];
    const creatorIds = [
      ...new Set(
        list
          .map((row) => row.created_by)
          .filter((id): id is string => typeof id === "string"),
      ),
    ];
    const names = new Map<string, string>();
    if (creatorIds.length > 0) {
      const { data: profiles } = await admin
        .from("user_profiles")
        .select("id, display_name")
        .in("id", creatorIds);
      for (const profile of (profiles ?? []) as Row[]) {
        names.set(String(profile.id), String(profile.display_name ?? ""));
      }
    }
    return json(request, {
      data: {
        broadcasts: list.map((row) => ({
          id: row.id,
          title: row.title,
          body: row.body,
          audienceKind: row.audience_kind,
          audienceCount: Array.isArray(row.audience_ids)
            ? row.audience_ids.length
            : 0,
          status: row.status,
          people: row.recipient_count,
          iosDevices: row.ios_devices,
          androidDevices: row.android_devices,
          delivered: row.delivered_count,
          failed: row.failed_count,
          createdAt: row.created_at,
          createdBy:
            typeof row.created_by === "string"
              ? (names.get(row.created_by) ?? null)
              : null,
        })),
      },
    });
  }

  const audience = parseAudience(body.audience);
  if (!audience) return fail(request, "audience_invalid", 400);

  if (body.type === "preview") {
    const { summary } = await reach(admin, tenantId, audience);
    return json(request, { data: summary });
  }

  if (body.type === "send") {
    const title = cleanText(body.title, TITLE_MAX);
    const text = cleanText(body.body, BODY_MAX);
    if (!title) return fail(request, "title_invalid", 400);
    if (!text) return fail(request, "body_invalid", 400);

    // Schutz vor doppeltem Absenden (Doppelklick, erneutes Laden).
    const since = new Date(
      Date.now() - MIN_SECONDS_BETWEEN_SENDS * 1000,
    ).toISOString();
    const { data: recent } = await admin
      .from("push_broadcasts")
      .select("id")
      .eq("tenant_id", tenantId)
      .gte("created_at", since)
      .limit(1);
    if ((recent ?? []).length > 0) return fail(request, "too_fast", 429);

    const { users, devices, summary } = await reach(admin, tenantId, audience);
    if (summary.iosDevices + summary.androidDevices === 0) {
      return fail(request, "no_devices", 409);
    }
    const { data: created, error: createError } = await admin
      .from("push_broadcasts")
      .insert({
        tenant_id: tenantId,
        created_by: actorId,
        title,
        body: text,
        audience_kind: audience.kind,
        audience_ids: audience.ids,
        status: "sending",
        recipient_count: users.length,
        ios_devices: summary.iosDevices,
        android_devices: summary.androidDevices,
      })
      .select("id")
      .single();
    if (createError || !created) return fail(request, "broadcast_failed", 500);
    const broadcastId = String(created.id);

    let delivered = 0;
    let failed = 0;
    const iosInvalid: string[] = [];
    const androidInvalid: string[] = [];

    // iPhone: direkt über Apple.
    const payload = buildBroadcastPayload({
      title,
      body: text,
      tenantId,
      broadcastId,
    });
    for (let index = 0; index < devices.ios.length; index += 20) {
      const batch = devices.ios.slice(index, index + 20);
      const results = await Promise.all(
        batch.map((device) =>
          sendApns(
            device.apns_token,
            device.apns_environment,
            payload,
            broadcastId,
          ),
        ),
      );
      results.forEach((result, position) => {
        if (result.status === 200) {
          delivered += 1;
        } else {
          failed += 1;
          const invalid =
            result.status === 410 ||
            (result.status === 400 &&
              [
                "BadDeviceToken",
                "DeviceTokenNotForTopic",
                "Unregistered",
              ].includes(result.reason ?? ""));
          if (invalid) iosInvalid.push(batch[position]!.id);
        }
      });
    }

    // Android: über den Expo-Push-Dienst.
    const messages: ExpoMessage[] = devices.android.map((device) => ({
      to: device.expo_token,
      title,
      body: text,
      data: { kind: "broadcast", tenantId, notificationId: broadcastId },
    }));
    const expoResults = await sendExpoPush(messages);
    const byToken = new Map(
      devices.android.map((device) => [device.expo_token, device.id]),
    );
    for (const result of expoResults) {
      if (result.ok) {
        delivered += 1;
      } else {
        failed += 1;
        if (result.error === "DeviceNotRegistered") {
          const id = byToken.get(result.to);
          if (id) androidInvalid.push(id);
        }
      }
    }

    if (iosInvalid.length > 0) {
      await admin
        .from("push_devices")
        .update({ enabled: false, disabled_reason: "apns_unregistered" })
        .in("id", iosInvalid);
    }
    if (androidInvalid.length > 0) {
      await admin
        .from("push_android_devices")
        .update({ enabled: false, disabled_reason: "expo_unregistered" })
        .in("id", androidInvalid);
    }
    await admin
      .from("push_broadcasts")
      .update({
        status: delivered > 0 ? "sent" : "failed",
        delivered_count: delivered,
        failed_count: failed,
        sent_at: new Date().toISOString(),
      })
      .eq("id", broadcastId);
    await admin.from("audit_logs").insert({
      tenant_id: tenantId,
      actor_id: actorId,
      action: "push.broadcast.sent",
      entity_type: "push_broadcast",
      entity_id: broadcastId,
      severity: "info",
      before_data: null,
      after_data: null,
      metadata: {
        audience: audience.kind,
        audienceCount: audience.ids.length,
        delivered,
        failed,
      },
    });
    return json(request, {
      data: { id: broadcastId, delivered, failed, ...summary },
    });
  }

  return fail(request, "invalid_request", 400);
});

export default {
  fetch(request: Request): Response | Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: headers(request) });
    }
    return handler(request);
  },
};
