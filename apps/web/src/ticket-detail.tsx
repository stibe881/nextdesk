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
  ChevronDown,
  Clock3,
  Eye,
  EyeOff,
  Focus,
  LoaderCircle,
  MessageSquare,
  RefreshCw,
  Save,
  Send,
  Star,
  FolderTree,
  UsersRound,
  X,
} from "lucide-react";
import { supabase } from "./lib/supabase";
import { TicketApprovals } from "./ticket-approvals";
import { TicketComparison } from "./ticket-comparison";
import { TicketCustomFields } from "./ticket-custom-fields";
import { TicketPdfRecord } from "./ticket-pdf-record";

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
  | "feedback"
  | "quality-review"
  | null;
type PendingAttachmentAction = "upload" | "download" | "delete" | null;
type PendingCatalogAction = "link" | "unlink" | null;
type PendingHandoverAction = "create" | "acknowledge" | "resolve" | null;
type CatalogKind = "service" | "asset" | "problem";
type HandoverRiskLevel = "low" | "medium" | "high";
type HandoverStatus = "open" | "acknowledged" | "resolved";
type PendingCloseConfirmation = {
  statusKey: string;
  statusLabel: string;
  source: "overview" | "editor";
};

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

type SearchMergeTargetsAction = {
  type: "searchMergeTargets";
  tenantId: string;
  ticketId: string;
  query: string;
};

type UpdateTicketAction = {
  type: "updateTicket";
  tenantId: string;
  ticketId: string;
  statusKey?: string;
  confirmClose?: boolean;
  priorityKey?: string;
  assignedAgentId?: string | null;
  assignedTeamId?: string | null;
  subject?: string;
  description?: string;
};

type TicketAgentAssignmentAction =
  | { type: "list"; tenantId: string; ticketId: string }
  | {
      type: "assign";
      tenantId: string;
      ticketId: string;
      assignedAgentId: string | null;
    };

