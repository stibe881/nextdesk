import { withSupabase } from "@supabase/server";

type AzureIdentity = {
  provider?: unknown;
  identity_data?: unknown;
};

type SsoConfiguration = {
  tenant_id: string;
  provider: string;
  enabled: boolean;
  issuer_url: string | null;
  enforce_sso: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function response(
  request: Request,
  body: Record<string, unknown>,
  status = 200,
) {
  const origin = request.headers.get("origin");
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Access-Control-Allow-Origin":
        origin === "https://app.nextdesk.ch" ? origin : "",
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

function configuredAzureTenant(issuerUrl: string | null): string | null {
  if (!issuerUrl) return null;
  try {
    const url = new URL(issuerUrl);
    if (url.hostname !== "login.microsoftonline.com") return null;
    const [tenant] = url.pathname.split("/").filter(Boolean);
    return tenant && tenant !== "common" && tenant !== "organizations"
      ? tenant.toLocaleLowerCase("en-US")
      : null;
  } catch {
    return null;
  }
}

function identityAzureTenant(identities: unknown): string | null {
  if (!Array.isArray(identities)) return null;
  const identity = identities.find(
    (candidate: AzureIdentity) => candidate?.provider === "azure",
  );
  const data = isRecord(identity?.identity_data)
    ? identity.identity_data
    : null;
  if (!data) return null;
  for (const key of ["tid", "tenant_id", "tenantId"]) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim().toLocaleLowerCase("en-US");
    }
  }
  if (typeof data.iss === "string") return configuredAzureTenant(data.iss);
  return null;
}

const handler = withSupabase({ auth: "user" }, async (request, context) => {
  if (request.method !== "POST") {
    return error(request, "method_not_allowed", 405);
  }

  const actorId = context.userClaims?.id;
  if (typeof actorId !== "string") {
    return error(request, "invalid_request", 400);
  }

  const { data: userData, error: userError } =
    await context.supabaseAdmin.auth.admin.getUserById(actorId);
  const user = userData.user;
  if (userError || !user) return error(request, "session_user_not_found", 401);

  const domain = emailDomain(user.email ?? context.userClaims?.email);
  if (!domain) return error(request, "email_claim_required", 403);

  const { data: binding, error: bindingError } = await context.supabaseAdmin
    .from("tenant_sso_allowed_domains")
    .select("tenant_id")
    .eq("domain", domain)
    .maybeSingle();
  if (bindingError) return error(request, "sso_routing_lookup_failed", 500);

  // A user outside a configured customer SSO domain keeps the existing
  // invitation/membership workflow. Platform-owner access is evaluated by its
  // dedicated, stricter function afterwards.
  if (!binding?.tenant_id) {
    return response(request, { data: { scope: "unmanaged" } });
  }

  const { data: configuration, error: configurationError } =
    await context.supabaseAdmin
      .from("tenant_sso_configurations")
      .select("tenant_id, provider, enabled, issuer_url, enforce_sso")
      .eq("tenant_id", binding.tenant_id)
      .maybeSingle();
  if (configurationError || !configuration) {
    return error(request, "sso_configuration_not_found", 403);
  }
  const sso = configuration as SsoConfiguration;
  if (!sso.enabled || sso.provider !== "azure_ad") {
    return error(request, "sso_configuration_not_active", 403);
  }

  const azureSession = hasAzureOAuthSession(
    user.app_metadata,
    user.identities,
    context.jwtClaims,
  );
  if (sso.enforce_sso && !azureSession) {
    return error(request, "tenant_sso_required", 403);
  }

  if (azureSession) {
    const expectedTenant = configuredAzureTenant(sso.issuer_url);
    const identityTenant = identityAzureTenant(user.identities);
    // E-mail-domain routing stays the primary binding. If Entra exposed a
    // tenant claim, it must additionally match the tenant configured by the
    // customer. Older Supabase Azure identities may not contain this claim.
    if (expectedTenant && identityTenant && expectedTenant !== identityTenant) {
      return error(request, "tenant_sso_identity_mismatch", 403);
    }
  }

  const { data: membership, error: membershipError } =
    await context.supabaseAdmin
      .from("tenant_memberships")
      .select("tenant_id")
      .eq("tenant_id", sso.tenant_id)
      .eq("user_id", actorId)
      .eq("status", "active")
      .maybeSingle();
  if (membershipError) {
    return error(request, "sso_membership_lookup_failed", 500);
  }
  if (!membership) return error(request, "tenant_sso_membership_required", 403);

  return response(request, {
    data: {
      scope: "tenant",
      tenantId: sso.tenant_id,
      ssoEnforced: sso.enforce_sso,
    },
  });
});

export default {
  fetch(request: Request): Response | Promise<Response> {
    if (request.method === "OPTIONS") return response(request, {}, 204);
    return handler(request);
  },
};
