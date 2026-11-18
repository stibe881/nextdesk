import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { BrandGradient } from "@/components/knowledge-gradient";
import {
  formatMobileKnowledgeUpdatedAt,
  type MobileKnowledgeArticle,
} from "@/lib/mobile-knowledge";
import {
  makeThemedStyles,
  useAppColors,
  useIsDarkScheme,
} from "@/lib/themed-styles";

const GAP = 10;
const PEEK = 26;

/** The newest articles as cards to swipe through, with the next card peeking in. */
export function KnowledgeCarousel({
  articles,
  onOpen,
}: {
  articles: MobileKnowledgeArticle[];
  onOpen: (articleId: string) => void;
}) {
  const styles = useStyles();
  const colors = useAppColors();
  const dark = useIsDarkScheme();
  const [width, setWidth] = useState(0);
  const [index, setIndex] = useState(0);
  const slideWidth = Math.max(0, width - PEEK);
  const step = slideWidth + GAP;

  return (
    <View
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      style={styles.root}
    >
      {width > 0 ? (
        <ScrollView
          accessibilityHint="Nach links oder rechts wischen für weitere Artikel"
          contentContainerStyle={{ gap: GAP, paddingRight: width - slideWidth }}
          decelerationRate="fast"
          disableIntervalMomentum
          horizontal
          onScroll={(event) =>
            setIndex(
              Math.max(
                0,
                Math.min(
                  articles.length - 1,
                  Math.round(event.nativeEvent.contentOffset.x / step),
                ),
              ),
            )
          }
          scrollEventThrottle={32}
          showsHorizontalScrollIndicator={false}
          snapToAlignment="start"
          snapToInterval={step}
        >
          {articles.map((article, position) => (
            <Pressable
              accessibilityLabel={`Artikel ${position + 1} von ${articles.length}: ${article.title}`}
              accessibilityRole="button"
              key={article.id}
              onPress={() => onOpen(article.id)}
              style={[styles.slide, { width: slideWidth }]}
            >
              <BrandGradient
                dark={dark}
                from={colors.primary}
                id={`knowledgeSlide${position}`}
                to={colors.info}
              />
              {article.collections[0] ? (
                <Text numberOfLines={1} style={styles.topic}>
                  {article.collections[0].name}
                </Text>
              ) : null}
              <Text numberOfLines={3} style={styles.title}>
                {article.title}
              </Text>
              {article.summary || article.excerpt ? (
                <Text numberOfLines={2} style={styles.summary}>
                  {article.summary || article.excerpt}
                </Text>
              ) : null}
              <Text style={styles.meta}>
                {formatMobileKnowledgeUpdatedAt(article.updatedAt)}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
      {articles.length > 1 ? (
        <View accessibilityElementsHidden style={styles.dots}>
          {articles.map((article, position) => (
            <View
              key={article.id}
              style={[styles.dot, position === index ? styles.dotOn : null]}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const useStyles = makeThemedStyles((c) => ({
  root: { gap: 10 },
  slide: {
    borderRadius: 22,
    gap: 6,
    height: 200,
    justifyContent: "flex-end",
    overflow: "hidden",
    padding: 18,
  },
  topic: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(255,255,255,0.24)",
    borderRadius: 999,
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "800",
    maxWidth: "100%",
    overflow: "hidden",
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  title: {
    color: "#FFFFFF",
    fontSize: 23,
    fontWeight: "900",
    letterSpacing: -0.5,
    lineHeight: 28,
  },
  summary: { color: "rgba(255,255,255,0.94)", fontSize: 13, lineHeight: 18 },
  meta: { color: "rgba(255,255,255,0.86)", fontSize: 11, fontWeight: "600" },
  dots: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    justifyContent: "center",
  },
  dot: {
    backgroundColor: c.borderStrong,
    borderRadius: 4,
    height: 7,
    width: 7,
  },
  dotOn: { backgroundColor: c.primary, width: 20 },
}));
