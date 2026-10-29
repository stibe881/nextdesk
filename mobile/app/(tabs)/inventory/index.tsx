import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import {
  MobileFeatureLoadingScreen,
  MobileFeatureUnavailableScreen,
  useMobileFeatures,
} from "@/components/mobile-feature-gate";
import { useMobileNetworkStatus } from "@/components/offline-status";
import {
  loadMobileInventory,
  type MobileInventoryOverview,
} from "@/lib/inventory";
import { loadCurrentTenant } from "@/lib/nextdesk-client";
import { makeThemedStyles, useAppColors } from "@/lib/themed-styles";
import { useMobileSessionGuard } from "@/lib/use-mobile-session-guard";

const quantityFormat = new Intl.NumberFormat("de-CH", {
  maximumFractionDigits: 2,
});

export default function InventoryScreen() {
  const router = useRouter();
  const styles = useStyles();
  const colors = useAppColors();
  const checkingSession = useMobileSessionGuard();
  const { isEnabled, loading: checkingFeatures } = useMobileFeatures();
  const inventoryEnabled = isEnabled("inventory.management");
  const { recoveryEpoch } = useMobileNetworkStatus();
  const [overview, setOverview] = useState<MobileInventoryOverview | null>(
    null,
  );
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (pull = false) => {
    setError("");
    if (pull) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    try {
      const tenant = await loadCurrentTenant();
      setOverview(await loadMobileInventory(tenant.id));
    } catch (nextError) {
      setOverview(null);
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Das Lager konnte nicht geladen werden.",
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void recoveryEpoch;
      if (!checkingSession && !checkingFeatures && inventoryEnabled) {
        void load();
      }
    }, [checkingFeatures, checkingSession, inventoryEnabled, load, recoveryEpoch]),
  );

  const lowStock = useMemo(
    () => new Set(overview?.lowStockIds ?? []),
    [overview],
  );
  const items = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("de-CH");
    return (overview?.items ?? []).filter(
      (item) =>
        !needle ||
        `${item.name} ${item.articleNumber ?? ""} ${item.locationName ?? ""}`
          .toLocaleLowerCase("de-CH")
          .includes(needle),
    );
  }, [overview, query]);

  if (checkingSession || checkingFeatures) {
    return <MobileFeatureLoadingScreen />;
  }

  if (!inventoryEnabled) {
    return (
      <MobileFeatureUnavailableScreen
        feature="inventory.management"
        title="Lager"
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
        <View style={styles.headingRow}>
          <View style={styles.headingCopy}>
            <Text style={styles.eyebrow}>LAGER</Text>
            <Text style={styles.title}>Bestände</Text>
            <Text style={styles.subtitle}>
              {overview?.items.length === 1
                ? "1 Artikel"
                : `${overview?.items.length ?? 0} Artikel`}
            </Text>
          </View>
          <Pressable
            accessibilityLabel="Zum Assetscanner"
            accessibilityRole="button"
            onPress={() => router.push("/assets/scan" as never)}
            style={styles.scanButton}
          >
            <Ionicons color={colors.onPrimary} name="scan-outline" size={24} />
          </Pressable>
        </View>

        {overview ? (
          <View style={styles.summaryRow}>
            <View
              style={[
                styles.summaryCard,
                overview.criticalItemCount > 0 && styles.summaryCardAlert,
              ]}
            >
              <Text style={styles.summaryValue}>
                {overview.criticalItemCount}
              </Text>
              <Text style={styles.summaryLabel}>Unterbestand</Text>
            </View>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryValue}>
                {overview.openReservationCount}
              </Text>
              <Text style={styles.summaryLabel}>Reservationen</Text>
            </View>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryValue}>
                {overview.activeCountSessionCount}
              </Text>
              <Text style={styles.summaryLabel}>Inventuren</Text>
            </View>
          </View>
        ) : null}

        <View style={styles.searchRow}>
          <Ionicons color={colors.subtle} name="search-outline" size={19} />
          <TextInput
            accessibilityLabel="Lager durchsuchen"
            autoCapitalize="none"
            clearButtonMode="while-editing"
            onChangeText={setQuery}
            placeholder="Artikel, Nummer oder Lagerort"
            placeholderTextColor={colors.subtle}
            style={styles.searchInput}
            value={query}
          />
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

        <View style={styles.list}>
          {items.map((item) => (
            <View key={item.id} style={styles.itemCard}>
              <View style={styles.itemIcon}>
                <Ionicons
                  color={colors.primaryText}
                  name="cube-outline"
                  size={22}
                />
              </View>
              <View style={styles.itemCopy}>
                <Text numberOfLines={1} style={styles.itemName}>
                  {item.name}
                </Text>
                <Text numberOfLines={1} style={styles.itemMeta}>
                  {[item.articleNumber, item.locationName]
                    .filter(Boolean)
                    .join(" · ") || "Kein Lagerort hinterlegt"}
                </Text>
                {lowStock.has(item.id) ? (
                  <Text style={styles.lowBadge}>Unter Mindestbestand</Text>
                ) : null}
              </View>
              <View style={styles.quantity}>
                <Text style={styles.quantityValue}>
                  {quantityFormat.format(item.availableQuantity)}
                </Text>
                <Text style={styles.quantityUnit}>
                  {item.unit} verfügbar
                </Text>
                {item.reservedQuantity > 0 ? (
                  <Text style={styles.quantityUnit}>
                    {quantityFormat.format(item.reservedQuantity)} reserviert
                  </Text>
                ) : null}
              </View>
            </View>
          ))}
          {!error && items.length === 0 ? (
            <View style={styles.emptyCard}>
              <Ionicons
                color={colors.primaryText}
                name="file-tray-outline"
                size={28}
              />
              <Text style={styles.emptyTitle}>Keine Artikel gefunden</Text>
              <Text style={styles.emptyText}>
                Passe die Suche an oder ziehe die Ansicht zum Aktualisieren nach
                unten.
              </Text>
            </View>
          ) : null}
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

