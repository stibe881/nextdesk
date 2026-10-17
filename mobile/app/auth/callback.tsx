import * as Linking from "expo-linking";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { completeNextDeskAuth } from "@/lib/nextdesk-client";

export default function AuthCallbackScreen() {
  const url = Linking.useURL();
  const [message, setMessage] = useState("Anmeldung wird abgeschlossen …");

  useEffect(() => {
    void (async () => {
      try {
        const callbackUrl = url ?? (await Linking.getInitialURL());
        if (!callbackUrl) throw new Error("Keine Anmeldeantwort erhalten.");
        await completeNextDeskAuth(callbackUrl);
        router.replace("/");
      } catch {
        setMessage(
          "Die Anmeldung konnte nicht abgeschlossen werden. Bitte fordere einen neuen Anmeldelink an.",
        );
      }
    })();
  }, [url]);

  return (
    <ScreenContainer containerClassName="bg-[#F6F7FB]" className="px-5">
      <View style={styles.content}>
        <ActivityIndicator color="#4438CA" size="large" />
        <Text style={styles.message}>{message}</Text>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: { alignItems: "center", flex: 1, gap: 16, justifyContent: "center" },
  message: {
    color: "#4B4C60",
    fontSize: 15,
    lineHeight: 23,
    textAlign: "center",
  },
});
