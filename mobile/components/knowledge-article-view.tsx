import { Ionicons } from "@expo/vector-icons";
import { useMemo, useState } from "react";
import { Image, Pressable, ScrollView, Text, View } from "react-native";

import { BrandGradient } from "@/components/knowledge-gradient";
import {
  parseHandbookBlocks,
  parseHandbookInline,
  type HandbookBlock,
} from "@/lib/handbooks-model";
import {
  knowledgeKindLabels,
  knowledgeReadingMinutes,
  structureKnowledgeArticle,
} from "@/lib/knowledge-article-structure";
import {
  makeThemedStyles,
  useAppColors,
  useIsDarkScheme,
} from "@/lib/themed-styles";

const NOTE_START =
  /^(?:\*\*)?(Hinweis|Tipp|Wichtig|Achtung|Warnung)\s*:?(?:\*\*)?\s*:?\s*(.*)$/is;

function InlineText({
  codeStyle,
  style,
  text,
}: {
  codeStyle: object;
  style: object;
  text: string;
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

function ArticleBlocks({
  blocks,
  imageUrls,
  styles,
}: {
  blocks: HandbookBlock[];
  imageUrls: Record<string, string>;
  styles: ReturnType<typeof useStyles>;
}) {
  return (
    <View style={styles.blocks}>
      {blocks.map((block, index) => {
        switch (block.kind) {
          case "heading":
            return (
              <Text accessibilityRole="header" key={index} style={styles.h3}>
                {block.text}
              </Text>
            );
          case "paragraph": {
            const note = NOTE_START.exec(block.text);
            if (note?.[1]) {
              const warn = /^(achtung|warnung)$/i.test(note[1]);
              return (
                <View
                  key={index}
                  style={[
                    styles.note,
                    warn ? styles.noteWarn : styles.noteInfo,
                  ]}
                >
                  <Text
                    style={[
                      styles.noteLabel,
                      warn ? styles.noteWarnText : styles.noteInfoText,
                    ]}
                  >
                    {note[1].charAt(0).toUpperCase() +
                      note[1].slice(1).toLowerCase()}
                  </Text>
                  <InlineText
                    codeStyle={styles.inlineCode}
                    style={[styles.noteText, warn ? styles.noteWarnText : null]}
                    text={note[2] ?? ""}
                  />
                </View>
              );
            }
            return (
              <InlineText
                codeStyle={styles.inlineCode}
                key={index}
                style={styles.paragraph}
                text={block.text}
              />
            );
          }
          case "list":
            return (
              <View
                key={index}
                style={block.ordered ? styles.steps : styles.list}
              >
                {block.items.map((item, itemIndex) =>
                  block.ordered ? (
                    <View key={itemIndex} style={styles.step}>
                      <View style={styles.stepNumber}>
                        <Text style={styles.stepNumberText}>
                          {itemIndex + 1}
                        </Text>
                      </View>
                      <InlineText
                        codeStyle={styles.inlineCode}
                        style={styles.stepText}
                        text={item}
                      />
                    </View>
                  ) : (
                    <View key={itemIndex} style={styles.listItem}>
                      <Text style={styles.bullet}>•</Text>
                      <InlineText
                        codeStyle={styles.inlineCode}
                        style={styles.listText}
                        text={item}
                      />
                    </View>
                  ),
                )}
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
          case "image": {
            const uri = block.uri.startsWith("kb-image:")
              ? imageUrls[block.uri.slice("kb-image:".length)]
              : block.uri;
            return uri ? (
              <Image
                accessibilityLabel={block.alt || "Bild"}
                key={index}
                resizeMode="contain"
                source={{ uri }}
                style={styles.image}
              />
            ) : (
              <Text key={index} style={styles.caption}>
                {block.alt
                  ? `Bild «${block.alt}» nicht verfügbar`
                  : "Bild nicht verfügbar"}
              </Text>
            );
          }
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
                            cellIndex === 0
                              ? styles.tableKey
                              : styles.tableValue
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
      })}
    </View>
  );
}

/**
 * The article as people read it in the app: banner in the tenant's colours,
 * «Kurz gesagt», and sections that fold open. Same look as the web app.
 */
export function KnowledgeArticleView({
  body,
  imageUrls,
  onBack,
  onShare,
  summary,
  title,
  topic,
  updatedLabel,
}: {
  body: string;
  imageUrls: Record<string, string>;
  onBack: () => void;
  onShare: () => void;
  summary: string;
  title: string;
  topic: string;
  updatedLabel: string;
}) {
  const styles = useStyles();
  const colors = useAppColors();
  const structure = useMemo(
    () => structureKnowledgeArticle(body, summary || null),
    [body, summary],
  );
  const introBlocks = useMemo(
    () => parseHandbookBlocks(structure.intro),
    [structure.intro],
  );
  const sectionBlocks = useMemo(
    () =>
      structure.sections.map((section) => parseHandbookBlocks(section.body)),
    [structure.sections],
  );
  const [open, setOpen] = useState<ReadonlySet<number>>(() => new Set([0]));
  const minutes = knowledgeReadingMinutes(body);
  const dark = useIsDarkScheme();

  function toggle(index: number) {
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  return (
    <View style={styles.root}>
      <View style={styles.banner}>
        <BrandGradient
          dark={dark}
          from={colors.primary}
          id="knowledgeBanner"
          to={colors.info}
        />
        <View style={styles.bannerBar}>
          <Pressable
            accessibilityLabel="Zurück zu Wissen"
            accessibilityRole="button"
            hitSlop={8}
            onPress={onBack}
            style={styles.bannerButton}
          >
            <Ionicons color="#FFFFFF" name="chevron-back" size={20} />
          </Pressable>
          <Pressable
            accessibilityLabel="Artikel teilen"
            accessibilityRole="button"
            hitSlop={8}
            onPress={onShare}
            style={styles.bannerButton}
          >
            <Ionicons color="#FFFFFF" name="share-outline" size={19} />
          </Pressable>
        </View>
        <View style={styles.bannerMeta}>
          <Text style={styles.kind}>{knowledgeKindLabels[structure.kind]}</Text>
          {topic ? <Text style={styles.bannerMetaText}>{topic}</Text> : null}
        </View>
        <Text accessibilityRole="header" style={styles.bannerTitle}>
          {title}
        </Text>
        <Text style={styles.bannerMetaText}>
          {updatedLabel}
          {body.trim() ? ` · ${minutes} Min. Lesezeit` : ""}
        </Text>
      </View>

      {structure.lead ? (
        <View accessibilityLabel="Kurz gesagt" style={styles.lead}>
          <Text style={styles.leadLabel}>KURZ GESAGT</Text>
          <InlineText
            codeStyle={styles.inlineCode}
            style={styles.leadText}
            text={structure.lead}
          />
        </View>
      ) : null}

      {body.trim() ? (
        <View style={styles.content}>
          {introBlocks.length > 0 ? (
            <ArticleBlocks
              blocks={introBlocks}
              imageUrls={imageUrls}
              styles={styles}
            />
          ) : null}
          {structure.folding
            ? structure.sections.map((section, index) => {
                const expanded = open.has(index);
                return (
                  <View
                    key={`${index}-${section.title}`}
                    style={styles.section}
                  >
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ expanded }}
                      onPress={() => toggle(index)}
                      style={[
                        styles.sectionHeader,
                        expanded ? styles.sectionHeaderOpen : null,
                      ]}
                    >
                      <Text style={styles.sectionTitle}>{section.title}</Text>
                      <Ionicons
                        color={colors.muted}
                        name={expanded ? "remove" : "add"}
                        size={20}
                      />
                    </Pressable>
                    {expanded ? (
                      <View style={styles.sectionBody}>
                        <ArticleBlocks
                          blocks={sectionBlocks[index] ?? []}
                          imageUrls={imageUrls}
                          styles={styles}
                        />
                      </View>
                    ) : null}
                  </View>
                );
              })
            : structure.sections.map((section, index) => (
                <View
                  key={`${index}-${section.title}`}
                  style={styles.plainSection}
                >
                  <Text accessibilityRole="header" style={styles.h3}>
                    {section.title}
                  </Text>
                  <ArticleBlocks
                    blocks={sectionBlocks[index] ?? []}
                    imageUrls={imageUrls}
                    styles={styles}
                  />
                </View>
              ))}
        </View>
      ) : (
        <Text style={styles.empty}>
          Dieser Artikel enthält noch keinen Inhalt.
        </Text>
      )}
    </View>
  );
}

const useStyles = makeThemedStyles((c) => ({
  root: { gap: 14 },
  banner: {
    borderRadius: 22,
    gap: 8,
    overflow: "hidden",
    padding: 16,
    paddingBottom: 20,
  },
  bannerBar: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  bannerButton: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.22)",
    borderRadius: 18,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  bannerMeta: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  kind: {
    backgroundColor: "rgba(255,255,255,0.24)",
    borderRadius: 999,
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "800",
    overflow: "hidden",
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  bannerMetaText: {
    color: "rgba(255,255,255,0.94)",
    fontSize: 12,
    fontWeight: "600",
  },
  bannerTitle: {
    color: "#FFFFFF",
    fontSize: 28,
    fontWeight: "900",
    letterSpacing: -0.6,
    lineHeight: 33,
  },
  lead: {
    backgroundColor: c.infoSoft,
    borderLeftColor: c.primary,
    borderLeftWidth: 4,
    borderRadius: 14,
    gap: 3,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  leadLabel: {
    color: c.primaryText,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1,
  },
  leadText: { color: c.text, fontSize: 14, lineHeight: 21 },
  content: { gap: 12 },
  blocks: { gap: 10 },
  h3: { color: c.foreground, fontSize: 16, fontWeight: "900", marginTop: 4 },
  paragraph: { color: c.text, fontSize: 15, lineHeight: 24 },
  list: { gap: 6 },
  listItem: { flexDirection: "row", gap: 9 },
  bullet: { color: c.muted, fontSize: 15, lineHeight: 24 },
  listText: { color: c.text, flex: 1, fontSize: 15, lineHeight: 24 },
  steps: { gap: 8 },
  step: {
    alignItems: "flex-start",
    backgroundColor: c.surface,
    borderColor: c.border,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    padding: 12,
  },
  stepNumber: {
    alignItems: "center",
    backgroundColor: c.primary,
    borderRadius: 15,
    height: 30,
    justifyContent: "center",
    width: 30,
  },
  stepNumberText: { color: "#FFFFFF", fontSize: 13, fontWeight: "900" },
  stepText: {
    color: c.text,
    flex: 1,
    fontSize: 15,
    lineHeight: 23,
    paddingTop: 3,
  },
  note: {
    borderRadius: 14,
    gap: 3,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  noteInfo: { backgroundColor: c.infoSoft },
  noteWarn: { backgroundColor: c.warningSoft },
  noteLabel: {
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  noteInfoText: { color: c.info },
  noteWarnText: { color: c.warning },
  noteText: { color: c.text, fontSize: 14, lineHeight: 21 },
  quote: {
    borderLeftColor: c.borderStrong,
    borderLeftWidth: 3,
    paddingLeft: 12,
  },
  quoteText: { color: c.muted, fontSize: 14, lineHeight: 22 },
  codeBlock: {
    backgroundColor: c.surfaceSubtle,
    borderRadius: 12,
    padding: 12,
  },
  codeText: { color: c.foreground, fontFamily: "Courier", fontSize: 12.5 },
  inlineCode: {
    backgroundColor: c.surfaceSubtle,
    fontFamily: "Courier",
    fontSize: 13,
  },
  image: { aspectRatio: 1.6, borderRadius: 12, width: "100%" },
  caption: { color: c.muted, fontSize: 12 },
  table: { gap: 8 },
  tableRow: {
    backgroundColor: c.surface,
    borderColor: c.border,
    borderRadius: 14,
    borderWidth: 1,
    gap: 6,
    padding: 12,
  },
  tableCell: { gap: 1 },
  tableLabel: {
    color: c.muted,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  tableKey: { color: c.foreground, fontSize: 14, fontWeight: "800" },
  tableValue: { color: c.text, fontSize: 14, lineHeight: 20 },
  section: {
    backgroundColor: c.surface,
    borderColor: c.border,
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
  },
  sectionHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between",
    minHeight: 50,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  sectionHeaderOpen: { backgroundColor: c.primarySoft },
  sectionTitle: {
    color: c.foreground,
    flex: 1,
    fontSize: 16,
    fontWeight: "900",
  },
  sectionBody: { paddingBottom: 16, paddingHorizontal: 16, paddingTop: 12 },
  plainSection: { gap: 8 },
  empty: { color: c.muted, fontSize: 14 },
}));
