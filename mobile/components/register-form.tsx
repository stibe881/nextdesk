import { useRouter } from "expo-router";
import { useState } from "react";
import { Linking, Pressable, Text, TextInput, View } from "react-native";

import {
  beginNextDeskMagicLink,
  clearNextDeskAuthTransaction,
  getNextDeskAuthRedirectUrl,
  requireNextDesk,
} from "@/lib/nextdesk-client";
import { PRIVACY_URL } from "@/lib/site-links";
import { makeThemedStyles, useAppColors } from "@/lib/themed-styles";

const CONFIRMATION_LINK_TTL_MS = 24 * 60 * 60 * 1_000;
const MIN_PASSWORD_LENGTH = 8;

/**
 * Self-registration for people without an organisation account. After the
 * e-mail address is confirmed, the app offers to create a personal workspace.
 */
export function RegisterForm({ onCancel }: { onCancel: () => void }) {
  const styles = useStyles();
  const colors = useAppColors();
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [message, setMessage] = useState("");

  async function register() {
    const displayName = name.trim().replace(/\s+/g, " ");
    const address = email.trim().toLowerCase();
    if (displayName.length < 2) {
      setMessage("Bitte gib deinen Namen ein.");
      return;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) {
      setMessage("Bitte gib eine gültige E-Mail-Adresse ein.");
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setMessage(
        `Das Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen lang sein.`,
      );
      return;
    }
    setPending(true);
    setMessage("");
    try {
      await beginNextDeskMagicLink(CONFIRMATION_LINK_TTL_MS);
      const { data, error } = await requireNextDesk().auth.signUp({
        email: address,
        password,
        options: {
          data: { full_name: displayName },
          emailRedirectTo: getNextDeskAuthRedirectUrl(),
        },
      });
      if (error) throw error;
      setPassword("");
      if (data.session) {
        // E-mail confirmation is disabled: the account is ready immediately.
        await clearNextDeskAuthTransaction();
        router.replace("/");
        return;
      }
      // Supabase returns a user without identities when the address is
      // already registered; the response stays neutral for privacy reasons.
      setDone(true);
    } catch (error) {
      await clearNextDeskAuthTransaction().catch(() => undefined);
      const detail = error instanceof Error ? error.message.toLowerCase() : "";
      setMessage(
        detail.includes("password")
          ? "Dieses Passwort ist zu schwach. Bitte wähle ein längeres Passwort."
          : detail.includes("signup") || detail.includes("sign up")
            ? "Die Registrierung ist derzeit nicht möglich. Bitte versuche es später erneut."
            : "Das Konto konnte nicht erstellt werden. Bitte prüfe deine Angaben und versuche es erneut.",
      );
    } finally {
      setPending(false);
    }
  }

  if (done) {
    return (
      <View style={styles.wrap}>
        <Text style={styles.heading}>Bestätige deine E-Mail-Adresse</Text>
        <Text style={styles.copy}>
          Wir haben dir eine E-Mail an {email.trim().toLowerCase()} gesendet.
          Öffne den Bestätigungslink auf diesem iPhone. Danach kannst du deinen
          Arbeitsbereich erstellen. Falls die Adresse bereits registriert ist,
          melde dich stattdessen mit deinem Passwort an.
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={onCancel}
          style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
        >
          <Text style={styles.secondaryText}>Zur Anmeldung</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.heading}>Konto erstellen</Text>
      <Text style={styles.copy}>
        Kostenlos registrieren – auch ohne Firma. Du erhältst deinen eigenen
        Arbeitsbereich und kannst Teammitglieder einladen.
      </Text>
      <TextInput
        accessibilityLabel="Name"
        autoCapitalize="words"
        autoComplete="name"
        editable={!pending}
        onChangeText={setName}
        placeholder="Vor- und Nachname"
        placeholderTextColor={colors.subtle}
        style={styles.input}
        textContentType="name"
        value={name}
      />
      <TextInput
        accessibilityLabel="E-Mail-Adresse"
        autoCapitalize="none"
        autoComplete="email"
        autoCorrect={false}
        editable={!pending}
        keyboardType="email-address"
        onChangeText={setEmail}
        placeholder="name@beispiel.ch"
        placeholderTextColor={colors.subtle}
        style={styles.input}
        textContentType="emailAddress"
        value={email}
      />
      <TextInput
        accessibilityLabel="Passwort"
        autoCapitalize="none"
        autoComplete="new-password"
        autoCorrect={false}
        editable={!pending}
        onChangeText={setPassword}
        onSubmitEditing={() => void register()}
        placeholder={`Passwort (mind. ${MIN_PASSWORD_LENGTH} Zeichen)`}
        placeholderTextColor={colors.subtle}
        returnKeyType="go"
        secureTextEntry
        style={styles.input}
        textContentType="newPassword"
        value={password}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ busy: pending, disabled: pending }}
        disabled={pending}
        onPress={() => void register()}
        style={({ pressed }) => [
          styles.primary,
          pressed && styles.pressed,
          pending && styles.disabled,
        ]}
      >
        <Text style={styles.primaryText}>
          {pending ? "Konto wird erstellt …" : "KONTO ERSTELLEN"}
        </Text>
      </Pressable>
      <Text style={styles.legal}>
        Mit der Registrierung akzeptierst du die{" "}
        <Text
          accessibilityRole="link"
          onPress={() =>
            void Linking.openURL(PRIVACY_URL).catch(() => undefined)
          }
          style={styles.legalLink}
        >
          Datenschutzerklärung
        </Text>
        . Du kannst dein Konto jederzeit in den Einstellungen löschen.
      </Text>
      {message ? (
        <Text accessibilityLiveRegion="polite" style={styles.message}>
          {message}
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        disabled={pending}
        hitSlop={8}
        onPress={onCancel}
      >
        <Text style={styles.link}>Bereits registriert? Anmelden</Text>
      </Pressable>
    </View>
  );
}

const useStyles = makeThemedStyles((c) => ({
  wrap: { gap: 14 },
  heading: { color: c.foreground, fontSize: 22, fontWeight: "900" },
  copy: { color: c.muted, fontSize: 15, lineHeight: 22 },
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
  primary: {
    alignItems: "center",
    backgroundColor: c.primary,
    borderRadius: 15,
    justifyContent: "center",
    minHeight: 52,
    paddingHorizontal: 18,
  },
  primaryText: {
    color: c.onPrimary,
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: 0.25,
  },
  secondary: {
    alignItems: "center",
    backgroundColor: c.primarySoft,
    borderRadius: 15,
    justifyContent: "center",
    minHeight: 52,
    paddingHorizontal: 18,
  },
  secondaryText: { color: c.primaryText, fontSize: 14, fontWeight: "800" },
  legal: { color: c.muted, fontSize: 12, lineHeight: 18 },
  legalLink: { color: c.primaryText, textDecorationLine: "underline" },
  message: { color: c.error, fontSize: 13, lineHeight: 19 },
  link: {
    color: c.primaryText,
    fontSize: 13,
    fontWeight: "700",
    textAlign: "center",
  },
  pressed: { opacity: 0.82 },
  disabled: { opacity: 0.55 },
}));
