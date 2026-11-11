import { describe, expect, it } from "vitest";

import {
  formatInboxTime,
  inboxNavigationData,
  inboxPresentation,
  inboxRoute,
  inboxUnreadCount,
  type InboxNotification,
  markInboxRead,
  parseInboxNotifications,
  pushKindForNotification,
} from "../lib/notification-inbox-model";
import { PUSH_PAYLOAD_KINDS } from "../lib/push-navigation";

const tenantId = "10000000-0000-4000-8000-000000000001";
const id = "20000000-0000-4000-8000-000000000002";
const other = "30000000-0000-4000-8000-000000000003";

function item(
  kind: string,
  payload: Record<string, unknown> = {},
  ticket: InboxNotification["ticket"] = null,
): InboxNotification {
  return {
    id: other,
    tenantId,
    kind,
    payload,
    readAt: null,
    createdAt: "2026-11-11T10:00:00.000Z",
    ticket,
  };
}

const ticket = { id, ticketNumber: "ICT-2026-000041", subject: "Drucker" };

describe("parseInboxNotifications", () => {
  it("liest die Antwort von notification-center", () => {
    const parsed = parseInboxNotifications({
      data: {
        notifications: [
          {
            id: other,
            tenantId,
            kind: "ticket.assigned",
            payload: { a: 1 },
            readAt: null,
            createdAt: "2026-11-11T10:00:00.000Z",
            ticket,
          },
          {
            id,
            tenantId,
            kind: "shop.order.ready",
            payload: null,
            readAt: "2026-11-11T11:00:00.000Z",
            createdAt: "2026-11-11T09:00:00.000Z",
            ticket: null,
          },
        ],
      },
    });
    expect(parsed).toHaveLength(2);
    expect(parsed?.[0]?.ticket).toEqual(ticket);
    expect(parsed?.[1]?.payload).toEqual({});
  });

  it("lehnt falsche Formen ab", () => {
    expect(parseInboxNotifications(null)).toBeNull();
    expect(parseInboxNotifications({ data: {} })).toBeNull();
    expect(
      parseInboxNotifications({ data: { notifications: [{ id: 1 }] } }),
    ).toBeNull();
  });
});

describe("pushKindForNotification", () => {
  it("bildet jede Art auf eine bekannte Push-Art ab", () => {
    const kinds = [
      "ticket.assigned",
      "ticket.requester_reply",
      "ticket.support_reply",
      "ticket.requester_reminder",
      "ticket.mention",
      "ticket.supervisor_request",
      "ticket.supervisor_answer",
      "ticket.watch.status_changed",
      "ticket.resolved",
      "ticket.kudos",
      "ticket.approval.requested",
      "ticket.department_question.asked",
      "ticket.department_question.answered",
      "ticket.escalation_opened",
      "ticket.security_report",
      "security.case_overdue",
      "security.campaign",
      "ticket.follow_up_due",
      "ticket.rule_reminder",
      "ticket.vendor_reminder",
      "ticket.children_done",
      "ticket.sla.first_response_breached",
      "contract.deadline",
      "inventory.low_stock",
      "inventory.count_due",
      "shop.order.ready",
      "service_task.overdue",
      "infrastructure.due",
      "ipam.finding",
      "ipam.agent_offline",
      "monitoring.ipam_finding",
      "monitoring.down",
    ];
    for (const kind of kinds) {
      const pushKind = pushKindForNotification(kind);
      expect(
        (PUSH_PAYLOAD_KINDS as readonly string[]).includes(pushKind),
        kind,
      ).toBe(true);
    }
    expect(pushKindForNotification("monitoring.ipam_finding")).toBe("ipam");
    expect(pushKindForNotification("delegation.started")).toBe("");
  });
});

