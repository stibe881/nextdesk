// Zahl auf dem App-Symbol nachführen, wenn Mitteilungen ausserhalb der App
// gelesen werden (Glocke im Web: «Alle gesehen», einzelne Mitteilung,
// geöffnetes Ticket). iPhone: stiller Push nur mit der Zahl (keine Mitteilung,
// kein Ton). Android: Daten-Push, den die App im Hintergrund verarbeitet.

import { sendApns } from "./apns.ts";
import { sendExpoPush } from "./expo-push.ts";
import { unreadNotificationCount } from "./notification-badge.ts";

// deno-lint-ignore no-explicit-any
type Admin = any;

/** Payload eines reinen Zahl-Pushs fürs iPhone. */
export function badgeOnlyPayload(count: number): Record<string, unknown> {
  return {
    aps: { badge: Math.max(0, Math.min(Math.trunc(count), 9999)) },
    kind: "badge",
  };
}

/** Sendet die aktuelle Zahl an alle Geräte der Person; Fehler bleiben still. */
export async function pushBadgeUpdate(admin: Admin, userId: string): Promise<void> {
  try {
    const count = await unreadNotificationCount(admin, userId);
    const [ios, android] = await Promise.all([
      admin.from("push_devices").select("id, apns_token, apns_environment")
        .eq("user_id", userId).eq("enabled", true).limit(20),
      admin.from("push_android_devices").select("id, expo_token")
        .eq("user_id", userId).eq("enabled", true).limit(20),
    ]);
    const iosDevices = (ios.data ?? []) as {
      id: string;
      apns_token: string;
      apns_environment: "production" | "development";
    }[];
    const androidDevices = (android.data ?? []) as { id: string; expo_token: string }[];
    const payload = badgeOnlyPayload(count);
    // One token can be registered for several workspaces.
    const tokens = new Map(iosDevices.map((device) => [device.apns_token, device]));
    await Promise.all([
      ...[...tokens.values()].map((device) =>
        sendApns(device.apns_token, device.apns_environment, payload, "nextdesk-badge", {
          priority: 5,
          expiresInSeconds: 60 * 60,
        })
      ),
      androidDevices.length
        ? sendExpoPush(
          [...new Set(androidDevices.map((device) => device.expo_token))].map((to) => ({
            to,
            data: { kind: "badge", badgeCount: count },
          })),
        )
        : Promise.resolve([]),
    ]);
  } catch (failure) {
    console.error("badge_push_failed", failure instanceof Error ? failure.message : "");
  }
}

/** Läuft nach der Antwort weiter (EdgeRuntime.waitUntil), sonst sofort. */
export function pushBadgeUpdateInBackground(admin: Admin, userId: string): void {
  const task = pushBadgeUpdate(admin, userId);
  // deno-lint-ignore no-explicit-any
  const runtime = (globalThis as any).EdgeRuntime;
  if (runtime && typeof runtime.waitUntil === "function") runtime.waitUntil(task);
}
