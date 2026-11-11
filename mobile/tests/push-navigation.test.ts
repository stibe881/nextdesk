import { describe, expect, it } from "vitest";

import {
  parsePushNavigationData,
  PUSH_PAYLOAD_KINDS,
  pushRoute,
} from "../lib/push-navigation";

const tenantId = "10000000-0000-4000-8000-000000000001";
const id = "20000000-0000-4000-8000-000000000002";

describe("pushRoute", () => {
  it("hat für jede Push-Art ein Ziel (nur die Testmitteilung nicht)", () => {
    for (const kind of PUSH_PAYLOAD_KINDS) {
      const route = pushRoute({ tenantId, kind });
      if (kind === "test") expect(route).toBeNull();
      else expect(route, kind).not.toBeNull();
    }
  });

  it("öffnet für alle Ticket-Arten genau das Ticket", () => {
    for (const kind of [
      "assigned",
      "requester_reply",
      "support_reply",
      "requester_reminder",
      "mention",
      "resolved",
      "approval",
      "department_question_asked",
      "department_question_answered",
      "supervisor_request",
      "supervisor_answer",
      "escalation",
      "sla",
      "follow_up",
      "watched",
      "rule_reminder",
      "vendor_reminder",
      "children_done",
      "kudos",
    ]) {
      expect(pushRoute({ tenantId, ticketId: id, kind }), kind).toEqual({
        kind: "ticket",
        ticketId: id,
      });
    }
    expect(pushRoute({ tenantId, kind: "assigned" })).toEqual({
      kind: "path",
      path: "/tickets",
    });
  });

  it("öffnet Sicherheitsfälle, Störungen, Bestellungen und Geräte", () => {
    expect(
      pushRoute({ tenantId, ticketId: id, kind: "security_report" }),
    ).toEqual({ kind: "path", path: `/phishing/${id}` });
    expect(pushRoute({ tenantId, incidentId: id, kind: "incident" })).toEqual({
      kind: "path",
      path: `/incidents/${id}`,
    });
    expect(pushRoute({ tenantId, orderId: id, kind: "shop" })).toEqual({
      kind: "path",
      path: `/shop/order/${id}`,
      feature: "self_service.shop",
    });
    expect(
      pushRoute({ tenantId, assetId: id, kind: "infrastructure" }),
    ).toEqual({
      kind: "path",
      path: `/infrastructure/${id}`,
      feature: "assets.management",
    });
  });

  it("öffnet Serviceaufgaben und Lagerartikel bzw. Lagerorte", () => {
    expect(
      pushRoute({ tenantId, occurrenceId: id, kind: "service_task" }),
    ).toEqual({
      kind: "path",
      path: `/service-task/${id}`,
      feature: "service.tasks",
    });
    expect(
      pushRoute({ tenantId, inventoryItemId: id, kind: "inventory_low_stock" }),
    ).toEqual({
      kind: "path",
      path: `/inventory?item=${id}`,
      feature: "inventory.management",
    });
    expect(
      pushRoute({
        tenantId,
        inventoryLocationId: id,
        kind: "inventory_low_stock",
        notificationKind: "inventory.count_due",
      }),
    ).toEqual({
      kind: "path",
      path: `/inventory?location=${id}`,
      feature: "inventory.management",
    });
  });

  it("öffnet IP-Adressen über das Gerät oder die Adresse", () => {
    expect(pushRoute({ tenantId, kind: "ipam", assetId: id })).toEqual({
      kind: "path",
      path: `/assets/${id}`,
    });
    expect(
      pushRoute({ tenantId, kind: "ipam", ipamAddress: "fd00::1" }),
    ).toEqual({ kind: "path", path: "/ipam/fd00%3A%3A1" });
    expect(
      pushRoute({ tenantId, kind: "ipam", ipamAddress: "../../x" }),
    ).toMatchObject({ kind: "message" });
    expect(
      pushRoute({
        tenantId,
        kind: "ipam",
        ipamEvent: "agent_offline",
        ipamAddress: "10.0.0.5",
      }),
    ).toMatchObject({ kind: "message", title: "Netzwerkagent offline" });
  });

  it("zeigt bei Verträgen einen Hinweis statt einer leeren Seite", () => {
    expect(
      pushRoute({ tenantId, kind: "contract_deadline", contractId: id }),
    ).toMatchObject({ kind: "message", title: "Vertragsfrist" });
  });

  it("lehnt Kennungen ab, die keine UUID sind", () => {
    expect(
      pushRoute({ tenantId, kind: "incident", incidentId: "../tickets" }),
    ).toEqual({ kind: "path", path: "/incidents" });
    expect(pushRoute({ tenantId, kind: "assigned", ticketId: "t1" })).toEqual({
      kind: "path",
      path: "/tickets",
    });
  });

  it("öffnet bei unbekannten neueren Arten das Ticket, sonst nichts", () => {
    expect(pushRoute({ tenantId, kind: "future", ticketId: id })).toEqual({
      kind: "ticket",
      ticketId: id,
    });
    expect(pushRoute({ tenantId, kind: "future" })).toBeNull();
  });
});

describe("parsePushNavigationData", () => {
  it("liest die APNs-Felder aus «body»", () => {
    expect(
      parsePushNavigationData({
        body: {
          nextdeskV: 1,
          tenantId,
          kind: "inventory_low_stock",
          notificationKind: "inventory.reorder",
          inventoryItemId: id,
          notificationId: id,
          unknown: "x",
        },
      }),
    ).toEqual({
      tenantId,
      kind: "inventory_low_stock",
      notificationKind: "inventory.reorder",
      inventoryItemId: id,
      notificationId: id,
    });
  });

  it("verlangt einen gültigen Mandanten", () => {
    expect(parsePushNavigationData({ kind: "assigned" })).toBeNull();
    expect(
      parsePushNavigationData({ tenantId: "x", kind: "assigned" }),
    ).toBeNull();
    expect(parsePushNavigationData(null)).toBeNull();
  });
});
