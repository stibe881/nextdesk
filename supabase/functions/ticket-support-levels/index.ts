import { withSupabase } from "@supabase/server";
import { isRecord, isUuid, json, noContent } from "../_shared/http.ts";
import { listAssignableAgents } from "../_shared/assignable-agents.ts";
import { resolveUserFeatureStates } from "../_shared/tenant-features.ts";
import {
  buildSupportLevelReport,
  currentHandover,
  handoverDirection,
  handoverTargets,
  isSupportLevel,
  type LevelChange,
  type LevelChangeKind,
  type LevelTeam,
  normalizeHandoverNote,
  type ReportTicket,
  SUPPORT_LEVELS,
  type SupportLevel,
  supportLevelLabel,
} from "./levels.ts";

/**
 * Eskalationsstufen (1st/2nd/3rd Level Support) on top of the teams.
 * - getTicket: current level, handover targets, history with handover notes
 * - teamAgents: assignable agents of a target team
 * - handover: "An nächste Stufe übergeben" / "Zurück an Stufe X"
 * - queueLevels: levels configured in the caller's departments (queue filter)
 * - report: first-level resolution, escalations per category, time per level
 * Not related to ticket_escalations (management escalation, ticket-operations).
 */

// deno-lint-ignore no-explicit-any
type Admin = any;
type Row = Record<string, unknown>;

type Action =
  | { type: "getTicket"; tenantId: string; ticketId: string }
  | { type: "teamAgents"; tenantId: string; ticketId: string; teamId: string }
  | {
      type: "handover";
      tenantId: string;
      ticketId: string;
      targetTeamId: string;
      targetAgentId: string | null;
      note: string;
      expectedLevel: SupportLevel;
    }
  | { type: "queueLevels"; tenantId: string }
  | { type: "report"; tenantId: string; startsAt: string; endsAt: string };

const MAX_REPORT_DAYS = 400;
const PAGE_SIZE = 1_000;
const MAX_REPORT_TICKETS = 20_000;
const ID_CHUNK = 150;

function hasOnlyKeys(value: Row, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function isIsoTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/.test(
      value,
    ) &&
    Number.isFinite(Date.parse(value))
  );
}

export function parseAction(value: unknown): Action | null {
  if (!isRecord(value) || !isUuid(value.tenantId)) return null;
  const tenantId = value.tenantId.toLowerCase();
  switch (value.type) {
    case "getTicket":
      return hasOnlyKeys(value, ["type", "tenantId", "ticketId"]) &&
        isUuid(value.ticketId)
        ? {
            type: "getTicket",
            tenantId,
            ticketId: value.ticketId.toLowerCase(),
          }
        : null;
    case "teamAgents":
      return hasOnlyKeys(value, ["type", "tenantId", "ticketId", "teamId"]) &&
        isUuid(value.ticketId) &&
        isUuid(value.teamId)
        ? {
            type: "teamAgents",
            tenantId,
            ticketId: value.ticketId.toLowerCase(),
            teamId: value.teamId.toLowerCase(),
          }
        : null;
    case "handover": {
      if (
        !hasOnlyKeys(value, [
          "type",
          "tenantId",
          "ticketId",
          "targetTeamId",
          "targetAgentId",
          "note",
          "expectedLevel",
        ]) ||
        !isUuid(value.ticketId) ||
        !isUuid(value.targetTeamId) ||
        !(
          value.targetAgentId === undefined ||
          value.targetAgentId === null ||
          isUuid(value.targetAgentId)
        ) ||
        !isSupportLevel(value.expectedLevel)
      ) {
        return null;
      }
      const note = normalizeHandoverNote(value.note);
      if (!note) return null;
      return {
        type: "handover",
        tenantId,
        ticketId: value.ticketId.toLowerCase(),
        targetTeamId: value.targetTeamId.toLowerCase(),
        targetAgentId: isUuid(value.targetAgentId)
          ? value.targetAgentId.toLowerCase()
          : null,
        note,
        expectedLevel: value.expectedLevel,
      };
    }
    case "queueLevels":
      return hasOnlyKeys(value, ["type", "tenantId"])
        ? { type: "queueLevels", tenantId }
        : null;
    case "report": {
      if (
        !hasOnlyKeys(value, ["type", "tenantId", "startsAt", "endsAt"]) ||
        !isIsoTimestamp(value.startsAt) ||
        !isIsoTimestamp(value.endsAt)
      ) {
        return null;
      }
      const start = Date.parse(value.startsAt);
      const end = Date.parse(value.endsAt);
      if (end < start || end - start > MAX_REPORT_DAYS * 86_400_000) {
        return null;
      }
      return {
        type: "report",
        tenantId,
        startsAt: value.startsAt,
        endsAt: value.endsAt,
      };
    }
    default:
      return null;
  }
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message = code,
  ) {
    super(message);
  }
}