type TicketPresenceAction =
  | { type: "list"; tenantId: string; ticketId: string }
  | {
      type: "heartbeat";
      tenantId: string;
      ticketId: string;
      editing: boolean;
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
  | SearchMergeTargetsAction
  | UpdateTicketAction
  | AddCommentAction
  | ToggleWatchAction
  | AddChecklistItemAction
  | ToggleChecklistItemAction
  | AddTimeEntryAction;

type TicketAttachmentAction =
  | { type: "list"; tenantId: string; ticketId: string }
  | {
      type: "createUpload";
      tenantId: string;
      ticketId: string;
      filename: string;
      contentType: string;
      byteSize: number;
    }
  | {
      type: "completeUpload";
      tenantId: string;
      ticketId: string;
      storageObjectPath: string;
      originalFilename: string;
      contentType: string;
      byteSize: number;
    }
  | {
      type: "createDownloadUrl";
      tenantId: string;
      ticketId: string;
      attachmentId: string;
    }
  | {
      type: "delete";
      tenantId: string;
      ticketId: string;
      attachmentId: string;
    };

type TicketFeedbackAction =
  | { type: "get"; tenantId: string; ticketId: string }
  | {
      type: "submit";
      tenantId: string;
      ticketId: string;
      score: number;
      comment?: string;
    };

type TicketQualityAction =
  | { type: "get"; tenantId: string; ticketId: string }
  | {
      type: "submit";
      tenantId: string;
      ticketId: string;
      score: number;
      notes: string | null;
    };

type TicketHandoverAction =
  | { type: "list"; tenantId: string; ticketId: string }
  | {
      type: "create";
      tenantId: string;
      ticketId: string;
      summary: string;
      nextSteps: string | null;
      riskLevel: HandoverRiskLevel;
    }
  | {
      type: "acknowledge";
      tenantId: string;
      ticketId: string;
      handoverId: string;
    }
  | {
      type: "resolve";
      tenantId: string;
      ticketId: string;
      handoverId: string;
    };

type TicketRecord = {
  id: string;
  ticket_number: string;
  subject: string;
  description: string;
  status_id: string;
  priority_id: string;
  department_id: string;
  category_id: string | null;
  subcategory_id: string | null;
  assigned_agent_id: string | null;
  assigned_team_id: string | null;
  created_at: string;
};

type TicketComment = {
  id: string;
  authorName: string;
  authorKind?: "agent" | "requester";
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

type TicketAgent = {
  id: string;
  displayName: string;
};

type TicketPresencePerson = {
  displayName: string;
  editing: boolean;
  lastSeenAt: string;
};

type TicketRequesterContact = {
  id: string;
  displayName: string;
};

type TicketDepartment = {
  id: string;
  name: string;
};

type TicketRequesterProfile = {
  requesterContactId: string;
  location: string | null;
  department: string | null;
  offer: string | null;
  language: string | null;
  preferredContactChannel: string | null;
  importantNote: string | null;
};

type TicketRequesterProfileAction =
  | {
      type: "getProfile";
      tenantId: string;
      requesterContactId: string;
    }
  | ({
      type: "saveProfile";
      tenantId: string;
      requesterContactId: string;
    } & Omit<TicketRequesterProfile, "requesterContactId">);

type TicketCategory = {
  id: string;
  name: string;
  parentId: string | null;
};

type TicketCategoryDraft = {
  name: string;
  parentId: string | null;
};

type TicketCategorySelection = {
  tenantId: string;
  ticketId: string;
  categoryId: string | null;
  subcategoryId: string | null;
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

/** Only data approved for the merge-target search UI; the ID is never rendered. */
type MergeSearchTarget = {
  id: string;
  ticketNumber: string;
  subject: string;
  statusLabel: string;
};

type TicketAttachment = {
  id: string;
  originalFilename: string;
  contentType: string;
  byteSize: number;
  createdAt: string;
};

type AttachmentUpload = {
  storageObjectPath: string;
  signedUrl: string;
  contentType: string;
  byteSize: number;
};

type TicketSatisfaction = {
  score: number | null;
  comment: string | null;
};

type TicketFeedbackData = {
  satisfaction: TicketSatisfaction | null;
  canRate: boolean;
  isClosed: boolean;
};

type TicketQualityReview = {
  score: number;
  notes: string | null;
  createdAt: string;
};

type TicketQualityData = {
  canRead: boolean;
  count: number;
  averageScore: number | null;
  ownReview: TicketQualityReview | null;
  canReview: boolean;
};

/** Contains only the intentionally public, non-personal fields of an API handover. */
type TicketHandover = {
  id: string;
  ticketId: string;
  summary: string;
  nextSteps: string | null;
  riskLevel: HandoverRiskLevel;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
};

type CatalogService = {
  id: string;
  name: string;
  criticality: string;
};

type CatalogAsset = {
  id: string;
  name: string;
  assetTag: string | null;
  kind: string;
  status: string;
};

type CatalogProblem = {
  id: string;
  title: string;
  status: string;
};

type TicketCatalog = {
  services: CatalogService[];
  assets: CatalogAsset[];
  problems: CatalogProblem[];
};

type LinkedCatalogItem = {
  kind: CatalogKind;
  targetId: string;
  label: string;
  metadata: string[];
};

type CatalogSelection = {
  kind: CatalogKind;
  id: string;
  label: string;
  description: string;
};

type ServiceAssetsAction =
  | { type: "listCatalog"; tenantId: string }
  | {
      type: "linkTicket" | "unlinkTicket";
      tenantId: string;
      ticketId: string;
      kind: CatalogKind;
      targetId: string;
    };

type TicketDetailData = {
  ticket: TicketRecord;
  assignedAgent: TicketAgent | null;
  requesterContact: TicketRequesterContact | null;
  department: TicketDepartment | null;
  serviceOffers: string[];
  comments: TicketComment[];
  events: TicketEvent[];
  escalations: TicketEscalation[];
  statuses: TicketStatus[];
  priorities: TicketPriority[];
  departments: TicketDepartment[];
  teams: TicketTeam[];
  agents: TicketAgent[];
  checklistItems: TicketChecklistItem[];
  timeEntries: TicketTimeEntry[];
  relations: TicketRelation[];
  similarTickets: SimilarTicket[];
  ticketModules: {
    checklists: boolean;
    timeTracking: boolean;
  };
  watching: boolean;
  canUpdate: boolean;
  canAssign: boolean;
  canMerge: boolean;
  canExport: boolean;
  /** Geschlossene Status bleiben ohne diese Berechtigung nicht auswählbar. */
  canClose: boolean;
  /** Bei älteren Edge-Function-Deployments nicht vorhanden; kein Fallback auf canUpdate. */
  canEscalate?: boolean;
  canUseInternalNotes: boolean;
  canTrackTime: boolean;
};

type TicketDetailProps = {
  currentUserId: string | null;
  tenantId: string;
  ticketId: string;
  onClose: () => void;
  onChanged: () => void;
};

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const ATTACHMENT_CONTENT_TYPES = [
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;
const ALLOWED_ATTACHMENT_CONTENT_TYPES = new Set<string>(
  ATTACHMENT_CONTENT_TYPES,
);
const ATTACHMENT_ACCEPT = ATTACHMENT_CONTENT_TYPES.join(",");
const ATTACHMENT_ALLOWLIST_LABEL =
  "PDF, TXT, CSV, DOC, DOCX, XLS, XLSX, PNG, JPG/JPEG und WebP";

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const allowedKeys = new Set(keys);
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function isHandoverRiskLevel(value: unknown): value is HandoverRiskLevel {
  return value === "low" || value === "medium" || value === "high";
}

function isHandoverText(
  value: unknown,
  minimumLength: number,
  maximumLength: number,
): value is string {
  return (
    typeof value === "string" &&
    value.trim() === value &&
    !value.includes("\u0000") &&
    [...value].length >= minimumLength &&
    [...value].length <= maximumLength
  );
}

function isHandoverTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim() === value &&
    !value.includes("\u0000") &&
    value.length <= 64 &&
    Number.isFinite(Date.parse(value))
  );
}

function isTicketHandover(value: unknown): value is TicketHandover {
  const handover = asRecord(value);
  return Boolean(
    handover &&
    hasOnlyKeys(handover, [
      "id",
      "ticketId",
      "summary",
      "nextSteps",
      "riskLevel",
      "acknowledgedAt",
      "resolvedAt",
      "createdAt",
    ]) &&
    isUuid(handover.id) &&
    isUuid(handover.ticketId) &&
    isHandoverText(handover.summary, 3, 2_000) &&
    (handover.nextSteps === null ||
      isHandoverText(handover.nextSteps, 1, 3_000)) &&
    isHandoverRiskLevel(handover.riskLevel) &&
    (handover.acknowledgedAt === null ||
      isHandoverTimestamp(handover.acknowledgedAt)) &&
    (handover.resolvedAt === null ||
      isHandoverTimestamp(handover.resolvedAt)) &&
    isHandoverTimestamp(handover.createdAt),
  );
}

function parseTicketHandovers(value: unknown): TicketHandover[] | null {
  const envelope = asRecord(value);
  const data = asRecord(envelope?.data);
  if (
    !envelope ||
    !hasOnlyKeys(envelope, ["data"]) ||
    !data ||
    !hasOnlyKeys(data, ["handovers"]) ||
    !Array.isArray(data.handovers)
  ) {
    return null;
  }

  const handovers = data.handovers;
  return handovers.every(isTicketHandover) ? handovers : null;
}

function parseTicketHandoverResponse(value: unknown): TicketHandover | null {
  const envelope = asRecord(value);
  const data = asRecord(envelope?.data);
  if (
    !envelope ||
    !hasOnlyKeys(envelope, ["data"]) ||
    !data ||
    !hasOnlyKeys(data, ["handover"])
  ) {
    return null;
  }
  return isTicketHandover(data.handover) ? data.handover : null;
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
    typeof ticket.department_id === "string" &&
    (typeof ticket.category_id === "string" || ticket.category_id === null) &&
    (typeof ticket.subcategory_id === "string" ||
      ticket.subcategory_id === null) &&
    (typeof ticket.assigned_agent_id === "string" ||
      ticket.assigned_agent_id === null) &&
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
    (comment.authorKind === undefined ||
      comment.authorKind === "agent" ||
      comment.authorKind === "requester") &&
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

function toTicketCategory(value: unknown): TicketCategory | null {
  const category = asRecord(value);
  if (
    !category ||
    !isUuid(category.id) ||
    typeof category.name !== "string" ||
    !category.name.trim() ||
    category.name.includes("\u0000") ||
    (category.parentId !== null && !isUuid(category.parentId)) ||
    category.parentId === category.id
  ) {
    return null;
  }
  return {
    id: category.id,
    name: category.name.trim(),
    parentId: typeof category.parentId === "string" ? category.parentId : null,
  };
}

function isTicketCategory(value: unknown): value is TicketCategory {
  return toTicketCategory(value) !== null;
}

function isTicketTeam(value: unknown): value is TicketTeam {
  const team = asRecord(value);
  return Boolean(
    team && typeof team.id === "string" && typeof team.name === "string",
  );
}

function toTicketAgent(value: unknown): TicketAgent | null {
  const agent = asRecord(value);
  if (!agent || typeof agent.id !== "string" || agent.id.length === 0) {
    return null;
  }
  const displayName =
    typeof agent.displayName === "string" &&
    agent.displayName.trim().length > 0 &&
    !agent.displayName.includes("\u0000")
      ? agent.displayName.trim()
      : "Ohne Anzeigename";
  return { id: agent.id, displayName };
}

function isTicketAgent(value: unknown): value is TicketAgent {
  return toTicketAgent(value) !== null;
}

function toTicketPresencePerson(value: unknown): TicketPresencePerson | null {
  const person = asRecord(value);
  if (
    !person ||
    typeof person.displayName !== "string" ||
    !person.displayName.trim() ||
    person.displayName.includes("\u0000") ||
    typeof person.editing !== "boolean" ||
    typeof person.lastSeenAt !== "string" ||
    Number.isNaN(new Date(person.lastSeenAt).getTime())
  ) {
    return null;
  }
  return {
    displayName: person.displayName.trim(),
    editing: person.editing,
    lastSeenAt: person.lastSeenAt,
  };
}

function parseTicketPresence(value: unknown): TicketPresencePerson[] | null {
  const envelope = asRecord(value);
  const data = asRecord(envelope?.data);
  if (!data || !Array.isArray(data.people)) return null;
  const people = data.people.map(toTicketPresencePerson);
  return people.every(
    (person): person is TicketPresencePerson => person !== null,
  )
    ? people
    : null;
}

function parseAssignableTicketAgents(value: unknown): TicketAgent[] | null {
  const envelope = asRecord(value);
  const data = asRecord(envelope?.data);
  if (!data || !Array.isArray(data.agents)) return null;

  const agents = data.agents.map(toTicketAgent);
  return agents.every((agent): agent is TicketAgent => agent !== null)
    ? agents
    : null;
}

function toTicketRequesterContact(
  value: unknown,
): TicketRequesterContact | undefined {
  const contact = asRecord(value);
  if (
    !contact ||
    !hasOnlyKeys(contact, ["id", "displayName"]) ||
    typeof contact.id !== "string" ||
    contact.id.length === 0 ||
    typeof contact.displayName !== "string" ||
    contact.displayName.trim().length === 0 ||
    contact.displayName.includes("\u0000")
  ) {
    return undefined;
  }
  return { id: contact.id, displayName: contact.displayName };
}

function toTicketDepartment(
  value: unknown,
): TicketDepartment | null | undefined {
  if (value === null || value === undefined) return null;
  const department = asRecord(value);
  if (
    !department ||
    !hasOnlyKeys(department, ["id", "name"]) ||
    !isUuid(department.id) ||
    typeof department.name !== "string" ||
    !department.name.trim() ||
    department.name.includes("\u0000")
  ) {
    return undefined;
  }
  return { id: department.id, name: department.name.trim() };
}

function isTicketDepartment(value: unknown): value is TicketDepartment {
  return (
    toTicketDepartment(value) !== null &&
    toTicketDepartment(value) !== undefined
  );
}

function toTicketRequesterProfile(
  value: unknown,
): TicketRequesterProfile | null {
  const profile = asRecord(value);
  const optionalText = (entry: unknown) =>
    entry === null || (typeof entry === "string" && !entry.includes("\u0000"));
  if (
    !profile ||
    !hasOnlyKeys(profile, [
      "requesterContactId",
      "location",
      "department",
      "offer",
      "language",
      "preferredContactChannel",
      "importantNote",
    ]) ||
    !isUuid(profile.requesterContactId) ||
    !optionalText(profile.location) ||
    !optionalText(profile.department) ||
    !optionalText(profile.offer) ||
    !optionalText(profile.language) ||
    !optionalText(profile.preferredContactChannel) ||
    !optionalText(profile.importantNote)
  )
    return null;
  return {
    requesterContactId: profile.requesterContactId,
    location: typeof profile.location === "string" ? profile.location : null,
    department:
      typeof profile.department === "string" ? profile.department : null,
    offer: typeof profile.offer === "string" ? profile.offer : null,
    language: typeof profile.language === "string" ? profile.language : null,
    preferredContactChannel:
      typeof profile.preferredContactChannel === "string"
        ? profile.preferredContactChannel
        : null,
    importantNote:
      typeof profile.importantNote === "string" ? profile.importantNote : null,
  };
}

function parseTicketRequesterProfile(
  value: unknown,
): TicketRequesterProfile | null {
  const envelope = asRecord(value);
  const data = asRecord(envelope?.data);
  return data ? toTicketRequesterProfile(data.profile) : null;
}

function parseServiceOffers(value: unknown): string[] | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return undefined;
  const offers = value.map((offer) =>
    typeof offer === "string" && offer.trim() && !offer.includes("\u0000")
      ? offer.trim()
      : null,
  );
  return offers.every((offer): offer is string => offer !== null)
    ? [...new Set(offers)]
    : undefined;
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

function isMergeSearchTarget(value: unknown): value is MergeSearchTarget {
  const ticket = asRecord(value);
  return Boolean(
    ticket &&
    hasOnlyKeys(ticket, ["id", "ticketNumber", "subject", "statusLabel"]) &&
    isUuid(ticket.id) &&
    isHandoverText(ticket.ticketNumber, 1, 80) &&
    isHandoverText(ticket.subject, 1, 240) &&
    isHandoverText(ticket.statusLabel, 1, 120),
  );
}

function parseMergeSearchTargets(value: unknown): MergeSearchTarget[] | null {
  const envelope = asRecord(value);
  const data = asRecord(envelope?.data);
  if (
    !envelope ||
    !hasOnlyKeys(envelope, ["data"]) ||
    !data ||
    !hasOnlyKeys(data, ["mergeTargets"]) ||
    !Array.isArray(data.mergeTargets) ||
    !data.mergeTargets.every(isMergeSearchTarget)
  ) {
    return null;
  }
  return data.mergeTargets;
}

function toTicketAttachment(value: unknown): TicketAttachment | null {
  const attachment = asRecord(value);
  if (
    !attachment ||
    typeof attachment.id !== "string" ||
    typeof attachment.original_filename !== "string" ||
    !attachment.original_filename.trim() ||
    typeof attachment.content_type !== "string" ||
    !ALLOWED_ATTACHMENT_CONTENT_TYPES.has(attachment.content_type) ||
    typeof attachment.byte_size !== "number" ||
    !Number.isSafeInteger(attachment.byte_size) ||
    attachment.byte_size < 1 ||
    attachment.byte_size > MAX_ATTACHMENT_BYTES ||
    typeof attachment.created_at !== "string"
  ) {
    return null;
  }

  return {
    id: attachment.id,
    originalFilename: attachment.original_filename,
    contentType: attachment.content_type,
    byteSize: attachment.byte_size,
    createdAt: attachment.created_at,
  };
}

function parseTicketAttachments(value: unknown): TicketAttachment[] | null {
  const envelope = asRecord(value);
  const data = asRecord(envelope?.data);
  if (!Array.isArray(data?.attachments)) return null;

  const attachments = data.attachments.map(toTicketAttachment);
  return attachments.every(
    (attachment): attachment is TicketAttachment => attachment !== null,
  )
    ? attachments
    : null;
}

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function parseAttachmentUpload(value: unknown): AttachmentUpload | null {
  const envelope = asRecord(value);
  const data = asRecord(envelope?.data);
  if (
    !data ||
    typeof data.storageObjectPath !== "string" ||
    !data.storageObjectPath ||
    !isHttpsUrl(data.signedUrl) ||
    typeof data.contentType !== "string" ||
    !ALLOWED_ATTACHMENT_CONTENT_TYPES.has(data.contentType) ||
    typeof data.byteSize !== "number" ||
    !Number.isSafeInteger(data.byteSize) ||
    data.byteSize < 1 ||
    data.byteSize > MAX_ATTACHMENT_BYTES
  ) {
    return null;
  }

  return {
    storageObjectPath: data.storageObjectPath,
    signedUrl: data.signedUrl,
    contentType: data.contentType,
    byteSize: data.byteSize,
  };
}

function parseAttachmentDownloadUrl(value: unknown): string | null {
  const envelope = asRecord(value);
  const data = asRecord(envelope?.data);
  return isHttpsUrl(data?.signedUrl) ? data.signedUrl : null;
}

function isTicketSatisfaction(value: unknown): value is TicketSatisfaction {
  const satisfaction = asRecord(value);
  return Boolean(
    satisfaction &&
    (satisfaction.score === null ||
      (typeof satisfaction.score === "number" &&
        Number.isInteger(satisfaction.score) &&
        satisfaction.score >= 1 &&
        satisfaction.score <= 5)) &&
    (satisfaction.comment === null || typeof satisfaction.comment === "string"),
  );
}

function parseTicketFeedback(value: unknown): TicketFeedbackData | null {
  const envelope = asRecord(value);
  const data = asRecord(envelope?.data);
  const ticket = asRecord(data?.ticket);
  const status = asRecord(ticket?.status);
  if (
    !data ||
    (data.satisfaction !== null && !isTicketSatisfaction(data.satisfaction)) ||
    typeof data.canRate !== "boolean" ||
    typeof status?.isClosed !== "boolean"
  ) {
    return null;
  }

  return {
    satisfaction: data.satisfaction as TicketSatisfaction | null,
    canRate: data.canRate,
    isClosed: status.isClosed,
  };
}

function isTicketQualityScore(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 5
  );
}

function isTicketQualityReview(value: unknown): value is TicketQualityReview {
  const review = asRecord(value);
  return Boolean(
    review &&
    isTicketQualityScore(review.score) &&
    (review.notes === null ||
      (typeof review.notes === "string" &&
        [...review.notes].length <= 3_000 &&
        !review.notes.includes("\u0000"))) &&
    typeof review.createdAt === "string" &&
    Number.isFinite(Date.parse(review.createdAt)),
  );
}

function parseTicketQuality(value: unknown): TicketQualityData | null {
  const envelope = asRecord(value);
  const data = asRecord(envelope?.data);
  if (
    !data ||
    typeof data.count !== "number" ||
    !Number.isSafeInteger(data.count) ||
    data.count < 0 ||
    typeof data.canRead !== "boolean" ||
    typeof data.canReview !== "boolean"
  ) {
    return null;
  }

  const ownReview =
    data.ownReview === null
      ? null
      : isTicketQualityReview(data.ownReview)
        ? data.ownReview
        : null;
  if (data.ownReview !== null && ownReview === null) {
    return null;
  }

  if (data.count === 0) {
    if (data.averageScore !== null) return null;
    return {
      count: data.count,
      averageScore: null,
      ownReview,
      canRead: data.canRead,
      canReview: data.canReview,
    };
  }

  const averageScore = data.averageScore;
  if (
    typeof averageScore !== "number" ||
    !Number.isFinite(averageScore) ||
    averageScore < 1 ||
    averageScore > 5
  ) {
    return null;
  }

  return {
    count: data.count,
    averageScore,
    ownReview,
    canRead: data.canRead,
    canReview: data.canReview,
  };
}

function parseTicketQualitySubmit(value: unknown): boolean {
  const envelope = asRecord(value);
  const data = asRecord(envelope?.data);
  return isTicketQualityReview(data?.ownReview);
}

function emptyTicketCatalog(): TicketCatalog {
  return { services: [], assets: [], problems: [] };
}

function isStringOrNull(value: unknown): value is string | null {
  return typeof value === "string" || value === null;
}

function toCatalogService(value: unknown): CatalogService | null {
  const service = asRecord(value);
  if (
    !service ||
    typeof service.id !== "string" ||
    typeof service.name !== "string" ||
    typeof service.criticality !== "string"
  ) {
    return null;
  }
  return {
    id: service.id,
    name: service.name,
    criticality: service.criticality,
  };
}

function toCatalogAsset(value: unknown): CatalogAsset | null {
  const asset = asRecord(value);
  if (
    !asset ||
    typeof asset.id !== "string" ||
    typeof asset.name !== "string" ||
    !isStringOrNull(asset.asset_tag) ||
    typeof asset.kind !== "string" ||
    typeof asset.status !== "string"
  ) {
    return null;
  }
  return {
    id: asset.id,
    name: asset.name,
    assetTag: asset.asset_tag,
    kind: asset.kind,
    status: asset.status,
  };
}

function toCatalogProblem(value: unknown): CatalogProblem | null {
  const problem = asRecord(value);
  if (
    !problem ||
    typeof problem.id !== "string" ||
    typeof problem.title !== "string" ||
    typeof problem.status !== "string"
  ) {
    return null;
  }
  return { id: problem.id, title: problem.title, status: problem.status };
}

function parseTicketCatalog(value: unknown): TicketCatalog | null {
  const envelope = asRecord(value);
  const data = asRecord(envelope?.data);
  if (
    !data ||
    !Array.isArray(data.services) ||
    !Array.isArray(data.assets) ||
    !Array.isArray(data.problems)
  ) {
    return null;
  }

  const services = data.services.map(toCatalogService);
  const assets = data.assets.map(toCatalogAsset);
  const problems = data.problems.map(toCatalogProblem);
  if (
    !services.every((item): item is CatalogService => item !== null) ||
    !assets.every((item): item is CatalogAsset => item !== null) ||
    !problems.every((item): item is CatalogProblem => item !== null)
  ) {
    return null;
  }
  return { services, assets, problems };
}

function criticalityLabel(criticality: string): string {
  const labels: Record<string, string> = {
    low: "Niedrig",
    medium: "Mittel",
    high: "Hoch",
    critical: "Kritisch",
  };
  return labels[criticality] ?? criticality;
}

function catalogKindLabel(kind: CatalogKind): string {
  const labels: Record<CatalogKind, string> = {
    service: "Service",
    asset: "Asset",
    problem: "Problemfall",
  };
  return labels[kind];
}

function catalogItemKey(
  item: Pick<LinkedCatalogItem, "kind" | "targetId">,
): string {
  return `${item.kind}:${item.targetId}`;
}

function catalogSelectionKey(
  item: Pick<CatalogSelection, "kind" | "id">,
): string {
  return `${item.kind}:${item.id}`;
}

function toLinkedService(value: unknown): LinkedCatalogItem | null {
  const link = asRecord(value);
  const service = asRecord(link?.services);
  if (
    !link ||
    !service ||
    typeof link.service_id !== "string" ||
    service.id !== link.service_id ||
    typeof service.name !== "string" ||
    typeof service.criticality !== "string"
  ) {
    return null;
  }
  return {
    kind: "service",
    targetId: link.service_id,
    label: service.name,
    metadata: [`Kritikalität: ${criticalityLabel(service.criticality)}`],
  };
}

function toLinkedAsset(value: unknown): LinkedCatalogItem | null {
  const link = asRecord(value);
  const asset = asRecord(link?.assets);
  if (
    !link ||
    !asset ||
    typeof link.asset_id !== "string" ||
    asset.id !== link.asset_id ||
    typeof asset.name !== "string" ||
    !isStringOrNull(asset.asset_tag) ||
    typeof asset.kind !== "string" ||
    typeof asset.status !== "string"
  ) {
    return null;
  }
  return {
    kind: "asset",
    targetId: link.asset_id,
    label: asset.name,
    metadata: [
      asset.asset_tag ? `Asset-Kennung: ${asset.asset_tag}` : null,
      `Typ: ${asset.kind}`,
      `Status: ${asset.status}`,
    ].filter((entry): entry is string => entry !== null),
  };
}

function toLinkedProblem(value: unknown): LinkedCatalogItem | null {
  const link = asRecord(value);
  const problem = asRecord(link?.problems);
  if (
    !link ||
    !problem ||
    typeof link.problem_id !== "string" ||
    problem.id !== link.problem_id ||
    typeof problem.title !== "string" ||
    typeof problem.status !== "string"
  ) {
    return null;
  }
  return {
    kind: "problem",
    targetId: link.problem_id,
    label: problem.title,
    metadata: [`Status: ${problem.status}`],
  };
}

function parseLinkedCatalogItems(
  value: unknown,
  parser: (item: unknown) => LinkedCatalogItem | null,
): LinkedCatalogItem[] | null {
  if (!Array.isArray(value)) return null;
  const items = value.map(parser);
  return items.every((item): item is LinkedCatalogItem => item !== null)
    ? items
    : null;
}

function attachmentFileError(file: File): string | null {
  const filename = file.name.trim();
  const contentType = file.type.trim().toLowerCase();
  if (
    !filename ||
    filename.length > 255 ||
    filename === "." ||
    filename === ".." ||
    /[\u0000-\u001f\u007f/\\]/.test(filename)
  ) {
    return "Der Dateiname ist nicht zulässig.";
  }
  if (!ALLOWED_ATTACHMENT_CONTENT_TYPES.has(contentType)) {
    return `Dieser Dateityp ist nicht erlaubt. Erlaubt sind: ${ATTACHMENT_ALLOWLIST_LABEL}.`;
  }
  if (file.size < 1) return "Leere Dateien können nicht hochgeladen werden.";
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return "Die Datei ist zu groß. Erlaubt sind höchstens 25 MiB pro Datei.";
  }
  return null;
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

  const assignedAgent =
    data.assignedAgent === undefined || data.assignedAgent === null
      ? null
      : toTicketAgent(data.assignedAgent)
        ? toTicketAgent(data.assignedAgent)
        : undefined;
  if (
    assignedAgent === undefined ||
    (data.ticket.assigned_agent_id === null && assignedAgent !== null) ||
    (data.ticket.assigned_agent_id !== null &&
      assignedAgent?.id !== data.ticket.assigned_agent_id)
  ) {
    return undefined;
  }

  const requesterContact =
    data.requesterContact === undefined || data.requesterContact === null
      ? null
      : toTicketRequesterContact(data.requesterContact);
  if (requesterContact === undefined) return undefined;

  const department = toTicketDepartment(data.department);
  const serviceOffers = parseServiceOffers(data.serviceOffers);
  const departments =
    data.departments === undefined
      ? []
      : valuesOf(data.departments, isTicketDepartment);
  if (
    department === undefined ||
    serviceOffers === undefined ||
    departments === undefined
  )
    return undefined;

  // New capabilities are deployed independently from the web bundle. Missing
  // capability fields from an older active Function are therefore interpreted
  // as unavailable instead of making an otherwise readable historical ticket
  // impossible to open.
  const canAssign = data.canAssign === true;
  const canMerge = data.canMerge === true;
  const agents = canAssign
    ? Array.isArray(data.agents)
      ? data.agents.map(toTicketAgent)
      : undefined
    : data.agents === undefined
      ? []
      : undefined;
  const validAgents = (agents ?? []).filter(
    (agent): agent is TicketAgent => agent !== null,
  );
  if (
    agents === undefined ||
    validAgents.length !== agents.length ||
    new Set(validAgents.map((agent) => agent.id)).size !== agents.length
  ) {
    return undefined;
  }

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
  // Ein fehlendes Modulobjekt einer älteren Function bleibt deaktiviert. Die
  // UI erweitert damit niemals die serverseitig wirksame Mandantenfreigabe.
  const rawTicketModules = asRecord(data.ticketModules);
  const ticketModules = rawTicketModules
    ? {
        checklists: rawTicketModules.checklists === true,
        timeTracking: rawTicketModules.timeTracking === true,
      }
    : { checklists: false, timeTracking: false };

  const comments = Array.isArray(data.comments)
    ? data.comments
        .map(toTicketComment)
        .filter((comment): comment is TicketComment => comment !== null)
    : [];

  return {
    ticket: data.ticket,
    assignedAgent,
    requesterContact,
    department,
    serviceOffers,
    departments,
    comments,
    events: valuesOf(data.events, isTicketEvent),
    escalations,
    statuses: valuesOf(data.statuses, isTicketStatus),
    priorities: valuesOf(data.priorities, isTicketPriority),
    teams: valuesOf(data.teams, isTicketTeam),
    agents: validAgents,
    checklistItems: valuesOf(data.checklistItems, isTicketChecklistItem).sort(
      (first, second) => first.position - second.position,
    ),
    timeEntries: valuesOf(data.timeEntries, isTicketTimeEntry),
    relations,
    similarTickets,
    ticketModules,
    watching: data.watching === true,
    canUpdate: data.canUpdate === true,
    canAssign,
    canMerge,
    canExport: data.canExport === true,
    canClose: data.canClose === true,
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

function mergeErrorMessage(error: unknown, action: "search" | "merge"): string {
  const status = functionErrorStatus(error);
  if (status === 401) {
    return "Ihre Sitzung ist abgelaufen. Bitte melden Sie sich erneut an.";
  }
  if (status === 403) {
    return action === "search"
      ? "Sie sind nicht berechtigt, mögliche Haupttickets zu suchen."
      : "Sie sind nicht berechtigt, dieses Ticket zusammenzuführen.";
  }
  if (status === 404) {
    return action === "search"
      ? "Das Ticket ist nicht mehr verfügbar."
      : "Das ausgewählte Hauptticket ist nicht mehr verfügbar.";
  }
  if (status === 409) {
    return "Das Ticket wurde zwischenzeitlich geändert. Bitte laden Sie die Ticketdetails neu.";
  }
  if (status === 422) {
    return action === "search"
      ? "Die Suchanfrage ist ungültig."
      : "Dieses Ticket kann nicht in das ausgewählte Ticket zusammengeführt werden.";
  }
  return action === "search"
    ? "Die möglichen Haupttickets konnten nicht geladen werden. Bitte versuchen Sie es erneut."
    : "Das Ticket konnte nicht zusammengeführt werden. Bitte versuchen Sie es erneut.";
}

function formatDateTime(timestamp: string): string {
  const value = new Date(timestamp);
  if (Number.isNaN(value.getTime())) return timestamp;
  return new Intl.DateTimeFormat("de-CH", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

function formatFileSize(byteSize: number): string {
  if (byteSize < 1024) return `${byteSize} B`;
  const units = ["KiB", "MiB", "GiB"];
  const exponent = Math.min(
    Math.floor(Math.log(byteSize) / Math.log(1024)),
    units.length,
  );
  return `${new Intl.NumberFormat("de-CH", {
    maximumFractionDigits: 1,
  }).format(byteSize / 1024 ** exponent)} ${units[exponent - 1]}`;
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

function handoverRiskLevelLabel(riskLevel: HandoverRiskLevel): string {
  const labels: Record<HandoverRiskLevel, string> = {
    low: "Niedrig",
    medium: "Mittel",
    high: "Hoch",
  };
  return labels[riskLevel];
}

function handoverStatus(handover: TicketHandover): HandoverStatus {
  if (handover.resolvedAt) return "resolved";
  if (handover.acknowledgedAt) return "acknowledged";
  return "open";
}

function handoverStatusLabel(status: HandoverStatus): string {
  const labels: Record<HandoverStatus, string> = {
    open: "Offen",
    acknowledged: "Übernommen",
    resolved: "Erledigt",
  };
  return labels[status];
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
    "ticket.created": "Ticket erstellt",
    "comment.external_added": "Externer Kommentar hinzugefügt",
    "comment.internal_added": "Interne Notiz hinzugefügt",
    "ticket.updated": "Ticket aktualisiert",
    "ticket.closed": "Ticket abgeschlossen",
    "ticket.category_changed": "Kategorie aktualisiert",
    "ticket.knowledge.sent":
      "Wissensartikel als externe Ticketantwort versendet",
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

function parseTicketCategories(value: unknown): TicketCategory[] {
  const envelope = asRecord(value);
  const data = asRecord(envelope?.data);
  if (!data || !Array.isArray(data.categories)) {
    throw new Error("Die Kategorien fehlen in der Antwort.");
  }
  const categories = data.categories.map(toTicketCategory);
  if (
    categories.some((category) => category === null) ||
    new Set(categories.map((category) => category?.id)).size !==
      categories.length
  ) {
    throw new Error("Die Kategoriedaten sind ungültig.");
  }
  const resolved = categories.filter(
    (category): category is TicketCategory => category !== null,
  );
  const byId = new Map(resolved.map((category) => [category.id, category]));
  if (
    resolved.some(
      (category) =>
        category.parentId !== null &&
        byId.get(category.parentId)?.parentId !== null,
    )
  ) {
    throw new Error("Die Kategorien enthalten eine ungültige Hierarchie.");
  }
  return resolved;
}

function parseCreatedTicketCategory(
  value: unknown,
  parentId: string | null,
): TicketCategory {
  const envelope = asRecord(value);
  const data = asRecord(envelope?.data);
  const category = toTicketCategory(data?.category ?? data);
  if (!category || category.parentId !== parentId) {
    throw new Error("Die Bestätigung zur Kategorie ist unvollständig.");
  }
  return category;
}

async function loadTicketCategories(
  tenantId: string,
  departmentId: string,
): Promise<TicketCategory[]> {
  if (!supabase) throw new Error("Supabase ist nicht konfiguriert.");
  const { data, error } = await supabase.functions.invoke("ticket-actions", {
    body: { type: "getCategories", tenantId, departmentId },
  });
  if (error) throw error;
  return parseTicketCategories(data);
}

async function createTicketCategory(input: {
  tenantId: string;
  departmentId: string;
  name: string;
  parentId: string | null;
}): Promise<TicketCategory> {
  if (!supabase) throw new Error("Supabase ist nicht konfiguriert.");
  const { data, error } = await supabase.functions.invoke("ticket-actions", {
    body: {
      type: "createCategory",
      tenantId: input.tenantId,
      departmentId: input.departmentId,
      name: input.name,
      ...(input.parentId !== null ? { parentCategoryId: input.parentId } : {}),
    },
  });
  if (error) throw error;
  return parseCreatedTicketCategory(data, input.parentId);
}

async function invokeTicketCategorySelection(
  input: TicketCategorySelection,
): Promise<void> {
  if (!supabase) throw new Error("Supabase ist nicht konfiguriert.");
  const { error } = await supabase.functions.invoke(
    "ticket-category-selection",
    {
      body: input,
    },
  );
  if (error) throw error;
}

async function invokeTicketRequesterProfile(
  action: TicketRequesterProfileAction,
): Promise<TicketRequesterProfile | null> {
  if (!supabase) throw new Error("Supabase ist nicht konfiguriert.");
  const { data, error } = await supabase.functions.invoke(
    "ticket-requester-context",
    { body: action },
  );
  if (error) throw error;
  return parseTicketRequesterProfile(data);
}

async function invokeTicketDepartmentChange(input: {
  tenantId: string;
  ticketId: string;
  departmentId: string;
}): Promise<void> {
  if (!supabase) throw new Error("Supabase ist nicht konfiguriert.");
  const { error } = await supabase.functions.invoke(
    "ticket-department-change",
    {
      body: input,
    },
  );
  if (error) throw error;
}

async function invokeTicketAgentAssignment(
  action: TicketAgentAssignmentAction,
): Promise<unknown> {
  if (!supabase) throw new Error("Supabase ist nicht konfiguriert.");
  const { data, error } = await supabase.functions.invoke(
    "ticket-agent-assignment",
    { body: action },
  );
  if (error) throw error;
  return data;
}

async function invokeTicketPresence(
  action: TicketPresenceAction,
): Promise<unknown> {
  if (!supabase) throw new Error("Supabase ist nicht konfiguriert.");
  const { data, error } = await supabase.functions.invoke("ticket-presence", {
    body: action,
  });
  if (error) throw error;
  return data;
}

async function invokeTicketAttachmentAction(
  action: TicketAttachmentAction,
): Promise<unknown> {
  if (!supabase) throw new Error("Supabase ist nicht konfiguriert.");
  const { data, error } = await supabase.functions.invoke(
    "ticket-attachments",
    {
      body: action,
    },
  );
  if (error) throw error;
  return data;
}

async function invokeTicketFeedbackAction(
  action: TicketFeedbackAction,
): Promise<unknown> {
  if (!supabase) throw new Error("Supabase ist nicht konfiguriert.");
  const { data, error } = await supabase.functions.invoke("ticket-feedback", {
    body: action,
  });
  if (error) throw error;
  return data;
}

async function invokeTicketQualityAction(
  action: TicketQualityAction,
): Promise<unknown> {
  if (!supabase) throw new Error("Supabase ist nicht konfiguriert.");
  const { data, error } = await supabase.functions.invoke("ticket-quality", {
    body: action,
  });
  if (error) throw error;
  return data;
}

async function invokeTicketHandoverAction(
  action: TicketHandoverAction,
): Promise<unknown> {
  if (!supabase) throw new Error("Supabase ist nicht konfiguriert.");
  const { data, error } = await supabase.functions.invoke("ticket-handovers", {
    body: action,
  });
  if (error) throw error;
  return data;
}

async function invokeServiceAssetsAction(
  action: ServiceAssetsAction,
): Promise<unknown> {
  if (!supabase) throw new Error("Supabase ist nicht konfiguriert.");
  const { data, error } = await supabase.functions.invoke("service-assets", {
    body: action,
  });
  if (error) throw error;
  return data;
}

function functionErrorStatus(error: unknown): number | null {
  const value = asRecord(error);
  if (!value) return null;
  if (typeof value.status === "number") return value.status;

  const context = value.context;
  if (context instanceof Response) return context.status;
  const contextRecord = asRecord(context);
  return typeof contextRecord?.status === "number"
    ? contextRecord.status
    : null;
}

function feedbackErrorMessage(
  error: unknown,
  action: "get" | "submit",
): string {
  const status = functionErrorStatus(error);
  if (status === 403) {
    return action === "submit"
      ? "Sie sind nicht berechtigt, die Zufriedenheit für dieses Ticket zu bewerten."
      : "Die Zufriedenheitsdaten sind für dieses Ticket nicht verfügbar.";
  }
  if (status === 422) {
    return action === "submit"
      ? "Die Bewertung kann derzeit nicht abgegeben werden. Sie ist nur für ein geschlossenes Ticket möglich."
      : "Die Zufriedenheitsdaten können für dieses Ticket derzeit nicht verarbeitet werden.";
  }
  return action === "submit"
    ? "Die Bewertung konnte nicht gespeichert werden. Bitte versuchen Sie es erneut."
    : "Die Zufriedenheitsdaten konnten nicht geladen werden. Bitte versuchen Sie es erneut.";
}

function qualityErrorMessage(error: unknown, action: "get" | "submit"): string {
  const status = functionErrorStatus(error);
  if (status === 401) {
    return "Ihre Sitzung ist abgelaufen. Bitte melden Sie sich erneut an.";
  }
  if (status === 403) {
    return action === "submit"
      ? "Sie sind nicht berechtigt, für dieses Ticket eine Qualitätsprüfung abzugeben."
      : "Die Qualitätsprüfungsdaten sind für dieses Ticket nicht verfügbar.";
  }
  if (status === 409) {
    return "Die Qualitätsprüfung wurde zwischenzeitlich geändert. Bitte laden Sie die Ticketdetails neu.";
  }
  if (status === 422) {
    return action === "submit"
      ? "Die Qualitätsprüfung kann nicht gespeichert werden. Sie ist nur für geschlossene Tickets möglich und nach der ersten Abgabe höchstens 14 Tage lang änderbar."
      : "Die Qualitätsprüfungsdaten können für dieses Ticket derzeit nicht verarbeitet werden.";
  }
  if (status === 400) {
    return "Die Anfrage zur Qualitätsprüfung ist ungültig. Bitte laden Sie die Ticketdetails neu.";
  }
  return action === "submit"
    ? "Die Qualitätsprüfung konnte nicht gespeichert werden. Bitte versuchen Sie es erneut."
    : "Die Qualitätsprüfungsdaten konnten nicht geladen werden. Bitte versuchen Sie es erneut.";
}

function handoverErrorMessage(
  error: unknown,
  action: "list" | Exclude<PendingHandoverAction, null>,
): string {
  const status = functionErrorStatus(error);
  if (status === 401) {
    return "Ihre Sitzung ist abgelaufen. Bitte melden Sie sich erneut an.";
  }
  if (status === 403) {
    return action === "list"
      ? "Sie sind nicht berechtigt, die Übergaben dieses Tickets zu laden."
      : "Sie sind nicht berechtigt, Übergaben für dieses Ticket zu bearbeiten.";
  }
  if (status === 404) {
    return action === "list" || action === "create"
      ? "Das Ticket wurde nicht gefunden oder darf nicht eingesehen werden."
      : "Die Übergabe ist nicht mehr verfügbar. Bitte laden Sie die Liste erneut.";
  }
  if (status === 409) {
    return action === "acknowledge"
      ? "Die Übergabe wurde zwischenzeitlich bereits übernommen. Bitte laden Sie die Liste erneut."
      : action === "resolve"
        ? "Die Übergabe wurde zwischenzeitlich bereits als erledigt markiert. Bitte laden Sie die Liste erneut."
        : "Die Übergabeliste wurde zwischenzeitlich geändert. Bitte laden Sie sie erneut.";
  }
  if (status === 422) {
    return action === "create"
      ? "Die Übergabe konnte nicht gespeichert werden. Bitte prüfen Sie Zusammenfassung, nächste Schritte und Risikostufe."
      : "Die Übergabe konnte nicht aktualisiert werden. Bitte laden Sie die Liste erneut.";
  }
  const messages: Record<
    "list" | Exclude<PendingHandoverAction, null>,
    string
  > = {
    list: "Die Übergaben konnten nicht geladen werden. Bitte versuchen Sie es erneut.",
    create:
      "Die Übergabe konnte nicht gespeichert werden. Bitte versuchen Sie es erneut.",
    acknowledge:
      "Die Übergabe konnte nicht übernommen werden. Bitte versuchen Sie es erneut.",
    resolve:
      "Die Übergabe konnte nicht als erledigt markiert werden. Bitte versuchen Sie es erneut.",
  };
  return messages[action];
}

function affectedItemsErrorMessage(
  error: unknown,
  action: "list" | "link" | "unlink",
): string {
  const status = functionErrorStatus(error);
  if (status === 401) {
    return "Ihre Sitzung ist abgelaufen. Bitte melden Sie sich erneut an.";
  }
  if (status === 403) {
    return action === "list"
      ? "Sie sind nicht berechtigt, die betroffenen Elemente dieses Tickets zu laden."
      : "Sie sind nicht berechtigt, betroffene Elemente für dieses Ticket zu bearbeiten.";
  }
  if (status === 404) {
    return action === "unlink"
      ? "Die Verknüpfung ist nicht mehr vorhanden. Bitte laden Sie die Liste erneut."
      : "Das Ticket oder der ausgewählte Katalogeintrag ist nicht mehr verfügbar.";
  }
  if (status === 409 && action === "link") {
    return "Dieser Katalogeintrag ist bereits mit dem Ticket verknüpft.";
  }
  const messages: Record<"list" | "link" | "unlink", string> = {
    list: "Die betroffenen Elemente konnten nicht geladen werden. Bitte versuchen Sie es erneut.",
    link: "Der Katalogeintrag konnte nicht mit dem Ticket verknüpft werden. Bitte versuchen Sie es erneut.",
    unlink:
      "Die Verknüpfung konnte nicht entfernt werden. Bitte versuchen Sie es erneut.",
  };
  return messages[action];
}

function attachmentErrorMessage(
  action: Exclude<PendingAttachmentAction, null> | "list",
): string {
  const messages: Record<
    Exclude<PendingAttachmentAction, null> | "list",
    string
  > = {
    list: "Die Anhänge konnten nicht geladen werden. Bitte versuchen Sie es erneut.",
    upload:
      "Der Anhang konnte nicht hochgeladen werden. Bitte versuchen Sie es erneut.",
    download:
      "Der Anhang konnte nicht heruntergeladen werden. Bitte versuchen Sie es erneut.",
    delete:
      "Der Anhang konnte nicht gelöscht werden. Bitte versuchen Sie es erneut.",
  };
  return messages[action];
}

type KnowledgeArticle = {
  id: string;
  title: string;
  visibility: CommentVisibility;
  body: string;
  summary: string | null;
};

type KnowledgeLinkState = {
  articleId: string;
  visibility: CommentVisibility;
  attachedAt: string;
  sentAt: string | null;
};

type KnowledgeLink = KnowledgeLinkState & { article: KnowledgeArticle };
type KnowledgeReference = { tenantId: string; ticketId: string };
type KnowledgeMutation = KnowledgeReference &
  (
    | { type: "attach"; articleId: string; visibility: CommentVisibility }
    | { type: "detach" | "sendToRequester"; articleId: string }
    | {
        type: "createAndAttach";
        title: string;
        bodyMarkdown: string;
        visibility: CommentVisibility;
      }
  );
type TicketKnowledgeAction =
  | KnowledgeMutation
  | (KnowledgeReference &
      ({ type: "list" } | { type: "searchArticles"; query: string }));
type KnowledgeSendConfirmation =
  | { kind: "article"; articleId: string; title: string }
  | { kind: "draft"; title: string; bodyMarkdown: string };

function isKnowledgeVisibility(value: unknown): value is CommentVisibility {
  return value === "internal" || value === "external";
}

function isKnowledgeText(
  value: unknown,
  min: number,
  max: number,
): value is string {
  return (
    typeof value === "string" &&
    !value.includes("\u0000") &&
    !/\p{Cs}/u.test(value) &&
    [...value].length >= min &&
    [...value].length <= max
  );
}

function isKnowledgeTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    ) &&
    Number.isFinite(Date.parse(value))
  );
}

/** Allowlist the article contract; never retain actor, profile or email fields. */
function parseKnowledgeArticle(value: unknown): KnowledgeArticle | null {
  const article = asRecord(value);
  if (
    !article ||
    !hasOnlyKeys(article, ["id", "title", "visibility", "body", "summary"]) ||
    !isUuid(article.id) ||
    !isKnowledgeText(article.title, 3, 240) ||
    !article.title.trim() ||
    !isKnowledgeVisibility(article.visibility) ||
    !isKnowledgeText(article.body, 0, 100_000) ||
    (article.summary !== null && !isKnowledgeText(article.summary, 0, 100_000))
  ) {
    return null;
  }
  return {
    id: article.id,
    title: article.title,
    visibility: article.visibility,
    body: article.body,
    summary: article.summary,
  };
}

function parseKnowledgeData(value: unknown): Record<string, unknown> | null {
  const envelope = asRecord(value);
  return envelope && hasOnlyKeys(envelope, ["data"])
    ? asRecord(envelope.data)
    : null;
}

function parseKnowledgeLinkState(value: unknown): KnowledgeLinkState | null {
  const link = asRecord(value);
  if (
    !link ||
    !hasOnlyKeys(link, ["articleId", "visibility", "attachedAt", "sentAt"]) ||
    !isUuid(link.articleId) ||
    !isKnowledgeVisibility(link.visibility) ||
    !isKnowledgeTimestamp(link.attachedAt) ||
    (link.sentAt !== null && !isKnowledgeTimestamp(link.sentAt))
  ) {
    return null;
  }
  return {
    articleId: link.articleId,
    visibility: link.visibility,
    attachedAt: link.attachedAt,
    sentAt: link.sentAt,
  };
}

function parseKnowledgeLinks(value: unknown): KnowledgeLink[] | null {
  const data = parseKnowledgeData(value);
  if (!data || !hasOnlyKeys(data, ["links"]) || !Array.isArray(data.links))
    return null;
  const links: KnowledgeLink[] = [];
  const seen = new Set<string>();
  for (const value of data.links) {
    const record = asRecord(value);
    if (
      !record ||
      !hasOnlyKeys(record, [
        "articleId",
        "visibility",
        "attachedAt",
        "sentAt",
        "article",
      ])
    ) {
      return null;
    }
    const link = parseKnowledgeLinkState({
      articleId: record.articleId,
      visibility: record.visibility,
      attachedAt: record.attachedAt,
      sentAt: record.sentAt,
    });
    const article = parseKnowledgeArticle(record.article);
    if (
      !link ||
      !article ||
      link.articleId !== article.id ||
      seen.has(article.id) ||
      (link.visibility === "external" && article.visibility !== "external")
    ) {
      return null;
    }
    seen.add(article.id);
    links.push({ ...link, article });
  }
  return links;
}

function parseKnowledgeSearch(value: unknown): KnowledgeArticle[] | null {
  const data = parseKnowledgeData(value);
  if (
    !data ||
    !hasOnlyKeys(data, ["articles"]) ||
    !Array.isArray(data.articles) ||
    data.articles.length > 30
  )
    return null;
  const articles = data.articles.map(parseKnowledgeArticle);
  if (
    !articles.every(
      (article): article is KnowledgeArticle => article !== null,
    ) ||
    new Set(articles.map((article) => article.id)).size !== articles.length
  )
    return null;
  return articles;
}

function parseKnowledgeMutation(
  value: unknown,
  action: KnowledgeMutation,
): { articleId: string; sentAt: string | null } | null {
  const data = parseKnowledgeData(value);
  if (!data) return null;
  if (action.type === "attach" || action.type === "createAndAttach") {
    if (!hasOnlyKeys(data, ["link"])) return null;
    const link = parseKnowledgeLinkState(data.link);
    if (
      !link ||
      link.visibility !== action.visibility ||
      (action.type === "attach" && link.articleId !== action.articleId) ||
      (action.type === "createAndAttach" && link.sentAt !== null)
    )
      return null;
    return { articleId: link.articleId, sentAt: link.sentAt };
  }
  if (action.type === "detach") {
    return hasOnlyKeys(data, ["detached", "articleId"]) &&
      data.detached === true &&
      data.articleId === action.articleId
      ? { articleId: action.articleId, sentAt: null }
      : null;
  }
  if (data.articleId !== action.articleId || !isKnowledgeTimestamp(data.sentAt))
    return null;
  if (
    data.alreadySent === true &&
    hasOnlyKeys(data, ["articleId", "sentAt", "alreadySent"])
  ) {
    return { articleId: action.articleId, sentAt: data.sentAt };
  }
  return data.alreadySent === false &&
    isUuid(data.commentId) &&
    hasOnlyKeys(data, ["articleId", "commentId", "sentAt", "alreadySent"])
    ? { articleId: action.articleId, sentAt: data.sentAt }
    : null;
}

async function invokeTicketKnowledge(
  action: TicketKnowledgeAction,
): Promise<unknown> {
  if (!supabase) throw new Error("Supabase ist nicht konfiguriert.");
  const { data, error } = await supabase.functions.invoke("ticket-knowledge", {
    body: action,
  });
  if (error) throw error;
  return data;
}

function knowledgeErrorMessage(
  error: unknown,
  action: TicketKnowledgeAction["type"],
): string {
  const status = functionErrorStatus(error);
  if (status === 401)
    return "Ihre Sitzung ist abgelaufen. Bitte melden Sie sich erneut an.";
  if (status === 403)
    return action === "createAndAttach"
      ? "Sie sind nicht berechtigt, Wissensartikel zu erstellen. Dafür ist zusätzlich die Berechtigung zur Wissensverwaltung erforderlich."
      : "Sie sind nicht berechtigt, diesen Wissensvorgang auszuführen.";
  if (status === 404)
    return "Das Ticket oder der Artikel ist nicht mehr verfügbar oder darf nicht eingesehen werden.";
  if (status === 409)
    return "Der Artikel ist bereits mit einer anderen Sichtbarkeit angehängt. Bitte prüfen Sie die aktualisierte Liste.";
  if (status === 413)
    return "Der Artikeltext ist zu groß. Bitte kürzen Sie den Text.";
  if (status === 422)
    return action === "sendToRequester"
      ? "Nur veröffentlichte externe Artikel mit externer Verknüpfung und höchstens 50'000 Zeichen können versendet werden. Bitte prüfen Sie die aktualisierte Liste."
      : "Die Wissensanfrage ist ungültig. Bitte prüfen Sie Text, Sichtbarkeit und Artikelauswahl.";
  const messages: Record<TicketKnowledgeAction["type"], string> = {
    list: "Die angehängten Wissensartikel konnten nicht geladen werden. Bitte versuchen Sie es erneut.",
    searchArticles:
      "Die Artikelsuche ist fehlgeschlagen. Bitte versuchen Sie es erneut.",
    attach:
      "Der Artikel konnte nicht angehängt werden. Bitte prüfen Sie die Liste und versuchen Sie es erneut.",
    detach:
      "Die Verknüpfung konnte nicht entfernt werden. Bitte prüfen Sie die Liste und versuchen Sie es erneut.",
    createAndAttach:
      "Der Artikel konnte nicht bestätigt werden. Bitte prüfen Sie vor einem erneuten Erstellen die aktualisierte Liste.",
    sendToRequester:
      "Der Versand konnte nicht bestätigt werden. Bitte prüfen Sie den Versandstatus, bevor Sie es erneut versuchen.",
  };
  // Do not render untrusted API/database messages, which may contain personal data.
  return messages[action];
}

function KnowledgeSection({
  tenantId,
  ticketId,
  canUpdate,
  canUseInternalNotes,
  refreshToken,
  onChanged,
  onSent,
}: KnowledgeReference & {
  canUpdate: boolean;
  canUseInternalNotes: boolean;
  refreshToken: TicketDetailData;
  onChanged: () => void;
  onSent: () => Promise<boolean>;
}) {
  const [links, setLinks] = useState<KnowledgeLink[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [query, setQuery] = useState("");
  const [articles, setArticles] = useState<KnowledgeArticle[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [searchRevision, setSearchRevision] = useState(0);
  const [title, setTitle] = useState("");
  const [bodyMarkdown, setBodyMarkdown] = useState("");
  const [visibility, setVisibility] = useState<CommentVisibility>(
    canUseInternalNotes ? "internal" : "external",
  );
  const [confirmation, setConfirmation] =
    useState<KnowledgeSendConfirmation | null>(null);
  const [pending, setPending] = useState<KnowledgeMutation["type"] | null>(
    null,
  );
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const listSequence = useRef(0);
  const searchSequence = useRef(0);
  const scopeSequence = useRef(0);
  const inFlight = useRef(false);
  const permissions = useRef({ canUpdate, canUseInternalNotes });
  permissions.current = { canUpdate, canUseInternalNotes };
  const knowledgeBusy = pending !== null;

  const loadLinks = useCallback(async () => {
    const requestId = ++listSequence.current;
    setListLoading(true);
    setListError("");
    // Clear stale content, including articles whose visibility may have changed.
    setLinks([]);
    try {
      const result = parseKnowledgeLinks(
        await invokeTicketKnowledge({ type: "list", tenantId, ticketId }),
      );
      if (!result) throw new Error("Ungültige Wissensantwort.");
      if (requestId !== listSequence.current) return;
      setLinks(result);
    } catch (error) {
      if (requestId === listSequence.current)
        setListError(knowledgeErrorMessage(error, "list"));
    } finally {
      if (requestId === listSequence.current) setListLoading(false);
    }
  }, [tenantId, ticketId]);

  useEffect(() => {
    scopeSequence.current += 1;
    return () => {
      scopeSequence.current += 1;
      listSequence.current += 1;
      searchSequence.current += 1;
    };
  }, []);

  useEffect(() => {
    setConfirmation(null);
    void loadLinks();
    return () => {
      listSequence.current += 1;
    };
  }, [loadLinks, refreshToken, canUseInternalNotes]);

  useEffect(() => {
    setConfirmation(null);
    if (!canUseInternalNotes) {
      if (visibility === "internal") {
        setTitle("");
        setBodyMarkdown("");
      }
      setVisibility("external");
    }
  }, [canUpdate, canUseInternalNotes]);

  useEffect(() => {
    const requestId = ++searchSequence.current;
    const text = query.trim();
    setArticles([]);
    setSearchError("");
    setSearchLoading(false);
    if (!canUpdate || [...text].length < 2) return;
    if (!isKnowledgeText(text, 2, 120)) {
      setSearchError(
        "Bitte geben Sie zwischen 2 und 120 gültige Zeichen für die Suche ein.",
      );
      return;
    }
    setSearchLoading(true);
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const result = parseKnowledgeSearch(
            await invokeTicketKnowledge({
              type: "searchArticles",
              tenantId,
              ticketId,
              query: text,
            }),
          );
          if (!result) throw new Error("Ungültige Suchantwort.");
          if (requestId === searchSequence.current) setArticles(result);
        } catch (error) {
          if (requestId === searchSequence.current)
            setSearchError(knowledgeErrorMessage(error, "searchArticles"));
        } finally {
          if (requestId === searchSequence.current) setSearchLoading(false);
        }
      })();
    }, 250);
    return () => {
      window.clearTimeout(timer);
      searchSequence.current += 1;
    };
  }, [
    query,
    tenantId,
    ticketId,
    canUpdate,
    canUseInternalNotes,
    searchRevision,
    refreshToken,
  ]);

  const visibleLinks = links.filter(
    (link) =>
      canUseInternalNotes ||
      (link.visibility === "external" &&
        link.article.visibility === "external"),
  );
  const visibleArticles = articles.filter(
    (article) => canUseInternalNotes || article.visibility === "external",
  );

  function validDraft(send: boolean): boolean {
    if (!canUpdate || inFlight.current) return false;
    if (visibility === "internal" && !canUseInternalNotes) {
      setActionError("Sie sind nicht berechtigt, interne Artikel anzuhängen.");
      return false;
    }
    if (!isKnowledgeText(title.trim(), 3, 240)) {
      setActionError(
        "Der Titel muss zwischen 3 und 240 gültige Zeichen lang sein.",
      );
      return false;
    }
    if (!isKnowledgeText(bodyMarkdown, 1, 100_000) || !bodyMarkdown.trim()) {
      setActionError(
        "Der Artikeltext muss zwischen 1 und 100'000 gültige Zeichen enthalten und darf nicht leer sein.",
      );
      return false;
    }
    if (
      send &&
      (visibility !== "external" || [...bodyMarkdown].length > 50_000)
    ) {
      setActionError(
        "Der Versand erfordert einen externen Artikel mit höchstens 50'000 Zeichen.",
      );
      return false;
    }
    setActionError("");
    return true;
  }

  async function runMutation(action: KnowledgeMutation, sendCreated = false) {
    if (!permissions.current.canUpdate || inFlight.current || listLoading)
      return;
    if (
      (action.type === "attach" || action.type === "createAndAttach") &&
      action.visibility === "internal" &&
      !permissions.current.canUseInternalNotes
    )
      return;
    if (
      action.type === "sendToRequester" &&
      (confirmation?.kind !== "article" ||
        confirmation.articleId !== action.articleId)
    )
      return;
    if (
      sendCreated &&
      (confirmation?.kind !== "draft" ||
        action.type !== "createAndAttach" ||
        action.visibility !== "external" ||
        action.title !== confirmation.title ||
        action.bodyMarkdown !== confirmation.bodyMarkdown)
    )
      return;
    if (
      action.type === "sendToRequester" &&
      !visibleLinks.some(
        (link) =>
          link.articleId === action.articleId &&
          link.visibility === "external" &&
          link.article.visibility === "external" &&
          link.sentAt === null,
      )
    )
      return;

    inFlight.current = true;
    const scope = scopeSequence.current;
    setPending(action.type);
    setConfirmation(null); // Every retry needs a fresh explicit confirmation.
    setActionError("");
    setNotice("");
    let currentAction: TicketKnowledgeAction["type"] = action.type;
    let created = false;
    try {
      const result = parseKnowledgeMutation(
        await invokeTicketKnowledge(action),
        action,
      );
      if (scope !== scopeSequence.current) return;
      if (!result) throw new Error("Ungültige Wissensantwort.");
      if (action.type === "createAndAttach") {
        created = true;
        setTitle("");
        setBodyMarkdown("");
      }
      if (sendCreated) {
        // Creation only attaches. Sending is a separate, explicitly confirmed API call.
        currentAction = "sendToRequester";
        if (
          !permissions.current.canUpdate ||
          action.type !== "createAndAttach" ||
          action.visibility !== "external"
        ) {
          throw new Error("Versandberechtigung geändert.");
        }
        setPending("sendToRequester");
        const sendAction: KnowledgeMutation = {
          type: "sendToRequester",
          tenantId,
          ticketId,
          articleId: result.articleId,
        };
        const sent = parseKnowledgeMutation(
          await invokeTicketKnowledge(sendAction),
          sendAction,
        );
        if (scope !== scopeSequence.current) return;
        if (!sent) throw new Error("Ungültige Versandantwort.");
      }
      setNotice(
        action.type === "sendToRequester" || sendCreated
          ? "Der Artikeltext wurde als externe Ticketantwort versendet."
          : action.type === "detach"
            ? "Die Artikelverknüpfung wurde entfernt. Bereits versendete Ticketantworten bleiben bestehen."
            : action.type === "createAndAttach"
              ? "Der Artikel wurde erstellt und angehängt. Es wurde keine Ticketantwort versendet."
              : "Der Artikel wurde angehängt. Es wurde keine Ticketantwort versendet.",
      );
    } catch (error) {
      if (scope === scopeSequence.current)
        setActionError(
          (created && sendCreated
            ? "Der Artikel wurde erstellt und extern angehängt. "
            : "") + knowledgeErrorMessage(error, currentAction),
        );
    } finally {
      if (scope === scopeSequence.current) {
        // Refresh even after an uncertain response: the transaction may have committed.
        onChanged();
        await Promise.all([
          loadLinks(),
          action.type === "sendToRequester" || sendCreated
            ? onSent()
            : Promise.resolve(),
        ]);
        if (scope === scopeSequence.current) {
          setSearchRevision((revision) => revision + 1);
          setPending(null);
          inFlight.current = false;
        }
      }
    }
  }

  function createArticle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validDraft(false)) return;
    void runMutation({
      type: "createAndAttach",
      tenantId,
      ticketId,
      title: title.trim(),
      bodyMarkdown,
      visibility,
    });
  }

  function requestDraftSend() {
    if (!validDraft(true) || listLoading) return;
    setNotice("");
    setConfirmation({ kind: "draft", title: title.trim(), bodyMarkdown });
  }

  function confirmSend() {
    if (!confirmation || !canUpdate || knowledgeBusy || listLoading) return;
    if (confirmation.kind === "article") {
      void runMutation({
        type: "sendToRequester",
        tenantId,
        ticketId,
        articleId: confirmation.articleId,
      });
    } else if (
      visibility === "external" &&
      title.trim() === confirmation.title &&
      bodyMarkdown === confirmation.bodyMarkdown &&
      validDraft(true)
    ) {
      void runMutation(
        {
          type: "createAndAttach",
          tenantId,
          ticketId,
          title: confirmation.title,
          bodyMarkdown: confirmation.bodyMarkdown,
          visibility: "external",
        },
        true,
      );
    }
  }

  return (
    <section
      className="ticket-detail-comments"
      aria-labelledby="ticket-knowledge-heading"
      aria-busy={listLoading || knowledgeBusy}
    >
      <div className="ticket-detail-section-heading">
        <div>
          <p className="eyebrow">WISSEN</p>
          <h3 id="ticket-knowledge-heading">Wissen</h3>
        </div>
        <button
          className="secondary-button"
          type="button"
          disabled={listLoading || knowledgeBusy}
          onClick={() => {
            setConfirmation(null);
            setSearchRevision((revision) => revision + 1);
            void loadLinks();
          }}
        >
          <RefreshCw aria-hidden="true" size={16} />
          Wissen aktualisieren
        </button>
      </div>
      <p className="data-caption" id="ticket-knowledge-help">
        Anhängen allein versendet keine Antwort. Interne Verknüpfungen sind nur
        mit Berechtigung sichtbar. Bitte keine Namen, E-Mail-Adressen oder
        personenbezogenen Kennungen in neue Artikel übernehmen.
      </p>
      {listError && (
        <p className="ticket-detail-message error" role="alert">
          {listError}
        </p>
      )}
      {actionError && (
        <p className="ticket-detail-message error" role="alert">
          {actionError}
        </p>
      )}
      {notice && (
        <p className="data-caption" role="status">
          {notice}
        </p>
      )}
      {listLoading ? (
        <p className="empty-state" role="status">
          Wissensartikel werden geladen …
        </p>
      ) : !listError && visibleLinks.length === 0 ? (
        <p className="empty-state">Noch keine sichtbaren Artikel angehängt.</p>
      ) : null}
      {visibleLinks.length > 0 && (
        <ul
          className="ticket-comment-list"
          aria-label="Angehängte Wissensartikel"
        >
          {visibleLinks.map((link) => (
            <li className="ticket-comment" key={link.articleId}>
              <div className="ticket-comment-meta">
                <strong>{link.article.title}</strong>
                <span
                  className={`ticket-comment-visibility-badge ${link.article.visibility}`}
                >
                  Artikel:{" "}
                  {link.article.visibility === "internal" ? "Intern" : "Extern"}
                </span>
                <span
                  className={`ticket-comment-visibility-badge ${link.visibility}`}
                >
                  Angehängt:{" "}
                  {link.visibility === "internal" ? "Intern" : "Extern"}
                </span>
                <span className="data-caption">
                  {link.sentAt
                    ? `Versendet am ${formatDateTime(link.sentAt)}`
                    : "Noch nicht versendet"}
                </span>
              </div>
              {canUpdate && (
                <div className="ticket-detail-actions">
                  {link.visibility === "external" &&
                    link.article.visibility === "external" &&
                    !link.sentAt && (
                      <button
                        className="secondary-button"
                        type="button"
                        disabled={
                          knowledgeBusy ||
                          listLoading ||
                          !link.article.body.trim() ||
                          [...link.article.body].length > 50_000
                        }
                        onClick={() => {
                          setActionError("");
                          setNotice("");
                          setConfirmation({
                            kind: "article",
                            articleId: link.articleId,
                            title: link.article.title,
                          });
                        }}
                      >
                        <Send aria-hidden="true" size={16} />
                        An anfragende Person versenden …
                      </button>
                    )}
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={knowledgeBusy || listLoading}
                    onClick={() =>
                      void runMutation({
                        type: "detach",
                        tenantId,
                        ticketId,
                        articleId: link.articleId,
                      })
                    }
                  >
                    Verknüpfung entfernen
                  </button>
                </div>
              )}
              {canUpdate &&
                link.visibility === "external" &&
                !link.sentAt &&
                [...link.article.body].length > 50_000 && (
                  <p className="data-caption">
                    Dieser Artikeltext ist für eine Ticketantwort zu lang
                    (höchstens 50'000 Zeichen).
                  </p>
                )}
            </li>
          ))}
        </ul>
      )}
      {canUpdate ? (
        <>
          <label className="ticket-comment-body">
            Artikel suchen
            <input
              type="search"
              value={query}
              maxLength={120}
              disabled={knowledgeBusy}
              aria-describedby="ticket-knowledge-search-help"
              onChange={(event) => {
                setQuery(event.target.value);
                setConfirmation(null);
              }}
              placeholder="Mindestens 2 Zeichen"
            />
          </label>
          <p className="data-caption" id="ticket-knowledge-search-help">
            Die Suche startet ab 2 Zeichen. Nur externe Artikel können als
            Kundenantwort angehängt werden; das versendet noch keine Antwort.
          </p>
          {searchError && (
            <p className="ticket-detail-message error" role="alert">
              {searchError}
            </p>
          )}
          {searchLoading && (
            <p className="data-caption" role="status">
              Artikel werden gesucht …
            </p>
          )}
          {!searchLoading &&
            !searchError &&
            [...query.trim()].length >= 2 &&
            visibleArticles.length === 0 && (
              <p className="empty-state">Keine sichtbaren Artikel gefunden.</p>
            )}
          {visibleArticles.length > 0 && (
            <ul
              className="ticket-comment-list"
              aria-label="Gefundene Wissensartikel"
            >
              {visibleArticles.map((article) => {
                const attached = visibleLinks.some(
                  (link) => link.articleId === article.id,
                );
                return (
                  <li className="ticket-comment" key={article.id}>
                    <div className="ticket-comment-meta">
                      <strong>{article.title}</strong>
                      <span
                        className={`ticket-comment-visibility-badge ${article.visibility}`}
                      >
                        {article.visibility === "internal"
                          ? "Intern"
                          : "Extern"}
                      </span>
                    </div>
                    {attached ? (
                      <p className="data-caption">Bereits angehängt.</p>
                    ) : (
                      <div className="ticket-detail-actions">
                        {canUseInternalNotes && (
                          <button
                            className="secondary-button"
                            type="button"
                            disabled={knowledgeBusy || listLoading}
                            onClick={() =>
                              void runMutation({
                                type: "attach",
                                tenantId,
                                ticketId,
                                articleId: article.id,
                                visibility: "internal",
                              })
                            }
                          >
                            Anhängen intern
                          </button>
                        )}
                        {article.visibility === "external" && (
                          <button
                            className="secondary-button"
                            type="button"
                            disabled={knowledgeBusy || listLoading}
                            onClick={() =>
                              void runMutation({
                                type: "attach",
                                tenantId,
                                ticketId,
                                articleId: article.id,
                                visibility: "external",
                              })
                            }
                          >
                            Als Kundenantwort anhängen
                          </button>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <form
            className="ticket-comment-form"
            aria-labelledby="ticket-knowledge-create-heading"
            onSubmit={createArticle}
          >
            <h4 id="ticket-knowledge-create-heading">
              Neuen Artikel aus Ticket
            </h4>
            <label className="ticket-comment-body">
              Titel
              <input
                value={title}
                required
                minLength={3}
                maxLength={240}
                disabled={knowledgeBusy}
                aria-describedby="ticket-knowledge-help"
                onChange={(event) => {
                  setTitle(event.target.value);
                  setConfirmation(null);
                }}
              />
            </label>
            <label className="ticket-comment-body">
              Text (Markdown)
              <textarea
                value={bodyMarkdown}
                required
                maxLength={100000}
                rows={3}
                disabled={knowledgeBusy}
                aria-describedby="ticket-knowledge-help"
                onChange={(event) => {
                  setBodyMarkdown(event.target.value);
                  setConfirmation(null);
                }}
              />
            </label>
            <label>
              Sichtbarkeit
              <select
                value={visibility}
                disabled={knowledgeBusy}
                onChange={(event) => {
                  if (
                    isKnowledgeVisibility(event.target.value) &&
                    (event.target.value === "external" || canUseInternalNotes)
                  ) {
                    setVisibility(event.target.value);
                    setConfirmation(null);
                  }
                }}
              >
                {canUseInternalNotes && (
                  <option value="internal">Intern</option>
                )}
                <option value="external">Extern (veröffentlicht)</option>
              </select>
            </label>
            <p className="data-caption">
              {visibility === "internal"
                ? "Der interne Artikel wird nur angehängt und nicht versendet."
                : "Externe Artikel werden veröffentlicht. Die anfragende Person kann die externe Verknüpfung sehen; ein Versand erfolgt nur nach gesonderter Bestätigung."}{" "}
              Die Erstellung erfordert zusätzlich die Berechtigung zur
              Wissensverwaltung.
            </p>
            <div className="ticket-detail-actions">
              <button
                className="secondary-button"
                type="submit"
                disabled={knowledgeBusy || listLoading}
              >
                {visibility === "internal"
                  ? "Artikel erstellen und intern anhängen"
                  : "Extern erstellen und anhängen (ohne Versand)"}
              </button>
              {visibility === "external" && (
                <button
                  className="secondary-button"
                  type="button"
                  disabled={knowledgeBusy || listLoading}
                  onClick={requestDraftSend}
                >
                  Erstellen und als Kundenantwort versenden …
                </button>
              )}
            </div>
          </form>
        </>
      ) : (
        <p className="data-caption">Sie haben für Wissen nur Leserechte.</p>
      )}
      {canUpdate && confirmation && (
        <div
          className="ticket-comment"
          role="group"
          aria-labelledby="ticket-knowledge-send-heading"
          aria-describedby="ticket-knowledge-send-warning"
        >
          <h4 id="ticket-knowledge-send-heading">
            Versand ausdrücklich bestätigen
          </h4>
          <p>
            <strong>{confirmation.title}</strong>
          </p>
          <p id="ticket-knowledge-send-warning">
            Der vollständige{" "}
            {confirmation.kind === "article"
              ? "aktuelle Artikeltext"
              : "oben eingegebene Artikeltext"}{" "}
            wird als{" "}
            <strong>externe Ticketantwort an die anfragende Person</strong>{" "}
            versendet. Dies ist keine interne Notiz.{" "}
            {confirmation.kind === "draft"
              ? "Der Artikel wird außerdem extern veröffentlicht und angehängt."
              : "Bitte prüfen Sie, dass der Artikeltext für die anfragende Person bestimmt ist."}
          </p>
          <div className="ticket-detail-actions">
            <button
              className="primary-button"
              type="button"
              disabled={knowledgeBusy || listLoading}
              onClick={confirmSend}
            >
              <Send aria-hidden="true" size={16} />
              Ja, Artikeltext als externe Ticketantwort versenden
            </button>
            <button
              className="secondary-button"
              type="button"
              disabled={knowledgeBusy}
              onClick={() => setConfirmation(null)}
            >
              Abbrechen – nicht versenden
            </button>
          </div>
        </div>
      )}
      {knowledgeBusy && (
        <p className="data-caption" role="status">
          {pending === "sendToRequester"
            ? "Externe Ticketantwort wird versendet …"
            : "Wissensvorgang wird verarbeitet …"}
        </p>
      )}
    </section>
  );
}

export function TicketDetail({
  currentUserId,
  tenantId,
  ticketId,
  onClose,
  onChanged,
}: TicketDetailProps) {
  const [detail, setDetail] = useState<TicketDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [presence, setPresence] = useState<TicketPresencePerson[]>([]);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [statusKey, setStatusKey] = useState("");
  const [pendingCloseConfirmation, setPendingCloseConfirmation] =
    useState<PendingCloseConfirmation | null>(null);
  const [priorityKey, setPriorityKey] = useState("");
  const [isEditingTicket, setIsEditingTicket] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [editSubject, setEditSubject] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [selectedDepartmentId, setSelectedDepartmentId] = useState("");
  const [requesterProfile, setRequesterProfile] =
    useState<TicketRequesterProfile | null>(null);
  const [requesterDepartment, setRequesterDepartment] = useState("");
  const [requesterOffer, setRequesterOffer] = useState("");
  const [requesterProfileBusy, setRequesterProfileBusy] = useState(false);
  const [assignableAgents, setAssignableAgents] = useState<TicketAgent[]>([]);
  const [assignableAgentsLoading, setAssignableAgentsLoading] = useState(false);
  const [assignableAgentsError, setAssignableAgentsError] = useState("");
  const [comment, setComment] = useState("");
  const [commentVisibility, setCommentVisibility] =
    useState<CommentVisibility>("internal");
  const [isWorkToolsOpen, setIsWorkToolsOpen] = useState(false);
  const [ticketCategories, setTicketCategories] = useState<TicketCategory[]>(
    [],
  );
  const [ticketCategoriesLoading, setTicketCategoriesLoading] = useState(false);
  const [ticketCategoryDraft, setTicketCategoryDraft] =
    useState<TicketCategoryDraft | null>(null);
  const [ticketCategorySaving, setTicketCategorySaving] = useState(false);
  const [ticketCategoryError, setTicketCategoryError] = useState("");
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
  const [mergeQuery, setMergeQuery] = useState("");
  const [mergeTargets, setMergeTargets] = useState<MergeSearchTarget[]>([]);
  const [mergeSearchLoading, setMergeSearchLoading] = useState(false);
  const [mergeError, setMergeError] = useState("");
  const [mergeConfirmationTarget, setMergeConfirmationTarget] =
    useState<MergeSearchTarget | null>(null);
  const [pendingChecklistItemId, setPendingChecklistItemId] = useState<
    string | null
  >(null);
  const [pendingRelationKey, setPendingRelationKey] = useState<string | null>(
    null,
  );
  const [pendingEscalationId, setPendingEscalationId] = useState<string | null>(
    null,
  );
  const [attachments, setAttachments] = useState<TicketAttachment[]>([]);
  const [attachmentsLoading, setAttachmentsLoading] = useState(false);
  const [attachmentsLoaded, setAttachmentsLoaded] = useState(false);
  const [attachmentError, setAttachmentError] = useState("");
  const [selectedAttachmentFile, setSelectedAttachmentFile] =
    useState<File | null>(null);
  const [pendingAttachmentAction, setPendingAttachmentAction] =
    useState<PendingAttachmentAction>(null);
  const [pendingAttachmentId, setPendingAttachmentId] = useState<string | null>(
    null,
  );
  const [feedback, setFeedback] = useState<TicketFeedbackData | null>(null);
  const [feedbackLoading, setFeedbackLoading] = useState(true);
  const [feedbackError, setFeedbackError] = useState("");
  const [feedbackScore, setFeedbackScore] = useState<number | null>(null);
  const [feedbackComment, setFeedbackComment] = useState("");
  const [feedbackSuccess, setFeedbackSuccess] = useState("");
  const [quality, setQuality] = useState<TicketQualityData | null>(null);
  const [qualityLoading, setQualityLoading] = useState(true);
  const [qualityError, setQualityError] = useState("");
  const [qualityScore, setQualityScore] = useState<number | null>(null);
  const [qualityNotes, setQualityNotes] = useState("");
  const [qualitySuccess, setQualitySuccess] = useState("");
  const [handovers, setHandovers] = useState<TicketHandover[]>([]);
  const [handoversLoading, setHandoversLoading] = useState(false);
  const [handoversLoaded, setHandoversLoaded] = useState(false);
  const [handoverError, setHandoverError] = useState("");
  const [handoverSummary, setHandoverSummary] = useState("");
  const [handoverNextSteps, setHandoverNextSteps] = useState("");
  const [handoverRiskLevel, setHandoverRiskLevel] =
    useState<HandoverRiskLevel>("medium");
  const [pendingHandoverAction, setPendingHandoverAction] =
    useState<PendingHandoverAction>(null);
  const [pendingHandoverId, setPendingHandoverId] = useState<string | null>(
    null,
  );
  const [catalog, setCatalog] = useState<TicketCatalog>(emptyTicketCatalog);
  const [linkedCatalogItems, setLinkedCatalogItems] = useState<
    LinkedCatalogItem[]
  >([]);
  const [affectedItemsLoading, setAffectedItemsLoading] = useState(false);
  const [affectedItemsLoaded, setAffectedItemsLoaded] = useState(false);
  const [affectedItemsError, setAffectedItemsError] = useState("");
  const [selectedCatalogItemKey, setSelectedCatalogItemKey] = useState("");
  const [pendingCatalogAction, setPendingCatalogAction] =
    useState<PendingCatalogAction>(null);
  const [pendingCatalogItemKey, setPendingCatalogItemKey] = useState<
    string | null
  >(null);
  const requestSequence = useRef(0);
  const attachmentRequestSequence = useRef(0);
  const feedbackRequestSequence = useRef(0);
  const qualityRequestSequence = useRef(0);
  const handoverRequestSequence = useRef(0);
  const affectedItemsRequestSequence = useRef(0);
  const mergeSearchRequestSequence = useRef(0);
  const assignableAgentsRequestSequence = useRef(0);
  const ticketCategoriesRequestSequence = useRef(0);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const ticketIsClosed = Boolean(
    detail?.statuses.some(
      (status) => status.id === detail.ticket.status_id && status.is_closed,
    ),
  );

  const loadFeedback = useCallback(async () => {
    const requestId = ++feedbackRequestSequence.current;
    setFeedbackLoading(true);
    setFeedbackError("");
    setFeedback(null);

    try {
      const response = await invokeTicketFeedbackAction({
        type: "get",
        tenantId,
        ticketId,
      });
      const nextFeedback = parseTicketFeedback(response);
      if (!nextFeedback) {
        throw new Error("Die Zufriedenheitsdaten sind unvollständig.");
      }
      if (requestId !== feedbackRequestSequence.current) return false;

      setFeedback(nextFeedback);
      setFeedbackScore(nextFeedback.satisfaction?.score ?? null);
      setFeedbackComment(nextFeedback.satisfaction?.comment ?? "");
      return true;
    } catch (nextError) {
      if (requestId === feedbackRequestSequence.current) {
        setFeedback(null);
        setFeedbackError(feedbackErrorMessage(nextError, "get"));
      }
      return false;
    } finally {
      if (requestId === feedbackRequestSequence.current) {
        setFeedbackLoading(false);
      }
    }
  }, [tenantId, ticketId]);

  const loadQuality = useCallback(async () => {
    const requestId = ++qualityRequestSequence.current;
    setQualityLoading(true);
    setQualityError("");
    setQuality(null);

    try {
      const response = await invokeTicketQualityAction({
        type: "get",
        tenantId,
        ticketId,
      });
      const nextQuality = parseTicketQuality(response);
      if (!nextQuality) {
        throw new Error("Die Qualitätsprüfungsdaten sind unvollständig.");
      }
      if (requestId !== qualityRequestSequence.current) return false;

      setQuality(nextQuality);
      setQualityScore(
        nextQuality.canReview ? (nextQuality.ownReview?.score ?? null) : null,
      );
      setQualityNotes(
        nextQuality.canReview ? (nextQuality.ownReview?.notes ?? "") : "",
      );
      return true;
    } catch (nextError) {
      if (requestId === qualityRequestSequence.current) {
        setQuality(null);
        setQualityScore(null);
        setQualityNotes("");
        setQualityError(qualityErrorMessage(nextError, "get"));
      }
      return false;
    } finally {
      if (requestId === qualityRequestSequence.current) {
        setQualityLoading(false);
      }
    }
  }, [tenantId, ticketId]);

  const loadAssignableAgents = useCallback(
    async (canAssign: boolean) => {
      const requestId = ++assignableAgentsRequestSequence.current;
      setAssignableAgentsError("");
      if (!canAssign) {
        setAssignableAgents([]);
        setAssignableAgentsLoading(false);
        return;
      }

      setAssignableAgentsLoading(true);
      try {
        const response = await invokeTicketAgentAssignment({
          type: "list",
          tenantId,
          ticketId,
        });
        const agents = parseAssignableTicketAgents(response);
        if (!agents) {
          throw new Error("Die Agentenliste ist unvollständig.");
        }
        if (requestId !== assignableAgentsRequestSequence.current) return;
        setAssignableAgents(agents);
      } catch {
        if (requestId !== assignableAgentsRequestSequence.current) return;
        setAssignableAgents([]);
        setAssignableAgentsError(
          "Die verfügbaren Agenten konnten nicht geladen werden. Bitte aktualisieren Sie das Ticket.",
        );
      } finally {
        if (requestId === assignableAgentsRequestSequence.current) {
          setAssignableAgentsLoading(false);
        }
      }
    },
    [tenantId, ticketId],
  );

  const loadTicketCategoriesForDepartment = useCallback(
    async (departmentId: string) => {
      const requestId = ++ticketCategoriesRequestSequence.current;
      setTicketCategoriesLoading(true);
      setTicketCategoryError("");
      try {
        const categories = await loadTicketCategories(tenantId, departmentId);
        if (requestId !== ticketCategoriesRequestSequence.current) return;
        setTicketCategories(categories);
      } catch {
        if (requestId !== ticketCategoriesRequestSequence.current) return;
        setTicketCategories([]);
        setTicketCategoryError(
          "Die Kategorien konnten nicht geladen werden. Bitte aktualisieren Sie das Ticket.",
        );
      } finally {
        if (requestId === ticketCategoriesRequestSequence.current) {
          setTicketCategoriesLoading(false);
        }
      }
    },
    [tenantId],
  );

  const loadTicketContext = useCallback(
    async (ticket: TicketRecord) => {
      if (!supabase) return;
      const [departmentResult, departmentsResult, linksResult] =
        await Promise.all([
          supabase
            .from("departments")
            .select("name")
            .eq("tenant_id", tenantId)
            .eq("id", ticket.department_id)
            .maybeSingle(),
          supabase
            .from("departments")
            .select("id, name")
            .eq("tenant_id", tenantId)
            .eq("active", true)
            .order("name"),
          supabase
            .from("ticket_services")
            .select("service_id")
            .eq("tenant_id", tenantId)
            .eq("ticket_id", ticket.id),
        ]);

      const serviceIds = (linksResult.data ?? [])
        .map((link) => link.service_id)
        .filter(
          (serviceId): serviceId is string => typeof serviceId === "string",
        );
      const servicesResult = serviceIds.length
        ? await supabase
            .from("services")
            .select("name")
            .eq("tenant_id", tenantId)
            .eq("active", true)
            .in("id", serviceIds)
        : { data: [], error: null };
      const department =
        !departmentResult.error &&
        typeof departmentResult.data?.name === "string" &&
        departmentResult.data.name.trim()
          ? {
              id: ticket.department_id,
              name: departmentResult.data.name.trim(),
            }
          : null;
      const serviceOffers = !servicesResult.error
        ? [
            ...new Set(
              (servicesResult.data ?? [])
                .map((service) => service.name)
                .filter(
                  (name): name is string =>
                    typeof name === "string" && Boolean(name.trim()),
                )
                .map((name) => name.trim()),
            ),
          ]
        : [];
      const departments = !departmentsResult.error
        ? valuesOf(departmentsResult.data, isTicketDepartment)
        : [];

      setDetail((current) =>
        current?.ticket.id === ticket.id
          ? { ...current, department, departments, serviceOffers }
          : current,
      );
    },
    [tenantId],
  );

  const loadRequesterProfile = useCallback(
    async (contact: TicketRequesterContact | null, canUpdate: boolean) => {
      if (!contact || !canUpdate) {
        setRequesterProfile(null);
        setRequesterDepartment("");
        setRequesterOffer("");
        return;
      }
      try {
        const profile = await invokeTicketRequesterProfile({
          type: "getProfile",
          tenantId,
          requesterContactId: contact.id,
        });
        const resolved = profile ?? {
          requesterContactId: contact.id,
          location: null,
          department: null,
          offer: null,
          language: null,
          preferredContactChannel: null,
          importantNote: null,
        };
        setRequesterProfile(resolved);
        setRequesterDepartment(resolved.department ?? "");
        setRequesterOffer(resolved.offer ?? "");
      } catch {
        setRequesterProfile(null);
        setRequesterDepartment("");
        setRequesterOffer("");
      }
    },
    [tenantId],
  );

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
      let nextDetail = parseTicketDetail(response);
      if (nextDetail === undefined) {
        throw new Error("Die Ticketdaten sind unvollständig.");
      }
      if (nextDetail === null) {
        throw new Error("Dieses Ticket ist nicht mehr verfügbar.");
      }
      if (requestId !== requestSequence.current) return false;

      await loadAssignableAgents(nextDetail?.canAssign === true);
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
      setEditSubject(nextDetail?.ticket.subject ?? "");
      setEditDescription(nextDetail?.ticket.description ?? "");
      setSelectedTeamId(nextDetail?.ticket.assigned_team_id ?? "");
      setSelectedAgentId(nextDetail?.ticket.assigned_agent_id ?? "");
      setSelectedDepartmentId(nextDetail?.ticket.department_id ?? "");
      setTicketCategories([]);
      setTicketCategoryDraft(null);
      setTicketCategorySaving(false);
      setTicketCategoryError("");
      void loadTicketCategoriesForDepartment(nextDetail.ticket.department_id);
      if (!nextDetail?.canUseInternalNotes) {
        setCommentVisibility("external");
      }
      void loadTicketContext(nextDetail.ticket);
      void loadRequesterProfile(
        nextDetail.requesterContact,
        nextDetail.canUpdate,
      );
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
  }, [
    loadAssignableAgents,
    loadTicketCategoriesForDepartment,
    loadRequesterProfile,
    loadTicketContext,
    tenantId,
    ticketId,
  ]);

  const loadAttachments = useCallback(async () => {
    const requestId = ++attachmentRequestSequence.current;
    setAttachmentsLoading(true);
    setAttachmentError("");

    try {
      const response = await invokeTicketAttachmentAction({
        type: "list",
        tenantId,
        ticketId,
      });
      const nextAttachments = parseTicketAttachments(response);
      if (!nextAttachments) throw new Error("Ungültige Anhangsdaten.");
      if (requestId !== attachmentRequestSequence.current) return false;

      setAttachments(nextAttachments);
      return true;
    } catch {
      if (requestId === attachmentRequestSequence.current) {
        setAttachmentError(attachmentErrorMessage("list"));
      }
      return false;
    } finally {
      if (requestId === attachmentRequestSequence.current) {
        setAttachmentsLoaded(true);
        setAttachmentsLoading(false);
      }
    }
  }, [tenantId, ticketId]);

  const loadHandovers = useCallback(async () => {
    const requestId = ++handoverRequestSequence.current;
    setHandoversLoading(true);
    setHandoverError("");

    try {
      const response = await invokeTicketHandoverAction({
        type: "list",
        tenantId,
        ticketId,
      });
      const nextHandovers = parseTicketHandovers(response);
      if (
        !nextHandovers ||
        nextHandovers.some((handover) => handover.ticketId !== ticketId)
      ) {
        throw new Error("Die Übergabedaten sind unvollständig.");
      }
      if (requestId !== handoverRequestSequence.current) return false;

      setHandovers(nextHandovers);
      return true;
    } catch (nextError) {
      if (requestId === handoverRequestSequence.current) {
        // Ticket handovers are an optional module. A tenant can already use
        // the ticket workspace while the dedicated Function is not deployed.
        // In that state an empty list is the appropriate user-facing result,
        // not a technical error banner.
        if (functionErrorStatus(nextError) === 404) {
          setHandovers([]);
          setHandoverError("");
        } else {
          setHandoverError(handoverErrorMessage(nextError, "list"));
        }
      }
      return false;
    } finally {
      if (requestId === handoverRequestSequence.current) {
        setHandoversLoaded(true);
        setHandoversLoading(false);
      }
    }
  }, [tenantId, ticketId]);

  const loadAffectedItems = useCallback(async () => {
    const requestId = ++affectedItemsRequestSequence.current;
    setAffectedItemsLoading(true);
    setAffectedItemsError("");

    try {
      const client = supabase;
      if (!client) throw new Error("Supabase ist nicht konfiguriert.");
      const [
        catalogResponse,
        linkedServicesResponse,
        linkedAssetsResponse,
        linkedProblemsResponse,
      ] = await Promise.all([
        invokeServiceAssetsAction({ type: "listCatalog", tenantId }),
        client
          .from("ticket_services")
          .select("service_id, services(id, name, criticality)")
          .eq("tenant_id", tenantId)
          .eq("ticket_id", ticketId),
        client
          .from("ticket_assets")
          .select("asset_id, assets(id, name, asset_tag, kind, status)")
          .eq("tenant_id", tenantId)
          .eq("ticket_id", ticketId),
        client
          .from("problem_tickets")
          .select("problem_id, problems(id, title, status)")
          .eq("tenant_id", tenantId)
          .eq("ticket_id", ticketId),
      ]);
      if (
        linkedServicesResponse.error ||
        linkedAssetsResponse.error ||
        linkedProblemsResponse.error
      ) {
        throw (
          linkedServicesResponse.error ??
          linkedAssetsResponse.error ??
          linkedProblemsResponse.error
        );
      }

      const nextCatalog = parseTicketCatalog(catalogResponse);
      const services = parseLinkedCatalogItems(
        linkedServicesResponse.data,
        toLinkedService,
      );
      const assets = parseLinkedCatalogItems(
        linkedAssetsResponse.data,
        toLinkedAsset,
      );
      const problems = parseLinkedCatalogItems(
        linkedProblemsResponse.data,
        toLinkedProblem,
      );
      if (!nextCatalog || !services || !assets || !problems) {
        throw new Error(
          "Die Daten zu den betroffenen Elementen sind unvollständig.",
        );
      }
      if (requestId !== affectedItemsRequestSequence.current) return false;

      setCatalog(nextCatalog);
      setLinkedCatalogItems(
        [...services, ...assets, ...problems].sort((first, second) => {
          const kindComparison = catalogKindLabel(first.kind).localeCompare(
            catalogKindLabel(second.kind),
            "de-CH",
          );
          return (
            kindComparison || first.label.localeCompare(second.label, "de-CH")
          );
        }),
      );
      return true;
    } catch (nextError) {
      if (requestId === affectedItemsRequestSequence.current) {
        setCatalog(emptyTicketCatalog());
        setLinkedCatalogItems([]);
        setAffectedItemsError(affectedItemsErrorMessage(nextError, "list"));
      }
      return false;
    } finally {
      if (requestId === affectedItemsRequestSequence.current) {
        setAffectedItemsLoaded(true);
        setAffectedItemsLoading(false);
      }
    }
  }, [tenantId, ticketId]);

  useEffect(() => {
    void loadTicket();
    return () => {
      requestSequence.current += 1;
    };
  }, [loadTicket]);

  useEffect(() => {
    if (!detail || !supabase) {
      setPresence([]);
      return;
    }

    let cancelled = false;
    const refreshPresence = async () => {
      if (document.visibilityState === "hidden") {
        if (!cancelled) setPresence([]);
        return;
      }
      try {
        await invokeTicketPresence({
          type: "heartbeat",
          tenantId,
          ticketId,
          editing: isEditingTicket,
        });
        const response = await invokeTicketPresence({
          type: "list",
          tenantId,
          ticketId,
        });
        const people = parseTicketPresence(response);
        if (!people) throw new Error("Ungültige Präsenzdaten.");
        if (!cancelled) setPresence(people);
      } catch {
        // Presence is contextual convenience only. Ticket work remains available
        // when the short-lived indicator cannot be refreshed.
        if (!cancelled) setPresence([]);
      }
    };

    void refreshPresence();
    const interval = window.setInterval(() => {
      void refreshPresence();
    }, 30_000);
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        setPresence([]);
        return;
      }
      void refreshPresence();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [detail?.ticket.id, isEditingTicket, tenantId, ticketId]);

  useEffect(() => {
    if (!ticketIsClosed) {
      setFeedback(null);
      setFeedbackError("");
      setFeedbackSuccess("");
      setFeedbackLoading(false);
      return;
    }
    void loadFeedback();
    return () => {
      feedbackRequestSequence.current += 1;
    };
  }, [loadFeedback, ticketIsClosed]);

  useEffect(() => {
    if (!ticketIsClosed) {
      setQuality(null);
      setQualityError("");
      setQualitySuccess("");
      setQualityLoading(false);
      return;
    }
    void loadQuality();
    return () => {
      qualityRequestSequence.current += 1;
    };
  }, [loadQuality, ticketIsClosed]);

  useEffect(() => {
    setAttachments([]);
    setAttachmentsLoaded(false);
    setSelectedAttachmentFile(null);
    if (attachmentInputRef.current) attachmentInputRef.current.value = "";
    void loadAttachments();
    return () => {
      attachmentRequestSequence.current += 1;
    };
  }, [loadAttachments]);

  useEffect(() => {
    setHandovers([]);
    setHandoversLoaded(false);
    setHandoverError("");
    setHandoverSummary("");
    setHandoverNextSteps("");
    setHandoverRiskLevel("medium");
    if (detail?.canUpdate !== true) {
      setHandoversLoading(false);
      return;
    }
    void loadHandovers();
    return () => {
      handoverRequestSequence.current += 1;
    };
  }, [loadHandovers, detail?.canUpdate]);

  useEffect(() => {
    setCatalog(emptyTicketCatalog());
    setLinkedCatalogItems([]);
    setAffectedItemsLoaded(false);
    setAffectedItemsError("");
    setSelectedCatalogItemKey("");
    void loadAffectedItems();
    return () => {
      affectedItemsRequestSequence.current += 1;
    };
  }, [loadAffectedItems]);

  useEffect(() => {
    setMergeQuery("");
    setMergeTargets([]);
    setMergeError("");
    setMergeConfirmationTarget(null);
  }, [ticketId]);

  useEffect(() => {
    const query = mergeQuery.trim();
    const requestId = ++mergeSearchRequestSequence.current;
    setMergeConfirmationTarget(null);

    if (!detail?.canMerge || [...query].length < 2) {
      setMergeTargets([]);
      setMergeError("");
      setMergeSearchLoading(false);
      return;
    }
    if (query.includes("\u0000")) {
      setMergeTargets([]);
      setMergeError("Die Suchanfrage enthält ungültige Zeichen.");
      setMergeSearchLoading(false);
      return;
    }

    setMergeSearchLoading(true);
    setMergeError("");
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const response = await invokeTicketOperation({
            type: "searchMergeTargets",
            tenantId,
            ticketId,
            query,
          });
          const targets = parseMergeSearchTargets(response);
          if (
            !targets ||
            targets.length > 50 ||
            targets.some((target) => target.id === ticketId) ||
            new Set(targets.map((target) => target.id)).size !== targets.length
          ) {
            throw new Error("Ungültige Suchantwort.");
          }
          if (requestId !== mergeSearchRequestSequence.current) return;
          setMergeTargets(targets);
        } catch (nextError) {
          if (requestId === mergeSearchRequestSequence.current) {
            setMergeTargets([]);
            setMergeError(mergeErrorMessage(nextError, "search"));
          }
        } finally {
          if (requestId === mergeSearchRequestSequence.current) {
            setMergeSearchLoading(false);
          }
        }
      })();
    }, 250);

    return () => {
      window.clearTimeout(timer);
      mergeSearchRequestSequence.current += 1;
    };
  }, [detail?.canMerge, mergeQuery, tenantId, ticketId]);

  const selectedStatus = useMemo(
    () =>
      detail?.statuses.find(
        (status) => status.id === detail.ticket.status_id,
      ) ?? null,
    [detail],
  );
  const selectableStatuses = useMemo(
    () =>
      (detail?.statuses ?? []).filter(
        (status) =>
          !status.is_closed ||
          detail?.canClose ||
          status.id === selectedStatus?.id,
      ),
    [detail?.canClose, detail?.statuses, selectedStatus?.id],
  );
  const closingStatusForKey = useCallback(
    (nextStatusKey: string | undefined) => {
      if (!nextStatusKey) return null;
      const nextStatus = detail?.statuses.find(
        (status) => status.key === nextStatusKey,
      );
      return nextStatus?.is_closed === true &&
        nextStatus.id !== selectedStatus?.id
        ? nextStatus
        : null;
    },
    [detail?.statuses, selectedStatus?.id],
  );
  const selectedPriority = useMemo(
    () =>
      detail?.priorities.find(
        (priority) => priority.id === detail.ticket.priority_id,
      ) ?? null,
    [detail],
  );
  const selectedTeam = useMemo(
    () =>
      detail?.teams.find(
        (team) => team.id === detail.ticket.assigned_team_id,
      ) ?? null,
    [detail],
  );
  const requesterContext = useMemo(
    () =>
      [requesterProfile?.department, requesterProfile?.offer].filter(
        (value): value is string => Boolean(value?.trim()),
      ),
    [requesterProfile?.department, requesterProfile?.offer],
  );
  const selectedTicketCategory = useMemo(
    () =>
      ticketCategories.find(
        (category) => category.id === detail?.ticket.category_id,
      ) ?? null,
    [detail?.ticket.category_id, ticketCategories],
  );
  const availableTicketSubcategories = useMemo(
    () =>
      selectedTicketCategory
        ? ticketCategories.filter(
            (category) => category.parentId === selectedTicketCategory.id,
          )
        : [],
    [selectedTicketCategory, ticketCategories],
  );
  const selectedTicketSubcategory = useMemo(
    () =>
      availableTicketSubcategories.find(
        (category) => category.id === detail?.ticket.subcategory_id,
      ) ?? null,
    [availableTicketSubcategories, detail?.ticket.subcategory_id],
  );
  const rootTicketCategories = useMemo(
    () => ticketCategories.filter((category) => category.parentId === null),
    [ticketCategories],
  );
  const ticketCategoryDraftParent = useMemo(
    () =>
      ticketCategoryDraft?.parentId
        ? (rootTicketCategories.find(
            (category) => category.id === ticketCategoryDraft.parentId,
          ) ?? null)
        : null,
    [rootTicketCategories, ticketCategoryDraft?.parentId],
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
  const assignedAgentId = detail?.ticket.assigned_agent_id ?? "";
  const visibleAssignableAgents = useMemo(() => {
    const agents =
      assignableAgents.length > 0 ? assignableAgents : (detail?.agents ?? []);
    const byId = new Map(agents.map((agent) => [agent.id, agent]));
    if (detail?.assignedAgent) {
      byId.set(detail.assignedAgent.id, detail.assignedAgent);
    }
    return [...byId.values()].sort(
      (left, right) =>
        left.displayName.localeCompare(right.displayName, "de-CH", {
          sensitivity: "base",
        }) || left.id.localeCompare(right.id),
    );
  }, [assignableAgents, detail?.agents, detail?.assignedAgent]);
  const hasContentChanges = Boolean(
    detail &&
    isEditingTicket &&
    (editSubject.trim() !== detail.ticket.subject ||
      editDescription.trim() !== detail.ticket.description),
  );
  const hasChanges = Boolean(
    detail &&
    (statusKey !== selectedStatus?.key ||
      priorityKey !== selectedPriority?.key ||
      selectedTeamId !== assignedTeamId ||
      (detail.canAssign && selectedAgentId !== assignedAgentId) ||
      hasContentChanges),
  );
  const busy = pendingAction !== null;
  const attachmentBusy = pendingAttachmentAction !== null;
  const handoverBusy = pendingHandoverAction !== null;
  const catalogBusy = pendingCatalogAction !== null;
  const availableCatalogItems = useMemo(() => {
    const linkedItemKeys = new Set(linkedCatalogItems.map(catalogItemKey));
    const items: CatalogSelection[] = [
      ...catalog.services.map((service) => ({
        kind: "service" as const,
        id: service.id,
        label: service.name,
        description: `Kritikalität: ${criticalityLabel(service.criticality)}`,
      })),
      ...catalog.assets.map((asset) => ({
        kind: "asset" as const,
        id: asset.id,
        label: asset.name,
        description: [
          asset.assetTag ? `Asset-Kennung: ${asset.assetTag}` : null,
          `Typ: ${asset.kind}`,
          `Status: ${asset.status}`,
        ]
          .filter((entry): entry is string => entry !== null)
          .join(" · "),
      })),
      ...catalog.problems.map((problem) => ({
        kind: "problem" as const,
        id: problem.id,
        label: problem.title,
        description: `Status: ${problem.status}`,
      })),
    ];
    return items
      .filter((item) => !linkedItemKeys.has(catalogSelectionKey(item)))
      .sort((first, second) => {
        const kindComparison = catalogKindLabel(first.kind).localeCompare(
          catalogKindLabel(second.kind),
          "de-CH",
        );
        return (
          kindComparison || first.label.localeCompare(second.label, "de-CH")
        );
      });
  }, [catalog, linkedCatalogItems]);

  async function saveFeedback(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!feedback?.canRate || !feedback.isClosed) {
      setFeedbackError(
        "Eine Bewertung kann nur für ein geschlossenes Ticket abgegeben werden.",
      );
      return;
    }
    if (feedbackScore === null) {
      setFeedbackError(
        "Bitte wählen Sie eine Bewertung von 1 bis 5 Sternen aus.",
      );
      return;
    }

    const comment = feedbackComment.trim();
    if ([...comment].length > 3_000 || comment.includes("\u0000")) {
      setFeedbackError(
        "Der Kommentar darf höchstens 3'000 Zeichen enthalten und keine ungültigen Zeichen enthalten.",
      );
      return;
    }

    const action: Extract<TicketFeedbackAction, { type: "submit" }> = {
      type: "submit",
      tenantId,
      ticketId,
      score: feedbackScore,
    };
    if (comment) action.comment = comment;

    setPendingAction("feedback");
    setFeedbackError("");
    setFeedbackSuccess("");
    try {
      await invokeTicketFeedbackAction(action);
      onChanged();
      await loadFeedback();
      setFeedbackSuccess("Ihre Bewertung wurde gespeichert.");
    } catch (nextError) {
      setFeedbackError(feedbackErrorMessage(nextError, "submit"));
    } finally {
      setPendingAction(null);
    }
  }

  async function saveQuality(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!quality?.canReview) {
      setQualityError(
        "Eine Qualitätsprüfung kann nur mit Berechtigung für ein geschlossenes Ticket abgegeben werden.",
      );
      return;
    }
    if (!isTicketQualityScore(qualityScore)) {
      setQualityError(
        "Bitte wählen Sie eine Qualitätsbewertung von 1 bis 5 Sternen aus.",
      );
      return;
    }

    const notes = qualityNotes.trim();
    if ([...notes].length > 3_000 || notes.includes("\u0000")) {
      setQualityError(
        "Die Notizen dürfen höchstens 3'000 Zeichen enthalten und keine ungültigen Zeichen enthalten.",
      );
      return;
    }

    setPendingAction("quality-review");
    setQualityError("");
    setQualitySuccess("");
    try {
      const response = await invokeTicketQualityAction({
        type: "submit",
        tenantId,
        ticketId,
        score: qualityScore,
        notes: notes || null,
      });
      if (!parseTicketQualitySubmit(response)) {
        throw new Error("Ungültige Antwort der Qualitätsprüfung.");
      }
      onChanged();
      await loadQuality();
      setQualitySuccess("Die Qualitätsprüfung wurde gespeichert.");
    } catch (nextError) {
      setQualityError(qualityErrorMessage(nextError, "submit"));
    } finally {
      setPendingAction(null);
    }
  }

  async function createHandover(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail || !detail.canUpdate || handoverBusy) return;

    const summary = handoverSummary.trim();
    const nextSteps = handoverNextSteps.trim();
    const summaryLength = [...summary].length;
    const nextStepsLength = [...nextSteps].length;
    if (
      summaryLength < 3 ||
      summaryLength > 2_000 ||
      summary.includes("\u0000")
    ) {
      setHandoverError(
        "Die Zusammenfassung muss zwischen 3 und 2'000 Zeichen lang sein.",
      );
      return;
    }
    if (nextStepsLength > 3_000 || nextSteps.includes("\u0000")) {
      setHandoverError(
        "Die nächsten Schritte dürfen höchstens 3'000 Zeichen lang sein.",
      );
      return;
    }

    setPendingHandoverAction("create");
    setPendingHandoverId(null);
    setHandoverError("");
    try {
      const response = await invokeTicketHandoverAction({
        type: "create",
        tenantId,
        ticketId,
        summary,
        nextSteps: nextSteps || null,
        riskLevel: handoverRiskLevel,
      });
      const createdHandover = parseTicketHandoverResponse(response);
      if (
        !createdHandover ||
        createdHandover.ticketId !== ticketId ||
        createdHandover.acknowledgedAt !== null ||
        createdHandover.resolvedAt !== null
      ) {
        throw new Error("Ungültige Antwort für die Übergabe.");
      }

      setHandoverSummary("");
      setHandoverNextSteps("");
      setHandoverRiskLevel("medium");
      onChanged();
      await loadHandovers();
    } catch (nextError) {
      setHandoverError(handoverErrorMessage(nextError, "create"));
    } finally {
      setPendingHandoverId(null);
      setPendingHandoverAction(null);
    }
  }

  async function acknowledgeHandover(handover: TicketHandover) {
    if (
      !detail ||
      !detail.canUpdate ||
      handoverBusy ||
      handoverStatus(handover) !== "open"
    ) {
      return;
    }

    setPendingHandoverAction("acknowledge");
    setPendingHandoverId(handover.id);
    setHandoverError("");
    try {
      const response = await invokeTicketHandoverAction({
        type: "acknowledge",
        tenantId,
        ticketId,
        handoverId: handover.id,
      });
      const acknowledgedHandover = parseTicketHandoverResponse(response);
      if (
        !acknowledgedHandover ||
        acknowledgedHandover.ticketId !== ticketId ||
        acknowledgedHandover.acknowledgedAt === null ||
        acknowledgedHandover.resolvedAt !== null
      ) {
        throw new Error("Ungültige Antwort für die Übergabe.");
      }

      onChanged();
      await loadHandovers();
    } catch (nextError) {
      setHandoverError(handoverErrorMessage(nextError, "acknowledge"));
    } finally {
      setPendingHandoverId(null);
      setPendingHandoverAction(null);
    }
  }

  async function resolveHandover(handover: TicketHandover) {
    if (
      !detail ||
      !detail.canUpdate ||
      handoverBusy ||
      handoverStatus(handover) !== "acknowledged"
    ) {
      return;
    }

    setPendingHandoverAction("resolve");
    setPendingHandoverId(handover.id);
    setHandoverError("");
    try {
      const response = await invokeTicketHandoverAction({
        type: "resolve",
        tenantId,
        ticketId,
        handoverId: handover.id,
      });
      const resolvedHandover = parseTicketHandoverResponse(response);
      if (
        !resolvedHandover ||
        resolvedHandover.ticketId !== ticketId ||
        resolvedHandover.resolvedAt === null
      ) {
        throw new Error("Ungültige Antwort für die Übergabe.");
      }

      onChanged();
      await loadHandovers();
    } catch (nextError) {
      setHandoverError(handoverErrorMessage(nextError, "resolve"));
    } finally {
      setPendingHandoverId(null);
      setPendingHandoverAction(null);
    }
  }

  function selectAttachmentFile(file: File | null) {
    setAttachmentError("");
    setSelectedAttachmentFile(null);
    if (!file) return;

    const validationError = attachmentFileError(file);
    if (validationError) {
      setAttachmentError(validationError);
      if (attachmentInputRef.current) attachmentInputRef.current.value = "";
      return;
    }
    setSelectedAttachmentFile(file);
  }

  async function uploadAttachment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail || !detail.canUpdate || !selectedAttachmentFile) return;

    const file = selectedAttachmentFile;
    const validationError = attachmentFileError(file);
    if (validationError) {
      setAttachmentError(validationError);
      return;
    }

    const filename = file.name.trim();
    const contentType = file.type.trim().toLowerCase();
    setPendingAttachmentAction("upload");
    setAttachmentError("");
    try {
      const createResponse = await invokeTicketAttachmentAction({
        type: "createUpload",
        tenantId,
        ticketId,
        filename,
        contentType,
        byteSize: file.size,
      });
      const upload = parseAttachmentUpload(createResponse);
      if (
        !upload ||
        upload.contentType !== contentType ||
        upload.byteSize !== file.size
      ) {
        throw new Error("Ungültige Upload-Antwort.");
      }

      const uploadResponse = await fetch(upload.signedUrl, {
        method: "PUT",
        headers: { "Content-Type": contentType },
        body: file,
      });
      if (!uploadResponse.ok) throw new Error("Upload fehlgeschlagen.");

      await invokeTicketAttachmentAction({
        type: "completeUpload",
        tenantId,
        ticketId,
        storageObjectPath: upload.storageObjectPath,
        originalFilename: filename,
        contentType,
        byteSize: file.size,
      });
      setSelectedAttachmentFile(null);
      if (attachmentInputRef.current) attachmentInputRef.current.value = "";
      onChanged();
      await loadAttachments();
    } catch {
      setAttachmentError(attachmentErrorMessage("upload"));
    } finally {
      setPendingAttachmentAction(null);
    }
  }

  async function downloadAttachment(attachment: TicketAttachment) {
    setPendingAttachmentAction("download");
    setPendingAttachmentId(attachment.id);
    setAttachmentError("");
    try {
      const response = await invokeTicketAttachmentAction({
        type: "createDownloadUrl",
        tenantId,
        ticketId,
        attachmentId: attachment.id,
      });
      const signedUrl = parseAttachmentDownloadUrl(response);
      if (!signedUrl) throw new Error("Ungültige Download-Antwort.");

      window.open(signedUrl, "_blank", "noopener,noreferrer");
    } catch {
      setAttachmentError(attachmentErrorMessage("download"));
    } finally {
      setPendingAttachmentId(null);
      setPendingAttachmentAction(null);
    }
  }

  async function deleteAttachment(attachment: TicketAttachment) {
    if (!detail || !detail.canUpdate) return;

    setPendingAttachmentAction("delete");
    setPendingAttachmentId(attachment.id);
    setAttachmentError("");
    try {
      await invokeTicketAttachmentAction({
        type: "delete",
        tenantId,
        ticketId,
        attachmentId: attachment.id,
      });
      onChanged();
      await loadAttachments();
    } catch {
      setAttachmentError(attachmentErrorMessage("delete"));
    } finally {
      setPendingAttachmentId(null);
      setPendingAttachmentAction(null);
    }
  }

  function startTicketEdit() {
    if (!detail || !detail.canUpdate || busy) return;
    setFocusMode(false);
    setIsWorkToolsOpen(true);
    setEditSubject(detail.ticket.subject);
    setEditDescription(detail.ticket.description);
    setIsEditingTicket(true);
    setError("");
  }

  function cancelTicketEdit() {
    if (!detail || busy) return;
    setEditSubject(detail.ticket.subject);
    setEditDescription(detail.ticket.description);
    setStatusKey(
      detail.statuses.find((status) => status.id === detail.ticket.status_id)
        ?.key ?? "",
    );
    setPriorityKey(
      detail.priorities.find(
        (priority) => priority.id === detail.ticket.priority_id,
      )?.key ?? "",
    );
    setSelectedTeamId(detail.ticket.assigned_team_id ?? "");
    setSelectedAgentId(detail.ticket.assigned_agent_id ?? "");
    setSelectedDepartmentId(detail.ticket.department_id);
    setIsEditingTicket(false);
    setPendingCloseConfirmation(null);
    setError("");
  }

  async function saveOverviewChange(
    change: {
      statusKey?: string;
      priorityKey?: string;
      assignedTeamId?: string | null;
      assignedAgentId?: string | null;
    },
    confirmedClose = false,
  ) {
    if (!detail || busy) return;

    const updatesTicket =
      change.statusKey !== undefined ||
      change.priorityKey !== undefined ||
      change.assignedTeamId !== undefined;
    const updatesAgent = change.assignedAgentId !== undefined;
    if (!updatesTicket && !updatesAgent) return;
    const closingStatus = closingStatusForKey(change.statusKey);
    if (closingStatus && !confirmedClose) {
      setPendingCloseConfirmation({
        statusKey: closingStatus.key,
        statusLabel: closingStatus.label,
        source: "overview",
      });
      return;
    }

    setPendingAction("update");
    setError("");
    try {
      if (updatesTicket) {
        await invokeTicketOperation({
          type: "updateTicket",
          tenantId,
          ticketId,
          ...(change.statusKey !== undefined
            ? {
                statusKey: change.statusKey,
                ...(closingStatus ? { confirmClose: true } : {}),
              }
            : {}),
          ...(change.priorityKey !== undefined
            ? { priorityKey: change.priorityKey }
            : {}),
          ...(change.assignedTeamId !== undefined
            ? { assignedTeamId: change.assignedTeamId }
            : {}),
        });
      }
      if (updatesAgent) {
        await invokeTicketAgentAssignment({
          type: "assign",
          tenantId,
          ticketId,
          assignedAgentId: change.assignedAgentId ?? null,
        });
      }
      onChanged();
      await Promise.all([loadTicket(), loadFeedback(), loadQuality()]);
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setPendingAction(null);
    }
  }

  async function saveDepartmentChange(departmentId: string) {
    if (!detail?.canUpdate || !departmentId || busy) return;
    setPendingAction("update");
    setError("");
    try {
      await invokeTicketDepartmentChange({ tenantId, ticketId, departmentId });
      onChanged();
      await Promise.all([loadTicket(), loadFeedback(), loadQuality()]);
    } catch (nextError) {
      setSelectedDepartmentId(detail.ticket.department_id);
      setError(errorMessage(nextError));
    } finally {
      setPendingAction(null);
    }
  }

  async function saveRequesterContext() {
    if (!detail?.canUpdate || !requesterProfile || requesterProfileBusy || busy)
      return;
    const department = requesterDepartment.trim() || null;
    const offer = requesterOffer.trim() || null;
    if (
      department === requesterProfile.department &&
      offer === requesterProfile.offer
    )
      return;

    setRequesterProfileBusy(true);
    setError("");
    try {
      const profile = await invokeTicketRequesterProfile({
        type: "saveProfile",
        tenantId,
        requesterContactId: requesterProfile.requesterContactId,
        location: requesterProfile.location,
        department,
        offer,
        language: requesterProfile.language,
        preferredContactChannel: requesterProfile.preferredContactChannel,
        importantNote: requesterProfile.importantNote,
      });
      if (!profile)
        throw new Error(
          "Das Anfragendenprofil konnte nicht gespeichert werden.",
        );
      setRequesterProfile(profile);
      setRequesterDepartment(profile.department ?? "");
      setRequesterOffer(profile.offer ?? "");
      onChanged();
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setRequesterProfileBusy(false);
    }
  }

  async function saveTicketChanges(confirmedClose = false) {
    if (!detail || !detail.canUpdate || !hasChanges) return;

    const subject = editSubject.trim();
    const description = editDescription.trim();
    if (hasContentChanges) {
      if (
        [...subject].length < 3 ||
        [...subject].length > 240 ||
        subject.includes("\u0000")
      ) {
        setError("Der Titel muss zwischen 3 und 240 Zeichen lang sein.");
        return;
      }
      if (
        [...description].length < 1 ||
        [...description].length > 10_000 ||
        description.includes("\u0000")
      ) {
        setError(
          "Die Beschreibung muss zwischen 1 und 10'000 Zeichen lang sein.",
        );
        return;
      }
    }

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
    const assignedAgentChanged =
      detail.canAssign && selectedAgentId !== assignedAgentId;
    if (hasContentChanges && subject !== detail.ticket.subject) {
      action.subject = subject;
    }
    if (hasContentChanges && description !== detail.ticket.description) {
      action.description = description;
    }
    if (
      !action.statusKey &&
      !action.priorityKey &&
      action.assignedTeamId === undefined &&
      action.subject === undefined &&
      action.description === undefined &&
      !assignedAgentChanged
    ) {
      return;
    }

    const closingStatus = closingStatusForKey(action.statusKey);
    if (closingStatus && !confirmedClose) {
      setPendingCloseConfirmation({
        statusKey: closingStatus.key,
        statusLabel: closingStatus.label,
        source: "editor",
      });
      return;
    }
    if (closingStatus) action.confirmClose = true;

    setPendingAction("update");
    setError("");
    try {
      const hasTicketUpdate =
        action.statusKey !== undefined ||
        action.priorityKey !== undefined ||
        action.assignedTeamId !== undefined ||
        action.subject !== undefined ||
        action.description !== undefined;
      if (hasTicketUpdate) {
        await invokeTicketOperation(action);
      }
      if (assignedAgentChanged) {
        await invokeTicketAgentAssignment({
          type: "assign",
          tenantId,
          ticketId,
          assignedAgentId: selectedAgentId || null,
        });
      }
      setIsEditingTicket(false);
      onChanged();
      await Promise.all([loadTicket(), loadFeedback(), loadQuality()]);
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setPendingAction(null);
    }
  }

  async function confirmTicketClose() {
    const confirmation = pendingCloseConfirmation;
    if (!confirmation || busy) return;
    setPendingCloseConfirmation(null);
    if (confirmation.source === "overview") {
      await saveOverviewChange({ statusKey: confirmation.statusKey }, true);
      return;
    }
    if (statusKey !== confirmation.statusKey) {
      setError(
        "Der Abschlussstatus wurde geändert. Bitte wählen Sie ihn erneut aus.",
      );
      return;
    }
    await saveTicketChanges(true);
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

  function openTicketCategoryForm(parentId: string | null) {
    if (!detail?.canUpdate || ticketCategorySaving) return;
    setTicketCategoryError("");
    setTicketCategoryDraft({ name: "", parentId });
  }

  async function saveTicketCategory(
    categoryId: string | null,
    subcategoryId: string | null,
    options = ticketCategories,
    manageBusy = true,
  ): Promise<boolean> {
    if (!detail || !detail.canUpdate) return false;
    const selectedCategory = categoryId
      ? options.find(
          (category) =>
            category.id === categoryId && category.parentId === null,
        )
      : null;
    const selectedSubcategory = subcategoryId
      ? options.find(
          (category) =>
            category.id === subcategoryId && category.parentId === categoryId,
        )
      : null;
    if (
      (categoryId !== null && !selectedCategory) ||
      (subcategoryId !== null && !selectedSubcategory)
    ) {
      setTicketCategoryError("Bitte wählen Sie eine gültige Kategorie aus.");
      return false;
    }

    if (manageBusy) setTicketCategorySaving(true);
    setTicketCategoryError("");
    try {
      await invokeTicketCategorySelection({
        tenantId,
        ticketId,
        categoryId,
        subcategoryId,
      });
      setDetail((current) =>
        current
          ? {
              ...current,
              ticket: {
                ...current.ticket,
                category_id: categoryId,
                subcategory_id: subcategoryId,
              },
            }
          : current,
      );
      onChanged();
      return true;
    } catch {
      setTicketCategoryError(
        "Die Kategorie konnte nicht gespeichert werden. Bitte versuchen Sie es erneut.",
      );
      return false;
    } finally {
      if (manageBusy) setTicketCategorySaving(false);
    }
  }

  async function createTicketCategoryFromDetail() {
    if (
      !detail ||
      !detail.canUpdate ||
      !ticketCategoryDraft ||
      ticketCategorySaving
    ) {
      return;
    }
    const name = ticketCategoryDraft.name.trim();
    const parentId = ticketCategoryDraft.parentId;
    if (
      [...name].length < 2 ||
      [...name].length > 120 ||
      /[\u0000-\u001f\u007f]/.test(name)
    ) {
      setTicketCategoryError(
        "Bitte geben Sie einen Namen mit 2 bis 120 gültigen Zeichen ein.",
      );
      return;
    }
    if (
      parentId !== null &&
      !rootTicketCategories.some((category) => category.id === parentId)
    ) {
      setTicketCategoryError(
        "Die übergeordnete Kategorie ist nicht mehr verfügbar.",
      );
      return;
    }

    setTicketCategorySaving(true);
    setTicketCategoryError("");
    try {
      const category = await createTicketCategory({
        tenantId,
        departmentId: detail.ticket.department_id,
        name,
        parentId,
      });
      const nextCategories = [
        ...ticketCategories.filter((item) => item.id !== category.id),
        category,
      ].sort((left, right) =>
        left.name.localeCompare(right.name, "de-CH", { sensitivity: "base" }),
      );
      setTicketCategories(nextCategories);
      setTicketCategoryDraft(null);
      await saveTicketCategory(
        parentId ?? category.id,
        parentId ? category.id : null,
        nextCategories,
        false,
      );
    } catch {
      setTicketCategoryError(
        "Die Kategorie konnte nicht erstellt werden. Bitte prüfen Sie den Namen und versuchen Sie es erneut.",
      );
    } finally {
      setTicketCategorySaving(false);
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

  async function markMerged(primaryTicket: MergeSearchTarget) {
    if (!detail || !detail.canMerge || busy || primaryTicket.id === ticketId) {
      return;
    }

    setPendingAction("merge");
    setPendingRelationKey(`merge:${primaryTicket.id}`);
    setMergeError("");
    try {
      await invokeTicketOperation({
        type: "markMerged",
        tenantId,
        ticketId,
        primaryTicketId: primaryTicket.id,
      });
      setMergeConfirmationTarget(null);
      setMergeQuery("");
      setMergeTargets([]);
      onChanged();
      await Promise.all([loadTicket(), loadFeedback(), loadQuality()]);
    } catch (nextError) {
      setMergeError(mergeErrorMessage(nextError, "merge"));
    } finally {
      setPendingRelationKey(null);
      setPendingAction(null);
    }
  }

  async function linkCatalogItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail || !detail.canUpdate || catalogBusy) return;

    const item = availableCatalogItems.find(
      (entry) => catalogSelectionKey(entry) === selectedCatalogItemKey,
    );
    if (!item) {
      setAffectedItemsError(
        "Bitte wählen Sie einen verfügbaren Katalogeintrag aus.",
      );
      return;
    }

    const itemKey = catalogSelectionKey(item);
    setPendingCatalogAction("link");
    setPendingCatalogItemKey(itemKey);
    setAffectedItemsError("");
    try {
      await invokeServiceAssetsAction({
        type: "linkTicket",
        tenantId,
        ticketId,
        kind: item.kind,
        targetId: item.id,
      });
      setSelectedCatalogItemKey("");
      onChanged();
      await loadAffectedItems();
    } catch (nextError) {
      setAffectedItemsError(affectedItemsErrorMessage(nextError, "link"));
    } finally {
      setPendingCatalogItemKey(null);
      setPendingCatalogAction(null);
    }
  }

  async function unlinkCatalogItem(item: LinkedCatalogItem) {
    if (!detail || !detail.canUpdate || catalogBusy) return;

    const itemKey = catalogItemKey(item);
    setPendingCatalogAction("unlink");
    setPendingCatalogItemKey(itemKey);
    setAffectedItemsError("");
    try {
      await invokeServiceAssetsAction({
        type: "unlinkTicket",
        tenantId,
        ticketId,
        kind: item.kind,
        targetId: item.targetId,
      });
      onChanged();
      await loadAffectedItems();
    } catch (nextError) {
      setAffectedItemsError(affectedItemsErrorMessage(nextError, "unlink"));
    } finally {
      setPendingCatalogItemKey(null);
      setPendingCatalogAction(null);
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
            onClick={() => {
              void loadTicket();
              void loadFeedback();
              void loadQuality();
              void loadHandovers();
            }}
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
    <section
      className={
        focusMode
          ? "ticket-detail ticket-detail--focus panel"
          : "ticket-detail panel"
      }
      aria-label="Ticketdetails"
    >
      <header className="ticket-detail-header">
        <div className="ticket-detail-header-title">
          <p className="ticket-reference">
            <span>Ticket</span>
            {detail.ticket.ticket_number}
          </p>
          <h2>{detail.ticket.subject}</h2>
        </div>
        <div className="ticket-detail-header-actions">
          <TicketPdfRecord
            canExport={detail.canExport}
            tenantId={tenantId}
            ticketId={ticketId}
          />
          <button
            aria-label={
              detail.watching
                ? "Ticket nicht mehr beobachten"
                : "Ticket beobachten"
            }
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
            <span className="ticket-detail-action-label">
              {detail.watching ? "Nicht mehr beobachten" : "Beobachten"}
            </span>
          </button>
          {detail.canUpdate && (
            <button
              aria-controls="ticket-editor"
              aria-expanded={isEditingTicket}
              className="secondary-button"
              disabled={busy}
              onClick={startTicketEdit}
              type="button"
            >
              Bearbeiten
            </button>
          )}
          <button
            aria-pressed={focusMode}
            className={
              focusMode
                ? "secondary-button ticket-focus-button active"
                : "secondary-button ticket-focus-button"
            }
            disabled={busy}
            onClick={() => setFocusMode((current) => !current)}
            type="button"
          >
            <Focus aria-hidden="true" size={16} strokeWidth={1.8} />
            <span className="ticket-detail-action-label">
              {focusMode ? "Alle Bereiche" : "Fokus"}
            </span>
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

      <section
        className="ticket-detail-summary ticket-detail-primary"
        aria-labelledby="ticket-description-heading"
      >
        <div className="ticket-detail-section-heading">
          <div>
            <p className="eyebrow">ANLIEGEN</p>
            <h3 id="ticket-description-heading">Beschreibung</h3>
          </div>
        </div>
        <p className="ticket-detail-description">{detail.ticket.description}</p>
      </section>

      <section
        className="ticket-detail-comments ticket-detail-primary"
        aria-labelledby="ticket-comments-heading"
      >
        <div className="ticket-detail-section-heading">
          <div>
            <p className="eyebrow">KOMMUNIKATION</p>
            <h3 id="ticket-comments-heading">Kommentare</h3>
          </div>
          <span className="data-caption">{detail.comments.length}</span>
        </div>

        {detail.comments.length === 0 ? (
          <p className="empty-state">Noch keine Kommentare vorhanden.</p>
        ) : (
          <ol className="ticket-comment-list ticket-conversation">
            {[...detail.comments].reverse().map((item) => {
              const requesterName = detail.requesterContact?.displayName
                ?.trim()
                .toLocaleLowerCase("de-CH");
              const authorIsRequester =
                item.authorKind === "requester" ||
                (item.authorKind === undefined &&
                  Boolean(requesterName) &&
                  item.authorName.trim().toLocaleLowerCase("de-CH") ===
                    requesterName);
              const direction =
                item.visibility === "internal"
                  ? "center"
                  : authorIsRequester
                    ? "incoming"
                    : "outgoing";
              const visibilityLabel =
                direction === "incoming"
                  ? "Kunde"
                  : direction === "outgoing"
                    ? "Antwort an Kunden"
                    : "Interne Notiz";
              return (
                <li
                  className={`ticket-comment ticket-conversation__message ticket-conversation__message--${direction}`}
                  key={item.id}
                >
                  <div className="ticket-comment-meta">
                    <strong>{item.authorName}</strong>
                    <span
                      className={
                        item.visibility === "internal"
                          ? "ticket-comment-visibility-badge internal"
                          : "ticket-comment-visibility-badge external"
                      }
                    >
                      {visibilityLabel}
                    </span>
                    <time dateTime={item.created_at}>
                      {formatDateTime(item.created_at)}
                    </time>
                  </div>
                  <p>{item.body}</p>
                </li>
              );
            })}
          </ol>
        )}

        <form className="ticket-comment-form" onSubmit={saveComment}>
          <label className="ticket-comment-body">
            Neuer Kommentar
            <textarea
              aria-describedby="ticket-comment-visibility-hint"
              disabled={busy}
              maxLength={50_000}
              onChange={(event) => setComment(event.target.value)}
              placeholder="Interne Notiz oder Antwort verfassen …"
              required
              rows={4}
              value={comment}
            />
          </label>
          <fieldset className="ticket-comment-visibility" disabled={busy}>
            <legend>Kommentar-Sichtbarkeit</legend>
            {detail.canUseInternalNotes && (
              <label>
                <input
                  checked={commentVisibility === "internal"}
                  name="comment-visibility"
                  onChange={() => setCommentVisibility("internal")}
                  type="radio"
                  value="internal"
                />
                Interne Notiz
              </label>
            )}
            <label>
              <input
                checked={commentVisibility === "external"}
                name="comment-visibility"
                onChange={() => setCommentVisibility("external")}
                type="radio"
                value="external"
              />
              Externe Antwort
            </label>
          </fieldset>
          <p
            className={`ticket-comment-visibility-hint ${commentVisibility}`}
            id="ticket-comment-visibility-hint"
            aria-live="polite"
          >
            {commentVisibility === "internal"
              ? "Interne Notiz: Nur berechtigte Mitarbeitende sehen diesen Kommentar."
              : "Externe Antwort: Diese Nachricht ist für die anfragende Person sichtbar."}
          </p>
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
            {commentVisibility === "internal"
              ? "Interne Notiz speichern"
              : "Externe Antwort senden"}
          </button>
        </form>
      </section>

      <section
        className="ticket-detail-facts ticket-detail-primary"
        aria-labelledby="ticket-facts-heading"
      >
        <div className="ticket-detail-section-heading">
          <div>
            <p className="eyebrow">TICKETDETAILS</p>
            <h3 id="ticket-facts-heading">Übersicht</h3>
          </div>
          <span className="data-caption">
            {detail.canUpdate || detail.canAssign
              ? "Direkt anpassen"
              : "Aktueller Stand"}
          </span>
        </div>
        {(detail.canUpdate || detail.canAssign) && (
          <p className="ticket-detail-facts-hint" role="status">
            Änderungen werden beim Auswählen direkt gespeichert.
            {detail.canUpdate
              ? detail.canClose
                ? " Ein geschlossener Status braucht zusätzlich eine ausdrückliche Bestätigung."
                : " Geschlossene Status sind nur mit Abschlussberechtigung verfügbar."
              : ""}
          </p>
        )}
        {pendingCloseConfirmation && (
          <div
            aria-live="assertive"
            className="ticket-detail-message warning"
            role="alert"
          >
            <AlertCircle aria-hidden="true" size={17} />
            <div>
              <strong>Ticketabschluss bestätigen</strong>
              <p>
                Das Ticket wird in den Status „
                {pendingCloseConfirmation.statusLabel}“ verschoben. Offene
                Bearbeitung wird damit beendet.
              </p>
              <div className="ticket-detail-actions">
                <button
                  className="primary-button"
                  disabled={busy}
                  onClick={() => void confirmTicketClose()}
                  type="button"
                >
                  Abschluss bestätigen
                </button>
                <button
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => {
                    if (pendingCloseConfirmation.source === "editor") {
                      setStatusKey(selectedStatus?.key ?? "");
                    }
                    setPendingCloseConfirmation(null);
                  }}
                  type="button"
                >
                  Abbrechen
                </button>
              </div>
            </div>
          </div>
        )}
        <dl className="ticket-detail-facts-grid">
          <div
            className={
              detail.canUpdate ? "ticket-detail-fact--editable" : undefined
            }
          >
            <dt>Status</dt>
            <dd>
              {detail.canUpdate ? (
                <select
                  aria-label="Ticketstatus direkt ändern"
                  disabled={busy}
                  onChange={(event) => {
                    void saveOverviewChange({ statusKey: event.target.value });
                  }}
                  value={selectedStatus?.key ?? ""}
                >
                  {selectableStatuses.map((status) => (
                    <option key={status.id} value={status.key}>
                      {status.label}
                    </option>
                  ))}
                </select>
              ) : (
                (selectedStatus?.label ?? "Nicht verfügbar")
              )}
            </dd>
          </div>
          <div
            className={
              detail.canUpdate ? "ticket-detail-fact--editable" : undefined
            }
          >
            <dt>Priorität</dt>
            <dd>
              {detail.canUpdate ? (
                <select
                  aria-label="Ticketpriorität direkt ändern"
                  disabled={busy}
                  onChange={(event) => {
                    setPriorityKey(event.target.value);
                    void saveOverviewChange({
                      priorityKey: event.target.value,
                    });
                  }}
                  value={selectedPriority?.key ?? ""}
                >
                  {detail.priorities.map((priority) => (
                    <option key={priority.id} value={priority.key}>
                      {priority.label}
                    </option>
                  ))}
                </select>
              ) : (
                (selectedPriority?.label ?? "Nicht verfügbar")
              )}
            </dd>
          </div>
          <div
            className={
              detail.canAssign ? "ticket-detail-fact--editable" : undefined
            }
          >
            <dt>Zugewiesen an</dt>
            <dd>
              {detail.canAssign ? (
                <select
                  aria-label="Zugewiesene Person direkt ändern"
                  disabled={busy || assignableAgentsLoading}
                  onChange={(event) => {
                    setSelectedAgentId(event.target.value);
                    void saveOverviewChange({
                      assignedAgentId: event.target.value || null,
                    });
                  }}
                  value={detail.ticket.assigned_agent_id ?? ""}
                >
                  <option value="">Nicht zugewiesen</option>
                  {visibleAssignableAgents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.displayName}
                      {agent.id === currentUserId ? " (ich)" : ""}
                    </option>
                  ))}
                </select>
              ) : (
                (detail.assignedAgent?.displayName ?? "Nicht zugewiesen")
              )}
            </dd>
          </div>
          <div
            className={
              detail.canAssign ? "ticket-detail-fact--editable" : undefined
            }
          >
            <dt>Team</dt>
            <dd>
              {detail.canAssign ? (
                <select
                  aria-label="Zugewiesenes Team direkt ändern"
                  disabled={busy}
                  onChange={(event) => {
                    setSelectedTeamId(event.target.value);
                    void saveOverviewChange({
                      assignedTeamId: event.target.value || null,
                    });
                  }}
                  value={detail.ticket.assigned_team_id ?? ""}
                >
                  <option value="">Kein Team</option>
                  {detail.teams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </select>
              ) : (
                (selectedTeam?.name ?? "Kein Team")
              )}
            </dd>
          </div>
          {detail.requesterContact && (
            <div>
              <dt>Anfragende Person</dt>
              <dd>{detail.requesterContact.displayName}</dd>
            </div>
          )}
          <div
            className={
              detail.canUpdate && requesterProfile
                ? "ticket-detail-fact--editable ticket-requester-context"
                : undefined
            }
          >
            <dt>Abteilung / Angebot</dt>
            <dd>
              {detail.canUpdate && requesterProfile ? (
                <span className="ticket-requester-context-fields">
                  <input
                    aria-label="Abteilung der anfragenden Person"
                    disabled={busy || requesterProfileBusy}
                    onBlur={() => void saveRequesterContext()}
                    onChange={(event) =>
                      setRequesterDepartment(event.target.value)
                    }
                    placeholder="Abteilung"
                    value={requesterDepartment}
                  />
                  <input
                    aria-label="Angebot der anfragenden Person"
                    disabled={busy || requesterProfileBusy}
                    onBlur={() => void saveRequesterContext()}
                    onChange={(event) => setRequesterOffer(event.target.value)}
                    placeholder="Angebot"
                    value={requesterOffer}
                  />
                </span>
              ) : requesterContext.length > 0 ? (
                requesterContext.join(" · ")
              ) : (
                "Nicht hinterlegt"
              )}
            </dd>
          </div>
          <div
            className={
              detail.canUpdate ? "ticket-detail-fact--editable" : undefined
            }
          >
            <dt>Bearbeitende Abteilung</dt>
            <dd>
              {detail.canUpdate ? (
                <select
                  aria-label="Bearbeitende Abteilung direkt ändern"
                  disabled={busy || detail.departments.length === 0}
                  onChange={(event) => {
                    setSelectedDepartmentId(event.target.value);
                    void saveDepartmentChange(event.target.value);
                  }}
                  value={selectedDepartmentId}
                >
                  {detail.departments.map((department) => (
                    <option key={department.id} value={department.id}>
                      {department.name}
                    </option>
                  ))}
                </select>
              ) : (
                (detail.department?.name ?? "Nicht hinterlegt")
              )}
            </dd>
          </div>
          <div>
            <dt>Erfasst am</dt>
            <dd>{formatDateTime(detail.ticket.created_at)}</dd>
          </div>
        </dl>
      </section>

      <TicketCustomFields
        canUpdate={detail.canUpdate}
        tenantId={tenantId}
        ticketId={detail.ticket.id}
      />

      <section
        className="ticket-categorization ticket-detail-primary"
        aria-labelledby="ticket-categorization-heading"
      >
        <div className="ticket-detail-section-heading">
          <div>
            <p className="eyebrow">EINORDNUNG</p>
            <h3 id="ticket-categorization-heading">Kategorie</h3>
          </div>
          <FolderTree aria-hidden="true" size={19} strokeWidth={1.7} />
        </div>
        <p className="ticket-category-description">
          Ordnen Sie das Anliegen einem Bereich zu, zum Beispiel Hardware →
          Drucker oder Software → Abacus.
        </p>
        {ticketCategoriesLoading ? (
          <p className="ticket-categories-status" role="status">
            Kategorien werden geladen …
          </p>
        ) : detail.canUpdate ? (
          <div className="ticket-category-editor">
            <label>
              Kategorie
              <select
                aria-label="Ticketkategorie direkt ändern"
                disabled={ticketCategorySaving}
                onChange={(event) =>
                  void saveTicketCategory(event.target.value || null, null)
                }
                value={selectedTicketCategory?.id ?? ""}
              >
                <option value="">Keine Kategorie</option>
                {rootTicketCategories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Unterkategorie
              <select
                aria-label="Ticketunterkategorie direkt ändern"
                disabled={!selectedTicketCategory || ticketCategorySaving}
                onChange={(event) =>
                  void saveTicketCategory(
                    selectedTicketCategory?.id ?? null,
                    event.target.value || null,
                  )
                }
                value={selectedTicketSubcategory?.id ?? ""}
              >
                <option value="">
                  {selectedTicketCategory
                    ? "Keine Unterkategorie"
                    : "Zuerst Kategorie wählen"}
                </option>
                {availableTicketSubcategories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="ticket-category-actions">
              <button
                className="text-button"
                disabled={ticketCategorySaving}
                onClick={() => openTicketCategoryForm(null)}
                type="button"
              >
                Neue Kategorie
              </button>
              <button
                className="text-button"
                disabled={!selectedTicketCategory || ticketCategorySaving}
                onClick={() =>
                  selectedTicketCategory &&
                  openTicketCategoryForm(selectedTicketCategory.id)
                }
                type="button"
              >
                Neue Unterkategorie
              </button>
            </div>
            {ticketCategoryDraft && (
              <div className="ticket-category-create" role="group">
                <p className="data-caption">
                  {ticketCategoryDraftParent
                    ? `Unterkategorie von: ${ticketCategoryDraftParent.name}`
                    : "Neue Kategorie ohne übergeordnete Kategorie"}
                </p>
                <label>
                  Name
                  <input
                    autoFocus
                    disabled={ticketCategorySaving}
                    maxLength={120}
                    onChange={(event) => {
                      const name = event.target.value;
                      setTicketCategoryDraft((current) =>
                        current ? { ...current, name } : null,
                      );
                      setTicketCategoryError("");
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void createTicketCategoryFromDetail();
                      }
                    }}
                    placeholder={
                      ticketCategoryDraftParent
                        ? "Name der Unterkategorie"
                        : "Name der Kategorie"
                    }
                    value={ticketCategoryDraft.name}
                  />
                </label>
                <div>
                  <button
                    className="secondary-button"
                    disabled={ticketCategorySaving}
                    onClick={() => {
                      setTicketCategoryDraft(null);
                      setTicketCategoryError("");
                    }}
                    type="button"
                  >
                    Abbrechen
                  </button>
                  <button
                    className="primary-button"
                    disabled={
                      ticketCategorySaving || !ticketCategoryDraft.name.trim()
                    }
                    onClick={() => void createTicketCategoryFromDetail()}
                    type="button"
                  >
                    {ticketCategorySaving ? "Wird gespeichert …" : "Erstellen"}
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : selectedTicketCategory ? (
          <p className="ticket-category-summary">
            <strong>{selectedTicketCategory.name}</strong>
            {selectedTicketSubcategory &&
              ` → ${selectedTicketSubcategory.name}`}
          </p>
        ) : (
          <p className="ticket-categories-status">
            Noch keine Kategorie zugeordnet.
          </p>
        )}
        {ticketCategoryError && (
          <p className="error" role="alert">
            {ticketCategoryError}
          </p>
        )}
      </section>

      {presence.length > 0 && (
        <aside
          className="ticket-presence"
          aria-label="Aktive Ticketbearbeitung"
        >
          <UsersRound aria-hidden="true" size={17} strokeWidth={1.8} />
          <div>
            <strong>
              {presence.some((person) => person.editing)
                ? "Ticket wird parallel bearbeitet"
                : "Weitere Personen sehen dieses Ticket"}
            </strong>
            <span>
              {presence
                .map((person) =>
                  person.editing
                    ? `${person.displayName} bearbeitet gerade`
                    : person.displayName,
                )
                .join(", ")}
            </span>
          </div>
        </aside>
      )}

      {focusMode && (
        <p className="ticket-focus-notice" role="status">
          Fokusmodus aktiv: Kommunikation, Status und die nächste Aktion bleiben
          im Blick. Weitere Ticketbereiche können über „Alle Bereiche“
          eingeblendet werden.
        </p>
      )}

      <details className="ticket-detail-disclosure" open={ticketIsClosed}>
        <summary>
          <span className="ticket-detail-disclosure-label">
            <CircleCheck aria-hidden="true" size={17} strokeWidth={1.8} />
            Abschluss & Kontext
          </span>
          <span className="ticket-detail-disclosure-meta">
            Bewertungen, Wissen, Übergaben, Dateien
            <ChevronDown
              aria-hidden="true"
              className="ticket-detail-disclosure-icon"
              size={18}
              strokeWidth={1.8}
            />
          </span>
        </summary>
        <div className="ticket-detail-disclosure-content">
          <KnowledgeSection
            key={`${tenantId}:${ticketId}`}
            tenantId={tenantId}
            ticketId={ticketId}
            canUpdate={detail.canUpdate}
            canUseInternalNotes={detail.canUseInternalNotes}
            refreshToken={detail}
            onChanged={onChanged}
            onSent={loadTicket}
          />

          <section
            aria-busy={handoversLoading}
            aria-labelledby="ticket-handovers-heading"
            className="ticket-detail-comments"
          >
            <div className="ticket-detail-section-heading">
              <div>
                <p className="eyebrow">ÜBERGABEN</p>
                <h3 id="ticket-handovers-heading">Übergaben</h3>
              </div>
              <span className="data-caption">{handovers.length}</span>
            </div>
            <p className="data-caption" id="ticket-handovers-help">
              Übergaben zeigen keine Angaben zu beteiligten Personen. Bitte
              keine Namen oder anderen personenbezogenen Daten eingeben.
            </p>

            {handoverError && (
              <p className="ticket-detail-message error" role="alert">
                <AlertCircle aria-hidden="true" size={17} />
                {handoverError}
              </p>
            )}

            {detail.canUpdate ? (
              <form className="ticket-comment-form" onSubmit={createHandover}>
                <label className="ticket-comment-body">
                  Zusammenfassung
                  <textarea
                    aria-describedby="ticket-handovers-help"
                    disabled={handoverBusy || handoversLoading}
                    maxLength={2000}
                    minLength={3}
                    onChange={(event) => setHandoverSummary(event.target.value)}
                    placeholder="Was muss bei der Übergabe bekannt sein?"
                    required
                    rows={2}
                    value={handoverSummary}
                  />
                </label>
                <label className="ticket-comment-body">
                  Nächste Schritte (optional)
                  <textarea
                    disabled={handoverBusy || handoversLoading}
                    maxLength={3000}
                    onChange={(event) =>
                      setHandoverNextSteps(event.target.value)
                    }
                    placeholder="Welche Schritte stehen als Nächstes an?"
                    rows={2}
                    value={handoverNextSteps}
                  />
                </label>
                <label>
                  Risikostufe
                  <select
                    disabled={handoverBusy || handoversLoading}
                    onChange={(event) => {
                      const riskLevel = event.target.value;
                      if (isHandoverRiskLevel(riskLevel)) {
                        setHandoverRiskLevel(riskLevel);
                      }
                    }}
                    value={handoverRiskLevel}
                  >
                    <option value="low">Niedrig</option>
                    <option value="medium">Mittel</option>
                    <option value="high">Hoch</option>
                  </select>
                </label>
                <button
                  className="secondary-button"
                  disabled={handoverBusy || handoversLoading}
                  type="submit"
                >
                  {pendingHandoverAction === "create" ? (
                    <LoaderCircle
                      aria-hidden="true"
                      className="ticket-detail-spinner"
                      size={16}
                    />
                  ) : (
                    <Circle aria-hidden="true" size={16} strokeWidth={1.8} />
                  )}
                  Übergabe erstellen
                </button>
              </form>
            ) : (
              <p className="data-caption">
                Sie haben für Übergaben nur Leserechte.
              </p>
            )}

            {handoversLoading && !handoversLoaded ? (
              <p className="empty-state ticket-detail-loading" role="status">
                <LoaderCircle
                  aria-hidden="true"
                  className="ticket-detail-spinner"
                  size={18}
                />
                Übergaben werden geladen …
              </p>
            ) : handovers.length === 0 && !handoverError ? (
              <p className="empty-state">Noch keine Übergaben vorhanden.</p>
            ) : handovers.length > 0 ? (
              <ol className="ticket-comment-list" aria-busy={handoversLoading}>
                {handovers.map((handover) => {
                  const status = handoverStatus(handover);
                  const isAcknowledging =
                    pendingHandoverAction === "acknowledge" &&
                    pendingHandoverId === handover.id;
                  const isResolving =
                    pendingHandoverAction === "resolve" &&
                    pendingHandoverId === handover.id;

                  return (
                    <li className="ticket-comment" key={handover.id}>
                      <div className="ticket-comment-meta">
                        <strong>{handover.summary}</strong>
                        <span className="ticket-comment-visibility-badge internal">
                          Risiko: {handoverRiskLevelLabel(handover.riskLevel)}
                        </span>
                        <span className="ticket-comment-visibility-badge external">
                          {handoverStatusLabel(status)}
                        </span>
                        <time dateTime={handover.createdAt}>
                          Erstellt am {formatDateTime(handover.createdAt)}
                        </time>
                        {handover.acknowledgedAt && (
                          <time dateTime={handover.acknowledgedAt}>
                            Übernommen am{" "}
                            {formatDateTime(handover.acknowledgedAt)}
                          </time>
                        )}
                        {handover.resolvedAt && (
                          <time dateTime={handover.resolvedAt}>
                            Erledigt am {formatDateTime(handover.resolvedAt)}
                          </time>
                        )}
                      </div>
                      <p>
                        <strong>Nächste Schritte:</strong>{" "}
                        {handover.nextSteps ??
                          "Keine nächsten Schritte angegeben."}
                      </p>
                      {detail.canUpdate && status === "open" && (
                        <button
                          aria-label={`Übergabe „${handover.summary}“ übernehmen`}
                          className="secondary-button"
                          disabled={handoverBusy || handoversLoading}
                          onClick={() => void acknowledgeHandover(handover)}
                          type="button"
                        >
                          {isAcknowledging ? (
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
                          Übernehmen
                        </button>
                      )}
                      {detail.canUpdate && status === "acknowledged" && (
                        <button
                          aria-label={`Übergabe „${handover.summary}“ als erledigt markieren`}
                          className="secondary-button"
                          disabled={handoverBusy || handoversLoading}
                          onClick={() => void resolveHandover(handover)}
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
                          Als erledigt
                        </button>
                      )}
                    </li>
                  );
                })}
              </ol>
            ) : null}
          </section>

          <section
            aria-busy={affectedItemsLoading}
            aria-labelledby="ticket-affected-items-heading"
            className="ticket-detail-comments"
          >
            <div className="ticket-detail-section-heading">
              <div>
                <p className="eyebrow">KATALOG</p>
                <h3 id="ticket-affected-items-heading">Betroffene Elemente</h3>
              </div>
              <span className="data-caption">{linkedCatalogItems.length}</span>
            </div>
            <p className="data-caption" id="ticket-affected-items-help">
              Verknüpfte Services, Assets und Problemfälle dieses Tickets.
            </p>

            {affectedItemsError && (
              <p className="ticket-detail-message error" role="alert">
                <AlertCircle aria-hidden="true" size={17} />
                {affectedItemsError}
              </p>
            )}

            {detail.canUpdate ? (
              <form className="ticket-comment-form" onSubmit={linkCatalogItem}>
                <label>
                  Katalogeintrag verknüpfen
                  <select
                    aria-describedby="ticket-affected-items-help"
                    disabled={
                      catalogBusy ||
                      affectedItemsLoading ||
                      availableCatalogItems.length === 0
                    }
                    onChange={(event) =>
                      setSelectedCatalogItemKey(event.target.value)
                    }
                    required
                    value={selectedCatalogItemKey}
                  >
                    <option value="">Katalogeintrag auswählen</option>
                    {availableCatalogItems.map((item) => (
                      <option
                        key={catalogSelectionKey(item)}
                        value={catalogSelectionKey(item)}
                      >
                        {catalogKindLabel(item.kind)} – {item.label} (
                        {item.description})
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="secondary-button"
                  disabled={
                    catalogBusy ||
                    affectedItemsLoading ||
                    !selectedCatalogItemKey
                  }
                  type="submit"
                >
                  {pendingCatalogAction === "link" ? (
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
                {availableCatalogItems.length === 0 && affectedItemsLoaded ? (
                  <p className="data-caption" aria-live="polite">
                    Keine weiteren verfügbaren Katalogeinträge.
                  </p>
                ) : null}
              </form>
            ) : (
              <p className="data-caption">
                Sie haben für diese Elemente nur Leserechte.
              </p>
            )}

            {affectedItemsLoading && !affectedItemsLoaded ? (
              <p className="empty-state ticket-detail-loading" role="status">
                <LoaderCircle
                  aria-hidden="true"
                  className="ticket-detail-spinner"
                  size={18}
                />
                Betroffene Elemente werden geladen …
              </p>
            ) : linkedCatalogItems.length === 0 && !affectedItemsError ? (
              <p className="empty-state">
                Keine Elemente mit diesem Ticket verknüpft.
              </p>
            ) : linkedCatalogItems.length > 0 ? (
              <ol
                className="ticket-comment-list"
                aria-busy={affectedItemsLoading}
              >
                {linkedCatalogItems.map((item) => {
                  const itemKey = catalogItemKey(item);
                  const isUnlinking =
                    pendingCatalogAction === "unlink" &&
                    pendingCatalogItemKey === itemKey;

                  return (
                    <li className="ticket-comment" key={itemKey}>
                      <div className="ticket-comment-meta">
                        <strong>{item.label}</strong>
                        <span className="ticket-comment-visibility-badge internal">
                          {catalogKindLabel(item.kind)}
                        </span>
                        {item.metadata.length > 0 && (
                          <span>{item.metadata.join(" · ")}</span>
                        )}
                      </div>
                      {detail.canUpdate && (
                        <button
                          aria-label={`Verknüpfung mit ${catalogKindLabel(item.kind)} ${item.label} entfernen`}
                          className="secondary-button"
                          disabled={catalogBusy || affectedItemsLoading}
                          onClick={() => void unlinkCatalogItem(item)}
                          type="button"
                        >
                          {isUnlinking ? (
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
            ) : null}
          </section>

          <section
            aria-busy={qualityLoading}
            aria-labelledby="ticket-quality-heading"
            className="ticket-detail-comments"
          >
            <div className="ticket-detail-section-heading">
              <div>
                <p className="eyebrow">QUALITÄT</p>
                <h3 id="ticket-quality-heading">Qualitätsprüfung</h3>
              </div>
            </div>

            {qualityLoading ? (
              <p className="empty-state ticket-detail-loading" role="status">
                <LoaderCircle
                  aria-hidden="true"
                  className="ticket-detail-spinner"
                  size={18}
                />
                Qualitätsprüfungsdaten werden geladen …
              </p>
            ) : null}

            {qualityError && (
              <p className="ticket-detail-message error" role="alert">
                <AlertCircle aria-hidden="true" size={17} />
                {qualityError}
              </p>
            )}
            {qualitySuccess && (
              <p className="ticket-detail-message success" role="status">
                <CircleCheck aria-hidden="true" size={17} />
                {qualitySuccess}
              </p>
            )}

            {!qualityLoading && !quality && !qualityError ? (
              <p className="data-caption">
                {ticketIsClosed
                  ? "Die Qualitätsprüfung wird nach einer erneuten Berechtigungsprüfung angezeigt."
                  : "Nach dem Schliessen können berechtigte Mitarbeitende eine Qualitätsprüfung abgeben."}
              </p>
            ) : null}

            {quality && quality.canRead ? (
              <>
                <div className="ticket-comment">
                  <div className="ticket-comment-meta">
                    <strong>Übersicht</strong>
                    <span>
                      {quality.count}{" "}
                      {quality.count === 1 ? "Bewertung" : "Bewertungen"}
                    </span>
                    <span>
                      Durchschnitt:{" "}
                      {quality.averageScore === null
                        ? "Noch keine Bewertung"
                        : `${new Intl.NumberFormat("de-CH", {
                            minimumFractionDigits: 1,
                            maximumFractionDigits: 2,
                          }).format(quality.averageScore)} von 5`}
                    </span>
                  </div>
                </div>

                {quality.canReview ? (
                  <form className="ticket-comment-form" onSubmit={saveQuality}>
                    <fieldset
                      className="ticket-comment-visibility"
                      disabled={busy}
                    >
                      <legend>Eigene Qualitätsbewertung</legend>
                      {[1, 2, 3, 4, 5].map((score) => (
                        <label key={score}>
                          <input
                            checked={qualityScore === score}
                            name="ticket-quality-score"
                            onChange={() => setQualityScore(score)}
                            required
                            type="radio"
                            value={score}
                          />
                          <Star
                            aria-hidden="true"
                            size={16}
                            strokeWidth={1.8}
                          />{" "}
                          {score} {score === 1 ? "Stern" : "Sterne"}
                        </label>
                      ))}
                    </fieldset>
                    <label className="ticket-comment-body">
                      Notizen (optional)
                      <textarea
                        disabled={busy}
                        maxLength={3000}
                        onChange={(event) =>
                          setQualityNotes(event.target.value)
                        }
                        placeholder="Notizen zur Qualitätsprüfung"
                        rows={3}
                        value={qualityNotes}
                      />
                    </label>
                    <p className="data-caption" aria-live="polite">
                      {[...qualityNotes].length}/3&apos;000 Zeichen
                    </p>
                    <button
                      className="primary-button"
                      disabled={busy || qualityScore === null}
                      type="submit"
                    >
                      {pendingAction === "quality-review" ? (
                        <LoaderCircle
                          aria-hidden="true"
                          className="ticket-detail-spinner"
                          size={16}
                        />
                      ) : (
                        <Save aria-hidden="true" size={16} strokeWidth={1.8} />
                      )}
                      Qualitätsprüfung speichern
                    </button>
                  </form>
                ) : (
                  <p className="data-caption">
                    Eine eigene Qualitätsprüfung ist nur für geschlossene
                    Tickets mit entsprechender Berechtigung möglich.
                  </p>
                )}
              </>
            ) : quality && !quality.canRead ? (
              <p className="data-caption">
                Die Qualitätsübersicht ist nur für berechtigte Mitarbeitende
                sichtbar.
              </p>
            ) : null}
          </section>

          <section
            aria-busy={feedbackLoading}
            aria-labelledby="ticket-satisfaction-heading"
            className="ticket-detail-comments"
          >
            <div className="ticket-detail-section-heading">
              <div>
                <p className="eyebrow">ZUFRIEDENHEIT</p>
                <h3 id="ticket-satisfaction-heading">Zufriedenheit</h3>
              </div>
            </div>

            {feedbackLoading ? (
              <p className="empty-state ticket-detail-loading" role="status">
                <LoaderCircle
                  aria-hidden="true"
                  className="ticket-detail-spinner"
                  size={18}
                />
                Zufriedenheitsdaten werden geladen …
              </p>
            ) : null}

            {feedbackError && (
              <p className="ticket-detail-message error" role="alert">
                <AlertCircle aria-hidden="true" size={17} />
                {feedbackError}
              </p>
            )}
            {feedbackSuccess && (
              <p className="ticket-detail-message success" role="status">
                <CircleCheck aria-hidden="true" size={17} />
                {feedbackSuccess}
              </p>
            )}

            {!feedbackLoading && !feedback && !feedbackError ? (
              <p className="data-caption">
                Kundenfeedback kann abgegeben werden, sobald das Ticket
                geschlossen ist.
              </p>
            ) : null}

            {feedback && (
              <>
                {feedback.satisfaction ? (
                  <div className="ticket-comment">
                    <div className="ticket-comment-meta">
                      <strong>Bestehende Bewertung</strong>
                      <span>
                        {feedback.satisfaction.score === null
                          ? "Bewertung nicht verfügbar"
                          : `${feedback.satisfaction.score} von 5 Sternen`}
                      </span>
                    </div>
                    {feedback.satisfaction.comment && (
                      <p>
                        <strong>Kommentar:</strong>{" "}
                        {feedback.satisfaction.comment}
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="empty-state">Noch keine Bewertung vorhanden.</p>
                )}

                {feedback.canRate && feedback.isClosed ? (
                  <form className="ticket-comment-form" onSubmit={saveFeedback}>
                    <fieldset
                      className="ticket-comment-visibility"
                      disabled={busy}
                    >
                      <legend>Bewertung auswählen</legend>
                      {[1, 2, 3, 4, 5].map((score) => (
                        <label key={score}>
                          <input
                            checked={feedbackScore === score}
                            name="ticket-satisfaction-score"
                            onChange={() => setFeedbackScore(score)}
                            required
                            type="radio"
                            value={score}
                          />
                          <Star
                            aria-hidden="true"
                            size={16}
                            strokeWidth={1.8}
                          />{" "}
                          {score} {score === 1 ? "Stern" : "Sterne"}
                        </label>
                      ))}
                    </fieldset>
                    <label className="ticket-comment-body">
                      Kommentar (optional)
                      <textarea
                        disabled={busy}
                        maxLength={3000}
                        onChange={(event) =>
                          setFeedbackComment(event.target.value)
                        }
                        placeholder="Ihre Rückmeldung zur Ticketlösung"
                        rows={3}
                        value={feedbackComment}
                      />
                    </label>
                    <p className="data-caption" aria-live="polite">
                      {[...feedbackComment].length}/3&apos;000 Zeichen
                    </p>
                    <button
                      className="primary-button"
                      disabled={busy || feedbackScore === null}
                      type="submit"
                    >
                      {pendingAction === "feedback" ? (
                        <LoaderCircle
                          aria-hidden="true"
                          className="ticket-detail-spinner"
                          size={16}
                        />
                      ) : (
                        <Save aria-hidden="true" size={16} strokeWidth={1.8} />
                      )}
                      Bewertung speichern
                    </button>
                  </form>
                ) : !feedback.isClosed ? (
                  <p className="data-caption">
                    Eine Bewertung kann nach dem Schliessen des Tickets
                    abgegeben werden.
                  </p>
                ) : null}
              </>
            )}
          </section>

          <section
            className="ticket-detail-comments"
            aria-labelledby="ticket-attachments-heading"
          >
            <div className="ticket-detail-section-heading">
              <div>
                <p className="eyebrow">ANHÄNGE</p>
                <h3 id="ticket-attachments-heading">Anhänge</h3>
              </div>
              <span className="data-caption">{attachments.length}</span>
            </div>
            <p className="data-caption" id="ticket-attachments-help">
              Erlaubt sind {ATTACHMENT_ALLOWLIST_LABEL}. Maximal 25 MiB pro
              Datei.
            </p>

            {attachmentError && (
              <p className="ticket-detail-message error" role="alert">
                <AlertCircle aria-hidden="true" size={17} />
                {attachmentError}
              </p>
            )}

            {detail.canUpdate && (
              <form className="ticket-comment-form" onSubmit={uploadAttachment}>
                <label className="ticket-comment-body">
                  Datei auswählen
                  <input
                    accept={ATTACHMENT_ACCEPT}
                    aria-describedby="ticket-attachments-help"
                    disabled={attachmentBusy || busy}
                    onChange={(event) =>
                      selectAttachmentFile(event.target.files?.[0] ?? null)
                    }
                    ref={attachmentInputRef}
                    type="file"
                  />
                </label>
                {pendingAttachmentAction === "upload" ? (
                  <p
                    className="data-caption ticket-detail-loading"
                    role="status"
                  >
                    <LoaderCircle
                      aria-hidden="true"
                      className="ticket-detail-spinner"
                      size={16}
                    />
                    Anhang wird hochgeladen …
                  </p>
                ) : selectedAttachmentFile ? (
                  <p className="data-caption" aria-live="polite">
                    Ausgewählt: {selectedAttachmentFile.name} (
                    {formatFileSize(selectedAttachmentFile.size)})
                  </p>
                ) : null}
                <button
                  className="secondary-button"
                  disabled={attachmentBusy || busy || !selectedAttachmentFile}
                  type="submit"
                >
                  {pendingAttachmentAction === "upload" ? (
                    <LoaderCircle
                      aria-hidden="true"
                      className="ticket-detail-spinner"
                      size={16}
                    />
                  ) : (
                    <Circle aria-hidden="true" size={16} strokeWidth={1.8} />
                  )}
                  Anhang hochladen
                </button>
              </form>
            )}

            {attachmentsLoading && !attachmentsLoaded ? (
              <p className="empty-state ticket-detail-loading" role="status">
                <LoaderCircle
                  aria-hidden="true"
                  className="ticket-detail-spinner"
                  size={18}
                />
                Anhänge werden geladen …
              </p>
            ) : attachments.length === 0 ? (
              <p className="empty-state">Noch keine Anhänge vorhanden.</p>
            ) : (
              <ol
                className="ticket-comment-list"
                aria-busy={attachmentsLoading}
              >
                {attachments.map((attachment) => {
                  const isDownloading =
                    pendingAttachmentAction === "download" &&
                    pendingAttachmentId === attachment.id;
                  const isDeleting =
                    pendingAttachmentAction === "delete" &&
                    pendingAttachmentId === attachment.id;

                  return (
                    <li className="ticket-comment" key={attachment.id}>
                      <div className="ticket-comment-meta">
                        <strong>{attachment.originalFilename}</strong>
                        <span>{formatFileSize(attachment.byteSize)}</span>
                        <time dateTime={attachment.createdAt}>
                          Hochgeladen am {formatDateTime(attachment.createdAt)}
                        </time>
                      </div>
                      <div className="ticket-detail-actions">
                        <button
                          aria-label={`${attachment.originalFilename} herunterladen`}
                          className="secondary-button"
                          disabled={attachmentBusy || busy}
                          onClick={() => void downloadAttachment(attachment)}
                          type="button"
                        >
                          {isDownloading ? (
                            <LoaderCircle
                              aria-hidden="true"
                              className="ticket-detail-spinner"
                              size={16}
                            />
                          ) : (
                            <Save
                              aria-hidden="true"
                              size={16}
                              strokeWidth={1.8}
                            />
                          )}
                          Herunterladen
                        </button>
                        {detail.canUpdate && (
                          <button
                            aria-label={`${attachment.originalFilename} löschen`}
                            className="secondary-button"
                            disabled={attachmentBusy || busy}
                            onClick={() => void deleteAttachment(attachment)}
                            type="button"
                          >
                            {isDeleting ? (
                              <LoaderCircle
                                aria-hidden="true"
                                className="ticket-detail-spinner"
                                size={16}
                              />
                            ) : (
                              <X
                                aria-hidden="true"
                                size={16}
                                strokeWidth={1.8}
                              />
                            )}
                            Löschen
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        </div>
      </details>

      <details
        className="ticket-detail-disclosure"
        onToggle={(event) => setIsWorkToolsOpen(event.currentTarget.open)}
        open={isWorkToolsOpen}
      >
        <summary>
          <span className="ticket-detail-disclosure-label">
            <CircleCheck aria-hidden="true" size={17} strokeWidth={1.8} />
            Arbeitswerkzeuge
          </span>
          <span className="ticket-detail-disclosure-meta">
            {[
              detail.ticketModules.checklists ? "Checkliste" : null,
              "Status",
              "Eskalationen",
            ]
              .filter(Boolean)
              .join(", ")}
            <ChevronDown
              aria-hidden="true"
              className="ticket-detail-disclosure-icon"
              size={18}
              strokeWidth={1.8}
            />
          </span>
        </summary>
        <div className="ticket-detail-disclosure-content">
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
                {openEscalations.length} offen / {detail.escalations.length}{" "}
                gesamt
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
                      if (isEscalationKind(nextKind))
                        setEscalationKind(nextKind);
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
                    onChange={(event) =>
                      setEscalationReason(event.target.value)
                    }
                    placeholder="Warum muss dieses Ticket eskaliert werden?"
                    required
                    rows={3}
                    value={escalationReason}
                  />
                </label>
                <button
                  className="secondary-button"
                  disabled={busy}
                  type="submit"
                >
                  {pendingAction === "escalation-open" ? (
                    <LoaderCircle
                      aria-hidden="true"
                      className="ticket-detail-spinner"
                      size={16}
                    />
                  ) : (
                    <AlertCircle
                      aria-hidden="true"
                      size={16}
                      strokeWidth={1.8}
                    />
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
              <span className="data-caption">
                {historicalEscalations.length}
              </span>
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

          <TicketApprovals tenantId={tenantId} ticketId={ticketId} />

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
                  const canDeleteRelation = isRelationType(
                    relation.relationType,
                  );
                  const isDeleting =
                    pendingAction === "relation-delete" &&
                    pendingRelationKey === relationKey;

                  return (
                    <li
                      className="ticket-comment"
                      key={relation.id ?? relationKey}
                    >
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
              <span className="data-caption">
                {detail.similarTickets.length}
              </span>
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
                {detail.similarTickets.map((ticket) => (
                  <li className="ticket-comment" key={ticket.id}>
                    <div className="ticket-comment-meta">
                      <strong>{ticketReference(ticket)}</strong>
                      <span>{ticket.statusLabel}</span>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <TicketComparison
            candidates={[
              ...detail.relations.map((relation) => ({
                id: relation.relatedTicketId,
                ticketNumber: relation.ticketNumber,
                subject: relation.subject,
                statusLabel: relation.statusLabel,
              })),
              ...detail.similarTickets,
            ]}
            tenantId={tenantId}
            ticketId={ticketId}
          />

          {detail.canMerge && (
            <section
              aria-busy={mergeSearchLoading || pendingAction === "merge"}
              aria-labelledby="ticket-merge-heading"
              className="ticket-detail-comments"
            >
              <div className="ticket-detail-section-heading">
                <div>
                  <p className="eyebrow">ZUSAMMENFÜHREN</p>
                  <h3 id="ticket-merge-heading">Zusammenführen</h3>
                </div>
              </div>
              <p className="data-caption" id="ticket-merge-help">
                Das aktuelle Ticket wird als Duplikat geschlossen und im
                gewählten Hauptticket referenziert.
              </p>
              <label className="ticket-comment-body">
                Hauptticket suchen
                <input
                  aria-describedby="ticket-merge-help"
                  disabled={busy}
                  maxLength={240}
                  minLength={2}
                  onChange={(event) => setMergeQuery(event.target.value)}
                  placeholder="Ticketnummer oder Titel eingeben"
                  type="search"
                  value={mergeQuery}
                />
              </label>
              <p className="data-caption" aria-live="polite">
                {[...mergeQuery.trim()].length < 2
                  ? "Mindestens 2 Zeichen eingeben."
                  : "Es werden passende Haupttickets gesucht."}
              </p>

              {mergeError && (
                <p className="ticket-detail-message error" role="alert">
                  <AlertCircle aria-hidden="true" size={17} />
                  {mergeError}
                </p>
              )}

              {mergeSearchLoading && (
                <p className="empty-state ticket-detail-loading" role="status">
                  <LoaderCircle
                    aria-hidden="true"
                    className="ticket-detail-spinner"
                    size={18}
                  />
                  Haupttickets werden gesucht …
                </p>
              )}

              {!mergeSearchLoading &&
              [...mergeQuery.trim()].length >= 2 &&
              mergeTargets.length === 0 &&
              !mergeError ? (
                <p className="empty-state">
                  Keine passenden Haupttickets gefunden.
                </p>
              ) : null}

              {mergeTargets.length > 0 && (
                <ol className="ticket-comment-list">
                  {mergeTargets.map((target) => {
                    const isConfirming =
                      mergeConfirmationTarget?.id === target.id;
                    const isMerging =
                      pendingAction === "merge" &&
                      pendingRelationKey === `merge:${target.id}`;

                    return (
                      <li className="ticket-comment" key={target.id}>
                        <div className="ticket-comment-meta">
                          <strong>{ticketReference(target)}</strong>
                          <span>{target.statusLabel}</span>
                        </div>
                        {isConfirming ? (
                          <div>
                            <p className="data-caption" role="status">
                              Bitte bestätigen: Das aktuelle Ticket wird als
                              Duplikat geschlossen und in diesem Hauptticket
                              referenziert.
                            </p>
                            <div className="ticket-detail-actions">
                              <button
                                className="primary-button"
                                disabled={busy || mergeSearchLoading}
                                onClick={() => void markMerged(target)}
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
                                Zusammenführen bestätigen
                              </button>
                              <button
                                className="secondary-button"
                                disabled={busy}
                                onClick={() => setMergeConfirmationTarget(null)}
                                type="button"
                              >
                                Abbrechen
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            aria-label={`Aktuelles Ticket in ${ticketReference(target)} zusammenführen`}
                            className="secondary-button"
                            disabled={busy || mergeSearchLoading}
                            onClick={() => setMergeConfirmationTarget(target)}
                            type="button"
                          >
                            In dieses Ticket zusammenführen
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ol>
              )}
            </section>
          )}

          {detail.ticketModules.timeTracking && detail.canTrackTime && (
            <section
              className="ticket-detail-comments"
              aria-labelledby="ticket-time-entries-heading"
            >
              <div className="ticket-detail-section-heading">
                <div>
                  <p className="eyebrow">ARBEITSZEIT</p>
                  <h3 id="ticket-time-entries-heading">Arbeitszeit erfassen</h3>
                </div>
                <span className="data-caption">
                  {detail.timeEntries.length}
                </span>
              </div>

              <form className="ticket-comment-form" onSubmit={saveTimeEntry}>
                <label>
                  Minuten
                  <input
                    disabled={busy}
                    inputMode="numeric"
                    max={1440}
                    min={1}
                    onChange={(event) =>
                      setTimeEntryMinutes(event.target.value)
                    }
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
                <button
                  className="secondary-button"
                  disabled={busy}
                  type="submit"
                >
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

          {detail.ticketModules.checklists && (
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
                    detail.checklistItems.filter(
                      (item) => item.completed_at !== null,
                    ).length
                  }
                  /{detail.checklistItems.length} erledigt
                </span>
              </div>

              {detail.canUpdate && (
                <form
                  className="ticket-comment-form"
                  onSubmit={addChecklistItem}
                >
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
                  <button
                    className="secondary-button"
                    disabled={busy}
                    type="submit"
                  >
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
                <p className="empty-state">
                  Noch keine Checklistenpunkte vorhanden.
                </p>
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
                            <Circle
                              aria-hidden="true"
                              size={16}
                              strokeWidth={1.8}
                            />
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
          )}

          {detail.canUpdate && (
            <section
              className="ticket-detail-editor"
              aria-labelledby="ticket-status-heading"
              id="ticket-editor"
            >
              <div className="ticket-detail-section-heading">
                <div>
                  <p className="eyebrow">BEARBEITEN</p>
                  <h3 id="ticket-status-heading">Ticket bearbeiten</h3>
                </div>
              </div>
              {isEditingTicket && (
                <div className="ticket-comment-form">
                  <label className="ticket-comment-body">
                    Titel
                    <input
                      autoFocus
                      disabled={busy}
                      maxLength={240}
                      minLength={3}
                      onChange={(event) => setEditSubject(event.target.value)}
                      required
                      value={editSubject}
                    />
                  </label>
                  <p className="data-caption" aria-live="polite">
                    {[...editSubject].length}/240 Zeichen
                  </p>
                  <label className="ticket-comment-body">
                    Beschreibung
                    <textarea
                      disabled={busy}
                      maxLength={10_000}
                      minLength={1}
                      onChange={(event) =>
                        setEditDescription(event.target.value)
                      }
                      required
                      rows={5}
                      value={editDescription}
                    />
                  </label>
                  <p className="data-caption" aria-live="polite">
                    {[...editDescription].length}/10&apos;000 Zeichen
                  </p>
                  <button
                    className="secondary-button"
                    disabled={busy}
                    onClick={cancelTicketEdit}
                    type="button"
                  >
                    Abbrechen
                  </button>
                </div>
              )}
              <div className="ticket-detail-selects">
                <label>
                  Status
                  <select
                    disabled={busy || detail.statuses.length === 0}
                    onChange={(event) => setStatusKey(event.target.value)}
                    value={statusKey}
                  >
                    {selectableStatuses.map((status) => (
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
                {detail.canAssign ? (
                  <label>
                    Zugewiesener Agent
                    <select
                      disabled={busy || assignableAgentsLoading}
                      onChange={(event) =>
                        setSelectedAgentId(event.target.value)
                      }
                      value={selectedAgentId}
                    >
                      <option value="">Nicht zugewiesen</option>
                      {visibleAssignableAgents.map((agent) => (
                        <option key={agent.id} value={agent.id}>
                          {agent.displayName}
                          {agent.id === currentUserId ? " (Ich)" : ""}
                        </option>
                      ))}
                    </select>
                    <span className="data-caption">
                      {assignableAgentsLoading
                        ? "Agenten werden geladen …"
                        : "Alle aktiven, für diese Abteilung berechtigten Agenten des Mandanten stehen zur Auswahl."}
                    </span>
                    {assignableAgentsError && (
                      <span className="error" role="alert">
                        {assignableAgentsError}
                      </span>
                    )}
                  </label>
                ) : (
                  <p className="data-caption">
                    Zugewiesener Agent:{" "}
                    {detail.assignedAgent?.displayName ?? "Nicht zugewiesen"}
                  </p>
                )}
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
                {isEditingTicket ? "Speichern" : "Änderungen speichern"}
              </button>
            </section>
          )}
        </div>
      </details>

      <details className="ticket-detail-disclosure">
        <summary>
          <span className="ticket-detail-disclosure-label">
            <Clock3 aria-hidden="true" size={17} strokeWidth={1.8} />
            Verlauf
          </span>
          <span className="ticket-detail-disclosure-meta">
            {detail.events.length} Ereignisse
            <ChevronDown
              aria-hidden="true"
              className="ticket-detail-disclosure-icon"
              size={18}
              strokeWidth={1.8}
            />
          </span>
        </summary>
        <div className="ticket-detail-disclosure-content">
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
                    <MessageSquare
                      aria-hidden="true"
                      size={16}
                      strokeWidth={1.8}
                    />
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
        </div>
      </details>
    </section>
  );
}
