import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  findNodeHandle,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

import { RequesterPicker } from "@/components/requester-picker";
import { ScreenContainer } from "@/components/screen-container";
import { useMobileNetworkStatus } from "@/components/offline-status";
import {
  hapticError,
  hapticSelection,
  hapticSuccess,
} from "@/lib/mobile-haptics";
import { loadCurrentTenant, type MobileTenant } from "@/lib/nextdesk-client";
import {
  createMobileTicket,
  loadTicketFormOptions,
  type TicketRequester,
  type TicketFormOptions,
} from "@/lib/nextdesk-tickets";
import { makeThemedStyles, useAppColors } from "@/lib/themed-styles";

export default function NewTicketScreen() {
  const { isOffline } = useMobileNetworkStatus();
  const [tenant, setTenant] = useState<MobileTenant | null>(null);
  const [options, setOptions] = useState<TicketFormOptions | null>(null);
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [priorityKey, setPriorityKey] = useState("");
  const [requester, setRequester] = useState<TicketRequester | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const scrollViewRef = useRef<ScrollView>(null);
  const subjectInputRef = useRef<TextInput>(null);
  const descriptionInputRef = useRef<TextInput>(null);
  const styles = useStyles();
  const colors = useAppColors();

  useEffect(() => {
    if (isOffline) return;
    void (async () => {
      try {
        const currentTenant = await loadCurrentTenant();
        const formOptions = await loadTicketFormOptions(currentTenant.id);
        setTenant(currentTenant);
        setOptions(formOptions);
        setDepartmentId(formOptions.departments[0]?.id ?? "");
        setPriorityKey(formOptions.priorities[0]?.key ?? "");
        setRequester(formOptions.currentRequester);
      } catch (nextError) {
        setError(
          nextError instanceof Error
            ? nextError.message
            : "Die Erfassung konnte nicht vorbereitet werden.",
        );
      } finally {
        setLoading(false);
      }
    })();
  }, [isOffline]);

  const selectedDepartment = useMemo(
    () =>
      options?.departments.find(
        (department) => department.id === departmentId,
      ) ?? null,
    [departmentId, options],
  );
  const selectedRequester = requester ?? options?.currentRequester ?? null;

  if (isOffline) {
    return (
      <ScreenContainer className="px-5">
        <View style={styles.offlineGuard}>
          <View style={styles.offlineGuardIcon}>
            <Ionicons
              color={colors.warning}
              name="cloud-offline-outline"
              size={25}
            />
          </View>
          <Text style={styles.offlineGuardTitle}>
            Ticketerfassung benötigt eine Verbindung
          </Text>
          <Text style={styles.offlineGuardText}>
            Neue Tickets werden ausschliesslich nach einer serverseitigen
            Mandanten- und Rechteprüfung erfasst.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.back()}
            style={styles.offlineGuardButton}
          >
            <Text style={styles.offlineGuardButtonText}>Zurück zu Tickets</Text>
          </Pressable>
        </View>
      </ScreenContainer>
    );
  }

  function revealFieldAboveKeyboard(input: TextInput | null) {
    const inputHandle = findNodeHandle(input);
    const scrollResponder = scrollViewRef.current?.getScrollResponder();
    if (!inputHandle || !scrollResponder) return;
    requestAnimationFrame(() => {
      setTimeout(() => {
        scrollResponder.scrollResponderScrollNativeHandleToKeyboard(
          inputHandle,
          88,
          true,
        );
      }, 120);
    });
  }

  async function createTicket() {
    if (isOffline) {
      hapticError();
      setError(
        "Tickets können erst wieder erfasst werden, wenn eine Verbindung zum autorisierten Server besteht.",
      );
      return;
    }
    if (!tenant || !options) return;
    const cleanSubject = subject.trim();
    const cleanDescription = description.trim();
    if (cleanSubject.length < 3) {
      hapticError();
      setError("Bitte geben Sie einen Betreff mit mindestens 3 Zeichen ein.");
      return;
    }
    if (!cleanDescription) {
      hapticError();
      setError("Bitte beschreiben Sie Ihr Anliegen.");
      return;
    }
    if (!departmentId || !priorityKey) {
      hapticError();
      setError("Bitte wählen Sie Abteilung und Priorität.");
      return;
    }
    if (!selectedRequester) {
      hapticError();
      setError("Bitte wählen Sie eine anfragende Person.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const ticket = await createMobileTicket({
        tenantId: tenant.id,
        departmentId,
        priorityKey,
        requesterContactId: selectedRequester.id,
        subject: cleanSubject,
        description: cleanDescription,
      });
      router.replace({
        pathname: "/ticket/[id]",
        params: { id: ticket.ticketId },
      });
      hapticSuccess();
    } catch (nextError) {
      hapticError();
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Das Ticket konnte nicht erfasst werden.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScreenContainer className="px-5">
      <ScrollView
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        ref={scrollViewRef}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.topBar}>
          <Pressable
            accessibilityLabel="Zurück zur Übersicht"
            accessibilityRole="button"
            hitSlop={10}
            onPress={() => router.back()}
            style={styles.backButton}
          >
            <Ionicons color={colors.primaryText} name="arrow-back" size={22} />
          </Pressable>
          <Text style={styles.topTitle}>Ticket erfassen</Text>
          <View style={styles.topSpacer} />
        </View>

        <View style={styles.intro}>
          <Text style={styles.title}>Was können wir für dich tun?</Text>
          <Text style={styles.copy}>
            Dein Ticket wird direkt im Mandanten {tenant?.name ?? "nextDesk"}{" "}
            erfasst.
          </Text>
        </View>

        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.copy}>Formular wird geladen …</Text>
          </View>
        ) : options ? (
          <View style={styles.form}>
            <FieldLabel label="ANFRAGENDE PERSON" />
            <RequesterPicker
              defaultRequester={options.currentRequester}
              onChange={setRequester}
              tenantId={tenant?.id ?? ""}
              value={selectedRequester}
            />

            <FieldLabel label="BETREFF" />
            <TextInput
              autoCapitalize="sentences"
              maxLength={240}
              onChangeText={setSubject}
              onFocus={() => revealFieldAboveKeyboard(subjectInputRef.current)}
              placeholder="z. B. VPN-Zugang für Homeoffice"
              placeholderTextColor={colors.subtle}
              ref={subjectInputRef}
              style={styles.input}
              value={subject}
            />

            <FieldLabel label="BESCHREIBUNG" />
            <TextInput
              autoCapitalize="sentences"
              multiline
              onChangeText={setDescription}
              onFocus={() =>
                revealFieldAboveKeyboard(descriptionInputRef.current)
              }
              placeholder="Beschreibe dein Anliegen möglichst genau."
              placeholderTextColor={colors.subtle}
              ref={descriptionInputRef}
              style={[styles.input, styles.descriptionInput]}
              textAlignVertical="top"
              value={description}
            />

            <FieldLabel label="ABTEILUNG" />
            <View style={styles.choiceList}>
              {options.departments.map((department) => (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{
                    selected: department.id === departmentId,
                  }}
                  key={department.id}
                  onPress={() => {
                    hapticSelection();
                    setDepartmentId(department.id);
                  }}
                  style={[
                    styles.choice,
                    department.id === departmentId && styles.choiceActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.choiceText,
                      department.id === departmentId && styles.choiceTextActive,
                    ]}
                  >
                    {department.name}
                  </Text>
                </Pressable>
              ))}
            </View>
            {selectedDepartment ? (
              <Text style={styles.hint}>
                Bearbeitende Abteilung: {selectedDepartment.name}
              </Text>
            ) : null}

            <FieldLabel label="PRIORITÄT" />
            <View style={styles.choiceList}>
              {options.priorities.map((priority) => (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{
                    selected: priority.key === priorityKey,
                  }}
                  key={priority.key}
                  onPress={() => {
                    hapticSelection();
                    setPriorityKey(priority.key);
                  }}
                  style={[
                    styles.choice,
                    priority.key === priorityKey && styles.choiceActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.choiceText,
                      priority.key === priorityKey && styles.choiceTextActive,
                    ]}
                  >
                    {priority.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable
          accessibilityRole="button"
          disabled={loading || saving || !options}
          onPress={() => void createTicket()}
          style={[
            styles.primaryButton,
            (loading || saving || !options) && styles.disabled,
          ]}
        >
          {saving ? (
            <ActivityIndicator color={colors.onPrimary} />
          ) : (
            <Ionicons
              color={colors.onPrimary}
              name="add-circle-outline"
              size={20}
            />
          )}
          <Text style={styles.primaryButtonText}>
            {saving ? "Ticket wird erfasst …" : "Ticket erfassen"}
          </Text>
        </Pressable>
      </ScrollView>
    </ScreenContainer>
  );
}

function FieldLabel({ label }: { label: string }) {
  const styles = useStyles();
  return <Text style={styles.label}>{label}</Text>;
}

const useStyles = makeThemedStyles((c) => ({
  content: { gap: 16, paddingTop: 14, paddingBottom: 320 },
  offlineGuard: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 22,
  },
  offlineGuardIcon: {
    alignItems: "center",
    backgroundColor: c.warningSoft,
    borderRadius: 20,
    height: 56,
    justifyContent: "center",
    width: 56,
  },
  offlineGuardTitle: {
    color: c.foreground,
    fontSize: 19,
    fontWeight: "900",
    marginTop: 16,
    textAlign: "center",
  },
  offlineGuardText: {
    color: c.muted,
    fontSize: 14,
    lineHeight: 21,
    marginTop: 8,
    textAlign: "center",
  },
  offlineGuardButton: {
    backgroundColor: c.primarySoft,
    borderRadius: 14,
    marginTop: 20,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  offlineGuardButtonText: {
    color: c.primaryText,
    fontSize: 13,
    fontWeight: "900",
  },
  topBar: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  backButton: {
    alignItems: "center",
    backgroundColor: c.primarySoft,
    borderRadius: 18,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  topTitle: { color: c.foreground, fontSize: 17, fontWeight: "800" },
  topSpacer: { width: 40 },
  intro: { gap: 8, paddingTop: 10 },
  title: {
    color: c.foreground,
    fontSize: 27,
    fontWeight: "800",
    letterSpacing: -0.5,
    lineHeight: 33,
  },
  copy: { color: c.muted, fontSize: 15, lineHeight: 23 },
  centered: { alignItems: "center", gap: 10, paddingVertical: 35 },
  form: {
    backgroundColor: c.surface,
    borderColor: c.surfaceSubtle,
    borderRadius: 20,
    borderWidth: 1,
    gap: 8,
    padding: 17,
  },
  label: {
    color: c.muted,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.9,
    marginTop: 7,
  },
  input: {
    backgroundColor: c.surfaceSubtle,
    borderColor: c.border,
    borderRadius: 13,
    borderWidth: 1,
    color: c.foreground,
    fontSize: 15,
    minHeight: 50,
    paddingHorizontal: 13,
    paddingVertical: 11,
  },
  descriptionInput: { minHeight: 126 },
  choiceList: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  choice: {
    backgroundColor: c.surfaceSubtle,
    borderColor: c.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  choiceActive: {
    backgroundColor: c.primarySoft,
    borderColor: c.primaryText,
  },
  choiceText: { color: c.muted, fontSize: 13, fontWeight: "700" },
  choiceTextActive: { color: c.primaryText },
  hint: { color: c.muted, fontSize: 12, lineHeight: 18 },
  error: { color: c.error, fontSize: 13, lineHeight: 19 },
  primaryButton: {
    alignItems: "center",
    backgroundColor: c.primary,
    borderRadius: 16,
    flexDirection: "row",
    gap: 9,
    justifyContent: "center",
    minHeight: 52,
    paddingHorizontal: 16,
  },
  primaryButtonText: { color: c.onPrimary, fontSize: 15, fontWeight: "800" },
  disabled: { opacity: 0.55 },
}));
