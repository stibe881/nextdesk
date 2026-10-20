import { withSupabase } from "@supabase/server";

type SsoConfiguration = {
  tenant_id: string;
  provider: string;
  enabled: boolean;
  enforce_sso: boolean;
  issuer_url: string | null;
  allowed_email_domains: string[];
};

type TenantSummary = {
  id: string;
  name: string;
  slug: string;
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
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invitationFromMembershipClaim(
  value: unknown,
): PendingInvitation | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== "string" ||
    typeof value.tenant_id !== "string" ||
    typeof value.invited_by !== "string" ||
    typeof value.wants_agent !== "boolean"
  ) {
    return null;
  }
  const optionalText = [
    value.role_name,
    value.display_name,
    value.job_title,
    value.offer,
    value.department_id,
  ];
  if (
    optionalText.some(
      (candidate) => candidate !== null && typeof candidate !== "string",
    )
  ) {
    return null;
  }
  return {
    id: value.id,
    tenant_id: value.tenant_id,
    invited_by: value.invited_by,
    role_name: value.role_name as string | null,
    display_name: value.display_name as string | null,
    job_title: value.job_title as string | null,
    offer: value.offer as string | null,
    department_id: value.department_id as string | null,
    wants_agent: value.wants_agent,
  };
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

function canonicalAuthEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLocaleLowerCase("de-CH");
  return emailDomain(email) ? email : null;
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

function azureObjectId(identities: unknown): string | null {
  if (!Array.isArray(identities)) return null;
  const objectIds = new Set<string>();
  for (const identity of identities as AzureIdentity[]) {
    if (identity?.provider !== "azure" || !isRecord(identity.identity_data)) {
      continue;
    }
    for (const candidate of [
      identity.identity_data.oid,
      identity.identity_data.object_id,
    ]) {
      if (typeof candidate === "string" && UUID.test(candidate.trim())) {
        objectIds.add(candidate.trim().toLowerCase());
      }
    }
  }
  return objectIds.size === 1 ? [...objectIds][0] : null;
}

function cleanDisplayName(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  return value.trim().replace(/\s+/g, " ").slice(0, 160);
}

function ssoDisplayNameFromUser(user: any): string | null {
  const identities = Array.isArray(user?.identities) ? user.identities : [];
  for (const identity of identities as AzureIdentity[]) {
    if (identity?.provider !== "azure" || !isRecord(identity.identity_data)) {
      continue;
    }
    const identityData = identity.identity_data;
    const directCandidates = [
      identityData.name,
      identityData.display_name,
      identityData.full_name,
    ];
    for (const candidate of directCandidates) {
      const displayName = cleanDisplayName(candidate);
      if (displayName) return displayName;
    }
    const givenName = cleanDisplayName(identityData.given_name);
    const familyName = cleanDisplayName(identityData.family_name);
    const combinedName = cleanDisplayName(
      [givenName, familyName].filter(Boolean).join(" "),
    );
    if (combinedName) return combinedName;
  }

  const metadata = isRecord(user?.user_metadata) ? user.user_metadata : {};
  const candidates = [metadata.full_name, metadata.name, metadata.display_name];
  for (const candidate of candidates) {
    const displayName = cleanDisplayName(candidate);
    if (displayName) return displayName;
  }
  return null;
}

function displayNameFromEmail(email: unknown): string | null {
  if (typeof email !== "string") return null;
  const localPart = email
    .split("@", 1)[0]
    ?.replace(/[._-]+/g, " ")
    .trim();
  if (!localPart || localPart.length < 2) return null;
  return localPart
    .split(/\s+/)
    .filter(Boolean)
    .map(
      (part) =>
        `${part.slice(0, 1).toLocaleUpperCase("de-CH")}${part.slice(1)}`,
    )
    .join(" ")
    .slice(0, 160);
}

