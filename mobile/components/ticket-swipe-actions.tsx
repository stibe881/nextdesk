import { Ionicons } from "@expo/vector-icons";
import { useRef, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Swipeable from "react-native-gesture-handler/Swipeable";

import { useAppColors } from "@/lib/themed-styles";

/**
 * Wischaktionen für Ticketzeilen: nach rechts wischen für Zuweisen, Favorit
 * und Wiedervorlage, nach links wischen zum Löschen (mit Rückgängig-Frist).
 */
export function TicketSwipeActions({
  canAssign = false,
  canDelete,
  canFavorite,
  canFollowUp,
  children,
  enabled,
  favorite,
  onAssign,
  onDelete,
  onFavorite,
  onFollowUp,
}: {
  canAssign?: boolean;
  canDelete: boolean;
  canFavorite: boolean;
  canFollowUp: boolean;
  children: ReactNode;
  enabled: boolean;
  favorite: boolean;
  onAssign?: () => void;
  onDelete: () => void;
  onFavorite: () => void;
  onFollowUp: () => void;
}) {
  const colors = useAppColors();
  const swipeable = useRef<Swipeable>(null);

  const closeAndRun = (action: () => void) => {
    swipeable.current?.close();
    action();
  };

  const deleteNow = () => {
    swipeable.current?.close();
    onDelete();
  };

  const hasLeft = canAssign || canFavorite || canFollowUp;

  return (
    <Swipeable
      enabled={enabled && (hasLeft || canDelete)}
      friction={2}
      overshootLeft={false}
      overshootRight={false}
      ref={swipeable}
      renderLeftActions={() =>
        hasLeft ? (
          <View style={styles.group}>
            {canAssign && onAssign ? (
              <Pressable
                accessibilityLabel="Ticket mir zuweisen"
                accessibilityRole="button"
                onPress={() => closeAndRun(onAssign)}
                style={[styles.action, { backgroundColor: colors.foreground }]}
              >
                <Ionicons
                  color={colors.background}
                  name="person-add-outline"
                  size={20}
                />
                <Text style={[styles.text, { color: colors.background }]}>
                  Mir zuweisen
                </Text>
              </Pressable>
            ) : null}
            {canFavorite ? (
              <Pressable
                accessibilityLabel={
                  favorite
                    ? "Aus Favoriten entfernen"
                    : "Zu Favoriten hinzufügen"
                }
                accessibilityRole="button"
                onPress={() => closeAndRun(onFavorite)}
                style={[
                  styles.action,
                  { backgroundColor: colors.warningStrong },
                ]}
              >
                <Ionicons
                  color={colors.onWarningStrong}
                  name={favorite ? "star-outline" : "star"}
                  size={20}
                />
                <Text style={[styles.text, { color: colors.onWarningStrong }]}>
                  {favorite ? "Entfernen" : "Favorit"}
                </Text>
              </Pressable>
            ) : null}
            {canFollowUp ? (
              <Pressable
                accessibilityLabel="Wiedervorlage für heute setzen"
                accessibilityRole="button"
                onPress={() => closeAndRun(onFollowUp)}
                style={[styles.action, { backgroundColor: colors.primary }]}
              >
                <Ionicons
                  color={colors.onPrimary}
                  name="calendar-outline"
                  size={20}
                />
                <Text style={[styles.text, { color: colors.onPrimary }]}>
                  Wiedervorlage
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null
      }
      renderRightActions={() =>
        canDelete ? (
          <Pressable
            accessibilityLabel="Ticket löschen"
            accessibilityRole="button"
            onPress={deleteNow}
            style={[styles.action, { backgroundColor: colors.error }]}
          >
            <Ionicons color="#ffffff" name="trash-outline" size={20} />
            <Text style={[styles.text, { color: "#ffffff" }]}>Löschen</Text>
          </Pressable>
        ) : null
      }
    >
      {children}
    </Swipeable>
  );
}

const styles = StyleSheet.create({
  action: {
    alignItems: "center",
    borderRadius: 18,
    gap: 4,
    justifyContent: "center",
    marginVertical: 1,
    minWidth: 88,
    paddingHorizontal: 12,
  },
  group: { flexDirection: "row", gap: 6, paddingRight: 6 },
  text: { fontSize: 11, fontWeight: "900" },
});
