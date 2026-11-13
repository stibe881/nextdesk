// Notification kinds → preference categories (push, e-mail, settings).
//
// Mirror of public.push_notification_category (migration 0315). Keep both in
// sync; notification-kinds.test.ts checks every kind listed below.

export const NOTIFICATION_CATEGORIES = [
  "assigned",
  "requester_reply",
  "support_reply",
  "mention",
  "resolved",
  "approval",
  "escalation",
  "sla",
  "follow_up",
  "contract_deadline",
  "inventory_low_stock",
  "shop",
  "service_task",
  "infrastructure",
  "security_report",
  "security_case",
  "incident",
  "ipam",
] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

/** Kinds of the IP address management (category «ipam»). */
export const IPAM_NOTIFICATION_KINDS = [
  "ipam.finding",
  "ipam.agent_offline",
  "ipam.reservation_expiring",
  // Older kind (before 0315), still delivered.
  "monitoring.ipam_finding",
] as const;

/** Security cases (category «security_case»; phishing reports are «security_report»). */
export const SECURITY_CASE_NOTIFICATION_KINDS = [
  "security.case_overdue",
  "security.case_clicked",
  "security.campaign",
] as const;

/** Inventory kinds delivered like low stock (category «inventory_low_stock»). */
export const INVENTORY_NOTIFICATION_KINDS = [
  "inventory.low_stock",
  "inventory.reorder",
  "inventory.count_due",
] as const;

function oneOf(values: readonly string[], kind: string): boolean {
  return values.includes(kind);
}

export function notificationCategory(kind: string): NotificationCategory | null {
  if (kind === "ticket.assigned") return "assigned";
  if (kind === "ticket.requester_reply") return "requester_reply";
  if (kind === "ticket.support_reply") return "support_reply";
  if (kind === "ticket.requester_reminder") return "support_reply";
  if (kind === "ticket.mention") return "mention";
  if (
    kind === "ticket.supervisor_request" ||
    kind === "ticket.supervisor_answer"
  ) {
    return "mention";
  }
  if (kind.startsWith("ticket.watch.")) return "mention";
  if (kind === "ticket.resolved") return "resolved";
  if (kind === "ticket.kudos") return "resolved";
  if (kind === "ticket.approval.requested") return "approval";
  if (
    kind === "ticket.department_question.asked" ||
    kind === "ticket.department_question.answered"
  ) {
    return "approval";
  }
  if (kind === "ticket.escalation_opened") return "escalation";
  if (kind === "ticket.security_report") return "security_report";
  if (oneOf(SECURITY_CASE_NOTIFICATION_KINDS, kind)) return "security_case";
  if (kind === "ticket.follow_up_due") return "follow_up";
  if (kind === "ticket.rule_reminder") return "follow_up";
  if (kind === "ticket.vendor_reminder") return "follow_up";
  if (kind === "ticket.children_done") return "follow_up";
  if (kind.startsWith("ticket.sla.")) return "sla";
  if (kind === "contract.deadline") return "contract_deadline";
  if (oneOf(INVENTORY_NOTIFICATION_KINDS, kind)) return "inventory_low_stock";
  if (kind.startsWith("shop.order.")) return "shop";
  if (kind.startsWith("service_task.")) return "service_task";
  if (kind === "infrastructure.due") return "infrastructure";
  if (oneOf(IPAM_NOTIFICATION_KINDS, kind)) return "ipam";
  if (kind.startsWith("monitoring.")) return "incident";
  return null;
}

export function isIpamNotificationKind(kind: string): boolean {
  return oneOf(IPAM_NOTIFICATION_KINDS, kind);
}

export function isSecurityCaseNotificationKind(kind: string): boolean {
  return oneOf(SECURITY_CASE_NOTIFICATION_KINDS, kind);
}

export function isInventoryNotificationKind(kind: string): boolean {
  return oneOf(INVENTORY_NOTIFICATION_KINDS, kind);
}
