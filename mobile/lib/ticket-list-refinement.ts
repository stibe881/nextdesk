/** Erweiterte Filter und Sortierung der Ticketliste, wie im Web (Agent, Abteilung, Priorität, Sortierung). */

export type TicketSortBy =
  | "updated"
  | "agent"
  | "status"
  | "department"
  | "priority";
export type TicketSortDirection = "asc" | "desc";

export type TicketRefinement = {
  /** "all", "mine", "unassigned" oder die ID einer Agentin bzw. eines Agenten. */
  agent: string;
  /** "all" oder die ID der Abteilung. */
  department: string;
  /** "all" oder das Label der Priorität. */
  priority: string;
  sortBy: TicketSortBy;
  sortDirection: TicketSortDirection;
};

export const DEFAULT_REFINEMENT: TicketRefinement = {
  agent: "all",
  department: "all",
  priority: "all",
  sortBy: "updated",
  sortDirection: "desc",
};

export const SORT_OPTIONS: { key: TicketSortBy; label: string }[] = [
  { key: "updated", label: "Letzte Änderung" },
  { key: "agent", label: "Agent" },
  { key: "status", label: "Status" },
  { key: "department", label: "Abteilung" },
  { key: "priority", label: "Priorität" },
];

export type RefinableTicket = {
  assignedAgentId?: string | null;
  departmentId?: string | null;
  priority: string;
  priorityRank?: number | null;
  status: string;
};

export function activeRefinementCount(refinement: TicketRefinement): number {
  return [
    refinement.agent !== "all",
    refinement.department !== "all",
    refinement.priority !== "all",
    refinement.sortBy !== "updated",
    refinement.sortDirection !== "desc",
  ].filter(Boolean).length;
}

export function matchesRefinement(
  ticket: RefinableTicket,
  refinement: TicketRefinement,
  currentUserId: string | null,
): boolean {
  const { agent, department, priority } = refinement;
  if (agent === "mine") {
    if (!currentUserId || ticket.assignedAgentId !== currentUserId) return false;
  } else if (agent === "unassigned") {
    if (ticket.assignedAgentId) return false;
  } else if (agent !== "all" && ticket.assignedAgentId !== agent) {
    return false;
  }
  if (department !== "all" && ticket.departmentId !== department) return false;
  if (priority !== "all" && ticket.priority !== priority) return false;
  return true;
}

const collator = new Intl.Collator("de-CH", { sensitivity: "base" });

/**
 * Sortiert eine Kopie der Liste. Die Eingabe ist nach «Letzte Änderung»
 * absteigend geordnet (wie vom Server geliefert); gleiche Werte behalten
 * diese Reihenfolge.
 */
export function sortTickets<T extends RefinableTicket>(
  tickets: readonly T[],
  refinement: TicketRefinement,
  labels: {
    agentName: (agentId: string | null | undefined) => string;
    departmentName: (departmentId: string | null | undefined) => string;
  },
): T[] {
  const indexed = tickets.map((ticket, index) => ({ ticket, index }));
  const direction = refinement.sortDirection === "asc" ? 1 : -1;
  const compare = (
    left: { ticket: T; index: number },
    right: { ticket: T; index: number },
  ): number => {
    switch (refinement.sortBy) {
      case "agent":
        return collator.compare(
          labels.agentName(left.ticket.assignedAgentId),
          labels.agentName(right.ticket.assignedAgentId),
        );
      case "status":
        return collator.compare(left.ticket.status, right.ticket.status);
      case "department":
        return collator.compare(
          labels.departmentName(left.ticket.departmentId),
          labels.departmentName(right.ticket.departmentId),
        );
      case "priority": {
        const l = left.ticket.priorityRank ?? Number.MAX_SAFE_INTEGER;
        const r = right.ticket.priorityRank ?? Number.MAX_SAFE_INTEGER;
        return l - r || collator.compare(left.ticket.priority, right.ticket.priority);
      }
      default:
        // «Letzte Änderung»: Eingabe ist neueste zuerst.
        return left.index - right.index;
    }
  };
  if (refinement.sortBy === "updated") {
    const sorted = [...indexed].sort(compare);
    return (refinement.sortDirection === "desc" ? sorted : sorted.reverse()).map(
      (entry) => entry.ticket,
    );
  }
  return indexed
    .sort((left, right) => direction * compare(left, right) || left.index - right.index)
    .map((entry) => entry.ticket);
}
