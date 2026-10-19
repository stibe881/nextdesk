import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { useMobileFeatures } from "@/components/mobile-feature-gate";
import {
  answerTicketDepartmentQuestion,
  askTicketDepartmentQuestion,
  loadTicketDepartmentQuestions,
  type DepartmentQuestion,
  type DepartmentQuestionContext,
} from "@/lib/nextdesk-workbench";
import {
  hapticError,
  hapticSelection,
  hapticSuccess,
} from "@/lib/mobile-haptics";
import { useThemeContext } from "@/lib/theme-provider";

type Composer = "ask" | { question: DepartmentQuestion } | null;
type Filter = "open" | "answered";

function formatDate(value: string | null): string {
  if (!value || !Number.isFinite(Date.parse(value)))
    return "Unbekannter Zeitpunkt";
  return new Intl.DateTimeFormat("de-CH", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function DepartmentQuestions({ ticketId }: { ticketId: string }) {
  const { colors } = useThemeContext();
  const { tenantId: confirmedTenantId } = useMobileFeatures();
  const [context, setContext] = useState<DepartmentQuestionContext | null>(
    null,
  );
  const [expanded, setExpanded] = useState(false);
  const [filter, setFilter] = useState<Filter>("open");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [composer, setComposer] = useState<Composer>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const requestVersion = useRef(0);

  const refresh = useCallback(async () => {
    const version = requestVersion.current + 1;
    requestVersion.current = version;
    setLoading(true);
    setError("");
    try {
      const nextContext = await loadTicketDepartmentQuestions(ticketId);
      if (requestVersion.current !== version) return;
      setContext(nextContext);
    } catch (nextError) {
      if (requestVersion.current !== version) return;
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Abteilungsrückfragen konnten nicht geladen werden.",
      );
    } finally {
      if (requestVersion.current === version) setLoading(false);
    }
  }, [ticketId]);

  useEffect(
    () => () => {
      requestVersion.current += 1;
    },
    [],
  );

  const questions = useMemo(
    () =>
      (context?.questions ?? []).filter((question) =>
        filter === "open"
          ? question.status === "open"
          : question.status === "answered",
      ),
    [context?.questions, filter],
  );
  const canOpenComposer = Boolean(
    context?.permissions.canAsk && context.route.activeRecipientUserId,
  );
  const recipientName = context?.route.activeRecipientDisplayName ?? null;
  const summary = loading
    ? "Lädt …"
    : `${context?.counts.open ?? 0} offen · ${context?.counts.answered ?? 0} beantwortet`;

  function openAsk() {
    if (!canOpenComposer) return;
    setDraft("");
    setError("");
    setComposer("ask");
    hapticSelection();
  }

  function openAnswer(question: DepartmentQuestion) {
    setDraft("");
    setError("");
    setComposer({ question });
    hapticSelection();
  }

  async function submit() {
    const body = draft.trim();
    const isAnswer = typeof composer === "object" && composer !== null;
    const minimum = isAnswer ? 1 : 3;
    const maximum = isAnswer ? 5000 : 3000;
    if (
      isAnswer &&
      (composer.question.ticket_id !== ticketId || !composer.question.canAnswer)
    ) {
      setError(
        "Diese Rückfrage gehört nicht mehr zum geöffneten Ticket oder kann nicht mehr beantwortet werden.",
      );
      return;
    }
    if (
      Array.from(body).length < minimum ||
      Array.from(body).length > maximum
    ) {
      setError(
        isAnswer
          ? "Die Antwort muss zwischen 1 und 5'000 Zeichen lang sein."
          : "Die Rückfrage muss zwischen 3 und 3'000 Zeichen lang sein.",
      );
      return;
    }
    setSending(true);
    setError("");
    try {
      if (isAnswer) {
        await answerTicketDepartmentQuestion({
          questionId: composer.question.id,
          answer: body,
        });
      } else {
        await askTicketDepartmentQuestion({ ticketId, question: body });
      }
      hapticSuccess();
      setComposer(null);
      setDraft("");
      setFilter(isAnswer ? "answered" : "open");
      await refresh();
    } catch (nextError) {
      hapticError();
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Die Rückfrage konnte nicht gespeichert werden.",
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <View style={[styles.divider, { backgroundColor: colors.border }]} />
      <Pressable
        accessibilityLabel="Abteilungsrückfragen"
        accessibilityRole="button"
        accessibilityState={{ expanded, busy: loading }}
        onPress={() => {
          const next = !expanded;
          setExpanded(next);
          if (next && !context && !loading) void refresh();
          hapticSelection();
        }}
        style={styles.row}
      >
        <View style={styles.lead}>
          <Ionicons color={colors.info} name="chatbubbles-outline" size={19} />
          <Text style={[styles.label, { color: colors.foreground }]}>
            Abteilungsrückfragen
          </Text>
        </View>
        <View style={styles.end}>
          <Text
            numberOfLines={1}
            style={[styles.summary, { color: colors.muted }]}
          >
            {summary}
          </Text>
          <Ionicons
            color={colors.primaryText}
            name={expanded ? "chevron-up" : "chevron-down"}
            size={18}
          />
        </View>
      </Pressable>
      {expanded ? (
        <View style={styles.expansion}>
          {loading && !context ? (
            <View style={styles.loading}>
              <ActivityIndicator color={colors.primary} size="small" />
              <Text style={[styles.help, { color: colors.muted }]}>
                Rückfragen werden geladen …
              </Text>
            </View>
          ) : null}
          {error && !context ? (
            <View
              style={[
                styles.notice,
                {
                  borderColor: colors.errorBorder,
                  backgroundColor: colors.errorSoft,
                },
              ]}
            >
              <Text style={[styles.noticeText, { color: colors.foreground }]}>
                {error}
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => void refresh()}
                style={styles.retry}
              >
                <Text style={{ color: colors.primaryText }}>
                  Erneut versuchen
                </Text>
              </Pressable>
            </View>
          ) : null}
          {context ? (
            <>
              <View
                style={[
                  styles.route,
                  {
                    borderColor: colors.border,
                    backgroundColor: colors.surfaceSubtle,
                  },
                ]}
              >
                <Text style={[styles.routeLabel, { color: colors.muted }]}>
                  ZUSTÄNDIG
                </Text>
                <Text style={[styles.routeTitle, { color: colors.foreground }]}>
                  {context.department.name}
                </Text>
                {recipientName ? (
                  <Text style={[styles.help, { color: colors.muted }]}>
                    Antwortberechtigt: {recipientName}
                    {context.route.backupDisplayName
                      ? ` · Stellvertretung: ${context.route.backupDisplayName}`
                      : ""}
                  </Text>
                ) : (
                  <Text style={[styles.help, { color: colors.warning }]}>
                    Für diese Abteilung ist noch keine gültige Abteilungsleitung
                    hinterlegt.
                  </Text>
                )}
              </View>
              {context.permissions.canAsk ? (
                <Pressable
                  accessibilityRole="button"
                  disabled={!canOpenComposer || sending}
                  onPress={openAsk}
                  style={[
                    styles.primaryButton,
                    { backgroundColor: colors.primary },
                    (!canOpenComposer || sending) && styles.disabled,
                  ]}
                >
                  <Ionicons
                    color={colors.primaryText}
                    name="create-outline"
                    size={18}
                  />
                  <Text
                    style={[
                      styles.primaryButtonText,
                      { color: colors.primaryText },
                    ]}
                  >
                    Rückfrage schreiben
                  </Text>
                </Pressable>
              ) : null}
              {context.permissions.canAsk && !recipientName ? (
                <Text style={[styles.help, { color: colors.muted }]}>
                  Eine Rückfrage kann erst nach der Zuordnung einer
                  Abteilungsleitung versendet werden.
                </Text>
              ) : null}
              <View style={styles.filters}>
                {(["open", "answered"] as const).map((value) => {
                  const selected = filter === value;
                  const count =
                    value === "open"
                      ? context.counts.open
                      : context.counts.answered;
                  return (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      key={value}
                      onPress={() => setFilter(value)}
                      style={[
                        styles.filter,
                        {
                          borderColor: selected
                            ? colors.primary
                            : colors.border,
                          backgroundColor: selected
                            ? colors.primarySoft
                            : colors.surface,
                        },
                      ]}
                    >
                      <Text
                        style={{
                          color: selected
                            ? colors.primaryText
                            : colors.foreground,
                        }}
                      >
                        {value === "open"
                          ? `Offen (${count})`
                          : `Beantwortet (${count})`}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              {error ? (
                <Text style={[styles.error, { color: colors.error }]}>
                  {error}
                </Text>
              ) : null}
              {questions.length ? (
                <View style={styles.questionList}>
                  {questions.map((question) => (
                    <View
                      key={question.id}
                      style={[
                        styles.question,
                        {
                          borderColor: colors.border,
                          backgroundColor: colors.surfaceSubtle,
                        },
                      ]}
                    >
                      <View style={styles.questionHeader}>
                        <Text
                          style={[
                            styles.badge,
                            {
                              color:
                                question.status === "open"
                                  ? colors.warning
                                  : colors.success,
                            },
                          ]}
                        >
                          {question.status === "open" ? "Offen" : "Beantwortet"}
                        </Text>
                        <Text style={[styles.date, { color: colors.muted }]}>
                          {formatDate(question.created_at)}
                        </Text>
                      </View>
                      <Text
                        style={[
                          styles.questionText,
                          { color: colors.foreground },
                        ]}
                      >
                        {question.question}
                      </Text>
                      <Text style={[styles.help, { color: colors.muted }]}>
                        Von {question.askedByName ?? "nextDesk Benutzer"} · an{" "}
                        {question.recipientName ?? "Abteilungsleitung"}
                      </Text>
                      {question.status === "answered" ? (
                        <View
                          style={[
                            styles.answer,
                            { borderLeftColor: colors.success },
                          ]}
                        >
                          <Text
                            style={[
                              styles.answerLabel,
                              { color: colors.success },
                            ]}
                          >
                            ANTWORT
                          </Text>
                          <Text
                            style={[
                              styles.questionText,
                              { color: colors.foreground },
                            ]}
                          >
                            {question.answer}
                          </Text>
                          <Text style={[styles.help, { color: colors.muted }]}>
                            Antwort von{" "}
                            {question.answeredByName ?? "Abteilungsleitung"} ·{" "}
                            {formatDate(question.answered_at)}
                          </Text>
                        </View>
                      ) : question.canAnswer ? (
                        <Pressable
                          accessibilityRole="button"
                          onPress={() => openAnswer(question)}
                          style={[
                            styles.answerButton,
                            {
                              borderColor: colors.primarySoftBorder,
                              backgroundColor: colors.primarySoft,
                            },
                          ]}
                        >
                          <Text style={{ color: colors.primaryText }}>
                            Antworten
                          </Text>
                        </Pressable>
                      ) : null}
                    </View>
                  ))}
                </View>
              ) : !loading ? (
                <Text style={[styles.help, { color: colors.muted }]}>
                  Für diesen Status liegen keine Abteilungsrückfragen vor.
                </Text>
              ) : null}
            </>
          ) : null}
        </View>
      ) : null}
      <Modal
        animationType="slide"
        onRequestClose={() => !sending && setComposer(null)}
        transparent
        visible={composer !== null && Boolean(confirmedTenantId)}
      >
        <View style={styles.modalRoot}>
          <Pressable
            disabled={sending}
            onPress={() => setComposer(null)}
            style={StyleSheet.absoluteFill}
          />
          <View style={[styles.sheet, { backgroundColor: colors.surface }]}>
            <View style={styles.sheetHeader}>
              <View style={styles.sheetHeading}>
                <Text style={[styles.eyebrow, { color: colors.muted }]}>
                  ABTEILUNGSRÜCKFRAGE
                </Text>
                <Text style={[styles.sheetTitle, { color: colors.foreground }]}>
                  {typeof composer === "object"
                    ? "Antwort schreiben"
                    : `Rückfrage an ${context?.department.name ?? "Abteilung"}`}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                disabled={sending}
                onPress={() => setComposer(null)}
                style={styles.close}
              >
                <Ionicons color={colors.primaryText} name="close" size={22} />
              </Pressable>
            </View>
            {composer && typeof composer === "object" ? (
              <View
                style={[
                  styles.quote,
                  {
                    borderColor: colors.border,
                    backgroundColor: colors.surfaceSubtle,
                  },
                ]}
              >
                <Text style={[styles.help, { color: colors.muted }]}>
                  Rückfrage
                </Text>
                <Text style={{ color: colors.foreground }}>
                  {composer.question.question}
                </Text>
              </View>
            ) : (
              <Text style={[styles.help, { color: colors.muted }]}>
                Die Abteilungsleitung erhält die Rückfrage als Benachrichtigung
                und – falls Exchange Online aktiv ist – per E-Mail.
              </Text>
            )}
            <TextInput
              autoFocus
              editable={!sending}
              maxLength={typeof composer === "object" ? 5000 : 3000}
              multiline
              onChangeText={setDraft}
              placeholder={
                typeof composer === "object"
                  ? "Antwort schreiben"
                  : "Rückfrage möglichst konkret formulieren"
              }
              placeholderTextColor={colors.subtle}
              style={[
                styles.input,
                {
                  borderColor: colors.border,
                  color: colors.foreground,
                  backgroundColor: colors.surfaceSubtle,
                },
              ]}
              textAlignVertical="top"
              value={draft}
            />
            <Text style={[styles.counter, { color: colors.muted }]}>
              {Array.from(draft).length} /{" "}
              {typeof composer === "object" ? "5'000" : "3'000"}
            </Text>
            {error ? (
              <Text style={[styles.error, { color: colors.error }]}>
                {error}
              </Text>
            ) : null}
            <Pressable
              accessibilityRole="button"
              disabled={sending}
              onPress={() => void submit()}
              style={[
                styles.primaryButton,
                { backgroundColor: colors.primary },
                sending && styles.disabled,
              ]}
            >
              {sending ? (
                <ActivityIndicator color={colors.primaryText} size="small" />
              ) : (
                <Ionicons
                  color={colors.primaryText}
                  name="send-outline"
                  size={18}
                />
              )}
              <Text
                style={[
                  styles.primaryButtonText,
                  { color: colors.primaryText },
                ]}
              >
                {sending
                  ? "Wird gespeichert …"
                  : typeof composer === "object"
                    ? "Antwort veröffentlichen"
                    : "Rückfrage senden"}
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 4 },
  row: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  lead: { flexDirection: "row", alignItems: "center", gap: 12, flex: 1 },
  end: { flexDirection: "row", alignItems: "center", gap: 8, maxWidth: "54%" },
  label: { fontSize: 18, fontWeight: "800", flexShrink: 1 },
  summary: { fontSize: 14, textAlign: "right", flexShrink: 1 },
  expansion: { gap: 12, paddingBottom: 10 },
  loading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
  },
  route: { borderWidth: 1, borderRadius: 14, padding: 13, gap: 4 },
  routeLabel: { fontSize: 12, fontWeight: "800", letterSpacing: 1.2 },
  routeTitle: { fontSize: 16, fontWeight: "800" },
  help: { fontSize: 13, lineHeight: 19 },
  primaryButton: {
    minHeight: 46,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16,
  },
  primaryButtonText: { fontSize: 15, fontWeight: "800" },
  disabled: { opacity: 0.48 },
  filters: { flexDirection: "row", gap: 8 },
  filter: {
    borderWidth: 1,
    borderRadius: 999,
    minHeight: 38,
    paddingHorizontal: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  questionList: { gap: 10 },
  question: { borderWidth: 1, borderRadius: 14, padding: 13, gap: 7 },
  questionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
  },
  badge: {
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  date: { fontSize: 12, flexShrink: 1, textAlign: "right" },
  questionText: { fontSize: 15, lineHeight: 22 },
  answer: { borderLeftWidth: 3, paddingLeft: 10, gap: 5, marginTop: 2 },
  answerLabel: { fontSize: 12, fontWeight: "900", letterSpacing: 1 },
  answerButton: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderRadius: 10,
    minHeight: 38,
    paddingHorizontal: 13,
    justifyContent: "center",
  },
  notice: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 8 },
  noticeText: { fontSize: 14, lineHeight: 20 },
  retry: { alignSelf: "flex-start", minHeight: 32, justifyContent: "center" },
  error: { fontSize: 13, lineHeight: 19 },
  modalRoot: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(15, 16, 20, 0.36)",
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    gap: 12,
    maxHeight: "82%",
  },
  sheetHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
  sheetHeading: { flex: 1, gap: 3 },
  eyebrow: { fontSize: 11, fontWeight: "900", letterSpacing: 1.3 },
  sheetTitle: { fontSize: 20, fontWeight: "900" },
  close: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  quote: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 5 },
  input: {
    borderWidth: 1,
    borderRadius: 14,
    minHeight: 126,
    padding: 13,
    fontSize: 16,
    lineHeight: 23,
  },
  counter: { textAlign: "right", fontSize: 12 },
});
