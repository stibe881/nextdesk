import { Pressable, StyleSheet, Text, View } from "react-native";

import { useAppColors } from "@/lib/themed-styles";

/** Kurze Rückmeldung am unteren Rand mit Rückgängig-Schaltfläche. */
export function UndoToast({
  message,
  onUndo,
}: {
  message: string;
  onUndo: () => void;
}) {
  const colors = useAppColors();
  return (
    <View
      accessibilityLiveRegion="polite"
      pointerEvents="box-none"
      style={styles.wrap}
    >
      <View style={[styles.toast, { backgroundColor: colors.foreground }]}>
        <Text style={[styles.text, { color: colors.background }]}>
          {message}
        </Text>
        <Pressable
          accessibilityLabel="Löschen rückgängig machen"
          accessibilityRole="button"
          hitSlop={10}
          onPress={onUndo}
        >
          <Text style={[styles.action, { color: colors.primarySoftBorder }]}>
            Rückgängig
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  action: { fontSize: 14, fontWeight: "900" },
  text: { flex: 1, fontSize: 14, fontWeight: "600" },
  toast: {
    alignItems: "center",
    borderRadius: 16,
    flexDirection: "row",
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  wrap: { bottom: 12, left: 16, position: "absolute", right: 16 },
});
