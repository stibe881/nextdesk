export type ApprovalInboxCandidate = {
  approvalId: string;
  canDecide: boolean;
  canReadTicket: boolean;
  decisionApproverIds: readonly string[];
  requestedBy: string;
  status: string;
};

/**
 * The surrounding endpoint derives access booleans from current server-side
 * membership, ticket visibility and department permissions. This helper merely
 * keeps the final data-minimising inclusion rule auditable and testable.
 */
export function isApprovalInboxCandidate(input: {
  actorId: string;
  candidate: ApprovalInboxCandidate;
}): boolean {
  const actorId = input.actorId.toLowerCase();
  const candidate = input.candidate;
  if (candidate.status !== "pending") return false;
  if (!candidate.canReadTicket || !candidate.canDecide) return false;
  if (candidate.requestedBy.toLowerCase() === actorId) return false;
  return !candidate.decisionApproverIds.some(
    (approverId) => approverId.toLowerCase() === actorId,
  );
}
