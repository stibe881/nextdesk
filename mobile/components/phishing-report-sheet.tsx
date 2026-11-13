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

import { hapticError, hapticSuccess } from "@/lib/mobile-haptics";
import {
  informalThanks,
  MAX_PHISHING_PASTE_CHARACTERS,
  submitPhishingReport,
  type PhishingSubmitResult,
} from "@/lib/phishing-report";
import { makeThemedStyles, useAppColors } from "@/lib/themed-styles";
import { tn } from "@/lib/formality";

/**
 * «Phishing melden» (mobile): the person pastes the headers or the text of a
 * suspicious e-mail. The server analyses it without opening links or
 * attachments and informs the security team.
 */
export function PhishingReportSheet({
  onClose,
  onOpenTicket,
  reportAddress,
  tenantId,
  visible,
}: {
  onClose: () => void;
  onOpenTicket: (ticketId: string) => void;
  reportAddress: string | null;
  tenantId: string;
  visible: boolean;
}) {
  const styles = useStyles();
  const colors = useAppColors();
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<PhishingSubmitResult | null>(null);

  function close() {
    if (busy) return;
    setInput("");
    setError("");
    setResult(null);
    onClose();
  }

  async function send() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      setResult(await submitPhishingReport(tenantId, input));
      hapticSuccess();
    } catch (sendError) {
      hapticError();
      setError(
        sendError instanceof Error
          ? sendError.message
          : "Die Meldung konnte nicht gesendet werden.",
      );
    } finally {
      setBusy(false);
    }
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
          accessibilityLabel="Phishing-Meldung schliessen"
          accessibilityRole="button"
          onPress={close}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={styles.eyebrow}>SICHERHEIT</Text>
              <Text style={styles.title}>Phishing melden</Text>
            </View>
            <Pressable
              accessibilityLabel="Phishing-Meldung schliessen"
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
            {result ? (
              <View style={styles.thanks}>
                <Ionicons
                  color={colors.success}
                  name="checkmark-circle"
                  size={34}
                />
                <Text style={styles.body}>{informalThanks(result)}</Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    const ticketId = result.ticketId;
                    close();
                    onOpenTicket(ticketId);
                  }}
                  style={styles.secondaryButton}
                >
                  <Text style={styles.secondaryButtonText}>Ticket öffnen</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={close}
                  style={styles.primaryButton}
                >
                  <Text style={styles.primaryButtonText}>Fertig</Text>
                </Pressable>
              </View>
            ) : (
              <>
                <View style={styles.warning}>
                  <Ionicons color={colors.warning} name="warning" size={18} />
                  <Text style={styles.warningText}>
                    {tn("Klicke in der verdächtigen E-Mail keine Links an und öffne keine Anhänge.", "Klicken Sie in der verdächtigen E-Mail keine Links an und öffnen Sie keine Anhänge.")}
                  </Text>
                </View>
                <Text style={styles.note}>
                  {tn("Kopiere die Kopfzeilen (in Outlook: Nachricht › Details anzeigen) oder den ganzen Text der E-Mail und füge ihn hier ein.", "Kopieren Sie die Kopfzeilen (in Outlook: Nachricht › Details anzeigen) oder den ganzen Text der E-Mail und fügen Sie ihn hier ein.")}
                  {reportAddress
                    ? tn(` Du kannst die E-Mail auch an ${reportAddress} weiterleiten.`, ` Sie können die E-Mail auch an ${reportAddress} weiterleiten.`)
                    : ""}
                </Text>
                <TextInput
                  accessibilityLabel="Kopfzeilen oder Text der E-Mail"
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!busy}
                  maxLength={MAX_PHISHING_PASTE_CHARACTERS}
                  multiline
                  onChangeText={setInput}
                  placeholder="Received: from … / From: … / Subject: …"
                  placeholderTextColor={colors.subtle}
                  style={styles.input}
                  textAlignVertical="top"
                  value={input}
                />
                {error ? <Text style={styles.error}>{error}</Text> : null}
                <Pressable
                  accessibilityRole="button"
                  disabled={busy || !input.trim()}
                  onPress={() => void send()}
                  style={[
                    styles.primaryButton,
                    (busy || !input.trim()) && styles.disabled,
                  ]}
                >
                  {busy ? (
                    <ActivityIndicator color={colors.onPrimary} size="small" />
                  ) : (
                    <Text style={styles.primaryButtonText}>Melden</Text>
                  )}
                </Pressable>
              </>
            )}
          </ScrollView>
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
  content: { gap: 12, paddingBottom: 8 },
  note: { color: c.muted, fontSize: 13, lineHeight: 19 },
  body: { color: c.text, fontSize: 15, lineHeight: 21 },
  warning: {
    alignItems: "flex-start",
    backgroundColor: c.warningSoft,
    borderColor: c.warningBorder,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    padding: 12,
  },
  warningText: { color: c.text, flex: 1, fontSize: 14, lineHeight: 20 },
  input: {
    backgroundColor: c.surfaceSubtle,
    borderColor: c.border,
    borderRadius: 14,
    borderWidth: 1,
    color: c.foreground,
    fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }),
    fontSize: 12,
    minHeight: 160,
    padding: 12,
  },
  thanks: { alignItems: "flex-start", gap: 12 },
  primaryButton: {
    alignItems: "center",
    alignSelf: "stretch",
    backgroundColor: c.primary,
    borderRadius: 14,
    justifyContent: "center",
    minHeight: 46,
  },
  primaryButtonText: { color: c.onPrimary, fontSize: 15, fontWeight: "800" },
  secondaryButton: {
    alignItems: "center",
    alignSelf: "stretch",
    backgroundColor: c.primarySoft,
    borderRadius: 14,
    justifyContent: "center",
    minHeight: 44,
  },
  secondaryButtonText: {
    color: c.primaryText,
    fontSize: 14,
    fontWeight: "800",
  },
  disabled: { opacity: 0.5 },
  error: { color: c.error, fontSize: 13, lineHeight: 19 },
}));
