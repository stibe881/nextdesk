import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  Pressable,
  type StyleProp,
  Text,
  View,
  type ViewStyle,
} from "react-native";

import { loadInboxNotifications } from "@/lib/notification-inbox";
import { inboxUnreadCount } from "@/lib/notification-inbox-model";
import { makeThemedStyles, useAppColors } from "@/lib/themed-styles";

/** Glocke im Kopf des Home: öffnet die Mitteilungen, zeigt Ungelesene. */
export function NotificationBellButton({
  tenantId,
  style,
}: {
  tenantId: string | null;
  style?: StyleProp<ViewStyle>;
}) {
  const router = useRouter();
  const styles = useStyles();
  const colors = useAppColors();
  const [unread, setUnread] = useState<{ tenantId: string; count: number }>();

  useFocusEffect(
    useCallback(() => {
      if (!tenantId) return;
      let active = true;
      void loadInboxNotifications(tenantId, { unreadOnly: true, limit: 100 })
        .then((items) => {
          if (active) setUnread({ tenantId, count: inboxUnreadCount(items) });
        })
        .catch(() => undefined);
      return () => {
        active = false;
      };
    }, [tenantId]),
  );

  const count = unread && unread.tenantId === tenantId ? unread.count : 0;
  const label = count > 99 ? "99+" : String(count);

  return (
    <Pressable
      accessibilityLabel={
        count > 0
          ? `Mitteilungen öffnen, ${count} ungelesen`
          : "Mitteilungen öffnen"
      }
      accessibilityRole="button"
      onPress={() => router.push("/inbox")}
      style={style}
    >
      <Ionicons
        color={colors.primaryText}
        name={count > 0 ? "notifications" : "notifications-outline"}
        size={21}
      />
      {count > 0 ? (
        <View pointerEvents="none" style={styles.badge}>
          <Text style={styles.badgeText}>{label}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const useStyles = makeThemedStyles((c) => ({
  badge: {
    alignItems: "center",
    backgroundColor: c.error,
    borderRadius: 9,
    height: 18,
    justifyContent: "center",
    minWidth: 18,
    paddingHorizontal: 4,
    position: "absolute",
    right: 2,
    top: 2,
  },
  badgeText: { color: c.onPrimary, fontSize: 10, fontWeight: "800" },
}));
