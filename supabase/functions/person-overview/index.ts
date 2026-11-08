import { withSupabase } from "@supabase/server";

// Person overview for agents: profile from the Entra directory, all tickets
// (also closed ones), devices, licences, orders, key figures and the average
// satisfaction. The data is assembled by public.person_overview, which checks
// that the caller is a ticket agent and only returns readable tickets.
// Individual ratings and comments are never part of the response.

const ORIGIN = "https://app.nextdesk.ch";
const MAX_REQUEST_BYTES = 4 * 1024;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isUuid = (value: unknown): value is string =>
  typeof value === "string" && UUID.test(value);

type Action = {
  tenantId: string;
  entraObjectId: string | null;
  requesterContactId: string | null;
  userId: string | null;
};

function optionalUuid(value: unknown): string | null | false {
  if (value === undefined || value === null) return null;
  return isUuid(value) ? value : false;
}

function parse(value: unknown): Action | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const input = value as Record<string, unknown>;
  if (input.type !== "get" || !isUuid(input.tenantId)) return null;
  const entraObjectId = optionalUuid(input.entraObjectId);
  const requesterContactId = optionalUuid(input.requesterContactId);
  const userId = optionalUuid(input.userId);
  if (
    entraObjectId === false ||
    requesterContactId === false ||
    userId === false ||
    (!entraObjectId && !requesterContactId && !userId)
  ) {
    return null;
  }
  return {
    tenantId: input.tenantId,
    entraObjectId,
    requesterContactId,
    userId,
  };
}

function headers(request: Request) {
  const result = new Headers({
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    Vary: "Origin",
  });
  if (request.headers.get("origin") === ORIGIN) {
    result.set("Access-Control-Allow-Origin", ORIGIN);
    result.set(
      "Access-Control-Allow-Headers",
      "authorization, apikey, content-type, x-client-info",
    );
    result.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  }
  return result;
}

const respond = (
  request: Request,
  body: Record<string, unknown>,
  status = 200,
) => new Response(JSON.stringify(body), { status, headers: headers(request) });

const fail = (request: Request, code: string, status: number) =>
  respond(request, { error: { code } }, status);

async function readBody(request: Request): Promise<unknown> {
  const length = Number(request.headers.get("content-length"));
  if (Number.isFinite(length) && length > MAX_REQUEST_BYTES) return null;
  const text = await request.text().catch(() => "");
  if (text.length > MAX_REQUEST_BYTES) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const handler = withSupabase(
  { auth: "user", cors: "disabled", errors: { detailed: false } },
  async (request, context) => {
    if (request.method !== "POST") {
      return fail(request, "method_not_allowed", 405);
    }
    const action = parse(await readBody(request));
    if (!action) return fail(request, "invalid_request", 400);

    const { data, error } = await context.supabase.rpc("person_overview", {
      p_tenant_id: action.tenantId,
      p_entra_object_id: action.entraObjectId,
      p_requester_contact_id: action.requesterContactId,
      p_user_id: action.userId,
    });
    if (error) {
      if (error.code === "42501") {
        return fail(request, "agent_required", 403);
      }
      if (error.code === "P0002") {
        return fail(request, "person_not_found", 404);
      }
      if (error.code === "22023") {
        return fail(request, "invalid_request", 400);
      }
      return fail(request, "person_overview_failed", 503);
    }
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      return fail(request, "person_overview_failed", 500);
    }
    return respond(request, { data });
  },
);

export default {
  fetch(request: Request): Response | Promise<Response> {
    const origin = request.headers.get("origin");
    if (origin !== null && origin !== ORIGIN) {
      return fail(request, "origin_not_allowed", 403);
    }
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: headers(request) });
    }
    return handler(request);
  },
};
