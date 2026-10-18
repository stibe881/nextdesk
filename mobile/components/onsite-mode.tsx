import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { hapticSelection } from "@/lib/mobile-haptics";
import { useThemeContext } from "@/lib/theme-provider";
import { makeThemedStyles, useAppColors } from "@/lib/themed-styles";

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
  const { density } = useThemeContext();
  const colors = useAppColors();
  const styles = useStyles();
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
        enabled && styles.cardEnabled,
        { padding: density === "compact" ? 14 : 17 },
      ]}
    >
      <View style={styles.header}>
        <View style={styles.copy}>
          <Text style={styles.eyebrow}>VOR ORT</Text>
          <Text style={styles.title}>Vor-Ort-Modus</Text>
          <Text style={styles.description}>
            Grosse Schnellzugriffe für Einsätze vor Ort. Der Modus ändert keine
            Ticketdaten.
          </Text>
        </View>
        <View style={styles.icon}>
          <Ionicons
            color={colors.primaryText}
            name="construct-outline"
            size={22}
          />
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
        style={[styles.toggle, enabled && styles.toggleEnabled]}
      >
        <Ionicons
          color={enabled ? colors.primaryText : colors.muted}
          name={enabled ? "checkmark-circle-outline" : "power-outline"}
          size={20}
        />
        <Text style={[styles.toggleText, enabled && styles.toggleTextEnabled]}>
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
                style={styles.action}
              >
                <Ionicons
                  color={colors.primaryText}
                  name={action.icon}
                  size={27}
                />
                <Text style={styles.actionText}>{action.label}</Text>
              </Pressable>
            ))}
          </View>
        ) : (
          <Text style={styles.unavailable}>
            Für dieses Ticket stehen keine Vor-Ort-Schnellzugriffe zur
            Verfügung.
          </Text>
        )
      ) : null}
    </View>
  );
}

const useStyles = makeThemedStyles((c) => ({
  action: {
    alignItems: "center",
    backgroundColor: c.surfaceSubtle,
    borderColor: c.border,
    borderRadius: 16,
    borderWidth: 1,
    flex: 1,
    gap: 7,
    justifyContent: "center",
    minHeight: 88,
    padding: 10,
  },
  actionText: {
    color: c.foreground,
    fontSize: 13,
    fontWeight: "800",
    textAlign: "center",
  },
  actions: { flexDirection: "row", gap: 9 },
  card: {
    backgroundColor: c.surface,
    borderColor: c.border,
    borderRadius: 20,
    borderWidth: 1,
    gap: 13,
  },
  cardEnabled: { borderColor: c.primaryText },
  copy: { flex: 1, gap: 3 },
  description: { color: c.muted, fontSize: 12, lineHeight: 18 },
  eyebrow: {
    color: c.muted,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.9,
  },
  header: { alignItems: "flex-start", flexDirection: "row", gap: 10 },
  icon: {
    alignItems: "center",
    backgroundColor: c.primarySoft,
    borderRadius: 14,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  title: {
    color: c.foreground,
    fontSize: 16,
    fontWeight: "800",
    lineHeight: 21,
  },
  toggle: {
    alignItems: "center",
    backgroundColor: c.surfaceSubtle,
    borderColor: c.border,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    minHeight: 53,
    paddingHorizontal: 14,
  },
  toggleEnabled: { backgroundColor: c.primarySoft, borderColor: c.primaryText },
  toggleText: { color: c.foreground, fontSize: 14, fontWeight: "800" },
  toggleTextEnabled: { color: c.primaryText },
  unavailable: { color: c.muted, fontSize: 12, lineHeight: 18 },
}));
