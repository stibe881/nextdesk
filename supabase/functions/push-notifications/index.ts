import { type SupabaseContext, withSupabase } from "@supabase/server";
import {
  buildApnsPayload,
  isApnsConfigured,
  sendApns,
} from "../_shared/apns.ts";
import { resolveTenantFeatureStates } from "../_shared/tenant-features.ts";

const ALLOWED_ORIGIN = "https://app.nextdesk.ch";
const FEATURE = "notifications.push";
const ALL_CATEGORIES = [
  "assigned",
  "requester_reply",
  "support_reply",
  "mention",
  "resolved",
  "sla",
  "escalation",
  "approval",
  "follow_up",
] as const;
const AGENT_CATEGORIES = [
  "assigned",
  "requester_reply",
  "mention",
  "sla",
  "escalation",
  "approval",
  "follow_up",
] as const;
const REQUESTER_CATEGORIES = ["support_reply", "resolved", "approval"] as const;

type Category = (typeof ALL_CATEGORIES)[number];
type Row = Record<string, unknown>;
type Client = SupabaseContext["supabase"];
type Admin = SupabaseContext["supabaseAdmin"];
type Environment = "production" | "development";

type Action =
  | { type: "getStatus"; tenantId: string }
  | {
      type: "registerDevice";
      tenantId: string;
      token: string;
      environment: Environment;
      appVersion?: string;
      appBuild?: string;
      deviceName?: string;
    }
  | {
      type: "unregisterDevice";
      tenantId: string;
      token?: string;
      deviceId?: string;
    }
  | {
      type: "updatePreferences";
      tenantId: string;
      enabledCategories: Category[];
      quietHoursEnabled: boolean;
      quietStart: number;
      quietEnd: number;
      timezone: string;
    }
  | { type: "sendTest"; tenantId: string }
  | { type: "checkIn"; tenantId: string }
  | { type: "checkOut"; tenantId: string }
  | { type: "declineCheckIn"; tenantId: string }
  | { type: "getTenantSettings"; tenantId: string }
  | {
      type: "updateTenantSettings";
      tenantId: string;
      contentLevel: "minimal" | "subject";
      checkInRequired?: boolean;
      workStartHour?: number;
      workEndHour?: number;
    };

type PreferenceRow = {
  enabled_categories: string[];
  quiet_hours_enabled: boolean;
  quiet_start: number;
  quiet_end: number;
  timezone: string;
  last_test_at: string | null;
};

type DeviceRow = {
  id: string;
  apns_token?: string;
  apns_environment?: Environment;
  device_name: string | null;
  app_version: string | null;
  app_build: string | null;
  enabled: boolean;
  disabled_reason: string | null;
  last_registered_at: string;
  last_sent_at: string | null;
};

type WorkHours = {
  required: boolean;
  startHour: number;
  endHour: number;
  timezone: string;
  localDate: string;
  withinWindow: boolean;
  checkedIn: boolean;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  declinedAt: string | null;
  active: boolean;
  promptDue: boolean;
};

type WorkHoursState = Omit<WorkHours, "promptDue">;
type WorkHoursSettings = Pick<WorkHours, "required" | "startHour" | "endHour">;
type FeatureConfiguration = {
  featureEnabled: boolean;
  contentLevel: "minimal" | "subject";
  configuration: Row;
};

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

function isRecord(value: unknown): value is Row {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Row, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function hasOwn(value: Row, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      value,
    )
  );
}

function cleanText(value: unknown, max: number): string | null {
  if (
    typeof value !== "string" ||
    value.includes("\u0000") ||
    !value.isWellFormed()
  ) {
    return null;
  }
  const cleaned = value.trim();
  return Array.from(cleaned).length >= 1 && Array.from(cleaned).length <= max
    ? cleaned
    : null;
}

function parseOptionalText(
  value: Row,
  key: "appVersion" | "appBuild" | "deviceName",
): string | undefined | null {
  if (!hasOwn(value, key)) return undefined;
  return cleanText(value[key], 80);
}

function isToken(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64,200}$/iu.test(value);
}

function isHour(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 23
  );
}

function isWorkStartHour(value: unknown): value is number {
  return isHour(value);
}

function isWorkEndHour(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 24
  );
}

