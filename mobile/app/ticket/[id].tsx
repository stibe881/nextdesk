import DateTimePicker from "@react-native-community/datetimepicker";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { DepartmentQuestions } from "@/components/department-questions";
import { TicketConversation } from "@/components/ticket-conversation";
import { TicketPhotoAttachments } from "@/components/ticket-photo-attachments";
import {
  confirmResolution,
  ExperienceHubError,
  isExperienceUnavailableError,
  listFollowUps,
  resolveFollowUp,
  saveFollowUp,
  type ExperienceFollowUp,
} from "@/lib/nextdesk-experience";
import {
  assignTicketAgent,
  decideTicketReopenRequest,
  loadAssignableAgents,
  isWorkbenchUnavailableError,
  loadAssigneeSuggestions,
  loadMyTicketTimeline,
  loadReopenRequests,
  loadTicketWorkbenchContext,
  requestTicketReopen,
  type AssigneeSuggestion,
  type AssignableAgent,
  type PublicTicketTimelineItem,
  type TicketReopenRequest,
  type TicketWorkbenchContext,
} from "@/lib/nextdesk-workbench";
import { makeThemedStyles, useAppColors } from "@/lib/themed-styles";
import { useThemeContext } from "@/lib/theme-provider";
import {
  clearLocalTicketDraft,
  listFavoriteTicketIds,
  recordRecentTicket,
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
  updateMobileTicketCategory,
  type MobileTicketDetail,
  type TicketRequester,
  type TicketCommentVisibility,
} from "@/lib/nextdesk-tickets";

function roundUpToFiveMinutes(value: Date): Date {
  const rounded = new Date(value);
  rounded.setSeconds(0, 0);
  const remainder = rounded.getMinutes() % 5;
  if (remainder) rounded.setMinutes(rounded.getMinutes() + (5 - remainder));
  return rounded;
}

function oneHourFromNow(): Date {
  return roundUpToFiveMinutes(new Date(Date.now() + 60 * 60 * 1_000));
}

function atTimeFromToday(daysFromToday: number, hour: number): Date {
  const due = new Date();
  due.setDate(due.getDate() + daysFromToday);
  due.setHours(hour, 0, 0, 0);
  return due;
}

function nextMondayAtEight(): Date {
  const due = new Date();
  const daysUntilMonday = (8 - due.getDay()) % 7 || 7;
  due.setDate(due.getDate() + daysUntilMonday);
  due.setHours(8, 0, 0, 0);
  return due;
}

