import { withSupabase } from "@supabase/server";
import { resolveUserFeatureStates } from "../_shared/tenant-features.ts";
import { deflectionArticleFilter } from "./deflections.ts";
import {
  buildInsights,
  buildRequesterDepartments,
  buildThemes,
  type InsightComment,
  type InsightRating,
  type InsightTicket,
  type ThemeTicket,
} from "./insights.ts";

type Period = "7d" | "30d" | "90d" | "custom";
type Action = {
  type: "getReport" | "getInsights";
  tenantId: string;
  period: Period;
  startsOn?: string;
  endsOn?: string;
  /** Only for getInsights: narrow to one agent group (team) or agent. */
  teamId?: string;
  agentId?: string;
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
    !hasOnlyKeys(value, [
      "type",
      "tenantId",
      "period",
      "startsOn",
      "endsOn",
      "teamId",
      "agentId",
    ]) ||
    (value.type !== "getReport" && value.type !== "getInsights") ||
    !isUuid(value.tenantId) ||
    !isPeriod(value.period)
  ) {
    return null;
  }
  const filters: Pick<Action, "teamId" | "agentId"> = {};
  for (const key of ["teamId", "agentId"] as const) {
    if (value[key] === undefined) continue;
    if (value.type !== "getInsights" || !isUuid(value[key])) return null;
    filters[key] = (value[key] as string).toLowerCase();
  }

  if (value.period === "custom") {
    if (!isDateInput(value.startsOn) || !isDateInput(value.endsOn)) return null;
    return {
      type: value.type,
      tenantId: value.tenantId,
      period: value.period,
      startsOn: value.startsOn,
      endsOn: value.endsOn,
      ...filters,
    };
  }
  if (value.startsOn !== undefined || value.endsOn !== undefined) return null;
  return {
    type: value.type,
    tenantId: value.tenantId,
    period: value.period,
    ...filters,
  };
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

const ID_CHUNK = 150;

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

