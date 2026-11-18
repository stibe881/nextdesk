import * as Notifications from "expo-notifications";

import { invokeNextDesk, nextDesk } from "@/lib/nextdesk-client";

// Zahl auf dem App-Symbol (iPhone und Android): ungelesene Mitteilungen der
// Person, gleich gezählt wie die Glocke und die Mitteilungsliste.

/** Liest «{ data: { count } }» der Funktion notification-center. */
export function parseUnreadCount(value: unknown): number | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as { data?: unknown; count?: unknown };
  const data =
    typeof record.data === "object" && record.data !== null
      ? (record.data as { count?: unknown })
      : record;
  const count = data.count;
  return typeof count === "number" && Number.isInteger(count) && count >= 0
    ? Math.min(count, 9999)
    : null;
}

export async function setAppBadge(count: number): Promise<void> {
  await Notifications.setBadgeCountAsync(Math.max(0, count)).catch(
    () => undefined,
  );
}

/** Setzt die Zahl auf den Stand der Datenbank; ohne Anmeldung auf 0. */
export async function syncAppBadge(): Promise<void> {
  try {
    const session = nextDesk
      ? (await nextDesk.auth.getSession()).data.session
      : null;
    if (!session) {
      await setAppBadge(0);
      return;
    }
    const response = await invokeNextDesk<unknown>("notification-center", {
      type: "unreadCount",
    });
    const count = parseUnreadCount(response);
    if (count !== null) await setAppBadge(count);
  } catch {
    // Offline oder nicht erreichbar: die Zahl bleibt, wie sie ist.
  }
}
