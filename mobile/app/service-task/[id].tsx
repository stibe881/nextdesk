import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

import { useMobileFeatures } from "@/components/mobile-feature-gate";
import { ScreenContainer } from "@/components/screen-container";
import { hapticSuccess } from "@/lib/mobile-haptics";
import { loadCurrentTenant } from "@/lib/nextdesk-client";
import {
  formatServiceTaskDay,
  isServiceTaskOpen,
  SERVICE_TASK_STATUS_LABEL,
  type ServiceTaskAccess,
  type ServiceTaskDetail,
} from "@/lib/service-task-model";
import { loadServiceTask, updateServiceTask } from "@/lib/service-tasks";
import { makeThemedStyles, useAppColors } from "@/lib/themed-styles";
import { useMobileSessionGuard } from "@/lib/use-mobile-session-guard";
import { tn } from "@/lib/formality";

/**
 * Serviceaufgabe aus einer Mitteilung («heute fällig», «überfällig»): zeigt
 * Fälligkeit, Anleitung und Checkliste; erledigen wie in der Web-App.
 * Rechte prüft der Server (Modul Serviceaufgaben, Ausführen).
 */
export default function ServiceTaskScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const occurrenceId = typeof id === "string" ? id : "";
  const router = useRouter();
  const styles = useStyles();
  const colors = useAppColors();
  const checkingSession = useMobileSessionGuard();
  const { isEnabled, loading: checkingFeatures } = useMobileFeatures();
  const enabled = isEnabled("service.tasks");
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [task, setTask] = useState<ServiceTaskDetail | null>(null);
  const [access, setAccess] = useState<ServiceTaskAccess | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!occurrenceId) return;
    try {
      const tenant = await loadCurrentTenant();
      setTenantId(tenant.id);
      const result = await loadServiceTask(tenant.id, occurrenceId);
      setTask(result.task);
      setAccess(result.access);
      setError("");
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Die Serviceaufgabe konnte nicht geladen werden.",
      );
    }
  }, [occurrenceId]);

  useFocusEffect(
    useCallback(() => {
      if (!checkingSession && !checkingFeatures && enabled) void load();
    }, [checkingFeatures, checkingSession, enabled, load]),
  );

  async function run(
    key: string,
    action: "start" | "complete" | "toggleCheck",
    extra: Record<string, unknown> = {},
    message?: string,
  ) {
    if (!tenantId || !task) return;
    setBusy(key);
    setError("");
    setNotice("");
    try {
      await updateServiceTask(tenantId, task.id, action, extra);
      if (message) {
        setNotice(message);
        void hapticSuccess();
      }
      await load();
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Die Aktion ist fehlgeschlagen.",
      );
    } finally {
      setBusy(null);
    }
  }

  const open = task ? isServiceTaskOpen(task) : false;
  const canExecute = access?.canExecute === true;
  const due = formatServiceTaskDay(task?.dueOn ?? null);

  return (
    <ScreenContainer className="px-5">
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
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
        <Text style={styles.eyebrow}>SERVICEAUFGABE</Text>

        {checkingSession || checkingFeatures ? (
          <ActivityIndicator color={colors.primary} />
        ) : !enabled ? (
          <Text style={styles.hint}>
            {tn("Serviceaufgaben sind in deinem Arbeitsbereich nicht freigeschaltet oder dir fehlt die Berechtigung.", "Serviceaufgaben sind in Ihrem Arbeitsbereich nicht freigeschaltet oder Ihnen fehlt die Berechtigung.")}
          </Text>
        ) : error && !task ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        ) : !task ? (
          <ActivityIndicator color={colors.primary} />
        ) : (
          <>
            <Text selectable style={styles.title}>
              {task.title}
            </Text>
            <View style={styles.badges}>
              <Text style={[styles.badge, task.overdue && styles.badgeWarning]}>
                {task.overdue && open
                  ? "Überfällig"
                  : SERVICE_TASK_STATUS_LABEL[task.status]}
              </Text>
              {due ? <Text style={styles.meta}>Fällig am {due}</Text> : null}
            </View>
            {task.assigneeName ? (
              <Text style={styles.meta}>Zuständig: {task.assigneeName}</Text>
            ) : null}
            {task.referenceLabel ? (
              <Text style={styles.meta}>Bezug: {task.referenceLabel}</Text>
            ) : null}
            {task.instructions ? (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Anleitung</Text>
                <Text selectable style={styles.body}>
                  {task.instructions}
                </Text>
              </View>
            ) : null}

            {task.checklist.length > 0 ? (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Checkliste</Text>
                {task.checklist.map((item) => (
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityState={{
                      checked: item.done,
                      disabled: !open || !canExecute || busy !== null,
                    }}
                    disabled={!open || !canExecute || busy !== null}
                    key={item.id}
                    onPress={() =>
                      void run(`check:${item.id}`, "toggleCheck", {
                        checkId: item.id,
                        done: !item.done,
                      })
                    }
                    style={styles.checkRow}
                  >
                    <Ionicons
                      color={item.done ? colors.primary : colors.muted}
                      name={item.done ? "checkbox" : "square-outline"}
                      size={20}
                    />
                    <Text style={styles.body}>{item.label}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}

            {task.note && !open ? (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Notiz</Text>
                <Text selectable style={styles.body}>
                  {task.note}
                </Text>
              </View>
            ) : null}
            {task.status === "done" && task.completedBy ? (
              <Text style={styles.meta}>Erledigt von {task.completedBy}</Text>
            ) : null}
            {task.status === "skipped" && task.skippedReason ? (
              <Text style={styles.meta}>Grund: {task.skippedReason}</Text>
            ) : null}

            {open && canExecute ? (
              <View style={styles.actions}>
                <TextInput
                  accessibilityLabel="Notiz zum Ergebnis"
                  multiline
                  onChangeText={setNote}
                  placeholder={
                    task.requireNote
                      ? "Notiz zum Ergebnis (Pflicht)"
                      : "Notiz zum Ergebnis (optional)"
                  }
                  placeholderTextColor={colors.muted}
                  style={styles.input}
                  value={note}
                />
                {task.status === "open" ? (
                  <Pressable
                    accessibilityRole="button"
                    disabled={busy !== null}
                    onPress={() => void run("start", "start")}
                    style={styles.secondaryButton}
                  >
                    <Text style={styles.secondaryButtonText}>
                      {busy === "start" ? "Wird gestartet …" : "Starten"}
                    </Text>
                  </Pressable>
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  disabled={busy !== null}
                  onPress={() =>
                    void run(
                      "complete",
                      "complete",
                      note.trim() ? { note: note.trim() } : {},
                      "Die Serviceaufgabe ist erledigt.",
                    )
                  }
                  style={styles.primaryButton}
                >
                  <Text style={styles.primaryButtonText}>
                    {busy === "complete" ? "Wird gespeichert …" : "Erledigt"}
                  </Text>
                </Pressable>
              </View>
            ) : null}
            {!canExecute && open ? (
              <Text style={styles.hint}>
                {tn("Du kannst diese Aufgabe ansehen, aber nicht erledigen.", "Sie können diese Aufgabe ansehen, aber nicht erledigen.")}
              </Text>
            ) : null}
            {notice ? (
              <Text accessibilityLiveRegion="polite" style={styles.notice}>
                {notice}
              </Text>
            ) : null}
            {error ? (
              <Text accessibilityRole="alert" style={styles.error}>
                {error}
              </Text>
            ) : null}
            <Text style={styles.hint}>
              {tn("Vorlagen, Planung und Verlauf findest du in der Web-App unter «Serviceaufgaben».", "Vorlagen, Planung und Verlauf finden Sie in der Web-App unter «Serviceaufgaben».")}
            </Text>
          </>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

const useStyles = makeThemedStyles((c) => ({
  actions: { gap: 10 },
  back: { alignItems: "center", flexDirection: "row", gap: 4 },
  backText: { color: c.primaryText, fontSize: 15, fontWeight: "700" },
  badge: {
    backgroundColor: c.primarySoft,
    borderRadius: 999,
    color: c.primaryText,
    fontSize: 12,
    fontWeight: "800",
    overflow: "hidden",
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeWarning: { backgroundColor: c.warningSoft, color: c.warning },
  badges: { alignItems: "center", flexDirection: "row", gap: 10 },
  body: { color: c.text, flex: 1, fontSize: 14, lineHeight: 20 },
  card: {
    backgroundColor: c.surface,
    borderColor: c.border,
    borderRadius: 14,
    borderWidth: 1,
    gap: 8,
    padding: 14,
  },
  cardTitle: { color: c.foreground, fontSize: 14, fontWeight: "800" },
  checkRow: { alignItems: "center", flexDirection: "row", gap: 10 },
  content: { gap: 14, paddingBottom: 40, paddingTop: 12 },
  error: { color: c.error, fontSize: 13 },
  eyebrow: {
    color: c.muted,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1,
  },
  hint: { color: c.muted, fontSize: 13, lineHeight: 19 },
  input: {
    backgroundColor: c.surface,
    borderColor: c.border,
    borderRadius: 12,
    borderWidth: 1,
    color: c.foreground,
    fontSize: 14,
    minHeight: 72,
    padding: 12,
    textAlignVertical: "top",
  },
  meta: { color: c.muted, fontSize: 13 },
  notice: { color: c.primaryText, fontSize: 13, fontWeight: "700" },
  primaryButton: {
    alignItems: "center",
    backgroundColor: c.primary,
    borderRadius: 12,
    minHeight: 46,
    justifyContent: "center",
  },
  primaryButtonText: { color: c.onPrimary, fontSize: 15, fontWeight: "800" },
  secondaryButton: {
    alignItems: "center",
    borderColor: c.border,
    borderRadius: 12,
    borderWidth: 1,
    minHeight: 46,
    justifyContent: "center",
  },
  secondaryButtonText: { color: c.foreground, fontSize: 15, fontWeight: "700" },
  title: { color: c.foreground, fontSize: 24, fontWeight: "900" },
}));
