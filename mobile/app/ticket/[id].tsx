import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
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
  loadMobileTicketDetail,
  updateMobileTicket,
  type MobileTicketDetail,
} from "@/lib/nextdesk-tickets";

export default function TicketDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [tenant, setTenant] = useState<MobileTenant | null>(null);
  const [ticket, setTicket] = useState<MobileTicketDetail | null>(null);
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    if (!id) return;
    try {
      setError("");
      const currentTenant = await loadCurrentTenant();
      const detail = await loadMobileTicketDetail(currentTenant.id, id);
      setTenant(currentTenant);
      setTicket(detail);
      setSubject(detail.subject);
      setDescription(detail.description);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Die Ticketdetails konnten nicht geladen werden.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [id]);

  const status = useMemo(
    () =>
      ticket?.statusOptions.find((option) => option.id === ticket.statusId) ??
      null,
    [ticket],
  );
  const priority = useMemo(
    () =>
      ticket?.priorityOptions.find(
        (option) => option.id === ticket.priorityId,
      ) ?? null,
    [ticket],
  );

  async function save() {
    if (!ticket || !tenant) return;
    if (subject.trim().length < 3 || !description.trim()) {
      setError("Betreff und Beschreibung müssen ausgefüllt sein.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await updateMobileTicket({
        tenantId: tenant.id,
        ticketId: ticket.id,
        subject: subject.trim(),
        description: description.trim(),
      });
      setTicket({
        ...ticket,
        subject: subject.trim(),
        description: description.trim(),
      });
      setEditing(false);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Das Ticket konnte nicht gespeichert werden.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <ScreenContainer containerClassName="bg-[#F6F7FB]" className="px-5">
        <View style={styles.centered}>
          <ActivityIndicator color="#4438CA" size="large" />
          <Text style={styles.copy}>Ticketdetails werden geladen …</Text>
        </View>
      </ScreenContainer>
    );
  }

  if (!ticket) {
    return (
      <ScreenContainer containerClassName="bg-[#F6F7FB]" className="px-5">
        <View style={styles.centered}>
          <Text style={styles.emptyTitle}>
            {error || "Ticket nicht gefunden"}
          </Text>
          <Pressable
            onPress={() => router.back()}
            style={styles.secondaryButton}
          >
            <Text style={styles.secondaryButtonText}>Zur Übersicht</Text>
          </Pressable>
        </View>
      </ScreenContainer>
    );
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
          <Text numberOfLines={1} style={styles.topTitle}>
            Ticketdetails
          </Text>
          {ticket.canUpdate ? (
            <Pressable
              accessibilityRole="button"
              disabled={saving}
              onPress={() => setEditing((current) => !current)}
              style={styles.editButton}
            >
              <Ionicons
                color="#4438CA"
                name={editing ? "close" : "create-outline"}
                size={19}
              />
            </Pressable>
          ) : (
            <View style={styles.topSpacer} />
          )}
        </View>

        <View style={styles.ticketHead}>
          <Text style={styles.ticketId}>{ticket.ticketNumber}</Text>
          {editing ? (
            <TextInput
              autoCapitalize="sentences"
              maxLength={240}
              onChangeText={setSubject}
              style={styles.titleInput}
              value={subject}
            />
          ) : (
            <Text style={styles.title}>{ticket.subject}</Text>
          )}
          {status ? (
            <View
              style={[
                styles.status,
                status.is_closed ? styles.statusResolved : styles.statusOpen,
              ]}
            >
              <Text
                style={[
                  styles.statusText,
                  status.is_closed
                    ? styles.statusTextResolved
                    : styles.statusTextOpen,
                ]}
              >
                {status.label}
              </Text>
            </View>
          ) : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardLabel}>ANFRAGENDE PERSON</Text>
          <Text style={styles.cardValue}>
            {ticket.requesterName ?? "Anfragende Person"}
          </Text>
          <Text style={styles.cardLabel}>PRIORITÄT</Text>
          <Text style={styles.cardValue}>
            {priority?.label ?? "Ohne Priorität"}
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardLabel}>BESCHREIBUNG</Text>
          {editing ? (
            <TextInput
              autoCapitalize="sentences"
              multiline
              onChangeText={setDescription}
              style={styles.descriptionInput}
              textAlignVertical="top"
              value={description}
            />
          ) : (
            <Text style={styles.description}>{ticket.description}</Text>
          )}
        </View>

        {editing ? (
          <Pressable
            accessibilityRole="button"
            disabled={saving}
            onPress={() => void save()}
            style={[styles.primaryButton, saving && styles.disabled]}
          >
            {saving ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Ionicons color="#FFFFFF" name="save-outline" size={19} />
            )}
            <Text style={styles.primaryButtonText}>
              {saving
                ? "Änderungen werden gespeichert …"
                : "Änderungen speichern"}
            </Text>
          </Pressable>
        ) : ticket.canUpdate ? (
          <Text style={styles.hint}>
            Tippe oben auf das Stift-Symbol, um Betreff und Beschreibung direkt
            zu bearbeiten.
          </Text>
        ) : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: { gap: 16, paddingTop: 14, paddingBottom: 30 },
  centered: {
    alignItems: "center",
    flex: 1,
    gap: 18,
    justifyContent: "center",
  },
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
  editButton: {
    alignItems: "center",
    backgroundColor: "#EEECFF",
    borderRadius: 18,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  topTitle: { color: "#202136", fontSize: 17, fontWeight: "800" },
  topSpacer: { width: 40 },
  ticketHead: { gap: 8, paddingTop: 8 },
  ticketId: {
    color: "#77758C",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.8,
  },
  title: {
    color: "#202136",
    fontSize: 27,
    fontWeight: "800",
    letterSpacing: -0.5,
    lineHeight: 33,
  },
  titleInput: {
    backgroundColor: "#FFFFFF",
    borderColor: "#8B82F4",
    borderRadius: 13,
    borderWidth: 1,
    color: "#202136",
    fontSize: 22,
    fontWeight: "800",
    lineHeight: 29,
    padding: 11,
  },
  status: {
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  statusText: { fontSize: 12, fontWeight: "800" },
  statusOpen: { backgroundColor: "#E0F6FB" },
  statusResolved: { backgroundColor: "#E9F8EE" },
  statusTextOpen: { color: "#036B83" },
  statusTextResolved: { color: "#166534" },
  card: {
    backgroundColor: "#FFFFFF",
    borderColor: "#ECECF3",
    borderRadius: 20,
    borderWidth: 1,
    gap: 7,
    padding: 17,
  },
  cardLabel: {
    color: "#77758C",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.9,
    marginTop: 2,
  },
  cardValue: {
    color: "#202136",
    fontSize: 15,
    fontWeight: "700",
    marginBottom: 8,
  },
  description: { color: "#4B4C60", fontSize: 15, lineHeight: 23 },
  descriptionInput: {
    backgroundColor: "#F7F7FB",
    borderColor: "#8B82F4",
    borderRadius: 13,
    borderWidth: 1,
    color: "#202136",
    fontSize: 15,
    lineHeight: 23,
    minHeight: 145,
    padding: 12,
  },
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
  secondaryButton: {
    backgroundColor: "#EEECFF",
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  secondaryButtonText: { color: "#4438CA", fontWeight: "800" },
  hint: { color: "#77758C", fontSize: 12, lineHeight: 18, textAlign: "center" },
  copy: { color: "#626376", fontSize: 15 },
  emptyTitle: {
    color: "#202136",
    fontSize: 17,
    fontWeight: "800",
    textAlign: "center",
  },
  error: { color: "#A02820", fontSize: 13, lineHeight: 19 },
  disabled: { opacity: 0.55 },
});
