// Account for a synchronised Entra person who has never signed in, created
// when someone orders or acts on their behalf. The account has a confirmed
// e-mail, an active membership (Requester) and is linked to the Entra
// person; their later Microsoft sign-in is linked to it by the verified
// e-mail address (Supabase automatic identity linking).

// deno-lint-ignore no-explicit-any
type Admin = any;

export const ENTRA_PERSON_PREFIX = "entra:";

export class EntraPersonAccountError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export async function ensureEntraPersonAccount(
  admin: Admin,
  tenantId: string,
  entraObjectId: string,
  actorId: string,
): Promise<string> {
  const { data: person, error } = await admin
    .from("tenant_entra_directory_people")
    .select(
      "entra_object_id, email, display_name, job_title, source_department_name, local_user_id, account_enabled, inactive_at",
    )
    .eq("tenant_id", tenantId)
    .eq("entra_object_id", entraObjectId)
    .maybeSingle();
  if (error) throw new EntraPersonAccountError("entra_person_lookup_failed");
  if (!person || person.account_enabled !== true || person.inactive_at) {
    throw new EntraPersonAccountError("entra_person_not_active");
  }
  if (typeof person.local_user_id === "string") return person.local_user_id;
  const email = String(person.email ?? "").trim().toLowerCase();
  if (!email.includes("@")) {
    throw new EntraPersonAccountError("entra_person_without_email");
  }

  let userId: string | null = null;
  const { data: existing } = await admin.rpc("find_auth_user_id_by_email", {
    p_email: email,
  });
  if (typeof existing === "string") userId = existing;
  if (!userId) {
    const { data: created, error: createError } =
      await admin.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { full_name: person.display_name ?? null },
      });
    if (createError || !created?.user?.id) {
      const { data: raced } = await admin.rpc("find_auth_user_id_by_email", {
        p_email: email,
      });
      if (typeof raced !== "string") {
        throw new EntraPersonAccountError("entra_person_account_failed");
      }
      userId = raced;
    } else {
      userId = created.user.id as string;
    }
  }

  const { error: profileError } = await admin
    .from("user_profiles")
    .upsert(
      { id: userId, display_name: person.display_name ?? null },
      { onConflict: "id", ignoreDuplicates: true },
    );
  if (profileError) throw new EntraPersonAccountError("entra_person_account_failed");

  const { data: membership } = await admin
    .from("tenant_memberships")
    .select("status")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!membership) {
    const { error: membershipError } = await admin
      .from("tenant_memberships")
      .insert({ tenant_id: tenantId, user_id: userId, status: "active" });
    if (membershipError) {
      throw new EntraPersonAccountError("entra_person_account_failed");
    }
  } else if (membership.status !== "active") {
    // Suspended or removed people are not reactivated through an order.
    throw new EntraPersonAccountError("entra_person_not_active");
  }

  // Requester role (tenant scope), like on a first Microsoft sign-in.
  const { data: role } = await admin
    .from("roles")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("name", "Requester")
    .eq("scope", "tenant")
    .eq("active", true)
    .maybeSingle();
  if (role?.id) {
    const { data: assignment } = await admin
      .from("user_role_assignments")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("user_id", userId)
      .eq("role_id", role.id)
      .is("expires_at", null)
      .maybeSingle();
    if (!assignment) {
      await admin.from("user_role_assignments").insert({
        tenant_id: tenantId,
        user_id: userId,
        role_id: role.id,
        assigned_by: actorId,
      });
    }
  }
  await admin.from("tenant_member_directory").upsert(
    {
      tenant_id: tenantId,
      user_id: userId,
      job_title: person.job_title ?? null,
      offer: person.source_department_name ?? null,
    },
    { onConflict: "tenant_id,user_id", ignoreDuplicates: true },
  );
  // The membership trigger links by e-mail; make sure the link exists.
  await admin
    .from("tenant_entra_directory_people")
    .update({ local_user_id: userId })
    .eq("tenant_id", tenantId)
    .eq("entra_object_id", entraObjectId)
    .is("local_user_id", null);
  await admin.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_id: actorId,
    action: "tenant.entra_person.account_prepared",
    entity_type: "tenant_entra_directory_person",
    entity_id: entraObjectId,
    severity: "info",
    metadata: { source: "on_behalf" },
  });
  return userId;
}
