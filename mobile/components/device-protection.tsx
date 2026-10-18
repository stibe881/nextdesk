import * as LocalAuthentication from "expo-local-authentication";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  type AppStateStatus,
  Modal,
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
import { clearMobileWorkspace, nextDesk } from "@/lib/nextdesk-client";

export function DeviceProtection() {
  const router = useRouter();
  const appState = useRef<AppStateStatus>(AppState.currentState);
  const checkingRef = useRef(false);
  const [lockState, setLockState] = useState<
    "checking-session" | "locked" | "unlocked"
  >("checking-session");
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState("");

  const verify = useCallback(async () => {
    if (Platform.OS === "web" || checkingRef.current) return;
    checkingRef.current = true;
    setChecking(true);
    setMessage("");
    try {
      const session = (await nextDesk?.auth.getSession())?.data.session;
      if (!session?.user.id) {
        setLockState("unlocked");
        return;
      }
      const enabled = await getDeviceProtectionPreference(session.user.id);
      if (!enabled) {
        setLockState("unlocked");
        return;
      }
      const [hasHardware, enrolled] = await Promise.all([
        LocalAuthentication.hasHardwareAsync(),
        LocalAuthentication.isEnrolledAsync(),
      ]);
      if (!hasHardware || !enrolled) {
        await setDeviceProtectionPreference(session.user.id, false);
        setLockState("unlocked");
        return;
      }

      setLockState("locked");
      const result = await LocalAuthentication.authenticateAsync({
        cancelLabel: "Später",
        disableDeviceFallback: false,
        fallbackLabel: "Gerätecode",
        promptMessage: "nextDesk entsperren",
      });
      if (result.success) {
        setLockState("unlocked");
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
      const returnedFromBackground =
        /inactive|background/.test(appState.current) && nextState === "active";
      appState.current = nextState;
      if (returnedFromBackground) void verify();
    });
    return () => subscription.remove();
  }, [verify]);

  async function signOut() {
    try {
      await nextDesk?.auth.signOut();
    } finally {
      await clearMobileWorkspace();
      setLockState("unlocked");
      router.replace("/auth");
    }
  }

  if (Platform.OS === "web") return null;
  return (
    <Modal
      animationType="fade"
      statusBarTranslucent
      transparent
      visible={lockState !== "unlocked"}
    >
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.iconWrap}>
            <Text style={styles.icon}>⌁</Text>
          </View>
          <Text style={styles.title}>
            {lockState === "checking-session"
              ? "Sitzung wird geprüft"
              : "nextDesk ist geschützt"}
          </Text>
          <Text style={styles.copy}>
            {lockState === "checking-session"
              ? "Vertrauliche Arbeitsdaten werden erst nach der Sicherheitsprüfung angezeigt."
              : "Entsperren Sie Ihre aktuelle Sitzung, bevor vertrauliche Ticket- und Assetdaten angezeigt werden."}
          </Text>
          {message ? <Text style={styles.message}>{message}</Text> : null}
          {lockState === "checking-session" ? (
            <ActivityIndicator color="#4438CA" size="small" />
          ) : (
            <>
              <Pressable
                accessibilityRole="button"
                disabled={checking}
                onPress={() => void verify()}
                style={[styles.unlock, checking && styles.disabled]}
              >
                {checking ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Text style={styles.unlockText}>Jetzt entsperren</Text>
                )}
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={checking}
                onPress={() => void signOut()}
                style={styles.signOut}
              >
                <Text style={styles.signOutText}>Abmelden</Text>
              </Pressable>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    alignItems: "center",
    backgroundColor: "rgba(20, 20, 35, 0.78)",
    flex: 1,
    justifyContent: "center",
    padding: 24,
  },
  card: {
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 28,
    gap: 14,
    maxWidth: 380,
    padding: 26,
    width: "100%",
  },
  iconWrap: {
    alignItems: "center",
    backgroundColor: "#EEECFF",
    borderRadius: 22,
    height: 56,
    justifyContent: "center",
    width: 56,
  },
  icon: { color: "#4438CA", fontSize: 34, fontWeight: "900", lineHeight: 38 },
  title: { color: "#202136", fontSize: 21, fontWeight: "900" },
  copy: { color: "#656477", fontSize: 14, lineHeight: 21, textAlign: "center" },
  message: {
    color: "#95630F",
    fontSize: 12,
    lineHeight: 17,
    textAlign: "center",
  },
  unlock: {
    alignItems: "center",
    backgroundColor: "#4438CA",
    borderRadius: 14,
    justifyContent: "center",
    marginTop: 4,
    minHeight: 48,
    width: "100%",
  },
  unlockText: { color: "#FFFFFF", fontSize: 14, fontWeight: "900" },
  signOut: { minHeight: 36, justifyContent: "center", paddingHorizontal: 12 },
  signOutText: { color: "#9C2D2D", fontSize: 13, fontWeight: "800" },
  disabled: { opacity: 0.55 },
});
