import { Ionicons } from "@expo/vector-icons";
import { useEffect, useRef, useState } from "react";
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

import {
  createTicketRequester,
  searchTicketRequesters,
  type TicketRequester,
} from "@/lib/nextdesk-tickets";
import { useMobileFeatures } from "@/components/mobile-feature-gate";
import { makeThemedStyles, useAppColors } from "@/lib/themed-styles";

type RequesterPickerProps = {
  autoOpen?: boolean;
  contextLabel?: string;
  defaultRequester: TicketRequester;
  onChange: (requester: TicketRequester) => void;
  onClose?: () => void;
  tenantId: string;
  value: TicketRequester | null;
};

export function RequesterPicker({
  autoOpen = false,
  contextLabel = "TICKET ERFASSEN",
  defaultRequester,
  onChange,
  onClose,
  tenantId,
  value,
}: RequesterPickerProps) {
  const styles = useStyles();
  const colors = useAppColors();
  const { loading: checkingFeatures, tenantId: confirmedTenantId } =
    useMobileFeatures();
  const [isOpen, setIsOpen] = useState(autoOpen);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TicketRequester[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const resultsScrollRef = useRef<ScrollView>(null);
  const queryLength = Array.from(query.trim()).length;
  const selected = value ?? defaultRequester;

  function closePicker() {
    setIsOpen(false);
    onClose?.();
  }

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
    setShowCreateForm(false);
    setCreateError("");
    setIsOpen(true);
  }

  function changeQuery(nextQuery: string) {
    setQuery(nextQuery);
    if (Array.from(nextQuery.trim()).length < 2) {
      setResults([]);
      setIsSearching(false);
      setSearchError("");
    }
    setShowCreateForm(false);
    setCreateError("");
  }

  function selectRequester(requester: TicketRequester) {
    onChange(requester);
    closePicker();
  }

  function openCreateForm() {
    setNewName(query.trim());
    setNewEmail("");
    setCreateError("");
    setShowCreateForm(true);
    requestAnimationFrame(() => {
      resultsScrollRef.current?.scrollToEnd({ animated: true });
    });
  }

  function revealCreateFormAboveKeyboard() {
    requestAnimationFrame(() => {
      setTimeout(() => {
        resultsScrollRef.current?.scrollToEnd({ animated: true });
      }, 160);
    });
  }

  async function createRequester() {
    const displayName = newName.trim();
    if (Array.from(displayName).length < 2) {
      setCreateError(
        "Bitte geben Sie einen Namen mit mindestens zwei Zeichen ein.",
      );
      return;
    }
    setCreating(true);
    setCreateError("");
    try {
      const created = await createTicketRequester({
        tenantId,
        displayName,
        email: newEmail,
      });
      selectRequester(created);
    } catch (error) {
      setCreateError(
        error instanceof Error
          ? error.message
          : "Die anfragende Person konnte nicht angelegt werden.",
      );
    } finally {
      setCreating(false);
    }
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
          <Ionicons
            color={colors.primaryText}
            name="pencil-outline"
            size={18}
          />
        </View>
      </Pressable>

      <Modal
        animationType="slide"
        onRequestClose={closePicker}
        transparent
        visible={isOpen && !checkingFeatures && Boolean(confirmedTenantId)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.modalRoot}
        >
          <Pressable
            accessibilityLabel="Auswahl schliessen"
            accessibilityRole="button"
            onPress={closePicker}
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
                onPress={closePicker}
                style={styles.closeButton}
              >
                <Ionicons color={colors.primaryText} name="close" size={22} />
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
                <Ionicons
                  color={colors.primaryText}
                  name="checkmark-circle"
                  size={22}
                />
              ) : null}
            </Pressable>

            <Text style={styles.searchLabel}>ANDERE PERSON SUCHEN</Text>
            <View style={styles.searchInputWrap}>
              <Ionicons color={colors.muted} name="search-outline" size={19} />
              <TextInput
                autoCapitalize="words"
                autoCorrect={false}
                onChangeText={changeQuery}
                placeholder="Name eingeben"
                placeholderTextColor={colors.subtle}
                style={styles.searchInput}
                value={query}
              />
              {isSearching ? (
                <ActivityIndicator color={colors.primary} size="small" />
              ) : null}
            </View>

            <ScrollView
              automaticallyAdjustKeyboardInsets
              contentContainerStyle={styles.results}
              keyboardDismissMode="interactive"
              keyboardShouldPersistTaps="handled"
              ref={resultsScrollRef}
              showsVerticalScrollIndicator={false}
              style={styles.resultsScroll}
            >
              {queryLength < 2 ? (
                <Text style={styles.searchNote}>
                  Geben Sie mindestens zwei Buchstaben ein, um Personen dieses
                  Mandanten zu suchen.
                </Text>
              ) : searchError ? (
                <Text style={styles.error}>{searchError}</Text>
              ) : (
                <>
                  {!isSearching && results.length === 0 ? (
                    <Text style={styles.searchNote}>
                      Keine passende anfragende Person gefunden.
                    </Text>
                  ) : null}
                  {results.map((requester) => (
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
                        <Ionicons
                          color={colors.primaryText}
                          name="checkmark"
                          size={20}
                        />
                      ) : (
                        <Ionicons
                          color={colors.muted}
                          name="chevron-forward"
                          size={18}
                        />
                      )}
                    </Pressable>
                  ))}
                  {!isSearching && !showCreateForm ? (
                    <Pressable
                      accessibilityRole="button"
                      onPress={openCreateForm}
                      style={styles.createAction}
                    >
                      <Ionicons
                        color={colors.primaryText}
                        name="person-add-outline"
                        size={19}
                      />
                      <Text style={styles.createActionText}>
                        Neue anfragende Person hinzufügen
                      </Text>
                    </Pressable>
                  ) : null}
                  {showCreateForm ? (
                    <View style={styles.createForm}>
                      <Text style={styles.createTitle}>
                        Neue anfragende Person
                      </Text>
                      <TextInput
                        autoCapitalize="words"
                        onChangeText={setNewName}
                        onFocus={revealCreateFormAboveKeyboard}
                        placeholder="Vor- und Nachname"
                        placeholderTextColor={colors.subtle}
                        style={styles.createInput}
                        value={newName}
                      />
                      <TextInput
                        autoCapitalize="none"
                        autoCorrect={false}
                        keyboardType="email-address"
                        onChangeText={setNewEmail}
                        onFocus={revealCreateFormAboveKeyboard}
                        placeholder="E-Mail-Adresse (optional)"
                        placeholderTextColor={colors.subtle}
                        style={styles.createInput}
                        value={newEmail}
                      />
                      {createError ? (
                        <Text style={styles.error}>{createError}</Text>
                      ) : null}
                      <Pressable
                        accessibilityRole="button"
                        disabled={creating}
                        onPress={() => void createRequester()}
                        style={[
                          styles.createSubmit,
                          creating && styles.createSubmitDisabled,
                        ]}
                      >
                        {creating ? (
                          <ActivityIndicator
                            color={colors.onPrimary}
                            size="small"
                          />
                        ) : (
                          <Ionicons
                            color={colors.onPrimary}
                            name="person-add"
                            size={18}
                          />
                        )}
                        <Text style={styles.createSubmitText}>
                          {creating ? "Wird angelegt …" : "Person anlegen"}
                        </Text>
                      </Pressable>
                    </View>
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

const useStyles = makeThemedStyles((c) => ({
  control: {
    alignItems: "center",
    backgroundColor: c.primarySoft,
    borderColor: c.primarySoftBorder,
    borderRadius: 13,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 60,
    paddingHorizontal: 13,
  },
  controlCopy: { flex: 1, gap: 2, paddingRight: 10 },
  controlName: { color: c.text, fontSize: 15, fontWeight: "800" },
  controlHint: { color: c.muted, fontSize: 12, fontWeight: "600" },
  editIcon: {
    alignItems: "center",
    backgroundColor: c.surface,
    borderRadius: 14,
    height: 32,
    justifyContent: "center",
    width: 32,
  },
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
  defaultRequester: {
    alignItems: "center",
    backgroundColor: c.surfaceSubtle,
    borderColor: c.border,
    borderRadius: 15,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 63,
    paddingHorizontal: 14,
  },
  defaultRequesterActive: {
    backgroundColor: c.primarySoft,
    borderColor: c.primarySoftBorder,
  },
  defaultCopy: { flex: 1, gap: 3 },
  defaultLabel: {
    color: c.muted,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.8,
  },
  defaultName: { color: c.text, fontSize: 15, fontWeight: "800" },
  searchLabel: {
    color: c.muted,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.9,
    marginTop: 2,
  },
  searchInputWrap: {
    alignItems: "center",
    backgroundColor: c.surfaceSubtle,
    borderColor: c.border,
    borderRadius: 13,
    borderWidth: 1,
    flexDirection: "row",
    gap: 9,
    minHeight: 50,
    paddingHorizontal: 13,
  },
  searchInput: { color: c.foreground, flex: 1, fontSize: 15, minHeight: 46 },
  resultsScroll: { flexShrink: 1 },
  results: { flexGrow: 1, gap: 8, paddingBottom: 24 },
  searchNote: {
    color: c.muted,
    fontSize: 13,
    lineHeight: 19,
    paddingVertical: 6,
  },
  error: { color: c.error, fontSize: 13, lineHeight: 19, paddingVertical: 6 },
  result: {
    alignItems: "center",
    backgroundColor: c.surface,
    borderColor: c.border,
    borderRadius: 13,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 52,
    paddingHorizontal: 13,
  },
  resultActive: {
    backgroundColor: c.primarySoft,
    borderColor: c.primarySoftBorder,
  },
  resultName: {
    color: c.text,
    flex: 1,
    fontSize: 15,
    fontWeight: "700",
    paddingRight: 12,
  },
  createAction: {
    alignItems: "center",
    backgroundColor: c.primarySoft,
    borderColor: c.primarySoftBorder,
    borderRadius: 13,
    borderWidth: 1,
    flexDirection: "row",
    gap: 9,
    justifyContent: "center",
    minHeight: 50,
    paddingHorizontal: 13,
  },
  createActionText: { color: c.primaryText, fontSize: 14, fontWeight: "800" },
  createForm: {
    backgroundColor: c.surfaceSubtle,
    borderColor: c.border,
    borderRadius: 15,
    borderWidth: 1,
    gap: 9,
    padding: 13,
  },
  createTitle: { color: c.text, fontSize: 14, fontWeight: "900" },
  createInput: {
    backgroundColor: c.surface,
    borderColor: c.border,
    borderRadius: 11,
    borderWidth: 1,
    color: c.foreground,
    fontSize: 14,
    minHeight: 46,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  createSubmit: {
    alignItems: "center",
    backgroundColor: c.primary,
    borderRadius: 11,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    minHeight: 46,
    paddingHorizontal: 12,
  },
  createSubmitDisabled: { opacity: 0.6 },
  createSubmitText: { color: c.onPrimary, fontSize: 14, fontWeight: "800" },
}));