function isTimezone(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 1 || value.length > 80) {
    return false;
  }
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function isCategories(value: unknown): value is Category[] {
  return (
    Array.isArray(value) &&
    value.length <= ALL_CATEGORIES.length &&
    value.every(
      (category) =>
        typeof category === "string" &&
        (ALL_CATEGORIES as readonly string[]).includes(category),
    ) &&
    new Set(value).size === value.length
  );
}

function parseAction(value: unknown): Action | null {
  if (
    !isRecord(value) ||
    typeof value.type !== "string" ||
    !isUuid(value.tenantId)
  ) {
    return null;
  }
  const tenantId = value.tenantId.toLowerCase();

  if (
    ["getStatus", "sendTest", "getTenantSettings"].includes(value.type) &&
    hasOnlyKeys(value, ["type", "tenantId"])
  ) {
    return {
      type: value.type as "getStatus" | "sendTest" | "getTenantSettings",
      tenantId,
    };
  }
  if (
    value.type === "registerDevice" &&
    hasOnlyKeys(value, [
      "type",
      "tenantId",
      "token",
      "environment",
      "appVersion",
      "appBuild",
      "deviceName",
    ]) &&
    isToken(value.token) &&
    (value.environment === "production" || value.environment === "development")
  ) {
    const appVersion = parseOptionalText(value, "appVersion");
    const appBuild = parseOptionalText(value, "appBuild");
    const deviceName = parseOptionalText(value, "deviceName");
    if (appVersion === null || appBuild === null || deviceName === null) {
      return null;
    }
    return {
      type: "registerDevice",
      tenantId,
      token: value.token.toLowerCase(),
      environment: value.environment,
      ...(appVersion !== undefined ? { appVersion } : {}),
      ...(appBuild !== undefined ? { appBuild } : {}),
      ...(deviceName !== undefined ? { deviceName } : {}),
    };
  }
  if (
    value.type === "unregisterDevice" &&
    hasOnlyKeys(value, ["type", "tenantId", "token", "deviceId"])
  ) {
    const hasToken = hasOwn(value, "token") && isToken(value.token);
    const hasDeviceId = hasOwn(value, "deviceId") && isUuid(value.deviceId);
    if (hasToken === hasDeviceId) return null;
    return {
      type: "unregisterDevice",
      tenantId,
      ...(hasToken ? { token: (value.token as string).toLowerCase() } : {}),
      ...(hasDeviceId ? { deviceId: value.deviceId as string } : {}),
    };
  }
  if (
    value.type === "updatePreferences" &&
    hasOnlyKeys(value, [
      "type",
      "tenantId",
      "enabledCategories",
      "quietHoursEnabled",
      "quietStart",
      "quietEnd",
      "timezone",
    ]) &&
    isCategories(value.enabledCategories) &&
    typeof value.quietHoursEnabled === "boolean" &&
    isHour(value.quietStart) &&
    isHour(value.quietEnd) &&
    isTimezone(value.timezone)
  ) {
    return {
      type: "updatePreferences",
      tenantId,
      enabledCategories: value.enabledCategories,
      quietHoursEnabled: value.quietHoursEnabled,
      quietStart: value.quietStart,
      quietEnd: value.quietEnd,
      timezone: value.timezone,
    };
  }
  if (
    ["checkIn", "checkOut", "declineCheckIn"].includes(value.type) &&
    hasOnlyKeys(value, ["type", "tenantId"])
  ) {
    return {
      type: value.type as "checkIn" | "checkOut" | "declineCheckIn",
      tenantId,
    };
  }
  if (
    value.type === "updateTenantSettings" &&
    hasOnlyKeys(value, [
      "type",
      "tenantId",
      "contentLevel",
      "checkInRequired",
      "workStartHour",
      "workEndHour",
    ]) &&
    (value.contentLevel === "minimal" || value.contentLevel === "subject") &&
    (!hasOwn(value, "checkInRequired") ||
      typeof value.checkInRequired === "boolean") &&
    (!hasOwn(value, "workStartHour") || isWorkStartHour(value.workStartHour)) &&
    (!hasOwn(value, "workEndHour") || isWorkEndHour(value.workEndHour))
  ) {
    return {
      type: "updateTenantSettings",
      tenantId,
      contentLevel: value.contentLevel,
      ...(hasOwn(value, "checkInRequired")
        ? { checkInRequired: value.checkInRequired as boolean }
        : {}),
      ...(hasOwn(value, "workStartHour")
        ? { workStartHour: value.workStartHour as number }
        : {}),
      ...(hasOwn(value, "workEndHour")
        ? { workEndHour: value.workEndHour as number }
        : {}),
    };
  }
  return null;
}

