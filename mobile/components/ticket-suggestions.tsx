import { Ionicons } from "@expo/vector-icons";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { hapticSelection } from "@/lib/mobile-haptics";
import {
  classificationSource,
  loadTicketSuggestions,
  recordSuggestionOutcome,
  suggestedTicketLabel,
  SUGGESTION_DEBOUNCE_MS,
  suggestionRequest,
  type ClassificationVote,
  type SuggestedArticle,
  type SuggestionMode,
  type TicketSuggestions,
} from "@/lib/mobile-ticket-suggestions";
import { makeThemedStyles, useAppColors } from "@/lib/themed-styles";

/**
 * Suggestions for the draft, requested with a debounce while typing.
 * Failures stay quiet: suggestions never block ticket creation.
 */
export function useMobileTicketSuggestions(input: {
  description: string;
  enabled: boolean;
  mode: SuggestionMode;
  subject: string;
  tenantId: string | null;
}): TicketSuggestions | null {
  // Results are kept with the request they answer, so an outdated or
  // cleared draft never shows suggestions for other text.
  const [result, setResult] = useState<{
    key: string;
    suggestions: TicketSuggestions | null;
  } | null>(null);
  const sequence = useRef(0);
  const request =
    input.enabled && input.tenantId
      ? suggestionRequest(
          input.tenantId,
          input.subject,
          input.description,
          input.mode,
        )
      : null;
  const key = request ? JSON.stringify(request) : "";

  useEffect(() => {
    const requestId = ++sequence.current;
    if (!key) return;
    const timer = setTimeout(() => {
      void loadTicketSuggestions(JSON.parse(key))
        .then((next) => {
          if (sequence.current === requestId)
            setResult({ key, suggestions: next });
        })
        .catch(() => {
          if (sequence.current === requestId)
            setResult({ key, suggestions: null });
        });
    }, SUGGESTION_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      sequence.current += 1;
    };
  }, [key]);

  return key && result?.key === key ? result.suggestions : null;
}

/**
 * Articles (up to three), the duplicate hint for own open tickets
 * (requesters) and similar solved tickets (agents). "Hat mein Problem gelöst"
 * records the article as deflected and leaves the screen without a ticket.
 */
