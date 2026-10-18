import { withSupabase } from "@supabase/server";
import { resolveTenantFeatureStates } from "../_shared/tenant-features.ts";

const ORIGIN = "https://app.nextdesk.ch";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuid = (value: unknown): value is string =>
  typeof value === "string" && UUID.test(value);
const text = (value: unknown, max: number): string | null | false => {
  if (value === null) return null;
  if (typeof value !== "string" || /\p{Cc}|\p{Cs}/u.test(value)) return false;
  const cleaned = value.trim();
  return !cleaned || [...cleaned].length > max
    ? cleaned
      ? false
      : null
    : cleaned;
};
type Profile = {
  location: string | null;
  department: string | null;
  offer: string | null;
  language: string | null;
  preferredContactChannel: string | null;
  importantNote: string | null;
};
type Action =
  | { type: "getProfile"; tenantId: string; requesterContactId: string }
  | ({
      type: "saveProfile";
      tenantId: string;
      requesterContactId: string;
    } & Profile);
function parse(value: unknown): Action | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const input = value as Record<string, unknown>;
  if (!uuid(input.tenantId) || !uuid(input.requesterContactId)) return null;
  if (input.type === "getProfile") {
    return {
      type: input.type,
      tenantId: input.tenantId,
      requesterContactId: input.requesterContactId,
    };
  }
  if (input.type !== "saveProfile") return null;
  const location = text(input.location, 120);
  const department = text(input.department, 120);
  const offer = text(input.offer, 120);
  const language = text(input.language, 35);
  const preferredContactChannel = text(input.preferredContactChannel, 16);
  const importantNote = text(input.importantNote, 2000);
  if (
    location === false ||
    department === false ||
    offer === false ||
    language === false ||
    preferredContactChannel === false ||
    importantNote === false
  ) {
    return null;
  }
  return {
    type: input.type,
    tenantId: input.tenantId,
    requesterContactId: input.requesterContactId,
    location,
    department,
    offer,
    language,
    preferredContactChannel,
    importantNote,
  };
}
function headers(request: Request) {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    Vary: "Origin",
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
const response = (
  request: Request,
  body: Record<string, unknown>,
  status = 200,
) => new Response(JSON.stringify(body), { status, headers: headers(request) });
const fail = (request: Request, code: string, status: number) =>
  response(request, { error: { code } }, status);
function profile(row: any): (Profile & { requesterContactId: string }) | null {
  if (!uuid(row?.requester_id)) return null;
  return {
    requesterContactId: row.requester_id,
    location: typeof row.location === "string" ? row.location : null,
    department: typeof row.department === "string" ? row.department : null,
    offer: typeof row.offer === "string" ? row.offer : null,
    language: typeof row.language === "string" ? row.language : null,
    preferredContactChannel:
      typeof row.preferred_contact_channel === "string"
        ? row.preferred_contact_channel
        : null,
    importantNote:
      typeof row.important_note === "string" ? row.important_note : null,
  };
}

const handler = withSupabase({ auth: "user" }, async (request, context) => {
  if (request.method !== "POST") {
    return fail(request, "method_not_allowed", 405);
  }
  const input = parse(await request.json().catch(() => null));
  const actorId = context.userClaims?.id;
  if (!input || !uuid(actorId)) return fail(request, "invalid_request", 422);
  const [
    { data: membership, error: membershipError },
    { data: manageable, error: permissionError },
  ] = await Promise.all([
    context.supabaseAdmin
      .from("tenant_memberships")
      .select("tenant_id")
      .eq("tenant_id", input.tenantId)
      .eq("user_id", actorId)
      .eq("status", "active")
      .maybeSingle(),
    context.supabase.rpc("can_manage_ticket_requesters", {
      p_tenant_id: input.tenantId,
    }),
  ]);
  if (membershipError || permissionError) {
    return fail(request, "authorization_check_failed", 500);
  }
  if (!membership) return fail(request, "tenant_membership_required", 403);
  if (manageable !== true) return fail(request, "requester_manage_denied", 403);

  const featureStates = await resolveTenantFeatureStates(
    context.supabaseAdmin,
    input.tenantId,
    ["ticketing.detail"],
  );
  if (!featureStates) return fail(request, "tenant_feature_lookup_failed", 503);
  if (featureStates["ticketing.detail"] !== true)
    return fail(request, "ticket_feature_disabled", 403);

  const { data: requester, error: requesterError } = await context.supabase
    .from("ticket_requesters")
    .select("id")
    .eq("tenant_id", input.tenantId)
    .eq("id", input.requesterContactId)
    .maybeSingle();
  if (requesterError) return fail(request, "requester_profile_failed", 500);
  if (!requester) return fail(request, "requester_not_found", 404);

  if (input.type === "getProfile") {
    const { data, error } = await context.supabase
      .from("ticket_requester_profiles")
      .select(
        "requester_id,location,department,offer,language,preferred_contact_channel,important_note",
      )
      .eq("tenant_id", input.tenantId)
      .eq("requester_id", input.requesterContactId)
      .maybeSingle();
    if (error) return fail(request, "requester_profile_failed", 500);
    return response(request, {
      data: { profile: data ? profile(data) : null },
    });
  }

  const { data, error } = await context.supabase
    .from("ticket_requester_profiles")
    .upsert(
      {
        tenant_id: input.tenantId,
        requester_id: input.requesterContactId,
        location: input.location,
        department: input.department,
        offer: input.offer,
        language: input.language,
        preferred_contact_channel: input.preferredContactChannel,
        important_note: input.importantNote,
      },
      { onConflict: "requester_id" },
    )
    .select(
      "requester_id,location,department,offer,language,preferred_contact_channel,important_note",
    )
    .maybeSingle();
  const result = profile(data);
  return error || !result
    ? fail(request, "requester_profile_save_failed", 422)
    : response(request, { data: { profile: result } });
});

export default {
  fetch(request: Request): Response | Promise<Response> {
    const origin = request.headers.get("origin");
    if (origin !== null && origin !== ORIGIN) {
      return fail(request, "origin_not_allowed", 403);
    }
    if (request.method === "OPTIONS") {
      return origin === ORIGIN
        ? new Response(null, { status: 204, headers: headers(request) })
        : fail(request, "origin_not_allowed", 403);
    }
    return handler(request);
  },
};
