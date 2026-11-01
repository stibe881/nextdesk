import { Ionicons } from "@expo/vector-icons";
import * as LocalAuthentication from "expo-local-authentication";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  Linking,
} from "react-native";

import { getMyAvailability, setMyAvailability } from "@/lib/nextdesk-portal";
import { DeleteAccountButton } from "@/components/delete-account-button";
import { ScreenContainer } from "@/components/screen-container";
import { TeamMembersCard } from "@/components/team-members-card";
import {
  type DensityPreference,
  type MotionPreference,
  type ThemePreference,
  useThemeContext,
} from "@/lib/theme-provider";
import { useMobileFeatures } from "@/components/mobile-feature-gate";
import { makeThemedStyles } from "@/lib/themed-styles";
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
} from "@/lib/nextdesk-client";
import {
  clearMobileWorkingData,
  getDeviceProtectionPreference,
  setDeviceProtectionPreference,
} from "@/lib/mobile-private-state";
import { unregisterPushDeviceBeforeSignOut } from "@/lib/push-notifications";
import {
  IMPRINT_URL,
  PRIVACY_URL,
  SUPPORT_EMAIL,
  SUPPORT_URL,
} from "@/lib/site-links";

const themeOptions: { label: string; value: ThemePreference }[] = [
  { label: "Hell", value: "light" },
  { label: "Dunkel", value: "dark" },
  { label: "Wie iPhone", value: "system" },
];

const densityOptions: { label: string; value: DensityPreference }[] = [
  { label: "Komfortabel", value: "comfortable" },
  { label: "Kompakt", value: "compact" },
];

