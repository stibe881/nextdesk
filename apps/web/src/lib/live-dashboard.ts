import { supabase } from "./supabase";
import { parseTicketSearch } from "./ticket-search";
import type {
  DashboardMetrics,
  DashboardTicket,
  Period,
  ServiceHealth,
  TimelineItem,
} from "../dashboard-data";

const TICKET_PAGE_SIZE = 50;

export interface TenantOption {
  id: string;
  name: string;
  slug: string;
}

export type TicketAgentOption = {
  displayName: string;
  id: string;
};

export type TicketDepartmentOption = {
  id: string;
  key: string;
  label: string;
};

export type TicketFilterCatalog = {
  departments: TicketDepartmentOption[];
  priorities: string[];
  statuses: string[];
};

export type LiveTicketListRefinement = {
  agent: string;
  department: string;
  priority: string;
  sortBy: "updated" | "agent" | "status" | "department" | "priority";
  sortDirection: "asc" | "desc";
  status: string;
};

export type LiveTicketScope = "all" | "mine" | "unassigned" | "open" | "closed";

export type LiveTicketListControls = {
  metricTicketIds: string[] | null;
  query: string;
  queue: string;
  scope: LiveTicketScope;
};

export interface LiveDashboardSnapshot {
  activity: TimelineItem[];
  hasMoreTickets: boolean;
  metrics: DashboardMetrics;
  period: Period;
  serviceHealth: ServiceHealth[];
  ticketCount: number;
  ticketAgents: TicketAgentOption[];
  ticketFilterCatalog: TicketFilterCatalog;
  ticketListNote?: string;
  tenantId: string;
  tickets: DashboardTicket[];
  updatedAt: string;
}

interface TicketStatusRecord {
  id: string;
  is_closed: boolean;
  label: string;
  sort_order: number;
}

interface TicketPriorityRecord {
  id: string;
  label: string;
  sort_order: number;
}

interface DepartmentRecord {
  id: string;
  key: string;
  name: string;
}

