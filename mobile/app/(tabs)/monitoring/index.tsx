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

import { useIncidentStyles } from "@/components/incident-styles";
import { stateBadge, stateBar } from "@/components/monitoring-styles";
import { useMobileNetworkStatus } from "@/components/offline-status";
import { ScreenContainer } from "@/components/screen-container";
import {
  categoryText,
  formatAgo,
  formatMs,
  formatSince,
  loadMonitoringOverview,
  sensorCountsText,
  STATE_LABELS,
  type MonitoringOverview,
  type MonitoringState,
} from "@/lib/monitoring";
import { loadCurrentTenant } from "@/lib/nextdesk-client";
import { useAppColors } from "@/lib/themed-styles";
import { useAppActiveInterval } from "@/lib/use-app-active-interval";
import { useMobileSessionGuard } from "@/lib/use-mobile-session-guard";

const TILES: MonitoringState[] = ["down", "warning", "up", "unknown"];

/** «Überwachung»: devices nextDesk monitors itself, with their state. */
export default function MonitoringScreen() {
  const router = useRouter();
  const styles = useIncidentStyles();
  const colors = useAppColors();
  const checkingSession = useMobileSessionGuard();
  const { recoveryEpoch } = useMobileNetworkStatus();
  const [data, setData] = useState<MonitoringOverview | null>(null);
  const [filter, setFilter] = useState<MonitoringState | "all">("all");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [focused, setFocused] = useState(false);

  const load = useCallback(async (pull = false) => {
    setError("");
    if (pull) setRefreshing(true);
    try {
      const tenant = await loadCurrentTenant();
      setData(await loadMonitoringOverview(tenant.id));
      setNow(Date.now());
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Die Überwachung konnte nicht geladen werden.",
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void recoveryEpoch;
      setFocused(true);
      if (!checkingSession) void load();
      return () => setFocused(false);
    }, [checkingSession, load, recoveryEpoch]),
  );
  useAppActiveInterval(() => void load(), 30_000, focused && !checkingSession);

  if (checkingSession || (loading && !data)) {
    return (
      <ScreenContainer className="px-5">
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      </ScreenContainer>
    );
  }

  const devices = (data?.devices ?? []).filter(
    (device) => filter === "all" || device.state === filter,
  );
  const alarms = (data?.devices ?? []).filter((device) => device.problem);

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
        <Pressable
          accessibilityRole="button"
          onPress={() =>
            router.canGoBack()
              ? router.back()
              : router.replace("/services" as never)
          }
          style={styles.back}
        >
          <Ionicons color={colors.primaryText} name="chevron-back" size={18} />
          <Text style={styles.backText}>Dienste</Text>
        </Pressable>
        <View>
          <Text style={styles.eyebrow}>BETRIEB</Text>
          <Text style={styles.title}>Überwachung</Text>
          {data ? (
            <Text style={styles.subtitle}>
              {`${data.deviceCount} Geräte · ${data.sensorCount} Sensoren · aktualisiert ${formatAgo(data.checkedAt, now)}`}
            </Text>
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

        {data ? (
          <>
            <View style={styles.kpiRow}>
              {TILES.map((state) => (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: filter === state }}
                  key={state}
                  onPress={() => setFilter(filter === state ? "all" : state)}
                  style={[
                    styles.kpi,
                    filter === state ? styles.kpiActive : null,
                  ]}
                >
                  <Text
                    style={[
                      styles.kpiValue,
                      state === "down" && data.totals.down > 0
                        ? styles.kpiBad
                        : null,
                    ]}
                  >
                    {data.totals[state]}
                  </Text>
                  <Text style={styles.kpiLabel}>{STATE_LABELS[state]}</Text>
                </Pressable>
              ))}
            </View>

            {alarms.length && filter === "all" ? (
              <View style={styles.list}>
                <Text style={styles.eyebrow}>AKTIVE ALARME</Text>
                {alarms.map((device) => (
                  <Pressable
                    accessibilityRole="button"
                    key={device.assetId}
                    onPress={() =>
                      router.push(`/monitoring/${device.assetId}` as never)
                    }
                    style={styles.row}
                  >
                    <View
                      style={[
                        styles.sev,
                        stateBar(styles, device.problem!.state),
                      ]}
                    />
                    <View style={styles.rowCopy}>
                      <View style={styles.badgeRow}>
                        <Text
                          style={[
                            styles.badge,
                            stateBadge(styles, device.problem!.state),
                          ]}
                        >
                          {STATE_LABELS[device.problem!.state]}
                        </Text>
                        {device.incident ? (
                          <Text style={styles.badge}>
                            Störung {device.incident.number}
                          </Text>
                        ) : null}
                      </View>
                      <Text numberOfLines={2} style={styles.rowTitle}>
                        {device.name} · {device.problem!.sensorName}
                      </Text>
                      <Text numberOfLines={2} style={styles.rowMeta}>
                        {[
                          device.problem!.message,
                          formatSince(device.problem!.since, now),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </Text>
                    </View>
                  </Pressable>
                ))}
              </View>
            ) : null}

            <View style={styles.list}>
              <Text style={styles.eyebrow}>
                {filter === "all"
                  ? "GERÄTE"
                  : `GERÄTE · ${STATE_LABELS[filter].toUpperCase()}`}
              </Text>
              {devices.map((device) => (
                <Pressable
                  accessibilityRole="button"
                  key={device.assetId}
                  onPress={() =>
                    router.push(`/monitoring/${device.assetId}` as never)
                  }
                  style={styles.row}
                >
                  <View style={[styles.sev, stateBar(styles, device.state)]} />
                  <View style={styles.rowCopy}>
                    <View style={styles.badgeRow}>
                      <Text
                        style={[styles.badge, stateBadge(styles, device.state)]}
                      >
                        {STATE_LABELS[device.state]}
                      </Text>
                    </View>
                    <Text numberOfLines={1} style={styles.rowTitle}>
                      {device.name}
                    </Text>
                    <Text numberOfLines={1} style={styles.rowMeta}>
                      {[
                        categoryText(device.category, device.categoryLabel),
                        device.ipAddress ?? device.hostname,
                        sensorCountsText(device.counts),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </Text>
                  </View>
                  {device.responseMs !== null ? (
                    <View style={styles.duration}>
                      <Text style={styles.durationValue}>
                        {formatMs(device.responseMs)}
                      </Text>
                      <Text style={styles.durationLabel}>Antwort</Text>
                    </View>
                  ) : null}
                </Pressable>
              ))}
              {devices.length === 0 ? (
                <View style={styles.emptyCard}>
                  <Ionicons
                    color={colors.subtle}
                    name="radio-outline"
                    size={28}
                  />
                  <Text style={styles.emptyText}>
                    {data.deviceCount === 0
                      ? "Noch wird kein Gerät überwacht. Geräte und Sensoren werden im Web erfasst."
                      : "Kein Gerät in diesem Zustand."}
                  </Text>
                </View>
              ) : null}
            </View>

            <View style={styles.list}>
              <Text style={styles.eyebrow}>SONDEN</Text>
              {data.agents.map((agent) => (
                <View key={agent.id} style={styles.row}>
                  <View
                    style={[
                      styles.sev,
                      agent.online ? styles.sevOk : styles.sevBad,
                    ]}
                  />
                  <View style={styles.rowCopy}>
                    <Text numberOfLines={1} style={styles.rowTitle}>
                      {agent.name}
                    </Text>
                    <Text numberOfLines={1} style={styles.rowMeta}>
                      {[
                        agent.online
                          ? "online"
                          : agent.active
                            ? "meldet sich nicht"
                            : "deaktiviert",
                        `${agent.sensorCount ?? 0} Sensoren`,
                        formatAgo(agent.lastSeenAt, now),
                      ].join(" · ")}
                    </Text>
                  </View>
                </View>
              ))}
              {data.agents.length === 0 ? (
                <Text style={styles.rowMeta}>
                  Keine Sonde eingerichtet. Sonden werden im Web unter
                  Einstellungen → Monitoring angelegt.
                </Text>
              ) : null}
            </View>
          </>
        ) : null}
      </ScrollView>
    </ScreenContainer>
  );
}
