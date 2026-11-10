import { TicketAiTriage } from "./ticket-ai-triage";
import { TicketAiSummary } from "./ticket-ai-summary";
import { RequesterTicketProgress } from "./requester-ticket-progress";
import {
  absenceLabel,
  loadActiveAbsences,
  type ActiveAbsence,
} from "./lib/active-absences";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
} from "react";
import {
  AlertCircle,
  AlertTriangle,
  Circle,
  BookOpen,
  CircleCheck,
  Clock,
  ListChecks,
  Paperclip,
  Pencil,
  ChevronDown,
  Clock3,
  Eye,
  EyeOff,
  ImagePlus,
  LoaderCircle,
  Mail,
  MessageSquare,
  Phone,
  Plus,
  RefreshCw,
  Save,
  Search,
  Send,
  Sparkles,
  Star,
  UsersRound,
  X,
} from "lucide-react";
import {
  ticketCommentComposerCopy,
  ticketCommentComposerModeForTicketContext,
  ticketCommentDraftForMode,
  updateTicketCommentDraft,
  type TicketCommentComposerContext,
  isReplyGreetingOnly,
  ticketReplyGreeting,
} from "./lib/ticket-comment-composer";
import {
  chronologicalTicketComments,
  ticketConversationCountLabel,
} from "./lib/ticket-comment-order";
import {
  isTrustedTicketInlineImageUrl,
  ticketInlineAttachmentIds,
  ticketInlineMediaSegments,
} from "./lib/ticket-inline-media";
import {
  MAX_TICKET_COMMENT_IMAGE_ATTACHMENTS,
  ticketCommentAttachmentIds,
  ticketCommentBodyWithAttachments,
} from "./lib/ticket-comment-attachments";
import { ticketWatchPresentation } from "./lib/ticket-watch-presentation";
import { formatPersonDisplayName } from "./lib/person-display-name";
import {
  searchTicketCatalogItems,
  shouldLoadTicketCatalog,
} from "./lib/ticket-catalog-search";
import { supabase } from "./lib/supabase";
import { recordRecentItem } from "./lib/recent-items";
import { functionErrorMessage } from "./lib/function-error";
import { TicketControlPanel } from "./ticket-control";
import { knowledgeErrorBackendMessage } from "./lib/knowledge-errors";
import {
  parseKnowledgeImageUrls,
  type KnowledgeImageUrls,
} from "./lib/knowledge-images";
import { KnowledgeMarkdown } from "./knowledge-markdown";
import {
  TicketIncidentBanner,
  TicketPersonDevices,
  TicketSolutionPrompt,
} from "./ticket-learning";
import {
  parseEmailSenderContacts,
  phoneHref,
  splitPlainTextSignature,
  type EmailSenderContacts,
} from "./email-signature-frame";
import { TicketApprovals } from "./ticket-approvals";
import { TicketComparison } from "./ticket-comparison";
import { TicketCustomFields } from "./ticket-custom-fields";
import { TicketIntuneActions } from "./intune-actions";
import { intuneActionEventLabel } from "./lib/intune-actions";
import {
  TicketFollowUps,
  TicketResolutionExperience,
} from "./ticket-experience";
import "./ticket-experience.css";
import { TicketPdfRecord } from "./ticket-pdf-record";
import { TicketCoordination } from "./ticket-coordination";
import { TicketSlaBreachReason } from "./ticket-sla-breach-reason";
import { TicketSupportLevel } from "./ticket-support-level";
import {
  TicketFormAnswersBlock,
  parseStoredFormAnswers,
  type StoredFormAnswers,
} from "./ticket-template-form-fields";
import {
  TicketCopyRecipients,
  TicketMentionPicker,
  type CopyRecipient,
  useTicketReplyDraft,
} from "./ticket-workbench";

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
};

type UndoChange = {
  change: {
    assignedAgentId?: string | null;
    assignedTeamId?: string | null;
    priorityKey?: string;
    statusKey?: string;
  };
  label: string;
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
      composing: "external" | "internal" | null;
    };

type AddCommentAction = {
  type: "addComment";
  tenantId: string;
  ticketId: string;
  body: string;
  visibility: CommentVisibility;
  attachmentIds?: string[];
  copyEmails?: string[];
};

type SaveDraftAction = {
  type: "saveDraft";
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
  | SaveDraftAction
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
      visibility?: CommentVisibility;
    }
  | {
      type: "completeUpload";
      tenantId: string;
      ticketId: string;
      storageObjectPath: string;
      originalFilename: string;
      contentType: string;
      byteSize: number;
      visibility?: CommentVisibility;
    }
  | {
      type: "createDownloadUrl";
      tenantId: string;
      ticketId: string;
      attachmentId: string;
    }
  | {
      type: "createInlineImageUrls";
      tenantId: string;
      ticketId: string;
      attachmentIds: string[];
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
  /** These optional fields keep older ticket-operation deployments compatible. */
  requester_id?: string;
  affected_user_id?: string | null;
  resolved_at?: string | null;
};

type TicketComment = {
  id: string;
  authorName: string;
  authorKind?: "agent" | "requester" | "customer";
  body: string;
  created_at: string;
  visibility: CommentVisibility;
  channel?: "portal" | "email";
  emailDelivery?: "pending" | "sent" | "failed" | null;
};

