export type UUID = string;

export type PlatformRole = "platform_operator";
export type TenantRoleScope = "tenant" | "department" | "team";
export type DepartmentKind = "ict" | "infrastructure" | "custom";
export type TicketCommentVisibility = "internal" | "external";
export type CustomerTicketAccess = "disabled" | "own" | "company";

export interface TenantRef {
  id: UUID;
  slug: string;
  status: "active" | "suspended" | "archived";
}

export interface DepartmentRef {
  id: UUID;
  tenantId: UUID;
  key: string;
  kind: DepartmentKind;
}

export interface TicketRef {
  id: UUID;
  tenantId: UUID;
  departmentId: UUID;
  requesterId: UUID;
  affectedUserId?: UUID;
  assigneeId?: UUID;
}
