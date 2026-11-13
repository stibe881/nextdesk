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
import { invokeNextDesk } from "@/lib/nextdesk-client";
import { useAppColors } from "@/lib/themed-styles";
import {
  feedbackCommentError,
  parseTicketFeedback,
  type TicketFeedback,
} from "@/lib/ticket-satisfaction-model";
import { tn } from "@/lib/formality";

type Props = {
  tenantId: string;
  ticketId: string;
  /** Reloads when the ticket changes (status, comments). */
  refreshKey: string;
};

/**
 * Star rating for a resolved or closed ticket. The requester can rate; other
 * people only see an existing rating. Without either the card stays hidden.
 */
export function TicketSatisfactionCard({
  tenantId,
  ticketId,
  refreshKey,
}: Props) {
  const colors = useAppColors();
  const [feedback, setFeedback] = useState<TicketFeedback | null>(null);
  const [score, setScore] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const version = useRef(0);

  const load = useCallback(async () => {
    const current = ++version.current;
    try {
      const next = parseTicketFeedback(
        await invokeNextDesk<unknown>("ticket-feedback", {
          type: "get",
          tenantId,
          ticketId,
        }),
      );
      if (version.current !== current) return;
      setFeedback(next);
      setScore(next.satisfaction?.score ?? null);
      setComment(next.satisfaction?.comment ?? "");
    } catch {
      // Feature off or no access: the screen omits the card.
      if (version.current === current) setFeedback(null);
    }
  }, [tenantId, ticketId]);

  useEffect(() => {
    if (!tenantId) return;
    const task = setTimeout(() => void load(), 0);
    return () => {
      clearTimeout(task);
      version.current += 1;
    };
  }, [load, refreshKey, tenantId]);

  async function save() {
    if (saving || score === null) return;
    const trimmed = comment.trim();
    const commentError = feedbackCommentError(trimmed);
    if (commentError) {
      setError(commentError);
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await invokeNextDesk<unknown>("ticket-feedback", {
        type: "submit",
        tenantId,
        ticketId,
        score,
        ...(trimmed ? { comment: trimmed } : {}),
      });
      hapticSuccess();
      setNotice(tn("Danke für deine Bewertung!", "Danke für Ihre Bewertung!"));
      await load();
    } catch {
      hapticError();
      setError(
        tn("Deine Bewertung konnte nicht gespeichert werden. Eine Bewertung lässt sich innerhalb von 14 Tagen einmal ändern.", "Ihre Bewertung konnte nicht gespeichert werden. Eine Bewertung lässt sich innerhalb von 14 Tagen einmal ändern."),
      );
    } finally {
      setSaving(false);
    }
  }

  if (!feedback || !feedback.isRatable) return null;
  const existing = feedback.satisfaction;
  if (!feedback.canRate && !existing?.score) return null;

  return (
    <View
      accessibilityLabel="Bewertung"
      style={[
        styles.card,
        { backgroundColor: colors.surface, borderColor: colors.border },
      ]}
    >
      <Text style={[styles.eyebrow, { color: colors.muted }]}>BEWERTUNG</Text>
      <Text style={[styles.title, { color: colors.foreground }]}>
        {feedback.canRate
          ? tn("Wie zufrieden bist du?", "Wie zufrieden sind Sie?")
          : "Bewertung der anfragenden Person"}
      </Text>

      <View
        accessibilityLabel="Bewertung von 1 bis 5 Sternen"
        accessibilityRole={feedback.canRate ? "radiogroup" : "image"}
        style={styles.stars}
      >
        {[1, 2, 3, 4, 5].map((value) => {
          const active = score !== null && value <= score;
          const icon = (
            <Ionicons
              color={active ? colors.warning : colors.subtle}
              name={active ? "star" : "star-outline"}
              size={30}
            />
          );
          return feedback.canRate ? (
            <Pressable
              accessibilityLabel={`${value} von 5 Sternen`}
              accessibilityRole="radio"
              accessibilityState={{ checked: score === value }}
              hitSlop={4}
              key={value}
              onPress={() => {
                setScore(value);
                setNotice("");
              }}
              style={styles.star}
            >
              {icon}
            </Pressable>
          ) : (
            <View key={value} style={styles.star}>
              {icon}
            </View>
          );
        })}
      </View>

      {feedback.canRate ? (
        <>
          <TextInput
            accessibilityLabel="Kommentar (optional)"
            maxLength={3000}
            multiline
            onChangeText={setComment}
            placeholder="Was war gut, was können wir besser machen? (optional)"
            placeholderTextColor={colors.muted}
            style={[
              styles.input,
              {
                backgroundColor: colors.surfaceSubtle,
                borderColor: colors.border,
                color: colors.foreground,
              },
            ]}
            value={comment}
          />
          <Pressable
            accessibilityRole="button"
            disabled={score === null || saving}
            onPress={() => void save()}
            style={[
              styles.button,
              { backgroundColor: colors.primary },
              (score === null || saving) && styles.disabled,
            ]}
          >
            {saving ? (
              <ActivityIndicator color={colors.onPrimary} />
            ) : (
              <Text style={[styles.buttonText, { color: colors.onPrimary }]}>
                {existing ? "Bewertung ändern" : "Bewertung senden"}
              </Text>
            )}
          </Pressable>
          {existing ? (
            <Text style={[styles.hint, { color: colors.muted }]}>
              Eine Bewertung kann innerhalb von 14 Tagen einmal geändert werden.
            </Text>
          ) : null}
        </>
      ) : existing?.comment ? (
        <Text style={[styles.text, { color: colors.text }]}>
          {existing.comment}
        </Text>
      ) : null}

      {notice ? (
        <Text
          accessibilityLiveRegion="polite"
          style={[styles.hint, { color: colors.success }]}
        >
          {notice}
        </Text>
      ) : null}
      {error ? (
        <Text
          accessibilityLiveRegion="polite"
          style={[styles.hint, { color: colors.error }]}
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: 1, gap: 10, padding: 16 },
  eyebrow: { fontSize: 11, fontWeight: "700", letterSpacing: 1 },
  title: { fontSize: 18, fontWeight: "700" },
  stars: { flexDirection: "row", gap: 6 },
  star: {
    alignItems: "center",
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  input: {
    borderRadius: 12,
    borderWidth: 1,
    fontSize: 15,
    minHeight: 84,
    padding: 12,
    textAlignVertical: "top",
  },
  button: {
    alignItems: "center",
    alignSelf: "flex-start",
    borderRadius: 10,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 16,
  },
  buttonText: { fontSize: 15, fontWeight: "700" },
  disabled: { opacity: 0.5 },
  hint: { fontSize: 13, lineHeight: 18 },
  text: { fontSize: 14, lineHeight: 20 },
});
