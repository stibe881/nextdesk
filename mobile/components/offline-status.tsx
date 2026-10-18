import { Ionicons } from "@expo/vector-icons";
import { useNetworkState } from "expo-network";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import { StyleSheet, Text, View } from "react-native";

type MobileNetworkStatus = {
  isOffline: boolean;
  recoveryEpoch: number;
};

const MobileNetworkStatusContext = createContext<MobileNetworkStatus>({
  isOffline: false,
  recoveryEpoch: 0,
});

/**
 * nextDesk hält keine Ticketdetails, Assets oder Wissensdaten offline vor.
 * Ausschließlich die iOS-Ticketliste kann begrenzte, verschlüsselte Metadaten
 * als klar markierten, nicht bearbeitbaren Fallback verwenden. Nach einer
 * Wiederverbindung erhalten sichtbare Bildschirme einen neuen Abrufimpuls und
 * lesen ausschliesslich erneut autorisierte Serverdaten.
 */
export function MobileNetworkStatusProvider({ children }: PropsWithChildren) {
  const network = useNetworkState();
  const isOffline =
    network.isConnected === false || network.isInternetReachable === false;
  const wasOffline = useRef(false);
  const [recoveryEpoch, setRecoveryEpoch] = useState(0);

  useEffect(() => {
    if (isOffline) {
      wasOffline.current = true;
      return;
    }
    if (!wasOffline.current) return;
    wasOffline.current = false;
    setRecoveryEpoch((current) => current + 1);
  }, [isOffline]);

  const value = useMemo(
    () => ({ isOffline, recoveryEpoch }),
    [isOffline, recoveryEpoch],
  );

  return (
    <MobileNetworkStatusContext.Provider value={value}>
      {children}
    </MobileNetworkStatusContext.Provider>
  );
}

export function useMobileNetworkStatus(): MobileNetworkStatus {
  return useContext(MobileNetworkStatusContext);
}

export function OfflineStatus() {
  const { isOffline, recoveryEpoch } = useMobileNetworkStatus();
  const [dismissedRecoveryEpoch, setDismissedRecoveryEpoch] = useState(0);

  useEffect(() => {
    if (recoveryEpoch === 0) return;
    const timeout = setTimeout(
      () => setDismissedRecoveryEpoch(recoveryEpoch),
      4_500,
    );
    return () => clearTimeout(timeout);
  }, [recoveryEpoch]);

  if (isOffline) {
    return (
      <View accessibilityLiveRegion="polite" style={styles.banner}>
        <Ionicons color="#71420C" name="cloud-offline-outline" size={17} />
        <View style={styles.copy}>
          <Text style={styles.title}>Offline</Text>
          <Text style={styles.text}>
            Ticketdetails, Assets und Wissen werden aus Sicherheitsgründen nicht
            auf diesem Gerät zwischengespeichert.
          </Text>
        </View>
      </View>
    );
  }

  if (recoveryEpoch === 0 || dismissedRecoveryEpoch === recoveryEpoch) {
    return null;
  }
  return (
    <View
      accessibilityLiveRegion="polite"
      style={[styles.banner, styles.recoveredBanner]}
    >
      <Ionicons color="#166534" name="cloud-done-outline" size={17} />
      <View style={styles.copy}>
        <Text style={[styles.title, styles.recoveredTitle]}>Wieder online</Text>
        <Text style={[styles.text, styles.recoveredText]}>
          Sichtbare Daten werden erneut vom autorisierten Server geladen.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    alignItems: "flex-start",
    backgroundColor: "#FFF4DB",
    borderBottomColor: "#F0D49B",
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 9,
    left: 0,
    paddingBottom: 10,
    paddingHorizontal: 16,
    paddingTop: 12,
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 50,
  },
  copy: { flex: 1, gap: 1 },
  title: { color: "#71420C", fontSize: 12, fontWeight: "900" },
  text: { color: "#71420C", fontSize: 11, lineHeight: 15 },
  recoveredBanner: { backgroundColor: "#ECFDF3", borderBottomColor: "#BBF7D0" },
  recoveredTitle: { color: "#166534" },
  recoveredText: { color: "#166534" },
});
