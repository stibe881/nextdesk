import { requireTicketWorkspaceAccess } from "./index.ts";

const TENANT_ID = "10000000-0000-4000-8000-000000000001";

type AccessError = Error & { code?: string; status?: number };

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function callerClientFor(
  result: boolean | null,
  error: unknown = null,
): Parameters<typeof requireTicketWorkspaceAccess>[0] {
  return {
    rpc: async (name: string, args: Record<string, unknown>) => {
      assert(
        name === "can_work_tickets_in_tenant",
        "Follow-up access must use the common ticket-work RPC.",
      );
      assert(
        args.p_tenant_id === TENANT_ID,
        "Follow-up access must pass the requested tenant to the common RPC.",
      );
      return { data: result, error };
    },
  } as Parameters<typeof requireTicketWorkspaceAccess>[0];
}

async function expectAccessError(
  client: Parameters<typeof requireTicketWorkspaceAccess>[0],
  status: number,
  code: string,
): Promise<void> {
  try {
    await requireTicketWorkspaceAccess(client, TENANT_ID);
    throw new Error("Expected the ticket-work authorization check to fail.");
  } catch (error) {
    const accessError = error as AccessError;
    assert(
      accessError.status === status && accessError.code === code,
      `Expected ${status}/${code}, received ${accessError.status}/${accessError.code}.`,
    );
  }
}

Deno.test(
  "experience hub permits follow-up actions for verified ticket agents",
  async () => {
    await requireTicketWorkspaceAccess(callerClientFor(true), TENANT_ID);
  },
);

Deno.test(
  "experience hub rejects a requester without ticket work access",
  async () => {
    await expectAccessError(
      callerClientFor(false),
      403,
      "ticket_workspace_access_required",
    );
  },
);

Deno.test(
  "experience hub fails closed when ticket work access cannot be verified",
  async () => {
    await expectAccessError(
      callerClientFor(null, { code: "rpc_unavailable" }),
      503,
      "authorization_check_failed",
    );
  },
);

Deno.test(
  "experience hub gates every follow-up action before its handler",
  async () => {
    const source = await Deno.readTextFile(
      new URL("./index.ts", import.meta.url),
    );
    const guard =
      "await requireTicketWorkspaceAccess(client, action.tenantId);";
    const guardIndex = source.indexOf(guard);
    assert(
      guardIndex >= 0,
      "Follow-up actions must call the ticket-work guard.",
    );
    for (const actionType of [
      'action.type === "listFollowUps"',
      'action.type === "saveFollowUp"',
      'action.type === "resolveFollowUp"',
    ]) {
      const actionIndex = source.indexOf(actionType, guardIndex - 280);
      assert(
        actionIndex >= 0 && actionIndex < guardIndex,
        `${actionType} must be included in the central ticket-work guard.`,
      );
    }
    for (const handlerCall of [
      "return await listFollowUps(",
      "return await saveFollowUp(",
      "return await resolveFollowUp(",
    ]) {
      assert(
        source.indexOf(handlerCall) > guardIndex,
        `${handlerCall} must only run after the ticket-work guard.`,
      );
    }
  },
);
