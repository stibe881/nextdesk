import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
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

import {
  hapticError,
  hapticSelection,
  hapticSuccess,
} from "@/lib/mobile-haptics";
import {
  getMobileTicketSupportLevel,
  handOverMobileTicketLevel,
  MOBILE_NOTE_MAX,
  mobileHandoverNoteError,
  mobileSupportLevelLabel,
  shouldShowSupportLevelCard,
  type MobileLevelTeam,
  type MobileSupportLevel,
  type MobileTicketSupportLevel,
} from "@/lib/support-levels";
import { makeThemedStyles, useAppColors } from "@/lib/themed-styles";
import { tn } from "@/lib/formality";

type Mode = {
  direction: "escalated" | "returned";
  level: MobileSupportLevel;
  teams: MobileLevelTeam[];
};

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleString("de-CH", { dateStyle: "short", timeStyle: "short" });
}

/**
 * Supportstufe des Tickets (1st/2nd/3rd Level) mit Übergabe an die nächste
 * Stufe oder zurück. Die Übergabenotiz ist Pflicht und wird als interne
 * Notiz gespeichert.
 */
export function TicketSupportLevelCard({
  onChanged,
  refreshKey,
  tenantId,
  ticketId,
}: {
  onChanged: () => void;
  refreshKey: string;
  tenantId: string;
  ticketId: string;
}) {
  const styles = useStyles();
  const colors = useAppColors();
  const [state, setState] = useState<MobileTicketSupportLevel | null>(null);
  const [mode, setMode] = useState<Mode | null>(null);
  const [teamId, setTeamId] = useState("");
  const [note, setNote] = useState("");
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let active = true;
    getMobileTicketSupportLevel(tenantId, ticketId)
      .then((next) => {
        if (active) setState(next);
      })
      .catch(() => {
        // The card stays hidden when the level cannot be loaded.
        if (active) setState(null);
      });
    return () => {
      active = false;
    };
  }, [refreshKey, reloadToken, tenantId, ticketId]);

  if (!state || !shouldShowSupportLevelCard(state)) return null;

  const open = (next: Mode) => {
    hapticSelection();
    setMode(next);
    setTeamId(next.teams.length === 1 ? (next.teams[0]?.id ?? "") : "");
    setNote("");
    setTouched(false);
    setError("");
    setMessage("");
  };
  const noteError = mobileHandoverNoteError(note);

  async function submit() {
    if (!mode || !state?.currentLevel) return;
    setTouched(true);
    if (!teamId) {
      setError("Wähle ein Team aus.");
      return;
    }
    if (noteError) return;
    setSaving(true);
    setError("");
    try {
      await handOverMobileTicketLevel({
        tenantId,
        ticketId,
        targetTeamId: teamId,
        note,
        expectedLevel: state.currentLevel,
      });
      hapticSuccess();
      const label = mobileSupportLevelLabel(mode.level);
      setMessage(
        mode.direction === "escalated"
          ? `Ticket an ${label} übergeben.`
          : `Ticket an ${label} zurückgegeben.`,
      );
      setMode(null);
      onChanged();
      setReloadToken((value) => value + 1);
    } catch (nextError) {
      hapticError();
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Die Übergabe hat nicht geklappt.",
      );
    } finally {
      setSaving(false);
    }
  }

  const handover = state.currentHandover;
  return (
    <View style={styles.card}>
      <Text style={styles.eyebrow}>SUPPORTSTUFE</Text>
      <View style={styles.titleRow}>
        <Ionicons color={colors.primaryText} name="layers-outline" size={20} />
        <Text style={styles.title}>
          {state.currentLevel
            ? mobileSupportLevelLabel(state.currentLevel)
            : "Ohne Stufe"}
        </Text>
        {state.currentTeamName ? (
          <View style={styles.pill}>
            <Text style={styles.pillText}>{state.currentTeamName}</Text>
          </View>
        ) : null}
      </View>

      {handover ? (
        <View
          accessibilityLabel="Übergabenotiz"
          style={[
            styles.handover,
            handover.kind === "returned" ? styles.handoverReturned : null,
          ]}
        >
          <Text style={styles.handoverTitle}>
            {handover.kind === "returned"
              ? "Rückgabe mit Notiz"
              : "Übergabenotiz der vorherigen Stufe"}
          </Text>
          <Text style={styles.meta}>
            {[
              handover.actorName,
              formatDate(handover.createdAt),
              handover.fromLevel
                ? `von ${mobileSupportLevelLabel(handover.fromLevel)}`
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </Text>
          <Text style={styles.note}>{handover.note}</Text>
        </View>
      ) : null}

      {message ? (
        <Text accessibilityRole="alert" style={styles.success}>
          {message}
        </Text>
      ) : null}

      {state.canHandover && (state.next || state.back.length > 0) ? (
        <View style={styles.actions}>
          {state.next ? (
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                state.next &&
                open({
                  direction: "escalated",
                  level: state.next.level,
                  teams: state.next.teams,
                })
              }
              style={[styles.button, styles.primaryButton]}
            >
              <Ionicons color={colors.onPrimary} name="arrow-up" size={16} />
              <Text style={styles.primaryButtonText}>
                An nächste Stufe übergeben
              </Text>
            </Pressable>
          ) : null}
          {state.back.map((target) => (
            <Pressable
              accessibilityRole="button"
              key={target.level}
              onPress={() =>
                open({
                  direction: "returned",
                  level: target.level,
                  teams: target.teams,
                })
              }
              style={[styles.button, styles.secondaryButton]}
            >
              <Ionicons
                color={colors.primaryText}
                name="arrow-down"
                size={16}
              />
              <Text style={styles.secondaryButtonText}>
                Zurück an Stufe {target.level}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <Modal
        animationType="slide"
        onRequestClose={() => !saving && setMode(null)}
        transparent
        visible={mode !== null}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.sheetRoot}
        >
          <Pressable
            accessibilityLabel="Übergabe schliessen"
            accessibilityRole="button"
            disabled={saving}
            onPress={() => setMode(null)}
            style={StyleSheet.absoluteFill}
          />
          {mode ? (
            <View accessibilityViewIsModal style={styles.sheet}>
              <View style={styles.sheetHeader}>
                <View style={styles.sheetHeaderCopy}>
                  <Text style={styles.eyebrow}>
                    {mode.direction === "escalated"
                      ? "AN NÄCHSTE STUFE ÜBERGEBEN"
                      : `ZURÜCK AN STUFE ${mode.level}`}
                  </Text>
                  <Text style={styles.title}>
                    {state.currentLevel
                      ? `${mobileSupportLevelLabel(state.currentLevel)} → `
                      : ""}
                    {mobileSupportLevelLabel(mode.level)}
                  </Text>
                </View>
                <Pressable
                  accessibilityLabel="Übergabe schliessen"
                  accessibilityRole="button"
                  disabled={saving}
                  hitSlop={10}
                  onPress={() => setMode(null)}
                  style={styles.close}
                >
                  <Ionicons color={colors.primaryText} name="close" size={22} />
                </Pressable>
              </View>
              <ScrollView
                automaticallyAdjustKeyboardInsets
                contentContainerStyle={styles.sheetContent}
                keyboardShouldPersistTaps="handled"
              >
                <Text style={styles.label}>TEAM</Text>
                <View style={styles.teamList}>
                  {mode.teams.map((team) => {
                    const selected = team.id === teamId;
                    return (
                      <Pressable
                        accessibilityRole="radio"
                        accessibilityState={{ selected }}
                        key={team.id}
                        onPress={() => {
                          hapticSelection();
                          setTeamId(team.id);
                        }}
                        style={[
                          styles.team,
                          selected ? styles.teamSelected : null,
                        ]}
                      >
                        <Ionicons
                          color={selected ? colors.primaryText : colors.muted}
                          name={
                            selected ? "radio-button-on" : "radio-button-off"
                          }
                          size={18}
                        />
                        <Text style={styles.teamText}>{team.name}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                <Text style={styles.label}>ÜBERGABENOTIZ (PFLICHT)</Text>
                <TextInput
                  accessibilityLabel="Übergabenotiz"
                  editable={!saving}
                  maxLength={MOBILE_NOTE_MAX}
                  multiline
                  onBlur={() => setTouched(true)}
                  onChangeText={setNote}
                  placeholder={tn("Was hast du schon versucht? Was hast du herausgefunden?", "Was haben Sie schon versucht? Was haben Sie herausgefunden?")}
                  placeholderTextColor={colors.subtle}
                  style={styles.input}
                  textAlignVertical="top"
                  value={note}
                />
                <Text
                  style={touched && noteError ? styles.errorText : styles.meta}
                >
                  {touched && noteError
                    ? noteError
                    : "Die Notiz wird als interne Notiz gespeichert und der nächsten Stufe hervorgehoben angezeigt."}
                </Text>
                {error ? (
                  <Text accessibilityRole="alert" style={styles.errorText}>
                    {error}
                  </Text>
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  disabled={saving}
                  onPress={() => void submit()}
                  style={[styles.button, styles.primaryButton]}
                >
                  {saving ? (
                    <ActivityIndicator color={colors.onPrimary} />
                  ) : (
                    <Text style={styles.primaryButtonText}>
                      {mode.direction === "escalated"
                        ? `An ${mobileSupportLevelLabel(mode.level)} übergeben`
                        : `Zurück an ${mobileSupportLevelLabel(mode.level)}`}
                    </Text>
                  )}
                </Pressable>
              </ScrollView>
            </View>
          ) : null}
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const useStyles = makeThemedStyles((c) => ({
  card: {
    backgroundColor: c.surface,
    borderColor: c.border,
    borderRadius: 20,
    borderWidth: 1,
    gap: 10,
    padding: 14,
  },
  eyebrow: {
    color: c.muted,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1,
  },
  titleRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  title: { color: c.foreground, fontSize: 20, fontWeight: "800" },
  pill: {
    backgroundColor: c.infoSoft,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  pillText: { color: c.info, fontSize: 12, fontWeight: "800" },
  handover: {
    backgroundColor: c.warningSoft,
    borderColor: c.warningBorder,
    borderLeftWidth: 4,
    borderRadius: 12,
    borderWidth: 1,
    gap: 4,
    padding: 12,
  },
  handoverReturned: { backgroundColor: c.infoSoft, borderColor: c.info },
  handoverTitle: { color: c.foreground, fontSize: 14, fontWeight: "800" },
  meta: { color: c.muted, fontSize: 12 },
  note: { color: c.text, fontSize: 14, lineHeight: 20 },
  success: { color: c.success, fontSize: 13, fontWeight: "700" },
  errorText: { color: c.error, fontSize: 13, fontWeight: "600" },
  actions: { gap: 8 },
  button: {
    alignItems: "center",
    borderRadius: 14,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    minHeight: 46,
    paddingHorizontal: 14,
  },
  primaryButton: { backgroundColor: c.primary },
  primaryButtonText: { color: c.onPrimary, fontSize: 15, fontWeight: "800" },
  secondaryButton: {
    backgroundColor: c.primarySoft,
    borderColor: c.primarySoftBorder,
    borderWidth: 1,
  },
  secondaryButtonText: {
    color: c.primaryText,
    fontSize: 15,
    fontWeight: "800",
  },
  sheetRoot: {
    backgroundColor: c.overlay,
    flex: 1,
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: c.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: "90%",
    paddingBottom: 24,
    paddingHorizontal: 18,
    paddingTop: 18,
  },
  sheetHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  sheetHeaderCopy: { flex: 1, gap: 2 },
  close: {
    alignItems: "center",
    backgroundColor: c.primarySoft,
    borderRadius: 999,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  sheetContent: { gap: 10, paddingBottom: 12 },
  label: {
    color: c.muted,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.8,
  },
  teamList: { gap: 6 },
  team: {
    alignItems: "center",
    borderColor: c.border,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    minHeight: 46,
    paddingHorizontal: 12,
  },
  teamSelected: {
    backgroundColor: c.primarySoft,
    borderColor: c.primarySoftBorder,
  },
  teamText: { color: c.foreground, flex: 1, fontSize: 15, fontWeight: "600" },
  input: {
    backgroundColor: c.surfaceSubtle,
    borderColor: c.borderStrong,
    borderRadius: 12,
    borderWidth: 1,
    color: c.foreground,
    fontSize: 15,
    minHeight: 130,
    padding: 12,
  },
}));
