import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import {
  getMobileUserId,
  invokeNextDesk,
  loadCurrentTenant,
  nextDesk,
} from "@/lib/nextdesk-client";

/**
 * Antwort-Knöpfe in Mitteilungen (iPhone-Sperrbildschirm und Apple Watch).
 *
 * Der Server setzt die Kategorie in der Push-Nachricht
 * (supabase/functions/_shared/apns.ts). Die Aktionen laufen im Hintergrund mit
 * der Anmeldung der App; nextDesk prüft die Rechte wie in der App selbst.
 */
export const TICKET_CATEGORY = "NEXTDESK_TICKET";
export const SERVICE_TASK_CATEGORY = "NEXTDESK_SERVICE_TASK";

const ACTION_NOTE = "ticket.note";
const ACTION_TAKE = "ticket.take";
const ACTION_PROGRESS = "ticket.progress";
const ACTION_TASK_DONE = "task.complete";
const OUR_ACTIONS = new Set([
  ACTION_NOTE,
  ACTION_TAKE,
  ACTION_PROGRESS,
  ACTION_TASK_DONE,
]);

const HANDLED_KEY = "nextdesk.notificationActions.handled";
const HANDLED_LIMIT = 50;
const ACTION_NOTE_SUFFIX = "Erfasst über die Mitteilung.";

let registered: Promise<void> | null = null;

/** Registriert die Knöpfe einmal pro App-Start (nur iOS). */
export function registerNotificationActions(): Promise<void> {
  if (Platform.OS !== "ios") return Promise.resolve();
  registered ??= (async () => {
    await Notifications.setNotificationCategoryAsync(TICKET_CATEGORY, [
      {
        identifier: ACTION_NOTE,
        buttonTitle: "Notiz",
        textInput: {
          submitButtonTitle: "Speichern",
          placeholder: "Interne Notiz",
        },
        options: {
          opensAppToForeground: false,
          isAuthenticationRequired: true,
        },
      },
      {
        identifier: ACTION_TAKE,
        buttonTitle: "Mir zuweisen",
        options: {
          opensAppToForeground: false,
          isAuthenticationRequired: true,
        },
      },
      {
        identifier: ACTION_PROGRESS,
        buttonTitle: "In Bearbeitung",
        options: {
          opensAppToForeground: false,
          isAuthenticationRequired: true,
        },
      },
    ]);
    await Notifications.setNotificationCategoryAsync(SERVICE_TASK_CATEGORY, [
      {
        identifier: ACTION_TASK_DONE,
        buttonTitle: "Erledigt",
        options: {
          opensAppToForeground: false,
          isAuthenticationRequired: true,
        },
      },
    ]);
  })().catch(() => {
    registered = null;
  });
  return registered;
}

/** true, wenn die Antwort ein Antwort-Knopf von nextDesk ist. */
export function isNotificationAction(
  response: Notifications.NotificationResponse,
): boolean {
  return OUR_ACTIONS.has(response.actionIdentifier);
}

type ActionData = {
  tenantId: string;
  ticketId?: string;
  occurrenceId?: string;
  notificationId?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function actionData(
  response: Notifications.NotificationResponse,
): ActionData | null {
  const { content, trigger } = response.notification.request;
  const candidates: unknown[] = [content.data];
  if (
    trigger &&
    "type" in trigger &&
    trigger.type === "push" &&
    "payload" in trigger
  ) {
    candidates.push(trigger.payload?.body);
  }
  for (const candidate of candidates) {
    if (!isRecord(candidate)) continue;
    const value = isRecord(candidate.body) ? candidate.body : candidate;
    if (typeof value.tenantId !== "string" || !value.tenantId) continue;
    const text = (key: string) =>
      typeof value[key] === "string" && value[key]
        ? (value[key] as string)
        : undefined;
    return {
      tenantId: value.tenantId,
      ticketId: text("ticketId"),
      occurrenceId: text("occurrenceId"),
      notificationId: text("notificationId"),
    };
  }
  return null;
}

/** Verhindert, dass dieselbe Antwort nach einem Neustart erneut ausgeführt wird. */
async function claimResponse(key: string): Promise<boolean> {
  try {
    const stored = JSON.parse(
      (await AsyncStorage.getItem(HANDLED_KEY)) ?? "[]",
    );
    const handled: string[] = Array.isArray(stored) ? stored : [];
    if (handled.includes(key)) return false;
    await AsyncStorage.setItem(
      HANDLED_KEY,
      JSON.stringify([...handled, key].slice(-HANDLED_LIMIT)),
    );
    return true;
  } catch {
    return true;
  }
}

async function feedback(body: string): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    content: { title: "nextDesk", body, sound: false },
    trigger: null,
  }).catch(() => undefined);
}

