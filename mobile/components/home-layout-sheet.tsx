import { Ionicons } from "@expo/vector-icons";
import { Modal, Pressable, ScrollView, Switch, Text, View } from "react-native";

import {
  HOME_SECTIONS,
  DEFAULT_HOME_LAYOUT,
  isHomeLayoutDefault,
  moveHomeSection,
  toggleHomeSection,
  type HomeLayout,
} from "@/lib/home-layout";
import { makeThemedStyles, useAppColors } from "@/lib/themed-styles";

/**
 * «Home anpassen»: sections of the home screen can be switched on and off and
 * moved up or down. Each person arranges their own home screen.
 */
export function HomeLayoutSheet({
  layout,
  onChange,
  onClose,
  visible,
}: {
  layout: HomeLayout;
  onChange: (layout: HomeLayout) => void;
  onClose: () => void;
  visible: boolean;
}) {
  const styles = useStyles();
  const colors = useAppColors();

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="pageSheet"
      visible={visible}
    >
      <View style={styles.root}>
        <View style={styles.header}>
          <View style={styles.headerCopy}>
            <Text accessibilityRole="header" style={styles.title}>
              Home anpassen
            </Text>
            <Text style={styles.subtitle}>
              Bereiche ein- oder ausblenden und mit den Pfeilen verschieben. Das
              gilt nur für dich.
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={onClose}
            style={styles.done}
          >
            <Text style={styles.doneText}>Fertig</Text>
          </Pressable>
        </View>
        <ScrollView
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
        >
          {layout.order.map((id, index) => {
            const section = HOME_SECTIONS.find((item) => item.id === id);
            if (!section) return null;
            const shown = !layout.hidden.includes(id);
            return (
              <View
                key={id}
                style={[styles.row, shown ? null : styles.rowHidden]}
              >
                <View style={styles.rowCopy}>
                  <Text style={styles.rowTitle}>{section.label}</Text>
                  <Text style={styles.rowDescription}>
                    {section.description}
                  </Text>
                </View>
                <View style={styles.arrows}>
                  <Pressable
                    accessibilityLabel={`${section.label} nach oben`}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: index === 0 }}
                    disabled={index === 0}
                    hitSlop={6}
                    onPress={() => onChange(moveHomeSection(layout, id, -1))}
                    style={[styles.arrow, index === 0 ? styles.arrowOff : null]}
                  >
                    <Ionicons
                      color={colors.primaryText}
                      name="chevron-up"
                      size={20}
                    />
                  </Pressable>
                  <Pressable
                    accessibilityLabel={`${section.label} nach unten`}
                    accessibilityRole="button"
                    accessibilityState={{
                      disabled: index === layout.order.length - 1,
                    }}
                    disabled={index === layout.order.length - 1}
                    hitSlop={6}
                    onPress={() => onChange(moveHomeSection(layout, id, 1))}
                    style={[
                      styles.arrow,
                      index === layout.order.length - 1
                        ? styles.arrowOff
                        : null,
                    ]}
                  >
                    <Ionicons
                      color={colors.primaryText}
                      name="chevron-down"
                      size={20}
                    />
                  </Pressable>
                </View>
                <Switch
                  accessibilityLabel={`${section.label} anzeigen`}
                  onValueChange={() => onChange(toggleHomeSection(layout, id))}
                  trackColor={{
                    false: colors.borderStrong,
                    true: colors.primary,
                  }}
                  value={shown}
                />
              </View>
            );
          })}
          <Pressable
            accessibilityRole="button"
            disabled={isHomeLayoutDefault(layout)}
            onPress={() => onChange(DEFAULT_HOME_LAYOUT)}
            style={[
              styles.reset,
              isHomeLayoutDefault(layout) ? styles.arrowOff : null,
            ]}
          >
            <Ionicons color={colors.primaryText} name="refresh" size={16} />
            <Text style={styles.resetText}>Standard wiederherstellen</Text>
          </Pressable>
        </ScrollView>
      </View>
    </Modal>
  );
}

const useStyles = makeThemedStyles((c) => ({
  root: { backgroundColor: c.background, flex: 1 },
  header: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 12,
    padding: 20,
    paddingBottom: 12,
  },
  headerCopy: { flex: 1, gap: 4 },
  title: { color: c.foreground, fontSize: 24, fontWeight: "900" },
  subtitle: { color: c.muted, fontSize: 13, lineHeight: 19 },
  done: {
    backgroundColor: c.primary,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  doneText: { color: "#FFFFFF", fontSize: 14, fontWeight: "900" },
  list: { gap: 8, padding: 20, paddingTop: 8 },
  row: {
    alignItems: "center",
    backgroundColor: c.surface,
    borderColor: c.border,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    padding: 12,
  },
  rowHidden: { opacity: 0.6 },
  rowCopy: { flex: 1, gap: 2 },
  rowTitle: { color: c.foreground, fontSize: 15, fontWeight: "900" },
  rowDescription: { color: c.muted, fontSize: 12, lineHeight: 16 },
  arrows: { flexDirection: "row", gap: 4 },
  arrow: {
    alignItems: "center",
    backgroundColor: c.surfaceSubtle,
    borderRadius: 10,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  arrowOff: { opacity: 0.35 },
  reset: {
    alignItems: "center",
    alignSelf: "center",
    flexDirection: "row",
    gap: 6,
    marginTop: 8,
    padding: 10,
  },
  resetText: { color: c.primaryText, fontSize: 13, fontWeight: "800" },
}));
