import { withSupabase } from "@supabase/server";
import { resolveTenantFeatureStates } from "../_shared/tenant-features.ts";

type Period = "7d" | "30d" | "90d" | "custom";
type Action = {
  type: "getReport";
  tenantId: string;
  period: Period;
  startsOn?: string;
  endsOn?: string;
};
type PeriodRange = {
  key: Period;
  startsAt: string;
  endsAt: string;
};
type DatabaseError = {
  code?: unknown;
  message?: unknown;
  details?: unknown;
} | null;
type QueryResult<T> =
  { data: T[]; error: null } | { data: null; error: DatabaseError };

type TicketRow = {
  id: string;
  assigned_team_id: string | null;
  created_at: string;
  first_responded_at: string | null;
  resolved_at: string | null;
  status: unknown;
  priority: unknown;
  department: unknown;
};
type TeamScopedTicketRow = { assigned_team_id?: unknown };
type TimeEntryRow = {
  created_at: string;
  minutes: number;
  billing_kind: string;
  tickets?: TeamScopedTicketRow | TeamScopedTicketRow[] | null;
};
type SatisfactionRow = {
  submitted_at: string;
  score: number | null;
  tickets?: TeamScopedTicketRow | TeamScopedTicketRow[] | null;
};
type EscalationRow = {
  opened_at: string;
  resolved_at: string | null;
  tickets?: TeamScopedTicketRow | TeamScopedTicketRow[] | null;
};
type TicketStatus = { key?: unknown; label?: unknown; is_closed?: unknown };
type TicketPriority = { key?: unknown; label?: unknown };
type Department = { id?: unknown; name?: unknown };

const ALLOWED_ORIGIN = "https://app.nextdesk.ch";
const PAGE_SIZE = 1_000;
const MAX_REPORT_ROWS = 100_000;
const PERIOD_DAYS: Record<Exclude<Period, "custom">, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};
const MAX_CUSTOM_PERIOD_DAYS = 366;
const DAY_MS = 24 * 60 * 60 * 1_000;
const DATE_INPUT = /^(\d{4})-(\d{2})-(\d{2})$/;

function response(
  request: Request,
  body: Record<string, unknown>,
  status = 200,
): Response {
  const origin = request.headers.get("origin");
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers":
      "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json; charset=utf-8",
    Vary: "Origin",
  };
  if (origin === ALLOWED_ORIGIN) {
    headers["Access-Control-Allow-Origin"] = ALLOWED_ORIGIN;
  }

  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function isPeriod(value: unknown): value is Period {
  return (
    value === "7d" || value === "30d" || value === "90d" || value === "custom"
  );
}

function isDateInput(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = DATE_INPUT.exec(value);
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

function swissDateInput(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Zurich",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (kind: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === kind)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function swissDateTimeAsUtc(dateInput: string, endOfDay: boolean): Date | null {
  const match = DATE_INPUT.exec(dateInput);
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const hour = endOfDay ? 23 : 0;
  const minute = endOfDay ? 59 : 0;
  const second = endOfDay ? 59 : 0;
  const millisecond = endOfDay ? 999 : 0;
  const nominalUtc = Date.UTC(
    year,
    month - 1,
    day,
    hour,
    minute,
    second,
    millisecond,
  );
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Zurich",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(nominalUtc));
  const value = (kind: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === kind)?.value);
  const offset =
    Date.UTC(
      value("year"),
      value("month") - 1,
      value("day"),
      value("hour"),
      value("minute"),
      value("second"),
      millisecond,
    ) - nominalUtc;
  const result = new Date(nominalUtc - offset);
  return Number.isFinite(result.getTime()) ? result : null;
}

