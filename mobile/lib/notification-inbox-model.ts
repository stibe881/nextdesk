// Mitteilungen (Posteingang der App): Liste der letzten Benachrichtigungen
// des Arbeitsbereichs aus «notification-center» (wie die Glocke im Web).
// Ein Tipp öffnet das Objekt über dieselbe Routing-Tabelle wie eine
// Push-Mitteilung (push-navigation.ts). Reine Logik, getestet in
// tests/notification-inbox-model.test.ts.

import {
  type PushNavigationData,
  type PushRoute,
  pushRoute,
} from "./push-navigation";

export type InboxNotification = {
  id: string;
  tenantId: string;
  kind: string;
  payload: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
  ticket: { id: string; ticketNumber: string; subject: string | null } | null;
};

export type InboxIcon =
  | "ticket-outline"
  | "bag-handle-outline"
  | "pulse-outline"
  | "shield-outline"
  | "cube-outline"
  | "construct-outline"
  | "server-outline"
  | "git-network-outline"
  | "document-text-outline"
  | "alarm-outline"
  | "checkmark-circle-outline"
  | "notifications-outline";

export type InboxPresentation = {
  title: string;
  /** Ticketnummer, Bestellung, Gerät … (kann fehlen). */
  detail: string | null;
  icon: InboxIcon;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, max = 120): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  return cleaned.length <= max ? cleaned : `${cleaned.slice(0, max - 1)}…`;
}

function notificationFromValue(value: unknown): InboxNotification | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.tenantId !== "string" ||
    typeof value.kind !== "string" ||
    typeof value.createdAt !== "string" ||
    (value.readAt !== null && typeof value.readAt !== "string")
  ) {
    return null;
  }
  let ticket: InboxNotification["ticket"] = null;
  if (isRecord(value.ticket)) {
    if (
      typeof value.ticket.id !== "string" ||
      typeof value.ticket.ticketNumber !== "string"
    ) {
      return null;
    }
    ticket = {
      id: value.ticket.id,
      ticketNumber: value.ticket.ticketNumber,
      subject:
        typeof value.ticket.subject === "string" ? value.ticket.subject : null,
    };
  } else if (value.ticket !== null && value.ticket !== undefined) {
    return null;
  }
  return {
    id: value.id,
    tenantId: value.tenantId,
    kind: value.kind,
    payload: isRecord(value.payload) ? value.payload : {},
    readAt: value.readAt,
    createdAt: value.createdAt,
    ticket,
  };
}

/** Antwort von notification-center (type "list"); null bei falscher Form. */
export function parseInboxNotifications(
  value: unknown,
): InboxNotification[] | null {
  if (!isRecord(value)) return null;
  const data = isRecord(value.data) ? value.data : value;
  if (!Array.isArray(data.notifications)) return null;
  const items = data.notifications.map(notificationFromValue);
  return items.every((item): item is InboxNotification => item !== null)
    ? items
    : null;
}

const IPAM_KINDS = new Set([
  "ipam.finding",
  "ipam.agent_offline",
  "ipam.reservation_expiring",
  "monitoring.ipam_finding",
]);
const INVENTORY_KINDS = new Set([
  "inventory.low_stock",
  "inventory.reorder",
  "inventory.count_due",
]);

const EXACT_PUSH_KINDS: Record<string, string> = {
  "ticket.assigned": "assigned",
  "ticket.requester_reply": "requester_reply",
  "ticket.support_reply": "support_reply",
  "ticket.requester_reminder": "requester_reminder",
  "ticket.mention": "mention",
  "ticket.supervisor_request": "supervisor_request",
  "ticket.supervisor_answer": "supervisor_answer",
  "ticket.resolved": "resolved",
  "ticket.kudos": "kudos",
  "ticket.approval.requested": "approval",
  "ticket.department_question.asked": "department_question_asked",
  "ticket.department_question.answered": "department_question_answered",
  "ticket.escalation_opened": "escalation",
  "ticket.security_report": "security_report",
  "ticket.follow_up_due": "follow_up",
  "ticket.rule_reminder": "rule_reminder",
  "ticket.vendor_reminder": "vendor_reminder",
  "ticket.children_done": "children_done",
  "contract.deadline": "contract_deadline",
  "infrastructure.due": "infrastructure",
};

/**
 * Push-Art einer Benachrichtigungsart, wie sie push-dispatch verschickt
 * (supabase/functions/push-dispatch payloadKind + notification-kinds.ts).
 * Leer für Arten ohne Push (z. B. Stellvertretung).
 */
