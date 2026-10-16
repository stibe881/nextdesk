import { supabase } from "./supabase";
import type {
  DashboardMetrics,
  DashboardTicket,
  Period,
  ServiceHealth,
  TimelineItem,
} from "../dashboard-data";

export interface TenantOption {
  id: string;
  name: string;
  slug: string;
}

export interface LiveDashboardSnapshot {
  activity: TimelineItem[];
  metrics: DashboardMetrics;
  period: Period;
  serviceHealth: ServiceHealth[];
  ticketListNote?: string;
  tenantId: string;
  tickets: DashboardTicket[];
  updatedAt: string;
}

interface TicketStatusRecord {
  id: string;
  is_closed: boolean;
  label: string;
}

interface TicketPriorityRecord {
  id: string;
  label: string;
}

interface DepartmentRecord {
  id: string;
  key: string;
  name: string;
}

interface TicketRecord {
  assigned_agent_id: string | null;
  created_at: string;
  department_id: string;
  id: string;
  priority_id: string;
  requester_id: string;
  resolution_due_at: string | null;
  status_id: string;
  subject: string;
  ticket_number: string;
}

function requireSupabase() {
  if (!supabase) {
    throw new Error("Supabase ist nicht konfiguriert.");
  }
  return supabase;
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
): Promise<LiveDashboardSnapshot> {
  const client = requireSupabase();
  const since = startDate(period);
  const {
    data: { user },
    error: userError,
  } = await client.auth.getUser();
  if (userError) throw userError;
  const [ticketsResult, statusesResult, prioritiesResult, departmentsResult] =
    await Promise.all([
      client
        .from("tickets")
        .select(
          "id, ticket_number, subject, department_id, status_id, priority_id, resolution_due_at, created_at, assigned_agent_id, requester_id",
        )
        .eq("tenant_id", tenant.id)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(100),
      client
        .from("ticket_statuses")
        .select("id, label, is_closed")
        .eq("tenant_id", tenant.id),
      client
        .from("ticket_priorities")
        .select("id, label")
        .eq("tenant_id", tenant.id),
      client
        .from("departments")
        .select("id, key, name")
        .eq("tenant_id", tenant.id)
        .eq("active", true),
    ]);

  if (ticketsResult.error) throw ticketsResult.error;
  if (statusesResult.error) throw statusesResult.error;
  if (prioritiesResult.error) throw prioritiesResult.error;
  if (departmentsResult.error) throw departmentsResult.error;

  const tickets = (ticketsResult.data ?? []) as TicketRecord[];
  const statuses = (statusesResult.data ?? []) as TicketStatusRecord[];
  const priorities = (prioritiesResult.data ?? []) as TicketPriorityRecord[];
  const departments = (departmentsResult.data ?? []) as DepartmentRecord[];
  const statusById = new Map(statuses.map((status) => [status.id, status]));
  const priorityById = new Map(
    priorities.map((priority) => [priority.id, priority]),
  );
  const departmentById = new Map(
    departments.map((department) => [department.id, department]),
  );

  const ticketRows = tickets.map((ticket) => {
    const department = departmentById.get(ticket.department_id);
    const due = formatDueAt(ticket.resolution_due_at);
    return {
      age: formatAge(ticket.created_at),
      assignedToCurrentUser:
        Boolean(user) &&
        (ticket.assigned_agent_id === user?.id ||
          ticket.requester_id === user?.id),
      id: ticket.ticket_number,
      recordId: ticket.id,
      isClosed: Boolean(statusById.get(ticket.status_id)?.is_closed),
      isUnassigned: ticket.assigned_agent_id === null,
      priority: priorityById.get(ticket.priority_id)?.label ?? "Ohne Priorität",
      queue: department?.key ?? "unbekannt",
      queueLabel: department?.name ?? "Nicht zugeordnet",
      risk: due.risk,
      sla: due.label,
      state: statusById.get(ticket.status_id)?.label ?? "Status unbekannt",
      subject: ticket.subject,
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
      .eq("tenant_id", tenant.id)
      .gte("created_at", since),
    closedStatusIds.length > 0
      ? client
          .from("tickets")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenant.id)
          .gte("created_at", since)
          .in("status_id", closedStatusIds)
      : Promise.resolve({ count: 0, error: null }),
    user
      ? client
          .from("tickets")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenant.id)
          .gte("created_at", since)
          .or(`assigned_agent_id.eq.${user.id},requester_id.eq.${user.id}`)
      : Promise.resolve({ count: 0, error: null }),
    client
      .from("tickets")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenant.id)
      .gte("created_at", since)
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
  const openCount = Math.max(0, totalTicketCount - closedCount);
  const now = new Intl.DateTimeFormat("de-CH", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Zurich",
  }).format(new Date());
  const ticketListNote =
    totalTicketCount > ticketRows.length
      ? `Die Liste zeigt die neuesten ${ticketRows.length} von ${totalTicketCount} autorisierten Tickets.`
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
    metrics: {
      closed: String(closedCount),
      closedDetail: "im gewählten Zeitraum",
      mine: String(mineCount),
      mineDetail: "mir zugewiesen oder erstellt",
      open: String(openCount),
      openDetail: "RLS-autorisierte Tickets",
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
        availability: String(totalTicketCount),
        detail: "RLS-autorisierte Tickets",
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
    tickets: ticketRows,
    updatedAt: now,
  };
}
