// «Phishing» in the app: calls to the security-cases edge function. Parsing
// and labels are shared with the web app (security-cases-model.ts).
import {
  parseSecurityDetail,
  parseSecurityList,
  type SecurityCaseDetail,
  type SecurityCaseSummary,
  type SecurityStateFilter,
  type SecurityStats,
  type SecurityVerdict,
} from "@/lib/security-cases-model";
import { invokeNextDesk } from "@/lib/nextdesk-client";

export * from "@/lib/security-cases-model";

export async function listSecurityCases(
  tenantId: string,
  state: SecurityStateFilter,
): Promise<{ cases: SecurityCaseSummary[]; stats: SecurityStats }> {
  const parsed = parseSecurityList(
    await invokeNextDesk<unknown>("security-cases", {
      type: "list",
      tenantId,
      state,
    }),
  );
  if (!parsed)
    throw new Error("Die Phishing-Fälle konnten nicht gelesen werden.");
  return parsed;
}

async function detailCall(
  body: Record<string, unknown>,
): Promise<{ detail: SecurityCaseDetail; data: Record<string, unknown> }> {
  const value = await invokeNextDesk<unknown>("security-cases", body);
  const detail = parseSecurityDetail(value);
  if (!detail) throw new Error("Der Fall konnte nicht gelesen werden.");
  const data =
    value && typeof value === "object" && "data" in value
      ? ((value as { data?: Record<string, unknown> }).data ?? {})
      : {};
  return { detail, data };
}

export const loadSecurityCase = (tenantId: string, ticketId: string) =>
  detailCall({ type: "get", tenantId, ticketId });

export const setSecurityVerdict = (
  tenantId: string,
  ticketId: string,
  verdict: SecurityVerdict,
) => detailCall({ type: "setVerdict", tenantId, ticketId, verdict });

export const toggleSecurityAction = (
  tenantId: string,
  ticketId: string,
  actionId: string,
  done: boolean,
) => detailCall({ type: "toggleAction", tenantId, ticketId, actionId, done });

export const askReportersClicked = (tenantId: string, ticketId: string) =>
  detailCall({ type: "askClicked", tenantId, ticketId });

export const closeSecurityCase = (tenantId: string, ticketId: string) =>
  detailCall({ type: "close", tenantId, ticketId });

/** Agents who may work on the case (team rules of the ticket apply). */
export async function listCaseAgents(
  tenantId: string,
  ticketId: string,
): Promise<{ id: string; name: string }[]> {
  const value = await invokeNextDesk<{ data?: { agents?: unknown } }>(
    "ticket-agent-assignment",
    { type: "list", tenantId, ticketId },
  );
  const rows = value?.data?.agents;
  return Array.isArray(rows)
    ? rows.flatMap((row) => {
        if (!row || typeof row !== "object") return [];
        const entry = row as { id?: unknown; displayName?: unknown };
        return typeof entry.id === "string"
          ? [
              {
                id: entry.id,
                name:
                  typeof entry.displayName === "string"
                    ? entry.displayName
                    : "Agent",
              },
            ]
          : [];
      })
    : [];
}

export async function assignSecurityCase(
  tenantId: string,
  ticketId: string,
  agentId: string | null,
): Promise<void> {
  await invokeNextDesk("ticket-agent-assignment", {
    type: "assign",
    tenantId,
    ticketId,
    assignedAgentId: agentId,
  });
}
