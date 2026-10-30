import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  ActionSheetIOS,
  Alert,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import {
  TicketPriorityText,
  TicketStatusBadge,
} from "@/components/ticket-status-badge";
import { TicketSwipeActions } from "@/components/ticket-swipe-actions";
import { UndoToast } from "@/components/undo-toast";
import { useMobileFeatures } from "@/components/mobile-feature-gate";
import { useMobileNetworkStatus } from "@/components/offline-status";
import {
  isExperienceUnavailableError,
  saveFollowUp,
} from "@/lib/nextdesk-experience";
import {
  assignTicketsToMe,
  assignTicketToMe,
  BULK_STATUS_OPTIONS,
  bulkDeleteTickets,
  bulkSetTicketStatus,
  dueToday,
  followUpTitle,
  listSavedTicketViews,
  type BulkStatusKey,
  type SavedTicketView,
} from "@/lib/mobile-ticket-actions";
import { useUndoableDelete } from "@/lib/use-undoable-delete";
import { isNextDeskConfigured, nextDesk } from "@/lib/nextdesk-client";
import { loadMobileDashboard, type MobileTicket } from "@/lib/nextdesk-tickets";
import {
  listFavoriteTicketIds,
  reconcileFavoriteTicketIds,
  setFavoriteTicket,
} from "@/lib/mobile-private-state";
import { makeThemedStyles, useAppColors } from "@/lib/themed-styles";
import { useThemeContext } from "@/lib/theme-provider";

type TicketScope =
  | "all"
  | "mine"
  | "favorites"
  | "open"
  | "resolved"
  | "unassigned";