type TicketEvent = {
  id: string;
  event_type: string;
  created_at: string;
  payload?: Record<string, unknown> | null;
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
  photoUrl: string | null;
  editing: boolean;
  composing: "external" | "internal" | null;
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

type SimilarTicketSolution = {
  /** Full solution text for the reply editor. */
  text: string;
  /** About 300 characters for the list. */
  excerpt: string;
};

type SimilarTicket = {
  id: string;
  ticketNumber: string;
  subject: string;
  statusLabel: string;
  /** Missing in older deployments. */
  isClosed?: boolean;
  rank?: number;
  solution?: SimilarTicketSolution | null;
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
  commentId: string | null;
  visibility: CommentVisibility;
  originalFilename: string;
  contentType: string;
  byteSize: number;
  createdAt: string;
};

const COMMENT_PREVIEW_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

type QueuedCommentImage = {
  key: string;
  file: File;
  originalFilename: string;
  byteSize: number;
};

type CommentImageNotice = {
  tone: "error" | "success";
  text: string;
};

type AttachmentUpload = {
  storageObjectPath: string;
  signedUrl: string;
  contentType: string;
  byteSize: number;
};

type TicketInlineImage = {
  attachmentId: string;
  originalFilename: string;
  signedUrl: string;
};

type TicketSatisfaction = {
  score: number | null;
  comment: string | null;
};

type TicketFeedbackData = {
  satisfaction: TicketSatisfaction | null;
  canRate: boolean;
  isClosed: boolean;
  /** Resolved or closed: the requester may rate. */
  isRatable: boolean;
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
  description: string | null;
  criticality: string;
};

type CatalogAsset = {
  id: string;
  name: string;
  assetTag: string | null;
  kind: string;
  status: string;
  primaryPersonName: string | null;
};

type CatalogProblem = {
  id: string;
  title: string;
  description: string | null;
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

type TicketServerDraft = {
  visibility: CommentVisibility;
  body: string;
  updatedAt: string;
};

function toTicketServerDraft(value: unknown): TicketServerDraft | null {
  const record = asRecord(value);
  if (
    !record ||
    (record.visibility !== "internal" && record.visibility !== "external") ||
    typeof record.body !== "string" ||
    record.body.length > 50_000 ||
    typeof record.updated_at !== "string" ||
    !Number.isFinite(Date.parse(record.updated_at))
  ) {
    return null;
  }
  return {
    visibility: record.visibility,
    body: record.body,
    updatedAt: record.updated_at,
  };
}

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
  /** The caller's own server reply drafts (one per visibility). */
  drafts: TicketServerDraft[];
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
  canWriteInternalNotes: boolean;
  canCommentExternal: boolean;
  canTrackTime: boolean;
};

/** Lange Unterhaltungen scrollen im Fenster; es startet bei der neuesten Nachricht. */
function scrollConversationToLatest(element: HTMLOListElement | null) {
  if (element) element.scrollTop = element.scrollHeight;
}

function ticketCommentRevision(comments: readonly TicketComment[]): string {
  return comments
    .map(
      (comment) =>
        `${comment.id}:${comment.created_at}:${comment.emailDelivery ?? ""}`,
    )
    .join("|");
}

function hasActiveTicketTextInput(): boolean {
  const activeElement = document.activeElement;
  return (
    activeElement instanceof HTMLInputElement ||
    activeElement instanceof HTMLTextAreaElement ||
    activeElement instanceof HTMLSelectElement ||
    activeElement?.getAttribute("contenteditable") === "true"
  );
}

type TicketDetailProps = {
  currentUserId: string | null;
  tenantId: string;
  ticketId: string;
  onClose: () => void;
  onChanged: () => void;
  /** Opens a knowledge article (e.g. a freshly generated AI draft). */
  onOpenKnowledgeArticle?: (articleId: string) => void;
  /** Opens the asset list filtered to a device (name or asset tag). */
  onOpenAsset?: ((query: string) => void) | undefined;
  /** Requesters without ticket work see only what matters to them. */
  requesterView?: boolean;
  /** Opens another ticket (e.g. a child or parent ticket of a split). */
  onOpenTicket?: ((ticketId: string) => void) | undefined;
  /** Agents: opens the person overview of the requester. */
  onOpenPerson?:
    | ((person: {
        requesterContactId: string | null;
        userId: string | null;
        displayName: string;
      }) => void)
    | undefined;
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
const COMMENT_IMAGE_CONTENT_TYPES = new Set<string>([
  "image/png",
  "image/jpeg",
  "image/webp",
]);
const COMMENT_IMAGE_ACCEPT = [...COMMENT_IMAGE_CONTENT_TYPES].join(",");

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
    typeof ticket.created_at === "string" &&
    (ticket.requester_id === undefined ||
      typeof ticket.requester_id === "string") &&
    (ticket.affected_user_id === undefined ||
      typeof ticket.affected_user_id === "string" ||
      ticket.affected_user_id === null) &&
    (ticket.resolved_at === undefined ||
      typeof ticket.resolved_at === "string" ||
      ticket.resolved_at === null),
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
  const authorKind =
    comment?.authorKind === "agent" ||
    comment?.authorKind === "requester" ||
    comment?.authorKind === "customer"
      ? comment.authorKind
      : undefined;
  const channel =
    comment?.channel === "portal" || comment?.channel === "email"
      ? comment.channel
      : undefined;
  const emailDelivery =
    comment?.emailDelivery === "pending" ||
    comment?.emailDelivery === "sent" ||
    comment?.emailDelivery === "failed" ||
    comment?.emailDelivery === null
      ? comment.emailDelivery
      : undefined;

  return {
    id: comment?.id as string,
    authorName,
    body: comment?.body as string,
    created_at: comment?.created_at as string,
    visibility: comment?.visibility as CommentVisibility,
    ...(authorKind ? { authorKind } : {}),
    ...(channel ? { channel } : {}),
    ...(emailDelivery !== undefined ? { emailDelivery } : {}),
  };
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
    photoUrl:
      typeof person.photoUrl === "string" &&
      person.photoUrl.startsWith("https://")
        ? person.photoUrl
        : null,
    editing: person.editing,
    composing:
      person.composing === "external" || person.composing === "internal"
        ? person.composing
        : null,
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

function toTicketRequesterContact(
  value: unknown,
): TicketRequesterContact | undefined {
  const contact = asRecord(value);
  if (
    !contact ||
    !hasOnlyKeys(contact, ["id", "displayName", "email"]) ||
    typeof contact.id !== "string" ||
    contact.id.length === 0 ||
    typeof contact.displayName !== "string" ||
    contact.displayName.trim().length === 0 ||
    contact.displayName.includes("\u0000") ||
    (contact.email !== undefined &&
      (typeof contact.email !== "string" ||
        !contact.email.trim() ||
        contact.email.includes("\u0000")))
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

function isSimilarTicketSolution(
  value: unknown,
): value is SimilarTicketSolution | null | undefined {
  if (value === null || value === undefined) return true;
  const solution = asRecord(value);
  return Boolean(
    solution &&
    typeof solution.text === "string" &&
    typeof solution.excerpt === "string",
  );
}

function isSimilarTicket(value: unknown): value is SimilarTicket {
  const ticket = asRecord(value);
  return Boolean(
    ticket &&
    typeof ticket.id === "string" &&
    typeof ticket.ticketNumber === "string" &&
    typeof ticket.subject === "string" &&
    typeof ticket.statusLabel === "string" &&
    (ticket.isClosed === undefined || typeof ticket.isClosed === "boolean") &&
    (ticket.rank === undefined || typeof ticket.rank === "number") &&
    isSimilarTicketSolution(ticket.solution),
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
  const originalFilename =
    typeof attachment?.original_filename === "string"
      ? attachment.original_filename
      : attachment?.originalFilename;
  const contentType =
    typeof attachment?.content_type === "string"
      ? attachment.content_type
      : attachment?.contentType;
  const byteSize =
    typeof attachment?.byte_size === "number"
      ? attachment.byte_size
      : attachment?.byteSize;
  const createdAt =
    typeof attachment?.created_at === "string"
      ? attachment.created_at
      : attachment?.createdAt;
  const commentId =
    attachment?.comment_id === null || attachment?.comment_id === undefined
      ? (attachment?.commentId ?? null)
      : attachment.comment_id;
  const visibility =
    attachment?.visibility === undefined ? "external" : attachment.visibility;
  if (
    !attachment ||
    typeof attachment.id !== "string" ||
    typeof originalFilename !== "string" ||
    !originalFilename.trim() ||
    typeof contentType !== "string" ||
    !ALLOWED_ATTACHMENT_CONTENT_TYPES.has(contentType) ||
    typeof byteSize !== "number" ||
    !Number.isSafeInteger(byteSize) ||
    byteSize < 1 ||
    byteSize > MAX_ATTACHMENT_BYTES ||
    typeof createdAt !== "string" ||
    (commentId !== null && !isUuid(commentId)) ||
    (visibility !== "internal" && visibility !== "external")
  ) {
    return null;
  }

  return {
    id: attachment.id,
    commentId,
    visibility,
    originalFilename,
    contentType,
    byteSize,
    createdAt,
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

function parseCompletedTicketAttachment(
  value: unknown,
): TicketAttachment | null {
  const envelope = asRecord(value);
  const data = asRecord(envelope?.data);
  return data ? toTicketAttachment(data.attachment) : null;
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

function parseTicketInlineImages(value: unknown): TicketInlineImage[] | null {
  const envelope = asRecord(value);
  const data = asRecord(envelope?.data);
  if (
    !data ||
    !hasOnlyKeys(data, ["expiresIn", "inlineImages"]) ||
    !Array.isArray(data.inlineImages)
  ) {
    return null;
  }
  const images = data.inlineImages.flatMap((item) => {
    const image = asRecord(item);
    if (
      !image ||
      !isUuid(image.attachmentId) ||
      typeof image.originalFilename !== "string" ||
      !image.originalFilename.trim() ||
      !isTrustedTicketInlineImageUrl(
        image.signedUrl,
        import.meta.env.VITE_SUPABASE_URL,
      )
    ) {
      return [];
    }
    return [
      {
        attachmentId: image.attachmentId.toLowerCase(),
        originalFilename: image.originalFilename,
        signedUrl: image.signedUrl,
      },
    ];
  });
  return images.length === data.inlineImages.length ? images : null;
}

function TicketTextWithInlineImages({
  body,
  imagesByAttachmentId,
  loading,
  onImageError,
}: {
  body: string;
  imagesByAttachmentId: Readonly<Record<string, TicketInlineImage>>;
  loading: boolean;
  onImageError: (attachmentId: string) => void;
}) {
  return (
    <div className="ticket-rendered-body">
      {ticketInlineMediaSegments(body).map((segment, index) => {
        if (segment.kind === "text") {
          return (
            <span className="ticket-rendered-body__text" key={`text-${index}`}>
              <TicketTextWithAppLinks value={segment.value} />
            </span>
          );
        }
        const image = imagesByAttachmentId[segment.attachmentId];
        if (image) {
          return (
            <figure
              className="ticket-inline-email-image"
              key={`image-${segment.attachmentId}-${index}`}
            >
              <img
                alt={image.originalFilename}
                decoding="async"
                loading="lazy"
                onError={() => onImageError(segment.attachmentId)}
                referrerPolicy="no-referrer"
                src={image.signedUrl}
              />
            </figure>
          );
        }
        return loading ? (
          <span
            className="ticket-inline-email-image__status"
            key={`image-${segment.attachmentId}-${index}`}
            role="status"
          >
            Eingebettetes Bild wird geladen …
          </span>
        ) : (
          <span
            className="ticket-inline-email-image__status"
            key={`image-${segment.attachmentId}-${index}`}
          >
            Eingebettetes Bild ist nicht verfügbar.
          </span>
        );
      })}
    </div>
  );
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
    isRatable:
      typeof status.isRatable === "boolean"
        ? status.isRatable
        : status.isClosed,
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
    !isStringOrNull(service.description) ||
    typeof service.criticality !== "string"
  ) {
    return null;
  }
  return {
    id: service.id,
    name: service.name,
    description: service.description,
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
    primaryPersonName:
      typeof asset.intune_primary_person_name === "string" &&
      asset.intune_primary_person_name.trim()
        ? asset.intune_primary_person_name.trim()
        : null,
  };
}

function toCatalogProblem(value: unknown): CatalogProblem | null {
  const problem = asRecord(value);
  if (
    !problem ||
    typeof problem.id !== "string" ||
    typeof problem.title !== "string" ||
    !isStringOrNull(problem.description) ||
    typeof problem.status !== "string"
  ) {
    return null;
  }
  return {
    id: problem.id,
    title: problem.title,
    description: problem.description,
    status: problem.status,
  };
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

const ASSET_KIND_TEXT: Record<string, string> = {
  device: "Gerät",
  laptop: "Notebook",
  monitor: "Monitor",
  phone: "Telefon",
  printer: "Drucker",
  software: "Software",
  server: "Server",
  network: "Netzwerk",
};

const ASSET_STATUS_TEXT: Record<string, string> = {
  active: "Aktiv",
  inactive: "Inaktiv",
  retired: "Ausgemustert",
  maintenance: "In Wartung",
  stock: "Am Lager",
};

function assetKindText(kind: string): string {
  return ASSET_KIND_TEXT[kind] ?? kind;
}

function assetStatusText(status: string): string {
  return ASSET_STATUS_TEXT[status] ?? status;
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
      `Typ: ${assetKindText(asset.kind)}`,
      `Status: ${assetStatusText(asset.status)}`,
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
  // Linked records of another department are not readable (department
  // scope, migration 0177): the embed comes back as null. Skip those links
  // instead of failing the whole ticket view.
  const items = value
    .filter(
      (link) =>
        !(
          typeof link === "object" &&
          link !== null &&
          (["services", "assets", "problems"] as const).some(
            (key) =>
              key in link && (link as Record<string, unknown>)[key] === null,
          )
        ),
    )
    .map(parser);
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

function commentImageFileError(file: File): string | null {
  const validationError = attachmentFileError(file);
  if (validationError) return validationError;
  return COMMENT_IMAGE_CONTENT_TYPES.has(file.type.trim().toLowerCase())
    ? null
    : "Hier können nur PNG-, JPG/JPEG- oder WebP-Bilder hochgeladen werden.";
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
    drafts: Array.isArray(data.drafts)
      ? data.drafts
          .slice(0, 4)
          .map(toTicketServerDraft)
          .filter((draft): draft is TicketServerDraft => draft !== null)
      : [],
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
    canWriteInternalNotes: data.canWriteInternalNotes === true,
    canCommentExternal: data.canCommentExternal === true,
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

function eventLabel(
  eventType: string,
  payload?: Record<string, unknown> | null,
): string {
  if (eventType === "asset.intune_action") {
    return intuneActionEventLabel(payload ?? null);
  }
  const labels: Record<string, string> = {
    "ticket.created": "Ticket erstellt",
    "comment.external_added": "Externer Kommentar hinzugefügt",
    "comment.internal_added": "Interne Notiz hinzugefügt",
    "ticket.updated": "Ticket aktualisiert",
    "ticket.closed": "Ticket abgeschlossen",
    "ticket.category_changed": "Kategorie aktualisiert",
    "ticket.support_level_changed":
      "Supportstufe gewechselt (mit Übergabenotiz)",
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

async function invokeAgentWorkbench(
  body: Record<string, unknown>,
): Promise<unknown> {
  if (!supabase) throw new Error("Supabase ist nicht konfiguriert.");
  const { data, error } = await supabase.functions.invoke("agent-workbench", {
    body,
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

const NEW_CATEGORY_OPTION = "__new__";

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

function presenceInitials(name: string): string {
  const parts = name
    .replace(/@.*$/, "")
    .split(/[\s._-]+/)
    .filter(Boolean);
  const letters =
    parts.length > 1
      ? `${parts[0]![0]}${parts[parts.length - 1]![0]}`
      : (parts[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
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
      ? "Die Bewertung kann derzeit nicht abgegeben werden. Sie ist erst möglich, wenn das Ticket gelöst ist."
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

function parseKnowledgeLinks(
  value: unknown,
): { links: KnowledgeLink[]; imageUrls: KnowledgeImageUrls } | null {
  const data = parseKnowledgeData(value);
  // imageUrls: signed URLs for kb-image references (knowledge article images).
  const imageUrls = data ? parseKnowledgeImageUrls(data.imageUrls) : null;
  if (
    !data ||
    !imageUrls ||
    !hasOnlyKeys(data, ["links", "imageUrls"]) ||
    !Array.isArray(data.links)
  )
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
  return { links, imageUrls };
}

function parseKnowledgeSearch(
  value: unknown,
): { articles: KnowledgeArticle[]; imageUrls: KnowledgeImageUrls } | null {
  const data = parseKnowledgeData(value);
  const imageUrls = data ? parseKnowledgeImageUrls(data.imageUrls) : null;
  if (
    !data ||
    !imageUrls ||
    !hasOnlyKeys(data, ["articles", "imageUrls"]) ||
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
  return { articles, imageUrls };
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

/**
 * User message for a failed knowledge request: the backend's own German
 * explanation when it sends one (e.g. a missing department), otherwise a
 * generic text per status and action.
 */
async function knowledgeErrorMessage(
  error: unknown,
  action: TicketKnowledgeAction["type"],
): Promise<string> {
  const backendMessage = await knowledgeErrorBackendMessage(error);
  if (backendMessage) return backendMessage;
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
  // Database details are never rendered; only the curated error.message above.
  return messages[action];
}

const AI_TICKET_DRAFT_ERRORS: Record<string, string> = {
  article_manage_denied:
    "Für einen Wissensartikel fehlt Ihnen die Berechtigung zur Wissensverwaltung.",
  ai_feature_disabled:
    "Die KI-Unterstützung ist für diesen Mandanten nicht aktiviert.",
  ai_provider_not_approved:
    "Die KI-Unterstützung ist für diesen Mandanten noch nicht freigegeben.",
  ai_purpose_not_approved:
    "Die KI-Unterstützung für Wissensartikel ist noch nicht freigegeben.",
  ai_budget_exceeded:
    "Das stündliche KI-Kontingent ist erreicht. Bitte versuchen Sie es später erneut.",
  ai_provider_rate_limited:
    "Der KI-Dienst ist gerade ausgelastet. Bitte versuchen Sie es in einer Minute erneut.",
  ai_provider_not_configured: "Die KI-Anbindung ist noch nicht eingerichtet.",
  ticket_not_found: "Das Ticket ist nicht mehr verfügbar.",
};

async function requestAiTicketDraft(
  tenantId: string,
  ticketId: string,
): Promise<{ articleId: string; linkedToTicket: boolean }> {
  if (!supabase) throw new Error("Supabase ist nicht konfiguriert.");
  const { data, error } = await supabase.functions.invoke("ai-assist", {
    body: { type: "draftArticleFromTicket", tenantId, ticketId },
  });
  if (error) {
    let code = "";
    const context = (error as { context?: unknown }).context;
    if (context instanceof Response) {
      try {
        const body = (await context.clone().json()) as {
          error?: { code?: unknown };
        };
        code = typeof body.error?.code === "string" ? body.error.code : "";
      } catch {
        code = "";
      }
    }
    throw new Error(
      AI_TICKET_DRAFT_ERRORS[code] ??
        (await knowledgeErrorBackendMessage(error)) ??
        "Der KI-Entwurf konnte nicht erstellt werden. Bitte versuchen Sie es erneut.",
    );
  }
  const result = (data as { data?: unknown } | null)?.data;
  if (
    typeof result !== "object" ||
    result === null ||
    typeof (result as { articleId?: unknown }).articleId !== "string"
  ) {
    throw new Error("Die Antwort des KI-Entwurfs ist unvollständig.");
  }
  return {
    articleId: (result as { articleId: string }).articleId,
    linkedToTicket:
      (result as { linkedToTicket?: unknown }).linkedToTicket === true,
  };
}

/** Article text as Markdown with its images, collapsed by default. */
function KnowledgeArticleText({
  article,
  imageUrls,
}: {
  article: KnowledgeArticle;
  imageUrls: KnowledgeImageUrls;
}) {
  if (!article.body.trim()) return null;
  return (
    <details className="ticket-knowledge-article">
      <summary>Artikeltext anzeigen</summary>
      <div className="knowledge-markdown">
        <KnowledgeMarkdown body={article.body} imageUrls={imageUrls} />
      </div>
    </details>
  );
}

function knowledgeArticleUrl(articleId: string): string {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("wissen", articleId);
  return url.toString();
}

function openKnowledgeArticleInNewTab(articleId: string) {
  window.open(knowledgeArticleUrl(articleId), "_blank", "noopener,noreferrer");
}

// Links into this app (e.g. to a knowledge article) are clickable in ticket
// texts; other addresses stay plain text.
function TicketTextWithAppLinks({ value }: { value: string }) {
  const origin = window.location.origin;
  const parts = value.split(/(https?:\/\/[^\s<>"]+)/g);
  return (
    <>
      {parts.map((part, index) => {
        if (index % 2 === 1) {
          let sameOrigin = false;
          try {
            sameOrigin = new URL(part).origin === origin;
          } catch {
            sameOrigin = false;
          }
          if (sameOrigin) {
            return (
              <a
                href={part}
                key={index}
                rel="noopener noreferrer"
                target="_blank"
              >
                {part}
              </a>
            );
          }
        }
        return part;
      })}
    </>
  );
}

function RequiredMark() {
  return (
    <span
      aria-label="Pflichtfeld vor dem Schliessen"
      className="ticket-required-mark"
      title="Pflichtfeld vor dem Schliessen"
    >
      *
    </span>
  );
}

function KnowledgeSection({
  tenantId,
  ticketId,
  canUpdate,
  canUseInternalNotes,
  refreshToken,
  onChanged,
  onSent,
  onOpenArticle,
}: KnowledgeReference & {
  canUpdate: boolean;
  canUseInternalNotes: boolean;
  refreshToken: string;
  onChanged: () => void;
  onSent: () => Promise<boolean>;
  onOpenArticle?: ((articleId: string) => void) | undefined;
}) {
  const [aiDraftPending, setAiDraftPending] = useState(false);
  const [createdArticleId, setCreatedArticleId] = useState<string | null>(null);
  const [links, setLinks] = useState<KnowledgeLink[]>([]);
  // Signed URLs for kb-image references in the shown article texts.
  const [knowledgeImageUrls, setKnowledgeImageUrls] =
    useState<KnowledgeImageUrls>({});
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
      setLinks(result.links);
      setKnowledgeImageUrls((current) => ({
        ...current,
        ...result.imageUrls,
      }));
    } catch (error) {
      if (requestId === listSequence.current)
        setListError(await knowledgeErrorMessage(error, "list"));
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
          if (requestId === searchSequence.current) {
            setArticles(result.articles);
            setKnowledgeImageUrls((current) => ({
              ...current,
              ...result.imageUrls,
            }));
          }
        } catch (error) {
          if (requestId === searchSequence.current)
            setSearchError(
              await knowledgeErrorMessage(error, "searchArticles"),
            );
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
        setCreatedArticleId(result.articleId);
      } else {
        setCreatedArticleId(null);
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
              ? "Der Artikel wurde als Entwurf in der Wissensdatenbank gespeichert. Sobald er veröffentlicht ist, erscheint er hier beim Ticket."
              : "Der Artikel wurde mit dem Ticket verknüpft.",
      );
    } catch (error) {
      const message = await knowledgeErrorMessage(error, currentAction);
      if (scope === scopeSequence.current)
        setActionError(
          (created && sendCreated
            ? "Der Artikel wurde erstellt und extern angehängt. "
            : "") + message,
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
      // Internal articles are created as drafts and published later in the
      // knowledge base, where their visibility is chosen.
      visibility: "internal",
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

  // Links the article to the ticket and adds a link to it to the
  // conversation, as an internal note or as a reply to the requester.
  async function linkArticleToConversation(
    article: KnowledgeArticle,
    target: CommentVisibility,
  ) {
    if (!supabase || !canUpdate || inFlight.current || listLoading) return;
    inFlight.current = true;
    setPending("attach");
    setActionError("");
    setNotice("");
    setCreatedArticleId(null);
    try {
      await invokeTicketKnowledge({
        type: "attach",
        tenantId,
        ticketId,
        articleId: article.id,
        visibility: target,
      });
      const { error } = await supabase.functions.invoke("ticket-operations", {
        body: {
          type: "addComment",
          tenantId,
          ticketId,
          visibility: target,
          body: `Wissensartikel: ${article.title}\n${knowledgeArticleUrl(article.id)}`,
        },
      });
      if (error) throw error;
      setNotice(
        target === "internal"
          ? "Der Artikel wurde verknüpft und als interne Notiz in die Unterhaltung eingetragen."
          : "Der Artikel wurde verknüpft und als Antwort an die anfragende Person gesendet.",
      );
      onChanged();
      await Promise.all([loadLinks(), onSent()]);
    } catch (error) {
      setActionError(await knowledgeErrorMessage(error, "attach"));
    } finally {
      setPending(null);
      inFlight.current = false;
    }
  }

  const canCreate = canUpdate && canUseInternalNotes;
  const searching = [...query.trim()].length >= 2;

  return (
    <section
      className="ticket-knowledge"
      aria-labelledby="ticket-knowledge-heading"
      aria-busy={listLoading || knowledgeBusy}
    >
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
        <div className="ticket-knowledge__notice" role="status">
          <span>{notice}</span>
          {createdArticleId && onOpenArticle ? (
            <button
              className="text-button"
              type="button"
              onClick={() => openKnowledgeArticleInNewTab(createdArticleId)}
            >
              In der Wissensdatenbank öffnen
            </button>
          ) : null}
        </div>
      )}

      <div className="ticket-knowledge__block">
        <h3 id="ticket-knowledge-heading">Wissensartikel suchen</h3>
        <input
          aria-label="Wissensartikel suchen"
          className="ticket-knowledge__search"
          disabled={knowledgeBusy}
          maxLength={120}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Stichwort eingeben, z. B. Drucker, VPN, Passwort …"
          type="search"
          value={query}
        />
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
        {searching &&
          !searchLoading &&
          !searchError &&
          visibleArticles.length === 0 && (
            <p className="data-caption">Keine passenden Artikel gefunden.</p>
          )}
        {visibleArticles.length > 0 && (
          <ul
            aria-label="Gefundene Wissensartikel"
            className="ticket-knowledge__list"
          >
            {visibleArticles.map((article) => {
              const attached = visibleLinks.some(
                (link) => link.articleId === article.id,
              );
              return (
                <li key={article.id}>
                  <span className="ticket-knowledge__item-text">
                    <strong>{article.title}</strong>
                    {article.summary ? <small>{article.summary}</small> : null}
                  </span>
                  <span className="ticket-knowledge__item-actions">
                    {onOpenArticle ? (
                      <button
                        className="text-button"
                        type="button"
                        onClick={() => openKnowledgeArticleInNewTab(article.id)}
                      >
                        Öffnen
                      </button>
                    ) : null}
                    {canUpdate && !attached ? (
                      <>
                        {canUseInternalNotes ? (
                          <button
                            className="secondary-button"
                            type="button"
                            disabled={knowledgeBusy || listLoading}
                            onClick={() =>
                              void linkArticleToConversation(
                                article,
                                "internal",
                              )
                            }
                          >
                            Als interne Notiz
                          </button>
                        ) : null}
                        {article.visibility === "external" ? (
                          <button
                            className="secondary-button"
                            type="button"
                            disabled={knowledgeBusy || listLoading}
                            onClick={() =>
                              void linkArticleToConversation(
                                article,
                                "external",
                              )
                            }
                          >
                            Als Antwort an anfragende Person
                          </button>
                        ) : null}
                      </>
                    ) : attached ? (
                      <span className="data-caption">Verknüpft</span>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {listLoading ? (
          <p className="data-caption" role="status">
            Verknüpfte Artikel werden geladen …
          </p>
        ) : visibleLinks.length > 0 ? (
          <>
            <p className="ticket-knowledge__label">
              Mit diesem Ticket verknüpft
            </p>
            <ul
              aria-label="Verknüpfte Wissensartikel"
              className="ticket-knowledge__list"
            >
              {visibleLinks.map((link) => (
                <li key={link.articleId}>
                  <span className="ticket-knowledge__item-text">
                    <strong>{link.article.title}</strong>
                    {link.article.summary ? (
                      <small>{link.article.summary}</small>
                    ) : null}
                  </span>
                  <span className="ticket-knowledge__item-actions">
                    {onOpenArticle ? (
                      <button
                        className="text-button"
                        type="button"
                        onClick={() =>
                          openKnowledgeArticleInNewTab(link.articleId)
                        }
                      >
                        Öffnen
                      </button>
                    ) : null}
                    {canUpdate ? (
                      <button
                        className="text-button"
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
                        Entfernen
                      </button>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>

      {canCreate ? (
        <div className="ticket-knowledge__block">
          <h3>Wissensartikel aus diesem Ticket erstellen</h3>
          <p className="data-caption">
            Der Artikel wird als Entwurf in der Wissensdatenbank gespeichert.
            Sobald Sie ihn dort geprüft und veröffentlicht haben, erscheint er
            hier beim Ticket. Bitte keine Namen oder Kontaktdaten übernehmen.
          </p>
          <div className="ticket-knowledge__ai">
            <button
              className="secondary-button"
              type="button"
              disabled={aiDraftPending || knowledgeBusy}
              onClick={async () => {
                setAiDraftPending(true);
                setActionError("");
                setNotice("");
                try {
                  const created = await requestAiTicketDraft(
                    tenantId,
                    ticketId,
                  );
                  setCreatedArticleId(created.articleId);
                  setNotice(
                    "Der KI-Entwurf wurde in der Wissensdatenbank gespeichert. Sobald er veröffentlicht ist, erscheint er hier beim Ticket.",
                  );
                  void loadLinks();
                  onChanged();
                } catch (error) {
                  setActionError(
                    error instanceof Error
                      ? error.message
                      : "Der KI-Entwurf konnte nicht erstellt werden.",
                  );
                } finally {
                  setAiDraftPending(false);
                }
              }}
            >
              {aiDraftPending ? (
                <LoaderCircle aria-hidden="true" size={16} />
              ) : (
                <Sparkles aria-hidden="true" size={16} />
              )}
              {aiDraftPending
                ? "KI erstellt Entwurf …"
                : "Entwurf mit KI erstellen"}
            </button>
            <small className="data-caption">
              Die KI fasst Betreff, Beschreibung und Verlauf zusammen.
            </small>
          </div>
          <form
            aria-label="Wissensartikel selbst schreiben"
            className="ticket-knowledge__form"
            onSubmit={createArticle}
          >
            <p className="ticket-knowledge__label">Oder selbst schreiben</p>
            <label>
              Titel
              <input
                disabled={knowledgeBusy}
                maxLength={240}
                minLength={3}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="z. B. Drucker im 2. Stock druckt nicht"
                required
                value={title}
              />
            </label>
            <label>
              Lösung
              <textarea
                disabled={knowledgeBusy}
                maxLength={100000}
                onChange={(event) => setBodyMarkdown(event.target.value)}
                placeholder="Ursache und Lösungsschritte beschreiben …"
                required
                rows={5}
                value={bodyMarkdown}
              />
            </label>
            <div className="ticket-detail-actions">
              <button
                className="primary-button"
                disabled={knowledgeBusy || listLoading}
                type="submit"
              >
                {pending === "createAndAttach"
                  ? "Wird gespeichert …"
                  : "Als Entwurf speichern"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}

export function TicketDetail({
  currentUserId,
  tenantId,
  ticketId,
  onClose,
  onChanged,
  onOpenKnowledgeArticle,
  onOpenAsset,
  requesterView = false,
  onOpenTicket,
  onOpenPerson,
}: TicketDetailProps) {
  const [detail, setDetail] = useState<TicketDetailData | null>(null);
  // Answers from a ticket template form (only tickets created with one).
  const [storedFormAnswers, setStoredFormAnswers] = useState<{
    ticketId: string;
    stored: StoredFormAnswers;
  } | null>(null);
  useEffect(() => {
    if (!supabase) return;
    let active = true;
    void supabase
      .from("ticket_form_answers")
      .select("answers, fields")
      .eq("tenant_id", tenantId)
      .eq("ticket_id", ticketId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active) return;
        const stored = !error && data ? parseStoredFormAnswers(data) : null;
        setStoredFormAnswers(stored ? { ticketId, stored } : null);
      });
    return () => {
      active = false;
    };
  }, [tenantId, ticketId]);
  // Absent agents in the assignment picker (new assignments go to the stand-in).
  const [activeAbsences, setActiveAbsences] = useState<
    Map<string, ActiveAbsence>
  >(() => new Map());
  useEffect(() => {
    let active = true;
    void loadActiveAbsences(tenantId).then((next) => {
      if (active) setActiveAbsences(next);
    });
    return () => {
      active = false;
    };
  }, [tenantId]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [presence, setPresence] = useState<TicketPresencePerson[]>([]);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [statusKey, setStatusKey] = useState("");
  const resolveAfterCommentRef = useRef(false);
  const [pendingCloseConfirmation, setPendingCloseConfirmation] =
    useState<PendingCloseConfirmation | null>(null);
  const [solutionPromptOpen, setSolutionPromptOpen] = useState(false);
  const [priorityKey, setPriorityKey] = useState("");
  const [isEditingTicket, setIsEditingTicket] = useState(false);
  // Description edited in place via the pencil in the «Beschreibung» card.
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [timelineHost, setTimelineHost] = useState<HTMLDivElement | null>(null);
  const [focusMode, setFocusMode] = useState(false);
  const [editSubject, setEditSubject] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [assignmentPrefilled, setAssignmentPrefilled] = useState(false);
  const [selectedDepartmentId, setSelectedDepartmentId] = useState("");
  const [requesterProfile, setRequesterProfile] =
    useState<TicketRequesterProfile | null>(null);
  const [requesterDepartment, setRequesterDepartment] = useState("");
  const [requesterOffer, setRequesterOffer] = useState("");
  const [requesterProfileBusy, setRequesterProfileBusy] = useState(false);
  const [assignableAgents, setAssignableAgents] = useState<TicketAgent[]>([]);
  const [commentDrafts, setCommentDrafts] = useState({
    external: "",
    internal: "",
  });
  const [commentVisibility, setCommentVisibility] =
    useState<CommentVisibility>("internal");
  const [mentionedUserIds, setMentionedUserIds] = useState<string[]>([]);
  const [copyRecipients, setCopyRecipients] = useState<CopyRecipient[]>([]);
  const [commentNotice, setCommentNotice] = useState("");
  const [undoChange, setUndoChange] = useState<UndoChange | null>(null);
  const [isClosureContextOpen, setIsClosureContextOpen] = useState(false);
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
  const [inlineImagesByAttachmentId, setInlineImagesByAttachmentId] = useState<
    Record<string, TicketInlineImage>
  >({});
  const [inlineImagesLoading, setInlineImagesLoading] = useState(false);
  const [emailSenderContacts, setEmailSenderContacts] =
    useState<EmailSenderContacts | null>(null);
  const [selectedAttachmentFile, setSelectedAttachmentFile] =
    useState<File | null>(null);

  useEffect(() => {
    // Contact details of an external e-mail sender (phone numbers and
    // addresses from the signature) are read directly under RLS
    // (can_read_ticket); a missing row simply means "nothing to show".
    let active = true;
    setEmailSenderContacts(null);
    if (!supabase) return;
    void supabase
      .from("ticket_email_signatures")
      .select("phones, emails")
      .eq("ticket_id", ticketId)
      .maybeSingle()
      .then(({ data, error: contactsError }) => {
        if (!active || contactsError) return;
        setEmailSenderContacts(parseEmailSenderContacts(data));
      });
    return () => {
      active = false;
    };
  }, [ticketId]);
  const [commentImageAttachments, setCommentImageAttachments] = useState<
    Record<CommentVisibility, QueuedCommentImage[]>
  >({
    external: [],
    internal: [],
  });
  const [commentImageNotice, setCommentImageNotice] =
    useState<CommentImageNotice | null>(null);
  const [isCommentImageDropActive, setIsCommentImageDropActive] =
    useState(false);
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
  const [requesterDeviceIds, setRequesterDeviceIds] = useState<string[]>([]);
  const [linkedCatalogItems, setLinkedCatalogItems] = useState<
    LinkedCatalogItem[]
  >([]);
  const [affectedItemsLoading, setAffectedItemsLoading] = useState(false);
  const [affectedItemsLoaded, setAffectedItemsLoaded] = useState(false);
  const [affectedItemsError, setAffectedItemsError] = useState("");
  const [selectedCatalogItemKey, setSelectedCatalogItemKey] = useState("");
  const [catalogSearchQuery, setCatalogSearchQuery] = useState("");
  const [catalogPickerOpen, setCatalogPickerOpen] = useState(false);
  const [inlineImageRefreshToken, setInlineImageRefreshToken] = useState(0);
  const [pendingCatalogAction, setPendingCatalogAction] =
    useState<PendingCatalogAction>(null);
  const [pendingCatalogItemKey, setPendingCatalogItemKey] = useState<
    string | null
  >(null);
  const requestSequence = useRef(0);
  const attachmentRequestSequence = useRef(0);
  const inlineImageRequestSequence = useRef(0);
  const inlineImageErrorRefreshes = useRef(new Set<string>());
  const feedbackRequestSequence = useRef(0);
  const qualityRequestSequence = useRef(0);
  const handoverRequestSequence = useRef(0);
  const affectedItemsRequestSequence = useRef(0);
  const mergeSearchRequestSequence = useRef(0);
  const ticketCategoriesRequestSequence = useRef(0);
  const detailRef = useRef<TicketDetailData | null>(null);
  const backgroundTicketRefreshInFlightRef = useRef(false);
  const backgroundTicketRefreshBlockedRef = useRef(true);
  const commentModeContextRef = useRef<TicketCommentComposerContext | null>(
    null,
  );
  const commentVisibilityRef = useRef<CommentVisibility>("internal");
  const undoTimerRef = useRef<number | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const commentImageInputRef = useRef<HTMLInputElement>(null);
  const catalogPickerRef = useRef<HTMLDivElement>(null);
  const catalogPickerTriggerRef = useRef<HTMLButtonElement>(null);
  const catalogSearchInputRef = useRef<HTMLInputElement>(null);
  const catalogSearchResultRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const backgroundTicketRefreshBlocked =
    loading ||
    isEditingTicket ||
    pendingAction !== null ||
    pendingCloseConfirmation !== null ||
    pendingAttachmentAction !== null ||
    pendingHandoverAction !== null ||
    pendingCatalogAction !== null ||
    ticketCategorySaving ||
    requesterProfileBusy ||
    ticketCategoriesLoading ||
    attachmentsLoading ||
    inlineImagesLoading ||
    feedbackLoading ||
    qualityLoading ||
    handoversLoading ||
    affectedItemsLoading ||
    mergeSearchLoading ||
    (commentDrafts.external.trim().length > 0 &&
      !isReplyGreetingOnly(
        commentDrafts.external,
        requesterView
          ? null
          : ticketReplyGreeting(detail?.requesterContact?.displayName),
      )) ||
    commentDrafts.internal.trim().length > 0 ||
    commentImageAttachments.external.length > 0 ||
    commentImageAttachments.internal.length > 0 ||
    ticketCategoryDraft !== null ||
    selectedAttachmentFile !== null;
  detailRef.current = detail;
  backgroundTicketRefreshBlockedRef.current = backgroundTicketRefreshBlocked;
  const ticketIsClosed = Boolean(
    detail?.statuses.some(
      (status) => status.id === detail.ticket.status_id && status.is_closed,
    ),
  );
  // Requesters may rate once the ticket is resolved ("Gelöst") or closed.
  const ticketIsRatable = Boolean(
    detail?.statuses.some(
      (status) =>
        status.id === detail.ticket.status_id &&
        (status.is_closed || status.key === "resolved"),
    ),
  );
  const ticketIsResolved = Boolean(detail?.ticket.resolved_at);
  const isResolutionParticipant = Boolean(
    currentUserId &&
    detail &&
    (detail.ticket.requester_id === currentUserId ||
      detail.ticket.affected_user_id === currentUserId),
  );
  const hasAgentExperienceAccess = Boolean(
    detail &&
    (detail.canUpdate ||
      detail.canAssign ||
      detail.canTrackTime ||
      detail.canUseInternalNotes ||
      detail.canEscalate === true),
  );
  const inlineAttachmentIds = useMemo(() => {
    if (!detail) return [];
    const ids = ticketInlineAttachmentIds([
      detail.ticket.description,
      ...detail.comments.map((comment) => comment.body),
    ]);
    // Image attachments are shown as previews in the conversation and in
    // the attachment list.
    for (const attachment of attachments) {
      if (
        COMMENT_PREVIEW_IMAGE_TYPES.has(attachment.contentType) &&
        !ids.includes(attachment.id)
      ) {
        ids.push(attachment.id);
      }
    }
    // The server signs at most 16 images per request; newest first.
    return ids.slice(-16);
  }, [attachments, detail]);
  const inlineAttachmentIdsKey = inlineAttachmentIds.join(",");
  const refreshInlineImageAfterError = useCallback((attachmentId: string) => {
    if (inlineImageErrorRefreshes.current.has(attachmentId)) return;
    inlineImageErrorRefreshes.current.add(attachmentId);
    setInlineImageRefreshToken((current) => current + 1);
  }, []);
  const commentBody = ticketCommentDraftForMode(
    commentDrafts,
    commentVisibility,
  );
  const commentTextareaRef = useRef<HTMLTextAreaElement>(null);
  // Replies to the requester start with «Lieber <Vorname>» and room to write.
  const replyGreeting = requesterView
    ? null
    : ticketReplyGreeting(detail?.requesterContact?.displayName);
  const externalGreetingOnly = isReplyGreetingOnly(
    commentDrafts.external,
    replyGreeting,
  );
  const greetingAppliedRef = useRef<string | null>(null);
  const activeCommentImageAttachments =
    commentImageAttachments[commentVisibility];
  // Shared with colleagues so nobody answers the same ticket twice.
  const composingVisibility: "external" | "internal" | null =
    !requesterView &&
    commentBody.trim() &&
    !(commentVisibility === "external" && externalGreetingOnly)
      ? commentVisibility
      : null;
  const colleaguesComposing = presence.filter((person) => person.composing);
  const canAttachCommentImages = Boolean(
    detail &&
    (commentVisibility === "internal"
      ? detail.canWriteInternalNotes
      : detail.canCommentExternal),
  );
  const attachmentsByCommentId = useMemo(() => {
    const grouped = new Map<string, TicketAttachment[]>();
    for (const attachment of attachments) {
      if (!attachment.commentId) continue;
      const current = grouped.get(attachment.commentId) ?? [];
      current.push(attachment);
      grouped.set(attachment.commentId, current);
    }
    return grouped;
  }, [attachments]);
  const commentComposer = requesterView
    ? {
        ...ticketCommentComposerCopy("external"),
        bodyLabel: "Ihre Nachricht",
        placeholder: "Nachricht an den Support schreiben …",
        hint: "Der Support sieht Ihre Nachricht im Ticket und antwortet Ihnen hier.",
        submitLabel: "Nachricht senden",
      }
    : ticketCommentComposerCopy(commentVisibility);
  const restoreInternalNoteDraft = useCallback((body: string) => {
    setCommentDrafts((current) =>
      updateTicketCommentDraft(current, "internal", body),
    );
  }, []);
  const restoreExternalReplyDraft = useCallback((body: string) => {
    setCommentDrafts((current) =>
      updateTicketCommentDraft(current, "external", body),
    );
  }, []);
  // Server drafts follow the user to other devices (mobile shares them).
  const draftDetailReady = Boolean(detail && detail.ticket.id === ticketId);
  const serverDrafts = draftDetailReady ? detail?.drafts : undefined;
  const canSyncInternalDraft = Boolean(
    draftDetailReady && detail?.canWriteInternalNotes,
  );
  const canSyncExternalDraft = Boolean(
    draftDetailReady && detail?.canCommentExternal,
  );
  const saveInternalServerDraft = useCallback(
    async (body: string) => {
      await invokeTicketOperation({
        type: "saveDraft",
        tenantId,
        ticketId,
        body,
        visibility: "internal",
      });
    },
    [tenantId, ticketId],
  );
  const saveExternalServerDraft = useCallback(
    async (body: string) => {
      await invokeTicketOperation({
        type: "saveDraft",
        tenantId,
        ticketId,
        body,
        visibility: "external",
      });
    },
    [tenantId, ticketId],
  );
  const internalDraftRemote = useMemo(() => {
    if (!draftDetailReady) return undefined;
    if (!canSyncInternalDraft) return null;
    const draft =
      serverDrafts?.find((entry) => entry.visibility === "internal") ?? null;
    return { draft, save: saveInternalServerDraft };
  }, [
    canSyncInternalDraft,
    draftDetailReady,
    saveInternalServerDraft,
    serverDrafts,
  ]);
  const externalDraftRemote = useMemo(() => {
    if (!draftDetailReady) return undefined;
    if (!canSyncExternalDraft) return null;
    const draft =
      serverDrafts?.find((entry) => entry.visibility === "external") ?? null;
    return { draft, save: saveExternalServerDraft };
  }, [
    canSyncExternalDraft,
    draftDetailReady,
    saveExternalServerDraft,
    serverDrafts,
  ]);
  // «Zuletzt angesehen»: once per opened ticket.
  const recordedRecentTicketRef = useRef<string | null>(null);
  useEffect(() => {
    if (!draftDetailReady || recordedRecentTicketRef.current === ticketId) {
      return;
    }
    recordedRecentTicketRef.current = ticketId;
    recordRecentItem(tenantId, "ticket", ticketId);
  }, [draftDetailReady, tenantId, ticketId]);
  const internalNoteDraft = useTicketReplyDraft({
    body: commentDrafts.internal,
    onRestore: restoreInternalNoteDraft,
    remote: internalDraftRemote,
    tenantId,
    ticketId,
    userId: currentUserId,
    visibility: "internal",
  });
  const externalReplyDraft = useTicketReplyDraft({
    // The pre-filled greeting alone is no draft.
    body: externalGreetingOnly ? "" : commentDrafts.external,
    onRestore: restoreExternalReplyDraft,
    remote: externalDraftRemote,
    tenantId,
    ticketId,
    userId: currentUserId,
    visibility: "external",
  });
  // Pre-fill the greeting once per ticket, after a stored draft was restored.
  useEffect(() => {
    if (
      !replyGreeting ||
      !draftDetailReady ||
      !detail?.canCommentExternal ||
      greetingAppliedRef.current === ticketId
    )
      return;
    greetingAppliedRef.current = ticketId;
    setCommentDrafts((current) =>
      current.external ? current : { ...current, external: replyGreeting },
    );
  }, [detail?.canCommentExternal, draftDetailReady, replyGreeting, ticketId]);
  const activeCommunicationDraft =
    commentVisibility === "internal" ? internalNoteDraft : externalReplyDraft;

  const offerUndo = useCallback((change: UndoChange) => {
    if (undoTimerRef.current !== null) {
      window.clearTimeout(undoTimerRef.current);
    }
    setUndoChange(change);
    undoTimerRef.current = window.setTimeout(() => {
      setUndoChange(null);
      undoTimerRef.current = null;
    }, 8_000);
  }, []);

  useEffect(() => {
    return () => {
      if (undoTimerRef.current !== null) {
        window.clearTimeout(undoTimerRef.current);
      }
    };
  }, []);

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

  const loadTicket = useCallback(
    async ({
      background = false,
    }: { background?: boolean } = {}): Promise<TicketDetailData | null> => {
      const requestId = ++requestSequence.current;
      if (!background) {
        setLoading(true);
        setError("");
      }

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
        if (requestId !== requestSequence.current) return null;

        if (background) {
          const currentDetail = detailRef.current;
          if (
            backgroundTicketRefreshBlockedRef.current ||
            hasActiveTicketTextInput() ||
            !currentDetail ||
            currentDetail.ticket.id !== ticketId ||
            ticketCommentRevision(currentDetail.comments) ===
              ticketCommentRevision(nextDetail.comments)
          ) {
            return currentDetail;
          }
          const nextCommunicationDetail = {
            ...currentDetail,
            comments: nextDetail.comments,
          };
          detailRef.current = nextCommunicationDetail;
          setDetail(nextCommunicationDetail);
          return nextCommunicationDetail;
        }

        detailRef.current = nextDetail;
        setDetail(nextDetail);
        if (!background) {
          setAssignableAgents(nextDetail.agents);
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
          setAssignmentPrefilled(false);
          setSelectedDepartmentId(nextDetail?.ticket.department_id ?? "");
          setTicketCategories([]);
          setTicketCategoryDraft(null);
          setTicketCategorySaving(false);
          setTicketCategoryError("");
          void loadTicketCategoriesForDepartment(
            nextDetail.ticket.department_id,
          );
          const nextCommentContext = {
            canUseInternalNotes: nextDetail.canUseInternalNotes,
            key: `${tenantId}:${ticketId}`,
          };
          const previousCommentContext = commentModeContextRef.current;
          const nextCommentMode = ticketCommentComposerModeForTicketContext({
            currentMode: commentVisibilityRef.current,
            nextContext: nextCommentContext,
            previousContext: previousCommentContext,
          });
          commentModeContextRef.current = nextCommentContext;
          if (nextCommentMode !== commentVisibilityRef.current) {
            commentVisibilityRef.current = nextCommentMode;
            setCommentVisibility(nextCommentMode);
          }
          if (
            previousCommentContext?.key !== nextCommentContext.key ||
            !nextDetail.canUseInternalNotes
          ) {
            setMentionedUserIds([]);
          }
          void loadTicketContext(nextDetail.ticket);
          void loadRequesterProfile(
            nextDetail.requesterContact,
            nextDetail.canUpdate,
          );
        }
        return nextDetail;
      } catch (nextError) {
        if (requestId === requestSequence.current) {
          if (background) {
            return detailRef.current;
          }
          detailRef.current = null;
          setDetail(null);
          setError(errorMessage(nextError));
        }
        return null;
      } finally {
        if (requestId === requestSequence.current && !background) {
          setLoaded(true);
          setLoading(false);
        }
      }
    },
    [
      loadTicketCategoriesForDepartment,
      loadRequesterProfile,
      loadTicketContext,
      tenantId,
      ticketId,
    ],
  );

  // After an Intune action: reload only the ticket history, so open edits
  // in the form are kept.
  const refreshTicketEvents = useCallback(async () => {
    try {
      const nextDetail = parseTicketDetail(
        await invokeTicketOperation({ type: "getTicket", tenantId, ticketId }),
      );
      if (!nextDetail) return;
      setDetail((current) => {
        if (!current || current.ticket.id !== nextDetail.ticket.id) {
          return current;
        }
        const updated = { ...current, events: nextDetail.events };
        detailRef.current = updated;
        return updated;
      });
    } catch {
      // The history updates with the next regular reload.
    }
  }, [tenantId, ticketId]);

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
      // Devices of the requesting person as link suggestions (best effort).
      void client
        .rpc("ticket_requester_devices", {
          p_tenant_id: tenantId,
          p_ticket_id: ticketId,
        })
        .then(({ data, error: devicesError }) => {
          if (requestId !== affectedItemsRequestSequence.current) return;
          setRequesterDeviceIds(
            !devicesError && Array.isArray(data)
              ? data.filter((id): id is string => typeof id === "string")
              : [],
          );
        });
      // Linked assets show their primary person, like the asset picker.
      const primaryPersonByAssetId = new Map(
        nextCatalog.assets.map((asset) => [asset.id, asset.primaryPersonName]),
      );
      const assetsWithPerson = assets.map((item) => {
        const person = primaryPersonByAssetId.get(item.targetId);
        return person
          ? {
              ...item,
              metadata: [`Primäre Person: ${person}`, ...item.metadata],
            }
          : item;
      });
      setLinkedCatalogItems(
        [...services, ...assetsWithPerson, ...problems].sort(
          (first, second) => {
            const kindComparison = catalogKindLabel(first.kind).localeCompare(
              catalogKindLabel(second.kind),
              "de-CH",
            );
            return (
              kindComparison || first.label.localeCompare(second.label, "de-CH")
            );
          },
        ),
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
    if (!detail || detail.ticket.id !== ticketId) return;

    let cancelled = false;
    const refreshVisibleTicket = () => {
      if (
        cancelled ||
        document.visibilityState === "hidden" ||
        backgroundTicketRefreshBlocked ||
        backgroundTicketRefreshInFlightRef.current ||
        hasActiveTicketTextInput()
      ) {
        return;
      }
      backgroundTicketRefreshInFlightRef.current = true;
      void loadTicket({ background: true }).finally(() => {
        backgroundTicketRefreshInFlightRef.current = false;
      });
    };

    const interval = window.setInterval(refreshVisibleTicket, 15_000);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") refreshVisibleTicket();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [backgroundTicketRefreshBlocked, detail?.ticket.id, loadTicket, ticketId]);

  useEffect(() => {
    if (!supabase || !detail || detail.ticket.id !== ticketId) return;

    const realtimeClient = supabase;
    let refreshTimer: number | null = null;
    const refreshAfterAuthorizedCommentChange = () => {
      if (
        document.visibilityState === "hidden" ||
        backgroundTicketRefreshBlockedRef.current ||
        backgroundTicketRefreshInFlightRef.current ||
        hasActiveTicketTextInput() ||
        refreshTimer !== null
      ) {
        return;
      }
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        if (
          backgroundTicketRefreshBlockedRef.current ||
          backgroundTicketRefreshInFlightRef.current ||
          hasActiveTicketTextInput()
        ) {
          return;
        }
        backgroundTicketRefreshInFlightRef.current = true;
        void loadTicket({ background: true }).finally(() => {
          backgroundTicketRefreshInFlightRef.current = false;
        });
      }, 150);
    };
    const channel = realtimeClient
      .channel(`ticket-comment-invalidation:${tenantId}:${ticketId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          filter: `ticket_id=eq.${ticketId}`,
          schema: "public",
          table: "ticket_comments",
        },
        refreshAfterAuthorizedCommentChange,
      )
      .subscribe();

    return () => {
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      void realtimeClient.removeChannel(channel);
    };
  }, [detail?.ticket.id, loadTicket, tenantId, ticketId]);

  useEffect(() => {
    inlineImageErrorRefreshes.current.clear();
  }, [inlineAttachmentIdsKey, tenantId, ticketId]);

  useEffect(() => {
    const requestId = ++inlineImageRequestSequence.current;
    setInlineImagesByAttachmentId({});
    if (!inlineAttachmentIdsKey) {
      setInlineImagesLoading(false);
      return;
    }

    setInlineImagesLoading(true);
    void invokeTicketAttachmentAction({
      type: "createInlineImageUrls",
      tenantId,
      ticketId,
      attachmentIds: inlineAttachmentIds,
    })
      .then((response) => {
        const images = parseTicketInlineImages(response);
        if (!images || requestId !== inlineImageRequestSequence.current) return;
        setInlineImagesByAttachmentId(
          Object.fromEntries(
            images.map((image) => [image.attachmentId, image]),
          ),
        );
      })
      .catch(() => {
        if (requestId === inlineImageRequestSequence.current) {
          setInlineImagesByAttachmentId({});
        }
      })
      .finally(() => {
        if (requestId === inlineImageRequestSequence.current) {
          setInlineImagesLoading(false);
        }
      });

    return () => {
      inlineImageRequestSequence.current += 1;
    };
  }, [
    inlineAttachmentIds,
    inlineAttachmentIdsKey,
    inlineImageRefreshToken,
    tenantId,
    ticketId,
  ]);

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
          composing: composingVisibility,
        });
        const response = await invokeTicketPresence({
          type: "list",
          tenantId,
          ticketId,
        });
        const people = parseTicketPresence(response);
        if (!people) throw new Error("Ungültige Präsenzdaten.");
        if (!cancelled)
          // A new signed URL on every poll would reload the photos: keep the
          // URL already shown for the same person.
          setPresence((current) =>
            people.map((person) => ({
              ...person,
              photoUrl:
                current.find(
                  (known) =>
                    known.displayName === person.displayName && known.photoUrl,
                )?.photoUrl ?? person.photoUrl,
            })),
          );
      } catch {
        // Presence is contextual convenience only. Ticket work remains available
        // when the short-lived indicator cannot be refreshed.
        if (!cancelled) setPresence([]);
      }
    };

    void refreshPresence();
    // Shorter while someone writes, so a second reply is noticed in time.
    const interval = window.setInterval(
      () => {
        void refreshPresence();
      },
      composingVisibility ? 10_000 : 20_000,
    );
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
  }, [
    detail?.ticket.id,
    isEditingTicket,
    composingVisibility,
    tenantId,
    ticketId,
  ]);

  useEffect(() => {
    if (!ticketIsRatable) {
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
  }, [loadFeedback, ticketIsRatable]);

  useEffect(() => {
    if (!isClosureContextOpen || !ticketIsClosed) {
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
  }, [isClosureContextOpen, loadQuality, ticketIsClosed]);

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
    setCommentImageAttachments({ external: [], internal: [] });
    setCommentImageNotice(null);
    if (commentImageInputRef.current) commentImageInputRef.current.value = "";
  }, [tenantId, ticketId]);

  useEffect(() => {
    if (!isClosureContextOpen) return;
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
  }, [isClosureContextOpen, loadHandovers, detail?.canUpdate]);

  useEffect(() => {
    if (
      !shouldLoadTicketCatalog(Boolean(detail?.canUpdate), isClosureContextOpen)
    ) {
      setCatalog(emptyTicketCatalog());
      setLinkedCatalogItems([]);
      setRequesterDeviceIds([]);
      setAffectedItemsLoaded(false);
      setAffectedItemsError("");
      setSelectedCatalogItemKey("");
      return;
    }
    setCatalog(emptyTicketCatalog());
    setLinkedCatalogItems([]);
    setRequesterDeviceIds([]);
    setAffectedItemsLoaded(false);
    setAffectedItemsError("");
    setSelectedCatalogItemKey("");
    void loadAffectedItems();
    return () => {
      affectedItemsRequestSequence.current += 1;
    };
  }, [detail?.canUpdate, isClosureContextOpen, loadAffectedItems]);

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

  useEffect(() => {
    setSolutionPromptOpen(false);
  }, [tenantId, ticketId]);

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
          // "Neu" cannot be chosen again once the ticket has left it.
          (status.key !== "new" || status.id === selectedStatus?.id) &&
          (!status.is_closed ||
            detail?.canClose ||
            status.id === selectedStatus?.id),
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
  const requesterContext = useMemo(() => {
    const department = requesterProfile?.department?.trim();
    const offer = requesterProfile?.offer?.trim();
    return department ? [department] : offer ? [offer] : [];
  }, [requesterProfile?.department, requesterProfile?.offer]);
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
  // Category, team and assignee must be set before a ticket is closed;
  // category and team only where the department offers any.
  const requiredCloseFields = {
    assignee: Boolean(detail && !detail.ticket.assigned_agent_id),
    team: Boolean(
      detail && detail.teams.length > 0 && !detail.ticket.assigned_team_id,
    ),
    category: Boolean(
      detail && rootTicketCategories.length > 0 && !detail.ticket.category_id,
    ),
  };
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
    (isEditingTicket || isEditingDescription) &&
    (editSubject.trim() !== detail.ticket.subject ||
      editDescription.trim() !== detail.ticket.description),
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
        description: [
          service.description?.trim() || null,
          `Kritikalität: ${criticalityLabel(service.criticality)}`,
        ]
          .filter((entry): entry is string => entry !== null)
          .join(" · "),
      })),
      ...catalog.assets.map((asset) => ({
        kind: "asset" as const,
        id: asset.id,
        label: asset.name,
        description: [
          asset.primaryPersonName
            ? `Primäre Person: ${asset.primaryPersonName}`
            : null,
          asset.assetTag ? `Asset-Kennung: ${asset.assetTag}` : null,
          `Typ: ${assetKindText(asset.kind)}`,
          `Status: ${assetStatusText(asset.status)}`,
        ]
          .filter((entry): entry is string => entry !== null)
          .join(" · "),
      })),
      // Only open cases can be linked; resolved ones stay in the case list.
      ...catalog.problems
        .filter((problem) => problem.status !== "resolved")
        .map((problem) => ({
          kind: "problem" as const,
          id: problem.id,
          label: problem.title,
          description: [
            problem.description?.trim() || null,
            `Status: ${problem.status}`,
          ]
            .filter((entry): entry is string => entry !== null)
            .join(" · "),
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

  // With several devices nothing is linked automatically; offer them here
  // until one of the person's devices is linked.
  const requesterDeviceSuggestions = useMemo(() => {
    if (requesterDeviceIds.length < 2) return [];
    const deviceIds = new Set(requesterDeviceIds);
    if (
      linkedCatalogItems.some(
        (item) => item.kind === "asset" && deviceIds.has(item.targetId),
      )
    )
      return [];
    return availableCatalogItems.filter(
      (item) => item.kind === "asset" && deviceIds.has(item.id),
    );
  }, [availableCatalogItems, linkedCatalogItems, requesterDeviceIds]);
  const selectedCatalogItem = useMemo(
    () =>
      availableCatalogItems.find(
        (item) => catalogSelectionKey(item) === selectedCatalogItemKey,
      ) ?? null,
    [availableCatalogItems, selectedCatalogItemKey],
  );
  const catalogSearchResults = useMemo(
    () => searchTicketCatalogItems(availableCatalogItems, catalogSearchQuery),
    [availableCatalogItems, catalogSearchQuery],
  );
  const catalogPickerResultsId = `ticket-catalog-picker-results-${ticketId}`;

  useEffect(() => {
    setCatalogPickerOpen(false);
    setCatalogSearchQuery("");
  }, [ticketId]);

  useEffect(() => {
    if (!catalogPickerOpen) return;

    const focusFrame = window.requestAnimationFrame(() => {
      catalogSearchInputRef.current?.focus();
    });
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        catalogPickerRef.current?.contains(event.target)
      ) {
        return;
      }
      setCatalogPickerOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setCatalogPickerOpen(false);
      setCatalogSearchQuery("");
      catalogPickerTriggerRef.current?.focus();
    };

    window.addEventListener("pointerdown", closeOnOutsidePointer);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("pointerdown", closeOnOutsidePointer);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [catalogPickerOpen]);

  async function saveFeedback(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!feedback?.canRate || !feedback.isRatable) {
      setFeedbackError(
        "Eine Bewertung ist erst möglich, wenn das Ticket gelöst ist.",
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

  async function uploadTicketAttachment(
    file: File,
    visibility?: CommentVisibility,
  ): Promise<TicketAttachment> {
    const filename = file.name.trim();
    const contentType = file.type.trim().toLowerCase();
    const createResponse = await invokeTicketAttachmentAction({
      type: "createUpload",
      tenantId,
      ticketId,
      filename,
      contentType,
      byteSize: file.size,
      ...(visibility ? { visibility } : {}),
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

    const completeResponse = await invokeTicketAttachmentAction({
      type: "completeUpload",
      tenantId,
      ticketId,
      storageObjectPath: upload.storageObjectPath,
      originalFilename: filename,
      contentType,
      byteSize: file.size,
      ...(visibility ? { visibility } : {}),
    });
    const attachment = parseCompletedTicketAttachment(completeResponse);
    if (!attachment || attachment.visibility !== (visibility ?? "external")) {
      throw new Error("Ungültige Anhang-Antwort.");
    }
    return attachment;
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

    setPendingAttachmentAction("upload");
    setAttachmentError("");
    try {
      await uploadTicketAttachment(file);
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

  function clearCommentImageAttachments(visibility: CommentVisibility) {
    setCommentImageAttachments((current) => ({ ...current, [visibility]: [] }));
    if (commentImageInputRef.current) commentImageInputRef.current.value = "";
  }

  function addCommentImages(files: readonly File[]) {
    if (!detail || !canAttachCommentImages || busy || attachmentBusy) return;
    const remaining =
      MAX_TICKET_COMMENT_IMAGE_ATTACHMENTS -
      commentImageAttachments[commentVisibility].length;
    if (remaining < 1) {
      setCommentImageNotice({
        tone: "error",
        text: `Pro Nachricht sind höchstens ${MAX_TICKET_COMMENT_IMAGE_ATTACHMENTS} Bilder möglich.`,
      });
      return;
    }

    const selectedFiles = [...files].slice(0, remaining);
    const validationError = selectedFiles
      .map(commentImageFileError)
      .find((message): message is string => Boolean(message));
    if (validationError) {
      setCommentImageNotice({ tone: "error", text: validationError });
      return;
    }
    if (selectedFiles.length === 0) return;

    setCommentImageNotice(null);
    const queuedImages = selectedFiles.map((file) => {
      return {
        key: crypto.randomUUID(),
        file,
        originalFilename: file.name.trim(),
        byteSize: file.size,
      };
    });
    setCommentImageAttachments((current) => ({
      ...current,
      [commentVisibility]: [...current[commentVisibility], ...queuedImages],
    }));
    setCommentImageNotice({
      tone: "success",
      text:
        queuedImages.length === 1
          ? "Bild vorgemerkt. Es wird erst beim Speichern der Nachricht hochgeladen."
          : `${queuedImages.length} Bilder vorgemerkt. Sie werden erst beim Speichern der Nachricht hochgeladen.`,
    });
    if (commentImageInputRef.current) commentImageInputRef.current.value = "";
  }

  function removeCommentImage(
    attachment: QueuedCommentImage,
    visibility: CommentVisibility,
  ) {
    if (busy || attachmentBusy) return;
    setCommentImageNotice(null);
    setCommentImageAttachments((current) => ({
      ...current,
      [visibility]: current[visibility].filter(
        (item) => item.key !== attachment.key,
      ),
    }));
  }

  function handleCommentImageDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (!busy && !attachmentBusy && canAttachCommentImages) {
      setIsCommentImageDropActive(true);
    }
  }

  function handleCommentImageDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsCommentImageDropActive(false);
    void addCommentImages([...event.dataTransfer.files]);
  }

  function startDescriptionEdit() {
    if (!detail || !detail.canUpdate || busy) return;
    setEditSubject(detail.ticket.subject);
    setEditDescription(detail.ticket.description);
    setIsEditingTicket(false);
    setIsEditingDescription(true);
    setError("");
  }

  function cancelDescriptionEdit() {
    if (!detail || busy) return;
    setEditDescription(detail.ticket.description);
    setIsEditingDescription(false);
    setError("");
  }

  function cancelTicketEdit() {
    if (!detail || busy) return;
    setEditSubject(detail.ticket.subject);
    setEditDescription(detail.ticket.description);
    setIsEditingTicket(false);
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
    shouldOfferUndo = true,
  ) {
    if (!detail || busy) return;

    const updatesTicket =
      change.statusKey !== undefined ||
      change.priorityKey !== undefined ||
      change.assignedTeamId !== undefined;
    const updatesAgent = change.assignedAgentId !== undefined;
    if (!updatesTicket && !updatesAgent) return;
    const closingStatus = closingStatusForKey(change.statusKey);
    if (closingStatus) {
      const missing = [
        requiredCloseFields.category ? "Kategorie" : null,
        requiredCloseFields.team ? "Team" : null,
        // The person who closes the ticket is assigned automatically.
        requiredCloseFields.assignee && !hasAgentExperienceAccess
          ? "Zuweisung"
          : null,
      ].filter((label): label is string => label !== null);
      if (missing.length > 0) {
        setStatusKey(selectedStatus?.key ?? "");
        setError(
          `Bevor das Ticket ${closingStatus.label.toLowerCase()} werden kann, bitte zuerst ausfüllen: ${missing.join(", ")}.`,
        );
        return;
      }
    }
    if (closingStatus && !confirmedClose) {
      setPendingCloseConfirmation({
        statusKey: closingStatus.key,
        statusLabel: closingStatus.label,
      });
      return;
    }

    const previousChange: UndoChange["change"] = {};
    if (change.statusKey !== undefined && !closingStatus && selectedStatus) {
      previousChange.statusKey = selectedStatus.key;
    }
    if (change.priorityKey !== undefined && selectedPriority) {
      previousChange.priorityKey = selectedPriority.key;
    }
    if (change.assignedTeamId !== undefined) {
      previousChange.assignedTeamId = assignedTeamId || null;
    }
    if (change.assignedAgentId !== undefined) {
      previousChange.assignedAgentId = assignedAgentId || null;
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
      if (closingStatus) void offerSolutionArticle();
      if (shouldOfferUndo && Object.keys(previousChange).length > 0) {
        const label = change.priorityKey
          ? "Priorität"
          : change.assignedAgentId !== undefined
            ? "Zuweisung"
            : change.assignedTeamId !== undefined
              ? "Team"
              : "Status";
        offerUndo({ change: previousChange, label });
      }
    } catch (nextError) {
      if (change.assignedTeamId !== undefined) {
        setSelectedTeamId(detail.ticket.assigned_team_id ?? "");
      }
      if (change.assignedAgentId !== undefined) {
        setSelectedAgentId(detail.ticket.assigned_agent_id ?? "");
      }
      if (
        change.assignedTeamId !== undefined &&
        functionErrorStatus(nextError) === 422
      ) {
        setError(
          "Das Team wurde nicht geändert, weil die zugewiesene Person diesem Team nicht angehört. Fügen Sie die Person zuerst zum Team hinzu oder heben Sie die Zuweisung bewusst auf.",
        );
      } else if (change.statusKey !== undefined) {
        // e.g. required fields missing before closing: show the reason.
        if (selectedStatus) setStatusKey(selectedStatus.key);
        setError(
          await functionErrorMessage(nextError, errorMessage(nextError)),
        );
      } else {
        setError(errorMessage(nextError));
      }
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

  async function saveTicketContent() {
    if (!detail || !detail.canUpdate || !hasContentChanges) return;

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
    if (hasContentChanges && subject !== detail.ticket.subject) {
      action.subject = subject;
    }
    if (hasContentChanges && description !== detail.ticket.description) {
      action.description = description;
    }
    if (action.subject === undefined && action.description === undefined) {
      return;
    }

    setPendingAction("update");
    setError("");
    try {
      await invokeTicketOperation(action);
      setIsEditingTicket(false);
      setIsEditingDescription(false);
      onChanged();
      await Promise.all([loadTicket(), loadFeedback(), loadQuality()]);
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setPendingAction(null);
    }
  }

  /**
   * After closing: offer to save the solution as a knowledge article when the
   * ticket has none yet. Purely optional; failures only hide the prompt.
   */
  async function offerSolutionArticle() {
    if (!detail?.canUpdate || !detail.canUseInternalNotes) return;
    try {
      const links = parseKnowledgeLinks(
        await invokeTicketKnowledge({ type: "list", tenantId, ticketId }),
      );
      setSolutionPromptOpen(links !== null && links.links.length === 0);
    } catch {
      setSolutionPromptOpen(false);
    }
  }

  function applySimilarSolution(solution: SimilarTicketSolution) {
    if (!detail?.canCommentExternal) return;
    const currentDraft = ticketCommentDraftForMode(commentDrafts, "external");
    setCommentDrafts((current) =>
      updateTicketCommentDraft(
        current,
        "external",
        currentDraft.trim()
          ? `${currentDraft.trimEnd()}\n\n${solution.text}`
          : solution.text,
      ),
    );
    selectCommentMode("external");
    setCommentNotice(
      "Die Lösung wurde in die Antwort übernommen. Bitte prüfen und anpassen, bevor Sie sie senden.",
    );
  }

  async function confirmTicketClose() {
    const confirmation = pendingCloseConfirmation;
    if (!confirmation || busy) return;
    setPendingCloseConfirmation(null);
    await saveOverviewChange({ statusKey: confirmation.statusKey }, true);
  }

  /** Untouched greeting: continue writing right below it. */
  function placeCaretAfterGreeting(field: HTMLTextAreaElement) {
    if (
      commentVisibility === "external" &&
      replyGreeting &&
      field.value === replyGreeting &&
      field.selectionStart === field.selectionEnd
    ) {
      field.setSelectionRange(field.value.length, field.value.length);
    }
  }

  async function saveComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const resolveAfter = resolveAfterCommentRef.current;
    resolveAfterCommentRef.current = false;
    const body = ticketCommentBodyWithAttachments(
      commentVisibility === "external" && externalGreetingOnly
        ? ""
        : commentBody,
      activeCommentImageAttachments.length,
    );
    const mentionRecipients = detail?.canUseInternalNotes
      ? mentionedUserIds.filter((userId) => userId !== currentUserId)
      : [];
    if (!body) {
      setError("Bitte geben Sie einen Kommentar ein.");
      return;
    }
    if (body.length > 50_000) {
      setError("Ein Kommentar darf höchstens 50'000 Zeichen enthalten.");
      return;
    }

    // "… und als gelöst markieren": check before anything is sent.
    const resolvedStatus = resolveAfter
      ? (detail?.statuses.find((status) => status.key === "resolved") ??
        detail?.statuses.find((status) => status.is_closed))
      : undefined;
    if (resolveAfter) {
      if (!detail?.canClose || !resolvedStatus) {
        setError("Sie dürfen dieses Ticket nicht schliessen.");
        return;
      }
      const missing = [
        requiredCloseFields.category ? "Kategorie" : null,
        requiredCloseFields.team ? "Team" : null,
        requiredCloseFields.assignee ? "Zuweisung" : null,
      ].filter((label): label is string => label !== null);
      if (missing.length > 0) {
        setError(
          `Bevor das Ticket gelöst werden kann, bitte zuerst ausfüllen: ${missing.join(", ")}. Die Nachricht wurde nicht gesendet.`,
        );
        return;
      }
    }

    setPendingAction("comment");
    setError("");
    setCommentNotice("");
    const submittedAt = Date.now();
    const uploadedAttachments: TicketAttachment[] = [];
    let commentSaved = false;
    let copyNotice = "";
    try {
      if (activeCommentImageAttachments.length > 0) {
        setPendingAttachmentAction("upload");
        for (const image of activeCommentImageAttachments) {
          uploadedAttachments.push(
            await uploadTicketAttachment(image.file, commentVisibility),
          );
        }
        setPendingAttachmentAction(null);
      }
      const attachmentIds = ticketCommentAttachmentIds(uploadedAttachments);
      const sendResult = await invokeTicketOperation({
        type: "addComment",
        tenantId,
        ticketId,
        body,
        visibility: commentVisibility,
        ...(attachmentIds.length > 0 ? { attachmentIds } : {}),
        ...(commentVisibility === "external" && copyRecipients.length > 0
          ? { copyEmails: copyRecipients.map((entry) => entry.email) }
          : {}),
      });
      commentSaved = true;
      if (commentVisibility === "external" && copyRecipients.length > 0) {
        const copies = asRecord(asRecord(sendResult)?.data);
        setCopyRecipients([]);
        copyNotice =
          copies?.copiesFailed === true || copies?.copiesQueued === 0
            ? "Die Antwort wurde gesendet, die Kopien konnten aber nicht versendet werden. Bitte prüfe den E-Mail-Kanal."
            : `Antwort gesendet und ${copies?.copiesQueued ?? copyRecipients.length} Kopie(n) per E-Mail versendet.`;
        setCommentNotice(copyNotice);
      }
      setCommentDrafts((current) =>
        updateTicketCommentDraft(
          current,
          commentVisibility,
          commentVisibility === "external" && replyGreeting
            ? replyGreeting
            : "",
        ),
      );
      clearCommentImageAttachments(commentVisibility);
      onChanged();
      const [updatedDetail] = await Promise.all([
        loadTicket(),
        loadAttachments(),
      ]);
      if (mentionRecipients.length > 0 && updatedDetail) {
        const savedComment = [...updatedDetail.comments]
          .filter(
            (item) =>
              item.visibility === commentVisibility &&
              item.body === body &&
              Date.parse(item.created_at) >= submittedAt - 15_000,
          )
          .sort(
            (left, right) =>
              Date.parse(right.created_at) - Date.parse(left.created_at),
          )[0];
        if (!savedComment) {
          setCommentNotice(
            commentVisibility === "internal"
              ? "Die interne Notiz wurde gespeichert. Erwähnungen konnten nicht sicher zugeordnet werden."
              : "Die Nachricht wurde gesendet. Die Benachrichtigungen konnten nicht sicher zugeordnet werden.",
          );
        } else {
          const mentionResponse = asRecord(
            await invokeAgentWorkbench({
              type: "createMentions",
              tenantId,
              ticketId,
              commentId: savedComment.id,
              mentionedUserIds: mentionRecipients,
            }),
          );
          const mentionData = asRecord(mentionResponse?.data);
          if (!mentionData || !Array.isArray(mentionData.mentions)) {
            throw new Error("Die Erwähnungen konnten nicht bestätigt werden.");
          }
          setMentionedUserIds([]);
          setCommentNotice(
            commentVisibility === "internal"
              ? "Interne Notiz und Erwähnungen wurden gespeichert."
              : "Nachricht gesendet und weitere Personen benachrichtigt.",
          );
        }
      } else if (commentVisibility === "internal") {
        setMentionedUserIds([]);
        setCommentNotice("Interne Notiz wurde gespeichert.");
      }
      if (copyNotice) setCommentNotice(copyNotice);
      if (resolveAfter && resolvedStatus) {
        await saveOverviewChange(
          { statusKey: resolvedStatus.key },
          true,
          false,
        );
      }
    } catch (nextError) {
      if (!commentSaved && uploadedAttachments.length > 0) {
        await Promise.allSettled(
          uploadedAttachments.map((attachment) =>
            invokeTicketAttachmentAction({
              type: "delete",
              tenantId,
              ticketId,
              attachmentId: attachment.id,
            }),
          ),
        );
      }
      setError(errorMessage(nextError));
    } finally {
      setPendingAttachmentAction(null);
      setPendingAction(null);
    }
  }

  function selectCommentMode(mode: CommentVisibility) {
    commentVisibilityRef.current = mode;
    setCommentVisibility(mode);
    setCommentNotice("");
    setCommentImageNotice(null);
    if (mode === "external") setMentionedUserIds([]);
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
    await linkCatalogItemByKey(selectedCatalogItemKey);
  }

  // Choosing an asset or catalog entry links it right away.
  async function linkCatalogItemByKey(selectionKey: string) {
    if (!detail || !detail.canUpdate || catalogBusy) return;

    const item = availableCatalogItems.find(
      (entry) => catalogSelectionKey(entry) === selectionKey,
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

  function selectCatalogSearchResult(itemKey: string) {
    setSelectedCatalogItemKey(itemKey);
    setCatalogSearchQuery("");
    setCatalogPickerOpen(false);
    window.requestAnimationFrame(() => {
      catalogPickerTriggerRef.current?.focus();
    });
    void linkCatalogItemByKey(itemKey);
  }

  function focusCatalogSearchResult(index: number) {
    catalogSearchResultRefs.current[index]?.focus();
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
            title="Ticketdetails schliessen"
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

  const watchPresentation = ticketWatchPresentation(detail.watching);

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
          {!requesterView && presence.length > 0 ? (
            <ul
              aria-label="Personen, die dieses Ticket gerade geöffnet haben"
              className="ticket-presence-avatars"
            >
              {presence.slice(0, 5).map((person, index) => (
                <li
                  className={
                    person.editing
                      ? "ticket-presence-avatar is-editing"
                      : "ticket-presence-avatar"
                  }
                  key={`${person.displayName}-${index}`}
                  title={
                    person.editing
                      ? `${person.displayName} bearbeitet gerade`
                      : `${person.displayName} hat das Ticket geöffnet`
                  }
                >
                  {person.photoUrl ? (
                    <img
                      alt=""
                      onError={(event) => {
                        event.currentTarget.style.display = "none";
                      }}
                      src={person.photoUrl}
                    />
                  ) : null}
                  <span>{presenceInitials(person.displayName)}</span>
                </li>
              ))}
              {presence.length > 5 ? (
                <li
                  className="ticket-presence-avatar is-more"
                  title={presence
                    .slice(5)
                    .map((person) => person.displayName)
                    .join(", ")}
                >
                  +{presence.length - 5}
                </li>
              ) : null}
            </ul>
          ) : null}
          <TicketPdfRecord
            canExport={detail.canExport}
            tenantId={tenantId}
            ticketId={ticketId}
          />
          <TicketFollowUps
            enabled={hasAgentExperienceAccess}
            subject={detail.ticket.subject}
            tenantId={tenantId}
            ticketId={ticketId}
            ticketNumber={detail.ticket.ticket_number}
          />
          {requesterView ? null : (
            <button
              aria-label={watchPresentation.actionLabel}
              className={
                detail.watching
                  ? "secondary-button ticket-watch-button active"
                  : "secondary-button ticket-watch-button"
              }
              disabled={busy}
              onClick={() => void toggleWatch()}
              title={watchPresentation.actionLabel}
              type="button"
            >
              {pendingAction === "watch" ? (
                <LoaderCircle
                  aria-hidden="true"
                  className="ticket-detail-spinner"
                  size={16}
                />
              ) : watchPresentation.icon === "eye" ? (
                <Eye aria-hidden="true" size={16} strokeWidth={1.8} />
              ) : (
                <EyeOff aria-hidden="true" size={16} strokeWidth={1.8} />
              )}
              <span className="ticket-detail-action-label">
                {watchPresentation.label}
              </span>
            </button>
          )}
          <button
            aria-label="Ticketdetails schliessen"
            className="more-button"
            disabled={busy}
            onClick={onClose}
            title="Ticketdetails schliessen"
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

      {detail.canUpdate && (
        <TicketIncidentBanner
          refreshKey={`${detail.ticket.id}:${detail.ticket.subject}`}
          subject={detail.ticket.subject}
          tenantId={tenantId}
          ticketId={ticketId}
        />
      )}

      {undoChange && (
        <div className="ticket-workbench__undo" role="status">
          <span>{undoChange.label} wurde geändert.</span>
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() => {
              const change = undoChange.change;
              setUndoChange(null);
              if (undoTimerRef.current !== null) {
                window.clearTimeout(undoTimerRef.current);
                undoTimerRef.current = null;
              }
              void saveOverviewChange(change, false, false);
            }}
            type="button"
          >
            Rückgängig
          </button>
          <button
            aria-label="Rückgängig-Hinweis schliessen"
            className="more-button"
            disabled={busy}
            onClick={() => {
              setUndoChange(null);
              if (undoTimerRef.current !== null) {
                window.clearTimeout(undoTimerRef.current);
                undoTimerRef.current = null;
              }
            }}
            type="button"
          >
            <X aria-hidden="true" size={15} />
          </button>
        </div>
      )}

      <div className="ticket-detail-layout">
        <div className="ticket-detail-main">
          {requesterView ? null : (
            <div className="ticket-timeline-slot" ref={setTimelineHost} />
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
              {detail.canUpdate && !requesterView && !isEditingDescription ? (
                <button
                  aria-label="Beschreibung bearbeiten"
                  className="ticket-description-edit"
                  disabled={busy}
                  onClick={startDescriptionEdit}
                  title="Beschreibung bearbeiten"
                  type="button"
                >
                  <Pencil aria-hidden="true" size={16} strokeWidth={1.9} />
                </button>
              ) : null}
            </div>
            {isEditingDescription ? (
              <form
                className="ticket-description-editor"
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveTicketContent();
                }}
              >
                <label className="ticket-description-editor__subject">
                  <span>Betreff</span>
                  <input
                    disabled={busy}
                    maxLength={240}
                    onChange={(event) => setEditSubject(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        event.stopPropagation();
                        cancelDescriptionEdit();
                      }
                    }}
                    required
                    type="text"
                    value={editSubject}
                  />
                </label>
                <label className="ticket-comment-body">
                  <span className="sr-only">Beschreibung</span>
                  <textarea
                    autoFocus
                    disabled={busy}
                    maxLength={10_000}
                    onChange={(event) => setEditDescription(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        event.stopPropagation();
                        cancelDescriptionEdit();
                      }
                      if (
                        event.key === "Enter" &&
                        (event.metaKey || event.ctrlKey)
                      ) {
                        event.preventDefault();
                        void saveTicketContent();
                      }
                    }}
                    required
                    rows={Math.min(
                      18,
                      Math.max(6, editDescription.split("\n").length + 1),
                    )}
                    value={editDescription}
                  />
                </label>
                <div className="ticket-description-editor__actions">
                  <span className="data-caption" aria-live="polite">
                    {[...editDescription].length}/10&apos;000 Zeichen · Strg/⌘ +
                    Enter speichert
                  </span>
                  <button
                    className="secondary-button"
                    disabled={busy}
                    onClick={cancelDescriptionEdit}
                    type="button"
                  >
                    Abbrechen
                  </button>
                  <button
                    className="primary-button"
                    disabled={busy || !hasContentChanges}
                    type="submit"
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
                    Beschreibung speichern
                  </button>
                </div>
              </form>
            ) : (
              <div className="ticket-detail-description">
                <TicketTextWithInlineImages
                  body={
                    splitPlainTextSignature(detail.ticket.description).message
                  }
                  imagesByAttachmentId={inlineImagesByAttachmentId}
                  loading={inlineImagesLoading}
                  onImageError={refreshInlineImageAfterError}
                />
              </div>
            )}
            {storedFormAnswers?.ticketId === detail.ticket.id && (
              <TicketFormAnswersBlock stored={storedFormAnswers.stored} />
            )}
          </section>

          <section
            className="ticket-detail-comments ticket-detail-primary"
            aria-labelledby="ticket-comments-heading"
          >
            <div className="ticket-detail-section-heading">
              <div>
                <p className="eyebrow">UNTERHALTUNG</p>
                <h3 id="ticket-comments-heading">Unterhaltung</h3>
              </div>
              <span className="data-caption">
                {ticketConversationCountLabel(detail.comments.length)}
              </span>
            </div>

            {detail.comments.length === 0 ? (
              <p className="empty-state">Noch keine Nachrichten vorhanden.</p>
            ) : (
              <ol
                className="ticket-comment-list ticket-conversation"
                key={detail.comments.length}
                ref={scrollConversationToLatest}
              >
                {chronologicalTicketComments(detail.comments).map((item) => {
                  const requesterName = detail.requesterContact?.displayName
                    ?.trim()
                    .toLocaleLowerCase("de-CH");
                  const authorIsRequester =
                    item.authorKind === "requester" ||
                    item.authorKind === "customer" ||
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
                  const inboundEmail =
                    direction === "incoming" && item.channel === "email";
                  const emailDelivery =
                    direction === "outgoing" ? item.emailDelivery : null;
                  const deliveryLabel =
                    emailDelivery === "pending"
                      ? "E-Mail wird gesendet …"
                      : emailDelivery === "sent"
                        ? "per E-Mail gesendet"
                        : emailDelivery === "failed"
                          ? "E-Mail-Versand fehlgeschlagen"
                          : null;
                  const commentAttachments =
                    attachmentsByCommentId.get(item.id) ?? [];
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
                        {inboundEmail ? (
                          <span className="ticket-comment-channel-badge">
                            <Mail aria-hidden="true" size={13} />
                            per E-Mail
                          </span>
                        ) : null}
                        {deliveryLabel ? (
                          <span
                            className={
                              emailDelivery === "failed"
                                ? "ticket-comment-delivery ticket-comment-delivery--warning"
                                : "ticket-comment-delivery"
                            }
                          >
                            <Mail aria-hidden="true" size={13} />
                            {deliveryLabel}
                          </span>
                        ) : null}
                        <time dateTime={item.created_at}>
                          {formatDateTime(item.created_at)}
                        </time>
                      </div>
                      <TicketTextWithInlineImages
                        body={item.body}
                        imagesByAttachmentId={inlineImagesByAttachmentId}
                        loading={inlineImagesLoading}
                        onImageError={refreshInlineImageAfterError}
                      />
                      {commentAttachments.length > 0 ? (
                        <ul className="ticket-comment-attachment-list">
                          {commentAttachments.map((attachment) => (
                            <li key={attachment.id}>
                              {inlineImagesByAttachmentId[attachment.id] ? (
                                <button
                                  aria-label={`${attachment.originalFilename} gross anzeigen`}
                                  className="ticket-comment-image-preview"
                                  onClick={() =>
                                    void downloadAttachment(attachment)
                                  }
                                  type="button"
                                >
                                  <img
                                    alt={attachment.originalFilename}
                                    loading="lazy"
                                    onError={() =>
                                      refreshInlineImageAfterError(
                                        attachment.id,
                                      )
                                    }
                                    src={
                                      inlineImagesByAttachmentId[attachment.id]
                                        ?.signedUrl
                                    }
                                  />
                                </button>
                              ) : null}
                              <ImagePlus aria-hidden="true" size={16} />
                              <span>
                                <strong>{attachment.originalFilename}</strong>
                                <small>
                                  {formatFileSize(attachment.byteSize)}
                                </small>
                              </span>
                              <button
                                className="text-button"
                                disabled={attachmentBusy}
                                onClick={() =>
                                  void downloadAttachment(attachment)
                                }
                                type="button"
                              >
                                {pendingAttachmentAction === "download" &&
                                pendingAttachmentId === attachment.id
                                  ? "Wird geöffnet …"
                                  : "Öffnen"}
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            )}

            {colleaguesComposing.length > 0 ? (
              <p className="ticket-collision-warning" role="status">
                <AlertTriangle aria-hidden="true" size={16} />
                {colleaguesComposing
                  .map(
                    (person) =>
                      `${person.displayName} schreibt gerade ${
                        person.composing === "internal"
                          ? "eine interne Notiz"
                          : "eine Antwort"
                      }`,
                  )
                  .join(" · ")}
                . Stimmen Sie sich ab, bevor Sie ebenfalls antworten.
              </p>
            ) : null}
            <form className="ticket-comment-form" onSubmit={saveComment}>
              {requesterView ? null : (
                <div
                  aria-label="Nachrichtenart wählen"
                  className={`ticket-comment-mode-switch${detail.canUseInternalNotes ? "" : " ticket-comment-mode-switch--external-only"}`}
                  role="group"
                >
                  {detail.canUseInternalNotes && (
                    <button
                      aria-pressed={commentVisibility === "internal"}
                      className="ticket-comment-mode ticket-comment-mode--internal"
                      disabled={busy || attachmentBusy}
                      onClick={() => selectCommentMode("internal")}
                      type="button"
                    >
                      <MessageSquare aria-hidden="true" size={17} />
                      <span>
                        <strong>Interne Notiz</strong>
                        <small>Nur für berechtigte Mitarbeitende</small>
                      </span>
                    </button>
                  )}
                  <button
                    aria-pressed={commentVisibility === "external"}
                    className="ticket-comment-mode ticket-comment-mode--external"
                    disabled={busy || attachmentBusy}
                    onClick={() => selectCommentMode("external")}
                    type="button"
                  >
                    <Send aria-hidden="true" size={17} strokeWidth={1.8} />
                    <span>
                      <strong>Antwort an anfragende Person</strong>
                      <small>Für die anfragende Person sichtbar</small>
                    </span>
                  </button>
                </div>
              )}
              <label className="ticket-comment-body">
                {commentComposer.bodyLabel}
                <textarea
                  aria-describedby="ticket-comment-visibility-hint"
                  disabled={busy || attachmentBusy}
                  maxLength={50_000}
                  ref={commentTextareaRef}
                  onChange={(event) =>
                    setCommentDrafts((current) =>
                      updateTicketCommentDraft(
                        current,
                        commentVisibility,
                        event.target.value,
                      ),
                    )
                  }
                  onClick={(event) =>
                    placeCaretAfterGreeting(event.currentTarget)
                  }
                  onFocus={(event) => {
                    const field = event.currentTarget;
                    window.setTimeout(() => placeCaretAfterGreeting(field), 0);
                  }}
                  placeholder={commentComposer.placeholder}
                  rows={4}
                  value={commentBody}
                />
              </label>
              {canAttachCommentImages ? (
                <div
                  className={`ticket-comment-image-dropzone${isCommentImageDropActive ? " ticket-comment-image-dropzone--active" : ""}`}
                  onDragLeave={() => setIsCommentImageDropActive(false)}
                  onDragOver={handleCommentImageDragOver}
                  onDrop={handleCommentImageDrop}
                >
                  <input
                    accept={COMMENT_IMAGE_ACCEPT}
                    aria-label="Bilder für diese Nachricht auswählen"
                    className="ticket-comment-image-input"
                    disabled={busy || attachmentBusy}
                    multiple
                    onChange={(event) =>
                      void addCommentImages([
                        ...(event.currentTarget.files ?? []),
                      ])
                    }
                    ref={commentImageInputRef}
                    type="file"
                  />
                  <div className="ticket-comment-image-dropzone__copy">
                    <ImagePlus aria-hidden="true" size={19} />
                    <span>
                      <strong>Bilder zur Nachricht hinzufügen</strong>
                      <small>
                        Hierher ziehen oder hochladen · PNG, JPG/JPEG und WebP ·
                        maximal 25 MiB pro Bild
                      </small>
                    </span>
                  </div>
                  <button
                    className="secondary-button"
                    disabled={busy || attachmentBusy}
                    onClick={() => commentImageInputRef.current?.click()}
                    type="button"
                  >
                    <ImagePlus aria-hidden="true" size={16} />
                    Bilder hochladen
                  </button>
                  {activeCommentImageAttachments.length > 0 ? (
                    <ul className="ticket-comment-image-preview-list">
                      {activeCommentImageAttachments.map((attachment) => (
                        <li key={attachment.key}>
                          <ImagePlus aria-hidden="true" size={19} />
                          <span>
                            <strong>{attachment.originalFilename}</strong>
                            <small>{formatFileSize(attachment.byteSize)}</small>
                          </span>
                          <button
                            aria-label={`${attachment.originalFilename} entfernen`}
                            className="icon-button"
                            disabled={busy || attachmentBusy}
                            onClick={() =>
                              removeCommentImage(attachment, commentVisibility)
                            }
                            type="button"
                          >
                            <X aria-hidden="true" size={16} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {commentImageNotice ? (
                    <p
                      className={`ticket-comment-image-notice ticket-comment-image-notice--${commentImageNotice.tone}`}
                      role={
                        commentImageNotice.tone === "error" ? "alert" : "status"
                      }
                    >
                      {commentImageNotice.text}
                    </p>
                  ) : null}
                </div>
              ) : null}
              {activeCommunicationDraft.restored && (
                <p className="ticket-workbench__notice" role="status">
                  {activeCommunicationDraft.restoredLabel}
                  <button
                    className="text-button"
                    onClick={activeCommunicationDraft.discard}
                    type="button"
                  >
                    Verwerfen
                  </button>
                  <button
                    className="text-button"
                    onClick={activeCommunicationDraft.clearRestoredNotice}
                    type="button"
                  >
                    Hinweis ausblenden
                  </button>
                </p>
              )}
              <TicketMentionPicker
                disabled={busy}
                enabled={detail.canUseInternalNotes}
                notifyOnly={commentVisibility !== "internal"}
                onChange={setMentionedUserIds}
                onInsertMention={(displayName) =>
                  commentVisibility === "internal" &&
                  setCommentDrafts((current) => {
                    const internalNote = ticketCommentDraftForMode(
                      current,
                      "internal",
                    );
                    const mention = `@${displayName}`;
                    return updateTicketCommentDraft(
                      current,
                      "internal",
                      internalNote.includes(mention)
                        ? internalNote
                        : `${internalNote}${internalNote.trim() ? " " : ""}${mention} `,
                    );
                  })
                }
                people={visibleAssignableAgents
                  .filter((agent) => agent.id !== currentUserId)
                  .map((agent) => ({
                    id: agent.id,
                    displayName: agent.displayName,
                  }))}
                selectedIds={mentionedUserIds}
              />
              {commentVisibility === "external" &&
              detail.canUseInternalNotes ? (
                <TicketCopyRecipients
                  disabled={busy}
                  onChange={setCopyRecipients}
                  selected={copyRecipients}
                  tenantId={tenantId}
                  ticketId={ticketId}
                />
              ) : null}
              <p
                className={`ticket-comment-visibility-hint ${commentVisibility}`}
                id="ticket-comment-visibility-hint"
                aria-live="polite"
              >
                {commentComposer.hint}
              </p>
              {commentNotice && (
                <p className="ticket-workbench__notice" role="status">
                  {commentNotice}
                </p>
              )}
              <button
                className="primary-button"
                disabled={busy || attachmentBusy}
                type="submit"
              >
                {pendingAction === "comment" ? (
                  <LoaderCircle
                    aria-hidden="true"
                    className="ticket-detail-spinner"
                    size={16}
                  />
                ) : (
                  <Send aria-hidden="true" size={16} strokeWidth={1.8} />
                )}
                {commentComposer.submitLabel}
              </button>
              {detail.canClose && !ticketIsClosed ? (
                <button
                  className="secondary-button ticket-comment-resolve-button"
                  disabled={busy || attachmentBusy}
                  onClick={() => {
                    resolveAfterCommentRef.current = true;
                  }}
                  type="submit"
                >
                  <CircleCheck aria-hidden="true" size={16} strokeWidth={1.8} />
                  {commentVisibility === "internal"
                    ? "Notiz speichern und als gelöst markieren"
                    : "Antwort senden und als gelöst markieren"}
                </button>
              ) : null}
            </form>
          </section>
        </div>
        <aside
          className="ticket-detail-sidebar"
          aria-label="Ticketinformationen"
        >
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
                  {!requesterView && (
                    <TicketSlaBreachReason
                      tenantId={tenantId}
                      ticketId={ticketId}
                      variant="closing"
                    />
                  )}
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
                      onClick={() => setPendingCloseConfirmation(null)}
                      type="button"
                    >
                      Abbrechen
                    </button>
                  </div>
                </div>
              </div>
            )}
            {!requesterView && !pendingCloseConfirmation && (
              <TicketSlaBreachReason
                refreshKey={`${detail.ticket.status_id}:${detail.ticket.resolved_at ?? ""}`}
                tenantId={tenantId}
                ticketId={ticketId}
              />
            )}
            {solutionPromptOpen && ticketIsClosed && (
              <TicketSolutionPrompt
                onDismiss={() => setSolutionPromptOpen(false)}
                onOpenArticle={
                  onOpenKnowledgeArticle
                    ? (articleId) => {
                        setSolutionPromptOpen(false);
                        onOpenKnowledgeArticle(articleId);
                      }
                    : undefined
                }
                requestDraft={() => requestAiTicketDraft(tenantId, ticketId)}
              />
            )}
            {requesterView ? (
              <RequesterTicketProgress
                onChanged={() => {
                  void loadTicket();
                  onChanged();
                }}
                refreshKey={`${detail.ticket.status_id}:${detail.ticket.resolved_at ?? ""}:${detail.comments.length}`}
                tenantId={tenantId}
                ticketId={detail.ticket.id}
              />
            ) : null}
            {ticketIsRatable && (requesterView || feedback?.satisfaction) ? (
              <section
                aria-labelledby="ticket-satisfaction-heading"
                className="ticket-satisfaction"
              >
                <h3 id="ticket-satisfaction-heading">
                  {requesterView
                    ? "Wie zufrieden sind Sie?"
                    : "Bewertung der anfragenden Person"}
                </h3>
                {feedbackLoading ? (
                  <p className="ticket-satisfaction__hint">
                    Bewertung wird geladen …
                  </p>
                ) : feedback?.canRate ? (
                  <form onSubmit={saveFeedback}>
                    <div
                      aria-label="Bewertung von 1 bis 5 Sternen"
                      className="ticket-satisfaction__stars"
                      role="radiogroup"
                    >
                      {[1, 2, 3, 4, 5].map((value) => (
                        <button
                          aria-checked={feedbackScore === value}
                          aria-label={`${value} von 5 Sternen`}
                          className={
                            feedbackScore !== null && value <= feedbackScore
                              ? "ticket-satisfaction__star is-active"
                              : "ticket-satisfaction__star"
                          }
                          key={value}
                          onClick={() => setFeedbackScore(value)}
                          role="radio"
                          type="button"
                        >
                          <Star
                            aria-hidden="true"
                            size={24}
                            strokeWidth={1.8}
                          />
                        </button>
                      ))}
                    </div>
                    <label className="ticket-satisfaction__comment">
                      Kommentar (optional)
                      <textarea
                        maxLength={3000}
                        onChange={(event) =>
                          setFeedbackComment(event.target.value)
                        }
                        placeholder="Was war gut, was können wir besser machen?"
                        rows={3}
                        value={feedbackComment}
                      />
                    </label>
                    <div className="ticket-satisfaction__actions">
                      <button
                        className="primary-button"
                        disabled={
                          feedbackScore === null || pendingAction === "feedback"
                        }
                        type="submit"
                      >
                        {pendingAction === "feedback"
                          ? "Wird gespeichert …"
                          : feedback.satisfaction
                            ? "Bewertung ändern"
                            : "Bewertung senden"}
                      </button>
                      {feedback.satisfaction ? (
                        <span className="ticket-satisfaction__hint">
                          Eine Bewertung kann innerhalb von 14 Tagen einmal
                          geändert werden.
                        </span>
                      ) : null}
                    </div>
                  </form>
                ) : feedback?.satisfaction?.score ? (
                  <div className="ticket-satisfaction__result">
                    <span
                      aria-label={`${feedback.satisfaction.score} von 5 Sternen`}
                      className="ticket-satisfaction__stars"
                      role="img"
                    >
                      {[1, 2, 3, 4, 5].map((value) => (
                        <Star
                          aria-hidden="true"
                          className={
                            value <= (feedback.satisfaction?.score ?? 0)
                              ? "ticket-satisfaction__star is-active"
                              : "ticket-satisfaction__star"
                          }
                          key={value}
                          size={20}
                          strokeWidth={1.8}
                        />
                      ))}
                    </span>
                    {feedback.satisfaction.comment ? (
                      <p>{feedback.satisfaction.comment}</p>
                    ) : null}
                  </div>
                ) : null}
                {feedbackError ? (
                  <p className="ticket-detail-message error" role="alert">
                    {feedbackError}
                  </p>
                ) : null}
                {feedbackSuccess ? (
                  <p className="ticket-satisfaction__success" role="status">
                    {feedbackSuccess}
                  </p>
                ) : null}
              </section>
            ) : null}
            {requesterView ? (
              <dl className="ticket-detail-facts-grid">
                <div>
                  <dt>Status</dt>
                  <dd>{selectedStatus?.label ?? "Nicht verfügbar"}</dd>
                </div>
                <div>
                  <dt>Priorität</dt>
                  <dd>{selectedPriority?.label ?? "Nicht verfügbar"}</dd>
                </div>
                <div>
                  <dt>Bearbeitet von</dt>
                  <dd>
                    {detail.assignedAgent?.displayName ??
                      "Noch nicht zugewiesen"}
                  </dd>
                </div>
                <div>
                  <dt>Abteilung</dt>
                  <dd>{detail.department?.name ?? "Nicht hinterlegt"}</dd>
                </div>
                <div>
                  <dt>Kategorie</dt>
                  <dd>{selectedTicketCategory?.name ?? "Keine Kategorie"}</dd>
                </div>
                <div>
                  <dt>Erfasst am</dt>
                  <dd>{formatDateTime(detail.ticket.created_at)}</dd>
                </div>
              </dl>
            ) : (
              <dl className="ticket-detail-facts-grid">
                {detail.requesterContact && (
                  <div
                    className={
                      emailSenderContacts && !requesterView
                        ? "ticket-requester-fact ticket-requester-fact--contacts"
                        : "ticket-requester-fact"
                    }
                  >
                    <dt>Anfragende Person</dt>
                    <dd>
                      {onOpenPerson && !requesterView ? (
                        <button
                          className="ticket-requester-link"
                          onClick={() =>
                            detail.requesterContact &&
                            onOpenPerson({
                              requesterContactId: detail.requesterContact.id,
                              // requester_id can be the agent who recorded
                              // the ticket; the contact is the real person.
                              userId: null,
                              displayName: formatPersonDisplayName(
                                detail.requesterContact.displayName,
                              ),
                            })
                          }
                          title="Personenübersicht öffnen"
                          type="button"
                        >
                          {formatPersonDisplayName(
                            detail.requesterContact.displayName,
                          )}
                        </button>
                      ) : (
                        formatPersonDisplayName(
                          detail.requesterContact.displayName,
                        )
                      )}
                      {emailSenderContacts && !requesterView ? (
                        <ul
                          aria-label="Kontaktdaten aus der E-Mail"
                          className="ticket-requester-contacts"
                        >
                          {emailSenderContacts.phones.map((phone) => (
                            <li key={`phone:${phone}`}>
                              <Phone aria-hidden="true" size={13} />
                              <a href={phoneHref(phone)}>{phone}</a>
                            </li>
                          ))}
                          {emailSenderContacts.emails.map((email) => (
                            <li key={`email:${email}`}>
                              <Mail aria-hidden="true" size={13} />
                              <a href={`mailto:${email}`}>{email}</a>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </dd>
                  </div>
                )}
                {/* Externe Absender: Abteilung / Angebot ist nicht relevant. */}
                {emailSenderContacts ? null : (
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
                          {requesterDepartment.trim() ? (
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
                          ) : requesterOffer.trim() ? (
                            <input
                              aria-label="Angebot der anfragenden Person"
                              disabled={busy || requesterProfileBusy}
                              onBlur={() => void saveRequesterContext()}
                              onChange={(event) =>
                                setRequesterOffer(event.target.value)
                              }
                              placeholder="Angebot"
                              value={requesterOffer}
                            />
                          ) : (
                            <>
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
                                onChange={(event) =>
                                  setRequesterOffer(event.target.value)
                                }
                                placeholder="Angebot"
                                value={requesterOffer}
                              />
                            </>
                          )}
                        </span>
                      ) : requesterContext.length > 0 ? (
                        requesterContext.join(" · ")
                      ) : (
                        "Nicht hinterlegt"
                      )}
                    </dd>
                  </div>
                )}
                <div
                  className={
                    detail.canUpdate
                      ? "ticket-detail-fact--editable"
                      : undefined
                  }
                >
                  <dt>Status</dt>
                  <dd>
                    {detail.canUpdate ? (
                      <select
                        aria-label="Ticketstatus direkt ändern"
                        disabled={busy}
                        onChange={(event) => {
                          void saveOverviewChange({
                            statusKey: event.target.value,
                          });
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
                    detail.canUpdate
                      ? "ticket-detail-fact--editable"
                      : undefined
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
                  className={`${
                    detail.canAssign ? "ticket-detail-fact--editable" : ""
                  }${requiredCloseFields.assignee ? " ticket-detail-fact--required-missing" : ""}`}
                >
                  <dt>
                    Zugewiesen an <RequiredMark />
                  </dt>
                  <dd>
                    {detail.canAssign ? (
                      <>
                        <select
                          aria-label="Zugewiesene Person direkt ändern"
                          disabled={busy}
                          onChange={(event) => {
                            setSelectedAgentId(event.target.value);
                            setAssignmentPrefilled(false);
                            void saveOverviewChange({
                              assignedAgentId: event.target.value || null,
                            });
                          }}
                          value={selectedAgentId}
                        >
                          <option value="">Nicht zugewiesen</option>
                          {visibleAssignableAgents.map((agent) => (
                            <option key={agent.id} value={agent.id}>
                              {absenceLabel(
                                `${agent.displayName}${agent.id === currentUserId ? " (ich)" : ""}`,
                                activeAbsences.get(agent.id),
                                (id) =>
                                  visibleAssignableAgents.find(
                                    (candidate) => candidate.id === id,
                                  )?.displayName,
                              )}
                            </option>
                          ))}
                        </select>
                        {assignmentPrefilled &&
                          selectedAgentId !== assignedAgentId && (
                            <button
                              className="text-button"
                              disabled={busy}
                              onClick={() => {
                                void saveOverviewChange({
                                  assignedAgentId: selectedAgentId || null,
                                });
                                setAssignmentPrefilled(false);
                              }}
                              type="button"
                            >
                              Zuweisung bestätigen
                            </button>
                          )}
                      </>
                    ) : (
                      (detail.assignedAgent?.displayName ?? "Nicht zugewiesen")
                    )}
                  </dd>
                </div>
                <div
                  className={`${
                    detail.canAssign ? "ticket-detail-fact--editable" : ""
                  }${requiredCloseFields.team ? " ticket-detail-fact--required-missing" : ""}`}
                >
                  <dt>
                    Team <RequiredMark />
                  </dt>
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
                        value={selectedTeamId}
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
                <div
                  className={
                    detail.canUpdate
                      ? "ticket-detail-fact--editable"
                      : undefined
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
                <div
                  className={
                    detail.canUpdate
                      ? "ticket-detail-fact--editable"
                      : undefined
                  }
                >
                  <dt>Erfasst am</dt>
                  <dd>{formatDateTime(detail.ticket.created_at)}</dd>
                </div>
                <div className="ticket-detail-fact-pair">
                  <div
                    className={`${
                      detail.canUpdate ? "ticket-detail-fact--editable" : ""
                    }${requiredCloseFields.category ? " ticket-detail-fact--required-missing" : ""}`}
                  >
                    <dt>
                      Kategorie <RequiredMark />
                    </dt>
                    <dd>
                      {ticketCategoriesLoading ? (
                        "Wird geladen …"
                      ) : detail.canUpdate ? (
                        <select
                          aria-label="Ticketkategorie direkt ändern"
                          disabled={ticketCategorySaving}
                          onChange={(event) => {
                            if (event.target.value === NEW_CATEGORY_OPTION) {
                              openTicketCategoryForm(null);
                              return;
                            }
                            void saveTicketCategory(
                              event.target.value || null,
                              null,
                            );
                          }}
                          value={selectedTicketCategory?.id ?? ""}
                        >
                          <option value="">Keine Kategorie</option>
                          {rootTicketCategories.map((category) => (
                            <option key={category.id} value={category.id}>
                              {category.name}
                            </option>
                          ))}
                          <option value={NEW_CATEGORY_OPTION}>
                            + Neue Kategorie …
                          </option>
                        </select>
                      ) : (
                        (selectedTicketCategory?.name ?? "Keine Kategorie")
                      )}
                    </dd>
                  </div>
                  <div
                    className={
                      detail.canUpdate
                        ? "ticket-detail-fact--editable"
                        : undefined
                    }
                  >
                    <dt>Unterkategorie</dt>
                    <dd>
                      {ticketCategoriesLoading ? (
                        "Wird geladen …"
                      ) : detail.canUpdate ? (
                        <select
                          aria-label="Ticketunterkategorie direkt ändern"
                          disabled={
                            !selectedTicketCategory || ticketCategorySaving
                          }
                          onChange={(event) => {
                            if (event.target.value === NEW_CATEGORY_OPTION) {
                              if (selectedTicketCategory) {
                                openTicketCategoryForm(
                                  selectedTicketCategory.id,
                                );
                              }
                              return;
                            }
                            void saveTicketCategory(
                              selectedTicketCategory?.id ?? null,
                              event.target.value || null,
                            );
                          }}
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
                          {selectedTicketCategory ? (
                            <option value={NEW_CATEGORY_OPTION}>
                              + Neue Unterkategorie …
                            </option>
                          ) : null}
                        </select>
                      ) : (
                        (selectedTicketSubcategory?.name ??
                        "Keine Unterkategorie")
                      )}
                    </dd>
                  </div>
                </div>
                {detail.canUpdate && ticketCategoryDraft ? (
                  <div className="ticket-detail-fact--wide">
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
                            ticketCategorySaving ||
                            !ticketCategoryDraft.name.trim()
                          }
                          onClick={() => void createTicketCategoryFromDetail()}
                          type="button"
                        >
                          {ticketCategorySaving
                            ? "Wird gespeichert …"
                            : "Erstellen"}
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}
                {detail.canUpdate && ticketCategoryError ? (
                  <div className="error ticket-detail-fact--wide" role="alert">
                    {ticketCategoryError}
                  </div>
                ) : null}
                <div
                  className={
                    detail.canUpdate
                      ? "ticket-detail-fact--editable ticket-detail-fact--catalog-link"
                      : "ticket-detail-fact--catalog-link"
                  }
                >
                  <dt>Asset / Katalogeintrag verknüpfen</dt>
                  <dd>
                    {detail.canUpdate ? (
                      <form
                        className="ticket-overview-catalog-link"
                        onSubmit={linkCatalogItem}
                      >
                        <div
                          className="ticket-catalog-picker"
                          ref={catalogPickerRef}
                        >
                          <button
                            aria-controls={
                              catalogPickerOpen
                                ? catalogPickerResultsId
                                : undefined
                            }
                            aria-expanded={catalogPickerOpen}
                            className="ticket-catalog-picker__trigger"
                            disabled={catalogBusy || affectedItemsLoading}
                            onClick={() =>
                              setCatalogPickerOpen((open) => !open)
                            }
                            ref={catalogPickerTriggerRef}
                            type="button"
                          >
                            <span>
                              <strong>
                                {selectedCatalogItem
                                  ? selectedCatalogItem.label
                                  : "Asset oder Katalogeintrag suchen"}
                              </strong>
                              {selectedCatalogItem ? (
                                <small>
                                  {catalogKindLabel(selectedCatalogItem.kind)} ·{" "}
                                  {selectedCatalogItem.description}
                                </small>
                              ) : null}
                            </span>
                            <ChevronDown
                              aria-hidden="true"
                              size={16}
                              strokeWidth={1.8}
                            />
                          </button>
                          {catalogPickerOpen ? (
                            <section
                              aria-label="Asset oder Katalogeintrag suchen"
                              className="ticket-catalog-picker__panel"
                              id={catalogPickerResultsId}
                            >
                              <label className="ticket-catalog-picker__search">
                                <Search
                                  aria-hidden="true"
                                  size={16}
                                  strokeWidth={1.8}
                                />
                                <input
                                  aria-label="Assets und Katalogeinträge durchsuchen"
                                  autoComplete="off"
                                  onChange={(event) =>
                                    setCatalogSearchQuery(event.target.value)
                                  }
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter") {
                                      event.preventDefault();
                                      return;
                                    }
                                    if (
                                      event.key === "ArrowDown" &&
                                      catalogSearchResults.length > 0
                                    ) {
                                      event.preventDefault();
                                      focusCatalogSearchResult(0);
                                    }
                                  }}
                                  placeholder="Name, Asset-Kennung oder Typ suchen …"
                                  ref={catalogSearchInputRef}
                                  type="search"
                                  value={catalogSearchQuery}
                                />
                                {catalogSearchQuery ? (
                                  <button
                                    aria-label="Assetsuche löschen"
                                    className="ticket-catalog-picker__clear"
                                    onClick={() => setCatalogSearchQuery("")}
                                    type="button"
                                  >
                                    <X
                                      aria-hidden="true"
                                      size={15}
                                      strokeWidth={1.8}
                                    />
                                  </button>
                                ) : null}
                              </label>
                              {affectedItemsError ? (
                                <p
                                  className="ticket-catalog-picker__state"
                                  role="alert"
                                >
                                  {affectedItemsError}
                                </p>
                              ) : !affectedItemsLoaded ||
                                affectedItemsLoading ? (
                                <p
                                  className="ticket-catalog-picker__state"
                                  role="status"
                                >
                                  Verfügbare Assets und Katalogeinträge werden
                                  geladen …
                                </p>
                              ) : availableCatalogItems.length === 0 ? (
                                <p className="ticket-catalog-picker__state">
                                  Keine weiteren verfügbaren Katalogeinträge.
                                </p>
                              ) : catalogSearchQuery.trim().length < 2 ? (
                                <p className="ticket-catalog-picker__state">
                                  Mindestens zwei Zeichen eingeben, um
                                  verfügbare Assets und Katalogeinträge zu
                                  suchen.
                                </p>
                              ) : catalogSearchResults.length === 0 ? (
                                <p className="ticket-catalog-picker__state">
                                  Keine verfügbaren Treffer für «
                                  {catalogSearchQuery.trim()}
                                  ».
                                </p>
                              ) : (
                                <ul>
                                  {catalogSearchResults.map((item, index) => {
                                    const itemKey = catalogSelectionKey(item);
                                    return (
                                      <li key={itemKey}>
                                        <button
                                          className={
                                            selectedCatalogItemKey === itemKey
                                              ? "ticket-catalog-picker__option ticket-catalog-picker__option--selected"
                                              : "ticket-catalog-picker__option"
                                          }
                                          onClick={() =>
                                            selectCatalogSearchResult(itemKey)
                                          }
                                          onKeyDown={(event) => {
                                            if (event.key === "ArrowDown") {
                                              event.preventDefault();
                                              focusCatalogSearchResult(
                                                Math.min(
                                                  index + 1,
                                                  catalogSearchResults.length -
                                                    1,
                                                ),
                                              );
                                            } else if (
                                              event.key === "ArrowUp"
                                            ) {
                                              event.preventDefault();
                                              if (index === 0) {
                                                catalogSearchInputRef.current?.focus();
                                              } else {
                                                focusCatalogSearchResult(
                                                  index - 1,
                                                );
                                              }
                                            } else if (event.key === "Home") {
                                              event.preventDefault();
                                              focusCatalogSearchResult(0);
                                            } else if (event.key === "End") {
                                              event.preventDefault();
                                              focusCatalogSearchResult(
                                                catalogSearchResults.length - 1,
                                              );
                                            }
                                          }}
                                          ref={(element) => {
                                            catalogSearchResultRefs.current[
                                              index
                                            ] = element;
                                          }}
                                          type="button"
                                        >
                                          <span>
                                            {catalogKindLabel(item.kind)}
                                          </span>
                                          <strong>{item.label}</strong>
                                          <small>{item.description}</small>
                                        </button>
                                      </li>
                                    );
                                  })}
                                </ul>
                              )}
                            </section>
                          ) : null}
                        </div>
                        {pendingCatalogAction === "link" ? (
                          <span className="data-caption" role="status">
                            <LoaderCircle
                              aria-hidden="true"
                              className="ticket-detail-spinner"
                              size={16}
                            />{" "}
                            Wird verknüpft …
                          </span>
                        ) : null}
                      </form>
                    ) : null}
                    {detail.canUpdate &&
                    requesterDeviceSuggestions.length > 0 ? (
                      <div
                        aria-label="Geräte der anfragenden Person"
                        className="ticket-device-suggestions"
                      >
                        <p className="data-caption">
                          Geräte der anfragenden Person
                        </p>
                        <ul>
                          {requesterDeviceSuggestions.map((item) => (
                            <li key={catalogSelectionKey(item)}>
                              <button
                                disabled={catalogBusy}
                                onClick={() =>
                                  void linkCatalogItemByKey(
                                    catalogSelectionKey(item),
                                  )
                                }
                                title={item.description}
                                type="button"
                              >
                                <Plus aria-hidden="true" size={14} />
                                {item.label}
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {linkedCatalogItems.length > 0 ? (
                      <div
                        aria-label="Verknüpfte Assets und Katalogeinträge"
                        className="ticket-overview-linked-catalog"
                      >
                        <p className="data-caption">Verknüpft</p>
                        <ul>
                          {linkedCatalogItems.map((item) => (
                            <li key={catalogItemKey(item)}>
                              <span>{catalogKindLabel(item.kind)}</span>
                              <strong>{item.label}</strong>
                              {item.metadata.length > 0 ? (
                                <small>{item.metadata.join(" · ")}</small>
                              ) : null}
                              {detail.canUpdate ? (
                                <button
                                  aria-label={`${item.label} entfernen`}
                                  className="ticket-overview-linked-catalog__remove"
                                  disabled={catalogBusy}
                                  onClick={() => void unlinkCatalogItem(item)}
                                  title="Verknüpfung entfernen"
                                  type="button"
                                >
                                  <X aria-hidden="true" size={15} />
                                </button>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : !detail.canUpdate ? (
                      "Keine Elemente verknüpft"
                    ) : null}
                    {detail.canUpdate && affectedItemsLoading ? (
                      <p
                        className="data-caption"
                        aria-live="polite"
                        role="status"
                      >
                        Verfügbare Assets und Katalogeinträge werden geladen …
                      </p>
                    ) : detail.canUpdate &&
                      availableCatalogItems.length === 0 &&
                      affectedItemsLoaded ? (
                      <p className="data-caption" aria-live="polite">
                        Keine weiteren verfügbaren Katalogeinträge.
                      </p>
                    ) : null}
                  </dd>
                </div>
                {detail.canUpdate && (
                  <TicketPersonDevices
                    onOpenAsset={onOpenAsset}
                    refreshKey={`${detail.ticket.requester_id ?? ""}:${detail.ticket.affected_user_id ?? ""}`}
                    tenantId={tenantId}
                    ticketId={ticketId}
                  />
                )}
                {detail.canUpdate && (
                  <TicketIntuneActions
                    onCompleted={() => void refreshTicketEvents()}
                    refreshKey={`${detail.ticket.requester_id ?? ""}:${detail.ticket.affected_user_id ?? ""}`}
                    tenantId={tenantId}
                    ticketId={ticketId}
                  />
                )}
              </dl>
            )}
          </section>

          {requesterView ? null : (
            <TicketCoordination
              description={detail.ticket.description}
              onChanged={() => {
                onChanged();
                void loadTicket();
              }}
              onOpenTicket={onOpenTicket}
              refreshKey={`${detail.ticket.status_id}|${detail.ticket.assigned_agent_id ?? ""}|${detail.comments.length}|${detail.events[0]?.id ?? ""}`}
              subject={detail.ticket.subject}
              tenantId={tenantId}
              ticketId={detail.ticket.id}
              ticketNumber={detail.ticket.ticket_number}
              timelineHost={timelineHost}
              supportLevel={
                <TicketSupportLevel
                  embedded
                  onChanged={() => {
                    onChanged();
                    void loadTicket();
                  }}
                  refreshKey={`${detail.ticket.assigned_team_id ?? ""}|${detail.ticket.status_id}|${detail.events[0]?.id ?? ""}`}
                  tenantId={tenantId}
                  ticketId={detail.ticket.id}
                />
              }
            />
          )}

          <TicketCustomFields
            canUpdate={detail.canUpdate}
            tenantId={tenantId}
            ticketId={detail.ticket.id}
          />

          {!requesterView ? (
            <TicketAiTriage
              canUpdate={detail.canUpdate}
              key={`triage-${detail.ticket.id}`}
              onChanged={() => {
                void loadTicket();
                onChanged();
              }}
              tenantId={tenantId}
              ticketId={detail.ticket.id}
            />
          ) : null}
          {!requesterView ? (
            <TicketAiSummary tenantId={tenantId} ticketId={detail.ticket.id} />
          ) : null}

          {focusMode && (
            <p className="ticket-focus-notice" role="status">
              Fokusmodus aktiv: Kommunikation, Status und die nächste Aktion
              bleiben im Blick. Weitere Ticketbereiche können über „Alle
              Bereiche“ eingeblendet werden.
            </p>
          )}

          {!requesterView && detail.ticketModules.checklists ? (
            <details className="ticket-detail-disclosure">
              <summary>
                <span className="ticket-detail-disclosure-label">
                  <ListChecks aria-hidden="true" size={17} strokeWidth={1.8} />
                  Checkliste
                </span>
                <span className="ticket-detail-disclosure-meta">
                  Arbeitsschritte abhaken
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
                          <Circle
                            aria-hidden="true"
                            size={16}
                            strokeWidth={1.8}
                          />
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
              </div>
            </details>
          ) : null}

          {!requesterView &&
          detail.ticketModules.timeTracking &&
          detail.canTrackTime ? (
            <details className="ticket-detail-disclosure">
              <summary>
                <span className="ticket-detail-disclosure-label">
                  <Clock aria-hidden="true" size={17} strokeWidth={1.8} />
                  Arbeitszeit
                </span>
                <span className="ticket-detail-disclosure-meta">
                  Zeit erfassen und auswerten
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
                  aria-labelledby="ticket-time-entries-heading"
                >
                  <div className="ticket-detail-section-heading">
                    <div>
                      <p className="eyebrow">ARBEITSZEIT</p>
                      <h3 id="ticket-time-entries-heading">
                        Arbeitszeit erfassen
                      </h3>
                    </div>
                    <span className="data-caption">
                      {detail.timeEntries.length}
                    </span>
                  </div>

                  <form
                    className="ticket-comment-form"
                    onSubmit={saveTimeEntry}
                  >
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
                        onChange={(event) =>
                          setTimeEntryNote(event.target.value)
                        }
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
                        <Clock3
                          aria-hidden="true"
                          size={16}
                          strokeWidth={1.8}
                        />
                      )}
                      Arbeitszeit speichern
                    </button>
                  </form>

                  {detail.timeEntries.length === 0 ? (
                    <p className="empty-state">
                      Noch keine Arbeitszeit erfasst.
                    </p>
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
                                {entry.started_at
                                  ? "Begonnen am "
                                  : "Erfasst am "}
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
              </div>
            </details>
          ) : null}

          {requesterView ? null : (
            <details
              className="ticket-detail-disclosure"
              onToggle={(event) => setIsWorkToolsOpen(event.currentTarget.open)}
              open={isWorkToolsOpen}
            >
              <summary>
                <span className="ticket-detail-disclosure-label">
                  <CircleCheck aria-hidden="true" size={17} strokeWidth={1.8} />
                  Ticket steuern
                </span>
                <span className="ticket-detail-disclosure-meta">
                  Zusammenführen, Fall eröffnen, vorgesetzte Person fragen
                  <ChevronDown
                    aria-hidden="true"
                    className="ticket-detail-disclosure-icon"
                    size={18}
                    strokeWidth={1.8}
                  />
                </span>
              </summary>
              {isWorkToolsOpen && (
                <div className="ticket-detail-disclosure-content">
                  <TicketControlPanel
                    canAskSupervisor={detail.canUseInternalNotes}
                    canMerge={detail.canMerge}
                    canOpenCase={detail.canUpdate}
                    departmentId={detail.ticket.department_id ?? null}
                    mergeContent={
                      <section
                        aria-busy={
                          mergeSearchLoading || pendingAction === "merge"
                        }
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
                          Das aktuelle Ticket wird als Duplikat geschlossen und
                          im gewählten Hauptticket referenziert.
                        </p>
                        <label className="ticket-comment-body">
                          Hauptticket suchen
                          <input
                            aria-describedby="ticket-merge-help"
                            disabled={busy}
                            maxLength={240}
                            minLength={2}
                            onChange={(event) =>
                              setMergeQuery(event.target.value)
                            }
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
                          <p
                            className="ticket-detail-message error"
                            role="alert"
                          >
                            <AlertCircle aria-hidden="true" size={17} />
                            {mergeError}
                          </p>
                        )}

                        {mergeSearchLoading && (
                          <p
                            className="empty-state ticket-detail-loading"
                            role="status"
                          >
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
                                        Bitte bestätigen: Das aktuelle Ticket
                                        wird als Duplikat geschlossen und in
                                        diesem Hauptticket referenziert.
                                      </p>
                                      <div className="ticket-detail-actions">
                                        <button
                                          className="primary-button"
                                          disabled={busy || mergeSearchLoading}
                                          onClick={() =>
                                            void markMerged(target)
                                          }
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
                                          onClick={() =>
                                            setMergeConfirmationTarget(null)
                                          }
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
                                      onClick={() =>
                                        setMergeConfirmationTarget(target)
                                      }
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
                    }
                    onChanged={async () => {
                      onChanged();
                      await Promise.all([loadTicket(), loadAffectedItems()]);
                    }}
                    tenantId={tenantId}
                    ticketDescription={detail.ticket.description ?? ""}
                    ticketId={ticketId}
                    ticketSubject={detail.ticket.subject}
                  />
                </div>
              )}
            </details>
          )}

          {requesterView ? null : (
            <details
              className="ticket-detail-disclosure"
              onToggle={(event) =>
                setIsClosureContextOpen(event.currentTarget.open)
              }
              open={isClosureContextOpen}
            >
              <summary>
                <span className="ticket-detail-disclosure-label">
                  <BookOpen aria-hidden="true" size={17} strokeWidth={1.8} />
                  Wissen
                </span>
                <span className="ticket-detail-disclosure-meta">
                  Artikel suchen oder aus dem Ticket erstellen
                  <ChevronDown
                    aria-hidden="true"
                    className="ticket-detail-disclosure-icon"
                    size={18}
                    strokeWidth={1.8}
                  />
                </span>
              </summary>
              {isClosureContextOpen && (
                <div className="ticket-detail-disclosure-content">
                  <KnowledgeSection
                    key={`${tenantId}:${ticketId}`}
                    tenantId={tenantId}
                    ticketId={ticketId}
                    canUpdate={detail.canUpdate}
                    canUseInternalNotes={detail.canUseInternalNotes}
                    refreshToken={`${detail.ticket.id}:${detail.canUpdate}:${detail.canUseInternalNotes}`}
                    onChanged={onChanged}
                    onSent={async () => (await loadTicket()) !== null}
                    onOpenArticle={onOpenKnowledgeArticle}
                  />
                </div>
              )}
            </details>
          )}

          <details className="ticket-detail-disclosure">
            <summary>
              <span className="ticket-detail-disclosure-label">
                <Paperclip aria-hidden="true" size={17} strokeWidth={1.8} />
                Anhänge
              </span>
              <span className="ticket-detail-disclosure-meta">
                Dateien zum Ticket
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
                  <form
                    className="ticket-comment-form"
                    onSubmit={uploadAttachment}
                  >
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
                      disabled={
                        attachmentBusy || busy || !selectedAttachmentFile
                      }
                      type="submit"
                    >
                      {pendingAttachmentAction === "upload" ? (
                        <LoaderCircle
                          aria-hidden="true"
                          className="ticket-detail-spinner"
                          size={16}
                        />
                      ) : (
                        <Circle
                          aria-hidden="true"
                          size={16}
                          strokeWidth={1.8}
                        />
                      )}
                      Anhang hochladen
                    </button>
                  </form>
                )}

                {attachmentsLoading && !attachmentsLoaded ? (
                  <p
                    className="empty-state ticket-detail-loading"
                    role="status"
                  >
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
                          {inlineImagesByAttachmentId[attachment.id] ? (
                            <button
                              aria-label={`${attachment.originalFilename} gross anzeigen`}
                              className="ticket-attachment-thumbnail"
                              onClick={() =>
                                void downloadAttachment(attachment)
                              }
                              type="button"
                            >
                              <img
                                alt=""
                                loading="lazy"
                                onError={() =>
                                  refreshInlineImageAfterError(attachment.id)
                                }
                                src={
                                  inlineImagesByAttachmentId[attachment.id]
                                    ?.signedUrl
                                }
                              />
                            </button>
                          ) : null}
                          <div className="ticket-comment-meta">
                            <strong>{attachment.originalFilename}</strong>
                            <span>{formatFileSize(attachment.byteSize)}</span>
                            <time dateTime={attachment.createdAt}>
                              Hochgeladen am{" "}
                              {formatDateTime(attachment.createdAt)}
                            </time>
                          </div>
                          <div className="ticket-detail-actions">
                            <button
                              aria-label={`${attachment.originalFilename} herunterladen`}
                              className="secondary-button"
                              disabled={attachmentBusy || busy}
                              onClick={() =>
                                void downloadAttachment(attachment)
                              }
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
                                onClick={() =>
                                  void deleteAttachment(attachment)
                                }
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

          {requesterView ? null : (
            <details className="ticket-detail-disclosure ticket-detail-disclosure--timeline">
              <summary>
                <span className="ticket-detail-disclosure-label">
                  <Clock3 aria-hidden="true" size={17} strokeWidth={1.8} />
                  Änderungsverlauf
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
              <div className="ticket-detail-disclosure-content ticket-detail-disclosure-content--timeline">
                <div className="ticket-detail-disclosure-intro">
                  <p>Systemereignisse und Statusänderungen zu diesem Ticket.</p>
                </div>
                <section
                  className="ticket-detail-timeline"
                  aria-labelledby="ticket-timeline-heading"
                >
                  <div className="ticket-detail-section-heading">
                    <div>
                      <h3 id="ticket-timeline-heading">Ereignisse</h3>
                    </div>
                    <Clock3 aria-hidden="true" size={18} strokeWidth={1.8} />
                  </div>
                  {detail.events.length === 0 ? (
                    <p className="empty-state">
                      Noch keine Ereignisse vorhanden.
                    </p>
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
                            <strong>
                              {eventLabel(event.event_type, event.payload)}
                            </strong>
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
          )}
        </aside>
      </div>
    </section>
  );
}
