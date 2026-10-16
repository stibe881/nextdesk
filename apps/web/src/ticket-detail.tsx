import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  AlertCircle,
  Circle,
  CircleCheck,
  Clock3,
  Eye,
  EyeOff,
  LoaderCircle,
  MessageSquare,
  RefreshCw,
  Save,
  Send,
  X,
} from "lucide-react";
import { supabase } from "./lib/supabase";

type CommentVisibility = "external" | "internal";
type BillingKind = "internal" | "billable" | "goodwill";
type RelationType =
  "duplicates" | "blocks" | "blocked_by" | "relates_to" | "parent" | "child";
type DisplayRelationType = RelationType | "merged_into" | "merged_from";
type PendingAction =
  | "comment"
  | "update"
  | "watch"
  | "escalation-open"
  | "escalation-resolve"
  | "checklist-add"
  | "checklist-toggle"
  | "time-entry"
  | "relation-create"
  | "relation-delete"
  | "merge"
  | null;

type GetTicketAction = {
  type: "getTicket";
  tenantId: string;
  ticketId: string;
};

type EscalationKind = "technical" | "organizational" | "sla";

type OpenEscalationAction = {
  type: "openEscalation";
  tenantId: string;
  ticketId: string;
  kind: EscalationKind;
  reason: string;
};

type ResolveEscalationAction = {
  type: "resolveEscalation";
  tenantId: string;
  ticketId: string;
  escalationId: string;
};

type CreateRelationAction = {
  type: "createRelation";
  tenantId: string;
  ticketId: string;
  relatedTicketId: string;
  relationType: RelationType;
};

type DeleteRelationAction = {
  type: "deleteRelation";
  tenantId: string;
  ticketId: string;
  relatedTicketId: string;
  relationType: RelationType;
};

type MarkMergedAction = {
  type: "markMerged";
  tenantId: string;
  ticketId: string;
  primaryTicketId: string;
};

type UpdateTicketAction = {
  type: "updateTicket";
  tenantId: string;
  ticketId: string;
  statusKey?: string;
  priorityKey?: string;
  assignedTeamId?: string | null;
};

type AddCommentAction = {
  type: "addComment";
  tenantId: string;
  ticketId: string;
  body: string;
  visibility: CommentVisibility;
};

type ToggleWatchAction = {
  type: "toggleWatch";
  tenantId: string;
  ticketId: string;
  watching: boolean;
};

type AddChecklistItemAction = {
  type: "addChecklistItem";
  tenantId: string;
  ticketId: string;
  description: string;
};

type ToggleChecklistItemAction = {
  type: "toggleChecklistItem";
  tenantId: string;
  ticketId: string;
  itemId: string;
  completed: boolean;
};

type AddTimeEntryAction = {
  type: "addTimeEntry";
  tenantId: string;
  ticketId: string;
  minutes: number;
  billingKind: BillingKind;
  note?: string;
  startedAt?: string;
};

type TicketOperation =
  | GetTicketAction
  | OpenEscalationAction
  | ResolveEscalationAction
  | CreateRelationAction
  | DeleteRelationAction
  | MarkMergedAction
  | UpdateTicketAction
  | AddCommentAction
  | ToggleWatchAction
  | AddChecklistItemAction
  | ToggleChecklistItemAction
  | AddTimeEntryAction;

type TicketRecord = {
  id: string;
  ticket_number: string;
  subject: string;
  description: string;
  status_id: string;
  priority_id: string;
  assigned_team_id: string | null;
  created_at: string;
};

type TicketComment = {
  id: string;
  authorName: string;
  body: string;
  created_at: string;
  visibility: CommentVisibility;
};

type TicketEvent = {
  id: string;
  event_type: string;
  created_at: string;
};

type TicketEscalation = {
  id: string;
  ticket_id: string;
  level: number;
  kind: EscalationKind;
  reason: string;
  opened_by: string;
  resolved_by: string | null;
  opened_at: string;
  resolved_at: string | null;
};

type TicketStatus = {
  id: string;
  key: string;
  label: string;
  is_closed: boolean;
};

type TicketPriority = {
  id: string;
  key: string;
  label: string;
};

type TicketTeam = {
  id: string;
  name: string;
};

type TicketChecklistItem = {
  id: string;
  description: string;
  position: number;
  completed_at: string | null;
};

type TicketTimeEntry = {
  id: string;
  author_id: string;
  minutes: number;
  billing_kind: BillingKind;
  note: string | null;
  started_at: string | null;
  created_at: string;
};

type TicketRelation = {
  id?: string;
  relatedTicketId: string;
  ticketNumber: string;
  subject: string;
  statusLabel: string;
  relationType: DisplayRelationType;
};

type SimilarTicket = {
  id: string;
  ticketNumber: string;
  subject: string;
  statusLabel: string;
};

type TicketDetailData = {
  ticket: TicketRecord;
  comments: TicketComment[];
  events: TicketEvent[];
  escalations: TicketEscalation[];
  statuses: TicketStatus[];
  priorities: TicketPriority[];
  teams: TicketTeam[];
  checklistItems: TicketChecklistItem[];
  timeEntries: TicketTimeEntry[];
  relations: TicketRelation[];
  similarTickets: SimilarTicket[];
  watching: boolean;
  canUpdate: boolean;
  /** Bei älteren Edge-Function-Deployments nicht vorhanden; kein Fallback auf canUpdate. */
  canEscalate?: boolean;
  canUseInternalNotes: boolean;
  canTrackTime: boolean;
};

