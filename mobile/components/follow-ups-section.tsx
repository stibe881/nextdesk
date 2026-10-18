import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { useMobileFeatures } from "@/components/mobile-feature-gate";
import {
  isExperienceUnavailableError,
  listFollowUps,
  resolveFollowUp,
  saveFollowUp,
  type ExperienceFollowUp,
} from "@/lib/nextdesk-experience";
import {
  hapticError,
  hapticSelection,
  hapticSuccess,
} from "@/lib/mobile-haptics";
import { useThemeContext } from "@/lib/theme-provider";
import {
  makeThemedStyles,
  type AppPalette,
  useAppColors,
} from "@/lib/themed-styles";

type DueChoice = "today" | "tomorrow" | "week" | "none";

const dueChoices: { value: DueChoice; label: string }[] = [
  { value: "today", label: "Heute" },
  { value: "tomorrow", label: "Morgen" },
  { value: "week", label: "In 1 Woche" },
  { value: "none", label: "Ohne Datum" },
];

function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function dueForChoice(choice: DueChoice): string | null {
  if (choice === "none") return null;
  const due = startOfToday();
  due.setHours(12, 0, 0, 0);
  if (choice === "tomorrow") due.setDate(due.getDate() + 1);
  if (choice === "week") due.setDate(due.getDate() + 7);
  return due.toISOString();
}

function dayBuckets(followUps: ExperienceFollowUp[]) {
  const todayStart = startOfToday();
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);
  const overdue: ExperienceFollowUp[] = [];
  const today: ExperienceFollowUp[] = [];

  for (const followUp of followUps) {
    if (!followUp.dueAt) continue;
    const due = new Date(followUp.dueAt);
    if (!Number.isFinite(due.getTime())) continue;
    if (due < todayStart) overdue.push(followUp);
    else if (due < tomorrowStart) today.push(followUp);
  }

  const byDueAt = (left: ExperienceFollowUp, right: ExperienceFollowUp) =>
    (left.dueAt ?? "").localeCompare(right.dueAt ?? "");
  overdue.sort(byDueAt);
  today.sort(byDueAt);
  return { overdue, today };
}

