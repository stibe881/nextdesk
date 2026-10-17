import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { getMobileAsset, type MobileAssetDetail } from "@/lib/asset-registry";
import { loadCurrentTenant } from "@/lib/nextdesk-client";
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
  const { id } = useLocalSearchParams<{ id?: string }>();
  const checkingSession = useMobileSessionGuard();
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
      if (!checkingSession) void load();
    }, [checkingSession, load]),
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

  if (!detail) {
    return (
      <ScreenContainer containerClassName="bg-[#F6F7FB]" className="px-5">
        <View style={styles.errorPage}>
          <Ionicons color="#B42335" name="alert-circle-outline" size={31} />
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
    <ScreenContainer containerClassName="bg-[#F6F7FB]" className="px-5">
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
            <Ionicons color="#4438CA" name="arrow-back" size={23} />
          </Pressable>
          <Text style={styles.headerTitle}>Assetdetails</Text>
          <View style={styles.backButton} />
        </View>

        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            <Ionicons color="#4438CA" name="laptop-outline" size={29} />
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

const styles = StyleSheet.create({
  assetName: {
    color: "#202136",
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
    backgroundColor: "#FFFFFF",
    borderColor: "#E8E7F0",
    borderRadius: 20,
    borderWidth: 1,
    gap: 13,
    padding: 18,
  },
  cardTitle: { color: "#36364A", fontSize: 15, fontWeight: "900" },
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
    color: "#862334",
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
  },
  errorTitle: { color: "#8E2433", fontSize: 18, fontWeight: "900" },
  eyebrow: {
    color: "#77758C",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.1,
  },
  headerTitle: { color: "#202136", fontSize: 18, fontWeight: "900" },
  hero: {
    alignItems: "center",
    backgroundColor: "#F0EEFF",
    borderRadius: 22,
    flexDirection: "row",
    gap: 14,
    padding: 18,
  },
  heroCopy: { flex: 1 },
  heroIcon: {
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    height: 54,
    justifyContent: "center",
    width: 54,
  },
  lifecycle: {
    color: "#4438CA",
    fontSize: 12,
    fontWeight: "800",
    marginTop: 6,
    textTransform: "capitalize",
  },
  row: { flexDirection: "row", gap: 12, justifyContent: "space-between" },
  rowLabel: { color: "#77758C", flex: 1, fontSize: 12 },
  rowValue: {
    color: "#303145",
    flex: 1.2,
    fontSize: 12,
    fontWeight: "700",
    textAlign: "right",
  },
  rows: { gap: 10 },
  secondaryButton: {
    backgroundColor: "#F0EEFF",
    borderRadius: 12,
    marginTop: 4,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  secondaryButtonText: { color: "#4438CA", fontSize: 13, fontWeight: "800" },
  timelineCopy: { flex: 1 },
  timelineDate: { color: "#77758C", fontSize: 11, marginTop: 2 },
  timelineDot: {
    backgroundColor: "#6D62D7",
    borderRadius: 5,
    height: 10,
    marginTop: 4,
    width: 10,
  },
  timelineRow: { flexDirection: "row", gap: 10 },
  timelineState: {
    color: "#35364A",
    fontSize: 13,
    fontWeight: "800",
    textTransform: "capitalize",
  },
  topbar: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
});
