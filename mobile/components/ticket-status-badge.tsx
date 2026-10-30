import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";

import type { MobileTicket } from "@/lib/nextdesk-tickets";
import { useAppColors } from "@/lib/themed-styles";

type StatusTone = "error" | "info" | "primary" | "success" | "warning";

/**
 * Einheitliche Statussprache für Liste, Startseite und Kennzahlen:
 * gelöst = grün, neu = blau, wartend = gelb, in Bearbeitung = Markenfarbe.
 */
export function ticketStatusTone(
  ticket: Pick<MobileTicket, "resolved" | "status">,
): StatusTone {
  if (ticket.resolved) return "success";
  if (ticket.status === "Neu") return "info";
  if (ticket.status.startsWith("Wartend")) return "warning";
  return "primary";
}

const ICONS: Record<StatusTone, keyof typeof Ionicons.glyphMap> = {
  error: "alert-circle-outline",
  info: "sparkles-outline",
  primary: "time-outline",
  success: "checkmark-circle-outline",
  warning: "pause-circle-outline",
};

function useTonePalette(tone: StatusTone) {
  const colors = useAppColors();
  switch (tone) {
    case "success":
      return { bg: colors.successSoft, fg: colors.success };
    case "info":
      return { bg: colors.infoSoft, fg: colors.info };
    case "warning":
      return { bg: colors.warningSoft, fg: colors.warning };
    case "error":
      return { bg: colors.errorSoft, fg: colors.error };
    default:
      return { bg: colors.primarySoft, fg: colors.primaryText };
  }
}

export function TicketStatusBadge({
  ticket,
}: {
  ticket: Pick<MobileTicket, "resolved" | "status">;
}) {
  const tone = ticketStatusTone(ticket);
  const palette = useTonePalette(tone);
  return (
    <View
      accessibilityLabel={`Status: ${ticket.status}`}
      style={[styles.badge, { backgroundColor: palette.bg }]}
    >
      <Ionicons color={palette.fg} name={ICONS[tone]} size={13} />
      <Text style={[styles.text, { color: palette.fg }]}>{ticket.status}</Text>
    </View>
  );
}

/** Zeigt nur dringende oder hohe Prioritäten hervorgehoben; sonst schlichter Text. */
export function TicketPriorityText({
  priority,
}: {
  priority: MobileTicket["priority"];
}) {
  const colors = useAppColors();
  const urgent = priority === "Dringend";
  const high = priority === "Hoch";
  return (
    <View style={styles.priority}>
      {urgent || high ? (
        <Ionicons
          color={urgent ? colors.error : colors.warning}
          name={urgent ? "flame" : "arrow-up"}
          size={12}
        />
      ) : null}
      <Text
        style={[
          styles.priorityText,
          {
            color: urgent ? colors.error : high ? colors.warning : colors.muted,
            fontWeight: urgent || high ? "800" : "500",
          },
        ]}
      >
        {priority}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignItems: "center",
    alignSelf: "flex-end",
    borderRadius: 999,
    flexDirection: "row",
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  priority: { alignItems: "center", flexDirection: "row", gap: 3 },
  priorityText: { fontSize: 11 },
  text: { fontSize: 11, fontWeight: "800" },
});
