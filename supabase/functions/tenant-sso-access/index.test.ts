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
      !source.includes('.from("tenant_memberships")\n    .upsert('),
      "SSO provisioning must not directly upsert a membership",
    );
    assert(
      source.includes('.eq("accepted_by", userId)'),
      "Invitation acceptance must be bound to the person recorded by the claim",
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
