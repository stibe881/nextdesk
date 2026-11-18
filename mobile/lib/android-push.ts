import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { invokeNextDesk } from "@/lib/nextdesk-client";

// Push-Mitteilungen auf Android (Expo-Push-Token). Ticket-Mitteilungen laufen
// weiter nur über das iPhone; Android empfängt die Mitteilungen, die
// Administratoren unter Einstellungen → Funktionen → Push-Benachrichtigungen senden.

const CHANNEL_ID = "default";

/** Gültiges Expo-Token, wie es die Funktion push-android erwartet. */
export function isExpoPushToken(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{10,200}\]$/.test(value)
  );
}

async function ensureChannel(): Promise<void> {
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: "Mitteilungen",
    importance: Notifications.AndroidImportance.HIGH,
    showBadge: true,
  }).catch(() => undefined);
}

async function expoToken(): Promise<string | null> {
  const projectId =
    (
      Constants.expoConfig?.extra as
        { eas?: { projectId?: string } } | undefined
    )?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) return null;
  const token = await Notifications.getExpoPushTokenAsync({ projectId });
  return isExpoPushToken(token.data) ? token.data : null;
}

/**
 * Fragt die Android-Berechtigung an (ab Android 13) und meldet das Gerät für
 * Push-Mitteilungen an. Gibt es keine Firebase-Zugangsdaten in der App, bleibt
 * das still wirkungslos.
 */
export async function registerAndroidPush(tenantId: string): Promise<void> {
  if (Platform.OS !== "android") return;
  try {
    await ensureChannel();
    const current = await Notifications.getPermissionsAsync();
    const permission = current.granted
      ? current
      : current.canAskAgain
        ? await Notifications.requestPermissionsAsync()
        : current;
    if (!permission.granted) return;
    const token = await expoToken();
    if (!token) return;
    await invokeNextDesk("push-android", {
      type: "register",
      tenantId,
      token,
      deviceName: (Constants.deviceName ?? "Android").slice(0, 80),
      appVersion: Constants.nativeAppVersion ?? undefined,
    });
  } catch {
    // Push ist optional: ohne Zugangsdaten oder Netz einfach nicht registrieren.
  }
}

/** Beim Abmelden: Gerät abmelden, damit keine Mitteilungen mehr ankommen. */
export async function unregisterAndroidPush(tenantId: string): Promise<void> {
  if (Platform.OS !== "android") return;
  try {
    const token = await expoToken();
    if (!token) return;
    await invokeNextDesk("push-android", {
      type: "unregister",
      tenantId,
      token,
    });
  } catch {
    // Best effort.
  }
}
