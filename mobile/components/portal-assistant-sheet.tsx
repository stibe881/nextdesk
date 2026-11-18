import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
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

import { hapticSelection, hapticSuccess } from "@/lib/mobile-haptics";
import {
  recordAssistantOutcome,
  sendAssistantTurn,
} from "@/lib/nextdesk-assistance";
import type {
  AssistantDraft,
  AssistantMessage,
  AssistantTurn,
} from "@/lib/portal-assistant";
import { makeThemedStyles, useAppColors } from "@/lib/themed-styles";
import { tn } from "@/lib/formality";

/**
 * «Mit dem Assistenten lösen» (mobile): the person describes the problem,
 * the assistant suggests knowledge articles and asks at most two questions.
 * If nothing helps, the prepared draft goes into the ticket form.
 */
export function PortalAssistantSheet({
  departmentId,
  onClose,
  onOpenArticle,
  onSolved,
  onUseDraft,
  tenantId,
  visible,
}: {
  departmentId: string | null;
  onClose: () => void;
  onOpenArticle: (articleId: string) => void;
  onSolved: () => void;
  onUseDraft: (draft: AssistantDraft, sessionId: string) => void;
  tenantId: string;
  visible: boolean;
}) {
  const styles = useStyles();
  const colors = useAppColors();
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [input, setInput] = useState("");
  const [turn, setTurn] = useState<AssistantTurn | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const sessionId = turn?.sessionId ?? null;
  const canAnswer = !turn || turn.question !== null;

  function reset() {
    setMessages([]);
    setInput("");
    setTurn(null);
    setError("");
  }

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    const history: AssistantMessage[] = [...messages, { role: "user", text }];
    setBusy(true);
    setError("");
    try {
      const next = await sendAssistantTurn({
        tenantId,
        sessionId,
        departmentId,
        messages: history,
      });
      setTurn(next);
      setMessages([
        ...history,
        ...(next.question
          ? [{ role: "assistant" as const, text: next.question }]
          : []),
      ]);
      setInput("");
    } catch (sendError) {
      setError(
        sendError instanceof Error
          ? sendError.message
          : "Der Assistent ist gerade nicht verfügbar.",
      );
    } finally {
      setBusy(false);
    }
  }

  function close() {
    if (sessionId) {
      void recordAssistantOutcome({
        tenantId,
        sessionId,
        outcome: "abandoned",
      });
    }
    reset();
    onClose();
  }

  return (
    <Modal
      animationType="slide"
      onRequestClose={close}
      transparent
      visible={visible}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.modalRoot}
      >
        <Pressable
          accessibilityLabel="Assistent schliessen"
          accessibilityRole="button"
          onPress={close}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={styles.eyebrow}>SELBSTBEDIENUNG</Text>
              <Text style={styles.title}>Mit dem Assistenten lösen</Text>
            </View>
            <Pressable
              accessibilityLabel="Assistent schliessen"
              accessibilityRole="button"
              hitSlop={10}
              onPress={close}
              style={styles.closeButton}
            >
              <Ionicons color={colors.primaryText} name="close" size={22} />
            </Pressable>
          </View>
          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
          >
            {messages.length === 0 ? (
              <Text style={styles.note}>
                {tn("Beschreibe dein Problem. Der Assistent sucht passende Artikel und bereitet bei Bedarf ein Ticket für dich vor.", "Beschreiben Sie Ihr Problem. Der Assistent sucht passende Artikel und bereitet bei Bedarf ein Ticket für Sie vor.")}
              </Text>
            ) : null}
            {messages.map((message, index) => (
              <View
                key={`${index}-${message.role}`}
                style={[
                  styles.bubble,
                  message.role === "user"
                    ? styles.bubbleUser
                    : styles.bubbleAssistant,
                ]}
              >
                <Text
                  style={
                    message.role === "user"
                      ? styles.bubbleUserText
                      : styles.bubbleText
                  }
                >
                  {message.text}
                </Text>
              </View>
            ))}
            {turn ? (
              <View style={styles.result}>
                {turn.reply ? (
                  <Text style={styles.reply}>{turn.reply}</Text>
                ) : null}
                {turn.articles.map((article) => (
                  <View key={article.id} style={styles.article}>
                    <Text style={styles.articleTitle}>{article.title}</Text>
                    {article.excerpt ? (
                      <Text numberOfLines={3} style={styles.note}>
                        {article.excerpt}
                      </Text>
                    ) : null}
                    <View style={styles.articleActions}>
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => onOpenArticle(article.id)}
                        style={styles.secondaryButton}
                      >
                        <Text style={styles.secondaryButtonText}>Öffnen</Text>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => {
                          if (!sessionId) return;
                          hapticSuccess();
                          void recordAssistantOutcome({
                            tenantId,
                            sessionId,
                            outcome: "solved_by_article",
                            articleId: article.id,
                          });
                          reset();
                          onSolved();
                        }}
                        style={styles.secondaryButton}
                      >
                        <Ionicons
                          color={colors.primaryText}
                          name="checkmark"
                          size={16}
                        />
                        <Text style={styles.secondaryButtonText}>
                          Hat geholfen
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                ))}
                <View style={styles.draft}>
                  <Text style={styles.note}>
                    {tn("Nicht gelöst? Dein Ticket ist vorbereitet:", "Nicht gelöst? Ihr Ticket ist vorbereitet:")}
                  </Text>
                  <Text style={styles.articleTitle}>{turn.draft.subject}</Text>
                  {turn.draft.categoryName ? (
                    <Text style={styles.note}>
                      Kategorie: {turn.draft.categoryName}
                    </Text>
                  ) : null}
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      hapticSelection();
                      onUseDraft(turn.draft, turn.sessionId);
                      reset();
                    }}
                    style={styles.primaryButton}
                  >
                    <Text style={styles.primaryButtonText}>
                      Entwurf übernehmen
                    </Text>
                  </Pressable>
                </View>
              </View>
            ) : null}
            {error ? <Text style={styles.error}>{error}</Text> : null}
          </ScrollView>
          {canAnswer ? (
            <View style={styles.inputRow}>
              <TextInput
                accessibilityLabel={
                  turn?.question ? tn("Deine Antwort", "Ihre Antwort") : tn("Dein Problem", "Ihr Problem")
                }
                editable={!busy}
                maxLength={2000}
                multiline
                onChangeText={setInput}
                placeholder={
                  turn?.question
                    ? tn("Deine Antwort …", "Ihre Antwort …")
                    : "z. B. Mein Laptop findet das WLAN nicht."
                }
                placeholderTextColor={colors.subtle}
                style={styles.input}
                value={input}
              />
              <Pressable
                accessibilityLabel="Senden"
                accessibilityRole="button"
                disabled={busy || !input.trim()}
                onPress={() => void send()}
                style={[
                  styles.sendButton,
                  (busy || !input.trim()) && styles.disabled,
                ]}
              >
                {busy ? (
                  <ActivityIndicator color={colors.onPrimary} size="small" />
                ) : (
                  <Ionicons color={colors.onPrimary} name="send" size={18} />
                )}
              </Pressable>
            </View>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const useStyles = makeThemedStyles((c) => ({
  modalRoot: {
    backgroundColor: c.overlay,
    flex: 1,
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: c.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    flexShrink: 1,
    gap: 12,
    maxHeight: "90%",
    padding: 20,
    paddingBottom: 28,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  headerCopy: { flex: 1 },
  eyebrow: {
    color: c.muted,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.9,
  },
  title: { color: c.foreground, fontSize: 21, fontWeight: "800", marginTop: 3 },
  closeButton: {
    alignItems: "center",
    backgroundColor: c.primarySoft,
    borderRadius: 16,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  content: { gap: 10, paddingBottom: 8 },
  note: { color: c.muted, fontSize: 13, lineHeight: 19 },
  bubble: { borderRadius: 16, maxWidth: "88%", padding: 11 },
  bubbleUser: { alignSelf: "flex-end", backgroundColor: c.primary },
  bubbleAssistant: {
    alignSelf: "flex-start",
    backgroundColor: c.surfaceSubtle,
    borderColor: c.border,
    borderWidth: 1,
  },
  bubbleUserText: { color: c.onPrimary, fontSize: 14, lineHeight: 20 },
  bubbleText: { color: c.text, fontSize: 14, lineHeight: 20 },
  result: { gap: 10 },
  reply: { color: c.text, fontSize: 14, lineHeight: 20 },
  article: {
    backgroundColor: c.surfaceSubtle,
    borderColor: c.border,
    borderRadius: 14,
    borderWidth: 1,
    gap: 6,
    padding: 12,
  },
  articleTitle: { color: c.foreground, fontSize: 15, fontWeight: "700" },
  articleActions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  secondaryButton: {
    alignItems: "center",
    backgroundColor: c.primarySoft,
    borderRadius: 12,
    flexDirection: "row",
    gap: 6,
    minHeight: 38,
    paddingHorizontal: 12,
  },
  secondaryButtonText: {
    color: c.primaryText,
    fontSize: 13,
    fontWeight: "800",
  },
  draft: {
    borderTopColor: c.border,
    borderTopWidth: 1,
    gap: 6,
    paddingTop: 10,
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: c.primary,
    borderRadius: 14,
    justifyContent: "center",
    minHeight: 46,
  },
  primaryButtonText: { color: c.onPrimary, fontSize: 15, fontWeight: "800" },
  error: { color: c.error, fontSize: 13, lineHeight: 19 },
  inputRow: { alignItems: "flex-end", flexDirection: "row", gap: 8 },
  input: {
    backgroundColor: c.surfaceSubtle,
    borderColor: c.border,
    borderRadius: 14,
    borderWidth: 1,
    color: c.foreground,
    flex: 1,
    fontSize: 15,
    maxHeight: 120,
    minHeight: 46,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  sendButton: {
    alignItems: "center",
    backgroundColor: c.primary,
    borderRadius: 23,
    height: 46,
    justifyContent: "center",
    width: 46,
  },
  disabled: { opacity: 0.5 },
}));