interface TicketListRecord {
  assigned_agent_id: string | null;
  created_at: string;
  department_id: string;
  department_key: string;
  department_name: string;
  id: string;
  priority_id: string;
  priority_label: string;
  priority_sort_order: number;
  requester_id: string;
  resolution_due_at: string | null;
  status_id: string;
  status_is_closed: boolean;
  status_label: string;
  status_sort_order: number;
  subject: string;
  ticket_number: string;
  updated_at: string;
  matching_ticket_count: number;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function ticketListRpcArguments(
  tenantId: string,
  refinement: LiveTicketListRefinement | undefined,
  userId: string | undefined,
  statuses: TicketStatusRecord[],
  priorities: TicketPriorityRecord[],
  departments: DepartmentRecord[],
  ticketPage: number,
  controls: LiveTicketListControls | undefined,
  agentSortOrder: string[],
) {
  const emptyId = "00000000-0000-0000-0000-000000000000";
  const activeRefinement: LiveTicketListRefinement = refinement ?? {
    agent: "all",
    department: "all",
    priority: "all",
    sortBy: "updated",
    sortDirection: "desc",
    status: "all",
  };
  const activeControls: LiveTicketListControls = controls ?? {
    metricTicketIds: null,
    query: "",
    queue: "alle",
    scope: "all",
  };
  const search = parseTicketSearch(activeControls.query);
  const safeTerms = (values: string[], minimumLength = 1) =>
    values
      .map((value) => value.trim())
      .filter((value) => value.length >= minimumLength && value.length <= 120)
      .slice(0, 12);
  const idsForLabel = <Record extends { id: string; label: string }>(
    records: Record[],
    selectedLabel: string,
  ) =>
    selectedLabel === "all"
      ? null
      : records
          .filter((record) => record.label === selectedLabel)
          .map((record) => record.id);
  const statusIds = idsForLabel(statuses, activeRefinement.status);
  const priorityIds = idsForLabel(priorities, activeRefinement.priority);
  const departmentIds =
    activeRefinement.department === "all"
      ? null
      : departments
          .filter(
            (department) => department.key === activeRefinement.department,
          )
          .map((department) => department.id);
  const selectedAgentId =
    activeRefinement.agent === "mine"
      ? (userId ?? emptyId)
      : UUID_PATTERN.test(activeRefinement.agent)
        ? activeRefinement.agent
        : null;

  return {
    p_assigned_agent_id: selectedAgentId,
    p_agent_sort_order: agentSortOrder
      .filter((agentId) => UUID_PATTERN.test(agentId))
      .slice(0, 1000),
    p_department_ids: departmentIds,
    p_limit: TICKET_PAGE_SIZE + 1,
    p_metric_ticket_ids: activeControls.metricTicketIds
      ? activeControls.metricTicketIds
          .filter((ticketId) => UUID_PATTERN.test(ticketId))
          .slice(0, 500)
      : null,
    p_offset: ticketPage * TICKET_PAGE_SIZE,
    p_only_unassigned: activeRefinement.agent === "unassigned",
    p_priority_ids: priorityIds,
    p_queue_key: activeControls.queue === "alle" ? null : activeControls.queue,
    p_scope: activeControls.scope,
    p_search_assignment: search.filters.assignment,
    p_search_free_text: safeTerms(search.freeText, 2),
    p_search_priorities: safeTerms(search.filters.priority),
    p_search_queues: safeTerms(search.filters.queue),
    p_search_risks: search.filters.risk,
    p_search_statuses: safeTerms(search.filters.status),
    p_search_ticket_numbers: safeTerms(search.filters.ticketNumber),
    p_sort_by: activeRefinement.sortBy,
    p_sort_direction: activeRefinement.sortDirection,
    p_status_ids: statusIds,
    p_tenant_id: tenantId,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function ticketAgentsFromResponse(value: unknown): {
  agents: TicketAgentOption[];
  assignedAgentNames: Map<string, string>;
  departments: TicketDepartmentOption[];
} | null {
  if (!isRecord(value) || !isRecord(value.data)) return null;
  if (
    !Array.isArray(value.data.agents) ||
    !Array.isArray(value.data.departments) ||
    !isRecord(value.data.assignedAgentNames)
  ) {
    return null;
  }

  const agents: TicketAgentOption[] = [];
  for (const entry of value.data.agents) {
    if (
      !isRecord(entry) ||
      typeof entry.id !== "string" ||
      typeof entry.displayName !== "string" ||
      !UUID_PATTERN.test(entry.id) ||
      !entry.displayName.trim()
    ) {
      return null;
    }
    agents.push({ id: entry.id, displayName: entry.displayName.trim() });
  }

  const departments: TicketDepartmentOption[] = [];
  for (const entry of value.data.departments) {
    if (
      !isRecord(entry) ||
      typeof entry.id !== "string" ||
      typeof entry.key !== "string" ||
      typeof entry.label !== "string" ||
      !UUID_PATTERN.test(entry.id) ||
      !entry.key.trim() ||
      !entry.label.trim()
    ) {
      return null;
    }
    departments.push({
      id: entry.id,
      key: entry.key.trim(),
      label: entry.label.trim(),
    });
  }

  const assignedAgentNames = new Map<string, string>();
  for (const [id, displayName] of Object.entries(
    value.data.assignedAgentNames,
  )) {
    if (
      UUID_PATTERN.test(id) &&
      typeof displayName === "string" &&
      displayName.trim()
    ) {
      assignedAgentNames.set(id, displayName.trim());
    }
  }
  return { agents, assignedAgentNames, departments };
}

function requireSupabase() {
  if (!supabase) {
    throw new Error("Supabase ist nicht konfiguriert.");
  }
  return supabase;
}

export function isAssignedToCurrentUser(
  assignedAgentId: string | null,
  currentUserId: string | null | undefined,
): boolean {
  return typeof currentUserId === "string" && assignedAgentId === currentUserId;
}

function startDate(period: Period): string {
  const date = new Date();
  const days = period === "Heute" ? 1 : period === "7 Tage" ? 7 : 30;
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

function formatAge(timestamp: string): string {
  const elapsedMinutes = Math.max(
    0,
    Math.floor((Date.now() - Date.parse(timestamp)) / 60_000),
  );
  if (elapsedMinutes < 60) return `${elapsedMinutes} min`;
  const hours = Math.floor(elapsedMinutes / 60);
  if (hours < 24) return `${hours} h ${elapsedMinutes % 60}`;
  return `${Math.floor(hours / 24)} T`;
}

function formatDueAt(dueAt: string | null): {
  label: string;
  risk: DashboardTicket["risk"];
} {
  if (!dueAt) return { label: "kein SLA-Ziel", risk: "ok" };
  const difference = Date.parse(dueAt) - Date.now();
  if (difference <= 0) return { label: "SLA überfällig", risk: "kritisch" };
  const minutes = Math.ceil(difference / 60_000);
  const hours = Math.floor(minutes / 60);
  return {
    label: `SLA in ${hours > 0 ? `${hours} h ` : ""}${minutes % 60} min`,
    risk: minutes <= 60 ? "kritisch" : minutes <= 240 ? "warnung" : "ok",
  };
}

function normaliseEvent(eventType: string): string {
  const labels: Record<string, string> = {
    "ticket.created": "Ticket erstellt",
    "ticket.updated": "Ticket aktualisiert",
    "comment.external_added": "Externer Kommentar hinzugefügt",
    "comment.internal_added": "Interne Notiz hinzugefügt",
    "ticket.tag_added": "Einordnung aktualisiert",
    "ticket.tag_removed": "Einordnung aktualisiert",
    "ticket.category_changed": "Kategorie aktualisiert",
  };
  if (labels[eventType]) return labels[eventType];
  return eventType
    .replaceAll(/[._-]+/g, " ")
    .replace(/^./, (character) => character.toUpperCase());
}

export async function loadActiveTenants(): Promise<TenantOption[]> {
  const client = requireSupabase();
  const { data, error } = await client
    .from("tenant_memberships")
    .select("tenant_id, tenants(id, name, slug)")
    .eq("status", "active");

  if (error) throw error;

  return (data ?? [])
    .map((membership) => membership.tenants as unknown as TenantOption | null)
    .filter((tenant): tenant is TenantOption => Boolean(tenant))
    .sort((left, right) => left.name.localeCompare(right.name, "de-CH"));
}

export async function loadProfileName(): Promise<string | null> {
  const client = requireSupabase();
  const { data, error } = await client
    .from("user_profiles")
    .select("display_name")
    .maybeSingle();
  if (error) throw error;
  return data?.display_name?.trim() || null;
}

export async function loadLiveDashboard(
  tenant: TenantOption,
  period: Period,
  ticketPage = 0,
  ticketListRefinement?: LiveTicketListRefinement,
  ticketListControls?: LiveTicketListControls,
): Promise<LiveDashboardSnapshot> {
  const client = requireSupabase();
  const since = startDate(period);
  const {
    data: { user },
    error: userError,
  } = await client.auth.getUser();
  if (userError) throw userError;
  const [statusesResult, prioritiesResult] = await Promise.all([
    client
      .from("ticket_statuses")
      .select("id, label, is_closed, sort_order")
      .eq("tenant_id", tenant.id),
    client
      .from("ticket_priorities")
      .select("id, label, sort_order")
      .eq("tenant_id", tenant.id),
  ]);

  if (statusesResult.error) throw statusesResult.error;
  if (prioritiesResult.error) throw prioritiesResult.error;

  const statuses = (statusesResult.data ?? []) as TicketStatusRecord[];
  const priorities = (prioritiesResult.data ?? []) as TicketPriorityRecord[];
  let departments: DepartmentRecord[] = [];
  let ticketAgents: TicketAgentOption[] = [];
  const { data: agentDirectoryData, error: agentDirectoryError } =
    await client.functions.invoke("ticket-agent-assignment", {
      body: {
        includeAgents: true,
        ticketIds: [],
        tenantId: tenant.id,
        type: "listForTenant",
      },
    });
  if (!agentDirectoryError) {
    const directory = ticketAgentsFromResponse(agentDirectoryData);
    if (directory) {
      ticketAgents = directory.agents;
      departments = directory.departments.map((department) => ({
        id: department.id,
        key: department.key,
        name: department.label,
      }));
    }
  }
  const ticketsResult = await client.rpc(
    "list_authorized_ticket_list_page",
    ticketListRpcArguments(
      tenant.id,
      ticketListRefinement,
      user?.id,
      statuses,
      priorities,
      departments,
      ticketPage,
      ticketListControls,
      ticketAgents.map((agent) => agent.id),
    ),
  );
  if (ticketsResult.error) throw ticketsResult.error;

  const tickets = (ticketsResult.data ?? []) as TicketListRecord[];

  let assignedAgentNames = new Map<string, string>();
  const { data: agentNamesData, error: agentNamesError } =
    await client.functions.invoke("ticket-agent-assignment", {
      body: {
        includeAgents: false,
        ticketIds: tickets
          .slice(0, TICKET_PAGE_SIZE)
          .map((ticket) => ticket.id),
        tenantId: tenant.id,
        type: "listForTenant",
      },
    });
  if (!agentNamesError) {
    const directory = ticketAgentsFromResponse(agentNamesData);
    if (directory) assignedAgentNames = directory.assignedAgentNames;
  }

  const ticketRows = tickets.slice(0, TICKET_PAGE_SIZE).map((ticket) => {
    const due = formatDueAt(ticket.resolution_due_at);
    return {
      age: formatAge(ticket.created_at),
      assignedAgentId: ticket.assigned_agent_id,
      assignedAgentName:
        ticket.assigned_agent_id === null
          ? null
          : (assignedAgentNames.get(ticket.assigned_agent_id) ?? null),
      assignedToCurrentUser: isAssignedToCurrentUser(
        ticket.assigned_agent_id,
        user?.id,
      ),
      createdAt: ticket.created_at,
      id: ticket.ticket_number,
      recordId: ticket.id,
      isClosed: ticket.status_is_closed,
      isUnassigned: ticket.assigned_agent_id === null,
      priority: ticket.priority_label,
      priorityOrder: ticket.priority_sort_order,
      queue: ticket.department_key,
      queueLabel: ticket.department_name,
      risk: due.risk,
      sla: due.label,
      state: ticket.status_label,
      statusOrder: ticket.status_sort_order,
      subject: ticket.subject,
      updatedAt: ticket.updated_at,
    } satisfies DashboardTicket;
  });

  const closedStatusIds = statuses
    .filter((status) => status.is_closed)
    .map((status) => status.id);
  const [
    totalCountResult,
    closedCountResult,
    mineCountResult,
    unassignedCountResult,
    eventsResult,
  ] = await Promise.all([
    client
      .from("tickets")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenant.id),
    closedStatusIds.length > 0
      ? client
          .from("tickets")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenant.id)
          .in("status_id", closedStatusIds)
      : Promise.resolve({ count: 0, error: null }),
    user
      ? client
          .from("tickets")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenant.id)
          .eq("assigned_agent_id", user.id)
      : Promise.resolve({ count: 0, error: null }),
    client
      .from("tickets")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenant.id)
      .is("assigned_agent_id", null),
    client
      .from("ticket_events")
      .select("event_type, created_at")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(3),
  ]);

