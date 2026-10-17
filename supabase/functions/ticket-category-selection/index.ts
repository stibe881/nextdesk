import { withSupabase } from "@supabase/server";

type CategorySelection = {
  tenantId: string;
  ticketId: string;
  categoryId: string | null;
  subcategoryId: string | null;
};

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

function isOptionalUuid(value: unknown): value is string | null {
  return value === null || isUuid(value);
}

function parseInput(value: unknown): CategorySelection | null {
  if (!isRecord(value)) return null;
  if (
    !Object.keys(value).every((key) =>
      ["tenantId", "ticketId", "categoryId", "subcategoryId"].includes(key),
    ) ||
    !isUuid(value.tenantId) ||
    !isUuid(value.ticketId) ||
    !isOptionalUuid(value.categoryId) ||
    !isOptionalUuid(value.subcategoryId) ||
    (value.subcategoryId !== null && value.categoryId === null)
  ) {
    return null;
  }
  return {
    tenantId: value.tenantId,
    ticketId: value.ticketId,
    categoryId: value.categoryId,
    subcategoryId: value.subcategoryId,
  };
}

function headers(request: Request) {
  const origin = request.headers.get("origin");
  return {
    "Access-Control-Allow-Origin":
      origin === "https://app.nextdesk.ch" ? origin : "",
    "Access-Control-Allow-Headers":
      "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json; charset=utf-8",
    Vary: "Origin",
  };
}

function json(request: Request, body: Record<string, unknown>, status = 200) {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: headers(request),
  });
}

function selectionError(
  request: Request,
  error: { code?: string; message?: string },
) {
  if (error.code === "P0002" || error.message === "ticket_not_found") {
    return json(request, { error: { code: "ticket_not_found" } }, 404);
  }
  if (
    error.code === "42501" ||
    error.message === "ticket_category_change_denied"
  ) {
    return json(
      request,
      { error: { code: "ticket_category_change_denied" } },
      403,
    );
  }
  if (
    error.code === "22023" ||
    error.code === "23503" ||
    error.code === "23514" ||
    error.message === "invalid_ticket_category"
  ) {
    return json(request, { error: { code: "invalid_ticket_category" } }, 422);
  }
  return json(
    request,
    { error: { code: "ticket_category_change_failed" } },
    500,
  );
}

const handler = withSupabase({ auth: "user" }, async (request, context) => {
  if (request.method !== "POST") {
    return json(request, { error: { code: "method_not_allowed" } }, 405);
  }

  const input = parseInput(await request.json().catch(() => null));
  const actorId = context.userClaims?.id;
  if (!input || !isUuid(actorId)) {
    return json(request, { error: { code: "invalid_request" } }, 400);
  }

  const { data, error } = await context.supabaseAdmin.rpc(
    "apply_ticket_category_selection",
    {
      p_actor_id: actorId,
      p_tenant_id: input.tenantId,
      p_ticket_id: input.ticketId,
      p_category_id: input.categoryId,
      p_subcategory_id: input.subcategoryId,
    },
  );
  if (error) return selectionError(request, error);

  return json(request, { data });
});

export default {
  fetch(request: Request): Response | Promise<Response> {
    if (request.method === "OPTIONS") return json(request, {}, 204);
    return handler(request);
  },
};
