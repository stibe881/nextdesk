import type { TicketCommentVisibility, TicketRef, UUID } from "@nextdesk/types";
import type { PermissionCode } from "./catalog";

export interface MembershipContext {
  tenantId: UUID;
  active: boolean;
  departmentIds: readonly UUID[];
}

export interface PermissionGrant {
  permission: PermissionCode;
  scope: "platform" | "tenant" | "department" | "team";
  tenantId?: UUID;
  departmentId?: UUID;
  expiresAt?: string;
}

export interface ActorContext {
  userId: UUID;
  isPlatformOperator: boolean;
  permissionGrants: readonly PermissionGrant[];
  memberships: readonly MembershipContext[];
}

export interface TenantActionInput {
  actor: ActorContext;
  tenantId: UUID;
  permission: PermissionCode;
  departmentId?: UUID;
  now?: Date;
}

export interface TicketReadInput {
  actor: ActorContext;
  ticket: TicketRef;
  now?: Date;
}

export interface CommentReadInput extends TicketReadInput {
  visibility: TicketCommentVisibility;
}

function activeMembership(
  actor: ActorContext,
  tenantId: UUID,
): MembershipContext | undefined {
  return actor.memberships.find(
    (membership) => membership.tenantId === tenantId && membership.active,
  );
}

function grantIsActive(grant: PermissionGrant, now: Date): boolean {
  return (
    grant.expiresAt === undefined ||
    new Date(grant.expiresAt).getTime() > now.getTime()
  );
}

function hasPermission(
  actor: ActorContext,
  tenantId: UUID,
  permission: PermissionCode,
  options: { departmentId?: UUID | undefined; allowPlatform?: boolean },
  now: Date,
): boolean {
  const hasActivePlatformGrant = actor.permissionGrants.some(
    (grant) =>
      grant.permission === permission &&
      grant.scope === "platform" &&
      permission.startsWith("platform.") &&
      actor.isPlatformOperator &&
      grantIsActive(grant, now),
  );
  if (options.allowPlatform === true && hasActivePlatformGrant) {
    return true;
  }

  const membership = activeMembership(actor, tenantId);
  if (!membership) {
    return false;
  }

  return actor.permissionGrants.some((grant) => {
    if (grant.permission !== permission || !grantIsActive(grant, now)) {
      return false;
    }

    if (grant.scope === "platform") {
      return options.allowPlatform === true && actor.isPlatformOperator;
    }

    if (grant.tenantId !== tenantId) {
      return false;
    }

    if (grant.scope === "tenant") {
      return true;
    }

    if (grant.scope === "department") {
      return (
        options.departmentId !== undefined &&
        grant.departmentId === options.departmentId &&
        membership.departmentIds.includes(options.departmentId)
      );
    }

    // Team grants must be checked against an explicit ticket/team relation by a future evaluator.
    return false;
  });
}

export function canPerformTenantAction(input: TenantActionInput): boolean {
  const { actor, tenantId, permission, departmentId, now = new Date() } = input;

  if (permission.startsWith("platform.")) {
    return hasPermission(
      actor,
      tenantId,
      permission,
      { allowPlatform: true },
      now,
    );
  }

  return hasPermission(actor, tenantId, permission, { departmentId }, now);
}

export function canReadTicket({
  actor,
  ticket,
  now = new Date(),
}: TicketReadInput): boolean {
  const isRequester =
    ticket.requesterId === actor.userId ||
    ticket.affectedUserId === actor.userId;
  if (
    isRequester &&
    hasPermission(actor, ticket.tenantId, "ticket.read.own", {}, now)
  ) {
    return true;
  }

  const isAssigned = ticket.assigneeId === actor.userId;
  if (
    isAssigned &&
    hasPermission(
      actor,
      ticket.tenantId,
      "ticket.read.assigned",
      { departmentId: ticket.departmentId },
      now,
    )
  ) {
    return true;
  }

  return hasPermission(
    actor,
    ticket.tenantId,
    "ticket.read.department",
    { departmentId: ticket.departmentId },
    now,
  );
}

export function canReadTicketComment(input: CommentReadInput): boolean {
  if (!canReadTicket(input)) {
    return false;
  }

  return (
    input.visibility === "external" ||
    hasPermission(
      input.actor,
      input.ticket.tenantId,
      "ticket.internal_notes.read",
      { departmentId: input.ticket.departmentId },
      input.now ?? new Date(),
    )
  );
}
