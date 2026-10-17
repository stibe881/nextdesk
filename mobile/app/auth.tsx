import * as WebBrowser from "expo-web-browser";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import {
  completeNextDeskAuth,
  getNextDeskAuthRedirectUrl,
  nextDeskAuthFailureCode,
  nextDeskAuthFailureMessage,
  requireNextDesk,
} from "@/lib/nextdesk-client";

WebBrowser.maybeCompleteAuthSession();

export default function AuthScreen() {
  const { authError } = useLocalSearchParams<{ authError?: string }>();
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState<"magic" | "sso" | null>(null);
  const redirectTo = getNextDeskAuthRedirectUrl();
  const displayedMessage =
    message ||
    (pending === null && typeof authError === "string"
      ? nextDeskAuthFailureMessage(authError)
      : "");

  async function continueWithSso() {
    setPending("sso");
    setMessage("");
    try {
      const client = requireNextDesk();
      const { data, error } = await client.auth.signInWithOAuth({
        provider: "azure",
        options: {
          redirectTo,
          // Supabase Azure Auth requires this scope to receive an address that
          // can safely identify and link the signed-in person.
          scopes: "email",
          // Browser preview must redirect back to its HTTPS callback route.
          // Native iOS still hands the browser result to the app's deep link.
          skipBrowserRedirect: true,
        },
      });
      if (error) throw error;
      if (!data.url)
        throw new Error("Die SSO-Anmeldung konnte nicht vorbereitet werden.");
      if (Platform.OS === "web") {
        window.location.assign(data.url);
        return;
      }
      const result = await WebBrowser.openAuthSessionAsync(
        data.url,
        redirectTo,
      );
      if (result.type === "success") {
        // ASWebAuthenticationSession returns the callback directly and does not
        // reliably emit a Linking event while the app stays warm. Exchange the
        // code here; the shared completion helper deduplicates cold-start links.
        await completeNextDeskAuth(result.url);
        setMessage("Anmeldung wird abgeschlossen …");
        router.replace("/(tabs)");
      } else if (result.type !== "cancel") {
        setMessage(
          "Die Rückkehr aus dem Anmeldefenster wurde nicht erkannt. Bitte versuchen Sie die SSO-Anmeldung erneut.",
        );
      }
    } catch (error) {
      setMessage(nextDeskAuthFailureMessage(nextDeskAuthFailureCode(error)));
    } finally {
      setPending(null);
    }
  }

  async function sendMagicLink() {
    const address = email.trim().toLowerCase();
    if (!address.includes("@")) {
      setMessage("Bitte geben Sie eine gültige E-Mail-Adresse ein.");
      return;
    }
    setPending("magic");
    setMessage("");
    try {
      const { error } = await requireNextDesk().auth.signInWithOtp({
        email: address,
        options: { emailRedirectTo: redirectTo },
      });
      if (error) throw error;
      setMessage(
        "Der Anmeldelink wurde versendet. Öffnen Sie ihn auf diesem Gerät.",
      );
    } catch {
      setMessage(
        "Der Anmeldelink konnte nicht versendet werden. Bitte versuchen Sie es erneut.",
      );
    } finally {
      setPending(null);
    }
  }

  return (
    <ScreenContainer containerClassName="bg-[#F6F7FB]" className="px-5">
      <View style={styles.content}>
        <View style={styles.logoMark}>
          <Text style={styles.logoLetter}>n</Text>
        </View>
        <Text style={styles.brand}>nextDesk</Text>
        <Text style={styles.title}>
          Melde dich an, um deine Tickets zu bearbeiten.
        </Text>

        <Pressable
          accessibilityRole="button"
          disabled={pending !== null}
          onPress={() => void continueWithSso()}
          style={[styles.ssoButton, pending !== null && styles.disabled]}
        >
          <Text style={styles.ssoButtonText}>
            {pending === "sso" ? "SSO wird geöffnet …" : "MIT SSO ANMELDEN"}
          </Text>
        </Pressable>

        <View style={styles.divider}>
          <View style={styles.line} />
          <Text style={styles.dividerText}>oder mit E-Mail</Text>
          <View style={styles.line} />
        </View>

        <TextInput
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          onChangeText={setEmail}
          placeholder="name@unternehmen.ch"
          placeholderTextColor="#9A99AA"
          style={styles.input}
          textContentType="emailAddress"
          value={email}
        />
        <Pressable
          accessibilityRole="button"
          disabled={pending !== null}
          onPress={() => void sendMagicLink()}
          style={[styles.magicButton, pending !== null && styles.disabled]}
        >
          <Text style={styles.magicButtonText}>
            {pending === "magic"
              ? "Link wird versendet …"
              : "Anmeldelink senden"}
          </Text>
        </Pressable>
        {displayedMessage ? (
          <Text style={styles.message}>{displayedMessage}</Text>
        ) : null}
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, gap: 15, justifyContent: "center", paddingBottom: 36 },
  logoMark: {
    alignItems: "center",
    backgroundColor: "#4438CA",
    borderRadius: 18,
    height: 52,
    justifyContent: "center",
    width: 52,
  },
  logoLetter: { color: "#FFFFFF", fontSize: 28, fontWeight: "900" },
  brand: {
    color: "#202136",
    fontSize: 30,
    fontWeight: "900",
    letterSpacing: -0.9,
  },
  title: { color: "#626376", fontSize: 16, lineHeight: 24, marginBottom: 16 },
  ssoButton: {
    alignItems: "center",
    backgroundColor: "#4438CA",
    borderRadius: 15,
    justifyContent: "center",
    minHeight: 52,
    paddingHorizontal: 18,
  },
  ssoButtonText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: 0.25,
  },
  divider: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    marginTop: 4,
  },
  line: { backgroundColor: "#DFDFE9", flex: 1, height: 1 },
  dividerText: { color: "#77758C", fontSize: 12 },
  input: {
    backgroundColor: "#FFFFFF",
    borderColor: "#E5E5EF",
    borderRadius: 14,
    borderWidth: 1,
    color: "#202136",
    fontSize: 15,
    minHeight: 52,
    paddingHorizontal: 14,
  },
  magicButton: {
    alignItems: "center",
    backgroundColor: "#EEECFF",
    borderRadius: 15,
    justifyContent: "center",
    minHeight: 52,
    paddingHorizontal: 18,
  },
  magicButtonText: { color: "#4438CA", fontSize: 14, fontWeight: "800" },
  message: { color: "#4B4C60", fontSize: 13, lineHeight: 19, marginTop: 2 },
  disabled: { opacity: 0.55 },
});
