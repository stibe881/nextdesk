import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

import { GlobalSearch } from "@/components/global-search";
import { ApprovalInboxCard } from "@/components/approval-inbox-card";
import { IncidentBanner } from "@/components/incident-banner";
import { useMobileFeatures } from "@/components/mobile-feature-gate";
import { useMobileNetworkStatus } from "@/components/offline-status";
import { ScreenContainer } from "@/components/screen-container";
import { UndoToast } from "@/components/undo-toast";
import {
  TicketPriorityText,
  TicketStatusBadge,
} from "@/components/ticket-status-badge";
import { TicketSwipeActions } from "@/components/ticket-swipe-actions";
import {
  getMyMetrics,
  isNextDeskPortalUnavailableError,
  listActiveIncidentNotices,
  listMyApprovals,
  listMyDevices,
  listMyMentions,
  markMentionRead,
  type AgentMention,
  type AgentMetrics,
  type PortalApproval,
  type PortalDevice,
  type PortalIncidentNotice,
} from "@/lib/nextdesk-portal";
import {
  getMobileUserId,
  isNextDeskConfigured,
  nextDesk,
  type MobileTenant,
} from "@/lib/nextdesk-client";
import {
  listFavoriteTicketIds,
  listRecentTicketIds,
  setFavoriteTicket,
} from "@/lib/mobile-private-state";
import {
  assignTicketToMe,
  dueToday,
  followUpTitle,
} from "@/lib/mobile-ticket-actions";
import { useUndoableDelete } from "@/lib/use-undoable-delete";
import { saveFollowUp } from "@/lib/nextdesk-experience";
import {
  loadMobileDashboard,
  loadMobileTicketsByIds,
  type MobileDashboardMetrics,
  type MobileTicket,
} from "@/lib/nextdesk-tickets";
import { makeThemedStyles, useAppColors } from "@/lib/themed-styles";
import { useThemeContext } from "@/lib/theme-provider";
import { loadTenantBranding, type TenantBranding } from "@/lib/tenant-branding";

type FocusScope =
  | "assigned"
  | "solvedToday"
  | "firstResponse"
  | "resolution"
  | "slaDue";
type TicketScope = "all" | "mine" | "open" | "unassigned" | FocusScope;

const ticketScopeLabels: Record<Exclude<TicketScope, "all">, string> = {
  mine: "Meine Tickets",
  open: "Offene Tickets",
  unassigned: "Nicht zugewiesene Tickets",
  assigned: "Mir zugewiesen",
  solvedToday: "Heute gelöst",
  firstResponse: "Mit erster Antwort",
  resolution: "Von mir gelöst",
  slaDue: "Antwort oder Lösung fällig",
};

function isFocusScope(scope: TicketScope): scope is FocusScope {
  return (
    scope === "assigned" ||
    scope === "solvedToday" ||
    scope === "firstResponse" ||
    scope === "resolution" ||
    scope === "slaDue"
  );
}

/** Kurze Dauer für Kennzahlen, z. B. "45 Min.", "3,5 Std." oder "2,1 Tg.". */
function formatDuration(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes))
    return "—";
  if (minutes < 120) return `${Math.max(0, Math.round(minutes))} Min.`;
  const hours = minutes / 60;
  if (hours < 48) return `${hours.toFixed(1).replace(".", ",")} Std.`;
  return `${(hours / 24).toFixed(1).replace(".", ",")} Tg.`;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "vor Kurzem";
  return new Intl.DateTimeFormat("de-CH", {
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
  }).format(date);
}

