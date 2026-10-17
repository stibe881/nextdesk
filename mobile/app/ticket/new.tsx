import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { loadCurrentTenant, type MobileTenant } from "@/lib/nextdesk-client";
import {
  createMobileTicket,
  loadTicketFormOptions,
  type TicketRequester,
  type TicketFormOptions,
} from "@/lib/nextdesk-tickets";
import { RequesterPicker } from "@/components/requester-picker";

export default function NewTicketScreen() {
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

  useEffect(() => {
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
  }, []);

  const selectedDepartment = useMemo(
    () =>
      options?.departments.find(
        (department) => department.id === departmentId,
      ) ?? null,
    [departmentId, options],
  );
  const selectedRequester = requester ?? options?.currentRequester ?? null;

  async function createTicket() {
    if (!tenant || !options) return;
    const cleanSubject = subject.trim();
    const cleanDescription = description.trim();
    if (cleanSubject.length < 3) {
      setError("Bitte geben Sie einen Betreff mit mindestens 3 Zeichen ein.");
      return;
    }
    if (!cleanDescription) {
      setError("Bitte beschreiben Sie Ihr Anliegen.");
      return;
    }
    if (!departmentId || !priorityKey) {
      setError("Bitte wählen Sie Abteilung und Priorität.");
      return;
    }
    if (!selectedRequester) {
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
    } catch (nextError) {
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
    <ScreenContainer containerClassName="bg-[#F6F7FB]" className="px-5">
      <ScrollView
        contentContainerStyle={styles.content}
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
            <Ionicons color="#4438CA" name="arrow-back" size={22} />
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
            <ActivityIndicator color="#4438CA" />
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
              placeholder="z. B. VPN-Zugang für Homeoffice"
              placeholderTextColor="#9A99AA"
              style={styles.input}
              value={subject}
            />

            <FieldLabel label="BESCHREIBUNG" />
            <TextInput
              autoCapitalize="sentences"
              multiline
              onChangeText={setDescription}
              placeholder="Beschreibe dein Anliegen möglichst genau."
              placeholderTextColor="#9A99AA"
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
                  onPress={() => setDepartmentId(department.id)}
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
                  onPress={() => setPriorityKey(priority.key)}
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
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Ionicons color="#FFFFFF" name="add-circle-outline" size={20} />
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
  return <Text style={styles.label}>{label}</Text>;
}

const styles = StyleSheet.create({
  content: { gap: 16, paddingTop: 14, paddingBottom: 30 },
  topBar: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  backButton: {
    alignItems: "center",
    backgroundColor: "#EEECFF",
    borderRadius: 18,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  topTitle: { color: "#202136", fontSize: 17, fontWeight: "800" },
  topSpacer: { width: 40 },
  intro: { gap: 8, paddingTop: 10 },
  title: {
    color: "#202136",
    fontSize: 27,
    fontWeight: "800",
    letterSpacing: -0.5,
    lineHeight: 33,
  },
  copy: { color: "#626376", fontSize: 15, lineHeight: 23 },
  centered: { alignItems: "center", gap: 10, paddingVertical: 35 },
  form: {
    backgroundColor: "#FFFFFF",
    borderColor: "#ECECF3",
    borderRadius: 20,
    borderWidth: 1,
    gap: 8,
    padding: 17,
  },
  label: {
    color: "#77758C",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.9,
    marginTop: 7,
  },
  input: {
    backgroundColor: "#F7F7FB",
    borderColor: "#E5E5EF",
    borderRadius: 13,
    borderWidth: 1,
    color: "#202136",
    fontSize: 15,
    minHeight: 50,
    paddingHorizontal: 13,
    paddingVertical: 11,
  },
  descriptionInput: { minHeight: 126 },
  choiceList: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  choice: {
    backgroundColor: "#F7F7FB",
    borderColor: "#E5E5EF",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  choiceActive: { backgroundColor: "#EEECFF", borderColor: "#4438CA" },
  choiceText: { color: "#626376", fontSize: 13, fontWeight: "700" },
  choiceTextActive: { color: "#4438CA" },
  hint: { color: "#77758C", fontSize: 12, lineHeight: 18 },
  error: { color: "#A02820", fontSize: 13, lineHeight: 19 },
  primaryButton: {
    alignItems: "center",
    backgroundColor: "#4438CA",
    borderRadius: 16,
    flexDirection: "row",
    gap: 9,
    justifyContent: "center",
    minHeight: 52,
    paddingHorizontal: 16,
  },
  primaryButtonText: { color: "#FFFFFF", fontSize: 15, fontWeight: "800" },
  disabled: { opacity: 0.55 },
});
