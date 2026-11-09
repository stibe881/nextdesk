import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";

import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Share,
  Text,
  View,
} from "react-native";

import { KnowledgeArticleView } from "@/components/knowledge-article-view";
import { ScreenContainer } from "@/components/screen-container";
import {
  MobileFeatureLoadingScreen,
  MobileFeatureUnavailableScreen,
  useMobileFeatures,
} from "@/components/mobile-feature-gate";
import { useMobileNetworkStatus } from "@/components/offline-status";
import {
  formatMobileKnowledgeUpdatedAt,
  loadMobileKnowledgeArticle,
  type MobileKnowledgeArticleDetail,
} from "@/lib/mobile-knowledge";
import { loadCurrentTenant } from "@/lib/nextdesk-client";
import { makeThemedStyles, useAppColors } from "@/lib/themed-styles";
import { recordRecentItem } from "@/lib/recent-items";

function readId(value: string | string[] | undefined): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export default function KnowledgeArticleScreen() {
  const router = useRouter();
  const { recoveryEpoch } = useMobileNetworkStatus();
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const articleId = readId(id);
  const { isEnabled, loading: checkingFeatures } = useMobileFeatures();
  const knowledgeEnabled = isEnabled("knowledge.base");
  const [article, setArticle] = useState<MobileKnowledgeArticleDetail | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const styles = useStyles();
  const colors = useAppColors();

  const load = useCallback(async () => {
    if (!articleId) {
      setError("Der Wissensartikel ist ungültig.");
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setError("");
      const tenant = await loadCurrentTenant();
      setArticle(
        await loadMobileKnowledgeArticle({ tenantId: tenant.id, articleId }),
      );
      recordRecentItem(tenant.id, "knowledge_article", articleId);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Der Wissensartikel konnte nicht geladen werden.",
      );
    } finally {
      setLoading(false);
    }
  }, [articleId]);

  useFocusEffect(
    useCallback(() => {
      void recoveryEpoch;
      if (checkingFeatures || !knowledgeEnabled) return;
      const timer = setTimeout(() => void load(), 0);
      return () => clearTimeout(timer);
    }, [checkingFeatures, knowledgeEnabled, load, recoveryEpoch]),
  );

  if (checkingFeatures) return <MobileFeatureLoadingScreen />;

  if (!knowledgeEnabled) {
    return (
      <MobileFeatureUnavailableScreen
        feature="knowledge.base"
        title="Wissensartikel"
      />
    );
  }

  // Always back to the knowledge list: «back» returned to whichever tab the
  // article was opened from (e.g. the ticket page).
  function goToKnowledgeList() {
    router.replace("/knowledge" as never);
  }

  async function shareArticle() {
    if (!article) return;
    try {
      await Share.share({
        message: article.summary
          ? `${article.title}\n\n${article.summary}`
          : article.title,
      });
    } catch {
      // Sharing was cancelled or is not available.
    }
  }

  function createTicketForArticle() {
    if (!article) return;
    router.push(
      `/ticket/new?subject=${encodeURIComponent(`Rückfrage zu: ${article.title}`)}` as never,
    );
  }

  return (
    <ScreenContainer className="px-5">
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator color={colors.primary} size="large" />
            <Text style={styles.loadingText}>Artikel wird geladen …</Text>
          </View>
        ) : error ? (
          <View style={styles.errorBox}>
            <Ionicons
              color={colors.error}
              name="alert-circle-outline"
              size={20}
            />
            <Text style={styles.errorText}>{error}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => void load()}
              style={styles.retry}
            >
              <Text style={styles.retryText}>Erneut versuchen</Text>
            </Pressable>
            <Pressable
              accessibilityLabel="Zurück zu Wissen"
              accessibilityRole="button"
              onPress={goToKnowledgeList}
              style={styles.retry}
            >
              <Text style={styles.retryText}>Zurück zu Wissen</Text>
            </Pressable>
          </View>
        ) : article ? (
          <KnowledgeArticleView
            body={article.body}
            imageUrls={article.imageUrls}
            onBack={goToKnowledgeList}
            onShare={() => void shareArticle()}
            summary={article.summary}
            title={article.title}
            topic={article.collections
              .map((collection) => collection.name)
              .join(" · ")}
            updatedLabel={formatMobileKnowledgeUpdatedAt(article.updatedAt)}
          />
        ) : null}
      </ScrollView>
      {article ? (
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            onPress={() => void shareArticle()}
            style={styles.action}
          >
            <Ionicons
              color={colors.primaryText}
              name="share-outline"
              size={18}
            />
            <Text style={styles.actionText}>Teilen</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={createTicketForArticle}
            style={[styles.action, styles.actionPrimary]}
          >
            <Ionicons color="#FFFFFF" name="create-outline" size={18} />
            <Text style={styles.actionPrimaryText}>Ticket erstellen</Text>
          </Pressable>
        </View>
      ) : null}
    </ScreenContainer>
  );
}

const useStyles = makeThemedStyles((c) => ({
  content: { gap: 18, paddingBottom: 36, paddingTop: 18 },
  centered: {
    alignItems: "center",
    gap: 12,
    justifyContent: "center",
    minHeight: 280,
  },
  loadingText: { color: c.muted, fontSize: 13 },
  errorBox: {
    backgroundColor: c.errorSoft,
    borderRadius: 18,
    gap: 10,
    padding: 17,
  },
  errorText: { color: c.error, fontSize: 13, lineHeight: 19 },
  retry: { alignSelf: "flex-start", paddingVertical: 4 },
  retryText: { color: c.error, fontSize: 13, fontWeight: "900" },
  actions: {
    borderTopColor: c.border,
    borderTopWidth: 1,
    flexDirection: "row",
    gap: 10,
    paddingBottom: 34,
    paddingTop: 10,
  },
  action: {
    alignItems: "center",
    backgroundColor: c.surfaceSubtle,
    borderRadius: 14,
    flex: 1,
    flexDirection: "row",
    gap: 7,
    justifyContent: "center",
    minHeight: 48,
  },
  actionPrimary: { backgroundColor: c.primary },
  actionText: { color: c.primaryText, fontSize: 14, fontWeight: "900" },
  actionPrimaryText: { color: "#FFFFFF", fontSize: 14, fontWeight: "900" },
}));
