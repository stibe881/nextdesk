import { Ionicons } from "@expo/vector-icons";
import { Pressable, ScrollView, Text, View } from "react-native";

import { makeThemedStyles } from "@/lib/themed-styles";

export type KnowledgeTopic = { name: string; count: number };

const TOPIC_COLORS = [
  "#3B5BFD",
  "#0F9D6B",
  "#D9480F",
  "#9333EA",
  "#0891B2",
  "#BE185D",
];

/** Stable colour per topic (same idea as the web app). */
export function knowledgeTopicColor(name: string): string {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return TOPIC_COLORS[hash % TOPIC_COLORS.length] ?? "#3B5BFD";
}

type IconName = keyof typeof Ionicons.glyphMap;

/** A matching symbol for well-known topics; a book for the others. */
export function knowledgeTopicIcon(name: string): IconName {
  const text = name.toLowerCase();
  if (/drucker|print|scan/.test(text)) return "print-outline";
  if (/outlook|mail|exchange/.test(text)) return "mail-outline";
  if (/w-?lan|wifi|netz|vpn/.test(text)) return "wifi-outline";
  if (/teams|chat|telefon/.test(text)) return "chatbubbles-outline";
  if (/firewall|sicherheit|passwort|zugang|wipe/.test(text))
    return "shield-checkmark-outline";
  if (/intune|handy|mobil|iphone|ios|android/.test(text))
    return "phone-portrait-outline";
  if (/sccm|windows|software|client|pc|laptop|hyper/.test(text))
    return "desktop-outline";
  return "book-outline";
}

export function KnowledgeTopicRow({
  onSelect,
  selected,
  topics,
  total,
}: {
  onSelect: (topic: string | null) => void;
  selected: string | null;
  topics: KnowledgeTopic[];
  total: number;
}) {
  const styles = useStyles();
  if (topics.length === 0) return null;
  return (
    <ScrollView
      accessibilityLabel="Themen"
      contentContainerStyle={styles.row}
      horizontal
      showsHorizontalScrollIndicator={false}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected: selected === null }}
        onPress={() => onSelect(null)}
        style={[styles.topic, selected === null ? styles.topicOn : null]}
      >
        <View style={[styles.icon, styles.iconAll]}>
          <Ionicons color="#FFFFFF" name="book-outline" size={16} />
        </View>
        <View>
          <Text style={styles.name}>Alle</Text>
          <Text style={styles.count}>{total} Artikel</Text>
        </View>
      </Pressable>
      {topics.map((topic) => (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: selected === topic.name }}
          key={topic.name}
          onPress={() => onSelect(selected === topic.name ? null : topic.name)}
          style={[
            styles.topic,
            selected === topic.name ? styles.topicOn : null,
          ]}
        >
          <View
            style={[
              styles.icon,
              { backgroundColor: knowledgeTopicColor(topic.name) },
            ]}
          >
            <Ionicons
              color="#FFFFFF"
              name={knowledgeTopicIcon(topic.name)}
              size={16}
            />
          </View>
          <View>
            <Text numberOfLines={1} style={styles.name}>
              {topic.name}
            </Text>
            <Text style={styles.count}>
              {topic.count === 1 ? "1 Artikel" : `${topic.count} Artikel`}
            </Text>
          </View>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const useStyles = makeThemedStyles((c) => ({
  row: { gap: 8, paddingRight: 20 },
  topic: {
    alignItems: "center",
    backgroundColor: c.surface,
    borderColor: c.border,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: 9,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  topicOn: {
    borderColor: c.foreground,
    borderWidth: 2,
    paddingHorizontal: 9,
    paddingVertical: 7,
  },
  icon: {
    alignItems: "center",
    borderRadius: 10,
    height: 32,
    justifyContent: "center",
    width: 32,
  },
  iconAll: { backgroundColor: c.foreground },
  name: { color: c.foreground, fontSize: 13, fontWeight: "900", maxWidth: 150 },
  count: { color: c.muted, fontSize: 11, fontWeight: "600" },
}));
