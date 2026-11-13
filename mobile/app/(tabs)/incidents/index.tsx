import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";

import { severityStyle, useIncidentStyles } from "@/components/incident-styles";
import { useMobileNetworkStatus } from "@/components/offline-status";
import { ScreenContainer } from "@/components/screen-container";
import {
  canWorkIncidents,
  formatDuration,
  listIncidents,
  liveMinutes,
  STATE_LABELS,
  type IncidentFilter,
  type IncidentStats,
  type IncidentSummary,
} from "@/lib/incidents";
import { loadCurrentTenant } from "@/lib/nextdesk-client";
import { useAppColors } from "@/lib/themed-styles";
import { useAppActiveInterval } from "@/lib/use-app-active-interval";
import { useMobileSessionGuard } from "@/lib/use-mobile-session-guard";
import { tn } from "@/lib/formality";

/** State of the public message on the status page. */
const STATUS_PAGE_LABELS: Record<string, string> = {
  investigating: "Wird untersucht",
  identified: "Ursache bekannt",
  monitoring: "Wird beobachtet",
  resolved: "Behoben",
};

const FILTERS: { key: IncidentFilter; label: string }[] = [
  { key: "active", label: "Aktiv" },
  { key: "unacknowledged", label: "Unbestätigt" },
  { key: "closed", label: "Behoben" },
  { key: "all", label: "Alle" },
];

const EMPTY: Partial<Record<IncidentFilter, string>> = {
  active: "Keine aktiven Störungen. Alles läuft.",
  unacknowledged: "Alle aktiven Störungen sind bestätigt.",
  resolved: "Keine behobenen Störungen, die noch abgeschlossen werden müssen.",
  closed: "Noch keine behobenen Störungen.",
};

