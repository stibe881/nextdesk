import { loadCurrentTenant, requireNextDesk } from "@/lib/nextdesk-client";

export type IncidentStatus =
  | "investigating"
  | "identified"
  | "monitoring"
  | "resolved";

export type PortalIncidentNotice = {
  id: string;
  title: string;
  description: string;
  status: IncidentStatus;
  category_id: string | null;
  department_id: string | null;
  starts_at: string;
  resolved_at: string | null;
  updated_at: string;
};

export type AgentMention = {
  id: string;
  ticket_id: string;
  comment_id: string | null;
  mentioned_user_id: string;
  author_id: string;
  read_at: string | null;
  created_at: string;
};

export type AgentMetricTicketIds = {
  assigned: string[];
  solvedToday: string[];
  firstResponse: string[];
  dueFollowUps: string[];
  /** Von mir gelöste Tickets (Grundlage der Lösungszeit); fehlt bei älteren Serverständen. */
  resolution?: string[];
  /** Offene Tickets mit erreichter Antwort- oder Lösungsfrist; fehlt bei älteren Serverständen. */
  slaDue?: string[];
};

export type AgentMetrics = {
  open: number;
  solvedToday: number;
  medianFirstResponseMinutes: number | null;
  /** Fehlt bei älteren Serverständen. */
  medianResolutionMinutes?: number | null;
  dueFollowUps: number;
  /** Anzahl offener Tickets mit erreichter Antwort- oder Lösungsfrist. */
  slaDue?: number;
  /** Fehlt bei älteren Serverständen; dann sind die Kennzahlen nicht antippbar. */
  ticketIds?: AgentMetricTicketIds;
};

const metricTicketIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseMetricTicketIdList(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 100) return null;
  const ids = value.filter(
    (entry): entry is string =>
      typeof entry === "string" && metricTicketIdPattern.test(entry),
  );
  return ids.length === value.length ? ids : null;
}

function parseMetricTicketIds(
  value: unknown,
): AgentMetricTicketIds | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const assigned = parseMetricTicketIdList(record.assigned);
  const solvedToday = parseMetricTicketIdList(record.solvedToday);
  const firstResponse = parseMetricTicketIdList(record.firstResponse);
  const dueFollowUps = parseMetricTicketIdList(record.dueFollowUps);
  if (!assigned || !solvedToday || !firstResponse || !dueFollowUps)
    return undefined;
  const slaDue = parseMetricTicketIdList(record.slaDue);
  const resolution = parseMetricTicketIdList(record.resolution);
  return {
    assigned,
    solvedToday,
    firstResponse,
    dueFollowUps,
    ...(slaDue ? { slaDue } : {}),
    ...(resolution ? { resolution } : {}),
  };
}

export type PortalApproval = {
  id: string;
  ticket_id: string;
  approval_kind: string;
  reason: string;
  requested_at: string;
  required_approvals: number;
};

export type PortalDevice = Record<string, unknown>;

export type TicketWatcher = {
  userId: string;
  displayName: string | null;
  createdAt: string | null;
};

export type DepartmentTicket = {
  ticketNumber: string;
  title: string;
  statusLabel: string;
  createdAt: string;
  updatedAt: string;
};

export class NextDeskPortalError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "NextDeskPortalError";
    this.code = code;
  }
}

/**
 * No portal or workbench data is retained when the server cannot confirm the
 * requested boundary. Callers use this to hide the optional area quietly.
 */
export function isNextDeskPortalUnavailableError(error: unknown): boolean {
  return (
    error instanceof NextDeskPortalError &&
    [
      "agent_workbench_feature_disabled",
      "requester_portal_feature_disabled",
      "agent_workbench_not_configured",
      "requester_portal_not_configured",
      "requester_department_view_feature_disabled",
      "tenant_feature_lookup_failed",
      "authentication_required",
      "tenant_membership_required",
      "tenant_permission_required",
      "permission_denied",
      "agent_ticket_permission_required",
      "ticket_not_available",
      "watcher_not_found",
      "operation_failed",
      "invalid_response",
    ].includes(error.code)
  );
}

type AgentWorkbenchAction =
  | { type: "listMentions"; tenantId: string; onlyMine?: boolean }
  | { type: "markMentionRead"; tenantId: string; mentionId: string }
  | { type: "myMetrics"; tenantId: string };

type RequesterPortalAction =
  | { type: "activeIncidentNotices"; tenantId: string }
  | { type: "myDevices"; tenantId: string }
  | { type: "myApprovals"; tenantId: string }
  | { type: "listTicketWatchers"; tenantId: string; ticketId: string }
  | {
      type: "addTicketWatcher";
      tenantId: string;
      ticketId: string;
      watcherId: string;
    }
  | {
      type: "removeTicketWatcher";
      tenantId: string;
      ticketId: string;
      watcherId: string;
    }
  | { type: "getMyAvailability"; tenantId: string }
  | {
      type: "setMyAvailability";
      tenantId: string;
      availability: string | null;
    }
  | { type: "departmentTickets"; tenantId: string };

type AgentWorkbenchActionWithoutTenant =
  AgentWorkbenchAction extends infer Action
    ? Action extends { tenantId: string }
      ? Omit<Action, "tenantId">
      : never
    : never;

