import * as Notifications from "expo-notifications";
import { type Href, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, AppState, Platform, type AppStateStatus } from "react-native";

import { useMobileFeatures } from "@/components/mobile-feature-gate";

import {
  getMobileUserId,
  loadCurrentTenant,
  nextDesk,
} from "@/lib/nextdesk-client";
import { reregisterPushTokenIfEnabled } from "@/lib/push-notifications";
import {
  parsePushNavigationData,
  type PushNavigationData,
  pushRoute,
} from "@/lib/push-navigation";
import {
  REMINDER_ACTION_NEED_HELP,
  REMINDER_ACTION_RESOLVED,
  REQUESTER_REMINDER_CATEGORY,
  reminderAnswerFromNotificationAction,
} from "@/lib/requester-progress";
import {
  isNotificationAction,
  startNotificationActions,
} from "@/lib/notification-actions";
import { startWatchBridge } from "@/lib/watch-bridge";

// Antwort-Knöpfe (iPhone-Sperrbildschirm, Apple Watch) und die Verbindung zur
// Watch-App schon beim Laden des Moduls starten, damit sie auch bei einem
// Hintergrundstart greifen (z. B. wenn die Watch ein Token anfragt).
startNotificationActions();
startWatchBridge();

if (Platform.OS === "ios") {
  // Reminder pushes (category set by push-dispatch) offer two buttons. Both
  // open the ticket; the person confirms there, nothing changes from the
  // lock screen alone.
  void Notifications.setNotificationCategoryAsync(REQUESTER_REMINDER_CATEGORY, [
    {
      identifier: REMINDER_ACTION_RESOLVED,
      buttonTitle: "Problem ist gelöst",
      options: { opensAppToForeground: true },
    },
    {
      identifier: REMINDER_ACTION_NEED_HELP,
      buttonTitle: "Ich brauche noch Hilfe",
      options: { opensAppToForeground: true },
    },
  ]).catch(() => undefined);
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: false,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

function navigationDataFromNotification(
  notification: Notifications.Notification,
): PushNavigationData | null {
  const contentData = parsePushNavigationData(
    notification.request.content.data,
  );
  if (contentData) return contentData;

  const { trigger } = notification.request;
  if (!trigger || !("type" in trigger) || trigger.type !== "push") return null;
  if (!("payload" in trigger)) return null;
  return parsePushNavigationData(trigger.payload?.body);
}

type PendingTap = {
  data: PushNavigationData;
  actionIdentifier: string;
  /** Wechsel in den Arbeitsbereich der Mitteilung wurde schon versucht. */
  switchTried: boolean;
};

async function clearBadge(): Promise<void> {
  if (Platform.OS !== "ios") return;
  await Notifications.setBadgeCountAsync(0).catch(() => undefined);
}

export function PushNotificationBridge() {
  const router = useRouter();
  const { isEnabled, loading, switchTenant, tenantId } = useMobileFeatures();
  const ready = !loading && Boolean(tenantId);
  const handledResponseIds = useRef(new Set<string>());
  const pending = useRef<PendingTap | null>(null);
  const switching = useRef(false);
  const [retry, setRetry] = useState(0);
  // Aktueller Stand für asynchrone Abläufe (Kaltstart, Wechsel).
  const current = useRef({ isEnabled, ready, router, switchTenant, tenantId });
  useEffect(() => {
    current.current = { isEnabled, ready, router, switchTenant, tenantId };
  });

  /**
   * Öffnet das Objekt der angetippten Mitteilung, sobald der Arbeitsbereich
   * bestätigt ist (auch beim Kaltstart). Gehört die Mitteilung zu einem
   * anderen Arbeitsbereich, wird zuerst dorthin gewechselt.
   */
  const process = useCallback(async () => {
    const tap = pending.current;
    const state = current.current;
    if (!tap || switching.current || !state.ready || !state.tenantId) return;

    if (tap.data.tenantId !== state.tenantId) {
      if (tap.switchTried) {
        pending.current = null;
        return;
      }
      tap.switchTried = true;
      switching.current = true;
      try {
        // Der Wechsel bestätigt Mitgliedschaft und Freigaben neu; danach
        // läuft process() über den Effekt erneut.
        await state.switchTenant(tap.data.tenantId);
      } catch (error) {
        pending.current = null;
        Alert.alert(
          "Mitteilung aus einem anderen Arbeitsbereich",
          error instanceof Error && error.message
            ? `Der Arbeitsbereich dieser Mitteilung kann nicht geöffnet werden: ${error.message}`
            : "Der Arbeitsbereich dieser Mitteilung kann nicht geöffnet werden.",
        );
      } finally {
        switching.current = false;
      }
      // Falls der Effekt schon vor dem Ende des Wechsels lief.
      setRetry((value) => value + 1);
      return;
    }

    pending.current = null;
    const route = pushRoute(tap.data);
    const navigate = () => {
      const { router: nextRouter, isEnabled: enabled } = current.current;
      if (!route) return;
      if (route.kind === "message") {
        Alert.alert(route.title, route.message);
        return;
      }
      if (route.kind === "ticket") {
        const reminderAnswer = reminderAnswerFromNotificationAction(
          tap.actionIdentifier,
        );
        nextRouter.push({
          pathname: "/ticket/[id]",
          params: reminderAnswer
            ? { id: route.ticketId, reminderAnswer }
            : { id: route.ticketId },
        });
        return;
      }
      if (route.feature && !enabled(route.feature)) {
        Alert.alert(
          "Nicht verfügbar",
          "Diese Funktion ist in deinem Arbeitsbereich nicht freigeschaltet oder dir fehlt die Berechtigung.",
        );
        return;
      }
      nextRouter.push(route.path as Href);
    };
    // Nach einem Wechsel wird der Routenbaum neu aufgebaut; kurz warten.
    if (tap.switchTried) setTimeout(navigate, 350);
    else navigate();

    if (tap.data.notificationId && nextDesk) {
      void nextDesk.functions
        .invoke("notification-center", {
          body: { type: "markRead", notificationId: tap.data.notificationId },
        })
        .catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    void process();
  }, [process, ready, retry, tenantId]);

  useEffect(() => {
    if (Platform.OS !== "ios") return;
    let active = true;

    const handleResponse = (response: Notifications.NotificationResponse) => {
      // Antwort-Knöpfe führen eine Aktion aus und öffnen kein Ticket.
      if (isNotificationAction(response)) return;
      const responseId = response.notification.request.identifier;
      if (handledResponseIds.current.has(responseId)) return;
      handledResponseIds.current.add(responseId);
      // Beim nächsten Start nicht nochmals öffnen.
      try {
        Notifications.clearLastNotificationResponse();
      } catch {
        // Older native module: harmless.
      }

      const data = navigationDataFromNotification(response.notification);
      if (!data) return;
      pending.current = {
        data,
        actionIdentifier: response.actionIdentifier,
        switchTried: false,
      };
      void process();
    };

    const responseSubscription =
      Notifications.addNotificationResponseReceivedListener(handleResponse);

    // Kaltstart: die App wurde über die Mitteilung geöffnet.
    try {
      const initial = Notifications.getLastNotificationResponse();
      if (initial) handleResponse(initial);
    } catch {
      // Not available: the listener still handles later taps.
    }

    const tokenSubscription = Notifications.addPushTokenListener((token) => {
      void (async () => {
        if (token.type !== "ios" || !nextDesk) return;
        try {
          const {
            data: { session },
          } = await nextDesk.auth.getSession();
          if (!active || !session?.user.id) return;
          const [tenant, userId] = await Promise.all([
            loadCurrentTenant(),
            getMobileUserId(),
          ]);
          if (!active) return;
          await reregisterPushTokenIfEnabled(
            { tenantId: tenant.id, userId },
            token,
          );
        } catch {
          // The next explicit enable action or future token roll will retry.
        }
      })();
    });

    let previousAppState: AppStateStatus = AppState.currentState;
    void clearBadge();
    const appStateSubscription = AppState.addEventListener(
      "change",
      (state) => {
        const becameActive =
          previousAppState !== "active" && state === "active";
        previousAppState = state;
        if (becameActive) void clearBadge();
      },
    );

    return () => {
      active = false;
      responseSubscription.remove();
      tokenSubscription.remove();
      appStateSubscription.remove();
    };
  }, [process]);

  return null;
}
