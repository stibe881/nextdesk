import { Ionicons } from "@expo/vector-icons";
import { useMemo, useState } from "react";
import {
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

import { hapticSelection } from "@/lib/mobile-haptics";
import {
  filterSnippets,
  resolveSnippetPlaceholders,
  type ReplySnippet,
  type SnippetContext,
} from "@/lib/reply-snippets";
import { makeThemedStyles, useAppColors } from "@/lib/themed-styles";

/** Inline suggestions while «/kürzel» is typed in the reply field. */
export function SnippetSuggestions({
  context,
  matches,
  onPick,
}: {
  context: SnippetContext;
  matches: ReplySnippet[];
  onPick: (snippet: ReplySnippet) => void;
}) {
  const styles = useStyles();
  if (matches.length === 0) return null;
  return (
    <View accessibilityLabel="Antwort-Bausteine" style={styles.inlineList}>
      {matches.slice(0, 5).map((snippet) => (
        <Pressable
          accessibilityRole="button"
          key={snippet.id}
          onPress={() => {
            hapticSelection();
            onPick(snippet);
          }}
          style={styles.inlineItem}
        >
          <Text numberOfLines={1} style={styles.itemName}>
            {snippet.name}
            {snippet.shortcut ? `  /${snippet.shortcut}` : ""}
          </Text>
          <Text numberOfLines={1} style={styles.itemPreview}>
            {resolveSnippetPlaceholders(snippet.body, context)}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

/** «Bausteine» sheet: search and insert a snippet. */
export function ReplySnippetSheet({
  context,
  departmentId,
  onClose,
  onPick,
  snippets,
  visible,
}: {
  context: SnippetContext;
  departmentId: string | null;
  onClose: () => void;
  onPick: (snippet: ReplySnippet) => void;
  snippets: ReplySnippet[];
  visible: boolean;
}) {
  const styles = useStyles();
  const colors = useAppColors();
  const [query, setQuery] = useState("");
  const matches = useMemo(
    () => filterSnippets(snippets, query, departmentId, 30),
    [departmentId, query, snippets],
  );

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      transparent
      visible={visible}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.modalRoot}
      >
        <Pressable
          accessibilityLabel="Bausteine schliessen"
          accessibilityRole="button"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <View>
              <Text style={styles.sheetEyebrow}>ANTWORT-BAUSTEINE</Text>
              <Text style={styles.sheetTitle}>Baustein einfügen</Text>
            </View>
            <Pressable
              accessibilityLabel="Bausteine schliessen"
              accessibilityRole="button"
              hitSlop={10}
              onPress={onClose}
              style={styles.closeButton}
            >
              <Ionicons color={colors.primaryText} name="close" size={22} />
            </Pressable>
          </View>
          <View style={styles.searchWrap}>
            <Ionicons color={colors.muted} name="search-outline" size={19} />
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={setQuery}
              placeholder="Name oder Kürzel"
              placeholderTextColor={colors.subtle}
              style={styles.searchInput}
              value={query}
            />
          </View>
          <ScrollView
            contentContainerStyle={styles.results}
            keyboardShouldPersistTaps="handled"
          >
            {matches.length === 0 ? (
              <Text style={styles.note}>
                Keine passenden Bausteine. Bausteine erfasst du in der
                Webversion unter «Persönliche Einstellungen».
              </Text>
            ) : (
              matches.map((snippet) => (
                <Pressable
                  accessibilityRole="button"
                  key={snippet.id}
                  onPress={() => {
                    hapticSelection();
                    onPick(snippet);
                    setQuery("");
                  }}
                  style={styles.result}
                >
                  <Text style={styles.itemName}>
                    {snippet.name}
                    {snippet.shortcut ? `  /${snippet.shortcut}` : ""}
                  </Text>
                  <Text numberOfLines={3} style={styles.itemPreview}>
                    {resolveSnippetPlaceholders(snippet.body, context)}
                  </Text>
                  <Text style={styles.itemMeta}>
                    {snippet.personal ? "Persönlich" : "Gemeinsam"}
                    {snippet.departmentName
                      ? ` · ${snippet.departmentName}`
                      : ""}
                  </Text>
                </Pressable>
              ))
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const useStyles = makeThemedStyles((c) => ({
  inlineList: {
    backgroundColor: c.surface,
    borderColor: c.border,
    borderRadius: 14,
    borderWidth: 1,
    overflow: "hidden",
  },
  inlineItem: {
    borderBottomColor: c.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 2,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  itemName: { color: c.foreground, fontSize: 14, fontWeight: "700" },
  itemPreview: { color: c.muted, fontSize: 12, lineHeight: 17 },
  itemMeta: { color: c.subtle, fontSize: 11, fontWeight: "600" },
  modalRoot: {
    backgroundColor: c.overlay,
    flex: 1,
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: c.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    flexShrink: 1,
    gap: 15,
    maxHeight: "88%",
    padding: 20,
    paddingBottom: 28,
  },
  sheetHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  sheetEyebrow: {
    color: c.muted,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.9,
  },
  sheetTitle: {
    color: c.foreground,
    fontSize: 21,
    fontWeight: "800",
    marginTop: 3,
  },
  closeButton: {
    alignItems: "center",
    backgroundColor: c.primarySoft,
    borderRadius: 16,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  searchWrap: {
    alignItems: "center",
    backgroundColor: c.surfaceSubtle,
    borderColor: c.border,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 12,
  },
  searchInput: { color: c.foreground, flex: 1, fontSize: 15, minHeight: 44 },
  results: { gap: 8, paddingBottom: 8 },
  result: {
    backgroundColor: c.surfaceSubtle,
    borderColor: c.border,
    borderRadius: 14,
    borderWidth: 1,
    gap: 4,
    padding: 12,
  },
  note: { color: c.muted, fontSize: 13, lineHeight: 19 },
}));
