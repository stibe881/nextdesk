type AssignmentRole = {
  active: boolean;
  scope: string;
  role_permissions?: Array<{ permission_code: string }> | null;
};

type Assignment = {
  starts_at: string;
  expires_at: string | null;
  roles: AssignmentRole | AssignmentRole[] | null;
};

function relatedRole(value: Assignment["roles"]): AssignmentRole | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function isEffectiveAssignment(
  assignment: Pick<Assignment, "starts_at" | "expires_at">,
  now: string,
): boolean {
  return (
    assignment.starts_at <= now &&
    (assignment.expires_at === null || assignment.expires_at > now)
  );
}

export function canManageServiceStatusFromAssignments(
  assignments: readonly Assignment[],
  now: string,
): boolean {
  return assignments.some((assignment) => {
    const role = relatedRole(assignment.roles);
    return (
      isEffectiveAssignment(assignment, now) &&
      role?.active === true &&
      role.scope === "tenant" &&
      (role.role_permissions ?? []).some(
        (permission) => permission.permission_code === "asset.manage",
      )
    );
  });
}