function headers(request: Request): Headers {
  const origin = request.headers.get("origin");
  const result = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    Vary: "Origin",
  });
  if (origin === ALLOWED_ORIGIN) {
    result.set("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
    result.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    result.set(
      "Access-Control-Allow-Headers",
      "authorization, apikey, content-type, x-client-info",
    );
  }
  return result;
}

function reply(request: Request, body: Row, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: headers(request),
  });
}

function fail(request: Request, error: unknown): Response {
  const safe =
    error instanceof HttpError ? error : new HttpError(500, "operation_failed");
  return reply(request, { error: { code: safe.code } }, safe.status);
}

function defaultPreferences() {
  return {
    enabledCategories: [...ALL_CATEGORIES],
    quietHoursEnabled: false,
    quietStart: 22,
    quietEnd: 7,
    timezone: "Europe/Zurich",
  };
}

function preferencesForResponse(row: PreferenceRow | null) {
  if (!row) return defaultPreferences();
  return {
    enabledCategories: row.enabled_categories,
    quietHoursEnabled: row.quiet_hours_enabled,
    quietStart: row.quiet_start,
    quietEnd: row.quiet_end,
    timezone: row.timezone,
  };
}

function deviceForResponse(row: DeviceRow) {
  return {
    id: row.id,
    deviceName: row.device_name,
    appVersion: row.app_version,
    appBuild: row.app_build,
    enabled: row.enabled,
    disabledReason: row.disabled_reason,
    lastRegisteredAt: row.last_registered_at,
    lastSentAt: row.last_sent_at,
  };
}

async function requireMembership(
  admin: Admin,
  tenantId: string,
  userId: string,
): Promise<void> {
  const { data, error } = await admin
    .from("tenant_memberships")
    .select("tenant_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw new HttpError(500, "authorization_check_failed");
  if (!data) throw new HttpError(403, "tenant_access_denied");
}

async function requireFeature(admin: Admin, tenantId: string): Promise<void> {
  const flags = await resolveTenantFeatureStates(admin, tenantId, [FEATURE]);
  if (!flags) throw new HttpError(500, "tenant_feature_lookup_failed");
  if (flags[FEATURE] !== true) throw new HttpError(403, "feature_disabled");
}

async function requireTenantAdministrator(
  admin: Admin,
  tenantId: string,
  userId: string,
): Promise<void> {
  // This is intentionally the same Tenant administrator role test used by
  // tenant-admin-settings for feature administration.
  await requireMembership(admin, tenantId, userId);
  const { data: role, error: roleError } = await admin
    .from("roles")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("name", "Tenant administrator")
    .eq("scope", "tenant")
    .eq("active", true)
    .maybeSingle();
  if (roleError) throw new HttpError(500, "authorization_check_failed");
  if (!role?.id) throw new HttpError(403, "forbidden");
  const now = new Date().toISOString();
  const { data: assignment, error: assignmentError } = await admin
    .from("user_role_assignments")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .eq("role_id", role.id)
    .lte("starts_at", now)
    .or(`expires_at.is.null,expires_at.gt.${now}`)
    .maybeSingle();
  if (assignmentError) throw new HttpError(500, "authorization_check_failed");
  if (!assignment) throw new HttpError(403, "forbidden");
}

async function audit(
  admin: Admin,
  tenantId: string,
  actorId: string,
  action: string,
  entityType: string,
  entityId: string | null,
  metadata: Row = {},
): Promise<void> {
  const { error } = await admin.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_id: actorId,
    action,
    entity_type: entityType,
    entity_id: entityId,
    severity: "security",
    metadata,
  });
  if (error) throw new HttpError(500, "audit_log_write_failed");
}

async function readPreferences(
  admin: Admin,
  tenantId: string,
  actorId: string,
): Promise<PreferenceRow | null> {
  const { data, error } = await admin
    .from("push_preferences")
    .select(
      "enabled_categories, quiet_hours_enabled, quiet_start, quiet_end, timezone, last_test_at",
    )
    .eq("tenant_id", tenantId)
    .eq("user_id", actorId)
    .maybeSingle();
  if (error) throw new HttpError(500, "preferences_read_failed");
  return data as PreferenceRow | null;
}

