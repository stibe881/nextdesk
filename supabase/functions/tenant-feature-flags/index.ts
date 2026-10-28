import { withSupabase } from "@supabase/server";

const APP_ORIGIN = "https://app.nextdesk.ch";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const KNOWN_FEATURE_KEYS: ReadonlySet<string> = new Set([
  "ticketing.detail",
  "ticketing.checklists",
  "ticketing.time-tracking",
  "ticketing.templates",
  "knowledge.base",
  "automation.sla",
  "reporting.service",
  "integrations.email",
  "assets.management",
  "inventory.management",
  "experience.workspace",
  "portal.self-service",
  "ai.assist",
  "webhooks.outbound",
  "agent.workbench",
  "requester.portal",
  "requester.department-view",
  "notifications.push",
]);

type RequestBody = {
  type: "list";
  tenantId: string;
};

type FeatureFlagRow = {
  feature_key: string;
  enabled: boolean;
  pilot_ends_at: string | null;
  feature_catalog:
    { default_enabled: boolean } | { default_enabled: boolean }[] | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseBody(value: unknown): RequestBody | null {
  if (
    !isRecord(value) ||
    value.type !== "list" ||
    typeof value.tenantId !== "string"
  ) {
    return null;
  }

  const tenantId = value.tenantId.trim();
  return UUID_PATTERN.test(tenantId) ? { type: "list", tenantId } : null;
}

function corsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get("origin");
  const headers: Record<string, string> = { Vary: "Origin" };

  // Native Supabase invocations carry no Origin. Browser requests may only come
  // from the production app, never from arbitrary third-party pages.
  if (!origin || origin === APP_ORIGIN) {
    headers["Access-Control-Allow-Origin"] = origin ?? APP_ORIGIN;
    headers["Access-Control-Allow-Headers"] =
      "authorization, apikey, content-type, x-client-info";
    headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
  }

  return headers;
}

function response(request: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(request),
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function preflight(request: Request): Response {
  if (
    request.headers.get("origin") &&
    request.headers.get("origin") !== APP_ORIGIN
  ) {
    return response(request, { error: { code: "origin_not_allowed" } }, 403);
  }

  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

async function jsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function defaultEnabled(row: FeatureFlagRow): boolean {
  const catalog = Array.isArray(row.feature_catalog)
    ? row.feature_catalog[0]
    : row.feature_catalog;
  return catalog?.default_enabled === true;
}

function hasActivePilot(row: FeatureFlagRow): boolean {
  if (row.pilot_ends_at === null) return true;
  const endsAt = Date.parse(row.pilot_ends_at);
  return Number.isFinite(endsAt) && endsAt > Date.now();
}

const handler = withSupabase({ auth: "user" }, async (request, context) => {
  if (request.method !== "POST") {
    return response(request, { error: { code: "method_not_allowed" } }, 405);
  }

  const body = parseBody(await jsonBody(request));
  const userId = context.userClaims?.id;
  if (!body || !userId || !UUID_PATTERN.test(userId)) {
    return response(request, { error: { code: "invalid_request" } }, 400);
  }

  const { data: membership, error: membershipError } =
    await context.supabaseAdmin
      .from("tenant_memberships")
      .select("tenant_id")
      .eq("tenant_id", body.tenantId)
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle();

  if (membershipError) {
    return response(
      request,
      { error: { code: "membership_check_failed" } },
      500,
    );
  }
  if (!membership) {
    return response(request, { error: { code: "tenant_access_denied" } }, 403);
  }

  const { data, error } = await context.supabaseAdmin
    .from("tenant_feature_flags")
    .select(
      "feature_key, enabled, pilot_ends_at, feature_catalog(default_enabled)",
    )
    .eq("tenant_id", body.tenantId)
    .order("feature_key", { ascending: true })
    .limit(100);

  if (error) {
    return response(request, { error: { code: "feature_list_failed" } }, 500);
  }

  const features = ((data ?? []) as FeatureFlagRow[])
    .filter(
      (row) =>
        typeof row.feature_key === "string" &&
        KNOWN_FEATURE_KEYS.has(row.feature_key) &&
        typeof row.enabled === "boolean" &&
        (row.pilot_ends_at === null || typeof row.pilot_ends_at === "string"),
    )
    .map((row) => ({
      key: row.feature_key,
      // Expired pilots are treated exactly like disabled modules. This protects
      // navigation and content even if no browser reload happened at midnight.
      enabled: row.enabled && hasActivePilot(row),
      defaultEnabled: defaultEnabled(row),
      pilotEndsAt: row.pilot_ends_at,
    }));

  return response(request, { data: { features } });
});

export default {
  fetch(request: Request) {
    return request.method === "OPTIONS" ? preflight(request) : handler(request);
  },
};