export function pushKindForNotification(kind: string): string {
  const exact = EXACT_PUSH_KINDS[kind];
  if (exact) return exact;
  if (kind.startsWith("ticket.watch.")) return "watched";
  if (kind.startsWith("ticket.sla.")) return "sla";
  if (kind.startsWith("security.")) return "security_report";
  if (INVENTORY_KINDS.has(kind)) return "inventory_low_stock";
  if (kind.startsWith("shop.order.")) return "shop";
  if (kind.startsWith("service_task.")) return "service_task";
  if (IPAM_KINDS.has(kind)) return "ipam";
  if (kind.startsWith("monitoring.")) return "incident";
  return "";
}

function payloadId(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  return typeof value === "string" && UUID.test(value.trim())
    ? value.trim()
    : undefined;
}

/** Felder wie in einer Push-Mitteilung derselben Benachrichtigung. */
export function inboxNavigationData(
  notification: InboxNotification,
): PushNavigationData {
  const { payload } = notification;
  const kind = pushKindForNotification(notification.kind);
  const data: PushNavigationData = {
    tenantId: notification.tenantId,
    notificationId: notification.id,
    notificationKind: notification.kind,
  };
  if (kind) data.kind = kind;
  if (notification.ticket?.id) data.ticketId = notification.ticket.id;
  const ids: [keyof PushNavigationData, string][] = [
    ["orderId", "orderId"],
    ["incidentId", "incidentId"],
    ["occurrenceId", "occurrenceId"],
    ["assetId", "assetId"],
    ["contractId", "contractId"],
    ["inventoryItemId", "inventoryItemId"],
    ["inventoryLocationId", "inventoryLocationId"],
  ];
  for (const [target, source] of ids) {
    const value = payloadId(payload, source);
    if (value) data[target] = value;
  }
  if (kind === "ipam") {
    data.ipamEvent =
      notification.kind === "ipam.agent_offline"
        ? "agent_offline"
        : notification.kind === "ipam.reservation_expiring"
          ? "reservation_expiring"
          : "finding";
    const address = text(payload.address, 45);
    if (address) data.ipamAddress = address;
  }
  return data;
}

/** Ziel eines Tipps: dieselbe Tabelle wie bei Push-Mitteilungen. */
export function inboxRoute(notification: InboxNotification): PushRoute | null {
  return pushRoute(inboxNavigationData(notification));
}

const titles = (): Record<string, [string, InboxIcon]> => ({
  assigned: ["Ticket zugewiesen", "ticket-outline"],
  requester_reply: ["Neue Antwort", "ticket-outline"],
  support_reply: ["Antwort vom Support", "ticket-outline"],
  requester_reminder: [tn("Wir warten auf deine Antwort", "Wir warten auf Ihre Antwort"), "ticket-outline"],
  mention: [tn("Du wurdest erwähnt", "Sie wurden erwähnt"), "ticket-outline"],
  supervisor_request: [tn("Anfrage an dich", "Anfrage an Sie"), "ticket-outline"],
  supervisor_answer: [tn("Antwort auf deine Anfrage", "Antwort auf Ihre Anfrage"), "ticket-outline"],
  watched: ["Beobachtetes Ticket geändert", "ticket-outline"],
  resolved: ["Ticket gelöst", "checkmark-circle-outline"],
  kudos: ["Lob erhalten", "checkmark-circle-outline"],
  approval: ["Freigabe benötigt", "checkmark-circle-outline"],
  department_question_asked: [tn("Rückfrage an dein Team", "Rückfrage an Ihr Team"), "ticket-outline"],
  department_question_answered: ["Rückfrage beantwortet", "ticket-outline"],
  escalation: ["Ticket eskaliert", "alarm-outline"],
  security_report: ["Phishing und Sicherheitsfälle", "shield-outline"],
  follow_up: ["Wiedervorlage fällig", "alarm-outline"],
  rule_reminder: ["Erinnerung", "alarm-outline"],
  vendor_reminder: ["Drittanbieter nachfassen", "alarm-outline"],
  children_done: ["Teil-Tickets erledigt", "checkmark-circle-outline"],
  sla: ["SLA-Hinweis", "alarm-outline"],
  contract_deadline: ["Vertragsfrist", "document-text-outline"],
  inventory_low_stock: ["Lager", "cube-outline"],
  shop: ["Shop", "bag-handle-outline"],
  service_task: ["Serviceaufgabe", "construct-outline"],
  infrastructure: ["Infrastruktur", "server-outline"],
  ipam: ["IP-Adressverwaltung", "git-network-outline"],
  incident: ["Störung", "pulse-outline"],
});

