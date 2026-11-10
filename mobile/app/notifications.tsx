import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  Text,
  View,
} from "react-native";

import {
  MobileFeatureLoadingScreen,
  useMobileFeatures,
} from "@/components/mobile-feature-gate";
import { ScreenContainer } from "@/components/screen-container";
import {
  hapticError,
  hapticSelection,
  hapticSuccess,
} from "@/lib/mobile-haptics";
import { getMobileUserId } from "@/lib/nextdesk-client";
import {
  deviceTimezone,
  ALL_DELIVERY_DAYS,
  disablePushNotifications,
  enablePushNotifications,
  getPushNotificationStatus,
  getPushPermissionState,
  isPushRegisteredOnThisDevice,
  PUSH_CATEGORIES,
  sendPushTest,
  type PushCategory,
  type PushNotificationStatus,
  type PushPermissionState,
  type PushPreferences,
  updatePushPreferences,
} from "@/lib/push-notifications";
import { makeThemedStyles, useAppColors } from "@/lib/themed-styles";
import { useThemeContext } from "@/lib/theme-provider";

const CATEGORY_DETAILS: readonly {
  key: PushCategory;
  label: string;
  description: string;
}[] = [
  {
    key: "assigned",
    label: "Mir zugewiesene Tickets",
    description: "Wenn dir ein Ticket neu zugeteilt wird.",
  },
  {
    key: "requester_reply",
    label: "Antworten von Anfragenden",
    description: "Wenn eine anfragende Person auf dein Ticket antwortet.",
  },
  {
    key: "support_reply",
    label: "Antworten vom Support",
    description: "Wenn der Support auf dein Ticket antwortet.",
  },
  {
    key: "mention",
    label: "Erwähnungen",
    description: "Wenn du in einer internen Notiz erwähnt wirst.",
  },
  {
    key: "resolved",
    label: "Gelöste Tickets",
    description: "Wenn ein Ticket für dich als gelöst markiert wird.",
  },
  {
    key: "approval",
    label: "Freigaben",
    description: "Wenn für ein Ticket dein Entscheid benötigt wird.",
  },
  {
    key: "escalation",
    label: "Eskalationen",
    description: "Wenn ein relevantes Ticket eskaliert wird.",
  },
  {
    key: "security_report",
    label: "Phishing-Meldungen",
    description: "Wenn eine verdächtige E-Mail als Phishing gemeldet wird.",
  },
  {
    key: "incident",
    label: "Störungen",
    description:
      "Wenn PRTG eine Störung meldet und solange sie niemand bestätigt.",
  },
  {
    key: "follow_up",
    label: "Wiedervorlagen",
    description:
      "Erinnerungen zu Wiedervorlagen und aus zeitgesteuerten Regeln.",
  },
  {
    key: "sla",
    label: "SLA-Hinweise",
    description: "Wenn eine SLA-Frist Aufmerksamkeit braucht.",
  },
  {
    key: "shop",
    label: "Shop",
    description: "Freigaben, Bereitstellung und Status deiner Bestellungen.",
  },
  {
    key: "inventory_low_stock",
    label: "Lagerunterbestand",
    description:
      "Wenn die Verfügbarkeit eines Artikels den Mindestbestand erreicht.",
  },
  {
    key: "infrastructure",
    label: "Infrastruktur",
    description:
      "Wenn Garantie, Support, End of Life oder Wartung eines Geräts fällig werden.",
  },
];

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

function defaultPreferences(): PushPreferences {
  return {
    enabledCategories: PUSH_CATEGORIES.filter(
      (category) => category !== "inventory_low_stock",
    ),
    emailCategories: [],
    deliveryDays: [...ALL_DELIVERY_DAYS],
    quietEnd: 7,
    quietHoursEnabled: false,
    quietStart: 22,
    timezone: deviceTimezone(),
  };
}

const WEEKDAYS = [
  { day: 1, short: "Mo", long: "Montag" },
  { day: 2, short: "Di", long: "Dienstag" },
  { day: 3, short: "Mi", long: "Mittwoch" },
  { day: 4, short: "Do", long: "Donnerstag" },
  { day: 5, short: "Fr", long: "Freitag" },
  { day: 6, short: "Sa", long: "Samstag" },
  { day: 7, short: "So", long: "Sonntag" },
];

