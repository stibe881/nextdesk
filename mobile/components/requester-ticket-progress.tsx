import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { hapticError, hapticSuccess } from "@/lib/mobile-haptics";
import {
  NextDeskPortalError,
  getTicketProgress,
  respondToWaitingTicket,
} from "@/lib/nextdesk-portal";
import {
  expectedResolutionText,
  formatProgressTime,
  parseRequesterProgress,
  progressStepHint,
  progressStepLabel,
  type ReminderAnswer,
  type RequesterProgress,
} from "@/lib/requester-progress";
import { useAppColors } from "@/lib/themed-styles";
import { tn } from "@/lib/formality";

type Props = {
  ticketId: string;
  /** Reloads when the ticket changes (status, comments). */
  refreshKey: string;
  /** Preselected from a push notification action (remount via key to change). */
  initialAnswer: ReminderAnswer | null;
  onChanged: () => void;
};

/**
 * Step tracker for the requester's own ticket, with «Problem ist gelöst» /
 * «Ich brauche noch Hilfe» while the ticket waits for the person.
 */
export function RequesterTicketProgress({
  ticketId,
  refreshKey,
  initialAnswer,
  onChanged,
}: Props) {
  const colors = useAppColors();
  const [progress, setProgress] = useState<RequesterProgress | null>(null);
  const [answer, setAnswer] = useState<ReminderAnswer | null>(initialAnswer);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const version = useRef(0);

  const load = useCallback(async () => {
    const current = ++version.current;
    try {
      const next = parseRequesterProgress(await getTicketProgress(ticketId));
      if (version.current !== current) return;
      setProgress(next);
    } catch {
      // Feature off, older backend or no access: the screen omits the card.
      if (version.current === current) setProgress(null);
    }
  }, [ticketId]);

  useEffect(() => {
    const task = setTimeout(() => void load(), 0);
    return () => {
      clearTimeout(task);
      version.current += 1;
    };
  }, [load, refreshKey]);

  async function send(response: ReminderAnswer) {
    if (sending) return;
    setSending(true);
    setError("");
    try {
      await respondToWaitingTicket({
        ticketId,
        response,
        ...(response === "need_help" && message.trim()
          ? { message: message.trim() }
          : {}),
      });
      hapticSuccess();
      setAnswer(null);
      setMessage("");
      setNotice(
        response === "resolved"
          ? tn(
              "Danke! Dein Ticket ist jetzt gelöst.",
              "Danke! Ihr Ticket ist jetzt gelöst.",
            )
          : "Danke! Das Support-Team kümmert sich wieder darum.",
      );
      await load();
      onChanged();
    } catch (cause) {
      hapticError();
      setError(
        cause instanceof NextDeskPortalError &&
          cause.code === "ticket_not_waiting"
          ? tn(
              "Das Ticket wartet nicht mehr auf deine Rückmeldung.",
              "Das Ticket wartet nicht mehr auf Ihre Rückmeldung.",
            )
          : tn(
              "Deine Rückmeldung konnte nicht gesendet werden. Versuch es bitte nochmals.",
              "Ihre Rückmeldung konnte nicht gesendet werden. Versuchen Sie es bitte nochmals.",
            ),
      );
    } finally {
      setSending(false);
    }
  }

  if (!progress) return null;
  const expected = expectedResolutionText(progress.expected);

  return (
    <View
      accessibilityLabel="Ticketfortschritt"
      style={[
        styles.card,
        { backgroundColor: colors.surface, borderColor: colors.border },
      ]}
    >
      <Text style={[styles.eyebrow, { color: colors.muted }]}>FORTSCHRITT</Text>
      <Text style={[styles.title, { color: colors.foreground }]}>
        {progressStepLabel(progress.currentStep)}
      </Text>
      <Text style={[styles.text, { color: colors.muted }]}>
        {progressStepHint(progress.currentStep)}
      </Text>
      {expected ? (
        <Text style={[styles.expected, { color: colors.primaryText }]}>
          {expected}
        </Text>
      ) : null}

      <View style={styles.steps}>
        {progress.steps.map((step, index) => {
          const done = step.state === "done";
          const current = step.state === "current";
          const waiting = step.key === "waiting_for_requester";
          const accent = waiting ? colors.warning : colors.primary;
          return (
            <View
              accessibilityLabel={`${progressStepLabel(step.key)}${
                current ? ", aktueller Schritt" : done ? ", erledigt" : ""
              }`}
              key={step.key}
              style={styles.step}
            >
              <View style={styles.rail}>
                <View
                  style={[
                    styles.dot,
                    {
                      borderColor: done
                        ? colors.success
                        : current
                          ? accent
                          : colors.border,
                      backgroundColor: done ? colors.success : colors.surface,
                    },
                  ]}
                >
                  {done ? (
                    <Ionicons
                      color={colors.onPrimary}
                      name="checkmark"
                      size={12}
                    />
                  ) : null}
                </View>
                {index < progress.steps.length - 1 ? (
                  <View
                    style={[
                      styles.line,
                      {
                        backgroundColor: done ? colors.success : colors.border,
                      },
                    ]}
                  />
                ) : null}
              </View>
              <View style={styles.stepCopy}>
                <Text
                  style={[
                    styles.stepLabel,
                    {
                      color:
                        step.state === "upcoming"
                          ? colors.muted
                          : colors.foreground,
                      fontWeight: current ? "700" : "500",
                    },
                  ]}
                >
                  {progressStepLabel(step.key)}
                </Text>
                {step.reachedAt ? (
                  <Text style={[styles.stepTime, { color: colors.muted }]}>
                    {formatProgressTime(step.reachedAt)}
                  </Text>
                ) : null}
              </View>
            </View>
          );
        })}
      </View>

      {progress.waitingForRequester ? (
        <View style={[styles.answer, { backgroundColor: colors.warningSoft }]}>
          <Text style={[styles.answerTitle, { color: colors.foreground }]}>
            {tn("Ist dein Problem gelöst?", "Ist Ihr Problem gelöst?")}
          </Text>
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Problem ist gelöst"
              disabled={sending}
              onPress={() =>
                answer === "resolved"
                  ? void send("resolved")
                  : setAnswer("resolved")
              }
              style={[styles.button, { backgroundColor: colors.primary }]}
            >
              {sending && answer === "resolved" ? (
                <ActivityIndicator color={colors.onPrimary} />
              ) : (
                <Text style={[styles.buttonText, { color: colors.onPrimary }]}>
                  {answer === "resolved"
                    ? "Ja, bestätigen"
                    : "Problem ist gelöst"}
                </Text>
              )}
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Ich brauche noch Hilfe"
              disabled={sending}
              onPress={() => setAnswer("need_help")}
              style={[
                styles.button,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                  borderWidth: 1,
                },
              ]}
            >
              <Text style={[styles.buttonText, { color: colors.foreground }]}>
                Ich brauche noch Hilfe
              </Text>
            </Pressable>
          </View>
          {answer === "resolved" ? (
            <Text style={[styles.text, { color: colors.muted }]}>
              {tn(
                "Tippe nochmals, um zu bestätigen. Das Ticket wird dann als gelöst markiert.",
                "Tippen Sie nochmals, um zu bestätigen. Das Ticket wird dann als gelöst markiert.",
              )}
            </Text>
          ) : null}
          {answer === "need_help" ? (
            <View style={styles.help}>
              <TextInput
                accessibilityLabel="Was ist noch offen?"
                editable={!sending}
                maxLength={5000}
                multiline
                onChangeText={setMessage}
                placeholder="Was ist noch offen? (optional)"
                placeholderTextColor={colors.muted}
                style={[
                  styles.input,
                  {
                    backgroundColor: colors.surfaceSubtle,
                    borderColor: colors.border,
                    color: colors.foreground,
                  },
                ]}
                value={message}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Rückmeldung senden"
                disabled={sending}
                onPress={() => void send("need_help")}
                style={[styles.button, { backgroundColor: colors.primary }]}
              >
                {sending ? (
                  <ActivityIndicator color={colors.onPrimary} />
                ) : (
                  <Text
                    style={[styles.buttonText, { color: colors.onPrimary }]}
                  >
                    Rückmeldung senden
                  </Text>
                )}
              </Pressable>
            </View>
          ) : null}
        </View>
      ) : null}
      {notice ? (
        <Text style={[styles.text, { color: colors.success }]}>{notice}</Text>
      ) : null}
      {error ? (
        <Text style={[styles.text, { color: colors.error }]}>{error}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: 1, gap: 6, padding: 16 },
  eyebrow: { fontSize: 11, fontWeight: "700", letterSpacing: 1 },
  title: { fontSize: 18, fontWeight: "700" },
  text: { fontSize: 14, lineHeight: 20 },
  expected: { fontSize: 14, fontWeight: "600", marginTop: 4 },
  steps: { marginTop: 10 },
  step: { flexDirection: "row", gap: 12, minHeight: 44 },
  rail: { alignItems: "center", width: 22 },
  dot: {
    alignItems: "center",
    borderRadius: 11,
    borderWidth: 3,
    height: 22,
    justifyContent: "center",
    width: 22,
  },
  line: { borderRadius: 1, flex: 1, marginVertical: 2, width: 3 },
  stepCopy: { flex: 1, paddingBottom: 10 },
  stepLabel: { fontSize: 15 },
  stepTime: { fontSize: 13, marginTop: 2 },
  answer: { borderRadius: 12, gap: 10, marginTop: 8, padding: 12 },
  answerTitle: { fontSize: 15, fontWeight: "700" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  button: {
    alignItems: "center",
    borderRadius: 10,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 14,
  },
  buttonText: { fontSize: 15, fontWeight: "600" },
  help: { gap: 8 },
  input: {
    borderRadius: 10,
    borderWidth: 1,
    fontSize: 15,
    minHeight: 80,
    padding: 10,
    textAlignVertical: "top",
  },
});