type TicketDetailProps = {
  tenantId: string;
  ticketId: string;
  onClose: () => void;
  onChanged: () => void;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isTicketRecord(value: unknown): value is TicketRecord {
  const ticket = asRecord(value);
  return Boolean(
    ticket &&
    typeof ticket.id === "string" &&
    typeof ticket.ticket_number === "string" &&
    typeof ticket.subject === "string" &&
    typeof ticket.description === "string" &&
    typeof ticket.status_id === "string" &&
    typeof ticket.priority_id === "string" &&
    (typeof ticket.assigned_team_id === "string" ||
      ticket.assigned_team_id === null) &&
    typeof ticket.created_at === "string",
  );
}

function isTicketComment(value: unknown): value is TicketComment {
  const comment = asRecord(value);
  return Boolean(
    comment &&
    typeof comment.id === "string" &&
    typeof comment.body === "string" &&
    typeof comment.created_at === "string" &&
    (comment.visibility === "external" || comment.visibility === "internal"),
  );
}

function toTicketComment(value: unknown): TicketComment | null {
  if (!isTicketComment(value)) return null;
  const comment = asRecord(value);
  const authorName =
    typeof comment?.authorName === "string" && comment.authorName.trim()
      ? comment.authorName
      : "Benutzerkonto";
  return { ...value, authorName };
}

function isTicketEvent(value: unknown): value is TicketEvent {
  const event = asRecord(value);
  return Boolean(
    event &&
    typeof event.id === "string" &&
    typeof event.event_type === "string" &&
    typeof event.created_at === "string",
  );
}

function isEscalationKind(value: unknown): value is EscalationKind {
  return value === "technical" || value === "organizational" || value === "sla";
}

function isTicketEscalation(value: unknown): value is TicketEscalation {
  const escalation = asRecord(value);
  return Boolean(
    escalation &&
    typeof escalation.id === "string" &&
    typeof escalation.ticket_id === "string" &&
    typeof escalation.level === "number" &&
    Number.isInteger(escalation.level) &&
    escalation.level >= 1 &&
    isEscalationKind(escalation.kind) &&
    typeof escalation.reason === "string" &&
    typeof escalation.opened_by === "string" &&
    (typeof escalation.resolved_by === "string" ||
      escalation.resolved_by === null) &&
    typeof escalation.opened_at === "string" &&
    (typeof escalation.resolved_at === "string" ||
      escalation.resolved_at === null),
  );
}

function isTicketStatus(value: unknown): value is TicketStatus {
  const status = asRecord(value);
  return Boolean(
    status &&
    typeof status.id === "string" &&
    typeof status.key === "string" &&
    typeof status.label === "string" &&
    typeof status.is_closed === "boolean",
  );
}

function isTicketPriority(value: unknown): value is TicketPriority {
  const priority = asRecord(value);
  return Boolean(
    priority &&
    typeof priority.id === "string" &&
    typeof priority.key === "string" &&
    typeof priority.label === "string",
  );
}

function isTicketTeam(value: unknown): value is TicketTeam {
  const team = asRecord(value);
  return Boolean(
    team && typeof team.id === "string" && typeof team.name === "string",
  );
}

function isBillingKind(value: unknown): value is BillingKind {
  return value === "internal" || value === "billable" || value === "goodwill";
}

function isRelationType(value: unknown): value is RelationType {
  return (
    value === "duplicates" ||
    value === "blocks" ||
    value === "blocked_by" ||
    value === "relates_to" ||
    value === "parent" ||
    value === "child"
  );
}

function isDisplayRelationType(value: unknown): value is DisplayRelationType {
  return (
    isRelationType(value) || value === "merged_into" || value === "merged_from"
  );
}

function isTicketChecklistItem(value: unknown): value is TicketChecklistItem {
  const item = asRecord(value);
  return Boolean(
    item &&
    typeof item.id === "string" &&
    typeof item.description === "string" &&
    typeof item.position === "number" &&
    (typeof item.completed_at === "string" || item.completed_at === null),
  );
}

function isTicketTimeEntry(value: unknown): value is TicketTimeEntry {
  const entry = asRecord(value);
  return Boolean(
    entry &&
    typeof entry.id === "string" &&
    typeof entry.author_id === "string" &&
    typeof entry.minutes === "number" &&
    Number.isInteger(entry.minutes) &&
    entry.minutes >= 1 &&
    entry.minutes <= 1440 &&
    isBillingKind(entry.billing_kind) &&
    (typeof entry.note === "string" || entry.note === null) &&
    (typeof entry.started_at === "string" || entry.started_at === null) &&
    typeof entry.created_at === "string",
  );
}

function isTicketRelation(value: unknown): value is TicketRelation {
  const relation = asRecord(value);
  return Boolean(
    relation &&
    (relation.id === undefined || typeof relation.id === "string") &&
    typeof relation.relatedTicketId === "string" &&
    typeof relation.ticketNumber === "string" &&
    typeof relation.subject === "string" &&
    typeof relation.statusLabel === "string" &&
    isDisplayRelationType(relation.relationType),
  );
}

function isSimilarTicket(value: unknown): value is SimilarTicket {
  const ticket = asRecord(value);
  return Boolean(
    ticket &&
    typeof ticket.id === "string" &&
    typeof ticket.ticketNumber === "string" &&
    typeof ticket.subject === "string" &&
    typeof ticket.statusLabel === "string",
  );
}

function valuesOf<T>(value: unknown, guard: (item: unknown) => item is T): T[] {
  return Array.isArray(value) ? value.filter(guard) : [];
}

/**
 * Relations are newly returned by the Edge Function. An omitted field remains
 * compatible with an older deployment, but every supplied item must match the
 * declared API contract before it reaches the UI.
 */
function parseStrictValues<T>(
  value: unknown,
  guard: (item: unknown) => item is T,
): T[] | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every(guard)) return undefined;
  return value;
}

/**
 * `null` represents an explicitly empty server response; `undefined` is an
 * invalid response shape and is treated as a request error.
 */
