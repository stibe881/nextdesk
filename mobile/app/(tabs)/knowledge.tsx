import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
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
import {
  MobileFeatureLoadingScreen,
  MobileFeatureUnavailableScreen,
  useMobileFeatures,
} from "@/components/mobile-feature-gate";
import { useMobileNetworkStatus } from "@/components/offline-status";
import {
  formatMobileKnowledgeUpdatedAt,
  searchMobileKnowledge,
  type MobileKnowledgeArticle,
} from "@/lib/mobile-knowledge";
import { loadCurrentTenant } from "@/lib/nextdesk-client";
import { useMobileSessionGuard } from "@/lib/use-mobile-session-guard";

export default function KnowledgeScreen() {
  const router = useRouter();
  const { recoveryEpoch } = useMobileNetworkStatus();
  const checkingSession = useMobileSessionGuard();
  const { isEnabled, loading: checkingFeatures } = useMobileFeatures();
  const knowledgeEnabled = isEnabled("knowledge.base");
  const [query, setQuery] = useState("");
  const [articles, setArticles] = useState<MobileKnowledgeArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const loadArticles = useCallback(async () => {
    try {
      setError("");
      const tenant = await loadCurrentTenant();
      setArticles(await searchMobileKnowledge({ tenantId: tenant.id, query }));
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Die Wissensartikel konnten nicht geladen werden.",
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [query]);

  useFocusEffect(
    useCallback(() => {
      void recoveryEpoch;
      if (checkingFeatures || !knowledgeEnabled) return;
      const timer = setTimeout(() => void loadArticles(), query ? 260 : 0);
      return () => clearTimeout(timer);
    }, [
      checkingFeatures,
      knowledgeEnabled,
      loadArticles,
      query,
      recoveryEpoch,
    ]),
  );

  function openArticle(articleId: string) {
    router.push(`/knowledge/${articleId}` as never);
  }

  if (checkingSession || checkingFeatures)
    return <MobileFeatureLoadingScreen />;

  if (!knowledgeEnabled) {
    return (
      <MobileFeatureUnavailableScreen feature="knowledge.base" title="Wissen" />
    );
  }

  return (
    <ScreenContainer containerClassName="bg-[#F6F7FB]" className="px-5">
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            onRefresh={() => {
              setRefreshing(true);
              void loadArticles();
            }}
            refreshing={refreshing}
            tintColor="#4438CA"
          />
        }
        showsVerticalScrollIndicator={false}
      >
        <View>
          <Text style={styles.eyebrow}>WISSEN</Text>
          <Text style={styles.title}>Wissen</Text>
          <Text style={styles.subtitle}>
            Durchsuchen Sie freigegebene Anleitungen, Lösungen und Hinweise.
          </Text>
        </View>

        <View style={styles.searchBox}>
          <Ionicons color="#77758C" name="search-outline" size={21} />
          <TextInput
            accessibilityLabel="Wissensartikel suchen"
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setQuery}
            placeholder="Wissen durchsuchen"
            placeholderTextColor="#9A99AA"
            returnKeyType="search"
            style={styles.searchInput}
            value={query}
          />
          {query ? (
            <Pressable
              accessibilityLabel="Wissenssuche zurücksetzen"
              accessibilityRole="button"
              onPress={() => setQuery("")}
            >
              <Ionicons color="#77758C" name="close-circle" size={19} />
            </Pressable>
          ) : null}
        </View>

        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator color="#4438CA" size="small" />
            <Text style={styles.loadingText}>
              Wissensartikel werden geladen …
            </Text>
          </View>
        ) : error ? (
          <View style={styles.notice}>
            <Ionicons color="#B42318" name="alert-circle-outline" size={19} />
            <Text style={styles.noticeText}>{error}</Text>
          </View>
        ) : articles.length === 0 ? (
          <View style={styles.empty}>
            <View style={styles.emptyIcon}>
              <Ionicons color="#4438CA" name="book-outline" size={27} />
            </View>
            <Text style={styles.emptyTitle}>
              {query ? "Keine passenden Artikel" : "Noch keine Wissensartikel"}
            </Text>
            <Text style={styles.emptyCopy}>
              {query
                ? "Passen Sie Ihren Suchbegriff an oder versuchen Sie eine andere Formulierung."
                : "Freigegebene Artikel erscheinen hier automatisch."}
            </Text>
          </View>
        ) : (
          <View style={styles.list}>
            <View style={styles.listHeader}>
              <Text style={styles.listTitle}>Artikel</Text>
              <Text style={styles.resultCount}>{articles.length}</Text>
            </View>
            {articles.map((article) => (
              <Pressable
                accessibilityLabel={`Artikel ${article.title} öffnen`}
                accessibilityRole="button"
                key={article.id}
                onPress={() => openArticle(article.id)}
                style={styles.article}
              >
                <View style={styles.articleIcon}>
                  <Ionicons
                    color="#087A95"
                    name="document-text-outline"
                    size={20}
                  />
                </View>
                <View style={styles.articleCopy}>
                  <Text numberOfLines={2} style={styles.articleTitle}>
                    {article.title}
                  </Text>
                  {article.summary ? (
                    <Text numberOfLines={2} style={styles.articleSummary}>
                      {article.summary}
                    </Text>
                  ) : null}
                  <View style={styles.articleMetaRow}>
                    <Text style={styles.articleMeta}>
                      {article.visibility === "internal"
                        ? "Intern"
                        : "Extern freigegeben"}
                    </Text>
                    {article.revision ? (
                      <Text style={styles.articleVersion}>
                        Version {article.revision}
                      </Text>
                    ) : null}
                  </View>
                  {article.collections.length > 0 ? (
                    <View style={styles.collections}>
                      <Ionicons
                        color="#77758C"
                        name="folder-open-outline"
                        size={13}
                      />
                      <Text numberOfLines={1} style={styles.collectionsText}>
                        {article.collections
                          .map((collection) => collection.name)
                          .join(" · ")}
                      </Text>
                    </View>
                  ) : null}
                  <Text style={styles.updatedAt}>
                    {formatMobileKnowledgeUpdatedAt(article.updatedAt)}
                  </Text>
                </View>
                <Ionicons color="#8A8999" name="chevron-forward" size={19} />
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: { gap: 18, paddingBottom: 34, paddingTop: 18 },
  centered: { alignItems: "center", flex: 1, justifyContent: "center" },
  eyebrow: {
    color: "#77758C",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.2,
  },
  title: {
    color: "#202136",
    fontSize: 29,
    fontWeight: "900",
    letterSpacing: -0.8,
    marginTop: 4,
  },
  subtitle: { color: "#6B7280", fontSize: 14, lineHeight: 20, marginTop: 5 },
  searchBox: {
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderColor: "#DFDEE8",
    borderRadius: 15,
    borderWidth: 1,
    flexDirection: "row",
    gap: 9,
    minHeight: 52,
    paddingHorizontal: 14,
  },
  searchInput: { color: "#25263A", flex: 1, fontSize: 15, minHeight: 50 },
  loading: { alignItems: "center", flexDirection: "row", gap: 9, padding: 18 },
  loadingText: { color: "#77758C", fontSize: 13 },
  notice: {
    alignItems: "flex-start",
    backgroundColor: "#FFF3F2",
    borderRadius: 15,
    flexDirection: "row",
    gap: 9,
    padding: 14,
  },
  noticeText: { color: "#9C2D2D", flex: 1, fontSize: 13, lineHeight: 18 },
  empty: {
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderColor: "#E7E6EF",
    borderRadius: 22,
    borderWidth: 1,
    gap: 9,
    padding: 27,
  },
  emptyIcon: {
    alignItems: "center",
    backgroundColor: "#F0EEFF",
    borderRadius: 17,
    height: 52,
    justifyContent: "center",
    width: 52,
  },
  emptyTitle: {
    color: "#292A3E",
    fontSize: 17,
    fontWeight: "900",
    marginTop: 3,
  },
  emptyCopy: {
    color: "#747486",
    fontSize: 13,
    lineHeight: 20,
    textAlign: "center",
  },
  list: { gap: 9 },
  listHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  listTitle: { color: "#292A3E", fontSize: 18, fontWeight: "900" },
  resultCount: {
    backgroundColor: "#F0EEFF",
    borderRadius: 10,
    color: "#514AA1",
    fontSize: 12,
    fontWeight: "900",
    overflow: "hidden",
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  article: {
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderColor: "#E7E6EF",
    borderRadius: 17,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    minHeight: 74,
    paddingHorizontal: 13,
    paddingVertical: 11,
  },
  articleIcon: {
    alignItems: "center",
    backgroundColor: "#E5F7FA",
    borderRadius: 13,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  articleCopy: { flex: 1, gap: 3 },
  articleTitle: {
    color: "#292A3E",
    fontSize: 14,
    fontWeight: "900",
    lineHeight: 19,
  },
  articleSummary: { color: "#77758C", fontSize: 12, lineHeight: 16 },
  articleMeta: {
    color: "#087A95",
    fontSize: 10,
    fontWeight: "800",
    marginTop: 1,
  },
  articleMetaRow: { alignItems: "center", flexDirection: "row", gap: 7 },
  articleVersion: { color: "#77758C", fontSize: 10, fontWeight: "700" },
  collections: { alignItems: "center", flexDirection: "row", gap: 4 },
  collectionsText: {
    color: "#656477",
    flex: 1,
    fontSize: 11,
    fontWeight: "700",
  },
  updatedAt: { color: "#8A8999", fontSize: 10, lineHeight: 14 },
});
