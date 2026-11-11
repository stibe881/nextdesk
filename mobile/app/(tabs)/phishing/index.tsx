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

import { useIncidentStyles } from "@/components/incident-styles";
import { useMobileNetworkStatus } from "@/components/offline-status";
import { ScreenContainer } from "@/components/screen-container";
import { useAppActiveInterval } from "@/hooks/use-app-active-interval";
import { canWorkSecurityCases } from "@/lib/incidents";
import { loadCurrentTenant } from "@/lib/nextdesk-client";
import {
  formatAgo,
  formatMinutes,
  listSecurityCases,
  RISK_LABELS,
  STATE_LABELS,
  VERDICT_LABELS,
  type SecurityCaseSummary,
  type SecurityStateFilter,
  type SecurityStats,
} from "@/lib/security-cases";
import { useAppColors } from "@/lib/themed-styles";
import { useMobileSessionGuard } from "@/lib/use-mobile-session-guard";

const FILTERS: { key: SecurityStateFilter; label: string }[] = [
  { key: "triage", label: "Zu beurteilen" },
  { key: "actions", label: "Massnahmen" },
  { key: "closed", label: "Abgeschlossen" },
  { key: "all", label: "Alle" },
];

const EMPTY: Partial<Record<SecurityStateFilter, string>> = {
  triage: "Keine Meldungen zu beurteilen.",
  actions: "Keine Fälle mit offenen Massnahmen.",
  closed: "Keine abgeschlossenen Fälle.",
  today: "Heute wurde noch nichts gemeldet.",
  clicked: "Niemand hat angegeben, geklickt zu haben.",
};

