import { withSupabase } from "@supabase/server";

type SsoConfiguration = {
  tenant_id: string;
  provider: string;
  enabled: boolean;
  enforce_sso: boolean;
  issuer_url: string | null;
  allowed_email_domains: string[];
};

type AzureIdentity = {
  provider?: unknown;
  identity_data?: unknown;
};

type PendingInvitation = {
  id: string;
  tenant_id: string;
  invited_by: string;
  role_name: string | null;
  display_name: string | null;
  job_title: string | null;
  offer: string | null;
  department_id: string | null;
  wants_agent: boolean;
};

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

function normalizedIssuer(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "https:") return null;
    return `${parsed.origin}${parsed.pathname}`
      .replace(/\/+$/, "")
      .toLowerCase();
  } catch {
    return null;
  }
}

function configuredEntraTenantId(issuer: string): string | null {
  const path = new URL(issuer).pathname.split("/").filter(Boolean);
  const candidate = path[0]?.trim();
  return candidate && candidate.toLowerCase() !== "common"
    ? candidate.toLowerCase()
    : null;
}

function azureTenantClaimStatus(
  identities: unknown,
  configuredIssuer: unknown,
): "match" | "missing" | "mismatch" {
  const issuer = normalizedIssuer(configuredIssuer);
  if (!issuer || !Array.isArray(identities)) return "missing";
  const expectedTenantId = configuredEntraTenantId(issuer);
  let foundClaim = false;

  for (const identity of identities as AzureIdentity[]) {
    if (identity?.provider !== "azure" || !isRecord(identity.identity_data)) {
      continue;
    }
    const identityIssuer = normalizedIssuer(
      identity.identity_data.iss ?? identity.identity_data.issuer,
    );
    if (identityIssuer) {
      foundClaim = true;
      if (identityIssuer === issuer) return "match";
    }
    const tenantClaim =
      typeof identity.identity_data.tid === "string"
        ? identity.identity_data.tid.trim().toLowerCase()
        : typeof identity.identity_data.tenant_id === "string"
          ? identity.identity_data.tenant_id.trim().toLowerCase()
          : null;
    if (tenantClaim) {
      foundClaim = true;
      if (expectedTenantId && tenantClaim === expectedTenantId) return "match";
    }
  }

  return foundClaim ? "mismatch" : "missing";
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

async function ensureTenantRole(
  admin: any,
  tenantId: string,
  userId: string,
  roleName: string,
  assignedBy: string,
): Promise<boolean> {
  const { data: role, error: roleError } = await admin
    .from("roles")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("name", roleName)
    .eq("scope", "tenant")
    .eq("active", true)
    .maybeSingle();
  if (roleError || !role?.id) return false;

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
      assigned_by: assignedBy,
    });
  return !createError;
}

async function ensureInvitedAgentRole(
  admin: any,
  invitation: PendingInvitation,
  userId: string,
): Promise<boolean> {
  if (!invitation.wants_agent || !invitation.department_id) return true;
  const { data: departmentMembership, error: departmentError } = await admin
    .from("department_memberships")
    .upsert(
      {
        tenant_id: invitation.tenant_id,
        department_id: invitation.department_id,
        user_id: userId,
        status: "active",
      },
      { onConflict: "department_id,user_id" },
    );
  if (departmentError) return false;

  const { data: role, error: roleError } = await admin
    .from("roles")
    .select("id")
    .eq("tenant_id", invitation.tenant_id)
    .eq("name", "Support agent")
    .eq("scope", "department")
    .eq("active", true)
    .maybeSingle();
  if (roleError || !role?.id) return false;

  const { data: assignment, error: assignmentError } = await admin
    .from("user_role_assignments")
    .select("id")
    .eq("tenant_id", invitation.tenant_id)
    .eq("user_id", userId)
    .eq("role_id", role.id)
    .eq("department_id", invitation.department_id)
    .is("team_id", null)
    .is("expires_at", null)
    .maybeSingle();
  if (assignmentError || assignment) return !assignmentError;

  const { error: createError } = await admin
    .from("user_role_assignments")
    .insert({
      tenant_id: invitation.tenant_id,
      user_id: userId,
      role_id: role.id,
      department_id: invitation.department_id,
      assigned_by: invitation.invited_by,
    });
  return !createError;
}

