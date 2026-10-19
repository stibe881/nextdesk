import { withSupabase } from "@supabase/server";

const APP_ORIGIN = "https://app.nextdesk.ch";
const TENANT_ADMINISTRATOR_ROLE = "Tenant administrator";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GRAPH_ORIGIN = "https://graph.microsoft.com";
const GRAPH_FIELDS = [
  "id",
  "displayName",
  "mail",
  "userPrincipalName",
  "jobTitle",
  "department",
  "accountEnabled",
  "userType",
].join(",");

type SyncAction = { type: "syncTenant"; tenantId: string };
type GraphUser = {
  id?: unknown;
  displayName?: unknown;
  mail?: unknown;
  userPrincipalName?: unknown;
  jobTitle?: unknown;
  department?: unknown;
  accountEnabled?: unknown;
  userType?: unknown;
};

type DirectoryPerson = {
  tenant_id: string;
  entra_object_id: string;
  email: string;
  display_name: string;
  job_title: string | null;
  source_department_name: string | null;
  account_enabled: boolean;
  inactive_at: string | null;
  last_synced_at: string;
};

type RequesterProfileSyncResult = {
  requester_contacts_created?: unknown;
  requester_profiles_initialized?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function response(request: Request, body: unknown, status = 200): Response {
  const origin = request.headers.get("origin");
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...(origin === APP_ORIGIN
        ? { "Access-Control-Allow-Origin": APP_ORIGIN }
        : {}),
      "Access-Control-Allow-Headers":
        "authorization, apikey, content-type, x-client-info",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Content-Type": "application/json; charset=utf-8",
      Vary: "Origin",
    },
  });
}

function parseAction(value: unknown): SyncAction | null {
  if (
    !isRecord(value) ||
    value.type !== "syncTenant" ||
    !isUuid(value.tenantId)
  ) {
    return null;
  }
  return { type: "syncTenant", tenantId: value.tenantId };
}

function optionalText(value: unknown, maximum = 160): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) return null;
  return Array.from(normalized).length <= maximum
    ? normalized
    : normalized.slice(0, maximum);
}

function optionalDirectoryLabel(value: unknown): string | null {
  const normalized = optionalText(value);
  return normalized && Array.from(normalized).length >= 2 ? normalized : null;
}

function nonNegativeInteger(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : 0;
}

function requesterProfileSyncResult(value: unknown): {
  contactsCreated: number;
  profilesInitialized: number;
} {
  const row = Array.isArray(value) ? value[0] : value;
  if (!isRecord(row)) return { contactsCreated: 0, profilesInitialized: 0 };
  const result = row as RequesterProfileSyncResult;
  return {
    contactsCreated: nonNegativeInteger(result.requester_contacts_created),
    profilesInitialized: nonNegativeInteger(
      result.requester_profiles_initialized,
    ),
  };
}

function asDirectoryPerson(
  value: GraphUser,
  tenantId: string,
  syncedAt: string,
): DirectoryPerson | null {
  if (!isUuid(value.id) || value.userType !== "Member") return null;
  const email =
    optionalText(value.mail) ?? optionalText(value.userPrincipalName);
  const displayName = optionalDirectoryLabel(value.displayName);
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !displayName) {
    return null;
  }
  const accountEnabled = value.accountEnabled !== false;
  return {
    tenant_id: tenantId,
    entra_object_id: value.id,
    email: email.toLowerCase(),
    display_name: displayName,
    job_title: optionalDirectoryLabel(value.jobTitle),
    source_department_name: optionalDirectoryLabel(value.department),
    account_enabled: accountEnabled,
    inactive_at: accountEnabled ? null : syncedAt,
    last_synced_at: syncedAt,
  };
}

