import { loadCurrentTenant, requireNextDesk } from "@/lib/nextdesk-client";

export type InboxApproval = {
  approvalId: string;
  approvalKind: string;
  approvedDecisions: number;
  reason: string;
  requestedAt: string;
  requiredApprovals: number;
  ticketId: string;
  ticketNumber: string;
  ticketSubject: string;
};

export type ApprovalDecision = "approved" | "rejected";

export class ApprovalError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ApprovalError";
    this.code = code;
  }
}

const ERROR_MESSAGES: Record<string, string> = {
  ticket_approval_decision_denied:
    "Du hast keine Berechtigung, diese Freigabe zu entscheiden.",
  ticket_approval_decision_failed:
    "Die Freigabe wurde bereits entschieden oder ist nicht mehr offen.",
  ticket_access_denied: "Dieses Ticket ist für dich nicht verfügbar.",
  ticket_feature_disabled:
    "Die Freigaben sind für diesen Mandanten nicht aktiv.",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function errorFrom(error: unknown): Promise<ApprovalError> {
  const context =
    isRecord(error) && "context" in error ? error.context : undefined;
  if (context instanceof Response) {
    const payload: unknown = await context
      .clone()
      .json()
      .catch(() => null);
    const code =
      isRecord(payload) &&
      isRecord(payload.error) &&
      typeof payload.error.code === "string"
        ? payload.error.code
        : null;
    if (code) {
      return new ApprovalError(
        code,
        ERROR_MESSAGES[code] ?? "Die Freigabe konnte nicht verarbeitet werden.",
      );
    }
  }
  return new ApprovalError(
    "operation_failed",
    "Die Freigaben konnten nicht erreicht werden.",
  );
}

async function invokeApprovals(
  action: Record<string, unknown>,
): Promise<unknown> {
  const tenant = await loadCurrentTenant();
  const { data, error } = await requireNextDesk().functions.invoke(
    "ticket-approvals",
    { body: { ...action, tenantId: tenant.id } },
  );
  if (error) throw await errorFrom(error);
  if (!isRecord(data) || !("data" in data)) {
    throw new ApprovalError(
      "invalid_response",
      "Die Antwort der Freigaben ist unvollständig.",
    );
  }
  return data.data;
}

/** Freigaben, die auf eine Entscheidung der angemeldeten Person warten. */
export async function listApprovalInbox(): Promise<InboxApproval[]> {
  const data = await invokeApprovals({ type: "listInbox" });
  if (!isRecord(data) || !Array.isArray(data.approvals)) {
    throw new ApprovalError(
      "invalid_response",
      "Die Antwort der Freigaben ist unvollständig.",
    );
  }
  const result: InboxApproval[] = [];
  for (const entry of data.approvals) {
    if (
      !isRecord(entry) ||
      !isRecord(entry.ticket) ||
      !isRecord(entry.approval)
    )
      continue;
    const { ticket, approval } = entry;
    if (
      typeof ticket.id !== "string" ||
      typeof approval.id !== "string" ||
      typeof approval.approvalKind !== "string" ||
      typeof approval.reason !== "string" ||
      typeof approval.requestedAt !== "string"
    )
      continue;
    result.push({
      approvalId: approval.id,
      approvalKind: approval.approvalKind,
      approvedDecisions:
        typeof approval.approvedDecisions === "number"
          ? approval.approvedDecisions
          : 0,
      reason: approval.reason,
      requestedAt: approval.requestedAt,
      requiredApprovals:
        typeof approval.requiredApprovals === "number"
          ? approval.requiredApprovals
          : 1,
      ticketId: ticket.id,
      ticketNumber: typeof ticket.number === "string" ? ticket.number : "",
      ticketSubject: typeof ticket.subject === "string" ? ticket.subject : "",
    });
  }
  return result;
}

export async function decideApproval(input: {
  approvalId: string;
  comment?: string;
  decision: ApprovalDecision;
  ticketId: string;
}): Promise<void> {
  await invokeApprovals({
    type: "decide",
    ticketId: input.ticketId,
    approvalId: input.approvalId,
    decision: input.decision,
    ...(input.comment ? { comment: input.comment } : {}),
  });
}
