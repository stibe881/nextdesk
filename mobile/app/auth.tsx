import Constants from "expo-constants";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useRef, useState } from "react";
import { Platform, Pressable, Text, TextInput, View } from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { makeThemedStyles, useAppColors } from "@/lib/themed-styles";
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
import { withTimeout } from "@/lib/pkce";

WebBrowser.maybeCompleteAuthSession();

const NATIVE_SSO_OPEN_TIMEOUT_MS = 8_000;
const NATIVE_SSO_PREPARE_TIMEOUT_MS = 10_000;
// iOS can report a stale on-screen position for a freshly shown screen. A
// generous retention area keeps such a tap from being treated as "moved away".
const RELIABLE_PRESS_RETENTION = {
  bottom: 400,
  left: 400,
  right: 400,
  top: 400,
};
const APP_VERSION_LABEL = (() => {
  const version = Constants.expoConfig?.version ?? "";
  const build =
    Constants.platform?.ios?.buildNumber ??
    Constants.expoConfig?.ios?.buildNumber ??
    "";
  if (!version && !build) return "";
  return `nextDesk ${version}${build ? ` · Build ${build}` : ""}`;
})();

function preparationFailureMessage(error: unknown): string {
  const detail = error instanceof Error ? error.message.trim() : "";
  return detail
    ? `Die SSO-Anmeldung konnte nicht vorbereitet werden. ${detail}`
    : "Die SSO-Anmeldung konnte nicht vorbereitet werden. Bitte versuchen Sie es erneut.";
}

async function openNativeSsoInSafari(providerUrl: string): Promise<void> {
  const supported = await Linking.canOpenURL(providerUrl);
  if (!supported) {
    throw new Error("Das sichere Anmeldefenster konnte nicht geöffnet werden.");
  }
  await Linking.openURL(providerUrl);
}

export default function AuthScreen() {
  const router = useRouter();
  const colors = useAppColors();
  const styles = useStyles();
  const { authError } = useLocalSearchParams<{ authError?: string }>();
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [password, setPassword] = useState("");
  const [passwordMode, setPasswordMode] = useState(false);
  const [pending, setPending] = useState<"magic" | "password" | "sso" | null>(
    null,
  );
  // Synchronous guard: a single tap may report both onPressOut and onPress.
  const ssoStartingRef = useRef(false);
  const magicStartingRef = useRef(false);
  const redirectTo = getNextDeskAuthRedirectUrl();
  const displayedMessage =
    message ||
    (pending === null && typeof authError === "string"
      ? nextDeskAuthFailureMessage(authError)
      : "");

  async function continueWithSso() {
    setPending("sso");
    setMessage("Sichere SSO-Anmeldung wird vorbereitet …");
    let stage: "prepare" | "browser" = "prepare";
    try {
      const providerUrl =
        Platform.OS === "web"
          ? await (async () => {
              const { data, error } =
                await requireNextDesk().auth.signInWithOAuth({
                  provider: "azure",
                  options: {
                    redirectTo,
                    // Profile claims keep the visible Entra name intact; email
                    // remains required for serverseitige Mandantenrouting.
                    // Browser preview must redirect back to its HTTPS callback
                    // route instead of taking over the embedded frame.
                    scopes: "openid profile email",
                    skipBrowserRedirect: true,
                  },
                });
              if (error) throw error;
              return data.url;
            })()
          : await withTimeout(
              createNativeNextDeskOAuthUrl(redirectTo),
              NATIVE_SSO_PREPARE_TIMEOUT_MS,
              "Die Vorbereitung hat zu lange gedauert. Bitte versuchen Sie es erneut.",
            );
      if (!providerUrl)
        throw new Error("Die SSO-Anmeldung konnte nicht vorbereitet werden.");
      await beginNextDeskOAuth();
      stage = "browser";
      if (Platform.OS === "web" && typeof window !== "undefined") {
        // Manus kann Pop-ups aus einer eingebetteten Vorschau unsichtbar
        // behandeln. Die Callback-Seite unterstützt die Rückkehr ohne opener,
        // deshalb bleibt der OAuth-Fluss im selben sicheren Browser-Tab.
        window.location.assign(providerUrl);
        return;
      }
      setMessage("Microsoft-Anmeldung wird geöffnet …");
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
      await withTimeout(
        clearNextDeskAuthTransaction(),
        3_000,
        "Auth-Transaktion konnte nicht entfernt werden.",
      ).catch(() => undefined);
      setMessage(
        stage === "prepare" && Platform.OS !== "web"
          ? preparationFailureMessage(error)
          : nextDeskAuthFailureMessage(nextDeskAuthFailureCode(error)),
      );
    } finally {
      setPending(null);
    }
  }

  function startSsoOnce() {
    if (ssoStartingRef.current || pending !== null) return;
    ssoStartingRef.current = true;
    void continueWithSso().finally(() => {
      ssoStartingRef.current = false;
    });
  }

  function startMagicLinkOnce() {
    if (magicStartingRef.current || pending !== null) return;
    magicStartingRef.current = true;
    void sendMagicLink().finally(() => {
      magicStartingRef.current = false;
    });
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

  // Anmeldung mit E-Mail und Passwort, z. B. für das Testkonto der App-Prüfung.
  async function signInWithPassword() {
    const address = email.trim().toLowerCase();
    if (!address.includes("@") || !password) {
      setMessage("Bitte geben Sie E-Mail-Adresse und Passwort ein.");
      return;
    }
    setPending("password");
    setMessage("");
    try {
      const client = requireNextDesk();
      const { error } = await client.auth.signInWithPassword({
        email: address,
        password,
      });
      if (error) throw error;
      const {
        data: { session },
      } = await client.auth.getSession();
      if (!session) throw new Error("session_not_saved");
      setPassword("");
      router.replace("/");
    } catch {
      setMessage(
        "Die Anmeldung war nicht möglich. Bitte prüfen Sie E-Mail-Adresse und Passwort.",
      );
    } finally {
      setPending(null);
    }
  }

  return (
    <ScreenContainer className="px-5">
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
          accessibilityLabel="Mit SSO anmelden"
          accessibilityState={{
            busy: pending === "sso",
            disabled: pending !== null,
          }}
          disabled={pending !== null}
          hitSlop={8}
          pressRetentionOffset={RELIABLE_PRESS_RETENTION}
          onPress={startSsoOnce}
          // On iOS a tap must never be lost: if the system cancels the press
          // before onPress, the release still starts the sign-in exactly once.
          onPressOut={Platform.OS === "web" ? undefined : startSsoOnce}
          style={({ pressed }) => [
            styles.ssoButton,
            pressed && styles.pressed,
            pending !== null && styles.disabled,
          ]}
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
          placeholderTextColor={colors.subtle}
          style={styles.input}
          textContentType="emailAddress"
          value={email}
        />
        <Pressable
          accessibilityRole="button"
          disabled={pending !== null}
          hitSlop={8}
          pressRetentionOffset={RELIABLE_PRESS_RETENTION}
          onPress={startMagicLinkOnce}
          onPressOut={Platform.OS === "web" ? undefined : startMagicLinkOnce}
          style={({ pressed }) => [
            styles.magicButton,
            pressed && styles.pressed,
            pending !== null && styles.disabled,
          ]}
        >
          <Text style={styles.magicButtonText}>
            {pending === "magic"
              ? "Link wird versendet …"
              : "Anmeldelink senden"}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: passwordMode }}
          disabled={pending !== null}
          hitSlop={8}
          onPress={() => setPasswordMode((current) => !current)}
        >
          <Text style={styles.passwordToggle}>
            {passwordMode ? "Passwort-Anmeldung ausblenden" : "Mit Passwort anmelden"}
          </Text>
        </Pressable>
        {passwordMode ? (
          <>
            <TextInput
              autoCapitalize="none"
              autoComplete="current-password"
              autoCorrect={false}
              onChangeText={setPassword}
              onSubmitEditing={() => void signInWithPassword()}
              placeholder="Passwort"
              placeholderTextColor={colors.subtle}
              returnKeyType="go"
              secureTextEntry
              style={styles.input}
              textContentType="password"
              value={password}
            />
            <Pressable
              accessibilityRole="button"
              disabled={pending !== null}
              hitSlop={8}
              onPress={() => void signInWithPassword()}
              style={({ pressed }) => [
                styles.ssoButton,
                pressed && styles.pressed,
                pending !== null && styles.disabled,
              ]}
            >
              <Text style={styles.ssoButtonText}>
                {pending === "password" ? "Anmeldung läuft …" : "ANMELDEN"}
              </Text>
            </Pressable>
          </>
        ) : null}
        {/* Fixed slot: status text must not shift the buttons during a tap. */}
        <View style={styles.messageSlot}>
          {displayedMessage ? (
            <Text accessibilityLiveRegion="polite" style={styles.message}>
              {displayedMessage}
            </Text>
          ) : null}
        </View>
        {APP_VERSION_LABEL ? (
          <Text style={styles.version}>{APP_VERSION_LABEL}</Text>
        ) : null}
      </View>
    </ScreenContainer>
  );
}

