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
import {
  MobileFeatureLoadingScreen,
  MobileFeatureUnavailableScreen,
  useMobileFeatures,
} from "@/components/mobile-feature-gate";
import { useMobileNetworkStatus } from "@/components/offline-status";
import { RequesterPicker } from "@/components/requester-picker";
import { TicketConversation } from "@/components/ticket-conversation";
import { TicketPhotoAttachments } from "@/components/ticket-photo-attachments";
import {
  confirmResolution,
  ExperienceHubError,
  isExperienceUnavailableError,
  saveFollowUp,
} from "@/lib/nextdesk-experience";
import { useThemeContext } from "@/lib/theme-provider";
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

type FollowUpDueChoice = "today" | "tomorrow" | "week" | "none";

function followUpDueAt(choice: FollowUpDueChoice): string | null {
  if (choice === "none") return null;
  const due = new Date();
  due.setHours(12, 0, 0, 0);
  if (choice === "tomorrow") due.setDate(due.getDate() + 1);
  if (choice === "week") due.setDate(due.getDate() + 7);
  return due.toISOString();
}

function followUpDueLabel(choice: FollowUpDueChoice): string {
  switch (choice) {
    case "tomorrow":
      return "morgen";
    case "week":
      return "in einer Woche";
    case "none":
      return "ohne Termin";
    default:
      return "heute";
  }
}

function followUpTitle(ticket: MobileTicketDetail): string {
  const title = `${ticket.ticketNumber}: ${ticket.subject}`.trim();
  return Array.from(title).slice(0, 240).join("") || "Ticket-Wiedervorlage";
}