function shiftDateInput(dateInput: string, days: number): string | null {
  const match = DATE_INPUT.exec(dateInput);
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function customPeriodRange(
  startsOn: string,
  endsOn: string,
): {
  current: PeriodRange;
  previous: PeriodRange;
} | null {
  const start = swissDateTimeAsUtc(startsOn, false);
  const requestedEnd = swissDateTimeAsUtc(endsOn, true);
  const now = new Date();
  if (
    !start ||
    !requestedEnd ||
    startsOn > endsOn ||
    startsOn > swissDateInput(now) ||
    endsOn > swissDateInput(now)
  ) {
    return null;
  }

  const currentEnd = requestedEnd > now ? now : requestedEnd;
  const calendarDays =
    (Date.UTC(
      Number(endsOn.slice(0, 4)),
      Number(endsOn.slice(5, 7)) - 1,
      Number(endsOn.slice(8, 10)),
    ) -
      Date.UTC(
        Number(startsOn.slice(0, 4)),
        Number(startsOn.slice(5, 7)) - 1,
        Number(startsOn.slice(8, 10)),
      )) /
      DAY_MS +
    1;
  if (
    currentEnd < start ||
    calendarDays < 1 ||
    calendarDays > MAX_CUSTOM_PERIOD_DAYS
  ) {
    return null;
  }
  const previousStartsOn = shiftDateInput(startsOn, -calendarDays);
  const previousEndsOn = shiftDateInput(startsOn, -1);
  const previousStart = previousStartsOn
    ? swissDateTimeAsUtc(previousStartsOn, false)
    : null;
  const previousEnd = previousEndsOn
    ? swissDateTimeAsUtc(previousEndsOn, true)
    : null;
  if (!previousStart || !previousEnd) return null;
  return {
    current: {
      key: "custom",
      startsAt: start.toISOString(),
      endsAt: currentEnd.toISOString(),
    },
    previous: {
      key: "custom",
      startsAt: previousStart.toISOString(),
      endsAt: previousEnd.toISOString(),
    },
  };
}

function periodRanges(
  action: Action,
): { current: PeriodRange; previous: PeriodRange } | null {
  if (action.period === "custom") {
    return action.startsOn && action.endsOn
      ? customPeriodRange(action.startsOn, action.endsOn)
      : null;
  }

  const endsAt = new Date();
  const startsAt = new Date(
    endsAt.getTime() - PERIOD_DAYS[action.period] * DAY_MS,
  );
  const previousStartsAt = new Date(
    startsAt.getTime() - PERIOD_DAYS[action.period] * DAY_MS,
  );
  const previousEndsAt = new Date(startsAt.getTime() - 1);
  return {
    current: {
      key: action.period,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
    },
    previous: {
      key: action.period,
      startsAt: previousStartsAt.toISOString(),
      endsAt: previousEndsAt.toISOString(),
    },
  };
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function parseAction(value: unknown): Action | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["type", "tenantId", "period", "startsOn", "endsOn"]) ||
    value.type !== "getReport" ||
    !isUuid(value.tenantId) ||
    !isPeriod(value.period)
  ) {
    return null;
  }

  if (value.period === "custom") {
    if (!isDateInput(value.startsOn) || !isDateInput(value.endsOn)) return null;
    return {
      type: value.type,
      tenantId: value.tenantId,
      period: value.period,
      startsOn: value.startsOn,
      endsOn: value.endsOn,
    };
  }
  if (value.startsOn !== undefined || value.endsOn !== undefined) return null;
  return { type: value.type, tenantId: value.tenantId, period: value.period };
}

function one<T>(value: unknown): T | null {
  if (Array.isArray(value)) return (value[0] as T | undefined) ?? null;
  return isRecord(value) ? (value as T) : null;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  const total = values.reduce((sum, value) => sum + value, 0);
  return Math.round((total / values.length) * 100) / 100;
}

function elapsedMinutes(start: unknown, end: unknown): number | null {
  if (typeof start !== "string" || typeof end !== "string") return null;
  const elapsed = Date.parse(end) - Date.parse(start);
  if (!Number.isFinite(elapsed) || elapsed < 0) return null;
  return elapsed / 60_000;
}