function compactDeviceName(device: PortalDevice, index: number): string {
  const fields = ["display_name", "name", "asset_tag", "model", "id"];
  for (const field of fields) {
    const value = device[field];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return `Eigenes Gerät ${index + 1}`;
}

function compactDeviceDetail(device: PortalDevice): string | null {
  const fields = ["asset_tag", "serial_number", "model", "status"];
  const values = fields
    .map((field) => device[field])
    .filter(
      (value): value is string =>
        typeof value === "string" && Boolean(value.trim()),
    );
  return values.length > 0
    ? [...new Set(values)].slice(0, 2).join(" · ")
    : null;
}

function firstReason(value: string): string {
  return value.trim() || "Freigabe ausstehend";
}

const NO_TICKET_IDS: string[] = [];

export default function HomeScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { isOffline, recoveryEpoch } = useMobileNetworkStatus();
  const {
    error: featureError,
    isEnabled,
    loading: checkingFeatures,
    refresh: refreshFeatures,
    tenantId: featureTenantId,
  } = useMobileFeatures();
  const ticketDetailsEnabled = isEnabled("ticketing.detail");
  const agentWorkbenchEnabled = isEnabled("agent.workbench");
  const requesterPortalEnabled = isEnabled("requester.portal");
  const { density } = useThemeContext();
  const colors = useAppColors();
  const styles = useStyles();
  const [tenant, setTenant] = useState<MobileTenant | null>(null);
  const [tickets, setTickets] = useState<MobileTicket[]>([]);
  const [ticketMetrics, setTicketMetrics] =
    useState<MobileDashboardMetrics | null>(null);
  const [ticketScope, setTicketScope] = useState<TicketScope>("all");
  // Tickets, die eine Kennzahl enthält, aber nicht unter den zuletzt
  // geänderten Tickets der Startseite sind.
  const [extraTickets, setExtraTickets] = useState<MobileTicket[]>([]);
  // IDs, deren Nachladen bereits versucht wurde (erfolgreich oder nicht).
  const [attemptedFocusIds, setAttemptedFocusIds] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const focusLoadInFlight = useRef("");
  const scrollRef = useRef<ScrollView>(null);
  const ticketListOffset = useRef(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [incidentNotices, setIncidentNotices] = useState<
    PortalIncidentNotice[]
  >([]);
  const [agentMetrics, setAgentMetrics] = useState<AgentMetrics | null>(null);
  const [mentions, setMentions] = useState<AgentMention[]>([]);
  const [approvals, setApprovals] = useState<PortalApproval[]>([]);
  const [devices, setDevices] = useState<PortalDevice[]>([]);
  const [metricsAvailable, setMetricsAvailable] = useState(false);
  const [mentionsAvailable, setMentionsAvailable] = useState(false);
  const [approvalsAvailable, setApprovalsAvailable] = useState(false);
  const [devicesAvailable, setDevicesAvailable] = useState(false);
  // Ergänzende Daten werden erst angezeigt, wenn sie für diesen Mandanten
  // vollständig und aktuell geladen wurden.
  const [supplementaryTenantId, setSupplementaryTenantId] = useState<
    string | null
  >(null);
  const [readingMentionId, setReadingMentionId] = useState<string | null>(null);
  const [supplementaryMessage, setSupplementaryMessage] = useState("");
  const dashboardRequest = useRef(0);
  const dashboardTenant = useRef<string | null>(null);
  const tenantEpoch = useRef(0);
  const supplementaryRequest = useRef(0);
  const tenantId = tenant?.id ?? null;
  // Nach einem Mandantenwechsel kann dieser Tab noch kurz den vorherigen
  // Dashboard-Stand halten. Bis der neue Stand geladen ist, wird nichts aus
  // dem alten Mandanten angezeigt.
  const tenantContextMismatch =
    Boolean(tenantId) && (checkingFeatures || featureTenantId !== tenantId);
  const brandingTenantId = tenantContextMismatch ? null : tenantId;
  const supplementaryIsCurrent = Boolean(
    tenantId && !tenantContextMismatch && supplementaryTenantId === tenantId,
  );
  const visibleAgentMetrics = supplementaryIsCurrent ? agentMetrics : null;
  const visibleIncidentNotices = supplementaryIsCurrent ? incidentNotices : [];
  const visibleMentions = supplementaryIsCurrent ? mentions : [];
  const visibleApprovals = supplementaryIsCurrent ? approvals : [];
  const visibleDevices = supplementaryIsCurrent ? devices : [];
  const metricsAvailableForTenant = supplementaryIsCurrent && metricsAvailable;
  const mentionsAvailableForTenant =
    supplementaryIsCurrent && mentionsAvailable;
  const approvalsAvailableForTenant =
    supplementaryIsCurrent && approvalsAvailable;
  const devicesAvailableForTenant = supplementaryIsCurrent && devicesAvailable;
  // Logo und Portalname aus den Web-Einstellungen des aktiven Mandanten.
  const [branding, setBranding] = useState<{
    tenantId: string;
    value: TenantBranding;
  } | null>(null);
  const [logoLoad, setLogoLoad] = useState<{
    aspect: number | null;
    failed: boolean;
    url: string;
  } | null>(null);
  const brandingTenant = useRef<string | null>(null);
  const brandingRequest = useRef(0);
  const isWide = width >= 760;
  const cardPadding = density === "compact" ? 14 : 17;
  const tokenStyles = useMemo(
    () => ({
      card: { backgroundColor: colors.surface, borderColor: colors.border },
      foreground: { color: colors.foreground },
      muted: { color: colors.muted },
      primaryText: { color: colors.primaryText },
    }),
    [colors],
  );

  const load = useCallback(async () => {
    const requestId = dashboardRequest.current + 1;
    dashboardRequest.current = requestId;
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
      const result = await loadMobileDashboard({ allowOfflineCache: false });
      if (requestId !== dashboardRequest.current) return;
      const tenantChanged =
        dashboardTenant.current !== null &&
        dashboardTenant.current !== result.tenant.id;
      dashboardTenant.current = result.tenant.id;
      if (tenantChanged) {
        // Alle laufenden Antworten des bisherigen Mandanten werden verworfen.
        tenantEpoch.current += 1;
        supplementaryRequest.current += 1;
        focusLoadInFlight.current = "";
        setSupplementaryTenantId(null);
        setSupplementaryMessage("");
        setReadingMentionId(null);
        setTicketScope("all");
      }
      setTenant(result.tenant);
      setTickets(result.tickets);
      setTicketMetrics(result.metrics);
      setExtraTickets([]);
      setAttemptedFocusIds(new Set());
    } catch (nextError) {
      if (requestId !== dashboardRequest.current) return;
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Die Tickets konnten nicht geladen werden.",
      );
    } finally {
      if (requestId !== dashboardRequest.current) return;
      setLoading(false);
      setRefreshing(false);
    }
  }, [router]);

  const loadSupplementaryData = useCallback(async () => {
    if (
      !tenant ||
      checkingFeatures ||
      featureTenantId !== tenant.id ||
      !isNextDeskConfigured
    ) {
      return;
    }
    const requestId = supplementaryRequest.current + 1;
    supplementaryRequest.current = requestId;
    const stillCurrent = () => supplementaryRequest.current === requestId;
    const markTenantReady = () => {
      if (stillCurrent()) setSupplementaryTenantId(tenant.id);
    };

    if (!agentWorkbenchEnabled) {
      setAgentMetrics(null);
      setMentions([]);
      setMetricsAvailable(false);
      setMentionsAvailable(false);
    } else {
      const [metricsResult, mentionsResult] = await Promise.allSettled([
        getMyMetrics(),
        listMyMentions(),
      ]);
      if (!stillCurrent()) return;
      if (metricsResult.status === "fulfilled") {
        setAgentMetrics(metricsResult.value.metrics);
        setMetricsAvailable(true);
      } else {
        setAgentMetrics(null);
        setMetricsAvailable(false);
      }
      if (mentionsResult.status === "fulfilled") {
        setMentions(mentionsResult.value.mentions);
        setMentionsAvailable(true);
      } else {
        setMentions([]);
        setMentionsAvailable(false);
      }
    }

    if (!requesterPortalEnabled) {
      setIncidentNotices([]);
      setApprovals([]);
      setDevices([]);
      setApprovalsAvailable(false);
      setDevicesAvailable(false);
      markTenantReady();
      return;
    }

    const [noticesResult, approvalsResult, devicesResult] =
      await Promise.allSettled([
        listActiveIncidentNotices(),
        listMyApprovals(),
        listMyDevices(),
      ]);
    if (!stillCurrent()) return;

    if (noticesResult.status === "fulfilled") {
      setIncidentNotices(noticesResult.value.notices);
    } else {
      // Failure is deliberately indistinguishable from a disabled optional area:
      // no stale or cross-tenant portal data is displayed.
      setIncidentNotices([]);
    }
    if (approvalsResult.status === "fulfilled") {
      setApprovals(approvalsResult.value.approvals);
      setApprovalsAvailable(true);
    } else {
      setApprovals([]);
      setApprovalsAvailable(false);
    }
    if (devicesResult.status === "fulfilled" && devicesResult.value.available) {
      setDevices(devicesResult.value.devices);
      setDevicesAvailable(true);
    } else {
      setDevices([]);
      setDevicesAvailable(false);
    }
    markTenantReady();
  }, [
    agentWorkbenchEnabled,
    checkingFeatures,
    featureTenantId,
    requesterPortalEnabled,
    tenant,
  ]);

  useFocusEffect(
    useCallback(() => {
      void recoveryEpoch;
      void load();
    }, [load, recoveryEpoch]),
  );

  const loadBranding = useCallback(async (id: string) => {
    const requestId = brandingRequest.current + 1;
    brandingRequest.current = requestId;
    const stillCurrent = () =>
      brandingRequest.current === requestId && brandingTenant.current === id;
    brandingTenant.current = id;
    // Web-Einstellungen sind massgebend: Bis sie neu bestätigt sind, wird
    // kein möglicherweise veraltetes eigenes Branding angezeigt.
    setBranding({
      tenantId: id,
      value: {
        accentColor: null,
        logoUrl: null,
        portalName: null,
        primaryColor: null,
        secondaryColor: null,
      },
    });
    try {
      const value = await loadTenantBranding(id);
      if (stillCurrent()) setBranding({ tenantId: id, value });
    } catch {
      // Bei nicht bestätigtem Branding darf kein alter Mandantenstand
      // weiter sichtbar bleiben.
      if (stillCurrent())
        setBranding({
          tenantId: id,
          value: {
            accentColor: null,
            logoUrl: null,
            portalName: null,
            primaryColor: null,
            secondaryColor: null,
          },
        });
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void recoveryEpoch;
      if (!brandingTenantId) {
        brandingRequest.current += 1;
        brandingTenant.current = null;
        return;
      }
      void loadBranding(brandingTenantId);
    }, [brandingTenantId, loadBranding, recoveryEpoch]),
  );

  // Zuletzt geöffnete Tickets dieses Kontos (nur IDs, lokal gespeichert).
  const [recentTicketState, setRecentTicketState] = useState<{
    ids: string[];
    tenantId: string;
  } | null>(null);
  const [favoriteState, setFavoriteState] = useState<{
    ids: string[];
    tenantId: string;
    userId: string;
  } | null>(null);
  const [actionMessage, setActionMessage] = useState("");
  useFocusEffect(
    useCallback(() => {
      if (!tenantId) return;
      let cancelled = false;
      void (async () => {
        try {
          const userId = await getMobileUserId();
          const ids = await listRecentTicketIds({ userId, tenantId });
          const favorites = await listFavoriteTicketIds({ userId, tenantId });
          if (!cancelled) {
            setRecentTicketState({ ids, tenantId });
            setFavoriteState({ ids: favorites, tenantId, userId });
          }
        } catch {
          if (!cancelled) setRecentTicketState({ ids: [], tenantId });
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [tenantId]),
  );
  const recentTicketIds =
    recentTicketState && recentTicketState.tenantId === tenantId
      ? recentTicketState.ids
      : NO_TICKET_IDS;
  const favoriteIds =
    favoriteState && favoriteState.tenantId === tenantId
      ? favoriteState.ids
      : NO_TICKET_IDS;
  const workspaceEnabled = isEnabled("experience.workspace");

  async function toggleFavorite(ticket: MobileTicket) {
    if (!favoriteState || favoriteState.tenantId !== tenantId) return;
    const nextFavorite = !favoriteIds.includes(ticket.id);
    setActionMessage("");
    try {
      const ids = await setFavoriteTicket({
        favorite: nextFavorite,
        tenantId: favoriteState.tenantId,
        ticketId: ticket.id,
        userId: favoriteState.userId,
      });
      setFavoriteState({ ...favoriteState, ids });
      setActionMessage(
        nextFavorite
          ? `«${ticket.ticketNumber}» wurde zu Favoriten hinzugefügt.`
          : `«${ticket.ticketNumber}» wurde aus Favoriten entfernt.`,
      );
    } catch {
      setActionMessage("Der Favorit konnte nicht gespeichert werden.");
    }
  }

  async function createFollowUp(ticket: MobileTicket) {
    setActionMessage("");
    try {
      await saveFollowUp({
        description: null,
        dueAt: dueToday(),
        priority: "normal",
        ticketId: ticket.id,
        title: followUpTitle(ticket),
      });
      setActionMessage(
        `Wiedervorlage für «${ticket.ticketNumber}» für heute gesetzt.`,
      );
    } catch (nextError) {
      setActionMessage(
        nextError instanceof Error
          ? nextError.message
          : "Die Wiedervorlage konnte nicht gesetzt werden.",
      );
    }
  }

  const undoDelete = useUndoableDelete({
    onDeleted: (ticket) => {
      setTickets((current) => current.filter((item) => item.id !== ticket.id));
      setExtraTickets((current) =>
        current.filter((item) => item.id !== ticket.id),
      );
    },
    onFailed: (failure) => setActionMessage(failure),
  });

  function deleteTicket(ticket: MobileTicket) {
    setActionMessage("");
    undoDelete.schedule(ticket);
  }

  async function assignToMe(ticket: MobileTicket) {
    if (!favoriteState) return;
    setActionMessage("");
    try {
      await assignTicketToMe(ticket.id, favoriteState.userId);
      setTickets((current) =>
        current.map((item) =>
          item.id === ticket.id
            ? { ...item, assignedToCurrentUser: true, unassigned: false }
            : item,
        ),
      );
      setActionMessage(`«${ticket.ticketNumber}» wurde dir zugewiesen.`);
    } catch (nextError) {
      setActionMessage(
        nextError instanceof Error
          ? nextError.message
          : "Das Ticket konnte nicht zugewiesen werden.",
      );
    }
  }

  const activeBranding =
    branding && branding.tenantId === brandingTenantId ? branding.value : null;
  const configuredLogoUrl = activeBranding?.logoUrl ?? null;
  const customLogoUrl =
    configuredLogoUrl &&
    !(logoLoad?.url === configuredLogoUrl && logoLoad.failed)
      ? configuredLogoUrl
      : null;
  const brandName = activeBranding?.portalName ?? "nextDesk";
  const hasCustomName = Boolean(activeBranding?.portalName);
  // Nur anzeigen, was unter Einstellungen > Design hinterlegt ist: Logo und
  // Portalname. Ohne eigenes Logo bleibt "nextDesk" als Wortmarke bestehen.
  const showBrandText = hasCustomName || !customLogoUrl;

  useEffect(() => {
    if (!configuredLogoUrl) return;
    let active = true;
    Image.getSize(
      configuredLogoUrl,
      (logoWidth, logoHeight) => {
        if (active && logoWidth > 0 && logoHeight > 0)
          setLogoLoad({
            aspect: logoWidth / logoHeight,
            failed: false,
            url: configuredLogoUrl,
          });
      },
      () => {
        if (active)
          setLogoLoad({
            aspect: null,
            failed: true,
            url: configuredLogoUrl,
          });
      },
    );
    return () => {
      active = false;
    };
  }, [configuredLogoUrl]);
  const logoHeight = 30;
  const logoAspect =
    logoLoad?.url === configuredLogoUrl ? logoLoad.aspect : null;
  const logoWidth = logoAspect
    ? Math.min(Math.max(logoHeight * logoAspect, logoHeight), 104)
    : logoHeight;

  useFocusEffect(
    useCallback(() => {
      void loadSupplementaryData();
    }, [loadSupplementaryData]),
  );

  const focusTicketIds = useMemo(
    () =>
      isFocusScope(ticketScope)
        ? (visibleAgentMetrics?.ticketIds?.[ticketScope] ?? [])
        : ticketScope === "all"
          ? // Zuletzt geöffnete Tickets, die nicht in der Liste stehen, werden nachgeladen.
            recentTicketIds.slice(0, 5)
          : [],
    [recentTicketIds, ticketScope, visibleAgentMetrics],
  );
  const missingFocusIds = useMemo(() => {
    const known = new Set([
      ...tickets.map((ticket) => ticket.id),
      ...extraTickets.map((ticket) => ticket.id),
    ]);
    return focusTicketIds.filter(
      (id) => !known.has(id) && !attemptedFocusIds.has(id),
    );
  }, [attemptedFocusIds, extraTickets, focusTicketIds, tickets]);
  const focusLoading = missingFocusIds.length > 0;
  useEffect(() => {
    if (missingFocusIds.length === 0) return;
    const focusTenantId = tenantId;
    if (!focusTenantId) return;
    const focusEpoch = tenantEpoch.current;
    const key = `${focusEpoch}:${missingFocusIds.join(",")}`;
    if (focusLoadInFlight.current === key) return;
    focusLoadInFlight.current = key;
    const isFocusTenantCurrent = () =>
      dashboardTenant.current === focusTenantId &&
      tenantEpoch.current === focusEpoch;
    const markAttempted = () =>
      setAttemptedFocusIds((current) => {
        const next = new Set(current);
        missingFocusIds.forEach((id) => next.add(id));
        return next;
      });
    loadMobileTicketsByIds(missingFocusIds)
      .then((loaded) => {
        if (!isFocusTenantCurrent()) return;
        setExtraTickets((current) => {
          const ids = new Set(current.map((ticket) => ticket.id));
          return [
            ...current,
            ...loaded.filter((ticket) => !ids.has(ticket.id)),
          ];
        });
        markAttempted();
      })
      .catch(() => {
        // Nicht ladbare Tickets (z. B. offline) werden nicht angezeigt.
        if (!isFocusTenantCurrent()) return;
        markAttempted();
      })
      .finally(() => {
        if (focusLoadInFlight.current === key) focusLoadInFlight.current = "";
      });
  }, [missingFocusIds, tenantId]);
  const scopedTickets = (() => {
    if (isFocusScope(ticketScope)) {
      const byId = new Map(
        [...extraTickets, ...tickets].map((ticket) => [ticket.id, ticket]),
      );
      return focusTicketIds
        .map((id) => byId.get(id))
        .filter((ticket): ticket is MobileTicket => ticket !== undefined);
    }
    if (ticketScope === "all") {
      // Ohne Filter nur die fünf zuletzt geöffneten Tickets.
      const byId = new Map(
        [...extraTickets, ...tickets].map((ticket) => [ticket.id, ticket]),
      );
      return recentTicketIds
        .map((id) => byId.get(id))
        .filter((ticket): ticket is MobileTicket => ticket !== undefined)
        .slice(0, 5);
    }
    return tickets.filter((ticket) => {
      if (ticketScope === "mine") return ticket.assignedToCurrentUser;
      if (ticketScope === "open") return !ticket.resolved;
      if (ticketScope === "unassigned") return ticket.unassigned;
      return true;
    });
  })();
  const visibleTickets = scopedTickets.filter(
    (ticket) => !undoDelete.hiddenIds.has(ticket.id),
  );
  const canOpenFocus = Boolean(visibleAgentMetrics?.ticketIds);
  const selectFocusScope = (scope: FocusScope) => {
    if (ticketScope === scope) {
      setTicketScope("all");
      return;
    }
    setTicketScope(scope);
    scrollRef.current?.scrollTo({
      animated: true,
      y: Math.max(0, ticketListOffset.current - 12),
    });
  };
  const scopeCount = (scope: Exclude<TicketScope, "all">) => {
    if (
      ticketMetrics &&
      (scope === "mine" || scope === "open" || scope === "unassigned")
    ) {
      return ticketMetrics[scope];
    }
    return tickets.filter((ticket) => {
      if (scope === "mine") return ticket.assignedToCurrentUser;
      if (scope === "open") return !ticket.resolved;
      return ticket.unassigned;
    }).length;
  };
  const unreadMentions = visibleMentions.filter(
    (mention) => !mention.read_at,
  ).length;
  const recentMentions = [...visibleMentions]
    .sort((left, right) => right.created_at.localeCompare(left.created_at))
    .slice(0, 3);

  async function readMention(mention: AgentMention) {
    const mentionTenantId = tenantId;
    if (!mentionTenantId || mention.read_at || readingMentionId) return;
    const mentionEpoch = tenantEpoch.current;
    const isMentionTenantCurrent = () =>
      dashboardTenant.current === mentionTenantId &&
      tenantEpoch.current === mentionEpoch;
    setReadingMentionId(mention.id);
    setSupplementaryMessage("");
    try {
      const result = await markMentionRead(mention.id);
      if (!isMentionTenantCurrent()) return;
      setMentions((current) =>
        current.map((entry) =>
          entry.id === result.mention.id
            ? { ...entry, read_at: result.mention.read_at }
            : entry,
        ),
      );
    } catch (nextError) {
      if (!isMentionTenantCurrent()) return;
      if (isNextDeskPortalUnavailableError(nextError)) {
        setMentions([]);
        setMentionsAvailable(false);
      } else {
        setSupplementaryMessage(
          "Die Erwähnung konnte derzeit nicht aktualisiert werden.",
        );
      }
    } finally {
      if (isMentionTenantCurrent()) setReadingMentionId(null);
    }
  }

  if ((loading && !tenant) || tenantContextMismatch) {
    return (
      <ScreenContainer
        containerClassName="bg-background"
        className="px-5"
        style={{ backgroundColor: colors.background }}
      >
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={[styles.loadingText, tokenStyles.muted]}>
            {featureError
              ? "Der Arbeitsbereich konnte nicht sicher bestätigt werden."
              : "nextDesk wird geladen …"}
          </Text>
          {featureError ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => void refreshFeatures()}
              style={[
                styles.loadingRetry,
                { borderColor: colors.primarySoftBorder },
              ]}
            >
              <Text style={[styles.retryText, tokenStyles.primaryText]}>
                Erneut versuchen
              </Text>
            </Pressable>
          ) : null}
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
        ref={scrollRef}
        contentContainerStyle={[styles.content, isWide && styles.contentWide]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load();
              void loadSupplementaryData();
              if (brandingTenantId) void loadBranding(brandingTenantId);
            }}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View style={styles.headerBrand}>
            <View style={styles.brandRow}>
              {customLogoUrl ? (
                <Image
                  accessibilityLabel={`${brandName} Logo`}
                  onError={() =>
                    setLogoLoad({
                      aspect: null,
                      failed: true,
                      url: customLogoUrl,
                    })
                  }
                  resizeMode="contain"
                  source={{ uri: customLogoUrl }}
                  style={{ height: logoHeight, width: logoWidth }}
                />
              ) : (
                <Image
                  accessibilityLabel="nextDesk Logo"
                  source={require("@/assets/images/icon.png")}
                  style={styles.brandLogo}
                />
              )}
              {showBrandText ? (
                <Text
                  adjustsFontSizeToFit
                  minimumFontScale={0.8}
                  numberOfLines={hasCustomName ? 2 : 1}
                  style={[
                    styles.brand,
                    hasCustomName && styles.brandCustom,
                    tokenStyles.foreground,
                  ]}
                >
                  {brandName}
                </Text>
              ) : null}
            </View>
          </View>
          <Pressable
            accessibilityLabel="Persönliche Einstellungen öffnen"
            accessibilityRole="button"
            onPress={() => router.push("/settings")}
            style={[styles.avatar, { backgroundColor: colors.primarySoft }]}
          >
            <Ionicons
              color={colors.primaryText}
              name="person-circle-outline"
              size={23}
            />
          </Pressable>
        </View>

        <GlobalSearch
          key={tenantId ?? "kein-mandant"}
          platformName={brandName}
          tenant={tenant}
          tickets={tickets}
        />

        <IncidentBanner notices={visibleIncidentNotices} />

        <View style={[styles.hero, { backgroundColor: colors.primary }]}>
          <Text style={[styles.heroEyebrow, { color: colors.onPrimary }]}>
            HEUTE IM FOKUS
          </Text>
          {metricsAvailableForTenant && visibleAgentMetrics ? (
            <View style={styles.heroKpiRows}>
              <View style={styles.heroKpis}>
                <HeroKpi
                  disabled={!canOpenFocus}
                  label="Mir zugewiesen"
                  onPress={() => selectFocusScope("assigned")}
                  selected={ticketScope === "assigned"}
                  value={String(visibleAgentMetrics.open)}
                />
                <View
                  style={[
                    styles.heroKpiDivider,
                    { backgroundColor: colors.onPrimary },
                  ]}
                />
                <HeroKpi
                  disabled={!canOpenFocus}
                  label="Heute gelöst"
                  onPress={() => selectFocusScope("solvedToday")}
                  selected={ticketScope === "solvedToday"}
                  value={String(visibleAgentMetrics.solvedToday)}
                />
                <View
                  style={[
                    styles.heroKpiDivider,
                    { backgroundColor: colors.onPrimary },
                  ]}
                />
                <HeroKpi
                  disabled={
                    !canOpenFocus || !visibleAgentMetrics.ticketIds?.slaDue
                  }
                  label="Fällig"
                  onPress={() => selectFocusScope("slaDue")}
                  selected={ticketScope === "slaDue"}
                  value={
                    visibleAgentMetrics.slaDue === undefined
                      ? "—"
                      : String(visibleAgentMetrics.slaDue)
                  }
                />
              </View>
              <View style={styles.heroKpis}>
                <HeroKpi
                  disabled={!canOpenFocus}
                  label="Erste Antwort (Median)"
                  onPress={() => selectFocusScope("firstResponse")}
                  selected={ticketScope === "firstResponse"}
                  value={formatDuration(
                    visibleAgentMetrics.medianFirstResponseMinutes,
                  )}
                />
                <View
                  style={[
                    styles.heroKpiDivider,
                    { backgroundColor: colors.onPrimary },
                  ]}
                />
                <HeroKpi
                  disabled={
                    !canOpenFocus || !visibleAgentMetrics.ticketIds?.resolution
                  }
                  label="Lösungszeit (Median)"
                  onPress={() => selectFocusScope("resolution")}
                  selected={ticketScope === "resolution"}
                  value={formatDuration(
                    visibleAgentMetrics.medianResolutionMinutes,
                  )}
                />
              </View>
            </View>
          ) : (
            <>
              <Text style={[styles.heroTitle, { color: colors.onPrimary }]}>
                Alles im Blick.
              </Text>
              <Text style={[styles.heroBody, { color: colors.onPrimary }]}>
                Bearbeite Tickets schnell, klar und von überall.
              </Text>
            </>
          )}
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push("/ticket/new")}
            style={[styles.heroButton, { backgroundColor: colors.surface }]}
          >
            <Ionicons color={colors.primaryText} name="add" size={21} />
            <Text
              style={[styles.heroButtonText, { color: colors.primaryText }]}
            >
              Ticket erfassen
            </Text>
          </Pressable>
        </View>

        {error ? (
          <View
            accessibilityRole="alert"
            style={[
              styles.errorBox,
              {
                backgroundColor: colors.errorSoft,
                borderColor: colors.errorBorder,
              },
            ]}
          >
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
              <Text style={[styles.retryText, tokenStyles.primaryText]}>
                Erneut versuchen
              </Text>
            </Pressable>
          </View>
        ) : null}

        {supplementaryMessage ? (
          <View
            accessibilityLiveRegion="polite"
            style={[
              styles.supplementaryMessage,
              {
                backgroundColor: colors.warningSoft,
                borderColor: colors.warningBorder,
              },
            ]}
          >
            <Ionicons
              color={colors.warning}
              name="information-circle-outline"
              size={18}
            />
            <Text
              style={[styles.supplementaryMessageText, tokenStyles.foreground]}
            >
              {supplementaryMessage}
            </Text>
          </View>
        ) : null}

        <Text style={[styles.sectionEyebrow, tokenStyles.muted]}>
          ÜBERSICHT
        </Text>
        <View style={styles.metrics}>
          <Metric
            color={colors.primaryText}
            icon="person-outline"
            label="Meine Tickets"
            onPress={() => setTicketScope("mine")}
            selected={ticketScope === "mine"}
            value={String(scopeCount("mine"))}
          />
          <Metric
            color={colors.primaryText}
            icon="time-outline"
            label="Offen"
            onPress={() => setTicketScope("open")}
            selected={ticketScope === "open"}
            value={String(scopeCount("open"))}
          />
          <Metric
            color={colors.warning}
            icon="person-add-outline"
            label="Nicht zugewiesen"
            onPress={() => setTicketScope("unassigned")}
            selected={ticketScope === "unassigned"}
            value={String(scopeCount("unassigned"))}
          />
        </View>

        <View
          onLayout={(event) => {
            ticketListOffset.current = event.nativeEvent.layout.y;
          }}
          style={styles.sectionHeader}
        >
          <View>
            <Text style={[styles.sectionTitle, tokenStyles.foreground]}>
              {ticketScope === "all"
                ? "Zuletzt geöffnet"
                : ticketScopeLabels[ticketScope]}
            </Text>
            <Text style={[styles.sectionSub, tokenStyles.muted]}>
              {ticketScope === "all"
                ? "Die fünf Tickets, die du zuletzt geöffnet hast"
                : focusLoading
                  ? "Passende Tickets werden geladen …"
                  : ticketScope === "resolution"
                    ? `${visibleTickets.length} Tickets · Grundlage deiner Lösungszeit`
                    : ticketScope === "firstResponse"
                      ? `${visibleTickets.length} Tickets · Grundlage der ersten Antwortzeit`
                      : `${visibleTickets.length} passende Vorgänge`}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              ticketScope === "all"
                ? router.push("/(tabs)/tickets")
                : setTicketScope("all")
            }
          >
            <Text style={[styles.all, tokenStyles.primaryText]}>
              {ticketScope === "all" ? "Alle" : "Filter zurücksetzen"}
            </Text>
          </Pressable>
        </View>

        {actionMessage ? (
          <Text
            accessibilityLiveRegion="polite"
            style={[styles.sectionSub, tokenStyles.muted]}
          >
            {actionMessage}
          </Text>
        ) : null}
        {visibleTickets.length === 0 ? (
          <View style={[styles.emptyList, tokenStyles.card]}>
            <Text style={[styles.emptyText, tokenStyles.muted]}>
              {ticketScope === "all"
                ? "Du hast noch kein Ticket geöffnet."
                : "Keine passenden Tickets vorhanden."}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                ticketScope === "all"
                  ? router.push("/(tabs)/tickets")
                  : setTicketScope("all")
              }
              style={[styles.emptyAction, { borderColor: colors.border }]}
            >
              <Text style={[styles.all, tokenStyles.primaryText]}>
                {ticketScope === "all"
                  ? "Alle Tickets ansehen"
                  : "Filter zurücksetzen"}
              </Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.list}>
            {visibleTickets
              .slice(0, isFocusScope(ticketScope) ? 100 : 10)
              .map((ticket) => (
                <TicketSwipeActions
                  canAssign={
                    !isOffline &&
                    !checkingFeatures &&
                    favoriteState?.tenantId === tenantId &&
                    !ticket.assignedToCurrentUser
                  }
                  canDelete={!isOffline && !checkingFeatures}
                  onAssign={() => void assignToMe(ticket)}
                  canFavorite={favoriteState?.tenantId === tenantId}
                  canFollowUp={
                    workspaceEnabled && !isOffline && !checkingFeatures
                  }
                  enabled
                  favorite={favoriteIds.includes(ticket.id)}
                  key={ticket.id}
                  onDelete={() => deleteTicket(ticket)}
                  onFavorite={() => void toggleFavorite(ticket)}
                  onFollowUp={() => void createFollowUp(ticket)}
                >
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{
                      disabled: checkingFeatures || !ticketDetailsEnabled,
                    }}
                    disabled={checkingFeatures || !ticketDetailsEnabled}
                    onPress={() =>
                      router.push({
                        pathname: "/ticket/[id]",
                        params: { id: ticket.id },
                      })
                    }
                    style={[
                      styles.ticket,
                      tokenStyles.card,
                      (checkingFeatures || !ticketDetailsEnabled) &&
                        styles.ticketDisabled,
                    ]}
                  >
                    <View
                      style={[
                        styles.ticketMark,
                        {
                          backgroundColor: ticket.resolved
                            ? colors.success
                            : colors.primary,
                        },
                      ]}
                    />
                    <View style={styles.ticketContent}>
                      <Text style={[styles.ticketId, tokenStyles.muted]}>
                        {ticket.ticketNumber}
                      </Text>
                      <Text
                        numberOfLines={1}
                        style={[styles.ticketTitle, tokenStyles.foreground]}
                      >
                        {ticket.subject}
                      </Text>
                      <TicketPriorityText priority={ticket.priority} />
                    </View>
                    <View style={styles.ticketRight}>
                      <TicketStatusBadge ticket={ticket} />
                      <Ionicons
                        color={colors.subtle}
                        name="chevron-forward"
                        size={18}
                      />
                    </View>
                  </Pressable>
                </TicketSwipeActions>
              ))}
            {visibleTickets.length > 10 ? (
              <Pressable
                accessibilityLabel={`Alle ${visibleTickets.length} Tickets anzeigen`}
                accessibilityRole="button"
                onPress={() => router.push("/(tabs)/tickets")}
                style={[
                  styles.showAllTickets,
                  { borderColor: colors.primarySoftBorder },
                ]}
              >
                <Text
                  style={[styles.showAllTicketsText, tokenStyles.primaryText]}
                >
                  Alle {visibleTickets.length} Tickets anzeigen
                </Text>
                <Ionicons
                  color={colors.primaryText}
                  name="arrow-forward"
                  size={17}
                />
              </Pressable>
            ) : null}
          </View>
        )}

        <View
          style={[styles.auxiliaryGrid, isWide && styles.auxiliaryGridWide]}
        >
          <View style={styles.auxiliaryColumn}>
            <ApprovalInboxCard
              tenantId={tenantContextMismatch ? null : tenantId}
            />
            {mentionsAvailableForTenant ? (
              <View
                style={[
                  styles.card,
                  tokenStyles.card,
                  { padding: cardPadding },
                ]}
              >
                <View style={styles.cardHeadingRow}>
                  <SectionTitle
                    icon="at-outline"
                    title="Erwähnungen"
                    subtitle={
                      unreadMentions === 1
                        ? "1 ungelesene Erwähnung"
                        : `${unreadMentions} ungelesene Erwähnungen`
                    }
                  />
                  <Text
                    accessibilityLabel={`${unreadMentions} ungelesene Erwähnungen`}
                    style={[
                      styles.countBadge,
                      {
                        backgroundColor: colors.primarySoft,
                        color: colors.primaryText,
                      },
                    ]}
                  >
                    {unreadMentions}
                  </Text>
                </View>
                {recentMentions.length === 0 ? (
                  <Text style={[styles.emptyCardText, tokenStyles.muted]}>
                    Keine Erwähnungen vorhanden.
                  </Text>
                ) : (
                  <View style={styles.compactList}>
                    {recentMentions.map((mention) => (
                      <View
                        key={mention.id}
                        style={[
                          styles.compactListRow,
                          { borderColor: colors.border },
                        ]}
                      >
                        <View style={styles.compactListCopy}>
                          <Text
                            style={[
                              styles.compactListTitle,
                              tokenStyles.foreground,
                            ]}
                          >
                            Ticket-Erwähnung
                          </Text>
                          <Text
                            style={[styles.compactListMeta, tokenStyles.muted]}
                          >
                            {formatDateTime(mention.created_at)} ·{" "}
                            {mention.read_at ? "Gelesen" : "Neu"}
                          </Text>
                        </View>
                        {!mention.read_at ? (
                          <Pressable
                            accessibilityLabel="Erwähnung als gelesen markieren"
                            accessibilityRole="button"
                            accessibilityState={{
                              busy: readingMentionId === mention.id,
                            }}
                            disabled={readingMentionId !== null}
                            onPress={() => void readMention(mention)}
                            style={[
                              styles.compactAction,
                              { borderColor: colors.primarySoftBorder },
                            ]}
                          >
                            <Text
                              style={[
                                styles.compactActionText,
                                tokenStyles.primaryText,
                              ]}
                            >
                              {readingMentionId === mention.id
                                ? "…"
                                : "Gelesen"}
                            </Text>
                          </Pressable>
                        ) : null}
                      </View>
                    ))}
                  </View>
                )}
              </View>
            ) : null}
          </View>

          <View style={styles.auxiliaryColumn}>
            {approvalsAvailableForTenant ? (
              <View
                style={[
                  styles.card,
                  tokenStyles.card,
                  { padding: cardPadding },
                ]}
              >
                <SectionTitle
                  icon="checkbox-outline"
                  title="Meine Freigabeanfragen"
                  subtitle={`${visibleApprovals.length} offene Anfrage${visibleApprovals.length === 1 ? "" : "n"}`}
                />
                {visibleApprovals.length === 0 ? (
                  <Text style={[styles.emptyCardText, tokenStyles.muted]}>
                    Keine offenen Freigaben.
                  </Text>
                ) : (
                  <View style={styles.compactList}>
                    {visibleApprovals.slice(0, 3).map((approval) => (
                      <Pressable
                        accessibilityHint="Öffnet das zugehörige Ticket"
                        accessibilityRole="button"
                        accessibilityState={{
                          disabled: checkingFeatures || !ticketDetailsEnabled,
                        }}
                        disabled={checkingFeatures || !ticketDetailsEnabled}
                        key={approval.id}
                        onPress={() =>
                          router.push({
                            pathname: "/ticket/[id]",
                            params: { id: approval.ticket_id },
                          })
                        }
                        style={[
                          styles.compactListRow,
                          { borderColor: colors.border },
                        ]}
                      >
                        <View style={styles.compactListCopy}>
                          <Text
                            numberOfLines={1}
                            style={[
                              styles.compactListTitle,
                              tokenStyles.foreground,
                            ]}
                          >
                            {approval.approval_kind}
                          </Text>
                          <Text
                            numberOfLines={1}
                            style={[styles.compactListMeta, tokenStyles.muted]}
                          >
                            {firstReason(approval.reason)}
                          </Text>
                        </View>
                        <Text
                          style={[styles.compactListMeta, tokenStyles.muted]}
                        >
                          {approval.required_approvals} nötig
                        </Text>
                        <Ionicons
                          color={colors.subtle}
                          name="chevron-forward"
                          size={16}
                        />
                      </Pressable>
                    ))}
                  </View>
                )}
              </View>
            ) : null}
            {devicesAvailableForTenant && !agentWorkbenchEnabled ? (
              <View
                style={[
                  styles.card,
                  tokenStyles.card,
                  { padding: cardPadding },
                ]}
              >
                <SectionTitle
                  icon="hardware-chip-outline"
                  title="Meine Geräte"
                  subtitle={`${visibleDevices.length} zugeordnet`}
                />
                {visibleDevices.length === 0 ? (
                  <Text style={[styles.emptyCardText, tokenStyles.muted]}>
                    Derzeit sind keine Geräte zugeordnet.
                  </Text>
                ) : (
                  <View style={styles.compactList}>
                    {visibleDevices.slice(0, 3).map((device, index) => {
                      const detail = compactDeviceDetail(device);
                      return (
                        <View
                          key={
                            typeof device.id === "string"
                              ? device.id
                              : `device-${index}`
                          }
                          style={[
                            styles.compactListRow,
                            { borderColor: colors.border },
                          ]}
                        >
                          <Ionicons
                            color={colors.primary}
                            name="laptop-outline"
                            size={18}
                          />
                          <View style={styles.compactListCopy}>
                            <Text
                              numberOfLines={1}
                              style={[
                                styles.compactListTitle,
                                tokenStyles.foreground,
                              ]}
                            >
                              {compactDeviceName(device, index)}
                            </Text>
                            {detail ? (
                              <Text
                                numberOfLines={1}
                                style={[
                                  styles.compactListMeta,
                                  tokenStyles.muted,
                                ]}
                              >
                                {detail}
                              </Text>
                            ) : null}
                          </View>
                        </View>
                      );
                    })}
                  </View>
                )}
              </View>
            ) : null}
          </View>
        </View>
      </ScrollView>
      {undoDelete.lastDeleted ? (
        <UndoToast
          message={`«${undoDelete.lastDeleted.ticketNumber}» gelöscht`}
          onUndo={() => undoDelete.undo(undoDelete.lastDeleted!)}
        />
      ) : null}
    </ScreenContainer>
  );
}

