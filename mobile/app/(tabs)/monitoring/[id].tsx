import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
  TextInput,
} from "react-native";
import Svg, { Line, Path, Rect, Text as SvgText } from "react-native-svg";

import { useMobileFeatures } from "@/components/mobile-feature-gate";
import { useIncidentStyles } from "@/components/incident-styles";
import { stateBadge, stateBar } from "@/components/monitoring-styles";
import { useMobileNetworkStatus } from "@/components/offline-status";
import { ScreenContainer } from "@/components/screen-container";
import {
  categoryText,
  chartGeometry,
  connectedPorts,
  formatAgo,
  intervalLabel,
  kindLabel,
  LINK_SOURCE_LABELS,
  loadMonitoringConnections,
  loadMonitoringDevice,
  loadMonitoringSeries,
  pauseMonitoringDevice,
  portLinkText,
  RANGE_LABELS,
  sensorTarget,
  sensorValueText,
  STATE_LABELS,
  thresholdText,
  valueLabel,
  type MonitoringConnections,
  type MonitoringDeviceDetail,
  type MonitoringRange,
  type MonitoringSeries,
} from "@/lib/monitoring";
import { loadCurrentTenant } from "@/lib/nextdesk-client";
import { useAppColors } from "@/lib/themed-styles";
import { useAppActiveInterval } from "@/lib/use-app-active-interval";
import { useMobileSessionGuard } from "@/lib/use-mobile-session-guard";

// A rendering error shows expo-router's error screen with «Retry» instead of
// closing the app.
export { ErrorBoundary } from "expo-router";

const RANGES = Object.keys(RANGE_LABELS) as MonitoringRange[];

