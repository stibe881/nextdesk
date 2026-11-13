import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, Text, View } from "react-native";

import {
  hapticError,
  hapticSelection,
  hapticSuccess,
} from "@/lib/mobile-haptics";
import {
  getMobileTicketSupportLevel,
  markMobileTicketSpam,
  mobileSpamResultText,
  type MobileTicketSupportLevel,
} from "@/lib/support-levels";
import { makeThemedStyles, useAppColors } from "@/lib/themed-styles";

/**
 * «Als Spam/Phishing einstufen» in the ticket detail. After a confirmation
 * the requester gets the same standard reply as for a mail reported in
 * Outlook and the ticket goes to the 2nd level team of its department
 * (e.g. «System Engineer»). Hidden without the rights or without a single
 * active 2nd level team; the server checks everything again.
 */
export function TicketSpamButton({
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
  const [spam, setSpam] = useState<MobileTicketSupportLevel["spam"] | null>(
    null,
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void getMobileTicketSupportLevel(tenantId, ticketId)
      .then((state) => {
        if (active) setSpam(state?.spam ?? null);
      })
      .catch(() => {
        if (active) setSpam(null);
      });
    return () => {
      active = false;
    };
  }, [refreshKey, tenantId, ticketId]);

  if (!spam) return null;
  if (spam.marked) {
    return (
      <View
        accessibilityLabel="Dieses Ticket wurde als Spam/Phishing eingestuft."
        style={styles.marked}
      >
        <Ionicons color={colors.error} name="shield" size={17} />
        <Text style={styles.markedText}>Als Spam/Phishing eingestuft</Text>
      </View>
    );
  }
  if (!spam.canMark || !spam.targetTeamName) return null;
  const teamName = spam.targetTeamName;

  async function mark() {
    setBusy(true);
    try {
      const result = await markMobileTicketSpam(tenantId, ticketId);
      setSpam((current) =>
        current ? { ...current, marked: true, canMark: false } : current,
      );
      if (result.reply === "queued") hapticSuccess();
      else hapticError();
      Alert.alert("Als Spam/Phishing eingestuft", mobileSpamResultText(result));
      onChanged();
    } catch (error) {
      hapticError();
      Alert.alert(
        "Einstufung nicht möglich",
        error instanceof Error
          ? error.message
          : "Das Ticket konnte nicht als Spam/Phishing eingestuft werden.",
      );
    } finally {
      setBusy(false);
    }
  }

  function confirm() {
    hapticSelection();
    Alert.alert(
      "Wirklich als Spam/Phishing markieren?",
      `Die anfragende Person erhält die Standardantwort (wie bei einer Phishing-Meldung aus Outlook) und das Ticket wird an den 2nd Level (${teamName}) weitergeleitet. Das lässt sich nicht rückgängig machen.`,
      [
        { text: "Abbrechen", style: "cancel" },
        {
          text: "Als Spam/Phishing markieren",
          style: "destructive",
          onPress: () => void mark(),
        },
      ],
    );
  }

  return (
    <Pressable
      accessibilityHint={`Sendet die Standardantwort an die anfragende Person und leitet das Ticket an ${teamName} weiter. Vorher wird nachgefragt.`}
      accessibilityLabel="Als Spam/Phishing einstufen"
      accessibilityRole="button"
      accessibilityState={{ busy, disabled: busy }}
      disabled={busy}
      onPress={confirm}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      {busy ? (
        <ActivityIndicator color={colors.error} size="small" />
      ) : (
        <Ionicons color={colors.error} name="shield-outline" size={19} />
      )}
      <View style={styles.copy}>
        <Text style={styles.title}>Als Spam/Phishing einstufen</Text>
        <Text style={styles.hint}>
          Standardantwort senden und an {teamName} weiterleiten
        </Text>
      </View>
    </Pressable>
  );
}

const useStyles = makeThemedStyles((c) => ({
  button: {
    alignItems: "center",
    backgroundColor: c.surface,
    borderColor: c.border,
    borderRadius: 20,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    minHeight: 56,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  pressed: { opacity: 0.75 },
  copy: { flex: 1, gap: 2 },
  title: { color: c.error, fontSize: 15, fontWeight: "800" },
  hint: { color: c.muted, fontSize: 12, lineHeight: 17 },
  marked: {
    alignItems: "center",
    backgroundColor: c.errorSoft,
    borderRadius: 20,
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  markedText: { color: c.error, fontSize: 14, fontWeight: "800" },
}));
