import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { isNextDeskConfigured, nextDesk } from "@/lib/nextdesk-client";
import { loadMobileDashboard, type MobileTicket } from "@/lib/nextdesk-tickets";

type TicketScope = "all" | "mine" | "open" | "resolved";

const scopes: { key: TicketScope; label: string }[] = [
  { key: "all", label: "Alle" },
  { key: "mine", label: "Meine" },
  { key: "open", label: "Offen" },
  { key: "resolved", label: "Gelöst" },
];

export default function TicketsScreen() {
  const router = useRouter();
  const [tickets, setTickets] = useState<MobileTicket[]>([]);
  const [tenantName, setTenantName] = useState("");
  const [scope, setScope] = useState<TicketScope>("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!isNextDeskConfigured || !nextDesk) {
      setError("Die mobile nextDesk-Verbindung ist noch nicht konfiguriert.");
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const { data } = await nextDesk.auth.getSession();
    if (!data.session) {
      router.replace("/auth");
      return;
    }

    try {
      setError("");
      const result = await loadMobileDashboard();
      setTickets(result.tickets);
      setTenantName(result.tenant.name);
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
      void load();
    }, [load]),
  );

  const normalizedQuery = query.trim().toLocaleLowerCase("de-CH");
  const visibleTickets = tickets.filter((ticket) => {
    const matchesScope =
      scope === "mine"
        ? ticket.assignedToCurrentUser
        : scope === "open"
          ? !ticket.resolved
          : scope === "resolved"
            ? ticket.resolved
            : true;
    if (!matchesScope || !normalizedQuery) return matchesScope;
    return [
      ticket.ticketNumber,
      ticket.subject,
      ticket.description,
      ticket.status,
      ticket.priority,
    ].some((value) =>
      value.toLocaleLowerCase("de-CH").includes(normalizedQuery),
    );
  });

  if (loading && tickets.length === 0) {
    return (
      <ScreenContainer containerClassName="bg-[#F6F7FB]" className="px-5">
        <View style={styles.centered}>
          <ActivityIndicator color="#4438CA" size="large" />
          <Text style={styles.loadingText}>Tickets werden geladen …</Text>
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
            onRefresh={() => {
              setRefreshing(true);
              void load();
            }}
            refreshing={refreshing}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>ARBEITSBEREICH</Text>
            <Text style={styles.title}>Tickets</Text>
            <Text style={styles.subtitle}>
              {tenantName || "Deine autorisierten Vorgänge"}
            </Text>
          </View>
          <Pressable
            accessibilityLabel="Ticket erfassen"
            accessibilityRole="button"
            onPress={() => router.push("/ticket/new")}
            style={styles.addButton}
          >
            <Ionicons color="#FFFFFF" name="add" size={23} />
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={styles.filters}
          horizontal
          showsHorizontalScrollIndicator={false}
        >
          {scopes.map((option) => (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: scope === option.key }}
              key={option.key}
              onPress={() => setScope(option.key)}
              style={[
                styles.filter,
                scope === option.key && styles.filterSelected,
              ]}
            >
              <Text
                style={[
                  styles.filterText,
                  scope === option.key && styles.filterTextSelected,
                ]}
              >
                {option.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        <View style={styles.searchWrap}>
          <Ionicons color="#77758C" name="search-outline" size={20} />
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setQuery}
            placeholder="Tickets durchsuchen"
            placeholderTextColor="#9A99AA"
            style={styles.searchInput}
            value={query}
          />
          {query ? (
            <Pressable
              accessibilityLabel="Ticketsuche löschen"
              accessibilityRole="button"
              hitSlop={10}
              onPress={() => setQuery("")}
            >
              <Ionicons color="#77758C" name="close-circle" size={19} />
            </Pressable>
          ) : null}
        </View>

        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setLoading(true);
                void load();
              }}
            >
              <Text style={styles.retryText}>Erneut versuchen</Text>
            </Pressable>
          </View>
        ) : null}

        <View style={styles.listHeading}>
          <Text style={styles.listTitle}>
            {scope === "all" ? "Alle Tickets" : "Gefilterte Tickets"}
          </Text>
          <Text style={styles.listCount}>{visibleTickets.length}</Text>
        </View>

        {visibleTickets.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons color="#9896A8" name="ticket-outline" size={28} />
            <Text style={styles.emptyTitle}>Keine passenden Tickets</Text>
            <Text style={styles.emptyText}>
              Passe den Filter an oder erfasse ein neues Ticket.
            </Text>
          </View>
        ) : (
          <View style={styles.list}>
            {visibleTickets.map((ticket) => (
              <TicketRow
                key={ticket.id}
                onPress={() =>
                  router.push({
                    pathname: "/ticket/[id]",
                    params: { id: ticket.id },
                  })
                }
                ticket={ticket}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

function TicketRow({
  onPress,
  ticket,
}: {
  onPress: () => void;
  ticket: MobileTicket;
}) {
  const tone = ticket.resolved
    ? styles.markResolved
    : ticket.status === "Neu"
      ? styles.markNew
      : styles.markActive;
  const statusTone = ticket.resolved
    ? styles.statusResolved
    : ticket.status === "Neu"
      ? styles.statusNew
      : styles.statusActive;

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={styles.ticket}
    >
      <View style={[styles.mark, tone]} />
      <View style={styles.ticketCopy}>
        <Text style={styles.ticketNumber}>{ticket.ticketNumber}</Text>
        <Text numberOfLines={2} style={styles.ticketTitle}>
          {ticket.subject}
        </Text>
        <Text style={styles.ticketMeta}>{ticket.priority}</Text>
      </View>
      <View style={styles.ticketState}>
        <Text style={[styles.status, statusTone]}>{ticket.status}</Text>
        <Ionicons color="#A1A0AF" name="chevron-forward" size={18} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { gap: 18, paddingBottom: 34, paddingTop: 18 },
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
  subtitle: { color: "#6B7280", fontSize: 13, marginTop: 3 },
  addButton: {
    alignItems: "center",
    backgroundColor: "#4438CA",
    borderRadius: 17,
    height: 48,
    justifyContent: "center",
    width: 48,
  },
  filters: { gap: 9, paddingRight: 16 },
  searchWrap: {
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderColor: "#E5E5EF",
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: 9,
    minHeight: 52,
    paddingHorizontal: 14,
  },
  searchInput: { color: "#202136", flex: 1, fontSize: 14, minHeight: 48 },
  filter: {
    backgroundColor: "#FFFFFF",
    borderColor: "#E6E5EE",
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 15,
    paddingVertical: 9,
  },
  filterSelected: { backgroundColor: "#4438CA", borderColor: "#4438CA" },
  filterText: { color: "#626376", fontSize: 13, fontWeight: "800" },
  filterTextSelected: { color: "#FFFFFF" },
  errorBox: {
    backgroundColor: "#FFF3F2",
    borderColor: "#F5C2C0",
    borderRadius: 15,
    borderWidth: 1,
    gap: 7,
    padding: 14,
  },
  errorText: { color: "#A02820", fontSize: 13, lineHeight: 19 },
  retryText: { color: "#4438CA", fontSize: 13, fontWeight: "800" },
  listHeading: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 2,
  },
  listTitle: { color: "#202136", fontSize: 18, fontWeight: "800" },
  listCount: {
    backgroundColor: "#ECEAFF",
    borderRadius: 10,
    color: "#4438CA",
    fontSize: 12,
    fontWeight: "900",
    minWidth: 27,
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 4,
    textAlign: "center",
  },
  list: { gap: 10 },
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
  mark: { borderRadius: 2, height: 46, width: 4 },
  markNew: { backgroundColor: "#0EA5C6" },
  markActive: { backgroundColor: "#7C3AED" },
  markResolved: { backgroundColor: "#15803D" },
  ticketCopy: { flex: 1, gap: 3 },
  ticketNumber: {
    color: "#77758C",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.6,
  },
  ticketTitle: {
    color: "#24253A",
    fontSize: 14,
    fontWeight: "800",
    lineHeight: 19,
  },
  ticketMeta: { color: "#6B7280", fontSize: 11 },
  ticketState: { alignItems: "flex-end", gap: 8 },
  status: {
    borderRadius: 8,
    fontSize: 10,
    fontWeight: "900",
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  statusNew: { backgroundColor: "#E0F6FB", color: "#036B83" },
  statusActive: { backgroundColor: "#F0E9FF", color: "#6432B7" },
  statusResolved: { backgroundColor: "#E9F8EE", color: "#166534" },
  empty: {
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderColor: "#ECECF3",
    borderRadius: 20,
    borderWidth: 1,
    gap: 8,
    padding: 27,
  },
  emptyTitle: {
    color: "#303145",
    fontSize: 15,
    fontWeight: "800",
    marginTop: 2,
  },
  emptyText: {
    color: "#77758C",
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
  },
});
