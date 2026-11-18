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

/**
 * Profile photo of the person (copied from Entra into a private bucket) as a
 * short-lived signed URL. Null without a photo or on any error: the overview
 * works without it.
 */
async function personPhotoUrl(
  // deno-lint-ignore no-explicit-any
  admin: any,
  tenantId: string,
  entraObjectId: string,
): Promise<string | null> {
  try {
    const { data: row } = await admin
      .from("tenant_entra_directory_people")
      .select("photo_path")
      .eq("tenant_id", tenantId)
      .eq("entra_object_id", entraObjectId)
      .maybeSingle();
    const path =
      typeof row?.photo_path === "string" &&
      row.photo_path.startsWith(`${tenantId}/`)
        ? row.photo_path
        : null;
    if (!path) return null;
    const { data: signed } = await admin.storage
      .from("entra-avatars")
      .createSignedUrl(path, 3600);
    return typeof signed?.signedUrl === "string" ? signed.signedUrl : null;
  } catch {
    return null;
  }
}

/** {securityCases, incidents}; null per list when the caller may not see it. */
export async function personOperations(
  // deno-lint-ignore no-explicit-any
  client: any,
  tenantId: string,
  overview: Record<string, unknown>,
): Promise<{ securityCases: unknown[] | null; incidents: unknown[] | null }> {
  const person =
    typeof overview.person === "object" && overview.person !== null
      ? (overview.person as Record<string, unknown>)
      : {};
  const assetIds = (Array.isArray(overview.devices) ? overview.devices : [])
    .map((device) =>
      typeof device === "object" && device !== null
        ? (device as Record<string, unknown>).id
        : null,
    )
    .filter(isUuid)
    .slice(0, 100);
  try {
    const { data, error } = await client.rpc("person_overview_operations", {
      p_tenant_id: tenantId,
      p_user_id: isUuid(person.userId) ? person.userId : null,
      p_email: typeof person.email === "string" ? person.email : null,
      p_asset_ids: assetIds,
    });
    if (error || typeof data !== "object" || data === null) {
      return { securityCases: null, incidents: null };
    }
    const result = data as Record<string, unknown>;
    return {
      securityCases: Array.isArray(result.securityCases)
        ? result.securityCases
        : null,
      incidents: Array.isArray(result.incidents) ? result.incidents : null,
    };
  } catch {
    return { securityCases: null, incidents: null };
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
    // The database function has checked that the caller may see this person.
    const person = (data as Record<string, unknown>).person;
    const entraObjectId =
      typeof person === "object" && person !== null
        ? (person as Record<string, unknown>).entraObjectId
        : null;
    if (isUuid(entraObjectId)) {
      const photoUrl = await personPhotoUrl(
        context.supabaseAdmin,
        action.tenantId,
        entraObjectId,
      );
      (data as Record<string, Record<string, unknown>>).person = {
        ...(person as Record<string, unknown>),
        photoUrl,
      };
    }
    // Security cases of the person and Störungen of their devices: only for
    // the responsible teams (checked in the database function).
    Object.assign(
      data as Record<string, unknown>,
      await personOperations(
        context.supabase,
        action.tenantId,
        data as Record<string, unknown>,
      ),
    );
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
