import { Ionicons } from "@expo/vector-icons";
import { useRouter, type Href } from "expo-router";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useMobileFeatures } from "@/components/mobile-feature-gate";
import { QUICK_CREATE } from "@/lib/quick-create-actions";
import { useAppColors } from "@/lib/themed-styles";

type QuickCreateMenuProps = {
  visible: boolean;
  onClose: () => void;
};

/**
 * Menu that opens on a long press of the Home tab: create a follow-up,
 * ticket, service task or inventory item, depending on the workspace.
 */
export function QuickCreateMenu({ visible, onClose }: QuickCreateMenuProps) {
  const colors = useAppColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isEnabled } = useMobileFeatures();
  const items = QUICK_CREATE.filter(
    (item) => !item.feature || isEnabled(item.feature),
  );

  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
      transparent
      visible={visible}
    >
      <Pressable
        accessibilityLabel="Menü schliessen"
        onPress={onClose}
        style={styles.backdrop}
      >
        <View
          accessibilityRole="menu"
          style={[
            styles.card,
            {
              marginBottom: Math.max(insets.bottom, 8) + 84,
              backgroundColor: colors.surface,
              borderColor: colors.border,
              shadowColor: colors.shadow,
            },
          ]}
        >
          <Text style={[styles.heading, { color: colors.muted }]}>
            Neu erfassen
          </Text>
          {items.map((item, index) => (
            <Pressable
              accessibilityRole="menuitem"
              key={item.id}
              onPress={() => {
                onClose();
                router.push(item.href as Href);
              }}
              style={({ pressed }) => [
                styles.item,
                index > 0 && {
                  borderTopColor: colors.border,
                  borderTopWidth: StyleSheet.hairlineWidth,
                },
                pressed && { backgroundColor: colors.primarySoft },
              ]}
            >
              <View
                style={[styles.icon, { backgroundColor: colors.primarySoft }]}
              >
                <Ionicons
                  color={colors.primaryText}
                  name={item.icon}
                  size={20}
                />
              </View>
              <Text style={[styles.label, { color: colors.foreground }]}>
                {item.title}
              </Text>
            </Pressable>
          ))}
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "flex-end",
    alignItems: "center",
    paddingHorizontal: 16,
    backgroundColor: "rgba(15, 23, 42, 0.35)",
  },
  card: {
    width: "100%",
    maxWidth: 360,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 6,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 20,
    elevation: 12,
  },
  heading: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  icon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    fontSize: 16,
    fontWeight: "600",
  },
});
