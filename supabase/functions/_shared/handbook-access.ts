/**
 * Decides which handbooks a tenant member may open.
 *
 * - Mitarbeitende: every active member of the tenant.
 * - Agenten: members whose effective role can work tickets.
 * - Administratoren und Installation: tenant administrators only.
 *
 * The rule is deliberately hierarchical: an agent is also an employee, and an
 * administrator sees every handbook. The web app only shows what the
 * `handbooks` Function returns, so this file is the single source of truth.
 */

export const HANDBOOK_IDS = [
  "mitarbeitende",
  "agenten",
  "administratoren",
  "installation",
] as const;

export type HandbookId = (typeof HANDBOOK_IDS)[number];

export type HandbookAudience = "employee" | "agent" | "admin";

export const HANDBOOK_AUDIENCE: Record<HandbookId, HandbookAudience> = {
  mitarbeitende: "employee",
  agenten: "agent",
  administratoren: "admin",
  installation: "admin",
};

export type HandbookRole = {
  name: string;
  scope: string;
  active: boolean;
  role_permissions?: Array<{ permission_code: string }> | null;
};

export type HandbookRoleAssignment = {
  starts_at: string;
  expires_at: string | null;
  roles: HandbookRole | HandbookRole[] | null;
};

export type HandbookAccess = {
  canWorkTickets: boolean;
  isTenantAdmin: boolean;
};

const TENANT_ADMINISTRATOR_ROLE = "Tenant administrator";
const TICKET_WORK_PERMISSIONS = new Set([
  "ticket.read.department",
  "ticket.read.assigned",
  "ticket.update",
]);

export function isHandbookId(value: unknown): value is HandbookId {
  return (
    typeof value === "string" &&
    (HANDBOOK_IDS as readonly string[]).includes(value)
  );
}

function relatedRole(value: HandbookRoleAssignment["roles"]) {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function isEffective(assignment: HandbookRoleAssignment, now: string) {
  return (
    assignment.starts_at <= now &&
    (assignment.expires_at === null || assignment.expires_at > now)
  );
}

/** Mirrors `getMyTicketAccess` in the tenant-users Function. */
export function handbookAccessFromAssignments(
  assignments: HandbookRoleAssignment[],
  now: string,
): HandbookAccess {
  let canWorkTickets = false;
  let isTenantAdmin = false;
  for (const assignment of assignments) {
    const role = relatedRole(assignment.roles);
    if (!role?.active) continue;
    if (role.name === TENANT_ADMINISTRATOR_ROLE && role.scope === "tenant") {
      isTenantAdmin = true;
    }
    if (
      isEffective(assignment, now) &&
      (role.role_permissions ?? []).some((permission) =>
        TICKET_WORK_PERMISSIONS.has(permission.permission_code),
      )
    ) {
      canWorkTickets = true;
    }
  }
  return { canWorkTickets, isTenantAdmin };
}

export function allowedHandbookIds(access: HandbookAccess): HandbookId[] {
  return HANDBOOK_IDS.filter((id) => {
    const audience = HANDBOOK_AUDIENCE[id];
    if (audience === "employee") return true;
    if (audience === "agent")
      return access.canWorkTickets || access.isTenantAdmin;
    return access.isTenantAdmin;
  });
}
