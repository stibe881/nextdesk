import { withSupabase } from "@supabase/server";

type SsoConfiguration = {
  tenant_id: string;
  provider: string;
  enabled: boolean;
  enforce_sso: boolean;
  allowed_email_domains: string[];
};

type AzureIdentity = { provider?: unknown };

const APP_ORIGIN = "https://app.nextdesk.ch";
const REQUESTER_ROLE = "Requester";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function response(
  request: Request,
  body: Record<string, unknown>,
  status = 200,
) {
  const origin = request.headers.get("origin");
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: {
      "Access-Control-Allow-Origin": origin === APP_ORIGIN ? origin : "",
      "Access-Control-Allow-Headers":
        "authorization, apikey, content-type, x-client-info",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Content-Type": "application/json; charset=utf-8",
      Vary: "Origin",
    },
  });
}

function error(request: Request, code: string, status: number) {
  return response(request, { error: { code } }, status);
}

function emailDomain(email: unknown): string | null {
  if (typeof email !== "string") return null;
  const normalized = email.trim().toLocaleLowerCase("de-CH");
  const atIndex = normalized.lastIndexOf("@");
  const domain = atIndex > 0 ? normalized.slice(atIndex + 1) : "";
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(
    domain,
  )
    ? domain
    : null;
}

function hasAzureOAuthSession(
  appMetadata: unknown,
  identities: unknown,
  jwtClaims: unknown,
): boolean {
  const providers = isRecord(appMetadata) ? appMetadata.providers : undefined;
  const hasAzureProvider =
    Array.isArray(providers) && providers.includes("azure");
  const hasAzureIdentity =
    Array.isArray(identities) &&
    identities.some(
      (identity: AzureIdentity) => identity?.provider === "azure",
    );
  const amr = isRecord(jwtClaims) ? jwtClaims.amr : undefined;
  const hasOAuthAmr =
    Array.isArray(amr) &&
    amr.some((entry) => isRecord(entry) && entry.method === "oauth");
  return hasAzureProvider && hasAzureIdentity && hasOAuthAmr;
}

function displayNameFromUser(user: any): string | null {
  const metadata = isRecord(user?.user_metadata) ? user.user_metadata : {};
  const candidates = [metadata.full_name, metadata.name, metadata.display_name];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim().replace(/\s+/g, " ").slice(0, 160);
    }
  }
  const email = typeof user?.email === "string" ? user.email : "";
  const localPart = email
    .split("@", 1)[0]
    ?.replace(/[._-]+/g, " ")
    .trim();
  return localPart && localPart.length >= 2 ? localPart.slice(0, 160) : null;
}

async function ensureRequesterRole(
  admin: any,
  tenantId: string,
  userId: string,
): Promise<boolean> {
  const { data: role, error: roleError } = await admin
    .from("roles")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("name", REQUESTER_ROLE)
    .eq("scope", "tenant")
    .eq("active", true)
    .maybeSingle();
  if (roleError || !role?.id) return Boolean(!roleError);

  const { data: assignment, error: assignmentError } = await admin
    .from("user_role_assignments")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .eq("role_id", role.id)
    .is("expires_at", null)
    .maybeSingle();
  if (assignmentError || assignment) return !assignmentError;

  const { error: createError } = await admin
    .from("user_role_assignments")
    .insert({
      tenant_id: tenantId,
      user_id: userId,
      role_id: role.id,
      assigned_by: userId,
    });
  return !createError;
}

async function provisionSsoPerson(
  admin: any,
  user: any,
  tenantId: string,
): Promise<"created" | "existing" | "removed" | "failed"> {
  const userId = user?.id;
  if (typeof userId !== "string") return "failed";

  const { data: existing, error: membershipError } = await admin
    .from("tenant_memberships")
    .select("status")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .maybeSingle();
  if (membershipError) return "failed";
  if (existing?.status === "removed") return "removed";
  // A verified SSO person can sign in repeatedly. Once their membership exists,
  // do not repeat optional directory/profile writes; a transient write failure
  // must never lock an already authorized employee out of the tenant.
  if (existing?.status === "active") return "existing";

  const isNew = !existing;
  if (isNew) {
    const { error: createMembershipError } = await admin
      .from("tenant_memberships")
      .insert({
        tenant_id: tenantId,
        user_id: userId,
        status: "active",
        joined_at: new Date().toISOString(),
      });
    if (createMembershipError) return "failed";
  }

  const displayName = displayNameFromUser(user);
  if (displayName) {
    const { error: profileError } = await admin
      .from("user_profiles")
      .upsert({ id: userId, display_name: displayName });
    if (profileError) return "failed";
  } else {
    const { error: profileError } = await admin.from("user_profiles").upsert({
      id: userId,
    });
    if (profileError) return "failed";
  }

  const { error: directoryError } = await admin
    .from("tenant_member_directory")
    .upsert(
      { tenant_id: tenantId, user_id: userId },
      {
        onConflict: "tenant_id,user_id",
      },
    );
  if (directoryError || !(await ensureRequesterRole(admin, tenantId, userId))) {
    return "failed";
  }
  return isNew ? "created" : "existing";
}

const handler = withSupabase({ auth: "user" }, async (request, context) => {
  if (request.method !== "POST") {
    return error(request, "method_not_allowed", 405);
  }
  const actorId = context.userClaims?.id;
  const domain = emailDomain(context.userClaims?.email);
  if (typeof actorId !== "string" || !domain) {
    return error(request, "sso_email_claim_required", 403);
  }

  const { data: domainBinding, error: domainError } =
    await context.supabaseAdmin
      .from("tenant_sso_allowed_domains")
      .select("tenant_id")
      .eq("domain", domain)
      .maybeSingle();
  if (domainError) return error(request, "sso_domain_lookup_failed", 500);

  if (!domainBinding?.tenant_id) {
    return response(request, { data: { scope: "unmanaged" } });
  }

  const { data: configuration, error: configurationError } =
    await context.supabaseAdmin
      .from("tenant_sso_configurations")
      .select(
        "tenant_id, provider, enabled, enforce_sso, allowed_email_domains",
      )
      .eq("tenant_id", domainBinding.tenant_id)
      .maybeSingle();
  if (configurationError) {
    return error(request, "sso_configuration_lookup_failed", 500);
  }
  const sso = configuration as SsoConfiguration | null;
  if (!sso?.enabled || sso.provider !== "azure_ad") {
    return error(request, "sso_configuration_not_active", 403);
  }

  const { data: userData, error: userError } =
    await context.supabaseAdmin.auth.admin.getUserById(actorId);
  if (userError || !userData.user) {
    return error(request, "sso_identity_lookup_failed", 500);
  }
  if (
    !hasAzureOAuthSession(
      userData.user.app_metadata,
      userData.user.identities,
      context.jwtClaims,
    )
  ) {
    return error(request, "tenant_sso_required", 403);
  }

  const provision = await provisionSsoPerson(
    context.supabaseAdmin,
    userData.user,
    sso.tenant_id,
  );
  if (provision === "removed") {
    return error(request, "tenant_person_removed", 403);
  }
  if (provision === "failed") {
    return error(request, "sso_person_provision_failed", 500);
  }

  return response(request, {
    data: {
      scope: "tenant",
      tenantId: sso.tenant_id,
      ssoEnforced: sso.enforce_sso,
      provisioned: provision === "created",
    },
  });
});

export default {
  fetch(request: Request): Response | Promise<Response> {
    if (request.method === "OPTIONS") return response(request, {}, 204);
    return handler(request);
  },
};