async function readDevices(
  admin: Admin,
  tenantId: string,
  actorId: string,
): Promise<DeviceRow[]> {
  const { data, error } = await admin
    .from("push_devices")
    .select(
      "id, apns_token, apns_environment, device_name, app_version, app_build, enabled, disabled_reason, last_registered_at, last_sent_at",
    )
    .eq("tenant_id", tenantId)
    .eq("user_id", actorId)
    .order("last_registered_at", { ascending: false })
    .limit(10);
  if (error) throw new HttpError(500, "devices_read_failed");
  return (data ?? []) as DeviceRow[];
}

async function applicableCategories(
  client: Client,
  tenantId: string,
): Promise<string[]> {
  const { data, error } = await client.rpc("is_tenant_ticket_agent", {
    p_tenant_id: tenantId,
  });
  if (error || typeof data !== "boolean") {
    throw new HttpError(500, "authorization_check_failed");
  }
  return data ? [...AGENT_CATEGORIES] : [...REQUESTER_CATEGORIES];
}

function workHoursSettings(configuration: Row): WorkHoursSettings {
  let startHour = isWorkStartHour(configuration.workStartHour)
    ? configuration.workStartHour
    : 6;
  let endHour = isWorkEndHour(configuration.workEndHour)
    ? configuration.workEndHour
    : 17;
  if (endHour <= startHour) {
    startHour = 6;
    endHour = 17;
  }
  return {
    required:
      typeof configuration.checkInRequired === "boolean"
        ? configuration.checkInRequired
        : true,
    startHour,
    endHour,
  };
}

function workHoursStateForResponse(value: unknown): WorkHoursState {
  if (
    !isRecord(value) ||
    typeof value.required !== "boolean" ||
    !isWorkStartHour(value.startHour) ||
    !isWorkEndHour(value.endHour) ||
    typeof value.timezone !== "string" ||
    typeof value.localDate !== "string" ||
    !isHour(value.localHour) ||
    typeof value.withinWindow !== "boolean" ||
    typeof value.checkedIn !== "boolean" ||
    (value.checkedInAt !== null && typeof value.checkedInAt !== "string") ||
    (value.checkedOutAt !== null && typeof value.checkedOutAt !== "string") ||
    (value.declinedAt !== null && typeof value.declinedAt !== "string") ||
    typeof value.active !== "boolean"
  ) {
    throw new HttpError(500, "work_hours_read_failed");
  }
  return {
    required: value.required,
    startHour: value.startHour,
    endHour: value.endHour,
    timezone: value.timezone,
    localDate: value.localDate,
    withinWindow: value.withinWindow,
    checkedIn: value.checkedIn,
    checkedInAt: value.checkedInAt,
    checkedOutAt: value.checkedOutAt,
    declinedAt: value.declinedAt,
    active: value.active,
  };
}

async function readWorkHours(
  admin: Admin,
  tenantId: string,
  actorId: string,
  featureEnabled: boolean,
): Promise<WorkHours> {
  const [stateResult, deviceCountResult] = await Promise.all([
    admin.rpc("push_work_state", {
      p_tenant_id: tenantId,
      p_user_id: actorId,
    }),
    admin
      .from("push_devices")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("user_id", actorId)
      .eq("enabled", true),
  ]);
  if (stateResult.error || deviceCountResult.error) {
    throw new HttpError(500, "work_hours_read_failed");
  }
  const state = workHoursStateForResponse(stateResult.data);
  return {
    ...state,
    promptDue:
      featureEnabled &&
      state.required &&
      state.withinWindow &&
      state.checkedInAt === null &&
      state.declinedAt === null &&
      (deviceCountResult.count ?? 0) > 0,
  };
}

async function featureConfiguration(
  admin: Admin,
  tenantId: string,
): Promise<FeatureConfiguration> {
  const flags = await resolveTenantFeatureStates(admin, tenantId, [FEATURE]);
  if (!flags) throw new HttpError(500, "tenant_feature_lookup_failed");
  const { data, error } = await admin
    .from("tenant_feature_flags")
    .select("configuration")
    .eq("tenant_id", tenantId)
    .eq("feature_key", FEATURE)
    .maybeSingle();
  if (error) throw new HttpError(500, "tenant_feature_lookup_failed");
  const configuration = isRecord(data?.configuration) ? data.configuration : {};
  return {
    featureEnabled: flags[FEATURE] === true,
    contentLevel:
      configuration.contentLevel === "subject" ? "subject" : "minimal",
    configuration,
  };
}

