import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
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

import {
  IpamAccessDenied,
  IpamAddressItem,
  IpamErrorCard,
  IpamOffline,
  IpamUsageBar,
  useIpamStyles,
} from "@/components/ipam-overview-parts";
import { useMobileNetworkStatus } from "@/components/offline-status";
import { ScreenContainer } from "@/components/screen-container";
import { tn } from "@/lib/formality";
import {
  formatIpamCount,
  ipamAddressHref,
  ipamHasMoreAddresses,
  ipamPrefixStatusLabel,
  ipamVlanLabel,
  isIpamAccessDenied,
  isIpamId,
  loadIpamPrefix,
  matchesIpamAddress,
  type IpamAddressRow,
  type IpamPrefixDetailData,
} from "@/lib/ipam-overview";
import { loadCurrentTenant } from "@/lib/nextdesk-client";
import { useAppColors } from "@/lib/themed-styles";
import { useMobileSessionGuard } from "@/lib/use-mobile-session-guard";

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/** Subnetz aus «IP-Adressen»: Eckdaten, Auslastung und erfasste Adressen. */
export default function IpamPrefixScreen() {
  const { id: raw } = useLocalSearchParams<{ id?: string }>();
  const prefixId = isIpamId(raw) ? raw.toLowerCase() : null;
  const router = useRouter();
  const styles = useIpamStyles();
  const colors = useAppColors();
  const checkingSession = useMobileSessionGuard();
  const { isOffline, recoveryEpoch } = useMobileNetworkStatus();
  const [detail, setDetail] = useState<IpamPrefixDetailData | null>(null);
  const [addresses, setAddresses] = useState<IpamAddressRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [denied, setDenied] = useState(false);
  const [filter, setFilter] = useState("");

  const handleError = useCallback((nextError: unknown) => {
    if (isIpamAccessDenied(nextError)) {
      setDenied(true);
      setDetail(null);
    } else {
      setError(
        errorText(nextError, "Das Subnetz konnte nicht geladen werden."),
      );
    }
  }, []);

  const load = useCallback(
    async (pull = false) => {
      if (!prefixId) {
        setLoading(false);
        return;
      }
      setError("");
      if (pull) setRefreshing(true);
      try {
        const tenant = await loadCurrentTenant();
        const next = await loadIpamPrefix(tenant.id, prefixId, 0);
        setDetail(next);
        setAddresses(next.addresses);
        setDenied(false);
      } catch (nextError) {
        handleError(nextError);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [handleError, prefixId],
  );

  const loadMore = async () => {
    if (!detail || !prefixId || loadingMore) return;
    setLoadingMore(true);
    setError("");
    try {
      const tenant = await loadCurrentTenant();
      const next = await loadIpamPrefix(tenant.id, prefixId, detail.page + 1);
      setDetail(next);
      setAddresses((current) => {
        const known = new Set(current.map((row) => row.id));
        return [
          ...current,
          ...next.addresses.filter((row) => !known.has(row.id)),
        ];
      });
    } catch (nextError) {
      handleError(nextError);
    } finally {
      setLoadingMore(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      void recoveryEpoch;
      if (!checkingSession) void load();
    }, [checkingSession, load, recoveryEpoch]),
  );

  const visible = useMemo(
    () => addresses.filter((row) => matchesIpamAddress(row, filter)),
    [addresses, filter],
  );

  if (checkingSession || (loading && !detail && !denied && prefixId)) {
    return (
      <ScreenContainer className="px-5">
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      </ScreenContainer>
    );
  }

  const prefix = detail?.prefix ?? null;
  const info: [string, string | null][] = detail
    ? [
        ["Status", ipamPrefixStatusLabel(detail.prefix.status)],
        ["VLAN", ipamVlanLabel(detail.vlan)],
        ["Standort", detail.site?.name ?? null],
        ["VRF", detail.vrf?.name ?? null],
        ["Zone", detail.prefix.securityZone],
        ["Gateway", detail.prefix.gateway],
        [
          "DHCP-Bereich",
          detail.prefix.dhcpStart && detail.prefix.dhcpEnd
            ? `${detail.prefix.dhcpStart} – ${detail.prefix.dhcpEnd}`
            : null,
        ],
        ["Nächste freie", detail.nextFree],
      ]
    : [];

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
        <Pressable
          accessibilityLabel="Zurück zu IP-Adressen"
          accessibilityRole="button"
          onPress={() =>
            router.canGoBack()
              ? router.back()
              : router.replace("/ipam" as never)
          }
          style={styles.back}
        >
          <Ionicons color={colors.primaryText} name="chevron-back" size={20} />
          <Text style={styles.backText}>IP-Adressen</Text>
        </Pressable>
        <View>
          <Text style={styles.eyebrow}>SUBNETZ</Text>
          <Text selectable style={styles.title}>
            {prefix?.prefix ?? "Unbekanntes Subnetz"}
          </Text>
          {prefix?.description ? (
            <Text style={styles.subtitle}>{prefix.description}</Text>
          ) : null}
        </View>

        {denied ? (
          <IpamAccessDenied />
        ) : !detail && isOffline ? (
          <IpamOffline />
        ) : (
          <>
            {error ? <IpamErrorCard message={error} /> : null}
            {!prefixId ? (
              <IpamErrorCard message="Der Link zum Subnetz ist ungültig." />
            ) : null}
            {detail ? (
              <>
                <View style={styles.card}>
                  {prefix && prefix.status !== "container" ? (
                    <IpamUsageBar
                      usage={prefix.usage}
                      warningPercent={prefix.warningPercent}
                    />
                  ) : null}
                  {info
                    .filter((row): row is [string, string] => Boolean(row[1]))
                    .map(([label, value]) => (
                      <View key={label} style={styles.infoRow}>
                        <Text style={styles.infoLabel}>{label}</Text>
                        <Text selectable style={styles.infoValue}>
                          {value}
                        </Text>
                      </View>
                    ))}
                </View>

                <Text style={styles.eyebrow}>
                  {`ADRESSEN · ${formatIpamCount(detail.total)}`}
                </Text>
                {addresses.length ? (
                  <View style={styles.searchRow}>
                    <Ionicons
                      color={colors.subtle}
                      name="filter-outline"
                      size={18}
                    />
                    <TextInput
                      accessibilityLabel="Adressen filtern"
                      autoCapitalize="none"
                      autoCorrect={false}
                      clearButtonMode="while-editing"
                      onChangeText={setFilter}
                      placeholder="IP, Hostname oder MAC filtern"
                      placeholderTextColor={colors.subtle}
                      style={styles.searchInput}
                      value={filter}
                    />
                  </View>
                ) : null}
                {visible.length ? (
                  <View style={styles.list}>
                    {visible.map((row) => {
                      const href = ipamAddressHref(row.address);
                      return (
                        <IpamAddressItem
                          address={row}
                          key={row.id}
                          onPress={
                            href ? () => router.push(href as never) : null
                          }
                        />
                      );
                    })}
                  </View>
                ) : (
                  <View style={styles.card}>
                    <Text style={styles.cardMeta}>
                      {addresses.length
                        ? tn(
                            "Keine geladene Adresse passt zum Filter. Passe den Filter an.",
                            "Keine geladene Adresse passt zum Filter. Passen Sie den Filter an.",
                          )
                        : "In diesem Subnetz sind keine Adressen erfasst."}
                    </Text>
                  </View>
                )}
                {ipamHasMoreAddresses(detail, addresses.length) ? (
                  <Pressable
                    accessibilityRole="button"
                    disabled={loadingMore}
                    onPress={() => void loadMore()}
                    style={styles.more}
                  >
                    {loadingMore ? (
                      <ActivityIndicator color={colors.primary} size="small" />
                    ) : (
                      <Text style={styles.moreText}>
                        {`Weitere Adressen laden (${formatIpamCount(addresses.length)} von ${formatIpamCount(detail.total)})`}
                      </Text>
                    )}
                  </Pressable>
                ) : null}
              </>
            ) : null}
          </>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}
