import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { listMobileAssets, type MobileAsset } from "@/lib/asset-registry";
import { loadCurrentTenant } from "@/lib/nextdesk-client";
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
  const checkingSession = useMobileSessionGuard();
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
      if (!checkingSession) void load("");
    }, [checkingSession, load]),
  );

  const description = useMemo(
    () =>
      assets.length === 1
        ? "1 Asset im eigenen Mandanten"
        : `${assets.length} Assets im eigenen Mandanten`,
    [assets.length],
  );

  if (checkingSession || loading) {
    return (
      <ScreenContainer containerClassName="bg-[#F6F7FB]" className="px-5">
        <View style={styles.centered}>
          <ActivityIndicator color="#4438CA" size="large" />
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer containerClassName="bg-[#F6F7FB]" className="px-5">
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void load(query, true)}
            tintColor="#4438CA"
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
            <Ionicons color="#FFFFFF" name="scan-outline" size={24} />
          </Pressable>
        </View>

        <View style={styles.searchRow}>
          <Ionicons color="#817F95" name="search-outline" size={19} />
          <TextInput
            accessibilityLabel="Assets durchsuchen"
            autoCapitalize="none"
            clearButtonMode="while-editing"
            onChangeText={setQuery}
            onSubmitEditing={() => void load(query)}
            placeholder="Name, Inventar- oder Seriennummer"
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
            <Ionicons color="#4438CA" name="arrow-forward" size={18} />
          </Pressable>
        </View>

        {error ? (
          <View style={styles.errorCard}>
            <Ionicons color="#B42335" name="alert-circle-outline" size={19} />
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
                <Ionicons color="#4438CA" name="laptop-outline" size={22} />
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
              <Ionicons color="#9A98A8" name="chevron-forward" size={19} />
            </Pressable>
          ))}
          {!error && assets.length === 0 ? (
            <View style={styles.emptyCard}>
              <Ionicons color="#6D62D7" name="cube-outline" size={28} />
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

const styles = StyleSheet.create({
  assetCard: {
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderColor: "#E8E7F0",
    borderRadius: 19,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    padding: 14,
  },
  assetCopy: { flex: 1, gap: 3 },
  assetIcon: {
    alignItems: "center",
    backgroundColor: "#F0EEFF",
    borderRadius: 14,
    height: 46,
    justifyContent: "center",
    width: 46,
  },
  assetMeta: { color: "#76748A", fontSize: 12 },
  assetName: { color: "#25263A", fontSize: 15, fontWeight: "800" },
  badge: {
    backgroundColor: "#E8F6FB",
    borderRadius: 8,
    color: "#087A95",
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
    color: "#35725E",
    fontSize: 10,
    fontWeight: "700",
    textTransform: "capitalize",
  },
  content: { gap: 18, paddingBottom: 34, paddingTop: 18 },
  emptyCard: {
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderColor: "#E8E7F0",
    borderRadius: 20,
    borderWidth: 1,
    gap: 7,
    padding: 30,
  },
  emptyText: {
    color: "#76748A",
    fontSize: 12,
    lineHeight: 18,
    textAlign: "center",
  },
  emptyTitle: {
    color: "#34354A",
    fontSize: 15,
    fontWeight: "800",
    marginTop: 2,
  },
  errorCard: {
    alignItems: "flex-start",
    backgroundColor: "#FFF1F3",
    borderRadius: 16,
    flexDirection: "row",
    gap: 9,
    padding: 13,
  },
  errorText: { color: "#982435", flex: 1, fontSize: 12, lineHeight: 18 },
  eyebrow: {
    color: "#77758C",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.2,
  },
  headingCopy: { flex: 1 },
  headingRow: { alignItems: "flex-start", flexDirection: "row", gap: 14 },
  list: { gap: 10 },
  scanButton: {
    alignItems: "center",
    backgroundColor: "#4438CA",
    borderRadius: 16,
    height: 52,
    justifyContent: "center",
    width: 52,
  },
  searchButton: {
    alignItems: "center",
    backgroundColor: "#F0EEFF",
    borderRadius: 11,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  searchInput: { color: "#303145", flex: 1, fontSize: 13, paddingVertical: 0 },
  searchRow: {
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderColor: "#DFDEE8",
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    gap: 9,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  subtitle: { color: "#6B7280", fontSize: 13, marginTop: 4 },
  title: {
    color: "#202136",
    fontSize: 30,
    fontWeight: "900",
    letterSpacing: -0.8,
    marginTop: 3,
  },
});
