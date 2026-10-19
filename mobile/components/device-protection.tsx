import * as LocalAuthentication from "expo-local-authentication";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  type AppStateStatus,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  getDeviceProtectionPreference,
  setDeviceProtectionPreference,
} from "@/lib/mobile-private-state";
import { useMobileFeatures } from "@/components/mobile-feature-gate";
import { clearMobileWorkspace, nextDesk } from "@/lib/nextdesk-client";
import { unregisterPushDeviceBeforeSignOut } from "@/lib/push-notifications";
import { loadTenantBranding, type TenantBranding } from "@/lib/tenant-branding";
import { makeThemedStyles, useAppColors } from "@/lib/themed-styles";

/**
 * Antwortet die native Face-ID-/Gerätecode-Abfrage nicht, wird die Taste
 * nach dieser Zeit wieder freigegeben, damit niemand festhängt.
 */
const AUTHENTICATION_TIMEOUT_MS = 45_000;

type AuthenticationOutcome =
  | LocalAuthentication.LocalAuthenticationResult
  | { success: false; error: "timeout" };

function authenticateWithTimeout(): Promise<AuthenticationOutcome> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => resolve({ success: false, error: "timeout" }),
      AUTHENTICATION_TIMEOUT_MS,
    );
    LocalAuthentication.authenticateAsync({
      cancelLabel: "Später",
      disableDeviceFallback: false,
      fallbackLabel: "Gerätecode",
      promptMessage: "nextDesk entsperren",
    }).then(
      (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function DeviceProtection() {
  const styles = useStyles();
  const colors = useAppColors();
  const router = useRouter();
  const { tenantId: confirmedTenantId } = useMobileFeatures();
  const appState = useRef<AppStateStatus>(AppState.currentState);
  const checkingRef = useRef(false);
  /** Zuletzt bekannter Schutzstatus, um beim Verlassen sofort abzudecken. */
  const protectionEnabledRef = useRef(false);
  /** true, sobald die App wirklich im Hintergrund war (nicht nur inaktiv). */
  const wasInBackgroundRef = useRef(false);
  const [lockState, setLockState] = useState<
    "checking-session" | "locked" | "unlocked"
  >("checking-session");
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState("");
  const [branding, setBranding] = useState<{
    tenantId: string;
    value: TenantBranding;
  } | null>(null);
  const [failedLogoUrl, setFailedLogoUrl] = useState<string | null>(null);

  useEffect(() => {
    const tenantId = confirmedTenantId;
    let active = true;
    if (!tenantId)
      return () => {
        active = false;
      };
    void loadTenantBranding(tenantId)
      .then((value) => {
        if (active) setBranding({ tenantId, value });
      })
      .catch(() => {
        if (active) setBranding(null);
      });
    return () => {
      active = false;
    };
  }, [confirmedTenantId]);

  const activeBranding =
    branding?.tenantId === confirmedTenantId ? branding.value : null;
  const logoUrl =
    activeBranding?.logoUrl && activeBranding.logoUrl !== failedLogoUrl
      ? activeBranding.logoUrl
      : null;
  const platformName = activeBranding?.portalName ?? "nextDesk";

  const verify = useCallback(async () => {
    if (Platform.OS === "web" || checkingRef.current) return;
    checkingRef.current = true;
    setChecking(true);
    setMessage("");
    try {
      const session = (await nextDesk?.auth.getSession())?.data.session;
      if (!session?.user.id) {
        protectionEnabledRef.current = false;
        setLockState("unlocked");
        return;
      }
      const enabled = await getDeviceProtectionPreference(session.user.id);
      if (!enabled) {
        protectionEnabledRef.current = false;
        setLockState("unlocked");
        return;
      }
      const [hasHardware, enrolled] = await Promise.all([
        LocalAuthentication.hasHardwareAsync(),
        LocalAuthentication.isEnrolledAsync(),
      ]);
      if (!hasHardware || !enrolled) {
        await setDeviceProtectionPreference(session.user.id, false);
        protectionEnabledRef.current = false;
        setLockState("unlocked");
        return;
      }

      protectionEnabledRef.current = true;
      setLockState("locked");
      const result = await authenticateWithTimeout();
      if (result.success) {
        setLockState("unlocked");
      } else if (result.error === "timeout") {
        setMessage(
          "Die Entsperrung hat nicht geantwortet. Bitte tippen Sie erneut auf «Jetzt entsperren».",
        );
      } else {
        setMessage(
          "Entsperren Sie nextDesk mit Face ID, Touch ID oder Gerätecode.",
        );
      }
    } catch {
      setMessage(
        "Der Geräteschutz konnte nicht gestartet werden. Bitte versuchen Sie es erneut.",
      );
    } finally {
      checkingRef.current = false;
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void verify(), 0);
    return () => clearTimeout(timer);
  }, [verify]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      appState.current = nextState;
      // Face ID, Gerätecode, Kontrollzentrum, Kamera und Systemdialoge setzen
      // die App nur kurz auf "inactive". Würde das als Rückkehr gelten, löste
      // jede erfolgreiche Entsperrung sofort die nächste Abfrage aus (Schleife).
      // Gesperrt wird deshalb nur nach echtem Aufenthalt im Hintergrund.
      if (nextState === "background") {
        wasInBackgroundRef.current = true;
        // Inhalte im App-Umschalter sofort abdecken.
        if (protectionEnabledRef.current && !checkingRef.current) {
          setLockState("locked");
        }
        return;
      }
      if (nextState === "active" && wasInBackgroundRef.current) {
        wasInBackgroundRef.current = false;
        void verify();
      }
    });
    return () => subscription.remove();
  }, [verify]);

  async function signOut() {
    try {
      await unregisterPushDeviceBeforeSignOut();
      await nextDesk?.auth.signOut();
    } finally {
      await clearMobileWorkspace();
      setLockState("unlocked");
      router.replace("/auth");
    }
  }

  // Deliberately no native <Modal>: presenting and immediately dismissing an
  // iOS modal at app start left later taps on the sign-in screen without
  // onPress. A plain overlay is removed completely once the session is clear.
  if (Platform.OS === "web" || lockState === "unlocked") return null;
  return (
    <View
      accessibilityViewIsModal
      style={[StyleSheet.absoluteFill, styles.layer]}
    >
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.logoWrap}>
            <Image
              accessibilityLabel={`${platformName} Logo`}
              onError={() => logoUrl && setFailedLogoUrl(logoUrl)}
              resizeMode="contain"
              source={
                logoUrl ? { uri: logoUrl } : require("@/assets/images/icon.png")
              }
              style={logoUrl ? styles.customLogo : styles.defaultLogo}
            />
          </View>
          <Text style={styles.title}>
            {lockState === "checking-session"
              ? "Sitzung wird geprüft"
              : `${platformName} ist geschützt`}
          </Text>
          <Text style={styles.copy}>
            {lockState === "checking-session"
              ? "Vertrauliche Arbeitsdaten werden erst nach der Sicherheitsprüfung angezeigt."
              : "Entsperren Sie Ihre aktuelle Sitzung, bevor vertrauliche Ticket- und Assetdaten angezeigt werden."}
          </Text>
          {message ? <Text style={styles.message}>{message}</Text> : null}
          {lockState === "checking-session" ? (
            <ActivityIndicator color={colors.primary} size="small" />
          ) : (
            <>
              <Pressable
                accessibilityRole="button"
                disabled={checking}
                onPress={() => void verify()}
                style={[styles.unlock, checking && styles.disabled]}
              >
                {checking ? (
                  <ActivityIndicator color={colors.onPrimary} size="small" />
                ) : (
                  <Text style={styles.unlockText}>Jetzt entsperren</Text>
                )}
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => void signOut()}
                style={styles.signOut}
              >
                <Text style={styles.signOutText}>Abmelden</Text>
              </Pressable>
            </>
          )}
        </View>
      </View>
    </View>
  );
}

