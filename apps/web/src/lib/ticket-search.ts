import type { DashboardTicket } from "../dashboard-data";

export type TicketSearchChip = {
  label: string;
  raw: string;
};

type TicketSearchFilters = {
  assignment: "mine" | "unassigned" | null;
  priority: string[];
  queue: string[];
  risk: DashboardTicket["risk"][];
  status: string[];
  ticketNumber: string[];
};

export type ParsedTicketSearch = {
  chips: TicketSearchChip[];
  filters: TicketSearchFilters;
  freeText: string[];
};

const EMPTY_FILTERS: TicketSearchFilters = {
  assignment: null,
  priority: [],
  queue: [],
  risk: [],
  status: [],
  ticketNumber: [],
};

function normalise(value: string): string {
  return value.trim().toLocaleLowerCase("de-CH");
}

function tokenize(query: string): string[] {
  return Array.from(query.matchAll(/"([^\"]+)"|(\S+)/g), (match) =>
    (match[1] ?? match[2] ?? "").trim(),
  ).filter(Boolean);
}

function filterLabel(key: string, value: string): string | null {
  const labels: Record<string, string> = {
    agent: "Zuweisung",
    assignment: "Zuweisung",
    nummer: "Ticket",
    nr: "Ticket",
    prioritaet: "Priorität",
    priority: "Priorität",
    prio: "Priorität",
    queue: "Queue",
    risiko: "SLA-Risiko",
    sla: "SLA-Risiko",
    status: "Status",
    team: "Queue",
    ticket: "Ticket",
    zuweisung: "Zuweisung",
  };
  return labels[key] ? `${labels[key]}: ${value}` : null;
}

function includes(value: string, search: string): boolean {
  return normalise(value).includes(normalise(search));
}

function matchesStatus(ticket: DashboardTicket, status: string): boolean {
  const value = normalise(status);
  if (["offen", "open"].includes(value)) return !ticket.isClosed;
  if (["geloest", "gelöst", "geschlossen", "closed"].includes(value)) {
    return ticket.isClosed;
  }
  return includes(ticket.state, value);
}

function matchesAssignment(
  ticket: DashboardTicket,
  assignment: TicketSearchFilters["assignment"],
): boolean {
  if (assignment === "mine") return ticket.assignedToCurrentUser;
  if (assignment === "unassigned") return ticket.isUnassigned;
  return true;
}

export function parseTicketSearch(query: string): ParsedTicketSearch {
  const filters: TicketSearchFilters = {
    ...EMPTY_FILTERS,
    priority: [],
    queue: [],
    risk: [],
    status: [],
    ticketNumber: [],
  };
  const chips: TicketSearchChip[] = [];
  const freeText: string[] = [];

  for (const raw of tokenize(query)) {
    const separator = raw.indexOf(":");
    if (separator <= 0 || separator === raw.length - 1) {
      freeText.push(raw);
      continue;
    }

    const key = normalise(raw.slice(0, separator));
    const value = normalise(raw.slice(separator + 1));
    const label = filterLabel(key, value);
    if (!label) {
      freeText.push(raw);
      continue;
    }

    if (["ticket", "nr", "nummer"].includes(key)) {
      filters.ticketNumber.push(value);
    } else if (["status"].includes(key)) {
      filters.status.push(value);
    } else if (["prio", "priority", "prioritaet"].includes(key)) {
      filters.priority.push(value);
    } else if (["queue", "team"].includes(key)) {
      filters.queue.push(value);
    } else if (["sla", "risiko"].includes(key)) {
      if (["ok", "warnung", "kritisch"].includes(value)) {
        filters.risk.push(value as DashboardTicket["risk"]);
      } else {
        freeText.push(raw);
        continue;
      }
    } else if (["agent", "assignment", "zuweisung"].includes(key)) {
      if (["ich", "mir", "mine", "me"].includes(value)) {
        filters.assignment = "mine";
      } else if (["unzugewiesen", "ohne", "none"].includes(value)) {
        filters.assignment = "unassigned";
      } else {
        freeText.push(raw);
        continue;
      }
    }
    chips.push({ label, raw });
  }

  return { chips, filters, freeText };
}

export function matchesTicketSearch(
  ticket: DashboardTicket,
  search: ParsedTicketSearch,
): boolean {
  const { filters } = search;
  if (
    filters.ticketNumber.some((value) => !includes(ticket.id, value)) ||
    filters.status.some((value) => !matchesStatus(ticket, value)) ||
    filters.priority.some((value) => !includes(ticket.priority ?? "", value)) ||
    filters.queue.some(
      (value) =>
        !includes(ticket.queue, value) && !includes(ticket.queueLabel, value),
    ) ||
    filters.risk.some((value) => ticket.risk !== value) ||
    !matchesAssignment(ticket, filters.assignment)
  ) {
    return false;
  }

  const haystack = [
    ticket.id,
    ticket.priority ?? "",
    ticket.queue,
    ticket.queueLabel,
    ticket.sla,
    ticket.state,
    ticket.subject,
  ].join(" ");
  return search.freeText.every((term) => includes(haystack, term));
}

export function removeTicketSearchClause(query: string, raw: string): string {
  const remaining = tokenize(query).filter((term) => term !== raw);
  return remaining.join(" ");
}
