import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import {
  loadOnboardingEntries,
  onboardingDetailRows,
  onboardingProgress,
  setOnboardingTaskStatus,
  type OnboardingEntry,
  type OnboardingTask,
  type OnboardingTaskStatus,
} from "@/lib/nextdesk-onboarding";
import { makeThemedStyles, useAppColors } from "@/lib/themed-styles";

function dateLabel(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("de-CH", {
        day: "numeric",
        month: "long",
        timeZone: "Europe/Zurich",
        year: "numeric",
      }).format(date);
}

const STATUS_LABELS: Record<OnboardingTaskStatus, string> = {
  blocked: "Blockiert",
  completed: "Erledigt",
  in_progress: "In Arbeit",
  open: "Offen",
};

export default function OnboardingScreen() {
  const router = useRouter();
  const colors = useAppColors();
  const styles = useStyles();
  const [entries, setEntries] = useState<OnboardingEntry[] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [busyTask, setBusyTask] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError("");
      const result = await loadOnboardingEntries();
      setEntries(result);
      setExpanded((current) => current ?? result[0]?.id ?? null);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Die Eintritte konnten nicht geladen werden.",
      );
    } finally {
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function toggleTask(item: OnboardingTask) {
    if (!item.canUpdate || busyTask) return;
    const next: OnboardingTaskStatus =
      item.status === "completed" ? "open" : "completed";
    setBusyTask(item.id);
    try {
      await setOnboardingTaskStatus(item.id, next);
      setEntries((current) =>
        (current ?? []).map((entry) => ({
          ...entry,
          tasks: entry.tasks.map((candidate) =>
            candidate.id === item.id
              ? { ...candidate, status: next }
              : candidate,
          ),
        })),
      );
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Die Aufgabe konnte nicht aktualisiert werden.",
      );
    } finally {
      setBusyTask(null);
    }
  }

  return (
    <ScreenContainer className="px-5">
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            onRefresh={() => {
              setRefreshing(true);
              void load();
            }}
            refreshing={refreshing}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.topBar}>
          <Pressable
            accessibilityLabel="Zurück"
            accessibilityRole="button"
            hitSlop={10}
            onPress={() => router.back()}
            style={styles.back}
          >
            <Ionicons color={colors.primaryText} name="arrow-back" size={22} />
          </Pressable>
          <Text style={styles.title}>Eintritte</Text>
          <View style={styles.back} />
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}
        {entries === null && !error ? (
          <ActivityIndicator color={colors.primary} style={styles.loader} />
        ) : null}
        {entries?.length === 0 ? (
          <Text style={styles.muted}>Keine Eintritte vorhanden.</Text>
        ) : null}

        {entries?.map((entry) => {
          const progress = onboardingProgress(entry.tasks);
          const open = expanded === entry.id;
          const rows =
            entry.source === "email" ? onboardingDetailRows(entry.details) : [];
          return (
            <View key={entry.id} style={styles.card}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: open }}
                onPress={() => setExpanded(open ? null : entry.id)}
                style={styles.cardHeader}
              >
                <View style={styles.cardCopy}>
                  <Text style={styles.name}>{entry.employeeName}</Text>
                  <Text style={styles.muted}>
                    Eintritt am {dateLabel(entry.startsOn)}
                    {entry.organisationUnit
                      ? ` · ${entry.organisationUnit}`
                      : ""}
                  </Text>
                </View>
                <Text style={styles.count}>
                  {progress.done}/{progress.total}
                </Text>
                <Ionicons
                  color={colors.subtle}
                  name={open ? "chevron-up" : "chevron-down"}
                  size={18}
                />
              </Pressable>
              <View style={styles.progressTrack}>
                <View
                  style={[
                    styles.progressFill,
                    { width: `${progress.percent}%` },
                  ]}
                />
              </View>

              {open ? (
                <View style={styles.body}>
                  <Text style={styles.muted}>
                    Führung: {entry.managerName || "–"} · ICT:{" "}
                    {entry.ictResponsibleName || "–"}
                  </Text>
                  {entry.tasks.map((item) => (
                    <Pressable
                      accessibilityRole="checkbox"
                      accessibilityState={{
                        checked: item.status === "completed",
                        disabled: !item.canUpdate,
                      }}
                      key={item.id}
                      onPress={() => void toggleTask(item)}
                      style={styles.task}
                    >
                      <Ionicons
                        color={
                          item.status === "completed"
                            ? colors.success
                            : colors.subtle
                        }
                        name={
                          item.status === "completed"
                            ? "checkmark-circle"
                            : "ellipse-outline"
                        }
                        size={24}
                      />
                      <View style={styles.taskCopy}>
                        <Text
                          style={[
                            styles.taskTitle,
                            item.status === "completed" && styles.taskDone,
                          ]}
                        >
                          {item.title}
                        </Text>
                        <Text style={styles.muted}>
                          Fällig {dateLabel(item.dueOn)} ·{" "}
                          {item.responsibleName}
                          {item.status !== "open" && item.status !== "completed"
                            ? ` · ${STATUS_LABELS[item.status]}`
                            : ""}
                        </Text>
                      </View>
                      {busyTask === item.id ? (
                        <ActivityIndicator
                          color={colors.primary}
                          size="small"
                        />
                      ) : null}
                    </Pressable>
                  ))}
                  {rows.length > 0 ? (
                    <View style={styles.details}>
                      <Text style={styles.detailsTitle}>
                        Angaben aus der Eintrittsmeldung
                      </Text>
                      {rows.map((row) => (
                        <View key={row.label} style={styles.detailRow}>
                          <Text style={styles.detailLabel}>{row.label}</Text>
                          <Text style={styles.detailValue}>{row.value}</Text>
                        </View>
                      ))}
                    </View>
                  ) : null}
                </View>
              ) : null}
            </View>
          );
        })}
      </ScrollView>
    </ScreenContainer>
  );
}