/** A monitored device: sensors, history of one sensor, linked incident. */
export default function MonitoringDeviceScreen() {
  const router = useRouter();
  const { isEnabled } = useMobileFeatures();
  const assetsEnabled = isEnabled("assets.management");
  const { id } = useLocalSearchParams<{ id: string }>();
  const styles = useIncidentStyles();
  const colors = useAppColors();
  const checkingSession = useMobileSessionGuard();
  const { recoveryEpoch } = useMobileNetworkStatus();
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [data, setData] = useState<MonitoringDeviceDetail | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [range, setRange] = useState<MonitoringRange>("24h");
  const [series, setSeries] = useState<MonitoringSeries | null>(null);
  const [connections, setConnections] = useState<MonitoringConnections | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [focused, setFocused] = useState(false);

  const load = useCallback(
    async (pull = false) => {
      if (!id) return;
      setError("");
      if (pull) setRefreshing(true);
      try {
        const tenant = await loadCurrentTenant();
        setTenantId(tenant.id);
        const result = await loadMonitoringDevice(tenant.id, id);
        setData(result);
        setNow(Date.now());
        // The connections are an extra; the screen works without them.
        loadMonitoringConnections(tenant.id, id)
          .then(setConnections)
          .catch(() => setConnections(null));
        setSelected((current) =>
          current && result.sensors.some((sensor) => sensor.id === current)
            ? current
            : (result.sensors[0]?.id ?? null),
        );
      } catch (nextError) {
        setError(
          nextError instanceof Error
            ? nextError.message
            : "Das Gerät konnte nicht geladen werden.",
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [id],
  );

  useFocusEffect(
    useCallback(() => {
      void recoveryEpoch;
      setFocused(true);
      if (!checkingSession) void load();
      return () => setFocused(false);
    }, [checkingSession, load, recoveryEpoch]),
  );
  useAppActiveInterval(() => void load(), 30_000, focused && !checkingSession);

  const checkedAt = data?.checkedAt;
  useEffect(() => {
    if (!tenantId || !selected) return;
    let cancelled = false;
    loadMonitoringSeries(tenantId, selected, range)
      .then((result) => {
        if (!cancelled) setSeries(result);
      })
      .catch(() => {
        if (!cancelled) setSeries(null);
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId, selected, range, checkedAt]);

  const sensor = data?.sensors.find((entry) => entry.id === selected) ?? null;
  const chart = useMemo(
    () =>
      series && sensor && series.sensorId === sensor.id && series.points.length
        ? chartGeometry(
            { ...series, unit: sensor.unit },
            now,
            sensor.warningAbove,
            340,
            190,
          )
        : null,
    [series, sensor, now],
  );
  const allPaused =
    !!data?.sensors.length && data.sensors.every((entry) => entry.paused);

  // Pausing asks for a reason first (shown on the device and in the events).
  const [pauseReason, setPauseReason] = useState<string | null>(null);
  const togglePause = async () => {
    if (!tenantId || !id) return;
    if (!allPaused && pauseReason === null) {
      setPauseReason("");
      return;
    }
    const reason = pauseReason?.trim() ?? "";
    if (!allPaused && reason.length < 3) {
      setError(
        "Bitte einen Grund für das Pausieren angeben (mindestens 3 Zeichen).",
      );
      return;
    }
    setBusy(true);
    try {
      await pauseMonitoringDevice(
        tenantId,
        id,
        !allPaused,
        allPaused ? null : reason,
      );
      setPauseReason(null);
      setError("");
      await load();
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Die Änderung ist fehlgeschlagen.",
      );
    } finally {
      setBusy(false);
    }
  };

  if (checkingSession || (loading && !data)) {
    return (
      <ScreenContainer className="px-5">
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} size="large" />
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
        <Pressable
          accessibilityRole="button"
          onPress={() =>
            router.canGoBack()
              ? router.back()
              : router.replace("/monitoring" as never)
          }
          style={styles.back}
        >
          <Ionicons color={colors.primaryText} name="chevron-back" size={18} />
          <Text style={styles.backText}>Überwachung</Text>
        </Pressable>

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
            <View>
              <View style={styles.badgeRow}>
                <Text
                  style={[styles.badge, stateBadge(styles, data.device.state)]}
                >
                  {STATE_LABELS[data.device.state]}
                </Text>
                {data.device.incident ? (
                  <Text style={[styles.badge, styles.badgeBad]}>
                    Störung {data.device.incident.number}
                  </Text>
                ) : null}
              </View>
              <Text style={styles.title}>{data.device.name}</Text>
              <Text style={styles.subtitle}>
                {[
                  categoryText(data.device.category, data.device.categoryLabel),
                  data.device.ipAddress,
                  data.device.hostname,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
            </View>

            {assetsEnabled ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push(`/infrastructure/${id}` as never)}
                style={styles.row}
              >
                <View style={styles.rowCopy}>
                  <Text style={styles.rowTitle}>In Infrastruktur öffnen</Text>
                  <Text numberOfLines={1} style={styles.rowMeta}>
                    Standort, Rack, Uplink und Services des Geräts
                  </Text>
                </View>
                <Ionicons
                  color={colors.muted}
                  name="chevron-forward"
                  size={18}
                />
              </Pressable>
            ) : null}

            {data.device.incident ? (
              <Pressable
                accessibilityRole="button"
                onPress={() =>
                  router.push(`/incidents/${data.device.incident!.id}` as never)
                }
                style={styles.row}
              >
                <View style={[styles.sev, styles.sevBad]} />
                <View style={styles.rowCopy}>
                  <Text style={styles.rowTitle}>
                    Störung {data.device.incident.number} öffnen
                  </Text>
                  <Text numberOfLines={2} style={styles.rowMeta}>
                    {data.device.incident.acknowledged
                      ? "bestätigt"
                      : "noch nicht bestätigt"}
                    {" · "}
                    {data.device.incident.title}
                  </Text>
                </View>
                <Ionicons
                  color={colors.subtle}
                  name="chevron-forward"
                  size={19}
                />
              </Pressable>
            ) : null}

            {sensor ? (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>
                  {sensor.name} · {valueLabel(sensor.unit)}
                </Text>
                <Text style={styles.rowMeta}>
                  Aktuell {sensorValueText(sensor)}
                  {series?.availability !== null &&
                  series?.availability !== undefined
                    ? ` · Verfügbarkeit ${series.availability.toLocaleString("de-CH")} %`
                    : ""}
                </Text>
                <ScrollView
                  contentContainerStyle={styles.chips}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                >
                  {RANGES.map((entry) => {
                    const active = range === entry;
                    return (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                        key={entry}
                        onPress={() => setRange(entry)}
                        style={[styles.chip, active ? styles.chipActive : null]}
                      >
                        <Text
                          style={[
                            styles.chipText,
                            active ? styles.chipTextActive : null,
                          ]}
                        >
                          {RANGE_LABELS[entry]}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
                {chart ? (
                  <Svg
                    accessibilityLabel={`${valueLabel(sensor.unit)} über ${RANGE_LABELS[range]}`}
                    height={190}
                    viewBox={`0 0 ${chart.width} ${chart.height}`}
                    width="100%"
                  >
                    {chart.yTicks.map((tick) => (
                      <Line
                        key={`g${tick.y}`}
                        stroke={colors.border}
                        strokeWidth={1}
                        x1={46}
                        x2={chart.width - 10}
                        y1={tick.y}
                        y2={tick.y}
                      />
                    ))}
                    {chart.yTicks.map((tick) => (
                      <SvgText
                        fill={colors.muted}
                        fontSize={10}
                        key={`l${tick.y}`}
                        textAnchor="end"
                        x={42}
                        y={tick.y + 3}
                      >
                        {tick.label.replace(/ (ms|bit\/s)$/, "")}
                      </SvgText>
                    ))}
                    {chart.xTicks
                      .filter((_tick, index) => index % 2 === 0)
                      .map((tick, index, list) => (
                        <SvgText
                          fill={colors.muted}
                          fontSize={10}
                          key={`x${tick.x}`}
                          textAnchor={
                            index === 0
                              ? "start"
                              : index === list.length - 1
                                ? "end"
                                : "middle"
                          }
                          x={tick.x}
                          y={chart.height - 6}
                        >
                          {tick.label}
                        </SvgText>
                      ))}
                    {chart.failures.map((failure) => (
                      <Rect
                        fill={colors.error}
                        height={chart.height - 32}
                        key={`f${failure.x}`}
                        opacity={0.25 + failure.share * 0.5}
                        width={failure.width}
                        x={failure.x}
                        y={10}
                      />
                    ))}
                    {chart.threshold !== null ? (
                      <Line
                        stroke={colors.warning}
                        strokeDasharray="3 4"
                        strokeWidth={1.5}
                        x1={46}
                        x2={chart.width - 10}
                        y1={chart.threshold}
                        y2={chart.threshold}
                      />
                    ) : null}
                    {chart.lines2.map((path) => (
                      <Path
                        d={path}
                        fill="none"
                        key={`o${path}`}
                        stroke={colors.warning}
                        strokeDasharray="5 3"
                        strokeWidth={1.6}
                      />
                    ))}
                    {chart.lines.map((path) => (
                      <Path
                        d={path}
                        fill="none"
                        key={`i${path}`}
                        stroke={colors.primary}
                        strokeLinejoin="round"
                        strokeWidth={2}
                      />
                    ))}
                  </Svg>
                ) : (
                  <Text style={styles.rowMeta}>
                    Für diesen Zeitraum liegen noch keine Messwerte vor.
                  </Text>
                )}
                {sensor.snmpMetric === "traffic" ? (
                  <Text style={styles.rowMeta}>
                    Durchgezogen: eingehend · gestrichelt: ausgehend
                  </Text>
                ) : null}
              </View>
            ) : null}

            <View style={styles.list}>
              <Text style={styles.eyebrow}>SENSOREN</Text>
              {data.sensors.map((entry) => {
                const active = entry.id === selected;
                const limits = thresholdText(entry);
                return (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    key={entry.id}
                    onPress={() => setSelected(entry.id)}
                    style={[styles.row, active ? styles.kpiActive : null]}
                  >
                    <View style={[styles.sev, stateBar(styles, entry.state)]} />
                    <View style={styles.rowCopy}>
                      <View style={styles.badgeRow}>
                        <Text
                          style={[
                            styles.badge,
                            stateBadge(styles, entry.state),
                          ]}
                        >
                          {STATE_LABELS[entry.state]}
                        </Text>
                        <Text style={styles.badge}>{kindLabel(entry)}</Text>
                      </View>
                      <Text numberOfLines={1} style={styles.rowTitle}>
                        {entry.name}
                      </Text>
                      <Text numberOfLines={2} style={styles.rowMeta}>
                        {[
                          entry.state === "down"
                            ? (entry.lastMessage ?? "Keine Antwort")
                            : sensorValueText(entry),
                          limits,
                          sensorTarget(entry, data.device),
                          intervalLabel(entry.intervalSeconds),
                          formatAgo(entry.lastCheckAt, now),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </Text>
                      {entry.paused ? (
                        <Text numberOfLines={3} style={styles.rowMeta}>
                          {entry.pausedByName
                            ? `Pausiert von ${entry.pausedByName}`
                            : "Pausiert"}
                          {entry.pausedReason ? `: ${entry.pausedReason}` : ""}
                        </Text>
                      ) : null}
                    </View>
                  </Pressable>
                );
              })}
              {data.sensors.length === 0 ? (
                <Text style={styles.rowMeta}>
                  Dieses Gerät hat noch keinen Sensor.
                </Text>
              ) : null}
            </View>

            {connections &&
            (connections.attachedTo.length || connections.ports.length) ? (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Verbindungen</Text>
                {connections.scannedAt ? (
                  <Text style={styles.rowMeta}>
                    Stand {formatAgo(connections.scannedAt, now)}
                  </Text>
                ) : null}
                {connections.attachedTo.map((entry) => (
                  <Pressable
                    accessibilityRole="button"
                    key={`${entry.assetId}|${entry.port}`}
                    onPress={() =>
                      router.push(
                        (entry.monitored
                          ? `/monitoring/${entry.assetId}`
                          : `/infrastructure/${entry.assetId}`) as never,
                      )
                    }
                  >
                    <Text style={styles.rowTitle}>
                      Hängt an {entry.name}, Port {entry.port}
                    </Text>
                    <Text style={styles.rowMeta}>
                      {LINK_SOURCE_LABELS[entry.source]}
                    </Text>
                  </Pressable>
                ))}
                {connectedPorts(connections.ports)
                  .slice(0, 60)
                  .map((port) => {
                    const target = port.link?.assetId
                      ? port.link.monitored
                        ? `/monitoring/${port.link.assetId}`
                        : assetsEnabled
                          ? `/infrastructure/${port.link.assetId}`
                          : null
                      : null;
                    return (
                      <Pressable
                        accessibilityRole={target ? "button" : "text"}
                        disabled={!target}
                        key={port.port}
                        onPress={() =>
                          target ? router.push(target as never) : undefined
                        }
                      >
                        <Text style={styles.rowTitle}>
                          {port.port} → {portLinkText(port)}
                        </Text>
                        <Text style={styles.rowMeta}>
                          {[
                            port.alias,
                            port.link?.address,
                            port.link
                              ? LINK_SOURCE_LABELS[port.link.source]
                              : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </Text>
                      </Pressable>
                    );
                  })}
              </View>
            ) : null}

            {data.device.services.length || data.device.uplink ? (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Verknüpft</Text>
                {data.device.services.length ? (
                  <Text style={styles.rowMeta}>
                    Services:{" "}
                    {data.device.services.map((entry) => entry.name).join(", ")}
                  </Text>
                ) : null}
                {data.device.uplink ? (
                  <Text style={styles.rowMeta}>
                    Uplink: {data.device.uplink.name}
                  </Text>
                ) : null}
              </View>
            ) : null}

            {data.canManage && data.sensors.length && pauseReason !== null ? (
              <View style={styles.card}>
                <Text style={styles.rowTitle}>Grund für das Pausieren</Text>
                <TextInput
                  autoFocus
                  maxLength={300}
                  onChangeText={setPauseReason}
                  placeholder="z. B. Wartung des Switches bis 14 Uhr"
                  placeholderTextColor={colors.subtle}
                  style={styles.input}
                  value={pauseReason}
                />
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <Pressable
                    accessibilityRole="button"
                    disabled={busy}
                    onPress={() => void togglePause()}
                    style={[styles.chip, { alignSelf: "flex-start" }]}
                  >
                    <Text style={styles.chipText}>
                      {busy ? "Wird geändert …" : "Pausieren"}
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    disabled={busy}
                    onPress={() => setPauseReason(null)}
                    style={[styles.chip, { alignSelf: "flex-start" }]}
                  >
                    <Text style={styles.chipText}>Abbrechen</Text>
                  </Pressable>
                </View>
              </View>
            ) : data.canManage && data.sensors.length ? (
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() => void togglePause()}
                style={[styles.chip, { alignSelf: "flex-start" }]}
              >
                <Text style={styles.chipText}>
                  {busy
                    ? "Wird geändert …"
                    : allPaused
                      ? "Überwachung fortsetzen"
                      : "Überwachung pausieren"}
                </Text>
              </Pressable>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </ScreenContainer>
  );
}