async function getStatus(
  request: Request,
  client: Client,
  admin: Admin,
  action: Extract<Action, { type: "getStatus" }>,
  actorId: string,
): Promise<Response> {
  const [feature, preferences, devices, categories] = await Promise.all([
    featureConfiguration(admin, action.tenantId),
    readPreferences(admin, action.tenantId, actorId),
    readDevices(admin, action.tenantId, actorId),
    applicableCategories(client, action.tenantId),
  ]);
  const workHours = await readWorkHours(
    admin,
    action.tenantId,
    actorId,
    feature.featureEnabled,
  );
  return reply(request, {
    data: {
      featureEnabled: feature.featureEnabled,
      apnsConfigured: isApnsConfigured(),
      contentLevel: feature.contentLevel,
      applicableCategories: categories,
      preferences: preferencesForResponse(preferences),
      devices: devices.map(deviceForResponse),
      workHours,
    },
  });
}

async function registerDevice(
  request: Request,
  admin: Admin,
  action: Extract<Action, { type: "registerDevice" }>,
  actorId: string,
): Promise<Response> {
  await requireFeature(admin, action.tenantId);
  const now = new Date().toISOString();
  const values = {
    tenant_id: action.tenantId,
    user_id: actorId,
    platform: "ios",
    apns_token: action.token,
    apns_environment: action.environment,
    app_version: action.appVersion ?? null,
    app_build: action.appBuild ?? null,
    device_name: action.deviceName ?? null,
    enabled: true,
    disabled_reason: null,
    last_registered_at: now,
  };
  const { data, error } = await admin
    .from("push_devices")
    .upsert(values, { onConflict: "apns_token" })
    .select(
      "id, apns_token, apns_environment, device_name, app_version, app_build, enabled, disabled_reason, last_registered_at, last_sent_at",
    )
    .single();
  if (error || !data) throw new HttpError(422, "device_registration_failed");

  const { data: excess, error: excessError } = await admin
    .from("push_devices")
    .select("id")
    .eq("tenant_id", action.tenantId)
    .eq("user_id", actorId)
    .order("last_registered_at", { ascending: true })
    .limit(20);
  if (excessError) throw new HttpError(500, "device_registration_failed");
  const staleIds = (excess ?? [])
    .slice(0, Math.max(0, (excess?.length ?? 0) - 10))
    .map((row: { id: string }) => row.id);
  if (staleIds.length > 0) {
    const { error: trimError } = await admin
      .from("push_devices")
      .delete()
      .eq("tenant_id", action.tenantId)
      .eq("user_id", actorId)
      .in("id", staleIds);
    if (trimError) throw new HttpError(500, "device_registration_failed");
  }
  await audit(
    admin,
    action.tenantId,
    actorId,
    "push.device.registered",
    "push_device",
    data.id,
    { environment: action.environment, movedExistingToken: true },
  );
  return reply(request, {
    data: { device: deviceForResponse(data as DeviceRow) },
  });
}

async function unregisterDevice(
  request: Request,
  admin: Admin,
  action: Extract<Action, { type: "unregisterDevice" }>,
  actorId: string,
): Promise<Response> {
  let query = admin
    .from("push_devices")
    .delete()
    .eq("tenant_id", action.tenantId)
    .eq("user_id", actorId);
  query = action.deviceId
    ? query.eq("id", action.deviceId)
    : query.eq("apns_token", action.token ?? "");
  const { data, error } = await query.select("id").maybeSingle();
  if (error) throw new HttpError(500, "device_removal_failed");
  const removedDeviceId = typeof data?.id === "string" ? data.id : null;
  const removed = removedDeviceId !== null;
  if (removedDeviceId) {
    await audit(
      admin,
      action.tenantId,
      actorId,
      "push.device.removed",
      "push_device",
      removedDeviceId,
    );
  }
  return reply(request, { data: { removed } });
}