function followUpDate(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function followUpWeekday(value: Date): string {
  const weekday = new Intl.DateTimeFormat("de-CH", {
    weekday: "short",
  }).format(value);
  return weekday.endsWith(".") ? weekday : `${weekday}.`;
}

function followUpDayMonth(value: Date): string {
  return new Intl.DateTimeFormat("de-CH", {
    day: "2-digit",
    month: "2-digit",
  }).format(value);
}

function followUpTime(value: Date): string {
  return new Intl.DateTimeFormat("de-CH", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

function followUpSummary(value: Date): string {
  const date = new Intl.DateTimeFormat("de-CH", {
    day: "2-digit",
    month: "short",
    weekday: "short",
    year: "numeric",
  }).format(value);
  return `Erinnerung am ${date} um ${followUpTime(value)}`;
}

function compactFollowUpDate(value: string | null): string {
  const date = followUpDate(value);
  if (!date) return "Termin fehlt";
  return `${followUpWeekday(date)}, ${followUpDayMonth(date)}, ${followUpTime(date)}`;
}

function followUpSuccessDate(value: Date): string {
  return `${followUpWeekday(value)}, ${followUpDayMonth(value)} um ${followUpTime(value)}`;
}

function isOverdueFollowUp(followUp: ExperienceFollowUp): boolean {
  const dueAt = followUpDate(followUp.dueAt);
  return dueAt !== null && dueAt.getTime() < Date.now();
}

function sortedOpenFollowUps(
  followUps: ExperienceFollowUp[],
): ExperienceFollowUp[] {
  return followUps
    .filter((followUp) => !followUp.resolvedAt)
    .sort((left, right) => {
      const leftDate =
        followUpDate(left.dueAt)?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const rightDate =
        followUpDate(right.dueAt)?.getTime() ?? Number.MAX_SAFE_INTEGER;
      return leftDate - rightDate;
    });
}

function followUpTitle(ticket: MobileTicketDetail): string {
  const title = `${ticket.ticketNumber}: ${ticket.subject}`.trim();
  return Array.from(title).slice(0, 240).join("") || "Ticket-Wiedervorlage";
}

function formatWorkbenchDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Zeitpunkt unbekannt";
  return new Intl.DateTimeFormat("de-CH", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
  }).format(date);
}

function publicTimelineEventLabel(
  item: Extract<PublicTicketTimelineItem, { type: "event" }>,
): string {
  const eventType = item.eventType.toLocaleLowerCase("de-CH");
  if (eventType === "status_changed" || eventType === "ticket_status_changed") {
    return item.statusLabel?.trim()
      ? `Status geändert: ${item.statusLabel.trim()}`
      : "Status geändert";
  }
  const labels: Record<string, string> = {
    assigned: "Ticket zugewiesen",
    comment: "Kommentar hinzugefügt",
    created: "Ticket erfasst",
    closed: "Ticket geschlossen",
    reopened: "Ticket wieder geöffnet",
    reply: "Antwort hinzugefügt",
    resolved: "Ticket gelöst",
    ticket_assigned: "Ticket zugewiesen",
    ticket_closed: "Ticket geschlossen",
    ticket_created: "Ticket erfasst",
    ticket_reopened: "Ticket wieder geöffnet",
    ticket_resolved: "Ticket gelöst",
  };
  return labels[eventType] ?? "Aktualisiert";
}

function compactContextValue(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) {
    const characters = Array.from(value.trim());
    return characters.length > 120
      ? `${characters.slice(0, 117).join("")}…`
      : characters.join("");
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

export default function TicketDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { recoveryEpoch } = useMobileNetworkStatus();
  const {
    isEnabled,
    loading: checkingFeatures,
    tenantId: confirmedTenantId,
  } = useMobileFeatures();
  const ticketDetailEnabled = isEnabled("ticketing.detail");
  const workspaceEnabled = isEnabled("experience.workspace");
  const selfServiceEnabled = isEnabled("portal.self-service");
  const agentWorkbenchEnabled = isEnabled("agent.workbench");
  const requesterPortalEnabled = isEnabled("requester.portal");
  const { colorScheme, density } = useThemeContext();
  const colors = useAppColors();
  const styles = useStyles();
  const tokenStyles = useMemo(
    () => ({
      card: { backgroundColor: colors.surface, borderColor: colors.border },
      control: {
        backgroundColor: colors.surfaceSubtle,
        borderColor: colors.border,
      },
      error: {
        backgroundColor: colors.errorSoft,
        borderColor: colors.errorBorder,
      },
      foreground: { color: colors.foreground },
      muted: { color: colors.muted },
      primary: { backgroundColor: colors.primary },
      primaryText: { color: colors.onPrimary },
      success: {
        backgroundColor: colors.successSoft,
        borderColor: colors.successBorder,
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
  const [categorySheetOpen, setCategorySheetOpen] = useState(false);
  const [categorySelectionStep, setCategorySelectionStep] = useState<
    "category" | "subcategory"
  >("category");
  const [categoryDraftId, setCategoryDraftId] = useState<string | null>(null);
  const [categoryError, setCategoryError] = useState("");
  const [savingCategory, setSavingCategory] = useState(false);
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
  const [followUps, setFollowUps] = useState<ExperienceFollowUp[]>([]);
  const [followUpDueAt, setFollowUpDueAt] = useState<Date>(() =>
    oneHourFromNow(),
  );
  const [followUpNote, setFollowUpNote] = useState("");
  const [editingFollowUp, setEditingFollowUp] =
    useState<ExperienceFollowUp | null>(null);
  const [showCustomDateTimePicker, setShowCustomDateTimePicker] =
    useState(false);
  const [followUpError, setFollowUpError] = useState("");
  const [savingFollowUp, setSavingFollowUp] = useState(false);
  const [resolvingFollowUpId, setResolvingFollowUpId] = useState<string | null>(
    null,
  );
  const [resolutionSheetOpen, setResolutionSheetOpen] = useState(false);
  const [resolutionDecision, setResolutionDecision] = useState<boolean | null>(
    null,
  );
  const [resolutionComment, setResolutionComment] = useState("");
  const [resolutionError, setResolutionError] = useState("");
  const [submittingResolution, setSubmittingResolution] = useState(false);
  const [resolutionSubmitted, setResolutionSubmitted] = useState(false);
  // Background reloads (reconnect, recovery, refresh after actions) must never
  // overwrite text that is currently being edited. Refs expose the latest
  // editing state to the stable load() callback.
  const editingFieldRef = useRef<typeof editingField>(null);
  const draftDirtyRef = useRef(false);
  useEffect(() => {
    editingFieldRef.current = editingField;
  }, [editingField]);
  useEffect(() => {
    draftDirtyRef.current = draftDirty;
  }, [draftDirty]);
  const [requesterPortalAvailable, setRequesterPortalAvailable] =
    useState(true);
  const [timeline, setTimeline] = useState<PublicTicketTimelineItem[] | null>(
    null,
  );
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [reopenSheetOpen, setReopenSheetOpen] = useState(false);
  const [reopenReason, setReopenReason] = useState("");
  const [reopenError, setReopenError] = useState("");
  const [requestingReopen, setRequestingReopen] = useState(false);
  const [reopenSubmitted, setReopenSubmitted] = useState(false);
  const [agentWorkbenchAvailable, setAgentWorkbenchAvailable] = useState(true);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [agentContextOpen, setAgentContextOpen] = useState(false);
  const [agentContext, setAgentContext] =
    useState<TicketWorkbenchContext | null>(null);
  const [contextLoading, setContextLoading] = useState(false);
  const [assigneeSuggestionsOpen, setAssigneeSuggestionsOpen] = useState(false);
  const [assigneeSuggestions, setAssigneeSuggestions] = useState<
    AssigneeSuggestion[] | null
  >(null);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [agentPickerOpen, setAgentPickerOpen] = useState(false);
  const [agentPickerQuery, setAgentPickerQuery] = useState("");
  const [assignableAgents, setAssignableAgents] = useState<
    AssignableAgent[] | null
  >(null);
  const [assignableAgentsLoading, setAssignableAgentsLoading] = useState(false);
  const [assignableAgentsError, setAssignableAgentsError] = useState("");
  const [pendingAgentAssignment, setPendingAgentAssignment] =
    useState<AssigneeSuggestion | null>(null);
  const [manualAgentAssignment, setManualAgentAssignment] =
    useState<AssignableAgent | null>(null);
  const [manualAgentAssignmentError, setManualAgentAssignmentError] =
    useState("");
  const [assigningAgent, setAssigningAgent] = useState(false);
  const [reopenRequestsOpen, setReopenRequestsOpen] = useState(false);
  const [reopenRequests, setReopenRequests] = useState<TicketReopenRequest[]>(
    [],
  );
  const [reopenRequestsLoading, setReopenRequestsLoading] = useState(false);
  const [pendingReopenDecision, setPendingReopenDecision] = useState<{
    decision: "accepted" | "declined";
    request: TicketReopenRequest;
  } | null>(null);
  const [decidingReopen, setDecidingReopen] = useState(false);

  const filteredAssignableAgents = useMemo(() => {
    const query = agentPickerQuery.trim().toLocaleLowerCase("de-CH");
    if (!query) return assignableAgents ?? [];
    return (assignableAgents ?? []).filter((agent) =>
      (agent.displayName ?? "Agent").toLocaleLowerCase("de-CH").includes(query),
    );
  }, [agentPickerQuery, assignableAgents]);

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
          // Für "Zuletzt geöffnet" auf der Startseite; ein Fehler ist unkritisch.
          void recordRecentTicket({
            userId,
            tenantId: currentTenant.id,
            ticketId: detail.id,
          }).catch(() => undefined);
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
          if (editingFieldRef.current === null) {
            setRequester(detail.requesterContact);
            setSubject(detail.subject);
            setDescription(detail.description);
            setStatusKey(
              detail.statusOptions.find(
                (option) => option.id === detail.statusId,
              )?.key ?? "",
            );
            setPriorityKey(
              detail.priorityOptions.find(
                (option) => option.id === detail.priorityId,
              )?.key ?? "",
            );
          }
          if (!draftDirtyRef.current) {
            setComment(localDraft?.body ?? serverDraft?.body ?? "");
            setDraftState(
              localDraft ? "local" : serverDraft ? "synced" : "idle",
            );
            setDraftDirty(false);
            setCommentVisibility(initialVisibility);
          }
          setFavorite(favoriteIds.includes(detail.id));
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
  const rootCategories = useMemo(
    () =>
      (ticket?.categoryOptions ?? []).filter(
        (category) => category.active && category.parentId === null,
      ),
    [ticket?.categoryOptions],
  );
  const selectedCategory = useMemo(
    () =>
      (ticket?.categoryOptions ?? []).find(
        (category) => category.id === ticket?.categoryId,
      ) ?? null,
    [ticket?.categoryId, ticket?.categoryOptions],
  );
  const selectedSubcategory = useMemo(
    () =>
      (ticket?.categoryOptions ?? []).find(
        (category) => category.id === ticket?.subcategoryId,
      ) ?? null,
    [ticket?.subcategoryId, ticket?.categoryOptions],
  );
  const draftCategory = useMemo(
    () =>
      (ticket?.categoryOptions ?? []).find(
        (category) => category.id === categoryDraftId,
      ) ?? null,
    [categoryDraftId, ticket?.categoryOptions],
  );
  const draftSubcategories = useMemo(
    () =>
      draftCategory
        ? (ticket?.categoryOptions ?? []).filter(
            (category) =>
              category.active && category.parentId === draftCategory.id,
          )
        : [],
    [draftCategory, ticket?.categoryOptions],
  );
  const categorySummary = selectedCategory
    ? [selectedCategory.name, selectedSubcategory?.name]
        .filter((value): value is string => Boolean(value))
        .join(" · ")
    : "Nicht zugewiesen";
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
  const ticketIsResolved = Boolean(ticket?.resolvedAt || status?.is_closed);
  const canUseRequesterPortal =
    requesterPortalEnabled && requesterPortalAvailable;
  const canUseAgentWorkbench =
    agentWorkbenchEnabled &&
    agentWorkbenchAvailable &&
    Boolean(ticket?.canUpdate);

  const loadOpenFollowUps = useCallback(async (ticketId: string) => {
    const result = await listFollowUps({
      includeResolved: false,
      ticketId,
    });
    return sortedOpenFollowUps(result.followUps);
  }, []);

  useEffect(() => {
    let active = true;
    const task = setTimeout(() => {
      if (!ticket?.id || !canSetFollowUp) {
        if (active) setFollowUps([]);
        return;
      }
      void loadOpenFollowUps(ticket.id)
        .then((nextFollowUps) => {
          if (active) setFollowUps(nextFollowUps);
        })
        .catch((nextError) => {
          if (!active) return;
          setFollowUps([]);
          if (isExperienceUnavailableError(nextError)) {
            setWorkspaceAvailable(false);
          }
        });
    }, 0);
    return () => {
      active = false;
      clearTimeout(task);
    };
  }, [canSetFollowUp, loadOpenFollowUps, ticket?.id]);

  useEffect(() => {
    if (!ticket || !canUseRequesterPortal) return;
    let active = true;
    const task = setTimeout(() => {
      setTimelineLoading(true);
      void loadMyTicketTimeline(ticket.id)
        .then((result) => {
          if (active) setTimeline(result.timeline);
        })
        .catch(() => {
          if (!active) return;
          setRequesterPortalAvailable(false);
          setTimeline(null);
        })
        .finally(() => {
          if (active) setTimelineLoading(false);
        });
    }, 0);
    return () => {
      active = false;
      clearTimeout(task);
    };
  }, [canUseRequesterPortal, ticket]);

  useEffect(() => {
    if (!ticket || !canUseAgentWorkbench) return;
    let active = true;
    const task = setTimeout(() => {
      setReopenRequestsLoading(true);
      void loadReopenRequests()
        .then((result) => {
          if (!active) return;
          setReopenRequests(
            result.reopenRequests.filter(
              (request) =>
                request.ticket_id === ticket.id && request.status === "pending",
            ),
          );
        })
        .catch(() => {
          if (!active) return;
          setAgentWorkbenchAvailable(false);
          setReopenRequests([]);
        })
        .finally(() => {
          if (active) setReopenRequestsLoading(false);
        });
    }, 0);
    return () => {
      active = false;
      clearTimeout(task);
    };
  }, [canUseAgentWorkbench, ticket]);

  // Name of the assigned agent, resolved from the assignable agents.
  const [assigneeName, setAssigneeName] = useState<string | null>(null);
  const assignedAgentId = ticket?.assignedAgentId ?? null;
  const ticketIdForAssignee = ticket?.id ?? null;
  useEffect(() => {
    if (!ticketIdForAssignee || !assignedAgentId || !canUseAgentWorkbench) {
      return;
    }
    let active = true;
    void loadAssignableAgents(ticketIdForAssignee)
      .then((result) => {
        if (!active) return;
        const agent = result.agents.find(
          (candidate) => candidate.userId === assignedAgentId,
        );
        setAssigneeName(agent?.displayName?.trim() || "Agent");
      })
      .catch(() => {
        if (active) setAssigneeName("Agent");
      });
    return () => {
      active = false;
    };
  }, [assignedAgentId, canUseAgentWorkbench, ticketIdForAssignee]);

  function openReopenSheet() {
    setReopenReason("");
    setReopenError("");
    setReopenSheetOpen(true);
    hapticSelection();
  }

  async function submitReopenRequest() {
    if (!ticket) return;
    const reason = reopenReason.trim();
    if (!reason) {
      setReopenError(
        "Bitte beschreiben Sie kurz, weshalb das Ticket wieder geöffnet werden soll.",
      );
      return;
    }
    if (reason.includes("\u0000") || Array.from(reason).length > 3_000) {
      setReopenError("Die Begründung darf höchstens 3'000 Zeichen lang sein.");
      return;
    }

    setRequestingReopen(true);
    setReopenError("");
    try {
      await requestTicketReopen({ ticketId: ticket.id, reason });
      setReopenSubmitted(true);
      setReopenSheetOpen(false);
      setMessage(
        "Ihr Antrag wurde übermittelt. Der Ticketstatus bleibt unverändert, bis ein berechtigter Agent entscheidet.",
      );
      hapticSuccess();
    } catch (nextError) {
      if (isWorkbenchUnavailableError(nextError)) {
        setRequesterPortalAvailable(false);
        setReopenSheetOpen(false);
        return;
      }
      hapticError();
      setReopenError(
        nextError instanceof Error
          ? nextError.message
          : "Der Wiedereröffnungsantrag konnte nicht übermittelt werden.",
      );
    } finally {
      setRequestingReopen(false);
    }
  }

  async function toggleAgentContext() {
    if (!ticket) return;
    if (agentContextOpen) {
      setAgentContextOpen(false);
      return;
    }

    setAgentContextOpen(true);
    if (agentContext) return;
    setContextLoading(true);
    try {
      setAgentContext(await loadTicketWorkbenchContext(ticket.id));
    } catch {
      setAgentWorkbenchAvailable(false);
      setAgentContextOpen(false);
    } finally {
      setContextLoading(false);
    }
  }

  async function loadSuggestions() {
    if (!ticket) return;
    setSuggestionsLoading(true);
    try {
      const result = await loadAssigneeSuggestions(ticket.id);
      setAssigneeSuggestions(result.suggestions);
    } catch {
      setAgentWorkbenchAvailable(false);
      setAssigneeSuggestions(null);
    } finally {
      setSuggestionsLoading(false);
    }
  }

  async function toggleAssigneeSuggestions() {
    const nextOpen = !assigneeSuggestionsOpen;
    setAssigneeSuggestionsOpen(nextOpen);
    if (nextOpen && assigneeSuggestions === null) {
      await loadSuggestions();
    }
  }

  async function loadAllAssignableAgents() {
    if (!ticket) return;
    setAssignableAgentsLoading(true);
    setAssignableAgentsError("");
    try {
      const result = await loadAssignableAgents(ticket.id);
      setAssignableAgents(result.agents);
    } catch (nextError) {
      setAssignableAgents([]);
      setAssignableAgentsError(
        nextError instanceof Error
          ? nextError.message
          : "Die berechtigten Agenten konnten nicht geladen werden.",
      );
    } finally {
      setAssignableAgentsLoading(false);
    }
  }

  async function openAgentPicker() {
    setPendingAgentAssignment(null);
    setManualAgentAssignment(null);
    setManualAgentAssignmentError("");
    setAgentPickerQuery("");
    setAgentPickerOpen(true);
    await loadAllAssignableAgents();
  }

  async function confirmAgentAssignment() {
    const assignment = manualAgentAssignment ?? pendingAgentAssignment;
    if (!tenant || !ticket || !assignment) return;
    const displayName = assignment.displayName?.trim() || "Agent";
    setAssigningAgent(true);
    setError("");
    setManualAgentAssignmentError("");
    try {
      await assignTicketAgent(tenant.id, ticket.id, assignment.userId);
      setPendingAgentAssignment(null);
      setManualAgentAssignment(null);
      setAgentPickerOpen(false);
      await Promise.all([
        load(false),
        loadSuggestions(),
        loadAllAssignableAgents(),
      ]);
      setMessage(`${displayName} wurde zugewiesen.`);
      hapticSuccess();
    } catch (nextError) {
      const assignmentError =
        nextError instanceof Error
          ? nextError.message
          : "Der Agent konnte nicht zugewiesen werden.";
      hapticError();
      setError(assignmentError);
      if (manualAgentAssignment) setManualAgentAssignmentError(assignmentError);
    } finally {
      setAssigningAgent(false);
    }
  }

  async function decidePendingReopenRequest() {
    if (!pendingReopenDecision) return;
    setDecidingReopen(true);
    try {
      const result = await decideTicketReopenRequest({
        decision: pendingReopenDecision.decision,
        reopenRequestId: pendingReopenDecision.request.id,
      });
      setReopenRequests((current) =>
        current.filter((request) => request.id !== result.reopenRequest.id),
      );
      setPendingReopenDecision(null);
      setMessage(result.notice);
      hapticSuccess();
    } catch (nextError) {
      if (isWorkbenchUnavailableError(nextError)) {
        setAgentWorkbenchAvailable(false);
        setPendingReopenDecision(null);
        return;
      }
      hapticError();
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Der Entscheid konnte nicht gespeichert werden.",
      );
    } finally {
      setDecidingReopen(false);
    }
  }

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

    const requesterChanged =
      nextRequester !== null &&
      nextRequester.id !== (ticket.requesterContact?.id ?? null);
    const unchanged =
      nextSubject === ticket.subject.trim() &&
      nextDescription === ticket.description.trim() &&
      nextStatus.id === ticket.statusId &&
      nextPriority.id === ticket.priorityId &&
      !requesterChanged;
    if (unchanged) {
      // Nothing to save: close the editor locally instead of asking the server.
      setEditingField(null);
      setError("");
      setMessage("Es gab keine Änderungen zum Speichern.");
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
        ...(requesterChanged ? { requesterContactId: nextRequester.id } : {}),
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

  function openCategorySelection() {
    if (!ticket?.canUpdate || savingCategory) return;
    setCategoryDraftId(ticket.categoryId);
    setCategorySelectionStep("category");
    setCategoryError("");
    setCategorySheetOpen(true);
    hapticSelection();
  }

  async function saveCategorySelection(
    categoryId: string | null,
    subcategoryId: string | null,
  ) {
    if (!ticket || !tenant) return;
    const category = categoryId
      ? (rootCategories.find((option) => option.id === categoryId) ?? null)
      : null;
    const subcategory = subcategoryId
      ? (ticket.categoryOptions.find(
          (option) =>
            option.active &&
            option.id === subcategoryId &&
            option.parentId === categoryId,
        ) ?? null)
      : null;
    if (
      (categoryId !== null && !category) ||
      (subcategoryId !== null && !subcategory)
    ) {
      setCategoryError("Bitte wählen Sie eine gültige Kategorie aus.");
      return;
    }

    setSavingCategory(true);
    setCategoryError("");
    setError("");
    setMessage("");
    try {
      await updateMobileTicketCategory({
        categoryId,
        subcategoryId,
        tenantId: tenant.id,
        ticketId: ticket.id,
      });
      setTicket((current) =>
        current && current.id === ticket.id
          ? { ...current, categoryId, subcategoryId }
          : current,
      );
      setCategorySheetOpen(false);
      setCategorySelectionStep("category");
      setCategoryDraftId(categoryId);
      setMessage("Kategorie wurde erfolgreich gespeichert.");
      hapticSuccess();
    } catch (nextError) {
      hapticError();
      setCategoryError(
        nextError instanceof Error
          ? nextError.message
          : "Die Kategorie konnte nicht gespeichert werden.",
      );
    } finally {
      setSavingCategory(false);
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
  async function contactRequesterByPhone(number: string) {
    const target = `tel:${encodeURIComponent(number)}`;
    try {
      if (!(await Linking.canOpenURL(target))) {
        throw new Error(
          "Auf diesem Gerät ist keine Telefon-App für die Kontaktaufnahme verfügbar.",
        );
      }
      await Linking.openURL(target);
    } catch (nextError) {
      hapticError();
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Die Telefon-App konnte nicht geöffnet werden.",
      );
    }
  }

  function openFollowUpSheet(followUp?: ExperienceFollowUp) {
    const existingDueAt = followUp ? followUpDate(followUp.dueAt) : null;
    setEditingFollowUp(followUp ?? null);
    setFollowUpDueAt(
      existingDueAt && existingDueAt.getTime() > Date.now()
        ? existingDueAt
        : oneHourFromNow(),
    );
    setFollowUpNote(followUp?.description ?? "");
    setFollowUpError("");
    setShowCustomDateTimePicker(false);
    setFollowUpSheetOpen(true);
    hapticSelection();
  }

  function chooseFollowUpTime(value: Date) {
    setFollowUpDueAt(value);
    setShowCustomDateTimePicker(false);
    setFollowUpError("");
    hapticSelection();
  }

  async function saveTicketFollowUp() {
    if (!ticket) return;
    if (followUpDueAt.getTime() <= Date.now()) {
      setFollowUpError("Bitte wählen Sie einen zukünftigen Zeitpunkt.");
      return;
    }
    const description = followUpNote.trim();
    if (
      description.includes("\u0000") ||
      Array.from(description).length > 500
    ) {
      setFollowUpError("Die Notiz darf höchstens 500 Zeichen lang sein.");
      return;
    }

    setSavingFollowUp(true);
    setFollowUpError("");
    setError("");
    setMessage("");
    try {
      const { followUp } = await saveFollowUp({
        ...(editingFollowUp ? { followUpId: editingFollowUp.id } : {}),
        title: followUpTitle(ticket),
        description: description || null,
        dueAt: followUpDueAt.toISOString(),
        priority: "normal",
        ticketId: ticket.id,
      });
      setFollowUps((current) =>
        sortedOpenFollowUps([
          ...current.filter((entry) => entry.id !== followUp.id),
          followUp,
        ]),
      );
      setFollowUpSheetOpen(false);
      setMessage(
        `Erinnerung für ${followUpSuccessDate(followUpDueAt)} gesetzt.`,
      );
      hapticSuccess();
    } catch (nextError) {
      if (isExperienceUnavailableError(nextError)) {
        setWorkspaceAvailable(false);
        setFollowUps([]);
        setFollowUpSheetOpen(false);
        return;
      }
      hapticError();
      setFollowUpError(
        nextError instanceof Error
          ? nextError.message
          : "Die Erinnerung konnte nicht gespeichert werden.",
      );
    } finally {
      setSavingFollowUp(false);
    }
  }

  async function resolveTicketFollowUp(followUpId: string) {
    if (!ticket || resolvingFollowUpId) return;
    setResolvingFollowUpId(followUpId);
    setError("");
    setMessage("");
    try {
      await resolveFollowUp(followUpId);
      setFollowUps(await loadOpenFollowUps(ticket.id));
      setMessage("Erinnerung wurde als erledigt markiert.");
      hapticSuccess();
    } catch (nextError) {
      if (isExperienceUnavailableError(nextError)) {
        setWorkspaceAvailable(false);
        setFollowUps([]);
        return;
      }
      hapticError();
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Die Erinnerung konnte nicht aktualisiert werden.",
      );
    } finally {
      setResolvingFollowUpId(null);
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
              { backgroundColor: colors.primarySoft },
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
              <Ionicons
                color={colors.primaryText}
                name="arrow-back"
                size={22}
              />
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
                color={favorite ? colors.onPrimary : colors.primaryText}
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
                  <Ionicons
                    color={colors.onPrimary}
                    name="checkmark"
                    size={18}
                  />
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
                  setSubject(ticket.subject);
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
                      color: status.is_closed
                        ? colors.success
                        : colors.primaryText,
                    },
                  ]}
                >
                  {status.label}
                </Text>
                {ticket.canUpdate ? (
                  <Ionicons
                    color={
                      status.is_closed ? colors.success : colors.primaryText
                    }
                    name="chevron-down"
                    size={14}
                  />
                ) : null}
              </Pressable>
            ) : null}
          </View>

          <View
            style={[styles.detailsCard, tokenStyles.card, densityStyles.card]}
          >
            <Text style={[styles.detailsTitle, tokenStyles.foreground]}>
              Details
            </Text>

            <View style={styles.detailsRequester}>
              <Text style={[styles.cardLabel, tokenStyles.muted]}>
                ANFRAGENDE PERSON
              </Text>
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
                  style={styles.requesterPressable}
                >
                  <Text numberOfLines={2} style={styles.requesterName}>
                    {ticket.requesterName ?? "Anfragende Person"}
                  </Text>
                  {ticket.requesterContact?.department ||
                  ticket.requesterContact?.offering ? (
                    <Text style={styles.requesterMeta}>
                      {[
                        ticket.requesterContact?.department,
                        ticket.requesterContact?.offering,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </Text>
                  ) : null}
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
                  <Ionicons color={colors.info} name="mail-outline" size={15} />
                  <Text numberOfLines={1} style={styles.contactActionText}>
                    {ticket.requesterContact.email}
                  </Text>
                </Pressable>
              ) : null}
              {ticket.requesterContact?.phone ? (
                <Pressable
                  accessibilityLabel={`${ticket.requesterContact.displayName} anrufen`}
                  accessibilityRole="button"
                  onPress={() =>
                    void contactRequesterByPhone(
                      ticket.requesterContact?.phone ?? "",
                    )
                  }
                  style={styles.contactAction}
                >
                  <Ionicons color={colors.info} name="call-outline" size={15} />
                  <Text numberOfLines={1} style={styles.contactActionText}>
                    {ticket.requesterContact.phone}
                  </Text>
                </Pressable>
              ) : null}
            </View>

            {canUseAgentWorkbench ? (
              <>
                <View style={styles.detailsDivider} />
                <Pressable
                  accessibilityHint="Antippen, um einen Agenten zuzuweisen."
                  accessibilityLabel="Zugewiesen an"
                  accessibilityRole="button"
                  disabled={assignableAgentsLoading || assigningAgent}
                  onPress={() => {
                    hapticSelection();
                    void openAgentPicker();
                  }}
                  style={styles.detailsValueRow}
                >
                  <View>
                    <Text style={[styles.cardLabel, tokenStyles.muted]}>
                      ZUGEWIESEN AN
                    </Text>
                    <Text style={styles.detailsValue}>
                      {ticket.assignedAgentId
                        ? (assigneeName ?? "Wird geladen …")
                        : "Niemand"}
                    </Text>
                  </View>
                  <Ionicons
                    color={colors.primaryText}
                    name="chevron-forward"
                    size={18}
                  />
                </Pressable>
              </>
            ) : null}

            <View style={styles.detailsDivider} />
            <Pressable
              accessibilityHint={
                ticket.canUpdate
                  ? "Antippen, um den Status zu ändern."
                  : undefined
              }
              accessibilityLabel="Status"
              accessibilityRole={ticket.canUpdate ? "button" : undefined}
              disabled={!ticket.canUpdate || saving}
              onPress={() => {
                hapticSelection();
                setSelection("status");
              }}
              style={styles.detailsValueRow}
            >
              <View>
                <Text style={[styles.cardLabel, tokenStyles.muted]}>
                  STATUS
                </Text>
                <Text style={styles.detailsValue}>
                  {status?.label ?? "Unbekannt"}
                </Text>
              </View>
              {ticket.canUpdate ? (
                <Ionicons
                  color={colors.primaryText}
                  name="chevron-forward"
                  size={18}
                />
              ) : null}
            </Pressable>

            <View style={styles.detailsDivider} />
            <Pressable
              accessibilityHint={
                ticket.canUpdate
                  ? "Antippen, um die Priorität zu ändern."
                  : undefined
              }
              accessibilityLabel="Priorität"
              accessibilityRole={ticket.canUpdate ? "button" : undefined}
              disabled={!ticket.canUpdate}
              onPress={() => {
                hapticSelection();
                setSelection("priority");
              }}
              style={styles.detailsValueRow}
            >
              <View>
                <Text style={[styles.cardLabel, tokenStyles.muted]}>
                  PRIORITÄT
                </Text>
                <Text style={styles.detailsValue}>
                  {priority?.label ?? "Ohne Priorität"}
                </Text>
              </View>
              {ticket.canUpdate ? (
                <Ionicons
                  color={colors.primaryText}
                  name="chevron-forward"
                  size={18}
                />
              ) : null}
            </Pressable>

            <View style={styles.detailsDivider} />
            <Pressable
              accessibilityHint={
                ticket.canUpdate
                  ? "Antippen, um Kategorie und Unterkategorie zu ändern."
                  : undefined
              }
              accessibilityLabel="Kategorie und Unterkategorie"
              accessibilityRole={ticket.canUpdate ? "button" : undefined}
              disabled={!ticket.canUpdate || savingCategory}
              onPress={openCategorySelection}
              style={styles.detailsValueRow}
            >
              <View style={styles.detailsValueCopy}>
                <Text style={[styles.cardLabel, tokenStyles.muted]}>
                  KATEGORIE
                </Text>
                <Text numberOfLines={2} style={styles.detailsValue}>
                  {categorySummary}
                </Text>
              </View>
              {savingCategory ? (
                <ActivityIndicator color={colors.primaryText} size="small" />
              ) : ticket.canUpdate ? (
                <Ionicons
                  color={colors.primaryText}
                  name="chevron-forward"
                  size={18}
                />
              ) : null}
            </Pressable>

            {canSetFollowUp ? (
              <>
                <View style={styles.detailsDivider} />
                <Pressable
                  accessibilityLabel="Erinnerung für dieses Ticket setzen"
                  accessibilityRole="button"
                  disabled={savingFollowUp}
                  onPress={() => openFollowUpSheet()}
                  style={styles.detailsActionRow}
                >
                  <View style={styles.detailsActionLead}>
                    <Ionicons
                      color={colors.primaryText}
                      name="alarm-outline"
                      size={19}
                    />
                    <Text style={styles.detailsActionLabel}>Wiedervorlage</Text>
                  </View>
                  <View style={styles.detailsActionLead}>
                    <Text style={styles.detailsActionLink}>Setzen</Text>
                    <Ionicons
                      color={colors.primaryText}
                      name="chevron-forward"
                      size={18}
                    />
                  </View>
                </Pressable>
                {followUps.length > 0 ? (
                  <View style={styles.followUpList}>
                    {followUps.map((followUp) => {
                      const overdue = isOverdueFollowUp(followUp);
                      return (
                        <View key={followUp.id} style={styles.followUpRow}>
                          <View style={styles.followUpCopy}>
                            <Text
                              style={[
                                styles.followUpTitle,
                                overdue && styles.followUpOverdue,
                              ]}
                            >
                              Erinnerung · {compactFollowUpDate(followUp.dueAt)}
                              {overdue ? " · überfällig" : ""}
                            </Text>
                            {followUp.description ? (
                              <Text
                                numberOfLines={2}
                                style={styles.followUpNote}
                              >
                                {followUp.description}
                              </Text>
                            ) : null}
                          </View>
                          <View style={styles.followUpActions}>
                            <Pressable
                              accessibilityLabel="Erinnerung ändern"
                              accessibilityRole="button"
                              disabled={resolvingFollowUpId !== null}
                              onPress={() => openFollowUpSheet(followUp)}
                              style={styles.followUpAction}
                            >
                              <Text style={styles.followUpEditText}>
                                Ändern
                              </Text>
                            </Pressable>
                            <Pressable
                              accessibilityLabel="Erinnerung als erledigt markieren"
                              accessibilityRole="button"
                              accessibilityState={{
                                busy: resolvingFollowUpId === followUp.id,
                              }}
                              disabled={resolvingFollowUpId !== null}
                              onPress={() =>
                                void resolveTicketFollowUp(followUp.id)
                              }
                              style={styles.followUpAction}
                            >
                              <Text style={styles.followUpDoneText}>
                                {resolvingFollowUpId === followUp.id
                                  ? "…"
                                  : "Erledigt"}
                              </Text>
                            </Pressable>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                ) : null}
              </>
            ) : null}

            {canUseRequesterPortal ? (
              <>
                <View style={styles.detailsDivider} />
                <Pressable
                  accessibilityLabel="Statuszeitleiste"
                  accessibilityRole="button"
                  accessibilityState={{ expanded: timelineOpen }}
                  onPress={() => {
                    setTimelineOpen((current) => !current);
                    hapticSelection();
                  }}
                  style={styles.detailsAccordionRow}
                >
                  <View style={styles.detailsActionLead}>
                    <Ionicons
                      color={colors.primaryText}
                      name="time-outline"
                      size={19}
                    />
                    <Text style={styles.detailsActionLabel}>
                      Statuszeitleiste
                    </Text>
                  </View>
                  <View style={styles.detailsActionLead}>
                    <Text numberOfLines={1} style={styles.detailsSummary}>
                      {timelineLoading || timeline === null
                        ? "Lädt …"
                        : timeline?.length
                          ? `${timeline.length} Ereignisse · ${formatWorkbenchDate(
                              timeline.reduce((latest, item) =>
                                new Date(item.occurredAt).getTime() >
                                new Date(latest.occurredAt).getTime()
                                  ? item
                                  : latest,
                              ).occurredAt,
                            )}`
                          : "Keine"}
                    </Text>
                    {timelineLoading || timeline === null ? (
                      <ActivityIndicator
                        color={colors.primaryText}
                        size="small"
                      />
                    ) : (
                      <Ionicons
                        color={colors.primaryText}
                        name={timelineOpen ? "chevron-up" : "chevron-down"}
                        size={18}
                      />
                    )}
                  </View>
                </Pressable>
                {timelineOpen ? (
                  <View style={styles.detailsExpansion}>
                    {timelineLoading || timeline === null ? (
                      <View style={styles.inlineLoading}>
                        <ActivityIndicator
                          color={colors.primaryText}
                          size="small"
                        />
                        <Text style={[styles.timelineText, tokenStyles.muted]}>
                          Öffentlicher Verlauf wird geladen …
                        </Text>
                      </View>
                    ) : timeline?.length ? (
                      <View style={styles.timelineList}>
                        {timeline.map((item) => (
                          <View key={item.id} style={styles.timelineItem}>
                            <View
                              style={[
                                styles.timelineIcon,
                                { backgroundColor: colors.primarySoft },
                              ]}
                            >
                              <Ionicons
                                color={colors.primaryText}
                                name={
                                  item.type === "comment"
                                    ? "chatbubble-outline"
                                    : "ellipse-outline"
                                }
                                size={15}
                              />
                            </View>
                            <View style={styles.timelineCopy}>
                              <Text
                                style={[
                                  styles.timelineTitle,
                                  tokenStyles.foreground,
                                ]}
                              >
                                {item.type === "comment"
                                  ? item.authorDisplayName
                                    ? `Kommentar von ${item.authorDisplayName}`
                                    : "Kommentar"
                                  : publicTimelineEventLabel(item)}
                              </Text>
                              {item.type === "comment" && item.body ? (
                                <Text
                                  numberOfLines={2}
                                  style={[
                                    styles.timelineText,
                                    tokenStyles.muted,
                                  ]}
                                >
                                  {item.body}
                                </Text>
                              ) : null}
                              <Text
                                style={[styles.timelineDate, tokenStyles.muted]}
                              >
                                {formatWorkbenchDate(item.occurredAt)}
                              </Text>
                            </View>
                          </View>
                        ))}
                      </View>
                    ) : (
                      <Text style={[styles.timelineText, tokenStyles.muted]}>
                        Noch keine öffentlichen Einträge vorhanden.
                      </Text>
                    )}
                  </View>
                ) : null}
              </>
            ) : null}

            {canUseAgentWorkbench ? (
              <>
                <View style={styles.detailsDivider} />
                <Pressable
                  accessibilityLabel="360°-Kontext"
                  accessibilityRole="button"
                  accessibilityState={{ expanded: agentContextOpen }}
                  disabled={contextLoading}
                  onPress={() => void toggleAgentContext()}
                  style={styles.detailsAccordionRow}
                >
                  <View style={styles.detailsActionLead}>
                    <Ionicons
                      color={colors.primaryText}
                      name="layers-outline"
                      size={19}
                    />
                    <Text style={styles.detailsActionLabel}>360°-Kontext</Text>
                  </View>
                  <View style={styles.detailsActionLead}>
                    <Text numberOfLines={1} style={styles.detailsSummary}>
                      {contextLoading
                        ? "Lädt …"
                        : agentContext
                          ? `${agentContext.requesterTickets.length} weitere Tickets`
                          : "Aufklappen"}
                    </Text>
                    {contextLoading ? (
                      <ActivityIndicator
                        color={colors.primaryText}
                        size="small"
                      />
                    ) : (
                      <Ionicons
                        color={colors.primaryText}
                        name={agentContextOpen ? "chevron-up" : "chevron-down"}
                        size={18}
                      />
                    )}
                  </View>
                </Pressable>
                {agentContextOpen && agentContext ? (
                  <View style={styles.detailsExpansion}>
                    {compactContextValue(agentContext.ticket.ticket_number) ? (
                      <Text
                        style={[
                          styles.contextReference,
                          tokenStyles.foreground,
                        ]}
                      >
                        {compactContextValue(agentContext.ticket.ticket_number)}
                      </Text>
                    ) : null}
                    {[
                      ["Weitere Tickets", agentContext.requesterTickets.length],
                      ["Assets", agentContext.assets.length],
                      ["Assetverlauf", agentContext.assetHistory.length],
                      [
                        "Lösungsbestätigungen",
                        agentContext.resolutionConfirmations.length,
                      ],
                    ].map(([label, value]) => (
                      <View key={label} style={styles.contextSummaryRow}>
                        <Text style={[styles.timelineText, tokenStyles.muted]}>
                          {label}
                        </Text>
                        <Text
                          style={[
                            styles.contextSummaryValue,
                            tokenStyles.foreground,
                          ]}
                        >
                          {value}
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : null}
              </>
            ) : null}

            {canUseAgentWorkbench ? (
              <>
                <View style={styles.detailsDivider} />
                <Pressable
                  accessibilityLabel="Passende Agenten"
                  accessibilityRole="button"
                  accessibilityState={{ expanded: assigneeSuggestionsOpen }}
                  disabled={suggestionsLoading}
                  onPress={() => void toggleAssigneeSuggestions()}
                  style={styles.detailsAccordionRow}
                >
                  <View style={styles.detailsActionLead}>
                    <Ionicons
                      color={colors.primaryText}
                      name="people-outline"
                      size={19}
                    />
                    <Text style={styles.detailsActionLabel}>
                      Passende Agenten
                    </Text>
                  </View>
                  <View style={styles.detailsActionLead}>
                    <Text numberOfLines={1} style={styles.detailsSummary}>
                      {suggestionsLoading
                        ? "Lädt …"
                        : assigneeSuggestions
                          ? assigneeSuggestions.length
                            ? `${Math.min(assigneeSuggestions.length, 5)} Vorschläge`
                            : "Keine"
                          : "Aufklappen"}
                    </Text>
                    {suggestionsLoading ? (
                      <ActivityIndicator
                        color={colors.primaryText}
                        size="small"
                      />
                    ) : (
                      <Ionicons
                        color={colors.primaryText}
                        name={
                          assigneeSuggestionsOpen
                            ? "chevron-up"
                            : "chevron-down"
                        }
                        size={18}
                      />
                    )}
                  </View>
                </Pressable>
                {assigneeSuggestionsOpen ? (
                  <View style={styles.detailsExpansion}>
                    {suggestionsLoading ? (
                      <View style={styles.inlineLoading}>
                        <ActivityIndicator
                          color={colors.primaryText}
                          size="small"
                        />
                        <Text style={[styles.timelineText, tokenStyles.muted]}>
                          Vorschläge werden geladen …
                        </Text>
                      </View>
                    ) : assigneeSuggestions?.length ? (
                      <View style={styles.suggestionList}>
                        {assigneeSuggestions.slice(0, 5).map((suggestion) => {
                          const displayName =
                            suggestion.displayName?.trim() || "Agent";
                          const confirming =
                            pendingAgentAssignment?.userId ===
                            suggestion.userId;
                          return (
                            <View
                              key={suggestion.userId}
                              style={[
                                styles.suggestion,
                                {
                                  backgroundColor: colors.surfaceSubtle,
                                  borderColor: colors.border,
                                },
                              ]}
                            >
                              <View style={styles.suggestionHeader}>
                                <View style={styles.suggestionCopy}>
                                  <Text
                                    numberOfLines={1}
                                    style={[
                                      styles.suggestionUser,
                                      tokenStyles.foreground,
                                    ]}
                                  >
                                    {displayName}
                                  </Text>
                                  <Text
                                    numberOfLines={1}
                                    style={[
                                      styles.timelineText,
                                      tokenStyles.muted,
                                    ]}
                                  >
                                    {suggestion.reasons
                                      .slice(0, 2)
                                      .join(" · ") ||
                                      "Keine Begründung verfügbar"}
                                  </Text>
                                </View>
                                {suggestion.isCurrentAssignee ? (
                                  <View
                                    accessibilityLabel={`${displayName} ist bereits zugewiesen`}
                                    style={styles.assignedBadge}
                                  >
                                    <Text style={styles.assignedBadgeText}>
                                      Zugewiesen
                                    </Text>
                                  </View>
                                ) : (
                                  <Pressable
                                    accessibilityLabel={`${displayName} zuweisen`}
                                    accessibilityRole="button"
                                    disabled={assigningAgent}
                                    onPress={() => {
                                      setManualAgentAssignment(null);
                                      setManualAgentAssignmentError("");
                                      setPendingAgentAssignment(suggestion);
                                      hapticSelection();
                                    }}
                                    style={styles.assignButton}
                                  >
                                    <Text style={styles.assignButtonText}>
                                      Zuweisen
                                    </Text>
                                  </Pressable>
                                )}
                              </View>
                              {confirming ? (
                                <View style={styles.assignmentConfirmation}>
                                  <Text
                                    style={styles.assignmentConfirmationText}
                                  >
                                    {displayName} zuweisen?
                                  </Text>
                                  <View style={styles.assignmentActions}>
                                    <Pressable
                                      accessibilityLabel={`${displayName} zuweisen bestätigen`}
                                      accessibilityRole="button"
                                      disabled={assigningAgent}
                                      onPress={() =>
                                        void confirmAgentAssignment()
                                      }
                                      style={styles.assignmentConfirmButton}
                                    >
                                      {assigningAgent ? (
                                        <ActivityIndicator
                                          color={colors.onPrimary}
                                          size="small"
                                        />
                                      ) : null}
                                      <Text
                                        style={styles.assignmentConfirmText}
                                      >
                                        Bestätigen
                                      </Text>
                                    </Pressable>
                                    <Pressable
                                      accessibilityLabel="Zuweisung abbrechen"
                                      accessibilityRole="button"
                                      disabled={assigningAgent}
                                      onPress={() =>
                                        setPendingAgentAssignment(null)
                                      }
                                      style={styles.assignmentCancelButton}
                                    >
                                      <Text style={styles.assignmentCancelText}>
                                        Abbrechen
                                      </Text>
                                    </Pressable>
                                  </View>
                                </View>
                              ) : null}
                            </View>
                          );
                        })}
                        <Text style={styles.assignmentFootnote}>
                          Zuweisung nur nach Bestätigung
                        </Text>
                      </View>
                    ) : (
                      <Text style={[styles.timelineText, tokenStyles.muted]}>
                        Derzeit liegen keine Zuweisungsvorschläge vor.
                      </Text>
                    )}
                    {!suggestionsLoading ? (
                      <Pressable
                        accessibilityHint="Öffnet alle für dieses Ticket berechtigten Agenten."
                        accessibilityLabel="Anderen Agenten auswählen"
                        accessibilityRole="button"
                        disabled={assignableAgentsLoading || assigningAgent}
                        onPress={() => {
                          hapticSelection();
                          void openAgentPicker();
                        }}
                        style={({ pressed }) => [
                          styles.manualAssigneeButton,
                          (assignableAgentsLoading || assigningAgent) &&
                            styles.disabled,
                          pressed && styles.pressed,
                        ]}
                      >
                        <View style={styles.manualAssigneeCopy}>
                          <Ionicons
                            color={colors.primaryText}
                            name="people-outline"
                            size={18}
                          />
                          <View style={styles.suggestionCopy}>
                            <Text style={styles.manualAssigneeTitle}>
                              Anderen Agenten auswählen
                            </Text>
                            <Text style={styles.manualAssigneeText}>
                              Alle berechtigten Agenten anzeigen
                            </Text>
                          </View>
                        </View>
                        {assignableAgentsLoading ? (
                          <ActivityIndicator
                            color={colors.primaryText}
                            size="small"
                          />
                        ) : (
                          <Ionicons
                            color={colors.primaryText}
                            name="chevron-forward"
                            size={18}
                          />
                        )}
                      </Pressable>
                    ) : null}
                  </View>
                ) : null}
              </>
            ) : null}

            {canUseAgentWorkbench ? (
              <>
                <DepartmentQuestions key={ticket.id} ticketId={ticket.id} />
                <View style={styles.detailsDivider} />
                <Pressable
                  accessibilityLabel="Wiedereröffnungsanträge"
                  accessibilityRole="button"
                  accessibilityState={{ expanded: reopenRequestsOpen }}
                  onPress={() => {
                    setReopenRequestsOpen((current) => !current);
                    hapticSelection();
                  }}
                  style={styles.detailsAccordionRow}
                >
                  <View style={styles.detailsActionLead}>
                    <Ionicons
                      color={colors.warning}
                      name="git-pull-request-outline"
                      size={19}
                    />
                    <Text style={styles.detailsActionLabel}>
                      Wiedereröffnungsanträge
                    </Text>
                  </View>
                  <View style={styles.detailsActionLead}>
                    {reopenRequestsLoading ? (
                      <ActivityIndicator
                        color={colors.primaryText}
                        size="small"
                      />
                    ) : (
                      <>
                        <View style={styles.detailsCountBadge}>
                          <Text style={styles.detailsCountBadgeText}>
                            {reopenRequests.length || "Keine"}
                          </Text>
                        </View>
                        <Ionicons
                          color={colors.primaryText}
                          name={
                            reopenRequestsOpen ? "chevron-up" : "chevron-down"
                          }
                          size={18}
                        />
                      </>
                    )}
                  </View>
                </Pressable>
                {reopenRequestsOpen ? (
                  <View style={styles.detailsExpansion}>
                    {reopenRequestsLoading ? (
                      <View style={styles.inlineLoading}>
                        <ActivityIndicator
                          color={colors.primaryText}
                          size="small"
                        />
                        <Text style={[styles.timelineText, tokenStyles.muted]}>
                          Anfragen werden geladen …
                        </Text>
                      </View>
                    ) : reopenRequests.length ? (
                      <View style={styles.reopenRequestList}>
                        {reopenRequests.map((request) => (
                          <View
                            key={request.id}
                            style={[
                              styles.reopenRequest,
                              {
                                backgroundColor: colors.surfaceSubtle,
                                borderColor: colors.border,
                              },
                            ]}
                          >
                            <Text
                              style={[
                                styles.timelineText,
                                tokenStyles.foreground,
                              ]}
                            >
                              {request.reason}
                            </Text>
                            <Text
                              style={[styles.timelineDate, tokenStyles.muted]}
                            >
                              Eingereicht:{" "}
                              {formatWorkbenchDate(request.created_at)}
                            </Text>
                            <View style={styles.decisionActions}>
                              <Pressable
                                accessibilityLabel="Wiedereröffnungsantrag annehmen"
                                accessibilityRole="button"
                                onPress={() =>
                                  setPendingReopenDecision({
                                    decision: "accepted",
                                    request,
                                  })
                                }
                                style={[
                                  styles.decisionButton,
                                  {
                                    backgroundColor: colors.successSoft,
                                    borderColor: colors.successBorder,
                                  },
                                ]}
                              >
                                <Text style={styles.decisionAcceptText}>
                                  Annehmen
                                </Text>
                              </Pressable>
                              <Pressable
                                accessibilityLabel="Wiedereröffnungsantrag ablehnen"
                                accessibilityRole="button"
                                onPress={() =>
                                  setPendingReopenDecision({
                                    decision: "declined",
                                    request,
                                  })
                                }
                                style={[
                                  styles.decisionButton,
                                  {
                                    backgroundColor: colors.errorSoft,
                                    borderColor: colors.errorBorder,
                                  },
                                ]}
                              >
                                <Text style={styles.decisionDeclineText}>
                                  Ablehnen
                                </Text>
                              </Pressable>
                            </View>
                          </View>
                        ))}
                      </View>
                    ) : (
                      <Text style={[styles.timelineText, tokenStyles.muted]}>
                        Für dieses Ticket liegen keine offenen
                        Wiedereröffnungsanfragen vor.
                      </Text>
                    )}
                  </View>
                ) : null}
              </>
            ) : null}
          </View>

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
                    { backgroundColor: colors.successSoft },
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
                      backgroundColor: colors.successSoft,
                      borderColor: colors.successBorder,
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
                      backgroundColor: colors.errorSoft,
                      borderColor: colors.errorBorder,
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
                  setDescription(ticket.description);
                  setEditingField("description");
                }}
              >
                <Text style={styles.description}>{ticket.description}</Text>
              </Pressable>
            )}
          </View>

          {canUseRequesterPortal && ticketIsResolved && !reopenSubmitted ? (
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
                    { backgroundColor: colors.warningSoft },
                  ]}
                >
                  <Ionicons
                    color={colors.warning}
                    name="refresh-outline"
                    size={20}
                  />
                </View>
                <View style={styles.experienceCopy}>
                  <Text
                    style={[styles.experienceTitle, tokenStyles.foreground]}
                  >
                    Wiedereröffnung beantragen
                  </Text>
                  <Text style={[styles.experienceText, tokenStyles.muted]}>
                    Ein Antrag ändert den Ticketstatus nicht.
                  </Text>
                </View>
              </View>
              <Pressable
                accessibilityLabel="Wiedereröffnung beantragen"
                accessibilityRole="button"
                onPress={openReopenSheet}
                style={[styles.experienceAction, tokenStyles.control]}
              >
                <Text
                  style={[
                    styles.experienceActionText,
                    { color: colors.primaryText },
                  ]}
                >
                  Antrag erfassen
                </Text>
                <Ionicons
                  color={colors.primaryText}
                  name="chevron-forward"
                  size={19}
                />
              </Pressable>
            </View>
          ) : null}

          <View>
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
          </View>

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
          animationType="slide"
          onRequestClose={() => setFollowUpSheetOpen(false)}
          transparent
          visible={
            followUpSheetOpen && !checkingFeatures && Boolean(confirmedTenantId)
          }
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : "height"}
            style={styles.experienceSheetRoot}
          >
            <Pressable
              accessibilityLabel="Erinnerung schliessen"
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
                    Erinnerung setzen
                  </Text>
                </View>
                <Pressable
                  accessibilityLabel="Erinnerung schliessen"
                  accessibilityRole="button"
                  disabled={savingFollowUp}
                  hitSlop={10}
                  onPress={() => setFollowUpSheetOpen(false)}
                  style={[
                    styles.selectionClose,
                    { backgroundColor: colors.primarySoft },
                  ]}
                >
                  <Ionicons color={colors.primaryText} name="close" size={22} />
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
                <Text style={[styles.followUpSheetLabel, tokenStyles.muted]}>
                  SCHNELL AUSWÄHLEN
                </Text>
                <View style={styles.followUpQuickChoices}>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => chooseFollowUpTime(oneHourFromNow())}
                    style={[
                      styles.followUpQuickChoice,
                      tokenStyles.control,
                      { borderColor: colors.primarySoftBorder },
                    ]}
                  >
                    <Text
                      style={[
                        styles.followUpQuickChoiceText,
                        tokenStyles.primaryText,
                      ]}
                    >
                      In 1 Stunde
                    </Text>
                  </Pressable>
                  {new Date().getHours() < 15 ||
                  (new Date().getHours() === 15 &&
                    new Date().getMinutes() < 30) ? (
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => chooseFollowUpTime(atTimeFromToday(0, 16))}
                      style={[
                        styles.followUpQuickChoice,
                        tokenStyles.control,
                        { borderColor: colors.primarySoftBorder },
                      ]}
                    >
                      <Text
                        style={[
                          styles.followUpQuickChoiceText,
                          tokenStyles.primaryText,
                        ]}
                      >
                        Heute 16:00
                      </Text>
                    </Pressable>
                  ) : null}
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => chooseFollowUpTime(atTimeFromToday(1, 8))}
                    style={[
                      styles.followUpQuickChoice,
                      tokenStyles.control,
                      { borderColor: colors.primarySoftBorder },
                    ]}
                  >
                    <Text
                      style={[
                        styles.followUpQuickChoiceText,
                        tokenStyles.primaryText,
                      ]}
                    >
                      Morgen 08:00
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => chooseFollowUpTime(nextMondayAtEight())}
                    style={[
                      styles.followUpQuickChoice,
                      tokenStyles.control,
                      { borderColor: colors.primarySoftBorder },
                    ]}
                  >
                    <Text
                      style={[
                        styles.followUpQuickChoiceText,
                        tokenStyles.primaryText,
                      ]}
                    >
                      Montag 08:00
                    </Text>
                  </Pressable>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded: showCustomDateTimePicker }}
                  onPress={() => {
                    setShowCustomDateTimePicker((current) => !current);
                    hapticSelection();
                  }}
                  style={[
                    styles.followUpPickerToggle,
                    tokenStyles.control,
                    { borderColor: colors.primarySoftBorder },
                  ]}
                >
                  <Text
                    style={[
                      styles.followUpPickerToggleText,
                      tokenStyles.primaryText,
                    ]}
                  >
                    Datum & Uhrzeit wählen
                  </Text>
                  <Ionicons
                    color={colors.primaryText}
                    name={
                      showCustomDateTimePicker ? "chevron-up" : "chevron-down"
                    }
                    size={18}
                  />
                </Pressable>
                {showCustomDateTimePicker ? (
                  <View
                    style={[
                      styles.followUpPicker,
                      { backgroundColor: colors.surfaceSubtle },
                    ]}
                  >
                    <DateTimePicker
                      accentColor={colors.primary}
                      display={Platform.OS === "ios" ? "inline" : "default"}
                      locale="de-CH"
                      minimumDate={new Date()}
                      minuteInterval={5}
                      mode="datetime"
                      onChange={(_event, value) => {
                        if (!value) return;
                        setFollowUpDueAt(value);
                        setFollowUpError("");
                      }}
                      themeVariant={colorScheme}
                      value={followUpDueAt}
                    />
                  </View>
                ) : null}
                <View style={styles.followUpSummary}>
                  <Ionicons
                    color={colors.primaryText}
                    name="alarm-outline"
                    size={18}
                  />
                  <Text
                    style={[styles.followUpSummaryText, tokenStyles.foreground]}
                  >
                    {followUpSummary(followUpDueAt)}
                  </Text>
                </View>
                <View style={styles.followUpNoteField}>
                  <Text style={[styles.followUpSheetLabel, tokenStyles.muted]}>
                    NOTIZ (OPTIONAL)
                  </Text>
                  <TextInput
                    autoCapitalize="sentences"
                    maxLength={500}
                    multiline
                    onChangeText={setFollowUpNote}
                    placeholder="Was möchten Sie beachten?"
                    placeholderTextColor={colors.subtle}
                    style={[
                      styles.followUpNoteInput,
                      tokenStyles.control,
                      tokenStyles.foreground,
                    ]}
                    textAlignVertical="top"
                    value={followUpNote}
                  />
                  <Text style={[styles.characterCount, tokenStyles.muted]}>
                    {Array.from(followUpNote).length}/500
                  </Text>
                </View>
                {followUpError ? (
                  <Text accessibilityRole="alert" style={styles.followUpError}>
                    {followUpError}
                  </Text>
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  disabled={savingFollowUp}
                  onPress={() => void saveTicketFollowUp()}
                  style={[
                    styles.experienceSaveButton,
                    { backgroundColor: colors.primary },
                    savingFollowUp && styles.disabled,
                  ]}
                >
                  {savingFollowUp ? (
                    <ActivityIndicator color={colors.onPrimary} size="small" />
                  ) : (
                    <Ionicons
                      color={colors.onPrimary}
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
                    {savingFollowUp
                      ? "Wird gespeichert …"
                      : editingFollowUp
                        ? "Erinnerung speichern"
                        : "Erinnerung setzen"}
                  </Text>
                </Pressable>
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </Modal>

        <Modal
          animationType="slide"
          onRequestClose={() => setResolutionSheetOpen(false)}
          transparent
          visible={
            resolutionSheetOpen &&
            !checkingFeatures &&
            Boolean(confirmedTenantId)
          }
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
                    { backgroundColor: colors.primarySoft },
                  ]}
                >
                  <Ionicons color={colors.primaryText} name="close" size={22} />
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
                              ? decision
                                ? colors.successSoft
                                : colors.errorSoft
                              : colors.surfaceSubtle,
                            borderColor: selected
                              ? decision
                                ? colors.successBorder
                                : colors.errorBorder
                              : colors.border,
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
                    placeholderTextColor={colors.subtle}
                    style={[
                      styles.resolutionInput,
                      {
                        backgroundColor: colors.surfaceSubtle,
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
                    <ActivityIndicator color={colors.onPrimary} size="small" />
                  ) : (
                    <Ionicons
                      color={colors.onPrimary}
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
          animationType="slide"
          onRequestClose={() => setReopenSheetOpen(false)}
          transparent
          visible={
            reopenSheetOpen && !checkingFeatures && Boolean(confirmedTenantId)
          }
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : "height"}
            style={styles.experienceSheetRoot}
          >
            <Pressable
              accessibilityLabel="Wiedereröffnungsantrag schliessen"
              accessibilityRole="button"
              disabled={requestingReopen}
              onPress={() => setReopenSheetOpen(false)}
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
                    GELÖSTES TICKET
                  </Text>
                  <Text
                    style={[
                      styles.experienceSheetTitle,
                      tokenStyles.foreground,
                    ]}
                  >
                    Wiedereröffnung beantragen
                  </Text>
                </View>
                <Pressable
                  accessibilityLabel="Wiedereröffnungsantrag schliessen"
                  accessibilityRole="button"
                  disabled={requestingReopen}
                  hitSlop={10}
                  onPress={() => setReopenSheetOpen(false)}
                  style={[
                    styles.selectionClose,
                    { backgroundColor: colors.primarySoft },
                  ]}
                >
                  <Ionicons color={colors.primaryText} name="close" size={22} />
                </Pressable>
              </View>
              <ScrollView
                automaticallyAdjustKeyboardInsets
                contentContainerStyle={styles.experienceSheetContent}
                keyboardDismissMode="interactive"
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                <Text
                  style={[styles.experienceSheetDescription, tokenStyles.muted]}
                >
                  Bitte erläutern Sie kurz, was weiterhin fehlt. Der Antrag
                  ändert den Ticketstatus nicht.
                </Text>
                <View style={styles.resolutionField}>
                  <Text style={[styles.cardLabel, tokenStyles.muted]}>
                    BEGRÜNDUNG
                  </Text>
                  <TextInput
                    autoCapitalize="sentences"
                    maxLength={3_000}
                    multiline
                    onChangeText={setReopenReason}
                    placeholder="Was ist noch offen?"
                    placeholderTextColor={colors.subtle}
                    style={[
                      styles.resolutionInput,
                      {
                        backgroundColor: colors.surfaceSubtle,
                        borderColor: colors.border,
                        color: colors.foreground,
                      },
                    ]}
                    textAlignVertical="top"
                    value={reopenReason}
                  />
                  <Text style={[styles.characterCount, tokenStyles.muted]}>
                    {`${Array.from(reopenReason).length}/3'000`}
                  </Text>
                </View>
                {reopenError ? (
                  <View style={[styles.feedback, tokenStyles.error]}>
                    <Ionicons
                      color={colors.error}
                      name="alert-circle-outline"
                      size={20}
                    />
                    <Text
                      style={[styles.feedbackText, { color: colors.error }]}
                    >
                      {reopenError}
                    </Text>
                  </View>
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  disabled={requestingReopen || !reopenReason.trim()}
                  onPress={() => void submitReopenRequest()}
                  style={[
                    styles.experienceSaveButton,
                    { backgroundColor: colors.primary },
                    (requestingReopen || !reopenReason.trim()) &&
                      styles.disabled,
                  ]}
                >
                  {requestingReopen ? (
                    <ActivityIndicator color={colors.onPrimary} size="small" />
                  ) : (
                    <Ionicons
                      color={colors.onPrimary}
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
                    {requestingReopen
                      ? "Antrag wird übermittelt …"
                      : "Antrag übermitteln"}
                  </Text>
                </Pressable>
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </Modal>

        <Modal
          animationType="fade"
          onRequestClose={() => setPendingReopenDecision(null)}
          transparent
          visible={
            pendingReopenDecision !== null &&
            !checkingFeatures &&
            Boolean(confirmedTenantId)
          }
        >
          <View style={styles.closeConfirmationRoot}>
            <Pressable
              accessibilityLabel="Entscheid abbrechen"
              accessibilityRole="button"
              disabled={decidingReopen}
              onPress={() => setPendingReopenDecision(null)}
              style={StyleSheet.absoluteFill}
            />
            <View
              accessibilityViewIsModal
              style={[
                styles.closeConfirmationCard,
                { backgroundColor: colors.surface },
              ]}
            >
              <View
                style={[
                  styles.closeConfirmationIcon,
                  {
                    backgroundColor:
                      pendingReopenDecision?.decision === "accepted"
                        ? colors.successSoft
                        : colors.errorSoft,
                  },
                ]}
              >
                <Ionicons
                  color={
                    pendingReopenDecision?.decision === "accepted"
                      ? colors.success
                      : colors.error
                  }
                  name={
                    pendingReopenDecision?.decision === "accepted"
                      ? "checkmark-outline"
                      : "close-outline"
                  }
                  size={24}
                />
              </View>
              <Text
                style={[styles.closeConfirmationTitle, tokenStyles.foreground]}
              >
                Antrag{" "}
                {pendingReopenDecision?.decision === "accepted"
                  ? "annehmen"
                  : "ablehnen"}
                ?
              </Text>
              <Text style={[styles.closeConfirmationText, tokenStyles.muted]}>
                Dieser Entscheid wird protokolliert. Der Ticketstatus bleibt
                unverändert und wird nicht automatisch wieder geöffnet.
              </Text>
              <Pressable
                accessibilityLabel="Entscheid verbindlich speichern"
                accessibilityRole="button"
                disabled={decidingReopen}
                onPress={() => void decidePendingReopenRequest()}
                style={[
                  styles.closeConfirmationButton,
                  {
                    backgroundColor:
                      pendingReopenDecision?.decision === "accepted"
                        ? colors.success
                        : colors.error,
                  },
                  decidingReopen && styles.disabled,
                ]}
              >
                {decidingReopen ? (
                  <ActivityIndicator color={colors.onPrimary} size="small" />
                ) : null}
                <Text style={styles.closeConfirmationButtonText}>
                  {decidingReopen
                    ? "Entscheid wird gespeichert …"
                    : "Entscheid speichern"}
                </Text>
              </Pressable>
              <Pressable
                accessibilityLabel="Entscheid abbrechen"
                accessibilityRole="button"
                disabled={decidingReopen}
                onPress={() => setPendingReopenDecision(null)}
                style={styles.closeConfirmationCancel}
              >
                <Text
                  style={[
                    styles.closeConfirmationCancelText,
                    { color: colors.primaryText },
                  ]}
                >
                  Abbrechen
                </Text>
              </Pressable>
            </View>
          </View>
        </Modal>

        <Modal
          animationType="slide"
          onRequestClose={() => setSelection(null)}
          transparent
          visible={
            selection !== null &&
            !checkingFeatures &&
            Boolean(confirmedTenantId)
          }
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
                  <Ionicons color={colors.primaryText} name="close" size={22} />
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
                        <Ionicons
                          color={colors.primaryText}
                          name="checkmark"
                          size={21}
                        />
                      ) : (
                        <Ionicons
                          color={colors.subtle}
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
          animationType="slide"
          onRequestClose={() => setCategorySheetOpen(false)}
          transparent
          visible={
            categorySheetOpen && !checkingFeatures && Boolean(confirmedTenantId)
          }
        >
          <View style={styles.selectionModalRoot}>
            <Pressable
              accessibilityLabel="Kategorieauswahl schliessen"
              accessibilityRole="button"
              disabled={savingCategory}
              onPress={() => setCategorySheetOpen(false)}
              style={StyleSheet.absoluteFill}
            />
            <View style={styles.selectionSheet}>
              <View style={styles.selectionHeader}>
                <View style={styles.categorySelectionHeading}>
                  {categorySelectionStep === "subcategory" ? (
                    <Pressable
                      accessibilityLabel="Zurück zur Kategorieauswahl"
                      accessibilityRole="button"
                      disabled={savingCategory}
                      hitSlop={8}
                      onPress={() => {
                        setCategorySelectionStep("category");
                        setCategoryError("");
                        hapticSelection();
                      }}
                      style={styles.categorySelectionBack}
                    >
                      <Ionicons
                        color={colors.primaryText}
                        name="arrow-back"
                        size={18}
                      />
                    </Pressable>
                  ) : null}
                  <View>
                    <Text style={styles.selectionEyebrow}>
                      TICKET BEARBEITEN
                    </Text>
                    <Text style={styles.selectionTitle}>
                      {categorySelectionStep === "category"
                        ? "Kategorie wählen"
                        : "Unterkategorie wählen"}
                    </Text>
                  </View>
                </View>
                <Pressable
                  accessibilityLabel="Kategorieauswahl schliessen"
                  accessibilityRole="button"
                  disabled={savingCategory}
                  onPress={() => setCategorySheetOpen(false)}
                  style={styles.selectionClose}
                >
                  <Ionicons color={colors.primaryText} name="close" size={22} />
                </Pressable>
              </View>
              <ScrollView
                contentContainerStyle={styles.selectionOptions}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                {categorySelectionStep === "category" ? (
                  <>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{
                        selected: ticket.categoryId === null,
                      }}
                      disabled={savingCategory}
                      onPress={() => {
                        hapticSelection();
                        void saveCategorySelection(null, null);
                      }}
                      style={[
                        styles.selectionOption,
                        ticket.categoryId === null &&
                          styles.selectionOptionActive,
                      ]}
                    >
                      <View style={styles.categoryOptionCopy}>
                        <Text
                          style={[
                            styles.selectionOptionText,
                            ticket.categoryId === null &&
                              styles.selectionOptionTextActive,
                          ]}
                        >
                          Keine Kategorie
                        </Text>
                        <Text style={styles.categoryOptionHint}>
                          Kategorie und Unterkategorie entfernen
                        </Text>
                      </View>
                      <Ionicons
                        color={
                          ticket.categoryId === null
                            ? colors.primaryText
                            : colors.subtle
                        }
                        name={
                          ticket.categoryId === null ? "checkmark" : "close"
                        }
                        size={ticket.categoryId === null ? 21 : 19}
                      />
                    </Pressable>
                    {rootCategories.map((category) => {
                      const hasSubcategories = ticket.categoryOptions.some(
                        (option) => option.parentId === category.id,
                      );
                      const selected = ticket.categoryId === category.id;
                      return (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityState={{ selected }}
                          disabled={savingCategory}
                          key={category.id}
                          onPress={() => {
                            hapticSelection();
                            if (hasSubcategories) {
                              setCategoryDraftId(category.id);
                              setCategorySelectionStep("subcategory");
                              setCategoryError("");
                              return;
                            }
                            void saveCategorySelection(category.id, null);
                          }}
                          style={[
                            styles.selectionOption,
                            selected && styles.selectionOptionActive,
                          ]}
                        >
                          <View style={styles.categoryOptionCopy}>
                            <Text
                              style={[
                                styles.selectionOptionText,
                                selected && styles.selectionOptionTextActive,
                              ]}
                            >
                              {category.name}
                            </Text>
                            <Text style={styles.categoryOptionHint}>
                              {hasSubcategories
                                ? "Unterkategorie auswählen"
                                : "Direkt übernehmen"}
                            </Text>
                          </View>
                          <Ionicons
                            color={
                              selected ? colors.primaryText : colors.subtle
                            }
                            name={
                              hasSubcategories
                                ? "chevron-forward"
                                : selected
                                  ? "checkmark"
                                  : "chevron-forward"
                            }
                            size={selected && !hasSubcategories ? 21 : 19}
                          />
                        </Pressable>
                      );
                    })}
                    {rootCategories.length === 0 ? (
                      <Text style={styles.categoryEmptyText}>
                        Für diese Ticketabteilung sind noch keine Kategorien
                        hinterlegt.
                      </Text>
                    ) : null}
                  </>
                ) : (
                  <>
                    <Text style={styles.categoryPickerContext}>
                      {draftCategory?.name ?? "Kategorie"}
                    </Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{
                        selected:
                          ticket.categoryId === draftCategory?.id &&
                          ticket.subcategoryId === null,
                      }}
                      disabled={savingCategory || !draftCategory}
                      onPress={() => {
                        hapticSelection();
                        if (draftCategory) {
                          void saveCategorySelection(draftCategory.id, null);
                        }
                      }}
                      style={[
                        styles.selectionOption,
                        ticket.categoryId === draftCategory?.id &&
                          ticket.subcategoryId === null &&
                          styles.selectionOptionActive,
                      ]}
                    >
                      <View style={styles.categoryOptionCopy}>
                        <Text style={styles.selectionOptionText}>
                          Nur {draftCategory?.name ?? "diese Kategorie"}
                        </Text>
                        <Text style={styles.categoryOptionHint}>
                          Ohne Unterkategorie übernehmen
                        </Text>
                      </View>
                      <Ionicons
                        color={colors.subtle}
                        name="chevron-forward"
                        size={19}
                      />
                    </Pressable>
                    {draftSubcategories.map((subcategory) => {
                      const selected = ticket.subcategoryId === subcategory.id;
                      return (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityState={{ selected }}
                          disabled={savingCategory || !draftCategory}
                          key={subcategory.id}
                          onPress={() => {
                            hapticSelection();
                            if (draftCategory) {
                              void saveCategorySelection(
                                draftCategory.id,
                                subcategory.id,
                              );
                            }
                          }}
                          style={[
                            styles.selectionOption,
                            selected && styles.selectionOptionActive,
                          ]}
                        >
                          <View style={styles.categoryOptionCopy}>
                            <Text
                              style={[
                                styles.selectionOptionText,
                                selected && styles.selectionOptionTextActive,
                              ]}
                            >
                              {subcategory.name}
                            </Text>
                            <Text style={styles.categoryOptionHint}>
                              {draftCategory?.name}
                            </Text>
                          </View>
                          <Ionicons
                            color={
                              selected ? colors.primaryText : colors.subtle
                            }
                            name={selected ? "checkmark" : "chevron-forward"}
                            size={selected ? 21 : 19}
                          />
                        </Pressable>
                      );
                    })}
                  </>
                )}
                {categoryError ? (
                  <Text accessibilityRole="alert" style={styles.categoryError}>
                    {categoryError}
                  </Text>
                ) : null}
              </ScrollView>
            </View>
          </View>
        </Modal>

        <Modal
          animationType="slide"
          onRequestClose={() => setAgentPickerOpen(false)}
          transparent
          visible={
            agentPickerOpen && !checkingFeatures && Boolean(confirmedTenantId)
          }
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : "height"}
            style={styles.selectionModalRoot}
          >
            <Pressable
              accessibilityLabel="Agentenauswahl schliessen"
              accessibilityRole="button"
              onPress={() => setAgentPickerOpen(false)}
              style={StyleSheet.absoluteFill}
            />
            <View style={styles.selectionSheet}>
              <View style={styles.selectionHeader}>
                <View>
                  <Text style={styles.selectionEyebrow}>ZUSTÄNDIGKEIT</Text>
                  <Text style={styles.selectionTitle}>Agenten auswählen</Text>
                </View>
                <Pressable
                  accessibilityLabel="Agentenauswahl schliessen"
                  accessibilityRole="button"
                  onPress={() => setAgentPickerOpen(false)}
                  style={styles.selectionClose}
                >
                  <Ionicons color={colors.primaryText} name="close" size={22} />
                </Pressable>
              </View>
              <View style={styles.agentPickerSearch}>
                <Ionicons
                  color={colors.muted}
                  name="search-outline"
                  size={18}
                />
                <TextInput
                  accessibilityLabel="Agenten durchsuchen"
                  autoCapitalize="none"
                  autoCorrect={false}
                  onChangeText={setAgentPickerQuery}
                  placeholder="Agenten durchsuchen"
                  placeholderTextColor={colors.subtle}
                  style={styles.agentPickerSearchInput}
                  value={agentPickerQuery}
                />
              </View>
              {assignableAgentsError ? (
                <View style={[styles.agentPickerError, tokenStyles.error]}>
                  <Ionicons
                    color={colors.error}
                    name="alert-circle-outline"
                    size={18}
                  />
                  <View style={styles.suggestionCopy}>
                    <Text style={styles.agentPickerErrorText}>
                      {assignableAgentsError}
                    </Text>
                    <Pressable
                      accessibilityLabel="Agentenliste erneut laden"
                      accessibilityRole="button"
                      onPress={() => void loadAllAssignableAgents()}
                    >
                      <Text style={styles.agentPickerRetry}>Erneut laden</Text>
                    </Pressable>
                  </View>
                </View>
              ) : assignableAgentsLoading ? (
                <View style={styles.inlineLoading}>
                  <ActivityIndicator color={colors.primaryText} size="small" />
                  <Text style={[styles.timelineText, tokenStyles.muted]}>
                    Berechtigte Agenten werden geladen …
                  </Text>
                </View>
              ) : (
                <ScrollView
                  contentContainerStyle={styles.selectionOptions}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                >
                  {filteredAssignableAgents.length ? (
                    filteredAssignableAgents.map((agent) => {
                      const displayName = agent.displayName?.trim() || "Agent";
                      return (
                        <Pressable
                          accessibilityLabel={
                            agent.isCurrentAssignee
                              ? `${displayName} ist bereits zugewiesen`
                              : `${displayName} auswählen`
                          }
                          accessibilityRole="button"
                          accessibilityState={{
                            disabled: agent.isCurrentAssignee || assigningAgent,
                          }}
                          disabled={agent.isCurrentAssignee || assigningAgent}
                          key={agent.userId}
                          onPress={() => {
                            setPendingAgentAssignment(null);
                            setManualAgentAssignmentError("");
                            setAgentPickerOpen(false);
                            setManualAgentAssignment(agent);
                            hapticSelection();
                          }}
                          style={({ pressed }) => [
                            styles.selectionOption,
                            (agent.isCurrentAssignee || assigningAgent) &&
                              styles.disabled,
                            pressed && styles.pressed,
                          ]}
                        >
                          <View style={styles.agentPickerOptionCopy}>
                            <Text style={styles.selectionOptionText}>
                              {displayName}
                            </Text>
                            <Text style={styles.agentPickerOptionText}>
                              {agent.isCurrentAssignee
                                ? "Bereits diesem Ticket zugewiesen"
                                : "Berechtigter Agent"}
                            </Text>
                          </View>
                          {agent.isCurrentAssignee ? (
                            <View style={styles.assignedBadge}>
                              <Text style={styles.assignedBadgeText}>
                                Zugewiesen
                              </Text>
                            </View>
                          ) : (
                            <Ionicons
                              color={colors.primaryText}
                              name="chevron-forward"
                              size={19}
                            />
                          )}
                        </Pressable>
                      );
                    })
                  ) : (
                    <Text style={[styles.timelineText, tokenStyles.muted]}>
                      Keine passenden berechtigten Agenten gefunden.
                    </Text>
                  )}
                </ScrollView>
              )}
            </View>
          </KeyboardAvoidingView>
        </Modal>

        <Modal
          animationType="fade"
          onRequestClose={() => {
            setManualAgentAssignment(null);
            setManualAgentAssignmentError("");
          }}
          transparent
          visible={
            manualAgentAssignment !== null &&
            !checkingFeatures &&
            Boolean(confirmedTenantId)
          }
        >
          <View style={styles.closeConfirmationRoot}>
            <Pressable
              accessibilityLabel="Zuweisung abbrechen"
              accessibilityRole="button"
              disabled={assigningAgent}
              onPress={() => {
                setManualAgentAssignment(null);
                setManualAgentAssignmentError("");
              }}
              style={StyleSheet.absoluteFill}
            />
            <View accessibilityViewIsModal style={styles.closeConfirmationCard}>
              <View style={styles.closeConfirmationIcon}>
                <Ionicons
                  color={colors.primaryText}
                  name="people-outline"
                  size={22}
                />
              </View>
              <Text style={styles.closeConfirmationTitle}>
                Agenten zuweisen?
              </Text>
              <Text style={styles.closeConfirmationText}>
                {manualAgentAssignment?.displayName?.trim() || "Dieser Agent"}{" "}
                wird diesem Ticket zugewiesen. Die Berechtigung wird beim
                Speichern erneut auf dem Server geprüft.
              </Text>
              {manualAgentAssignmentError ? (
                <View style={[styles.manualAssignmentError, tokenStyles.error]}>
                  <Ionicons
                    color={colors.error}
                    name="alert-circle-outline"
                    size={18}
                  />
                  <Text style={styles.agentPickerErrorText}>
                    {manualAgentAssignmentError}
                  </Text>
                </View>
              ) : null}
              <Pressable
                accessibilityLabel="Agentenzuweisung bestätigen"
                accessibilityRole="button"
                disabled={assigningAgent}
                onPress={() => void confirmAgentAssignment()}
                style={[
                  styles.closeConfirmationButton,
                  assigningAgent && styles.disabled,
                ]}
              >
                {assigningAgent ? (
                  <ActivityIndicator color={colors.onPrimary} size="small" />
                ) : null}
                <Text style={styles.closeConfirmationButtonText}>
                  {assigningAgent ? "Zuweisung wird gespeichert …" : "Zuweisen"}
                </Text>
              </Pressable>
              <Pressable
                accessibilityLabel="Zuweisung abbrechen"
                accessibilityRole="button"
                disabled={assigningAgent}
                onPress={() => {
                  setManualAgentAssignment(null);
                  setManualAgentAssignmentError("");
                }}
                style={styles.closeConfirmationCancel}
              >
                <Text
                  style={[
                    styles.closeConfirmationCancelText,
                    { color: colors.primaryText },
                  ]}
                >
                  Abbrechen
                </Text>
              </Pressable>
            </View>
          </View>
        </Modal>

        <Modal
          animationType="fade"
          onRequestClose={() => setPendingCloseStatus(null)}
          transparent
          visible={
            pendingCloseStatus !== null &&
            !checkingFeatures &&
            Boolean(confirmedTenantId)
          }
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
                  color={colors.warning}
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

const useStyles = makeThemedStyles((c) => ({
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
    backgroundColor: c.primarySoft,
    borderRadius: 18,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  editButton: {
    alignItems: "center",
    backgroundColor: c.primarySoft,
    borderRadius: 14,
    flexDirection: "row",
    gap: 5,
    height: 40,
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  editButtonText: { color: c.primaryText, fontSize: 12, fontWeight: "800" },
  topTitle: { color: c.foreground, fontSize: 17, fontWeight: "800" },
  favoriteButton: {
    alignItems: "center",
    backgroundColor: c.primarySoft,
    borderRadius: 18,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  favoriteButtonActive: { backgroundColor: c.primary },
  ticketHead: { gap: 8, paddingTop: 8 },
  ticketId: {
    color: c.muted,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.8,
  },
  title: {
    color: c.foreground,
    fontSize: 27,
    fontWeight: "800",
    letterSpacing: -0.5,
    lineHeight: 33,
  },
  titleInput: {
    backgroundColor: c.surface,
    borderColor: c.primaryText,
    borderRadius: 13,
    borderWidth: 1,
    color: c.foreground,
    fontSize: 22,
    fontWeight: "800",
    lineHeight: 29,
    padding: 11,
  },
  inlineEdit: { gap: 9 },
  inlineSave: {
    alignItems: "center",
    alignSelf: "flex-end",
    backgroundColor: c.primary,
    borderRadius: 12,
    justifyContent: "center",
    minHeight: 38,
    minWidth: 42,
    paddingHorizontal: 13,
  },
  inlineSaveText: { color: c.onPrimary, fontSize: 13, fontWeight: "800" },
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
  statusOpen: { backgroundColor: c.infoSoft },
  statusResolved: { backgroundColor: c.successSoft },
  statusTextOpen: { color: c.info },
  statusTextResolved: { color: c.success },
  card: {
    backgroundColor: c.surface,
    borderColor: c.border,
    borderRadius: 20,
    borderWidth: 1,
    gap: 7,
    padding: 17,
  },
  detailsCard: {
    backgroundColor: c.surface,
    borderColor: c.border,
    borderRadius: 18,
    borderWidth: 1,
    gap: 0,
  },
  detailsTitle: { fontSize: 16, fontWeight: "800", marginBottom: 5 },
  detailsRequester: { gap: 4, paddingVertical: 2 },
  requesterPressable: { gap: 3, justifyContent: "center", minHeight: 44 },
  requesterName: { color: c.foreground, fontSize: 15, fontWeight: "800" },
  requesterMeta: { color: c.muted, fontSize: 13, lineHeight: 18 },
  detailsDivider: { backgroundColor: c.border, height: 1, marginVertical: 5 },
  detailsValueRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 44,
  },
  detailsValueCopy: { flex: 1, paddingRight: 12 },
  detailsValue: { color: c.foreground, fontSize: 14, fontWeight: "700" },
  detailsActionRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 44,
  },
  detailsActionLead: { alignItems: "center", flexDirection: "row", gap: 7 },
  detailsActionLabel: { color: c.foreground, fontSize: 14, fontWeight: "700" },
  detailsActionLink: { color: c.primaryText, fontSize: 13, fontWeight: "800" },
  detailsAccordionRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 44,
  },
  detailsSummary: {
    color: c.muted,
    flexShrink: 1,
    fontSize: 12,
    maxWidth: 155,
    textAlign: "right",
  },
  detailsCountBadge: {
    alignItems: "center",
    backgroundColor: c.warningSoft,
    borderColor: c.warningBorder,
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 24,
    minWidth: 24,
    paddingHorizontal: 8,
  },
  detailsCountBadgeText: { color: c.warning, fontSize: 11, fontWeight: "800" },
  detailsExpansion: { gap: 9, paddingBottom: 4, paddingTop: 8 },
  followUpAction: {
    alignItems: "center",
    borderColor: c.primarySoftBorder,
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 30,
    paddingHorizontal: 7,
  },
  followUpActions: { flexDirection: "row", gap: 5 },
  followUpCopy: { flex: 1, gap: 2, minWidth: 0 },
  followUpDoneText: { color: c.success, fontSize: 10, fontWeight: "800" },
  followUpEditText: { color: c.primaryText, fontSize: 10, fontWeight: "800" },
  followUpError: { color: c.error, fontSize: 12, lineHeight: 17 },
  followUpList: {
    borderTopColor: c.border,
    borderTopWidth: 1,
    gap: 8,
    paddingTop: 9,
  },
  followUpNote: { color: c.muted, fontSize: 11, lineHeight: 16 },
  followUpNoteField: { gap: 6 },
  followUpNoteInput: {
    borderRadius: 12,
    borderWidth: 1,
    color: c.foreground,
    fontSize: 14,
    lineHeight: 20,
    minHeight: 82,
    padding: 11,
  },
  followUpOverdue: { color: c.error },
  followUpPicker: { borderRadius: 14, overflow: "hidden" },
  followUpPickerToggle: {
    alignItems: "center",
    borderRadius: 13,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 48,
    paddingHorizontal: 13,
  },
  followUpPickerToggleText: { fontSize: 14, fontWeight: "800" },
  followUpQuickChoice: {
    alignItems: "center",
    borderRadius: 11,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 39,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  followUpQuickChoices: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  followUpQuickChoiceText: { fontSize: 12, fontWeight: "800" },
  followUpRow: { alignItems: "center", flexDirection: "row", gap: 8 },
  followUpSheetLabel: {
    color: c.muted,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.8,
  },
  followUpSummary: {
    alignItems: "center",
    backgroundColor: c.primarySoft,
    borderRadius: 12,
    flexDirection: "row",
    gap: 8,
    padding: 11,
  },
  followUpSummaryText: {
    color: c.foreground,
    flex: 1,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 18,
  },
  followUpTitle: {
    color: c.foreground,
    fontSize: 11,
    fontWeight: "800",
    lineHeight: 16,
  },
  experienceCard: {
    backgroundColor: c.surface,
    borderColor: c.border,
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
  inlineLoading: { alignItems: "center", flexDirection: "row", gap: 9 },
  timelineList: { gap: 11 },
  timelineItem: { alignItems: "flex-start", flexDirection: "row", gap: 10 },
  timelineIcon: {
    alignItems: "center",
    borderRadius: 12,
    height: 30,
    justifyContent: "center",
    width: 30,
  },
  timelineCopy: { flex: 1, gap: 2 },
  timelineTitle: {
    fontSize: 13,
    fontWeight: "800",
    textTransform: "capitalize",
  },
  timelineText: { fontSize: 12, lineHeight: 18 },
  timelineDate: { fontSize: 10, lineHeight: 15 },
  contextSummary: {
    borderTopWidth: 1,
    gap: 8,
    paddingTop: 11,
  },
  contextReference: { fontSize: 13, fontWeight: "800" },
  contextSummaryRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  contextSummaryValue: { fontSize: 13, fontWeight: "800" },
  suggestionList: { gap: 8 },
  suggestion: { borderRadius: 13, borderWidth: 1, gap: 7, padding: 10 },
  suggestionHeader: { alignItems: "center", flexDirection: "row", gap: 8 },
  suggestionCopy: { flex: 1, gap: 2 },
  suggestionUser: { fontSize: 13, fontWeight: "800" },
  assignedBadge: {
    alignItems: "center",
    backgroundColor: c.successSoft,
    borderColor: c.successBorder,
    borderRadius: 9,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 32,
    paddingHorizontal: 8,
  },
  assignedBadgeText: { color: c.success, fontSize: 11, fontWeight: "800" },
  assignButton: {
    alignItems: "center",
    backgroundColor: c.primarySoft,
    borderColor: c.primarySoftBorder,
    borderRadius: 10,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 10,
  },
  assignButtonText: { color: c.primaryText, fontSize: 12, fontWeight: "800" },
  assignmentConfirmation: {
    backgroundColor: c.primarySoft,
    borderColor: c.primarySoftBorder,
    borderRadius: 10,
    borderWidth: 1,
    gap: 7,
    padding: 9,
  },
  assignmentConfirmationText: {
    color: c.foreground,
    fontSize: 13,
    fontWeight: "700",
  },
  assignmentActions: { flexDirection: "row", gap: 8 },
  assignmentConfirmButton: {
    alignItems: "center",
    backgroundColor: c.primary,
    borderRadius: 9,
    flex: 1,
    flexDirection: "row",
    gap: 6,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 10,
  },
  assignmentConfirmText: {
    color: c.onPrimary,
    fontSize: 12,
    fontWeight: "800",
  },
  assignmentCancelButton: {
    alignItems: "center",
    borderColor: c.primarySoftBorder,
    borderRadius: 9,
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 10,
  },
  assignmentCancelText: {
    color: c.primaryText,
    fontSize: 12,
    fontWeight: "800",
  },
  assignmentFootnote: { color: c.muted, fontSize: 11, lineHeight: 16 },
  manualAssigneeButton: {
    alignItems: "center",
    backgroundColor: c.primarySoft,
    borderColor: c.primarySoftBorder,
    borderRadius: 13,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 54,
    paddingHorizontal: 12,
  },
  manualAssigneeCopy: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: 9,
  },
  manualAssigneeTitle: {
    color: c.primaryText,
    fontSize: 13,
    fontWeight: "800",
  },
  manualAssigneeText: { color: c.muted, fontSize: 11, lineHeight: 16 },
  pressed: { opacity: 0.76 },
  reopenRequestList: { gap: 9 },
  reopenRequest: { borderRadius: 13, borderWidth: 1, gap: 8, padding: 11 },
  decisionActions: { flexDirection: "row", gap: 8 },
  decisionButton: {
    alignItems: "center",
    borderRadius: 11,
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    minHeight: 44,
  },
  decisionAcceptText: { color: c.success, fontWeight: "800" },
  decisionDeclineText: { color: c.error, fontWeight: "800" },
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
  cardLabel: {
    color: c.muted,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.9,
    marginTop: 2,
  },
  contactAction: {
    alignItems: "center",
    flexDirection: "row",
    gap: 5,
    marginTop: 7,
  },
  contactActionText: {
    color: c.info,
    flex: 1,
    fontSize: 11,
    fontWeight: "700",
  },
  description: { color: c.text, fontSize: 15, lineHeight: 23 },
  descriptionInput: {
    backgroundColor: c.surfaceSubtle,
    borderColor: c.primaryText,
    borderRadius: 13,
    borderWidth: 1,
    color: c.foreground,
    fontSize: 15,
    lineHeight: 23,
    minHeight: 145,
    padding: 12,
  },
  editorCard: {
    backgroundColor: c.surface,
    borderColor: c.borderStrong,
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
  editorCopy: { color: c.muted, fontSize: 12, lineHeight: 18, marginTop: 3 },
  editorIcon: {
    alignItems: "center",
    backgroundColor: c.primarySoft,
    borderRadius: 15,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  editorField: { gap: 7 },
  missingRequester: { color: c.muted, fontSize: 13, lineHeight: 19 },
  selector: {
    alignItems: "center",
    backgroundColor: c.surfaceSubtle,
    borderColor: c.border,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 58,
    paddingHorizontal: 14,
  },
  selectorValue: { color: c.foreground, fontSize: 15, fontWeight: "800" },
  selectorHint: { color: c.muted, fontSize: 11, marginTop: 2 },
  editTitle: { color: c.foreground, fontSize: 18, fontWeight: "800" },
  fieldLabel: {
    color: c.muted,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.9,
    marginTop: 3,
  },
  optionWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  option: {
    backgroundColor: c.surfaceSubtle,
    borderColor: c.border,
    borderRadius: 13,
    borderWidth: 1,
    minHeight: 39,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  optionActive: { backgroundColor: c.primary, borderColor: c.primary },
  optionText: { color: c.text, fontSize: 13, fontWeight: "800" },
  optionTextActive: { color: c.onPrimary },
  primaryButton: {
    alignItems: "center",
    backgroundColor: c.primary,
    borderRadius: 16,
    flexDirection: "row",
    gap: 9,
    justifyContent: "center",
    marginTop: 5,
    minHeight: 52,
    paddingHorizontal: 16,
  },
  primaryButtonText: { color: c.onPrimary, fontSize: 15, fontWeight: "800" },
  secondaryButton: {
    backgroundColor: c.primarySoft,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  secondaryButtonText: { color: c.primaryText, fontWeight: "800" },
  hint: { color: c.muted, fontSize: 12, lineHeight: 18, textAlign: "center" },
  copy: { color: c.muted, fontSize: 15 },
  emptyTitle: {
    color: c.foreground,
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
  error: { color: c.error, fontSize: 13, lineHeight: 19 },
  experienceSheetRoot: {
    backgroundColor: c.overlay,
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
    backgroundColor: c.overlay,
    flex: 1,
    justifyContent: "flex-end",
  },
  selectionSheet: {
    backgroundColor: c.surface,
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
  categorySelectionHeading: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: 10,
    paddingRight: 12,
  },
  categorySelectionBack: {
    alignItems: "center",
    backgroundColor: c.primarySoft,
    borderRadius: 14,
    height: 32,
    justifyContent: "center",
    width: 32,
  },
  selectionEyebrow: {
    color: c.muted,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.9,
  },
  selectionTitle: {
    color: c.foreground,
    fontSize: 21,
    fontWeight: "800",
    marginTop: 3,
  },
  selectionClose: {
    alignItems: "center",
    backgroundColor: c.primarySoft,
    borderRadius: 16,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  selectionOptions: { gap: 8, paddingBottom: 4 },
  categoryOptionCopy: { flex: 1, gap: 2, paddingRight: 8 },
  categoryOptionHint: { color: c.muted, fontSize: 11, lineHeight: 16 },
  categoryPickerContext: {
    color: c.primaryText,
    fontSize: 13,
    fontWeight: "800",
    paddingBottom: 3,
  },
  categoryEmptyText: {
    color: c.muted,
    fontSize: 13,
    lineHeight: 19,
    paddingHorizontal: 4,
    paddingVertical: 12,
    textAlign: "center",
  },
  categoryError: {
    color: c.error,
    fontSize: 13,
    lineHeight: 19,
    paddingHorizontal: 4,
    paddingTop: 4,
  },
  agentPickerSearch: {
    alignItems: "center",
    backgroundColor: c.surfaceSubtle,
    borderColor: c.border,
    borderRadius: 13,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    minHeight: 46,
    paddingHorizontal: 12,
  },
  agentPickerSearchInput: {
    color: c.foreground,
    flex: 1,
    fontSize: 15,
    paddingVertical: 10,
  },
  agentPickerError: {
    alignItems: "flex-start",
    borderRadius: 13,
    borderWidth: 1,
    flexDirection: "row",
    gap: 9,
    padding: 12,
  },
  agentPickerErrorText: { color: c.error, fontSize: 12, lineHeight: 17 },
  agentPickerRetry: { color: c.primaryText, fontSize: 12, fontWeight: "800" },
  selectionOption: {
    alignItems: "center",
    backgroundColor: c.surface,
    borderColor: c.border,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 54,
    paddingHorizontal: 14,
  },
  agentPickerOptionCopy: { flex: 1, gap: 2, paddingRight: 8 },
  agentPickerOptionText: { color: c.muted, fontSize: 11, lineHeight: 16 },
  manualAssignmentError: {
    alignItems: "flex-start",
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    gap: 9,
    padding: 11,
  },
  selectionOptionActive: {
    backgroundColor: c.primarySoft,
    borderColor: c.primaryText,
  },
  selectionOptionText: { color: c.text, fontSize: 15, fontWeight: "800" },
  selectionOptionTextActive: { color: c.primaryText },
  closeConfirmationRoot: {
    alignItems: "center",
    backgroundColor: c.overlay,
    flex: 1,
    justifyContent: "center",
    padding: 24,
  },
  closeConfirmationCard: {
    alignItems: "stretch",
    backgroundColor: c.surface,
    borderRadius: 24,
    gap: 13,
    maxWidth: 420,
    padding: 22,
    width: "100%",
  },
  closeConfirmationIcon: {
    alignItems: "center",
    backgroundColor: c.warningSoft,
    borderRadius: 17,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  closeConfirmationTitle: {
    color: c.foreground,
    fontSize: 21,
    fontWeight: "900",
  },
  closeConfirmationText: { color: c.muted, fontSize: 14, lineHeight: 21 },
  closeConfirmationButton: {
    alignItems: "center",
    backgroundColor: c.warningStrong,
    borderRadius: 14,
    justifyContent: "center",
    marginTop: 5,
    minHeight: 50,
    paddingHorizontal: 16,
  },
  closeConfirmationButtonText: {
    color: c.onWarningStrong,
    fontSize: 14,
    fontWeight: "900",
  },
  closeConfirmationCancel: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 40,
  },
  closeConfirmationCancelText: {
    color: c.primaryText,
    fontSize: 13,
    fontWeight: "800",
  },
}));
