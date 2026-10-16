import { withSupabase } from "@supabase/server";
import {
  corsHeaders,
  isRecord,
  isUuid,
  json,
  noContent,
  parseJsonObject,
} from "../_shared/http.ts";

type InitialDepartment = {
  key: string;
  name: string;
  kind: "ict" | "infrastructure" | "custom";
};

function parseRequestBody(body: Record<string, unknown>): {
  slug: string;
  name: string;
  initialAdminUserId?: string;
  departments: InitialDepartment[];
} | null {
  if (
    typeof body.slug !== "string" ||
    typeof body.name !== "string" ||
    body.name.trim().length > 160 ||
    !Array.isArray(body.departments) ||
    body.departments.length < 1 ||
    body.departments.length > 50
  ) {
    return null;
  }

  const departments: InitialDepartment[] = [];
  for (const value of body.departments) {
    if (
      !isRecord(value) ||
      typeof value.key !== "string" ||
      typeof value.name !== "string" ||
      value.name.trim().length > 160 ||
      !["ict", "infrastructure", "custom"].includes(String(value.kind))
    ) {
      return null;
    }
    departments.push({
      key: value.key.trim(),
      name: value.name.trim(),
      kind: value.kind as InitialDepartment["kind"],
    });
  }

  if (
    body.initialAdminUserId !== undefined &&
    !isUuid(body.initialAdminUserId)
  ) {
    return null;
  }

  return {
    slug: body.slug.trim().toLowerCase(),
    name: body.name.trim(),
    ...(body.initialAdminUserId === undefined
      ? {}
      : { initialAdminUserId: body.initialAdminUserId }),
    departments,
  };
}

const securedHandler = withSupabase(
  { auth: "user" },
  async (request, context) => {
    if (request.method !== "POST") {
      return json(request, { error: { code: "method_not_allowed" } }, 405);
    }

    const body = await parseJsonObject(request);
    const input = body ? parseRequestBody(body) : null;
    const actorId = context.userClaims?.id;
    if (!input || !isUuid(actorId)) {
      return json(request, { error: { code: "invalid_request" } }, 400);
    }

    const aal = isRecord(context.jwtClaims) ? context.jwtClaims.aal : undefined;
    if (aal !== "aal2") {
      return json(request, { error: { code: "mfa_required" } }, 403);
    }

    const { data: operator, error: operatorError } = await context.supabaseAdmin
      .from("platform_administrators")
      .update({ mfa_verified_at: new Date().toISOString() })
      .eq("user_id", actorId)
      .eq("enabled", true)
      .select("user_id")
      .maybeSingle();
    if (operatorError || !operator) {
      console.error("Platform operator verification failed", {
        code: operatorError?.code,
      });
      return json(
        request,
        { error: { code: "platform_operator_required" } },
        403,
      );
    }

    const { data: tenantId, error } = await context.supabaseAdmin.rpc(
      "provision_tenant",
      {
        p_actor_id: actorId,
        p_slug: input.slug,
        p_name: input.name,
        p_initial_admin_user_id: input.initialAdminUserId ?? actorId,
        p_departments: input.departments,
      },
    );

    if (error) {
      console.error("Tenant provisioning failed", {
        code: error.code,
        requestId: request.headers.get("x-request-id"),
      });
      const status =
        error.code === "42501" ? 403 : error.code === "23505" ? 409 : 422;
      return json(
        request,
        { error: { code: "tenant_provisioning_failed" } },
        status,
      );
    }

    return json(request, { data: { tenantId } }, 201);
  },
);

export default {
  fetch(request: Request): Response | Promise<Response> {
    return request.method === "OPTIONS"
      ? noContent(request)
      : securedHandler(request);
  },
};

export { corsHeaders };
