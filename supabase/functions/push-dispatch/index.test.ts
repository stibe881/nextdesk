import { assertEquals } from "jsr:@std/assert@1";
import { ticketNotificationRecipientAuthorized } from "./index.ts";

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
  "dispatcher reauthorizes only the allowed ticket-free inventory kind",
  async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const admin = {
      rpc: async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        return {
          data: name === "inventory_low_stock_delivery_authorized",
          error: null,
        };
      },
    };

    assertEquals(
      await ticketNotificationRecipientAuthorized(
        admin,
        ticketFreeRow("inventory.low_stock"),
      ),
      true,
    );
    assertEquals(calls, [
      {
        name: "inventory_low_stock_delivery_authorized",
        args: { p_tenant_id: TENANT_ID, p_user_id: USER_ID },
      },
    ]);
  },
);

Deno.test(
  "dispatcher rejects every other ticket-free notification kind",
  async () => {
    let called = false;
    const admin = {
      rpc: async () => {
        called = true;
        return { data: true, error: null };
      },
    };

    assertEquals(
      await ticketNotificationRecipientAuthorized(
        admin,
        ticketFreeRow("ticket.assigned"),
      ),
      false,
    );
    assertEquals(called, false);
  },
);
