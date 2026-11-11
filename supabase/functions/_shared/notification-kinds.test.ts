import { assertEquals } from "jsr:@std/assert@1";

import {
  isIpamNotificationKind,
  notificationCategory,
} from "./notification-kinds.ts";

// Same expectations as the database check in run-local-migration-tests.sh
// (block 0315) for public.push_notification_category.
const EXPECTED: Record<string, string | null> = {
  // A – Monitoring
  "monitoring.incident": "incident",
  "monitoring.incident.reopened": "incident",
  // C – Security
  "ticket.security_report": "security_report",
  "security.case_overdue": "security_report",
  "security.case_clicked": "security_report",
  "security.campaign": "security_report",
  // D – Shop and inventory
  "shop.order.loan_due": "shop",
  "shop.order.loan_overdue": "shop",
  "shop.order.approval_reminder": "shop",
  "inventory.low_stock": "inventory_low_stock",
  "inventory.reorder": "inventory_low_stock",
  "inventory.count_due": "inventory_low_stock",
  // E – IP address management (and the older kind)
  "ipam.finding": "ipam",
  "ipam.agent_offline": "ipam",
  "ipam.reservation_expiring": "ipam",
  "monitoring.ipam_finding": "ipam",
  // Existing kinds stay as they were.
  "ticket.assigned": "assigned",
  "infrastructure.due": "infrastructure",
  "service_task.overdue": "service_task",
  "ticket.sla.breached": "sla",
  "ipam.unknown": null,
  "security.unknown": null,
};

Deno.test("every notification kind maps to its category", () => {
  for (const [kind, category] of Object.entries(EXPECTED)) {
    assertEquals(notificationCategory(kind), category, kind);
  }
});

Deno.test("the database function lists the same kinds", async () => {
  const sql = await Deno.readTextFile(
    new URL(
      "../../migrations/0315_ipam_automation_notifications.sql",
      import.meta.url,
    ),
  );
  const body = sql.slice(
    sql.indexOf("function public.push_notification_category"),
    sql.indexOf("function public.push_delivery_modes_valid"),
  );
  for (const kind of Object.keys(EXPECTED)) {
    if (
      EXPECTED[kind] === null || kind.startsWith("ticket.") ||
      kind.startsWith("shop.") || kind.startsWith("service_task.") ||
      kind === "infrastructure.due" || kind.startsWith("monitoring.incident")
    ) {
      continue; // covered by prefixes in SQL
    }
    assertEquals(body.includes(`'${kind}'`), true, kind);
  }
});

Deno.test("IPAM kinds are recognized, including the older one", () => {
  assertEquals(isIpamNotificationKind("monitoring.ipam_finding"), true);
  assertEquals(isIpamNotificationKind("monitoring.incident"), false);
});
