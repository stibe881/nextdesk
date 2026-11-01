import { withSupabase } from "@supabase/server";
import {
  graphAccessToken,
  graphManagerId,
  graphUsers,
  testEntraDirectoryConnection,
  type GraphUser,
} from "../_shared/entra-directory-graph.ts";

const APP_ORIGIN = "https://app.nextdesk.ch";
const TENANT_ADMINISTRATOR_ROLE = "Tenant administrator";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type SyncAction =
  | { type: "syncTenant"; tenantId: string }
  | { type: "testTenant"; tenantId: string };

type DirectoryPerson = {
  entra_object_id: string;
  email: string;
  display_name: string;
  job_title: string | null;
  source_department_name: string | null;
  account_enabled: boolean;
};

type SyncClaim = {
  outcome?: unknown;
  entra_tenant_id?: unknown;
  started_at?: unknown;
  sync_generation?: unknown;
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
    !isUuid(value.tenantId) ||
    (value.type !== "syncTenant" && value.type !== "testTenant")
  ) {
    return null;
  }
  return { type: value.type, tenantId: value.tenantId };
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

function asDirectoryPerson(value: GraphUser): DirectoryPerson | null {
  if (!isUuid(value.id) || value.userType !== "Member") return null;
  const email =
    optionalText(value.mail) ?? optionalText(value.userPrincipalName);
  const displayName = optionalDirectoryLabel(value.displayName);
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !displayName) {
    return null;
  }
  const accountEnabled = value.accountEnabled !== false;
  return {
    entra_object_id: value.id,
    email: email.toLowerCase(),
    display_name: displayName,
    job_title: optionalDirectoryLabel(value.jobTitle),
    source_department_name: optionalDirectoryLabel(value.department),
    account_enabled: accountEnabled,
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

async function readDirectoryConfiguration(
  admin: any,
  tenantId: string,
): Promise<{
  entraTenantId: string;
  enabled: boolean;
  syncGeneration: number;
} | null> {
  const [configurationResult, trustedTenantResult] = await Promise.all([
    admin
      .from("tenant_entra_directory_sync_configurations")
      .select("entra_tenant_id, enabled, sync_generation")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    admin.rpc("trusted_entra_tenant_id_for_tenant", {
      p_tenant_id: tenantId,
    }),
  ]);
  const { data, error } = configurationResult;
  const trustedEntraTenantId = trustedTenantResult.data;
  if (
    error ||
    trustedTenantResult.error ||
    !data ||
    !isUuid(data.entra_tenant_id) ||
    typeof data.sync_generation !== "number" ||
    !Number.isSafeInteger(data.sync_generation) ||
    data.sync_generation < 1 ||
    !isUuid(trustedEntraTenantId) ||
    data.entra_tenant_id.toLowerCase() !== trustedEntraTenantId.toLowerCase()
  ) {
    return null;
  }
  return {
    entraTenantId: data.entra_tenant_id,
    enabled: data.enabled === true,
    syncGeneration: data.sync_generation,
  };
}

function firstClaim(value: unknown): SyncClaim | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  return isRecord(candidate) ? (candidate as SyncClaim) : null;
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

  if (action.type === "testTenant") {
    const configuration = await readDirectoryConfiguration(
      context.supabaseAdmin,
      action.tenantId,
    );
    if (!configuration) {
      return response(
        request,
        { error: { code: "directory_sync_not_ready" } },
        422,
      );
    }

    let success = false;
    try {
      await testEntraDirectoryConnection(configuration.entraTenantId);
      success = true;
    } catch {
      success = false;
    }

    const { error: auditError } = await context.supabaseAdmin.rpc(
      "record_entra_directory_connection_test",
      {
        p_actor_id: actorId,
        p_tenant_id: action.tenantId,
        p_entra_tenant_id: configuration.entraTenantId,
        p_sync_generation: configuration.syncGeneration,
        p_success: success,
      },
    );
    if (auditError) {
      return response(
        request,
        { error: { code: "directory_connection_failed" } },
        502,
      );
    }

    return success
      ? response(request, { data: { connected: true } })
      : response(
          request,
          { error: { code: "directory_connection_failed" } },
          502,
        );
  }

  const runId = crypto.randomUUID();
  const { data: claimData, error: claimError } =
    await context.supabaseAdmin.rpc("claim_entra_directory_sync_run", {
      p_actor_id: actorId,
      p_tenant_id: action.tenantId,
      p_run_id: runId,
    });
  const claim = firstClaim(claimData);
  if (claimError || !claim) {
    return response(request, { error: { code: "directory_sync_failed" } }, 502);
  }
  if (claim.outcome === "in_progress") {
    return response(
      request,
      { error: { code: "directory_sync_in_progress" } },
      409,
    );
  }
  if (
    claim.outcome !== "claimed" ||
    !isUuid(claim.entra_tenant_id) ||
    typeof claim.started_at !== "string" ||
    typeof claim.sync_generation !== "number" ||
    !Number.isSafeInteger(claim.sync_generation) ||
    claim.sync_generation < 1
  ) {
    return response(
      request,
      { error: { code: "directory_sync_not_ready" } },
      422,
    );
  }

  const startedAt = claim.started_at;
  const syncGeneration = claim.sync_generation;
  try {
    const accessToken = await graphAccessToken(claim.entra_tenant_id);
    const graphPeople = await graphUsers(accessToken, fetch, async () => {
      const { data: renewed, error: renewError } =
        await context.supabaseAdmin.rpc("renew_entra_directory_sync_run", {
          p_actor_id: actorId,
          p_tenant_id: action.tenantId,
          p_run_id: runId,
          p_sync_generation: syncGeneration,
          p_entra_tenant_id: claim.entra_tenant_id,
        });
      if (renewError || renewed !== true) {
        throw new Error("directory_sync_failed");
      }
    });
    const objectIds = new Set<string>();
    const emails = new Set<string>();
    const people: DirectoryPerson[] = [];
    for (const graphPerson of graphPeople) {
      const person = asDirectoryPerson(graphPerson);
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
      const batch = people.slice(offset, offset + 250);
      const { data: imported, error } = await context.supabaseAdmin.rpc(
        "upsert_fenced_entra_directory_people_batch",
        {
          p_actor_id: actorId,
          p_tenant_id: action.tenantId,
          p_run_id: runId,
          p_sync_generation: syncGeneration,
          p_entra_tenant_id: claim.entra_tenant_id,
          p_started_at: startedAt,
          p_people: batch,
        },
      );
      if (error || nonNegativeInteger(imported) !== batch.length) {
        throw new Error("directory_sync_failed");
      }
    }

    // Managers (Graph "manager") drive approvals in the self-service shop.
    // They are stored after the fenced people import so that both ends of a
    // manager relation exist.
    const managerPairs = graphPeople
      .filter(
        (graphPerson) =>
          objectIds.has(String(graphPerson.id).toLowerCase()) ||
          objectIds.has(String(graphPerson.id)),
      )
      .map((graphPerson) => ({
        entra_object_id: String(graphPerson.id),
        manager_entra_object_id: graphManagerId(graphPerson),
      }));
    for (let offset = 0; offset < managerPairs.length; offset += 500) {
      const { error: managerError } = await context.supabaseAdmin.rpc(
        "apply_entra_directory_managers",
        {
          p_tenant_id: action.tenantId,
          p_pairs: managerPairs.slice(offset, offset + 500),
        },
      );
      if (managerError) {
        // Missing managers must not fail the directory import itself.
        console.error("Entra manager import failed", {
          code: managerError.code,
        });
        break;
      }
    }

    const { data: requesterProfileSyncData, error: requesterProfileSyncError } =
      await context.supabaseAdmin.rpc(
        "finalize_fenced_entra_directory_sync_run",
        {
          p_actor_id: actorId,
          p_tenant_id: action.tenantId,
          p_run_id: runId,
          p_sync_generation: syncGeneration,
          p_entra_tenant_id: claim.entra_tenant_id,
          p_started_at: startedAt,
          p_imported_count: people.length,
        },
      );
    if (requesterProfileSyncError) {
      throw new Error("directory_sync_failed");
    }
    const requesterProfileSync = requesterProfileSyncResult(
      requesterProfileSyncData,
    );

    return response(request, {
      data: {
        active: people.filter((person) => person.account_enabled).length,
        imported: people.length,
        skipped: graphPeople.length - people.length,
        requesterContactsCreated: requesterProfileSync.contactsCreated,
        requesterProfilesInitialized: requesterProfileSync.profilesInitialized,
      },
    });
  } catch {
    await context.supabaseAdmin.rpc("fail_entra_directory_sync_run", {
      p_actor_id: actorId,
      p_tenant_id: action.tenantId,
      p_run_id: runId,
      p_sync_generation: syncGeneration,
    });
    return response(request, { error: { code: "directory_sync_failed" } }, 502);
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