const SPECIFIC_TITLES: Record<string, string> = {
  "ticket.security_report": "Phishing-Meldung",
  "security.case_overdue": "Sicherheitsfall überfällig",
  "security.case_clicked": "Melder hat geklickt",
  "security.campaign": "Phishing-Kampagne",
  "inventory.low_stock": "Mindestbestand erreicht",
  "inventory.reorder": "Nachbestellen",
  "inventory.count_due": "Inventur fällig",
  "service_task.due": "Serviceaufgabe fällig",
  "service_task.overdue": "Serviceaufgabe überfällig",
  "ipam.agent_offline": "Netzwerkagent offline",
  "ipam.reservation_expiring": "Reservierung läuft ab",
  "ticket.sla.supervisor_no_response": "Team: Ticket ohne Antwort",
  "ticket.sla.supervisor_risk": "Team: SLA in Gefahr",
};

export function inboxPresentation(
  notification: InboxNotification,
): InboxPresentation {
  const { payload } = notification;
  const kind = pushKindForNotification(notification.kind);
  const [baseTitle, icon] = titles()[kind] ?? [
    "Benachrichtigung",
    "notifications-outline",
  ];
  let title = SPECIFIC_TITLES[notification.kind] ?? baseTitle;
  if (kind === "incident") {
    title = payload.severity === "warning" ? "Warnung" : "Störung";
  }
  if (kind === "rule_reminder") {
    const rule = text(payload.ruleName, 60);
    if (rule) title = `Erinnerung: ${rule}`;
  }

  let detail: string | null = null;
  if (notification.ticket) {
    const subject = text(notification.ticket.subject, 80);
    detail = subject
      ? `${notification.ticket.ticketNumber} · ${subject}`
      : notification.ticket.ticketNumber;
  } else if (kind === "shop") {
    detail = text(payload.orderNumber, 40) ?? text(payload.teamName, 80);
  } else if (kind === "incident") {
    const number = text(payload.number, 40);
    const name = text(payload.title, 80);
    detail = [number, name].filter(Boolean).join(" · ") || null;
  } else if (kind === "service_task") {
    detail = text(payload.title, 80);
  } else if (kind === "infrastructure") {
    detail = text(payload.assetName, 80);
  } else if (kind === "ipam") {
    detail =
      text(payload.agentName, 80) ??
      [text(payload.address, 45), text(payload.title, 80)]
        .filter(Boolean)
        .join(" · ") ??
      null;
    if (detail === "") detail = null;
  } else if (kind === "inventory_low_stock") {
    detail =
      text(payload.itemName, 80) ??
      text(payload.locationName, 80) ??
      text(payload.title, 80);
  } else if (kind === "contract_deadline") {
    detail = text(payload.title, 80) ?? text(payload.contractName, 80);
  }
  return { title, detail, icon };
}

export function inboxUnreadCount(
  notifications: readonly InboxNotification[],
): number {
  return notifications.filter((notification) => !notification.readAt).length;
}

/** Lokaler Stand nach «gelesen» (einzeln oder alle). */
export function markInboxRead(
  notifications: readonly InboxNotification[],
  notificationId: string | "all",
  readAt: string,
): InboxNotification[] {
  return notifications.map((notification) =>
    !notification.readAt &&
    (notificationId === "all" || notification.id === notificationId)
      ? { ...notification, readAt }
      : notification,
  );
}

/** «Gerade eben», «vor 5 Min.», «vor 3 Std.», «gestern», «12.11.2026». */
export function formatInboxTime(createdAt: string, now: Date): string {
  const created = new Date(createdAt);
  const time = created.getTime();
  if (!Number.isFinite(time)) return "";
  const minutes = Math.floor((now.getTime() - time) / 60_000);
  if (minutes < 1) return "Gerade eben";
  if (minutes < 60) return `vor ${minutes} Min.`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `vor ${hours} Std.`;
  const day = (date: Date) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((day(now) - day(created)) / 86_400_000);
  if (days === 1) return "Gestern";
  if (days < 7) return `vor ${days} Tagen`;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(created.getDate())}.${pad(created.getMonth() + 1)}.${created.getFullYear()}`;
}
