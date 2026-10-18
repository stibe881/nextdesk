import { withSupabase } from "@supabase/server";

const APP_ORIGIN = "https://app.nextdesk.ch";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATUS_KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

type Action =
  | { type: "listStatusOptions"; tenantId: string }
  | {
      type: "applyStatus";
      tenantId: string;
      ticketIds: string[];
      statusKey: string;
      confirmClose: boolean;
    };

function headers(request: Request): HeadersInit {
  const origin = request.headers.get("origin");
  return {
    "Access-Control-Allow-Origin": origin === APP_ORIGIN ? APP_ORIGIN : "",
    "Access-Control-Allow-Headers":
      "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json; charset=utf-8",
    Vary: "Origin",
  };
}

function response(
  request: Request,
  body: Record<string, unknown>,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: headers(request),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function parseAction(value: unknown): Action | null {
  if (!isRecord(value) || !isUuid(value.tenantId)) return null;
  if (
    value.type === "listStatusOptions" &&
    hasOnlyKeys(value, ["type", "tenantId"])
  ) {
    return { type: value.type, tenantId: value.tenantId };
  }
  if (
    value.type === "applyStatus" &&
    hasOnlyKeys(value, [
      "type",
      "tenantId",
      "ticketIds",
      "statusKey",
      "confirmClose",
    ]) &&
    Array.isArray(value.ticketIds) &&
    value.ticketIds.length >= 1 &&
    value.ticketIds.length <= 50 &&
    value.ticketIds.every(isUuid) &&
    new Set(value.ticketIds).size === value.ticketIds.length &&
    typeof value.statusKey === "string" &&
    STATUS_KEY_PATTERN.test(value.statusKey) &&
    (typeof value.confirmClose === "undefined" ||
      typeof value.confirmClose === "boolean")
  ) {
    return {
      type: value.type,
      tenantId: value.tenantId,
      ticketIds: value.ticketIds,
      statusKey: value.statusKey,
      confirmClose: value.confirmClose === true,
    };
  }
  return null;
}

async function isActiveMember(admin: any, userId: string, tenantId: string) {
  const { data, error } = await admin
    .from("tenant_memberships")
    .select("tenant_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  return !error && Boolean(data);
}

function rpcError(request: Request, error: any): Response {
  if (error?.message === "Bulk ticket close confirmation required") {
    return response(
      request,
      { error: { code: "bulk_status_close_confirmation_required" } },
      409,
    );
  }
  if (error?.code === "42501") {
    return response(
      request,
      { error: { code: "bulk_status_permission_denied" } },
      403,
    );
  }
  if (error?.code === "P0002") {
    return response(
      request,
      { error: { code: "bulk_status_target_missing" } },
      404,
    );
  }
  if (error?.code === "22023") {
    return response(request, { error: { code: "bulk_status_invalid" } }, 422);
  }
  return response(request, { error: { code: "bulk_status_failed" } }, 500);
}

const handler = withSupabase({ auth: "user" }, async (request, context) => {
  if (request.method !== "POST") {
    return response(request, { error: { code: "method_not_allowed" } }, 405);
  }

  const action = parseAction(await request.json().catch(() => null));
  const actorId = context.userClaims?.id;
  if (!action || !isUuid(actorId)) {
    return response(request, { error: { code: "invalid_request" } }, 400);
  }
  if (
    !(await isActiveMember(context.supabaseAdmin, actorId, action.tenantId))
  ) {
    return response(
      request,
      { error: { code: "bulk_status_tenant_access_denied" } },
      403,
    );
  }

  if (action.type === "listStatusOptions") {
    const { data, error } = await context.supabaseAdmin
      .from("ticket_statuses")
      .select("key, label, is_closed, sort_order")
      .eq("tenant_id", action.tenantId)
      .order("sort_order")
      .order("label");
    if (error) {
      return response(
        request,
        {
          error: { code: "bulk_status_options_failed" },
        },
        500,
      );
    }
    return response(request, {
      data: {
        statuses: (data ?? []).map((status: any) => ({
          key: status.key,
          label: status.label,
          isClosed: Boolean(status.is_closed),
        })),
      },
    });
  }

  const { data, error } = await context.supabaseAdmin.rpc(
    "bulk_update_ticket_statuses",
    {
      p_actor_id: actorId,
      p_tenant_id: action.tenantId,
      p_ticket_ids: action.ticketIds,
      p_status_key: action.statusKey,
      p_confirm_close: action.confirmClose,
    },
  );
  if (error) return rpcError(request, error);
  if (!isRecord(data) || typeof data.updated !== "number") {
    return response(request, { error: { code: "bulk_status_failed" } }, 500);
  }
  return response(request, {
    data: {
      requested: typeof data.requested === "number" ? data.requested : 0,
      statusKey:
        typeof data.statusKey === "string" ? data.statusKey : action.statusKey,
      updated: data.updated,
    },
  });
});

export default {
  fetch(request: Request): Response | Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: headers(request) });
    }
    return handler(request);
  },
};
