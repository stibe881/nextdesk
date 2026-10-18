import { Ionicons } from "@expo/vector-icons";
import { useNetworkState } from "expo-network";
import { StyleSheet, Text, View } from "react-native";

/**
 * nextDesk hält keine Ticket-, Asset- oder Wissensdaten im Offline-Cache.
 * Der Hinweis erklärt diesen Schutz, statt veraltete Daten als aktuell zu zeigen.
 */
export function OfflineStatus() {
  const network = useNetworkState();
  const offline =
    network.isConnected === false || network.isInternetReachable === false;

  if (!offline) return null;

  return (
    <View accessibilityLiveRegion="polite" style={styles.banner}>
      <Ionicons color="#71420C" name="cloud-offline-outline" size={17} />
      <View style={styles.copy}>
        <Text style={styles.title}>Offline</Text>
        <Text style={styles.text}>
          Aktuelle Daten werden aus Sicherheitsgründen nicht auf diesem Gerät
          zwischengespeichert.
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
});
