import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
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
  beginNextDeskMagicLink,
  beginNextDeskOAuth,
  clearNextDeskAuthTransaction,
  completeNextDeskAuth,
  createNativeNextDeskOAuthUrl,
  getNextDeskAuthRedirectUrl,
  nextDeskAuthFailureCode,
  nextDeskAuthFailureMessage,
  requireNextDesk,
} from "@/lib/nextdesk-client";

WebBrowser.maybeCompleteAuthSession();

const WEB_SSO_CALLBACK_MESSAGE = "nextdesk.sso.callback";
const NATIVE_SSO_OPEN_TIMEOUT_MS = 8_000;

async function openNativeSsoInSafari(providerUrl: string): Promise<void> {
  const supported = await Linking.canOpenURL(providerUrl);
  if (!supported) {
    throw new Error("Das sichere Anmeldefenster konnte nicht geöffnet werden.");
  }
  await Linking.openURL(providerUrl);
}

export default function AuthScreen() {
  const router = useRouter();
  const { authError } = useLocalSearchParams<{ authError?: string }>();
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState<"magic" | "sso" | null>(null);
  const popupRef = useRef<Window | null>(null);
  const popupMonitorRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const redirectTo = getNextDeskAuthRedirectUrl();
  const displayedMessage =
    message ||
    (pending === null && typeof authError === "string"
      ? nextDeskAuthFailureMessage(authError)
      : "");

  function stopPopupMonitor() {
    if (popupMonitorRef.current !== null) {
      clearInterval(popupMonitorRef.current);
      popupMonitorRef.current = null;
    }
  }

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;

    const handleCallback = (event: MessageEvent<unknown>) => {
      if (event.origin !== window.location.origin) return;
      const payload = event.data;
      if (
        typeof payload !== "object" ||
        payload === null ||
        !(
          "type" in payload &&
          (payload as { type?: unknown }).type === WEB_SSO_CALLBACK_MESSAGE
        ) ||
        !("callbackUrl" in payload) ||
        typeof (payload as { callbackUrl?: unknown }).callbackUrl !== "string"
      ) {
        return;
      }

      stopPopupMonitor();
      popupRef.current = null;
      setPending("sso");
      void completeNextDeskAuth(
        (payload as { callbackUrl: string }).callbackUrl,
      )
        .then(() => router.replace("/"))
        .catch((error) =>
          setMessage(
            nextDeskAuthFailureMessage(nextDeskAuthFailureCode(error)),
          ),
        )
        .finally(() => setPending(null));
    };

    window.addEventListener("message", handleCallback);
    return () => {
      window.removeEventListener("message", handleCallback);
      stopPopupMonitor();
    };
  }, [router]);

  async function continueWithSso() {
    setPending("sso");
    setMessage("SSO-Verbindung wird vorbereitet …");
    const webPopup =
      Platform.OS === "web" && typeof window !== "undefined"
        ? window.open("about:blank", "nextdesk-sso")
        : null;
    if (Platform.OS === "web" && !webPopup) {
      setPending(null);
      setMessage(
        "Das Anmeldefenster wurde blockiert. Bitte erlauben Sie Pop-ups für die Manus-Vorschau und versuchen Sie es erneut.",
      );
      return;
    }

    let waitingForWebCallback = false;
    try {
      const providerUrl =
        Platform.OS === "web"
          ? await (async () => {
              const { data, error } =
                await requireNextDesk().auth.signInWithOAuth({
                  provider: "azure",
                  options: {
                    redirectTo,
                    // Browser preview must redirect back to its HTTPS callback
                    // route instead of taking over the embedded frame.
                    scopes: "email",
                    skipBrowserRedirect: true,
                  },
                });
              if (error) throw error;
              return data.url;
            })()
          : await createNativeNextDeskOAuthUrl(redirectTo);
      if (!providerUrl)
        throw new Error("Die SSO-Anmeldung konnte nicht vorbereitet werden.");
      await beginNextDeskOAuth();
      if (Platform.OS === "web") {
        popupRef.current = webPopup;
        webPopup?.location.replace(providerUrl);
        waitingForWebCallback = true;
        popupMonitorRef.current = setInterval(() => {
          if (popupRef.current !== webPopup || !webPopup || !webPopup.closed) {
            return;
          }
          stopPopupMonitor();
          popupRef.current = null;
          setPending(null);
          setMessage("Die SSO-Anmeldung wurde abgebrochen.");
        }, 500);
        return;
      }
      const startedAt = Date.now();
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const timeoutResult = new Promise<{ type: "timeout" }>((resolve) => {
        timeout = setTimeout(
          () => resolve({ type: "timeout" }),
          NATIVE_SSO_OPEN_TIMEOUT_MS,
        );
      });
      const result = await Promise.race([
        WebBrowser.openAuthSessionAsync(providerUrl, redirectTo),
        timeoutResult,
      ]);
      if (timeout) clearTimeout(timeout);
      if (result.type === "success") {
        // ASWebAuthenticationSession returns the callback directly and does not
        // reliably emit a Linking event while the app stays warm. Exchange the
        // code here; the shared completion helper deduplicates cold-start links.
        await completeNextDeskAuth(result.url);
        setMessage("Anmeldung wird abgeschlossen …");
        router.replace("/");
      } else if (result.type === "cancel") {
        // Some iOS versions immediately cancel ASWebAuthenticationSession
        // without showing the sheet. Fall back only in that case to Safari;
        // the existing PKCE transaction and root deep-link handler complete
        // the return journey safely.
        if (Date.now() - startedAt < 1_500) {
          setMessage("Die Anmeldung wird in Safari geöffnet …");
          await openNativeSsoInSafari(providerUrl);
          setMessage(
            "Melden Sie sich in Safari an. nextDesk öffnet sich danach automatisch.",
          );
        } else {
          setMessage("Die SSO-Anmeldung wurde abgebrochen.");
        }
      } else if (result.type === "timeout") {
        WebBrowser.dismissAuthSession();
        setMessage("Die Anmeldung wird in Safari geöffnet …");
        await openNativeSsoInSafari(providerUrl);
        setMessage(
          "Melden Sie sich in Safari an. nextDesk öffnet sich danach automatisch.",
        );
      } else {
        setMessage(
          "Die Rückkehr aus dem Anmeldefenster wurde nicht erkannt. Bitte versuchen Sie die SSO-Anmeldung erneut.",
        );
      }
    } catch (error) {
      await clearNextDeskAuthTransaction();
      webPopup?.close();
      setMessage(nextDeskAuthFailureMessage(nextDeskAuthFailureCode(error)));
    } finally {
      if (!waitingForWebCallback) setPending(null);
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
      await beginNextDeskMagicLink();
      const { error } = await requireNextDesk().auth.signInWithOtp({
        email: address,
        options: { emailRedirectTo: redirectTo },
      });
      if (error) throw error;
      setMessage(
        "Der Anmeldelink wurde versendet. Öffnen Sie ihn auf diesem Gerät.",
      );
    } catch {
      await clearNextDeskAuthTransaction();
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
          onPressIn={() => {
            if (pending === null)
              setMessage("SSO-Verbindung wird vorbereitet …");
          }}
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
