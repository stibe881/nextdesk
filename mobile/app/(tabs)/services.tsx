import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

import { RequesterCollaboration } from "@/components/requester-collaboration";
import { ScreenContainer } from "@/components/screen-container";
import { useMobileFeatures } from "@/components/mobile-feature-gate";
import { makeThemedStyles, useAppColors } from "@/lib/themed-styles";
import { useMobileSessionGuard } from "@/lib/use-mobile-session-guard";

export default function ServicesScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const colors = useAppColors();
  const styles = useStyles();
  const checkingSession = useMobileSessionGuard();
  const { isEnabled, loading: checkingFeatures } = useMobileFeatures();
  const assetsEnabled = isEnabled("assets.management");
  const departmentViewEnabled = isEnabled("requester.department-view");
  const requesterPortalEnabled = isEnabled("requester.portal");
  const wideLayout = width >= 768;

  if (checkingSession || checkingFeatures) {
    return (
      <ScreenContainer containerClassName="bg-background" className="px-5">
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer containerClassName="bg-background" className="px-5">
      <ScrollView
        contentContainerStyle={[
          styles.content,
          wideLayout && styles.contentWide,
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View>
          <Text style={styles.eyebrow}>SERVICEZENTRALE</Text>
          <Text style={styles.title}>Services</Text>
          <Text style={styles.subtitle}>
            Starte eine Anfrage oder finde schnell den richtigen Einstieg.
          </Text>
        </View>

        <View
          style={[styles.serviceGrid, wideLayout && styles.serviceGridWide]}
        >
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push("/ticket/new")}
            style={[styles.primaryCard, wideLayout && styles.primaryCardWide]}
          >
            <View style={styles.primaryIcon}>
              <Ionicons
                color={colors.primaryText}
                name="add-circle-outline"
                size={25}
              />
            </View>
            <View style={styles.cardCopy}>
              <Text style={styles.primaryTitle}>Service anfragen</Text>
              <Text style={styles.primaryText}>
                Erfasse ein Ticket mit Anliegen, Priorität und Abteilung.
              </Text>
            </View>
            <Ionicons color={colors.onPrimary} name="arrow-forward" size={21} />
          </Pressable>

          <View style={styles.actionsColumn}>
            <Text style={styles.sectionLabel}>SCHNELLZUGRIFF</Text>
            <View style={styles.list}>
              <Pressable
                accessibilityRole="button"
                onPress={() => router.navigate("/tickets")}
                style={styles.action}
              >
                <View style={styles.actionInfoIcon}>
                  <Ionicons
                    color={colors.info}
                    name="ticket-outline"
                    size={20}
                  />
                </View>
                <View style={styles.cardCopy}>
                  <Text style={styles.actionTitle}>Meine Serviceanfragen</Text>
                  <Text style={styles.actionText}>
                    Prüfe Status, Antworten und Bearbeitung deiner Tickets.
                  </Text>
                </View>
                <Ionicons
                  color={colors.subtle}
                  name="chevron-forward"
                  size={19}
                />
              </Pressable>
              {assetsEnabled ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.push("/assets" as never)}
                  style={styles.action}
                >
                  <View style={styles.actionPrimaryIcon}>
                    <Ionicons
                      color={colors.primaryText}
                      name="cube-outline"
                      size={20}
                    />
                  </View>
                  <View style={styles.cardCopy}>
                    <Text style={styles.actionTitle}>Assets & Inventar</Text>
                    <Text style={styles.actionText}>
                      Finde Geräte, lies Intune-Informationen und scanne
                      QR-Codes.
                    </Text>
                  </View>
                  <Ionicons
                    color={colors.subtle}
                    name="chevron-forward"
                    size={19}
                  />
                </Pressable>
              ) : null}
              <View style={styles.infoCard}>
                <Ionicons
                  color={colors.primaryText}
                  name="information-circle-outline"
                  size={20}
                />
                <Text style={styles.infoText}>
                  Services werden mandantenbezogen verwaltet. Weitere
                  Servicekataloge erscheinen hier, sobald sie für deinen
                  Mandanten freigegeben sind.
                </Text>
              </View>
            </View>
          </View>
        </View>

        {requesterPortalEnabled && departmentViewEnabled ? (
          <RequesterCollaboration />
        ) : null}
      </ScrollView>
    </ScreenContainer>
  );
}

const useStyles = makeThemedStyles((c) => ({
  actionsColumn: { flex: 1, gap: 10 },
  content: {
    alignSelf: "center",
    gap: 20,
    paddingBottom: 34,
    paddingTop: 18,
    width: "100%",
  },
  contentWide: { maxWidth: 1_120 },
  centered: { alignItems: "center", flex: 1, justifyContent: "center" },
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
  primaryCard: {
    alignItems: "center",
    backgroundColor: c.primary,
    borderRadius: 23,
    flexDirection: "row",
    gap: 14,
    padding: 19,
  },
  primaryIcon: {
    alignItems: "center",
    backgroundColor: c.surface,
    borderRadius: 15,
    height: 46,
    justifyContent: "center",
    width: 46,
  },
  primaryCardWide: { flex: 1, minHeight: 158 },
  cardCopy: { flex: 1 },
  primaryTitle: { color: c.onPrimary, fontSize: 16, fontWeight: "900" },
  primaryText: {
    color: c.onPrimary,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 4,
  },
  sectionLabel: {
    color: c.muted,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.2,
    marginTop: 5,
  },
  serviceGrid: { gap: 20 },
  serviceGridWide: { alignItems: "stretch", flexDirection: "row" },
  list: { gap: 11 },
  action: {
    alignItems: "center",
    backgroundColor: c.surface,
    borderColor: c.border,
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
  actionInfoIcon: {
    alignItems: "center",
    backgroundColor: c.infoSoft,
    borderRadius: 13,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  actionPrimaryIcon: {
    alignItems: "center",
    backgroundColor: c.primarySoft,
    borderRadius: 13,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  actionTitle: { color: c.text, fontSize: 14, fontWeight: "800" },
  actionText: { color: c.muted, fontSize: 12, lineHeight: 17, marginTop: 3 },
  infoCard: {
    alignItems: "flex-start",
    backgroundColor: c.primarySoft,
    borderRadius: 18,
    flexDirection: "row",
    gap: 10,
    padding: 15,
  },
  infoText: { color: c.primaryText, flex: 1, fontSize: 12, lineHeight: 18 },
}));