/**
 * Führt einen Antwort-Knopf aus. Läuft auch, wenn iOS die App dafür nur im
 * Hintergrund startet; das Ergebnis meldet eine kurze Mitteilung.
 */
export async function handleNotificationAction(
  response: Notifications.NotificationResponse,
): Promise<void> {
  if (!isNotificationAction(response) || !nextDesk) return;
  const key = `${response.notification.request.identifier}:${response.actionIdentifier}`;
  if (!(await claimResponse(key))) return;
  const data = actionData(response);
  if (!data) return;

  try {
    const {
      data: { session },
    } = await nextDesk.auth.getSession();
    if (!session?.user.id) {
      await feedback("Bitte zuerst in der nextDesk-App anmelden.");
      return;
    }
    // Nie in einem anderen Arbeitsbereich handeln als dem der Mitteilung.
    const tenant = await loadCurrentTenant();
    if (tenant.id !== data.tenantId) {
      await feedback(
        "Die Mitteilung gehört zu einem anderen Arbeitsbereich. Bitte in der App ausführen.",
      );
      return;
    }

    switch (response.actionIdentifier) {
      case ACTION_TAKE: {
        if (!data.ticketId) return;
        const userId = await getMobileUserId();
        await invokeNextDesk("ticket-operations", {
          type: "updateTicket",
          tenantId: tenant.id,
          ticketId: data.ticketId,
          assignedAgentId: userId,
        });
        await feedback(tn("Das Ticket ist dir zugewiesen.", "Das Ticket ist Ihnen zugewiesen."));
        break;
      }
      case ACTION_PROGRESS: {
        if (!data.ticketId) return;
        await invokeNextDesk("ticket-operations", {
          type: "updateTicket",
          tenantId: tenant.id,
          ticketId: data.ticketId,
          statusKey: "in_progress",
        });
        await feedback("Das Ticket ist in Bearbeitung.");
        break;
      }
      case ACTION_NOTE: {
        const text = response.userText?.trim();
        if (!data.ticketId || !text) return;
        await invokeNextDesk("ticket-operations", {
          type: "addComment",
          tenantId: tenant.id,
          ticketId: data.ticketId,
          body: `${text.slice(0, 7900)}\n\n${ACTION_NOTE_SUFFIX}`,
          visibility: "internal",
        });
        await feedback("Die interne Notiz ist gespeichert.");
        break;
      }
      case ACTION_TASK_DONE: {
        if (!data.occurrenceId) return;
        await invokeNextDesk("service-tasks", {
          type: "updateOccurrence",
          tenantId: tenant.id,
          occurrenceId: data.occurrenceId,
          action: "complete",
        });
        await feedback("Die Serviceaufgabe ist erledigt.");
        break;
      }
    }

    if (data.notificationId) {
      void invokeNextDesk("notification-center", {
        type: "markRead",
        notificationId: data.notificationId,
      }).catch(() => undefined);
    }
  } catch (error) {
    const message =
      error instanceof Error && error.message
        ? error.message
        : "Die Aktion war nicht möglich.";
    await feedback(`Nicht ausgeführt: ${message}`);
  }
}

let listening = false;

/**
 * Startet die Verarbeitung der Antwort-Knöpfe. Wird beim Laden des Moduls
 * aufgerufen, damit sie auch bei einem Hintergrundstart ohne sichtbare
 * Oberfläche greift.
 */
export function startNotificationActions(): void {
  if (Platform.OS !== "ios" || listening) return;
  listening = true;
  void registerNotificationActions();
  Notifications.addNotificationResponseReceivedListener((response) => {
    void handleNotificationAction(response);
  });
  void Notifications.getLastNotificationResponseAsync()
    .then((response) => {
      if (response) return handleNotificationAction(response);
    })
    .catch(() => undefined);
}
