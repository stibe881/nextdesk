import { describe, expect, it } from "vitest";
import {
  canPerformTenantAction,
  canReadTicket,
  canReadTicketComment,
  type ActorContext,
} from "../src";

const tenantA = "11111111-1111-4111-8111-111111111111";
const tenantB = "22222222-2222-4222-8222-222222222222";
const ict = "33333333-3333-4333-8333-333333333333";
const infrastructure = "44444444-4444-4444-8444-444444444444";

const ictAgent: ActorContext = {
  userId: "agent-ict",
  isPlatformOperator: false,
  permissionGrants: [
    {
      permission: "ticket.read.department",
      scope: "department",
      tenantId: tenantA,
      departmentId: ict,
    },
    {
      permission: "ticket.read.assigned",
      scope: "department",
      tenantId: tenantA,
      departmentId: ict,
    },
    {
      permission: "ticket.internal_notes.read",
      scope: "department",
      tenantId: tenantA,
      departmentId: ict,
    },
  ],
  memberships: [{ tenantId: tenantA, active: true, departmentIds: [ict] }],
};

const requester: ActorContext = {
  userId: "requester-a",
  isPlatformOperator: false,
  permissionGrants: [
    { permission: "ticket.read.own", scope: "tenant", tenantId: tenantA },
    { permission: "ticket.create", scope: "tenant", tenantId: tenantA },
  ],
  memberships: [{ tenantId: tenantA, active: true, departmentIds: [] }],
};

const ictTicket = {
  id: "ticket-ict",
  tenantId: tenantA,
  departmentId: ict,
  requesterId: "requester-a",
};
const infrastructureTicket = {
  id: "ticket-inf",
  tenantId: tenantA,
  departmentId: infrastructure,
  requesterId: "requester-b",
};

describe("TicketHub permission evaluation", () => {
  it("isolates department ticket visibility for ICT agents", () => {
    expect(canReadTicket({ actor: ictAgent, ticket: ictTicket })).toBe(true);
    expect(
      canReadTicket({ actor: ictAgent, ticket: infrastructureTicket }),
    ).toBe(false);
  });

  it("does not allow a requester to read another requester's ticket", () => {
    expect(canReadTicket({ actor: requester, ticket: ictTicket })).toBe(true);
    expect(
      canReadTicket({ actor: requester, ticket: infrastructureTicket }),
    ).toBe(false);
  });

  it("keeps internal comments private by default", () => {
    expect(
      canReadTicketComment({
        actor: requester,
        ticket: ictTicket,
        visibility: "internal",
      }),
    ).toBe(false);
    expect(
      canReadTicketComment({
        actor: ictAgent,
        ticket: ictTicket,
        visibility: "internal",
      }),
    ).toBe(true);
    expect(
      canReadTicketComment({
        actor: requester,
        ticket: ictTicket,
        visibility: "external",
      }),
    ).toBe(true);
  });

  it("rejects a grant scoped to another tenant", () => {
    const actor: ActorContext = {
      ...requester,
      permissionGrants: [
        { permission: "ticket.create", scope: "tenant", tenantId: tenantB },
      ],
    };
    expect(
      canPerformTenantAction({
        actor,
        tenantId: tenantA,
        permission: "ticket.create",
      }),
    ).toBe(false);
  });

  it("requires an active department membership for department grants", () => {
    const actor: ActorContext = {
      ...ictAgent,
      memberships: [{ tenantId: tenantA, active: true, departmentIds: [] }],
    };
    expect(canReadTicket({ actor, ticket: ictTicket })).toBe(false);
  });

  it("does not accept expired permission grants", () => {
    const actor: ActorContext = {
      ...requester,
      permissionGrants: [
        {
          permission: "ticket.read.own",
          scope: "tenant",
          tenantId: tenantA,
          expiresAt: "2025-01-01T00:00:00Z",
        },
      ],
    };
    expect(
      canReadTicket({
        actor,
        ticket: ictTicket,
        now: new Date("2026-01-01T00:00:00Z"),
      }),
    ).toBe(false);
  });

  it("requires operator state and a platform-scoped grant for global actions", () => {
    const operator: ActorContext = {
      userId: "operator",
      isPlatformOperator: true,
      permissionGrants: [
        { permission: "platform.tenants.manage", scope: "platform" },
      ],
      memberships: [{ tenantId: tenantA, active: true, departmentIds: [] }],
    };
    expect(
      canPerformTenantAction({
        actor: operator,
        tenantId: tenantA,
        permission: "platform.tenants.manage",
      }),
    ).toBe(true);
    expect(
      canPerformTenantAction({
        actor: ictAgent,
        tenantId: tenantA,
        permission: "platform.tenants.manage",
      }),
    ).toBe(false);
  });
});