/** «Störungen»: PRTG incidents, handled without tickets. Agents only. */
export default function IncidentsScreen() {
  const router = useRouter();
  const styles = useIncidentStyles();
  const colors = useAppColors();
  const checkingSession = useMobileSessionGuard();
  const { recoveryEpoch } = useMobileNetworkStatus();
  const [filter, setFilter] = useState<IncidentFilter>("active");
  const [incidents, setIncidents] = useState<IncidentSummary[]>([]);
  const [stats, setStats] = useState<IncidentStats | null>(null);
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [focused, setFocused] = useState(false);
  const loadedFilter = useRef<IncidentFilter | null>(null);

  const load = useCallback(
    async (pull = false) => {
      setError("");
      if (pull) setRefreshing(true);
      else if (loadedFilter.current !== filter) setLoading(true);
      try {
        const tenant = await loadCurrentTenant();
        const permitted = await canWorkIncidents(tenant.id);
        setAllowed(permitted);
        if (!permitted) return;
        const result = await listIncidents(tenant.id, filter);
        setIncidents(result.incidents);
        if (result.stats) setStats(result.stats);
        loadedFilter.current = filter;
        setNow(Date.now());
      } catch (nextError) {
        setError(
          nextError instanceof Error
            ? nextError.message
            : "Die Störungen konnten nicht geladen werden.",
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [filter],
  );

  useFocusEffect(
    useCallback(() => {
      void recoveryEpoch;
      setFocused(true);
      if (!checkingSession) void load();
      return () => setFocused(false);
    }, [checkingSession, load, recoveryEpoch]),
  );

  // New PRTG messages show up while the screen is open and the app in use.
  useAppActiveInterval(() => void load(), 30_000, focused && !checkingSession);
  useAppActiveInterval(() => setNow(Date.now()), 30_000, focused);

  if (checkingSession || (loading && allowed === null)) {
    return (
      <ScreenContainer className="px-5">
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      </ScreenContainer>
    );
  }

  if (allowed === false) {
    return (
      <ScreenContainer className="px-5">
        <View style={styles.centered}>
          <View style={styles.emptyCard}>
            <Ionicons color={colors.primaryText} name="pulse" size={28} />
            <Text style={styles.cardTitle}>Störungen</Text>
            <Text style={styles.emptyText}>
              Störungen sieht nur das zuständige Team.
            </Text>
          </View>
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer className="px-5">
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            onRefresh={() => void load(true)}
            refreshing={refreshing}
            tintColor={colors.primary}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        <View>
          <Text style={styles.eyebrow}>BETRIEB</Text>
          <Text style={styles.title}>Störungen</Text>
          <Text style={styles.subtitle}>
            {tn(
              "Meldungen aus PRTG. Bestätige eine Störung, sobald du dich darum kümmerst. Meldet PRTG wieder OK, gilt sie als behoben – abschliessen mit Ursache musst du sie selbst.",
              "Meldungen aus PRTG. Bestätigen Sie eine Störung, sobald Sie sich darum kümmern. Meldet PRTG wieder OK, gilt sie als behoben – abschliessen mit Ursache müssen Sie sie selbst.",
            )}
          </Text>
        </View>

        {stats ? (
          <View style={styles.kpiRow}>
            <Pressable
              accessibilityRole="button"
              onPress={() => setFilter("active")}
              style={[
                styles.kpi,
                filter === "active" ? styles.kpiActive : null,
              ]}
            >
              <Text
                style={[
                  styles.kpiValue,
                  stats.activeDown > 0 ? styles.kpiBad : null,
                ]}
              >
                {stats.active}
              </Text>
              <Text style={styles.kpiLabel}>Aktiv</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => setFilter("unacknowledged")}
              style={[
                styles.kpi,
                filter === "unacknowledged" ? styles.kpiActive : null,
              ]}
            >
              <Text
                style={[
                  styles.kpiValue,
                  stats.unacknowledged > 0 ? styles.kpiBad : null,
                ]}
              >
                {stats.unacknowledged}
              </Text>
              <Text style={styles.kpiLabel}>Unbestätigt</Text>
            </Pressable>
            <View style={styles.kpi}>
              <Text style={styles.kpiValue}>
                {formatDuration(stats.medianResolveMinutes)}
              </Text>
              <Text style={styles.kpiLabel}>Behebung</Text>
            </View>
          </View>
        ) : null}

        <ScrollView
          contentContainerStyle={styles.chips}
          horizontal
          showsHorizontalScrollIndicator={false}
        >
          {FILTERS.map((entry) => {
            const selected = filter === entry.key;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected }}
                key={entry.key}
                onPress={() => setFilter(entry.key)}
                style={[styles.chip, selected ? styles.chipActive : null]}
              >
                <Text
                  style={[
                    styles.chipText,
                    selected ? styles.chipTextActive : null,
                  ]}
                >
                  {entry.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

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

        {loading ? (
          <ActivityIndicator color={colors.primary} />
        ) : (
          <View style={styles.list}>
            {incidents.map((entry) => (
              <View key={entry.id} style={styles.list}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.push(`/incidents/${entry.id}` as never)}
                  style={styles.row}
                >
                  <View style={[styles.sev, severityStyle(styles, entry)]} />
                  <View style={styles.rowCopy}>
                    <View style={styles.badgeRow}>
                      <Text style={styles.number}>{entry.number}</Text>
                      {entry.state === "active" ? (
                        <Text
                          style={[
                            styles.badge,
                            entry.severity === "warning"
                              ? styles.badgeWarn
                              : styles.badgeBad,
                          ]}
                        >
                          {entry.severity === "warning" ? "Warnung" : "Ausfall"}
                        </Text>
                      ) : (
                        <Text style={[styles.badge, styles.badgeOk]}>
                          {STATE_LABELS[entry.state]}
                        </Text>
                      )}
                      {entry.state === "active" &&
                      !entry.acknowledgedAt &&
                      entry.source !== "external" ? (
                        <Text style={[styles.badge, styles.badgeBad]}>
                          Unbestätigt
                        </Text>
                      ) : null}
                      {entry.assignedAgentName ? (
                        <Text
                          style={[
                            styles.badge,
                            entry.acknowledgedAt ? styles.badgeOk : null,
                          ]}
                        >
                          {entry.assignedAgentName}
                        </Text>
                      ) : entry.state !== "closed" ? (
                        <Text style={styles.badge}>Nicht zugewiesen</Text>
                      ) : null}
                      {entry.statusPage ? (
                        <Text
                          style={[
                            styles.badge,
                            entry.statusPage.state === "resolved"
                              ? styles.badgeOk
                              : null,
                          ]}
                        >
                          Statusseite
                          {STATUS_PAGE_LABELS[entry.statusPage.state]
                            ? ` · ${STATUS_PAGE_LABELS[entry.statusPage.state]}`
                            : ""}
                        </Text>
                      ) : null}
                      {entry.source === "external" ? (
                        <Text style={styles.badge}>
                          Extern
                          {entry.externalProvider
                            ? ` · ${entry.externalProvider}`
                            : ""}
                        </Text>
                      ) : null}
                    </View>
                    <Text numberOfLines={2} style={styles.rowTitle}>
                      {entry.title}
                    </Text>
                    {entry.location || entry.services.length ? (
                      <Text numberOfLines={1} style={styles.rowMeta}>
                        {[
                          entry.location,
                          entry.services.map((s) => s.name).join(", "),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </Text>
                    ) : null}
                  </View>
                  <View style={styles.duration}>
                    <Text style={styles.durationValue}>
                      {formatDuration(
                        liveMinutes(entry.openedAt, entry.resolvedAt, now),
                      )}
                    </Text>
                    <Text style={styles.durationLabel}>
                      {entry.state === "active" ? "läuft" : "Dauer"}
                    </Text>
                  </View>
                </Pressable>
                {entry.children.length ? (
                  <View style={styles.child}>
                    <Text style={styles.childLabel}>
                      {entry.children.length === 1
                        ? "FOLGESTÖRUNG"
                        : `${entry.children.length} FOLGESTÖRUNGEN`}
                    </Text>
                    <Text numberOfLines={2} style={styles.rowMeta}>
                      {entry.children
                        .map((child) => child.deviceName ?? child.title)
                        .join(", ")}
                    </Text>
                  </View>
                ) : null}
              </View>
            ))}
            {!error && incidents.length === 0 ? (
              <View style={styles.emptyCard}>
                <Ionicons
                  color={colors.success}
                  name="checkmark-circle-outline"
                  size={28}
                />
                <Text style={styles.emptyText}>
                  {EMPTY[filter] ?? "Keine Störungen."}
                </Text>
              </View>
            ) : null}
          </View>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}
