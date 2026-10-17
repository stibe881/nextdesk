import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import {
  type MobileTicketComment,
  type TicketCommentVisibility,
} from "@/lib/nextdesk-tickets";

type TicketConversationProps = {
  body: string;
  canCommentExternal: boolean;
  canWriteInternalNotes: boolean;
  comments: MobileTicketComment[];
  isSending: boolean;
  onBodyChange: (body: string) => void;
  onSend: () => void;
  onVisibilityChange: (visibility: TicketCommentVisibility) => void;
  visibility: TicketCommentVisibility;
};

function messageDirection(
  comment: MobileTicketComment,
): "incoming" | "internal" | "outgoing" {
  if (comment.authorKind === "internal" || comment.visibility === "internal") {
    return "internal";
  }
  return comment.authorKind === "customer" ? "incoming" : "outgoing";
}

function messageTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Zeitpunkt unbekannt";
  return new Intl.DateTimeFormat("de-CH", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function TicketConversation({
  body,
  canCommentExternal,
  canWriteInternalNotes,
  comments,
  isSending,
  onBodyChange,
  onSend,
  onVisibilityChange,
  visibility,
}: TicketConversationProps) {
  const canWrite = canWriteInternalNotes || canCommentExternal;
  const externalHint =
    visibility === "external"
      ? "Im Kundenportal sichtbar · kein E-Mail-Versand"
      : "Nur für berechtigte Mitarbeitende sichtbar";

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View>
          <Text style={styles.eyebrow}>KOMMUNIKATION</Text>
          <Text style={styles.title}>Verlauf</Text>
        </View>
        <View style={styles.countBadge}>
          <Text style={styles.count}>{comments.length}</Text>
        </View>
      </View>

      {comments.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons
            color="#77758C"
            name="chatbubble-ellipses-outline"
            size={24}
          />
          <Text style={styles.emptyText}>
            Noch keine Nachrichten vorhanden.
          </Text>
        </View>
      ) : (
        <View style={styles.messages}>
          {comments.map((comment) => {
            const direction = messageDirection(comment);
            const isInternal = direction === "internal";
            const label = isInternal
              ? "Interne Notiz"
              : direction === "incoming"
                ? "Kundschaft"
                : "Portalantwort";
            return (
              <View
                key={comment.id}
                style={[
                  styles.messageRow,
                  direction === "incoming" && styles.messageIncoming,
                  direction === "outgoing" && styles.messageOutgoing,
                  isInternal && styles.messageInternal,
                ]}
              >
                <View
                  style={[
                    styles.message,
                    direction === "incoming" && styles.messageIncomingBubble,
                    direction === "outgoing" && styles.messageOutgoingBubble,
                    isInternal && styles.messageInternalBubble,
                  ]}
                >
                  <View style={styles.messageMeta}>
                    <Text style={styles.author} numberOfLines={1}>
                      {isInternal ? "Intern · " : ""}
                      {comment.authorName}
                    </Text>
                    <Text style={styles.timestamp}>
                      {messageTimestamp(comment.createdAt)}
                    </Text>
                  </View>
                  <Text style={styles.messageBody}>{comment.body}</Text>
                  <Text
                    style={[
                      styles.visibility,
                      isInternal
                        ? styles.visibilityInternal
                        : styles.visibilityExternal,
                    ]}
                  >
                    {label}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      )}

      {canWrite ? (
        <View style={styles.composer}>
          <Text style={styles.composerLabel}>NEUE NACHRICHT</Text>
          {canWriteInternalNotes && canCommentExternal ? (
            <View style={styles.visibilityToggle}>
              <Pressable
                accessibilityRole="button"
                onPress={() => onVisibilityChange("internal")}
                style={[
                  styles.visibilityButton,
                  visibility === "internal" && styles.visibilityButtonActive,
                ]}
              >
                <Ionicons
                  color={visibility === "internal" ? "#FFFFFF" : "#4438CA"}
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
                  visibility === "external" && styles.visibilityButtonActive,
                ]}
              >
                <Ionicons
                  color={visibility === "external" ? "#FFFFFF" : "#4438CA"}
                  name="eye-outline"
                  size={16}
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
                : "Portalantwort für die Kundschaft schreiben …"
            }
            placeholderTextColor="#9A99AA"
            style={styles.composerInput}
            textAlignVertical="top"
            value={body}
          />
          <Text style={styles.visibilityHint}>{externalHint}</Text>
          <Pressable
            accessibilityRole="button"
            disabled={isSending || !body.trim()}
            onPress={onSend}
            style={[
              styles.sendButton,
              (isSending || !body.trim()) && styles.disabled,
            ]}
          >
            <Ionicons color="#FFFFFF" name="send" size={17} />
            <Text style={styles.sendButtonText}>
              {isSending
                ? "Wird veröffentlicht …"
                : visibility === "internal"
                  ? "Interne Notiz speichern"
                  : "Portalantwort veröffentlichen"}
            </Text>
          </Pressable>
        </View>
      ) : (
        <Text style={styles.readOnlyHint}>
          Sie können den Verlauf einsehen, aber keine Nachricht zu diesem Ticket
          veröffentlichen.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    backgroundColor: "#FFFFFF",
    borderColor: "#ECECF3",
    borderRadius: 20,
    borderWidth: 1,
    gap: 15,
    padding: 17,
  },
  sectionHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  eyebrow: {
    color: "#77758C",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.9,
  },
  title: { color: "#202136", fontSize: 19, fontWeight: "800", marginTop: 3 },
  countBadge: {
    alignItems: "center",
    backgroundColor: "#EEECFF",
    borderRadius: 14,
    height: 28,
    justifyContent: "center",
    minWidth: 28,
    paddingHorizontal: 8,
  },
  count: { color: "#4438CA", fontSize: 12, fontWeight: "800" },
  empty: {
    alignItems: "center",
    backgroundColor: "#F7F7FB",
    borderRadius: 14,
    gap: 8,
    padding: 17,
  },
  emptyText: { color: "#77758C", fontSize: 13, fontWeight: "600" },
  messages: { gap: 10 },
  messageRow: { flexDirection: "row" },
  messageIncoming: { justifyContent: "flex-start" },
  messageOutgoing: { justifyContent: "flex-end" },
  messageInternal: { justifyContent: "center" },
  message: { borderRadius: 16, maxWidth: "88%", padding: 12 },
  messageIncomingBubble: {
    backgroundColor: "#F1F0FA",
    borderBottomLeftRadius: 4,
  },
  messageOutgoingBubble: {
    backgroundColor: "#E4E1FF",
    borderBottomRightRadius: 4,
  },
  messageInternalBubble: {
    backgroundColor: "#F7F7FB",
    borderColor: "#E5E5EF",
    borderRadius: 13,
    borderWidth: 1,
    maxWidth: "96%",
  },
  messageMeta: {
    alignItems: "baseline",
    flexDirection: "row",
    gap: 6,
    justifyContent: "space-between",
    marginBottom: 5,
  },
  author: { color: "#37384B", flex: 1, fontSize: 12, fontWeight: "800" },
  timestamp: { color: "#77758C", fontSize: 10, fontWeight: "600" },
  messageBody: { color: "#343447", fontSize: 14, lineHeight: 20 },
  visibility: { fontSize: 10, fontWeight: "800", marginTop: 8 },
  visibilityInternal: { color: "#7C5A12" },
  visibilityExternal: { color: "#4438CA" },
  composer: {
    backgroundColor: "#F7F7FB",
    borderColor: "#E5E5EF",
    borderRadius: 16,
    borderWidth: 1,
    gap: 10,
    padding: 13,
  },
  composerLabel: {
    color: "#77758C",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.9,
  },
  visibilityToggle: { flexDirection: "row", gap: 8 },
  visibilityButton: {
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderColor: "#DAD8EE",
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    minHeight: 37,
    paddingHorizontal: 11,
  },
  visibilityButtonActive: {
    backgroundColor: "#4438CA",
    borderColor: "#4438CA",
  },
  visibilityButtonText: { color: "#4438CA", fontSize: 12, fontWeight: "800" },
  visibilityButtonTextActive: { color: "#FFFFFF" },
  composerInput: {
    backgroundColor: "#FFFFFF",
    borderColor: "#DAD8EE",
    borderRadius: 13,
    borderWidth: 1,
    color: "#202136",
    fontSize: 14,
    lineHeight: 20,
    minHeight: 108,
    padding: 11,
  },
  visibilityHint: { color: "#77758C", fontSize: 11, lineHeight: 16 },
  sendButton: {
    alignItems: "center",
    backgroundColor: "#4438CA",
    borderRadius: 13,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    minHeight: 46,
    paddingHorizontal: 14,
  },
  sendButtonText: { color: "#FFFFFF", fontSize: 13, fontWeight: "800" },
  readOnlyHint: {
    color: "#77758C",
    fontSize: 12,
    lineHeight: 18,
    textAlign: "center",
  },
  disabled: { opacity: 0.52 },
});