function one<T>(value: unknown): T | null {
  return (Array.isArray(value) ? value[0] : value) as T | null;
}

function levelOrNull(value: unknown): SupportLevel | null {
  return isSupportLevel(value) ? value : null;
}

async function activeMember(admin: Admin, userId: string, tenantId: string) {
  const { data, error } = await admin
    .from("tenant_memberships")
    .select("user_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw new HttpError(503, "membership_validation_failed");
  return Boolean(data);
}

/** Same rule as public.has_ticket_permission (see ticket-operations). */
async function permissionsInDepartment(
  admin: Admin,
  userId: string,
  tenantId: string,
  departmentId: string,
): Promise<Set<string>> {
  const now = new Date().toISOString();
  const [departmentMembership, roleAssignments] = await Promise.all([
    admin
      .from("department_memberships")
      .select("user_id")
      .eq("tenant_id", tenantId)
      .eq("department_id", departmentId)
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle(),
    admin
      .from("user_role_assignments")
      .select(
        "department_id, roles!user_role_assignments_role_tenant_fk!inner(tenant_id, active, scope, role_permissions!inner(permission_code))",
      )
      .eq("tenant_id", tenantId)
      .eq("user_id", userId)
      .lte("starts_at", now)
      .or(`expires_at.is.null,expires_at.gt.${now}`),
  ]);
  if (departmentMembership.error || roleAssignments.error) {
    throw new HttpError(503, "permission_validation_failed");
  }
  const result = new Set<string>();
  if (!departmentMembership.data) return result;
  for (const assignment of roleAssignments.data ?? []) {
    const role = one<Row>(assignment.roles);
    if (
      role?.tenant_id !== tenantId ||
      role.active !== true ||
      !(
        role.scope === "tenant" ||
        (role.scope === "department" &&
          assignment.department_id === departmentId)
      )
    ) {
      continue;
    }
    for (const item of (role.role_permissions as Row[] | undefined) ?? []) {
      if (typeof item.permission_code === "string") {
        result.add(item.permission_code);
      }
    }
  }
  return result;
}

async function canAccessTeamTicket(
  admin: Admin,
  userId: string,
  ticketId: string,
): Promise<boolean> {
  const { data, error } = await admin.rpc("can_user_access_ticket_team", {
    p_ticket_id: ticketId,
    p_user_id: userId,
  });
  return !error && data === true;
}

type TicketRow = {
  id: string;
  tenant_id: string;
  department_id: string;
  assigned_team_id: string | null;
  assigned_agent_id: string | null;
  merged_into_ticket_id: string | null;
  status: unknown;
};

async function loadTicketContext(
  admin: Admin,
  actorId: string,
  tenantId: string,
  ticketId: string,
) {
  if (!(await activeMember(admin, actorId, tenantId))) {
    throw new HttpError(403, "active_tenant_membership_required");
  }
  const { data: ticket, error } = await admin
    .from("tickets")
    .select(
      "id, tenant_id, department_id, assigned_team_id, assigned_agent_id, merged_into_ticket_id, status:ticket_statuses!tickets_status_tenant_fk(is_closed)",
    )
    .eq("id", ticketId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) throw new HttpError(500, "ticket_lookup_failed");
  if (!ticket) throw new HttpError(404, "ticket_not_found");
  const typed = ticket as TicketRow;
  const [permissions, teamAccess] = await Promise.all([
    permissionsInDepartment(admin, actorId, tenantId, typed.department_id),
    canAccessTeamTicket(admin, actorId, typed.id),
  ]);
  const canRead =
    teamAccess &&
    (permissions.has("ticket.read.department") ||
      permissions.has("ticket.update") ||
      (typed.assigned_agent_id === actorId &&
        permissions.has("ticket.read.assigned")));
  if (!canRead) throw new HttpError(403, "ticket_read_denied");
  const closed =
    one<{ is_closed?: unknown }>(typed.status)?.is_closed === true ||
    typed.merged_into_ticket_id !== null;
  return {
    ticket: typed,
    closed,
    canHandover:
      teamAccess &&
      permissions.has("ticket.update") &&
      permissions.has("ticket.assign"),
    canAssign: permissions.has("ticket.assign"),
  };
}

async function departmentTeams(
  admin: Admin,
  tenantId: string,
  departmentId: string,
): Promise<LevelTeam[]> {
  const { data, error } = await admin
    .from("teams")
    .select("id, name, department_id, support_level, active")
    .eq("tenant_id", tenantId)
    .eq("department_id", departmentId)
    .limit(300);
  if (error) throw new HttpError(500, "team_lookup_failed");
  return (data ?? []).flatMap((row: Row) =>
    isUuid(row.id) &&
    typeof row.name === "string" &&
    typeof row.department_id === "string"
      ? [
          {
            id: row.id,
            name: row.name,
            departmentId: row.department_id,
            supportLevel: levelOrNull(row.support_level),
            active: row.active === true,
          },
        ]
      : [],
  );
}

async function getTicket(
  admin: Admin,
  actorId: string,
  action: Extract<Action, { type: "getTicket" }>,
) {
  const context = await loadTicketContext(
    admin,
    actorId,
    action.tenantId,
    action.ticketId,
  );
  const { ticket } = context;
  const [teams, changesResult] = await Promise.all([
    departmentTeams(admin, action.tenantId, ticket.department_id),
    admin
      .from("ticket_support_level_changes")
      .select(
        "id, from_level, to_level, from_team_id, to_team_id, kind, handover_note, actor_id, created_at",
      )
      .eq("tenant_id", action.tenantId)
      .eq("ticket_id", ticket.id)
      .order("seq", { ascending: true })
      .limit(200),
  ]);
  if (changesResult.error) throw new HttpError(500, "level_history_failed");
  const rows: Row[] = changesResult.data ?? [];
  const teamNames = new Map(teams.map((team) => [team.id, team.name]));
  const missingTeamIds = [
    ...new Set(
      rows
        .flatMap((row) => [row.from_team_id, row.to_team_id])
        .filter((id): id is string => isUuid(id) && !teamNames.has(id)),
    ),
  ];
  const actorIds = [...new Set(rows.map((row) => row.actor_id).filter(isUuid))];
  const [otherTeams, profiles] = await Promise.all([
    missingTeamIds.length
      ? admin
          .from("teams")
          .select("id, name")
          .eq("tenant_id", action.tenantId)
          .in("id", missingTeamIds)
      : Promise.resolve({ data: [], error: null }),
    actorIds.length
      ? admin
          .from("user_profiles")
          .select("id, display_name")
          .in("id", actorIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  for (const row of otherTeams.data ?? []) teamNames.set(row.id, row.name);
  const actorNames = new Map<string, string>(
    (profiles.data ?? []).map((row: Row) => [
      String(row.id),
      typeof row.display_name === "string" && row.display_name.trim()
        ? row.display_name.trim()
        : "Aktive Person",
    ]),
  );

  const currentTeam = teams.find((team) => team.id === ticket.assigned_team_id);
  const currentLevel = currentTeam?.supportLevel ?? null;
  const history = rows.map((row) => ({
    id: String(row.id),
    ticketId: ticket.id,
    kind: row.kind as LevelChangeKind,
    fromLevel: levelOrNull(row.from_level),
    toLevel: levelOrNull(row.to_level),
    teamName: isUuid(row.to_team_id)
      ? (teamNames.get(row.to_team_id) ?? "Unbekanntes Team")
      : null,
    note: typeof row.handover_note === "string" ? row.handover_note : null,
    actorName: isUuid(row.actor_id)
      ? (actorNames.get(row.actor_id) ?? "Ehemalige Person")
      : null,
    createdAt: String(row.created_at),
  }));
  const handover = currentHandover(history, currentLevel);
  return {
    levelsConfigured: teams.some(
      (team) => team.active && team.supportLevel !== null,
    ),
    currentLevel,
    currentTeam: currentTeam
      ? { id: currentTeam.id, name: currentTeam.name }
      : null,
    ticketClosed: context.closed,
    canHandover:
      context.canHandover && !context.closed && currentLevel !== null,
    targets: handoverTargets(currentLevel, ticket.department_id, teams),
    currentHandover: handover,
    history: history
      .map(({ ticketId: _ticketId, ...entry }) => entry)
      .reverse(),
  };
}

async function teamAgents(
  admin: Admin,
  actorId: string,
  action: Extract<Action, { type: "teamAgents" }>,
) {
  const context = await loadTicketContext(
    admin,
    actorId,
    action.tenantId,
    action.ticketId,
  );
  if (!context.canAssign) throw new HttpError(403, "ticket_assign_denied");
  const teams = await departmentTeams(
    admin,
    action.tenantId,
    context.ticket.department_id,
  );
  if (
    !teams.some(
      (team) =>
        team.id === action.teamId && team.active && team.supportLevel !== null,
    )
  ) {
    throw new HttpError(422, "support_level_target_invalid");
  }
  const result = await listAssignableAgents(
    admin,
    action.tenantId,
    context.ticket.department_id,
    action.teamId,
  );
  if (result.error) throw new HttpError(500, "ticket_agents_lookup_failed");
  return { agents: result.agents };
}

const HANDOVER_ERRORS: Record<string, [number, string]> = {
  support_level_handover_invalid: [
    422,
    "Die Übergabenotiz muss zwischen 10 und 4000 Zeichen lang sein.",
  ],
  support_level_ticket_closed: [
    409,
    "Geschlossene Tickets können nicht übergeben werden.",
  ],
  support_level_current_missing: [
    409,
    "Das Ticket ist keinem Team mit Supportstufe zugewiesen.",
  ],
  support_level_changed: [
    409,
    "Die Stufe des Tickets wurde inzwischen geändert. Bitte neu laden.",
  ],
  support_level_target_invalid: [
    422,
    "Das gewählte Team gehört nicht zur nächsten oder einer tieferen Stufe dieser Abteilung.",
  ],
  ticket_not_found: [404, "Das Ticket ist nicht mehr verfügbar."],
};

async function handover(
  admin: Admin,
  actorId: string,
  action: Extract<Action, { type: "handover" }>,
) {
  const context = await loadTicketContext(
    admin,
    actorId,
    action.tenantId,
    action.ticketId,
  );
  if (!context.canHandover) {
    throw new HttpError(
      403,
      "support_level_handover_denied",
      "Für die Übergabe sind die Rechte «Tickets bearbeiten» und «Tickets zuweisen» in dieser Abteilung nötig.",
    );
  }
  if (context.closed) {
    const [status, message] = HANDOVER_ERRORS.support_level_ticket_closed;
    throw new HttpError(status, "support_level_ticket_closed", message);
  }
  const teams = await departmentTeams(
    admin,
    action.tenantId,
    context.ticket.department_id,
  );
  const currentLevel =
    teams.find((team) => team.id === context.ticket.assigned_team_id)
      ?.supportLevel ?? null;
  const target = teams.find(
    (team) => team.id === action.targetTeamId && team.active,
  );
  if (currentLevel === null) {
    const [status, message] = HANDOVER_ERRORS.support_level_current_missing;
    throw new HttpError(status, "support_level_current_missing", message);
  }
  if (currentLevel !== action.expectedLevel) {
    const [status, message] = HANDOVER_ERRORS.support_level_changed;
    throw new HttpError(status, "support_level_changed", message);
  }
  if (!target || !handoverDirection(currentLevel, target.supportLevel)) {
    const [status, message] = HANDOVER_ERRORS.support_level_target_invalid;
    throw new HttpError(status, "support_level_target_invalid", message);
  }
  if (action.targetAgentId) {
    const agents = await listAssignableAgents(
      admin,
      action.tenantId,
      context.ticket.department_id,
      target.id,
    );
    if (agents.error) throw new HttpError(500, "ticket_agents_lookup_failed");
    if (!agents.agents.some((agent) => agent.id === action.targetAgentId)) {
      throw new HttpError(
        422,
        "assigned_agent_invalid",
        "Die gewählte Person gehört nicht zum Zielteam oder darf keine Tickets bearbeiten.",
      );
    }
  }
  const { data, error } = await admin
    .rpc("ticket_support_level_handover", {
      p_tenant_id: action.tenantId,
      p_ticket_id: context.ticket.id,
      p_actor_id: actorId,
      p_target_team_id: target.id,
      p_target_agent_id: action.targetAgentId,
      p_note: action.note,
      p_expected_level: action.expectedLevel,
    })
    // Lets the push trigger recognise the acting person behind the write.
    .setHeader("x-nextdesk-actor-id", actorId);
  if (error) {
    const known =
      typeof error.hint === "string" ? HANDOVER_ERRORS[error.hint] : undefined;
    if (known) throw new HttpError(known[0], error.hint, known[1]);
    throw new HttpError(500, "support_level_handover_failed");
  }
  await admin.from("audit_logs").insert({
    tenant_id: action.tenantId,
    actor_id: actorId,
    action: "ticket.support_level_changed",
    entity_type: "ticket",
    entity_id: context.ticket.id,
    metadata: isRecord(data)
      ? {
          direction: data.direction,
          from_level: data.fromLevel,
          to_level: data.toLevel,
          team_id: data.teamId,
        }
      : {},
  });
  return { handover: data };
}

async function queueLevels(
  admin: Admin,
  actorId: string,
  action: Extract<Action, { type: "queueLevels" }>,
) {
  if (!(await activeMember(admin, actorId, action.tenantId))) {
    throw new HttpError(403, "active_tenant_membership_required");
  }
  const { data: memberships, error: membershipError } = await admin
    .from("department_memberships")
    .select("department_id")
    .eq("tenant_id", action.tenantId)
    .eq("user_id", actorId)
    .eq("status", "active");
  if (membershipError) throw new HttpError(503, "membership_validation_failed");
  const departmentIds = (memberships ?? [])
    .map((row: Row) => row.department_id)
    .filter(isUuid);
  if (departmentIds.length === 0) return { levels: [] };
  const { data, error } = await admin
    .from("teams")
    .select("support_level")
    .eq("tenant_id", action.tenantId)
    .eq("active", true)
    .in("department_id", departmentIds)
    .not("support_level", "is", null)
    .limit(500);
  if (error) throw new HttpError(500, "team_lookup_failed");
  const counts = new Map<SupportLevel, number>();
  for (const row of data ?? []) {
    const level = levelOrNull(row.support_level);
    if (level) counts.set(level, (counts.get(level) ?? 0) + 1);
  }
  return {
    levels: SUPPORT_LEVELS.filter((level) => counts.has(level)).map(
      (level) => ({
        level,
        label: supportLevelLabel(level),
        teamCount: counts.get(level) ?? 0,
      }),
    ),
  };
}

async function hasTenantReportPermission(
  admin: Admin,
  userId: string,
  tenantId: string,
): Promise<boolean> {
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
  if (error) throw new HttpError(503, "report_permission_validation_failed");
  return (data ?? []).some((assignment: Row) => {
    const role = one<Row>(assignment.roles);
    return (
      assignment.department_id === null &&
      role?.active === true &&
      role.scope === "tenant" &&
      Array.isArray(role.role_permissions) &&
      (role.role_permissions as Row[]).some(
        (item) => item.permission_code === "report.read",
      )
    );
  });
}

function chunks<T>(values: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

async function report(
  admin: Admin,
  actorId: string,
  action: Extract<Action, { type: "report" }>,
) {
  if (!(await activeMember(admin, actorId, action.tenantId))) {
    throw new HttpError(403, "active_tenant_membership_required");
  }
  const features = await resolveUserFeatureStates(
    admin,
    action.tenantId,
    actorId,
    ["reporting.service"],
  );
  if (features === null)
    throw new HttpError(503, "tenant_feature_lookup_failed");
  if (features["reporting.service"] !== true) {
    throw new HttpError(403, "reporting_feature_disabled");
  }
  if (!(await hasTenantReportPermission(admin, actorId, action.tenantId))) {
    throw new HttpError(403, "report_read_permission_required");
  }

  const { startsAt, endsAt } = action;
  const [teamsResult, membershipsResult, departmentMembershipsResult] =
    await Promise.all([
      admin
        .from("teams")
        .select("id, department_id, support_level, active")
        .eq("tenant_id", action.tenantId)
        .limit(1000),
      admin
        .from("team_memberships")
        .select(
          "team_id, teams!team_memberships_team_tenant_fk!inner(active, department_id)",
        )
        .eq("tenant_id", action.tenantId)
        .eq("user_id", actorId),
      admin
        .from("department_memberships")
        .select("department_id")
        .eq("tenant_id", action.tenantId)
        .eq("user_id", actorId)
        .eq("status", "active"),
    ]);
  if (
    teamsResult.error ||
    membershipsResult.error ||
    departmentMembershipsResult.error
  ) {
    throw new HttpError(500, "reporting_query_failed");
  }
  const teamLevel = new Map<string, SupportLevel | null>();
  const leveledDepartmentIds = new Set<string>();
  for (const team of teamsResult.data ?? []) {
    const level = levelOrNull(team.support_level);
    teamLevel.set(team.id, level);
    if (level && team.active === true) {
      leveledDepartmentIds.add(team.department_id);
    }
  }
  // Same team scope as service-reporting: tickets without team or of a team
  // the reporting person belongs to; here also teams the ticket passed.
  const activeDepartmentIds = new Set(
    (departmentMembershipsResult.data ?? []).map(
      (row: Row) => row.department_id,
    ),
  );
  const readableTeamIds = new Set<string>(
    (membershipsResult.data ?? []).flatMap((row: Row) => {
      const team = one<Row>(row.teams);
      return isUuid(row.team_id) &&
        team?.active === true &&
        activeDepartmentIds.has(team.department_id)
        ? [row.team_id]
        : [];
    }),
  );
  const visible = (currentTeamId: unknown, passedTeamIds: unknown[]) =>
    !isUuid(currentTeamId) ||
    [currentTeamId, ...passedTeamIds].some(
      (id) => isUuid(id) && readableTeamIds.has(id),
    );

  const tickets: Row[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await admin
      .from("tickets")
      .select(
        "id, department_id, category_id, assigned_team_id, resolved_at, closed_at",
      )
      .eq("tenant_id", action.tenantId)
      .or(
        `and(resolved_at.gte.${startsAt},resolved_at.lte.${endsAt}),and(resolved_at.is.null,closed_at.gte.${startsAt},closed_at.lte.${endsAt})`,
      )
      .order("id")
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new HttpError(500, "reporting_query_failed");
    tickets.push(...(data ?? []));
    if ((data ?? []).length < PAGE_SIZE) break;
    if (tickets.length >= MAX_REPORT_TICKETS) {
      throw new HttpError(
        413,
        "reporting_result_limit_exceeded",
        "Der Berichtszeitraum enthält zu viele Tickets.",
      );
    }
  }

  const changesByTicket = new Map<
    string,
    (LevelChange & { teams: unknown[] })[]
  >();
  const changePages = await Promise.all(
    chunks(
      tickets.map((ticket) => String(ticket.id)),
      ID_CHUNK,
    ).map((ids) =>
      admin
        .from("ticket_support_level_changes")
        .select(
          "ticket_id, from_level, to_level, from_team_id, to_team_id, kind, created_at, seq",
        )
        .eq("tenant_id", action.tenantId)
        .in("ticket_id", ids)
        .order("seq", { ascending: true })
        .limit(5000),
    ),
  );
  for (const page of changePages) {
    if (page.error) throw new HttpError(500, "reporting_query_failed");
    for (const row of page.data ?? []) {
      const list = changesByTicket.get(row.ticket_id) ?? [];
      list.push({
        ticketId: row.ticket_id,
        fromLevel: levelOrNull(row.from_level),
        toLevel: levelOrNull(row.to_level),
        kind: row.kind,
        createdAt: row.created_at,
        teams: [row.from_team_id, row.to_team_id],
      });
      changesByTicket.set(row.ticket_id, list);
    }
  }

  const resolvedTickets: ReportTicket[] = tickets.flatMap((ticket) => {
    const history = changesByTicket.get(String(ticket.id)) ?? [];
    if (
      !visible(
        ticket.assigned_team_id,
        history.flatMap((c) => c.teams),
      )
    ) {
      return [];
    }
    return [
      {
        id: String(ticket.id),
        departmentId: String(ticket.department_id),
        categoryId: isUuid(ticket.category_id) ? ticket.category_id : null,
        currentLevel: isUuid(ticket.assigned_team_id)
          ? (teamLevel.get(ticket.assigned_team_id) ?? null)
          : null,
        resolvedAt:
          typeof ticket.resolved_at === "string"
            ? ticket.resolved_at
            : typeof ticket.closed_at === "string"
              ? ticket.closed_at
              : null,
      },
    ];
  });

  const { data: periodRows, error: periodError } = await admin
    .from("ticket_support_level_changes")
    .select(
      "ticket_id, from_level, to_level, from_team_id, to_team_id, kind, created_at, tickets(category_id, assigned_team_id)",
    )
    .eq("tenant_id", action.tenantId)
    .in("kind", ["escalated", "returned"])
    .gte("created_at", startsAt)
    .lte("created_at", endsAt)
    .limit(MAX_REPORT_TICKETS);
  if (periodError) throw new HttpError(500, "reporting_query_failed");
  const periodChanges = (periodRows ?? []).flatMap((row: Row) => {
    const ticket = one<Row>(row.tickets);
    if (
      !ticket ||
      !visible(ticket.assigned_team_id, [row.from_team_id, row.to_team_id])
    ) {
      return [];
    }
    return [
      {
        ticketId: String(row.ticket_id),
        fromLevel: levelOrNull(row.from_level),
        toLevel: levelOrNull(row.to_level),
        kind: row.kind as LevelChangeKind,
        createdAt: String(row.created_at),
        categoryId: isUuid(ticket?.category_id) ? ticket.category_id : null,
      },
    ];
  });

  const categoryIds = [
    ...new Set(
      periodChanges
        .map((change: { categoryId: string | null }) => change.categoryId)
        .filter(isUuid),
    ),
  ];
  const categoryNames = new Map<string, string>();
  if (categoryIds.length) {
    const { data, error } = await admin
      .from("ticket_categories")
      .select("id, name")
      .eq("tenant_id", action.tenantId)
      .in("id", categoryIds);
    if (error) throw new HttpError(500, "reporting_query_failed");
    for (const row of data ?? []) categoryNames.set(row.id, row.name);
  }

  return {
    period: { startsAt, endsAt },
    levelsConfigured: leveledDepartmentIds.size > 0,
    ...buildSupportLevelReport({
      range: { startsAt, endsAt },
      resolvedTickets,
      changesByTicket,
      periodChanges,
      leveledDepartmentIds,
      categoryNames,
    }),
  };
}

const handler = withSupabase({ auth: "user" }, async (request, context) => {
  if (request.method !== "POST") {
    return json(request, { error: { code: "method_not_allowed" } }, 405);
  }
  const action = parseAction(await request.json().catch(() => null));
  const actorId = context.userClaims?.id;
  if (!action || !isUuid(actorId)) {
    return json(request, { error: { code: "invalid_request" } }, 422);
  }
  const admin = context.supabaseAdmin;
  try {
    const data =
      action.type === "getTicket"
        ? await getTicket(admin, actorId, action)
        : action.type === "teamAgents"
          ? await teamAgents(admin, actorId, action)
          : action.type === "handover"
            ? await handover(admin, actorId, action)
            : action.type === "queueLevels"
              ? await queueLevels(admin, actorId, action)
              : await report(admin, actorId, action);
    return json(request, { data });
  } catch (error) {
    if (error instanceof HttpError) {
      return json(
        request,
        {
          error: {
            code: error.code,
            ...(error.message !== error.code ? { message: error.message } : {}),
          },
        },
        error.status,
      );
    }
    console.error("ticket-support-levels failed", error);
    return json(request, { error: { code: "support_levels_failed" } }, 500);
  }
});

export default {
  fetch(request: Request): Response | Promise<Response> {
    if (request.method === "OPTIONS") return noContent(request);
    return handler(request);
  },
};