function dueLabel(dueAt: string | null): string {
  if (!dueAt) return "Ohne Termin";
  const due = new Date(dueAt);
  if (!Number.isFinite(due.getTime())) return "Termin nicht verfügbar";
  return new Intl.DateTimeFormat("de-CH", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(due);
}

function priorityLabel(priority: ExperienceFollowUp["priority"]): string {
  switch (priority) {
    case "high":
      return "Hohe Priorität";
    case "low":
      return "Niedrige Priorität";
    default:
      return "Normale Priorität";
  }
}

export function FollowUpsSection() {
  const { isEnabled, loading: checkingFeatures } = useMobileFeatures();
  const { density, reducedMotion } = useThemeContext();
  const colors = useAppColors();
  const styles = useStyles();
  const workspaceEnabled = isEnabled("experience.workspace");
  const [followUps, setFollowUps] = useState<ExperienceFollowUp[]>([]);
  const [loading, setLoading] = useState(false);
  const [available, setAvailable] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [dueChoice, setDueChoice] = useState<DueChoice>("today");
  const [saving, setSaving] = useState(false);
  const [sheetError, setSheetError] = useState("");

  const load = useCallback(async () => {
    if (!workspaceEnabled || !available) return;
    setLoading(true);
    setError("");
    try {
      const result = await listFollowUps({ limit: 50 });
      setFollowUps(result.followUps);
    } catch (nextError) {
      if (isExperienceUnavailableError(nextError)) {
        setAvailable(false);
        return;
      }
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Die Wiedervorlagen konnten nicht geladen werden.",
      );
    } finally {
      setLoading(false);
    }
  }, [available, workspaceEnabled]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const buckets = useMemo(() => dayBuckets(followUps), [followUps]);
  const relevant = [...buckets.overdue, ...buckets.today];
  const padding = density === "compact" ? 14 : 17;

  function openSheet() {
    setTitle("");
    setDueChoice("today");
    setSheetError("");
    setSheetOpen(true);
    hapticSelection();
  }

  async function createFollowUp() {
    const nextTitle = title.trim();
    if (!nextTitle) {
      setSheetError("Bitte geben Sie eine kurze Wiedervorlage ein.");
      return;
    }
    if (Array.from(nextTitle).length > 240) {
      setSheetError("Die Wiedervorlage darf höchstens 240 Zeichen lang sein.");
      return;
    }

    setSaving(true);
    setSheetError("");
    try {
      const result = await saveFollowUp({
        title: nextTitle,
        description: null,
        dueAt: dueForChoice(dueChoice),
        priority: "normal",
        ticketId: null,
      });
      setFollowUps((current) => [...current, result.followUp]);
      setSheetOpen(false);
      setMessage("Wiedervorlage gespeichert.");
      hapticSuccess();
    } catch (nextError) {
      if (isExperienceUnavailableError(nextError)) {
        setSheetOpen(false);
        setAvailable(false);
        return;
      }
      hapticError();
      setSheetError(
        nextError instanceof Error
          ? nextError.message
          : "Die Wiedervorlage konnte nicht gespeichert werden.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function completeFollowUp(followUp: ExperienceFollowUp) {
    setResolvingId(followUp.id);
    setError("");
    setMessage("");
    try {
      const result = await resolveFollowUp(followUp.id);
      setFollowUps((current) =>
        result.changed
          ? current.filter((entry) => entry.id !== result.followUp.id)
          : current,
      );
      setMessage(
        result.changed
          ? "Wiedervorlage als erledigt markiert."
          : "Diese Wiedervorlage war bereits erledigt.",
      );
      hapticSuccess();
    } catch (nextError) {
      if (isExperienceUnavailableError(nextError)) {
        setAvailable(false);
        return;
      }
      hapticError();
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Die Wiedervorlage konnte nicht aktualisiert werden.",
      );
    } finally {
      setResolvingId(null);
    }
  }

  if (checkingFeatures || !workspaceEnabled || !available) return null;

  return (
    <>
      <View
        accessibilityLabel="Mein Tag: Wiedervorlagen"
        style={[styles.card, { padding }]}
      >
        <View style={styles.header}>
          <View style={styles.headerCopy}>
            <View style={styles.headingRow}>
              <View style={styles.icon}>
                <Ionicons
                  color={colors.primaryText}
                  name="today-outline"
                  size={19}
                />
              </View>
              <View>
                <Text style={styles.eyebrow}>MEIN TAG</Text>
                <Text style={styles.title}>Wiedervorlagen</Text>
              </View>
            </View>
            <Text style={styles.subtitle}>
              {relevant.length === 0
                ? "Für heute ist nichts offen."
                : `${buckets.overdue.length} überfällig · ${buckets.today.length} heute`}
            </Text>
          </View>
          <Pressable
            accessibilityLabel="Neue Wiedervorlage erstellen"
            accessibilityRole="button"
            hitSlop={8}
            onPress={openSheet}
            style={styles.addButton}
          >
            <Ionicons color={colors.primaryText} name="add" size={23} />
          </Pressable>
        </View>

        {loading ? (
          <View accessibilityRole="progressbar" style={styles.skeletonList}>
            {[1, 2].map((item) => (
              <View key={item} style={styles.skeletonRow}>
                <View style={styles.skeletonMark} />
                <View style={styles.skeletonCopy}>
                  <View style={styles.skeletonLine} />
                  <View style={styles.skeletonShort} />
                </View>
              </View>
            ))}
          </View>
        ) : relevant.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons
              color={colors.muted}
              name="checkmark-circle-outline"
              size={20}
            />
            <Text style={styles.emptyText}>
              Keine überfälligen oder heutigen Wiedervorlagen.
            </Text>
          </View>
        ) : (
          <View style={styles.list}>
            {buckets.overdue.map((followUp) => (
              <FollowUpRow
                colors={colors}
                followUp={followUp}
                key={followUp.id}
                onComplete={() => void completeFollowUp(followUp)}
                resolving={resolvingId === followUp.id}
                timingLabel="Überfällig"
              />
            ))}
            {buckets.today.map((followUp) => (
              <FollowUpRow
                colors={colors}
                followUp={followUp}
                key={followUp.id}
                onComplete={() => void completeFollowUp(followUp)}
                resolving={resolvingId === followUp.id}
                timingLabel={`Heute · ${dueLabel(followUp.dueAt)}`}
              />
            ))}
          </View>
        )}

        <Pressable
          accessibilityLabel="Wiedervorlage schnell erstellen"
          accessibilityRole="button"
          onPress={openSheet}
          style={styles.quickAction}
        >
          <Ionicons
            color={colors.primaryText}
            name="add-circle-outline"
            size={20}
          />
          <Text style={styles.quickActionText}>Wiedervorlage erstellen</Text>
          <Ionicons color={colors.muted} name="chevron-forward" size={18} />
        </Pressable>

        {error ? (
          <View style={[styles.feedback, styles.feedbackError]}>
            <Ionicons
              color={colors.error}
              name="alert-circle-outline"
              size={19}
            />
            <Text style={[styles.feedbackText, styles.feedbackTextError]}>
              {error}
            </Text>
          </View>
        ) : null}
        {message ? (
          <View style={[styles.feedback, styles.feedbackSuccess]}>
            <Ionicons
              color={colors.success}
              name="checkmark-circle-outline"
              size={19}
            />
            <Text style={[styles.feedbackText, styles.feedbackTextSuccess]}>
              {message}
            </Text>
          </View>
        ) : null}
      </View>

      <Modal
        animationType={reducedMotion ? "none" : "slide"}
        onRequestClose={() => setSheetOpen(false)}
        transparent
        visible={sheetOpen}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.modalRoot}
        >
          <Pressable
            accessibilityLabel="Wiedervorlage schliessen"
            accessibilityRole="button"
            disabled={saving}
            onPress={() => setSheetOpen(false)}
            style={StyleSheet.absoluteFill}
          />
          <View accessibilityViewIsModal style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <View>
                <Text style={styles.eyebrow}>SCHNELLAKTION</Text>
                <Text style={styles.sheetTitle}>Wiedervorlage setzen</Text>
              </View>
              <Pressable
                accessibilityLabel="Wiedervorlage schliessen"
                accessibilityRole="button"
                disabled={saving}
                hitSlop={8}
                onPress={() => setSheetOpen(false)}
                style={styles.closeButton}
              >
                <Ionicons color={colors.primaryText} name="close" size={22} />
              </Pressable>
            </View>
            <ScrollView
              automaticallyAdjustKeyboardInsets
              contentContainerStyle={styles.sheetContent}
              keyboardDismissMode="interactive"
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>
                  WORAN MÖCHTEN SIE ERINNERT WERDEN?
                </Text>
                <TextInput
                  autoCapitalize="sentences"
                  autoFocus
                  maxLength={240}
                  onChangeText={setTitle}
                  placeholder="Zum Beispiel: Rückmeldung einholen"
                  placeholderTextColor={colors.subtle}
                  returnKeyType="done"
                  style={styles.input}
                  value={title}
                />
              </View>
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>FÄLLIG</Text>
                <View style={styles.choiceList}>
                  {dueChoices.map((choice) => {
                    const selected = dueChoice === choice.value;
                    return (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        key={choice.value}
                        onPress={() => {
                          setDueChoice(choice.value);
                          hapticSelection();
                        }}
                        style={[
                          styles.choice,
                          selected && styles.choiceSelected,
                        ]}
                      >
                        <Text
                          style={[
                            styles.choiceText,
                            selected && styles.choiceTextSelected,
                          ]}
                        >
                          {choice.label}
                        </Text>
                        {selected ? (
                          <Ionicons
                            color={colors.primaryText}
                            name="checkmark"
                            size={19}
                          />
                        ) : null}
                      </Pressable>
                    );
                  })}
                </View>
              </View>
              {sheetError ? (
                <View style={[styles.feedback, styles.feedbackError]}>
                  <Ionicons
                    color={colors.error}
                    name="alert-circle-outline"
                    size={19}
                  />
                  <Text style={[styles.feedbackText, styles.feedbackTextError]}>
                    {sheetError}
                  </Text>
                </View>
              ) : null}
              <Pressable
                accessibilityRole="button"
                disabled={saving}
                onPress={() => void createFollowUp()}
                style={[styles.saveButton, saving && styles.disabled]}
              >
                {saving ? (
                  <ActivityIndicator color={colors.onPrimary} size="small" />
                ) : (
                  <Ionicons
                    color={colors.onPrimary}
                    name="alarm-outline"
                    size={20}
                  />
                )}
                <Text style={styles.saveButtonText}>
                  {saving ? "Wird gespeichert …" : "Wiedervorlage speichern"}
                </Text>
              </Pressable>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

function FollowUpRow({
  colors,
  followUp,
  onComplete,
  resolving,
  timingLabel,
}: {
  colors: AppPalette;
  followUp: ExperienceFollowUp;
  onComplete: () => void;
  resolving: boolean;
  timingLabel: string;
}) {
  const styles = useStyles();
  const overdue = timingLabel === "Überfällig";
  return (
    <View style={styles.followUp}>
      <View style={[styles.timingIcon, overdue && styles.timingIconOverdue]}>
        <Ionicons
          color={overdue ? colors.error : colors.primaryText}
          name={overdue ? "alert-circle-outline" : "time-outline"}
          size={19}
        />
      </View>
      <View style={styles.followUpCopy}>
        <Text numberOfLines={1} style={styles.followUpTitle}>
          {followUp.title}
        </Text>
        <Text numberOfLines={1} style={styles.followUpMeta}>
          {timingLabel} · {priorityLabel(followUp.priority)}
        </Text>
      </View>
      <Pressable
        accessibilityLabel={`${followUp.title} als erledigt markieren`}
        accessibilityRole="button"
        disabled={resolving}
        onPress={onComplete}
        style={[styles.completeButton, resolving && styles.disabled]}
      >
        {resolving ? (
          <ActivityIndicator color={colors.success} size="small" />
        ) : (
          <Ionicons color={colors.success} name="checkmark" size={20} />
        )}
      </Pressable>
    </View>
  );
}

const useStyles = makeThemedStyles((c) => ({
  card: {
    backgroundColor: c.surface,
    borderColor: c.border,
    borderRadius: 22,
    borderWidth: 1,
    gap: 14,
  },
  header: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
  },
  headerCopy: { flex: 1 },
  headingRow: { alignItems: "center", flexDirection: "row", gap: 10 },
  icon: {
    alignItems: "center",
    backgroundColor: c.primarySoft,
    borderRadius: 14,
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  eyebrow: {
    color: c.muted,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1,
  },
  title: { color: c.foreground, fontSize: 19, fontWeight: "800", marginTop: 2 },
  subtitle: { color: c.muted, fontSize: 12, lineHeight: 18, marginTop: 8 },
  addButton: {
    alignItems: "center",
    backgroundColor: c.primarySoft,
    borderRadius: 18,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  skeletonList: { gap: 8 },
  skeletonRow: {
    alignItems: "center",
    backgroundColor: c.surfaceSubtle,
    borderRadius: 15,
    flexDirection: "row",
    gap: 10,
    minHeight: 62,
    padding: 11,
  },
  skeletonMark: {
    backgroundColor: c.border,
    borderRadius: 10,
    height: 31,
    width: 31,
  },
  skeletonCopy: { flex: 1, gap: 8 },
  skeletonLine: {
    backgroundColor: c.border,
    borderRadius: 5,
    height: 11,
    width: "84%",
  },
  skeletonShort: {
    backgroundColor: c.border,
    borderRadius: 5,
    height: 9,
    width: "52%",
  },
  empty: {
    alignItems: "center",
    backgroundColor: c.surfaceSubtle,
    borderColor: c.border,
    borderRadius: 15,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    minHeight: 58,
    paddingHorizontal: 13,
  },
  emptyText: { color: c.muted, flex: 1, fontSize: 13, lineHeight: 18 },
  list: { gap: 8 },
  followUp: {
    alignItems: "center",
    backgroundColor: c.surfaceSubtle,
    borderColor: c.border,
    borderRadius: 15,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    minHeight: 66,
    padding: 10,
  },
  timingIcon: {
    alignItems: "center",
    backgroundColor: c.primarySoft,
    borderRadius: 11,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  timingIconOverdue: { backgroundColor: c.errorSoft },
  followUpCopy: { flex: 1, gap: 3 },
  followUpTitle: { color: c.foreground, fontSize: 14, fontWeight: "800" },
  followUpMeta: { color: c.muted, fontSize: 11, lineHeight: 16 },
  completeButton: {
    alignItems: "center",
    backgroundColor: c.successSoft,
    borderColor: c.successBorder,
    borderRadius: 16,
    borderWidth: 1,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  quickAction: {
    alignItems: "center",
    borderColor: c.border,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: 9,
    justifyContent: "center",
    minHeight: 50,
    paddingHorizontal: 13,
  },
  quickActionText: {
    color: c.primaryText,
    flex: 1,
    fontSize: 14,
    fontWeight: "800",
  },
  feedback: {
    alignItems: "flex-start",
    borderRadius: 13,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    padding: 11,
  },
  feedbackError: { backgroundColor: c.errorSoft, borderColor: c.errorBorder },
  feedbackSuccess: {
    backgroundColor: c.successSoft,
    borderColor: c.successBorder,
  },
  feedbackText: { flex: 1, fontSize: 12, lineHeight: 18 },
  feedbackTextError: { color: c.error },
  feedbackTextSuccess: { color: c.success },
  modalRoot: {
    backgroundColor: c.overlay,
    flex: 1,
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: c.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: "84%",
    padding: 20,
    paddingBottom: 28,
  },
  sheetHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  sheetTitle: {
    color: c.foreground,
    fontSize: 21,
    fontWeight: "800",
    marginTop: 3,
  },
  closeButton: {
    alignItems: "center",
    backgroundColor: c.primarySoft,
    borderRadius: 17,
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  sheetContent: { gap: 17, paddingTop: 18 },
  field: { gap: 8 },
  fieldLabel: {
    color: c.muted,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.9,
  },
  input: {
    backgroundColor: c.surfaceSubtle,
    borderColor: c.border,
    borderRadius: 14,
    borderWidth: 1,
    color: c.foreground,
    fontSize: 15,
    minHeight: 52,
    paddingHorizontal: 13,
  },
  choiceList: { gap: 8 },
  choice: {
    alignItems: "center",
    backgroundColor: c.surfaceSubtle,
    borderColor: c.border,
    borderRadius: 13,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 50,
    paddingHorizontal: 13,
  },
  choiceSelected: {
    backgroundColor: c.primarySoft,
    borderColor: c.primarySoftBorder,
  },
  choiceText: { color: c.foreground, fontSize: 14, fontWeight: "800" },
  choiceTextSelected: { color: c.primaryText },
  saveButton: {
    alignItems: "center",
    backgroundColor: c.primary,
    borderRadius: 15,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    minHeight: 52,
    paddingHorizontal: 16,
  },
  saveButtonText: { color: c.onPrimary, fontSize: 14, fontWeight: "800" },
  disabled: { opacity: 0.55 },
}));
