import { Ionicons } from "@expo/vector-icons";
import * as LocalAuthentication from "expo-local-authentication";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  Platform,
} from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { useMobileFeatures } from "@/components/mobile-feature-gate";
import {
  clearMobileWorkspace,
  getMobileUserId,
  isNextDeskConfigured,
  listMobileTenants,
  loadCurrentTenant,
  type MobileTenant,
  nextDesk,
  requireNextDesk,
  resolveMobileSsoEnforcement,
  selectMobileTenant,
} from "@/lib/nextdesk-client";
import {
  clearMobileWorkingData,
  getDeviceProtectionPreference,
  setDeviceProtectionPreference,
} from "@/lib/mobile-private-state";

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
  const { refresh: refreshFeatures } = useMobileFeatures();
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [tenants, setTenants] = useState<MobileTenant[]>([]);
  const [currentTenant, setCurrentTenant] = useState<MobileTenant | null>(null);
  const [tenantPickerOpen, setTenantPickerOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [deviceProtectionAvailable, setDeviceProtectionAvailable] =
    useState(false);
  const [deviceProtectionEnabled, setDeviceProtectionEnabled] = useState(false);
  const [deviceProtectionSaving, setDeviceProtectionSaving] = useState(false);
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
      if (Platform.OS !== "web") {
        const [hasHardware, enrolled, enabled] = await Promise.all([
          LocalAuthentication.hasHardwareAsync(),
          LocalAuthentication.isEnrolledAsync(),
          getDeviceProtectionPreference(data.user.id),
        ]);
        setDeviceProtectionAvailable(hasHardware && enrolled);
        setDeviceProtectionEnabled(enabled && hasHardware && enrolled);
      }
      const [availableTenants, selectedTenant] = await Promise.all([
        listMobileTenants(),
        loadCurrentTenant(),
      ]);
      setTenants(availableTenants);
      setCurrentTenant(selectedTenant);
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
    try {
      await nextDesk.auth.signOut();
    } finally {
      await clearMobileWorkspace();
      router.replace("/auth");
    }
  }

  async function toggleDeviceProtection() {
    if (!deviceProtectionAvailable || deviceProtectionSaving) return;
    setError("");
    setMessage("");
    setDeviceProtectionSaving(true);
    try {
      const result = await LocalAuthentication.authenticateAsync({
        cancelLabel: "Abbrechen",
        disableDeviceFallback: false,
        fallbackLabel: "Gerätecode",
        promptMessage: deviceProtectionEnabled
          ? "Geräteschutz deaktivieren"
          : "Geräteschutz aktivieren",
      });
      if (!result.success) {
        setError("Die Änderung des Geräteschutzes wurde nicht bestätigt.");
        return;
      }
      const userId = await getMobileUserId();
      const nextValue = !deviceProtectionEnabled;
      await setDeviceProtectionPreference(userId, nextValue);
      setDeviceProtectionEnabled(nextValue);
      setMessage(
        nextValue
          ? "Geräteschutz ist aktiv. Nach Rückkehr in die App ist eine Entsperrung erforderlich."
          : "Geräteschutz wurde deaktiviert.",
      );
    } catch {
      setError("Der Geräteschutz konnte nicht geändert werden.");
    } finally {
      setDeviceProtectionSaving(false);
    }
  }

  async function clearWorkingData() {
    setError("");
    setMessage("");
    setSaving(true);
    try {
      await clearMobileWorkingData(await getMobileUserId());
      setMessage(
        "Lokale Entwürfe und Favoriten wurden von diesem Gerät entfernt.",
      );
    } catch {
      setError("Die lokalen Arbeitsdaten konnten nicht entfernt werden.");
    } finally {
      setSaving(false);
    }
  }

  async function changeTenant(tenantId: string) {
    setError("");
    try {
      const selectedTenant = await selectMobileTenant(tenantId);
      setCurrentTenant(selectedTenant);
      setTenantPickerOpen(false);
      await refreshFeatures();
      setMessage(`Arbeitsbereich «${selectedTenant.name}» ist aktiv.`);
      router.replace("/");
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Der Arbeitsbereich konnte nicht gewechselt werden.",
      );
    }
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

        <View style={styles.card}>
          <View style={styles.cardHeading}>
            <View style={[styles.cardIcon, { backgroundColor: "#E5F7FA" }]}>
              <Ionicons color="#087A95" name="business-outline" size={20} />
            </View>
            <Text style={styles.cardTitle}>Arbeitsbereich</Text>
          </View>
          <Text style={styles.cardHint}>
            Alle Tickets, Assets und Suchen beziehen sich auf diesen aktiven
            Mandanten.
          </Text>
          <Pressable
            accessibilityHint="Öffnet die Auswahl Ihrer aktiven Arbeitsbereiche."
            accessibilityLabel={`Arbeitsbereich: ${currentTenant?.name ?? "wird geladen"}`}
            accessibilityRole="button"
            disabled={tenants.length < 2}
            onPress={() => setTenantPickerOpen(true)}
            style={[
              styles.tenantControl,
              tenants.length < 2 && styles.tenantControlDisabled,
            ]}
          >
            <View style={styles.tenantControlCopy}>
              <Text style={styles.tenantControlName}>
                {currentTenant?.name ?? "Arbeitsbereich wird geladen …"}
              </Text>
              <Text style={styles.tenantControlHint}>
                {tenants.length < 2
                  ? "Ihr einziger aktiver Mandant"
                  : "Antippen zum Wechseln"}
              </Text>
            </View>
            {tenants.length > 1 ? (
              <Ionicons color="#4438CA" name="chevron-forward" size={20} />
            ) : null}
          </Pressable>
        </View>

        {deviceProtectionAvailable ? (
          <View style={styles.card}>
            <View style={styles.cardHeading}>
              <View style={[styles.cardIcon, { backgroundColor: "#EEECFF" }]}>
                <Ionicons
                  color="#4438CA"
                  name="phone-portrait-outline"
                  size={20}
                />
              </View>
              <Text style={styles.cardTitle}>Geräteschutz</Text>
            </View>
            <Text style={styles.cardHint}>
              Schützt Ihre geöffnete nextDesk-Sitzung nach der Rückkehr in die
              App mit Face ID, Touch ID oder Gerätecode.
            </Text>
            <Pressable
              accessibilityHint="Die Änderung wird mit Face ID, Touch ID oder Gerätecode bestätigt."
              accessibilityLabel={
                deviceProtectionEnabled
                  ? "Geräteschutz deaktivieren"
                  : "Geräteschutz aktivieren"
              }
              accessibilityRole="switch"
              accessibilityState={{ checked: deviceProtectionEnabled }}
              disabled={deviceProtectionSaving}
              onPress={() => void toggleDeviceProtection()}
              style={[
                styles.deviceProtectionControl,
                deviceProtectionEnabled && styles.deviceProtectionControlActive,
                deviceProtectionSaving && styles.disabled,
              ]}
            >
              <View style={styles.deviceProtectionCopy}>
                <Text style={styles.deviceProtectionTitle}>
                  {deviceProtectionEnabled ? "Aktiv" : "Deaktiviert"}
                </Text>
                <Text style={styles.deviceProtectionHint}>
                  {deviceProtectionEnabled
                    ? "Beim Zurückkehren entsperren"
                    : "Auf diesem Gerät nicht geschützt"}
                </Text>
              </View>
              {deviceProtectionSaving ? (
                <ActivityIndicator color="#4438CA" size="small" />
              ) : (
                <Ionicons
                  color={deviceProtectionEnabled ? "#2B8A54" : "#77758C"}
                  name={
                    deviceProtectionEnabled
                      ? "shield-checkmark-outline"
                      : "shield-outline"
                  }
                  size={22}
                />
              )}
            </Pressable>
          </View>
        ) : null}

        <View style={styles.cacheNote}>
          <Ionicons color="#087A95" name="shield-checkmark-outline" size={20} />
          <View style={styles.noteCopy}>
            <Text style={styles.noteTitle}>Offline &amp; Cache</Text>
            <Text style={styles.noteText}>
              Nur Entwürfe und Favoriten bleiben verschlüsselt auf diesem Gerät.
              Tickets, Fotos, Assets und Wissen werden nicht offline
              gespeichert.
            </Text>
            <Pressable
              accessibilityRole="button"
              disabled={saving}
              onPress={() => void clearWorkingData()}
              style={styles.clearCacheButton}
            >
              <Text style={styles.clearCacheText}>Arbeitsdaten entfernen</Text>
            </Pressable>
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

      <Modal
        animationType="slide"
        onRequestClose={() => setTenantPickerOpen(false)}
        transparent
        visible={tenantPickerOpen}
      >
        <View style={styles.modalRoot}>
          <Pressable
            accessibilityLabel="Arbeitsbereichsauswahl schliessen"
            accessibilityRole="button"
            onPress={() => setTenantPickerOpen(false)}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <View>
                <Text style={styles.sheetEyebrow}>ARBEITSBEREICH</Text>
                <Text style={styles.sheetTitle}>Mandanten wechseln</Text>
              </View>
              <Pressable
                accessibilityLabel="Arbeitsbereichsauswahl schliessen"
                accessibilityRole="button"
                onPress={() => setTenantPickerOpen(false)}
                style={styles.sheetClose}
              >
                <Ionicons color="#4438CA" name="close" size={22} />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.tenantOptions}>
              {tenants.map((tenant) => {
                const selected = tenant.id === currentTenant?.id;
                return (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    key={tenant.id}
                    onPress={() => void changeTenant(tenant.id)}
                    style={[
                      styles.tenantOption,
                      selected && styles.tenantOptionSelected,
                    ]}
                  >
                    <View style={styles.tenantOptionCopy}>
                      <Text style={styles.tenantOptionName}>{tenant.name}</Text>
                      <Text style={styles.tenantOptionSlug}>{tenant.slug}</Text>
                    </View>
                    {selected ? (
                      <Ionicons
                        color="#4438CA"
                        name="checkmark-circle"
                        size={22}
                      />
                    ) : (
                      <Ionicons
                        color="#868599"
                        name="chevron-forward"
                        size={19}
                      />
                    )}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
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
  tenantControl: {
    alignItems: "center",
    backgroundColor: "#F7F7FB",
    borderColor: "#E3E2EC",
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 62,
    paddingHorizontal: 13,
  },
  tenantControlDisabled: { opacity: 0.72 },
  tenantControlCopy: { flex: 1, gap: 3, paddingRight: 10 },
  tenantControlName: { color: "#303145", fontSize: 14, fontWeight: "800" },
  tenantControlHint: { color: "#77758C", fontSize: 12 },
  deviceProtectionControl: {
    alignItems: "center",
    backgroundColor: "#F7F7FB",
    borderColor: "#E3E2EC",
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 62,
    paddingHorizontal: 13,
  },
  deviceProtectionControlActive: {
    backgroundColor: "#F0FAF3",
    borderColor: "#BCE7CB",
  },
  deviceProtectionCopy: { flex: 1, gap: 3, paddingRight: 10 },
  deviceProtectionTitle: { color: "#303145", fontSize: 14, fontWeight: "900" },
  deviceProtectionHint: { color: "#77758C", fontSize: 12 },
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
  cacheNote: {
    alignItems: "flex-start",
    backgroundColor: "#EAF8FB",
    borderRadius: 19,
    flexDirection: "row",
    gap: 11,
    padding: 16,
  },
  clearCacheButton: {
    alignSelf: "flex-start",
    marginTop: 10,
    paddingVertical: 3,
  },
  clearCacheText: { color: "#087A95", fontSize: 12, fontWeight: "900" },
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
  modalRoot: {
    backgroundColor: "rgba(25, 25, 42, 0.42)",
    flex: 1,
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    gap: 15,
    maxHeight: "72%",
    padding: 20,
    paddingBottom: 30,
  },
  sheetHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  sheetEyebrow: {
    color: "#77758C",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.9,
  },
  sheetTitle: {
    color: "#202136",
    fontSize: 21,
    fontWeight: "800",
    marginTop: 3,
  },
  sheetClose: {
    alignItems: "center",
    backgroundColor: "#EEECFF",
    borderRadius: 16,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  tenantOptions: { gap: 8, paddingBottom: 4 },
  tenantOption: {
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderColor: "#E5E5EF",
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 62,
    paddingHorizontal: 14,
  },
  tenantOptionSelected: { backgroundColor: "#F0EFFB", borderColor: "#4438CA" },
  tenantOptionCopy: { flex: 1, gap: 3, paddingRight: 12 },
  tenantOptionName: { color: "#303145", fontSize: 15, fontWeight: "800" },
  tenantOptionSlug: { color: "#77758C", fontSize: 12 },
  disabled: { opacity: 0.55 },
});