describe("inboxRoute (dieselbe Tabelle wie Push)", () => {
  it("öffnet Tickets und Sicherheitsfälle", () => {
    expect(inboxRoute(item("ticket.assigned", {}, ticket))).toEqual({
      kind: "ticket",
      ticketId: id,
    });
    expect(inboxRoute(item("security.case_overdue", {}, ticket))).toEqual({
      kind: "path",
      path: `/phishing/${id}`,
    });
  });

  it("öffnet Bestellung, Störung, Gerät, Serviceaufgabe und Lager", () => {
    expect(inboxRoute(item("shop.order.ready", { orderId: id }))).toEqual({
      kind: "path",
      path: `/shop/order/${id}`,
      feature: "self_service.shop",
    });
    expect(inboxRoute(item("monitoring.down", { incidentId: id }))).toEqual({
      kind: "path",
      path: `/incidents/${id}`,
    });
    expect(inboxRoute(item("infrastructure.due", { assetId: id }))).toEqual({
      kind: "path",
      path: `/infrastructure/${id}`,
      feature: "assets.management",
    });
    expect(
      inboxRoute(item("service_task.due", { occurrenceId: id })),
    ).toMatchObject({ kind: "path", path: `/service-task/${id}` });
    expect(
      inboxRoute(item("inventory.reorder", { inventoryItemId: id })),
    ).toMatchObject({ kind: "path", path: `/inventory?item=${id}` });
  });

  it("öffnet IP-Adressen und zeigt beim Netzwerkagenten einen Hinweis", () => {
    expect(inboxRoute(item("ipam.finding", { address: "10.0.0.5" }))).toEqual({
      kind: "path",
      path: "/ipam/10.0.0.5",
    });
    expect(
      inboxRoute(item("ipam.agent_offline", { address: "10.0.0.5" })),
    ).toMatchObject({ kind: "message", title: "Netzwerkagent offline" });
  });

  it("übernimmt nur UUIDs aus dem Inhalt", () => {
    const data = inboxNavigationData(
      item("shop.order.ready", { orderId: "../admin", orderNumber: "B-1" }),
    );
    expect(data.orderId).toBeUndefined();
    expect(data.notificationId).toBe(other);
    expect(inboxRoute(item("shop.order.ready", { orderId: "x" }))).toEqual({
      kind: "path",
      path: "/shop",
      feature: "self_service.shop",
    });
  });

  it("öffnet bei Arten ohne Ziel nichts", () => {
    expect(inboxRoute(item("delegation.started"))).toBeNull();
  });
});

describe("inboxPresentation", () => {
  it("nennt Art und Objekt", () => {
    expect(inboxPresentation(item("ticket.assigned", {}, ticket))).toEqual({
      title: "Ticket zugewiesen",
      detail: "ICT-2026-000041 · Drucker",
      icon: "ticket-outline",
    });
    expect(
      inboxPresentation(item("shop.order.ready", { orderNumber: "B-2026-7" })),
    ).toMatchObject({ title: "Shop", detail: "B-2026-7" });
    expect(
      inboxPresentation(
        item("monitoring.down", {
          number: "ST-12",
          title: "Core-Switch",
          severity: "warning",
        }),
      ),
    ).toMatchObject({ title: "Warnung", detail: "ST-12 · Core-Switch" });
    expect(inboxPresentation(item("ipam.agent_offline"))).toMatchObject({
      title: "Netzwerkagent offline",
      detail: null,
    });
    expect(inboxPresentation(item("delegation.started"))).toMatchObject({
      title: "Benachrichtigung",
      icon: "notifications-outline",
    });
  });
});

describe("gelesen", () => {
  it("zählt und markiert einzeln oder alle", () => {
    const list = [item("ticket.assigned"), { ...item("shop.order.ready"), id }];
    expect(inboxUnreadCount(list)).toBe(2);
    const one = markInboxRead(list, id, "2026-11-11T12:00:00.000Z");
    expect(inboxUnreadCount(one)).toBe(1);
    expect(one[1]?.readAt).toBe("2026-11-11T12:00:00.000Z");
    expect(inboxUnreadCount(markInboxRead(list, "all", "x"))).toBe(0);
  });
});

describe("formatInboxTime", () => {
  const now = new Date(2026, 10, 11, 12, 0, 0);
  it("zeigt relative Zeiten", () => {
    expect(
      formatInboxTime(new Date(2026, 10, 11, 11, 59, 40).toISOString(), now),
    ).toBe("Gerade eben");
    expect(
      formatInboxTime(new Date(2026, 10, 11, 11, 55).toISOString(), now),
    ).toBe("vor 5 Min.");
    expect(
      formatInboxTime(new Date(2026, 10, 11, 9, 0).toISOString(), now),
    ).toBe("vor 3 Std.");
    expect(
      formatInboxTime(new Date(2026, 10, 10, 8, 0).toISOString(), now),
    ).toBe("Gestern");
    expect(
      formatInboxTime(new Date(2026, 10, 1, 8, 0).toISOString(), now),
    ).toBe("01.11.2026");
    expect(formatInboxTime("kaputt", now)).toBe("");
  });
});