const useStyles = makeThemedStyles((c) => ({
  back: {
    alignItems: "center",
    backgroundColor: c.primarySoft,
    borderRadius: 18,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  body: { gap: 12, paddingTop: 12 },
  card: {
    backgroundColor: c.surface,
    borderColor: c.border,
    borderRadius: 18,
    borderWidth: 1,
    padding: 16,
  },
  cardCopy: { flex: 1, gap: 2 },
  cardHeader: { alignItems: "center", flexDirection: "row", gap: 10 },
  content: { gap: 14, paddingBottom: 120, paddingTop: 14 },
  count: { color: c.primaryText, fontSize: 13, fontWeight: "900" },
  detailLabel: { color: c.muted, fontSize: 11, fontWeight: "800" },
  detailRow: { gap: 2 },
  details: {
    borderColor: c.border,
    borderTopWidth: 1,
    gap: 10,
    paddingTop: 12,
  },
  detailsTitle: { color: c.foreground, fontSize: 13, fontWeight: "900" },
  detailValue: { color: c.foreground, fontSize: 14, lineHeight: 20 },
  error: { color: c.error, fontSize: 14 },
  loader: { marginTop: 30 },
  muted: { color: c.muted, fontSize: 13, lineHeight: 18 },
  name: { color: c.foreground, fontSize: 17, fontWeight: "900" },
  progressFill: {
    backgroundColor: c.primary,
    borderRadius: 4,
    height: 6,
  },
  progressTrack: {
    backgroundColor: c.primarySoft,
    borderRadius: 4,
    height: 6,
    marginTop: 12,
    overflow: "hidden",
  },
  task: { alignItems: "center", flexDirection: "row", gap: 10 },
  taskCopy: { flex: 1, gap: 2 },
  taskDone: { opacity: 0.55, textDecorationLine: "line-through" },
  taskTitle: { color: c.foreground, fontSize: 14, fontWeight: "700" },
  title: { color: c.foreground, fontSize: 18, fontWeight: "800" },
  topBar: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
}));
