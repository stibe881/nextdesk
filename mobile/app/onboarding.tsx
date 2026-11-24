import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import {
  assignOnboardingEntry,
  loadOnboardingWorkspace,
  onboardingDetailRows,
  onboardingDocumentUrl,
  onboardingProgress,
  setOnboardingTaskStatus,
  type OnboardingAgent,
  type OnboardingEntry,
  type OnboardingTask,
  type OnboardingTaskStatus,
} from "@/lib/nextdesk-onboarding";
import { changeSummary } from "@/lib/onboarding-change";
import {
  filterOnboardingEntries,
  onboardingEntryDone,
  type OnboardingEntryFilter,
} from "@/lib/onboarding-filter";
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
  // Aus einer Mitteilung geöffnet: diesen Eintritt aufklappen.
  const params = useLocalSearchParams<{ entry?: string }>();
  const focusEntryId = typeof params.entry === "string" ? params.entry : null;
  const [entries, setEntries] = useState<OnboardingEntry[] | null>(null);
  const [agents, setAgents] = useState<OnboardingAgent[]>([]);
  const [assignTarget, setAssignTarget] = useState<OnboardingEntry | null>(
    null,
  );
  const [notice, setNotice] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [busyTask, setBusyTask] = useState<string | null>(null);
  const [filter, setFilter] = useState<OnboardingEntryFilter>("open");
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    try {
      setError("");
      const workspace = await loadOnboardingWorkspace();
      const result = workspace.entries;
      setEntries(result);
      setAgents(workspace.agents);
      setExpanded(
        (current) =>
          current ??
          (focusEntryId && result.some((entry) => entry.id === focusEntryId)
            ? focusEntryId
            : null) ??
          result.find((entry) => !onboardingEntryDone(entry))?.id ??
          null,
      );
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Die Eintritte konnten nicht geladen werden.",
      );
    } finally {
      setRefreshing(false);
    }
  }, [focusEntryId]);

  async function assign(entry: OnboardingEntry, agent: OnboardingAgent | null) {
    setAssignTarget(null);
    if ((agent?.id ?? null) === entry.ictResponsibleUserId) return;
    setError("");
    setNotice("");
    try {
      const result = await assignOnboardingEntry(entry.id, agent?.id ?? null);
      if (!agent) {
        setNotice("Nicht mehr zugewiesen.");
        await load();
        return;
      }
      setNotice(
        result.redirected && result.assignedName
          ? `${result.requestedName ?? agent.displayName} ist abwesend. Der Eintritt ging an die Stellvertretung ${result.assignedName}.`
          : `Zugewiesen an ${result.assignedName ?? agent.displayName}.`,
      );
      await load();
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Der Eintritt konnte nicht zugewiesen werden.",
      );
    }
  }

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
        {notice ? <Text style={styles.notice}>{notice}</Text> : null}
        {entries === null && !error ? (
          <ActivityIndicator color={colors.primary} style={styles.loader} />
        ) : null}
        {entries ? (
          <View style={styles.filters}>
            <View accessibilityRole="tablist" style={styles.filterRow}>
              {(
                [
                  ["open", "Offen"],
                  ["done", "Erledigt"],
                  ["all", "Alle"],
                ] as const
              ).map(([key, label]) => {
                const active = filter === key;
                const count =
                  key === "all"
                    ? entries.length
                    : entries.filter(
                        (entry) =>
                          onboardingEntryDone(entry) === (key === "done"),
                      ).length;
                return (
                  <Pressable
                    accessibilityRole="tab"
                    accessibilityState={{ selected: active }}
                    key={key}
                    onPress={() => setFilter(key)}
                    style={[
                      styles.filterChip,
                      active && styles.filterChipActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.filterText,
                        active && styles.filterTextActive,
                      ]}
                    >
                      {label} ({count})
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <TextInput
              accessibilityLabel="Eintritte durchsuchen"
              autoCapitalize="none"
              autoCorrect={false}
              clearButtonMode="while-editing"
              onChangeText={setQuery}
              placeholder="Name, Abteilung, Ort, Ticketnummer …"
              placeholderTextColor={colors.subtle}
              returnKeyType="search"
              style={styles.search}
              value={query}
            />
          </View>
        ) : null}

        {entries?.length === 0 ? (
          <Text style={styles.muted}>Keine Eintritte vorhanden.</Text>
        ) : entries &&
          filterOnboardingEntries(entries, filter, query).length === 0 ? (
          <Text style={styles.muted}>
            {query.trim()
              ? "Kein Eintritt passt zur Suche."
              : filter === "open"
                ? "Keine offenen Eintritte. Erledigte stehen unter «Erledigt»."
                : "Keine erledigten Eintritte."}
          </Text>
        ) : null}

        {(entries ? filterOnboardingEntries(entries, filter, query) : []).map(
          (entry) => {
            const progress = onboardingProgress(entry.tasks);
            const open = expanded === entry.id;
            const rows =
              entry.source === "email"
                ? onboardingDetailRows(entry.details)
                : [];
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
                    {entry.delegatedFor ? (
                      <Text style={styles.delegated}>
                        Stellvertretung für {entry.delegatedFor}
                      </Text>
                    ) : null}
                    <Text style={styles.muted}>
                      {entry.kind === "change"
                        ? "Mutation, gültig ab"
                        : entry.kind === "offboarding"
                          ? "Austritt am"
                          : "Eintritt am"}{" "}
                      {dateLabel(entry.startsOn)}
                      {entry.organisationUnit
                        ? ` · ${entry.organisationUnit}`
                        : ""}
                    </Text>
                    {entry.kind === "change"
                      ? changeSummary(
                          entry.changeTypes,
                          entry.details,
                          entry.employeeName,
                        ).map((row) => (
                          <Text key={row.type} style={styles.changeLine}>
                            {row.label}
                            {row.text ? `: ${row.text}` : ""}
                          </Text>
                        ))
                      : null}
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
                      {entry.ictResponsibleUserId
                        ? entry.ictResponsibleName || "–"
                        : "Nicht zugewiesen"}
                    </Text>
                    {entry.canAssign && agents.length > 0 ? (
                      <Pressable
                        accessibilityHint="Wählt eine andere ICT-Verantwortung."
                        accessibilityRole="button"
                        onPress={() => setAssignTarget(entry)}
                        style={styles.assignButton}
                      >
                        <Ionicons
                          color={colors.primaryText}
                          name="person-add-outline"
                          size={16}
                        />
                        <Text style={styles.assignButtonText}>
                          Zuweisen an …
                        </Text>
                      </Pressable>
                    ) : null}
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
                            {item.status !== "open" &&
                            item.status !== "completed"
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
                    {entry.hasDocument ? (
                      <Pressable
                        accessibilityRole="button"
                        onPress={() =>
                          void onboardingDocumentUrl(entry.id)
                            .then((url) => WebBrowser.openBrowserAsync(url))
                            .catch((nextError: unknown) =>
                              setError(
                                nextError instanceof Error
                                  ? nextError.message
                                  : "Die Eintrittsmeldung konnte nicht geöffnet werden.",
                              ),
                            )
                        }
                        style={styles.document}
                      >
                        <Ionicons
                          color={colors.primaryText}
                          name="document-text-outline"
                          size={18}
                        />
                        <Text style={styles.documentText}>
                          Eintrittsmeldung (PDF) öffnen
                        </Text>
                      </Pressable>
                    ) : null}
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
          },
        )}
      </ScrollView>
      <Modal
        animationType="slide"
        onRequestClose={() => setAssignTarget(null)}
        transparent
        visible={assignTarget !== null}
      >
        <Pressable
          accessibilityLabel="Auswahl schliessen"
          onPress={() => setAssignTarget(null)}
          style={styles.sheetBackdrop}
        >
          <Pressable style={styles.sheet}>
            <Text style={styles.sheetTitle}>ICT-Verantwortung wählen</Text>
            <ScrollView style={styles.sheetList}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{
                  selected: !assignTarget?.ictResponsibleUserId,
                }}
                onPress={() =>
                  assignTarget ? void assign(assignTarget, null) : null
                }
                style={styles.sheetRow}
              >
                <Text style={styles.sheetRowText}>Nicht zugewiesen</Text>
                {!assignTarget?.ictResponsibleUserId ? (
                  <Ionicons color={colors.primary} name="checkmark" size={18} />
                ) : null}
              </Pressable>
              {agents
                .filter(
                  (agent) =>
                    !assignTarget?.assignableAgentIds ||
                    assignTarget.assignableAgentIds.includes(agent.id),
                )
                .map((agent) => {
                  const current =
                    agent.id === assignTarget?.ictResponsibleUserId;
                  return (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ selected: current }}
                      key={agent.id}
                      onPress={() =>
                        assignTarget ? void assign(assignTarget, agent) : null
                      }
                      style={styles.sheetRow}
                    >
                      <Text style={styles.sheetRowText}>
                        {agent.displayName}
                      </Text>
                      {current ? (
                        <Ionicons
                          color={colors.primary}
                          name="checkmark"
                          size={18}
                        />
                      ) : null}
                    </Pressable>
                  );
                })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </ScreenContainer>
  );
}

const useStyles = makeThemedStyles((c) => ({
  assignButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: c.primarySoft,
    borderRadius: 999,
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  assignButtonText: { color: c.primaryText, fontSize: 13, fontWeight: "800" },
  delegated: { color: c.warning, fontSize: 12, fontWeight: "800" },
  changeLine: { color: c.info, fontSize: 12, fontWeight: "700" },
  notice: { color: c.success, fontSize: 13, fontWeight: "700" },
  sheet: {
    backgroundColor: c.surface,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    gap: 10,
    maxHeight: "70%",
    padding: 20,
    paddingBottom: 36,
  },
  sheetBackdrop: {
    backgroundColor: "rgba(0,0,0,0.35)",
    flex: 1,
    justifyContent: "flex-end",
  },
  sheetList: { flexGrow: 0 },
  sheetRow: {
    alignItems: "center",
    borderBottomColor: c.border,
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 14,
  },
  sheetRowText: { color: c.foreground, fontSize: 15, fontWeight: "600" },
  sheetTitle: { color: c.foreground, fontSize: 17, fontWeight: "900" },
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
  filters: { gap: 10 },
  filterRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  filterChip: {
    borderColor: c.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  filterChipActive: { backgroundColor: c.primarySoft, borderColor: c.primary },
  filterText: { color: c.muted, fontSize: 13, fontWeight: "700" },
  filterTextActive: { color: c.primaryText },
  search: {
    backgroundColor: c.surface,
    borderColor: c.border,
    borderRadius: 12,
    borderWidth: 1,
    color: c.foreground,
    fontSize: 15,
    minHeight: 44,
    paddingHorizontal: 12,
  },
  document: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    minHeight: 44,
  },
  documentText: { color: c.primaryText, fontSize: 14, fontWeight: "800" },
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