export default function TicketDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { recoveryEpoch } = useMobileNetworkStatus();
  const { isEnabled, loading: checkingFeatures } = useMobileFeatures();
  const ticketDetailEnabled = isEnabled("ticketing.detail");
  const workspaceEnabled = isEnabled("experience.workspace");
  const selfServiceEnabled = isEnabled("portal.self-service");
  const { colors, density, reducedMotion } = useThemeContext();
  const tokenStyles = useMemo(
    () => ({
      card: { backgroundColor: colors.surface, borderColor: colors.border },
      control: {
        backgroundColor: colors.background,
        borderColor: colors.border,
      },
      error: {
        backgroundColor: colors.error + "1A",
        borderColor: colors.error,
      },
      foreground: { color: colors.foreground },
      muted: { color: colors.muted },
      primary: { backgroundColor: colors.primary },
      primaryText: { color: colors.background },
      success: {
        backgroundColor: colors.success + "1A",
        borderColor: colors.success,
      },
      successText: { color: colors.success },
    }),
    [colors],
  );
  const densityStyles = useMemo(
    () => ({
      card: { padding: density === "compact" ? 14 : 17 },
      content: { gap: density === "compact" ? 12 : 16 },
    }),
    [density],
  );
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
  const [message, setMessage] = useState("");
  const [workspaceAvailable, setWorkspaceAvailable] = useState(true);
  const [selfServiceAvailable, setSelfServiceAvailable] = useState(true);
  const [followUpSheetOpen, setFollowUpSheetOpen] = useState(false);
  const [followUpDueChoice, setFollowUpDueChoice] = useState<
    "today" | "tomorrow" | "week" | "none"
  >("today");
  const [savingFollowUp, setSavingFollowUp] = useState(false);
  const [resolutionSheetOpen, setResolutionSheetOpen] = useState(false);
  const [resolutionDecision, setResolutionDecision] = useState<boolean | null>(
    null,
  );
  const [resolutionComment, setResolutionComment] = useState("");
  const [resolutionError, setResolutionError] = useState("");
  const [submittingResolution, setSubmittingResolution] = useState(false);
  const [resolutionSubmitted, setResolutionSubmitted] = useState(false);

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
    if (checkingFeatures || !ticketDetailEnabled) return;
    void recoveryEpoch;
    const task = setTimeout(() => void load(), 0);
    return () => clearTimeout(task);
  }, [checkingFeatures, load, recoveryEpoch, ticketDetailEnabled]);

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
  const canSetFollowUp = workspaceEnabled && workspaceAvailable;
  const canConfirmResolution =
    selfServiceEnabled &&
    selfServiceAvailable &&
    !resolutionSubmitted &&
    Boolean(ticket?.resolvedAt) &&
    Boolean(currentUserId) &&
    ticket?.requesterId === currentUserId;
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
    setMessage("");
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
      setMessage("Ticket wurde erfolgreich gespeichert.");
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
    setError("");
    setMessage("");
    try {
      await setFavoriteTicket({
        userId: currentUserId,
        tenantId: tenant.id,
        ticketId: ticket.id,
        favorite: nextFavorite,
      });
      setFavorite(nextFavorite);
      setMessage(
        nextFavorite
          ? "Ticket wurde zu Favoriten hinzugefügt."
          : "Ticket wurde aus Favoriten entfernt.",
      );
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

  function openFollowUpSheet() {
    setFollowUpDueChoice("today");
    setFollowUpSheetOpen(true);
    hapticSelection();
  }

  async function createTicketFollowUp() {
    if (!ticket) return;
    setSavingFollowUp(true);
    setError("");
    setMessage("");
    try {
      await saveFollowUp({
        title: followUpTitle(ticket),
        description: null,
        dueAt: followUpDueAt(followUpDueChoice),
        priority: "normal",
        ticketId: ticket.id,
      });
      setFollowUpSheetOpen(false);
      setMessage(
        `Wiedervorlage für dieses Ticket ${followUpDueLabel(followUpDueChoice)} gesetzt.`,
      );
      hapticSuccess();
    } catch (nextError) {
      if (isExperienceUnavailableError(nextError)) {
        setWorkspaceAvailable(false);
        setFollowUpSheetOpen(false);
        setMessage("Diese Zusatzfunktion ist derzeit nicht verfügbar.");
        return;
      }
      hapticError();
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Die Wiedervorlage konnte nicht gesetzt werden.",
      );
    } finally {
      setSavingFollowUp(false);
    }
  }

  function openResolutionSheet(confirmed: boolean) {
    setResolutionDecision(confirmed);
    setResolutionComment("");
    setResolutionError("");
    setResolutionSheetOpen(true);
    hapticSelection();
  }

  async function submitResolutionConfirmation() {
    if (!ticket || resolutionDecision === null) return;
    const normalizedComment = resolutionComment.trim();
    if (
      normalizedComment.includes("\u0000") ||
      Array.from(normalizedComment).length > 3_000
    ) {
      setResolutionError(
        "Der Kommentar darf höchstens 3'000 Zeichen lang sein.",
      );
      return;
    }

    setSubmittingResolution(true);
    setResolutionError("");
    setError("");
    setMessage("");
    try {
      await confirmResolution({
        ticketId: ticket.id,
        confirmed: resolutionDecision,
        comment: normalizedComment || null,
      });
      setResolutionSubmitted(true);
      setResolutionSheetOpen(false);
      setMessage(
        resolutionDecision
          ? "Danke, Ihre Lösungsbestätigung wurde gespeichert."
          : "Danke, Ihre Rückmeldung wurde gespeichert.",
      );
      hapticSuccess();
    } catch (nextError) {
      if (
        isExperienceUnavailableError(nextError) ||
        (nextError instanceof ExperienceHubError &&
          (nextError.code === "resolution_confirmation_not_allowed" ||
            nextError.code === "ticket_not_resolved"))
      ) {
        setSelfServiceAvailable(false);
        setResolutionSheetOpen(false);
        setMessage("Diese Zusatzfunktion ist derzeit nicht verfügbar.");
        return;
      }
      hapticError();
      setResolutionError(
        nextError instanceof Error
          ? nextError.message
          : "Ihre Rückmeldung konnte nicht gespeichert werden.",
      );
    } finally {
      setSubmittingResolution(false);
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
    setMessage("");
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
      setMessage("Nachricht wurde erfolgreich veröffentlicht.");
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

  if (checkingFeatures) return <MobileFeatureLoadingScreen />;

  if (!ticketDetailEnabled) {
    return (
      <MobileFeatureUnavailableScreen
        feature="ticketing.detail"
        title="Ticketdetails"
      />
    );
  }

  if (loading) {
    return (
      <ScreenContainer containerClassName="bg-background" className="px-5">
        <View
          accessibilityLabel="Ticketdetails werden geladen"
          accessibilityRole="progressbar"
          style={styles.skeletonPage}
        >
          <View
            style={[styles.skeletonTopBar, { backgroundColor: colors.border }]}
          />
          <View
            style={[styles.skeletonTitle, { backgroundColor: colors.border }]}
          />
          <View
            style={[
              styles.skeletonStatus,
              { backgroundColor: colors.primary + "33" },
            ]}
          />
          {[1, 2, 3].map((item) => (
            <View key={item} style={[styles.skeletonCard, tokenStyles.card]}>
              <View
                style={[
                  styles.skeletonLine,
                  { backgroundColor: colors.border },
                ]}
              />
              <View
                style={[
                  styles.skeletonShortLine,
                  { backgroundColor: colors.border },
                ]}
              />
            </View>
          ))}
          <Text style={[styles.copy, tokenStyles.muted]}>
            Ticketdetails werden geladen …
          </Text>
        </View>
      </ScreenContainer>
    );
  }

  if (!ticket) {
    return (
      <ScreenContainer
        containerClassName="bg-background"
        className="px-5"
        style={{ backgroundColor: colors.background }}
      >
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
      <ScreenContainer
        containerClassName="bg-background"
        className="px-5"
        style={{ backgroundColor: colors.background }}
      >
        <ScrollView
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={[styles.content, densityStyles.content]}
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
                  allowFontScaling
                  style={[
                    styles.titleInput,
                    tokenStyles.card,
                    tokenStyles.foreground,
                  ]}
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
                <Text style={[styles.title, tokenStyles.foreground]}>
                  {ticket.subject}
                </Text>
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
                <Ionicons
                  color={status.is_closed ? colors.success : colors.primary}
                  name={
                    status.is_closed
                      ? "checkmark-circle-outline"
                      : "time-outline"
                  }
                  size={15}
                />
                <Text
                  style={[
                    styles.statusText,
                    {
                      color: status.is_closed ? colors.success : colors.primary,
                    },
                  ]}
                >
                  {status.label}
                </Text>
              </Pressable>
            ) : null}
          </View>

          {canSetFollowUp ? (
            <View
              style={[
                styles.experienceCard,
                tokenStyles.card,
                densityStyles.card,
              ]}
            >
              <View style={styles.experienceHeader}>
                <View
                  style={[
                    styles.experienceIcon,
                    { backgroundColor: colors.primary + "1A" },
                  ]}
                >
                  <Ionicons
                    color={colors.primary}
                    name="alarm-outline"
                    size={20}
                  />
                </View>
                <View style={styles.experienceCopy}>
                  <Text
                    style={[styles.experienceTitle, tokenStyles.foreground]}
                  >
                    Wiedervorlage
                  </Text>
                  <Text style={[styles.experienceText, tokenStyles.muted]}>
                    Erinnerung für dieses Ticket setzen, ohne den Ticketstatus
                    zu ändern.
                  </Text>
                </View>
              </View>
              <Pressable
                accessibilityLabel="Wiedervorlage für dieses Ticket setzen"
                accessibilityRole="button"
                disabled={savingFollowUp}
                onPress={openFollowUpSheet}
                style={[
                  styles.experienceAction,
                  {
                    borderColor: colors.border,
                    backgroundColor: colors.background,
                  },
                  savingFollowUp && styles.disabled,
                ]}
              >
                <Text
                  style={[
                    styles.experienceActionText,
                    { color: colors.primary },
                  ]}
                >
                  Wiedervorlage setzen
                </Text>
                <Ionicons
                  color={colors.primary}
                  name="chevron-forward"
                  size={19}
                />
              </Pressable>
            </View>
          ) : null}

          {canConfirmResolution ? (
            <View
              style={[
                styles.experienceCard,
                tokenStyles.card,
                densityStyles.card,
              ]}
            >
              <View style={styles.experienceHeader}>
                <View
                  style={[
                    styles.experienceIcon,
                    { backgroundColor: colors.success + "1A" },
                  ]}
                >
                  <Ionicons
                    color={colors.success}
                    name="chatbubble-ellipses-outline"
                    size={20}
                  />
                </View>
                <View style={styles.experienceCopy}>
                  <Text
                    style={[styles.experienceTitle, tokenStyles.foreground]}
                  >
                    Wurde Ihr Anliegen gelöst?
                  </Text>
                  <Text style={[styles.experienceText, tokenStyles.muted]}>
                    Ihre Rückmeldung ändert den Ticketstatus nicht.
                  </Text>
                </View>
              </View>
              <View style={styles.resolutionActions}>
                <Pressable
                  accessibilityLabel="Ja, mein Anliegen wurde gelöst"
                  accessibilityRole="button"
                  onPress={() => openResolutionSheet(true)}
                  style={[
                    styles.resolutionAction,
                    {
                      backgroundColor: colors.success + "14",
                      borderColor: colors.success,
                    },
                  ]}
                >
                  <Ionicons
                    color={colors.success}
                    name="checkmark-circle-outline"
                    size={19}
                  />
                  <Text
                    style={[
                      styles.resolutionActionText,
                      { color: colors.success },
                    ]}
                  >
                    Ja
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityLabel="Nein, mein Anliegen wurde nicht gelöst"
                  accessibilityRole="button"
                  onPress={() => openResolutionSheet(false)}
                  style={[
                    styles.resolutionAction,
                    {
                      backgroundColor: colors.error + "12",
                      borderColor: colors.error,
                    },
                  ]}
                >
                  <Ionicons
                    color={colors.error}
                    name="close-circle-outline"
                    size={19}
                  />
                  <Text
                    style={[
                      styles.resolutionActionText,
                      { color: colors.error },
                    ]}
                  >
                    Nein
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : null}

          <View
            style={[styles.contextCard, tokenStyles.card, densityStyles.card]}
          >
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

          <View style={[styles.card, tokenStyles.card, densityStyles.card]}>
            <Text style={[styles.cardLabel, tokenStyles.muted]}>
              BESCHREIBUNG
            </Text>
            {ticket.canUpdate && editingField === "description" ? (
              <View style={styles.inlineEdit}>
                <TextInput
                  autoCapitalize="sentences"
                  autoFocus
                  multiline
                  onChangeText={setDescription}
                  allowFontScaling
                  style={[
                    styles.descriptionInput,
                    tokenStyles.control,
                    tokenStyles.foreground,
                  ]}
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

          {error ? (
            <View
              accessibilityRole="alert"
              style={[styles.feedback, tokenStyles.error]}
            >
              <Ionicons
                color={colors.error}
                name="alert-circle-outline"
                size={20}
              />
              <Text style={[styles.feedbackText, { color: colors.error }]}>
                {error}
              </Text>
            </View>
          ) : null}
          {message ? (
            <View
              accessibilityRole="alert"
              style={[styles.feedback, tokenStyles.success]}
            >
              <Ionicons
                color={colors.success}
                name="checkmark-circle-outline"
                size={20}
              />
              <Text style={[styles.feedbackText, tokenStyles.successText]}>
                {message}
              </Text>
            </View>
          ) : null}
        </ScrollView>

        <Modal
          animationType={reducedMotion ? "none" : "slide"}
          onRequestClose={() => setFollowUpSheetOpen(false)}
          transparent
          visible={followUpSheetOpen}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : "height"}
            style={styles.experienceSheetRoot}
          >
            <Pressable
              accessibilityLabel="Wiedervorlage schliessen"
              accessibilityRole="button"
              disabled={savingFollowUp}
              onPress={() => setFollowUpSheetOpen(false)}
              style={StyleSheet.absoluteFill}
            />
            <View
              accessibilityViewIsModal
              style={[
                styles.experienceSheet,
                { backgroundColor: colors.surface },
              ]}
            >
              <View style={styles.experienceSheetHeader}>
                <View>
                  <Text style={[styles.selectionEyebrow, tokenStyles.muted]}>
                    WIEDERVORLAGE
                  </Text>
                  <Text
                    style={[
                      styles.experienceSheetTitle,
                      tokenStyles.foreground,
                    ]}
                  >
                    Wann möchten Sie erinnert werden?
                  </Text>
                </View>
                <Pressable
                  accessibilityLabel="Wiedervorlage schliessen"
                  accessibilityRole="button"
                  disabled={savingFollowUp}
                  hitSlop={10}
                  onPress={() => setFollowUpSheetOpen(false)}
                  style={[
                    styles.selectionClose,
                    { backgroundColor: colors.primary + "1A" },
                  ]}
                >
                  <Ionicons color={colors.primary} name="close" size={22} />
                </Pressable>
              </View>
              <Text
                style={[styles.experienceSheetDescription, tokenStyles.muted]}
              >
                {ticket.ticketNumber}: {ticket.subject}
              </Text>
              <ScrollView
                automaticallyAdjustKeyboardInsets
                contentContainerStyle={styles.experienceSheetContent}
                keyboardDismissMode="interactive"
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                {(
                  [
                    ["today", "Heute"],
                    ["tomorrow", "Morgen"],
                    ["week", "In 1 Woche"],
                    ["none", "Ohne Termin"],
                  ] as const
                ).map(([choice, label]) => {
                  const selected = followUpDueChoice === choice;
                  return (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      key={choice}
                      onPress={() => {
                        setFollowUpDueChoice(choice);
                        hapticSelection();
                      }}
                      style={[
                        styles.experienceChoice,
                        {
                          backgroundColor: selected
                            ? colors.primary + "14"
                            : colors.background,
                          borderColor: selected
                            ? colors.primary
                            : colors.border,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.experienceChoiceText,
                          {
                            color: selected
                              ? colors.primary
                              : colors.foreground,
                          },
                        ]}
                      >
                        {label}
                      </Text>
                      {selected ? (
                        <Ionicons
                          color={colors.primary}
                          name="checkmark"
                          size={20}
                        />
                      ) : null}
                    </Pressable>
                  );
                })}
                <Pressable
                  accessibilityRole="button"
                  disabled={savingFollowUp}
                  onPress={() => void createTicketFollowUp()}
                  style={[
                    styles.experienceSaveButton,
                    { backgroundColor: colors.primary },
                    savingFollowUp && styles.disabled,
                  ]}
                >
                  {savingFollowUp ? (
                    <ActivityIndicator color={colors.background} size="small" />
                  ) : (
                    <Ionicons
                      color={colors.background}
                      name="alarm-outline"
                      size={20}
                    />
                  )}
                  <Text
                    style={[
                      styles.experienceSaveButtonText,
                      tokenStyles.primaryText,
                    ]}
                  >
                    {savingFollowUp ? "Wird gesetzt …" : "Wiedervorlage setzen"}
                  </Text>
                </Pressable>
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </Modal>

        <Modal
          animationType={reducedMotion ? "none" : "slide"}
          onRequestClose={() => setResolutionSheetOpen(false)}
          transparent
          visible={resolutionSheetOpen}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : "height"}
            style={styles.experienceSheetRoot}
          >
            <Pressable
              accessibilityLabel="Rückmeldung schliessen"
              accessibilityRole="button"
              disabled={submittingResolution}
              onPress={() => setResolutionSheetOpen(false)}
              style={StyleSheet.absoluteFill}
            />
            <View
              accessibilityViewIsModal
              style={[
                styles.experienceSheet,
                { backgroundColor: colors.surface },
              ]}
            >
              <View style={styles.experienceSheetHeader}>
                <View>
                  <Text style={[styles.selectionEyebrow, tokenStyles.muted]}>
                    IHRE RÜCKMELDUNG
                  </Text>
                  <Text
                    style={[
                      styles.experienceSheetTitle,
                      tokenStyles.foreground,
                    ]}
                  >
                    Wurde Ihr Anliegen gelöst?
                  </Text>
                </View>
                <Pressable
                  accessibilityLabel="Rückmeldung schliessen"
                  accessibilityRole="button"
                  disabled={submittingResolution}
                  hitSlop={10}
                  onPress={() => setResolutionSheetOpen(false)}
                  style={[
                    styles.selectionClose,
                    { backgroundColor: colors.primary + "1A" },
                  ]}
                >
                  <Ionicons color={colors.primary} name="close" size={22} />
                </Pressable>
              </View>
              <ScrollView
                automaticallyAdjustKeyboardInsets
                contentContainerStyle={styles.experienceSheetContent}
                keyboardDismissMode="interactive"
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                <View style={styles.resolutionChoiceRow}>
                  {(
                    [
                      [true, "Ja", "checkmark-circle-outline"],
                      [false, "Nein", "close-circle-outline"],
                    ] as const
                  ).map(([decision, label, icon]) => {
                    const selected = resolutionDecision === decision;
                    const accent = decision ? colors.success : colors.error;
                    return (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        key={label}
                        onPress={() => {
                          setResolutionDecision(decision);
                          hapticSelection();
                        }}
                        style={[
                          styles.resolutionSheetChoice,
                          {
                            backgroundColor: selected
                              ? accent + "16"
                              : colors.background,
                            borderColor: selected ? accent : colors.border,
                          },
                        ]}
                      >
                        <Ionicons color={accent} name={icon} size={20} />
                        <Text
                          style={[
                            styles.resolutionSheetChoiceText,
                            { color: accent },
                          ]}
                        >
                          {label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                <View style={styles.resolutionField}>
                  <Text style={[styles.cardLabel, tokenStyles.muted]}>
                    KOMMENTAR (OPTIONAL)
                  </Text>
                  <TextInput
                    autoCapitalize="sentences"
                    maxLength={3_000}
                    multiline
                    onChangeText={setResolutionComment}
                    placeholder="Was hat gut funktioniert oder was fehlt noch?"
                    placeholderTextColor={colors.muted}
                    style={[
                      styles.resolutionInput,
                      {
                        backgroundColor: colors.background,
                        borderColor: colors.border,
                        color: colors.foreground,
                      },
                    ]}
                    textAlignVertical="top"
                    value={resolutionComment}
                  />
                  <Text style={[styles.characterCount, tokenStyles.muted]}>
                    {`${Array.from(resolutionComment).length}/3'000`}
                  </Text>
                </View>
                <Text style={[styles.resolutionNotice, tokenStyles.muted]}>
                  Diese Rückmeldung speichert nur Ihre Bestätigung oder
                  Ablehnung. Der Ticketstatus bleibt unverändert.
                </Text>
                {resolutionError ? (
                  <View style={[styles.feedback, tokenStyles.error]}>
                    <Ionicons
                      color={colors.error}
                      name="alert-circle-outline"
                      size={20}
                    />
                    <Text
                      style={[styles.feedbackText, { color: colors.error }]}
                    >
                      {resolutionError}
                    </Text>
                  </View>
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  disabled={submittingResolution || resolutionDecision === null}
                  onPress={() => void submitResolutionConfirmation()}
                  style={[
                    styles.experienceSaveButton,
                    { backgroundColor: colors.primary },
                    (submittingResolution || resolutionDecision === null) &&
                      styles.disabled,
                  ]}
                >
                  {submittingResolution ? (
                    <ActivityIndicator color={colors.background} size="small" />
                  ) : (
                    <Ionicons
                      color={colors.background}
                      name="send-outline"
                      size={20}
                    />
                  )}
                  <Text
                    style={[
                      styles.experienceSaveButtonText,
                      tokenStyles.primaryText,
                    ]}
                  >
                    {submittingResolution
                      ? "Wird gespeichert …"
                      : "Rückmeldung speichern"}
                  </Text>
                </Pressable>
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </Modal>

        <Modal
          animationType={reducedMotion ? "none" : "slide"}
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
          animationType={reducedMotion ? "none" : "fade"}
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
    alignItems: "center",
    alignSelf: "flex-start",
    borderRadius: 999,
    flexDirection: "row",
    gap: 5,
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
  experienceCard: {
    backgroundColor: "#FFFFFF",
    borderColor: "#ECECF3",
    borderRadius: 20,
    borderWidth: 1,
    gap: 13,
    padding: 17,
  },
  experienceHeader: { alignItems: "flex-start", flexDirection: "row", gap: 10 },
  experienceIcon: {
    alignItems: "center",
    borderRadius: 13,
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  experienceCopy: { flex: 1, gap: 3 },
  experienceTitle: { fontSize: 16, fontWeight: "800", lineHeight: 21 },
  experienceText: { fontSize: 12, lineHeight: 18 },
  experienceAction: {
    alignItems: "center",
    borderRadius: 13,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 51,
    paddingHorizontal: 13,
  },
  experienceActionText: { fontSize: 14, fontWeight: "800" },
  resolutionActions: { flexDirection: "row", gap: 9 },
  resolutionAction: {
    alignItems: "center",
    borderRadius: 13,
    borderWidth: 1,
    flex: 1,
    flexDirection: "row",
    gap: 6,
    justifyContent: "center",
    minHeight: 50,
    paddingHorizontal: 10,
  },
  resolutionActionText: { fontSize: 14, fontWeight: "800" },
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
  feedback: {
    alignItems: "flex-start",
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: 9,
    padding: 13,
  },
  feedbackText: { flex: 1, fontSize: 13, lineHeight: 19 },
  error: { color: "#A02820", fontSize: 13, lineHeight: 19 },
  experienceSheetRoot: {
    backgroundColor: "rgba(25, 25, 42, 0.42)",
    flex: 1,
    justifyContent: "flex-end",
  },
  experienceSheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: "84%",
    padding: 20,
    paddingBottom: 28,
  },
  experienceSheetHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  experienceSheetTitle: {
    fontSize: 21,
    fontWeight: "800",
    lineHeight: 27,
    marginTop: 3,
  },
  experienceSheetDescription: { fontSize: 13, lineHeight: 19, marginTop: 12 },
  experienceSheetContent: { gap: 10, paddingTop: 18 },
  experienceChoice: {
    alignItems: "center",
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 53,
    paddingHorizontal: 14,
  },
  experienceChoiceText: { fontSize: 15, fontWeight: "800" },
  experienceSaveButton: {
    alignItems: "center",
    borderRadius: 15,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    marginTop: 7,
    minHeight: 53,
    paddingHorizontal: 16,
  },
  experienceSaveButtonText: { fontSize: 14, fontWeight: "800" },
  resolutionChoiceRow: { flexDirection: "row", gap: 9 },
  resolutionSheetChoice: {
    alignItems: "center",
    borderRadius: 13,
    borderWidth: 1,
    flex: 1,
    flexDirection: "row",
    gap: 6,
    justifyContent: "center",
    minHeight: 51,
    paddingHorizontal: 10,
  },
  resolutionSheetChoiceText: { fontSize: 14, fontWeight: "800" },
  resolutionField: { gap: 7, marginTop: 8 },
  resolutionInput: {
    borderRadius: 14,
    borderWidth: 1,
    fontSize: 15,
    lineHeight: 21,
    minHeight: 118,
    padding: 12,
  },
  characterCount: { alignSelf: "flex-end", fontSize: 11 },
  resolutionNotice: { fontSize: 12, lineHeight: 18, marginTop: 3 },
  skeletonPage: { flex: 1, gap: 14, justifyContent: "center" },
  skeletonTopBar: { borderRadius: 8, height: 40, width: "100%" },
  skeletonTitle: { borderRadius: 8, height: 42, width: "82%" },
  skeletonStatus: { borderRadius: 999, height: 28, width: "30%" },
  skeletonCard: {
    borderRadius: 20,
    borderWidth: 1,
    gap: 12,
    minHeight: 95,
    padding: 17,
  },
  skeletonLine: { borderRadius: 6, height: 13, width: "100%" },
  skeletonShortLine: { borderRadius: 6, height: 13, width: "64%" },
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