function weekdaysLabel(days: readonly number[]): string {
  const sorted = [...new Set(days)].sort((left, right) => left - right);
  if (sorted.length === 7) return "Täglich";
  const short = (day: number) =>
    WEEKDAYS.find((entry) => entry.day === day)?.short ?? "";
  const first = sorted[0] ?? 1;
  const last = sorted[sorted.length - 1] ?? first;
  return sorted.length >= 3 && last - first === sorted.length - 1
    ? `${short(first)}–${short(last)}`
    : sorted.map(short).join(", ");
}

function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

function testFeedback(
  results: Awaited<ReturnType<typeof sendPushTest>>["results"],
): string {
  if (results.some((result) => result.status === "sent")) {
    return "Testmitteilung wurde an deine registrierten Geräte gesendet.";
  }
  if (results.some((result) => result.status === "disabled")) {
    return "Dieses iPhone ist für Push-Benachrichtigungen derzeit nicht aktiv.";
  }
  return "Die Testmitteilung konnte nicht gesendet werden. Bitte versuche es später erneut.";
}

export default function NotificationsScreen() {
  const router = useRouter();
  const styles = useStyles();
  const colors = useAppColors();
  const { density } = useThemeContext();
  const {
    isEnabled,
    loading: checkingFeatures,
    tenantId,
  } = useMobileFeatures();
  const pushFeatureEnabled = isEnabled("notifications.push");
  const [status, setStatus] = useState<PushNotificationStatus | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [permission, setPermission] =
    useState<PushPermissionState>("undetermined");
  const [registered, setRegistered] = useState(false);
  const [loading, setLoading] = useState(true);
  const [masterSaving, setMasterSaving] = useState(false);
  const [preferenceSaving, setPreferenceSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const densityStyles = useMemo(
    () => ({
      card: { padding: density === "compact" ? 14 : 17 },
      content: { gap: density === "compact" ? 12 : 16 },
    }),
    [density],
  );

  const load = useCallback(async () => {
    if (!tenantId || !pushFeatureEnabled) return;
    setLoading(true);
    try {
      setError("");
      const [nextStatus, nextUserId, nextPermission] = await Promise.all([
        getPushNotificationStatus(tenantId),
        getMobileUserId(),
        getPushPermissionState(),
      ]);
      const nextRegistered = await isPushRegisteredOnThisDevice({
        tenantId,
        userId: nextUserId,
      });
      setStatus(nextStatus);
      setUserId(nextUserId);
      setPermission(nextPermission);
      setRegistered(nextRegistered);
    } catch (nextError) {
      setStatus(null);
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Push-Benachrichtigungen konnten nicht geladen werden. Bitte versuche es später erneut.",
      );
    } finally {
      setLoading(false);
    }
  }, [pushFeatureEnabled, tenantId]);

  useFocusEffect(
    useCallback(() => {
      if (checkingFeatures || !pushFeatureEnabled) return;
      void load();
    }, [checkingFeatures, load, pushFeatureEnabled]),
  );

  const preferences = status?.preferences ?? defaultPreferences();
  const applicableCategories = status?.applicableCategories ?? [];
  const emailAvailable = status?.emailAvailable ?? false;
  const context = tenantId && userId ? { tenantId, userId } : null;
  const masterDisabled =
    !context ||
    masterSaving ||
    (!registered &&
      (!status?.featureEnabled ||
        !status.apnsConfigured ||
        permission === "unsupported"));
  const canSavePreferences = Boolean(tenantId && status?.featureEnabled);
  // Personal notification window, stored as quiet hours: "from 06 to 17"
  // means quiet from 17 to 06.
  // means quiet from 17 to 06. Without quiet hours the chosen days apply
  // all day (00:00–24:00).
  const deliveryDays = preferences.deliveryDays ?? ALL_DELIVERY_DAYS;
  const timeLimited =
    preferences.quietHoursEnabled &&
    preferences.quietStart !== preferences.quietEnd;
  const deliveryLimited = timeLimited || deliveryDays.length < 7;
  const windowStart = timeLimited ? preferences.quietEnd : 0;
  const windowEnd = timeLimited ? preferences.quietStart : 0;
  const deliveryDescription = !deliveryLimited
    ? "Jederzeit"
    : timeLimited
      ? `${weekdaysLabel(deliveryDays)} von ${hourLabel(windowStart)} bis ${hourLabel(windowEnd === 0 ? 24 : windowEnd)} Uhr`
      : `${weekdaysLabel(deliveryDays)} ganztags`;

  const statusDescription = (() => {
    if (!status) return "Status wird geprüft";
    if (!status.featureEnabled) {
      return "Für deinen Mandanten noch nicht aktiviert";
    }
    if (!status.apnsConfigured) {
      return "Apple-Zugang wird noch eingerichtet";
    }
    if (permission === "denied") {
      return "Mitteilungen in iOS deaktiviert";
    }
    if (registered) return "Aktiv auf diesem iPhone";
    return "Auf diesem iPhone nicht aktiviert";
  })();
  const statusColor =
    registered && status?.featureEnabled && status.apnsConfigured
      ? colors.success
      : permission === "denied" || !status?.featureEnabled
        ? colors.error
        : colors.warning;
  const statusBackground =
    registered && status?.featureEnabled && status.apnsConfigured
      ? colors.successSoft
      : permission === "denied" || !status?.featureEnabled
        ? colors.errorSoft
        : colors.warningSoft;
  const statusBorder =
    registered && status?.featureEnabled && status.apnsConfigured
      ? colors.successBorder
      : permission === "denied" || !status?.featureEnabled
        ? colors.errorBorder
        : colors.warningBorder;

  async function toggleMaster(nextValue: boolean) {
    if (!context || masterSaving) return;
    setMasterSaving(true);
    setError("");
    setMessage("");
    hapticSelection();
    try {
      if (nextValue) {
        await enablePushNotifications(context);
        setRegistered(true);
        setPermission(await getPushPermissionState());
        setMessage("Push-Benachrichtigungen sind auf diesem iPhone aktiv.");
      } else {
        await disablePushNotifications(context);
        setRegistered(false);
        setMessage(
          "Push-Benachrichtigungen wurden auf diesem iPhone deaktiviert.",
        );
      }
      hapticSuccess();
      void load();
    } catch (nextError) {
      hapticError();
      setPermission(await getPushPermissionState().catch(() => permission));
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Push-Benachrichtigungen konnten nicht geändert werden.",
      );
    } finally {
      setMasterSaving(false);
    }
  }

  async function savePreferences(nextPreferences: PushPreferences) {
    if (!tenantId || !canSavePreferences || preferenceSaving) return;
    setPreferenceSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await updatePushPreferences({
        tenantId,
        preferences: nextPreferences,
      });
      setStatus((current) =>
        current ? { ...current, preferences: response.preferences } : current,
      );
      setMessage("Deine Benachrichtigungseinstellungen wurden gespeichert.");
      hapticSuccess();
    } catch (nextError) {
      hapticError();
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Die Benachrichtigungseinstellungen konnten nicht gespeichert werden.",
      );
    } finally {
      setPreferenceSaving(false);
    }
  }

  function toggleCategory(
    category: PushCategory,
    channel: "push" | "email",
    enabled: boolean,
  ) {
    hapticSelection();
    const key = channel === "push" ? "enabledCategories" : "emailCategories";
    const next = enabled
      ? [...new Set([...preferences[key], category])]
      : preferences[key].filter((item) => item !== category);
    void savePreferences({ ...preferences, [key]: next });
  }

  function toggleQuietHours(enabled: boolean) {
    hapticSelection();
    void savePreferences(
      enabled
        ? {
            ...preferences,
            // Default: Monday to Friday, 06:00–17:00.
            quietHoursEnabled: true,
            quietStart: 17,
            quietEnd: 6,
            deliveryDays: [1, 2, 3, 4, 5],
          }
        : {
            ...preferences,
            quietHoursEnabled: false,
            deliveryDays: [...ALL_DELIVERY_DAYS],
          },
    );
  }

  function toggleDeliveryDay(day: number) {
    hapticSelection();
    const selected = deliveryDays.includes(day);
    if (selected && deliveryDays.length === 1) return;
    void savePreferences({
      ...preferences,
      deliveryDays: selected
        ? deliveryDays.filter((entry) => entry !== day)
        : [...deliveryDays, day].sort((left, right) => left - right),
    });
  }

  // "quietEnd" is the window start, "quietStart" the window end.
  function chooseHour(key: "quietStart" | "quietEnd", hour: number) {
    hapticSelection();
    void savePreferences({
      ...preferences,
      quietHoursEnabled: true,
      quietStart: key === "quietStart" ? hour : windowEnd,
      quietEnd: key === "quietEnd" ? hour : windowStart,
    });
  }

  async function openIosSettings() {
    try {
      await Linking.openSettings();
    } catch {
      setError("Die iPhone-Einstellungen konnten nicht geöffnet werden.");
    }
  }

  async function sendTestNotification() {
    if (!tenantId || testing) return;
    setTesting(true);
    setError("");
    setMessage("");
    try {
      const { results } = await sendPushTest(tenantId);
      const feedback = testFeedback(results);
      setMessage(feedback);
      if (results.some((result) => result.status === "sent")) {
        hapticSuccess();
      } else {
        hapticError();
      }
    } catch (nextError) {
      hapticError();
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Die Testmitteilung konnte nicht gesendet werden.",
      );
    } finally {
      setTesting(false);
    }
  }

  if (checkingFeatures) return <MobileFeatureLoadingScreen />;

  if (!pushFeatureEnabled) {
    return (
      <ScreenContainer
        containerClassName="bg-background"
        className="px-5"
        style={{ backgroundColor: colors.background }}
      >
        <View style={styles.unavailable}>
          <Ionicons
            color={colors.primaryText}
            name="lock-closed-outline"
            size={26}
          />
          <Text style={[styles.unavailableTitle, { color: colors.foreground }]}>
            Benachrichtigungen sind nicht verfügbar
          </Text>
          <Text style={[styles.unavailableCopy, { color: colors.muted }]}>
            Push-Benachrichtigungen sind für diesen Mandanten derzeit nicht
            freigeschaltet.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.back()}
            style={styles.backButton}
          >
            <Text
              style={[styles.backButtonText, { color: colors.primaryText }]}
            >
              Zurück zu den Einstellungen
            </Text>
          </Pressable>
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
          <View style={styles.topBar}>
            <Pressable
              accessibilityLabel="Zurück zu den Einstellungen"
              accessibilityRole="button"
              onPress={() => router.back()}
              style={[styles.backIcon, { backgroundColor: colors.primarySoft }]}
            >
              <Ionicons
                color={colors.primaryText}
                name="chevron-back"
                size={22}
              />
            </Pressable>
            <View style={styles.topCopy}>
              <Text style={[styles.eyebrow, { color: colors.muted }]}>
                MEIN KONTO
              </Text>
              <Text style={[styles.title, { color: colors.foreground }]}>
                Benachrichtigungen
              </Text>
            </View>
          </View>
          <Text style={[styles.subtitle, { color: colors.muted }]}>
            Bestimme, welche Hinweise nextDesk auf diesem iPhone senden darf.
          </Text>

          {error ? (
            <View
              accessibilityRole="alert"
              style={[
                styles.feedback,
                {
                  backgroundColor: colors.errorSoft,
                  borderColor: colors.errorBorder,
                },
              ]}
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
              accessibilityLiveRegion="polite"
              accessibilityRole="alert"
              style={[
                styles.feedback,
                {
                  backgroundColor: colors.successSoft,
                  borderColor: colors.successBorder,
                },
              ]}
            >
              <Ionicons
                color={colors.success}
                name="checkmark-circle-outline"
                size={20}
              />
              <Text style={[styles.feedbackText, { color: colors.success }]}>
                {message}
              </Text>
            </View>
          ) : null}

          <View
            style={[
              styles.statusCard,
              densityStyles.card,
              { backgroundColor: statusBackground, borderColor: statusBorder },
            ]}
          >
            <View style={styles.statusHeading}>
              <View style={styles.statusCopy}>
                <Text
                  style={[styles.statusTitle, { color: colors.foreground }]}
                >
                  Push-Benachrichtigungen
                </Text>
                <Text style={[styles.statusText, { color: statusColor }]}>
                  {loading ? "Status wird geprüft …" : statusDescription}
                </Text>
              </View>
              {masterSaving ? (
                <ActivityIndicator color={colors.primaryText} size="small" />
              ) : (
                <Switch
                  accessibilityLabel="Push-Benachrichtigungen auf diesem iPhone"
                  accessibilityRole="switch"
                  accessibilityState={{
                    checked: registered,
                    disabled: masterDisabled,
                  }}
                  disabled={masterDisabled}
                  onValueChange={(value) => void toggleMaster(value)}
                  thumbColor={registered ? colors.onPrimary : colors.surface}
                  trackColor={{ false: colors.border, true: colors.primary }}
                  value={registered}
                />
              )}
            </View>
            {permission === "denied" ? (
              <Pressable
                accessibilityLabel="iPhone-Einstellungen für Mitteilungen öffnen"
                accessibilityRole="button"
                onPress={() => void openIosSettings()}
                style={[
                  styles.settingsButton,
                  { borderColor: colors.primarySoftBorder },
                ]}
              >
                <Ionicons
                  color={colors.primaryText}
                  name="settings-outline"
                  size={17}
                />
                <Text
                  style={[
                    styles.settingsButtonText,
                    { color: colors.primaryText },
                  ]}
                >
                  Einstellungen öffnen
                </Text>
              </Pressable>
            ) : null}
          </View>

          {status?.featureEnabled && status.apnsConfigured ? (
            <>
              <View
                style={[
                  styles.card,
                  densityStyles.card,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                  },
                ]}
              >
                <View style={styles.cardHeading}>
                  <View
                    style={[
                      styles.cardIcon,
                      { backgroundColor: colors.primarySoft },
                    ]}
                  >
                    <Ionicons
                      color={colors.primaryText}
                      name="options-outline"
                      size={20}
                    />
                  </View>
                  <View style={styles.cardHeadingCopy}>
                    <Text
                      style={[styles.cardTitle, { color: colors.foreground }]}
                    >
                      Kategorien
                    </Text>
                    <Text style={[styles.cardHint, { color: colors.muted }]}>
                      Wähle pro Hinweis, ob er als Push, als Mail oder beides
                      kommen soll.
                    </Text>
                  </View>
                </View>
                {applicableCategories.length === 0 ? (
                  <Text style={[styles.emptyCopy, { color: colors.muted }]}>
                    Für deine Rolle sind derzeit keine Push-Kategorien
                    verfügbar.
                  </Text>
                ) : (
                  <View style={styles.categoryList}>
                    {CATEGORY_DETAILS.filter((category) =>
                      applicableCategories.includes(category.key),
                    ).map((category) => {
                      const enabled = preferences.enabledCategories.includes(
                        category.key,
                      );
                      const emailEnabled = preferences.emailCategories.includes(
                        category.key,
                      );
                      return (
                        <View
                          key={category.key}
                          style={[
                            styles.categoryRow,
                            { borderColor: colors.border },
                          ]}
                        >
                          <View style={styles.categoryCopy}>
                            <Text
                              style={[
                                styles.categoryTitle,
                                { color: colors.foreground },
                              ]}
                            >
                              {category.label}
                            </Text>
                            <Text
                              style={[
                                styles.categoryDescription,
                                { color: colors.muted },
                              ]}
                            >
                              {category.description}
                            </Text>
                          </View>
                          <View style={styles.channelSwitches}>
                            {(
                              [
                                ["push", "Push", enabled],
                                ["email", "Mail", emailEnabled],
                              ] as const
                            ).map(([channel, label, on]) => {
                              const unavailable =
                                channel === "email" && !emailAvailable;
                              return (
                                <View
                                  key={channel}
                                  style={styles.channelSwitch}
                                >
                                  <Text
                                    style={[
                                      styles.channelLabel,
                                      { color: colors.muted },
                                    ]}
                                  >
                                    {label}
                                  </Text>
                                  <Switch
                                    accessibilityLabel={`${category.label} per ${label} ${on ? "deaktivieren" : "aktivieren"}`}
                                    accessibilityRole="switch"
                                    accessibilityState={{
                                      checked: on && !unavailable,
                                      disabled: preferenceSaving || unavailable,
                                    }}
                                    disabled={preferenceSaving || unavailable}
                                    onValueChange={(value) =>
                                      toggleCategory(
                                        category.key,
                                        channel,
                                        value,
                                      )
                                    }
                                    thumbColor={
                                      on ? colors.onPrimary : colors.surface
                                    }
                                    trackColor={{
                                      false: colors.border,
                                      true: colors.primary,
                                    }}
                                    value={on && !unavailable}
                                  />
                                </View>
                              );
                            })}
                          </View>
                        </View>
                      );
                    })}
                  </View>
                )}
              </View>

              <View
                style={[
                  styles.card,
                  densityStyles.card,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                  },
                ]}
              >
                <View style={styles.cardHeading}>
                  <View
                    style={[
                      styles.cardIcon,
                      { backgroundColor: colors.infoSoft },
                    ]}
                  >
                    <Ionicons
                      color={colors.info}
                      name="time-outline"
                      size={20}
                    />
                  </View>
                  <View style={styles.cardHeadingCopy}>
                    <Text
                      style={[styles.cardTitle, { color: colors.foreground }]}
                    >
                      Benachrichtigungszeit
                    </Text>
                    <Text style={[styles.cardHint, { color: colors.muted }]}>
                      {deliveryDescription}
                    </Text>
                  </View>
                  <Switch
                    accessibilityLabel="Nur zu bestimmten Zeiten benachrichtigen"
                    accessibilityRole="switch"
                    accessibilityState={{
                      checked: deliveryLimited,
                      disabled: preferenceSaving,
                    }}
                    disabled={preferenceSaving}
                    onValueChange={toggleQuietHours}
                    thumbColor={
                      deliveryLimited ? colors.onPrimary : colors.surface
                    }
                    trackColor={{ false: colors.border, true: colors.primary }}
                    value={deliveryLimited}
                  />
                </View>
                <Text style={[styles.quietNote, { color: colors.muted }]}>
                  {deliveryLimited
                    ? "Was ausserhalb dieser Zeit anfällt, kommt zu Beginn der nächsten Benachrichtigungszeit. In nextDesk siehst du alles sofort."
                    : "Schalte ein, um Push-Mitteilungen nur an bestimmten Tagen und Zeiten zu erhalten."}
                </Text>
                {deliveryLimited ? (
                  <>
                    <Text style={[styles.timeLabel, { color: colors.subtle }]}>
                      TAGE
                    </Text>
                    <View style={styles.dayChoices}>
                      {WEEKDAYS.map((weekday) => {
                        const selected = deliveryDays.includes(weekday.day);
                        return (
                          <Pressable
                            accessibilityLabel={weekday.long}
                            accessibilityRole="button"
                            accessibilityState={{
                              selected,
                              disabled: preferenceSaving,
                            }}
                            disabled={preferenceSaving}
                            key={`day-${weekday.day}`}
                            onPress={() => toggleDeliveryDay(weekday.day)}
                            style={[
                              styles.hourChoice,
                              styles.dayChoice,
                              {
                                backgroundColor: selected
                                  ? colors.primary
                                  : colors.surfaceSubtle,
                                borderColor: selected
                                  ? colors.primary
                                  : colors.border,
                              },
                            ]}
                          >
                            <Text
                              style={[
                                styles.hourChoiceText,
                                {
                                  color: selected
                                    ? colors.onPrimary
                                    : colors.foreground,
                                },
                              ]}
                            >
                              {weekday.short}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                    <Text style={[styles.timeLabel, { color: colors.subtle }]}>
                      VON
                    </Text>
                    <ScrollView
                      contentContainerStyle={styles.hourChoices}
                      horizontal
                      showsHorizontalScrollIndicator={false}
                    >
                      {HOURS.map((hour) => {
                        const selected = windowStart === hour;
                        return (
                          <Pressable
                            accessibilityLabel={`Benachrichtigungen ab ${hourLabel(hour)} Uhr`}
                            accessibilityRole="button"
                            accessibilityState={{
                              selected,
                              disabled: preferenceSaving,
                            }}
                            disabled={preferenceSaving}
                            key={`start-${hour}`}
                            onPress={() => chooseHour("quietEnd", hour)}
                            style={[
                              styles.hourChoice,
                              {
                                backgroundColor: selected
                                  ? colors.primary
                                  : colors.surfaceSubtle,
                                borderColor: selected
                                  ? colors.primary
                                  : colors.border,
                              },
                            ]}
                          >
                            <Text
                              style={[
                                styles.hourChoiceText,
                                {
                                  color: selected
                                    ? colors.onPrimary
                                    : colors.foreground,
                                },
                              ]}
                            >
                              {hourLabel(hour)}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </ScrollView>
                    <Text style={[styles.timeLabel, { color: colors.subtle }]}>
                      BIS
                    </Text>
                    <ScrollView
                      contentContainerStyle={styles.hourChoices}
                      horizontal
                      showsHorizontalScrollIndicator={false}
                    >
                      {[...HOURS.filter((hour) => hour !== 0), 0].map(
                        (hour) => {
                          const selected = windowEnd === hour;
                          return (
                            <Pressable
                              accessibilityLabel={`Benachrichtigungen bis ${hourLabel(hour === 0 ? 24 : hour)} Uhr`}
                              accessibilityRole="button"
                              accessibilityState={{
                                selected,
                                disabled: preferenceSaving,
                              }}
                              disabled={preferenceSaving}
                              key={`end-${hour}`}
                              onPress={() => chooseHour("quietStart", hour)}
                              style={[
                                styles.hourChoice,
                                {
                                  backgroundColor: selected
                                    ? colors.primary
                                    : colors.surfaceSubtle,
                                  borderColor: selected
                                    ? colors.primary
                                    : colors.border,
                                },
                              ]}
                            >
                              <Text
                                style={[
                                  styles.hourChoiceText,
                                  {
                                    color: selected
                                      ? colors.onPrimary
                                      : colors.foreground,
                                  },
                                ]}
                              >
                                {hourLabel(hour === 0 ? 24 : hour)}
                              </Text>
                            </Pressable>
                          );
                        },
                      )}
                    </ScrollView>
                  </>
                ) : null}
              </View>

              <View
                style={[
                  styles.card,
                  densityStyles.card,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                  },
                ]}
              >
                <View style={styles.cardHeading}>
                  <View
                    style={[
                      styles.cardIcon,
                      { backgroundColor: colors.primarySoft },
                    ]}
                  >
                    <Ionicons
                      color={colors.primaryText}
                      name="flask-outline"
                      size={20}
                    />
                  </View>
                  <View style={styles.cardHeadingCopy}>
                    <Text
                      style={[styles.cardTitle, { color: colors.foreground }]}
                    >
                      Testmitteilung
                    </Text>
                    <Text style={[styles.cardHint, { color: colors.muted }]}>
                      Prüfe, ob Push-Benachrichtigungen auf diesem iPhone
                      ankommen.
                    </Text>
                  </View>
                </View>
                <Pressable
                  accessibilityLabel="Testmitteilung senden"
                  accessibilityRole="button"
                  accessibilityState={{ disabled: testing || !registered }}
                  disabled={testing || !registered}
                  onPress={() => void sendTestNotification()}
                  style={[
                    styles.testButton,
                    { backgroundColor: colors.primary },
                    (testing || !registered) && styles.disabled,
                  ]}
                >
                  {testing ? (
                    <ActivityIndicator color={colors.onPrimary} size="small" />
                  ) : null}
                  <Text
                    style={[styles.testButtonText, { color: colors.onPrimary }]}
                  >
                    {testing
                      ? "Testmitteilung wird gesendet …"
                      : "Testmitteilung senden"}
                  </Text>
                </Pressable>
                {!registered ? (
                  <Text style={[styles.testHint, { color: colors.muted }]}>
                    Aktiviere zuerst Push-Benachrichtigungen auf diesem iPhone.
                  </Text>
                ) : null}
              </View>
            </>
          ) : null}

          <View
            style={[styles.privacyNote, { backgroundColor: colors.infoSoft }]}
          >
            <Ionicons
              color={colors.info}
              name="shield-checkmark-outline"
              size={20}
            />
            <Text style={[styles.privacyText, { color: colors.info }]}>
              Mitteilungen werden über Apple zugestellt und enthalten keine
              Nachrichtentexte.
            </Text>
          </View>
        </ScrollView>
      </ScreenContainer>
    </KeyboardAvoidingView>
  );
}

const useStyles = makeThemedStyles((c) => ({
  backButton: { marginTop: 8, minHeight: 42, paddingHorizontal: 12 },
  backButtonText: { fontSize: 13, fontWeight: "900" },
  backIcon: {
    alignItems: "center",
    borderRadius: 18,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  card: {
    borderRadius: 21,
    borderWidth: 1,
    gap: 12,
    padding: 17,
  },
  cardHeading: { alignItems: "center", flexDirection: "row", gap: 10 },
  cardHeadingCopy: { flex: 1, gap: 2 },
  cardHint: { fontSize: 12, lineHeight: 18 },
  cardIcon: {
    alignItems: "center",
    backgroundColor: c.primarySoft,
    borderRadius: 11,
    height: 37,
    justifyContent: "center",
    width: 37,
  },
  cardTitle: { fontSize: 16, fontWeight: "900" },
  categoryCopy: { flex: 1, gap: 3, paddingRight: 12 },
  categoryDescription: { fontSize: 12, lineHeight: 17 },
  channelLabel: { fontSize: 10, fontWeight: "800", letterSpacing: 0.4 },
  channelSwitch: { alignItems: "center", gap: 4 },
  channelSwitches: { flexDirection: "row", gap: 10 },
  categoryList: { gap: 1 },
  categoryRow: {
    alignItems: "center",
    borderTopWidth: 1,
    flexDirection: "row",
    minHeight: 66,
    paddingVertical: 10,
  },
  categoryTitle: { fontSize: 14, fontWeight: "800" },
  content: { gap: 16, paddingBottom: 34, paddingTop: 18 },
  disabled: { opacity: 0.52 },
  emptyCopy: { fontSize: 13, lineHeight: 19 },
  eyebrow: { fontSize: 10, fontWeight: "900", letterSpacing: 1.1 },
  feedback: {
    alignItems: "flex-start",
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: 9,
    padding: 13,
  },
  feedbackText: { flex: 1, fontSize: 13, lineHeight: 19 },
  hourChoice: {
    alignItems: "center",
    borderRadius: 11,
    borderWidth: 1,
    minHeight: 38,
    justifyContent: "center",
    minWidth: 57,
    paddingHorizontal: 10,
  },
  hourChoiceText: { fontSize: 12, fontWeight: "800" },
  hourChoices: { gap: 7, paddingRight: 12 },
  dayChoices: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  dayChoice: { minWidth: 44 },
  keyboardAvoiding: { flex: 1 },
  privacyNote: {
    alignItems: "flex-start",
    borderRadius: 18,
    flexDirection: "row",
    gap: 11,
    padding: 15,
  },
  privacyText: { flex: 1, fontSize: 12, fontWeight: "700", lineHeight: 18 },
  quietNote: { fontSize: 12, lineHeight: 18 },
  settingsButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    borderRadius: 11,
    borderWidth: 1,
    flexDirection: "row",
    gap: 7,
    minHeight: 40,
    paddingHorizontal: 11,
  },
  settingsButtonText: { fontSize: 12, fontWeight: "900" },
  statusCard: { borderRadius: 21, borderWidth: 1, gap: 11, padding: 17 },
  statusCopy: { flex: 1, gap: 3, paddingRight: 10 },
  statusHeading: { alignItems: "center", flexDirection: "row" },
  statusText: { fontSize: 13, fontWeight: "800", lineHeight: 18 },
  statusTitle: { fontSize: 16, fontWeight: "900" },
  subtitle: { fontSize: 14, lineHeight: 20, marginTop: -10 },
  testButton: {
    alignItems: "center",
    borderRadius: 13,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    minHeight: 49,
  },
  testButtonText: { fontSize: 14, fontWeight: "900" },
  testHint: { fontSize: 12, lineHeight: 18, marginTop: -3 },
  timeLabel: {
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.8,
    marginTop: 2,
  },
  title: { fontSize: 26, fontWeight: "900", letterSpacing: -0.6, marginTop: 2 },
  topBar: { alignItems: "center", flexDirection: "row", gap: 11 },
  topCopy: { flex: 1 },
  unavailable: {
    alignItems: "center",
    flex: 1,
    gap: 12,
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  unavailableCopy: { fontSize: 14, lineHeight: 21, textAlign: "center" },
  unavailableTitle: { fontSize: 20, fontWeight: "900", textAlign: "center" },
  workHoursButton: {
    alignItems: "center",
    borderRadius: 13,
    justifyContent: "center",
    minHeight: 46,
  },
  workHoursButtonText: { fontSize: 14, fontWeight: "900" },
  workHoursStatus: { fontSize: 13, fontWeight: "700", lineHeight: 18 },
}));
