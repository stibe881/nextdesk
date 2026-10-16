import { withSupabase } from "@supabase/server";

type ErrorCode =
  "invalid_request" | "sso_required" | "platform_operator_required";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function response(
  request: Request,
  body: Record<string, unknown>,
  status = 200,
) {
  const origin = request.headers.get("origin");
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: {
      "Access-Control-Allow-Origin":
        origin === "https://app.nextdesk.ch" ? origin : "",
      "Access-Control-Allow-Headers":
        "authorization, apikey, content-type, x-client-info",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Content-Type": "application/json; charset=utf-8",
      Vary: "Origin",
    },
  });
}

function failure(request: Request, code: ErrorCode) {
  return response(request, { error: { code } }, 403);
}

const handler = withSupabase({ auth: "user" }, async (request, context) => {
  if (request.method !== "POST") {
    return response(request, { error: { code: "method_not_allowed" } }, 405);
  }
  const actorId = context.userClaims?.id;
  if (typeof actorId !== "string") {
    return response(request, { error: { code: "invalid_request" } }, 400);
  }

  const { data: userData, error: userError } =
    await context.supabaseAdmin.auth.admin.getUserById(actorId);
  const providers = isRecord(userData.user?.app_metadata)
    ? userData.user.app_metadata.providers
    : undefined;
  if (userError || !Array.isArray(providers) || !providers.includes("azure")) {
    return failure(request, "sso_required");
  }
  const amr = isRecord(context.jwtClaims) ? context.jwtClaims.amr : undefined;
  const hasOAuthSession =
    Array.isArray(amr) &&
    amr.some((entry) => isRecord(entry) && entry.method === "oauth");
  if (!hasOAuthSession) return failure(request, "sso_required");

  const { data: operator, error } = await context.supabaseAdmin
    .from("platform_administrators")
    .select("user_id")
    .eq("user_id", actorId)
    .eq("enabled", true)
    .maybeSingle();
  if (error || !operator) return failure(request, "platform_operator_required");

  return response(request, {
    data: { owner: true, ssoProvider: "azure" },
  });
});

export default {
  fetch(request: Request): Response | Promise<Response> {
    if (request.method === "OPTIONS") return response(request, {}, 204);
    return handler(request);
  },
};
