import { Ionicons } from "@expo/vector-icons";
import { Pressable, Text, TextInput, View } from "react-native";

import {
  type MobileTicketComment,
  type TicketCommentVisibility,
} from "@/lib/nextdesk-tickets";
import { makeThemedStyles, useAppColors } from "@/lib/themed-styles";

type TicketConversationProps = {
  body: string;
  canCommentExternal: boolean;
  canWriteInternalNotes: boolean;
  comments: MobileTicketComment[];
  draftState: "idle" | "local" | "saving" | "synced";
  isSending: boolean;
  onBodyChange: (body: string) => void;
  onSend: () => void;
  onVisibilityChange: (visibility: TicketCommentVisibility) => void;
  visibility: TicketCommentVisibility;
};

type MessageDirection = "incoming" | "internal" | "outgoing";

function messageDirection(comment: MobileTicketComment): MessageDirection {
  if (comment.visibility === "internal" || comment.authorKind === "internal") {
    return "internal";
  }
  return comment.authorKind === "customer" ? "incoming" : "outgoing";
}

function messageTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Zeitpunkt unbekannt";
  return new Intl.DateTimeFormat("de-CH", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function messageDay(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Verlauf";
  return new Intl.DateTimeFormat("de-CH", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(date);
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "N";
  return words
    .slice(0, 2)
    .map((word) => word.slice(0, 1).toLocaleUpperCase("de-CH"))
    .join("");
}

function messageLabel(direction: MessageDirection): string {
  if (direction === "internal") return "Intern";
  return direction === "incoming" ? "Kundschaft" : "Antwort";
}

function draftStatusLabel(
  state: TicketConversationProps["draftState"],
): string | null {
  if (state === "saving") return "Entwurf wird gesichert …";
  if (state === "synced") return "Entwurf sicher gespeichert";
  if (state === "local") return "Entwurf nur auf diesem Gerät gesichert";
  return null;
}

export function TicketConversation({
  body,
  canCommentExternal,
  canWriteInternalNotes,
  comments,
  draftState,
  isSending,
  onBodyChange,
  onSend,
  onVisibilityChange,
  visibility,
}: TicketConversationProps) {
  const colors = useAppColors();
  const styles = useStyles();
  const canWrite = canWriteInternalNotes || canCommentExternal;
  const externalOnly = canCommentExternal && !canWriteInternalNotes;
  const externalHint =
    visibility === "external"
      ? "Für die Kundschaft sichtbar"
      : "Nur für berechtigte Mitarbeitende sichtbar";
  const draftLabel = draftStatusLabel(draftState);

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View>
          <Text style={styles.eyebrow}>KOMMUNIKATION</Text>
          <Text style={styles.title}>Nachrichten</Text>
        </View>
        <View style={styles.countBadge}>
          <Ionicons
            color={colors.primaryText}
            name="chatbubble-outline"
            size={14}
          />
          <Text style={styles.count}>{comments.length}</Text>
        </View>
      </View>

      {comments.length === 0 ? (
        <View style={styles.empty}>
          <View style={styles.emptyIcon}>
            <Ionicons
              color={colors.primaryText}
              name="chatbubble-ellipses-outline"
              size={22}
            />
          </View>
          <View style={styles.emptyCopy}>
            <Text style={styles.emptyTitle}>Noch keine Nachricht</Text>
            <Text style={styles.emptyText}>
              Starten Sie die Kommunikation direkt über das Eingabefeld.
            </Text>
          </View>
        </View>
      ) : (
        <View style={styles.messages}>
          {comments.map((comment, index) => {
            const direction = messageDirection(comment);
            const previousComment = comments[index - 1];
            const isNewDay =
              !previousComment ||
              messageDay(previousComment.createdAt) !==
                messageDay(comment.createdAt);
            const isOutgoing = direction === "outgoing";
            const isInternal = direction === "internal";
            const authorName = comment.authorName || "nextDesk Benutzer";
            return (
              <View key={comment.id} style={styles.messageBlock}>
                {isNewDay ? (
                  <View style={styles.dayDivider}>
                    <View style={styles.dayLine} />
                    <Text style={styles.dayLabel}>
                      {messageDay(comment.createdAt)}
                    </Text>
                    <View style={styles.dayLine} />
                  </View>
                ) : null}
                {isInternal ? (
                  <View style={styles.internalNote}>
                    <View style={styles.internalHeader}>
                      <Ionicons
                        color={colors.warning}
                        name="lock-closed"
                        size={13}
                      />
                      <Text style={styles.internalLabel}>Interne Notiz</Text>
                    </View>
                    <Text style={styles.internalBody}>{comment.body}</Text>
                    <Text style={styles.internalMeta}>
                      {authorName} · {messageTimestamp(comment.createdAt)}
                    </Text>
                  </View>
                ) : (
                  <View
                    style={[
                      styles.messageRow,
                      isOutgoing
                        ? styles.messageRowOutgoing
                        : styles.messageRowIncoming,
                    ]}
                  >
                    {!isOutgoing ? (
                      <View style={[styles.avatar, styles.avatarIncoming]}>
                        <Text style={styles.avatarText}>
                          {initials(authorName)}
                        </Text>
                      </View>
                    ) : null}
                    <View
                      style={[
                        styles.bubble,
                        isOutgoing
                          ? styles.bubbleOutgoing
                          : styles.bubbleIncoming,
                      ]}
                    >
                      <View style={styles.bubbleLabelRow}>
                        <Text
                          style={[
                            styles.bubbleLabel,
                            isOutgoing && styles.bubbleLabelOutgoing,
                          ]}
                        >
                          {messageLabel(direction)}
                        </Text>
                      </View>
                      <Text
                        style={[
                          styles.messageBody,
                          isOutgoing && styles.messageBodyOutgoing,
                        ]}
                      >
                        {comment.body}
                      </Text>
                      <View style={styles.messageFooter}>
                        <Text
                          numberOfLines={1}
                          style={[
                            styles.author,
                            isOutgoing && styles.authorOutgoing,
                          ]}
                        >
                          {authorName}
                        </Text>
                        <Text
                          style={[
                            styles.timestamp,
                            isOutgoing && styles.timestampOutgoing,
                          ]}
                        >
                          {messageTimestamp(comment.createdAt)}
                        </Text>
                      </View>
                    </View>
                    {isOutgoing ? (
                      <View style={[styles.avatar, styles.avatarOutgoing]}>
                        <Text style={styles.avatarTextOutgoing}>
                          {initials(authorName)}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                )}
              </View>
            );
          })}
        </View>
      )}

      {canWrite ? (
        <View style={styles.composer}>
          <View style={styles.composerHeader}>
            <View>
              <Text style={styles.composerLabel}>NEUE NACHRICHT</Text>
              <Text style={styles.composerTitle}>
                {externalOnly ? "Antwort an Kundschaft" : "Antwort verfassen"}
              </Text>
            </View>
            {visibility === "internal" ? (
              <Ionicons color={colors.warning} name="lock-closed" size={18} />
            ) : (
              <Ionicons
                color={colors.primaryText}
                name="paper-plane-outline"
                size={19}
              />
            )}
          </View>
          {canWriteInternalNotes && canCommentExternal ? (
            <View style={styles.visibilityToggle}>
              <Pressable
                accessibilityRole="button"
                onPress={() => onVisibilityChange("internal")}
                style={[
                  styles.visibilityButton,
                  visibility === "internal" &&
                    styles.visibilityButtonInternalActive,
                ]}
              >
                <Ionicons
                  color={
                    visibility === "internal"
                      ? colors.onPrimary
                      : colors.warning
                  }
                  name="lock-closed-outline"
                  size={15}
                />
                <Text
                  style={[
                    styles.visibilityButtonText,
                    visibility === "internal" &&
                      styles.visibilityButtonTextActive,
                  ]}
                >
                  Intern
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => onVisibilityChange("external")}
                style={[
                  styles.visibilityButton,
                  visibility === "external" &&
                    styles.visibilityButtonExternalActive,
                ]}
              >
                <Ionicons
                  color={
                    visibility === "external"
                      ? colors.onPrimary
                      : colors.primaryText
                  }
                  name="paper-plane-outline"
                  size={15}
                />
                <Text
                  style={[
                    styles.visibilityButtonText,
                    visibility === "external" &&
                      styles.visibilityButtonTextActive,
                  ]}
                >
                  Extern
                </Text>
              </Pressable>
            </View>
          ) : null}
          <TextInput
            autoCapitalize="sentences"
            editable={!isSending}
            maxLength={50_000}
            multiline
            onChangeText={onBodyChange}
            placeholder={
              visibility === "internal"
                ? "Interne Notiz für das Team schreiben …"
                : "Nachricht an die Kundschaft schreiben …"
            }
            placeholderTextColor={colors.subtle}
            style={styles.composerInput}
            textAlignVertical="top"
            value={body}
          />
          <View style={styles.composerFooter}>
            <View style={styles.composerHints}>
              <Text style={styles.visibilityHint}>{externalHint}</Text>
              {draftLabel ? (
                <Text
                  style={[
                    styles.draftHint,
                    draftState === "local" && styles.draftHintLocal,
                  ]}
                >
                  {draftLabel}
                </Text>
              ) : null}
            </View>
            <Pressable
              accessibilityLabel="Nachricht senden"
              accessibilityRole="button"
              disabled={isSending || !body.trim()}
              onPress={onSend}
              style={[
                styles.sendButton,
                (isSending || !body.trim()) && styles.disabled,
              ]}
            >
              <Ionicons color={colors.onPrimary} name="send" size={15} />
              <Text style={styles.sendButtonText}>
                {isSending ? "Sendet …" : "Senden"}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={styles.readOnly}>
          <Ionicons color={colors.muted} name="lock-closed-outline" size={16} />
          <Text style={styles.readOnlyHint}>
            Für dieses Ticket steht Ihnen nur der Lesezugriff zur Verfügung.
          </Text>
        </View>
      )}
    </View>
  );
}

const useStyles = makeThemedStyles((c) => ({
  section: { gap: 16 },
  sectionHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 2,
  },
  eyebrow: {
    color: c.muted,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.05,
  },
  title: { color: c.foreground, fontSize: 23, fontWeight: "800", marginTop: 4 },
  countBadge: {
    alignItems: "center",
    backgroundColor: c.primarySoft,
    borderRadius: 15,
    flexDirection: "row",
    gap: 6,
    minHeight: 30,
    paddingHorizontal: 10,
  },
  count: { color: c.primaryText, fontSize: 12, fontWeight: "800" },
  empty: {
    alignItems: "center",
    backgroundColor: c.surface,
    borderColor: c.border,
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    padding: 16,
  },
  emptyIcon: {
    alignItems: "center",
    backgroundColor: c.primarySoft,
    borderRadius: 15,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  emptyCopy: { flex: 1, gap: 3 },
  emptyTitle: { color: c.foreground, fontSize: 14, fontWeight: "800" },
  emptyText: { color: c.muted, fontSize: 12, lineHeight: 17 },
  messages: { gap: 12 },
  messageBlock: { gap: 9 },
  dayDivider: {
    alignItems: "center",
    flexDirection: "row",
    gap: 9,
    marginTop: 2,
  },
  dayLine: { backgroundColor: c.border, flex: 1, height: 1 },
  dayLabel: { color: c.subtle, fontSize: 10, fontWeight: "700" },
  messageRow: { alignItems: "flex-end", flexDirection: "row", gap: 8 },
  messageRowIncoming: { justifyContent: "flex-start" },
  messageRowOutgoing: {
    flexDirection: "row-reverse",
    justifyContent: "flex-start",
  },
  avatar: {
    alignItems: "center",
    borderRadius: 15,
    height: 30,
    justifyContent: "center",
    width: 30,
  },
  avatarIncoming: { backgroundColor: c.infoSoft },
  avatarOutgoing: { backgroundColor: c.primarySoft },
  avatarText: { color: c.info, fontSize: 10, fontWeight: "900" },
  avatarTextOutgoing: { color: c.primaryText, fontSize: 10, fontWeight: "900" },
  bubble: { borderRadius: 18, maxWidth: "78%", padding: 13 },
  bubbleIncoming: { backgroundColor: c.infoSoft, borderBottomLeftRadius: 5 },
  bubbleOutgoing: { backgroundColor: c.primary, borderBottomRightRadius: 5 },
  bubbleLabelRow: { marginBottom: 5 },
  bubbleLabel: {
    color: c.info,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.45,
    textTransform: "uppercase",
  },
  bubbleLabelOutgoing: { color: c.onPrimary },
  messageBody: { color: c.text, fontSize: 15, lineHeight: 22 },
  messageBodyOutgoing: { color: c.onPrimary },
  messageFooter: {
    alignItems: "center",
    flexDirection: "row",
    gap: 7,
    justifyContent: "space-between",
    marginTop: 9,
  },
  author: { color: c.info, flex: 1, fontSize: 10, fontWeight: "800" },
  authorOutgoing: { color: c.onPrimary },
  timestamp: { color: c.info, fontSize: 10, fontWeight: "600" },
  timestampOutgoing: { color: c.onPrimary },
  internalNote: {
    alignSelf: "center",
    backgroundColor: c.warningSoft,
    borderColor: c.warningBorder,
    borderRadius: 14,
    borderWidth: 1,
    gap: 7,
    maxWidth: "94%",
    padding: 12,
  },
  internalHeader: { alignItems: "center", flexDirection: "row", gap: 6 },
  internalLabel: {
    color: c.warning,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  internalBody: { color: c.warning, fontSize: 14, lineHeight: 20 },
  internalMeta: { color: c.warning, fontSize: 10, fontWeight: "600" },
  composer: {
    backgroundColor: c.surface,
    borderColor: c.primarySoftBorder,
    borderRadius: 20,
    borderWidth: 1,
    gap: 12,
    padding: 14,
    shadowColor: c.shadow,
    shadowOffset: { width: 0, height: 7 },
    shadowOpacity: 0.06,
    shadowRadius: 16,
  },
  composerHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  composerLabel: {
    color: c.muted,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1,
  },
  composerTitle: {
    color: c.foreground,
    fontSize: 15,
    fontWeight: "800",
    marginTop: 3,
  },
  visibilityToggle: { flexDirection: "row", gap: 8 },
  visibilityButton: {
    alignItems: "center",
    backgroundColor: c.surface,
    borderColor: c.primarySoftBorder,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    minHeight: 37,
    paddingHorizontal: 11,
  },
  visibilityButtonInternalActive: {
    backgroundColor: c.warningStrong,
    borderColor: c.warningStrong,
  },
  visibilityButtonExternalActive: {
    backgroundColor: c.primary,
    borderColor: c.primary,
  },
  visibilityButtonText: {
    color: c.primaryText,
    fontSize: 12,
    fontWeight: "800",
  },
  visibilityButtonTextActive: { color: c.onPrimary },
  composerInput: {
    backgroundColor: c.surfaceSubtle,
    borderColor: c.borderStrong,
    borderRadius: 14,
    borderWidth: 1,
    color: c.foreground,
    fontSize: 15,
    lineHeight: 21,
    minHeight: 96,
    padding: 12,
  },
  composerFooter: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
  },
  composerHints: { flex: 1, gap: 2 },
  visibilityHint: { color: c.muted, flex: 1, fontSize: 10, lineHeight: 14 },
  draftHint: {
    color: c.success,
    fontSize: 10,
    fontWeight: "700",
    lineHeight: 14,
  },
  draftHintLocal: { color: c.warning },
  sendButton: {
    alignItems: "center",
    backgroundColor: c.primary,
    borderRadius: 12,
    flexDirection: "row",
    gap: 6,
    justifyContent: "center",
    minHeight: 40,
    paddingHorizontal: 12,
  },
  sendButtonText: { color: c.onPrimary, fontSize: 12, fontWeight: "900" },
  readOnly: {
    alignItems: "center",
    backgroundColor: c.surfaceSubtle,
    borderRadius: 14,
    flexDirection: "row",
    gap: 9,
    padding: 13,
  },
  readOnlyHint: { color: c.muted, flex: 1, fontSize: 12, lineHeight: 17 },
  disabled: { opacity: 0.5 },
}));
