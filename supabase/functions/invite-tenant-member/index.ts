import { withSupabase } from "@supabase/server";
import { isUuid, json, noContent, parseJsonObject } from "../_shared/http.ts";

function parseRequestBody(
  body: Record<string, unknown>,
): { tenantId: string; email: string } | null {
  if (!isUuid(body.tenantId) || typeof body.email !== "string") {
    return null;
  }

  const email = body.email.trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)
    ? { tenantId: body.tenantId, email }
    : null;
}

type RpcFailureResult = { error: { code?: string } | null };
type RpcClient = {
  rpc: (
    functionName: string,
    args: Record<string, unknown>,
  ) => PromiseLike<RpcFailureResult>;
};

async function recordFailure(
  supabaseAdmin: RpcClient,
  actorId: string,
  invitationId: string,
  failureCode: string,
): Promise<void> {
  const result = await supabaseAdmin.rpc("fail_tenant_invitation", {
    p_actor_id: actorId,
    p_invitation_id: invitationId,
    p_failure_code: failureCode,
  });
  if ("error" in result && result.error) {
    console.error("Failed to record invitation failure", {
      code: result.error.code,
    });
  }
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

    const { data: invitationId, error: preparationError } =
      await context.supabaseAdmin.rpc("prepare_tenant_invitation", {
        p_actor_id: actorId,
        p_tenant_id: input.tenantId,
        p_email: input.email,
      });
    if (preparationError || !isUuid(invitationId)) {
      console.error("Invitation preparation failed", {
        code: preparationError?.code,
      });
      return json(
        request,
        { error: { code: "invitation_preparation_failed" } },
        preparationError?.code === "42501" ? 403 : 422,
      );
    }

    const redirectTo =
      Deno.env.get("TENANT_INVITATION_REDIRECT_URL") || undefined;
    const { data: invitation, error: authError } =
      await context.supabaseAdmin.auth.admin.inviteUserByEmail(input.email, {
        ...(redirectTo ? { redirectTo } : {}),
      });
    if (authError || !invitation.user?.id) {
      await recordFailure(
        context.supabaseAdmin,
        actorId,
        invitationId,
        "auth_invite_failed",
      );
      console.error("Supabase Auth invitation failed", {
        code: authError?.code,
      });
      return json(
        request,
        { error: { code: "invitation_delivery_failed" } },
        502,
      );
    }

    const { error: deliveryError } = await context.supabaseAdmin.rpc(
      "record_tenant_invitation_delivery",
      {
        p_actor_id: actorId,
        p_invitation_id: invitationId,
        p_invited_user_id: invitation.user.id,
      },
    );
    if (deliveryError) {
      await recordFailure(
        context.supabaseAdmin,
        actorId,
        invitationId,
        "membership_staging_failed",
      );
      console.error("Invitation membership staging failed", {
        code: deliveryError.code,
      });
      return json(
        request,
        { error: { code: "invitation_delivery_failed" } },
        500,
      );
    }

    return json(request, { data: { invitationId } }, 201);
  },
);

export default {
  fetch(request: Request): Response | Promise<Response> {
    return request.method === "OPTIONS"
      ? noContent(request)
      : securedHandler(request);
  },
};
