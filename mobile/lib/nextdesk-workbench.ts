import { loadCurrentTenant, requireNextDesk } from "@/lib/nextdesk-client";

export type WorkbenchErrorCode =
  | "authentication_required"
  | "tenant_membership_required"
  | "permission_denied"
  | "tenant_permission_required"
  | "ticket_permission_required"
  | "agent_ticket_permission_required"
  | "agent_workbench_feature_disabled"
  | "requester_portal_feature_disabled"
  | "tenant_feature_lookup_failed"
  | "authorization_check_failed"
  | "agent_workbench_not_configured"
  | "requester_portal_not_configured"
  | "ticket_not_available"
  | "operation_failed"
  | "invalid_response";

export class NextDeskWorkbenchError extends Error {
  readonly code: string;

  constructor(code: WorkbenchErrorCode | string, message: string) {
    super(message);
    this.name = "NextDeskWorkbenchError";
    this.code = code;
  }
}

/**
 * These errors deliberately remove optional workbench and portal areas. The
 * Edge Functions remain the authoritative source for feature gates, tenancy
 * and ticket permissions.
 */
export function isWorkbenchUnavailableError(error: unknown): boolean {
  return (
    error instanceof NextDeskWorkbenchError &&
    [
      "authentication_required",
      "tenant_membership_required",
      "permission_denied",
      "tenant_permission_required",
      "ticket_permission_required",
      "agent_ticket_permission_required",
      "agent_workbench_feature_disabled",
      "requester_portal_feature_disabled",
      "tenant_feature_lookup_failed",
      "authorization_check_failed",
      "agent_workbench_not_configured",
      "requester_portal_not_configured",
      "ticket_not_available",
      "operation_failed",
    ].includes(error.code)
  );
}

export type PublicTicketTimelineItem =
  | {
      type: "event";
      id: string;
      eventType: string;
      occurredAt: string;
      statusLabel?: string | null;
    }
  | {
      type: "comment";
      id: string;
      body: string;
      occurredAt: string;
      authorDisplayName: string | null;
    };

export type AssigneeSuggestion = {
  userId: string;
  displayName?: string;
  isCurrentAssignee: boolean;
  score: number;
  reasons: string[];
  automaticAssignment: false;
};

export type AssignableAgent = {
  userId: string;
  displayName?: string;
  isCurrentAssignee: boolean;
};

export type TicketReopenRequest = {
  id: string;
  ticket_id: string;
  requested_by: string;
  reason: string;
  status: "pending" | "accepted" | "declined";
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
};

export type TicketWorkbenchContext = {
  ticket: Record<string, unknown>;
  requesterTickets: Record<string, unknown>[];
  assets: Record<string, unknown>[];
  assetHistory: Record<string, unknown>[];
  resolutionConfirmations: Record<string, unknown>[];
};

type ApiEnvelope<T> = { data: T };
type ApiErrorEnvelope = { error: { code?: unknown; message?: unknown } };

type AgentWorkbenchAction =
  | { type: "ticketContext"; tenantId: string; ticketId: string }
  | { type: "listAssignableAgents"; tenantId: string; ticketId: string }
  | { type: "suggestAssignees"; tenantId: string; ticketId: string }
  | { type: "listReopenRequests"; tenantId: string }
  | {
      type: "decideReopenRequest";
      tenantId: string;
      reopenRequestId: string;
      decision: "accepted" | "declined";
    };

type RequesterPortalAction =
  | { type: "myTicketTimeline"; tenantId: string; ticketId: string }
  | {
      type: "requestReopen";
      tenantId: string;
      ticketId: string;
      reason: string;
    };

type WithoutTenant<Action> = Action extends { tenantId: string }
  ? Omit<Action, "tenantId">
  : never;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidResponse(): never {
  throw new NextDeskWorkbenchError(
    "invalid_response",
    "Die Antwort von nextDesk ist unvollständig.",
  );
}

function parseErrorEnvelope(value: unknown): NextDeskWorkbenchError | null {
  if (!isRecord(value) || !isRecord(value.error)) return null;
  const { code, message } = value.error;
  if (typeof code !== "string") return null;
  return new NextDeskWorkbenchError(
    code,
    typeof message === "string" && message.trim()
      ? message
      : "Diese Funktion ist derzeit nicht verfügbar.",
  );
}

