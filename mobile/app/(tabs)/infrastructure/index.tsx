import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

import { NetworkIcon } from "@/components/section-icons";
import { ScreenContainer } from "@/components/screen-container";
import {
  MobileFeatureLoadingScreen,
  MobileFeatureUnavailableScreen,
  useMobileFeatures,
} from "@/components/mobile-feature-gate";
import { useMobileNetworkStatus } from "@/components/offline-status";
import {
  INFRA_CATEGORIES,
  categoryIcons,
  categoryLabels,
  dueItems,
  formatDay,
  lifecycleLabels,
  listInfrastructure,
  type InfraCategory,
  type InfraDevice,
} from "@/lib/infrastructure";
import { loadCurrentTenant } from "@/lib/nextdesk-client";
import { makeThemedStyles, useAppColors } from "@/lib/themed-styles";
import { useMobileSessionGuard } from "@/lib/use-mobile-session-guard";
import { tn } from "@/lib/formality";

type Filter = "all" | "due" | InfraCategory;

function matches(device: InfraDevice, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [
    device.name,
    device.hostname,
    device.ipAddress,
    device.macAddress,
    device.serialNumber,
    device.inventoryNumber,
    device.assetTag,
    device.manufacturer,
    device.model,
    device.locationName,
    device.rack,
  ].some((value) => value?.toLowerCase().includes(needle));
}

