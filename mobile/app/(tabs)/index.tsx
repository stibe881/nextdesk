import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { FollowUpsSection } from "@/components/follow-ups-section";
import { ScreenContainer } from "@/components/screen-container";
import { GlobalSearch } from "@/components/global-search";
import { useMobileFeatures } from "@/components/mobile-feature-gate";
import { useMobileNetworkStatus } from "@/components/offline-status";
import {
  isNextDeskConfigured,
  nextDesk,
  type MobileTenant,
} from "@/lib/nextdesk-client";
import { loadMobileDashboard, type MobileTicket } from "@/lib/nextdesk-tickets";

type TicketScope = "all" | "mine" | "open" | "resolved";

const ticketScopeLabels: Record<Exclude<TicketScope, "all">, string> = {
  mine: "Meine Tickets",
  open: "Offene Tickets",
  resolved: "Gelöste Tickets",
};

export default function HomeScreen() {
  const router = useRouter();
  const { recoveryEpoch } = useMobileNetworkStatus();
  const { isEnabled, loading: checkingFeatures } = useMobileFeatures();
  const ticketDetailsEnabled = isEnabled("ticketing.detail");
  const [tenant, setTenant] = useState<MobileTenant | null>(null);
  const [tickets, setTickets] = useState<MobileTicket[]>([]);
  const [ticketScope, setTicketScope] = useState<TicketScope>("all");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!isNextDeskConfigured || !nextDesk) {
      setError("Die mobile nextDesk-Verbindung ist noch nicht konfiguriert.");
      setLoading(false);
      return;
    }
    const { data } = await nextDesk.auth.getSession();
    if (!data.session) {
      router.replace("/auth");
      return;
    }
    try {
      setError("");
      const result = await loadMobileDashboard({ allowOfflineCache: false });
      setTenant(result.tenant);
      setTickets(result.tickets);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Die Tickets konnten nicht geladen werden.",
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [router]);

  useFocusEffect(
    useCallback(() => {
      void recoveryEpoch;
      void load();
    }, [load, recoveryEpoch]),
  );

  const visibleTickets = tickets.filter((ticket) => {
    if (ticketScope === "mine") return ticket.assignedToCurrentUser;
    if (ticketScope === "open") return !ticket.resolved;
    if (ticketScope === "resolved") return ticket.resolved;
    return true;
  });
  const scopeCount = (scope: Exclude<TicketScope, "all">) =>
    tickets.filter((ticket) => {
      if (scope === "mine") return ticket.assignedToCurrentUser;
      if (scope === "open") return !ticket.resolved;
      return ticket.resolved;
    }).length;

  if (loading && !tenant) {
    return (
      <ScreenContainer containerClassName="bg-[#F6F7FB]" className="px-5">
        <View style={styles.centered}>
          <ActivityIndicator color="#4438CA" size="large" />
          <Text style={styles.loadingText}>nextDesk wird geladen …</Text>
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer containerClassName="bg-[#F6F7FB]" className="px-5">
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load();
            }}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View>
            <View style={styles.brandRow}>
              <Image
                accessibilityLabel="nextDesk Logo"
                source={require("@/assets/images/icon.png")}
                style={styles.brandLogo}
              />
              <Text style={styles.brand}>nextDesk</Text>
            </View>
            <Text style={styles.greeting}>
              {tenant?.name ?? "Dein Arbeitsbereich"}
            </Text>
          </View>
          <Pressable
            accessibilityLabel="Persönliche Einstellungen öffnen"
            accessibilityRole="button"
            onPress={() => router.push("/settings")}
            style={styles.avatar}
          >
            <Ionicons color="#4438CA" name="person-circle-outline" size={23} />
          </Pressable>
        </View>

        <GlobalSearch tenant={tenant} tickets={tickets} />

        <View style={styles.hero}>
          <Text style={styles.heroEyebrow}>HEUTE IM FOKUS</Text>
          <Text style={styles.heroTitle}>Alles im Blick.</Text>
          <Text style={styles.heroBody}>
            Bearbeite Tickets schnell, klar und von überall.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push("/ticket/new")}
            style={styles.heroButton}
          >
            <Ionicons color="#3826B8" name="add" size={21} />
            <Text style={styles.heroButtonText}>Ticket erfassen</Text>
          </Pressable>
        </View>

        <FollowUpsSection />

        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable
              onPress={() => {
                setLoading(true);
                void load();
              }}
            >
              <Text style={styles.retryText}>Erneut versuchen</Text>
            </Pressable>
          </View>
        ) : null}

        <Text style={styles.sectionEyebrow}>ÜBERSICHT</Text>
        <View style={styles.metrics}>
          <Metric
            icon="person-outline"
            label="Meine Tickets"
            value={String(scopeCount("mine"))}
            color="#4438CA"
            onPress={() => setTicketScope("mine")}
            selected={ticketScope === "mine"}
          />
          <Metric
            icon="time-outline"
            label="Offen"
            value={String(scopeCount("open"))}
            color="#0E7490"
            onPress={() => setTicketScope("open")}
            selected={ticketScope === "open"}
          />
          <Metric
            icon="checkmark-circle-outline"
            label="Gelöst"
            value={String(scopeCount("resolved"))}
            color="#15803D"
            onPress={() => setTicketScope("resolved")}
            selected={ticketScope === "resolved"}
          />
        </View>

        <View style={styles.sectionHeader}>
          <View>
            <Text style={styles.sectionTitle}>
              {ticketScope === "all"
                ? "Aktuelle Tickets"
                : ticketScopeLabels[ticketScope]}
            </Text>
            <Text style={styles.sectionSub}>
              {ticketScope === "all"
                ? "Deine zuletzt bearbeiteten Vorgänge"
                : `${visibleTickets.length} passende Vorgänge`}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => setTicketScope("all")}
          >
            <Text style={styles.all}>
              {ticketScope === "all" ? "Alle" : "Filter zurücksetzen"}
            </Text>
          </Pressable>
        </View>

        {visibleTickets.length === 0 ? (
          <View style={styles.emptyList}>
            <Text style={styles.emptyText}>
              Keine passenden Tickets vorhanden.
            </Text>
          </View>
        ) : (
          <View style={styles.list}>
            {visibleTickets.map((ticket) => (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{
                  disabled: checkingFeatures || !ticketDetailsEnabled,
                }}
                disabled={checkingFeatures || !ticketDetailsEnabled}
                key={ticket.id}
                onPress={() =>
                  router.push({
                    pathname: "/ticket/[id]",
                    params: { id: ticket.id },
                  })
                }
                style={[
                  styles.ticket,
                  (checkingFeatures || !ticketDetailsEnabled) &&
                    styles.ticketDisabled,
                ]}
              >
                <View
                  style={[
                    styles.ticketMark,
                    ticket.resolved
                      ? styles.green
                      : ticket.status === "Neu"
                        ? styles.blue
                        : styles.violet,
                  ]}
                />
                <View style={styles.ticketContent}>
                  <Text style={styles.ticketId}>{ticket.ticketNumber}</Text>
                  <Text numberOfLines={1} style={styles.ticketTitle}>
                    {ticket.subject}
                  </Text>
                  <Text style={styles.ticketMeta}>{ticket.priority}</Text>
                </View>
                <View style={styles.ticketRight}>
                  <Text
                    style={[
                      styles.status,
                      ticket.resolved
                        ? styles.statusGreen
                        : ticket.status === "Neu"
                          ? styles.statusBlue
                          : styles.statusViolet,
                    ]}
                  >
                    {ticket.status}
                  </Text>
                  <Ionicons color="#9CA3AF" name="chevron-forward" size={18} />
                </View>
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

function Metric({
  icon,
  label,
  value,
  color,
  onPress,
  selected,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  color: string;
  onPress: () => void;
  selected: boolean;
}) {
  return (
    <Pressable
      accessibilityLabel={`${label}: ${value} Tickets anzeigen`}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.metric, selected && styles.metricSelected]}
    >
      <Ionicons color={color} name={icon} size={19} />
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { gap: 18, paddingTop: 16, paddingBottom: 32 },
  centered: {
    alignItems: "center",
    flex: 1,
    gap: 14,
    justifyContent: "center",
  },
  loadingText: { color: "#626376", fontSize: 14 },
  header: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  brandRow: { alignItems: "center", flexDirection: "row", gap: 7 },
  brandLogo: { height: 27, width: 27 },
  brand: {
    color: "#17172A",
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: -0.8,
  },
  greeting: { color: "#6B7280", fontSize: 13, marginTop: 2 },
  avatar: {
    alignItems: "center",
    backgroundColor: "#E9E7FF",
    borderRadius: 21,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  hero: {
    backgroundColor: "#4438CA",
    borderRadius: 26,
    gap: 9,
    padding: 22,
    shadowColor: "#4438CA",
    shadowOpacity: 0.22,
    shadowRadius: 16,
    elevation: 4,
  },
  heroEyebrow: {
    color: "#DCD8FF",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.3,
  },
  heroTitle: {
    color: "#FFFFFF",
    fontSize: 27,
    fontWeight: "800",
    letterSpacing: -0.5,
  },
  heroBody: { color: "#E9E7FF", fontSize: 15, lineHeight: 21 },
  heroButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    flexDirection: "row",
    gap: 7,
    marginTop: 6,
    paddingHorizontal: 15,
    paddingVertical: 11,
  },
  heroButtonText: { color: "#3826B8", fontSize: 14, fontWeight: "800" },
  errorBox: {
    backgroundColor: "#FFF3F2",
    borderColor: "#F5C2C0",
    borderRadius: 14,
    borderWidth: 1,
    gap: 7,
    padding: 13,
  },
  errorText: { color: "#A02820", fontSize: 13, lineHeight: 18 },
  retryText: { color: "#4438CA", fontSize: 13, fontWeight: "800" },
  sectionEyebrow: {
    color: "#77758C",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.1,
    marginTop: 6,
  },
  metrics: { flexDirection: "row", gap: 10 },
  metric: {
    backgroundColor: "#FFFFFF",
    borderColor: "#ECECF3",
    borderRadius: 18,
    borderWidth: 1,
    flex: 1,
    gap: 4,
    padding: 13,
  },
  metricSelected: { backgroundColor: "#F8F7FF", borderColor: "#8B82F4" },
  metricValue: {
    color: "#1F2033",
    fontSize: 22,
    fontWeight: "800",
    marginTop: 2,
  },
  metricLabel: { color: "#6B7280", fontSize: 11, fontWeight: "600" },
  sectionHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 8,
  },
  sectionTitle: { color: "#202136", fontSize: 19, fontWeight: "800" },
  sectionSub: { color: "#6B7280", fontSize: 12, marginTop: 3 },
  all: { color: "#4438CA", fontSize: 14, fontWeight: "800" },
  list: { gap: 9 },
  emptyList: {
    backgroundColor: "#FFFFFF",
    borderColor: "#ECECF3",
    borderRadius: 18,
    borderWidth: 1,
    padding: 18,
  },
  emptyText: { color: "#77758C", fontSize: 13, textAlign: "center" },
  ticket: {
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderColor: "#ECECF3",
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: "row",
    gap: 11,
    padding: 14,
  },
  ticketDisabled: { opacity: 0.55 },
  ticketMark: { borderRadius: 2, height: 43, width: 4 },
  blue: { backgroundColor: "#0EA5C6" },
  violet: { backgroundColor: "#7C3AED" },
  green: { backgroundColor: "#15803D" },
  ticketContent: { flex: 1, gap: 2 },
  ticketId: {
    color: "#77758C",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  ticketTitle: { color: "#24253A", fontSize: 14, fontWeight: "800" },
  ticketMeta: { color: "#6B7280", fontSize: 11 },
  ticketRight: { alignItems: "flex-end", gap: 7 },
  status: {
    borderRadius: 8,
    fontSize: 10,
    fontWeight: "800",
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  statusBlue: { backgroundColor: "#E0F6FB", color: "#036B83" },
  statusViolet: { backgroundColor: "#F0E9FF", color: "#6432B7" },
  statusGreen: { backgroundColor: "#E9F8EE", color: "#166534" },
});
