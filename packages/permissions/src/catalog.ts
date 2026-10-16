export const permissionCodes = [
  "ticket.create",
  "ticket.read.own",
  "ticket.read.assigned",
  "ticket.read.department",
  "ticket.update",
  "ticket.assign",
  "ticket.close",
  "ticket.delete",
  "ticket.merge",
  "ticket.export",
  "ticket.internal_notes.read",
  "ticket.internal_notes.write",
  "department.manage",
  "team.manage",
  "user.manage",
  "role.manage",
  "report.read",
  "automation.manage",
  "knowledge.manage",
  "asset.manage",
  "tenant.settings.manage",
  "platform.tenants.manage",
  "platform.support_access.request",
] as const;

export type PermissionCode = (typeof permissionCodes)[number];

export const sensitivePermissions: readonly PermissionCode[] = [
  "ticket.export",
  "ticket.delete",
  "role.manage",
  "platform.tenants.manage",
  "platform.support_access.request",
];
