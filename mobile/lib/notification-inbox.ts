import { syncAppBadge } from "@/lib/app-badge";
import { invokeNextDesk } from "@/lib/nextdesk-client";
import {
  type InboxNotification,
  parseInboxNotifications,
} from "@/lib/notification-inbox-model";

// Gleiche Funktion wie die Glocke der Web-App («notification-center»).

export async function loadInboxNotifications(
  tenantId: string,
  options: { unreadOnly?: boolean; limit?: number } = {},
): Promise<InboxNotification[]> {
  const response = await invokeNextDesk<unknown>("notification-center", {
    type: "list",
    tenantId,
    unreadOnly: options.unreadOnly ?? false,
    limit: options.limit ?? 50,
  });
  const notifications = parseInboxNotifications(response);
  if (!notifications) {
    throw new Error("Die Mitteilungen konnten nicht gelesen werden.");
  }
  return notifications;
}

export async function markInboxNotificationRead(
  notificationId: string,
): Promise<void> {
  await invokeNextDesk("notification-center", {
    type: "markRead",
    notificationId,
  });
  void syncAppBadge();
}

export async function markAllInboxNotificationsRead(
  tenantId: string,
): Promise<void> {
  await invokeNextDesk("notification-center", {
    type: "markAllRead",
    tenantId,
  });
  void syncAppBadge();
}

/**
 * Wer ein Ticket öffnet, hat die Mitteilungen dazu gesehen: alle ungelesenen
 * Mitteilungen zu diesem Ticket gelten als gelesen, die Zahl auf dem
 * App-Symbol wird neu gesetzt. Ein Fehler ist unkritisch.
 */
export async function markTicketNotificationsRead(
  tenantId: string,
  ticketId: string,
): Promise<void> {
  try {
    await invokeNextDesk("notification-center", {
      type: "markTicketRead",
      tenantId,
      ticketId,
    });
    void syncAppBadge();
  } catch {
    // Die Mitteilungen bleiben ungelesen und lassen sich in der Liste lesen.
  }
}