async function errorFromInvoke(
  error: unknown,
): Promise<NextDeskWorkbenchError | null> {
  const context =
    typeof error === "object" && error !== null && "context" in error
      ? (error as { context?: unknown }).context
      : undefined;
  if (!(context instanceof Response)) return null;
  const payload = await context
    .clone()
    .json()
    .catch(() => null);
  return parseErrorEnvelope(payload);
}

async function invokeWithBody<Result>(
  functionName:
    | "agent-workbench"
    | "requester-portal"
    | "ticket-agent-assignment",
  body: Record<string, unknown>,
): Promise<Result> {
  const { data, error } = await requireNextDesk().functions.invoke(
    functionName,
    {
      body,
    },
  );

  if (error) {
    const parsed = await errorFromInvoke(error);
    if (parsed) throw parsed;
    throw new NextDeskWorkbenchError(
      "operation_failed",
      "Diese Funktion ist derzeit nicht verfügbar.",
    );
  }

  const serverError = parseErrorEnvelope(data);
  if (serverError) throw serverError;
  if (!isRecord(data) || !("data" in data)) invalidResponse();
  return (data as ApiEnvelope<Result>).data;
}

async function invokeFunction<Action extends { tenantId: string }, Result>(
  functionName: "agent-workbench" | "requester-portal",
  action: WithoutTenant<Action>,
): Promise<Result> {
  const tenant = await loadCurrentTenant();
  return invokeWithBody<Result>(functionName, {
    ...action,
    tenantId: tenant.id,
  });
}

function invokeAgentWorkbench<Result>(
  action: WithoutTenant<AgentWorkbenchAction>,
): Promise<Result> {
  return invokeFunction<AgentWorkbenchAction, Result>(
    "agent-workbench",
    action,
  );
}

function invokeRequesterPortal<Result>(
  action: WithoutTenant<RequesterPortalAction>,
): Promise<Result> {
  return invokeFunction<RequesterPortalAction, Result>(
    "requester-portal",
    action,
  );
}

export function loadMyTicketTimeline(ticketId: string): Promise<{
  timeline: PublicTicketTimelineItem[];
}> {
  return invokeRequesterPortal({ type: "myTicketTimeline", ticketId });
}

export function requestTicketReopen(input: {
  ticketId: string;
  reason: string;
}): Promise<{
  reopenRequest: Pick<
    TicketReopenRequest,
    "id" | "ticket_id" | "reason" | "status" | "created_at"
  >;
  ticketChanged: false;
}> {
  return invokeRequesterPortal({ type: "requestReopen", ...input });
}

export function loadTicketWorkbenchContext(ticketId: string): Promise<{
  ticket: TicketWorkbenchContext["ticket"];
  requesterTickets: TicketWorkbenchContext["requesterTickets"];
  assets: TicketWorkbenchContext["assets"];
  assetHistory: TicketWorkbenchContext["assetHistory"];
  resolutionConfirmations: TicketWorkbenchContext["resolutionConfirmations"];
}> {
  return invokeAgentWorkbench({ type: "ticketContext", ticketId });
}

export function loadAssigneeSuggestions(ticketId: string): Promise<{
  suggestions: AssigneeSuggestion[];
  notice: string;
}> {
  return invokeAgentWorkbench({ type: "suggestAssignees", ticketId });
}

export function loadAssignableAgents(ticketId: string): Promise<{
  agents: AssignableAgent[];
}> {
  return invokeAgentWorkbench({ type: "listAssignableAgents", ticketId });
}

export function assignTicketAgent(
  tenantId: string,
  ticketId: string,
  agentId: string,
): Promise<Record<string, unknown>> {
  return invokeWithBody("ticket-agent-assignment", {
    type: "assign",
    tenantId,
    ticketId,
    assignedAgentId: agentId,
  });
}

export function loadReopenRequests(): Promise<{
  reopenRequests: TicketReopenRequest[];
}> {
  return invokeAgentWorkbench({ type: "listReopenRequests" });
}

export function decideTicketReopenRequest(input: {
  reopenRequestId: string;
  decision: "accepted" | "declined";
}): Promise<{
  reopenRequest: TicketReopenRequest;
  ticketReopened: false;
  notice: string;
}> {
  return invokeAgentWorkbench({ type: "decideReopenRequest", ...input });
}