/** Teams whose tickets the caller may include, as in getReport. */
async function readableTeamIds(
  admin: any,
  tenantId: string,
  actorId: string,
): Promise<Set<string> | null> {
  const [teams, departments] = await Promise.all([
    admin
      .from("team_memberships")
      .select(
        "team_id, teams!team_memberships_team_tenant_fk!inner(active, department_id)",
      )
      .eq("tenant_id", tenantId)
      .eq("user_id", actorId),
    admin
      .from("department_memberships")
      .select("department_id")
      .eq("tenant_id", tenantId)
      .eq("user_id", actorId)
      .eq("status", "active"),
  ]);
  if (teams.error || departments.error) return null;
  const activeDepartmentIds = new Set(
    (departments.data ?? []).flatMap((membership: any) =>
      isUuid(membership.department_id) ? [membership.department_id] : [],
    ),
  );
  return new Set(
    (teams.data ?? []).flatMap((membership: any) => {
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
}

async function insightsResponse(
  request: Request,
  admin: any,
  actorId: string,
  action: Action,
  ranges: { current: PeriodRange; previous: PeriodRange },
): Promise<Response> {
  const since = ranges.previous.startsAt;
  const until = ranges.current.endsAt;
  const [ticketsResult, teamIds] = await Promise.all([
    // Every ticket that existed and was not yet resolved at some point of the
    // two periods: needed for the open backlog and the resolution metrics.
    fetchAll<any>((from, to) =>
      admin
        .from("tickets")
        .select(
          "id, assigned_team_id, assigned_agent_id, requester_id, requester_contact_id, category_id, subject, source, created_at, first_responded_at, resolved_at, response_due_at, resolution_due_at",
        )
        .is("deleted_at", null)
        .eq("tenant_id", action.tenantId)
        .lte("created_at", until)
        .or(`resolved_at.is.null,resolved_at.gte.${since}`)
        .order("created_at", { ascending: true })
        .range(from, to),
    ),
    readableTeamIds(admin, action.tenantId, actorId),
  ]);
  if (ticketsResult.error) {
    if (ticketsResult.error.code === "reporting_result_limit_exceeded") {
      return response(
        request,
        { error: { code: "reporting_result_limit_exceeded" } },
        413,
      );
    }
    return reportingError(request, ticketsResult.error);
  }
  if (!teamIds) {
    return response(
      request,
      { error: { code: "reporting_query_failed" } },
      500,
    );
  }

  const visible: InsightTicket[] = (ticketsResult.data ?? [])
    .filter(
      (row: any) =>
        row.assigned_team_id === null || teamIds.has(row.assigned_team_id),
    )
    .map((row: any) => ({
      id: row.id,
      assignedTeamId: row.assigned_team_id ?? null,
      assignedAgentId: row.assigned_agent_id ?? null,
      requesterId: row.requester_id ?? null,
      source: typeof row.source === "string" ? row.source : null,
      createdAt: row.created_at,
      firstRespondedAt: row.first_responded_at ?? null,
      resolvedAt: row.resolved_at ?? null,
      responseDueAt: row.response_due_at ?? null,
      resolutionDueAt: row.resolution_due_at ?? null,
    }));
  const tickets = visible.filter(
    (ticket) =>
      (!action.teamId || ticket.assignedTeamId === action.teamId) &&
      (!action.agentId || ticket.assignedAgentId === action.agentId),
  );

  const ids = tickets.map((ticket) => ticket.id);
  // Agent filter: every member of the readable teams (or of the chosen
  // team), plus anyone with an assigned ticket in the period.
  const memberTeamIds = action.teamId
    ? [action.teamId].filter((id) => teamIds.has(id))
    : [...teamIds];
  const teamMembers = memberTeamIds.length
    ? await admin
        .from("team_memberships")
        .select("user_id")
        .eq("tenant_id", action.tenantId)
        .in("team_id", memberTeamIds)
        .limit(2000)
    : { data: [] as { user_id: string }[], error: null };
  const agentIds = [
    ...new Set([
      ...visible.flatMap((ticket) =>
        ticket.assignedAgentId ? [ticket.assignedAgentId] : [],
      ),
      ...((teamMembers.data ?? []) as { user_id: string }[]).map(
        (row) => row.user_id,
      ),
    ]),
  ];
  const [commentPages, ratingPages, teams, profiles] = await Promise.all([
    Promise.all(
      chunks(ids, ID_CHUNK).map((part) =>
        fetchAll<any>((from, to) =>
          admin
            .from("ticket_comments")
            .select("id, ticket_id, author_id, visibility, created_at")
            .in("ticket_id", part)
            .lte("created_at", until)
            .order("id", { ascending: true })
            .range(from, to),
        ),
      ),
    ),
    Promise.all(
      chunks(ids, ID_CHUNK).map((part) =>
        admin
          .from("ticket_satisfaction")
          .select("ticket_id, score, submitted_at")
          .in("ticket_id", part)
          .gte("submitted_at", since)
          .lte("submitted_at", until),
      ),
    ),
    admin.from("teams").select("id, name").eq("tenant_id", action.tenantId),
    agentIds.length
      ? admin
          .from("user_profiles")
          .select("id, display_name")
          .in("id", agentIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const failed = [...commentPages, ...ratingPages, teams, profiles].find(
    (page: any) => page.error,
  );
  if (failed) {
    const error = (failed as any).error;
    if (error?.code === "reporting_result_limit_exceeded") {
      return response(
        request,
        { error: { code: "reporting_result_limit_exceeded" } },
        413,
      );
    }
    return reportingError(request, error);
  }

  const comments: InsightComment[] = commentPages.flatMap((page: any) =>
    (page.data ?? []).map((row: any) => ({
      ticketId: row.ticket_id,
      authorId: row.author_id ?? null,
      external: row.visibility === "external",
      createdAt: row.created_at,
    })),
  );
  const ratings: InsightRating[] = ratingPages.flatMap((page: any) =>
    (page.data ?? []).flatMap((row: any) =>
      typeof row.score === "number" && typeof row.submitted_at === "string"
        ? [
            {
              ticketId: row.ticket_id,
              score: row.score,
              submittedAt: row.submitted_at,
            },
          ]
        : [],
    ),
  );
  const teamNames = new Map<string, string>(
    (teams.data ?? []).map((team: any) => [team.id, team.name]),
  );
  const agentNames = new Map<string, string>(
    (profiles.data ?? []).map((profile: any) => [
      profile.id,
      profile.display_name || "Unbekannter Agent",
    ]),
  );

  const visibleTeamIds = [
    ...new Set(
      visible.flatMap((ticket) =>
        ticket.assignedTeamId ? [ticket.assignedTeamId] : [],
      ),
    ),
  ];
  // Themes and requesting departments.
  const visibleRows = (ticketsResult.data ?? []).filter((row: any) =>
    tickets.some((ticket) => ticket.id === row.id),
  );
  const categoryIds = [
    ...new Set(
      visibleRows.flatMap((row: any) =>
        typeof row.category_id === "string" ? [row.category_id] : [],
      ),
    ),
  ];
  const contactIds = [
    ...new Set(
      visibleRows.flatMap((row: any) =>
        typeof row.requester_contact_id === "string"
          ? [row.requester_contact_id]
          : [],
      ),
    ),
  ];
  const [categoryRows, profilePages] = await Promise.all([
    categoryIds.length
      ? admin
          .from("ticket_categories")
          .select("id, name")
          .eq("tenant_id", action.tenantId)
          .in("id", categoryIds)
      : Promise.resolve({ data: [], error: null }),
    Promise.all(
      chunks(contactIds, ID_CHUNK).map((part) =>
        admin
          .from("ticket_requester_profiles")
          .select("requester_id, department")
          .eq("tenant_id", action.tenantId)
          .in("requester_id", part),
      ),
    ),
  ]);
  const categoryNames = new Map<string, string>(
    (categoryRows.data ?? []).map((row: any) => [row.id, row.name]),
  );
  const departmentByContact = new Map<string, string>();
  for (const page of profilePages as any[])
    for (const row of page.data ?? [])
      if (typeof row.department === "string" && row.department.trim())
        departmentByContact.set(row.requester_id, row.department.trim());
  const themeTickets: ThemeTicket[] = visibleRows.map((row: any) => ({
    id: row.id,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at ?? null,
    subject: typeof row.subject === "string" ? row.subject : null,
    categoryName:
      typeof row.category_id === "string"
        ? (categoryNames.get(row.category_id) ?? null)
        : null,
    requesterDepartment:
      typeof row.requester_contact_id === "string"
        ? (departmentByContact.get(row.requester_contact_id) ?? null)
        : null,
  }));

  const byName = (a: { name: string }, b: { name: string }) =>
    a.name.localeCompare(b.name, "de-CH");
  return response(request, {
    data: {
      period: ranges.current,
      comparisonPeriod: ranges.previous,
      filters: {
        teams: visibleTeamIds
          .map((id) => ({ id, name: teamNames.get(id) ?? "Unbekanntes Team" }))
          .sort(byName),
        agents: agentIds
          .map((id) => ({
            id,
            name: agentNames.get(id) ?? "Unbekannter Agent",
          }))
          .sort(byName),
      },
      ...buildInsights({
        current: ranges.current,
        previous: ranges.previous,
        tickets,
        comments,
        ratings,
        teamNames,
        agentNames,
      }),
      themes: buildThemes({
        current: ranges.current,
        previous: ranges.previous,
        tickets: themeTickets,
      }),
      requesterDepartments: buildRequesterDepartments({
        current: ranges.current,
        previous: ranges.previous,
        tickets: themeTickets,
      }),
    },
  });
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

  const featureStates = await resolveUserFeatureStates(
    context.supabaseAdmin,
    action.tenantId,
    actorId,
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

  if (action.type === "getInsights") {
    return insightsResponse(request, context.supabaseAdmin, actorId, action, {
      current: ranges.current,
      previous: ranges.previous,
    });
  }

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
          "id, assigned_team_id, created_at, first_responded_at, resolved_at, status:ticket_statuses!tickets_status_tenant_fk(key, label, is_closed), priority:ticket_priorities!tickets_priority_tenant_fk(key, label), department:departments!tickets_department_tenant_fk(id, name)",
        )
        .is("deleted_at", null)
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
        .is("tickets.deleted_at", null)
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
        .is("tickets.deleted_at", null)
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
        .is("tickets.deleted_at", null)
        .gte("opened_at", since)
        .lte("opened_at", until)
        .is("resolved_at", null)
        .order("opened_at", { ascending: true })
        .range(from, to),
    ),
    context.supabaseAdmin
      .from("team_memberships")
      .select(
        "team_id, teams!team_memberships_team_tenant_fk!inner(active, department_id)",
      )
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
  // Departments of the readable teams: the knowledge deflection count below
  // uses exactly the same basis as the ticket KPIs (tickets of readable teams).
  const readableTeamDepartmentIds = new Set<string>();
  const readableTeamIds = new Set(
    (teamMembershipsResult.data ?? []).flatMap((membership: any) => {
      const team = one<{ active?: unknown; department_id?: unknown }>(
        membership.teams,
      );
      if (
        isUuid(membership.team_id) &&
        team?.active === true &&
        isUuid(team.department_id) &&
        activeDepartmentIds.has(team.department_id)
      ) {
        readableTeamDepartmentIds.add(team.department_id);
        return [membership.team_id];
      }
      return [];
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

  // Tickets that were not created because a knowledge article solved the
  // problem ("Hat mein Problem gelöst" while creating a ticket). Scoped like
  // the ticket KPIs: tickets count for readable teams (plus tickets without
  // team), deflections for articles of those teams' departments (plus
  // articles without department). Optional: a failed count does not fail
  // the report.
  const deflectionFilter = deflectionArticleFilter(readableTeamDepartmentIds);
  const deflectedCount = async (range: PeriodRange) => {
    const { count, error } = await context.supabaseAdmin
      .from("knowledge_article_outcomes")
      .select("id, knowledge_articles!inner(department_id)", {
        count: "exact",
        head: true,
      })
      .eq("tenant_id", action.tenantId)
      .eq("kind", "deflected")
      .or(deflectionFilter, { referencedTable: "knowledge_articles" })
      .gte("created_at", range.startsAt)
      .lte("created_at", range.endsAt);
    return error || typeof count !== "number" ? null : count;
  };
  const [deflectedTickets, previousDeflectedTickets] = await Promise.all([
    deflectedCount(ranges.current),
    deflectedCount(ranges.previous),
  ]);

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
      deflectedTickets,
      comparison: {
        period: previous.period,
        deflectedTickets: previousDeflectedTickets,
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
