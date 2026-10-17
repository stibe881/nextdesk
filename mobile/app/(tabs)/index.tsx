import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { ScreenContainer } from "@/components/screen-container";

type TicketScope = "all" | "mine" | "open" | "resolved";

const tickets = [
  {
    id: "ICT-2026-000001",
    title: "VPN-Zugang für Homeoffice",
    status: "Neu",
    tone: "blue",
    assignedToMe: true,
    resolved: false,
  },
  {
    id: "ICT-2026-000014",
    title: "Drucker im Sitzungszimmer",
    status: "In Bearbeitung",
    tone: "violet",
    assignedToMe: true,
    resolved: false,
  },
  {
    id: "ICT-2026-000019",
    title: "Softwarefreigabe Adobe",
    status: "Wartet",
    tone: "amber",
    assignedToMe: false,
    resolved: false,
  },
  {
    id: "ICT-2026-000004",
    title: "Zugang für Meetingraum eingerichtet",
    status: "Gelöst",
    tone: "green",
    assignedToMe: false,
    resolved: true,
  },
];

const ticketScopeLabels: Record<Exclude<TicketScope, "all">, string> = {
  mine: "Meine Tickets",
  open: "Offene Tickets",
  resolved: "Gelöste Tickets",
};

export default function HomeScreen() {
  const [selected, setSelected] = useState<string | null>(null);
  const [ticketScope, setTicketScope] = useState<TicketScope>("all");
  const visibleTickets = tickets.filter((ticket) => {
    if (ticketScope === "mine") return ticket.assignedToMe;
    if (ticketScope === "open") return !ticket.resolved;
    if (ticketScope === "resolved") return ticket.resolved;
    return true;
  });
  const scopeCount = (scope: Exclude<TicketScope, "all">) =>
    tickets.filter((ticket) => {
      if (scope === "mine") return ticket.assignedToMe;
      if (scope === "open") return !ticket.resolved;
      return ticket.resolved;
    }).length;

  return (
    <ScreenContainer containerClassName="bg-[#F6F7FB]" className="px-5">
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
      >
        <View style={styles.header}>
          <View>
            <Text style={styles.brand}>nextDesk</Text>
            <Text style={styles.greeting}>Dein Arbeitsbereich</Text>
          </View>
          <Pressable accessibilityRole="button" style={styles.avatar}>
            <Text style={styles.avatarText}>SG</Text>
          </Pressable>
        </View>

        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            <Ionicons name="sparkles" size={20} color="#FFFFFF" />
          </View>
          <Text style={styles.heroEyebrow}>HEUTE IM FOKUS</Text>
          <Text style={styles.heroTitle}>Alles im Blick.</Text>
          <Text style={styles.heroBody}>
            Bearbeite Tickets schnell, klar und von überall.
          </Text>
          <Pressable style={styles.heroButton} accessibilityRole="button">
            <Ionicons name="add" size={21} color="#3826B8" />
            <Text style={styles.heroButtonText}>Ticket erfassen</Text>
          </Pressable>
        </View>

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
            accessibilityState={{ selected: ticketScope === "all" }}
            onPress={() => setTicketScope("all")}
          >
            <Text style={styles.all}>
              {ticketScope === "all" ? "Alle" : "Filter zurücksetzen"}
            </Text>
          </Pressable>
        </View>

        <View style={styles.list}>
          {visibleTickets.map((ticket) => (
            <Pressable
              key={ticket.id}
              onPress={() => setSelected(ticket.id)}
              style={[
                styles.ticket,
                selected === ticket.id && styles.ticketSelected,
              ]}
              accessibilityRole="button"
            >
              <View
                style={[
                  styles.ticketMark,
                  ticket.tone === "violet"
                    ? styles.violet
                    : ticket.tone === "amber"
                      ? styles.amber
                      : ticket.tone === "green"
                        ? styles.green
                        : styles.blue,
                ]}
              />
              <View style={styles.ticketContent}>
                <Text style={styles.ticketId}>{ticket.id}</Text>
                <Text numberOfLines={1} style={styles.ticketTitle}>
                  {ticket.title}
                </Text>
                <Text style={styles.ticketMeta}>Beispiel Abteilung ICT</Text>
              </View>
              <View style={styles.ticketRight}>
                <Text
                  style={[
                    styles.status,
                    ticket.tone === "violet"
                      ? styles.statusViolet
                      : ticket.tone === "amber"
                        ? styles.statusAmber
                        : ticket.tone === "green"
                          ? styles.statusGreen
                          : styles.statusBlue,
                  ]}
                >
                  {ticket.status}
                </Text>
                <Ionicons name="chevron-forward" size={18} color="#9CA3AF" />
              </View>
            </Pressable>
          ))}
        </View>
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
      <Ionicons name={icon} size={19} color={color} />
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: 16, paddingBottom: 32, gap: 18 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  brand: {
    fontSize: 28,
    fontWeight: "800",
    color: "#17172A",
    letterSpacing: -0.8,
  },
  greeting: { color: "#6B7280", marginTop: 2, fontSize: 14 },
  avatar: {
    backgroundColor: "#E9E7FF",
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontWeight: "800", color: "#4438CA" },
  hero: {
    backgroundColor: "#4438CA",
    borderRadius: 26,
    padding: 22,
    gap: 9,
    shadowColor: "#4438CA",
    shadowOpacity: 0.22,
    shadowRadius: 16,
    elevation: 4,
  },
  heroIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  heroEyebrow: {
    color: "#DCD8FF",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.3,
    marginTop: 4,
  },
  heroTitle: {
    color: "#FFFFFF",
    fontSize: 27,
    fontWeight: "800",
    letterSpacing: -0.5,
  },
  heroBody: { color: "#E9E7FF", fontSize: 15, lineHeight: 21 },
  heroButton: {
    alignSelf: "flex-start",
    flexDirection: "row",
    gap: 7,
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 15,
    paddingVertical: 11,
    borderRadius: 14,
    marginTop: 6,
  },
  heroButtonText: { color: "#3826B8", fontSize: 14, fontWeight: "800" },
  sectionEyebrow: {
    color: "#77758C",
    letterSpacing: 1.1,
    fontSize: 11,
    fontWeight: "800",
    marginTop: 6,
  },
  metrics: { flexDirection: "row", gap: 10 },
  metric: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 13,
    gap: 4,
    borderWidth: 1,
    borderColor: "#ECECF3",
  },
  metricSelected: { borderColor: "#8B82F4", backgroundColor: "#F8F7FF" },
  metricValue: {
    fontSize: 22,
    fontWeight: "800",
    color: "#1F2033",
    marginTop: 2,
  },
  metricLabel: { fontSize: 11, color: "#6B7280", fontWeight: "600" },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 8,
  },
  sectionTitle: { fontSize: 19, fontWeight: "800", color: "#202136" },
  sectionSub: { fontSize: 12, color: "#6B7280", marginTop: 3 },
  all: { color: "#4438CA", fontWeight: "800", fontSize: 14 },
  list: { gap: 9 },
  ticket: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    borderWidth: 1,
    borderColor: "#ECECF3",
  },
  ticketSelected: { borderColor: "#8B82F4", backgroundColor: "#F8F7FF" },
  ticketMark: { width: 4, height: 43, borderRadius: 2 },
  blue: { backgroundColor: "#0EA5C6" },
  violet: { backgroundColor: "#7C3AED" },
  amber: { backgroundColor: "#D97706" },
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
    fontSize: 10,
    fontWeight: "800",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  statusBlue: { color: "#036B83", backgroundColor: "#E0F6FB" },
  statusViolet: { color: "#6432B7", backgroundColor: "#F0E9FF" },
  statusAmber: { color: "#9A5100", backgroundColor: "#FFF2DD" },
  statusGreen: { color: "#166534", backgroundColor: "#E9F8EE" },
});
