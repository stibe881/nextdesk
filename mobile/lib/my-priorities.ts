import { invokeNextDesk } from "@/lib/nextdesk-client";

export type PriorityItem = {
  position: number;
  id: string;
  ticketNumber: string;
  subject: string;
  statusLabel: string;
  priorityLabel: string;
  resolutionDueAt: string | null;
  reason: string | null;
  aiRank: number | null;
  manual: boolean;
};

export type PriorityList = {
  rankedAt: string | null;
  source: "ai" | "rules" | null;
  hasManualOrder: boolean;
  tickets: PriorityItem[];
};

async function call(body: Record<string, unknown>): Promise<PriorityList> {
  const response = await invokeNextDesk<{ data?: PriorityList }>(
    "my-priorities",
    body,
  );
  if (!response?.data || !Array.isArray(response.data.tickets)) {
    throw new Error("Die Prioritäten sind unvollständig.");
  }
  return response.data;
}

export const loadMyPriorities = (tenantId: string) =>
  call({ type: "list", tenantId });

export const refreshMyPriorities = (tenantId: string) =>
  call({ type: "refresh", tenantId, resetManual: false });

export const resetMyPriorities = (tenantId: string) =>
  call({ type: "resetManual", tenantId });

export const reorderMyPriorities = (tenantId: string, ticketIds: string[]) =>
  call({ type: "reorder", tenantId, ticketIds });

/** Moves one ticket up (-1) or down (+1) and returns the new id order. */
export function movedOrder(
  ids: readonly string[],
  id: string,
  direction: -1 | 1,
): string[] | null {
  const next = [...ids];
  const index = next.indexOf(id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= next.length) return null;
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}
