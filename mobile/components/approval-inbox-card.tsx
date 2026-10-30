import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, Text, View } from "react-native";

import { useMobileFeatures } from "@/components/mobile-feature-gate";
import {
  decideApproval,
  listApprovalInbox,
  type ApprovalDecision,
  type InboxApproval,
} from "@/lib/nextdesk-approvals";
import { makeThemedStyles, useAppColors } from "@/lib/themed-styles";

/**
 * Freigaben, die auf eine Entscheidung der angemeldeten Person warten. Die Karte
 * erscheint nur, wenn der Server solche Freigaben liefert; fehlt die
 * Berechtigung oder die Funktion, bleibt sie unsichtbar.
 */
export function ApprovalInboxCard({ tenantId }: { tenantId: string | null }) {
  const router = useRouter();
  const colors = useAppColors();
  const styles = useStyles();
  const { isEnabled, loading: checkingFeatures } = useMobileFeatures();
  const ticketDetailsEnabled = isEnabled("ticketing.detail");
  const [approvals, setApprovals] = useState<InboxApproval[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const request = useRef(0);

  useFocusEffect(
    useCallback(() => {
      if (!tenantId || checkingFeatures || !ticketDetailsEnabled) {
        setApprovals(null);
        return;
      }
      const requestId = request.current + 1;
      request.current = requestId;
      void listApprovalInbox()
        .then((items) => {
          if (request.current === requestId) setApprovals(items);
        })
        .catch(() => {
          // Ohne Berechtigung oder Funktion bleibt die Karte verborgen.
          if (request.current === requestId) setApprovals(null);
        });
    }, [checkingFeatures, tenantId, ticketDetailsEnabled]),
  );

  async function decide(item: InboxApproval, decision: ApprovalDecision) {
    setBusyId(item.approvalId);
    setMessage("");
    try {
      await decideApproval({
        approvalId: item.approvalId,
        decision,
        ticketId: item.ticketId,
      });
      setApprovals((current) =>
        (current ?? []).filter((entry) => entry.approvalId !== item.approvalId),
      );
      setMessage(
        decision === "approved"
          ? `«${item.ticketNumber}» wurde freigegeben.`
          : `«${item.ticketNumber}» wurde abgelehnt.`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Die Freigabe konnte nicht verarbeitet werden.",
      );
    } finally {
      setBusyId(null);
    }
  }

  const confirmReject = (item: InboxApproval) => {
    Alert.alert(
      "Freigabe ablehnen?",
      `«${item.ticketNumber}» wird abgelehnt.`,
      [
        { style: "cancel", text: "Abbrechen" },
        {
          onPress: () => void decide(item, "rejected"),
          style: "destructive",
          text: "Ablehnen",
        },
      ],
    );
  };

  if (!approvals || (approvals.length === 0 && !message)) return null;

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.surface, borderColor: colors.border },
      ]}
    >
      <View style={styles.header}>
        <View style={[styles.iconBox, { backgroundColor: colors.primarySoft }]}>
          <Ionicons
            color={colors.primaryText}
            name="checkmark-done-outline"
            size={20}
          />
        </View>
        <View style={styles.headerCopy}>
          <Text style={[styles.title, { color: colors.foreground }]}>
            Zu entscheiden
          </Text>
          <Text style={[styles.subtitle, { color: colors.muted }]}>
            {approvals.length === 0
              ? "Keine offenen Freigaben"
              : `${approvals.length} Freigabe${approvals.length === 1 ? "" : "n"} warten auf dich`}
          </Text>
        </View>
      </View>
      {message ? (
        <Text
          accessibilityLiveRegion="polite"
          style={[styles.message, { color: colors.muted }]}
        >
          {message}
        </Text>
      ) : null}
      {approvals.slice(0, 5).map((item) => {
        const busy = busyId === item.approvalId;
        return (
          <View
            key={item.approvalId}
            style={[styles.row, { borderColor: colors.border }]}
          >
            <Pressable
              accessibilityHint="Öffnet das zugehörige Ticket"
              accessibilityRole="button"
              onPress={() =>
                router.push({
                  pathname: "/ticket/[id]",
                  params: { id: item.ticketId },
                })
              }
            >
              <Text style={[styles.number, { color: colors.muted }]}>
                {item.ticketNumber}
              </Text>
              <Text
                numberOfLines={2}
                style={[styles.subject, { color: colors.foreground }]}
              >
                {item.ticketSubject || item.approvalKind}
              </Text>
              <Text
                numberOfLines={2}
                style={[styles.reason, { color: colors.muted }]}
              >
                {item.reason}
              </Text>
            </Pressable>
            <View style={styles.actions}>
              <Pressable
                accessibilityLabel={`${item.ticketNumber} ablehnen`}
                accessibilityRole="button"
                accessibilityState={{ busy, disabled: busy }}
                disabled={busy}
                onPress={() => confirmReject(item)}
                style={[styles.button, { borderColor: colors.errorBorder }]}
              >
                <Text style={[styles.buttonText, { color: colors.error }]}>
                  Ablehnen
                </Text>
              </Pressable>
              <Pressable
                accessibilityLabel={`${item.ticketNumber} freigeben`}
                accessibilityRole="button"
                accessibilityState={{ busy, disabled: busy }}
                disabled={busy}
                onPress={() => void decide(item, "approved")}
                style={[styles.primary, { backgroundColor: colors.primary }]}
              >
                {busy ? (
                  <ActivityIndicator color={colors.onPrimary} size="small" />
                ) : (
                  <Text
                    style={[styles.buttonText, { color: colors.onPrimary }]}
                  >
                    Freigeben
                  </Text>
                )}
              </Pressable>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const useStyles = makeThemedStyles(() => ({
  actions: { flexDirection: "row", gap: 8, justifyContent: "flex-end" },
  button: {
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 40,
    paddingHorizontal: 16,
  },
  buttonText: { fontSize: 13, fontWeight: "800" },
  card: { borderRadius: 22, borderWidth: 1, gap: 12, padding: 17 },
  header: { alignItems: "center", flexDirection: "row", gap: 12 },
  headerCopy: { flex: 1, gap: 2 },
  iconBox: {
    alignItems: "center",
    borderRadius: 14,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  message: { fontSize: 12 },
  number: { fontSize: 10, fontWeight: "800", letterSpacing: 0.5 },
  primary: {
    alignItems: "center",
    borderRadius: 12,
    justifyContent: "center",
    minHeight: 40,
    minWidth: 96,
    paddingHorizontal: 16,
  },
  reason: { fontSize: 12, lineHeight: 17 },
  row: { borderTopWidth: 1, gap: 10, paddingTop: 12 },
  subject: { fontSize: 14, fontWeight: "800", lineHeight: 19 },
  subtitle: { fontSize: 12 },
  title: { fontSize: 18, fontWeight: "800" },
}));