function parseTicketDetail(
  value: unknown,
): TicketDetailData | null | undefined {
  const envelope = asRecord(value);
  const data = asRecord(envelope?.data);
  if (!data) return undefined;
  if (data.ticket === null) return null;
  if (!isTicketRecord(data.ticket)) return undefined;

  const relations = parseStrictValues(data.relations, isTicketRelation);
  const similarTickets = parseStrictValues(
    data.similarTickets,
    isSimilarTicket,
  );
  const escalations = parseStrictValues(data.escalations, isTicketEscalation);
  if (
    relations === undefined ||
    similarTickets === undefined ||
    escalations === undefined
  ) {
    return undefined;
  }
  const canEscalate =
    data.canEscalate === undefined
      ? undefined
      : typeof data.canEscalate === "boolean"
        ? data.canEscalate
        : null;
  if (canEscalate === null) return undefined;

  const comments = Array.isArray(data.comments)
    ? data.comments
        .map(toTicketComment)
        .filter((comment): comment is TicketComment => comment !== null)
    : [];

  return {
    ticket: data.ticket,
    comments,
    events: valuesOf(data.events, isTicketEvent),
    escalations,
    statuses: valuesOf(data.statuses, isTicketStatus),
    priorities: valuesOf(data.priorities, isTicketPriority),
    teams: valuesOf(data.teams, isTicketTeam),
    checklistItems: valuesOf(data.checklistItems, isTicketChecklistItem).sort(
      (first, second) => first.position - second.position,
    ),
    timeEntries: valuesOf(data.timeEntries, isTicketTimeEntry),
    relations,
    similarTickets,
    watching: data.watching === true,
    canUpdate: data.canUpdate === true,
    ...(canEscalate === undefined ? {} : { canEscalate }),
    canUseInternalNotes: data.canUseInternalNotes === true,
    canTrackTime: data.canTrackTime === true,
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    const message = error.message.trim();
    if (message.includes("non-2xx") || message.includes("FunctionsHttpError")) {
      return "Die Ticketdetails konnten nicht geladen werden. Bitte versuchen Sie es erneut.";
    }
    return message;
  }
  const value = asRecord(error);
  if (typeof value?.message === "string" && value.message.trim()) {
    return value.message;
  }
  return "Der Ticketvorgang konnte nicht verarbeitet werden.";
}

function formatDateTime(timestamp: string): string {
  const value = new Date(timestamp);
  if (Number.isNaN(value.getTime())) return timestamp;
  return new Intl.DateTimeFormat("de-CH", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours === 0) return `${minutes} Min.`;
  if (remainingMinutes === 0) return `${hours} Std.`;
  return `${hours} Std. ${remainingMinutes} Min.`;
}

function billingKindLabel(kind: BillingKind): string {
  const labels: Record<BillingKind, string> = {
    internal: "Intern",
    billable: "Verrechenbar",
    goodwill: "Kulanz",
  };
  return labels[kind];
}

function escalationKindLabel(kind: EscalationKind): string {
  const labels: Record<EscalationKind, string> = {
    technical: "Technisch",
    organizational: "Organisatorisch",
    sla: "SLA",
  };
  return labels[kind];
}

function relationTypeLabel(relationType: DisplayRelationType): string {
  const labels: Record<DisplayRelationType, string> = {
    duplicates: "Duplikat",
    blocks: "Blockiert",
    blocked_by: "Wird blockiert von",
    relates_to: "Verknüpft mit",
    parent: "Übergeordnetes Ticket",
    child: "Untergeordnetes Ticket",
    merged_into: "Zusammengeführt in",
    merged_from: "Zusammengeführt aus",
  };
  return labels[relationType];
}

function ticketReference(
  ticket: Pick<SimilarTicket, "ticketNumber" | "subject">,
) {
  return `${ticket.ticketNumber} – ${ticket.subject}`;
}

function relationActionKey(relation: TicketRelation): string {
  return `${relation.relationType}:${relation.relatedTicketId}`;
}

function eventLabel(eventType: string): string {
  const labels: Record<string, string> = {
    "comment.external_added": "Externer Kommentar hinzugefügt",
    "comment.internal_added": "Interne Notiz hinzugefügt",
    "ticket.updated": "Ticket aktualisiert",
  };
  return (
    labels[eventType] ??
    eventType
      .replaceAll(/[._-]+/g, " ")
      .replace(/^./, (character) => character.toLocaleUpperCase("de-CH"))
  );
}

async function invokeTicketOperation(
  action: TicketOperation,
): Promise<unknown> {
  if (!supabase) throw new Error("Supabase ist nicht konfiguriert.");
  const { data, error } = await supabase.functions.invoke("ticket-operations", {
    body: action,
  });
  if (error) throw error;
  return data;
}

