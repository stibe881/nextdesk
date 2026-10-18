import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { hapticSelection } from "@/lib/mobile-haptics";
import { useThemeContext } from "@/lib/theme-provider";

type OnsiteModeProps = {
  canAddPhoto: boolean;
  canScanAsset: boolean;
  canWriteInternalNote: boolean;
  onAddPhoto: () => void;
  onScanAsset: () => void;
  onWriteInternalNote: () => void;
};

type QuickAction = {
  accessibilityLabel: string;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
};

export function OnsiteMode({
  canAddPhoto,
  canScanAsset,
  canWriteInternalNote,
  onAddPhoto,
  onScanAsset,
  onWriteInternalNote,
}: OnsiteModeProps) {
  const { colors, density } = useThemeContext();
  const [enabled, setEnabled] = useState(false);
  const actions: QuickAction[] = [
    ...(canAddPhoto
      ? [
          {
            accessibilityLabel: "Fotoanhang öffnen",
            icon: "camera-outline" as const,
            label: "Fotoanhang",
            onPress: onAddPhoto,
          },
        ]
      : []),
    ...(canWriteInternalNote
      ? [
          {
            accessibilityLabel: "Interne Notiz verfassen",
            icon: "lock-closed-outline" as const,
            label: "Interne Notiz",
            onPress: onWriteInternalNote,
          },
        ]
      : []),
    ...(canScanAsset
      ? [
          {
            accessibilityLabel: "Asset scannen",
            icon: "scan-outline" as const,
            label: "Asset scannen",
            onPress: onScanAsset,
          },
        ]
      : []),
  ];

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.surface,
          borderColor: enabled ? colors.primary : colors.border,
          padding: density === "compact" ? 14 : 17,
        },
      ]}
    >
      <View style={styles.header}>
        <View style={styles.copy}>
          <Text style={[styles.eyebrow, { color: colors.muted }]}>VOR ORT</Text>
          <Text style={[styles.title, { color: colors.foreground }]}>
            Vor-Ort-Modus
          </Text>
          <Text style={[styles.description, { color: colors.muted }]}>
            Grosse Schnellzugriffe für Einsätze vor Ort. Der Modus ändert keine
            Ticketdaten.
          </Text>
        </View>
        <View style={[styles.icon, { backgroundColor: colors.primary + "1A" }]}>
          <Ionicons color={colors.primary} name="construct-outline" size={22} />
        </View>
      </View>

      <Pressable
        accessibilityLabel={
          enabled ? "Vor-Ort-Modus ausschalten" : "Vor-Ort-Modus einschalten"
        }
        accessibilityRole="switch"
        accessibilityState={{ checked: enabled }}
        onPress={() => {
          setEnabled((current) => !current);
          hapticSelection();
        }}
        style={[
          styles.toggle,
          {
            backgroundColor: enabled
              ? colors.primary + "16"
              : colors.background,
            borderColor: enabled ? colors.primary : colors.border,
          },
        ]}
      >
        <Ionicons
          color={enabled ? colors.primary : colors.muted}
          name={enabled ? "checkmark-circle-outline" : "power-outline"}
          size={20}
        />
        <Text
          style={[
            styles.toggleText,
            { color: enabled ? colors.primary : colors.foreground },
          ]}
        >
          {enabled ? "Vor-Ort-Modus aktiv" : "Vor-Ort-Modus einschalten"}
        </Text>
      </Pressable>

      {enabled ? (
        actions.length > 0 ? (
          <View style={styles.actions}>
            {actions.map((action) => (
              <Pressable
                accessibilityLabel={action.accessibilityLabel}
                accessibilityRole="button"
                key={action.label}
                onPress={() => {
                  hapticSelection();
                  action.onPress();
                }}
                style={[
                  styles.action,
                  {
                    backgroundColor: colors.background,
                    borderColor: colors.border,
                  },
                ]}
              >
                <Ionicons color={colors.primary} name={action.icon} size={27} />
                <Text style={[styles.actionText, { color: colors.foreground }]}>
                  {action.label}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : (
          <Text style={[styles.unavailable, { color: colors.muted }]}>
            Für dieses Ticket stehen keine Vor-Ort-Schnellzugriffe zur
            Verfügung.
          </Text>
        )
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  action: {
    alignItems: "center",
    borderRadius: 16,
    borderWidth: 1,
    flex: 1,
    gap: 7,
    justifyContent: "center",
    minHeight: 88,
    padding: 10,
  },
  actionText: { fontSize: 13, fontWeight: "800", textAlign: "center" },
  actions: { flexDirection: "row", gap: 9 },
  card: { borderRadius: 20, borderWidth: 1, gap: 13 },
  copy: { flex: 1, gap: 3 },
  description: { fontSize: 12, lineHeight: 18 },
  eyebrow: { fontSize: 10, fontWeight: "800", letterSpacing: 0.9 },
  header: { alignItems: "flex-start", flexDirection: "row", gap: 10 },
  icon: {
    alignItems: "center",
    borderRadius: 14,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  title: { fontSize: 16, fontWeight: "800", lineHeight: 21 },
  toggle: {
    alignItems: "center",
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    minHeight: 53,
    paddingHorizontal: 14,
  },
  toggleText: { fontSize: 14, fontWeight: "800" },
  unavailable: { fontSize: 12, lineHeight: 18 },
});
