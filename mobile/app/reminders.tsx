import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";

import {
  MobileFeatureLoadingScreen,
  MobileFeatureUnavailableScreen,
  useMobileFeatures,
} from "@/components/mobile-feature-gate";
import { useMobileNetworkStatus } from "@/components/offline-status";
import { ScreenContainer } from "@/components/screen-container";
import { tn } from "@/lib/formality";
import {
  hapticError,
  hapticSelection,
  hapticSuccess,
} from "@/lib/mobile-haptics";
import {
  isExperienceUnavailableError,
  listFollowUps,
  resolveFollowUp,
} from "@/lib/nextdesk-experience";
import {
  formatReminderDue,
  formatReminderResolved,
  groupOpenReminders,
  isReminderOverdue,
  openReminderCount,
  recentResolvedReminders,
  type Reminder,
  reminderPriorityLabel,
  removeReminder,
  upsertReminder,
  withReminderResolvedAt,
} from "@/lib/reminders-model";
import { makeThemedStyles, useAppColors } from "@/lib/themed-styles";
import { useMobileSessionGuard } from "@/lib/use-mobile-session-guard";

/** Höchstzahl, die experience-hub pro Abruf liefert. */
const LIST_LIMIT = 100;

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * Erinnerungen: alle offenen Erinnerungen der angemeldeten Person (wie der
 * Arbeitsplatz im Web), gruppiert nach Fälligkeit, mit Abschluss per Tipp und
 * einem eingeklappten Bereich für die zuletzt erledigten.
 */
