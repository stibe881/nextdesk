import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, Text, View } from "react-native";

import {
  loadOnboardingEntries,
  onboardingProgress,
  type OnboardingEntry,
} from "@/lib/nextdesk-onboarding";
import { makeThemedStyles, useAppColors } from "@/lib/themed-styles";

/**
 * Kompakter Hinweis auf offene Eintritte. Ohne Berechtigung, ohne Eintritte
 * oder bei einem Fehler bleibt die Karte unsichtbar.
 */
export function OnboardingHomeCard({ tenantId }: { tenantId: string | null }) {
  const router = useRouter();
  const colors = useAppColors();
  const styles = useStyles();
  const [entries, setEntries] = useState<OnboardingEntry[] | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!tenantId) {
        setEntries(null);
        return;
      }
      let active = true;
      void loadOnboardingEntries()
        .then((result) => {
          if (active) setEntries(result);
        })
        .catch(() => {
          if (active) setEntries(null);
        });
      return () => {
        active = false;
      };
    }, [tenantId]),
  );

  const open = (entries ?? []).filter((entry) => {
    const progress = onboardingProgress(entry.tasks);
    return progress.total === 0 || progress.done < progress.total;
  });
  if (open.length === 0) return null;
  const next = open[0]!;

  return (
    <Pressable
      accessibilityHint="Öffnet die Eintritte"
      accessibilityRole="button"
      onPress={() => router.push("/onboarding" as never)}
      style={[
        styles.card,
        { backgroundColor: colors.surface, borderColor: colors.border },
      ]}
    >
      <View style={[styles.icon, { backgroundColor: colors.primarySoft }]}>
        <Ionicons
          color={colors.primaryText}
          name="person-add-outline"
          size={22}
        />
      </View>
      <View style={styles.copy}>
        <Text style={[styles.title, { color: colors.foreground }]}>
          Eintritte
        </Text>
        <Text
          numberOfLines={1}
          style={[styles.subtitle, { color: colors.muted }]}
        >
          {open.length} offen · nächster: {next.employeeName}
        </Text>
      </View>
      <Ionicons color={colors.subtle} name="chevron-forward" size={18} />
    </Pressable>
  );
}

const useStyles = makeThemedStyles(() => ({
  card: {
    alignItems: "center",
    borderRadius: 22,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    padding: 17,
  },
  copy: { flex: 1, gap: 2 },
  icon: {
    alignItems: "center",
    borderRadius: 14,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  subtitle: { fontSize: 12 },
  title: { fontSize: 18, fontWeight: "800" },
}));
