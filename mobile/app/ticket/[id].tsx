import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
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

import { ScreenContainer } from "@/components/screen-container";
import { RequesterPicker } from "@/components/requester-picker";
import { TicketConversation } from "@/components/ticket-conversation";
import { loadCurrentTenant, type MobileTenant } from "@/lib/nextdesk-client";
import {
  addMobileTicketComment,
  loadMobileTicketDetail,
  updateMobileTicket,
  type MobileTicketDetail,
  type TicketRequester,
  type TicketCommentVisibility,
} from "@/lib/nextdesk-tickets";

export default function TicketDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [tenant, setTenant] = useState<MobileTenant | null>(null);
  const [ticket, setTicket] = useState<MobileTicketDetail | null>(null);
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [statusKey, setStatusKey] = useState("");
  const [priorityKey, setPriorityKey] = useState("");
  const [requester, setRequester] = useState<TicketRequester | null>(null);
  const [comment, setComment] = useState("");
  const [commentVisibility, setCommentVisibility] =
    useState<TicketCommentVisibility>("internal");
  const [editing, setEditing] = useState(false);
  const [selection, setSelection] = useState<"status" | "priority" | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sendingComment, setSendingComment] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(
    async (syncEditor = true) => {
      if (!id) return;
      try {
        setError("");
        const currentTenant = await loadCurrentTenant();
        const detail = await loadMobileTicketDetail(currentTenant.id, id);
        setTenant(currentTenant);
        setTicket(detail);
        if (syncEditor) {
          setRequester(detail.requesterContact);
          setSubject(detail.subject);
          setDescription(detail.description);
          setStatusKey(
            detail.statusOptions.find((option) => option.id === detail.statusId)
              ?.key ?? "",
          );
          setPriorityKey(
            detail.priorityOptions.find(
              (option) => option.id === detail.priorityId,
            )?.key ?? "",
          );
        }
        setCommentVisibility((current) => {
          if (current === "internal" && detail.canWriteInternalNotes) {
            return current;
          }
          if (current === "external" && detail.canCommentExternal) {
            return current;
          }
          return detail.canWriteInternalNotes ? "internal" : "external";
        });
      } catch (nextError) {
        setError(
          nextError instanceof Error
            ? nextError.message
            : "Die Ticketdetails konnten nicht geladen werden.",
        );
      } finally {
        setLoading(false);
      }
    },
    [id],
  );

  useEffect(() => {
    const task = setTimeout(() => void load(), 0);
    return () => clearTimeout(task);
  }, [load]);

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
  const editableStatuses = useMemo(
    () =>
      (ticket?.statusOptions ?? []).filter(
        (option) =>
          !option.is_closed ||
          ticket?.canClose ||
          option.id === ticket?.statusId,
      ),
    [ticket],
  );

  function resetEditor() {
    if (!ticket) return;
    setSubject(ticket.subject);
    setDescription(ticket.description);
    setStatusKey(
      ticket.statusOptions.find((option) => option.id === ticket.statusId)
        ?.key ?? "",
    );
    setPriorityKey(
      ticket.priorityOptions.find((option) => option.id === ticket.priorityId)
        ?.key ?? "",
    );
    setRequester(ticket.requesterContact);
  }

  function toggleEditing() {
    if (editing) resetEditor();
    setError("");
    setSelection(null);
    setEditing((current) => !current);
  }

  async function save() {
    if (!ticket || !tenant) return;
    if (subject.trim().length < 3 || !description.trim()) {
      setError("Betreff und Beschreibung müssen ausgefüllt sein.");
      return;
    }
    if (!statusKey || !priorityKey) {
      setError("Bitte wählen Sie Status und Priorität.");
      return;
    }
    const nextStatus = ticket.statusOptions.find(
      (option) => option.key === statusKey,
    );
    const nextPriority = ticket.priorityOptions.find(
      (option) => option.key === priorityKey,
    );
    if (!nextStatus || !nextPriority) {
      setError("Status oder Priorität sind nicht gültig.");
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
        statusKey,
        priorityKey,
        ...(requester ? { requesterContactId: requester.id } : {}),
      });
      setTicket({
        ...ticket,
        subject: subject.trim(),
        description: description.trim(),
        statusId: nextStatus.id,
        priorityId: nextPriority.id,
        requesterContact: requester,
        requesterName: requester?.displayName ?? null,
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

  async function sendComment() {
    if (!ticket || !tenant) return;
    const body = comment.trim();
    if (!body) {
      setError("Bitte schreiben Sie zuerst eine Nachricht.");
      return;
    }
    if (
      (commentVisibility === "internal" && !ticket.canWriteInternalNotes) ||
      (commentVisibility === "external" && !ticket.canCommentExternal)
    ) {
      setError(
        "Sie sind nicht berechtigt, diese Nachricht zu veröffentlichen.",
      );
      return;
    }

    setSendingComment(true);
    setError("");
    try {
      await addMobileTicketComment({
        tenantId: tenant.id,
        ticketId: ticket.id,
        body,
        visibility: commentVisibility,
      });
      setComment("");
      await load(false);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Die Nachricht konnte nicht veröffentlicht werden.",
      );
    } finally {
      setSendingComment(false);
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
            accessibilityRole="button"
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
        keyboardShouldPersistTaps="handled"
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
              accessibilityLabel={
                editing ? "Bearbeitung abbrechen" : "Ticket bearbeiten"
              }
              accessibilityRole="button"
              disabled={saving || sendingComment}
              onPress={toggleEditing}
              style={styles.editButton}
            >
              <Ionicons
                color="#4438CA"
                name={editing ? "close" : "create-outline"}
                size={19}
              />
              <Text style={styles.editButtonText}>
                {editing ? "Abbrechen" : "Bearbeiten"}
              </Text>
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

        <View style={styles.contextCard}>
          <View style={styles.contextItem}>
            <Text style={styles.cardLabel}>ANFRAGENDE PERSON</Text>
            <Text numberOfLines={2} style={styles.cardValue}>
              {ticket.requesterName ?? "Anfragende Person"}
            </Text>
          </View>
          <View style={styles.contextDivider} />
          <View style={styles.contextItem}>
            <Text style={styles.cardLabel}>PRIORITÄT</Text>
            <Text style={styles.cardValue}>
              {priority?.label ?? "Ohne Priorität"}
            </Text>
          </View>
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
          <View style={styles.editorCard}>
            <View style={styles.editorHeader}>
              <View>
                <Text style={styles.editTitle}>Ticket bearbeiten</Text>
                <Text style={styles.editorCopy}>
                  Passe die Angaben an und speichere sie gemeinsam.
                </Text>
              </View>
              <View style={styles.editorIcon}>
                <Ionicons color="#4438CA" name="create-outline" size={20} />
              </View>
            </View>

            <View style={styles.editorField}>
              <Text style={styles.fieldLabel}>ANFRAGENDE PERSON</Text>
              {requester ? (
                <RequesterPicker
                  contextLabel="TICKET BEARBEITEN"
                  defaultRequester={ticket.requesterContact ?? requester}
                  onChange={setRequester}
                  tenantId={tenant?.id ?? ""}
                  value={requester}
                />
              ) : (
                <Text style={styles.missingRequester}>
                  Für dieses Ticket ist keine anfragende Person hinterlegt.
                </Text>
              )}
            </View>

            <View style={styles.editorField}>
              <Text style={styles.fieldLabel}>STATUS</Text>
              <Pressable
                accessibilityLabel="Status auswählen"
                accessibilityRole="button"
                onPress={() => setSelection("status")}
                style={styles.selector}
              >
                <View>
                  <Text style={styles.selectorValue}>
                    {editableStatuses.find((option) => option.key === statusKey)
                      ?.label ?? "Status wählen"}
                  </Text>
                  <Text style={styles.selectorHint}>Antippen zum Ändern</Text>
                </View>
                <Ionicons color="#4438CA" name="chevron-down" size={19} />
              </Pressable>
            </View>

            <View style={styles.editorField}>
              <Text style={styles.fieldLabel}>PRIORITÄT</Text>
              <Pressable
                accessibilityLabel="Priorität auswählen"
                accessibilityRole="button"
                onPress={() => setSelection("priority")}
                style={styles.selector}
              >
                <View>
                  <Text style={styles.selectorValue}>
                    {ticket.priorityOptions.find(
                      (option) => option.key === priorityKey,
                    )?.label ?? "Priorität wählen"}
                  </Text>
                  <Text style={styles.selectorHint}>Antippen zum Ändern</Text>
                </View>
                <Ionicons color="#4438CA" name="chevron-down" size={19} />
              </Pressable>
            </View>

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
          </View>
        ) : ticket.canUpdate ? (
          <Text style={styles.hint}>
            Über «Bearbeiten» können Sie Betreff, Beschreibung, Status und
            Priorität anpassen.
          </Text>
        ) : null}

        <TicketConversation
          body={comment}
          canCommentExternal={ticket.canCommentExternal}
          canWriteInternalNotes={ticket.canWriteInternalNotes}
          comments={ticket.comments}
          isSending={sendingComment}
          onBodyChange={setComment}
          onSend={() => void sendComment()}
          onVisibilityChange={setCommentVisibility}
          visibility={commentVisibility}
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>

      <Modal
        animationType="slide"
        onRequestClose={() => setSelection(null)}
        transparent
        visible={selection !== null}
      >
        <View style={styles.selectionModalRoot}>
          <Pressable
            accessibilityLabel="Auswahl schliessen"
            accessibilityRole="button"
            onPress={() => setSelection(null)}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.selectionSheet}>
            <View style={styles.selectionHeader}>
              <View>
                <Text style={styles.selectionEyebrow}>TICKET BEARBEITEN</Text>
                <Text style={styles.selectionTitle}>
                  {selection === "status"
                    ? "Status wählen"
                    : "Priorität wählen"}
                </Text>
              </View>
              <Pressable
                accessibilityLabel="Auswahl schliessen"
                accessibilityRole="button"
                onPress={() => setSelection(null)}
                style={styles.selectionClose}
              >
                <Ionicons color="#4438CA" name="close" size={22} />
              </Pressable>
            </View>
            <ScrollView
              contentContainerStyle={styles.selectionOptions}
              showsVerticalScrollIndicator={false}
            >
              {(selection === "status"
                ? editableStatuses
                : ticket.priorityOptions
              ).map((option) => {
                const selected =
                  selection === "status"
                    ? statusKey === option.key
                    : priorityKey === option.key;
                return (
                  <Pressable
                    accessibilityRole="button"
                    key={option.id}
                    onPress={() => {
                      if (selection === "status") setStatusKey(option.key);
                      else setPriorityKey(option.key);
                      setSelection(null);
                    }}
                    style={[
                      styles.selectionOption,
                      selected && styles.selectionOptionActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.selectionOptionText,
                        selected && styles.selectionOptionTextActive,
                      ]}
                    >
                      {option.label}
                    </Text>
                    {selected ? (
                      <Ionicons color="#4438CA" name="checkmark" size={21} />
                    ) : (
                      <Ionicons
                        color="#858398"
                        name="chevron-forward"
                        size={19}
                      />
                    )}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: { gap: 16, paddingTop: 14, paddingBottom: 36 },
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
    borderRadius: 14,
    flexDirection: "row",
    gap: 5,
    height: 40,
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  editButtonText: { color: "#4438CA", fontSize: 12, fontWeight: "800" },
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
  contextCard: {
    alignItems: "stretch",
    backgroundColor: "#FFFFFF",
    borderColor: "#ECECF3",
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: "row",
    gap: 13,
    padding: 16,
  },
  contextItem: { flex: 1, gap: 5 },
  contextDivider: { backgroundColor: "#ECECF3", width: 1 },
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
  editorCard: {
    backgroundColor: "#FFFFFF",
    borderColor: "#DCD9F0",
    borderRadius: 22,
    borderWidth: 1,
    gap: 16,
    padding: 18,
  },
  editorHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  editorCopy: { color: "#77758C", fontSize: 12, lineHeight: 18, marginTop: 3 },
  editorIcon: {
    alignItems: "center",
    backgroundColor: "#EEECFF",
    borderRadius: 15,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  editorField: { gap: 7 },
  missingRequester: { color: "#77758C", fontSize: 13, lineHeight: 19 },
  selector: {
    alignItems: "center",
    backgroundColor: "#F7F7FB",
    borderColor: "#E1E0EC",
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 58,
    paddingHorizontal: 14,
  },
  selectorValue: { color: "#292A3E", fontSize: 15, fontWeight: "800" },
  selectorHint: { color: "#77758C", fontSize: 11, marginTop: 2 },
  editTitle: { color: "#202136", fontSize: 18, fontWeight: "800" },
  fieldLabel: {
    color: "#77758C",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.9,
    marginTop: 3,
  },
  optionWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  option: {
    backgroundColor: "#F7F7FB",
    borderColor: "#E5E5EF",
    borderRadius: 13,
    borderWidth: 1,
    minHeight: 39,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  optionActive: { backgroundColor: "#4438CA", borderColor: "#4438CA" },
  optionText: { color: "#555568", fontSize: 13, fontWeight: "800" },
  optionTextActive: { color: "#FFFFFF" },
  primaryButton: {
    alignItems: "center",
    backgroundColor: "#4438CA",
    borderRadius: 16,
    flexDirection: "row",
    gap: 9,
    justifyContent: "center",
    marginTop: 5,
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
  selectionModalRoot: {
    backgroundColor: "rgba(25, 25, 42, 0.42)",
    flex: 1,
    justifyContent: "flex-end",
  },
  selectionSheet: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    gap: 15,
    maxHeight: "72%",
    padding: 20,
    paddingBottom: 30,
  },
  selectionHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  selectionEyebrow: {
    color: "#77758C",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.9,
  },
  selectionTitle: {
    color: "#202136",
    fontSize: 21,
    fontWeight: "800",
    marginTop: 3,
  },
  selectionClose: {
    alignItems: "center",
    backgroundColor: "#EEECFF",
    borderRadius: 16,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  selectionOptions: { gap: 8, paddingBottom: 4 },
  selectionOption: {
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderColor: "#E5E5EF",
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 54,
    paddingHorizontal: 14,
  },
  selectionOptionActive: { backgroundColor: "#F0EFFB", borderColor: "#4438CA" },
  selectionOptionText: { color: "#363653", fontSize: 15, fontWeight: "800" },
  selectionOptionTextActive: { color: "#4438CA" },
});