type RequesterPortalActionWithoutTenant =
  RequesterPortalAction extends infer Action
    ? Action extends { tenantId: string }
      ? Omit<Action, "tenantId">
      : never
    : never;

type ApiEnvelope<T> = { data: T };
type ApiErrorEnvelope = { error: { code?: unknown; message?: unknown } };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidResponse(): never {
  throw new NextDeskPortalError(
    "invalid_response",
    "Die Antwort von nextDesk ist unvollständig.",
  );
}

function parseErrorEnvelope(value: unknown): NextDeskPortalError | null {
  if (!isRecord(value) || !isRecord(value.error)) return null;
  const payload = value as ApiErrorEnvelope;
  if (typeof payload.error.code !== "string") return null;
  return new NextDeskPortalError(
    payload.error.code,
    typeof payload.error.message === "string" && payload.error.message.trim()
      ? payload.error.message
      : "Diese nextDesk-Zusatzfunktion ist derzeit nicht verfügbar.",
  );
}

async function errorFromInvoke(
  error: unknown,
): Promise<NextDeskPortalError | null> {
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

async function invokeTenantFunction<T>(
  functionName: "agent-workbench" | "requester-portal",
  action:
    | AgentWorkbenchActionWithoutTenant
    | RequesterPortalActionWithoutTenant,
): Promise<T> {
  // `loadCurrentTenant` resolves the authenticated person's selected, active
  // tenant. The Edge Function repeats membership and permission checks.
  const tenant = await loadCurrentTenant();
  const body = { ...action, tenantId: tenant.id };
  const { data, error } = await requireNextDesk().functions.invoke(
    functionName,
    {
      body,
    },
  );

  if (error) {
    const parsedError = await errorFromInvoke(error);
    if (parsedError) throw parsedError;
    throw new NextDeskPortalError(
      "operation_failed",
      "Die nextDesk-Zusatzfunktion konnte nicht erreicht werden.",
    );
  }

  const serverError = parseErrorEnvelope(data);
  if (serverError) throw serverError;
  if (!isRecord(data) || !("data" in data)) invalidResponse();
  return (data as ApiEnvelope<T>).data;
}

export async function listMyMentions(): Promise<{ mentions: AgentMention[] }> {
  return invokeTenantFunction("agent-workbench", {
    type: "listMentions",
    onlyMine: true,
  });
}

export async function markMentionRead(mentionId: string): Promise<{
  mention: Pick<AgentMention, "id" | "read_at">;
  changed: boolean;
}> {
  return invokeTenantFunction("agent-workbench", {
    type: "markMentionRead",
    mentionId,
  });
}

export async function getMyMetrics(): Promise<{ metrics: AgentMetrics }> {
  const result = await invokeTenantFunction<{
    metrics: AgentMetrics & { slaDue?: unknown; ticketIds?: unknown };
  }>("agent-workbench", { type: "myMetrics" });
  const { slaDue, ...metrics } = result.metrics;
  return {
    metrics: {
      ...metrics,
      ...(typeof slaDue === "number" && Number.isFinite(slaDue)
        ? { slaDue }
        : {}),
      ticketIds: parseMetricTicketIds(result.metrics.ticketIds),
    },
  };
}

export async function listActiveIncidentNotices(): Promise<{
  notices: PortalIncidentNotice[];
}> {
  return invokeTenantFunction("requester-portal", {
    type: "activeIncidentNotices",
  });
}

export async function listMyDevices(): Promise<{
  devices: PortalDevice[];
  available: boolean;
}> {
  return invokeTenantFunction("requester-portal", { type: "myDevices" });
}

export async function listMyApprovals(): Promise<{
  approvals: PortalApproval[];
}> {
  return invokeTenantFunction("requester-portal", { type: "myApprovals" });
}

export async function listTicketWatchers(ticketId: string): Promise<{
  watchers: TicketWatcher[];
}> {
  return invokeTenantFunction("requester-portal", {
    type: "listTicketWatchers",
    ticketId,
  });
}

export async function addTicketWatcher(
  ticketId: string,
  watcherId: string,
): Promise<{
  watcher: Pick<TicketWatcher, "userId" | "createdAt">;
}> {
  return invokeTenantFunction("requester-portal", {
    type: "addTicketWatcher",
    ticketId,
    watcherId,
  });
}

export async function removeTicketWatcher(
  ticketId: string,
  watcherId: string,
): Promise<{ removedWatcherId: string }> {
  return invokeTenantFunction("requester-portal", {
    type: "removeTicketWatcher",
    ticketId,
    watcherId,
  });
}

export async function getMyAvailability(): Promise<{
  availability: string | null;
}> {
  return invokeTenantFunction("requester-portal", {
    type: "getMyAvailability",
  });
}

export async function setMyAvailability(
  availability: string | null,
): Promise<{ availability: string | null }> {
  return invokeTenantFunction("requester-portal", {
    type: "setMyAvailability",
    availability,
  });
}

export async function listDepartmentTickets(): Promise<{
  tickets: DepartmentTicket[];
}> {
  return invokeTenantFunction("requester-portal", {
    type: "departmentTickets",
  });
}