  if (totalCountResult.error) throw totalCountResult.error;
  if (closedCountResult.error) throw closedCountResult.error;
  if (mineCountResult.error) throw mineCountResult.error;
  if (unassignedCountResult.error) throw unassignedCountResult.error;
  if (eventsResult.error) throw eventsResult.error;

  const totalTicketCount = totalCountResult.count ?? 0;
  const closedCount = closedCountResult.count ?? 0;
  const mineCount = mineCountResult.count ?? 0;
  const unassignedCount = unassignedCountResult.count ?? 0;
  const matchingTicketCount = Number(tickets[0]?.matching_ticket_count ?? 0);
  const ticketListCount =
    Number.isSafeInteger(matchingTicketCount) && matchingTicketCount >= 0
      ? matchingTicketCount
      : 0;
  const openCount = Math.max(0, totalTicketCount - closedCount);
  const now = new Intl.DateTimeFormat("de-CH", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Zurich",
  }).format(new Date());
  const hasMoreTickets = tickets.length > TICKET_PAGE_SIZE;
  const ticketListNote =
    ticketListCount > ticketRows.length
      ? `Die Liste zeigt ${ticketRows.length} von ${ticketListCount} passenden Tickets.`
      : null;

  return {
    activity: (eventsResult.data ?? []).map((event) => ({
      text: normaliseEvent(event.event_type),
      time: new Intl.DateTimeFormat("de-CH", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Europe/Zurich",
      }).format(new Date(event.created_at)),
      tone: "neutral" as const,
    })),
    hasMoreTickets,
    metrics: {
      closed: String(closedCount),
      closedDetail: "im aktuellen Bestand",
      mine: String(mineCount),
      mineDetail: "mir zugewiesen",
      open: String(openCount),
      openDetail: "aktuell offen",
      unassigned: String(unassignedCount),
      unassignedDetail: "ohne Bearbeiter",
    },
    serviceHealth: [
      {
        availability: "aktiv",
        detail: tenant.slug,
        name: "Mandantenkontext",
        state: "stabil",
      },
      {
        availability: String(ticketListCount),
        detail: "Autorisierte Tickets",
        name: "Datenzugriff",
        state: "stabil",
      },
      {
        availability: period,
        detail: `Stand ${now}`,
        name: "Auswertungszeitraum",
        state: "stabil",
      },
    ],
    period,
    ...(ticketListNote ? { ticketListNote } : {}),
    tenantId: tenant.id,
    ticketCount: ticketListCount,
    ticketAgents,
    ticketFilterCatalog: {
      departments: departments
        .map((department) => ({
          id: department.id,
          key: department.key,
          label: department.name,
        }))
        .sort((left, right) => left.label.localeCompare(right.label, "de-CH")),
      priorities: priorities
        .slice()
        .sort((left, right) => left.sort_order - right.sort_order)
        .map((priority) => priority.label),
      statuses: statuses
        .slice()
        .sort((left, right) => left.sort_order - right.sort_order)
        .map((status) => status.label),
    },
    tickets: ticketRows,
    updatedAt: now,
  };
}
