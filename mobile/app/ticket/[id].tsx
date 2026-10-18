import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { useMobileNetworkStatus } from "@/components/offline-status";
import { RequesterPicker } from "@/components/requester-picker";
import { TicketConversation } from "@/components/ticket-conversation";
import { TicketPhotoAttachments } from "@/components/ticket-photo-attachments";
import {
  clearLocalTicketDraft,
  listFavoriteTicketIds,
  loadLocalTicketDraft,
  saveLocalTicketDraft,
  setFavoriteTicket,
} from "@/lib/mobile-private-state";
import {
  hapticError,
  hapticSelection,
  hapticSuccess,
} from "@/lib/mobile-haptics";
import {
  getMobileUserId,
  loadCurrentTenant,
  type MobileTenant,
} from "@/lib/nextdesk-client";
import {
  addMobileTicketComment,
  loadMobileTicketDetail,
  saveMobileTicketDraft,
  updateMobileTicket,
  type MobileTicketDetail,
  type TicketRequester,
  type TicketCommentVisibility,
} from "@/lib/nextdesk-tickets";

export default function TicketDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { recoveryEpoch } = useMobileNetworkStatus();
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
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [favorite, setFavorite] = useState(false);
  const [draftState, setDraftState] = useState<
    "idle" | "local" | "saving" | "synced"
  >("idle");
  const [draftDirty, setDraftDirty] = useState(false);
  const [editingField, setEditingField] = useState<
    "subject" | "description" | "requester" | null
  >(null);
  const [selection, setSelection] = useState<"status" | "priority" | null>(
    null,
  );
  const [pendingCloseStatus, setPendingCloseStatus] = useState<{
    key: string;
    label: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sendingComment, setSendingComment] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(
    async (syncEditor = true) => {
      if (!id) return;
      try {
        setError("");
        const [currentTenant, userId] = await Promise.all([
          loadCurrentTenant(),
          getMobileUserId(),
        ]);
        const detail = await loadMobileTicketDetail(currentTenant.id, id);
        setTenant(currentTenant);
        setCurrentUserId(userId);
        setTicket(detail);
        if (syncEditor) {
          const initialVisibility = detail.canWriteInternalNotes
            ? "internal"
            : "external";
          const [localDraft, favoriteIds] = await Promise.all([
            loadLocalTicketDraft({
              userId,
              tenantId: currentTenant.id,
              ticketId: detail.id,
              visibility: initialVisibility,
            }),
            listFavoriteTicketIds({ userId, tenantId: currentTenant.id }),
          ]);
          const serverDraft = detail.drafts.find(
            (draft) =>
              draft.visibility === initialVisibility &&
              Boolean(draft.body.trim()),
          );
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
          setComment(localDraft?.body ?? serverDraft?.body ?? "");
          setDraftState(localDraft ? "local" : serverDraft ? "synced" : "idle");
          setDraftDirty(false);
          setFavorite(favoriteIds.includes(detail.id));
          setCommentVisibility(initialVisibility);
        }
        setCommentVisibility((current) => {
          if (syncEditor) return current;
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
    void recoveryEpoch;
    const task = setTimeout(() => void load(), 0);
    return () => clearTimeout(task);
  }, [load, recoveryEpoch]);

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

  async function saveChange(changes: {
    confirmClose?: boolean;
    description?: string;
    priorityKey?: string;
    requester?: TicketRequester;
    statusKey?: string;
    subject?: string;
  }) {
    if (!ticket || !tenant) return;
    const nextSubject = (changes.subject ?? ticket.subject).trim();
    const nextDescription = (changes.description ?? ticket.description).trim();
    const nextStatusKey = changes.statusKey ?? statusKey;
    const nextPriorityKey = changes.priorityKey ?? priorityKey;
    const nextRequester = changes.requester ?? requester;
    if (nextSubject.length < 3 || !nextDescription) {
      setError("Betreff und Beschreibung müssen ausgefüllt sein.");
      return;
    }
    if (!nextStatusKey || !nextPriorityKey) {
      setError("Bitte wählen Sie Status und Priorität.");
      return;
    }
    const nextStatus = ticket.statusOptions.find(
      (option) => option.key === nextStatusKey,
    );
    const nextPriority = ticket.priorityOptions.find(
      (option) => option.key === nextPriorityKey,
    );
    if (!nextStatus || !nextPriority) {
      setError("Status oder Priorität sind nicht gültig.");
      return;
    }
    if (
      nextStatus.is_closed &&
      nextStatus.id !== ticket.statusId &&
      changes.confirmClose !== true
    ) {
      setPendingCloseStatus({ key: nextStatus.key, label: nextStatus.label });
      return;
    }

    setSaving(true);
    setError("");
    try {
      await updateMobileTicket({
        tenantId: tenant.id,
        ticketId: ticket.id,
        subject: nextSubject,
        description: nextDescription,
        ...(changes.confirmClose ? { confirmClose: true } : {}),
        statusKey: nextStatusKey,
        priorityKey: nextPriorityKey,
        ...(nextRequester ? { requesterContactId: nextRequester.id } : {}),
      });
      setTicket({
        ...ticket,
        subject: nextSubject,
        description: nextDescription,
        statusId: nextStatus.id,
        priorityId: nextPriority.id,
        requesterContact: nextRequester,
        requesterName: nextRequester?.displayName ?? null,
      });
      setSubject(nextSubject);
      setDescription(nextDescription);
      setStatusKey(nextStatusKey);
      setPriorityKey(nextPriorityKey);
      setRequester(nextRequester);
      setEditingField(null);
      hapticSuccess();
    } catch (nextError) {
      hapticError();
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Das Ticket konnte nicht gespeichert werden.",
      );
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    if (!draftDirty || !ticket || !tenant || !currentUserId) return;
    const draft = {
      userId: currentUserId,
      tenantId: tenant.id,
      ticketId: ticket.id,
      visibility: commentVisibility,
      body: comment,
    };
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        setDraftState("saving");
        try {
          // Persist on-device first. The iOS Keychain protects this small
          // fallback if the network disappears while the server save runs.
          await saveLocalTicketDraft(draft);
          await saveMobileTicketDraft(draft);
          await clearLocalTicketDraft(draft);
          if (!cancelled) {
            setDraftState(draft.body.trim() ? "synced" : "idle");
            setDraftDirty(false);
          }
        } catch {
          if (!cancelled) setDraftState(draft.body.trim() ? "local" : "idle");
        }
      })();
    }, 700);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [comment, commentVisibility, currentUserId, draftDirty, tenant, ticket]);

  function changeComment(nextBody: string) {
    setComment(nextBody);
    setDraftDirty(true);
  }

  function changeCommentVisibility(nextVisibility: TicketCommentVisibility) {
    if (nextVisibility === commentVisibility) return;
    setCommentVisibility(nextVisibility);
    setDraftDirty(true);
  }

  async function toggleFavorite() {
    if (!ticket || !tenant || !currentUserId) return;
    const nextFavorite = !favorite;
    try {
      await setFavoriteTicket({
        userId: currentUserId,
        tenantId: tenant.id,
        ticketId: ticket.id,
        favorite: nextFavorite,
      });
      setFavorite(nextFavorite);
      hapticSelection();
    } catch {
      hapticError();
      setError("Der Favorit konnte nicht auf diesem Gerät gespeichert werden.");
    }
  }

  async function contactRequesterByEmail(address: string) {
    const target = `mailto:${encodeURIComponent(address)}`;
    try {
      if (!(await Linking.canOpenURL(target))) {
        throw new Error(
          "Auf diesem Gerät ist keine E-Mail-App für die Kontaktaufnahme verfügbar.",
        );
      }
      await Linking.openURL(target);
    } catch (nextError) {
      hapticError();
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Die E-Mail-App konnte nicht geöffnet werden.",
      );
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
      setDraftDirty(false);
      setDraftState("idle");
      await clearLocalTicketDraft({
        userId: currentUserId ?? "",
        tenantId: tenant.id,
        ticketId: ticket.id,
        visibility: commentVisibility,
      });
      // Emptying the same server draft keeps it from resurfacing after a
      // successfully posted message. It contains no ticket history.
      await saveMobileTicketDraft({
        tenantId: tenant.id,
        ticketId: ticket.id,
        body: "",
        visibility: commentVisibility,
      });
      await load(false);
      hapticSuccess();
    } catch (nextError) {
      hapticError();
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
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={styles.keyboardAvoider}
    >
      <ScreenContainer containerClassName="bg-[#F6F7FB]" className="px-5">
        <ScrollView
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={styles.content}
          keyboardDismissMode="interactive"
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
            <Pressable
              accessibilityLabel={
                favorite
                  ? "Ticket aus Favoriten entfernen"
                  : "Ticket favorisieren"
              }
              accessibilityRole="button"
              hitSlop={10}
              onPress={() => void toggleFavorite()}
              style={[
                styles.favoriteButton,
                favorite && styles.favoriteButtonActive,
              ]}
            >
              <Ionicons
                color={favorite ? "#FFFFFF" : "#4438CA"}
                name={favorite ? "star" : "star-outline"}
                size={20}
              />
            </Pressable>
          </View>

          <View style={styles.ticketHead}>
            <Text style={styles.ticketId}>{ticket.ticketNumber}</Text>
            {ticket.canUpdate && editingField === "subject" ? (
              <View style={styles.inlineEdit}>
                <TextInput
                  autoCapitalize="sentences"
                  autoFocus
                  maxLength={240}
                  onChangeText={setSubject}
                  style={styles.titleInput}
                  value={subject}
                />
                <Pressable
                  accessibilityLabel="Betreff speichern"
                  accessibilityRole="button"
                  disabled={saving}
                  onPress={() => void saveChange({ subject })}
                  style={styles.inlineSave}
                >
                  <Ionicons color="#FFFFFF" name="checkmark" size={18} />
                </Pressable>
              </View>
            ) : (
              <Pressable
                accessibilityHint={
                  ticket.canUpdate
                    ? "Antippen, um den Betreff zu ändern."
                    : undefined
                }
                accessibilityRole={ticket.canUpdate ? "button" : undefined}
                disabled={!ticket.canUpdate}
                onPress={() => {
                  hapticSelection();
                  setEditingField("subject");
                }}
              >
                <Text style={styles.title}>{ticket.subject}</Text>
              </Pressable>
            )}
            {status ? (
              <Pressable
                accessibilityHint={
                  ticket.canUpdate
                    ? "Antippen, um den Status zu ändern."
                    : undefined
                }
                accessibilityRole={ticket.canUpdate ? "button" : undefined}
                disabled={!ticket.canUpdate}
                onPress={() => {
                  hapticSelection();
                  setSelection("status");
                }}
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
              </Pressable>
            ) : null}
          </View>

          <View style={styles.contextCard}>
            <View style={styles.contextItem}>
              <Text style={styles.cardLabel}>ANFRAGENDE PERSON</Text>
              {ticket.canUpdate && editingField === "requester" && requester ? (
                <RequesterPicker
                  autoOpen
                  contextLabel="TICKET BEARBEITEN"
                  defaultRequester={ticket.requesterContact ?? requester}
                  onChange={(nextRequester) =>
                    void saveChange({ requester: nextRequester })
                  }
                  onClose={() => setEditingField(null)}
                  tenantId={tenant?.id ?? ""}
                  value={requester}
                />
              ) : (
                <Pressable
                  accessibilityHint={
                    ticket.canUpdate
                      ? "Antippen, um die anfragende Person zu ändern."
                      : undefined
                  }
                  accessibilityRole={ticket.canUpdate ? "button" : undefined}
                  disabled={!ticket.canUpdate || !requester}
                  onPress={() => {
                    hapticSelection();
                    setEditingField("requester");
                  }}
                >
                  <Text numberOfLines={2} style={styles.cardValue}>
                    {ticket.requesterName ?? "Anfragende Person"}
                  </Text>
                </Pressable>
              )}
              {ticket.requesterContact?.email ? (
                <Pressable
                  accessibilityLabel={`${ticket.requesterContact.displayName} per E-Mail kontaktieren`}
                  accessibilityRole="button"
                  onPress={() =>
                    void contactRequesterByEmail(
                      ticket.requesterContact?.email ?? "",
                    )
                  }
                  style={styles.contactAction}
                >
                  <Ionicons color="#087A95" name="mail-outline" size={14} />
                  <Text numberOfLines={1} style={styles.contactActionText}>
                    {ticket.requesterContact.email}
                  </Text>
                </Pressable>
              ) : null}
            </View>
            <View style={styles.contextDivider} />
            <View style={styles.contextItem}>
              <Text style={styles.cardLabel}>PRIORITÄT</Text>
              <Pressable
                accessibilityHint={
                  ticket.canUpdate
                    ? "Antippen, um die Priorität zu ändern."
                    : undefined
                }
                accessibilityRole={ticket.canUpdate ? "button" : undefined}
                disabled={!ticket.canUpdate}
                onPress={() => {
                  hapticSelection();
                  setSelection("priority");
                }}
              >
                <Text style={styles.cardValue}>
                  {priority?.label ?? "Ohne Priorität"}
                </Text>
              </Pressable>
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardLabel}>BESCHREIBUNG</Text>
            {ticket.canUpdate && editingField === "description" ? (
              <View style={styles.inlineEdit}>
                <TextInput
                  autoCapitalize="sentences"
                  autoFocus
                  multiline
                  onChangeText={setDescription}
                  style={styles.descriptionInput}
                  textAlignVertical="top"
                  value={description}
                />
                <Pressable
                  accessibilityLabel="Beschreibung speichern"
                  accessibilityRole="button"
                  disabled={saving}
                  onPress={() => void saveChange({ description })}
                  style={styles.inlineSave}
                >
                  <Text style={styles.inlineSaveText}>Speichern</Text>
                </Pressable>
              </View>
            ) : (
              <Pressable
                accessibilityHint={
                  ticket.canUpdate
                    ? "Antippen, um die Beschreibung zu ändern."
                    : undefined
                }
                accessibilityRole={ticket.canUpdate ? "button" : undefined}
                disabled={!ticket.canUpdate}
                onPress={() => {
                  hapticSelection();
                  setEditingField("description");
                }}
              >
                <Text style={styles.description}>{ticket.description}</Text>
              </Pressable>
            )}
          </View>

          <TicketConversation
            body={comment}
            canCommentExternal={ticket.canCommentExternal}
            canWriteInternalNotes={ticket.canWriteInternalNotes}
            comments={ticket.comments}
            draftState={draftState}
            isSending={sendingComment}
            onBodyChange={changeComment}
            onSend={() => void sendComment()}
            onVisibilityChange={changeCommentVisibility}
            visibility={commentVisibility}
          />

          {tenant ? (
            <TicketPhotoAttachments
              canUpload={ticket.canUpdate}
              tenantId={tenant.id}
              ticketId={ticket.id}
            />
          ) : null}

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
                      disabled={saving}
                      key={option.id}
                      onPress={() => {
                        const field = selection;
                        setSelection(null);
                        if (field === "status") {
                          void saveChange({ statusKey: option.key });
                        } else {
                          void saveChange({ priorityKey: option.key });
                        }
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

        <Modal
          animationType="fade"
          onRequestClose={() => setPendingCloseStatus(null)}
          transparent
          visible={pendingCloseStatus !== null}
        >
          <View style={styles.closeConfirmationRoot}>
            <Pressable
              accessibilityLabel="Ticketabschluss abbrechen"
              accessibilityRole="button"
              onPress={() => setPendingCloseStatus(null)}
              style={StyleSheet.absoluteFill}
            />
            <View accessibilityViewIsModal style={styles.closeConfirmationCard}>
              <View style={styles.closeConfirmationIcon}>
                <Ionicons
                  color="#9A5B12"
                  name="lock-closed-outline"
                  size={22}
                />
              </View>
              <Text style={styles.closeConfirmationTitle}>
                Ticket schliessen?
              </Text>
              <Text style={styles.closeConfirmationText}>
                Der Status «{pendingCloseStatus?.label}» schliesst dieses
                Ticket. Die Berechtigung wird beim Speichern erneut auf dem
                Server geprüft und der Abschluss im Verlauf protokolliert.
              </Text>
              <Pressable
                accessibilityLabel="Ticketabschluss bestätigen"
                accessibilityRole="button"
                disabled={saving}
                onPress={() => {
                  const nextStatus = pendingCloseStatus;
                  setPendingCloseStatus(null);
                  if (nextStatus) {
                    void saveChange({
                      confirmClose: true,
                      statusKey: nextStatus.key,
                    });
                  }
                }}
                style={[
                  styles.closeConfirmationButton,
                  saving && styles.disabled,
                ]}
              >
                <Text style={styles.closeConfirmationButtonText}>
                  Ticket verbindlich schliessen
                </Text>
              </Pressable>
              <Pressable
                accessibilityLabel="Ticketabschluss abbrechen"
                accessibilityRole="button"
                disabled={saving}
                onPress={() => setPendingCloseStatus(null)}
                style={styles.closeConfirmationCancel}
              >
                <Text style={styles.closeConfirmationCancelText}>
                  Abbrechen
                </Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      </ScreenContainer>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  keyboardAvoider: { flex: 1 },
  content: { gap: 16, paddingTop: 14, paddingBottom: 220 },
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
  favoriteButton: {
    alignItems: "center",
    backgroundColor: "#EEECFF",
    borderRadius: 18,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  favoriteButtonActive: { backgroundColor: "#4438CA" },
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
  inlineEdit: { gap: 9 },
  inlineSave: {
    alignItems: "center",
    alignSelf: "flex-end",
    backgroundColor: "#4438CA",
    borderRadius: 12,
    justifyContent: "center",
    minHeight: 38,
    minWidth: 42,
    paddingHorizontal: 13,
  },
  inlineSaveText: { color: "#FFFFFF", fontSize: 13, fontWeight: "800" },
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
  contactAction: {
    alignItems: "center",
    flexDirection: "row",
    gap: 5,
    marginTop: 7,
  },
  contactActionText: {
    color: "#087A95",
    flex: 1,
    fontSize: 11,
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
  closeConfirmationRoot: {
    alignItems: "center",
    backgroundColor: "rgba(25, 25, 42, 0.42)",
    flex: 1,
    justifyContent: "center",
    padding: 24,
  },
  closeConfirmationCard: {
    alignItems: "stretch",
    backgroundColor: "#FFFFFF",
    borderRadius: 24,
    gap: 13,
    maxWidth: 420,
    padding: 22,
    width: "100%",
  },
  closeConfirmationIcon: {
    alignItems: "center",
    backgroundColor: "#FFF4DB",
    borderRadius: 17,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  closeConfirmationTitle: { color: "#202136", fontSize: 21, fontWeight: "900" },
  closeConfirmationText: { color: "#626376", fontSize: 14, lineHeight: 21 },
  closeConfirmationButton: {
    alignItems: "center",
    backgroundColor: "#9A5B12",
    borderRadius: 14,
    justifyContent: "center",
    marginTop: 5,
    minHeight: 50,
    paddingHorizontal: 16,
  },
  closeConfirmationButtonText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "900",
  },
  closeConfirmationCancel: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 40,
  },
  closeConfirmationCancelText: {
    color: "#4438CA",
    fontSize: 13,
    fontWeight: "800",
  },
});