async function isTenantAdministrator(
  admin: any,
  userId: string,
  tenantId: string,
): Promise<boolean> {
  const { data: membership } = await admin
    .from("tenant_memberships")
    .select("tenant_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  if (!membership) return false;

  const { data: role } = await admin
    .from("roles")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("name", TENANT_ADMINISTRATOR_ROLE)
    .eq("scope", "tenant")
    .eq("active", true)
    .maybeSingle();
  if (!role) return false;

  const now = new Date().toISOString();
  const { data: assignment } = await admin
    .from("user_role_assignments")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .eq("role_id", role.id)
    .lte("starts_at", now)
    .or(`expires_at.is.null,expires_at.gt.${now}`)
    .maybeSingle();
  return Boolean(assignment);
}

async function graphAccessToken(entraTenantId: string): Promise<string> {
  const clientId = Deno.env.get("ENTRA_DIRECTORY_CLIENT_ID");
  const clientSecret = Deno.env.get("ENTRA_DIRECTORY_CLIENT_SECRET");
  if (!clientId || !clientSecret) throw new Error("directory_secrets_missing");

  const tokenResponse = await fetch(
    `https://login.microsoftonline.com/${entraTenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "client_credentials",
        scope: "https://graph.microsoft.com/.default",
      }),
    },
  );
  const payload = (await tokenResponse.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!tokenResponse.ok || typeof payload?.access_token !== "string") {
    throw new Error("directory_token_failed");
  }
  return payload.access_token;
}

async function graphUsers(token: string): Promise<GraphUser[]> {
  const users: GraphUser[] = [];
  let next: string | null =
    `${GRAPH_ORIGIN}/v1.0/users?$select=${encodeURIComponent(
      GRAPH_FIELDS,
    )}&$top=999`;

  for (let page = 0; next && page < 100; page += 1) {
    const url = new URL(next);
    if (
      url.origin !== GRAPH_ORIGIN ||
      !url.pathname.startsWith("/v1.0/users")
    ) {
      throw new Error("directory_pagination_invalid");
    }
    const graphResponse = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const payload = (await graphResponse.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!graphResponse.ok || !payload || !Array.isArray(payload.value)) {
      throw new Error("directory_users_failed");
    }
    users.push(...payload.value.filter(isRecord));
    next =
      typeof payload["@odata.nextLink"] === "string"
        ? payload["@odata.nextLink"]
        : null;
  }
  if (next) throw new Error("directory_page_limit_reached");
  return users;
}

function safeErrorCode(error: unknown): string {
  return error instanceof Error && /^[a-z_]{3,80}$/.test(error.message)
    ? error.message
    : "directory_sync_failed";
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
    !(await isTenantAdministrator(
      context.supabaseAdmin,
      actorId,
      action.tenantId,
    ))
  ) {
    return response(request, { error: { code: "tenant_admin_required" } }, 403);
  }

  const { data: configuration } = await context.supabaseAdmin
    .from("tenant_entra_directory_sync_configurations")
    .select("entra_tenant_id, enabled")
    .eq("tenant_id", action.tenantId)
    .maybeSingle();
  if (!configuration?.enabled || !isUuid(configuration.entra_tenant_id)) {
    return response(
      request,
      { error: { code: "directory_sync_not_configured" } },
      422,
    );
  }

  const startedAt = new Date().toISOString();
  await context.supabaseAdmin
    .from("tenant_entra_directory_sync_configurations")
    .update({
      last_sync_started_at: startedAt,
      last_sync_status: "running",
      last_sync_error: null,
    })
    .eq("tenant_id", action.tenantId);

  try {
    const token = await graphAccessToken(configuration.entra_tenant_id);
    const graphPeople = await graphUsers(token);
    const objectIds = new Set<string>();
    const emails = new Set<string>();
    const people: DirectoryPerson[] = [];
    for (const graphPerson of graphPeople) {
      const person = asDirectoryPerson(graphPerson, action.tenantId, startedAt);
      if (
        !person ||
        objectIds.has(person.entra_object_id) ||
        emails.has(person.email)
      ) {
        continue;
      }
      objectIds.add(person.entra_object_id);
      emails.add(person.email);
      people.push(person);
    }

    for (let offset = 0; offset < people.length; offset += 250) {
      const { error } = await context.supabaseAdmin
        .from("tenant_entra_directory_people")
        .upsert(people.slice(offset, offset + 250), {
          onConflict: "tenant_id,entra_object_id",
        });
      if (error) {
        console.error("directory_upsert_failed", {
          code: error.code,
          message: error.message,
        });
        throw new Error("directory_upsert_failed");
      }
    }

    const { error: staleError } = await context.supabaseAdmin.rpc(
      "deactivate_stale_entra_directory_people",
      {
        p_tenant_id: action.tenantId,
        p_started_at: startedAt,
        p_actor_id: actorId,
      },
    );
    if (staleError) throw new Error("directory_deactivate_failed");

    const { data: requesterProfileSyncData, error: requesterProfileSyncError } =
      await context.supabaseAdmin.rpc("sync_entra_directory_requesters", {
        p_tenant_id: action.tenantId,
      });
    if (requesterProfileSyncError) {
      console.error("directory_requester_profile_sync_failed", {
        code: requesterProfileSyncError.code,
        message: requesterProfileSyncError.message,
      });
      throw new Error("directory_requester_profile_sync_failed");
    }
    const requesterProfileSync = requesterProfileSyncResult(
      requesterProfileSyncData,
    );

    const completedAt = new Date().toISOString();
    await context.supabaseAdmin
      .from("tenant_entra_directory_sync_configurations")
      .update({
        last_sync_completed_at: completedAt,
        last_sync_status: "success",
        last_sync_error: null,
      })
      .eq("tenant_id", action.tenantId);

    return response(request, {
      data: {
        active: people.filter((person) => person.account_enabled).length,
        imported: people.length,
        skipped: graphPeople.length - people.length,
        requesterContactsCreated: requesterProfileSync.contactsCreated,
        requesterProfilesInitialized: requesterProfileSync.profilesInitialized,
      },
    });
  } catch (error) {
    const code = safeErrorCode(error);
    await context.supabaseAdmin
      .from("tenant_entra_directory_sync_configurations")
      .update({
        last_sync_status: "failed",
        last_sync_error: code,
      })
      .eq("tenant_id", action.tenantId);
    return response(request, { error: { code } }, 502);
  }
});

export default {
  fetch(request: Request) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": APP_ORIGIN,
          "Access-Control-Allow-Headers":
            "authorization, apikey, content-type, x-client-info",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
        },
      });
    }
    return handler(request);
  },
};
