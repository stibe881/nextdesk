// Gemeinsame, fail-closed Ermittlung zuweisbarer Agenten eines Mandanten.
// Agent ist nur, wer aktiv Mitglied ist und über eine aktive Rolle mit
// ticket.read.assigned oder ticket.update verfügt (mandantenweit oder für die
// Abteilung des Tickets). Personen aus Entra werden dadurch nie automatisch zu
// Agenten.
export type TicketAgent = {
  id: string;
  displayName: string;
};
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isUuid = (value: unknown): value is string =>
  typeof value === "string" && UUID_PATTERN.test(value);
export async function listAssignableAgents(
  admin: any,
  tenantId: string,
  departmentId: string,
): Promise<{ agents: TicketAgent[]; error: boolean }> {
  const now = new Date().toISOString();
  const [
    { data: tenantMemberships, error: tenantMembershipsError },
    { data: departmentMemberships, error: departmentMembershipsError },
    { data: roleAssignments, error: roleAssignmentsError },
  ] = await Promise.all([
    admin
      .from("tenant_memberships")
      .select("user_id")
      .eq("tenant_id", tenantId)
      .eq("status", "active"),
    admin
      .from("department_memberships")
      .select("user_id")
      .eq("tenant_id", tenantId)
      .eq("department_id", departmentId)
      .eq("status", "active"),
    admin
      .from("user_role_assignments")
      .select(
        "user_id, department_id, roles!user_role_assignments_role_tenant_fk!inner(tenant_id, active, scope, role_permissions!inner(permission_code))",
      )
      .eq("tenant_id", tenantId)
      .lte("starts_at", now)
      .or(`expires_at.is.null,expires_at.gt.${now}`),
  ]);
  if (
    tenantMembershipsError ||
    departmentMembershipsError ||
    roleAssignmentsError
  ) {
    return { agents: [], error: true };
  }

  const activeTenantMemberIds = new Set(
    (tenantMemberships ?? []).flatMap((membership: any) =>
      isUuid(membership.user_id) ? [membership.user_id] : [],
    ),
  );
  const activeDepartmentMemberIds = new Set(
    (departmentMemberships ?? []).flatMap((membership: any) =>
      isUuid(membership.user_id) ? [membership.user_id] : [],
    ),
  );
  const agentIds = new Set<string>();
  for (const assignment of roleAssignments ?? []) {
    if (
      !isUuid(assignment.user_id) ||
      !activeTenantMemberIds.has(assignment.user_id)
    ) {
      continue;
    }
    const role = Array.isArray(assignment.roles)
      ? assignment.roles[0]
      : assignment.roles;
    const canHandleAssignedTickets = (role?.role_permissions ?? []).some(
      (permission: any) =>
        permission.permission_code === "ticket.read.assigned" ||
        permission.permission_code === "ticket.update",
    );
    const tenantScopedAgent =
      role?.tenant_id === tenantId &&
      role?.active === true &&
      role.scope === "tenant";
    const departmentScopedAgent =
      role?.tenant_id === tenantId &&
      role?.active === true &&
      role.scope === "department" &&
      assignment.department_id === departmentId &&
      activeDepartmentMemberIds.has(assignment.user_id);
    if (
      canHandleAssignedTickets &&
      (tenantScopedAgent || departmentScopedAgent)
    ) {
      agentIds.add(assignment.user_id);
    }
  }
  if (agentIds.size === 0) return { agents: [], error: false };

  const { data: profiles, error: profilesError } = await admin
    .from("user_profiles")
    .select("id, display_name")
    .in("id", [...agentIds]);
  if (profilesError) return { agents: [], error: true };

  const profileNames = new Map<string, string>();
  for (const profile of profiles ?? []) {
    if (!isUuid(profile.id)) continue;
    if (
      typeof profile.display_name === "string" &&
      profile.display_name.trim()
    ) {
      profileNames.set(profile.id, profile.display_name.trim());
    }
  }
  const agents = [...agentIds].map((id) => ({
    id,
    displayName: profileNames.get(id) ?? "Aktiver Agent",
  }));
  agents.sort(
    (left, right) =>
      left.displayName.localeCompare(right.displayName, "de-CH", {
        sensitivity: "base",
      }) || left.id.localeCompare(right.id),
  );
  return { agents, error: false };
}