function SectionTitle({
  icon,
  subtitle,
  title,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  subtitle: string;
  title: string;
}) {
  const colors = useAppColors();
  const styles = useStyles();
  return (
    <View style={styles.sectionTitleRow}>
      <View
        style={[styles.sectionIcon, { backgroundColor: colors.primarySoft }]}
      >
        <Ionicons color={colors.primaryText} name={icon} size={18} />
      </View>
      <View style={styles.sectionTitleCopy}>
        <Text style={[styles.cardTitle, { color: colors.foreground }]}>
          {title}
        </Text>
        <Text style={[styles.cardSubtitle, { color: colors.muted }]}>
          {subtitle}
        </Text>
      </View>
    </View>
  );
}

function HeroKpi({
  disabled,
  label,
  onPress,
  selected,
  value,
}: {
  disabled: boolean;
  label: string;
  onPress: () => void;
  selected: boolean;
  value: string;
}) {
  const colors = useAppColors();
  const styles = useStyles();
  return (
    <Pressable
      accessibilityHint={
        disabled ? undefined : "Zeigt die passenden Tickets in der Liste."
      }
      accessibilityLabel={`${label}: ${value}`}
      accessibilityRole="button"
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [
        styles.heroKpi,
        pressed && styles.heroKpiPressed,
      ]}
    >
      {selected ? (
        <View
          pointerEvents="none"
          style={[
            styles.heroKpiHighlight,
            { backgroundColor: colors.onPrimary },
          ]}
        />
      ) : null}
      <Text
        numberOfLines={1}
        style={[styles.heroKpiValue, { color: colors.onPrimary }]}
      >
        {value}
      </Text>
      <Text
        numberOfLines={2}
        style={[
          styles.heroKpiLabel,
          { color: colors.onPrimary },
          selected && styles.heroKpiLabelSelected,
        ]}
      >
        {label}
      </Text>
    </Pressable>
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
  const colors = useAppColors();
  const styles = useStyles();
  return (
    <Pressable
      accessibilityLabel={`${label}: ${value} Tickets anzeigen`}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[
        styles.metric,
        { backgroundColor: colors.surface, borderColor: colors.border },
        selected && {
          backgroundColor:
            color === colors.success ? colors.successSoft : colors.primarySoft,
          borderColor:
            color === colors.success
              ? colors.successBorder
              : colors.primarySoftBorder,
        },
      ]}
    >
      <Ionicons color={color} name={icon} size={19} />
      <Text style={[styles.metricValue, { color: colors.foreground }]}>
        {value}
      </Text>
      <Text style={[styles.metricLabel, { color: colors.muted }]}>{label}</Text>
    </Pressable>
  );
}