export default function InfrastructureScreen() {
  const router = useRouter();
  const styles = useStyles();
  const colors = useAppColors();
  const checkingSession = useMobileSessionGuard();
  const { isEnabled, loading: checkingFeatures } = useMobileFeatures();
  const enabled = isEnabled("assets.management");
  const { recoveryEpoch } = useMobileNetworkStatus();
  const [devices, setDevices] = useState<InfraDevice[]>([]);
  // «?rack=…» from a scanned rack label filters the list to that rack.
  const { rack } = useLocalSearchParams<{ rack?: string }>();
  const rackParam = typeof rack === "string" ? rack.trim() : "";
  const [query, setQuery] = useState(rackParam);
  const [appliedRack, setAppliedRack] = useState(rackParam);
  if (rackParam && rackParam !== appliedRack) {
    // A later scan of another rack while this screen stays mounted.
    setAppliedRack(rackParam);
    setQuery(rackParam);
  }
  const [filter, setFilter] = useState<Filter>("all");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const loadedOnce = useRef(false);

  const load = useCallback(async (pull = false) => {
    setError("");
    if (pull) setRefreshing(true);
    else if (!loadedOnce.current) setLoading(true);
    try {
      const tenant = await loadCurrentTenant();
      const result = await listInfrastructure(tenant.id);
      setDevices(result.devices);
      loadedOnce.current = true;
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Die Infrastruktur konnte nicht geladen werden.",
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void recoveryEpoch;
      if (!checkingSession && !checkingFeatures && enabled) void load();
    }, [checkingFeatures, checkingSession, enabled, load, recoveryEpoch]),
  );

  const dueById = useMemo(
    () => new Map(devices.map((device) => [device.id, dueItems(device)])),
    [devices],
  );
  const counts = useMemo(() => {
    const result = new Map<Filter, number>([["all", devices.length]]);
    let due = 0;
    for (const device of devices) {
      result.set(device.category, (result.get(device.category) ?? 0) + 1);
      if ((dueById.get(device.id) ?? []).length > 0) due += 1;
    }
    result.set("due", due);
    return result;
  }, [devices, dueById]);
  const active = devices.filter((d) => d.lifecycleState === "active").length;
  const repair = devices.filter((d) => d.lifecycleState === "repair").length;

  const visible = useMemo(
    () =>
      devices.filter(
        (device) =>
          matches(device, query) &&
          (filter === "all" ||
            (filter === "due"
              ? (dueById.get(device.id) ?? []).length > 0
              : device.category === filter)),
      ),
    [devices, dueById, filter, query],
  );

  if (checkingSession || checkingFeatures) {
    return <MobileFeatureLoadingScreen />;
  }
  if (!enabled) {
    return (
      <MobileFeatureUnavailableScreen
        feature="assets.management"
        title="Infrastruktur"
      />
    );
  }
  if (loading) {
    return (
      <ScreenContainer className="px-5">
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      </ScreenContainer>
    );
  }

  const filters: Filter[] = [
    "all",
    "due",
    ...INFRA_CATEGORIES.filter((category) => (counts.get(category) ?? 0) > 0),
  ];

  return (
    <ScreenContainer className="px-5">
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
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
          <Text style={styles.eyebrow}>INVENTAR</Text>
          <Text style={styles.title}>Infrastruktur</Text>
          <Text style={styles.subtitle}>
            Server, Switches, Access Points und weitere Netzwerkgeräte
          </Text>
        </View>

        <View style={styles.kpiRow}>
          <View style={styles.kpi}>
            <Text style={styles.kpiValue}>{devices.length}</Text>
            <Text style={styles.kpiLabel}>Geräte</Text>
          </View>
          <View style={styles.kpi}>
            <Text style={styles.kpiValue}>{active}</Text>
            <Text style={styles.kpiLabel}>In Betrieb</Text>
          </View>
          <View style={styles.kpi}>
            <Text
              style={[
                styles.kpiValue,
                (counts.get("due") ?? 0) > 0 ? styles.kpiWarn : null,
              ]}
            >
              {counts.get("due") ?? 0}
            </Text>
            <Text style={styles.kpiLabel}>Fällig</Text>
          </View>
          <View style={styles.kpi}>
            <Text style={styles.kpiValue}>{repair}</Text>
            <Text style={styles.kpiLabel}>Reparatur</Text>
          </View>
        </View>

        <View style={styles.searchRow}>
          <Ionicons color={colors.subtle} name="search-outline" size={19} />
          <TextInput
            accessibilityLabel="Infrastruktur durchsuchen"
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
            onChangeText={setQuery}
            placeholder="Name, Hostname, IP, Seriennummer"
            placeholderTextColor={colors.subtle}
            returnKeyType="search"
            style={styles.searchInput}
            value={query}
          />
        </View>

        <ScrollView
          contentContainerStyle={styles.chips}
          horizontal
          showsHorizontalScrollIndicator={false}
        >
          {filters.map((entry) => {
            const selected = filter === entry;
            const label =
              entry === "all"
                ? "Alle"
                : entry === "due"
                  ? "Fällig"
                  : categoryLabels[entry];
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected }}
                key={entry}
                onPress={() => setFilter(entry)}
                style={[styles.chip, selected ? styles.chipActive : null]}
              >
                <Text
                  style={[
                    styles.chipText,
                    selected ? styles.chipTextActive : null,
                  ]}
                >
                  {label} {counts.get(entry) ?? 0}
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

        <View style={styles.list}>
          {visible.map((device) => {
            const due = dueById.get(device.id) ?? [];
            const subtitle =
              [
                device.hostname ?? device.ipAddress,
                device.locationName,
                device.rack
                  ? `Rack ${device.rack}${device.rackUnit ? ` / ${device.rackUnit}` : ""}`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ") ||
              [device.manufacturer, device.model].filter(Boolean).join(" ") ||
              categoryLabels[device.category];
            return (
              <Pressable
                accessibilityRole="button"
                key={device.id}
                onPress={() =>
                  router.push(`/infrastructure/${device.id}` as never)
                }
                style={styles.card}
              >
                <View style={styles.icon}>
                  <Ionicons
                    color={colors.primaryText}
                    name={categoryIcons[device.category] as never}
                    size={22}
                  />
                </View>
                <View style={styles.cardCopy}>
                  <Text numberOfLines={1} style={styles.cardTitle}>
                    {device.name}
                  </Text>
                  <Text numberOfLines={1} style={styles.cardMeta}>
                    {subtitle}
                  </Text>
                  <View style={styles.badgeRow}>
                    <Text
                      style={[
                        styles.badge,
                        device.lifecycleState === "active"
                          ? styles.badgeSuccess
                          : device.lifecycleState === "repair"
                            ? styles.badgeWarn
                            : null,
                      ]}
                    >
                      {lifecycleLabels[device.lifecycleState] ??
                        device.lifecycleState}
                    </Text>
                    {due.map((item) => (
                      <Text
                        key={item.reason}
                        style={[
                          styles.badge,
                          item.overdue ? styles.badgeError : styles.badgeWarn,
                        ]}
                      >
                        {item.label} {formatDay(item.dueOn)}
                      </Text>
                    ))}
                  </View>
                </View>
                <Ionicons
                  color={colors.subtle}
                  name="chevron-forward"
                  size={19}
                />
              </Pressable>
            );
          })}
          {!error && visible.length === 0 ? (
            <View style={styles.emptyCard}>
              <NetworkIcon color={colors.primaryText} size={28} />
              <Text style={styles.emptyTitle}>Keine Geräte gefunden</Text>
              <Text style={styles.emptyText}>
                {devices.length === 0
                  ? tn("Erfasse Geräte im Webportal unter Infrastruktur.", "Erfassen Sie Geräte im Webportal unter Infrastruktur.")
                  : tn("Passe die Suche oder den Filter an.", "Passen Sie die Suche oder den Filter an.")}
              </Text>
            </View>
          ) : null}
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

const useStyles = makeThemedStyles((c) => ({
  badge: {
    backgroundColor: c.infoSoft,
    borderRadius: 8,
    color: c.info,
    fontSize: 10,
    fontWeight: "800",
    overflow: "hidden",
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  badgeError: { backgroundColor: c.errorSoft, color: c.error },
  badgeRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 },
  badgeSuccess: { backgroundColor: c.successSoft, color: c.success },
  badgeWarn: { backgroundColor: c.warningSoft, color: c.warning },
  card: {
    alignItems: "center",
    backgroundColor: c.surface,
    borderColor: c.border,
    borderRadius: 19,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    padding: 14,
  },
  cardCopy: { flex: 1, gap: 3 },
  cardMeta: { color: c.muted, fontSize: 12 },
  cardTitle: { color: c.foreground, fontSize: 15, fontWeight: "800" },
  centered: { alignItems: "center", flex: 1, justifyContent: "center" },
  chip: {
    backgroundColor: c.surface,
    borderColor: c.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 13,
    paddingVertical: 7,
  },
  chipActive: { backgroundColor: c.primary, borderColor: c.primary },
  chipText: { color: c.text, fontSize: 12, fontWeight: "700" },
  chipTextActive: { color: c.onPrimary },
  chips: { gap: 8 },
  content: { gap: 16, paddingBottom: 34, paddingTop: 18 },
  emptyCard: {
    alignItems: "center",
    backgroundColor: c.surface,
    borderColor: c.border,
    borderRadius: 20,
    borderWidth: 1,
    gap: 7,
    padding: 30,
  },
  emptyText: {
    color: c.muted,
    fontSize: 12,
    lineHeight: 18,
    textAlign: "center",
  },
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
  icon: {
    alignItems: "center",
    backgroundColor: c.primarySoft,
    borderRadius: 14,
    height: 46,
    justifyContent: "center",
    width: 46,
  },
  kpi: {
    backgroundColor: c.surface,
    borderColor: c.border,
    borderRadius: 16,
    borderWidth: 1,
    flex: 1,
    paddingHorizontal: 8,
    paddingVertical: 10,
  },
  kpiLabel: { color: c.muted, fontSize: 11, fontWeight: "700" },
  kpiRow: { flexDirection: "row", gap: 8 },
  kpiValue: { color: c.foreground, fontSize: 22, fontWeight: "900" },
  kpiWarn: { color: c.warning },
  list: { gap: 10 },
  searchInput: { color: c.text, flex: 1, fontSize: 13, paddingVertical: 4 },
  searchRow: {
    alignItems: "center",
    backgroundColor: c.surface,
    borderColor: c.borderStrong,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    gap: 9,
    paddingHorizontal: 12,
    paddingVertical: 7,
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