const scopes: { key: TicketScope; label: string }[] = [
  { key: "all", label: "Alle" },
  { key: "mine", label: "Meine" },
  { key: "favorites", label: "Favoriten" },
  { key: "open", label: "Offen" },
  { key: "resolved", label: "Gelöst" },
  { key: "unassigned", label: "Nicht zugewiesen" },
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
  const { width } = useWindowDimensions();
  const { isOffline, recoveryEpoch } = useMobileNetworkStatus();
  const { isEnabled, loading: checkingFeatures } = useMobileFeatures();
  const ticketDetailsEnabled = isEnabled("ticketing.detail");
  const workspaceEnabled = isEnabled("experience.workspace");
  const { density, reducedMotion } = useThemeContext();
  const colors = useAppColors();
  const styles = useStyles();
  const tokenStyles = useMemo(
    () => ({
      card: { backgroundColor: colors.surface, borderColor: colors.border },
      control: {
        backgroundColor: colors.surfaceSubtle,
        borderColor: colors.border,
      },
      error: {
        backgroundColor: colors.errorSoft,
        borderColor: colors.errorBorder,
      },
      foreground: { color: colors.foreground },
      muted: { color: colors.muted },
      primary: { backgroundColor: colors.primary },
      onPrimary: { color: colors.onPrimary },
      success: {
        backgroundColor: colors.successSoft,
        borderColor: colors.successBorder,
      },
      successText: { color: colors.success },
      warning: {
        backgroundColor: colors.warningSoft,
        borderColor: colors.warningBorder,
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
  const [workspaceAvailable, setWorkspaceAvailable] = useState(true);
  const [creatingFollowUpFor, setCreatingFollowUpFor] = useState<string | null>(
    null,
  );
  const latestLoad = useRef(0);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [statusPickerOpen, setStatusPickerOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [savedViews, setSavedViews] = useState<SavedTicketView[]>([]);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const undoDelete = useUndoableDelete({
    onDeleted: (ticket) =>
      setTickets((current) => current.filter((item) => item.id !== ticket.id)),
    onFailed: (failure) => setError(failure),
  });
  const isWide = width >= 760;

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
      if (!result.isOfflineCache) {
        void listSavedTicketViews()
          .then((views) => {
            if (loadId === latestLoad.current) setSavedViews(views);
          })
          .catch(() => undefined);
      }
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

  async function createFollowUp(ticket: MobileTicket) {
    if (
      !workspaceEnabled ||
      !workspaceAvailable ||
      isOffline ||
      offlineCacheAt
    ) {
      return;
    }
    setCreatingFollowUpFor(ticket.id);
    setError("");
    setMessage("");
    try {
      await saveFollowUp({
        title: followUpTitle(ticket),
        description: null,
        dueAt: dueToday(),
        priority: "normal",
        ticketId: ticket.id,
      });
      setMessage(
        `Wiedervorlage für «${ticket.ticketNumber}» für heute gesetzt.`,
      );
    } catch (nextError) {
      if (isExperienceUnavailableError(nextError)) {
        setWorkspaceAvailable(false);
        setMessage("Diese Zusatzfunktion ist derzeit nicht verfügbar.");
        return;
      }
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Die Wiedervorlage konnte nicht gesetzt werden.",
      );
    } finally {
      setCreatingFollowUpFor(null);
    }
  }

  function deleteTicket(ticket: MobileTicket) {
    setError("");
    setMessage("");
    undoDelete.schedule(ticket);
  }

  async function assignToMe(ticket: MobileTicket) {
    if (!currentUserId) return;
    setError("");
    setMessage("");
    try {
      await assignTicketToMe(ticket.id, currentUserId);
      setTickets((current) =>
        current.map((item) =>
          item.id === ticket.id
            ? { ...item, assignedToCurrentUser: true, unassigned: false }
            : item,
        ),
      );
      setMessage(`«${ticket.ticketNumber}» wurde dir zugewiesen.`);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Das Ticket konnte nicht zugewiesen werden.",
      );
    }
  }

  function toggleSelection(ticketId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(ticketId)) next.delete(ticketId);
      else next.add(ticketId);
      return next;
    });
  }

  function leaveSelection() {
    setSelectionMode(false);
    setSelectedIds(new Set());
    setStatusPickerOpen(false);
  }

  async function runBulk(
    action: () => Promise<string>,
    failureMessage: string,
  ) {
    setBulkBusy(true);
    setError("");
    setMessage("");
    try {
      const summary = await action();
      leaveSelection();
      setMessage(summary);
      void load();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : failureMessage);
    } finally {
      setBulkBusy(false);
    }
  }

  function bulkAssign() {
    if (!currentUserId || selectedIds.size === 0) return;
    const ids = [...selectedIds];
    void runBulk(async () => {
      const result = await assignTicketsToMe(ids, currentUserId);
      if (result.succeeded === 0) {
        throw new Error("Die Tickets konnten nicht zugewiesen werden.");
      }
      return result.failed > 0
        ? `${result.succeeded} Tickets zugewiesen, ${result.failed} nicht möglich.`
        : `${result.succeeded} Tickets wurden dir zugewiesen.`;
    }, "Die Tickets konnten nicht zugewiesen werden.");
  }

  function bulkStatus(statusKey: BulkStatusKey, label: string) {
    if (selectedIds.size === 0) return;
    const ids = [...selectedIds];
    const apply = () =>
      void runBulk(async () => {
        await bulkSetTicketStatus(ids, statusKey);
        return `${ids.length} Tickets auf «${label}» gesetzt.`;
      }, "Der Status konnte nicht geändert werden.");
    setStatusPickerOpen(false);
    if (statusKey === "resolved" || statusKey === "closed") {
      Alert.alert(
        `${ids.length} Tickets auf «${label}» setzen?`,
        "Die Anfragenden werden entsprechend informiert.",
        [
          { style: "cancel", text: "Abbrechen" },
          { onPress: apply, text: "Bestätigen" },
        ],
      );
    } else {
      apply();
    }
  }

  function bulkDelete() {
    if (selectedIds.size === 0) return;
    const ids = [...selectedIds];
    Alert.alert(
      `${ids.length} Tickets löschen?`,
      "Sie werden endgültig gelöscht. Das kann nicht rückgängig gemacht werden.",
      [
        { style: "cancel", text: "Abbrechen" },
        {
          onPress: () =>
            void runBulk(async () => {
              await bulkDeleteTickets(ids);
              return `${ids.length} Tickets wurden gelöscht.`;
            }, "Die Tickets konnten nicht gelöscht werden."),
          style: "destructive",
          text: "Löschen",
        },
      ],
    );
  }

  function applySavedView(view: SavedTicketView) {
    if (activeViewId === view.id) {
      setActiveViewId(null);
      setScope("all");
      setQuery("");
      return;
    }
    setActiveViewId(view.id);
    setQuery(view.filters.query);
    if (view.filters.agent === "mine") setScope("mine");
    else if (view.filters.agent === "unassigned") setScope("unassigned");
    else if (view.filters.ticketScope === "mine") setScope("mine");
    else if (view.filters.ticketScope === "unassigned") setScope("unassigned");
    else if (view.filters.ticketScope === "open") setScope("open");
    else if (view.filters.ticketScope === "closed") setScope("resolved");
    else setScope("all");
  }

  function openTicketActions(ticket: MobileTicket) {
    if (Platform.OS !== "ios" || !tenantId || !currentUserId) return;
    const isFavorite = favoriteIds.includes(ticket.id);
    const canCreateFollowUp =
      workspaceEnabled &&
      workspaceAvailable &&
      !isOffline &&
      !offlineCacheAt &&
      creatingFollowUpFor !== ticket.id;
    ActionSheetIOS.showActionSheetWithOptions(
      {
        cancelButtonIndex: 0,
        message:
          "Favoriten werden nur verschlüsselt auf diesem Gerät gespeichert.",
        options: [
          "Abbrechen",
          isFavorite ? "Aus Favoriten entfernen" : "Zu Favoriten hinzufügen",
          ...(canCreateFollowUp ? ["Wiedervorlage für heute setzen"] : []),
        ],
        title: ticket.ticketNumber,
      },
      (buttonIndex) => {
        if (buttonIndex === 1) void toggleFavorite(ticket);
        if (buttonIndex === 2 && canCreateFollowUp) void createFollowUp(ticket);
      },
    );
  }

  const normalizedQuery = query.trim().toLocaleLowerCase("de-CH");
  const visibleTickets = tickets.filter((ticket) => {
    if (undoDelete.hiddenIds.has(ticket.id)) return false;
    const matchesScope =
      scope === "mine"
        ? ticket.assignedToCurrentUser
        : scope === "favorites"
          ? favoriteIds.includes(ticket.id)
          : scope === "unassigned"
            ? ticket.unassigned && !ticket.resolved
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
                  { backgroundColor: colors.primarySoft },
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
        contentContainerStyle={[
          styles.content,
          densityStyles.content,
          isWide && styles.contentWide,
        ]}
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
            <Ionicons color={colors.onPrimary} name="add" size={23} />
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
              onPress={() => {
                setActiveViewId(null);
                setScope(option.key);
              }}
              style={[
                styles.filter,
                tokenStyles.card,
                scope === option.key && tokenStyles.primary,
              ]}
            >
              <Text
                style={[
                  styles.filterText,
                  tokenStyles.muted,
                  scope === option.key && tokenStyles.onPrimary,
                ]}
              >
                {option.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        {savedViews.length > 0 ? (
          <ScrollView
            contentContainerStyle={styles.filters}
            horizontal
            showsHorizontalScrollIndicator={false}
          >
            <Text style={[styles.viewsLabel, tokenStyles.muted]}>
              Ansichten
            </Text>
            {savedViews.map((view) => (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: activeViewId === view.id }}
                key={view.id}
                onPress={() => applySavedView(view)}
                style={[
                  styles.filter,
                  tokenStyles.card,
                  activeViewId === view.id && tokenStyles.primary,
                ]}
              >
                <Text
                  style={[
                    styles.filterText,
                    tokenStyles.muted,
                    activeViewId === view.id && tokenStyles.onPrimary,
                  ]}
                >
                  {view.name}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}

        <View style={[styles.searchWrap, tokenStyles.control]}>
          <Ionicons color={colors.muted} name="search-outline" size={20} />
          <TextInput
            allowFontScaling
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setQuery}
            placeholder="Tickets durchsuchen"
            placeholderTextColor={colors.subtle}
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
              <Ionicons color={colors.muted} name="close-circle" size={19} />
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
                <Text style={[styles.retryText, { color: colors.primaryText }]}>
                  Erneut versuchen
                </Text>
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
          <View style={[styles.cacheNotice, tokenStyles.warning]}>
            <Ionicons
              color={colors.warning}
              name="cloud-offline-outline"
              size={19}
            />
            <View style={styles.cacheNoticeCopy}>
              <Text
                style={[styles.cacheNoticeTitle, { color: colors.warning }]}
              >
                Offline verfügbar
              </Text>
              <Text style={[styles.cacheNoticeText, tokenStyles.foreground]}>
                Verschlüsselte Ticketlisten-Metadaten vom{" "}
                {offlineCacheTimestamp(offlineCacheAt)}. Öffnen und Bearbeiten
                sind erst nach einer Serververbindung wieder möglich.
              </Text>
            </View>
          </View>
        ) : null}

        {!checkingFeatures && !ticketDetailsEnabled ? (
          <View style={[styles.featureNotice, tokenStyles.warning]}>
            <Ionicons
              color={colors.warning}
              name="lock-closed-outline"
              size={18}
            />
            <Text style={[styles.featureNoticeText, tokenStyles.foreground]}>
              Ticketdetails sind für diesen Mandanten derzeit nicht
              freigeschaltet.
            </Text>
          </View>
        ) : null}

        <View style={styles.listHeading}>
          <View>
            <Text style={[styles.listTitle, tokenStyles.foreground]}>
              {scope === "all"
                ? "Alle Tickets"
                : scope === "favorites"
                  ? "Favorisierte Tickets"
                  : "Gefilterte Tickets"}
            </Text>
            {!checkingFeatures &&
            !reducedMotion &&
            workspaceEnabled &&
            workspaceAvailable ? (
              <Text style={[styles.gestureHint, tokenStyles.muted]}>
                Nach rechts wischen: zuweisen, Favorit oder Wiedervorlage. Nach
                links: löschen.
              </Text>
            ) : null}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: selectionMode }}
            disabled={visibleTickets.length === 0 || Boolean(offlineCacheAt)}
            hitSlop={8}
            onPress={() =>
              selectionMode ? leaveSelection() : setSelectionMode(true)
            }
          >
            <Text style={[styles.selectToggle, { color: colors.primaryText }]}>
              {selectionMode ? "Fertig" : "Auswählen"}
            </Text>
          </Pressable>
          <Text
            accessibilityLabel={`${visibleTickets.length} Tickets`}
            style={[
              styles.listCount,
              {
                backgroundColor: colors.primarySoft,
                color: colors.primaryText,
              },
            ]}
          >
            {visibleTickets.length}
          </Text>
        </View>

        {visibleTickets.length === 0 ? (
          <View style={[styles.empty, tokenStyles.card]}>
            <Ionicons color={colors.muted} name="ticket-outline" size={28} />
            <Text style={[styles.emptyTitle, tokenStyles.foreground]}>
              Keine passenden Tickets
            </Text>
            <Text style={[styles.emptyText, tokenStyles.muted]}>
              {scope !== "all" || query
                ? "Mit diesem Filter gibt es keine Treffer."
                : "Hier ist noch nichts. Erfasse das erste Ticket."}
            </Text>
            <View style={styles.emptyActions}>
              {scope !== "all" || query ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    setScope("all");
                    setQuery("");
                    setActiveViewId(null);
                  }}
                  style={[styles.emptyButton, tokenStyles.control]}
                >
                  <Text
                    style={[styles.emptyButtonText, tokenStyles.foreground]}
                  >
                    Filter zurücksetzen
                  </Text>
                </Pressable>
              ) : null}
              {!offlineCacheAt && !isOffline ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.push("/ticket/new")}
                  style={[styles.emptyButton, tokenStyles.primary]}
                >
                  <Text style={[styles.emptyButtonText, tokenStyles.onPrimary]}>
                    Ticket erfassen
                  </Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        ) : (
          <View style={styles.list}>
            {visibleTickets.map((ticket) => {
              const actionsDisabled = !tenantId || !currentUserId;
              const canCreateFollowUp =
                workspaceEnabled &&
                workspaceAvailable &&
                !isOffline &&
                !offlineCacheAt &&
                creatingFollowUpFor !== ticket.id;
              return (
                <SwipeableTicketRow
                  actionsDisabled={actionsDisabled}
                  canCreateFollowUp={canCreateFollowUp}
                  densityStyle={densityStyles.ticket}
                  favorite={favoriteIds.includes(ticket.id)}
                  key={ticket.id}
                  canAssign={
                    !actionsDisabled &&
                    !isOffline &&
                    !offlineCacheAt &&
                    !ticket.assignedToCurrentUser
                  }
                  canDelete={!isOffline && !offlineCacheAt && !checkingFeatures}
                  onAssign={() => void assignToMe(ticket)}
                  onCreateFollowUp={() => void createFollowUp(ticket)}
                  onDelete={() => deleteTicket(ticket)}
                  onToggleSelect={() => toggleSelection(ticket.id)}
                  selected={selectedIds.has(ticket.id)}
                  selectionMode={selectionMode}
                  onFavorite={() => void toggleFavorite(ticket)}
                  onLongPress={() => openTicketActions(ticket)}
                  onPress={() => {
                    if (selectionMode) {
                      toggleSelection(ticket.id);
                      return;
                    }
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
                  openDisabled={
                    Boolean(offlineCacheAt) ||
                    checkingFeatures ||
                    !ticketDetailsEnabled
                  }
                  swipeEnabled={!reducedMotion && !selectionMode}
                  ticket={ticket}
                />
              );
            })}
            {selectionMode ? <View style={styles.selectionSpacer} /> : null}
          </View>
        )}
      </ScrollView>
      {selectionMode ? (
        <View
          style={[
            styles.selectionBar,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          {statusPickerOpen ? (
            <View style={styles.statusPicker}>
              {BULK_STATUS_OPTIONS.map((option) => (
                <Pressable
                  accessibilityRole="button"
                  key={option.key}
                  onPress={() => bulkStatus(option.key, option.label)}
                  style={[styles.filter, tokenStyles.control]}
                >
                  <Text style={[styles.filterText, tokenStyles.foreground]}>
                    {option.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          <View style={styles.selectionRow}>
            <Text style={[styles.selectionCount, tokenStyles.foreground]}>
              {selectedIds.size} ausgewählt
            </Text>
            {bulkBusy ? (
              <Text style={[styles.selectionHint, tokenStyles.muted]}>
                Wird ausgeführt …
              </Text>
            ) : (
              <View style={styles.selectionActions}>
                <Pressable
                  accessibilityLabel="Ausgewählte Tickets mir zuweisen"
                  accessibilityRole="button"
                  disabled={selectedIds.size === 0}
                  onPress={bulkAssign}
                  style={styles.selectionAction}
                >
                  <Ionicons
                    color={colors.primaryText}
                    name="person-add-outline"
                    size={20}
                  />
                  <Text
                    style={[styles.selectionActionText, tokenStyles.foreground]}
                  >
                    Mir
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityLabel="Status der ausgewählten Tickets ändern"
                  accessibilityRole="button"
                  disabled={selectedIds.size === 0}
                  onPress={() => setStatusPickerOpen((open) => !open)}
                  style={styles.selectionAction}
                >
                  <Ionicons
                    color={colors.primaryText}
                    name="swap-horizontal-outline"
                    size={20}
                  />
                  <Text
                    style={[styles.selectionActionText, tokenStyles.foreground]}
                  >
                    Status
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityLabel="Ausgewählte Tickets löschen"
                  accessibilityRole="button"
                  disabled={selectedIds.size === 0}
                  onPress={bulkDelete}
                  style={styles.selectionAction}
                >
                  <Ionicons
                    color={colors.error}
                    name="trash-outline"
                    size={20}
                  />
                  <Text
                    style={[
                      styles.selectionActionText,
                      { color: colors.error },
                    ]}
                  >
                    Löschen
                  </Text>
                </Pressable>
              </View>
            )}
          </View>
        </View>
      ) : null}
      {undoDelete.lastDeleted ? (
        <UndoToast
          message={`«${undoDelete.lastDeleted.ticketNumber}» gelöscht`}
          onUndo={() => undoDelete.undo(undoDelete.lastDeleted!)}
        />
      ) : null}
    </ScreenContainer>
  );
}

function SwipeableTicketRow({
  actionsDisabled,
  canAssign,
  canCreateFollowUp,
  canDelete,
  densityStyle,
  favorite,
  onAssign,
  onCreateFollowUp,
  onDelete,
  onFavorite,
  onLongPress,
  onPress,
  onToggleSelect,
  openDisabled,
  selected,
  selectionMode,
  swipeEnabled,
  ticket,
}: {
  actionsDisabled: boolean;
  canAssign: boolean;
  canCreateFollowUp: boolean;
  canDelete: boolean;
  densityStyle: { padding: number };
  favorite: boolean;
  onAssign: () => void;
  onCreateFollowUp: () => void;
  onDelete: () => void;
  onFavorite: () => void;
  onLongPress: () => void;
  onPress: () => void;
  onToggleSelect: () => void;
  openDisabled: boolean;
  selected: boolean;
  selectionMode: boolean;
  swipeEnabled: boolean;
  ticket: MobileTicket;
}) {
  const colors = useAppColors();
  const styles = useStyles();
  const actionsAvailable = !actionsDisabled;

  return (
    <TicketSwipeActions
      canAssign={actionsAvailable && canAssign}
      canDelete={actionsAvailable && canDelete}
      canFavorite={actionsAvailable}
      canFollowUp={actionsAvailable && canCreateFollowUp}
      enabled={swipeEnabled}
      favorite={favorite}
      onAssign={onAssign}
      onDelete={onDelete}
      onFavorite={onFavorite}
      onFollowUp={onCreateFollowUp}
    >
      <View style={styles.selectableRow}>
        {selectionMode ? (
          <Pressable
            accessibilityLabel={`${ticket.ticketNumber} auswählen`}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: selected }}
            hitSlop={8}
            onPress={onToggleSelect}
            style={[
              styles.checkbox,
              {
                backgroundColor: selected ? colors.primary : "transparent",
                borderColor: selected ? colors.primary : colors.borderStrong,
              },
            ]}
          >
            {selected ? (
              <Ionicons color={colors.onPrimary} name="checkmark" size={16} />
            ) : null}
          </Pressable>
        ) : null}
        <View style={styles.selectableBody}>
          <TicketRow
            actionsDisabled={actionsDisabled}
            canCreateFollowUp={canCreateFollowUp}
            densityStyle={densityStyle}
            favorite={favorite}
            onCreateFollowUp={onCreateFollowUp}
            onFavorite={onFavorite}
            onLongPress={onLongPress}
            onPress={onPress}
            openDisabled={openDisabled}
            ticket={ticket}
          />
        </View>
      </View>
    </TicketSwipeActions>
  );
}

function TicketRow({
  actionsDisabled,
  canCreateFollowUp,
  densityStyle,
  favorite,
  onCreateFollowUp,
  onFavorite,
  onLongPress,
  onPress,
  openDisabled,
  ticket,
}: {
  actionsDisabled: boolean;
  canCreateFollowUp: boolean;
  densityStyle: { padding: number };
  favorite: boolean;
  onCreateFollowUp: () => void;
  onFavorite: () => void;
  onLongPress: () => void;
  onPress: () => void;
  openDisabled: boolean;
  ticket: MobileTicket;
}) {
  const colors = useAppColors();
  const styles = useStyles();
  const tone = ticket.resolved
    ? styles.markResolved
    : ticket.status === "Neu"
      ? styles.markNew
      : styles.markActive;
  const accessibilityActions = [
    {
      label: favorite ? "Aus Favoriten entfernen" : "Zu Favoriten hinzufügen",
      name: "favorite",
    },
    ...(canCreateFollowUp
      ? [
          {
            label: "Wiedervorlage für heute setzen",
            name: "followUp",
          },
        ]
      : []),
  ];

  return (
    <View
      style={[
        styles.ticket,
        { backgroundColor: colors.surface, borderColor: colors.border },
        openDisabled && styles.ticketOffline,
      ]}
    >
      <Pressable
        accessibilityActions={accessibilityActions}
        accessibilityHint={
          Platform.OS === "ios"
            ? "Für Schnellaktionen lange drücken oder nach rechts bzw. links wischen."
            : "Schnellaktionen sind über die Aktionen des Eintrags verfügbar."
        }
        accessibilityLabel={`${ticket.ticketNumber}: ${ticket.subject}. Status: ${ticket.status}. ${favorite ? "Favorit." : "Kein Favorit."}`}
        accessibilityRole="button"
        accessibilityState={{ disabled: openDisabled }}
        disabled={openDisabled}
        onAccessibilityAction={(event) => {
          if (actionsDisabled) return;
          if (event.nativeEvent.actionName === "favorite") onFavorite();
          if (
            event.nativeEvent.actionName === "followUp" &&
            canCreateFollowUp
          ) {
            onCreateFollowUp();
          }
        }}
        onLongPress={actionsDisabled ? undefined : onLongPress}
        onPress={onPress}
        style={[styles.ticketPress, densityStyle]}
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
          <TicketPriorityText priority={ticket.priority} />
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
          <TicketStatusBadge ticket={ticket} />
          <Ionicons color={colors.subtle} name="chevron-forward" size={18} />
        </View>
      </Pressable>
    </View>
  );
}

const useStyles = makeThemedStyles((c) => ({
  checkbox: {
    alignItems: "center",
    borderRadius: 8,
    borderWidth: 2,
    height: 26,
    justifyContent: "center",
    width: 26,
  },
  emptyActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 6,
  },
  emptyButton: {
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 40,
    paddingHorizontal: 16,
  },
  emptyButtonText: { fontSize: 13, fontWeight: "800" },
  selectableBody: { flex: 1 },
  selectableRow: { alignItems: "center", flexDirection: "row", gap: 10 },
  selectToggle: { fontSize: 14, fontWeight: "800" },
  selectionAction: { alignItems: "center", gap: 2, minWidth: 56 },
  selectionActions: { flexDirection: "row", gap: 6 },
  selectionActionText: { fontSize: 11, fontWeight: "800" },
  selectionBar: {
    borderRadius: 18,
    borderWidth: 1,
    bottom: 10,
    gap: 10,
    left: 14,
    padding: 12,
    position: "absolute",
    right: 14,
  },
  selectionCount: { flex: 1, fontSize: 14, fontWeight: "800" },
  selectionHint: { fontSize: 13 },
  selectionRow: { alignItems: "center", flexDirection: "row", gap: 10 },
  selectionSpacer: { height: 96 },
  statusPicker: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  viewsLabel: {
    alignSelf: "center",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  addButton: {
    alignItems: "center",
    borderRadius: 17,
    height: 48,
    justifyContent: "center",
    width: 48,
  },
  addButtonOffline: { opacity: 0.5 },
  cacheNotice: {
    alignItems: "flex-start",
    borderRadius: 15,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    padding: 14,
  },
  cacheNoticeCopy: { flex: 1, gap: 3 },
  cacheNoticeText: { fontSize: 12, lineHeight: 18 },
  cacheNoticeTitle: { fontSize: 13, fontWeight: "900" },
  content: {
    alignSelf: "center",
    paddingBottom: 34,
    paddingTop: 18,
    width: "100%",
  },
  contentWide: { maxWidth: 1_040 },
  empty: {
    alignItems: "center",
    borderRadius: 20,
    borderWidth: 1,
    gap: 8,
    padding: 27,
  },
  emptyText: { fontSize: 13, lineHeight: 19, textAlign: "center" },
  emptyTitle: { fontSize: 15, fontWeight: "800", marginTop: 2 },
  errorText: { fontSize: 13, lineHeight: 19 },
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
  featureNotice: {
    alignItems: "flex-start",
    borderRadius: 15,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    padding: 13,
  },
  featureNoticeText: { flex: 1, fontSize: 12, lineHeight: 18 },
  favoriteMark: { alignItems: "center", flexDirection: "row", gap: 3 },
  favoriteText: { fontSize: 10, fontWeight: "800" },
  filter: {
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 15,
    paddingVertical: 9,
  },
  filterText: { fontSize: 13, fontWeight: "800" },
  filters: { gap: 9, paddingRight: 16 },
  gestureHint: { fontSize: 11, marginTop: 3 },
  header: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  eyebrow: { fontSize: 11, fontWeight: "800", letterSpacing: 1.2 },
  list: { gap: 10 },
  listCount: {
    borderRadius: 10,
    fontSize: 12,
    fontWeight: "900",
    minWidth: 27,
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 4,
    textAlign: "center",
  },
  listHeading: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 2,
  },
  listTitle: { fontSize: 18, fontWeight: "800" },
  loadingText: { fontSize: 14 },
  mark: { borderRadius: 2, height: 46, width: 4 },
  markActive: { backgroundColor: c.primary },
  markNew: { backgroundColor: c.info },
  markResolved: { backgroundColor: c.success },
  retryText: { fontSize: 13, fontWeight: "800" },
  searchInput: { flex: 1, fontSize: 14, minHeight: 48 },
  searchWrap: {
    alignItems: "center",
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: 9,
    minHeight: 52,
    paddingHorizontal: 14,
  },
  skeletonCopy: { flex: 1, gap: 9 },
  skeletonLine: { borderRadius: 6, height: 12, width: "100%" },
  skeletonMark: { borderRadius: 2, height: 46, width: 4 },
  skeletonPage: { flex: 1, gap: 14, justifyContent: "center" },
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
  skeletonTitle: { borderRadius: 8, height: 31, width: "42%" },
  status: {
    alignItems: "center",
    borderRadius: 8,
    flexDirection: "row",
    gap: 4,
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  statusActive: { backgroundColor: c.primarySoft },
  statusNew: { backgroundColor: c.infoSoft },
  statusResolved: { backgroundColor: c.successSoft },
  statusText: { fontSize: 10, fontWeight: "900" },
  subtitle: { fontSize: 13, marginTop: 3 },
  ticket: {
    alignItems: "stretch",
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: "row",
    overflow: "hidden",
  },
  ticketCopy: { flex: 1, gap: 3 },
  ticketMeta: { fontSize: 11 },
  ticketNumber: { fontSize: 10, fontWeight: "900", letterSpacing: 0.6 },
  ticketOffline: { opacity: 0.7 },
  ticketPress: { alignItems: "center", flex: 1, flexDirection: "row", gap: 11 },
  ticketState: { alignItems: "flex-end", gap: 8 },
  ticketTitle: { fontSize: 14, fontWeight: "800", lineHeight: 19 },
  title: { fontSize: 29, fontWeight: "900", letterSpacing: -0.8, marginTop: 4 },
}));
