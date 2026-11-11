import { describe, expect, it } from "vitest";

import { notificationTarget } from "./notification-target";

const id = "20000000-0000-4000-8000-000000000002";

describe("notificationTarget", () => {
  it("öffnet das Ticket für alle Ticket-Benachrichtigungen", () => {
    for (const kind of [
      "ticket.assigned",
      "ticket.requester_reply",
      "ticket.mention",
      "ticket.watch.comment",
      "ticket.approval.requested",
      "ticket.department_question.asked",
      "ticket.sla.supervisor_risk",
      "ticket.follow_up_due",
      "ticket.kudos",
    ]) {
      expect(
        notificationTarget({ kind, payload: {}, ticketId: id }),
        kind,
      ).toEqual({ type: "ticket", ticketId: id });
    }
  });

  it("hat für jede bekannte Art ohne Ticket ein Ziel", () => {
    for (const kind of [
      "security.case_overdue",
      "monitoring.incident",
      "monitoring.ipam_finding",
      "ipam.finding",
      "ipam.agent_offline",
      "ipam.reservation_expiring",
      "shop.order.approval_requested",
      "inventory.low_stock",
      "inventory.reorder",
      "inventory.count_due",
      "service_task.due",
      "service_task.overdue",
      "infrastructure.due",
      "maintenance.upcoming",
      "team.overload",
      "problem.recurring_detected",
      "license.reclaim_candidates",
      "contract.deadline",
      "delegation.started",
      "delegation.ended",
    ]) {
      expect(
        notificationTarget({ kind, payload: {}, ticketId: null }),
        kind,
      ).not.toBeNull();
    }
    expect(
      notificationTarget({ kind: "unknown", payload: {}, ticketId: null }),
    ).toBeNull();
  });

  it("fokussiert das auslösende Objekt", () => {
    expect(
      notificationTarget({
        kind: "security.campaign",
        payload: {},
        ticketId: id,
      }),
    ).toEqual({
      type: "section",
      section: "Sicherheitsfälle",
      focus: { kind: "security", id },
    });
    expect(
      notificationTarget({
        kind: "monitoring.incident",
        payload: { incidentId: id },
        ticketId: null,
      }),
    ).toEqual({
      type: "section",
      section: "Störungen",
      focus: { kind: "incident", id },
    });
    expect(
      notificationTarget({
        kind: "shop.order.ready",
        payload: { orderId: id, orderNumber: "B-1" },
        ticketId: null,
      }),
    ).toMatchObject({ section: "Shop", focus: { kind: "shopOrder", id } });
    expect(
      notificationTarget({
        kind: "inventory.reorder",
        payload: { inventoryItemId: id },
        ticketId: null,
      }),
    ).toMatchObject({ section: "Lager", focus: { kind: "inventoryItem", id } });
    expect(
      notificationTarget({
        kind: "service_task.overdue",
        payload: { occurrenceId: id },
        ticketId: null,
      }),
    ).toMatchObject({ focus: { kind: "serviceTask", id } });
    expect(
      notificationTarget({
        kind: "infrastructure.due",
        payload: { assetId: id },
        ticketId: null,
      }),
    ).toMatchObject({ focus: { kind: "infrastructureDevice", id } });
  });

  it("öffnet IP-Adressen, Netze, Funde und Agenten", () => {
    expect(
      notificationTarget({
        kind: "ipam.reservation_expiring",
        payload: { addressId: id, address: "10.0.0.5" },
        ticketId: null,
      }),
    ).toMatchObject({
      focus: { kind: "ipam", addressId: id, ip: null, view: null },
    });
    expect(
      notificationTarget({
        kind: "ipam.finding",
        payload: { address: "10.0.0.5", findingId: id },
        ticketId: null,
      }),
    ).toMatchObject({ focus: { kind: "ipam", ip: "10.0.0.5" } });
    expect(
      notificationTarget({
        kind: "ipam.finding",
        payload: { prefixId: id },
        ticketId: null,
      }),
    ).toMatchObject({ focus: { kind: "ipam", prefixId: id, view: null } });
    expect(
      notificationTarget({ kind: "ipam.finding", payload: {}, ticketId: null }),
    ).toMatchObject({ focus: { kind: "ipam", view: "findings" } });
    expect(
      notificationTarget({
        kind: "ipam.agent_offline",
        payload: { agentId: id },
        ticketId: null,
      }),
    ).toMatchObject({ focus: { kind: "ipam", view: "discovery" } });
  });

  it("ignoriert Kennungen, die keine UUID sind", () => {
    expect(
      notificationTarget({
        kind: "monitoring.incident",
        payload: { incidentId: "x" },
        ticketId: null,
      }),
    ).toEqual({ type: "section", section: "Störungen" });
  });
});
