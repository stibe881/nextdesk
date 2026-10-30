import { Ionicons } from "@expo/vector-icons";
import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";

import { hapticSelection } from "@/lib/mobile-haptics";
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

type MessageGroup = {
  key: string;
  dayKey: string;
  dayLabel: string;
  showDay: boolean;
  direction: MessageDirection;
  authorName: string;
  items: MobileTicketComment[];
};

// Nachrichten derselben Person innerhalb dieses Zeitfensters werden wie in
// Messenger-Apps zu einer Gruppe zusammengefasst (Name und Avatar nur einmal).
const GROUP_WINDOW_MS = 5 * 60 * 1000;

function messageDirection(comment: MobileTicketComment): MessageDirection {
  if (comment.visibility === "internal" || comment.authorKind === "internal") {
    return "internal";
  }
  return comment.authorKind === "customer" ? "incoming" : "outgoing";
}

function toDate(value: string): Date | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function messageTime(value: string): string {
  const date = toDate(value);
  if (!date) return "–";
  return new Intl.DateTimeFormat("de-CH", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function dayKey(value: string): string {
  const date = toDate(value);
  if (!date) return "unbekannt";
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function dayLabel(value: string): string {
  const date = toDate(value);
  if (!date) return "Verlauf";
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (left: Date, right: Date) =>
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate();
  if (sameDay(date, today)) return "Heute";
  if (sameDay(date, yesterday)) return "Gestern";
  return new Intl.DateTimeFormat("de-CH", {
    weekday: "short",
    day: "numeric",
    month: "long",
    ...(date.getFullYear() === today.getFullYear()
      ? {}
      : { year: "numeric" as const }),
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

function draftStatusLabel(
  state: TicketConversationProps["draftState"],
): string | null {
  if (state === "saving") return "Entwurf wird gesichert …";
  if (state === "synced") return "Entwurf gespeichert";
  if (state === "local") return "Entwurf nur auf diesem Gerät";
  return null;
}

function buildGroups(comments: MobileTicketComment[]): MessageGroup[] {
  const groups: MessageGroup[] = [];
  let previousDay: string | null = null;
  for (const comment of comments) {
    const direction = messageDirection(comment);
    const authorName = comment.authorName || "nextDesk Benutzer";
    const currentDay = dayKey(comment.createdAt);
    const last = groups[groups.length - 1];
    const lastItem = last?.items[last.items.length - 1];
    const lastTime = lastItem ? toDate(lastItem.createdAt)?.getTime() : null;
    const currentTime = toDate(comment.createdAt)?.getTime();
    const continuesGroup =
      last !== undefined &&
      last.direction === direction &&
      last.authorName === authorName &&
      last.dayKey === currentDay &&
      typeof lastTime === "number" &&
      typeof currentTime === "number" &&
      currentTime - lastTime <= GROUP_WINDOW_MS;
    if (continuesGroup) {
      last.items.push(comment);
    } else {
      groups.push({
        key: comment.id,
        dayKey: currentDay,
        dayLabel: dayLabel(comment.createdAt),
        showDay: currentDay !== previousDay,
        direction,
        authorName,
        items: [comment],
      });
    }
    previousDay = currentDay;
  }
  return groups;
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
  const canChooseVisibility = canWriteInternalNotes && canCommentExternal;
  const isInternalDraft = visibility === "internal";
  const draftLabel = draftStatusLabel(draftState);
  const sendDisabled = isSending || !body.trim();
  const groups = buildGroups(comments);
  const countLabel =
    comments.length === 1 ? "1 Nachricht" : `${comments.length} Nachrichten`;

  const chooseVisibility = (next: TicketCommentVisibility) => {
    if (next === visibility) return;
    hapticSelection();
    onVisibilityChange(next);
  };

  return (
    <View style={styles.chat}>
      <View style={styles.header}>
        <View style={styles.headerIcon}>
          <Ionicons
            color={colors.primaryText}
            name="chatbubbles-outline"
            size={18}
          />
        </View>
        <View style={styles.headerCopy}>
          <Text style={styles.headerTitle}>Unterhaltung</Text>
          <Text style={styles.headerSubtitle}>{countLabel}</Text>
        </View>
      </View>

      <View style={styles.thread}>
        {groups.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons
              color={colors.subtle}
              name="chatbubble-ellipses-outline"
              size={26}
            />
            <Text style={styles.emptyTitle}>Noch keine Nachrichten</Text>
            <Text style={styles.emptyText}>
              Die Unterhaltung beginnt mit der ersten Nachricht.
            </Text>
          </View>
        ) : (
          groups.map((group) => (
            <View key={group.key} style={styles.groupBlock}>
              {group.showDay ? (
                <View style={styles.dayChipRow}>
                  <View style={styles.dayChip}>
                    <Text style={styles.dayChipText}>{group.dayLabel}</Text>
                  </View>
                </View>
              ) : null}
              {group.direction === "internal" ? (
                <InternalGroup group={group} />
              ) : (
                <BubbleGroup group={group} />
              )}
            </View>
          ))
        )}
      </View>

      {canWrite ? (
        <View style={styles.composer}>
          {canChooseVisibility ? (
            <View accessibilityRole="tablist" style={styles.segmentTrack}>
              <Pressable
                accessibilityLabel="Externe Antwort an die anfragende Person"
                accessibilityRole="tab"
                accessibilityState={{ selected: !isInternalDraft }}
                hitSlop={4}
                onPress={() => chooseVisibility("external")}
                style={[
                  styles.segment,
                  !isInternalDraft && styles.segmentActive,
                ]}
              >
                <Ionicons
                  color={!isInternalDraft ? colors.primaryText : colors.muted}
                  name="paper-plane-outline"
                  size={14}
                />
                <Text
                  style={[
                    styles.segmentText,
                    !isInternalDraft && styles.segmentTextExternal,
                  ]}
                >
                  Extern
                </Text>
              </Pressable>
              <Pressable
                accessibilityLabel="Interne Notiz für das Team"
                accessibilityRole="tab"
                accessibilityState={{ selected: isInternalDraft }}
                hitSlop={4}
                onPress={() => chooseVisibility("internal")}
                style={[
                  styles.segment,
                  isInternalDraft && styles.segmentActive,
                ]}
              >
                <Ionicons
                  color={isInternalDraft ? colors.warning : colors.muted}
                  name="lock-closed-outline"
                  size={14}
                />
                <Text
                  style={[
                    styles.segmentText,
                    isInternalDraft && styles.segmentTextInternal,
                  ]}
                >
                  Intern
                </Text>
              </Pressable>
            </View>
          ) : null}

          <View style={styles.inputRow}>
            <TextInput
              accessibilityLabel={
                isInternalDraft ? "Interne Notiz" : "Nachricht"
              }
              autoCapitalize="sentences"
              editable={!isSending}
              maxLength={50_000}
              multiline
              onChangeText={onBodyChange}
              placeholder={
                isInternalDraft
                  ? "Interne Notiz schreiben …"
                  : "Nachricht schreiben …"
              }
              placeholderTextColor={colors.subtle}
              scrollEnabled
              style={[styles.input, isInternalDraft && styles.inputInternal]}
              textAlignVertical="top"
              value={body}
            />
            <Pressable
              accessibilityLabel={
                isInternalDraft ? "Interne Notiz speichern" : "Nachricht senden"
              }
              accessibilityRole="button"
              accessibilityState={{ disabled: sendDisabled, busy: isSending }}
              disabled={sendDisabled}
              onPress={onSend}
              style={[
                styles.sendButton,
                isInternalDraft && styles.sendButtonInternal,
                sendDisabled && styles.sendButtonDisabled,
              ]}
            >
              {isSending ? (
                <ActivityIndicator
                  color={
                    isInternalDraft ? colors.onWarningStrong : colors.onPrimary
                  }
                  size="small"
                />
              ) : (
                <Ionicons
                  color={
                    isInternalDraft ? colors.onWarningStrong : colors.onPrimary
                  }
                  name="send"
                  size={18}
                />
              )}
            </Pressable>
          </View>

          <View style={styles.composerMeta}>
            <View style={styles.composerHint}>
              <Ionicons
                color={isInternalDraft ? colors.warning : colors.muted}
                name={isInternalDraft ? "lock-closed" : "eye-outline"}
                size={12}
              />
              <Text
                style={[
                  styles.composerHintText,
                  isInternalDraft && styles.composerHintInternal,
                ]}
              >
                {isInternalDraft
                  ? "Nur für Mitarbeitende sichtbar"
                  : "Für die anfragende Person sichtbar"}
              </Text>
            </View>
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
        </View>
      ) : (
        <View style={styles.readOnly}>
          <Ionicons color={colors.muted} name="lock-closed-outline" size={15} />
          <Text style={styles.readOnlyHint}>
            Für dieses Ticket besteht nur Lesezugriff.
          </Text>
        </View>
      )}
    </View>
  );
}

function BubbleGroup({ group }: { group: MessageGroup }) {
  const colors = useAppColors();
  const styles = useStyles();
  const isOutgoing = group.direction === "outgoing";
  return (
    <View
      style={[
        styles.bubbleGroup,
        isOutgoing ? styles.bubbleGroupOutgoing : styles.bubbleGroupIncoming,
      ]}
    >
      <Text
        numberOfLines={1}
        style={[
          styles.groupAuthor,
          isOutgoing ? styles.groupAuthorOutgoing : styles.groupAuthorIncoming,
        ]}
      >
        {group.authorName}
      </Text>
      {group.items.map((comment, index) => {
        const isFirst = index === 0;
        const isLast = index === group.items.length - 1;
        const viaEmail = comment.channel === "email";
        const delivery =
          isOutgoing && comment.emailDelivery ? comment.emailDelivery : null;
        const metaColor = isOutgoing ? colors.onPrimary : colors.muted;
        return (
          <View key={comment.id} style={styles.bubbleWrap}>
            <View
              style={[styles.bubbleRow, isOutgoing && styles.bubbleRowOutgoing]}
            >
              {!isOutgoing ? (
                isLast ? (
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>
                      {initials(group.authorName)}
                    </Text>
                  </View>
                ) : (
                  <View style={styles.avatarSpacer} />
                )
              ) : null}
              <View
                accessible
                accessibilityLabel={`${group.authorName}, ${messageTime(
                  comment.createdAt,
                )}${viaEmail ? ", per E-Mail" : ""}: ${comment.body}`}
                style={[
                  styles.bubble,
                  isOutgoing ? styles.bubbleOutgoing : styles.bubbleIncoming,
                  isFirst &&
                    (isOutgoing
                      ? styles.bubbleTailOutgoing
                      : styles.bubbleTailIncoming),
                ]}
              >
                <Text
                  selectable
                  style={[
                    styles.bubbleText,
                    isOutgoing && styles.bubbleTextOutgoing,
                  ]}
                >
                  {comment.body}
                </Text>
                <View style={styles.bubbleMeta}>
                  {viaEmail ? (
                    <Ionicons color={metaColor} name="mail-outline" size={11} />
                  ) : null}
                  <Text
                    style={[
                      styles.bubbleTime,
                      isOutgoing && styles.bubbleTimeOutgoing,
                    ]}
                  >
                    {messageTime(comment.createdAt)}
                  </Text>
                  {delivery === "pending" ? (
                    <Ionicons color={metaColor} name="time-outline" size={12} />
                  ) : delivery === "sent" ? (
                    <Ionicons
                      color={metaColor}
                      name="checkmark-done"
                      size={13}
                    />
                  ) : delivery === "failed" ? (
                    <Ionicons
                      color={metaColor}
                      name="alert-circle-outline"
                      size={13}
                    />
                  ) : null}
                </View>
              </View>
            </View>
            {delivery === "failed" ? (
              <Text style={styles.deliveryFailed}>
                E-Mail konnte nicht zugestellt werden
              </Text>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

function InternalGroup({ group }: { group: MessageGroup }) {
  const colors = useAppColors();
  const styles = useStyles();
  return (
    <View style={styles.internalGroup}>
      {group.items.map((comment, index) => (
        <View
          accessible
          accessibilityLabel={`Interne Notiz von ${group.authorName}, ${messageTime(
            comment.createdAt,
          )}: ${comment.body}`}
          key={comment.id}
          style={styles.internalNote}
        >
          {index === 0 ? (
            <View style={styles.internalHeader}>
              <Ionicons color={colors.warning} name="lock-closed" size={11} />
              <Text numberOfLines={1} style={styles.internalLabel}>
                Interne Notiz · {group.authorName}
              </Text>
            </View>
          ) : null}
          <Text selectable style={styles.internalBody}>
            {comment.body}
          </Text>
          <Text style={styles.internalTime}>
            {messageTime(comment.createdAt)}
          </Text>
        </View>
      ))}
    </View>
  );
}

const useStyles = makeThemedStyles((c) => ({
  chat: {
    backgroundColor: c.surface,
    borderColor: c.border,
    borderRadius: 22,
    borderWidth: 1,
    overflow: "hidden",
  },
  header: {
    alignItems: "center",
    borderBottomColor: c.border,
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  headerIcon: {
    alignItems: "center",
    backgroundColor: c.primarySoft,
    borderRadius: 17,
    height: 34,
    justifyContent: "center",
    width: 34,
  },
  headerCopy: { flex: 1 },
  headerTitle: { color: c.foreground, fontSize: 16, fontWeight: "800" },
  headerSubtitle: { color: c.muted, fontSize: 12, marginTop: 1 },
  thread: {
    backgroundColor: c.surfaceSubtle,
    gap: 10,
    minHeight: 120,
    paddingHorizontal: 10,
    paddingVertical: 12,
  },
  empty: {
    alignItems: "center",
    gap: 4,
    justifyContent: "center",
    paddingVertical: 22,
  },
  emptyTitle: {
    color: c.foreground,
    fontSize: 14,
    fontWeight: "700",
    marginTop: 4,
  },
  emptyText: { color: c.muted, fontSize: 12, textAlign: "center" },
  groupBlock: { gap: 8 },
  dayChipRow: { alignItems: "center", marginVertical: 2 },
  dayChip: {
    backgroundColor: c.surface,
    borderColor: c.border,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  dayChipText: { color: c.muted, fontSize: 11, fontWeight: "700" },
  bubbleGroup: { gap: 3 },
  bubbleGroupIncoming: { alignItems: "flex-start" },
  bubbleGroupOutgoing: { alignItems: "flex-end" },
  groupAuthor: { fontSize: 11, fontWeight: "700", maxWidth: "80%" },
  groupAuthorIncoming: { color: c.info, marginLeft: 36 },
  groupAuthorOutgoing: { color: c.muted, marginRight: 4 },
  // Full width gives the percentage max width of the bubble a fixed reference;
  // a shrink-wrapped wrapper made long messages wrap too late and get clipped.
  bubbleWrap: { gap: 2, width: "100%" },
  bubbleRow: { alignItems: "flex-end", flexDirection: "row", gap: 6 },
  bubbleRowOutgoing: { justifyContent: "flex-end" },
  avatar: {
    alignItems: "center",
    backgroundColor: c.infoSoft,
    borderRadius: 14,
    height: 28,
    justifyContent: "center",
    width: 28,
  },
  avatarSpacer: { width: 28 },
  avatarText: { color: c.info, fontSize: 10, fontWeight: "900" },
  bubble: {
    borderRadius: 18,
    flexShrink: 1,
    maxWidth: "80%",
    paddingBottom: 6,
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  bubbleIncoming: {
    backgroundColor: c.surface,
    borderColor: c.border,
    borderWidth: 1,
  },
  bubbleOutgoing: { backgroundColor: c.primary },
  bubbleTailIncoming: { borderTopLeftRadius: 5 },
  bubbleTailOutgoing: { borderTopRightRadius: 5 },
  bubbleText: { color: c.foreground, fontSize: 15, lineHeight: 21 },
  bubbleTextOutgoing: { color: c.onPrimary },
  bubbleMeta: {
    alignItems: "center",
    alignSelf: "flex-end",
    flexDirection: "row",
    gap: 3,
    marginTop: 2,
  },
  bubbleTime: { color: c.muted, fontSize: 11 },
  bubbleTimeOutgoing: { color: c.onPrimary, opacity: 0.85 },
  deliveryFailed: {
    alignSelf: "flex-end",
    color: c.error,
    fontSize: 11,
    fontWeight: "600",
    marginRight: 4,
  },
  internalGroup: { alignItems: "center", gap: 4 },
  internalNote: {
    backgroundColor: c.warningSoft,
    borderColor: c.warningBorder,
    borderRadius: 14,
    borderWidth: 1,
    gap: 3,
    maxWidth: "90%",
    minWidth: "55%",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  internalHeader: { alignItems: "center", flexDirection: "row", gap: 5 },
  internalLabel: {
    color: c.warning,
    flexShrink: 1,
    fontSize: 11,
    fontWeight: "800",
  },
  internalBody: { color: c.foreground, fontSize: 14, lineHeight: 20 },
  internalTime: { alignSelf: "flex-end", color: c.warning, fontSize: 11 },
  composer: {
    backgroundColor: c.surface,
    borderTopColor: c.border,
    borderTopWidth: 1,
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  segmentTrack: {
    alignSelf: "flex-start",
    backgroundColor: c.surfaceSubtle,
    borderColor: c.border,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    padding: 3,
  },
  segment: {
    alignItems: "center",
    borderRadius: 9,
    flexDirection: "row",
    gap: 5,
    justifyContent: "center",
    minHeight: 32,
    paddingHorizontal: 14,
  },
  segmentActive: {
    backgroundColor: c.surface,
    shadowColor: c.shadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.12,
    shadowRadius: 3,
  },
  segmentText: { color: c.muted, fontSize: 13, fontWeight: "700" },
  segmentTextExternal: { color: c.primaryText },
  segmentTextInternal: { color: c.warning },
  inputRow: { alignItems: "flex-end", flexDirection: "row", gap: 8 },
  input: {
    backgroundColor: c.surfaceSubtle,
    borderColor: c.borderStrong,
    borderRadius: 22,
    borderWidth: 1,
    color: c.foreground,
    flex: 1,
    fontSize: 15,
    lineHeight: 20,
    maxHeight: 140,
    minHeight: 44,
    paddingBottom: 11,
    paddingHorizontal: 16,
    paddingTop: 11,
  },
  inputInternal: {
    backgroundColor: c.warningSoft,
    borderColor: c.warningBorder,
  },
  sendButton: {
    alignItems: "center",
    backgroundColor: c.primary,
    borderRadius: 22,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  sendButtonInternal: { backgroundColor: c.warningStrong },
  sendButtonDisabled: { opacity: 0.4 },
  composerMeta: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    justifyContent: "space-between",
    paddingHorizontal: 6,
  },
  composerHint: {
    alignItems: "center",
    flexDirection: "row",
    flexShrink: 1,
    gap: 5,
  },
  composerHintText: { color: c.muted, flexShrink: 1, fontSize: 11 },
  composerHintInternal: { color: c.warning, fontWeight: "600" },
  draftHint: { color: c.success, fontSize: 11, fontWeight: "600" },
  draftHintLocal: { color: c.warning },
  readOnly: {
    alignItems: "center",
    backgroundColor: c.surface,
    borderTopColor: c.border,
    borderTopWidth: 1,
    flexDirection: "row",
    gap: 8,
    padding: 13,
  },
  readOnlyHint: { color: c.muted, flex: 1, fontSize: 12, lineHeight: 17 },
}));
