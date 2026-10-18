import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  ActionSheetIOS,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { useMobileFeatures } from "@/components/mobile-feature-gate";
import { useMobileNetworkStatus } from "@/components/offline-status";
import { isNextDeskConfigured, nextDesk } from "@/lib/nextdesk-client";
import { loadMobileDashboard, type MobileTicket } from "@/lib/nextdesk-tickets";
import {
  listFavoriteTicketIds,
  reconcileFavoriteTicketIds,
  setFavoriteTicket,
} from "@/lib/mobile-private-state";
import { useThemeContext } from "@/lib/theme-provider";

type TicketScope = "all" | "mine" | "favorites" | "open" | "resolved";

const scopes: { key: TicketScope; label: string }[] = [
  { key: "all", label: "Alle" },
  { key: "mine", label: "Meine" },
  { key: "favorites", label: "Favoriten" },
  { key: "open", label: "Offen" },
  { key: "resolved", label: "Gelöst" },
];

function offlineCacheTimestamp(value: string): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return "vor Kurzem";
  return new Intl.DateTimeFormat("de-CH", {
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
  }).format(timestamp);
}

export default function TicketsScreen() {
  const router = useRouter();
  const { isOffline, recoveryEpoch } = useMobileNetworkStatus();
  const { isEnabled, loading: checkingFeatures } = useMobileFeatures();
  const ticketDetailsEnabled = isEnabled("ticketing.detail");
  const { colors, density } = useThemeContext();
  const tokenStyles = useMemo(
    () => ({
      card: { backgroundColor: colors.surface, borderColor: colors.border },
      control: {
        backgroundColor: colors.background,
        borderColor: colors.border,
      },
      error: {
        backgroundColor: colors.error + "1A",
        borderColor: colors.error,
      },
      foreground: { color: colors.foreground },
      muted: { color: colors.muted },
      primary: { backgroundColor: colors.primary },
      primaryText: { color: colors.background },
      success: {
        backgroundColor: colors.success + "1A",
        borderColor: colors.success,
      },
      successText: { color: colors.success },
      warning: {
        backgroundColor: colors.warning + "1A",
        borderColor: colors.warning,
      },
    }),
    [colors],
  );
  const densityStyles = useMemo(
    () => ({
      content: { gap: density === "compact" ? 13 : 18 },
      ticket: { padding: density === "compact" ? 11 : 14 },
    }),
    [density],
  );
  const [tickets, setTickets] = useState<MobileTicket[]>([]);
  const [tenantName, setTenantName] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [currentUserId, setCurrentUserId] = useState("");
  const [scope, setScope] = useState<TicketScope>("all");
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [offlineCacheAt, setOfflineCacheAt] = useState<string | null>(null);
  const latestLoad = useRef(0);

  const load = useCallback(async () => {
    const loadId = latestLoad.current + 1;
    latestLoad.current = loadId;
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
      const result = await loadMobileDashboard({
        allowOfflineCache: isOffline,
      });
      const favorites = result.isOfflineCache
        ? await listFavoriteTicketIds({
            userId: result.userId,
            tenantId: result.tenant.id,
          })
        : await reconcileFavoriteTicketIds({
            userId: result.userId,
            tenantId: result.tenant.id,
            authorizedTicketIds: result.tickets.map((ticket) => ticket.id),
          });
      if (loadId !== latestLoad.current) return;
      setTickets(result.tickets);
      setTenantName(result.tenant.name);
      setTenantId(result.tenant.id);
      setCurrentUserId(result.userId);
      setFavoriteIds(favorites);
      setOfflineCacheAt(result.isOfflineCache ? result.cachedAt : null);
    } catch (nextError) {
      if (loadId !== latestLoad.current) return;
      setOfflineCacheAt(null);
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Die Tickets konnten nicht geladen werden.",
      );
    } finally {
      if (loadId !== latestLoad.current) return;
      setLoading(false);
      setRefreshing(false);
    }
  }, [isOffline, router]);

  useFocusEffect(
    useCallback(() => {
      void recoveryEpoch;
      void load();
    }, [load, recoveryEpoch]),
  );

  async function toggleFavorite(ticket: MobileTicket) {
    if (!tenantId || !currentUserId) return;
    const nextFavorite = !favoriteIds.includes(ticket.id);
    setError("");
    setMessage("");
    try {
      const nextIds = await setFavoriteTicket({
        userId: currentUserId,
        tenantId,
        ticketId: ticket.id,
        favorite: nextFavorite,
      });
      setFavoriteIds(nextIds);
      setMessage(
        nextFavorite
          ? `«${ticket.ticketNumber}» wurde zu Favoriten hinzugefügt.`
          : `«${ticket.ticketNumber}» wurde aus Favoriten entfernt.`,
      );
    } catch {
      setError("Der Favorit konnte nicht auf diesem Gerät gespeichert werden.");
    }
  }

  function openFavoriteActions(ticket: MobileTicket) {
    if (Platform.OS !== "ios" || !tenantId || !currentUserId) return;
    const isFavorite = favoriteIds.includes(ticket.id);
    ActionSheetIOS.showActionSheetWithOptions(
      {
        cancelButtonIndex: 0,
        message: isFavorite
          ? "Der Favorit wird nur verschlüsselt auf diesem Gerät gespeichert."
          : "Favoriten werden nur verschlüsselt auf diesem Gerät gespeichert.",
        options: [
          "Abbrechen",
          isFavorite ? "Aus Favoriten entfernen" : "Zu Favoriten hinzufügen",
        ],
        title: ticket.ticketNumber,
      },
      (buttonIndex) => {
        if (buttonIndex === 1) void toggleFavorite(ticket);
      },
    );
  }

  const normalizedQuery = query.trim().toLocaleLowerCase("de-CH");
  const visibleTickets = tickets.filter((ticket) => {
    const matchesScope =
      scope === "mine"
        ? ticket.assignedToCurrentUser
        : scope === "favorites"
          ? favoriteIds.includes(ticket.id)
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
      <ScreenContainer containerClassName="bg-background" className="px-5">
        <View
          accessibilityLabel="Tickets werden geladen"
          accessibilityRole="progressbar"
          style={styles.skeletonPage}
        >
          <View
            style={[styles.skeletonTitle, { backgroundColor: colors.border }]}
          />
          <View
            style={[styles.skeletonLine, { backgroundColor: colors.border }]}
          />
          {[1, 2, 3, 4].map((item) => (
            <View key={item} style={[styles.skeletonTicket, tokenStyles.card]}>
              <View
                style={[
                  styles.skeletonMark,
                  { backgroundColor: colors.primary + "33" },
                ]}
              />
              <View style={styles.skeletonCopy}>
                <View
                  style={[
                    styles.skeletonShortLine,
                    { backgroundColor: colors.border },
                  ]}
                />
                <View
                  style={[
                    styles.skeletonLine,
                    { backgroundColor: colors.border },
                  ]}
                />
              </View>
            </View>
          ))}
          <Text style={[styles.loadingText, tokenStyles.muted]}>
            Tickets werden geladen …
          </Text>
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer
      containerClassName="bg-background"
      className="px-5"
      style={{ backgroundColor: colors.background }}
    >
      <ScrollView
        contentContainerStyle={[styles.content, densityStyles.content]}
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
            <Text style={[styles.eyebrow, tokenStyles.muted]}>
              ARBEITSBEREICH
            </Text>
            <Text style={[styles.title, tokenStyles.foreground]}>Tickets</Text>
            <Text style={[styles.subtitle, tokenStyles.muted]}>
              {tenantName || "Deine autorisierten Vorgänge"}
            </Text>
          </View>
          <Pressable
            accessibilityLabel="Ticket erfassen"
            accessibilityRole="button"
            accessibilityState={{
              disabled: Boolean(offlineCacheAt) || isOffline,
            }}
            disabled={Boolean(offlineCacheAt) || isOffline}
            onPress={() => router.push("/ticket/new")}
            style={[
              styles.addButton,
              tokenStyles.primary,
              (offlineCacheAt || isOffline) && styles.addButtonOffline,
            ]}
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
            allowFontScaling
            style={[styles.searchInput, tokenStyles.foreground]}
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
          <View
            accessibilityRole="alert"
            style={[styles.feedback, tokenStyles.error]}
          >
            <Ionicons
              color={colors.error}
              name="alert-circle-outline"
              size={20}
            />
            <View style={styles.feedbackCopy}>
              <Text style={[styles.errorText, { color: colors.error }]}>
                {error}
              </Text>
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
          </View>
        ) : null}

        {message ? (
          <View
            accessibilityRole="alert"
            style={[styles.feedback, tokenStyles.success]}
          >
            <Ionicons
              color={colors.success}
              name="checkmark-circle-outline"
              size={20}
            />
            <Text style={[styles.feedbackText, tokenStyles.successText]}>
              {message}
            </Text>
          </View>
        ) : null}

        {offlineCacheAt ? (
          <View style={styles.cacheNotice}>
            <Ionicons color="#9A5B12" name="cloud-offline-outline" size={19} />
            <View style={styles.cacheNoticeCopy}>
              <Text style={styles.cacheNoticeTitle}>Offline verfügbar</Text>
              <Text style={styles.cacheNoticeText}>
                Verschlüsselte Ticketlisten-Metadaten vom{" "}
                {offlineCacheTimestamp(offlineCacheAt)}. Öffnen und Bearbeiten
                sind erst nach einer Serververbindung wieder möglich.
              </Text>
            </View>
          </View>
        ) : null}

        {!checkingFeatures && !ticketDetailsEnabled ? (
          <View style={styles.featureNotice}>
            <Ionicons color="#5C5892" name="lock-closed-outline" size={18} />
            <Text style={styles.featureNoticeText}>
              Ticketdetails sind für diesen Mandanten derzeit nicht
              freigeschaltet.
            </Text>
          </View>
        ) : null}

        <View style={styles.listHeading}>
          <Text style={[styles.listTitle, tokenStyles.foreground]}>
            {scope === "all"
              ? "Alle Tickets"
              : scope === "favorites"
                ? "Favorisierte Tickets"
                : "Gefilterte Tickets"}
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
                disabled={
                  Boolean(offlineCacheAt) ||
                  checkingFeatures ||
                  !ticketDetailsEnabled
                }
                favorite={favoriteIds.includes(ticket.id)}
                colors={colors}
                densityStyle={densityStyles.ticket}
                onLongPress={() => openFavoriteActions(ticket)}
                onPress={() => {
                  if (
                    offlineCacheAt ||
                    checkingFeatures ||
                    !ticketDetailsEnabled
                  ) {
                    return;
                  }
                  router.push({
                    pathname: "/ticket/[id]",
                    params: { id: ticket.id },
                  });
                }}
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
  colors,
  densityStyle,
  disabled = false,
  favorite,
  onLongPress,
  onPress,
  ticket,
}: {
  colors: ReturnType<typeof useThemeContext>["colors"];
  densityStyle: { padding: number };
  disabled?: boolean;
  favorite: boolean;
  onLongPress: () => void;
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
      accessibilityActions={[
        {
          label: favorite
            ? "Aus Favoriten entfernen"
            : "Zu Favoriten hinzufügen",
          name: "favorite",
        },
      ]}
      accessibilityHint={
        Platform.OS === "ios"
          ? "Für Favoritenaktionen lange drücken."
          : undefined
      }
      accessibilityLabel={`${ticket.ticketNumber}: ${ticket.subject}. Status: ${ticket.status}. ${favorite ? "Favorit." : "Kein Favorit."}`}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === "favorite") onLongPress();
      }}
      onLongPress={disabled ? undefined : onLongPress}
      onPress={onPress}
      style={[
        styles.ticket,
        { backgroundColor: colors.surface, borderColor: colors.border },
        densityStyle,
        disabled && styles.ticketOffline,
      ]}
    >
      <View style={[styles.mark, tone]} />
      <View style={styles.ticketCopy}>
        <Text style={[styles.ticketNumber, { color: colors.muted }]}>
          {ticket.ticketNumber}
        </Text>
        <Text
          numberOfLines={2}
          style={[styles.ticketTitle, { color: colors.foreground }]}
        >
          {ticket.subject}
        </Text>
        <Text style={styles.ticketMeta}>{ticket.priority}</Text>
      </View>
      <View style={styles.ticketState}>
        {favorite ? (
          <View accessibilityLabel="Favorit" style={styles.favoriteMark}>
            <Ionicons color={colors.warning} name="star" size={14} />
            <Text style={[styles.favoriteText, { color: colors.warning }]}>
              Favorit
            </Text>
          </View>
        ) : null}
        <View
          accessibilityLabel={`Status: ${ticket.status}`}
          style={[styles.status, statusTone]}
        >
          <Ionicons
            color={
              ticket.resolved
                ? colors.success
                : ticket.status === "Neu"
                  ? colors.primary
                  : colors.primary
            }
            name={
              ticket.resolved
                ? "checkmark-circle-outline"
                : ticket.status === "Neu"
                  ? "sparkles-outline"
                  : "time-outline"
            }
            size={14}
          />
          <Text
            style={[
              styles.statusText,
              { color: ticket.resolved ? colors.success : colors.primary },
            ]}
          >
            {ticket.status}
          </Text>
        </View>
        <Ionicons color={colors.muted} name="chevron-forward" size={18} />
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
  addButtonOffline: { opacity: 0.5 },
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
  feedback: {
    alignItems: "flex-start",
    borderRadius: 15,
    borderWidth: 1,
    flexDirection: "row",
    gap: 9,
    padding: 14,
  },
  feedbackCopy: { flex: 1, gap: 7 },
  feedbackText: { flex: 1, fontSize: 13, lineHeight: 19 },
  errorText: { fontSize: 13, lineHeight: 19 },
  retryText: { color: "#4438CA", fontSize: 13, fontWeight: "800" },
  cacheNotice: {
    alignItems: "flex-start",
    backgroundColor: "#FFF8E7",
    borderColor: "#F3D79A",
    borderRadius: 15,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    padding: 14,
  },
  cacheNoticeCopy: { flex: 1, gap: 3 },
  cacheNoticeTitle: { color: "#7B4B0D", fontSize: 13, fontWeight: "900" },
  cacheNoticeText: { color: "#71420C", fontSize: 12, lineHeight: 18 },
  featureNotice: {
    alignItems: "flex-start",
    backgroundColor: "#F0EEFF",
    borderRadius: 15,
    flexDirection: "row",
    gap: 8,
    padding: 13,
  },
  featureNoticeText: {
    color: "#5C5892",
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
  },
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
  ticketOffline: { opacity: 0.7 },
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
    alignItems: "center",
    borderRadius: 8,
    flexDirection: "row",
    gap: 4,
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  statusText: { fontSize: 10, fontWeight: "900" },
  favoriteMark: { alignItems: "center", flexDirection: "row", gap: 3 },
  favoriteText: { fontSize: 10, fontWeight: "800" },
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
  skeletonPage: { flex: 1, gap: 14, justifyContent: "center" },
  skeletonTitle: { borderRadius: 8, height: 31, width: "42%" },
  skeletonLine: { borderRadius: 6, height: 12, width: "100%" },
  skeletonShortLine: { borderRadius: 6, height: 10, width: "38%" },
  skeletonTicket: {
    alignItems: "center",
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: "row",
    gap: 11,
    minHeight: 74,
    padding: 14,
  },
  skeletonMark: { borderRadius: 2, height: 46, width: 4 },
  skeletonCopy: { flex: 1, gap: 9 },
});
