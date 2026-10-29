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
  teamId: string | null = null,
): Promise<{ agents: TicketAgent[]; error: boolean }> {
  const now = new Date().toISOString();
  const [
    { data: tenantMemberships, error: tenantMembershipsError },
    { data: departmentMemberships, error: departmentMembershipsError },
    { data: roleAssignments, error: roleAssignmentsError },
    { data: teamMemberships, error: teamMembershipsError },
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
    teamId
      ? admin
          .from("team_memberships")
          .select("user_id")
          .eq("tenant_id", tenantId)
          .eq("team_id", teamId)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (
    tenantMembershipsError ||
    departmentMembershipsError ||
    roleAssignmentsError ||
    teamMembershipsError
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
      activeDepartmentMemberIds.has(assignment.user_id) &&
      (tenantScopedAgent || departmentScopedAgent)
    ) {
      agentIds.add(assignment.user_id);
    }
  }
  if (teamId) {
    const teamMemberIds = new Set(
      (teamMemberships ?? []).flatMap((membership: any) =>
        isUuid(membership.user_id) ? [membership.user_id] : [],
      ),
    );
    for (const agentId of agentIds) {
      if (
        !teamMemberIds.has(agentId) ||
        !activeDepartmentMemberIds.has(agentId)
      )
        agentIds.delete(agentId);
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

// The tenant-wide directory endpoint needs the same assignment semantics for
// several already-authorized departments. Loading memberships and role grants
// once keeps the server as the source of truth without repeating the same
// tenant-wide lookups for each department.
export async function listAssignableAgentsForDepartments(
  admin: any,
  tenantId: string,
  departmentIds: readonly string[],
): Promise<{
  agentsByDepartmentId: Map<string, TicketAgent[]>;
  error: boolean;
}> {
  const requestedDepartmentIds = [...new Set(departmentIds.filter(isUuid))];
  const agentsByDepartmentId = new Map<string, TicketAgent[]>(
    requestedDepartmentIds.map((departmentId) => [departmentId, []]),
  );
  if (requestedDepartmentIds.length === 0) {
    return { agentsByDepartmentId, error: false };
  }

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
      .select("department_id, user_id")
      .eq("tenant_id", tenantId)
      .eq("status", "active")
      .in("department_id", requestedDepartmentIds),
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
    return { agentsByDepartmentId, error: true };
  }

  const activeTenantMemberIds = new Set(
    (tenantMemberships ?? []).flatMap((membership: any) =>
      isUuid(membership.user_id) ? [membership.user_id] : [],
    ),
  );
  const activeDepartmentsByUserId = new Map<string, Set<string>>();
  for (const membership of departmentMemberships ?? []) {
    if (!isUuid(membership.user_id) || !isUuid(membership.department_id)) {
      continue;
    }
    const departments =
      activeDepartmentsByUserId.get(membership.user_id) ?? new Set<string>();
    departments.add(membership.department_id);
    activeDepartmentsByUserId.set(membership.user_id, departments);
  }

  const agentIdsByDepartmentId = new Map<string, Set<string>>(
    requestedDepartmentIds.map((departmentId) => [departmentId, new Set()]),
  );
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
    if (
      !canHandleAssignedTickets ||
      role?.tenant_id !== tenantId ||
      role?.active !== true
    ) {
      continue;
    }

    if (role.scope === "tenant") {
      for (const departmentId of activeDepartmentsByUserId.get(
        assignment.user_id,
      ) ?? []) {
        agentIdsByDepartmentId.get(departmentId)?.add(assignment.user_id);
      }
      continue;
    }
    if (
      role.scope === "department" &&
      isUuid(assignment.department_id) &&
      activeDepartmentsByUserId
        .get(assignment.user_id)
        ?.has(assignment.department_id)
    ) {
      agentIdsByDepartmentId
        .get(assignment.department_id)
        ?.add(assignment.user_id);
    }
  }

  const agentIds = [
    ...new Set([...agentIdsByDepartmentId.values()].flatMap((ids) => [...ids])),
  ];
  const profileNames = new Map<string, string>();
  if (agentIds.length > 0) {
    const { data: profiles, error: profilesError } = await admin
      .from("user_profiles")
      .select("id, display_name")
      .in("id", agentIds);
    if (profilesError) return { agentsByDepartmentId, error: true };
    for (const profile of profiles ?? []) {
      if (
        isUuid(profile.id) &&
        typeof profile.display_name === "string" &&
        profile.display_name.trim()
      ) {
        profileNames.set(profile.id, profile.display_name.trim());
      }
    }
  }

  for (const [departmentId, ids] of agentIdsByDepartmentId) {
    const agents = [...ids].map((id) => ({
      id,
      displayName: profileNames.get(id) ?? "Aktiver Agent",
    }));
    agents.sort(
      (left, right) =>
        left.displayName.localeCompare(right.displayName, "de-CH", {
          sensitivity: "base",
        }) || left.id.localeCompare(right.id),
    );
    agentsByDepartmentId.set(departmentId, agents);
  }
  return { agentsByDepartmentId, error: false };
}

// Services gehören keiner einzelnen Ticketabteilung. Die Auswahl bleibt dennoch
// streng: Ein:e Verantwortliche:r muss aktiv Mitglied sein, mindestens einer
// aktiven Abteilung angehören und aktuell über eine effektive Ticketrolle mit
// Bearbeitungszugriff verfügen. Teamrollen zählen bewusst nicht.
export async function listAssignableTenantSupportAgents(
  admin: any,
  tenantId: string,
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
      .select("department_id, user_id")
      .eq("tenant_id", tenantId)
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
  const activeDepartmentsByUserId = new Map<string, Set<string>>();
  for (const membership of departmentMemberships ?? []) {
    if (!isUuid(membership.user_id) || !isUuid(membership.department_id)) {
      continue;
    }
    const departments =
      activeDepartmentsByUserId.get(membership.user_id) ?? new Set<string>();
    departments.add(membership.department_id);
    activeDepartmentsByUserId.set(membership.user_id, departments);
  }

  const agentIds = new Set<string>();
  for (const assignment of roleAssignments ?? []) {
    if (
      !isUuid(assignment.user_id) ||
      !activeTenantMemberIds.has(assignment.user_id)
    ) {
      continue;
    }
    const activeDepartments = activeDepartmentsByUserId.get(
      assignment.user_id,
    );
    if (!activeDepartments || activeDepartments.size === 0) continue;
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
      isUuid(assignment.department_id) &&
      activeDepartments.has(assignment.department_id);
    if (canHandleAssignedTickets && (tenantScopedAgent || departmentScopedAgent)) {
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
    if (
      isUuid(profile.id) &&
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
