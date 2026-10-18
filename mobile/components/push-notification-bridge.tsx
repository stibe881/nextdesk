import * as Notifications from "expo-notifications";
import { useRouter } from "expo-router";
import { useEffect, useRef } from "react";
import { AppState, Platform, type AppStateStatus } from "react-native";

import {
  getMobileUserId,
  loadCurrentTenant,
  nextDesk,
} from "@/lib/nextdesk-client";
import { reregisterPushTokenIfEnabled } from "@/lib/push-notifications";

if (Platform.OS === "ios") {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: false,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

type PushNavigationData = {
  tenantId: string;
  ticketId?: string;
  notificationId?: string;
  kind?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePushNavigationData(value: unknown): PushNavigationData | null {
  if (!isRecord(value)) return null;
  const nestedBody = isRecord(value.body) ? value.body : value;
  if (typeof nestedBody.tenantId !== "string" || !nestedBody.tenantId) {
    return null;
  }
  return {
    tenantId: nestedBody.tenantId,
    ...(typeof nestedBody.ticketId === "string" && nestedBody.ticketId
      ? { ticketId: nestedBody.ticketId }
      : {}),
    ...(typeof nestedBody.notificationId === "string" &&
    nestedBody.notificationId
      ? { notificationId: nestedBody.notificationId }
      : {}),
    ...(typeof nestedBody.kind === "string" && nestedBody.kind
      ? { kind: nestedBody.kind }
      : {}),
  };
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

async function clearBadge(): Promise<void> {
  if (Platform.OS !== "ios") return;
  await Notifications.setBadgeCountAsync(0).catch(() => undefined);
}

export function PushNotificationBridge() {
  const router = useRouter();
  const handledResponseIds = useRef(new Set<string>());

  useEffect(() => {
    if (Platform.OS !== "ios") return;
    let active = true;

    const handleResponse = async (
      response: Notifications.NotificationResponse,
    ) => {
      const responseId = response.notification.request.identifier;
      if (handledResponseIds.current.has(responseId)) return;
      handledResponseIds.current.add(responseId);

      const data = navigationDataFromNotification(response.notification);
      if (!data || !nextDesk) return;

      try {
        const {
          data: { session },
        } = await nextDesk.auth.getSession();
        if (!active || !session?.user.id) return;

        const tenant = await loadCurrentTenant();
        if (!active || tenant.id !== data.tenantId) return;

        if (data.ticketId) {
          router.push({
            pathname: "/ticket/[id]",
            params: { id: data.ticketId },
          });
        } else if (data.kind === "summary") {
          router.push("/tickets");
        } else {
          return;
        }

        if (data.notificationId) {
          void nextDesk.functions
            .invoke("notification-center", {
              body: { type: "markRead", notificationId: data.notificationId },
            })
            .catch(() => undefined);
        }
      } catch {
        // A stale session, missing server Function or tenant lookup failure must
        // never route a notification into another workspace.
      }
    };

    const responseSubscription =
      Notifications.addNotificationResponseReceivedListener((response) => {
        void handleResponse(response);
      });

    void Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (response) return handleResponse(response);
      })
      .catch(() => undefined);

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
  }, [router]);

  return null;
}
