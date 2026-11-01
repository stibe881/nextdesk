import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, Text, View } from "react-native";

import { deleteAccount } from "@/lib/account";
import { clearMobileWorkspace, nextDesk } from "@/lib/nextdesk-client";
import { unregisterPushDeviceBeforeSignOut } from "@/lib/push-notifications";
import { makeThemedStyles, useAppColors } from "@/lib/themed-styles";

/**
 * In-app account deletion (App Store Review Guideline 5.1.1(v)). Deletes the
 * account, its personal workspace and all data of that workspace.
 */
export function DeleteAccountButton({
  ownsWorkspace,
}: {
  /** Unknown (undefined) shows the general explanation. */
  ownsWorkspace?: boolean;
}) {
  const styles = useStyles();
  const colors = useAppColors();
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  async function runDeletion() {
    setDeleting(true);
    setError("");
    try {
      await unregisterPushDeviceBeforeSignOut().catch(() => undefined);
      await deleteAccount();
      await nextDesk?.auth.signOut({ scope: "local" }).catch(() => undefined);
      await clearMobileWorkspace();
      router.replace({ pathname: "/auth", params: { accountDeleted: "1" } });
    } catch (nextError) {
      setError(
        nextError instanceof Error && nextError.message
          ? nextError.message
          : "Das Konto konnte nicht gelöscht werden. Bitte versuche es erneut.",
      );
    } finally {
      setDeleting(false);
    }
  }

  function confirm() {
    Alert.alert(
      "Konto endgültig löschen?",
      ownsWorkspace === true
        ? "Dein Konto, dein Arbeitsbereich und alle darin gespeicherten Tickets, Dateien und Einträge werden unwiderruflich gelöscht. Eingeladene Teammitglieder verlieren den Zugriff auf diesen Arbeitsbereich."
        : ownsWorkspace === false
          ? "Dein Konto und deine persönlichen Daten werden unwiderruflich gelöscht."
          : "Dein Konto und deine persönlichen Daten werden unwiderruflich gelöscht. Besitzt du einen eigenen Arbeitsbereich, wird er mit allen Tickets und Dateien ebenfalls gelöscht. Arbeitsbereiche von Organisationen bleiben bestehen; du verlierst nur deinen Zugriff.",
      [
        { style: "cancel", text: "Abbrechen" },
        {
          onPress: () => void runDeletion(),
          style: "destructive",
          text: "Konto löschen",
        },
      ],
    );
  }

  return (
    <View style={styles.wrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ busy: deleting, disabled: deleting }}
        disabled={deleting}
        onPress={confirm}
        style={({ pressed }) => [
          styles.button,
          pressed && styles.pressed,
          deleting && styles.disabled,
        ]}
      >
        {deleting ? (
          <ActivityIndicator color={colors.error} />
        ) : (
          <Ionicons color={colors.error} name="trash-outline" size={19} />
        )}
        <Text style={styles.text}>
          {deleting ? "Konto wird gelöscht …" : "Konto löschen"}
        </Text>
      </Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const useStyles = makeThemedStyles((c) => ({
  wrap: { gap: 8 },
  button: {
    alignItems: "center",
    borderColor: c.errorBorder,
    borderRadius: 15,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    minHeight: 50,
    paddingHorizontal: 16,
  },
  text: { color: c.error, fontSize: 14, fontWeight: "900" },
  error: { color: c.error, fontSize: 13, lineHeight: 19, textAlign: "center" },
  pressed: { opacity: 0.82 },
  disabled: { opacity: 0.55 },
}));