const motionOptions: { label: string; value: MotionPreference }[] = [
  { label: "System", value: "system" },
  { label: "Reduziert", value: "reduced" },
];

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
  const styles = useStyles();
  const router = useRouter();
  const {
    isEnabled,
    loading: checkingFeatures,
    refresh: refreshFeatures,
    switchTenant,
    switchingTenant,
    tenantId: confirmedTenantId,
  } = useMobileFeatures();
  const {
    colors,
    density,
    motionPreference,
    preferencesReady,
    reducedMotion,
    setDensity,
    setMotionPreference,
    setThemePreference,
    themePreference,
  } = useThemeContext();
  const tokenStyles = useMemo(
    () => ({
      card: { backgroundColor: colors.surface, borderColor: colors.border },
      control: {
        backgroundColor: colors.surfaceSubtle,
        borderColor: colors.border,
      },
      error: {
        backgroundColor: colors.errorSoft,
        borderColor: colors.errorBorder,
      },
      foreground: { color: colors.foreground },
      info: { backgroundColor: colors.infoSoft },
      muted: { color: colors.muted },
      primary: { backgroundColor: colors.primary },
      primaryText: { color: colors.onPrimary },
      success: {
        backgroundColor: colors.successSoft,
        borderColor: colors.successBorder,
      },
      successText: { color: colors.success },
    }),
    [colors],
  );
  const densityStyles = useMemo(
    () => ({
      card: { padding: density === "compact" ? 14 : 17 },
      content: { gap: density === "compact" ? 12 : 16 },
      control: { minHeight: density === "compact" ? 54 : 62 },
    }),
    [density],
  );
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [tenants, setTenants] = useState<MobileTenant[]>([]);
  const [currentTenant, setCurrentTenant] = useState<MobileTenant | null>(null);
  const [tenantPickerOpen, setTenantPickerOpen] = useState(false);
  const [tenantChangeSaving, setTenantChangeSaving] = useState(false);
  const tenantChangeInFlight = useRef(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [deviceProtectionAvailable, setDeviceProtectionAvailable] =
    useState(false);
  const [deviceProtectionEnabled, setDeviceProtectionEnabled] = useState(false);
  const [deviceProtectionSaving, setDeviceProtectionSaving] = useState(false);
  const [availability, setAvailability] = useState("");
  const [availabilityAvailable, setAvailabilityAvailable] = useState(false);
  const [availabilitySaving, setAvailabilitySaving] = useState(false);
  const availabilityDirty = useRef(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const requesterPortalEnabled = isEnabled("requester.portal");
  const pushNotificationsEnabled = isEnabled("notifications.push");

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

  useFocusEffect(
    useCallback(() => {
      let active = true;

      if (checkingFeatures || !requesterPortalEnabled) {
        setAvailabilityAvailable(false);
        return () => {
          active = false;
        };
      }

      void getMyAvailability()
        .then(({ availability: nextAvailability }) => {
          if (!active) return;
          if (!availabilityDirty.current)
            setAvailability(nextAvailability ?? "");
          setAvailabilityAvailable(true);
        })
        .catch(() => {
          // Ohne bestätigte Freigabe oder bei Netzwerkfehlern bleibt der
          // optionale Bereich unsichtbar.
          if (!active) return;
          if (!availabilityDirty.current) setAvailability("");
          setAvailabilityAvailable(false);
        });

      return () => {
        active = false;
      };
    }, [checkingFeatures, requesterPortalEnabled]),
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
      await unregisterPushDeviceBeforeSignOut();
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

  async function saveAvailability() {
    if (!availabilityAvailable || availabilitySaving) return;
    setAvailabilitySaving(true);
    try {
      const nextAvailability = availability.trim() || null;
      const result = await setMyAvailability(nextAvailability);
      setAvailability(result.availability ?? "");
      availabilityDirty.current = false;
      setMessage(
        result.availability
          ? "Deine Erreichbarkeit wurde gespeichert."
          : "Deine Erreichbarkeit wurde entfernt.",
      );
    } catch {
      // Die Einstellung ist optional. Bei jeder nicht verifizierbaren Grenze
      // wird sie vorsorglich ausgeblendet, statt Informationen anzuzeigen.
      setAvailability("");
      setAvailabilityAvailable(false);
    } finally {
      setAvailabilitySaving(false);
    }
  }

  async function changeTenant(tenantId: string) {
    if (tenantChangeInFlight.current || tenantId === currentTenant?.id) {
      return;
    }
    tenantChangeInFlight.current = true;
    setTenantChangeSaving(true);
    setError("");
    try {
      const selectedTenant = await switchTenant(tenantId);
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
    } finally {
      tenantChangeInFlight.current = false;
      setTenantChangeSaving(false);
    }
  }

  if (loading && !profile) {
    return (
      <ScreenContainer containerClassName="bg-background" className="px-5">
        <View
          accessibilityLabel="Einstellungen werden geladen"
          accessibilityRole="progressbar"
          style={styles.skeletonPage}
        >
          <View
            style={[styles.skeletonTitle, { backgroundColor: colors.border }]}
          />
          <View
            style={[styles.skeletonLine, { backgroundColor: colors.border }]}
          />
          {[1, 2, 3].map((item) => (
            <View
              key={item}
              style={[
                styles.skeletonCard,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <View
                style={[
                  styles.skeletonIcon,
                  { backgroundColor: colors.surfaceSubtle },
                ]}
              />
              <View style={styles.skeletonCopy}>
                <View
                  style={[
                    styles.skeletonLine,
                    { backgroundColor: colors.border },
                  ]}
                />
                <View
                  style={[
                    styles.skeletonShortLine,
                    { backgroundColor: colors.border },
                  ]}
                />
              </View>
            </View>
          ))}
          <Text style={[styles.loadingText, tokenStyles.muted]}>
            Einstellungen werden geladen …
          </Text>
        </View>
      </ScreenContainer>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={styles.keyboardAvoiding}
    >
      <ScreenContainer
        containerClassName="bg-background"
        className="px-5"
        style={{ backgroundColor: colors.surfaceSubtle }}
      >
        <ScrollView
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={[styles.content, densityStyles.content]}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View>
            <Text style={[styles.eyebrow, tokenStyles.muted]}>MEIN KONTO</Text>
            <Text style={[styles.title, tokenStyles.foreground]}>
              Einstellungen
            </Text>
            <Text style={[styles.subtitle, tokenStyles.muted]}>
              Verwalte deine persönlichen Zugangs- und Sicherheitsangaben.
            </Text>
          </View>

          {error ? (
            <View
              accessibilityRole="alert"
              style={[styles.feedback, styles.errorText, tokenStyles.error]}
            >
              <Ionicons
                color={colors.error}
                name="alert-circle-outline"
                size={20}
              />
              <Text style={[styles.feedbackText, { color: colors.error }]}>
                {error}
              </Text>
            </View>
          ) : null}
          {message ? (
            <View
              accessibilityRole="alert"
              style={[styles.feedback, styles.successText, tokenStyles.success]}
            >
              <Ionicons
                color={colors.success}
                name="checkmark-circle-outline"
                size={20}
              />
              <Text style={[styles.feedbackText, tokenStyles.successText]}>
                {message}
              </Text>
            </View>
          ) : null}

          <View style={[styles.card, tokenStyles.card, densityStyles.card]}>
            <View style={styles.cardHeading}>
              <View style={styles.cardIcon}>
                <Ionicons
                  color={colors.primaryText}
                  name="person-outline"
                  size={20}
                />
              </View>
              <Text style={[styles.cardTitle, tokenStyles.foreground]}>
                Profil
              </Text>
            </View>
            <Text style={styles.fieldLabel}>E-MAIL-ADRESSE</Text>
            <Text
              selectable
              style={[styles.fieldValue, tokenStyles.foreground]}
            >
              {profile?.email ?? "Keine E-Mail-Adresse hinterlegt"}
            </Text>
            <Text style={[styles.fieldLabel, styles.secondLabel]}>
              ANMELDEART
            </Text>
            <View style={styles.providerBadge}>
              <Ionicons
                color={colors.primaryText}
                name="shield-checkmark-outline"
                size={15}
              />
              <Text style={styles.providerText}>{profile?.providerLabel}</Text>
            </View>
          </View>

          <View style={[styles.card, tokenStyles.card, densityStyles.card]}>
            <View style={styles.cardHeading}>
              <View
                style={[styles.cardIcon, { backgroundColor: colors.infoSoft }]}
              >
                <Ionicons
                  color={colors.info}
                  name="business-outline"
                  size={20}
                />
              </View>
              <Text style={[styles.cardTitle, tokenStyles.foreground]}>
                Arbeitsbereich
              </Text>
            </View>
            <Text style={[styles.cardHint, tokenStyles.muted]}>
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
                tokenStyles.control,
                densityStyles.control,
                tenants.length < 2 && styles.tenantControlDisabled,
              ]}
            >
              <View style={styles.tenantControlCopy}>
                <Text
                  style={[styles.tenantControlName, tokenStyles.foreground]}
                >
                  {currentTenant?.name ?? "Arbeitsbereich wird geladen …"}
                </Text>
                <Text style={[styles.tenantControlHint, tokenStyles.muted]}>
                  {tenants.length < 2
                    ? "Ihr einziger aktiver Mandant"
                    : "Antippen zum Wechseln"}
                </Text>
              </View>
              {tenants.length > 1 ? (
                <Ionicons
                  color={colors.primaryText}
                  name="chevron-forward"
                  size={20}
                />
              ) : null}
            </Pressable>
          </View>

          {pushNotificationsEnabled ? (
            <View style={[styles.card, tokenStyles.card, densityStyles.card]}>
              <View style={styles.cardHeading}>
                <View
                  style={[
                    styles.cardIcon,
                    { backgroundColor: colors.primarySoft },
                  ]}
                >
                  <Ionicons
                    color={colors.primaryText}
                    name="notifications-outline"
                    size={20}
                  />
                </View>
                <Text style={[styles.cardTitle, tokenStyles.foreground]}>
                  Benachrichtigungen
                </Text>
              </View>
              <Text style={[styles.cardHint, tokenStyles.muted]}>
                Lege fest, welche Hinweise nextDesk auf diesem iPhone senden
                darf.
              </Text>
              <Pressable
                accessibilityHint="Öffnet die Push-Benachrichtigungseinstellungen."
                accessibilityLabel="Push-Benachrichtigungen öffnen"
                accessibilityRole="button"
                onPress={() => router.push("/notifications" as never)}
                style={[
                  styles.tenantControl,
                  tokenStyles.control,
                  densityStyles.control,
                ]}
              >
                <View style={styles.tenantControlCopy}>
                  <Text
                    style={[styles.tenantControlName, tokenStyles.foreground]}
                  >
                    Push-Benachrichtigungen
                  </Text>
                  <Text style={[styles.tenantControlHint, tokenStyles.muted]}>
                    Kategorien, Ruhezeit und Testmitteilung
                  </Text>
                </View>
                <Ionicons
                  color={colors.primaryText}
                  name="chevron-forward"
                  size={20}
                />
              </Pressable>
            </View>
          ) : null}

          {availabilityAvailable ? (
            <View style={[styles.card, tokenStyles.card, densityStyles.card]}>
              <View style={styles.cardHeading}>
                <View
                  style={[
                    styles.cardIcon,
                    { backgroundColor: colors.infoSoft },
                  ]}
                >
                  <Ionicons color={colors.info} name="time-outline" size={20} />
                </View>
                <Text style={[styles.cardTitle, tokenStyles.foreground]}>
                  Erreichbarkeit
                </Text>
              </View>
              <Text style={[styles.cardHint, tokenStyles.muted]}>
                Teile mit, wann oder wie du bei Rückfragen zu deinen Tickets
                erreichbar bist. Der Hinweis ist nur für berechtigte Agenten in
                deinem Mandanten sichtbar.
              </Text>
              <Text style={[styles.fieldLabel, tokenStyles.muted]}>
                HINWEIS FÜR RÜCKFRAGEN
              </Text>
              <TextInput
                accessibilityHint="Maximal 300 Zeichen. Ein leerer Hinweis wird entfernt."
                accessibilityLabel="Eigene Erreichbarkeit"
                allowFontScaling
                maxLength={300}
                multiline
                onChangeText={(value) => {
                  availabilityDirty.current = true;
                  setAvailability(value);
                }}
                placeholder="Zum Beispiel: Heute ab 14 Uhr wieder erreichbar."
                placeholderTextColor={colors.subtle}
                style={[
                  styles.input,
                  styles.availabilityInput,
                  tokenStyles.control,
                  tokenStyles.foreground,
                ]}
                textAlignVertical="top"
                value={availability}
              />
              <Text style={[styles.characterCount, tokenStyles.muted]}>
                {availability.length}/300 Zeichen
              </Text>
              <Pressable
                accessibilityLabel={
                  availability.trim()
                    ? "Erreichbarkeit speichern"
                    : "Erreichbarkeit entfernen"
                }
                accessibilityRole="button"
                disabled={availabilitySaving}
                onPress={() => void saveAvailability()}
                style={[
                  styles.primaryButton,
                  availabilitySaving && styles.disabled,
                ]}
              >
                {availabilitySaving ? (
                  <ActivityIndicator color={colors.onPrimary} size="small" />
                ) : null}
                <Text
                  style={[styles.primaryButtonText, tokenStyles.primaryText]}
                >
                  {availabilitySaving
                    ? "Erreichbarkeit wird gespeichert …"
                    : availability.trim()
                      ? "Erreichbarkeit speichern"
                      : "Erreichbarkeit entfernen"}
                </Text>
              </Pressable>
            </View>
          ) : null}

          {deviceProtectionAvailable ? (
            <View style={[styles.card, tokenStyles.card, densityStyles.card]}>
              <View style={styles.cardHeading}>
                <View
                  style={[
                    styles.cardIcon,
                    { backgroundColor: colors.primarySoft },
                  ]}
                >
                  <Ionicons
                    color={colors.primaryText}
                    name="phone-portrait-outline"
                    size={20}
                  />
                </View>
                <Text style={[styles.cardTitle, tokenStyles.foreground]}>
                  Geräteschutz
                </Text>
              </View>
              <Text style={[styles.cardHint, tokenStyles.muted]}>
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
                  tokenStyles.control,
                  densityStyles.control,
                  deviceProtectionEnabled &&
                    styles.deviceProtectionControlActive,
                  deviceProtectionSaving && styles.disabled,
                ]}
              >
                <View style={styles.deviceProtectionCopy}>
                  <Text
                    style={[
                      styles.deviceProtectionTitle,
                      tokenStyles.foreground,
                    ]}
                  >
                    {deviceProtectionEnabled ? "Aktiv" : "Deaktiviert"}
                  </Text>
                  <Text
                    style={[styles.deviceProtectionHint, tokenStyles.muted]}
                  >
                    {deviceProtectionEnabled
                      ? "Beim Zurückkehren entsperren"
                      : "Auf diesem Gerät nicht geschützt"}
                  </Text>
                </View>
                {deviceProtectionSaving ? (
                  <ActivityIndicator color={colors.primaryText} size="small" />
                ) : (
                  <Ionicons
                    color={
                      deviceProtectionEnabled ? colors.success : colors.muted
                    }
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

          <View style={[styles.cacheNote, tokenStyles.info]}>
            <Ionicons
              color={colors.info}
              name="shield-checkmark-outline"
              size={20}
            />
            <View style={styles.noteCopy}>
              <Text style={styles.cacheNoteTitle}>Offline &amp; Cache</Text>
              <Text style={styles.cacheNoteText}>
                Nur Entwürfe und Favoriten bleiben verschlüsselt auf diesem
                Gerät. Tickets, Fotos, Assets und Wissen werden nicht offline
                gespeichert.
              </Text>
              <Pressable
                accessibilityRole="button"
                disabled={saving}
                onPress={() => void clearWorkingData()}
                style={styles.clearCacheButton}
              >
                <Text style={styles.clearCacheText}>
                  Arbeitsdaten entfernen
                </Text>
              </Pressable>
            </View>
          </View>

          <View style={[styles.card, tokenStyles.card, densityStyles.card]}>
            <View style={styles.cardHeading}>
              <View
                style={[
                  styles.cardIcon,
                  { backgroundColor: colors.primarySoft },
                ]}
              >
                <Ionicons
                  color={colors.primaryText}
                  name="color-palette-outline"
                  size={20}
                />
              </View>
              <Text style={[styles.cardTitle, tokenStyles.foreground]}>
                Darstellung
              </Text>
            </View>
            <Text style={[styles.cardHint, tokenStyles.muted]}>
              Standard ist Hell. „Wie iPhone“ folgt der Einstellung des Geräts.
              Die Wahl bleibt verschlüsselt nur auf diesem Gerät gespeichert.
            </Text>
            <Text style={[styles.fieldLabel, tokenStyles.muted]}>
              FARBDARSTELLUNG
            </Text>
            <View style={styles.preferenceOptions}>
              {themeOptions.map((option) => {
                const selected = themePreference === option.value;
                return (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    key={option.value}
                    onPress={() => setThemePreference(option.value)}
                    style={[
                      styles.preferenceOption,
                      tokenStyles.control,
                      selected && tokenStyles.primary,
                    ]}
                  >
                    <Text
                      style={[
                        styles.preferenceOptionText,
                        selected
                          ? tokenStyles.primaryText
                          : tokenStyles.foreground,
                      ]}
                    >
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={[styles.fieldLabel, tokenStyles.muted]}>
              ANZEIGEDICHTE
            </Text>
            <View style={styles.preferenceOptions}>
              {densityOptions.map((option) => {
                const selected = density === option.value;
                return (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    key={option.value}
                    onPress={() => setDensity(option.value)}
                    style={[
                      styles.preferenceOption,
                      tokenStyles.control,
                      selected && tokenStyles.primary,
                    ]}
                  >
                    <Text
                      style={[
                        styles.preferenceOptionText,
                        selected
                          ? tokenStyles.primaryText
                          : tokenStyles.foreground,
                      ]}
                    >
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={[styles.fieldLabel, tokenStyles.muted]}>BEWEGUNG</Text>
            <View style={styles.preferenceOptions}>
              {motionOptions.map((option) => {
                const selected = motionPreference === option.value;
                return (
                  <Pressable
                    accessibilityHint={
                      option.value === "system"
                        ? "Folgt der Bedienungshilfe Ihres Geräts."
                        : "Reduziert Bewegungen in dieser App."
                    }
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    key={option.value}
                    onPress={() => setMotionPreference(option.value)}
                    style={[
                      styles.preferenceOption,
                      tokenStyles.control,
                      selected && tokenStyles.primary,
                    ]}
                  >
                    <Text
                      style={[
                        styles.preferenceOptionText,
                        selected
                          ? tokenStyles.primaryText
                          : tokenStyles.foreground,
                      ]}
                    >
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={[styles.preferenceSummary, tokenStyles.muted]}>
              {preferencesReady
                ? reducedMotion
                  ? "Bewegungen sind reduziert."
                  : "Bewegungen folgen der Systemvorgabe."
                : "Darstellungspräferenzen werden geladen …"}
            </Text>
          </View>

          {profile?.canChangePassword ? (
            <View style={[styles.card, tokenStyles.card, densityStyles.card]}>
              <View style={styles.cardHeading}>
                <View
                  style={[
                    styles.cardIcon,
                    { backgroundColor: colors.infoSoft },
                  ]}
                >
                  <Ionicons color={colors.info} name="key-outline" size={20} />
                </View>
                <Text style={[styles.cardTitle, tokenStyles.foreground]}>
                  Passwort ändern
                </Text>
              </View>
              <Text style={[styles.cardHint, tokenStyles.muted]}>
                Verwende mindestens 12 Zeichen. Dein Passwort wird nie angezeigt
                oder in deinem Profil hinterlegt.
              </Text>
              <TextInput
                autoComplete="new-password"
                onChangeText={setPassword}
                placeholder="Neues Passwort"
                placeholderTextColor={colors.subtle}
                secureTextEntry
                allowFontScaling
                style={[
                  styles.input,
                  tokenStyles.control,
                  tokenStyles.foreground,
                ]}
                textContentType="newPassword"
                value={password}
              />
              <TextInput
                autoComplete="new-password"
                onChangeText={setPasswordConfirmation}
                placeholder="Neues Passwort bestätigen"
                placeholderTextColor={colors.subtle}
                secureTextEntry
                allowFontScaling
                style={[
                  styles.input,
                  tokenStyles.control,
                  tokenStyles.foreground,
                ]}
                textContentType="newPassword"
                value={passwordConfirmation}
              />
              <Pressable
                accessibilityRole="button"
                disabled={saving}
                onPress={() => void changePassword()}
                style={[styles.primaryButton, saving && styles.disabled]}
              >
                <Text
                  style={[styles.primaryButtonText, tokenStyles.primaryText]}
                >
                  {saving ? "Passwort wird geändert …" : "Passwort ändern"}
                </Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.ssoNote}>
              <Ionicons
                color={colors.primaryText}
                name="lock-closed-outline"
                size={20}
              />
              <View style={styles.noteCopy}>
                <Text style={styles.ssoNoteTitle}>
                  Passwort wird über SSO verwaltet
                </Text>
                <Text style={styles.ssoNoteText}>
                  Dein Konto wird über Microsoft Entra authentifiziert. Ändere
                  dein Passwort bitte direkt bei deinem Identitätsanbieter.
                </Text>
              </View>
            </View>
          )}

          <TeamMembersCard tenantId={confirmedTenantId} />

          <View style={styles.helpCard}>
            <Text style={styles.helpTitle}>Hilfe und Rechtliches</Text>
            {(
              [
                ["Support", SUPPORT_URL, "help-circle-outline"],
                ["Datenschutz", PRIVACY_URL, "shield-checkmark-outline"],
                ["Impressum", IMPRINT_URL, "document-text-outline"],
              ] as const
            ).map(([label, url, icon]) => (
              <Pressable
                accessibilityRole="link"
                key={label}
                onPress={() => void Linking.openURL(url).catch(() => undefined)}
                style={styles.helpRow}
              >
                <Ionicons color={colors.primaryText} name={icon} size={19} />
                <Text style={styles.helpRowText}>{label}</Text>
                <Ionicons color={colors.subtle} name="open-outline" size={16} />
              </Pressable>
            ))}
            <Text style={styles.helpMail}>{SUPPORT_EMAIL}</Text>
          </View>

          <Pressable
            accessibilityRole="button"
            onPress={() => void signOut()}
            style={[
              styles.signOutButton,
              {
                borderColor: colors.errorBorder,
                backgroundColor: colors.errorSoft,
              },
            ]}
          >
            <Ionicons color={colors.error} name="log-out-outline" size={19} />
            <Text style={styles.signOutText}>Abmelden</Text>
          </Pressable>

          <DeleteAccountButton />
        </ScrollView>

        <Modal
          animationType={reducedMotion ? "none" : "slide"}
          onRequestClose={() => setTenantPickerOpen(false)}
          transparent
          visible={
            tenantPickerOpen &&
            !checkingFeatures &&
            !switchingTenant &&
            Boolean(confirmedTenantId)
          }
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
                  <Ionicons color={colors.primaryText} name="close" size={22} />
                </Pressable>
              </View>
              <ScrollView contentContainerStyle={styles.tenantOptions}>
                {tenants.map((tenant) => {
                  const selected = tenant.id === currentTenant?.id;
                  return (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{
                        busy: tenantChangeSaving || switchingTenant,
                        disabled: tenantChangeSaving || switchingTenant,
                        selected,
                      }}
                      disabled={tenantChangeSaving || switchingTenant}
                      key={tenant.id}
                      onPress={() => void changeTenant(tenant.id)}
                      style={[
                        styles.tenantOption,
                        selected && styles.tenantOptionSelected,
                      ]}
                    >
                      <View style={styles.tenantOptionCopy}>
                        <Text style={styles.tenantOptionName}>
                          {tenant.name}
                        </Text>
                        <Text style={styles.tenantOptionSlug}>
                          {tenant.slug}
                        </Text>
                      </View>
                      {selected ? (
                        <Ionicons
                          color={colors.primaryText}
                          name="checkmark-circle"
                          size={22}
                        />
                      ) : (
                        <Ionicons
                          color={colors.subtle}
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
    </KeyboardAvoidingView>
  );
}

const useStyles = makeThemedStyles((c) => ({
  availabilityInput: { minHeight: 102, paddingTop: 12 },
  content: { gap: 16, paddingBottom: 34, paddingTop: 18 },
  characterCount: { alignSelf: "flex-end", fontSize: 11, marginTop: -2 },
  centered: {
    alignItems: "center",
    flex: 1,
    gap: 14,
    justifyContent: "center",
  },
  loadingText: { color: c.muted, fontSize: 14 },
  eyebrow: {
    color: c.muted,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.2,
  },
  title: {
    color: c.foreground,
    fontSize: 29,
    fontWeight: "900",
    letterSpacing: -0.8,
    marginTop: 4,
  },
  subtitle: { color: c.muted, fontSize: 14, lineHeight: 20, marginTop: 5 },
  card: {
    backgroundColor: c.surface,
    borderColor: c.border,
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
    backgroundColor: c.primarySoft,
    borderRadius: 11,
    height: 37,
    justifyContent: "center",
    width: 37,
  },
  cardTitle: { color: c.text, fontSize: 16, fontWeight: "900" },
  fieldLabel: {
    color: c.subtle,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.8,
    marginTop: 5,
  },
  secondLabel: { marginTop: 10 },
  fieldValue: { color: c.text, fontSize: 14, fontWeight: "700" },
  providerBadge: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: c.primarySoft,
    borderRadius: 10,
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  providerText: { color: c.primaryText, fontSize: 12, fontWeight: "800" },
  cardHint: { color: c.muted, fontSize: 12, lineHeight: 18, marginBottom: 2 },
  tenantControl: {
    alignItems: "center",
    backgroundColor: c.surfaceSubtle,
    borderColor: c.border,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 62,
    paddingHorizontal: 13,
  },
  tenantControlDisabled: { opacity: 0.72 },
  tenantControlCopy: { flex: 1, gap: 3, paddingRight: 10 },
  tenantControlName: { color: c.text, fontSize: 14, fontWeight: "800" },
  tenantControlHint: { color: c.muted, fontSize: 12 },
  deviceProtectionControl: {
    alignItems: "center",
    backgroundColor: c.surfaceSubtle,
    borderColor: c.border,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 62,
    paddingHorizontal: 13,
  },
  deviceProtectionControlActive: {
    backgroundColor: c.successSoft,
    borderColor: c.successBorder,
  },
  deviceProtectionCopy: { flex: 1, gap: 3, paddingRight: 10 },
  deviceProtectionTitle: { color: c.text, fontSize: 14, fontWeight: "900" },
  deviceProtectionHint: { color: c.muted, fontSize: 12 },
  input: {
    backgroundColor: c.surfaceSubtle,
    borderColor: c.border,
    borderRadius: 13,
    borderWidth: 1,
    color: c.foreground,
    fontSize: 14,
    minHeight: 50,
    paddingHorizontal: 13,
  },
  keyboardAvoiding: { flex: 1 },
  primaryButton: {
    alignItems: "center",
    backgroundColor: c.primary,
    borderRadius: 13,
    justifyContent: "center",
    marginTop: 4,
    minHeight: 50,
  },
  primaryButtonText: { color: c.onPrimary, fontSize: 14, fontWeight: "900" },
  ssoNote: {
    alignItems: "flex-start",
    backgroundColor: c.primarySoft,
    borderRadius: 19,
    flexDirection: "row",
    gap: 11,
    padding: 16,
  },
  noteCopy: { flex: 1 },
  cacheNoteTitle: { color: c.info, fontSize: 13, fontWeight: "900" },
  cacheNoteText: { color: c.info, fontSize: 12, lineHeight: 18, marginTop: 3 },
  ssoNoteTitle: { color: c.primaryText, fontSize: 13, fontWeight: "900" },
  ssoNoteText: {
    color: c.primaryText,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 3,
  },
  cacheNote: {
    alignItems: "flex-start",
    backgroundColor: c.infoSoft,
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
  clearCacheText: { color: c.info, fontSize: 12, fontWeight: "900" },
  helpCard: {
    backgroundColor: c.surface,
    borderColor: c.border,
    borderRadius: 19,
    borderWidth: 1,
    gap: 4,
    padding: 16,
  },
  helpMail: { color: c.muted, fontSize: 12, marginTop: 4 },
  helpRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    paddingVertical: 9,
  },
  helpRowText: {
    color: c.foreground,
    flex: 1,
    fontSize: 14,
    fontWeight: "700",
  },
  helpTitle: { color: c.foreground, fontSize: 15, fontWeight: "900" },
  signOutButton: {
    alignItems: "center",
    backgroundColor: c.errorSoft,
    borderColor: c.errorBorder,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    marginTop: 2,
    minHeight: 51,
  },
  signOutText: { color: c.error, fontSize: 14, fontWeight: "900" },
  feedback: {
    alignItems: "flex-start",
    borderRadius: 13,
    borderWidth: 1,
    flexDirection: "row",
    gap: 9,
    padding: 13,
  },
  feedbackText: { flex: 1, fontSize: 13, lineHeight: 19 },
  errorText: {},
  successText: {},
  preferenceOptions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  preferenceOption: {
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    flexGrow: 1,
    justifyContent: "center",
    minHeight: 42,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  preferenceOptionText: {
    fontSize: 12,
    fontWeight: "800",
    textAlign: "center",
  },
  preferenceSummary: { fontSize: 12, lineHeight: 18 },
  skeletonPage: { flex: 1, gap: 15, justifyContent: "center" },
  skeletonTitle: { borderRadius: 8, height: 30, width: "47%" },
  skeletonLine: { borderRadius: 6, height: 13, width: "100%" },
  skeletonShortLine: { borderRadius: 6, height: 12, width: "62%" },
  skeletonCard: {
    alignItems: "center",
    borderRadius: 21,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    minHeight: 92,
    padding: 17,
  },
  skeletonIcon: { borderRadius: 11, height: 37, width: 37 },
  skeletonCopy: { flex: 1, gap: 10 },
  modalRoot: {
    backgroundColor: c.overlay,
    flex: 1,
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: c.surface,
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
    color: c.muted,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.9,
  },
  sheetTitle: {
    color: c.foreground,
    fontSize: 21,
    fontWeight: "800",
    marginTop: 3,
  },
  sheetClose: {
    alignItems: "center",
    backgroundColor: c.primarySoft,
    borderRadius: 16,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  tenantOptions: { gap: 8, paddingBottom: 4 },
  tenantOption: {
    alignItems: "center",
    backgroundColor: c.surface,
    borderColor: c.border,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 62,
    paddingHorizontal: 14,
  },
  tenantOptionSelected: {
    backgroundColor: c.primarySoft,
    borderColor: c.primarySoftBorder,
  },
  tenantOptionCopy: { flex: 1, gap: 3, paddingRight: 12 },
  tenantOptionName: { color: c.text, fontSize: 15, fontWeight: "800" },
  tenantOptionSlug: { color: c.muted, fontSize: 12 },
  disabled: { opacity: 0.55 },
}));
