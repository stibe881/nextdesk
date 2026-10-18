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

export type AgentMetrics = {
  open: number;
  solvedToday: number;
  medianFirstResponseMinutes: number | null;
  dueFollowUps: number;
};

export type PortalApproval = {
  id: string;
  ticket_id: string;
  approval_kind: string;
  reason: string;
  requested_at: string;
  required_approvals: number;
};

export type PortalDevice = Record<string, unknown>;

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
      "tenant_feature_lookup_failed",
      "authentication_required",
      "tenant_membership_required",
      "tenant_permission_required",
      "permission_denied",
      "agent_ticket_permission_required",
      "ticket_not_available",
      "operation_failed",
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
  | { type: "myApprovals"; tenantId: string };

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
  return invokeTenantFunction("agent-workbench", { type: "myMetrics" });
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