function isSchemaOrRlsError(error: DatabaseError): boolean {
  const code = typeof error?.code === "string" ? error.code : "";
  const text = [error?.message, error?.details]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
  return (
    code === "42P01" ||
    code === "42501" ||
    code === "PGRST204" ||
    code === "PGRST205" ||
    text.includes("does not exist") ||
    text.includes("permission denied") ||
    text.includes("row-level security") ||
    text.includes("rls")
  );
}

function reportingError(request: Request, error: DatabaseError): Response {
  if (isSchemaOrRlsError(error)) {
    return response(
      request,
      {
        error: {
          code: "reporting_schema_or_rls_unavailable",
          message:
            "Die erforderlichen Reporting-Tabellen fehlen oder der Datenzugriff wird durch RLS bzw. Datenbankberechtigungen verhindert.",
        },
      },
      503,
    );
  }

  return response(
    request,
    {
      error: {
        code: "reporting_query_failed",
        message:
          "Die Reporting-Daten konnten nicht vollständig gelesen werden.",
      },
    },
    500,
  );
}

async function activeMembership(
  admin: any,
  userId: string,
  tenantId: string,
): Promise<boolean | null> {
  const { data, error } = await admin
    .from("tenant_memberships")
    .select("tenant_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  if (error) return null;
  return Boolean(data);
}

async function hasTenantReportPermission(
  admin: any,
  userId: string,
  tenantId: string,
): Promise<boolean | null> {
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("user_role_assignments")
    .select(
      "department_id, roles!user_role_assignments_role_tenant_fk!inner(active, scope, role_permissions!inner(permission_code))",
    )
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .lte("starts_at", now)
    .or(`expires_at.is.null,expires_at.gt.${now}`);
  if (error) return null;

  return (data ?? []).some((assignment: any) => {
    const role = one<{
      active?: unknown;
      scope?: unknown;
      role_permissions?: Array<{ permission_code?: unknown }>;
    }>(assignment.roles);
    return (
      assignment.department_id === null &&
      role?.active === true &&
      role.scope === "tenant" &&
      Array.isArray(role.role_permissions) &&
      role.role_permissions.some(
        (permission) => permission.permission_code === "report.read",
      )
    );
  });
}

async function fetchAll<T>(
  page: (
    from: number,
    to: number,
  ) => PromiseLike<{
    data: T[] | null;
    error: DatabaseError;
  }>,
): Promise<QueryResult<T>> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) return { data: null, error };
    const pageRows = data ?? [];
    rows.push(...pageRows);
    if (rows.length > MAX_REPORT_ROWS) {
      return {
        data: null,
        error: { code: "reporting_result_limit_exceeded" },
      };
    }
    if (pageRows.length < PAGE_SIZE) return { data: rows, error: null };
  }
}