async function updatePreferences(
  request: Request,
  admin: Admin,
  action: Extract<Action, { type: "updatePreferences" }>,
  actorId: string,
): Promise<Response> {
  const { data, error } = await admin
    .from("push_preferences")
    .upsert(
      {
        tenant_id: action.tenantId,
        user_id: actorId,
        enabled_categories: action.enabledCategories,
        quiet_hours_enabled: action.quietHoursEnabled,
        quiet_start: action.quietStart,
        quiet_end: action.quietEnd,
        timezone: action.timezone,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "tenant_id,user_id" },
    )
    .select(
      "enabled_categories, quiet_hours_enabled, quiet_start, quiet_end, timezone, last_test_at",
    )
    .single();
  if (error || !data) throw new HttpError(422, "preferences_update_failed");
  await audit(
    admin,
    action.tenantId,
    actorId,
    "push.preferences.updated",
    "push_preferences",
    actorId,
    {
      enabledCategoryCount: action.enabledCategories.length,
      quietHoursEnabled: action.quietHoursEnabled,
    },
  );
  return reply(request, {
    data: { preferences: preferencesForResponse(data as PreferenceRow) },
  });
}

function isInvalidApnsDevice(result: {
  status: number;
  reason?: string;
}): boolean {
  return (
    result.status === 410 ||
    (result.status === 400 &&
      ["BadDeviceToken", "DeviceTokenNotForTopic", "Unregistered"].includes(
        result.reason ?? "",
      ))
  );
}

async function sendTest(
  request: Request,
  admin: Admin,
  action: Extract<Action, { type: "sendTest" }>,
  actorId: string,
): Promise<Response> {
  await requireFeature(admin, action.tenantId);
  if (!isApnsConfigured()) throw new HttpError(503, "apns_not_configured");
  const preference = await readPreferences(admin, action.tenantId, actorId);
  const now = Date.now();
  if (
    preference?.last_test_at &&
    Number.isFinite(Date.parse(preference.last_test_at)) &&
    Date.parse(preference.last_test_at) > now - 60_000
  ) {
    throw new HttpError(429, "rate_limited");
  }
  const { error: preferenceError } = await admin
    .from("push_preferences")
    .upsert(
      {
        tenant_id: action.tenantId,
        user_id: actorId,
        ...(preference
          ? {
              enabled_categories: preference.enabled_categories,
              quiet_hours_enabled: preference.quiet_hours_enabled,
              quiet_start: preference.quiet_start,
              quiet_end: preference.quiet_end,
              timezone: preference.timezone,
            }
          : {
              enabled_categories: [...ALL_CATEGORIES],
              quiet_hours_enabled: false,
              quiet_start: 22,
              quiet_end: 7,
              timezone: "Europe/Zurich",
            }),
        last_test_at: new Date(now).toISOString(),
        updated_at: new Date(now).toISOString(),
      },
      { onConflict: "tenant_id,user_id" },
    );
  if (preferenceError) throw new HttpError(500, "test_send_failed");

  const devices = (await readDevices(admin, action.tenantId, actorId)).filter(
    (device) => device.enabled && device.apns_token && device.apns_environment,
  );
  const results: Array<{
    deviceId: string;
    status: "sent" | "failed" | "disabled";
    code?: string;
  }> = [];
  for (const device of devices) {
    const result = await sendApns(
      device.apns_token as string,
      device.apns_environment as Environment,
      buildApnsPayload({
        kind: "test",
        tenantId: action.tenantId,
        notificationId: crypto.randomUUID(),
      }),
      crypto.randomUUID(),
    );
    if (result.status === 200) {
      await admin
        .from("push_devices")
        .update({ last_sent_at: new Date().toISOString() })
        .eq("id", device.id)
        .eq("tenant_id", action.tenantId)
        .eq("user_id", actorId);
      results.push({ deviceId: device.id, status: "sent" });
    } else if (isInvalidApnsDevice(result)) {
      await admin
        .from("push_devices")
        .update({ enabled: false, disabled_reason: "apns_unregistered" })
        .eq("id", device.id)
        .eq("tenant_id", action.tenantId)
        .eq("user_id", actorId);
      results.push({
        deviceId: device.id,
        status: "disabled",
        code: result.reason ?? String(result.status),
      });
    } else {
      results.push({
        deviceId: device.id,
        status: "failed",
        code: result.reason ?? String(result.status),
      });
    }
  }
  return reply(request, { data: { results } });
}

