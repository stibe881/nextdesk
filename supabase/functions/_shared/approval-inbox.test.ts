import { isApprovalInboxCandidate } from "./approval-inbox.ts";

const actorId = "00000000-0000-4000-8000-000000000001";
const otherUserId = "00000000-0000-4000-8000-000000000002";

Deno.test(
  "approval inbox excludes own, already decided and inaccessible requests",
  () => {
    const base = {
      approvalId: "00000000-0000-4000-8000-000000000010",
      canDecide: true,
      canReadTicket: true,
      decisionApproverIds: [] as string[],
      requestedBy: otherUserId,
      status: "pending",
    };

    if (!isApprovalInboxCandidate({ actorId, candidate: base })) {
      throw new Error("Expected an actionable foreign request in the inbox.");
    }
    if (
      isApprovalInboxCandidate({
        actorId,
        candidate: { ...base, requestedBy: actorId },
      })
    ) {
      throw new Error("Own requests must never appear in the decision inbox.");
    }
    if (
      isApprovalInboxCandidate({
        actorId,
        candidate: { ...base, decisionApproverIds: [actorId] },
      })
    ) {
      throw new Error("Requests already decided by the actor must be omitted.");
    }
    if (
      isApprovalInboxCandidate({
        actorId,
        candidate: { ...base, canDecide: false },
      })
    ) {
      throw new Error(
        "Requests without a current server permission must be omitted.",
      );
    }
    if (
      isApprovalInboxCandidate({
        actorId,
        candidate: { ...base, canReadTicket: false },
      })
    ) {
      throw new Error("Requests without ticket visibility must be omitted.");
    }
  },
);