const handler = withSupabase({ auth: "user" }, async (request, context) => {
  if (request.method !== "POST") {
    return response(request, { error: { code: "method_not_allowed" } }, 405);
  }

  const action = parseAction(await request.json().catch(() => null));
  const actorId = context.userClaims?.id;
  if (!action || typeof actorId !== "string") {
    return response(request, { error: { code: "invalid_request" } }, 400);
  }

  const membership = await activeMembership(
    context.supabaseAdmin,
    actorId,
    action.tenantId,
  );
  if (membership === null) {
    return response(
      request,
      { error: { code: "membership_validation_failed" } },
      503,
    );
  }
  if (!membership) {
    return response(
      request,
      { error: { code: "active_tenant_membership_required" } },
      403,
    );
  }

  const featureStates = await resolveTenantFeatureStates(
    context.supabaseAdmin,
    action.tenantId,
    ["reporting.service"],
  );
  if (featureStates === null) {
    return response(
      request,
      { error: { code: "tenant_feature_lookup_failed" } },
      503,
    );
  }
  if (featureStates["reporting.service"] !== true) {
    return response(
      request,
      { error: { code: "reporting_feature_disabled" } },
      403,
    );
  }

  const permitted = await hasTenantReportPermission(
    context.supabaseAdmin,
    actorId,
    action.tenantId,
  );
  if (permitted === null) {
    return response(
      request,
      { error: { code: "report_permission_validation_failed" } },
      503,
    );
  }
  if (!permitted) {
    return response(
      request,
      { error: { code: "report_read_permission_required" } },
      403,
    );
  }

  const ranges = periodRanges(action);
  if (!ranges) {
    return response(request, { error: { code: "invalid_request" } }, 400);
  }
  const since = ranges.previous.startsAt;
  const until = ranges.current.endsAt;

  const [
    ticketsResult,
    timeEntriesResult,
    satisfactionResult,
    escalationsResult,
    teamMembershipsResult,
    departmentMembershipsResult,
  ] = await Promise.all([
    fetchAll<TicketRow>((from, to) =>
      context.supabaseAdmin
        .from("tickets")
        .select(
          "id, assigned_team_id, created_at, first_responded_at, resolved_at, status:ticket_statuses(key, label, is_closed), priority:ticket_priorities(key, label), department:departments(id, name)",
        )
        .eq("tenant_id", action.tenantId)
        .gte("created_at", since)
        .lte("created_at", until)
        .order("created_at", { ascending: true })
        .range(from, to),
    ),
    fetchAll<TimeEntryRow>((from, to) =>
      context.supabaseAdmin
        .from("ticket_time_entries")
        .select(
          "created_at, minutes, billing_kind, tickets!inner(tenant_id, assigned_team_id)",
        )
        .eq("tickets.tenant_id", action.tenantId)
        .gte("created_at", since)
        .lte("created_at", until)
        .order("created_at", { ascending: true })
        .range(from, to),
    ),
    fetchAll<SatisfactionRow>((from, to) =>
      context.supabaseAdmin
        .from("ticket_satisfaction")
        .select(
          "submitted_at, score, tickets!inner(tenant_id, assigned_team_id)",
        )
        .eq("tickets.tenant_id", action.tenantId)
        .gte("submitted_at", since)
        .lte("submitted_at", until)
        .order("submitted_at", { ascending: true })
        .range(from, to),
    ),
    fetchAll<EscalationRow>((from, to) =>
      context.supabaseAdmin
        .from("ticket_escalations")
        .select(
          "opened_at, resolved_at, tickets!inner(tenant_id, assigned_team_id)",
        )
        .eq("tickets.tenant_id", action.tenantId)
        .gte("opened_at", since)
        .lte("opened_at", until)
        .is("resolved_at", null)
        .order("opened_at", { ascending: true })
        .range(from, to),
    ),
    context.supabaseAdmin
      .from("team_memberships")
      .select("team_id, teams!inner(active, department_id)")
      .eq("tenant_id", action.tenantId)
      .eq("user_id", actorId),
    context.supabaseAdmin
      .from("department_memberships")
      .select("department_id")
      .eq("tenant_id", action.tenantId)
      .eq("user_id", actorId)
      .eq("status", "active"),
  ]);

  for (const result of [
    ticketsResult,
    timeEntriesResult,
    satisfactionResult,
    escalationsResult,
    teamMembershipsResult,
    departmentMembershipsResult,
  ]) {
    if (result.error) {
      if (result.error.code === "reporting_result_limit_exceeded") {
        return response(
          request,
          {
            error: {
              code: "reporting_result_limit_exceeded",
              message:
                "Der angeforderte Berichtszeitraum enthält mehr Daten als sicher verarbeitet werden können.",
            },
          },
          413,
        );
      }
      return reportingError(request, result.error);
    }
  }

  const activeDepartmentIds = new Set(
    (departmentMembershipsResult.data ?? []).flatMap((membership: any) =>
      isUuid(membership.department_id) ? [membership.department_id] : [],
    ),
  );
  const readableTeamIds = new Set(
    (teamMembershipsResult.data ?? []).flatMap((membership: any) => {
      const team = one<{ active?: unknown; department_id?: unknown }>(
        membership.teams,
      );
      return isUuid(membership.team_id) &&
        team?.active === true &&
        isUuid(team.department_id) &&
        activeDepartmentIds.has(team.department_id)
        ? [membership.team_id]
        : [];
    }),
  );
  const canIncludeTeam = (teamId: unknown) =>
    teamId === null ||
    teamId === undefined ||
    (isUuid(teamId) && readableTeamIds.has(teamId));
  const nestedTeamId = (value: unknown) =>
    one<TeamScopedTicketRow>(value)?.assigned_team_id;

  const tickets = (ticketsResult.data ?? []).filter((ticket) =>
    canIncludeTeam(ticket.assigned_team_id),
  );
  const timeEntries = (timeEntriesResult.data ?? []).filter((entry) =>
    canIncludeTeam(nestedTeamId(entry.tickets)),
  );
  const satisfaction = (satisfactionResult.data ?? []).filter((entry) =>
    canIncludeTeam(nestedTeamId(entry.tickets)),
  );
  const escalations = (escalationsResult.data ?? []).filter((entry) =>
    canIncludeTeam(nestedTeamId(entry.tickets)),
  );
  if (!tickets || !timeEntries || !satisfaction || !escalations) {
    return response(
      request,
      { error: { code: "reporting_query_failed" } },
      500,
    );
  }

  const inRange = (value: unknown, range: PeriodRange) => {
    if (typeof value !== "string") return false;
    const timestamp = Date.parse(value);
    return (
      Number.isFinite(timestamp) &&
      timestamp >= Date.parse(range.startsAt) &&
      timestamp <= Date.parse(range.endsAt)
    );
  };

  const buildMetrics = (
    range: PeriodRange,
    rangeTickets: TicketRow[],
    rangeTimeEntries: TimeEntryRow[],
    rangeSatisfaction: SatisfactionRow[],
    rangeEscalations: EscalationRow[],
  ) => {
    const byPriority = new Map<
      string,
      { key: string | null; label: string | null; ticketCount: number }
    >();
    const byDepartment = new Map<
      string,
      { id: string | null; name: string | null; ticketCount: number }
    >();
    const firstResponseMinutes: number[] = [];
    const resolutionMinutes: number[] = [];
    let resolvedTickets = 0;

    for (const ticket of rangeTickets) {
      const status = one<TicketStatus>(ticket.status);
      if (status?.is_closed === true) resolvedTickets += 1;
      const priority = one<TicketPriority>(ticket.priority);
      const priorityKey =
        typeof priority?.key === "string" ? priority.key : null;
      const priorityLabel =
        typeof priority?.label === "string" ? priority.label : null;
      const priorityGroup = `${priorityKey ?? ""}\u0000${priorityLabel ?? ""}`;
      const priorityMetric = byPriority.get(priorityGroup) ?? {
        key: priorityKey,
        label: priorityLabel,
        ticketCount: 0,
      };
      priorityMetric.ticketCount += 1;
      byPriority.set(priorityGroup, priorityMetric);

      const department = one<Department>(ticket.department);
      const departmentId =
        typeof department?.id === "string" ? department.id : null;
      const departmentName =
        typeof department?.name === "string" ? department.name : null;
      const departmentGroup = `${departmentId ?? ""}\u0000${departmentName ?? ""}`;
      const departmentMetric = byDepartment.get(departmentGroup) ?? {
        id: departmentId,
        name: departmentName,
        ticketCount: 0,
      };
      departmentMetric.ticketCount += 1;
      byDepartment.set(departmentGroup, departmentMetric);

      const firstResponse = elapsedMinutes(
        ticket.created_at,
        ticket.first_responded_at,
      );
      if (firstResponse !== null) firstResponseMinutes.push(firstResponse);
      const resolution = elapsedMinutes(ticket.created_at, ticket.resolved_at);
      if (resolution !== null) resolutionMinutes.push(resolution);
    }

    const timeByBillingKind = new Map<
      string,
      { billingKind: string; entryCount: number; minutes: number }
    >();
    for (const entry of rangeTimeEntries) {
      if (
        typeof entry.billing_kind !== "string" ||
        typeof entry.minutes !== "number" ||
        !Number.isFinite(entry.minutes)
      )
        continue;
      const metric = timeByBillingKind.get(entry.billing_kind) ?? {
        billingKind: entry.billing_kind,
        entryCount: 0,
        minutes: 0,
      };
      metric.entryCount += 1;
      metric.minutes += entry.minutes;
      timeByBillingKind.set(entry.billing_kind, metric);
    }

    const satisfactionScores = rangeSatisfaction
      .map((entry) => entry.score)
      .filter(
        (score): score is number =>
          typeof score === "number" && Number.isFinite(score),
      );
    const timeTrackingByBillingKind = [...timeByBillingKind.values()].sort(
      (a, b) => a.billingKind.localeCompare(b.billingKind),
    );
    const timeTrackingMinutes = timeTrackingByBillingKind.reduce(
      (total, entry) => total + entry.minutes,
      0,
    );
    const timeTrackingEntryCount = timeTrackingByBillingKind.reduce(
      (total, entry) => total + entry.entryCount,
      0,
    );

    return {
      period: range,
      ticketVolume: rangeTickets.length,
      tickets: {
        open: rangeTickets.length - resolvedTickets,
        resolved: resolvedTickets,
        byPriority: [...byPriority.values()].sort((a, b) =>
          (a.label ?? a.key ?? "").localeCompare(
            b.label ?? b.key ?? "",
            "de-CH",
          ),
        ),
        byDepartment: [...byDepartment.values()].sort((a, b) =>
          (a.name ?? "").localeCompare(b.name ?? "", "de-CH"),
        ),
      },
      averageFirstResponseMinutes: average(firstResponseMinutes),
      firstResponseSampleSize: firstResponseMinutes.length,
      averageResolutionMinutes: average(resolutionMinutes),
      resolutionSampleSize: resolutionMinutes.length,
      timeTrackingByBillingKind,
      timeTrackingMinutes,
      timeTrackingEntryCount,
      openEscalations: rangeEscalations.length,
      averageSatisfaction: average(satisfactionScores),
      satisfactionSampleSize: satisfactionScores.length,
    };
  };

  const current = buildMetrics(
    ranges.current,
    tickets.filter((ticket) => inRange(ticket.created_at, ranges.current)),
    timeEntries.filter((entry) => inRange(entry.created_at, ranges.current)),
    satisfaction.filter((entry) => inRange(entry.submitted_at, ranges.current)),
    escalations.filter((entry) => inRange(entry.opened_at, ranges.current)),
  );
  const previous = buildMetrics(
    ranges.previous,
    tickets.filter((ticket) => inRange(ticket.created_at, ranges.previous)),
    timeEntries.filter((entry) => inRange(entry.created_at, ranges.previous)),
    satisfaction.filter((entry) =>
      inRange(entry.submitted_at, ranges.previous),
    ),
    escalations.filter((entry) => inRange(entry.opened_at, ranges.previous)),
  );

  return response(request, {
    data: {
      ...current,
      comparison: {
        period: previous.period,
        ticketVolume: previous.ticketVolume,
        tickets: {
          open: previous.tickets.open,
          resolved: previous.tickets.resolved,
        },
        averageFirstResponseMinutes: previous.averageFirstResponseMinutes,
        firstResponseSampleSize: previous.firstResponseSampleSize,
        averageResolutionMinutes: previous.averageResolutionMinutes,
        resolutionSampleSize: previous.resolutionSampleSize,
        timeTrackingMinutes: previous.timeTrackingMinutes,
        timeTrackingEntryCount: previous.timeTrackingEntryCount,
        openEscalations: previous.openEscalations,
        averageSatisfaction: previous.averageSatisfaction,
        satisfactionSampleSize: previous.satisfactionSampleSize,
      },
    },
  });
});

export default {
  fetch(request: Request): Response | Promise<Response> {
    if (request.method === "OPTIONS") return response(request, {}, 204);
    return handler(request);
  },
};
