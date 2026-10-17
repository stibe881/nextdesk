import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import {
  isNextDeskConfigured,
  nextDesk,
  requireNextDesk,
  resolveMobileSsoEnforcement,
} from "@/lib/nextdesk-client";

type AccountProfile = {
  email: string;
  providerLabel: string;
  canChangePassword: boolean;
};

function profileFromUser(
  user: {
    email?: string | null;
    identities?: { provider?: string }[] | null;
  },
  ssoEnforced: boolean,
): AccountProfile {
  const providers = new Set(
    (user.identities ?? [])
      .map((identity) => identity.provider?.toLowerCase())
      .filter((provider): provider is string => Boolean(provider)),
  );
  const usesSso =
    ssoEnforced || providers.has("azure") || providers.has("saml");
  const hasEmailIdentity = providers.has("email");

  return {
    email: user.email?.trim() || "Keine E-Mail-Adresse hinterlegt",
    providerLabel: usesSso
      ? "Microsoft Entra SSO"
      : hasEmailIdentity
        ? "E-Mail-Anmeldung"
        : "Externer Identitätsanbieter",
    canChangePassword: hasEmailIdentity && !usesSso,
  };
}

export default function SettingsScreen() {
  const router = useRouter();
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!isNextDeskConfigured || !nextDesk) {
      setError("Die mobile nextDesk-Verbindung ist noch nicht konfiguriert.");
      setLoading(false);
      return;
    }
    try {
      setError("");
      const { data, error: userError } = await nextDesk.auth.getUser();
      if (userError || !data.user) {
        router.replace("/auth");
        return;
      }
      let ssoEnforced = true;
      try {
        ssoEnforced = await resolveMobileSsoEnforcement();
      } catch {
        setError(
          "Die Anmeldeart konnte nicht geprüft werden. Eine Passwortänderung ist deshalb vorübergehend gesperrt.",
        );
      }
      setProfile(profileFromUser(data.user, ssoEnforced));
    } catch {
      setError("Die persönlichen Einstellungen konnten nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function changePassword() {
    if (!profile?.canChangePassword) return;
    setMessage("");
    setError("");
    if (password.length < 12) {
      setError("Das neue Passwort muss mindestens 12 Zeichen lang sein.");
      return;
    }
    if (password !== passwordConfirmation) {
      setError("Die Passwortbestätigung stimmt nicht überein.");
      return;
    }

    setSaving(true);
    try {
      const { error: updateError } = await requireNextDesk().auth.updateUser({
        password,
      });
      if (updateError) throw updateError;
      setPassword("");
      setPasswordConfirmation("");
      setMessage("Dein Passwort wurde erfolgreich geändert.");
    } catch {
      setError(
        "Das Passwort konnte nicht geändert werden. Bitte versuche es erneut.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function signOut() {
    if (!nextDesk) return;
    await nextDesk.auth.signOut();
    router.replace("/auth");
  }

  if (loading && !profile) {
    return (
      <ScreenContainer containerClassName="bg-[#F6F7FB]" className="px-5">
        <View style={styles.centered}>
          <ActivityIndicator color="#4438CA" size="large" />
          <Text style={styles.loadingText}>Einstellungen werden geladen …</Text>
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer containerClassName="bg-[#F6F7FB]" className="px-5">
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View>
          <Text style={styles.eyebrow}>MEIN KONTO</Text>
          <Text style={styles.title}>Einstellungen</Text>
          <Text style={styles.subtitle}>
            Verwalte deine persönlichen Zugangs- und Sicherheitsangaben.
          </Text>
        </View>

        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        {message ? <Text style={styles.successText}>{message}</Text> : null}

        <View style={styles.card}>
          <View style={styles.cardHeading}>
            <View style={styles.cardIcon}>
              <Ionicons color="#4438CA" name="person-outline" size={20} />
            </View>
            <Text style={styles.cardTitle}>Profil</Text>
          </View>
          <Text style={styles.fieldLabel}>E-MAIL-ADRESSE</Text>
          <Text selectable style={styles.fieldValue}>
            {profile?.email ?? "Keine E-Mail-Adresse hinterlegt"}
          </Text>
          <Text style={[styles.fieldLabel, styles.secondLabel]}>
            ANMELDEART
          </Text>
          <View style={styles.providerBadge}>
            <Ionicons
              color="#5E55B8"
              name="shield-checkmark-outline"
              size={15}
            />
            <Text style={styles.providerText}>{profile?.providerLabel}</Text>
          </View>
        </View>

        {profile?.canChangePassword ? (
          <View style={styles.card}>
            <View style={styles.cardHeading}>
              <View style={[styles.cardIcon, { backgroundColor: "#EAF8FB" }]}>
                <Ionicons color="#087A95" name="key-outline" size={20} />
              </View>
              <Text style={styles.cardTitle}>Passwort ändern</Text>
            </View>
            <Text style={styles.cardHint}>
              Verwende mindestens 12 Zeichen. Dein Passwort wird nie angezeigt
              oder in deinem Profil hinterlegt.
            </Text>
            <TextInput
              autoComplete="new-password"
              onChangeText={setPassword}
              placeholder="Neues Passwort"
              placeholderTextColor="#9A99AA"
              secureTextEntry
              style={styles.input}
              textContentType="newPassword"
              value={password}
            />
            <TextInput
              autoComplete="new-password"
              onChangeText={setPasswordConfirmation}
              placeholder="Neues Passwort bestätigen"
              placeholderTextColor="#9A99AA"
              secureTextEntry
              style={styles.input}
              textContentType="newPassword"
              value={passwordConfirmation}
            />
            <Pressable
              accessibilityRole="button"
              disabled={saving}
              onPress={() => void changePassword()}
              style={[styles.primaryButton, saving && styles.disabled]}
            >
              <Text style={styles.primaryButtonText}>
                {saving ? "Passwort wird geändert …" : "Passwort ändern"}
              </Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.ssoNote}>
            <Ionicons color="#5E55B8" name="lock-closed-outline" size={20} />
            <View style={styles.noteCopy}>
              <Text style={styles.noteTitle}>
                Passwort wird über SSO verwaltet
              </Text>
              <Text style={styles.noteText}>
                Dein Konto wird über Microsoft Entra authentifiziert. Ändere
                dein Passwort bitte direkt bei deinem Identitätsanbieter.
              </Text>
            </View>
          </View>
        )}

        <Pressable
          accessibilityRole="button"
          onPress={() => void signOut()}
          style={styles.signOutButton}
        >
          <Ionicons color="#B42318" name="log-out-outline" size={19} />
          <Text style={styles.signOutText}>Abmelden</Text>
        </Pressable>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: { gap: 16, paddingBottom: 34, paddingTop: 18 },
  centered: {
    alignItems: "center",
    flex: 1,
    gap: 14,
    justifyContent: "center",
  },
  loadingText: { color: "#626376", fontSize: 14 },
  eyebrow: {
    color: "#77758C",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.2,
  },
  title: {
    color: "#202136",
    fontSize: 29,
    fontWeight: "900",
    letterSpacing: -0.8,
    marginTop: 4,
  },
  subtitle: { color: "#6B7280", fontSize: 14, lineHeight: 20, marginTop: 5 },
  card: {
    backgroundColor: "#FFFFFF",
    borderColor: "#ECECF3",
    borderRadius: 21,
    borderWidth: 1,
    gap: 10,
    padding: 17,
  },
  cardHeading: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    marginBottom: 3,
  },
  cardIcon: {
    alignItems: "center",
    backgroundColor: "#EEECFF",
    borderRadius: 11,
    height: 37,
    justifyContent: "center",
    width: 37,
  },
  cardTitle: { color: "#303145", fontSize: 16, fontWeight: "900" },
  fieldLabel: {
    color: "#898798",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.8,
    marginTop: 5,
  },
  secondLabel: { marginTop: 10 },
  fieldValue: { color: "#303145", fontSize: 14, fontWeight: "700" },
  providerBadge: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: "#F0EEFF",
    borderRadius: 10,
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  providerText: { color: "#5E55B8", fontSize: 12, fontWeight: "800" },
  cardHint: { color: "#747486", fontSize: 12, lineHeight: 18, marginBottom: 2 },
  input: {
    backgroundColor: "#FAFAFD",
    borderColor: "#E5E5EF",
    borderRadius: 13,
    borderWidth: 1,
    color: "#202136",
    fontSize: 14,
    minHeight: 50,
    paddingHorizontal: 13,
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: "#4438CA",
    borderRadius: 13,
    minHeight: 50,
    justifyContent: "center",
    marginTop: 4,
  },
  primaryButtonText: { color: "#FFFFFF", fontSize: 14, fontWeight: "900" },
  ssoNote: {
    alignItems: "flex-start",
    backgroundColor: "#F0EEFF",
    borderRadius: 19,
    flexDirection: "row",
    gap: 11,
    padding: 16,
  },
  noteCopy: { flex: 1 },
  noteTitle: { color: "#514AA1", fontSize: 13, fontWeight: "900" },
  noteText: { color: "#625D98", fontSize: 12, lineHeight: 18, marginTop: 3 },
  signOutButton: {
    alignItems: "center",
    backgroundColor: "#FFF4F2",
    borderColor: "#F1CCC7",
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    minHeight: 51,
    marginTop: 2,
  },
  signOutText: { color: "#B42318", fontSize: 14, fontWeight: "900" },
  errorText: {
    backgroundColor: "#FFF3F2",
    borderColor: "#F5C2C0",
    borderRadius: 13,
    borderWidth: 1,
    color: "#A02820",
    fontSize: 13,
    lineHeight: 19,
    padding: 13,
  },
  successText: {
    backgroundColor: "#ECFDF3",
    borderColor: "#ABEFCA",
    borderRadius: 13,
    borderWidth: 1,
    color: "#067647",
    fontSize: 13,
    lineHeight: 19,
    padding: 13,
  },
  disabled: { opacity: 0.55 },
});
