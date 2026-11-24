import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";

import { tn } from "@/lib/formality";
import {
  type MobileProjectComment,
  type ProjectHealth,
  type ProjectStatus,
  type ProjectTaskStatus,
  projectDateTimeLabel,
  projectHealthLabel,
  projectStatusLabel,
  projectTaskStatusLabel,
} from "@/lib/projects-model";
import { makeThemedStyles, useAppColors } from "@/lib/themed-styles";

/** Fortschrittsbalken eines Projekts. */
export function ProjectProgress({
  percent,
  label,
}: {
  percent: number;
  label: string;
}) {
  const styles = useProjectStyles();
  const width = Math.max(0, Math.min(100, percent));
  return (
    <View accessible accessibilityLabel={`Fortschritt: ${label}`}>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${width}%` }]} />
      </View>
      <Text style={styles.progressText}>{label}</Text>
    </View>
  );
}

/** Status und Ampel eines Projekts als Abzeichen. */
export function ProjectBadges({
  status,
  health,
}: {
  status: ProjectStatus;
  health: ProjectHealth;
}) {
  const styles = useProjectStyles();
  return (
    <View style={styles.badgeRow}>
      <Text
        style={[
          styles.badge,
          status === "completed" ? styles.badgeMuted : null,
        ]}
      >
        {projectStatusLabel(status)}
      </Text>
      {status !== "completed" ? (
        <Text
          style={[
            styles.badge,
            health === "green"
              ? styles.badgeGood
              : health === "yellow"
                ? styles.badgeWarn
                : styles.badgeBad,
          ]}
        >
          {projectHealthLabel(health)}
        </Text>
      ) : null}
    </View>
  );
}

const TASK_STATUS_ICONS: Record<
  ProjectTaskStatus,
  | "ellipse-outline"
  | "play-circle-outline"
  | "alert-circle"
  | "checkmark-circle"
> = {
  todo: "ellipse-outline",
  in_progress: "play-circle-outline",
  blocked: "alert-circle",
  done: "checkmark-circle",
};

export function ProjectTaskStatusIcon({
  status,
  size = 20,
}: {
  status: ProjectTaskStatus;
  size?: number;
}) {
  const colors = useAppColors();
  return (
    <Ionicons
      accessibilityLabel={projectTaskStatusLabel(status)}
      color={
        status === "done"
          ? colors.success
          : status === "blocked"
            ? colors.error
            : status === "in_progress"
              ? colors.primaryText
              : colors.subtle
      }
      name={TASK_STATUS_ICONS[status]}
      size={size}
    />
  );
}

/** Freundlicher Hinweis statt Fehler bei fehlendem Recht oder Modul. */
export function ProjectAccessDenied() {
  const styles = useProjectStyles();
  const colors = useAppColors();
  return (
    <View style={styles.stateCard}>
      <Ionicons
        color={colors.primaryText}
        name="lock-closed-outline"
        size={28}
      />
      <Text style={styles.stateTitle}>Kein Zugriff auf Projekte</Text>
      <Text style={styles.stateText}>
        {tn(
          "Das Modul Projekte ist für dich nicht eingeschaltet oder du bist an diesem Projekt nicht beteiligt. Wende dich bei Bedarf an die Projektleitung.",
          "Das Modul Projekte ist für Sie nicht eingeschaltet oder Sie sind an diesem Projekt nicht beteiligt. Wenden Sie sich bei Bedarf an die Projektleitung.",
        )}
      </Text>
    </View>
  );
}

/** Hinweis ohne Verbindung, solange noch keine Daten geladen sind. */
export function ProjectOffline() {
  const styles = useProjectStyles();
  const colors = useAppColors();
  return (
    <View style={styles.stateCard}>
      <Ionicons
        color={colors.primaryText}
        name="cloud-offline-outline"
        size={28}
      />
      <Text style={styles.stateTitle}>Keine Verbindung</Text>
      <Text style={styles.stateText}>
        Die Projekte werden geladen, sobald wieder eine Verbindung besteht.
      </Text>
    </View>
  );
}

export function ProjectErrorCard({ message }: { message: string }) {
  const styles = useProjectStyles();
  const colors = useAppColors();
  return (
    <View style={styles.errorCard}>
      <Ionicons color={colors.error} name="alert-circle-outline" size={19} />
      <Text style={styles.errorText}>{message}</Text>
    </View>
  );
}

/** Kommentare zu Projekt oder Aufgabe mit Eingabe (falls erlaubt). */
export function ProjectComments({
  comments,
  canComment,
  onSend,
}: {
  comments: readonly MobileProjectComment[];
  canComment: boolean;
  /** Wirft bei Fehlern; die Meldung erscheint unter der Eingabe. */
  onSend: (body: string) => Promise<void>;
}) {
  const styles = useProjectStyles();
  const colors = useAppColors();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const ready = draft.trim().length > 0 && !sending;

  const send = async () => {
    if (!ready) return;
    setSending(true);
    setError("");
    try {
      await onSend(draft);
      setDraft("");
    } catch (nextError) {
      setError(
        nextError instanceof Error && nextError.message
          ? nextError.message
          : "Der Kommentar konnte nicht gespeichert werden.",
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <View style={styles.group}>
      <Text style={styles.eyebrow}>KOMMENTARE</Text>
      {comments.length ? (
        <View style={styles.list}>
          {comments.map((comment) => (
            <View key={comment.id} style={styles.comment}>
              <View style={styles.commentHead}>
                <Text numberOfLines={1} style={styles.commentAuthor}>
                  {comment.mine ? tn("Du", "Sie") : comment.authorName}
                </Text>
                {comment.external ? (
                  <Text style={styles.badge}>Für Gäste sichtbar</Text>
                ) : null}
                <Text style={styles.commentTime}>
                  {projectDateTimeLabel(comment.createdAt)}
                </Text>
              </View>
              <Text selectable style={styles.commentBody}>
                {comment.body}
              </Text>
            </View>
          ))}
        </View>
      ) : (
        <Text style={styles.cardMeta}>Noch keine Kommentare.</Text>
      )}
      {canComment ? (
        <>
          <View style={styles.composer}>
            <TextInput
              accessibilityLabel="Kommentar schreiben"
              editable={!sending}
              maxLength={20000}
              multiline
              onChangeText={setDraft}
              placeholder="Kommentar schreiben"
              placeholderTextColor={colors.subtle}
              style={styles.composerInput}
              value={draft}
            />
            <Pressable
              accessibilityLabel="Kommentar senden"
              accessibilityRole="button"
              accessibilityState={{ disabled: !ready }}
              disabled={!ready}
              onPress={() => void send()}
              style={[styles.send, !ready ? styles.sendDisabled : null]}
            >
              {sending ? (
                <ActivityIndicator color={colors.onPrimary} size="small" />
              ) : (
                <Ionicons color={colors.onPrimary} name="arrow-up" size={18} />
              )}
            </Pressable>
          </View>
          {error ? <ProjectErrorCard message={error} /> : null}
        </>
      ) : null}
    </View>
  );
}

export const useProjectStyles = makeThemedStyles((c) => ({
  back: {
    alignItems: "center",
    alignSelf: "flex-start",
    flexDirection: "row",
    gap: 4,
  },
  backText: { color: c.primaryText, fontSize: 15, fontWeight: "700" },
  badge: {
    backgroundColor: c.infoSoft,
    borderRadius: 8,
    color: c.info,
    fontSize: 10,
    fontWeight: "800",
    overflow: "hidden",
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  badgeBad: { backgroundColor: c.errorSoft, color: c.error },
  badgeGood: { backgroundColor: c.successSoft, color: c.success },
  badgeMuted: { backgroundColor: c.surfaceSubtle, color: c.muted },
  badgeRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  badgeWarn: { backgroundColor: c.warningSoft, color: c.warning },
  card: {
    backgroundColor: c.surface,
    borderColor: c.border,
    borderRadius: 19,
    borderWidth: 1,
    gap: 9,
    padding: 14,
  },
  cardHead: { alignItems: "center", flexDirection: "row", gap: 10 },
  cardMeta: { color: c.muted, fontSize: 12, lineHeight: 17 },
  cardTitle: { color: c.foreground, flex: 1, fontSize: 15, fontWeight: "800" },
  centered: { alignItems: "center", flex: 1, justifyContent: "center" },
  check: {
    alignItems: "center",
    borderBottomColor: c.border,
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  checkDone: { color: c.muted, textDecorationLine: "line-through" },
  checkText: { color: c.foreground, flex: 1, fontSize: 14 },
  chip: {
    borderColor: c.borderStrong,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chipActive: { backgroundColor: c.primary, borderColor: c.primary },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chipText: { color: c.text, fontSize: 13, fontWeight: "700" },
  chipTextActive: { color: c.onPrimary },
  comment: {
    borderBottomColor: c.border,
    borderBottomWidth: 1,
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  commentAuthor: {
    color: c.foreground,
    flexShrink: 1,
    fontSize: 13,
    fontWeight: "800",
  },
  commentBody: { color: c.text, fontSize: 14, lineHeight: 20 },
  commentHead: { alignItems: "center", flexDirection: "row", gap: 8 },
  commentTime: {
    color: c.muted,
    flex: 1,
    fontSize: 11,
    textAlign: "right",
  },
  composer: {
    alignItems: "flex-end",
    backgroundColor: c.surface,
    borderColor: c.borderStrong,
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  composerInput: {
    color: c.text,
    flex: 1,
    fontSize: 14,
    maxHeight: 140,
    minHeight: 32,
    paddingVertical: 6,
  },
  content: { gap: 16, paddingBottom: 40, paddingTop: 12 },
  description: { color: c.text, fontSize: 14, lineHeight: 21 },
  errorCard: {
    alignItems: "flex-start",
    backgroundColor: c.errorSoft,
    borderRadius: 16,
    flexDirection: "row",
    gap: 9,
    padding: 13,
  },
  errorText: { color: c.error, flex: 1, fontSize: 12, lineHeight: 18 },
  eyebrow: {
    color: c.muted,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.2,
  },
  fill: { backgroundColor: c.primary, borderRadius: 4, height: 6 },
  group: { gap: 10 },
  infoLabel: { color: c.muted, fontSize: 12, width: 124 },
  infoRow: { flexDirection: "row", gap: 10 },
  infoValue: { color: c.foreground, flex: 1, fontSize: 13, fontWeight: "600" },
  list: {
    backgroundColor: c.surface,
    borderColor: c.border,
    borderRadius: 19,
    borderWidth: 1,
    overflow: "hidden",
  },
  overdue: { color: c.error },
  progressText: {
    color: c.muted,
    fontSize: 12,
    fontWeight: "600",
    marginTop: 5,
  },
  row: {
    alignItems: "center",
    borderBottomColor: c.border,
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  rowCopy: { flex: 1, gap: 2 },
  rowMeta: { color: c.muted, fontSize: 12 },
  rowPhase: { backgroundColor: c.surfaceSubtle },
  rowTitle: { color: c.foreground, fontSize: 14, fontWeight: "700" },
  rowTitleDone: { color: c.muted, textDecorationLine: "line-through" },
  searchInput: { color: c.text, flex: 1, fontSize: 14, paddingVertical: 4 },
  searchRow: {
    alignItems: "center",
    backgroundColor: c.surface,
    borderColor: c.borderStrong,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    gap: 9,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  send: {
    alignItems: "center",
    backgroundColor: c.primary,
    borderRadius: 16,
    height: 32,
    justifyContent: "center",
    width: 32,
  },
  sendDisabled: { opacity: 0.4 },
  stateCard: {
    alignItems: "center",
    backgroundColor: c.surface,
    borderColor: c.border,
    borderRadius: 20,
    borderWidth: 1,
    gap: 7,
    padding: 26,
  },
  stateText: {
    color: c.muted,
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
  },
  stateTitle: {
    color: c.foreground,
    fontSize: 15,
    fontWeight: "800",
    textAlign: "center",
  },
  subtitle: { color: c.muted, fontSize: 13, marginTop: 4 },
  title: {
    color: c.foreground,
    fontSize: 28,
    fontWeight: "900",
    letterSpacing: -0.6,
    marginTop: 3,
  },
  track: {
    backgroundColor: c.surfaceSubtle,
    borderRadius: 4,
    height: 6,
    overflow: "hidden",
  },
}));
