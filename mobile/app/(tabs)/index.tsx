import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

import { FollowUpsSection } from "@/components/follow-ups-section";
import { GlobalSearch } from "@/components/global-search";
import { IncidentBanner } from "@/components/incident-banner";
import { useMobileFeatures } from "@/components/mobile-feature-gate";
import { useMobileNetworkStatus } from "@/components/offline-status";
import { ScreenContainer } from "@/components/screen-container";
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
  isNextDeskConfigured,
  nextDesk,
  type MobileTenant,
} from "@/lib/nextdesk-client";
import { loadMobileDashboard, type MobileTicket } from "@/lib/nextdesk-tickets";
import { useThemeContext } from "@/lib/theme-provider";

type TicketScope = "all" | "mine" | "open" | "resolved";

const ticketScopeLabels: Record<Exclude<TicketScope, "all">, string> = {
  mine: "Meine Tickets",
  open: "Offene Tickets",
  resolved: "Gelöste Tickets",
};

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

export default function HomeScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { recoveryEpoch } = useMobileNetworkStatus();
  const {
    isEnabled,
    loading: checkingFeatures,
    tenantId: featureTenantId,
  } = useMobileFeatures();
  const ticketDetailsEnabled = isEnabled("ticketing.detail");
  const agentWorkbenchEnabled = isEnabled("agent.workbench");
  const requesterPortalEnabled = isEnabled("requester.portal");
  const { colors, density } = useThemeContext();
  const [tenant, setTenant] = useState<MobileTenant | null>(null);
  const [tickets, setTickets] = useState<MobileTicket[]>([]);
  const [ticketScope, setTicketScope] = useState<TicketScope>("all");
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
  const [readingMentionId, setReadingMentionId] = useState<string | null>(null);
  const [supplementaryMessage, setSupplementaryMessage] = useState("");
  const dashboardRequest = useRef(0);
  const supplementaryRequest = useRef(0);
  const isWide = width >= 760;
  const cardPadding = density === "compact" ? 14 : 17;
  const tokenStyles = useMemo(
    () => ({
      card: { backgroundColor: colors.surface, borderColor: colors.border },
      foreground: { color: colors.foreground },
      muted: { color: colors.muted },
      primaryText: { color: colors.primary },
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
      setTenant(result.tenant);
      setTickets(result.tickets);
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

  useFocusEffect(
    useCallback(() => {
      void loadSupplementaryData();
    }, [loadSupplementaryData]),
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
  const unreadMentions = mentions.filter((mention) => !mention.read_at).length;
  const recentMentions = [...mentions]
    .sort((left, right) => right.created_at.localeCompare(left.created_at))
    .slice(0, 3);

  async function readMention(mention: AgentMention) {
    if (mention.read_at || readingMentionId) return;
    setReadingMentionId(mention.id);
    setSupplementaryMessage("");
    try {
      const result = await markMentionRead(mention.id);
      setMentions((current) =>
        current.map((entry) =>
          entry.id === result.mention.id
            ? { ...entry, read_at: result.mention.read_at }
            : entry,
        ),
      );
    } catch (nextError) {
      if (isNextDeskPortalUnavailableError(nextError)) {
        setMentions([]);
        setMentionsAvailable(false);
      } else {
        setSupplementaryMessage(
          "Die Erwähnung konnte derzeit nicht aktualisiert werden.",
        );
      }
    } finally {
      setReadingMentionId(null);
    }
  }

  if (loading && !tenant) {
    return (
      <ScreenContainer
        containerClassName="bg-background"
        className="px-5"
        style={{ backgroundColor: colors.background }}
      >
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={[styles.loadingText, tokenStyles.muted]}>
            nextDesk wird geladen …
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
        contentContainerStyle={[styles.content, isWide && styles.contentWide]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load();
              void loadSupplementaryData();
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
              <Text style={[styles.brand, tokenStyles.foreground]}>
                nextDesk
              </Text>
            </View>
            <Text style={[styles.greeting, tokenStyles.muted]}>
              {tenant?.name ?? "Dein Arbeitsbereich"}
            </Text>
          </View>
          <Pressable
            accessibilityLabel="Persönliche Einstellungen öffnen"
            accessibilityRole="button"
            onPress={() => router.push("/settings")}
            style={[styles.avatar, { backgroundColor: colors.primary + "1A" }]}
          >
            <Ionicons
              color={colors.primary}
              name="person-circle-outline"
              size={23}
            />
          </Pressable>
        </View>

        <GlobalSearch tenant={tenant} tickets={tickets} />

        <IncidentBanner notices={incidentNotices} />

        <View style={[styles.hero, { backgroundColor: colors.primary }]}>
          <Text style={[styles.heroEyebrow, { color: colors.background }]}>
            HEUTE IM FOKUS
          </Text>
          <Text style={[styles.heroTitle, { color: colors.background }]}>
            Alles im Blick.
          </Text>
          <Text style={[styles.heroBody, { color: colors.background }]}>
            Bearbeite Tickets schnell, klar und von überall.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push("/ticket/new")}
            style={[styles.heroButton, { backgroundColor: colors.surface }]}
          >
            <Ionicons color={colors.primary} name="add" size={21} />
            <Text style={[styles.heroButtonText, { color: colors.primary }]}>
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
                backgroundColor: colors.error + "1A",
                borderColor: colors.error,
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
                backgroundColor: colors.warning + "1A",
                borderColor: colors.warning,
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
            color={colors.primary}
            icon="person-outline"
            label="Meine Tickets"
            onPress={() => setTicketScope("mine")}
            selected={ticketScope === "mine"}
            value={String(scopeCount("mine"))}
          />
          <Metric
            color={colors.primary}
            icon="time-outline"
            label="Offen"
            onPress={() => setTicketScope("open")}
            selected={ticketScope === "open"}
            value={String(scopeCount("open"))}
          />
          <Metric
            color={colors.success}
            icon="checkmark-circle-outline"
            label="Gelöst"
            onPress={() => setTicketScope("resolved")}
            selected={ticketScope === "resolved"}
            value={String(scopeCount("resolved"))}
          />
        </View>

        <View
          style={[styles.auxiliaryGrid, isWide && styles.auxiliaryGridWide]}
        >
          <View style={styles.auxiliaryColumn}>
            <FollowUpsSection />
            {metricsAvailable && agentMetrics ? (
              <View
                style={[
                  styles.card,
                  tokenStyles.card,
                  { padding: cardPadding },
                ]}
              >
                <SectionTitle
                  icon="speedometer-outline"
                  title="Meine Kennzahlen"
                  subtitle="Aktuelle persönliche Bearbeitung"
                />
                <View style={styles.agentMetricsGrid}>
                  <MiniMetric label="Offen" value={String(agentMetrics.open)} />
                  <MiniMetric
                    label="Heute gelöst"
                    value={String(agentMetrics.solvedToday)}
                  />
                  <MiniMetric
                    label="Erste Antwort"
                    value={
                      agentMetrics.medianFirstResponseMinutes === null
                        ? "—"
                        : `${agentMetrics.medianFirstResponseMinutes} Min.`
                    }
                  />
                  <MiniMetric
                    label="Fällig"
                    value={String(agentMetrics.dueFollowUps)}
                  />
                </View>
              </View>
            ) : null}
            {mentionsAvailable ? (
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
                        backgroundColor: colors.primary + "1A",
                        color: colors.primary,
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
                              { borderColor: colors.primary + "66" },
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
            {approvalsAvailable ? (
              <View
                style={[
                  styles.card,
                  tokenStyles.card,
                  { padding: cardPadding },
                ]}
              >
                <SectionTitle
                  icon="checkbox-outline"
                  title="Freigabe-Eingang"
                  subtitle={`${approvals.length} offene Anfrage${approvals.length === 1 ? "" : "n"}`}
                />
                {approvals.length === 0 ? (
                  <Text style={[styles.emptyCardText, tokenStyles.muted]}>
                    Keine offenen Freigaben.
                  </Text>
                ) : (
                  <View style={styles.compactList}>
                    {approvals.slice(0, 3).map((approval) => (
                      <View
                        key={approval.id}
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
                      </View>
                    ))}
                  </View>
                )}
              </View>
            ) : null}
            {devicesAvailable ? (
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
                  subtitle={`${devices.length} zugeordnet`}
                />
                {devices.length === 0 ? (
                  <Text style={[styles.emptyCardText, tokenStyles.muted]}>
                    Derzeit sind keine Geräte zugeordnet.
                  </Text>
                ) : (
                  <View style={styles.compactList}>
                    {devices.slice(0, 3).map((device, index) => {
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

        <View style={styles.sectionHeader}>
          <View>
            <Text style={[styles.sectionTitle, tokenStyles.foreground]}>
              {ticketScope === "all"
                ? "Aktuelle Tickets"
                : ticketScopeLabels[ticketScope]}
            </Text>
            <Text style={[styles.sectionSub, tokenStyles.muted]}>
              {ticketScope === "all"
                ? "Deine zuletzt bearbeiteten Vorgänge"
                : `${visibleTickets.length} passende Vorgänge`}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => setTicketScope("all")}
          >
            <Text style={[styles.all, tokenStyles.primaryText]}>
              {ticketScope === "all" ? "Alle" : "Filter zurücksetzen"}
            </Text>
          </Pressable>
        </View>

        {visibleTickets.length === 0 ? (
          <View style={[styles.emptyList, tokenStyles.card]}>
            <Text style={[styles.emptyText, tokenStyles.muted]}>
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
                  <Text style={[styles.ticketMeta, tokenStyles.muted]}>
                    {ticket.priority}
                  </Text>
                </View>
                <View style={styles.ticketRight}>
                  <View
                    accessibilityLabel={`Status: ${ticket.status}`}
                    style={[
                      styles.status,
                      {
                        backgroundColor: ticket.resolved
                          ? colors.success + "1A"
                          : colors.primary + "1A",
                      },
                    ]}
                  >
                    <Ionicons
                      color={ticket.resolved ? colors.success : colors.primary}
                      name={
                        ticket.resolved
                          ? "checkmark-circle-outline"
                          : "time-outline"
                      }
                      size={13}
                    />
                    <Text
                      style={{
                        color: ticket.resolved
                          ? colors.success
                          : colors.primary,
                        fontSize: 10,
                        fontWeight: "800",
                      }}
                    >
                      {ticket.status}
                    </Text>
                  </View>
                  <Ionicons
                    color={colors.muted}
                    name="chevron-forward"
                    size={18}
                  />
                </View>
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>
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
  const { colors } = useThemeContext();
  return (
    <View style={styles.sectionTitleRow}>
      <View
        style={[styles.sectionIcon, { backgroundColor: colors.primary + "1A" }]}
      >
        <Ionicons color={colors.primary} name={icon} size={18} />
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

function MiniMetric({ label, value }: { label: string; value: string }) {
  const { colors } = useThemeContext();
  return (
    <View style={[styles.miniMetric, { backgroundColor: colors.background }]}>
      <Text style={[styles.miniMetricValue, { color: colors.foreground }]}>
        {value}
      </Text>
      <Text style={[styles.miniMetricLabel, { color: colors.muted }]}>
        {label}
      </Text>
    </View>
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
  const { colors } = useThemeContext();
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
          backgroundColor: color + "12",
          borderColor: color + "88",
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

const styles = StyleSheet.create({
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
  brand: { fontSize: 28, fontWeight: "800", letterSpacing: -0.8 },
  brandLogo: { height: 27, width: 27 },
  brandRow: { alignItems: "center", flexDirection: "row", gap: 7 },
  card: { borderRadius: 18, borderWidth: 1, gap: 14 },
  cardHeadingRow: {
    alignItems: "flex-start",
    flexDirection: "row",
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
    borderRadius: 10,
    fontSize: 12,
    fontWeight: "900",
    minWidth: 28,
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 4,
    textAlign: "center",
  },
  emptyCardText: { fontSize: 13, lineHeight: 19 },
  emptyList: { borderRadius: 18, borderWidth: 1, padding: 18 },
  emptyText: { fontSize: 13, textAlign: "center" },
  errorBox: { borderRadius: 14, borderWidth: 1, gap: 7, padding: 13 },
  errorText: { fontSize: 13, lineHeight: 18 },
  greeting: { fontSize: 13, marginTop: 2 },
  header: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
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
  heroTitle: { fontSize: 27, fontWeight: "800", letterSpacing: -0.5 },
  list: { gap: 9 },
  loadingText: { fontSize: 14 },
  metric: { borderRadius: 18, borderWidth: 1, flex: 1, gap: 4, padding: 13 },
  metricLabel: { fontSize: 11, fontWeight: "600" },
  metricValue: { fontSize: 22, fontWeight: "800", marginTop: 2 },
  metrics: { flexDirection: "row", gap: 10 },
  miniMetric: {
    borderRadius: 12,
    flexGrow: 1,
    gap: 3,
    minWidth: "45%",
    padding: 11,
  },
  miniMetricLabel: { fontSize: 10, fontWeight: "700" },
  miniMetricValue: { fontSize: 17, fontWeight: "900" },
  agentMetricsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
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
  sectionTitleRow: { alignItems: "center", flexDirection: "row", gap: 9 },
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
});