async function ensureSsoUserProfileBeforeMembershipClaim(
  admin: any,
  userId: string,
  displayName: string | null,
): Promise<void> {
  const { error: profileError } = await admin
    .from("user_profiles")
    .upsert(
      displayName ? { id: userId, display_name: displayName } : { id: userId },
      { onConflict: "id", ignoreDuplicates: true },
    );
  if (profileError) {
    // The subsequent locked membership claim is deliberately still the
    // authority: for a new person its profile foreign key fails closed; for an
    // existing member a transient profile refresh error must not remove access.
    console.error("sso_profile_bootstrap_failed", {
      code: profileError.code,
    });
  }
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

async function ensureSupportAgentRole(
  admin: any,
  tenantId: string,
  userId: string,
  departmentId: string | null,
  assignedBy: string,
): Promise<boolean> {
  if (!departmentId) return false;
  const { data: departmentMembership, error: departmentError } = await admin
    .from("department_memberships")
    .upsert(
      {
        tenant_id: tenantId,
        department_id: departmentId,
        user_id: userId,
        status: "active",
      },
      { onConflict: "department_id,user_id" },
    );
  if (departmentError) return false;

  const { data: role, error: roleError } = await admin
    .from("roles")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("name", "Support agent")
    .eq("scope", "department")
    .eq("active", true)
    .maybeSingle();
  if (roleError || !role?.id) return false;

  const { data: assignment, error: assignmentError } = await admin
    .from("user_role_assignments")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .eq("role_id", role.id)
    .eq("department_id", departmentId)
    .is("team_id", null)
    .is("expires_at", null)
    .maybeSingle();
  if (assignmentError || assignment) return !assignmentError;

  const { error: createError } = await admin
    .from("user_role_assignments")
    .insert({
      tenant_id: tenantId,
      user_id: userId,
      role_id: role.id,
      department_id: departmentId,
      assigned_by: assignedBy,
    });
  return !createError;
}

function requesterProfileDepartment(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  if (
    !normalized ||
    Array.from(normalized).length > 120 ||
    /[\u0000-\u001F\u007F]/.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

type EntraDirectoryLink = {
  status: "linked" | "not_found" | "conflict" | "failed";
  department: string | null;
};

async function linkEntraDirectoryPerson(
  admin: any,
  tenantId: string,
  userId: string,
  email: string,
  entraObjectId: string,
): Promise<EntraDirectoryLink> {
  const { data: directoryPerson, error: directoryError } = await admin
    .from("tenant_entra_directory_people")
    .select("entra_object_id,source_department_name,local_user_id")
    .eq("tenant_id", tenantId)
    .eq("entra_object_id", entraObjectId)
    .eq("email", email)
    .eq("account_enabled", true)
    .is("inactive_at", null)
    .maybeSingle();
  if (directoryError) {
    console.error("entra_directory_identity_lookup_failed", {
      code: directoryError.code,
      message: directoryError.message,
    });
    return { status: "failed", department: null };
  }
  if (!directoryPerson) {
    return { status: "not_found", department: null };
  }

  const existingLocalUserId = directoryPerson.local_user_id;
  if (existingLocalUserId && existingLocalUserId !== userId) {
    await admin.from("audit_logs").insert({
      tenant_id: tenantId,
      actor_id: userId,
      action: "tenant.sso_entra_identity_conflict",
      entity_type: "tenant_entra_directory_person",
      entity_id: entraObjectId,
      severity: "security",
      metadata: { source: "tenant_sso_access" },
    });
    return { status: "conflict", department: null };
  }

  if (!existingLocalUserId) {
    const { data: linked, error: linkError } = await admin
      .from("tenant_entra_directory_people")
      .update({ local_user_id: userId })
      .eq("tenant_id", tenantId)
      .eq("entra_object_id", entraObjectId)
      .eq("email", email)
      .is("local_user_id", null)
      .select("local_user_id")
      .maybeSingle();
    if (linkError) {
      console.error("entra_directory_local_user_link_failed", {
        code: linkError.code,
        message: linkError.message,
      });
      return { status: "failed", department: null };
    }
    if (linked?.local_user_id !== userId) {
      const { data: raced, error: raceError } = await admin
        .from("tenant_entra_directory_people")
        .select("local_user_id")
        .eq("tenant_id", tenantId)
        .eq("entra_object_id", entraObjectId)
        .eq("email", email)
        .maybeSingle();
      if (raceError) return { status: "failed", department: null };
      if (raced?.local_user_id !== userId) {
        await admin.from("audit_logs").insert({
          tenant_id: tenantId,
          actor_id: userId,
          action: "tenant.sso_entra_identity_conflict",
          entity_type: "tenant_entra_directory_person",
          entity_id: entraObjectId,
          severity: "security",
          metadata: { source: "tenant_sso_access", raced: true },
        });
        return { status: "conflict", department: null };
      }
    }
  }

  return {
    status: "linked",
    department: requesterProfileDepartment(
      directoryPerson.source_department_name,
    ),
  };
}

async function initialiseEntraRequesterProfile(
  admin: any,
  tenantId: string,
  userId: string,
  department: string | null,
): Promise<void> {
  if (!department) return;

  const { data: requesterId, error: requesterError } = await admin.rpc(
    "ensure_ticket_user_requester",
    {
      p_tenant_id: tenantId,
      p_user_id: userId,
      p_source: "portal",
    },
  );
  if (requesterError || typeof requesterId !== "string") {
    console.error("entra_requester_contact_initialization_failed", {
      code: requesterError?.code ?? "invalid_requester_id",
      message: requesterError?.message ?? "invalid_requester_id",
    });
    return;
  }

  const { error: profileError } = await admin.rpc(
    "initialise_entra_requester_profile",
    {
      p_tenant_id: tenantId,
      p_requester_id: requesterId,
      p_department: department,
    },
  );
  if (profileError) {
    console.error("entra_requester_profile_initialization_failed", {
      code: profileError.code,
      message: profileError.message,
    });
  }
}

async function applyRequestedEntraAgentAccess(
  admin: any,
  tenantId: string,
  userId: string,
  entraObjectId: string | null,
): Promise<boolean> {
  if (!entraObjectId) return false;
  const { data, error } = await admin.rpc("apply_entra_agent_request", {
    p_tenant_id: tenantId,
    p_entra_object_id: entraObjectId,
    p_user_id: userId,
  });
  if (error) {
    console.error("entra_requested_agent_access_apply_failed", {
      code: error.code,
      message: error.message,
      tenantId,
      userId,
    });
    return false;
  }
  return (data as { applied?: unknown } | null)?.applied === true;
}

async function provisionSsoPerson(
  admin: any,
  user: any,
  tenantId: string,
  email: string,
  entraObjectId: string | null,
): Promise<"automatic" | "invited" | "existing" | "removed" | "failed"> {
  const userId = user?.id;
  if (typeof userId !== "string") return "failed";

  const ssoDisplayName = ssoDisplayNameFromUser(user);
  // tenant_memberships.user_id deliberately references user_profiles.id.
  // Create or refresh the minimal profile after Azure/domain/tenant validation
  // but before the locked claim, so first-time Requesters satisfy that FK.
  // The claim remains the sole authority for tenant membership transitions.
  await ensureSsoUserProfileBeforeMembershipClaim(
    admin,
    userId,
    ssoDisplayName ?? displayNameFromEmail(email),
  );

  // The database claim locks the membership row and permits exactly the
  // invitation-to-active transition. A cancelled or suspended account can
  // therefore never be reactivated by a delayed SSO request.
  const { data: membershipClaim, error: membershipClaimError } =
    await admin.rpc("claim_verified_tenant_sso_membership", {
      p_tenant_id: tenantId,
      p_user_id: userId,
      p_email: email,
    });
  // PostgreSQL `returns table` RPCs are serialised by PostgREST as a one-row
  // array. Treat every other shape as a failed closed claim, never as a
  // permission to create a membership.
  const claimedMembership = Array.isArray(membershipClaim)
    ? membershipClaim[0]
    : membershipClaim;
  if (membershipClaimError || !isRecord(claimedMembership)) return "failed";
  const membershipStatus = claimedMembership.status;
  const wasActive = claimedMembership.was_active === true;
  if (membershipStatus === "removed") return "removed";
  if (membershipStatus !== "active") return "failed";

  let directoryLink: EntraDirectoryLink = {
    status: "not_found",
    department: null,
  };
  if (entraObjectId) {
    directoryLink = await linkEntraDirectoryPerson(
      admin,
      tenantId,
      userId,
      email,
      entraObjectId,
    );
  }
  if (directoryLink.status === "conflict") return "failed";
  if (directoryLink.status === "failed" && !wasActive) {
    return "failed";
  }
  if (directoryLink.status === "failed") {
    // Directory enrichment must not lock out a person who is already an active,
    // verified member of this tenant. The SSO tenant and domain checks above
    // remain mandatory; the next successful sign-in can retry the enrichment.
    directoryLink = {
      status: "not_found",
      department: null,
    };
  }

  // An existing authorised person has passed the locked membership claim. The
  // bootstrap above does not overwrite an existing profile; preserve the
  // established behaviour of refreshing it only from a trusted Azure name.
  if (wasActive) {
    if (ssoDisplayName) {
      await admin
        .from("user_profiles")
        .upsert({ id: userId, display_name: ssoDisplayName });
    }
    await initialiseEntraRequesterProfile(
      admin,
      tenantId,
      userId,
      directoryLink.department,
    );
    await applyRequestedEntraAgentAccess(
      admin,
      tenantId,
      userId,
      entraObjectId,
    );
    return "existing";
  }

  // The Entra tenant claim and the unique allowed-domain binding have already
  // been verified before this point. A matching employee may therefore enter
  // their own tenant as a normal requester without an invitation. An explicit
  // invitation remains the only way to assign a non-requester role or agent
  // department at first sign-in. A manually and explicitly requested Entra
  // agent assignment is the only additional, tenant-admin-controlled path.
  const invitation = invitationFromMembershipClaim(
    claimedMembership.invitation,
  );

  const joinedAt = new Date().toISOString();

  const displayName =
    ssoDisplayName ??
    invitation?.display_name?.trim() ??
    displayNameFromEmail(user?.email);
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

  const invitationAgentDepartmentId = invitation?.wants_agent
    ? (invitation.department_id ?? null)
    : null;
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
    (invitationAgentDepartmentId !== null &&
      !(await ensureSupportAgentRole(
        admin,
        tenantId,
        userId,
        invitationAgentDepartmentId,
        invitation?.invited_by ?? userId,
      )))
  ) {
    return "failed";
  }

  await initialiseEntraRequesterProfile(
    admin,
    tenantId,
    userId,
    directoryLink.department,
  );
  await applyRequestedEntraAgentAccess(admin, tenantId, userId, entraObjectId);

  if (invitation) {
    const { data: acceptedInvitation, error: invitationUpdateError } =
      await admin
        .from("tenant_user_invitations")
        .update({ status: "accepted", accepted_at: joinedAt })
        .eq("id", invitation.id)
        .eq("tenant_id", tenantId)
        .eq("status", "sent")
        .eq("accepted_by", userId)
        .select("id");
    if (
      invitationUpdateError ||
      !Array.isArray(acceptedInvitation) ||
      acceptedInvitation.length !== 1
    ) {
      return "failed";
    }

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
  if (typeof actorId !== "string") {
    return error(request, "sso_email_claim_required", 403);
  }

  // Use the canonical auth record for domain routing. OAuth provider claims in
  // a freshly exchanged JWT can lag behind the identity persisted by Supabase;
  // the server-loaded e-mail remains bound to the authenticated actor below.
  const { data: userData, error: userError } =
    await context.supabaseAdmin.auth.admin.getUserById(actorId);
  if (userError || !userData.user) {
    return error(request, "sso_identity_lookup_failed", 500);
  }
  const email = canonicalAuthEmail(userData.user.email);
  const domain = emailDomain(email);
  if (!email || !domain) {
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

  // The tenant is loaded by the trusted server after its domain binding has
  // been resolved. Returning only this small, already-authorised summary keeps
  // the first browser/mobile workspace selection independent from a second
  // nested PostgREST membership query immediately after SSO.
  const { data: tenantData, error: tenantError } = await context.supabaseAdmin
    .from("tenants")
    .select("id, name, slug")
    .eq("id", sso.tenant_id)
    .eq("status", "active")
    .maybeSingle();
  const tenant = tenantData as TenantSummary | null;
  if (
    tenantError ||
    !tenant ||
    typeof tenant.id !== "string" ||
    typeof tenant.name !== "string" ||
    typeof tenant.slug !== "string"
  ) {
    return error(request, "sso_configuration_not_active", 403);
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

  const entraObjectId = azureObjectId(userData.user.identities);

  const provision = await provisionSsoPerson(
    context.supabaseAdmin,
    userData.user,
    sso.tenant_id,
    email,
    entraObjectId,
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
      tenant,
    },
  });
});

export default {
  fetch(request: Request): Response | Promise<Response> {
    if (request.method === "OPTIONS") return response(request, {}, 204);
    return handler(request);
  },
};
