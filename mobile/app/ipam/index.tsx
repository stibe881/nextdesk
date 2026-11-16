import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { NetworkIcon } from "@/components/section-icons";
import { tn } from "@/lib/formality";
import {
  formatIpamCount,
  formatIpamPercent,
  groupIpamPrefixes,
  ipamAddressHref,
  ipamExactAddress,
  ipamPrefixHref,
  ipamPrefixMeta,
  ipamPrefixStatusLabel,
  ipamSearchReady,
  ipamV4Percent,
  isIpamAccessDenied,
  loadIpamOverview,
  searchIpam,
  type IpamOverviewData,
  type IpamPrefixRow,
  type IpamSearchResult,
} from "@/lib/ipam-overview";
import { loadCurrentTenant } from "@/lib/nextdesk-client";
import { useAppColors } from "@/lib/themed-styles";
import { useMobileSessionGuard } from "@/lib/use-mobile-session-guard";

const SEARCH_DELAY_MS = 350;

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * «IP-Adressen»: Suche nach Adresse, Hostname oder MAC und Subnetze nach
 * Standort mit Auslastung (nur lesen). Rechte prüft der Server (ipam.read,
 * Modul ipam.management); ohne Zugriff erscheint ein Hinweis statt Fehler.
 */
export default function IpamOverviewScreen() {
  const router = useRouter();
  const styles = useIpamStyles();
  const colors = useAppColors();
  const checkingSession = useMobileSessionGuard();
  const { isOffline, recoveryEpoch } = useMobileNetworkStatus();
  const [data, setData] = useState<IpamOverviewData | null>(null);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [denied, setDenied] = useState(false);
  const [query, setQuery] = useState("");
  // Answer of the server search for one query; stale answers are ignored.
  const [answer, setAnswer] = useState<{
    query: string;
    results: IpamSearchResult | null;
    error: string;
  } | null>(null);
  const searchRun = useRef(0);

  const load = useCallback(async (pull = false) => {
    setError("");
    if (pull) setRefreshing(true);
    try {
      const tenant = await loadCurrentTenant();
      setTenantId(tenant.id);
      setData(await loadIpamOverview(tenant.id));
      setDenied(false);
    } catch (nextError) {
      if (isIpamAccessDenied(nextError)) {
        setDenied(true);
        setData(null);
      } else {
        setError(
          errorText(nextError, "Die IP-Adressen konnten nicht geladen werden."),
        );
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void recoveryEpoch;
      if (!checkingSession) void load();
    }, [checkingSession, load, recoveryEpoch]),
  );

  // Server search with a short delay; only the latest request is shown.
  const trimmed = query.trim();
  const searchable = Boolean(tenantId) && !denied && ipamSearchReady(trimmed);
  useEffect(() => {
    const run = ++searchRun.current;
    if (!tenantId || !searchable) return;
    const timer = setTimeout(() => {
      searchIpam(tenantId, trimmed)
        .then((results) => {
          if (run === searchRun.current) {
            setAnswer({ query: trimmed, results, error: "" });
          }
        })
        .catch((nextError: unknown) => {
          if (run !== searchRun.current) return;
          if (isIpamAccessDenied(nextError)) setDenied(true);
          setAnswer({
            query: trimmed,
            results: null,
            error: errorText(
              nextError,
              "Die Suche konnte nicht ausgeführt werden.",
            ),
          });
        });
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [searchable, tenantId, trimmed]);
  const current = searchable && answer?.query === trimmed ? answer : null;
  const results = current?.results ?? null;
  const searchError = current?.error ?? "";
  const searching = searchable && !current;

  const groups = useMemo(() => (data ? groupIpamPrefixes(data) : []), [data]);
  const vlanById = useMemo(
    () => new Map((data?.vlans ?? []).map((vlan) => [vlan.id, vlan])),
    [data],
  );
  const vrfById = useMemo(
    () => new Map((data?.vrfs ?? []).map((vrf) => [vrf.id, vrf])),
    [data],
  );

  const openAddress = (address: string) => {
    const href = ipamAddressHref(address);
    if (href) router.push(href as never);
  };
  const openPrefix = (prefixId: string) => {
    const href = ipamPrefixHref(prefixId);
    if (href) router.push(href as never);
  };

  const exact = ipamExactAddress(trimmed);
  const exactListed = Boolean(
    exact && results?.addresses.some((row) => row.address === exact),
  );

  const renderPrefix = (prefix: IpamPrefixRow) => (
    <Pressable
      accessibilityRole="button"
      key={prefix.id}
      onPress={() => openPrefix(prefix.id)}
      style={styles.card}
    >
      <View style={styles.cardHead}>
        <Text numberOfLines={1} style={styles.cardTitle}>
          {prefix.description ?? prefix.prefix}
        </Text>
        {prefix.status !== "active" ? (
          <Text style={styles.badge}>
            {ipamPrefixStatusLabel(prefix.status)}
          </Text>
        ) : null}
        <Ionicons color={colors.subtle} name="chevron-forward" size={18} />
      </View>
      {(() => {
        const meta = ipamPrefixMeta(
          prefix,
          prefix.vlanId ? (vlanById.get(prefix.vlanId) ?? null) : null,
          prefix.vrfId ? (vrfById.get(prefix.vrfId) ?? null) : null,
        );
        return meta ? (
          <Text numberOfLines={2} style={styles.cardMeta}>
            {meta}
          </Text>
        ) : null;
      })()}
      {prefix.status !== "container" ? (
        <IpamUsageBar
          usage={prefix.usage}
          warningPercent={prefix.warningPercent}
        />
      ) : null}
    </Pressable>
  );

  const header = (
    <>
      <Pressable
        accessibilityLabel="Zurück"
        accessibilityRole="button"
        onPress={() =>
          router.canGoBack() ? router.back() : router.replace("/")
        }
        style={styles.back}
      >
        <Ionicons color={colors.primaryText} name="chevron-back" size={20} />
        <Text style={styles.backText}>Zurück</Text>
      </Pressable>
      <View>
        <Text style={styles.eyebrow}>NETZWERK</Text>
        <Text style={styles.title}>IP-Adressen</Text>
        {data ? (
          <Text style={styles.subtitle}>
            {`${formatIpamCount(data.kpis.prefixCount)} Subnetze · ${formatIpamCount(data.kpis.addressCount)} Adressen`}
          </Text>
        ) : null}
      </View>
    </>
  );

  if (checkingSession || (loading && !data && !denied)) {
    return (
      <ScreenContainer className="px-5">
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      </ScreenContainer>
    );
  }

  const v4Percent = data ? ipamV4Percent(data.kpis) : null;

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
        {header}

        {denied ? (
          <IpamAccessDenied />
        ) : !data && isOffline ? (
          <IpamOffline />
        ) : (
          <>
            {error ? <IpamErrorCard message={error} /> : null}

            {data ? (
              <View style={styles.kpiRow}>
                <View style={styles.kpi}>
                  <Text style={styles.kpiValue}>
                    {formatIpamCount(data.kpis.prefixCount)}
                  </Text>
                  <Text style={styles.kpiLabel}>Subnetze</Text>
                </View>
                <View style={styles.kpi}>
                  <Text style={styles.kpiValue}>
                    {v4Percent === null ? "–" : formatIpamPercent(v4Percent)}
                  </Text>
                  <Text style={styles.kpiLabel}>IPv4 belegt</Text>
                </View>
                <View style={styles.kpi}>
                  <Text
                    style={[
                      styles.kpiValue,
                      data.kpis.overWarning > 0 ? styles.kpiWarn : null,
                    ]}
                  >
                    {formatIpamCount(data.kpis.overWarning)}
                  </Text>
                  <Text style={styles.kpiLabel}>Fast voll</Text>
                </View>
                <View style={styles.kpi}>
                  <Text
                    style={[
                      styles.kpiValue,
                      data.kpis.openFindings > 0 ? styles.kpiWarn : null,
                    ]}
                  >
                    {formatIpamCount(data.kpis.openFindings)}
                  </Text>
                  <Text style={styles.kpiLabel}>Funde</Text>
                </View>
              </View>
            ) : null}

            <View style={styles.searchRow}>
              <Ionicons color={colors.subtle} name="search-outline" size={19} />
              <TextInput
                accessibilityLabel="IP-Adressen durchsuchen"
                autoCapitalize="none"
                autoCorrect={false}
                clearButtonMode="while-editing"
                keyboardType="default"
                maxLength={100}
                onChangeText={setQuery}
                onSubmitEditing={() => {
                  if (exact) openAddress(exact);
                }}
                placeholder="IP-Adresse, Hostname oder MAC"
                placeholderTextColor={colors.subtle}
                returnKeyType="search"
                style={styles.searchInput}
                value={query}
              />
              {searching ? (
                <ActivityIndicator color={colors.primary} size="small" />
              ) : null}
            </View>

            {trimmed ? (
              <View style={styles.group}>
                {!ipamSearchReady(trimmed) ? (
                  <Text style={styles.cardMeta}>
                    Mindestens zwei Zeichen eingeben.
                  </Text>
                ) : null}
                {searchError ? <IpamErrorCard message={searchError} /> : null}
                {exact && !exactListed && !searching ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => openAddress(exact)}
                    style={styles.card}
                  >
                    <View style={styles.cardHead}>
                      <Ionicons
                        color={colors.primaryText}
                        name="locate-outline"
                        size={19}
                      />
                      <Text numberOfLines={1} style={styles.cardTitle}>
                        {`${exact} öffnen`}
                      </Text>
                      <Ionicons
                        color={colors.subtle}
                        name="chevron-forward"
                        size={18}
                      />
                    </View>
                    <Text style={styles.cardMeta}>
                      Netzwerkdaten zu dieser Adresse anzeigen
                    </Text>
                  </Pressable>
                ) : null}
                {results && results.addresses.length ? (
                  <>
                    <Text style={styles.eyebrow}>ADRESSEN</Text>
                    <View style={styles.list}>
                      {results.addresses.map((address) => (
                        <IpamAddressItem
                          address={address}
                          key={address.id}
                          onPress={
                            ipamAddressHref(address.address)
                              ? () => openAddress(address.address)
                              : null
                          }
                        />
                      ))}
                    </View>
                  </>
                ) : null}
                {results && results.prefixes.length ? (
                  <>
                    <Text style={styles.eyebrow}>SUBNETZE</Text>
                    {results.prefixes.map(renderPrefix)}
                  </>
                ) : null}
                {results &&
                !searching &&
                !results.addresses.length &&
                !results.prefixes.length ? (
                  <View style={styles.card}>
                    <Text style={styles.cardTitle}>Keine Treffer</Text>
                    <Text style={styles.cardMeta}>
                      {tn(
                        "Prüfe die Schreibweise oder suche nach einem Teil des Hostnamens.",
                        "Prüfen Sie die Schreibweise oder suchen Sie nach einem Teil des Hostnamens.",
                      )}
                    </Text>
                  </View>
                ) : null}
              </View>
            ) : data ? (
              groups.length ? (
                groups.map((group) => (
                  <View key={group.key} style={styles.group}>
                    <Text style={styles.eyebrow}>
                      {group.label.toUpperCase()}
                    </Text>
                    {group.prefixes.map(renderPrefix)}
                  </View>
                ))
              ) : (
                <View style={[styles.card, { alignItems: "center" }]}>
                  <NetworkIcon color={colors.primaryText} size={28} />
                  <Text style={[styles.cardTitle, { flex: 0 }]}>
                    Noch keine Subnetze
                  </Text>
                  <Text style={[styles.cardMeta, { textAlign: "center" }]}>
                    {tn(
                      "Erfasse Subnetze in der Web-App unter «IP-Adressen».",
                      "Erfassen Sie Subnetze in der Web-App unter «IP-Adressen».",
                    )}
                  </Text>
                </View>
              )
            ) : null}
          </>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}