export function TicketSuggestionList({
  disabled = false,
  onDeflected,
  onOpenArticle,
  onOpenTicket,
  subject,
  suggestions,
  tenantId,
}: {
  disabled?: boolean;
  onDeflected: () => void;
  onOpenArticle: (articleId: string) => void;
  onOpenTicket: (ticketId: string) => void;
  subject: string;
  suggestions: TicketSuggestions | null;
  tenantId: string;
}) {
  const styles = useStyles();
  const colors = useAppColors();
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [busyArticleId, setBusyArticleId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  if (!suggestions) return null;
  const requester = suggestions.mode === "requester";
  const articles = suggestions.articles.filter(
    (article) => !dismissed.includes(article.id),
  );
  const duplicates = requester ? suggestions.duplicates : [];
  const solved = requester ? [] : suggestions.solvedTickets;
  if (!articles.length && !duplicates.length && !solved.length && !notice)
    return null;

  async function markOutcome(
    article: SuggestedArticle,
    kind: "deflected" | "not_helpful",
  ) {
    if (busyArticleId) return;
    hapticSelection();
    setBusyArticleId(article.id);
    await recordSuggestionOutcome({
      tenantId,
      articleId: article.id,
      kind,
      subject,
    });
    setBusyArticleId(null);
    if (kind === "deflected") {
      onDeflected();
      return;
    }
    setDismissed((current) => [...current, article.id]);
    setNotice("Danke für die Rückmeldung.");
  }

  return (
    <View accessibilityLiveRegion="polite" style={styles.panel}>
      {duplicates.map((ticket) => (
        <Pressable
          accessibilityHint="Öffnet das bestehende Ticket"
          accessibilityRole="button"
          disabled={disabled}
          key={ticket.id}
          onPress={() => onOpenTicket(ticket.id)}
          style={styles.duplicate}
        >
          <Ionicons color={colors.warning} name="copy-outline" size={18} />
          <View style={styles.flex}>
            <Text style={styles.duplicateText}>
              Du hast dazu bereits ein offenes Ticket:
            </Text>
            <Text style={styles.ticketLabel}>
              {suggestedTicketLabel(ticket)}
              {ticket.statusLabel ? ` (${ticket.statusLabel})` : ""}
            </Text>
          </View>
          <Ionicons color={colors.muted} name="chevron-forward" size={16} />
        </Pressable>
      ))}

      {articles.length > 0 ? (
        <View style={styles.section}>
          <View style={styles.heading}>
            <Ionicons
              color={colors.primaryText}
              name="bulb-outline"
              size={18}
            />
            <Text style={styles.headingText}>
              {requester
                ? "Könnte dir das helfen?"
                : "Passende Artikel aus der Wissensdatenbank"}
            </Text>
          </View>
          {articles.map((article) => (
            <View key={article.id} style={styles.article}>
              <Pressable
                accessibilityHint="Öffnet den Wissensartikel"
                accessibilityRole="button"
                disabled={disabled}
                onPress={() => onOpenArticle(article.id)}
                style={styles.articleOpen}
              >
                <View style={styles.flex}>
                  <Text style={styles.articleTitle}>
                    {article.title}
                    {!requester && article.visibility === "internal"
                      ? "  · Intern"
                      : ""}
                  </Text>
                  {article.excerpt ? (
                    <Text numberOfLines={3} style={styles.articleExcerpt}>
                      {article.excerpt}
                    </Text>
                  ) : null}
                </View>
                <Ionicons
                  color={colors.muted}
                  name="chevron-forward"
                  size={16}
                />
              </Pressable>
              {requester ? (
                <View style={styles.articleActions}>
                  <Pressable
                    accessibilityRole="button"
                    disabled={disabled || busyArticleId !== null}
                    onPress={() => void markOutcome(article, "deflected")}
                    style={[
                      styles.solvedButton,
                      (disabled || busyArticleId !== null) && styles.disabled,
                    ]}
                  >
                    {busyArticleId === article.id ? (
                      <ActivityIndicator color={colors.success} size="small" />
                    ) : (
                      <Ionicons
                        color={colors.success}
                        name="checkmark-circle-outline"
                        size={16}
                      />
                    )}
                    <Text style={styles.solvedButtonText}>
                      Hat mein Problem gelöst
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    disabled={disabled || busyArticleId !== null}
                    hitSlop={8}
                    onPress={() => void markOutcome(article, "not_helpful")}
                  >
                    <Text style={styles.linkText}>Hilft nicht</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}
      {notice ? <Text style={styles.muted}>{notice}</Text> : null}

      {solved.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.headingText}>Ähnliche gelöste Tickets</Text>
          {solved.map((ticket) => (
            <Pressable
              accessibilityRole="button"
              disabled={disabled}
              hitSlop={4}
              key={ticket.id}
              onPress={() => onOpenTicket(ticket.id)}
            >
              <Text style={styles.linkText}>
                {suggestedTicketLabel(ticket)}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** "Vorschlag: Netzwerk (aus 4 ähnlichen Tickets) – übernehmen" */
export function ClassificationSuggestionButton({
  disabled = false,
  onApply,
  vote,
}: {
  disabled?: boolean;
  onApply: () => void;
  vote: ClassificationVote;
}) {
  const styles = useStyles();
  const colors = useAppColors();
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={() => {
        hapticSelection();
        onApply();
      }}
      style={styles.classification}
    >
      <Ionicons color={colors.primaryText} name="sparkles-outline" size={14} />
      <Text style={styles.classificationText}>
        Vorschlag: {vote.name} ({classificationSource(vote.matches)}) –
        übernehmen
      </Text>
    </Pressable>
  );
}

const useStyles = makeThemedStyles((c) => ({
  panel: {
    backgroundColor: c.surface,
    borderColor: c.primarySoftBorder,
    borderLeftColor: c.primary,
    borderLeftWidth: 3,
    borderRadius: 16,
    borderWidth: 1,
    gap: 12,
    padding: 14,
  },
  flex: { flex: 1, gap: 3 },
  section: { gap: 8 },
  heading: { alignItems: "center", flexDirection: "row", gap: 8 },
  headingText: { color: c.foreground, fontSize: 14, fontWeight: "800" },
  duplicate: {
    alignItems: "center",
    backgroundColor: c.warningSoft,
    borderColor: c.warningBorder,
    borderRadius: 13,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    padding: 11,
  },
  duplicateText: { color: c.foreground, fontSize: 13, lineHeight: 19 },
  ticketLabel: { color: c.foreground, fontSize: 13, fontWeight: "800" },
  article: {
    backgroundColor: c.surfaceSubtle,
    borderColor: c.border,
    borderRadius: 13,
    borderWidth: 1,
    gap: 8,
    padding: 11,
  },
  articleOpen: { alignItems: "center", flexDirection: "row", gap: 8 },
  articleTitle: { color: c.foreground, fontSize: 14, fontWeight: "800" },
  articleExcerpt: { color: c.muted, fontSize: 13, lineHeight: 19 },
  articleActions: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 14,
  },
  solvedButton: {
    alignItems: "center",
    backgroundColor: c.successSoft,
    borderColor: c.successBorder,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    minHeight: 36,
    paddingHorizontal: 12,
  },
  solvedButtonText: { color: c.success, fontSize: 13, fontWeight: "800" },
  linkText: { color: c.primaryText, fontSize: 13, fontWeight: "700" },
  muted: { color: c.muted, fontSize: 12, lineHeight: 18 },
  classification: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: c.primarySoft,
    borderRadius: 999,
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  classificationText: {
    color: c.primaryText,
    flexShrink: 1,
    fontSize: 12,
    fontWeight: "700",
  },
  disabled: { opacity: 0.55 },
}));
