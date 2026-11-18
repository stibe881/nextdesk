import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { loadRecentItems, type RecentItem } from "@/lib/recent-items";
import {
  RECENT_ITEM_TYPE_LABEL,
  recentItemAgeLabel,
  recentItemRoute,
  type RecentItemType,
} from "@/lib/recent-items-model";
import { makeThemedStyles, useAppColors } from "@/lib/themed-styles";
import { tn } from "@/lib/formality";

const COLLAPSED = 5;

const ICONS: Record<RecentItemType, keyof typeof Ionicons.glyphMap> = {
  ticket: "chatbubbles-outline",
  asset: "laptop-outline",
  knowledge_article: "book-outline",
};

/**
 * «Zuletzt angesehen» auf der Startseite: Tickets, Geräte und
 * Wissensartikel, die du zuletzt geöffnet hast – auch im Web.
 */
export function RecentItemsCard({ tenantId }: { tenantId: string }) {
  const router = useRouter();
  const styles = useStyles();
  const colors = useAppColors();
  const [state, setState] = useState<{
    tenantId: string;
    items: RecentItem[];
  } | null>(null);
  const [expanded, setExpanded] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!tenantId) return;
      let active = true;
      loadRecentItems(tenantId)
        .then((items) => {
          if (active) setState({ tenantId, items });
        })
        .catch(() => {
          // Optional: bei einem Fehler bleibt die Karte ausgeblendet.
          if (active) setState({ tenantId, items: [] });
        });
      return () => {
        active = false;
      };
    }, [tenantId]),
  );

  const items = state?.tenantId === tenantId ? state.items : [];
  if (items.length === 0) return null;
  const visible = expanded ? items : items.slice(0, COLLAPSED);

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.icon}>
          <Ionicons color={colors.primaryText} name="time-outline" size={17} />
        </View>
        <View style={styles.headerCopy}>
          <Text accessibilityRole="header" style={styles.title}>
            Zuletzt angesehen
          </Text>
          <Text style={styles.subtitle}>
            {tn("Auf allen deinen Geräten", "Auf allen Ihren Geräten")}
          </Text>
        </View>
      </View>
      {visible.map((item) => (
        <Pressable
          accessibilityHint={`${RECENT_ITEM_TYPE_LABEL[item.itemType]} öffnen`}
          accessibilityLabel={`${RECENT_ITEM_TYPE_LABEL[item.itemType]}: ${item.title}`}
          accessibilityRole="button"
          key={`${item.itemType}:${item.itemId}`}
          onPress={() => router.push(recentItemRoute(item) as never)}
          style={styles.row}
        >
          <Ionicons
            color={colors.muted}
            name={ICONS[item.itemType]}
            size={17}
          />
          <View style={styles.rowCopy}>
            <Text numberOfLines={1} style={styles.rowTitle}>
              {item.title}
            </Text>
            <Text numberOfLines={1} style={styles.rowMeta}>
              {RECENT_ITEM_TYPE_LABEL[item.itemType]} · {item.detail} ·{" "}
              {recentItemAgeLabel(item.viewedAt)}
            </Text>
          </View>
          <Ionicons color={colors.subtle} name="chevron-forward" size={16} />
        </Pressable>
      ))}
      {items.length > COLLAPSED ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => setExpanded((current) => !current)}
          style={styles.more}
        >
          <Text style={styles.moreText}>
            {expanded ? "Weniger anzeigen" : `Alle ${items.length} anzeigen`}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const useStyles = makeThemedStyles((c) => ({
  card: {
    backgroundColor: c.surface,
    borderColor: c.border,
    borderRadius: 20,
    borderWidth: 1,
    gap: 4,
    padding: 14,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    marginBottom: 4,
  },
  headerCopy: { flex: 1 },
  icon: {
    alignItems: "center",
    backgroundColor: c.primarySoft,
    borderRadius: 12,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  more: { alignItems: "center", paddingTop: 8 },
  moreText: { color: c.primaryText, fontSize: 13, fontWeight: "800" },
  row: {
    alignItems: "center",
    borderTopColor: c.border,
    borderTopWidth: 1,
    flexDirection: "row",
    gap: 10,
    paddingVertical: 9,
  },
  rowCopy: { flex: 1 },
  rowMeta: { color: c.muted, fontSize: 12 },
  rowTitle: { color: c.foreground, fontSize: 14, fontWeight: "700" },
  subtitle: { color: c.muted, fontSize: 12 },
  title: { color: c.foreground, fontSize: 16, fontWeight: "800" },
}));
