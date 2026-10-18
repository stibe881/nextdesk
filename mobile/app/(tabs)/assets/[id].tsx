import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import {
  MobileFeatureLoadingScreen,
  MobileFeatureUnavailableScreen,
  useMobileFeatures,
} from "@/components/mobile-feature-gate";
import { useMobileNetworkStatus } from "@/components/offline-status";
import { getMobileAsset, type MobileAssetDetail } from "@/lib/asset-registry";
import { loadCurrentTenant } from "@/lib/nextdesk-client";
import { makeThemedStyles, useAppColors } from "@/lib/themed-styles";
import { useMobileSessionGuard } from "@/lib/use-mobile-session-guard";

function valueOrDash(value: string | null | undefined): string {
  return value?.trim() || "—";
}

function displayDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat("de-CH", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
}

export default function AssetDetailScreen() {
  const router = useRouter();
  const styles = useStyles();
  const colors = useAppColors();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const checkingSession = useMobileSessionGuard();
  const { isEnabled, loading: checkingFeatures } = useMobileFeatures();
  const assetsEnabled = isEnabled("assets.management");
  const { recoveryEpoch } = useMobileNetworkStatus();
  const [detail, setDetail] = useState<MobileAssetDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError("");
    try {
      const tenant = await loadCurrentTenant();
      setDetail(await getMobileAsset(tenant.id, id));
    } catch (nextError) {
      setDetail(null);
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Das Asset konnte nicht geladen werden.",
      );
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      void recoveryEpoch;
      if (!checkingSession && !checkingFeatures && assetsEnabled) void load();
    }, [assetsEnabled, checkingFeatures, checkingSession, load, recoveryEpoch]),
  );

  if (checkingSession || checkingFeatures) {
    return <MobileFeatureLoadingScreen />;
  }

  if (!assetsEnabled) {
    return (
      <MobileFeatureUnavailableScreen
        feature="assets.management"
        title="Assetdetails"
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

  if (!detail) {
    return (
      <ScreenContainer className="px-5">
        <View style={styles.errorPage}>
          <Ionicons
            color={colors.error}
            name="alert-circle-outline"
            size={31}
          />
          <Text style={styles.errorTitle}>Asset nicht verfügbar</Text>
          <Text style={styles.errorText}>
            {error || "Dieses Asset ist nicht verfügbar."}
          </Text>
          <Pressable
            onPress={() => router.back()}
            style={styles.secondaryButton}
          >
            <Text style={styles.secondaryButtonText}>Zurück zu Assets</Text>
          </Pressable>
        </View>
      </ScreenContainer>
    );
  }

  const { asset, integration, location, lifecycle } = detail;
  const integrationRows = integration
    ? [
        [
          "Intune-Gerätename",
          valueOrDash(integration.managed_device_name as string | null),
        ],
        [
          "Betriebssystem",
          valueOrDash(integration.operating_system as string | null),
        ],
        ["OS-Version", valueOrDash(integration.os_version as string | null)],
        [
          "Compliance",
          valueOrDash(integration.compliance_state as string | null),
        ],
        [
          "Verschlüsselung",
          integration.is_encrypted === true
            ? "Aktiv"
            : integration.is_encrypted === false
              ? "Nicht aktiv"
              : "—",
        ],
        [
          "Zuletzt gesehen",
          displayDate(integration.last_seen_at as string | null),
        ],
      ]
    : [];

  return (
    <ScreenContainer className="px-5">
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.topbar}>
          <Pressable
            accessibilityLabel="Zurück"
            onPress={() => router.back()}
            style={styles.backButton}
          >
            <Ionicons color={colors.primaryText} name="arrow-back" size={23} />
          </Pressable>
          <Text style={styles.headerTitle}>Assetdetails</Text>
          <View style={styles.backButton} />
        </View>

        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            <Ionicons
              color={colors.primaryText}
              name="laptop-outline"
              size={29}
            />
          </View>
          <View style={styles.heroCopy}>
            <Text style={styles.eyebrow}>ASSET</Text>
            <Text style={styles.assetName}>{asset.name}</Text>
            <Text style={styles.lifecycle}>
              {asset.lifecycleState.replaceAll("_", " ")}
            </Text>
          </View>
        </View>

        <InfoCard
          rows={[
            ["Inventarnummer", valueOrDash(asset.inventoryNumber)],
            ["Asset-Tag", valueOrDash(asset.assetTag)],
            ["Seriennummer", valueOrDash(asset.serialNumber)],
            ["Standort", valueOrDash(location?.name)],
          ]}
          title="Inventar"
        />
        <InfoCard
          rows={[
            ["Hersteller", valueOrDash(asset.manufacturer)],
            ["Modell", valueOrDash(asset.model)],
            ["Typ", valueOrDash(asset.kind)],
            ["Betriebssystem", valueOrDash(asset.operatingSystem)],
          ]}
          title="Gerät"
        />
        {integrationRows.length ? (
          <InfoCard rows={integrationRows} title="Microsoft Intune" />
        ) : null}
        {lifecycle.length ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Lebenszyklus</Text>
            {lifecycle.slice(0, 5).map((event) => (
              <View key={event.id} style={styles.timelineRow}>
                <View style={styles.timelineDot} />
                <View style={styles.timelineCopy}>
                  <Text style={styles.timelineState}>
                    {event.next_state.replaceAll("_", " ")}
                  </Text>
                  <Text style={styles.timelineDate}>
                    {displayDate(event.occurred_at)}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </ScreenContainer>
  );
}

function InfoCard({ title, rows }: { title: string; rows: string[][] }) {
  const styles = useStyles();

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      <View style={styles.rows}>
        {rows.map(([label, value]) => (
          <View key={label} style={styles.row}>
            <Text style={styles.rowLabel}>{label}</Text>
            <Text numberOfLines={2} style={styles.rowValue}>
              {value}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const useStyles = makeThemedStyles((c) => ({
  assetName: {
    color: c.foreground,
    fontSize: 23,
    fontWeight: "900",
    letterSpacing: -0.5,
    marginTop: 2,
  },
  backButton: {
    alignItems: "center",
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  card: {
    backgroundColor: c.surface,
    borderColor: c.border,
    borderRadius: 20,
    borderWidth: 1,
    gap: 13,
    padding: 18,
  },
  cardTitle: { color: c.foreground, fontSize: 15, fontWeight: "900" },
  centered: { alignItems: "center", flex: 1, justifyContent: "center" },
  content: { gap: 15, paddingBottom: 34, paddingTop: 13 },
  errorPage: {
    alignItems: "center",
    flex: 1,
    gap: 10,
    justifyContent: "center",
    padding: 28,
  },
  errorText: {
    color: c.error,
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
  },
  errorTitle: { color: c.error, fontSize: 18, fontWeight: "900" },
  eyebrow: {
    color: c.muted,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.1,
  },
  headerTitle: { color: c.foreground, fontSize: 18, fontWeight: "900" },
  hero: {
    alignItems: "center",
    backgroundColor: c.primarySoft,
    borderRadius: 22,
    flexDirection: "row",
    gap: 14,
    padding: 18,
  },
  heroCopy: { flex: 1 },
  heroIcon: {
    alignItems: "center",
    backgroundColor: c.surface,
    borderRadius: 16,
    height: 54,
    justifyContent: "center",
    width: 54,
  },
  lifecycle: {
    color: c.primaryText,
    fontSize: 12,
    fontWeight: "800",
    marginTop: 6,
    textTransform: "capitalize",
  },
  row: { flexDirection: "row", gap: 12, justifyContent: "space-between" },
  rowLabel: { color: c.muted, flex: 1, fontSize: 12 },
  rowValue: {
    color: c.text,
    flex: 1.2,
    fontSize: 12,
    fontWeight: "700",
    textAlign: "right",
  },
  rows: { gap: 10 },
  secondaryButton: {
    backgroundColor: c.primarySoft,
    borderRadius: 12,
    marginTop: 4,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  secondaryButtonText: {
    color: c.primaryText,
    fontSize: 13,
    fontWeight: "800",
  },
  timelineCopy: { flex: 1 },
  timelineDate: { color: c.muted, fontSize: 11, marginTop: 2 },
  timelineDot: {
    backgroundColor: c.primaryText,
    borderRadius: 5,
    height: 10,
    marginTop: 4,
    width: 10,
  },
  timelineRow: { flexDirection: "row", gap: 10 },
  timelineState: {
    color: c.text,
    fontSize: 13,
    fontWeight: "800",
    textTransform: "capitalize",
  },
  topbar: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
}));