export default function RemindersScreen() {
  const router = useRouter();
  const styles = useStyles();
  const colors = useAppColors();
  const checkingSession = useMobileSessionGuard();
  const {
    isEnabled,
    loading: checkingFeatures,
    tenantId,
  } = useMobileFeatures();
  const { isOffline, recoveryEpoch } = useMobileNetworkStatus();
  const featureEnabled = isEnabled("experience.workspace");

  const [open, setOpen] = useState<Reminder[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState("");
  const [unavailable, setUnavailable] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showResolved, setShowResolved] = useState(false);
  const [resolved, setResolved] = useState<Reminder[] | null>(null);
  const [resolvedLoading, setResolvedLoading] = useState(false);
  const [resolvedError, setResolvedError] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [resolvingIds, setResolvingIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const resolvingRef = useRef(new Set<string>());
  // Für Fokus- und Wiederverbindungs-Abrufe, ohne sie beim Umschalten auszulösen.
  const showResolvedRef = useRef(false);

  const loadOpen = useCallback(async () => {
    if (!tenantId || !featureEnabled) return;
    try {
      const result = await listFollowUps({
        includeResolved: false,
        limit: LIST_LIMIT,
      });
      // Erinnerungen, die gerade erledigt werden, bleiben ausgeblendet.
      setOpen(
        result.followUps.filter(
          (reminder) => !resolvingRef.current.has(reminder.id),
        ),
      );
      setTruncated(result.truncated);
      setError("");
    } catch (nextError) {
      if (isExperienceUnavailableError(nextError)) {
        setUnavailable(true);
        return;
      }
      setError(
        errorText(
          nextError,
          tn(
            "Die Erinnerungen konnten nicht geladen werden. Bitte versuche es erneut.",
            "Die Erinnerungen konnten nicht geladen werden. Bitte versuchen Sie es erneut.",
          ),
        ),
      );
    }
  }, [featureEnabled, tenantId]);

  const loadResolved = useCallback(async () => {
    if (!tenantId || !featureEnabled) return;
    setResolvedLoading(true);
    try {
      const result = await listFollowUps({
        includeResolved: true,
        limit: LIST_LIMIT,
      });
      setResolved(recentResolvedReminders(result.followUps));
      setResolvedError("");
    } catch (nextError) {
      if (isExperienceUnavailableError(nextError)) {
        setUnavailable(true);
        return;
      }
      setResolvedError(
        errorText(
          nextError,
          "Die erledigten Erinnerungen konnten nicht geladen werden.",
        ),
      );
    } finally {
      setResolvedLoading(false);
    }
  }, [featureEnabled, tenantId]);

  useFocusEffect(
    useCallback(() => {
      if (checkingSession || checkingFeatures) return;
      void loadOpen();
      if (showResolvedRef.current) void loadResolved();
    }, [checkingFeatures, checkingSession, loadOpen, loadResolved]),
  );

  // Nach einer Wiederverbindung neu laden.
  useEffect(() => {
    if (recoveryEpoch === 0) return;
    void loadOpen();
    if (showResolvedRef.current) void loadResolved();
  }, [loadOpen, loadResolved, recoveryEpoch]);

  async function refresh() {
    setRefreshing(true);
    await Promise.all([loadOpen(), showResolved ? loadResolved() : null]);
    setRefreshing(false);
  }

  function toggleResolved() {
    hapticSelection();
    const next = !showResolved;
    showResolvedRef.current = next;
    setShowResolved(next);
    if (next && resolved === null && !resolvedLoading) void loadResolved();
  }

  function openReminder(reminder: Reminder) {
    hapticSelection();
    if (reminder.ticketId) {
      router.push({
        pathname: "/ticket/[id]",
        params: { id: reminder.ticketId },
      });
      return;
    }
    if (reminder.description) {
      setExpandedId((current) => (current === reminder.id ? null : reminder.id));
    }
  }

  function setResolving(id: string, busy: boolean) {
    if (busy) resolvingRef.current.add(id);
    else resolvingRef.current.delete(id);
    setResolvingIds(new Set(resolvingRef.current));
  }

  async function resolve(reminder: Reminder) {
    if (resolvingRef.current.has(reminder.id) || isOffline) return;
    hapticSuccess();
    setResolving(reminder.id, true);
    const resolvedAt = new Date().toISOString();
    // Optimistisch: sofort aus den offenen in die erledigten verschieben.
    setOpen((current) =>
      current
        ? withReminderResolvedAt(current, reminder.id, resolvedAt)
        : current,
    );
    setResolved((current) =>
      current ? upsertReminder(current, { ...reminder, resolvedAt }) : current,
    );
    setError("");
    try {
      const result = await resolveFollowUp(reminder.id);
      setOpen((current) =>
        current ? removeReminder(current, reminder.id) : current,
      );
      setResolved((current) =>
        current
          ? recentResolvedReminders(upsertReminder(current, result.followUp))
          : current,
      );
    } catch (nextError) {
      hapticError();
      // Zurückrollen: wieder offen, aus «Erledigt» entfernen.
      setOpen((current) =>
        current ? withReminderResolvedAt(current, reminder.id, null) : current,
      );
      setResolved((current) =>
        current ? removeReminder(current, reminder.id) : current,
      );
      if (isExperienceUnavailableError(nextError)) {
        setUnavailable(true);
      } else {
        setError(
          errorText(
            nextError,
            `«${reminder.title}» konnte nicht als erledigt markiert werden.`,
          ),
        );
      }
    } finally {
      setResolving(reminder.id, false);
    }
  }

  if (checkingSession || checkingFeatures) {
    return <MobileFeatureLoadingScreen />;
  }

  if (!featureEnabled || unavailable) {
    return (
      <MobileFeatureUnavailableScreen
        feature="experience.workspace"
        title="Erinnerungen"
      />
    );
  }

  const now = new Date();
  const groups = open ? groupOpenReminders(open, now) : [];
  const openCount = open ? openReminderCount(open) : 0;
  const overdueCount =
    groups.find((group) => group.key === "overdue")?.entries.length ?? 0;
  const summary = !open
    ? null
    : openCount === 0
      ? "Keine offenen"
      : overdueCount > 0
        ? `${openCount} offen, ${overdueCount} überfällig`
        : `${openCount} offen`;

  function renderRow(reminder: Reminder) {
    const isResolved = Boolean(reminder.resolvedAt);
    const overdue = isReminderOverdue(reminder, now);
    const expanded = expandedId === reminder.id;
    const busy = resolvingIds.has(reminder.id);
    const dueText = isResolved
      ? formatReminderResolved(reminder.resolvedAt, now)
      : formatReminderDue(reminder.dueAt, now);
    const priority = reminderPriorityLabel(reminder.priority);
    const canOpen = Boolean(reminder.ticketId || reminder.description);
    return (
      <View
        key={reminder.id}
        style={[
          styles.row,
          overdue && styles.rowOverdue,
          isResolved && styles.rowResolved,
        ]}
      >
        <Pressable
          accessibilityHint={
            reminder.ticketId
              ? "Öffnet das verknüpfte Ticket"
              : reminder.description
                ? expanded
                  ? "Blendet die Notiz aus"
                  : "Zeigt die ganze Notiz"
                : undefined
          }
          accessibilityLabel={[
            reminder.title,
            overdue ? `überfällig, ${dueText}` : dueText,
            `Priorität ${priority}`,
            reminder.ticketId ? "mit Ticket verknüpft" : null,
          ]
            .filter(Boolean)
            .join(", ")}
          accessibilityRole={canOpen ? "button" : "text"}
          disabled={!canOpen}
          onPress={() => openReminder(reminder)}
          style={({ pressed }) => [
            styles.rowMain,
            pressed && canOpen && styles.pressed,
          ]}
        >
          <Text
            numberOfLines={expanded ? undefined : 2}
            style={[styles.rowTitle, isResolved && styles.rowTitleResolved]}
          >
            {reminder.title}
          </Text>
          <View style={styles.meta}>
            <View style={styles.metaItem}>
              <Ionicons
                color={overdue ? colors.error : colors.muted}
                name={isResolved ? "checkmark-done-outline" : "time-outline"}
                size={14}
              />
              <Text style={[styles.metaText, overdue && styles.metaOverdue]}>
                {dueText}
              </Text>
            </View>
            <View
              style={[
                styles.badge,
                reminder.priority === "high" && styles.badgeHigh,
                reminder.priority === "low" && styles.badgeLow,
              ]}
            >
              <Ionicons
                color={
                  reminder.priority === "high"
                    ? colors.warningStrong
                    : reminder.priority === "low"
                      ? colors.muted
                      : colors.primaryText
                }
                name="flag-outline"
                size={12}
              />
              <Text
                style={[
                  styles.badgeText,
                  reminder.priority === "high" && styles.badgeTextHigh,
                  reminder.priority === "low" && styles.badgeTextLow,
                ]}
              >
                {priority}
              </Text>
            </View>
          </View>
          {reminder.description ? (
            <Text
              numberOfLines={expanded ? undefined : 2}
              style={styles.description}
            >
              {reminder.description}
            </Text>
          ) : null}
          {reminder.ticketId ? (
            <View style={styles.ticketLink}>
              <Ionicons
                color={colors.primaryText}
                name="ticket-outline"
                size={14}
              />
              <Text style={styles.ticketLinkText}>Verknüpftes Ticket</Text>
              <Ionicons
                color={colors.primaryText}
                name="chevron-forward"
                size={14}
              />
            </View>
          ) : null}
        </Pressable>
        {isResolved ? null : (
          <Pressable
            accessibilityLabel={`Erinnerung «${reminder.title}» als erledigt markieren`}
            accessibilityRole="button"
            accessibilityState={{ busy, disabled: busy || isOffline }}
            disabled={busy || isOffline}
            hitSlop={6}
            onPress={() => void resolve(reminder)}
            style={({ pressed }) => [
              styles.doneButton,
              (busy || isOffline) && styles.doneButtonDisabled,
              pressed && styles.pressed,
            ]}
          >
            {busy ? (
              <ActivityIndicator color={colors.success} size="small" />
            ) : (
              <Ionicons
                color={colors.success}
                name="checkmark-circle-outline"
                size={22}
              />
            )}
            <Text style={styles.doneButtonText}>Erledigt</Text>
          </Pressable>
        )}
      </View>
    );
  }

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
            <Ionicons color={colors.primaryText} name="chevron-back" size={20} />
            <Text style={styles.backText}>Zurück</Text>
          </Pressable>
        </View>

        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text accessibilityRole="header" style={styles.title}>
              Erinnerungen
            </Text>
            {summary ? <Text style={styles.summary}>{summary}</Text> : null}
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              hapticSelection();
              router.push("/create/follow-up");
            }}
            style={({ pressed }) => [
              styles.primaryButton,
              pressed && styles.pressed,
            ]}
          >
            <Ionicons color={colors.onPrimary} name="add" size={18} />
            <Text style={styles.primaryButtonText}>Erinnerung erfassen</Text>
          </Pressable>
        </View>

        {isOffline ? (
          <View accessibilityLiveRegion="polite" style={styles.offline}>
            <Ionicons
              color={colors.warningStrong}
              name="cloud-offline-outline"
              size={18}
            />
            <Text style={styles.offlineText}>
              Keine Verbindung. Erinnerungen lassen sich erst nach der
              Wiederverbindung aktualisieren oder erledigen.
            </Text>
          </View>
        ) : null}

        {error ? (
          <View style={styles.errorBox}>
            <Text accessibilityRole="alert" style={styles.errorText}>
              {error}
            </Text>
            {open === null ? (
              <Pressable
                accessibilityRole="button"
                disabled={isOffline}
                onPress={() => {
                  setError("");
                  void loadOpen();
                }}
                style={styles.retry}
              >
                <Text style={styles.retryText}>Erneut versuchen</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {open === null ? (
          error ? null : isOffline ? (
            <View style={styles.empty}>
              <Ionicons
                color={colors.muted}
                name="cloud-offline-outline"
                size={30}
              />
              <Text style={styles.emptyTitle}>Offline</Text>
              <Text style={styles.hint}>
                Erinnerungen werden geladen, sobald wieder eine Verbindung
                besteht.
              </Text>
            </View>
          ) : (
            <ActivityIndicator color={colors.primary} style={styles.loader} />
          )
        ) : groups.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons color={colors.muted} name="alarm-outline" size={30} />
            <Text style={styles.emptyTitle}>Keine offenen Erinnerungen</Text>
            <Text style={styles.hint}>
              {tn(
                "Erfasse eine Erinnerung, damit du nichts vergisst. Die Erinnerung erscheint auch im Arbeitsplatz der Web-App.",
                "Erfassen Sie eine Erinnerung, damit Sie nichts vergessen. Die Erinnerung erscheint auch im Arbeitsplatz der Web-App.",
              )}
            </Text>
          </View>
        ) : (
          groups.map((group) => (
            <View key={group.key} style={styles.section}>
              <View style={styles.sectionHeading}>
                <Text
                  accessibilityRole="header"
                  style={[
                    styles.sectionTitle,
                    group.key === "overdue" && styles.sectionTitleOverdue,
                  ]}
                >
                  {group.label}
                </Text>
                <Text style={styles.sectionCount}>{group.entries.length}</Text>
              </View>
              <View style={styles.list}>{group.entries.map(renderRow)}</View>
            </View>
          ))
        )}

        {truncated ? (
          <Text style={styles.hint}>
            Es werden die {LIST_LIMIT} nächsten offenen Erinnerungen angezeigt.
          </Text>
        ) : null}

        {open !== null ? (
          <View style={styles.section}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: showResolved }}
              onPress={toggleResolved}
              style={({ pressed }) => [
                styles.resolvedToggle,
                pressed && styles.pressed,
              ]}
            >
              <Ionicons
                color={colors.muted}
                name={showResolved ? "chevron-down" : "chevron-forward"}
                size={16}
              />
              <Text style={styles.sectionTitle}>Erledigt</Text>
              {resolved && resolved.length > 0 ? (
                <Text style={styles.sectionCount}>{resolved.length}</Text>
              ) : null}
            </Pressable>
            {showResolved ? (
              resolvedLoading && resolved === null ? (
                <ActivityIndicator color={colors.primary} />
              ) : resolvedError ? (
                <Text accessibilityRole="alert" style={styles.errorText}>
                  {resolvedError}
                </Text>
              ) : resolved && resolved.length > 0 ? (
                <View style={styles.list}>{resolved.map(renderRow)}</View>
              ) : (
                <Text style={styles.hint}>
                  Noch keine erledigten Erinnerungen.
                </Text>
              )
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </ScreenContainer>
  );
}

const useStyles = makeThemedStyles((c) => ({
  back: { alignItems: "center", flexDirection: "row", gap: 4 },
  backText: { color: c.primaryText, fontSize: 15, fontWeight: "700" },
  badge: {
    alignItems: "center",
    backgroundColor: c.primarySoft,
    borderColor: c.primarySoftBorder,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  badgeHigh: { backgroundColor: c.warningSoft, borderColor: c.warningBorder },
  badgeLow: { backgroundColor: c.surfaceSubtle, borderColor: c.border },
  badgeText: { color: c.primaryText, fontSize: 12, fontWeight: "700" },
  badgeTextHigh: { color: c.warningStrong },
  badgeTextLow: { color: c.muted },
  content: { gap: 16, paddingBottom: 40, paddingTop: 12 },
  description: { color: c.text, fontSize: 13, lineHeight: 18 },
  doneButton: {
    alignItems: "center",
    alignSelf: "center",
    borderColor: c.successBorder,
    borderRadius: 12,
    borderWidth: 1,
    backgroundColor: c.successSoft,
    gap: 2,
    minHeight: 54,
    justifyContent: "center",
    minWidth: 68,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  doneButtonDisabled: { opacity: 0.5 },
  doneButtonText: { color: c.success, fontSize: 11, fontWeight: "800" },
  empty: { alignItems: "center", gap: 8, paddingVertical: 32 },
  emptyTitle: { color: c.foreground, fontSize: 16, fontWeight: "800" },
  errorBox: {
    backgroundColor: c.errorSoft,
    borderColor: c.errorBorder,
    borderRadius: 12,
    borderWidth: 1,
    gap: 8,
    padding: 12,
  },
  errorText: { color: c.error, fontSize: 13, lineHeight: 18 },
  header: {
    alignItems: "flex-start",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    justifyContent: "space-between",
  },
  headerText: { flexGrow: 1, flexShrink: 1, gap: 2, minWidth: 140 },
  hint: { color: c.muted, fontSize: 13, lineHeight: 19, textAlign: "center" },
  list: { gap: 8 },
  loader: { paddingVertical: 24 },
  meta: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  metaItem: { alignItems: "center", flexDirection: "row", gap: 4 },
  metaOverdue: { color: c.error, fontWeight: "700" },
  metaText: { color: c.muted, fontSize: 13 },
  offline: {
    alignItems: "center",
    backgroundColor: c.warningSoft,
    borderColor: c.warningBorder,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    padding: 12,
  },
  offlineText: { color: c.warningStrong, flex: 1, fontSize: 13, lineHeight: 18 },
  pressed: { opacity: 0.7 },
  primaryButton: {
    alignItems: "center",
    backgroundColor: c.primary,
    borderRadius: 999,
    flexDirection: "row",
    gap: 6,
    minHeight: 40,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  primaryButtonText: { color: c.onPrimary, fontSize: 14, fontWeight: "800" },
  resolvedToggle: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    minHeight: 36,
  },
  retry: {
    alignSelf: "flex-start",
    borderColor: c.errorBorder,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  retryText: { color: c.error, fontSize: 13, fontWeight: "700" },
  row: {
    alignItems: "stretch",
    backgroundColor: c.surface,
    borderColor: c.border,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    padding: 12,
  },
  rowMain: { flex: 1, gap: 6, minWidth: 0 },
  rowOverdue: { borderColor: c.errorBorder },
  rowResolved: { backgroundColor: c.surfaceSubtle },
  rowTitle: { color: c.foreground, fontSize: 15, fontWeight: "700" },
  rowTitleResolved: {
    color: c.muted,
    textDecorationLine: "line-through",
  },
  section: { gap: 8 },
  sectionCount: { color: c.muted, fontSize: 13, fontWeight: "700" },
  sectionHeading: { alignItems: "center", flexDirection: "row", gap: 8 },
  sectionTitle: { color: c.foreground, fontSize: 17, fontWeight: "800" },
  sectionTitleOverdue: { color: c.error },
  summary: { color: c.muted, fontSize: 14 },
  ticketLink: { alignItems: "center", flexDirection: "row", gap: 4 },
  ticketLinkText: { color: c.primaryText, fontSize: 13, fontWeight: "700" },
  title: { color: c.foreground, fontSize: 28, fontWeight: "900" },
  topRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
}));
