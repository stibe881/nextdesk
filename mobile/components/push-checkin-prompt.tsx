import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Pressable,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useMobileFeatures } from "@/components/mobile-feature-gate";
import {
  hapticError,
  hapticSelection,
  hapticSuccess,
} from "@/lib/mobile-haptics";
import { getMobileUserId } from "@/lib/nextdesk-client";
import {
  checkInForPush,
  declinePushCheckIn,
  getPushNotificationStatus,
  isPushRegisteredOnThisDevice,
  type WorkHours,
} from "@/lib/push-notifications";
import { makeThemedStyles, useAppColors } from "@/lib/themed-styles";

const STATUS_REFRESH_INTERVAL_MS = 60_000;

function hourLabel(hour: number): string {
  return String(hour).padStart(2, "0");
}

export function PushCheckInPrompt() {
  const styles = useStyles();
  const colors = useAppColors();
  const insets = useSafeAreaInsets();
  const { isEnabled, loading, tenantId } = useMobileFeatures();
  const [workHours, setWorkHours] = useState<WorkHours | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const lastStatusLoadAt = useRef(0);
  const lastTenantId = useRef<string | null>(null);
  const mounted = useRef(true);
  const canLoadStatus =
    !loading && Boolean(tenantId) && isEnabled("notifications.push");

  const loadPrompt = useCallback(async () => {
    if (!canLoadStatus || !tenantId) {
      setWorkHours(null);
      setError("");
      return;
    }

    if (lastTenantId.current !== tenantId) {
      lastTenantId.current = tenantId;
      lastStatusLoadAt.current = 0;
    }

    const now = Date.now();
    if (now - lastStatusLoadAt.current < STATUS_REFRESH_INTERVAL_MS) return;
    lastStatusLoadAt.current = now;

    try {
      const [status, userId] = await Promise.all([
        getPushNotificationStatus(tenantId),
        getMobileUserId(),
      ]);
      const registered = await isPushRegisteredOnThisDevice({
        tenantId,
        userId,
      });
      if (!mounted.current) return;

      setError("");
      setWorkHours(
        status.workHours.promptDue && registered ? status.workHours : null,
      );
    } catch {
      if (!mounted.current) return;
      // A missing network connection or status endpoint must never obstruct the app.
      setWorkHours(null);
      setError("");
    }
  }, [canLoadStatus, tenantId]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void loadPrompt(), 0);
    return () => clearTimeout(timer);
  }, [loadPrompt]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void loadPrompt();
    });
    return () => subscription.remove();
  }, [loadPrompt]);

  async function submit(action: "checkIn" | "decline") {
    if (!tenantId || !workHours || saving) return;

    setSaving(true);
    setError("");
    hapticSelection();
    try {
      if (action === "checkIn") {
        await checkInForPush(tenantId);
      } else {
        await declinePushCheckIn(tenantId);
      }
      if (!mounted.current) return;
      hapticSuccess();
      setWorkHours(null);
    } catch (nextError) {
      if (!mounted.current) return;
      hapticError();
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Der Check-in konnte nicht geändert werden. Bitte versuche es erneut.",
      );
    } finally {
      if (mounted.current) setSaving(false);
    }
  }

  if (!workHours) return null;

  const greeting = new Date().getHours() < 11 ? "Guten Morgen" : null;

  return (
    <View accessibilityViewIsModal style={styles.layer}>
      <View
        style={[
          styles.backdrop,
          {
            paddingBottom: Math.max(insets.bottom, 24),
            paddingTop: Math.max(insets.top, 24),
          },
        ]}
      >
        <View style={[styles.card, { borderColor: colors.border }]}>
          <View
            style={[styles.iconWrap, { backgroundColor: colors.primarySoft }]}
          >
            <Ionicons
              color={colors.primaryText}
              name="time-outline"
              size={25}
            />
          </View>
          {greeting ? <Text style={styles.greeting}>{greeting}</Text> : null}
          <Text accessibilityRole="header" style={styles.title}>
            Einchecken?
          </Text>
          <Text style={styles.copy}>
            Möchtest du dich einchecken? Dann erhältst du heute bis{" "}
            {hourLabel(workHours.endHour)}:00 Uhr Push-Benachrichtigungen.
          </Text>
          {error ? (
            <View accessibilityRole="alert" style={styles.error}>
              <Ionicons
                color={colors.error}
                name="alert-circle-outline"
                size={19}
              />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}
          <Pressable
            accessibilityLabel="Für Push-Benachrichtigungen einchecken"
            accessibilityRole="button"
            accessibilityState={{ busy: saving, disabled: saving }}
            disabled={saving}
            onPress={() => void submit("checkIn")}
            style={[styles.primaryButton, saving && styles.disabled]}
          >
            {saving ? (
              <ActivityIndicator color={colors.onPrimary} size="small" />
            ) : (
              <Text style={styles.primaryButtonText}>Einchecken</Text>
            )}
          </Pressable>
          <Pressable
            accessibilityLabel="Check-in für heute ablehnen"
            accessibilityRole="button"
            accessibilityState={{ disabled: saving }}
            disabled={saving}
            onPress={() => void submit("decline")}
            style={[styles.secondaryButton, saving && styles.disabled]}
          >
            <Text style={styles.secondaryButtonText}>Heute nicht</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const useStyles = makeThemedStyles((c) => ({
  backdrop: {
    alignItems: "center",
    backgroundColor: c.overlay,
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  card: {
    alignItems: "center",
    backgroundColor: c.surface,
    borderRadius: 26,
    borderWidth: 1,
    gap: 12,
    maxWidth: 390,
    padding: 24,
    width: "100%",
  },
  copy: { color: c.muted, fontSize: 14, lineHeight: 21, textAlign: "center" },
  disabled: { opacity: 0.55 },
  error: {
    alignItems: "flex-start",
    alignSelf: "stretch",
    backgroundColor: c.errorSoft,
    borderColor: c.errorBorder,
    borderRadius: 13,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    padding: 11,
  },
  errorText: { color: c.error, flex: 1, fontSize: 12, lineHeight: 18 },
  greeting: {
    color: c.primaryText,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.6,
    marginBottom: -7,
    textTransform: "uppercase",
  },
  iconWrap: {
    alignItems: "center",
    borderRadius: 22,
    height: 54,
    justifyContent: "center",
    width: 54,
  },
  layer: {
    bottom: 0,
    elevation: 100,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 100,
  },
  primaryButton: {
    alignItems: "center",
    alignSelf: "stretch",
    backgroundColor: c.primary,
    borderRadius: 14,
    justifyContent: "center",
    marginTop: 4,
    minHeight: 49,
  },
  primaryButtonText: { color: c.onPrimary, fontSize: 14, fontWeight: "900" },
  secondaryButton: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 38,
    paddingHorizontal: 14,
  },
  secondaryButtonText: {
    color: c.primaryText,
    fontSize: 13,
    fontWeight: "900",
  },
  title: { color: c.foreground, fontSize: 22, fontWeight: "900" },
}));
