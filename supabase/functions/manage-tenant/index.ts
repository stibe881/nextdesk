import { withSupabase } from "@supabase/server";
import {
  isRecord,
  isUuid,
  json,
  noContent,
  parseJsonObject,
} from "../_shared/http.ts";

type TenantAction =
  | {
      type: "updateSettings";
      tenantId: string;
      portalName: string;
      supportEmail: string | null;
      ticketAccessEnabled: boolean;
      allowExternalTicketAccess: boolean;
    }
  | {
      type: "createTeam";
      tenantId: string;
      departmentId: string | null;
      name: string;
    }
  | {
      type: "setDepartmentMembership";
      tenantId: string;
      departmentId: string;
      userId: string;
      status: "active" | "suspended" | "removed";
    }
  | { type: "cancelInvitation"; invitationId: string };

function parseAction(body: Record<string, unknown>): TenantAction | null {
  if (body.type === "updateSettings") {
    return isUuid(body.tenantId) &&
      typeof body.portalName === "string" &&
      (typeof body.supportEmail === "string" || body.supportEmail === null) &&
      typeof body.ticketAccessEnabled === "boolean" &&
      typeof body.allowExternalTicketAccess === "boolean"
      ? {
          type: "updateSettings",
          tenantId: body.tenantId,
          portalName: body.portalName.trim(),
          supportEmail:
            typeof body.supportEmail === "string"
              ? body.supportEmail.trim()
              : null,
          ticketAccessEnabled: body.ticketAccessEnabled,
          allowExternalTicketAccess: body.allowExternalTicketAccess,
        }
      : null;
  }

  if (body.type === "createTeam") {
    return isUuid(body.tenantId) &&
      (body.departmentId === null || isUuid(body.departmentId)) &&
      typeof body.name === "string"
      ? {
          type: "createTeam",
          tenantId: body.tenantId,
          departmentId: body.departmentId,
          name: body.name.trim(),
        }
      : null;
  }

  if (body.type === "setDepartmentMembership") {
    return isUuid(body.tenantId) &&
      isUuid(body.departmentId) &&
      isUuid(body.userId) &&
      ["active", "suspended", "removed"].includes(String(body.status))
      ? {
          type: "setDepartmentMembership",
          tenantId: body.tenantId,
          departmentId: body.departmentId,
          userId: body.userId,
          status: body.status as "active" | "suspended" | "removed",
        }
      : null;
  }

  if (body.type === "cancelInvitation") {
    return isUuid(body.invitationId)
      ? { type: "cancelInvitation", invitationId: body.invitationId }
      : null;
  }

  return null;
}

const securedHandler = withSupabase(
  { auth: "user" },
  async (request, context) => {
    if (request.method !== "POST") {
      return json(request, { error: { code: "method_not_allowed" } }, 405);
    }

    const body = await parseJsonObject(request);
    const action = body ? parseAction(body) : null;
    const actorId = context.userClaims?.id;
    if (!action || !isUuid(actorId)) {
      return json(request, { error: { code: "invalid_request" } }, 400);
    }

    if (action.type === "updateSettings") {
      const { error } = await context.supabaseAdmin.rpc(
        "update_tenant_settings",
        {
          p_actor_id: actorId,
          p_tenant_id: action.tenantId,
          p_portal_name: action.portalName,
          p_support_email: action.supportEmail,
          p_ticket_access_enabled: action.ticketAccessEnabled,
          p_allow_external_ticket_access: action.allowExternalTicketAccess,
        },
      );
      if (error) {
        return json(
          request,
          { error: { code: "tenant_settings_update_failed" } },
          error.code === "42501" ? 403 : 422,
        );
      }
      return json(request, { data: { updated: true } });
    }

    if (action.type === "createTeam") {
      const { data: teamId, error } = await context.supabaseAdmin.rpc(
        "create_tenant_team",
        {
          p_actor_id: actorId,
          p_tenant_id: action.tenantId,
          p_department_id: action.departmentId,
          p_name: action.name,
        },
      );
      if (error) {
        return json(
          request,
          { error: { code: "team_creation_failed" } },
          error.code === "42501" ? 403 : 422,
        );
      }
      return json(request, { data: { teamId } }, 201);
    }

    if (action.type === "cancelInvitation") {
      const { error } = await context.supabaseAdmin.rpc(
        "cancel_tenant_invitation",
        {
          p_actor_id: actorId,
          p_invitation_id: action.invitationId,
        },
      );
      if (error) {
        return json(
          request,
          { error: { code: "invitation_cancellation_failed" } },
          error.code === "42501" ? 403 : 422,
        );
      }
      return json(request, { data: { cancelled: true } });
    }

    const { error } = await context.supabaseAdmin.rpc(
      "set_department_membership",
      {
        p_actor_id: actorId,
        p_tenant_id: action.tenantId,
        p_department_id: action.departmentId,
        p_user_id: action.userId,
        p_status: action.status,
      },
    );
    if (error) {
      return json(
        request,
        { error: { code: "department_membership_update_failed" } },
        error.code === "42501" ? 403 : 422,
      );
    }
    return json(request, { data: { updated: true } });
  },
);

export default {
  fetch(request: Request): Response | Promise<Response> {
    return request.method === "OPTIONS"
      ? noContent(request)
      : securedHandler(request);
  },
};
