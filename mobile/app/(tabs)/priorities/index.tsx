import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { useMobileNetworkStatus } from "@/components/offline-status";
import {
  loadMyPriorities,
  movedOrder,
  refreshMyPriorities,
  reorderMyPriorities,
  resetMyPriorities,
  type PriorityList,
} from "@/lib/my-priorities";
import { loadCurrentTenant } from "@/lib/nextdesk-client";
import { makeThemedStyles, useAppColors } from "@/lib/themed-styles";
import { useMobileSessionGuard } from "@/lib/use-mobile-session-guard";

function clock(value: string): string {
  return new Date(value).toLocaleTimeString("de-CH", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function PrioritiesScreen() {
  const router = useRouter();
  const styles = useStyles();
  const colors = useAppColors();
  const checkingSession = useMobileSessionGuard();
  const { recoveryEpoch } = useMobileNetworkStatus();
  const [tenantId, setTenantId] = useState("");
  const [list, setList] = useState<PriorityList | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const run = useCallback(
    async (task: (tenant: string) => Promise<PriorityList>) => {
      setError("");
      try {
        const tenant = tenantId || (await loadCurrentTenant()).id;
        setTenantId(tenant);
        setList(await task(tenant));
      } catch (nextError) {
        setError(
          nextError instanceof Error
            ? nextError.message
            : "Die Prioritäten konnten nicht geladen werden.",
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
        setBusy(false);
      }
    },
    [tenantId],
  );

  useFocusEffect(
    useCallback(() => {
      void recoveryEpoch;
      if (!checkingSession) void run(loadMyPriorities);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [checkingSession, recoveryEpoch]),
  );

  function move(id: string, direction: -1 | 1) {
    if (!list || busy) return;
    const ids = movedOrder(
      list.tickets.map((ticket) => ticket.id),
      id,
      direction,
    );
    if (!ids) return;
    const byId = new Map(list.tickets.map((ticket) => [ticket.id, ticket]));
    setList({
      ...list,
      hasManualOrder: true,
      tickets: ids.map((ticketId, index) => ({
        ...byId.get(ticketId)!,
        position: index + 1,
        manual: true,
      })),
    });
    setBusy(true);
    void run((tenant) => reorderMyPriorities(tenant, ids));
  }

  if (checkingSession || loading) {
    return (
      <ScreenContainer className="px-5">
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      </ScreenContainer>
    );
  }

  const tickets = list?.tickets ?? [];

  return (
    <ScreenContainer className="px-5">
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            onRefresh={() => {
              setRefreshing(true);
              void run(loadMyPriorities);
            }}
            refreshing={refreshing}
            tintColor={colors.primary}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        <Pressable
          accessibilityRole="button"
          hitSlop={10}
          onPress={() =>
            router.canGoBack() ? router.back() : router.replace("/")
          }
          style={styles.back}
        >
          <Ionicons color={colors.primaryText} name="chevron-back" size={20} />
          <Text style={styles.backText}>Zurück</Text>
        </Pressable>
        <View>
          <Text style={styles.eyebrow}>KI-REIHENFOLGE</Text>
          <Text style={styles.title}>Meine Prioritäten</Text>
          <Text style={styles.subtitle}>
            {list?.rankedAt
              ? `${list.source === "ai" ? "Von der KI priorisiert" : "Nach SLA, Priorität und Wartezeit sortiert"} um ${clock(list.rankedAt)}${list.hasManualOrder ? " · deine Anpassungen haben Vorrang" : ""}`
              : "Deine zugewiesenen Tickets in sinnvoller Reihenfolge"}
          </Text>
        </View>

        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => {
              setBusy(true);
              void run(refreshMyPriorities);
            }}
            style={[styles.action, styles.actionPrimary]}
          >
            <Ionicons color={colors.onPrimary} name="sparkles" size={16} />
            <Text style={[styles.actionText, styles.actionTextPrimary]}>
              {busy ? "Bitte warten …" : "Neu priorisieren"}
            </Text>
          </Pressable>
          {list?.hasManualOrder ? (
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => {
                setBusy(true);
                void run(resetMyPriorities);
              }}
              style={styles.action}
            >
              <Ionicons
                color={colors.primaryText}
                name="refresh-outline"
                size={16}
              />
              <Text style={styles.actionText}>KI-Reihenfolge</Text>
            </Pressable>
          ) : null}
        </View>

        {error ? (
          <View style={styles.errorCard}>
            <Ionicons
              color={colors.error}
              name="alert-circle-outline"
              size={19}
            />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {tickets.length === 0 && !error ? (
          <View style={styles.emptyCard}>
            <Ionicons
              color={colors.primaryText}
              name="checkmark-done-outline"
              size={28}
            />
            <Text style={styles.emptyTitle}>Nichts offen</Text>
            <Text style={styles.emptyText}>
              Dir sind keine offenen Tickets zugewiesen.
            </Text>
          </View>
        ) : null}

        <View style={styles.list}>
          {tickets.map((ticket, index) => (
            <View key={ticket.id} style={styles.card}>
              <Text style={styles.rank}>{ticket.position}</Text>
              <Pressable
                accessibilityRole="button"
                onPress={() =>
                  router.push({
                    pathname: "/ticket/[id]",
                    params: { id: ticket.id },
                  })
                }
                style={styles.cardCopy}
              >
                <Text numberOfLines={1} style={styles.cardTitle}>
                  {ticket.subject}
                </Text>
                <Text numberOfLines={2} style={styles.cardMeta}>
                  {ticket.ticketNumber} ·{" "}
                  {ticket.manual ? "Eigene Einordnung · " : ""}
                  {ticket.reason ?? ticket.priorityLabel}
                </Text>
              </Pressable>
              <View style={styles.moveColumn}>
                <Pressable
                  accessibilityLabel={`${ticket.ticketNumber} nach oben`}
                  accessibilityRole="button"
                  disabled={busy || index === 0}
                  hitSlop={6}
                  onPress={() => move(ticket.id, -1)}
                  style={[
                    styles.moveButton,
                    index === 0 ? styles.moveDisabled : null,
                  ]}
                >
                  <Ionicons
                    color={colors.primaryText}
                    name="chevron-up"
                    size={18}
                  />
                </Pressable>
                <Pressable
                  accessibilityLabel={`${ticket.ticketNumber} nach unten`}
                  accessibilityRole="button"
                  disabled={busy || index === tickets.length - 1}
                  hitSlop={6}
                  onPress={() => move(ticket.id, 1)}
                  style={[
                    styles.moveButton,
                    index === tickets.length - 1 ? styles.moveDisabled : null,
                  ]}
                >
                  <Ionicons
                    color={colors.primaryText}
                    name="chevron-down"
                    size={18}
                  />
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

const useStyles = makeThemedStyles((c) => ({
  action: {
    alignItems: "center",
    backgroundColor: c.primarySoft,
    borderRadius: 14,
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  actionPrimary: { backgroundColor: c.primary },
  actionText: { color: c.primaryText, fontSize: 13, fontWeight: "800" },
  actionTextPrimary: { color: c.onPrimary },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  back: { alignItems: "center", flexDirection: "row", gap: 2 },
  backText: { color: c.primaryText, fontSize: 14, fontWeight: "700" },
  card: {
    alignItems: "center",
    backgroundColor: c.surface,
    borderColor: c.border,
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    padding: 12,
  },
  cardCopy: { flex: 1, gap: 3 },
  cardMeta: { color: c.muted, fontSize: 12, lineHeight: 16 },
  cardTitle: { color: c.foreground, fontSize: 15, fontWeight: "800" },
  centered: { alignItems: "center", flex: 1, justifyContent: "center" },
  content: { gap: 16, paddingBottom: 40, paddingTop: 14 },
  emptyCard: {
    alignItems: "center",
    backgroundColor: c.surface,
    borderColor: c.border,
    borderRadius: 20,
    borderWidth: 1,
    gap: 7,
    padding: 30,
  },
  emptyText: { color: c.muted, fontSize: 12, textAlign: "center" },
  emptyTitle: { color: c.foreground, fontSize: 15, fontWeight: "800" },
  errorCard: {
    alignItems: "flex-start",
    backgroundColor: c.errorSoft,
    borderRadius: 16,
    flexDirection: "row",
    gap: 9,
    padding: 13,
  },
  errorText: { color: c.error, flex: 1, fontSize: 12, lineHeight: 18 },
  eyebrow: {
    color: c.muted,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.2,
  },
  list: { gap: 10 },
  moveButton: {
    alignItems: "center",
    backgroundColor: c.primarySoft,
    borderRadius: 10,
    height: 30,
    justifyContent: "center",
    width: 34,
  },
  moveColumn: { gap: 6 },
  moveDisabled: { opacity: 0.35 },
  rank: {
    backgroundColor: c.primarySoft,
    borderRadius: 999,
    color: c.primaryText,
    fontSize: 13,
    fontWeight: "900",
    minWidth: 30,
    overflow: "hidden",
    paddingVertical: 5,
    textAlign: "center",
  },
  subtitle: { color: c.muted, fontSize: 13, marginTop: 4 },
  title: {
    color: c.foreground,
    fontSize: 30,
    fontWeight: "900",
    letterSpacing: -0.8,
    marginTop: 3,
  },
}));
