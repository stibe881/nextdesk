import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { makeThemedStyles, useAppColors } from "@/lib/themed-styles";
import {
  completeNextDeskAuth,
  nextDeskAuthFailureCode,
  nextDeskAuthFailureMessage,
} from "@/lib/nextdesk-client";

const WEB_SSO_CALLBACK_MESSAGE = "nextdesk.sso.callback";

export default function AuthCallbackScreen() {
  const router = useRouter();
  const colors = useAppColors();
  const styles = useStyles();
  const [failed, setFailed] = useState(false);
  const [message, setMessage] = useState("Anmeldung wird abgeschlossen …");

  useEffect(() => {
    // A Manus preview is still a browser even when it is presented inside a
    // mobile shell. `Platform.OS` can therefore be native-looking there; the
    // browser global is the reliable capability check for an HTTPS callback.
    if (typeof window === "undefined") return;
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage(
        { type: WEB_SSO_CALLBACK_MESSAGE, callbackUrl: window.location.href },
        window.location.origin,
      );
      window.close();
      return;
    }
    let active = true;
    void completeNextDeskAuth(window.location.href)
      .then(() => {
        if (active) router.replace("/");
      })
      .catch((error) => {
        if (active) {
          setMessage(
            nextDeskAuthFailureMessage(nextDeskAuthFailureCode(error)),
          );
          setFailed(true);
        }
      });
    return () => {
      active = false;
    };
  }, [router]);

  return (
    <ScreenContainer className="px-5">
      <View style={styles.content}>
        {failed ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.replace("/auth")}
            style={styles.backButton}
          >
            <Text style={styles.backButtonText}>Zur Anmeldung</Text>
          </Pressable>
        ) : (
          <ActivityIndicator color={colors.primary} size="large" />
        )}
        <Text style={styles.message}>{message}</Text>
      </View>
    </ScreenContainer>
  );
}

const useStyles = makeThemedStyles((c) => ({
  content: { alignItems: "center", flex: 1, gap: 16, justifyContent: "center" },
  message: {
    color: c.text,
    fontSize: 15,
    lineHeight: 23,
    textAlign: "center",
  },
  backButton: {
    backgroundColor: c.primarySoft,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backButtonText: { color: c.primaryText, fontSize: 14, fontWeight: "800" },
}));