const useStyles = makeThemedStyles(() => ({
  all: { fontSize: 14, fontWeight: "800" },
  auxiliaryColumn: { flex: 1, gap: 14, minWidth: 0 },
  auxiliaryGrid: { gap: 14 },
  auxiliaryGridWide: { flexDirection: "row" },
  avatar: {
    alignItems: "center",
    borderRadius: 21,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  brand: {
    flexShrink: 1,
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: -0.8,
  },
  brandCustom: { fontSize: 22, letterSpacing: -0.5, lineHeight: 26 },
  brandLogo: { height: 27, width: 27 },
  brandRow: { alignItems: "center", flexDirection: "row", gap: 8 },
  card: { borderRadius: 18, borderWidth: 1, gap: 14 },
  cardHeadingRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between",
  },
  cardSubtitle: { fontSize: 11, lineHeight: 16, marginTop: 2 },
  cardTitle: { fontSize: 16, fontWeight: "900" },
  centered: {
    alignItems: "center",
    flex: 1,
    gap: 14,
    justifyContent: "center",
  },
  compactAction: {
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 7,
  },
  compactActionText: { fontSize: 11, fontWeight: "900" },
  compactList: { gap: 1 },
  compactListCopy: { flex: 1, minWidth: 0 },
  compactListMeta: { fontSize: 11, lineHeight: 16 },
  compactListRow: {
    alignItems: "center",
    borderTopWidth: 1,
    flexDirection: "row",
    gap: 10,
    paddingTop: 10,
  },
  compactListTitle: { fontSize: 13, fontWeight: "800", lineHeight: 18 },
  content: {
    alignSelf: "center",
    gap: 18,
    paddingBottom: 32,
    paddingTop: 16,
    width: "100%",
  },
  contentWide: { maxWidth: 1_120 },
  countBadge: {
    alignSelf: "flex-start",
    borderRadius: 10,
    flexShrink: 0,
    fontSize: 12,
    fontWeight: "900",
    minWidth: 28,
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 4,
    textAlign: "center",
  },
  emptyCardText: { fontSize: 13, lineHeight: 19 },
  emptyAction: {
    alignItems: "center",
    alignSelf: "flex-start",
    borderRadius: 12,
    borderWidth: 1,
    minHeight: 40,
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  emptyList: { borderRadius: 18, borderWidth: 1, padding: 18 },
  emptyText: { fontSize: 13, textAlign: "center" },
  errorBox: { borderRadius: 14, borderWidth: 1, gap: 7, padding: 13 },
  errorText: { fontSize: 13, lineHeight: 18 },
  header: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  headerBrand: { flex: 1, marginRight: 12 },
  hero: { borderRadius: 26, gap: 9, padding: 22 },
  heroBody: { fontSize: 15, lineHeight: 21, opacity: 0.86 },
  heroButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    borderRadius: 14,
    flexDirection: "row",
    gap: 7,
    marginTop: 6,
    paddingHorizontal: 15,
    paddingVertical: 11,
  },
  heroButtonText: { fontSize: 14, fontWeight: "800" },
  heroEyebrow: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.3,
    opacity: 0.86,
  },
  heroKpi: {
    flex: 1,
    gap: 4,
    minWidth: 0,
    paddingHorizontal: 7,
    paddingVertical: 6,
  },
  heroKpiHighlight: {
    borderRadius: 12,
    bottom: 0,
    left: 2,
    opacity: 0.18,
    position: "absolute",
    right: 2,
    top: 0,
  },
  heroKpiLabelSelected: { opacity: 1 },
  heroKpiPressed: { opacity: 0.7 },
  heroKpiDivider: { opacity: 0.28, width: 1 },
  heroKpiLabel: {
    fontSize: 10,
    fontWeight: "700",
    lineHeight: 13,
    opacity: 0.76,
  },
  heroKpiRows: { gap: 12 },
  heroKpis: {
    alignItems: "stretch",
    flexDirection: "row",
    marginHorizontal: -7,
  },
  heroKpiValue: { fontSize: 18, fontWeight: "900", letterSpacing: -0.3 },
  heroTitle: { fontSize: 27, fontWeight: "800", letterSpacing: -0.5 },
  list: { gap: 9 },
  loadingText: { fontSize: 14 },
  loadingRetry: {
    borderRadius: 12,
    borderWidth: 1,
    minHeight: 40,
    paddingHorizontal: 14,
    justifyContent: "center",
  },
  metric: { borderRadius: 18, borderWidth: 1, flex: 1, gap: 4, padding: 13 },
  metricLabel: { fontSize: 11, fontWeight: "600" },
  metricValue: { fontSize: 22, fontWeight: "800", marginTop: 2 },
  metrics: { flexDirection: "row", gap: 10 },
  retryText: { fontSize: 13, fontWeight: "800" },
  sectionEyebrow: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.1,
    marginTop: 6,
  },
  sectionHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 8,
  },
  sectionIcon: {
    alignItems: "center",
    borderRadius: 12,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  sectionSub: { fontSize: 12, marginTop: 3 },
  sectionTitle: { fontSize: 19, fontWeight: "800" },
  sectionTitleCopy: { flex: 1, minWidth: 0 },
  sectionTitleRow: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: 9,
    minWidth: 0,
  },
  showAllTickets: {
    alignItems: "center",
    alignSelf: "center",
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    marginTop: 3,
    paddingHorizontal: 13,
    paddingVertical: 10,
  },
  showAllTicketsText: { fontSize: 13, fontWeight: "800" },
  status: {
    alignItems: "center",
    borderRadius: 8,
    flexDirection: "row",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  supplementaryMessage: {
    alignItems: "flex-start",
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    padding: 12,
  },
  supplementaryMessageText: { flex: 1, fontSize: 12, lineHeight: 18 },
  ticket: {
    alignItems: "center",
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: "row",
    gap: 11,
    padding: 14,
  },
  ticketContent: { flex: 1, gap: 2 },
  ticketDisabled: { opacity: 0.55 },
  ticketId: { fontSize: 10, fontWeight: "800", letterSpacing: 0.5 },
  ticketMark: { borderRadius: 2, height: 43, width: 4 },
  ticketMeta: { fontSize: 11 },
  ticketRight: { alignItems: "flex-end", gap: 7 },
  ticketTitle: { fontSize: 14, fontWeight: "800" },
}));