async function provisionSsoPerson(
  admin: any,
  user: any,
  tenantId: string,
  email: string,
): Promise<"automatic" | "invited" | "existing" | "removed" | "failed"> {
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

  const { data: invitationData, error: invitationError } = await admin
    .from("tenant_user_invitations")
    .select(
      "id, tenant_id, invited_by, role_name, display_name, job_title, offer, department_id, wants_agent",
    )
    .eq("tenant_id", tenantId)
    .eq("email", email)
    .eq("status", "sent")
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (invitationError) return "failed";
  // The Entra tenant claim and the unique allowed-domain binding have already
  // been verified before this point. A matching employee may therefore enter
  // their own tenant as a normal requester without an invitation. An explicit
  // invitation remains the only way to assign a non-requester role or agent
  // department at first sign-in.
  const invitation = invitationData as PendingInvitation | null;

  const joinedAt = new Date().toISOString();
  const { error: membershipWriteError } = await admin
    .from("tenant_memberships")
    .upsert(
      {
        tenant_id: tenantId,
        user_id: userId,
        status: "active",
        joined_at: joinedAt,
      },
      { onConflict: "tenant_id,user_id" },
    );
  if (membershipWriteError) return "failed";

  const displayName =
    invitation?.display_name?.trim() || displayNameFromUser(user);
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
      {
        tenant_id: tenantId,
        user_id: userId,
        department_id: invitation?.department_id ?? null,
        job_title: invitation?.job_title ?? null,
        offer: invitation?.offer ?? null,
      },
      {
        onConflict: "tenant_id,user_id",
      },
    );
  const invitedRole = invitation?.role_name?.trim() || REQUESTER_ROLE;
  if (
    directoryError ||
    !(await ensureTenantRole(
      admin,
      tenantId,
      userId,
      invitedRole,
      invitation?.invited_by ?? userId,
    )) ||
    (invitation !== null &&
      !(await ensureInvitedAgentRole(admin, invitation, userId)))
  ) {
    return "failed";
  }

  if (invitation) {
    const { error: invitationUpdateError } = await admin
      .from("tenant_user_invitations")
      .update({ status: "accepted", accepted_at: joinedAt })
      .eq("id", invitation.id)
      .eq("tenant_id", tenantId)
      .eq("status", "sent");
    if (invitationUpdateError) return "failed";

    await admin.from("audit_logs").insert({
      tenant_id: tenantId,
      actor_id: userId,
      action: "tenant.sso_invitation.accepted",
      entity_type: "tenant_user_invitation",
      entity_id: invitation.id,
      severity: "security",
      metadata: { source: "tenant_sso_access" },
    });
    return "invited";
  }

  await admin.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_id: userId,
    action: "tenant.sso_person.provisioned",
    entity_type: "tenant_membership",
    entity_id: tenantId,
    severity: "security",
    metadata: { source: "tenant_sso_access", role: REQUESTER_ROLE },
  });
  return "automatic";
}

const handler = withSupabase({ auth: "user" }, async (request, context) => {
  if (request.method !== "POST") {
    return error(request, "method_not_allowed", 405);
  }
  const actorId = context.userClaims?.id;
  const email =
    typeof context.userClaims?.email === "string"
      ? context.userClaims.email.trim().toLocaleLowerCase("de-CH")
      : null;
  const domain = emailDomain(email);
  if (typeof actorId !== "string" || !email || !domain) {
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
        "tenant_id, provider, enabled, enforce_sso, issuer_url, allowed_email_domains",
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

  const claimStatus = azureTenantClaimStatus(
    userData.user.identities,
    sso.issuer_url,
  );
  if (claimStatus === "missing") {
    return error(request, "sso_tenant_claim_required", 403);
  }
  if (claimStatus === "mismatch") {
    return error(request, "sso_tenant_claim_mismatch", 403);
  }

  const provision = await provisionSsoPerson(
    context.supabaseAdmin,
    userData.user,
    sso.tenant_id,
    email,
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
      provisioned: provision === "invited" || provision === "automatic",
    },
  });
});

export default {
  fetch(request: Request): Response | Promise<Response> {
    if (request.method === "OPTIONS") return response(request, {}, 204);
    return handler(request);
  },
};