export function TicketDetail({
  tenantId,
  ticketId,
  onClose,
  onChanged,
}: TicketDetailProps) {
  const [detail, setDetail] = useState<TicketDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [statusKey, setStatusKey] = useState("");
  const [priorityKey, setPriorityKey] = useState("");
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [comment, setComment] = useState("");
  const [commentVisibility, setCommentVisibility] =
    useState<CommentVisibility>("external");
  const [checklistDescription, setChecklistDescription] = useState("");
  const [timeEntryMinutes, setTimeEntryMinutes] = useState("");
  const [timeEntryBillingKind, setTimeEntryBillingKind] =
    useState<BillingKind>("internal");
  const [timeEntryNote, setTimeEntryNote] = useState("");
  const [escalationKind, setEscalationKind] =
    useState<EscalationKind>("technical");
  const [escalationReason, setEscalationReason] = useState("");
  const [selectedRelatedTicketId, setSelectedRelatedTicketId] = useState("");
  const [selectedRelationType, setSelectedRelationType] =
    useState<RelationType>("relates_to");
  const [pendingChecklistItemId, setPendingChecklistItemId] = useState<
    string | null
  >(null);
  const [pendingRelationKey, setPendingRelationKey] = useState<string | null>(
    null,
  );
  const [pendingEscalationId, setPendingEscalationId] = useState<string | null>(
    null,
  );
  const requestSequence = useRef(0);

  const loadTicket = useCallback(async () => {
    const requestId = ++requestSequence.current;
    setLoading(true);
    setError("");

    try {
      const response = await invokeTicketOperation({
        type: "getTicket",
        tenantId,
        ticketId,
      });
      const nextDetail = parseTicketDetail(response);
      if (nextDetail === undefined) {
        throw new Error("Die Ticketdaten sind unvollständig.");
      }
      if (requestId !== requestSequence.current) return false;

      setDetail(nextDetail);
      setStatusKey(
        nextDetail?.statuses.find(
          (status) => status.id === nextDetail.ticket.status_id,
        )?.key ?? "",
      );
      setPriorityKey(
        nextDetail?.priorities.find(
          (priority) => priority.id === nextDetail.ticket.priority_id,
        )?.key ?? "",
      );
      setSelectedTeamId(nextDetail?.ticket.assigned_team_id ?? "");
      if (!nextDetail?.canUseInternalNotes) {
        setCommentVisibility("external");
      }
      return true;
    } catch (nextError) {
      if (requestId === requestSequence.current) {
        setDetail(null);
        setError(errorMessage(nextError));
      }
      return false;
    } finally {
      if (requestId === requestSequence.current) {
        setLoaded(true);
        setLoading(false);
      }
    }
  }, [tenantId, ticketId]);

  useEffect(() => {
    void loadTicket();
    return () => {
      requestSequence.current += 1;
    };
  }, [loadTicket]);

  const selectedStatus = useMemo(
    () =>
      detail?.statuses.find(
        (status) => status.id === detail.ticket.status_id,
      ) ?? null,
    [detail],
  );
  const selectedPriority = useMemo(
    () =>
      detail?.priorities.find(
        (priority) => priority.id === detail.ticket.priority_id,
      ) ?? null,
    [detail],
  );
  const openEscalations = useMemo(
    () =>
      detail?.escalations.filter((escalation) => !escalation.resolved_at) ?? [],
    [detail],
  );
  const historicalEscalations = useMemo(
    () =>
      detail?.escalations.filter((escalation) => escalation.resolved_at) ?? [],
    [detail],
  );
  const assignedTeamId = detail?.ticket.assigned_team_id ?? "";
  const hasChanges = Boolean(
    detail &&
    (statusKey !== selectedStatus?.key ||
      priorityKey !== selectedPriority?.key ||
      selectedTeamId !== assignedTeamId),
  );
  const busy = pendingAction !== null;

  async function saveTicketChanges() {
    if (!detail || !hasChanges) return;

    const action: UpdateTicketAction = {
      type: "updateTicket",
      tenantId,
      ticketId,
    };
    if (statusKey && statusKey !== selectedStatus?.key) {
      action.statusKey = statusKey;
    }
    if (priorityKey && priorityKey !== selectedPriority?.key) {
      action.priorityKey = priorityKey;
    }
    if (selectedTeamId !== assignedTeamId) {
      action.assignedTeamId = selectedTeamId || null;
    }
    if (
      !action.statusKey &&
      !action.priorityKey &&
      action.assignedTeamId === undefined
    ) {
      return;
    }

    setPendingAction("update");
    setError("");
    try {
      await invokeTicketOperation(action);
      onChanged();
      await loadTicket();
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setPendingAction(null);
    }
  }

  async function saveComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = comment.trim();
    if (!body) {
      setError("Bitte geben Sie einen Kommentar ein.");
      return;
    }
    if (body.length > 50_000) {
      setError("Ein Kommentar darf höchstens 50'000 Zeichen enthalten.");
      return;
    }

    setPendingAction("comment");
    setError("");
    try {
      await invokeTicketOperation({
        type: "addComment",
        tenantId,
        ticketId,
        body,
        visibility: commentVisibility,
      });
      setComment("");
      onChanged();
      await loadTicket();
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setPendingAction(null);
    }
  }

  async function saveTimeEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail || !detail.canTrackTime) return;

    const minutes = Number(timeEntryMinutes);
    const note = timeEntryNote.trim();
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
      setError("Bitte geben Sie eine ganze Minutenanzahl von 1 bis 1'440 ein.");
      return;
    }
    if (note.length > 500) {
      setError("Die Notiz darf höchstens 500 Zeichen enthalten.");
      return;
    }

    const action: AddTimeEntryAction = {
      type: "addTimeEntry",
      tenantId,
      ticketId,
      minutes,
      billingKind: timeEntryBillingKind,
    };
    if (note) action.note = note;

    setPendingAction("time-entry");
    setError("");
    try {
      await invokeTicketOperation(action);
      setTimeEntryMinutes("");
      setTimeEntryBillingKind("internal");
      setTimeEntryNote("");
      onChanged();
      await loadTicket();
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setPendingAction(null);
    }
  }

  async function openEscalation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail || detail.canEscalate !== true) return;

    const reason = escalationReason.trim();
    const reasonLength = [...reason].length;
    if (reasonLength < 3 || reasonLength > 2_000 || reason.includes("\u0000")) {
      setError("Die Begründung muss zwischen 3 und 2'000 Zeichen lang sein.");
      return;
    }

    setPendingAction("escalation-open");
    setError("");
    try {
      await invokeTicketOperation({
        type: "openEscalation",
        tenantId,
        ticketId,
        kind: escalationKind,
        reason,
      });
      setEscalationKind("technical");
      setEscalationReason("");
      onChanged();
      await loadTicket();
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setPendingAction(null);
    }
  }

  async function resolveEscalation(escalation: TicketEscalation) {
    if (
      !detail ||
      detail.canEscalate !== true ||
      escalation.resolved_at !== null
    ) {
      return;
    }

    setPendingAction("escalation-resolve");
    setPendingEscalationId(escalation.id);
    setError("");
    try {
      await invokeTicketOperation({
        type: "resolveEscalation",
        tenantId,
        ticketId,
        escalationId: escalation.id,
      });
      onChanged();
      await loadTicket();
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setPendingEscalationId(null);
      setPendingAction(null);
    }
  }

  async function addChecklistItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail || !detail.canUpdate) return;

    const description = checklistDescription.trim();
    if (!description) {
      setError(
        "Bitte geben Sie eine Beschreibung für den Checklistenpunkt ein.",
      );
      return;
    }

    setPendingAction("checklist-add");
    setError("");
    try {
      await invokeTicketOperation({
        type: "addChecklistItem",
        tenantId,
        ticketId,
        description,
      });
      setChecklistDescription("");
      onChanged();
      await loadTicket();
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setPendingAction(null);
    }
  }

  async function toggleChecklistItem(item: TicketChecklistItem) {
    if (!detail || !detail.canUpdate) return;

    const completed = item.completed_at === null;
    setPendingAction("checklist-toggle");
    setPendingChecklistItemId(item.id);
    setError("");
    try {
      await invokeTicketOperation({
        type: "toggleChecklistItem",
        tenantId,
        ticketId,
        itemId: item.id,
        completed,
      });
      onChanged();
      await loadTicket();
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setPendingChecklistItemId(null);
      setPendingAction(null);
    }
  }

  async function toggleWatch() {
    if (!detail) return;
    const watching = !detail.watching;
    setPendingAction("watch");
    setError("");
    try {
      await invokeTicketOperation({
        type: "toggleWatch",
        tenantId,
        ticketId,
        watching,
      });
      setDetail((current) => (current ? { ...current, watching } : current));
      onChanged();
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setPendingAction(null);
    }
  }

  async function createRelation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail || !detail.canUpdate) return;

    const relatedTicket = detail.similarTickets.find(
      (ticket) => ticket.id === selectedRelatedTicketId,
    );
    if (!relatedTicket) {
      setError("Bitte wählen Sie ein ähnliches Ticket aus.");
      return;
    }

    setPendingAction("relation-create");
    setError("");
    try {
      await invokeTicketOperation({
        type: "createRelation",
        tenantId,
        ticketId,
        relatedTicketId: relatedTicket.id,
        relationType: selectedRelationType,
      });
      setSelectedRelatedTicketId("");
      onChanged();
      await loadTicket();
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setPendingAction(null);
    }
  }

  async function deleteRelation(relation: TicketRelation) {
    if (
      !detail ||
      !detail.canUpdate ||
      !isRelationType(relation.relationType)
    ) {
      return;
    }

    const relationKey = relationActionKey(relation);
    setPendingAction("relation-delete");
    setPendingRelationKey(relationKey);
    setError("");
    try {
      await invokeTicketOperation({
        type: "deleteRelation",
        tenantId,
        ticketId,
        relatedTicketId: relation.relatedTicketId,
        relationType: relation.relationType,
      });
      onChanged();
      await loadTicket();
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setPendingRelationKey(null);
      setPendingAction(null);
    }
  }

  async function markMerged(primaryTicket: SimilarTicket) {
    if (!detail || !detail.canUpdate || primaryTicket.id === ticketId) return;

    setPendingAction("merge");
    setPendingRelationKey(`merge:${primaryTicket.id}`);
    setError("");
    try {
      await invokeTicketOperation({
        type: "markMerged",
        tenantId,
        ticketId,
        primaryTicketId: primaryTicket.id,
      });
      onChanged();
      await loadTicket();
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setPendingRelationKey(null);
      setPendingAction(null);
    }
  }

  if (loading && !loaded) {
    return (
      <section className="ticket-detail panel" aria-label="Ticketdetails">
        <p className="empty-state ticket-detail-loading" aria-live="polite">
          <LoaderCircle
            aria-hidden="true"
            className="ticket-detail-spinner"
            size={18}
          />
          Ticket wird geladen …
        </p>
      </section>
    );
  }

  if (!detail) {
    return (
      <section className="ticket-detail panel" aria-label="Ticketdetails">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">TICKETDETAILS</p>
            <h2>Ticket nicht verfügbar</h2>
          </div>
          <button
            aria-label="Ticketdetails schliessen"
            className="more-button"
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" size={18} strokeWidth={1.8} />
          </button>
        </div>
        {error ? (
          <p className="ticket-detail-message error" role="alert">
            <AlertCircle aria-hidden="true" size={17} />
            {error}
          </p>
        ) : (
          <p className="empty-state">
            Für dieses Ticket sind keine Details verfügbar.
          </p>
        )}
        <div className="ticket-detail-actions">
          <button
            className="secondary-button"
            disabled={loading}
            onClick={() => void loadTicket()}
            type="button"
          >
            <RefreshCw aria-hidden="true" size={16} strokeWidth={1.8} />
            Erneut laden
          </button>
          <button className="primary-button" onClick={onClose} type="button">
            Schliessen
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="ticket-detail panel" aria-label="Ticketdetails">
      <header className="ticket-detail-header">
        <div>
          <p className="eyebrow">TICKET {detail.ticket.ticket_number}</p>
          <h2>{detail.ticket.subject}</h2>
        </div>
        <div className="ticket-detail-header-actions">
          <button
            className={
              detail.watching
                ? "secondary-button ticket-watch-button active"
                : "secondary-button ticket-watch-button"
            }
            disabled={busy}
            onClick={() => void toggleWatch()}
            type="button"
          >
            {pendingAction === "watch" ? (
              <LoaderCircle
                aria-hidden="true"
                className="ticket-detail-spinner"
                size={16}
              />
            ) : detail.watching ? (
              <EyeOff aria-hidden="true" size={16} strokeWidth={1.8} />
            ) : (
              <Eye aria-hidden="true" size={16} strokeWidth={1.8} />
            )}
            {detail.watching ? "Nicht mehr beobachten" : "Beobachten"}
          </button>
          <button
            aria-label="Ticketdetails schliessen"
            className="more-button"
            disabled={busy}
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" size={18} strokeWidth={1.8} />
          </button>
        </div>
      </header>

      {error && (
        <p className="ticket-detail-message error" role="alert">
          <AlertCircle aria-hidden="true" size={17} />
          {error}
        </p>
      )}

      <div className="ticket-detail-summary">
        <div className="ticket-detail-badges" aria-label="Ticketstatus">
          <span className="state-badge ticket-detail-status">
            {selectedStatus?.label ?? "Status nicht verfügbar"}
          </span>
          <span className="ticket-detail-priority">
            {selectedPriority?.label ?? "Priorität nicht verfügbar"}
          </span>
        </div>
        <p className="ticket-detail-description">{detail.ticket.description}</p>
        <p className="data-caption">
          Erstellt am {formatDateTime(detail.ticket.created_at)}
        </p>
      </div>

      <section
        className="ticket-detail-comments"
        aria-labelledby="ticket-escalations-heading"
      >
        <div className="ticket-detail-section-heading">
          <div>
            <p className="eyebrow">ESKALATIONEN</p>
            <h3 id="ticket-escalations-heading">Eskalationen</h3>
          </div>
          <span className="data-caption">
            {openEscalations.length} offen / {detail.escalations.length} gesamt
          </span>
        </div>

        {detail.canEscalate === true && (
          <form className="ticket-comment-form" onSubmit={openEscalation}>
            <label>
              Art der Eskalation
              <select
                disabled={busy}
                onChange={(event) => {
                  const nextKind = event.target.value;
                  if (isEscalationKind(nextKind)) setEscalationKind(nextKind);
                }}
                value={escalationKind}
              >
                <option value="technical">Technisch</option>
                <option value="organizational">Organisatorisch</option>
                <option value="sla">SLA</option>
              </select>
            </label>
            <label className="ticket-comment-body">
              Begründung
              <textarea
                disabled={busy}
                maxLength={2000}
                minLength={3}
                onChange={(event) => setEscalationReason(event.target.value)}
                placeholder="Warum muss dieses Ticket eskaliert werden?"
                required
                rows={3}
                value={escalationReason}
              />
            </label>
            <button className="secondary-button" disabled={busy} type="submit">
              {pendingAction === "escalation-open" ? (
                <LoaderCircle
                  aria-hidden="true"
                  className="ticket-detail-spinner"
                  size={16}
                />
              ) : (
                <AlertCircle aria-hidden="true" size={16} strokeWidth={1.8} />
              )}
              Eskalation eröffnen
            </button>
          </form>
        )}

        <div className="ticket-detail-section-heading">
          <strong>Offene Eskalationen</strong>
          <span className="data-caption">{openEscalations.length}</span>
        </div>
        {openEscalations.length === 0 ? (
          <p className="empty-state">Keine offenen Eskalationen.</p>
        ) : (
          <ol className="ticket-comment-list">
            {openEscalations.map((escalation) => {
              const isResolving =
                pendingAction === "escalation-resolve" &&
                pendingEscalationId === escalation.id;
              return (
                <li className="ticket-comment" key={escalation.id}>
                  <div className="ticket-comment-meta">
                    <strong>{escalationKindLabel(escalation.kind)}</strong>
                    <span className="ticket-comment-visibility-badge internal">
                      Stufe {escalation.level}
                    </span>
                    <span className="ticket-comment-visibility-badge external">
                      Offen
                    </span>
                    <time dateTime={escalation.opened_at}>
                      Eröffnet am {formatDateTime(escalation.opened_at)}
                    </time>
                  </div>
                  <p>{escalation.reason}</p>
                  {detail.canEscalate === true && (
                    <button
                      aria-label={`Eskalation der Art ${escalationKindLabel(escalation.kind)} auflösen`}
                      className="secondary-button"
                      disabled={busy}
                      onClick={() => void resolveEscalation(escalation)}
                      type="button"
                    >
                      {isResolving ? (
                        <LoaderCircle
                          aria-hidden="true"
                          className="ticket-detail-spinner"
                          size={16}
                        />
                      ) : (
                        <CircleCheck
                          aria-hidden="true"
                          size={16}
                          strokeWidth={1.8}
                        />
                      )}
                      Eskalation auflösen
                    </button>
                  )}
                </li>
              );
            })}
          </ol>
        )}

        <div className="ticket-detail-section-heading">
          <strong>Historische Eskalationen</strong>
          <span className="data-caption">{historicalEscalations.length}</span>
        </div>
        {historicalEscalations.length === 0 ? (
          <p className="empty-state">Keine historischen Eskalationen.</p>
        ) : (
          <ol className="ticket-comment-list">
            {historicalEscalations.map((escalation) => (
              <li className="ticket-comment" key={escalation.id}>
                <div className="ticket-comment-meta">
                  <strong>{escalationKindLabel(escalation.kind)}</strong>
                  <span className="ticket-comment-visibility-badge internal">
                    Stufe {escalation.level}
                  </span>
                  <span className="ticket-comment-visibility-badge external">
                    Aufgelöst
                  </span>
                  <time dateTime={escalation.opened_at}>
                    Eröffnet am {formatDateTime(escalation.opened_at)}
                  </time>
                  {escalation.resolved_at && (
                    <time dateTime={escalation.resolved_at}>
                      Aufgelöst am {formatDateTime(escalation.resolved_at)}
                    </time>
                  )}
                </div>
                <p>{escalation.reason}</p>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section
        className="ticket-detail-comments"
        aria-labelledby="ticket-relations-heading"
      >
        <div className="ticket-detail-section-heading">
          <div>
            <p className="eyebrow">VERKNÜPFUNGEN</p>
            <h3 id="ticket-relations-heading">Verknüpfte Tickets</h3>
          </div>
          <span className="data-caption">{detail.relations.length}</span>
        </div>

        {detail.relations.length === 0 ? (
          <p className="empty-state">Keine Tickets verknüpft.</p>
        ) : (
          <ol className="ticket-comment-list">
            {detail.relations.map((relation) => {
              const relationKey = relationActionKey(relation);
              const canDeleteRelation = isRelationType(relation.relationType);
              const isDeleting =
                pendingAction === "relation-delete" &&
                pendingRelationKey === relationKey;

              return (
                <li className="ticket-comment" key={relation.id ?? relationKey}>
                  <div className="ticket-comment-meta">
                    <strong>{ticketReference(relation)}</strong>
                    <span className="ticket-comment-visibility-badge internal">
                      {relationTypeLabel(relation.relationType)}
                    </span>
                    <span>{relation.statusLabel}</span>
                  </div>
                  {detail.canUpdate && canDeleteRelation && (
                    <button
                      aria-label={`Verknüpfung mit ${ticketReference(relation)} entfernen`}
                      className="secondary-button"
                      disabled={busy}
                      onClick={() => void deleteRelation(relation)}
                      type="button"
                    >
                      {isDeleting ? (
                        <LoaderCircle
                          aria-hidden="true"
                          className="ticket-detail-spinner"
                          size={16}
                        />
                      ) : (
                        <X aria-hidden="true" size={16} strokeWidth={1.8} />
                      )}
                      Verknüpfung entfernen
                    </button>
                  )}
                </li>
              );
            })}
          </ol>
        )}

        <div className="ticket-detail-section-heading">
          <div>
            <p className="eyebrow">ÄHNLICHE TICKETS</p>
            <h3>Vorgeschlagene Tickets</h3>
          </div>
          <span className="data-caption">{detail.similarTickets.length}</span>
        </div>

        {detail.canUpdate && detail.similarTickets.length > 0 && (
          <form className="ticket-comment-form" onSubmit={createRelation}>
            <label>
              Ticket
              <select
                disabled={busy}
                onChange={(event) =>
                  setSelectedRelatedTicketId(event.target.value)
                }
                required
                value={selectedRelatedTicketId}
              >
                <option value="">Ähnliches Ticket auswählen</option>
                {detail.similarTickets.map((ticket) => (
                  <option key={ticket.id} value={ticket.id}>
                    {ticketReference(ticket)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Art der Verknüpfung
              <select
                disabled={busy}
                onChange={(event) => {
                  const nextRelationType = event.target.value;
                  if (isRelationType(nextRelationType)) {
                    setSelectedRelationType(nextRelationType);
                  }
                }}
                value={selectedRelationType}
              >
                <option value="relates_to">Verknüpft mit</option>
                <option value="duplicates">Duplikat</option>
                <option value="blocks">Blockiert</option>
                <option value="blocked_by">Wird blockiert von</option>
                <option value="parent">Übergeordnetes Ticket</option>
                <option value="child">Untergeordnetes Ticket</option>
              </select>
            </label>
            <button
              className="secondary-button"
              disabled={busy || !selectedRelatedTicketId}
              type="submit"
            >
              {pendingAction === "relation-create" ? (
                <LoaderCircle
                  aria-hidden="true"
                  className="ticket-detail-spinner"
                  size={16}
                />
              ) : (
                <Circle aria-hidden="true" size={16} strokeWidth={1.8} />
              )}
              Verknüpfen
            </button>
          </form>
        )}

        {detail.similarTickets.length === 0 ? (
          <p className="empty-state">Keine ähnlichen Tickets gefunden.</p>
        ) : (
          <ol className="ticket-comment-list">
            {detail.similarTickets.map((ticket) => {
              const isMerging =
                pendingAction === "merge" &&
                pendingRelationKey === `merge:${ticket.id}`;

              return (
                <li className="ticket-comment" key={ticket.id}>
                  <div className="ticket-comment-meta">
                    <strong>{ticketReference(ticket)}</strong>
                    <span>{ticket.statusLabel}</span>
                  </div>
                  {detail.canUpdate && (
                    <button
                      aria-label={`${ticketReference(ticket)} als Primärticket auswählen und dieses Ticket zusammenführen`}
                      className="secondary-button"
                      disabled={busy}
                      onClick={() => void markMerged(ticket)}
                      type="button"
                    >
                      {isMerging ? (
                        <LoaderCircle
                          aria-hidden="true"
                          className="ticket-detail-spinner"
                          size={16}
                        />
                      ) : (
                        <CircleCheck
                          aria-hidden="true"
                          size={16}
                          strokeWidth={1.8}
                        />
                      )}
                      Als Duplikat zusammenführen
                    </button>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {detail.canTrackTime && (
        <section
          className="ticket-detail-comments"
          aria-labelledby="ticket-time-entries-heading"
        >
          <div className="ticket-detail-section-heading">
            <div>
              <p className="eyebrow">ARBEITSZEIT</p>
              <h3 id="ticket-time-entries-heading">Arbeitszeit erfassen</h3>
            </div>
            <span className="data-caption">{detail.timeEntries.length}</span>
          </div>

          <form className="ticket-comment-form" onSubmit={saveTimeEntry}>
            <label>
              Minuten
              <input
                disabled={busy}
                inputMode="numeric"
                max={1440}
                min={1}
                onChange={(event) => setTimeEntryMinutes(event.target.value)}
                placeholder="z. B. 30"
                required
                step={1}
                type="number"
                value={timeEntryMinutes}
              />
            </label>
            <label>
              Verrechnungsart
              <select
                disabled={busy}
                onChange={(event) => {
                  const nextBillingKind = event.target.value;
                  if (isBillingKind(nextBillingKind)) {
                    setTimeEntryBillingKind(nextBillingKind);
                  }
                }}
                value={timeEntryBillingKind}
              >
                <option value="internal">Intern</option>
                <option value="billable">Verrechenbar</option>
                <option value="goodwill">Kulanz</option>
              </select>
            </label>
            <label className="ticket-comment-body">
              Kurze Notiz (optional)
              <textarea
                disabled={busy}
                maxLength={500}
                onChange={(event) => setTimeEntryNote(event.target.value)}
                placeholder="Woran wurde gearbeitet?"
                rows={2}
                value={timeEntryNote}
              />
            </label>
            <button className="secondary-button" disabled={busy} type="submit">
              {pendingAction === "time-entry" ? (
                <LoaderCircle
                  aria-hidden="true"
                  className="ticket-detail-spinner"
                  size={16}
                />
              ) : (
                <Clock3 aria-hidden="true" size={16} strokeWidth={1.8} />
              )}
              Arbeitszeit speichern
            </button>
          </form>

          {detail.timeEntries.length === 0 ? (
            <p className="empty-state">Noch keine Arbeitszeit erfasst.</p>
          ) : (
            <ol className="ticket-comment-list">
              {detail.timeEntries.map((entry) => {
                const timestamp = entry.started_at ?? entry.created_at;
                return (
                  <li className="ticket-comment" key={entry.id}>
                    <div className="ticket-comment-meta">
                      <strong>{formatMinutes(entry.minutes)}</strong>
                      <span className="ticket-comment-visibility-badge internal">
                        {billingKindLabel(entry.billing_kind)}
                      </span>
                      <time dateTime={timestamp}>
                        {entry.started_at ? "Begonnen am " : "Erfasst am "}
                        {formatDateTime(timestamp)}
                      </time>
                    </div>
                    {entry.note && <p>{entry.note}</p>}
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      )}

      <section
        className="ticket-detail-checklist"
        aria-labelledby="ticket-checklist-heading"
      >
        <div className="ticket-detail-section-heading">
          <div>
            <p className="eyebrow">CHECKLISTE</p>
            <h3 id="ticket-checklist-heading">Checklistenpunkte</h3>
          </div>
          <span className="data-caption">
            {
              detail.checklistItems.filter((item) => item.completed_at !== null)
                .length
            }
            /{detail.checklistItems.length} erledigt
          </span>
        </div>

        {detail.canUpdate && (
          <form className="ticket-comment-form" onSubmit={addChecklistItem}>
            <label className="ticket-comment-body">
              Neuer Checklistenpunkt
              <input
                disabled={busy}
                onChange={(event) =>
                  setChecklistDescription(event.target.value)
                }
                placeholder="Punkt zur Checkliste hinzufügen …"
                required
                type="text"
                value={checklistDescription}
              />
            </label>
            <button className="secondary-button" disabled={busy} type="submit">
              {pendingAction === "checklist-add" ? (
                <LoaderCircle
                  aria-hidden="true"
                  className="ticket-detail-spinner"
                  size={16}
                />
              ) : (
                <Circle aria-hidden="true" size={16} strokeWidth={1.8} />
              )}
              Punkt hinzufügen
            </button>
          </form>
        )}

        {detail.checklistItems.length === 0 ? (
          <p className="empty-state">Noch keine Checklistenpunkte vorhanden.</p>
        ) : (
          <ol className="ticket-comment-list ticket-checklist-list">
            {detail.checklistItems.map((item) => {
              const isCompleted = item.completed_at !== null;
              const isPending =
                pendingAction === "checklist-toggle" &&
                pendingChecklistItemId === item.id;

              return (
                <li
                  className="ticket-comment ticket-checklist-item"
                  key={item.id}
                >
                  <button
                    aria-label={
                      isCompleted
                        ? `Checklistenpunkt „${item.description}“ als offen markieren`
                        : `Checklistenpunkt „${item.description}“ als erledigt markieren`
                    }
                    aria-pressed={isCompleted}
                    className="secondary-button"
                    disabled={busy || !detail.canUpdate}
                    onClick={() => void toggleChecklistItem(item)}
                    type="button"
                  >
                    {isPending ? (
                      <LoaderCircle
                        aria-hidden="true"
                        className="ticket-detail-spinner"
                        size={16}
                      />
                    ) : isCompleted ? (
                      <CircleCheck
                        aria-hidden="true"
                        size={16}
                        strokeWidth={1.8}
                      />
                    ) : (
                      <Circle aria-hidden="true" size={16} strokeWidth={1.8} />
                    )}
                    {isCompleted ? "Erledigt" : "Offen"}
                  </button>
                  <p>{item.description}</p>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {detail.canUpdate && (
        <section
          className="ticket-detail-editor"
          aria-labelledby="ticket-status-heading"
        >
          <div className="ticket-detail-section-heading">
            <div>
              <p className="eyebrow">BEARBEITEN</p>
              <h3 id="ticket-status-heading">Status und Priorität</h3>
            </div>
          </div>
          <div className="ticket-detail-selects">
            <label>
              Status
              <select
                disabled={busy || detail.statuses.length === 0}
                onChange={(event) => setStatusKey(event.target.value)}
                value={statusKey}
              >
                {detail.statuses.map((status) => (
                  <option key={status.id} value={status.key}>
                    {status.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Priorität
              <select
                disabled={busy || detail.priorities.length === 0}
                onChange={(event) => setPriorityKey(event.target.value)}
                value={priorityKey}
              >
                {detail.priorities.map((priority) => (
                  <option key={priority.id} value={priority.key}>
                    {priority.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Zugewiesenes Team
              <select
                disabled={busy}
                onChange={(event) => setSelectedTeamId(event.target.value)}
                value={selectedTeamId}
              >
                <option value="">Keinem Team zugewiesen</option>
                {detail.teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button
            className="secondary-button"
            disabled={busy || !hasChanges}
            onClick={() => void saveTicketChanges()}
            type="button"
          >
            {pendingAction === "update" ? (
              <LoaderCircle
                aria-hidden="true"
                className="ticket-detail-spinner"
                size={16}
              />
            ) : (
              <Save aria-hidden="true" size={16} strokeWidth={1.8} />
            )}
            Änderungen speichern
          </button>
        </section>
      )}

      <section
        className="ticket-detail-comments"
        aria-labelledby="ticket-comments-heading"
      >
        <div className="ticket-detail-section-heading">
          <div>
            <p className="eyebrow">KOMMUNIKATION</p>
            <h3 id="ticket-comments-heading">Kommentare</h3>
          </div>
          <span className="data-caption">{detail.comments.length}</span>
        </div>

        <form className="ticket-comment-form" onSubmit={saveComment}>
          <label className="ticket-comment-body">
            Neuer Kommentar
            <textarea
              disabled={busy}
              maxLength={50_000}
              onChange={(event) => setComment(event.target.value)}
              placeholder="Antwort oder Notiz verfassen …"
              required
              rows={4}
              value={comment}
            />
          </label>
          <fieldset className="ticket-comment-visibility" disabled={busy}>
            <legend>Sichtbarkeit</legend>
            <label>
              <input
                checked={commentVisibility === "external"}
                name="comment-visibility"
                onChange={() => setCommentVisibility("external")}
                type="radio"
                value="external"
              />
              Extern
            </label>
            {detail.canUseInternalNotes && (
              <label>
                <input
                  checked={commentVisibility === "internal"}
                  name="comment-visibility"
                  onChange={() => setCommentVisibility("internal")}
                  type="radio"
                  value="internal"
                />
                Intern
              </label>
            )}
          </fieldset>
          <button className="primary-button" disabled={busy} type="submit">
            {pendingAction === "comment" ? (
              <LoaderCircle
                aria-hidden="true"
                className="ticket-detail-spinner"
                size={16}
              />
            ) : (
              <Send aria-hidden="true" size={16} strokeWidth={1.8} />
            )}
            Kommentar speichern
          </button>
        </form>

        {detail.comments.length === 0 ? (
          <p className="empty-state">Noch keine Kommentare vorhanden.</p>
        ) : (
          <ol className="ticket-comment-list">
            {detail.comments.map((item) => (
              <li className="ticket-comment" key={item.id}>
                <div className="ticket-comment-meta">
                  <strong>{item.authorName}</strong>
                  <span
                    className={
                      item.visibility === "internal"
                        ? "ticket-comment-visibility-badge internal"
                        : "ticket-comment-visibility-badge external"
                    }
                  >
                    {item.visibility === "internal" ? "Intern" : "Extern"}
                  </span>
                  <time dateTime={item.created_at}>
                    {formatDateTime(item.created_at)}
                  </time>
                </div>
                <p>{item.body}</p>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section
        className="ticket-detail-timeline"
        aria-labelledby="ticket-timeline-heading"
      >
        <div className="ticket-detail-section-heading">
          <div>
            <p className="eyebrow">VERLAUF</p>
            <h3 id="ticket-timeline-heading">Timeline</h3>
          </div>
          <Clock3 aria-hidden="true" size={18} strokeWidth={1.8} />
        </div>
        {detail.events.length === 0 ? (
          <p className="empty-state">Noch keine Ereignisse vorhanden.</p>
        ) : (
          <ol className="ticket-timeline-list">
            {detail.events.map((event) => (
              <li className="ticket-timeline-event" key={event.id}>
                <MessageSquare aria-hidden="true" size={16} strokeWidth={1.8} />
                <div>
                  <strong>{eventLabel(event.event_type)}</strong>
                  <time dateTime={event.created_at}>
                    {formatDateTime(event.created_at)}
                  </time>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </section>
  );
}
