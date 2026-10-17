import { Ionicons } from "@expo/vector-icons";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { useMobileSessionGuard } from "@/lib/use-mobile-session-guard";

export default function KnowledgeScreen() {
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
          <Text style={styles.eyebrow}>WISSENSCENTER</Text>
          <Text style={styles.title}>Wissen</Text>
          <Text style={styles.subtitle}>
            Hilfreiche Informationen und freigegebene Anleitungen für deinen
            Arbeitsalltag.
          </Text>
        </View>

        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            <Ionicons color="#4438CA" name="book-outline" size={29} />
          </View>
          <Text style={styles.heroTitle}>Wissensartikel</Text>
          <Text style={styles.heroText}>
            Die Wissensbasis wird pro Mandant bereitgestellt. Freigegebene
            Artikel erscheinen hier automatisch und bleiben vom Ticketverlauf
            getrennt.
          </Text>
        </View>

        <View style={styles.notice}>
          <Ionicons color="#087A95" name="shield-checkmark-outline" size={21} />
          <View style={styles.noticeCopy}>
            <Text style={styles.noticeTitle}>Mandantenisoliert</Text>
            <Text style={styles.noticeText}>
              Du siehst ausschliesslich Wissen, das für deinen Mandanten und
              deine Rolle bestimmt ist.
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
  hero: {
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderColor: "#ECECF3",
    borderRadius: 24,
    borderWidth: 1,
    gap: 9,
    padding: 28,
  },
  heroIcon: {
    alignItems: "center",
    backgroundColor: "#EDEAFF",
    borderRadius: 19,
    height: 58,
    justifyContent: "center",
    width: 58,
  },
  heroTitle: {
    color: "#292A3E",
    fontSize: 17,
    fontWeight: "900",
    marginTop: 4,
  },
  heroText: {
    color: "#747486",
    fontSize: 13,
    lineHeight: 20,
    textAlign: "center",
  },
  notice: {
    alignItems: "flex-start",
    backgroundColor: "#EAF8FB",
    borderRadius: 18,
    flexDirection: "row",
    gap: 11,
    padding: 16,
  },
  noticeCopy: { flex: 1 },
  noticeTitle: { color: "#146B7D", fontSize: 13, fontWeight: "900" },
  noticeText: { color: "#397887", fontSize: 12, lineHeight: 18, marginTop: 3 },
});
