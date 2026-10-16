import { withSupabase } from "@supabase/server";
import { isUuid, json, noContent, parseJsonObject } from "../_shared/http.ts";

const securedHandler = withSupabase(
  { auth: "user" },
  async (request, context) => {
    if (request.method !== "POST") {
      return json(request, { error: { code: "method_not_allowed" } }, 405);
    }

    const body = await parseJsonObject(request);
    const invitationId = body?.invitationId;
    if (!isUuid(invitationId)) {
      return json(request, { error: { code: "invalid_request" } }, 400);
    }

    const { data: tenantId, error } = await context.supabase.rpc(
      "accept_current_tenant_invitation",
      {
        p_invitation_id: invitationId,
      },
    );
    if (error) {
      console.error("Invitation acceptance failed", { code: error.code });
      const status =
        error.code === "P0002" ? 404 : error.code === "42501" ? 403 : 422;
      return json(
        request,
        { error: { code: "invitation_acceptance_failed" } },
        status,
      );
    }

    return json(request, { data: { tenantId } });
  },
);

export default {
  fetch(request: Request): Response | Promise<Response> {
    return request.method === "OPTIONS"
      ? noContent(request)
      : securedHandler(request);
  },
};
