const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
const tenantUsersSource = await Deno.readTextFile(
  new URL("../tenant-users/index.ts", import.meta.url),
);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test(
  "SSO provisioning claims membership through the locked database RPC",
  () => {
    assert(
      source.includes(
        'await admin.rpc("claim_verified_tenant_sso_membership", {',
      ),
      "SSO provisioning must use the locked membership claim RPC",
    );
    assert(
      source.includes("p_email: email"),
      "The membership claim must be bound to the authenticated email",
    );
    assert(
      source.includes("ensureSsoUserProfileBeforeMembershipClaim"),
      "SSO provisioning must create the profile required by the membership foreign key",
    );
    assert(
      source.indexOf("await ensureSsoUserProfileBeforeMembershipClaim(") <
        source.indexOf(
          'await admin.rpc("claim_verified_tenant_sso_membership", {',
        ),
      "The profile must be established before the locked membership claim for a first-time requester",
    );
    assert(
      source.includes('.from("user_profiles")\n    .upsert('),
      "The SSO profile bootstrap must remain server-side",
    );
    assert(
      source.includes("ignoreDuplicates: true"),
      "The pre-claim profile bootstrap must not overwrite an existing profile",
    );
    assert(
      source.includes(
        "const claimedMembership = Array.isArray(membershipClaim)",
      ),
      "A one-row table RPC result must be read from the PostgREST array",
    );
    assert(
      source.includes("!isRecord(claimedMembership)"),
      "Malformed membership claim responses must fail closed",
    );
    assert(
      !source.includes('.from("tenant_memberships")\n    .upsert('),
      "SSO provisioning must not directly upsert a membership",
    );
    assert(
      source.includes('.from("tenants")') &&
        source.includes('.select("id, name, slug")'),
      "The SSO response must source the initial tenant only from the trusted server",
    );
    assert(
      source.includes('.eq("status", "active")'),
      "The SSO response must never expose a non-active tenant as a workspace",
    );
    assert(
      source.includes("tenant,\n    },"),
      "The verified minimal tenant summary must be returned with tenant-scoped SSO access",
    );
    assert(
      source.includes('.eq("accepted_by", userId)'),
      "Invitation acceptance must be bound to the person recorded by the claim",
    );
    assert(
      source.includes("const email = canonicalAuthEmail(userData.user.email)"),
      "SSO domain routing must use the server-loaded canonical auth e-mail",
    );
    assert(
      !source.includes("context.userClaims?.email"),
      "SSO domain routing must not depend on a potentially stale JWT e-mail mirror",
    );
    assert(
      source.indexOf("auth.admin.getUserById(actorId)") <
        source.indexOf('.from("tenant_sso_allowed_domains")'),
      "The canonical auth record must be loaded before domain routing",
    );
  },
);

Deno.test(
  "SSO links Entra organisational metadata only after verified Azure tenant access",
  () => {
    assert(
      source.includes("entraObjectId: string | null"),
      "The Entra directory link must allow an absent optional object ID.",
    );
    assert(
      source.includes(
        'if (entraObjectId) {\n    directoryLookup = directoryLookup.eq("entra_object_id", entraObjectId);',
      ),
      "A present Entra object ID must remain the preferred directory binding.",
    );
    assert(
      source.includes('.eq("email", email)') &&
        source.includes('.eq("account_enabled", true)') &&
        source.includes('.is("inactive_at", null)'),
      "E-mail fallback must require an active tenant-scoped directory record.",
    );
    assert(
      source.includes("const linkedDirectoryObjectId =") &&
        source.includes('.eq("entra_object_id", linkedDirectoryObjectId)') &&
        !source.includes(
          '.eq("entra_object_id", entraObjectId)\n      .eq("email", email)\n      .is("local_user_id", null)',
        ),
      "The write and race lookup must use the verified source record ID, never a missing OAuth object ID.",
    );
    assert(
      source.includes(
        "job_title: invitation?.job_title ?? directoryLink.jobTitle",
      ) && source.includes("offer: invitation?.offer ?? directoryLink.offer"),
      "A new requester must receive Entra organisation and function data without a role change.",
    );
    assert(
      source.includes("await applyRequestedEntraAgentAccess") &&
        source.includes("if (!entraObjectId) return false"),
      "An Entra metadata fallback must never create an agent assignment.",
    );
  },
);

Deno.test(
  "current invitation acceptance and revocation use the atomic offboarding gates",
  () => {
    assert(
      tenantUsersSource.includes('"claim_current_tenant_user_invitation"'),
      "The current invitation acceptance flow must lock the invitation before activating membership",
    );
    assert(
      tenantUsersSource.includes("p_invitation_id: invitation.id"),
      "The current invitation claim must bind the exact initially listed invitation",
    );
    assert(
      tenantUsersSource.includes(
        "const claimedMembership = Array.isArray(claim)",
      ),
      "Invitation acceptance must read the one-row table RPC response correctly",
    );
    assert(
      tenantUsersSource.includes('.eq("accepted_by", actorId)'),
      "The final acceptance write must remain bound to the accepted person",
    );
    assert(
      tenantUsersSource.includes('"revoke_tenant_user_invitation"'),
      "The current invitation flow must call the offboarding RPC",
    );
    assert(
      !tenantUsersSource.includes(
        '.from("tenant_user_invitations")\n      .update({ status: "revoked" })',
      ),
      "The current invitation flow must not directly revoke without membership cleanup",
    );
  },
);
