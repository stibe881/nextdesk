import { useRouter } from "expo-router";
import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

import { DeleteAccountButton } from "@/components/delete-account-button";
import { useMobileFeatures } from "@/components/mobile-feature-gate";
import { ScreenContainer } from "@/components/screen-container";
import { createPersonalWorkspace } from "@/lib/account";
import { clearMobileWorkspace, nextDesk } from "@/lib/nextdesk-client";
import { makeThemedStyles, useAppColors } from "@/lib/themed-styles";

/**
 * Shown after a self-registration: the person does not belong to any
 * organisation yet and creates a personal workspace for themselves and the
 * team members they invite later.
 */
export function CreateWorkspaceScreen() {
  const styles = useStyles();
  const colors = useAppColors();
  const router = useRouter();
  const { refresh } = useMobileFeatures();
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function submit() {
    const trimmed = name.trim().replace(/\s+/g, " ");
    if (trimmed.length < 2) {
      setMessage("Bitte gib einen Namen mit mindestens zwei Zeichen ein.");
      return;
    }
    setPending(true);
    setMessage("");
    try {
      await createPersonalWorkspace(trimmed);
      await refresh();
    } catch (error) {
      setMessage(
        error instanceof Error && error.message
          ? error.message
          : "Der Arbeitsbereich konnte nicht erstellt werden.",
      );
    } finally {
      setPending(false);
    }
  }

  async function signOut() {
    await nextDesk?.auth.signOut().catch(() => undefined);
    await clearMobileWorkspace();
    router.replace("/auth");
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={styles.flex}
    >
      <ScreenContainer className="px-5">
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.eyebrow}>WILLKOMMEN BEI NEXTDESK</Text>
          <Text style={styles.title}>Arbeitsbereich erstellen</Text>
          <Text style={styles.copy}>
            Dein Konto gehört noch zu keiner Organisation. Erstelle deinen
            eigenen Arbeitsbereich, um Tickets zu erfassen und zu bearbeiten.
            Teammitglieder kannst du danach in den Einstellungen einladen.
          </Text>
          <TextInput
            accessibilityLabel="Name des Arbeitsbereichs"
            autoCapitalize="words"
            editable={!pending}
            maxLength={160}
            onChangeText={setName}
            onSubmitEditing={() => void submit()}
            placeholder="z. B. Muster IT oder Max Muster"
            placeholderTextColor={colors.subtle}
            returnKeyType="done"
            style={styles.input}
            value={name}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ busy: pending, disabled: pending }}
            disabled={pending}
            onPress={() => void submit()}
            style={({ pressed }) => [
              styles.primary,
              pressed && styles.pressed,
              pending && styles.disabled,
            ]}
          >
            <Text style={styles.primaryText}>
              {pending
                ? "Arbeitsbereich wird erstellt …"
                : "Arbeitsbereich erstellen"}
            </Text>
          </Pressable>
          {message ? <Text style={styles.message}>{message}</Text> : null}
          <Text style={styles.hint}>
            Wurdest du von einem Team eingeladen? Öffne den Einladungslink aus
            der E-Mail mit derselben E-Mail-Adresse – du wirst dann automatisch
            dem Team zugeordnet.
          </Text>
          <View style={styles.footer}>
            <Pressable
              accessibilityRole="button"
              onPress={() => void refresh()}
              style={styles.link}
            >
              <Text style={styles.linkText}>Einladungen erneut prüfen</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => void signOut()}
              style={styles.link}
            >
              <Text style={styles.linkText}>Abmelden</Text>
            </Pressable>
            <DeleteAccountButton ownsWorkspace={false} />
          </View>
        </ScrollView>
      </ScreenContainer>
    </KeyboardAvoidingView>
  );
}

const useStyles = makeThemedStyles((c) => ({
  flex: { flex: 1 },
  content: {
    flexGrow: 1,
    gap: 14,
    justifyContent: "center",
    paddingVertical: 32,
  },
  eyebrow: {
    color: c.primaryText,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  title: {
    color: c.foreground,
    fontSize: 28,
    fontWeight: "900",
    letterSpacing: -0.6,
  },
  copy: { color: c.muted, fontSize: 15, lineHeight: 23 },
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
  primaryText: { color: c.onPrimary, fontSize: 14, fontWeight: "800" },
  message: { color: c.error, fontSize: 13, lineHeight: 19 },
  hint: { color: c.muted, fontSize: 13, lineHeight: 19 },
  footer: { gap: 10, marginTop: 18 },
  link: { alignItems: "center", minHeight: 40, justifyContent: "center" },
  linkText: { color: c.primaryText, fontSize: 14, fontWeight: "800" },
  pressed: { opacity: 0.82 },
  disabled: { opacity: 0.55 },
}));