const useStyles = makeThemedStyles((c) => ({
  layer: { elevation: 1000, zIndex: 1000 },
  overlay: {
    alignItems: "center",
    backgroundColor: c.overlay,
    flex: 1,
    justifyContent: "center",
    padding: 24,
  },
  card: {
    alignItems: "center",
    backgroundColor: c.surface,
    borderRadius: 28,
    gap: 14,
    maxWidth: 380,
    padding: 26,
    width: "100%",
  },
  logoWrap: {
    alignItems: "center",
    backgroundColor: c.primarySoft,
    borderRadius: 22,
    height: 64,
    justifyContent: "center",
    maxWidth: 136,
    minWidth: 64,
    paddingHorizontal: 8,
  },
  defaultLogo: { height: 46, width: 46 },
  customLogo: { height: 50, maxWidth: 120, width: 120 },
  title: { color: c.foreground, fontSize: 21, fontWeight: "900" },
  copy: { color: c.muted, fontSize: 14, lineHeight: 21, textAlign: "center" },
  message: {
    color: c.warning,
    fontSize: 12,
    lineHeight: 17,
    textAlign: "center",
  },
  unlock: {
    alignItems: "center",
    backgroundColor: c.primary,
    borderRadius: 14,
    justifyContent: "center",
    marginTop: 4,
    minHeight: 48,
    width: "100%",
  },
  unlockText: { color: c.onPrimary, fontSize: 14, fontWeight: "900" },
  signOut: { justifyContent: "center", minHeight: 36, paddingHorizontal: 12 },
  signOutText: { color: c.error, fontSize: 13, fontWeight: "800" },
  disabled: { opacity: 0.55 },
}));
