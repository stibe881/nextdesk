import { Ionicons } from "@expo/vector-icons";
import { type Href, useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";

import { useMobileFeatures } from "@/components/mobile-feature-gate";
import { ScreenContainer } from "@/components/screen-container";
import { hapticSelection } from "@/lib/mobile-haptics";
import {
  loadInboxNotifications,
  markAllInboxNotificationsRead,
  markInboxNotificationRead,
} from "@/lib/notification-inbox";
import {
  formatInboxTime,
  inboxPresentation,
  inboxRoute,
  inboxUnreadCount,
  type InboxNotification,
  markInboxRead,
} from "@/lib/notification-inbox-model";
import { makeThemedStyles, useAppColors } from "@/lib/themed-styles";
import { useMobileSessionGuard } from "@/lib/use-mobile-session-guard";
import { tn } from "@/lib/formality";

/**
 * Mitteilungen: die letzten Benachrichtigungen des Arbeitsbereichs (alle
 * Arten, wie die Glocke im Web). Ziel von Sammelmitteilungen; ein Tipp
 * öffnet das Objekt wie die einzelne Push-Mitteilung.
 */
export default function InboxScreen() {
  const router = useRouter();
  const styles = useStyles();
  const colors = useAppColors();
  const checkingSession = useMobileSessionGuard();
  const {
    isEnabled,
    loading: checkingFeatures,
    tenantId,
  } = useMobileFeatures();
  const [items, setItems] = useState<InboxNotification[] | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!tenantId) return;
    try {
      setItems(await loadInboxNotifications(tenantId));
      setError("");
    } catch (nextError) {
      setError(
        nextError instanceof Error && nextError.message
          ? nextError.message
          : "Die Mitteilungen konnten nicht geladen werden.",
      );
    }
  }, [tenantId]);

  useFocusEffect(
    useCallback(() => {
      if (!checkingSession && !checkingFeatures) void load();
    }, [checkingFeatures, checkingSession, load]),
  );

  async function refresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  function open(notification: InboxNotification) {
    void hapticSelection();
    if (!notification.readAt) {
      const readAt = new Date().toISOString();
      setItems((current) =>
        current ? markInboxRead(current, notification.id, readAt) : current,
      );
      void markInboxNotificationRead(notification.id).catch(() => undefined);
    }
    const route = inboxRoute(notification);
    if (!route) {
      Alert.alert(
        "Mitteilung",
        tn("Zu dieser Mitteilung gibt es in der App nichts zu öffnen. Details findest du in der Web-App.", "Zu dieser Mitteilung gibt es in der App nichts zu öffnen. Details finden Sie in der Web-App."),
      );
      return;
    }
    if (route.kind === "message") {
      Alert.alert(route.title, route.message);
      return;
    }
    if (route.kind === "ticket") {
      router.push({ pathname: "/ticket/[id]", params: { id: route.ticketId } });
      return;
    }
    if (route.feature && !isEnabled(route.feature)) {
      Alert.alert(
        "Nicht verfügbar",
        tn("Diese Funktion ist in deinem Arbeitsbereich nicht freigeschaltet oder dir fehlt die Berechtigung.", "Diese Funktion ist in Ihrem Arbeitsbereich nicht freigeschaltet oder Ihnen fehlt die Berechtigung."),
      );
      return;
    }
    router.push(route.path as Href);
  }

  async function markAll() {
    if (!tenantId || busy) return;
    setBusy(true);
    try {
      await markAllInboxNotificationsRead(tenantId);
      const readAt = new Date().toISOString();
      setItems((current) =>
        current ? markInboxRead(current, "all", readAt) : current,
      );
    } catch (nextError) {
      setError(
        nextError instanceof Error && nextError.message
          ? nextError.message
          : "Die Mitteilungen konnten nicht als gelesen markiert werden.",
      );
    } finally {
      setBusy(false);
    }
  }

  const unread = items ? inboxUnreadCount(items) : 0;
  const now = new Date();

  return (
    <ScreenContainer className="px-5">
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            onRefresh={() => void refresh()}
            refreshing={refreshing}
            tintColor={colors.primary}
          />
        }
      >
        <View style={styles.topRow}>
          <Pressable
            accessibilityLabel="Zurück"
            accessibilityRole="button"
            onPress={() =>
              router.canGoBack() ? router.back() : router.replace("/")
            }
            style={styles.back}
          >
            <Ionicons
              color={colors.primaryText}
              name="chevron-back"
              size={20}
            />
            <Text style={styles.backText}>Zurück</Text>
          </Pressable>
          <Pressable
            accessibilityLabel="Einstellungen für Mitteilungen"
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => router.push("/notifications")}
          >
            <Ionicons color={colors.muted} name="settings-outline" size={21} />
          </Pressable>
        </View>
        <Text style={styles.eyebrow}>MITTEILUNGEN</Text>
        <View style={styles.titleRow}>
          <Text accessibilityRole="header" style={styles.title}>
            {unread > 0 ? `${unread} ungelesen` : "Alles gelesen"}
          </Text>
          {unread > 0 ? (
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => void markAll()}
              style={styles.markAll}
            >
              <Text style={styles.markAllText}>
                {busy ? "Wird markiert …" : "Alle gelesen"}
              </Text>
            </Pressable>
          ) : null}
        </View>

        {error ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        ) : null}

        {checkingSession || checkingFeatures || (!items && !error) ? (
          <ActivityIndicator color={colors.primary} />
        ) : items && items.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons
              color={colors.muted}
              name="notifications-off-outline"
              size={30}
            />
            <Text style={styles.emptyTitle}>Keine Mitteilungen</Text>
            <Text style={styles.hint}>
              Hier erscheinen Benachrichtigungen zu Tickets, Bestellungen,
              Störungen und mehr.
            </Text>
          </View>
        ) : (
          <View style={styles.list}>
            {(items ?? []).map((notification) => {
              const presentation = inboxPresentation(notification);
              const isUnread = !notification.readAt;
              const time = formatInboxTime(notification.createdAt, now);
              return (
                <Pressable
                  accessibilityHint="Öffnet den Eintrag"
                  accessibilityLabel={[
                    isUnread ? "Ungelesen" : null,
                    presentation.title,
                    presentation.detail,
                    time,
                  ]
                    .filter(Boolean)
                    .join(", ")}
                  accessibilityRole="button"
                  key={notification.id}
                  onPress={() => open(notification)}
                  style={({ pressed }) => [
                    styles.row,
                    isUnread && styles.rowUnread,
                    pressed && styles.rowPressed,
                  ]}
                >
                  <View style={styles.icon}>
                    <Ionicons
                      color={colors.primaryText}
                      name={presentation.icon}
                      size={19}
                    />
                  </View>
                  <View style={styles.rowText}>
                    <Text
                      numberOfLines={1}
                      style={[styles.rowTitle, isUnread && styles.bold]}
                    >
                      {presentation.title}
                    </Text>
                    {presentation.detail ? (
                      <Text numberOfLines={2} style={styles.rowDetail}>
                        {presentation.detail}
                      </Text>
                    ) : null}
                    <Text style={styles.rowTime}>{time}</Text>
                  </View>
                  {isUnread ? <View style={styles.dot} /> : null}
                </Pressable>
              );
            })}
          </View>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

const useStyles = makeThemedStyles((c) => ({
  back: { alignItems: "center", flexDirection: "row", gap: 4 },
  backText: { color: c.primaryText, fontSize: 15, fontWeight: "700" },
  bold: { fontWeight: "800" },
  content: { gap: 14, paddingBottom: 40, paddingTop: 12 },
  dot: {
    backgroundColor: c.primary,
    borderRadius: 5,
    height: 10,
    marginTop: 6,
    width: 10,
  },
  empty: { alignItems: "center", gap: 8, paddingVertical: 32 },
  emptyTitle: { color: c.foreground, fontSize: 16, fontWeight: "800" },
  error: { color: c.error, fontSize: 13 },
  eyebrow: {
    color: c.muted,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1,
  },
  hint: { color: c.muted, fontSize: 13, lineHeight: 19, textAlign: "center" },
  icon: {
    alignItems: "center",
    backgroundColor: c.primarySoft,
    borderRadius: 18,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  list: { gap: 8 },
  markAll: {
    borderColor: c.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  markAllText: { color: c.primaryText, fontSize: 13, fontWeight: "700" },
  row: {
    alignItems: "flex-start",
    backgroundColor: c.surface,
    borderColor: c.border,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    padding: 12,
  },
  rowDetail: { color: c.text, fontSize: 13, lineHeight: 18 },
  rowPressed: { opacity: 0.7 },
  rowText: { flex: 1, gap: 2, minWidth: 0 },
  rowTime: { color: c.muted, fontSize: 12 },
  rowTitle: { color: c.foreground, fontSize: 15, fontWeight: "600" },
  rowUnread: { borderColor: c.primary },
  title: { color: c.foreground, flex: 1, fontSize: 24, fontWeight: "900" },
  titleRow: { alignItems: "center", flexDirection: "row", gap: 10 },
  topRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
}));