/** «Phishing»: reported phishing mails (security cases). Agents only. */
export default function PhishingScreen() {
  const router = useRouter();
  const styles = useIncidentStyles();
  const colors = useAppColors();
  const checkingSession = useMobileSessionGuard();
  const { recoveryEpoch } = useMobileNetworkStatus();
  const [filter, setFilter] = useState<SecurityStateFilter>("triage");
  const [cases, setCases] = useState<SecurityCaseSummary[]>([]);
  const [stats, setStats] = useState<SecurityStats | null>(null);
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const loadedFilter = useRef<SecurityStateFilter | null>(null);

  const load = useCallback(
    async (pull = false) => {
      setError("");
      if (pull) setRefreshing(true);
      else if (loadedFilter.current !== filter) setLoading(true);
      try {
        const tenant = await loadCurrentTenant();
        const permitted = await canWorkSecurityCases(tenant.id);
        setAllowed(permitted);
        if (!permitted) return;
        const result = await listSecurityCases(tenant.id, filter);
        setCases(result.cases);
        setStats(result.stats);
        loadedFilter.current = filter;
      } catch (nextError) {
        setError(
          nextError instanceof Error
            ? nextError.message
            : "Die Phishing-Fälle konnten nicht geladen werden.",
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [filter],
  );

  const [focused, setFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      void recoveryEpoch;
      if (checkingSession) return;
      void load();
      setFocused(true);
      return () => setFocused(false);
    }, [checkingSession, load, recoveryEpoch]),
  );
  // Jede Minute nachladen, nur solange die Liste sichtbar und die App aktiv ist.
  useAppActiveInterval(() => void load(), 60_000, focused && !checkingSession);

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
            <Ionicons
              color={colors.primaryText}
              name="shield-outline"
              size={28}
            />
            <Text style={styles.cardTitle}>Phishing</Text>
            <Text style={styles.emptyText}>
              Phishing-Fälle sieht nur das zuständige Sicherheitsteam.
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
          <Text style={styles.eyebrow}>SICHERHEIT</Text>
          <Text style={styles.title}>Phishing</Text>
          <Text style={styles.subtitle}>
            Gemeldete Phishing-Mails. Meldungen derselben Mail sind ein Fall.
            Beurteilen Sie den Fall und arbeiten Sie die Massnahmen ab; alle
            Melder erhalten das Ergebnis automatisch.
          </Text>
        </View>

        {stats ? (
          <View style={styles.kpiRow}>
            <Pressable
              accessibilityRole="button"
              onPress={() => setFilter("triage")}
              style={[
                styles.kpi,
                filter === "triage" ? styles.kpiActive : null,
              ]}
            >
              <Text
                style={[
                  styles.kpiValue,
                  stats.triageHigh > 0 || stats.overdue > 0
                    ? styles.kpiBad
                    : null,
                ]}
              >
                {stats.triage}
              </Text>
              <Text style={styles.kpiLabel}>Zu beurteilen</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => setFilter("today")}
              style={[styles.kpi, filter === "today" ? styles.kpiActive : null]}
            >
              <Text style={styles.kpiValue}>{stats.reportsToday}</Text>
              <Text style={styles.kpiLabel}>Heute</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => setFilter("clicked")}
              style={[
                styles.kpi,
                filter === "clicked" ? styles.kpiActive : null,
              ]}
            >
              <Text
                style={[
                  styles.kpiValue,
                  stats.clickYes > 0 ? styles.kpiBad : null,
                ]}
              >
                {stats.clickYes}
              </Text>
              <Text style={styles.kpiLabel}>Geklickt</Text>
            </Pressable>
          </View>
        ) : null}
        {stats?.medianVerdictMinutes !== null &&
        stats?.medianVerdictMinutes !== undefined ? (
          <Text style={styles.muted}>
            Zeit bis Urteil (Median, 30 Tage):{" "}
            {formatMinutes(stats.medianVerdictMinutes)}
          </Text>
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
            {cases.map((entry) => (
              <Pressable
                accessibilityRole="button"
                key={entry.ticketId}
                onPress={() =>
                  router.push(`/phishing/${entry.ticketId}` as never)
                }
                style={styles.row}
              >
                <View
                  style={[
                    styles.sev,
                    entry.verdict === "harmless" || entry.state === "closed"
                      ? styles.sevOk
                      : entry.riskLevel === "high"
                        ? styles.sevBad
                        : entry.riskLevel === "medium"
                          ? styles.sevWarn
                          : styles.sevOk,
                  ]}
                />
                <View style={styles.rowCopy}>
                  <View style={styles.badgeRow}>
                    {entry.ticketNumber ? (
                      <Text style={styles.number}>{entry.ticketNumber}</Text>
                    ) : null}
                    <Text
                      style={[
                        styles.badge,
                        entry.state === "triage"
                          ? styles.badgeBad
                          : entry.state === "actions"
                            ? styles.badgeWarn
                            : styles.badgeOk,
                      ]}
                    >
                      {entry.verdict
                        ? VERDICT_LABELS[entry.verdict]
                        : STATE_LABELS[entry.state]}
                    </Text>
                    <Text
                      style={[
                        styles.badge,
                        entry.riskLevel === "high"
                          ? styles.badgeBad
                          : entry.riskLevel === "medium"
                            ? styles.badgeWarn
                            : styles.badgeOk,
                      ]}
                    >
                      Risiko {RISK_LABELS[entry.riskLevel]}
                    </Text>
                    {entry.overdue ? (
                      <Text style={[styles.badge, styles.badgeBad]}>
                        Überfällig
                      </Text>
                    ) : null}
                  </View>
                  <Text numberOfLines={2} style={styles.rowTitle}>
                    {entry.subject ?? "(ohne Betreff)"}
                  </Text>
                  <Text numberOfLines={1} style={styles.rowMeta}>
                    {[
                      entry.from,
                      entry.assignedAgentName
                        ? `zuständig: ${entry.assignedAgentName}`
                        : "nicht zugewiesen",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </Text>
                </View>
                <View style={styles.duration}>
                  <Text style={styles.durationValue}>{entry.reporters}</Text>
                  <Text style={styles.durationLabel}>Melder</Text>
                  <Text style={styles.durationLabel}>
                    {formatAgo(entry.firstReportedAt)}
                  </Text>
                </View>
              </Pressable>
            ))}
            {!error && cases.length === 0 ? (
              <View style={styles.emptyCard}>
                <Ionicons
                  color={colors.success}
                  name="shield-checkmark-outline"
                  size={28}
                />
                <Text style={styles.emptyText}>
                  {EMPTY[filter] ?? "Keine Fälle."}
                </Text>
              </View>
            ) : null}
          </View>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}
