import { invokeNextDesk } from "@/lib/nextdesk-client";
import {
  isNoticeActionable,
  parseActiveNotices,
  type NoticeEvent,
  type NoticeView,
} from "@/lib/requester-notices-model";

/**
 * Lädt die aktiven Hinweise für die App. Ist die Funktion nicht erreichbar
 * oder für den Mandanten aus, wird still nichts angezeigt (leere Liste).
 */
export async function loadRequesterNotices(
  tenantId: string,
): Promise<NoticeView[]> {
  try {
    const response = await invokeNextDesk<unknown>("requester-notices", {
      type: "active",
      tenantId,
      placement: "app",
    });
    return parseActiveNotices(response).filter(isNoticeActionable);
  } catch {
    return [];
  }
}

/** Meldet Anzeige, Klick oder Wegklicken; Fehler werden bewusst ignoriert. */
export async function trackRequesterNotice(
  tenantId: string,
  noticeId: string,
  event: NoticeEvent,
): Promise<void> {
  try {
    await invokeNextDesk<unknown>("requester-notices", {
      type: "track",
      tenantId,
      noticeId,
      event,
      channel: "app",
    });
  } catch {
    // Statistik ist nicht kritisch.
  }
}