async function checkIn(
  request: Request,
  admin: Admin,
  action: Extract<Action, { type: "checkIn" }>,
  actorId: string,
): Promise<Response> {
  await requireFeature(admin, action.tenantId);
  const workHours = await readWorkHours(admin, action.tenantId, actorId, true);
  if (!workHours.required) {
    throw new HttpError(409, "check_in_not_required");
  }
  if (!workHours.withinWindow) {
    throw new HttpError(409, "outside_work_hours");
  }
  const { error } = await admin.from("push_work_checkins").upsert(
    {
      tenant_id: action.tenantId,
      user_id: actorId,
      work_date: workHours.localDate,
      checked_in_at: new Date().toISOString(),
      checked_out_at: null,
      declined_at: null,
    },
    { onConflict: "tenant_id,user_id,work_date" },
  );
  if (error) throw new HttpError(422, "work_hours_update_failed");
  return reply(request, {
    data: {
      workHours: await readWorkHours(admin, action.tenantId, actorId, true),
    },
  });
}

async function checkOut(
  request: Request,
  admin: Admin,
  action: Extract<Action, { type: "checkOut" }>,
  actorId: string,
): Promise<Response> {
  await requireFeature(admin, action.tenantId);
  const workHours = await readWorkHours(admin, action.tenantId, actorId, true);
  if (workHours.checkedIn) {
    const { error } = await admin
      .from("push_work_checkins")
      .update({ checked_out_at: new Date().toISOString() })
      .eq("tenant_id", action.tenantId)
      .eq("user_id", actorId)
      .eq("work_date", workHours.localDate);
    if (error) throw new HttpError(422, "work_hours_update_failed");
  }
  return reply(request, {
    data: {
      workHours: await readWorkHours(admin, action.tenantId, actorId, true),
    },
  });
}

async function declineCheckIn(
  request: Request,
  admin: Admin,
  action: Extract<Action, { type: "declineCheckIn" }>,
  actorId: string,
): Promise<Response> {
  await requireFeature(admin, action.tenantId);
  const workHours = await readWorkHours(admin, action.tenantId, actorId, true);
  if (!workHours.checkedIn) {
    const { error } = await admin.from("push_work_checkins").upsert(
      {
        tenant_id: action.tenantId,
        user_id: actorId,
        work_date: workHours.localDate,
        declined_at: new Date().toISOString(),
      },
      { onConflict: "tenant_id,user_id,work_date" },
    );
    if (error) throw new HttpError(422, "work_hours_update_failed");
  }
  return reply(request, {
    data: {
      workHours: await readWorkHours(admin, action.tenantId, actorId, true),
    },
  });
}

async function getTenantSettings(
  request: Request,
  admin: Admin,
  action: Extract<Action, { type: "getTenantSettings" }>,
): Promise<Response> {
  const [feature, countResult] = await Promise.all([
    featureConfiguration(admin, action.tenantId),
    admin
      .from("push_devices")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", action.tenantId)
      .eq("enabled", true),
  ]);
  if (countResult.error) {
    throw new HttpError(500, "tenant_settings_read_failed");
  }
  return reply(request, {
    data: {
      featureEnabled: feature.featureEnabled,
      apnsConfigured: isApnsConfigured(),
      contentLevel: feature.contentLevel,
      workHours: {
        checkInRequired: workHoursSettings(feature.configuration).required,
        workStartHour: workHoursSettings(feature.configuration).startHour,
        workEndHour: workHoursSettings(feature.configuration).endHour,
      },
      registeredDevices: countResult.count ?? 0,
    },
  });
}

