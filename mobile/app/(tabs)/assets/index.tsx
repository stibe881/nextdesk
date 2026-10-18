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
import { listMobileAssets, type MobileAsset } from "@/lib/asset-registry";
import { loadCurrentTenant } from "@/lib/nextdesk-client";
import { makeThemedStyles, useAppColors } from "@/lib/themed-styles";
import { useMobileSessionGuard } from "@/lib/use-mobile-session-guard";

function statusLabel(value: string): string {
  return value.replaceAll("_", " ");
}

function assetSubtitle(asset: MobileAsset): string {
  return (
    [
      asset.manufacturer,
      asset.model,
      asset.serialNumber ?? asset.inventoryNumber,
    ]
      .filter(Boolean)
      .join(" · ") || "Keine technischen Details hinterlegt"
  );
}

export default function AssetsScreen() {
  const router = useRouter();
  const styles = useStyles();
  const colors = useAppColors();
  const checkingSession = useMobileSessionGuard();
  const { isEnabled, loading: checkingFeatures } = useMobileFeatures();
  const assetsEnabled = isEnabled("assets.management");
  const { recoveryEpoch } = useMobileNetworkStatus();
  const [assets, setAssets] = useState<MobileAsset[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(
    async (search = query, pull = false) => {
      setError("");
      if (pull) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      try {
        const tenant = await loadCurrentTenant();
        setAssets(await listMobileAssets(tenant.id, search));
      } catch (nextError) {
        setAssets([]);
        setError(
          nextError instanceof Error
            ? nextError.message
            : "Assets konnten nicht geladen werden.",
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [query],
  );

  useFocusEffect(
    useCallback(() => {
      void recoveryEpoch;
      if (!checkingSession && !checkingFeatures && assetsEnabled) void load();
    }, [assetsEnabled, checkingFeatures, checkingSession, load, recoveryEpoch]),
  );

  const description = useMemo(
    () =>
      assets.length === 1
        ? "1 Asset im eigenen Mandanten"
        : `${assets.length} Assets im eigenen Mandanten`,
    [assets.length],
  );

  if (checkingSession || checkingFeatures) {
    return <MobileFeatureLoadingScreen />;
  }

  if (!assetsEnabled) {
    return (
      <MobileFeatureUnavailableScreen
        feature="assets.management"
        title="Assets"
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
            refreshing={refreshing}
            onRefresh={() => void load(query, true)}
            tintColor={colors.primary}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headingRow}>
          <View style={styles.headingCopy}>
            <Text style={styles.eyebrow}>INVENTAR</Text>
            <Text style={styles.title}>Assets</Text>
            <Text style={styles.subtitle}>{description}</Text>
          </View>
          <Pressable
            accessibilityLabel="Asset per QR-Code scannen"
            accessibilityRole="button"
            onPress={() => router.push("/assets/scan" as never)}
            style={styles.scanButton}
          >
            <Ionicons color={colors.onPrimary} name="scan-outline" size={24} />
          </Pressable>
        </View>

        <View style={styles.searchRow}>
          <Ionicons color={colors.subtle} name="search-outline" size={19} />
          <TextInput
            accessibilityLabel="Assets durchsuchen"
            autoCapitalize="none"
            clearButtonMode="while-editing"
            onChangeText={setQuery}
            onSubmitEditing={() => void load(query)}
            placeholder="Name, Inventar- oder Seriennummer"
            placeholderTextColor={colors.subtle}
            returnKeyType="search"
            style={styles.searchInput}
            value={query}
          />
          <Pressable
            accessibilityLabel="Assetsuche starten"
            accessibilityRole="button"
            onPress={() => void load(query)}
            style={styles.searchButton}
          >
            <Ionicons
              color={colors.primaryText}
              name="arrow-forward"
              size={18}
            />
          </Pressable>
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
          {assets.map((asset) => (
            <Pressable
              accessibilityRole="button"
              key={asset.id}
              onPress={() => router.push(`/assets/${asset.id}` as never)}
              style={styles.assetCard}
            >
              <View style={styles.assetIcon}>
                <Ionicons
                  color={colors.primaryText}
                  name="laptop-outline"
                  size={22}
                />
              </View>
              <View style={styles.assetCopy}>
                <Text numberOfLines={1} style={styles.assetName}>
                  {asset.name}
                </Text>
                <Text numberOfLines={1} style={styles.assetMeta}>
                  {assetSubtitle(asset)}
                </Text>
                <View style={styles.badgeRow}>
                  <Text style={styles.badge}>
                    {statusLabel(asset.lifecycleState)}
                  </Text>
                  {asset.complianceState ? (
                    <Text style={styles.compliance}>
                      {asset.complianceState}
                    </Text>
                  ) : null}
                </View>
              </View>
              <Ionicons
                color={colors.subtle}
                name="chevron-forward"
                size={19}
              />
            </Pressable>
          ))}
          {!error && assets.length === 0 ? (
            <View style={styles.emptyCard}>
              <Ionicons
                color={colors.primaryText}
                name="cube-outline"
                size={28}
              />
              <Text style={styles.emptyTitle}>Keine Assets gefunden</Text>
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
  assetCard: {
    alignItems: "center",
    backgroundColor: c.surface,
    borderColor: c.border,
    borderRadius: 19,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    padding: 14,
  },
  assetCopy: { flex: 1, gap: 3 },
  assetIcon: {
    alignItems: "center",
    backgroundColor: c.primarySoft,
    borderRadius: 14,
    height: 46,
    justifyContent: "center",
    width: 46,
  },
  assetMeta: { color: c.muted, fontSize: 12 },
  assetName: { color: c.foreground, fontSize: 15, fontWeight: "800" },
  badge: {
    backgroundColor: c.infoSoft,
    borderRadius: 8,
    color: c.info,
    fontSize: 10,
    fontWeight: "800",
    overflow: "hidden",
    paddingHorizontal: 7,
    paddingVertical: 3,
    textTransform: "capitalize",
  },
  badgeRow: { flexDirection: "row", gap: 6, marginTop: 4 },
  centered: { alignItems: "center", flex: 1, justifyContent: "center" },
  compliance: {
    color: c.success,
    fontSize: 10,
    fontWeight: "700",
    textTransform: "capitalize",
  },
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
  list: { gap: 10 },
  scanButton: {
    alignItems: "center",
    backgroundColor: c.primary,
    borderRadius: 16,
    height: 52,
    justifyContent: "center",
    width: 52,
  },
  searchButton: {
    alignItems: "center",
    backgroundColor: c.primarySoft,
    borderRadius: 11,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  searchInput: { color: c.text, flex: 1, fontSize: 13, paddingVertical: 0 },
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
