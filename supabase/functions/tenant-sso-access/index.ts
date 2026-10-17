import { withSupabase } from "@supabase/server";

type SsoConfiguration = {
  tenant_id: string;
  provider: string;
  enabled: boolean;
  enforce_sso: boolean;
  allowed_email_domains: string[];
};

type AzureIdentity = {
  provider?: unknown;
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
  return new Response(status === 204 ? null : JSON.stringify(body), {
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

const handler = withSupabase({ auth: "user" }, async (request, context) => {
  if (request.method !== "POST") {
    return error(request, "method_not_allowed", 405);
  }

  const actorId = context.userClaims?.id;
  if (typeof actorId !== "string") {
    return error(request, "invalid_request", 400);
  }

  // An active membership is the primary authorization boundary. It is created
  // only through tenant invitations or administration, so an Entra identity
  // never gains access merely by claiming a customer email domain.
  const { data: memberships, error: membershipError } =
    await context.supabaseAdmin
      .from("tenant_memberships")
      .select("tenant_id")
      .eq("user_id", actorId)
      .eq("status", "active")
      .limit(2);
  if (membershipError)
    return error(request, "sso_membership_lookup_failed", 500);
  if ((memberships ?? []).length === 0) {
    return response(request, { data: { scope: "unmanaged" } });
  }
  if ((memberships ?? []).length > 1) {
    return response(request, { data: { scope: "unmanaged" } });
  }

  const membership = memberships?.[0];
  if (!membership?.tenant_id)
    return error(request, "sso_membership_lookup_failed", 500);

  const { data: configuration, error: configurationError } =
    await context.supabaseAdmin
      .from("tenant_sso_configurations")
      .select(
        "tenant_id, provider, enabled, enforce_sso, allowed_email_domains",
      )
      .eq("tenant_id", membership.tenant_id)
      .maybeSingle();
  if (configurationError)
    return error(request, "sso_configuration_lookup_failed", 500);

  const sso = configuration as SsoConfiguration | null;
  if (!sso?.enabled || sso.provider !== "azure_ad") {
    return response(request, { data: { scope: "unmanaged" } });
  }

  // When the token exposes a verified e-mail address, it must belong to the
  // configured customer domain. Older Supabase identity payloads do not always
  // repeat the e-mail claim; their pre-existing active membership remains the
  // safe fallback until SSO is explicitly enforced.
  const domain = emailDomain(context.userClaims?.email);
  if (
    domain &&
    sso.allowed_email_domains.length > 0 &&
    !sso.allowed_email_domains.includes(domain)
  ) {
    return error(request, "tenant_sso_domain_mismatch", 403);
  }

  if (sso.enforce_sso) {
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
  }

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
