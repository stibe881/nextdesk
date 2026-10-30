import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { useMobileFeatures } from "@/components/mobile-feature-gate";
import { listMobileAssets, type MobileAsset } from "@/lib/asset-registry";
import {
  clearRecentSearches,
  listRecentSearches,
  recordRecentSearch,
} from "@/lib/mobile-private-state";
import {
  searchMobileKnowledge,
  type MobileKnowledgeArticle,
} from "@/lib/mobile-knowledge";
import { getMobileUserId, type MobileTenant } from "@/lib/nextdesk-client";
import type { MobileTicket } from "@/lib/nextdesk-tickets";
import { makeThemedStyles, useAppColors } from "@/lib/themed-styles";

type GlobalSearchProps = {
  platformName: string;
  tenant: MobileTenant | null;
  tickets: MobileTicket[];
};

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase("de-CH");
}

function assetSubtitle(asset: MobileAsset): string {
  return (
    [
      asset.manufacturer,
      asset.model,
      asset.serialNumber ?? asset.inventoryNumber,
    ]
      .filter(Boolean)
      .join(" · ") || "Asset"
  );
}

export function GlobalSearch({
  platformName,
  tenant,
  tickets,
}: GlobalSearchProps) {
  const router = useRouter();
  const {
    isEnabled,
    loading: checkingFeatures,
    tenantId: confirmedTenantId,
  } = useMobileFeatures();
  const assetsEnabled = isEnabled("assets.management");
  const ticketDetailsEnabled = isEnabled("ticketing.detail");
  const knowledgeEnabled = isEnabled("knowledge.base");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [assets, setAssets] = useState<MobileAsset[]>([]);
  const [searchingAssets, setSearchingAssets] = useState(false);
  const [assetSearchUnavailable, setAssetSearchUnavailable] = useState(false);
  const [articles, setArticles] = useState<MobileKnowledgeArticle[]>([]);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const styles = useStyles();
  const colors = useAppColors();

  const needle = normalized(query);
  const queryLength = Array.from(needle).length;
  const ticketResults = useMemo(() => {
    if (queryLength < 2 || !ticketDetailsEnabled) return [];
    return tickets.filter((ticket) =>
      [
        ticket.ticketNumber,
        ticket.subject,
        ticket.description,
        ticket.status,
        ticket.priority,
      ].some((value) => normalized(value).includes(needle)),
    );
  }, [needle, queryLength, ticketDetailsEnabled, tickets]);

  useEffect(() => {
    if (!open || !tenant || queryLength < 2 || !assetsEnabled) return;

    let cancelled = false;
    const timeout = setTimeout(() => {
      void (async () => {
        setSearchingAssets(true);
        setAssetSearchUnavailable(false);
        try {
          const matches = await listMobileAssets(tenant.id, query);
          if (!cancelled) setAssets(matches);
        } catch {
          // Asset results are optional for the global search. A user without
          // asset read permission can still search every ticket they may see.
          if (!cancelled) {
            setAssets([]);
            setAssetSearchUnavailable(true);
          }
        } finally {
          if (!cancelled) setSearchingAssets(false);
        }
      })();
    }, 240);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [assetsEnabled, open, query, queryLength, tenant]);

  useEffect(() => {
    if (!open || !tenant || queryLength < 2 || !knowledgeEnabled) return;
    let cancelled = false;
    const timeout = setTimeout(() => {
      void searchMobileKnowledge({ tenantId: tenant.id, query })
        .then((matches) => {
          if (!cancelled) setArticles(matches.slice(0, 8));
        })
        .catch(() => {
          // Wissensergebnisse sind optional.
          if (!cancelled) setArticles([]);
        });
    }, 260);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [knowledgeEnabled, open, query, queryLength, tenant]);

  // Zuletzt verwendete Suchbegriffe werden beim Öffnen geladen.
  useEffect(() => {
    if (!open || !tenant) return;
    let cancelled = false;
    void (async () => {
      try {
        const userId = await getMobileUserId();
        const terms = await listRecentSearches({
          userId,
          tenantId: tenant.id,
        });
        if (!cancelled) setRecentSearches(terms);
      } catch {
        if (!cancelled) setRecentSearches([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, tenant]);

  function rememberSearch() {
    if (!tenant) return;
    const term = query;
    void (async () => {
      try {
        await recordRecentSearch({
          userId: await getMobileUserId(),
          tenantId: tenant.id,
          term,
        });
      } catch {
        // Der Suchverlauf ist eine Komfortfunktion.
      }
    })();
  }

  async function forgetSearches() {
    if (!tenant) return;
    setRecentSearches([]);
    try {
      await clearRecentSearches({
        userId: await getMobileUserId(),
        tenantId: tenant.id,
      });
    } catch {
      // Ohne Speicherzugriff bleibt der Verlauf unverändert.
    }
  }

  function close() {
    setOpen(false);
  }

  function openSearch() {
    setQuery("");
    setAssets([]);
    setArticles([]);
    setSearchingAssets(false);
    setAssetSearchUnavailable(false);
    setOpen(true);
  }

  function changeQuery(value: string) {
    setQuery(value);
    if (Array.from(value.trim()).length < 2) {
      setAssets([]);
      setArticles([]);
      setSearchingAssets(false);
      setAssetSearchUnavailable(false);
    }
  }

  function openTicket(ticket: MobileTicket) {
    if (!ticketDetailsEnabled) return;
    rememberSearch();
    close();
    router.push({ pathname: "/ticket/[id]", params: { id: ticket.id } });
  }

  function openArticle(article: MobileKnowledgeArticle) {
    if (!knowledgeEnabled) return;
    rememberSearch();
    close();
    router.push(`/knowledge/${article.id}` as never);
  }

  function openAsset(asset: MobileAsset) {
    if (!assetsEnabled) return;
    rememberSearch();
    close();
    router.push({
      pathname: "/assets/[id]",
      params: { id: asset.id },
    } as never);
  }

  return (
    <>
      <Pressable
        accessibilityHint="Durchsucht freigegebene Tickets, Assets und Wissensartikel in Ihrem aktuellen Mandanten."
        accessibilityLabel="Globale Suche öffnen"
        accessibilityRole="button"
        onPress={openSearch}
        style={styles.trigger}
      >
        <Ionicons color={colors.muted} name="search-outline" size={20} />
        <Text numberOfLines={1} style={styles.triggerText}>
          {platformName} durchsuchen
        </Text>
        <Ionicons color={colors.primaryText} name="arrow-forward" size={18} />
      </Pressable>

      <Modal
        animationType="slide"
        onRequestClose={close}
        transparent
        visible={open && !checkingFeatures && Boolean(confirmedTenantId)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.overlay}
        >
          <Pressable
            accessibilityLabel="Globale Suche schliessen"
            accessibilityRole="button"
            onPress={close}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.sheet}>
            <View style={styles.header}>
              <View style={styles.headerCopy}>
                <Text style={styles.eyebrow}>GLOBALE SUCHE</Text>
                <Text numberOfLines={2} style={styles.title}>
                  In {platformName} suchen
                </Text>
              </View>
              <Pressable
                accessibilityLabel="Globale Suche schliessen"
                accessibilityRole="button"
                hitSlop={10}
                onPress={close}
                style={styles.close}
              >
                <Ionicons color={colors.primaryText} name="close" size={23} />
              </Pressable>
            </View>

            <View style={styles.inputWrap}>
              <Ionicons color={colors.muted} name="search-outline" size={21} />
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus
                onChangeText={changeQuery}
                placeholder="Freigegebene Vorgänge durchsuchen"
                placeholderTextColor={colors.subtle}
                returnKeyType="search"
                style={styles.input}
                value={query}
              />
              {searchingAssets ? (
                <ActivityIndicator color={colors.primary} size="small" />
              ) : null}
            </View>

            <ScrollView
              contentContainerStyle={styles.results}
              keyboardDismissMode="interactive"
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {queryLength < 2 ? (
                <>
                  {recentSearches.length > 0 ? (
                    <ResultGroup label="ZULETZT GESUCHT">
                      {recentSearches.map((term) => (
                        <Pressable
                          accessibilityRole="button"
                          key={term}
                          onPress={() => changeQuery(term)}
                          style={styles.result}
                        >
                          <View style={[styles.resultIcon, styles.ticketIcon]}>
                            <Ionicons
                              color={colors.primaryText}
                              name="time-outline"
                              size={18}
                            />
                          </View>
                          <View style={styles.resultCopy}>
                            <Text style={styles.resultTitle}>{term}</Text>
                          </View>
                        </Pressable>
                      ))}
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => void forgetSearches()}
                      >
                        <Text style={styles.note}>Verlauf löschen</Text>
                      </Pressable>
                    </ResultGroup>
                  ) : null}
                  <Text style={styles.note}>
                    Suche nach Ticketnummer, Betreff, Beschreibung, Status,
                    Priorität, Assetname, Seriennummer oder Wissensartikeln.
                  </Text>
                </>
              ) : (
                <>
                  {ticketResults.length > 0 ? (
                    <ResultGroup label={`TICKETS · ${ticketResults.length}`}>
                      {ticketResults.map((ticket) => (
                        <Pressable
                          accessibilityRole="button"
                          key={ticket.id}
                          onPress={() => openTicket(ticket)}
                          style={styles.result}
                        >
                          <View style={[styles.resultIcon, styles.ticketIcon]}>
                            <Ionicons
                              color={colors.primaryText}
                              name="ticket-outline"
                              size={18}
                            />
                          </View>
                          <View style={styles.resultCopy}>
                            <Text style={styles.resultTitle}>
                              {ticket.subject}
                            </Text>
                            <Text numberOfLines={1} style={styles.resultMeta}>
                              {ticket.ticketNumber} · {ticket.status} ·{" "}
                              {ticket.priority}
                            </Text>
                          </View>
                          <Ionicons
                            color={colors.subtle}
                            name="chevron-forward"
                            size={18}
                          />
                        </Pressable>
                      ))}
                    </ResultGroup>
                  ) : null}

                  {assetsEnabled && assets.length > 0 ? (
                    <ResultGroup label={`ASSETS · ${assets.length}`}>
                      {assets.map((asset) => (
                        <Pressable
                          accessibilityRole="button"
                          key={asset.id}
                          onPress={() => openAsset(asset)}
                          style={styles.result}
                        >
                          <View style={[styles.resultIcon, styles.assetIcon]}>
                            <Ionicons
                              color={colors.info}
                              name="cube-outline"
                              size={18}
                            />
                          </View>
                          <View style={styles.resultCopy}>
                            <Text style={styles.resultTitle}>{asset.name}</Text>
                            <Text numberOfLines={1} style={styles.resultMeta}>
                              {assetSubtitle(asset)}
                            </Text>
                          </View>
                          <Ionicons
                            color={colors.subtle}
                            name="chevron-forward"
                            size={18}
                          />
                        </Pressable>
                      ))}
                    </ResultGroup>
                  ) : null}

                  {knowledgeEnabled && articles.length > 0 ? (
                    <ResultGroup label={`WISSEN · ${articles.length}`}>
                      {articles.map((article) => (
                        <Pressable
                          accessibilityRole="button"
                          key={article.id}
                          onPress={() => openArticle(article)}
                          style={styles.result}
                        >
                          <View style={[styles.resultIcon, styles.ticketIcon]}>
                            <Ionicons
                              color={colors.primaryText}
                              name="book-outline"
                              size={18}
                            />
                          </View>
                          <View style={styles.resultCopy}>
                            <Text style={styles.resultTitle}>
                              {article.title}
                            </Text>
                            <Text numberOfLines={1} style={styles.resultMeta}>
                              {article.summary || "Wissensartikel"}
                            </Text>
                          </View>
                          <Ionicons
                            color={colors.subtle}
                            name="chevron-forward"
                            size={18}
                          />
                        </Pressable>
                      ))}
                    </ResultGroup>
                  ) : null}

                  {!checkingFeatures &&
                  !ticketDetailsEnabled &&
                  !assetsEnabled &&
                  !knowledgeEnabled ? (
                    <Text style={styles.note}>
                      Für diesen Mandanten sind keine durchsuchbaren
                      Detailmodule freigeschaltet.
                    </Text>
                  ) : null}

                  {!searchingAssets &&
                  (ticketDetailsEnabled || assetsEnabled || knowledgeEnabled) &&
                  ticketResults.length === 0 &&
                  assets.length === 0 &&
                  articles.length === 0 ? (
                    <Text style={styles.note}>
                      {assetSearchUnavailable
                        ? "Keine passenden Tickets gefunden. Assetergebnisse stehen für Ihre Rolle nicht zur Verfügung."
                        : "Keine passenden Tickets, Assets oder Wissensartikel gefunden."}
                    </Text>
                  ) : null}
                </>
              )}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

function ResultGroup({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  const styles = useStyles();
  return (
    <View style={styles.group}>
      <Text style={styles.groupLabel}>{label}</Text>
      {children}
    </View>
  );
}

const useStyles = makeThemedStyles((c) => ({
  trigger: {
    alignItems: "center",
    backgroundColor: c.surface,
    borderColor: c.border,
    borderRadius: 15,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    minHeight: 52,
    paddingHorizontal: 15,
  },
  triggerText: { color: c.muted, flex: 1, fontSize: 14, fontWeight: "700" },
  overlay: {
    backgroundColor: c.overlay,
    flex: 1,
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: c.background,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    gap: 16,
    maxHeight: "84%",
    minHeight: "62%",
    padding: 20,
    paddingBottom: 28,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  headerCopy: { flex: 1, marginRight: 12, minWidth: 0 },
  eyebrow: {
    color: c.muted,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1,
  },
  title: { color: c.foreground, fontSize: 22, fontWeight: "900", marginTop: 3 },
  close: {
    alignItems: "center",
    backgroundColor: c.primarySoft,
    borderRadius: 17,
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  inputWrap: {
    alignItems: "center",
    backgroundColor: c.surface,
    borderColor: c.borderStrong,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: 9,
    minHeight: 54,
    paddingHorizontal: 14,
  },
  input: { color: c.foreground, flex: 1, fontSize: 15, minHeight: 50 },
  results: { gap: 16, paddingBottom: 12 },
  note: { color: c.muted, fontSize: 14, lineHeight: 21, paddingVertical: 7 },
  group: { gap: 8 },
  groupLabel: {
    color: c.muted,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1,
  },
  result: {
    alignItems: "center",
    backgroundColor: c.surface,
    borderColor: c.border,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: 11,
    minHeight: 62,
    paddingHorizontal: 12,
  },
  resultIcon: {
    alignItems: "center",
    borderRadius: 12,
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  ticketIcon: { backgroundColor: c.primarySoft },
  assetIcon: { backgroundColor: c.infoSoft },
  resultCopy: { flex: 1, gap: 3 },
  resultTitle: { color: c.foreground, fontSize: 14, fontWeight: "800" },
  resultMeta: { color: c.muted, fontSize: 12 },
}));