const useStyles = makeThemedStyles((c) => ({
  centered: { alignItems: "center", flex: 1, justifyContent: "center" },
  content: { gap: 18, paddingBottom: 34, paddingTop: 18 },
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
  emptyTitle: {
    color: c.foreground,
    fontSize: 15,
    fontWeight: "800",
    marginTop: 2,
  },
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
  headingCopy: { flex: 1 },
  headingRow: { alignItems: "flex-start", flexDirection: "row", gap: 14 },
  itemCard: {
    alignItems: "center",
    backgroundColor: c.surface,
    borderColor: c.border,
    borderRadius: 19,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    padding: 14,
  },
  itemCopy: { flex: 1, gap: 3 },
  itemIcon: {
    alignItems: "center",
    backgroundColor: c.primarySoft,
    borderRadius: 14,
    height: 46,
    justifyContent: "center",
    width: 46,
  },
  itemMeta: { color: c.muted, fontSize: 12 },
  itemName: { color: c.foreground, fontSize: 15, fontWeight: "800" },
  list: { gap: 10 },
  lowBadge: {
    alignSelf: "flex-start",
    backgroundColor: c.errorSoft,
    borderRadius: 8,
    color: c.error,
    fontSize: 10,
    fontWeight: "800",
    marginTop: 4,
    overflow: "hidden",
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  quantity: { alignItems: "flex-end", gap: 1 },
  quantityUnit: { color: c.muted, fontSize: 10 },
  quantityValue: { color: c.foreground, fontSize: 20, fontWeight: "900" },
  scanButton: {
    alignItems: "center",
    backgroundColor: c.primary,
    borderRadius: 16,
    height: 52,
    justifyContent: "center",
    width: 52,
  },
  searchInput: { color: c.text, flex: 1, fontSize: 13, paddingVertical: 8 },
  searchRow: {
    alignItems: "center",
    backgroundColor: c.surface,
    borderColor: c.borderStrong,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    gap: 9,
    paddingHorizontal: 12,
  },
  subtitle: { color: c.muted, fontSize: 13, marginTop: 4 },
  summaryCard: {
    backgroundColor: c.surface,
    borderColor: c.border,
    borderRadius: 16,
    borderWidth: 1,
    flex: 1,
    gap: 2,
    padding: 12,
  },
  summaryCardAlert: { backgroundColor: c.errorSoft, borderColor: c.error },
  summaryLabel: { color: c.muted, fontSize: 11, fontWeight: "700" },
  summaryRow: { flexDirection: "row", gap: 10 },
  summaryValue: { color: c.foreground, fontSize: 22, fontWeight: "900" },
  title: {
    color: c.foreground,
    fontSize: 30,
    fontWeight: "900",
    letterSpacing: -0.8,
    marginTop: 3,
  },
}));
