// Link aus einer Benachrichtigungs-E-Mail: «/?benachrichtigung=<id>».
// Die Web-App liest die ID beim Laden, entfernt sie aus der Adresse, merkt
// sie sich über die Anmeldung (auch SSO/Anmeldelink in neuem Tab) hinweg,
// lädt die Benachrichtigung über «notification-center» (type "get") und
// öffnet danach das Objekt wie die Glocke (notification-target.ts).
// Server-Gegenstück: supabase/functions/_shared/notification-email.ts.
// Reine Logik, getestet in notification-link.test.ts.

export const NOTIFICATION_LINK_PARAM = "benachrichtigung";
export const NOTIFICATION_LINK_STORAGE_KEY = "nextdesk.pendingNotificationLink";
/** Länger offen gelassene Anmeldungen öffnen die Benachrichtigung nicht mehr. */

import { tn } from "./formality";
export const NOTIFICATION_LINK_MAX_AGE_MS = 60 * 60 * 1000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function notificationIdFromSearch(search: string): string | null {
  let value: string | null;
  try {
    value = new URLSearchParams(search).get(NOTIFICATION_LINK_PARAM);
  } catch {
    return null;
  }
  const trimmed = value?.trim() ?? "";
  return UUID.test(trimmed) ? trimmed.toLowerCase() : null;
}

/** Adresse ohne den Parameter (für history.replaceState); null = unverändert. */
export function urlWithoutNotificationLink(href: string): string | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (!url.searchParams.has(NOTIFICATION_LINK_PARAM)) return null;
  url.searchParams.delete(NOTIFICATION_LINK_PARAM);
  return url.toString();
}

type LinkStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function rememberNotificationLink(
  storage: LinkStorage,
  notificationId: string,
  now: number,
): void {
  try {
    storage.setItem(
      NOTIFICATION_LINK_STORAGE_KEY,
      JSON.stringify({ id: notificationId, at: now }),
    );
  } catch {
    // Kein Speicher: der Link wirkt nur bei bestehender Anmeldung.
  }
}

export function pendingNotificationLink(
  storage: LinkStorage,
  now: number,
): string | null {
  let raw: string | null;
  try {
    raw = storage.getItem(NOTIFICATION_LINK_STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as { id?: unknown; at?: unknown };
    if (
      typeof value.id === "string" &&
      UUID.test(value.id) &&
      typeof value.at === "number" &&
      now - value.at >= 0 &&
      now - value.at <= NOTIFICATION_LINK_MAX_AGE_MS
    ) {
      return value.id.toLowerCase();
    }
  } catch {
    // Ungültiger Eintrag: verwerfen.
  }
  forgetNotificationLink(storage);
  return null;
}

export function forgetNotificationLink(storage: LinkStorage): void {
  try {
    storage.removeItem(NOTIFICATION_LINK_STORAGE_KEY);
  } catch {
    // Nichts zu entfernen.
  }
}

/**
 * Nächster Schritt, sobald die Benachrichtigung geladen ist: im aktiven
 * Mandanten öffnen, zuerst in ihren Mandanten wechseln oder (keine
 * Mitgliedschaft in dieser Sitzung) einen Hinweis zeigen.
 */
export function notificationLinkStep(input: {
  notificationTenantId: string;
  activeTenantId: string;
  tenantIds: readonly string[];
}): "open" | "switch" | "unavailable" {
  if (input.notificationTenantId === input.activeTenantId) return "open";
  return input.tenantIds.includes(input.notificationTenantId)
    ? "switch"
    : "unavailable";
}

/** Freundlicher Hinweis, wenn sich die Benachrichtigung nicht öffnen lässt. */
export function notificationLinkMessage(code: string | null): string {
  switch (code) {
    case "notification_not_found":
      return tn(
        "Diese Benachrichtigung wurde nicht gefunden. Vielleicht bist du mit einem anderen Konto angemeldet als dem, an das die E-Mail ging.",
        "Diese Benachrichtigung wurde nicht gefunden. Vielleicht sind Sie mit einem anderen Konto angemeldet als dem, an das die E-Mail ging.",
      );
    case "tenant_membership_required":
    case "tenant_unavailable":
      return tn(
        "Diese Benachrichtigung gehört zu einem Arbeitsbereich, auf den du mit dieser Anmeldung keinen Zugriff hast.",
        "Diese Benachrichtigung gehört zu einem Arbeitsbereich, auf den Sie mit dieser Anmeldung keinen Zugriff haben.",
      );
    case "notification_target_unavailable":
      return tn(
        "Du hast keinen Zugriff mehr auf diesen Eintrag, oder er wurde gelöscht.",
        "Sie haben keinen Zugriff mehr auf diesen Eintrag, oder er wurde gelöscht.",
      );
    default:
      return tn(
        "Die Benachrichtigung konnte nicht geöffnet werden. Du findest sie auch in den Benachrichtigungen (Glocke).",
        "Die Benachrichtigung konnte nicht geöffnet werden. Sie finden sie auch in den Benachrichtigungen (Glocke).",
      );
  }
}
