import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";

import { rpcError } from "./index.ts";

Deno.test(
  "ticket deletion maps foreign-key dependencies to a generic conflict without database details",
  async () => {
    const response = rpcError(
      new Request("https://app.nextdesk.ch/functions/v1/ticket-bulk-status", {
        method: "POST",
        headers: { origin: "https://app.nextdesk.ch" },
      }),
      {
        code: "23503",
        message:
          'update or delete on table "tickets" violates foreign key constraint "experience_follow_ups_ticket_tenant_fk"',
      },
      "delete",
    );

    assertEquals(response.status, 409);
    const body = await response.text();
    assertEquals(
      body,
      '{"error":{"code":"bulk_ticket_delete_dependency_blocked"}}',
    );
    assertStringIncludes(
      response.headers.get("access-control-allow-origin") ?? "",
      "app.nextdesk.ch",
    );
  },
);
