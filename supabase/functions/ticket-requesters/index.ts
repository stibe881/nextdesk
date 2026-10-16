import { withSupabase } from "@supabase/server";

const ORIGIN = "https://app.nextdesk.ch";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAILBOX =
  /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

type Action =
  | { type: "getOwn"; tenantId: string }
  | { type: "search"; tenantId: string; query: string }
  | {
      type: "create";
      tenantId: string;
      displayName: string;
      email: string | null;
    }
  | {
      type: "assign";
      tenantId: string;
      ticketId: string;
      requesterContactId: string;
    };

type Contact = { id: string; displayName: string; userId: string | null };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function uuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}
function shortText(value: unknown, min: number, max: number): string | null {
  if (
    typeof value !== "string" ||
    value.includes("\u0000") ||
    /\p{Cs}/u.test(value)
  )
    return null;
  const result = value.trim();
  return [...result].length >= min && [...result].length <= max ? result : null;
}
function email(value: unknown): string | null | false {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || /[\r\n\t]/.test(value)) return false;
  const result = value.trim().toLowerCase();
  return result.length <= 254 && MAILBOX.test(result) ? result : false;
}
function parse(value: unknown): Action | null {
  if (!record(value) || !uuid(value.tenantId) || typeof value.type !== "string")
    return null;
  if (value.type === "getOwn")
    return { type: value.type, tenantId: value.tenantId };
  if (value.type === "search") {
    const query = shortText(value.query, 2, 120);
    return query ? { type: value.type, tenantId: value.tenantId, query } : null;
  }
  if (value.type === "create") {
    const displayName = shortText(value.displayName, 2, 160);
    const normalizedEmail = email(value.email);
    return displayName && normalizedEmail !== false
      ? {
          type: value.type,
          tenantId: value.tenantId,
          displayName,
          email: normalizedEmail,
        }
      : null;
  }
  if (
    value.type === "assign" &&
    uuid(value.ticketId) &&
    uuid(value.requesterContactId)
  )
    return {
      type: value.type,
      tenantId: value.tenantId,
      ticketId: value.ticketId,
      requesterContactId: value.requesterContactId,
    };
  return null;
}
function cors(request: Request) {
  const headers = new Headers({
    "Cache-Control": "no-store",
    Vary: "Origin",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  if (request.headers.get("origin") === ORIGIN) {
    headers.set("Access-Control-Allow-Origin", ORIGIN);
    headers.set(
      "Access-Control-Allow-Headers",
      "authorization, apikey, content-type, x-client-info",
    );
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  }
  return headers;
}
function json(request: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: cors(request) });
}
function fail(request: Request, code: string, status: number) {
  return json(request, { error: { code } }, status);
}
function cleanName(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return text && !text.includes("@") ? text.slice(0, 160) : "Anfragende Person";
}
function contact(row: any): Contact | null {
  return uuid(row?.id)
    ? {
        id: row.id,
        displayName: cleanName(row.display_name),
        userId: uuid(row.user_id) ? row.user_id : null,
      }
    : null;
}
function escapeLike(value: string) {
  return value.replace(/[\\%_(),]/g, "\\$&");
}

async function member(admin: any, tenantId: string, actorId: string) {
  const { data, error } = await admin
    .from("tenant_memberships")
    .select("tenant_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", actorId)
    .eq("status", "active")
    .maybeSingle();
  return error ? null : Boolean(data);
}
async function canManage(client: any, tenantId: string) {
  const { data, error } = await client.rpc("can_manage_ticket_requesters", {
    p_tenant_id: tenantId,
  });
  return error ? null : data === true;
}
async function ensureOwn(
  client: any,
  admin: any,
  tenantId: string,
  actorId: string,
): Promise<{ value: Contact | null; error: boolean }> {
  const existing = await client
    .from("ticket_requesters")
    .select("id,display_name,user_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", actorId)
    .maybeSingle();
  if (existing.error) return { value: null, error: true };
  const found = contact(existing.data);
  if (found) return { value: found, error: false };
  const profile = await admin
    .from("user_profiles")
    .select("display_name")
    .eq("id", actorId)
    .maybeSingle();
  if (profile.error) return { value: null, error: true };
  const created = await client
    .from("ticket_requesters")
    .insert({
      tenant_id: tenantId,
      user_id: actorId,
      display_name: cleanName(profile.data?.display_name),
      source: "portal",
    })
    .select("id,display_name,user_id")
    .maybeSingle();
  if (created.data) return { value: contact(created.data), error: false };
  if (created.error?.code !== "23505") return { value: null, error: true };
  const raced = await client
    .from("ticket_requesters")
    .select("id,display_name,user_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", actorId)
    .maybeSingle();
  return {
    value: contact(raced.data),
    error: Boolean(raced.error) || !contact(raced.data),
  };
}

