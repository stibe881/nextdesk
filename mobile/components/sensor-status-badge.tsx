import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";

import {
  SENSOR_TONE_LABELS,
  sensorTone,
  type SensorTone,
} from "@/lib/incidents-model";
import { useAppColors } from "@/lib/themed-styles";

const ICONS: Record<SensorTone, keyof typeof Ionicons.glyphMap> = {
  down: "alert-circle-outline",
  warning: "warning-outline",
  ok: "checkmark-circle-outline",
};

/** Sensor state as a badge, styled like the ticket status: red, yellow, green. */
export function SensorStatusBadge({
  sensor,
}: {
  sensor: { state: string; status: string | null };
}) {
  const colors = useAppColors();
  const tone = sensorTone(sensor);
  const palette =
    tone === "down"
      ? { bg: colors.errorSoft, fg: colors.error }
      : tone === "warning"
        ? { bg: colors.warningSoft, fg: colors.warning }
        : { bg: colors.successSoft, fg: colors.success };
  return (
    <View
      accessibilityLabel={`Status: ${SENSOR_TONE_LABELS[tone]}`}
      style={[styles.badge, { backgroundColor: palette.bg }]}
    >
      <Ionicons color={palette.fg} name={ICONS[tone]} size={13} />
      <Text style={[styles.text, { color: palette.fg }]}>
        {SENSOR_TONE_LABELS[tone]}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignItems: "center",
    alignSelf: "flex-start",
    borderRadius: 999,
    flexDirection: "row",
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  text: { fontSize: 12, fontWeight: "800" },
});
