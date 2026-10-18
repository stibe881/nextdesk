import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  searchTicketRequesters,
  type TicketRequester,
} from "@/lib/nextdesk-tickets";

type RequesterPickerProps = {
  contextLabel?: string;
  defaultRequester: TicketRequester;
  onChange: (requester: TicketRequester) => void;
  tenantId: string;
  value: TicketRequester | null;
};

export function RequesterPicker({
  contextLabel = "TICKET ERFASSEN",
  defaultRequester,
  onChange,
  tenantId,
  value,
}: RequesterPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TicketRequester[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const queryLength = Array.from(query.trim()).length;
  const selected = value ?? defaultRequester;

  useEffect(() => {
    if (!isOpen || queryLength < 2 || !tenantId) return;

    let cancelled = false;
    const timeout = setTimeout(() => {
      void (async () => {
        setIsSearching(true);
        setSearchError("");
        try {
          const requesters = await searchTicketRequesters(tenantId, query);
          if (!cancelled) setResults(requesters);
        } catch (error) {
          if (!cancelled) {
            setResults([]);
            setSearchError(
              error instanceof Error
                ? error.message
                : "Die anfragenden Personen konnten nicht geladen werden.",
            );
          }
        } finally {
          if (!cancelled) setIsSearching(false);
        }
      })();
    }, 220);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [isOpen, query, queryLength, tenantId]);

  function openPicker() {
    setQuery("");
    setResults([]);
    setSearchError("");
    setIsOpen(true);
  }

  function changeQuery(nextQuery: string) {
    setQuery(nextQuery);
    if (Array.from(nextQuery.trim()).length < 2) {
      setResults([]);
      setIsSearching(false);
      setSearchError("");
    }
  }

  function selectRequester(requester: TicketRequester) {
    onChange(requester);
    setIsOpen(false);
  }

  return (
    <>
      <Pressable
        accessibilityHint="Öffnet die Suche nach einer anfragenden Person."
        accessibilityLabel={`Anfragende Person: ${selected.displayName}`}
        accessibilityRole="button"
        onPress={openPicker}
        style={styles.control}
      >
        <View style={styles.controlCopy}>
          <Text numberOfLines={1} style={styles.controlName}>
            {selected.displayName}
          </Text>
          <Text style={styles.controlHint}>Antippen zum Ändern</Text>
        </View>
        <View style={styles.editIcon}>
          <Ionicons color="#4438CA" name="pencil-outline" size={18} />
        </View>
      </Pressable>

      <Modal
        animationType="slide"
        onRequestClose={() => setIsOpen(false)}
        transparent
        visible={isOpen}
      >
        <View style={styles.modalRoot}>
          <Pressable
            accessibilityLabel="Auswahl schliessen"
            accessibilityRole="button"
            onPress={() => setIsOpen(false)}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <View>
                <Text style={styles.sheetEyebrow}>{contextLabel}</Text>
                <Text style={styles.sheetTitle}>Anfragende Person wählen</Text>
              </View>
              <Pressable
                accessibilityLabel="Auswahl schliessen"
                accessibilityRole="button"
                hitSlop={10}
                onPress={() => setIsOpen(false)}
                style={styles.closeButton}
              >
                <Ionicons color="#4438CA" name="close" size={22} />
              </Pressable>
            </View>

            <Pressable
              accessibilityRole="button"
              onPress={() => selectRequester(defaultRequester)}
              style={[
                styles.defaultRequester,
                selected.id === defaultRequester.id &&
                  styles.defaultRequesterActive,
              ]}
            >
              <View style={styles.defaultCopy}>
                <Text style={styles.defaultLabel}>ANGEMELDETE PERSON</Text>
                <Text style={styles.defaultName}>
                  {defaultRequester.displayName}
                </Text>
              </View>
              {selected.id === defaultRequester.id ? (
                <Ionicons color="#4438CA" name="checkmark-circle" size={22} />
              ) : null}
            </Pressable>

            <Text style={styles.searchLabel}>ANDERE PERSON SUCHEN</Text>
            <View style={styles.searchInputWrap}>
              <Ionicons color="#77758C" name="search-outline" size={19} />
              <TextInput
                autoCapitalize="words"
                autoCorrect={false}
                onChangeText={changeQuery}
                placeholder="Name eingeben"
                placeholderTextColor="#9A99AA"
                style={styles.searchInput}
                value={query}
              />
              {isSearching ? (
                <ActivityIndicator color="#4438CA" size="small" />
              ) : null}
            </View>

            <ScrollView
              contentContainerStyle={styles.results}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {queryLength < 2 ? (
                <Text style={styles.searchNote}>
                  Geben Sie mindestens zwei Buchstaben ein, um Personen dieses
                  Mandanten zu suchen.
                </Text>
              ) : searchError ? (
                <Text style={styles.error}>{searchError}</Text>
              ) : !isSearching && results.length === 0 ? (
                <Text style={styles.searchNote}>
                  Keine passende anfragende Person gefunden.
                </Text>
              ) : (
                results.map((requester) => (
                  <Pressable
                    accessibilityRole="button"
                    key={requester.id}
                    onPress={() => selectRequester(requester)}
                    style={[
                      styles.result,
                      requester.id === selected.id && styles.resultActive,
                    ]}
                  >
                    <Text style={styles.resultName}>
                      {requester.displayName}
                    </Text>
                    {requester.id === selected.id ? (
                      <Ionicons color="#4438CA" name="checkmark" size={20} />
                    ) : (
                      <Ionicons
                        color="#77758C"
                        name="chevron-forward"
                        size={18}
                      />
                    )}
                  </Pressable>
                ))
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  control: {
    alignItems: "center",
    backgroundColor: "#F0EFFB",
    borderColor: "#E0DDF7",
    borderRadius: 13,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 60,
    paddingHorizontal: 13,
  },
  controlCopy: { flex: 1, gap: 2, paddingRight: 10 },
  controlName: { color: "#363653", fontSize: 15, fontWeight: "800" },
  controlHint: { color: "#77758C", fontSize: 12, fontWeight: "600" },
  editIcon: {
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    height: 32,
    justifyContent: "center",
    width: 32,
  },
  modalRoot: {
    backgroundColor: "rgba(25, 25, 42, 0.42)",
    flex: 1,
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    gap: 15,
    maxHeight: "76%",
    padding: 20,
    paddingBottom: 28,
  },
  sheetHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  sheetEyebrow: {
    color: "#77758C",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.9,
  },
  sheetTitle: {
    color: "#202136",
    fontSize: 21,
    fontWeight: "800",
    marginTop: 3,
  },
  closeButton: {
    alignItems: "center",
    backgroundColor: "#EEECFF",
    borderRadius: 16,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  defaultRequester: {
    alignItems: "center",
    backgroundColor: "#F7F7FB",
    borderColor: "#E5E5EF",
    borderRadius: 15,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 63,
    paddingHorizontal: 14,
  },
  defaultRequesterActive: {
    backgroundColor: "#F0EFFB",
    borderColor: "#4438CA",
  },
  defaultCopy: { gap: 3, flex: 1 },
  defaultLabel: {
    color: "#77758C",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.8,
  },
  defaultName: { color: "#363653", fontSize: 15, fontWeight: "800" },
  searchLabel: {
    color: "#77758C",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.9,
    marginTop: 2,
  },
  searchInputWrap: {
    alignItems: "center",
    backgroundColor: "#F7F7FB",
    borderColor: "#E5E5EF",
    borderRadius: 13,
    borderWidth: 1,
    flexDirection: "row",
    gap: 9,
    minHeight: 50,
    paddingHorizontal: 13,
  },
  searchInput: { color: "#202136", flex: 1, fontSize: 15, minHeight: 46 },
  results: { gap: 8, paddingBottom: 3 },
  searchNote: {
    color: "#77758C",
    fontSize: 13,
    lineHeight: 19,
    paddingVertical: 6,
  },
  error: { color: "#A02820", fontSize: 13, lineHeight: 19, paddingVertical: 6 },
  result: {
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderColor: "#E5E5EF",
    borderRadius: 13,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 52,
    paddingHorizontal: 13,
  },
  resultActive: { backgroundColor: "#F0EFFB", borderColor: "#4438CA" },
  resultName: {
    color: "#363653",
    flex: 1,
    fontSize: 15,
    fontWeight: "700",
    paddingRight: 12,
  },
});
