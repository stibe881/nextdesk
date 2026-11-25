import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";
import { Platform } from "react-native";

import { badgeCountFromPush } from "@/lib/badge-push-model";

// Android: Daten-Push mit der neuen Zahl, auch wenn die App geschlossen ist.
// Beim iPhone setzt der stille Push die Zahl selbst; dort braucht es nichts.

export const BADGE_PUSH_TASK = "nextdesk-badge-push";

if (Platform.OS === "android" && !TaskManager.isTaskDefined(BADGE_PUSH_TASK)) {
  TaskManager.defineTask(BADGE_PUSH_TASK, async ({ data, error }) => {
    if (error) return;
    const count = badgeCountFromPush(data);
    if (count === null) return;
    await Notifications.setBadgeCountAsync(count).catch(() => undefined);
    // Alles gelesen: auch die Mitteilungen in der Leiste entfernen, denn
    // viele Android-Startbildschirme zählen diese.
    if (count === 0) {
      await Notifications.dismissAllNotificationsAsync().catch(() => undefined);
    }
  });
}

/** Meldet die Aufgabe für Daten-Pushs an (nur Android, einmal pro Start). */
export async function registerBadgePushTask(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.registerTaskAsync(BADGE_PUSH_TASK).catch(() => undefined);
}
