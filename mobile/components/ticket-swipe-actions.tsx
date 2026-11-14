import { Ionicons } from "@expo/vector-icons";
import { useRef, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Swipeable from "react-native-gesture-handler/Swipeable";

import { useAppColors } from "@/lib/themed-styles";

/**
 * Wischaktionen für Ticketzeilen: nach rechts wischen für Zuweisen, Beobachten
 * und Wiedervorlage, nach links wischen für Spam (mit Rückfrage) und zum Löschen (mit
 * Rückgängig-Frist).
 */
export function TicketSwipeActions({
  canAssign = false,
  canDelete,
  canSpam = false,
  canWatch,
  canFollowUp,
  children,
  enabled,
  watched,
  onAssign,
  onDelete,
  onSpam,
  onWatch,
  onFollowUp,
}: {
  canAssign?: boolean;
  canDelete: boolean;
  canSpam?: boolean;
  canWatch: boolean;
  canFollowUp: boolean;
  children: ReactNode;
  enabled: boolean;
  watched: boolean;
  onAssign?: () => void;
  onDelete: () => void;
  onSpam?: () => void;
  onWatch: () => void;
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

  const hasLeft = canAssign || canWatch || canFollowUp;
  const showSpam = canDelete && canSpam && Boolean(onSpam);

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
            {canWatch ? (
              <Pressable
                accessibilityLabel={
                  watched ? "Nicht mehr beobachten" : "Beobachten"
                }
                accessibilityRole="button"
                onPress={() => closeAndRun(onWatch)}
                style={[
                  styles.action,
                  { backgroundColor: colors.warningStrong },
                ]}
              >
                <Ionicons
                  color={colors.onWarningStrong}
                  name={watched ? "eye-off-outline" : "eye-outline"}
                  size={20}
                />
                <Text style={[styles.text, { color: colors.onWarningStrong }]}>
                  {watched ? "Nicht mehr" : "Beobachten"}
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
          <View style={styles.group}>
            {showSpam && onSpam ? (
              <Pressable
                accessibilityLabel="Ticket als Spam markieren"
                accessibilityRole="button"
                onPress={() => closeAndRun(onSpam)}
                style={[
                  styles.action,
                  { backgroundColor: colors.warningStrong },
                ]}
              >
                <Ionicons
                  color={colors.onWarningStrong}
                  name="mail-unread-outline"
                  size={20}
                />
                <Text style={[styles.text, { color: colors.onWarningStrong }]}>
                  Spam
                </Text>
              </Pressable>
            ) : null}
            <Pressable
              accessibilityLabel="Ticket löschen"
              accessibilityRole="button"
              onPress={deleteNow}
              style={[styles.action, { backgroundColor: colors.error }]}
            >
              <Ionicons color="#ffffff" name="trash-outline" size={20} />
              <Text style={[styles.text, { color: "#ffffff" }]}>Löschen</Text>
            </Pressable>
          </View>
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
