import { assertEquals } from "jsr:@std/assert@1";
import {
  inventoryFields,
  ipamFields,
  securityCaseFields,
  ticketNotificationRecipientAuthorized,
} from "./index.ts";

const TENANT_ID = "00000000-0000-4000-8000-000000000001";
const USER_ID = "00000000-0000-4000-8000-000000000002";

function ticketFreeRow(kind: string) {
  return {
    outbox_id: "00000000-0000-4000-8000-000000000003",
    tenant_id: TENANT_ID,
    user_id: USER_ID,
    notification_id: "00000000-0000-4000-8000-000000000004",
    source_type: "ticket" as const,
    ticket_id: null,
    contract_id: null,
    kind,
    ticket_number: null,
    subject: null,
    delivery_mode: "immediate" as const,
    devices: [],
  };
}

Deno.test(
  "dispatcher reauthorizes ticket-free notifications with the shared rule",
  async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const admin = {
      rpc: async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        return {
          data: name === "push_non_ticket_recipient_authorized" &&
            args.p_kind !== "ticket.assigned",
          error: null,
        };
      },
    };

    for (
      const kind of [
        "inventory.low_stock",
        "inventory.reorder",
        "ipam.finding",
        "security.case_overdue",
        "shop.order.loan_due",
      ]
    ) {
      assertEquals(
        await ticketNotificationRecipientAuthorized(admin, ticketFreeRow(kind)),
        true,
        kind,
      );
    }
    assertEquals(calls[0], {
      name: "push_non_ticket_recipient_authorized",
      args: {
        p_tenant_id: TENANT_ID,
        p_user_id: USER_ID,
        p_kind: "inventory.low_stock",
      },
    });
  },
);

Deno.test(
  "dispatcher rejects ticket-free kinds the database does not allow",
  async () => {
    const admin = {
      rpc: async () => ({ data: false, error: null }),
    };
    assertEquals(
      await ticketNotificationRecipientAuthorized(
        admin,
        ticketFreeRow("ticket.assigned"),
      ),
      false,
    );
    const failing = {
      rpc: async () => ({ data: null, error: { message: "boom" } }),
    };
    assertEquals(
      await ticketNotificationRecipientAuthorized(
        failing,
        ticketFreeRow("ipam.finding"),
      ),
      false,
    );
  },
);

Deno.test("IPAM push fields carry no personal data", () => {
  assertEquals(
    ipamFields("ipam.reservation_expiring", {
      address: "10.1.2.3",
      number: "10.1.2.3",
      title: "DRU-01",
      reservedUntil: "2026-11-14",
      assetId: "00000000-0000-4000-8000-000000000009",
      ownerEmail: "someone@example.test",
    }),
    {
      ipamEvent: "reservation_expiring",
      ipamTitle: "DRU-01",
      ipamNumber: "10.1.2.3",
      ipamAddress: "10.1.2.3",
      dueOn: "2026-11-14",
      assetId: "00000000-0000-4000-8000-000000000009",
    },
  );
  assertEquals(
    ipamFields("monitoring.ipam_finding", { assetId: "nope" }).ipamEvent,
    "finding",
  );
  assertEquals(
    ipamFields("ipam.agent_offline", { agentName: "Agent Baar" }),
    { ipamEvent: "agent_offline", ipamAgentName: "Agent Baar" },
  );
});

Deno.test("security case and inventory push fields", () => {
  assertEquals(securityCaseFields("security.campaign", { reporterCount: 4 }), {
    securityEvent: "campaign",
    securityCount: 4,
  });
  assertEquals(
    securityCaseFields("security.case_overdue", { stage: "supervisor" }),
    { securityEvent: "overdue", securityEscalated: "1" },
  );
  assertEquals(securityCaseFields("security.case_clicked", {}), {
    securityEvent: "clicked",
  });
  assertEquals(inventoryFields("inventory.count_due", { locationName: "Lager A" }), {
    inventoryEvent: "count_due",
    inventoryName: "Lager A",
  });
});
