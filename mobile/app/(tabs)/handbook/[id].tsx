import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";

import { useMobileNetworkStatus } from "@/components/offline-status";
import { ScreenContainer } from "@/components/screen-container";
import {
  formatHandbookDate,
  isHandbookId,
  loadMobileHandbook,
  parseHandbookBlocks,
  parseHandbookInline,
  type Handbook,
  type HandbookBlock,
} from "@/lib/handbooks";
import { loadCurrentTenant } from "@/lib/nextdesk-client";
import { makeThemedStyles, useAppColors } from "@/lib/themed-styles";

// Handbook screenshots are captured at 1280×800.
const SCREENSHOT_ASPECT_RATIO = 1.6;

function InlineText({
  text,
  style,
  codeStyle,
}: {
  text: string;
  style: object;
  codeStyle: object;
}) {
  return (
    <Text selectable style={style}>
      {parseHandbookInline(text).map((part, index) => (
        <Text
          key={index}
          style={[
            part.bold ? { fontWeight: "800" as const } : null,
            part.italic ? { fontStyle: "italic" as const } : null,
            part.code ? codeStyle : null,
          ]}
        >
          {part.text}
        </Text>
      ))}
    </Text>
  );
}

export default function HandbookScreen() {
  const router = useRouter();
  const { recoveryEpoch } = useMobileNetworkStatus();
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const handbookId = isHandbookId(id) ? id : null;
  const [handbook, setHandbook] = useState<Handbook | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);
  const styles = useStyles();
  const colors = useAppColors();

  const load = useCallback(async () => {
    if (!handbookId) {
      setError("Dieses Handbuch gibt es nicht.");
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setError("");
      const tenant = await loadCurrentTenant();
      setHandbook(await loadMobileHandbook(tenant.id, handbookId));
    } catch {
      setError(
        "Dieses Handbuch ist für dein Konto nicht verfügbar oder konnte nicht geladen werden.",
      );
    } finally {
      setLoading(false);
    }
  }, [handbookId]);

  useFocusEffect(
    useCallback(() => {
      void recoveryEpoch;
      const timer = setTimeout(() => void load(), 0);
      return () => clearTimeout(timer);
    }, [load, recoveryEpoch]),
  );

  const blocks = useMemo(
    () => (handbook ? parseHandbookBlocks(handbook.markdown) : []),
    [handbook],
  );

  const renderBlock = (block: HandbookBlock, index: number) => {
    switch (block.kind) {
      case "heading":
        return (
          <Text
            accessibilityRole="header"
            key={index}
            style={block.level === 2 ? styles.h2 : styles.h3}
          >
            {block.text}
          </Text>
        );
      case "paragraph":
        return (
          <InlineText
            codeStyle={styles.inlineCode}
            key={index}
            style={styles.paragraph}
            text={block.text}
          />
        );
      case "list":
        return (
          <View key={index} style={styles.list}>
            {block.items.map((item, itemIndex) => (
              <View key={itemIndex} style={styles.listItem}>
                <Text style={styles.listMarker}>
                  {block.ordered ? `${itemIndex + 1}.` : "•"}
                </Text>
                <InlineText
                  codeStyle={styles.inlineCode}
                  style={styles.listText}
                  text={item}
                />
              </View>
            ))}
          </View>
        );
      case "quote":
        return (
          <View key={index} style={styles.quote}>
            <InlineText
              codeStyle={styles.inlineCode}
              style={styles.quoteText}
              text={block.text}
            />
          </View>
        );
      case "code":
        return (
          <ScrollView
            horizontal
            key={index}
            showsHorizontalScrollIndicator={false}
            style={styles.codeBlock}
          >
            <Text selectable style={styles.codeText}>
              {block.text}
            </Text>
          </ScrollView>
        );
      case "image":
        return (
          <Pressable
            accessibilityHint="Öffnet das Bild in voller Grösse"
            accessibilityLabel={block.alt || "Bildschirmfoto"}
            accessibilityRole="imagebutton"
            key={index}
            onPress={() => setZoomedImage(block.uri)}
            style={styles.figure}
          >
            <Image
              resizeMode="contain"
              source={{ uri: block.uri }}
              style={styles.image}
            />
            {block.alt ? <Text style={styles.caption}>{block.alt}</Text> : null}
          </Pressable>
        );
      case "table":
        // Tables become label/value cards, which read better on a phone.
        return (
          <View key={index} style={styles.table}>
            {block.rows.map((row, rowIndex) => (
              <View key={rowIndex} style={styles.tableRow}>
                {row.map((cell, cellIndex) => (
                  <View key={cellIndex} style={styles.tableCell}>
                    {block.header[cellIndex] ? (
                      <Text style={styles.tableLabel}>
                        {block.header[cellIndex]}
                      </Text>
                    ) : null}
                    <InlineText
                      codeStyle={styles.inlineCode}
                      style={
                        cellIndex === 0 ? styles.tableKey : styles.tableValue
                      }
                      text={cell}
                    />
                  </View>
                ))}
              </View>
            ))}
          </View>
        );
    }
  };

  return (
    <ScreenContainer className="px-5">
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Pressable
          accessibilityLabel="Zurück zum Profil"
          accessibilityRole="button"
          onPress={() => router.back()}
          style={styles.back}
        >
          <Ionicons color={colors.primaryText} name="arrow-back" size={20} />
          <Text style={styles.backText}>Profil</Text>
        </Pressable>

        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator color={colors.primary} size="large" />
            <Text style={styles.loadingText}>Handbuch wird geladen …</Text>
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
          </View>
        ) : handbook ? (
          <View style={styles.article}>
            <View style={styles.metaRow}>
              <View style={styles.audience}>
                <Ionicons color={colors.info} name="book-outline" size={14} />
                <Text style={styles.audienceText}>
                  {handbook.audienceLabel}
                </Text>
              </View>
              <Text style={styles.updatedAt}>
                Stand {formatHandbookDate(handbook.updatedAt)}
              </Text>
            </View>
            <Text accessibilityRole="header" style={styles.title}>
              {handbook.title}
            </Text>
            <Text style={styles.summary}>{handbook.description}</Text>
            <View style={styles.rule} />
            {blocks.map(renderBlock)}
          </View>
        ) : null}
      </ScrollView>

      <Modal
        animationType="fade"
        onRequestClose={() => setZoomedImage(null)}
        transparent
        visible={zoomedImage !== null}
      >
        <View style={styles.zoomRoot}>
          <ScrollView
            centerContent
            contentContainerStyle={styles.zoomContent}
            maximumZoomScale={4}
            minimumZoomScale={1}
          >
            {zoomedImage ? (
              <Image
                resizeMode="contain"
                source={{ uri: zoomedImage }}
                style={styles.zoomImage}
              />
            ) : null}
          </ScrollView>
          <Pressable
            accessibilityLabel="Bild schliessen"
            accessibilityRole="button"
            onPress={() => setZoomedImage(null)}
            style={styles.zoomClose}
          >
            <Ionicons color="#ffffff" name="close" size={24} />
          </Pressable>
        </View>
      </Modal>
    </ScreenContainer>
  );
}