const handler = withSupabase({ auth: "user" }, async (request, context) => {
  if (request.method !== "POST")
    return fail(request, "method_not_allowed", 405);
  const action = parse(await request.json().catch(() => null));
  const actorId = context.userClaims?.id;
  if (!action || !uuid(actorId)) return fail(request, "invalid_request", 422);
  const active = await member(context.supabaseAdmin, action.tenantId, actorId);
  if (active === null) return fail(request, "authorization_check_failed", 500);
  if (!active) return fail(request, "tenant_membership_required", 403);

  if (action.type === "getOwn") {
    const own = await ensureOwn(
      context.supabase,
      context.supabaseAdmin,
      action.tenantId,
      actorId,
    );
    return own.error || !own.value
      ? fail(request, "requester_unavailable", 500)
      : json(request, {
          data: {
            requester: { id: own.value.id, displayName: own.value.displayName },
          },
        });
  }

  const managed = await canManage(context.supabase, action.tenantId);
  if (managed === null) return fail(request, "authorization_check_failed", 500);
  if (!managed) return fail(request, "requester_manage_denied", 403);

  if (action.type === "search") {
    const needle = escapeLike(action.query);
    const { data, error } = await context.supabase
      .from("ticket_requesters")
      .select("id,display_name,user_id")
      .eq("tenant_id", action.tenantId)
      .or(`display_name.ilike.%${needle}%,email.ilike.%${needle}%`)
      .order("display_name")
      .limit(30);
    if (error) return fail(request, "requester_search_failed", 500);
    const requesters = (data ?? [])
      .map(contact)
      .filter((entry): entry is Contact => entry !== null)
      .map(({ id, displayName }) => ({ id, displayName }));
    return json(request, { data: { requesters } });
  }

  if (action.type === "create") {
    if (action.email) {
      const existing = await context.supabase
        .from("ticket_requesters")
        .select("id,display_name,user_id")
        .eq("tenant_id", action.tenantId)
        .eq("email", action.email)
        .maybeSingle();
      if (existing.error) return fail(request, "requester_create_failed", 500);
      const found = contact(existing.data);
      if (found)
        return json(request, {
          data: { requester: { id: found.id, displayName: found.displayName } },
        });
    }
    const created = await context.supabase
      .from("ticket_requesters")
      .insert({
        tenant_id: action.tenantId,
        display_name: action.displayName,
        email: action.email,
        source: "manual",
      })
      .select("id,display_name,user_id")
      .maybeSingle();
    const value = contact(created.data);
    if (value)
      return json(
        request,
        {
          data: { requester: { id: value.id, displayName: value.displayName } },
        },
        201,
      );
    if (created.error?.code === "23505" && action.email) {
      const raced = await context.supabase
        .from("ticket_requesters")
        .select("id,display_name,user_id")
        .eq("tenant_id", action.tenantId)
        .eq("email", action.email)
        .maybeSingle();
      const found = contact(raced.data);
      if (found)
        return json(request, {
          data: { requester: { id: found.id, displayName: found.displayName } },
        });
    }
    return fail(request, "requester_create_failed", 422);
  }

  const [ticketResult, requesterResult] = await Promise.all([
    context.supabaseAdmin
      .from("tickets")
      .select("id,tenant_id,department_id,requester_id,requester_contact_id")
      .eq("id", action.ticketId)
      .eq("tenant_id", action.tenantId)
      .maybeSingle(),
    context.supabaseAdmin
      .from("ticket_requesters")
      .select("id,tenant_id,user_id,display_name")
      .eq("id", action.requesterContactId)
      .eq("tenant_id", action.tenantId)
      .maybeSingle(),
  ]);
  if (ticketResult.error || requesterResult.error)
    return fail(request, "requester_assignment_failed", 500);
  const ticket = ticketResult.data;
  const requester = contact(requesterResult.data);
  if (!ticket || !requester)
    return fail(request, "requester_or_ticket_not_found", 404);
  const { data: allowed, error: permissionError } = await context.supabase.rpc(
    "has_ticket_permission",
    {
      p_tenant_id: action.tenantId,
      p_department_id: ticket.department_id,
      p_permission_code: "ticket.update",
    },
  );
  if (permissionError) return fail(request, "authorization_check_failed", 500);
  if (allowed !== true)
    return fail(request, "requester_assignment_denied", 403);
  const update: Record<string, unknown> = {
    requester_contact_id: requester.id,
  };
  if (requester.userId) update.requester_id = requester.userId;
  const { error } = await context.supabaseAdmin
    .from("tickets")
    .update(update)
    .eq("id", ticket.id)
    .eq("tenant_id", action.tenantId);
  if (error) return fail(request, "requester_assignment_failed", 422);
  return json(request, {
    data: {
      requester: { id: requester.id, displayName: requester.displayName },
    },
  });
});

export default {
  fetch(request: Request): Response | Promise<Response> {
    const origin = request.headers.get("origin");
    if (origin !== null && origin !== ORIGIN)
      return fail(request, "origin_not_allowed", 403);
    if (request.method === "OPTIONS")
      return origin === ORIGIN
        ? new Response(null, { status: 204, headers: cors(request) })
        : fail(request, "origin_not_allowed", 403);
    return handler(request);
  },
};
