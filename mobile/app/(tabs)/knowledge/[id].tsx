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
import { useMobileNetworkStatus } from "@/components/offline-status";
import {
  formatMobileKnowledgeUpdatedAt,
  loadMobileKnowledgeArticle,
  type MobileKnowledgeArticleDetail,
} from "@/lib/mobile-knowledge";
import { loadCurrentTenant } from "@/lib/nextdesk-client";

function readId(value: string | string[] | undefined): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export default function KnowledgeArticleScreen() {
  const router = useRouter();
  const { recoveryEpoch } = useMobileNetworkStatus();
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const articleId = readId(id);
  const [article, setArticle] = useState<MobileKnowledgeArticleDetail | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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
      const timer = setTimeout(() => void load(), 0);
      return () => clearTimeout(timer);
    }, [load, recoveryEpoch]),
  );

  return (
    <ScreenContainer containerClassName="bg-[#F6F7FB]" className="px-5">
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Pressable
          accessibilityLabel="Zurück zu Wissen"
          accessibilityRole="button"
          onPress={() => router.back()}
          style={styles.back}
        >
          <Ionicons color="#4438CA" name="arrow-back" size={20} />
          <Text style={styles.backText}>Wissen</Text>
        </Pressable>

        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator color="#4438CA" size="large" />
            <Text style={styles.loadingText}>Artikel wird geladen …</Text>
          </View>
        ) : error ? (
          <View style={styles.errorBox}>
            <Ionicons color="#B42318" name="alert-circle-outline" size={20} />
            <Text style={styles.errorText}>{error}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => void load()}
              style={styles.retry}
            >
              <Text style={styles.retryText}>Erneut versuchen</Text>
            </Pressable>
          </View>
        ) : article ? (
          <View style={styles.article}>
            <View style={styles.metaRow}>
              <View style={styles.visibility}>
                <Ionicons
                  color="#087A95"
                  name={
                    article.visibility === "internal"
                      ? "lock-closed-outline"
                      : "checkmark-circle-outline"
                  }
                  size={14}
                />
                <Text style={styles.visibilityText}>
                  {article.visibility === "internal"
                    ? "Intern"
                    : "Extern freigegeben"}
                </Text>
              </View>
              <View style={styles.metaDetails}>
                <Text style={styles.revision}>Version {article.revision}</Text>
                <Text style={styles.updatedAt}>
                  {formatMobileKnowledgeUpdatedAt(article.updatedAt)}
                </Text>
              </View>
            </View>
            {article.collections.length > 0 ? (
              <View style={styles.collections}>
                <Ionicons
                  color="#656477"
                  name="folder-open-outline"
                  size={15}
                />
                <Text style={styles.collectionsText}>
                  {article.collections
                    .map((collection) => collection.name)
                    .join(" · ")}
                </Text>
              </View>
            ) : null}
            <Text style={styles.title}>{article.title}</Text>
            {article.summary ? (
              <Text style={styles.summary}>{article.summary}</Text>
            ) : null}
            <View style={styles.rule} />
            <Text selectable style={styles.body}>
              {article.body}
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: { gap: 18, paddingBottom: 36, paddingTop: 18 },
  back: {
    alignItems: "center",
    alignSelf: "flex-start",
    flexDirection: "row",
    gap: 6,
    minHeight: 34,
  },
  backText: { color: "#4438CA", fontSize: 14, fontWeight: "800" },
  centered: {
    alignItems: "center",
    gap: 12,
    justifyContent: "center",
    minHeight: 280,
  },
  loadingText: { color: "#77758C", fontSize: 13 },
  errorBox: {
    backgroundColor: "#FFF3F2",
    borderRadius: 18,
    gap: 10,
    padding: 17,
  },
  errorText: { color: "#9C2D2D", fontSize: 13, lineHeight: 19 },
  retry: { alignSelf: "flex-start", paddingVertical: 4 },
  retryText: { color: "#B42318", fontSize: 13, fontWeight: "900" },
  article: {
    backgroundColor: "#FFFFFF",
    borderColor: "#E7E6EF",
    borderRadius: 22,
    borderWidth: 1,
    padding: 20,
  },
  metaRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  visibility: {
    alignItems: "center",
    backgroundColor: "#E5F7FA",
    borderRadius: 10,
    flexDirection: "row",
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  visibilityText: { color: "#087A95", fontSize: 10, fontWeight: "900" },
  metaDetails: { alignItems: "flex-end", flex: 1, gap: 2 },
  revision: { color: "#77758C", fontSize: 11, fontWeight: "700" },
  updatedAt: { color: "#8A8999", fontSize: 10, textAlign: "right" },
  collections: {
    alignItems: "center",
    flexDirection: "row",
    gap: 5,
    marginTop: 12,
  },
  collectionsText: {
    color: "#656477",
    flex: 1,
    fontSize: 12,
    fontWeight: "700",
  },
  title: {
    color: "#202136",
    fontSize: 25,
    fontWeight: "900",
    letterSpacing: -0.5,
    lineHeight: 31,
    marginTop: 16,
  },
  summary: { color: "#656477", fontSize: 15, lineHeight: 22, marginTop: 10 },
  rule: { backgroundColor: "#ECECF3", height: 1, marginVertical: 18 },
  body: { color: "#38394C", fontSize: 15, lineHeight: 24 },
});