const useStyles = makeThemedStyles((c) => ({
  content: { flex: 1, gap: 15, justifyContent: "center", paddingBottom: 36 },
  logoMark: {
    alignItems: "center",
    backgroundColor: c.primary,
    borderRadius: 18,
    height: 52,
    justifyContent: "center",
    width: 52,
  },
  logoLetter: { color: c.onPrimary, fontSize: 28, fontWeight: "900" },
  brand: {
    color: c.foreground,
    fontSize: 30,
    fontWeight: "900",
    letterSpacing: -0.9,
  },
  title: { color: c.muted, fontSize: 16, lineHeight: 24, marginBottom: 16 },
  ssoButton: {
    alignItems: "center",
    backgroundColor: c.primary,
    borderRadius: 15,
    justifyContent: "center",
    minHeight: 52,
    paddingHorizontal: 18,
  },
  ssoButtonText: {
    color: c.onPrimary,
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
  line: { backgroundColor: c.border, flex: 1, height: 1 },
  dividerText: { color: c.muted, fontSize: 12 },
  input: {
    backgroundColor: c.surface,
    borderColor: c.border,
    borderRadius: 14,
    borderWidth: 1,
    color: c.foreground,
    fontSize: 15,
    minHeight: 52,
    paddingHorizontal: 14,
  },
  magicButton: {
    alignItems: "center",
    backgroundColor: c.primarySoft,
    borderRadius: 15,
    justifyContent: "center",
    minHeight: 52,
    paddingHorizontal: 18,
  },
  magicButtonText: { color: c.primaryText, fontSize: 14, fontWeight: "800" },
  passwordToggle: {
    color: c.primaryText,
    fontSize: 13,
    fontWeight: "700",
    textAlign: "center",
  },
  messageSlot: { marginTop: 2, minHeight: 58 },
  message: { color: c.text, fontSize: 13, lineHeight: 19 },
  version: { color: c.subtle, fontSize: 11, textAlign: "center" },
  pressed: { opacity: 0.82 },
  disabled: { opacity: 0.55 },
}));