const useStyles = makeThemedStyles((c) => ({
  content: { gap: 18, paddingBottom: 36, paddingTop: 18 },
  back: {
    alignItems: "center",
    alignSelf: "flex-start",
    flexDirection: "row",
    gap: 6,
    minHeight: 34,
  },
  backText: { color: c.primaryText, fontSize: 14, fontWeight: "800" },
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
  article: {
    backgroundColor: c.surface,
    borderColor: c.border,
    borderRadius: 22,
    borderWidth: 1,
    gap: 12,
    padding: 18,
  },
  metaRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between",
  },
  audience: {
    alignItems: "center",
    backgroundColor: c.infoSoft,
    borderRadius: 10,
    flexDirection: "row",
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  audienceText: { color: c.info, fontSize: 11, fontWeight: "900" },
  updatedAt: { color: c.subtle, flexShrink: 1, fontSize: 11 },
  title: {
    color: c.foreground,
    fontSize: 25,
    fontWeight: "900",
    letterSpacing: -0.5,
    lineHeight: 31,
    marginTop: 4,
  },
  summary: { color: c.muted, fontSize: 15, lineHeight: 22 },
  rule: { backgroundColor: c.surfaceSubtle, height: 1, marginVertical: 6 },
  h2: {
    color: c.foreground,
    fontSize: 19,
    fontWeight: "900",
    lineHeight: 25,
    marginTop: 14,
  },
  h3: {
    color: c.foreground,
    fontSize: 16,
    fontWeight: "800",
    lineHeight: 22,
    marginTop: 6,
  },
  paragraph: { color: c.text, fontSize: 15, lineHeight: 23 },
  inlineCode: {
    backgroundColor: c.surfaceSubtle,
    color: c.foreground,
    fontFamily: "Menlo",
    fontSize: 13,
  },
  list: { gap: 6 },
  listItem: { flexDirection: "row", gap: 8 },
  listMarker: {
    color: c.muted,
    fontSize: 15,
    fontWeight: "800",
    lineHeight: 23,
    minWidth: 18,
  },
  listText: { color: c.text, flex: 1, fontSize: 15, lineHeight: 23 },
  quote: {
    backgroundColor: c.infoSoft,
    borderLeftColor: c.info,
    borderLeftWidth: 3,
    borderRadius: 10,
    padding: 12,
  },
  quoteText: { color: c.text, fontSize: 14, lineHeight: 21 },
  codeBlock: {
    backgroundColor: c.surfaceSubtle,
    borderColor: c.border,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
  },
  codeText: { color: c.foreground, fontFamily: "Menlo", fontSize: 12 },
  figure: { gap: 6 },
  image: {
    aspectRatio: SCREENSHOT_ASPECT_RATIO,
    borderColor: c.border,
    borderRadius: 12,
    borderWidth: 1,
    width: "100%",
  },
  caption: {
    color: c.muted,
    fontSize: 12,
    lineHeight: 17,
    textAlign: "center",
  },
  table: { gap: 8 },
  tableRow: {
    backgroundColor: c.surfaceSubtle,
    borderColor: c.border,
    borderRadius: 12,
    borderWidth: 1,
    gap: 8,
    padding: 12,
  },
  tableCell: { gap: 2 },
  tableLabel: {
    color: c.subtle,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  tableKey: { color: c.foreground, fontSize: 14, fontWeight: "800" },
  tableValue: { color: c.text, fontSize: 14, lineHeight: 20 },
  zoomRoot: { backgroundColor: "rgba(10, 14, 24, 0.94)", flex: 1 },
  zoomContent: { alignItems: "center", flexGrow: 1, justifyContent: "center" },
  zoomImage: { aspectRatio: SCREENSHOT_ASPECT_RATIO, width: "100%" },
  zoomClose: {
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.16)",
    borderRadius: 22,
    height: 44,
    justifyContent: "center",
    position: "absolute",
    right: 18,
    top: 56,
    width: 44,
  },
}));
