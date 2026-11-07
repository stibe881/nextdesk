import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { loadMyPriorities, type PriorityItem } from "@/lib/my-priorities";
import { NextDeskRequestError } from "@/lib/nextdesk-error-messages";
import { makeThemedStyles, useAppColors } from "@/lib/themed-styles";

/** Top three of «Meine Prioritäten» on the home screen (agents only). */
export function MyPrioritiesCard({
  tenantId,
  refreshKey,
}: {
  tenantId: string;
  refreshKey: number;
}) {
  const router = useRouter();
  const styles = useStyles();
  const colors = useAppColors();
  const [items, setItems] = useState<PriorityItem[] | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!tenantId) return;
    let active = true;
    loadMyPriorities(tenantId)
      .then((list) => {
        if (active) setItems(list.tickets);
      })
      .catch((error) => {
        // Requesters have no assigned tickets: hide the card for them.
        if (
          active &&
          error instanceof NextDeskRequestError &&
          error.status === 403
        ) {
          setHidden(true);
        }
      });
    return () => {
      active = false;
    };
  }, [tenantId, refreshKey]);

  if (hidden || !items || items.length === 0) return null;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.icon}>
          <Ionicons color={colors.primaryText} name="sparkles" size={17} />
        </View>
        <View style={styles.headerCopy}>
          <Text style={styles.title}>Meine Prioritäten</Text>
          <Text style={styles.subtitle}>
            {items.length} zugewiesen · Reihenfolge von der KI
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push("/priorities" as never)}
        >
          <Text style={styles.all}>Alle</Text>
        </Pressable>
      </View>
      {items.slice(0, 3).map((item) => (
        <Pressable
          accessibilityRole="button"
          key={item.id}
          onPress={() =>
            router.push({ pathname: "/ticket/[id]", params: { id: item.id } })
          }
          style={styles.row}
        >
          <Text style={styles.rank}>{item.position}</Text>
          <View style={styles.rowCopy}>
            <Text numberOfLines={1} style={styles.rowTitle}>
              {item.subject}
            </Text>
            <Text numberOfLines={1} style={styles.rowMeta}>
              {item.reason ?? item.priorityLabel}
            </Text>
          </View>
          <Ionicons color={colors.subtle} name="chevron-forward" size={16} />
        </Pressable>
      ))}
    </View>
  );
}

const useStyles = makeThemedStyles((c) => ({
  all: { color: c.primaryText, fontSize: 13, fontWeight: "800" },
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
  rank: {
    color: c.primaryText,
    fontSize: 13,
    fontWeight: "900",
    textAlign: "center",
    width: 22,
  },
  row: {
    alignItems: "center",
    borderTopColor: c.border,
    borderTopWidth: 1,
    flexDirection: "row",
    gap: 8,
    paddingVertical: 9,
  },
  rowCopy: { flex: 1 },
  rowMeta: { color: c.muted, fontSize: 12 },
  rowTitle: { color: c.foreground, fontSize: 14, fontWeight: "700" },
  subtitle: { color: c.muted, fontSize: 12 },
  title: { color: c.foreground, fontSize: 16, fontWeight: "800" },
}));