async function updateTenantSettings(
  request: Request,
  admin: Admin,
  action: Extract<Action, { type: "updateTenantSettings" }>,
  actorId: string,
): Promise<Response> {
  const { data: existing, error: existingError } = await admin
    .from("tenant_feature_flags")
    .select("configuration")
    .eq("tenant_id", action.tenantId)
    .eq("feature_key", FEATURE)
    .maybeSingle();
  if (existingError) throw new HttpError(500, "tenant_settings_read_failed");
  const configuration = isRecord(existing?.configuration)
    ? existing.configuration
    : {};
  const currentWorkHours = workHoursSettings(configuration);
  const workHours = {
    checkInRequired: action.checkInRequired ?? currentWorkHours.required,
    workStartHour: action.workStartHour ?? currentWorkHours.startHour,
    workEndHour: action.workEndHour ?? currentWorkHours.endHour,
  };
  if (workHours.workStartHour >= workHours.workEndHour) {
    throw new HttpError(400, "invalid_request");
  }
  const { error } = await admin.from("tenant_feature_flags").upsert(
    {
      tenant_id: action.tenantId,
      feature_key: FEATURE,
      configuration: {
        ...configuration,
        contentLevel: action.contentLevel,
        checkInRequired: workHours.checkInRequired,
        workStartHour: workHours.workStartHour,
        workEndHour: workHours.workEndHour,
      },
      updated_by: actorId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id,feature_key" },
  );
  if (error) throw new HttpError(422, "tenant_settings_update_failed");
  await audit(
    admin,
    action.tenantId,
    actorId,
    "push.tenant_settings.updated",
    "tenant_feature_flag",
    action.tenantId,
    {
      contentLevel: action.contentLevel,
      checkInRequired: workHours.checkInRequired,
      workStartHour: workHours.workStartHour,
      workEndHour: workHours.workEndHour,
    },
  );
  return reply(request, {
    data: { contentLevel: action.contentLevel, workHours },
  });
}

const handler = withSupabase(
  { auth: "user", cors: "disabled", errors: { detailed: false } },
  async (request, context) => {
    const actorId = context.userClaims?.id;
    if (!isUuid(actorId)) throw new HttpError(401, "not_authenticated");
    const action = parseAction(await request.json().catch(() => null));
    if (!action) throw new HttpError(400, "invalid_request");
    await requireMembership(context.supabaseAdmin, action.tenantId, actorId);

    if (action.type === "getStatus") {
      return await getStatus(
        request,
        context.supabase,
        context.supabaseAdmin,
        action,
        actorId,
      );
    }
    if (action.type === "registerDevice") {
      return await registerDevice(
        request,
        context.supabaseAdmin,
        action,
        actorId,
      );
    }
    if (action.type === "unregisterDevice") {
      return await unregisterDevice(
        request,
        context.supabaseAdmin,
        action,
        actorId,
      );
    }
    if (action.type === "updatePreferences") {
      return await updatePreferences(
        request,
        context.supabaseAdmin,
        action,
        actorId,
      );
    }
    if (action.type === "sendTest") {
      return await sendTest(request, context.supabaseAdmin, action, actorId);
    }
    if (action.type === "checkIn") {
      return await checkIn(request, context.supabaseAdmin, action, actorId);
    }
    if (action.type === "checkOut") {
      return await checkOut(request, context.supabaseAdmin, action, actorId);
    }
    if (action.type === "declineCheckIn") {
      return await declineCheckIn(
        request,
        context.supabaseAdmin,
        action,
        actorId,
      );
    }
    await requireTenantAdministrator(
      context.supabaseAdmin,
      action.tenantId,
      actorId,
    );
    if (action.type === "getTenantSettings") {
      return await getTenantSettings(request, context.supabaseAdmin, action);
    }
    return await updateTenantSettings(
      request,
      context.supabaseAdmin,
      action,
      actorId,
    );
  },
);

export default {
  async fetch(request: Request): Promise<Response> {
    const origin = request.headers.get("origin");
    if (origin !== null && origin !== ALLOWED_ORIGIN) {
      return reply(
        request,
        { error: { code: "cors_origin_not_allowed" } },
        403,
      );
    }
    if (request.method === "OPTIONS") {
      if (origin !== ALLOWED_ORIGIN) {
        return reply(
          request,
          { error: { code: "cors_origin_not_allowed" } },
          403,
        );
      }
      return new Response(null, { status: 204, headers: headers(request) });
    }
    if (request.method !== "POST") {
      return reply(request, { error: { code: "method_not_allowed" } }, 405);
    }
    if (
      request.headers
        .get("content-type")
        ?.split(";", 1)[0]
        ?.trim()
        .toLowerCase() !== "application/json"
    ) {
      return reply(request, { error: { code: "unsupported_media_type" } }, 415);
    }
    try {
      const response = await handler(request);
      if (response.headers.has("x-supabase-server-error")) {
        return reply(request, { error: { code: "not_authenticated" } }, 401);
      }
      return new Response(response.body, {
        status: response.status,
        headers: headers(request),
      });
    } catch (error) {
      return fail(request, error);
    }
  },
};
