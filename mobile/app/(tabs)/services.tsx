import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { useMobileSessionGuard } from "@/lib/use-mobile-session-guard";

export default function ServicesScreen() {
  const router = useRouter();
  const checkingSession = useMobileSessionGuard();

  if (checkingSession) {
    return (
      <ScreenContainer containerClassName="bg-[#F6F7FB]" className="px-5">
        <View style={styles.centered}>
          <ActivityIndicator color="#4438CA" size="large" />
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
          <Text style={styles.eyebrow}>SERVICEZENTRALE</Text>
          <Text style={styles.title}>Services</Text>
          <Text style={styles.subtitle}>
            Starte eine Anfrage oder finde schnell den richtigen Einstieg.
          </Text>
        </View>

        <Pressable
          accessibilityRole="button"
          onPress={() => router.push("/ticket/new")}
          style={styles.primaryCard}
        >
          <View style={styles.primaryIcon}>
            <Ionicons color="#4438CA" name="add-circle-outline" size={25} />
          </View>
          <View style={styles.cardCopy}>
            <Text style={styles.primaryTitle}>Service anfragen</Text>
            <Text style={styles.primaryText}>
              Erfasse ein Ticket mit Anliegen, Priorität und Abteilung.
            </Text>
          </View>
          <Ionicons color="#D9D5FF" name="arrow-forward" size={21} />
        </Pressable>

        <Text style={styles.sectionLabel}>SCHNELLZUGRIFF</Text>
        <View style={styles.list}>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.navigate("/tickets")}
            style={styles.action}
          >
            <View style={[styles.actionIcon, { backgroundColor: "#E8F6FB" }]}>
              <Ionicons color="#087A95" name="ticket-outline" size={20} />
            </View>
            <View style={styles.cardCopy}>
              <Text style={styles.actionTitle}>Meine Serviceanfragen</Text>
              <Text style={styles.actionText}>
                Prüfe Status, Antworten und Bearbeitung deiner Tickets.
              </Text>
            </View>
            <Ionicons color="#AAA9B8" name="chevron-forward" size={19} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push("/assets" as never)}
            style={styles.action}
          >
            <View style={[styles.actionIcon, { backgroundColor: "#F0EEFF" }]}>
              <Ionicons color="#4438CA" name="cube-outline" size={20} />
            </View>
            <View style={styles.cardCopy}>
              <Text style={styles.actionTitle}>Assets & Inventar</Text>
              <Text style={styles.actionText}>
                Finde Geräte, lies Intune-Informationen und scanne QR-Codes.
              </Text>
            </View>
            <Ionicons color="#AAA9B8" name="chevron-forward" size={19} />
          </Pressable>
          <View style={styles.infoCard}>
            <Ionicons
              color="#6D62D7"
              name="information-circle-outline"
              size={20}
            />
            <Text style={styles.infoText}>
              Services werden mandantenbezogen verwaltet. Weitere
              Servicekataloge erscheinen hier, sobald sie für deinen Mandanten
              freigegeben sind.
            </Text>
          </View>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: { gap: 20, paddingBottom: 34, paddingTop: 18 },
  centered: { alignItems: "center", flex: 1, justifyContent: "center" },
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
  primaryCard: {
    alignItems: "center",
    backgroundColor: "#4438CA",
    borderRadius: 23,
    flexDirection: "row",
    gap: 14,
    padding: 19,
  },
  primaryIcon: {
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 15,
    height: 46,
    justifyContent: "center",
    width: 46,
  },
  cardCopy: { flex: 1 },
  primaryTitle: { color: "#FFFFFF", fontSize: 16, fontWeight: "900" },
  primaryText: { color: "#E5E1FF", fontSize: 12, lineHeight: 17, marginTop: 4 },
  sectionLabel: {
    color: "#77758C",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.2,
    marginTop: 5,
  },
  list: { gap: 11 },
  action: {
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderColor: "#ECECF3",
    borderRadius: 19,
    borderWidth: 1,
    flexDirection: "row",
    gap: 13,
    padding: 15,
  },
  actionIcon: {
    alignItems: "center",
    borderRadius: 13,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  actionTitle: { color: "#303145", fontSize: 14, fontWeight: "800" },
  actionText: { color: "#747486", fontSize: 12, lineHeight: 17, marginTop: 3 },
  infoCard: {
    alignItems: "flex-start",
    backgroundColor: "#F0EEFF",
    borderRadius: 18,
    flexDirection: "row",
    gap: 10,
    padding: 15,
  },
  infoText: { color: "#5C5892", flex: 1, fontSize: 12, lineHeight: 18 },
});
