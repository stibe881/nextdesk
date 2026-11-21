import { withSupabase } from "@supabase/server";
import {
  isRecord,
  isUuid,
  json,
  noContent,
  parseJsonObject,
} from "../_shared/http.ts";
import { resolveTenantFeatureStates } from "../_shared/tenant-features.ts";
import {
  addCalendarDays,
  computeSchedule,
  type DependencyType,
  isIsoDate,
  ScheduleCycleError,
} from "../_shared/project-schedule.ts";
import {
  buildSnapshot,
  instantiateSnapshot,
  normalizeSnapshot,
} from "../_shared/project-template.ts";
import {
  computeWorkload,
  type WorkItem,
  type WorkItemKind,
} from "../_shared/project-workload.ts";
import {
  accessFor,
  ATTACHMENT_CONTENT_TYPES,
  BILLING_KINDS,
  DEPENDENCY_TYPES,
  HEALTH,
  LINK_COLUMNS,
  LINK_KINDS,
  type LinkKind,
  type Permissions,
  PRIORITIES,
  type ProjectAccess,
  PROJECT_STATUSES,
  swissToday,
  TASK_KINDS,
  TASK_STATUSES,
} from "./logic.ts";

/**
 * Projekte: Projektmanagement auf derselben Basis wie Tickets.
 *
 * Alles läuft mit der Service-Rolle, nachdem Mitgliedschaft, Modul und Recht
 * geprüft sind; die Tabellen haben keine Client-Richtlinien. Zugriff auf ein
 * Projekt hat, wer project.manage oder project.read besitzt, das Projekt
 * leitet oder in project_members steht. Gäste (guest_read, guest_comment)
 * sehen nur den Plan sowie als «extern» markierte Dokumente und Kommentare.
 */

// deno-lint-ignore no-explicit-any
type Admin = any;
type Row = Record<string, unknown>;

export type Ctx = {
  admin: Admin;
  // deno-lint-ignore no-explicit-any
  userClient: any;
  actorId: string;
  tenantId: string;
  permissions: Permissions;
};

const FEATURE = "projects.management";
const BUCKET = "record-attachments";
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const MAX_ATTACHMENTS = 60;
const MAX_TASKS = 1000;

const PROJECT_SELECT =
  "id, tenant_id, project_number, title, description, status, health, health_note, manager_id, department_id, customer_organization_id, location_id, starts_on, ends_on, budget_minutes, budget_amount_cents, hourly_rate_cents, currency, schedule_mode, source_ticket_id, source_shop_order_id, template_id, completed_at, archived_at, created_by, created_at, updated_at";
const TASK_SELECT =
  "id, project_id, parent_task_id, kind, title, description, status, priority, assignee_id, team_id, starts_on, due_on, estimated_minutes, progress_percent, position, completed_at, created_at, updated_at";

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const forbidden = () =>
  new HttpError(403, "forbidden", "Dafür fehlt die Berechtigung.");
const notFound = (what = "Der Eintrag") =>
  new HttpError(404, "not_found", `${what} wurde nicht gefunden.`);
const invalid = (message: string) =>
  new HttpError(422, "invalid_data", message);
const failed = () =>
  new HttpError(
    500,
    "projects_failed",
    "Die Änderung konnte nicht gespeichert werden.",
  );

// ---------------------------------------------------------------------------
// Eingaben
// ---------------------------------------------------------------------------

function requiredText(value: unknown, max: number, field: string): string {
  if (typeof value !== "string") throw invalid(`${field} fehlt.`);
  const trimmed = value.trim();
  if (
    !trimmed ||
    trimmed.includes("\u0000") ||
    Array.from(trimmed).length > max
  ) {
    throw invalid(`${field} ist ungültig.`);
  }
  return trimmed;
}

function optionalText(
  value: unknown,
  max: number,
  field: string,
): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (
    typeof value !== "string" ||
    value.includes("\u0000") ||
    value.length > max
  ) {
    throw invalid(`${field} ist ungültig.`);
  }
  return value.trim() ? value : null;
}

function optionalUuid(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (!isUuid(value)) throw invalid("Die Auswahl ist ungültig.");
  return value.toLowerCase();
}

function requiredUuid(value: unknown): string {
  if (!isUuid(value)) throw invalid("Die Auswahl ist ungültig.");
  return value.toLowerCase();
}

function optionalInteger(
  value: unknown,
  min: number,
  max: number,
  field: string,
) {
  if (value === undefined || value === null || value === "") return null;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  ) {
    throw invalid(`${field} ist ungültig.`);
  }
  return value;
}

function optionalDate(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (!isIsoDate(value)) throw invalid(`${field} ist kein gültiges Datum.`);
  return value;
}

function oneOf<T extends string>(
  value: unknown,
  allowed: ReadonlySet<string>,
  field: string,
): T {
  if (typeof value !== "string" || !allowed.has(value)) {
    throw invalid(`${field} ist ungültig.`);
  }
  return value as T;
}

const has = (body: Row, key: string) => Object.hasOwn(body, key);

// ---------------------------------------------------------------------------
// Rechte
// ---------------------------------------------------------------------------

async function hasPermission(
  admin: Admin,
  userId: string,
  tenantId: string,
  code: string,
) {
  const { data, error } = await admin.rpc("shop_has_permission", {
    p_user_id: userId,
    p_tenant_id: tenantId,
    p_permission_code: code,
  });
  return !error && data === true;
}

async function loadPermissions(
  admin: Admin,
  userId: string,
  tenantId: string,
): Promise<Permissions> {
  const [read, create, manage] = await Promise.all([
    hasPermission(admin, userId, tenantId, "project.read"),
    hasPermission(admin, userId, tenantId, "project.create"),
    hasPermission(admin, userId, tenantId, "project.manage"),
  ]);
  return { read: read || manage, create: create || manage, manage };
}

async function isActiveMember(admin: Admin, userId: string, tenantId: string) {
  const { data } = await admin
    .from("tenant_memberships")
    .select("user_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  return !!data;
}

async function memberRole(ctx: Ctx, projectId: string): Promise<string | null> {
  const { data } = await ctx.admin
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", ctx.actorId)
    .maybeSingle();
  return (data?.role as string | undefined) ?? null;
}

async function loadProject(
  ctx: Ctx,
  projectId: unknown,
): Promise<{ project: Row; access: ProjectAccess }> {
  const id = requiredUuid(projectId);
  const { data, error } = await ctx.admin
    .from("projects")
    .select(PROJECT_SELECT)
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw failed();
  if (!data) throw notFound("Das Projekt");
  const access = accessFor(
    ctx.permissions,
    data.manager_id === ctx.actorId,
    await memberRole(ctx, id),
  );
  // Unknown and unauthorised look the same from outside.
  if (!access) throw notFound("Das Projekt");
  return { project: data as Row, access };
}

/**
 * Lists of people, customers, templates and linkable records are for people
 * who work in the tenant, not for external guests: a right, a project they
 * lead, or a membership that is not a guest role.
 */
async function assertInternal(ctx: Ctx) {
  if (ctx.permissions.read || ctx.permissions.create) return;
  const [members, led] = await Promise.all([
    ctx.admin
      .from("project_members")
      .select("role")
      .eq("tenant_id", ctx.tenantId)
      .eq("user_id", ctx.actorId),
    ctx.admin
      .from("projects")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", ctx.tenantId)
      .eq("manager_id", ctx.actorId),
  ]);
  const works = ((members.data ?? []) as Row[]).some(
    (row) => row.role === "manager" || row.role === "member",
  );
  if (!works && (led.count ?? 0) === 0) throw forbidden();
}

async function loadTask(ctx: Ctx, taskId: unknown) {
  const id = requiredUuid(taskId);
  const { data, error } = await ctx.admin
    .from("project_tasks")
    .select(TASK_SELECT)
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw failed();
  if (!data) throw notFound("Das Element");
  const loaded = await loadProject(ctx, data.project_id);
  return { task: data as Row, ...loaded };
}

function requireEdit(access: ProjectAccess) {
  if (!access.canEdit) throw forbidden();
}
function requireAdmin(access: ProjectAccess) {
  if (!access.canAdmin) throw forbidden();
}

async function assertTenantMember(ctx: Ctx, userId: string | null) {
  if (!userId) return;
  if (!(await isActiveMember(ctx.admin, userId, ctx.tenantId))) {
    throw invalid("Die Person gehört nicht zu diesem Mandanten.");
  }
}

async function assertTenantRow(
  ctx: Ctx,
  table: string,
  id: string | null,
  what: string,
) {
  if (!id) return;
  const { data } = await ctx.admin
    .from(table)
    .select("id")
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id)
    .maybeSingle();
  if (!data) throw invalid(`${what} wurde nicht gefunden.`);
}

// ---------------------------------------------------------------------------
// Lesen
// ---------------------------------------------------------------------------

/** `in` filters travel in the URL, so long id lists are sent in portions. */
async function selectIn(
  admin: Admin,
  table: string,
  columns: string,
  column: string,
  ids: readonly string[],
): Promise<Row[]> {
  const rows: Row[] = [];
  for (let index = 0; index < ids.length; index += 80) {
    const { data, error } = await admin
      .from(table)
      .select(columns)
      .in(column, ids.slice(index, index + 80));
    if (error) throw failed();
    rows.push(...((data ?? []) as Row[]));
  }
  return rows;
}

async function names(
  admin: Admin,
  ids: Iterable<unknown>,
): Promise<Map<string, string>> {
  const unique = [
    ...new Set(
      [...ids].filter((id): id is string => typeof id === "string" && !!id),
    ),
  ];
  const rows = await selectIn(
    admin,
    "user_profiles",
    "id, display_name",
    "id",
    unique,
  );
  return new Map(
    rows.map((row) => [
      row.id as string,
      (row.display_name as string) || "Unbekannte Person",
    ]),
  );
}

const ATTACHMENT_SELECT =
  "id, project_id, project_task_id, storage_object_path, original_filename, content_type, byte_size, uploaded_by, created_at";

/** Attachments of the project itself and of every element in its plan. */
async function projectAttachments(ctx: Ctx, projectId: string): Promise<Row[]> {
  const [own, ofTasks] = await Promise.all([
    ctx.admin
      .from("record_attachments")
      .select(ATTACHMENT_SELECT)
      .eq("tenant_id", ctx.tenantId)
      .eq("project_id", projectId),
    ctx.admin
      .from("record_attachments")
      .select(`${ATTACHMENT_SELECT}, project_tasks!inner(project_id)`)
      .eq("tenant_id", ctx.tenantId)
      .eq("project_tasks.project_id", projectId),
  ]);
  if (own.error || ofTasks.error) throw failed();
  return [
    ...((own.data ?? []) as Row[]),
    ...((ofTasks.data ?? []) as Row[]),
  ].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}

async function logEvent(
  ctx: Ctx,
  projectId: string,
  taskId: string | null,
  type: string,
  payload: Row = {},
) {
  await ctx.admin.from("project_events").insert({
    tenant_id: ctx.tenantId,
    project_id: projectId,
    task_id: taskId,
    actor_id: ctx.actorId,
    event_type: type,
    payload,
  });
}

async function audit(
  ctx: Ctx,
  action: string,
  projectId: string,
  metadata: Row = {},
) {
  await ctx.admin.from("audit_logs").insert({
    tenant_id: ctx.tenantId,
    actor_id: ctx.actorId,
    action,
    entity_type: "project",
    entity_id: projectId,
    metadata,
  });
}

type Stats = {
  taskCount: number;
  doneCount: number;
  progressPercent: number;
  estimatedMinutes: number;
  bookedMinutes: number;
  overdueTasks: number;
  overdueMilestones: number;
  nextMilestone: { title: string; on: string } | null;
  latestDueOn: string | null;
};

const EMPTY_STATS: Stats = {
  taskCount: 0,
  doneCount: 0,
  progressPercent: 0,
  estimatedMinutes: 0,
  bookedMinutes: 0,
  overdueTasks: 0,
  overdueMilestones: 0,
  nextMilestone: null,
  latestDueOn: null,
};

async function loadStats(
  ctx: Ctx,
  projectIds: string[] | null,
): Promise<Map<string, Stats>> {
  const { data, error } = await ctx.admin.rpc("project_stats", {
    p_tenant_id: ctx.tenantId,
    p_project_ids: projectIds,
  });
  if (error) throw failed();
  return new Map(
    (data ?? []).map((row: Row) => [
      row.project_id as string,
      {
        taskCount: Number(row.task_count),
        doneCount: Number(row.done_count),
        progressPercent: Number(row.progress_percent),
        estimatedMinutes: Number(row.estimated_minutes),
        bookedMinutes: Number(row.booked_minutes),
        overdueTasks: Number(row.overdue_tasks),
        overdueMilestones: Number(row.overdue_milestones),
        nextMilestone: row.next_milestone_on
          ? {
              title: String(row.next_milestone_title),
              on: String(row.next_milestone_on),
            }
          : null,
        latestDueOn: (row.latest_due_on as string | null) ?? null,
      },
    ]),
  );
}

function projectDto(
  project: Row,
  stats: Stats,
  lookup: Lookup,
  guest: boolean,
) {
  const rate = project.hourly_rate_cents as number | null;
  return {
    id: project.id,
    number: project.project_number,
    title: project.title,
    description: project.description,
    status: project.status,
    health: project.health,
    healthNote: project.health_note,
    managerId: project.manager_id,
    managerName: lookup.people.get(project.manager_id as string) ?? null,
    departmentId: guest ? null : project.department_id,
    customerOrganizationId: guest ? null : project.customer_organization_id,
    customerName:
      lookup.customers.get(project.customer_organization_id as string) ?? null,
    locationId: guest ? null : project.location_id,
    locationName: lookup.locations.get(project.location_id as string) ?? null,
    startsOn: project.starts_on,
    endsOn: project.ends_on,
    budgetMinutes: guest ? null : project.budget_minutes,
    budgetAmountCents: guest ? null : project.budget_amount_cents,
    hourlyRateCents: guest ? null : rate,
    currency: project.currency,
    scheduleMode: project.schedule_mode,
    sourceTicketId: guest ? null : project.source_ticket_id,
    sourceShopOrderId: guest ? null : project.source_shop_order_id,
    completedAt: project.completed_at,
    archivedAt: project.archived_at,
    createdAt: project.created_at,
    updatedAt: project.updated_at,
    stats: {
      ...stats,
      estimatedMinutes: guest ? 0 : stats.estimatedMinutes,
      bookedMinutes: guest ? 0 : stats.bookedMinutes,
      actualAmountCents:
        guest || rate === null
          ? null
          : Math.round((stats.bookedMinutes * rate) / 60),
    },
  };
}

type Lookup = {
  people: Map<string, string>;
  customers: Map<string, string>;
  locations: Map<string, string>;
};

async function lookupFor(
  ctx: Ctx,
  projects: Row[],
  extraPeople: Iterable<unknown> = [],
): Promise<Lookup> {
  const customerIds = [
    ...new Set(projects.map((p) => p.customer_organization_id).filter(Boolean)),
  ];
  const locationIds = [
    ...new Set(projects.map((p) => p.location_id).filter(Boolean)),
  ];
  const [people, customers, locations] = await Promise.all([
    names(ctx.admin, [...projects.map((p) => p.manager_id), ...extraPeople]),
    selectIn(
      ctx.admin,
      "customer_organizations",
      "id, name",
      "id",
      customerIds as string[],
    ),
    selectIn(
      ctx.admin,
      "asset_locations",
      "id, name",
      "id",
      locationIds as string[],
    ),
  ]);
  const toMap = (rows: Row[]) =>
    new Map(rows.map((row) => [row.id as string, row.name as string]));
  return { people, customers: toMap(customers), locations: toMap(locations) };
}

async function visibleProjects(
  ctx: Ctx,
  includeArchived: boolean,
): Promise<Row[]> {
  // Filters first: after order() or limit() the client offers no filters.
  let filter = ctx.admin
    .from("projects")
    .select(PROJECT_SELECT)
    .eq("tenant_id", ctx.tenantId);
  if (!includeArchived) filter = filter.is("archived_at", null);
  const { data, error } = await filter
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw failed();
  const projects = (data ?? []) as Row[];
  if (ctx.permissions.read) return projects;
  const { data: memberships } = await ctx.admin
    .from("project_members")
    .select("project_id")
    .eq("tenant_id", ctx.tenantId)
    .eq("user_id", ctx.actorId);
  const mine = new Set(
    (memberships ?? []).map((row: Row) => row.project_id as string),
  );
  return projects.filter(
    (project) =>
      project.manager_id === ctx.actorId || mine.has(project.id as string),
  );
}

type Milestone = { id: string; title: string; dueOn: string; done: boolean };

/** Dated milestones per project, for the timeline across all projects. */
async function milestonesOf(
  ctx: Ctx,
  projectIds: readonly string[],
): Promise<Map<string, Milestone[]>> {
  const result = new Map<string, Milestone[]>();
  for (let index = 0; index < projectIds.length; index += 80) {
    const { data, error } = await ctx.admin
      .from("project_tasks")
      .select("id, project_id, title, due_on, status")
      .eq("tenant_id", ctx.tenantId)
      .eq("kind", "milestone")
      .not("due_on", "is", null)
      .in("project_id", projectIds.slice(index, index + 80))
      .order("due_on")
      .limit(2000);
    if (error) throw failed();
    for (const row of (data ?? []) as Row[]) {
      const key = row.project_id as string;
      const list = result.get(key) ?? [];
      list.push({
        id: row.id as string,
        title: row.title as string,
        dueOn: row.due_on as string,
        done: row.status === "done",
      });
      result.set(key, list);
    }
  }
  return result;
}

async function overview(ctx: Ctx, body: Row) {
  const projects = await visibleProjects(ctx, body.includeArchived === true);
  const [stats, lookup, memberships, milestones] = await Promise.all([
    projects.length
      ? loadStats(
          ctx,
          projects.map((p) => p.id as string),
        )
      : new Map<string, Stats>(),
    lookupFor(ctx, projects),
    ctx.admin
      .from("project_members")
      .select("project_id, role")
      .eq("tenant_id", ctx.tenantId)
      .eq("user_id", ctx.actorId),
    milestonesOf(
      ctx,
      projects.map((p) => p.id as string),
    ),
  ]);
  const roles = new Map<string, string>(
    (memberships.data ?? []).map((row: Row) => [
      row.project_id as string,
      row.role as string,
    ]),
  );
  return {
    permissions: ctx.permissions,
    projects: projects.map((project) => {
      const access = accessFor(
        ctx.permissions,
        project.manager_id === ctx.actorId,
        roles.get(project.id as string) ?? null,
      );
      return {
        ...projectDto(
          project,
          stats.get(project.id as string) ?? EMPTY_STATS,
          lookup,
          !!access?.isGuest,
        ),
        role: access?.role ?? "viewer",
        milestones: milestones.get(project.id as string) ?? [],
      };
    }),
  };
}

async function options(ctx: Ctx) {
  await assertInternal(ctx);
  const [
    members,
    teams,
    customers,
    locations,
    departments,
    templates,
    settings,
  ] = await Promise.all([
    ctx.admin
      .from("tenant_memberships")
      .select("user_id")
      .eq("tenant_id", ctx.tenantId)
      .eq("status", "active")
      .limit(2000),
    ctx.admin
      .from("teams")
      .select("id, name")
      .eq("tenant_id", ctx.tenantId)
      .eq("active", true)
      .order("name"),
    ctx.admin
      .from("customer_organizations")
      .select("id, name")
      .eq("tenant_id", ctx.tenantId)
      .eq("active", true)
      .order("name"),
    ctx.admin
      .from("asset_locations")
      .select("id, name")
      .eq("tenant_id", ctx.tenantId)
      .eq("active", true)
      .order("name"),
    ctx.admin
      .from("departments")
      .select("id, name")
      .eq("tenant_id", ctx.tenantId)
      .eq("active", true)
      .order("name"),
    ctx.admin
      .from("project_templates")
      .select("id, name, description, snapshot, updated_at")
      .eq("tenant_id", ctx.tenantId)
      .order("name"),
    loadSettings(ctx),
  ]);
  const people = await names(
    ctx.admin,
    (members.data ?? []).map((row: Row) => row.user_id),
  );
  const pick = (rows: Row[] | null) =>
    (rows ?? []).map((row) => ({ id: row.id, name: row.name }));
  return {
    people: [...people]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "de")),
    teams: pick(teams.data),
    customers: pick(customers.data),
    locations: pick(locations.data),
    departments: pick(departments.data),
    templates: (templates.data ?? []).map((row: Row) => {
      const snapshot = normalizeSnapshot(row.snapshot);
      return {
        id: row.id,
        name: row.name,
        description: row.description,
        itemCount: snapshot?.items.length ?? 0,
        durationDays: snapshot?.durationDays ?? null,
        updatedAt: row.updated_at,
      };
    }),
    settings,
  };
}

async function loadSettings(ctx: Ctx) {
  const { data } = await ctx.admin
    .from("project_settings")
    .select("ticket_workload_minutes, daily_capacity_minutes")
    .eq("tenant_id", ctx.tenantId)
    .maybeSingle();
  return {
    ticketWorkloadMinutes: Number(data?.ticket_workload_minutes ?? 30),
    dailyCapacityMinutes: Number(data?.daily_capacity_minutes ?? 480),
  };
}

async function projectTasks(ctx: Ctx, projectId: string): Promise<Row[]> {
  const { data, error } = await ctx.admin
    .from("project_tasks")
    .select(TASK_SELECT)
    .eq("project_id", projectId)
    .order("position")
    .order("created_at")
    .limit(MAX_TASKS);
  if (error) throw failed();
  return (data ?? []) as Row[];
}

async function projectDependencies(
  ctx: Ctx,
  projectId: string,
): Promise<Row[]> {
  const { data, error } = await ctx.admin
    .from("project_task_dependencies")
    .select("id, predecessor_id, successor_id, dependency_type, lag_days")
    .eq("project_id", projectId);
  if (error) throw failed();
  return (data ?? []) as Row[];
}

async function getProject(ctx: Ctx, body: Row) {
  const { project, access } = await loadProject(ctx, body.projectId);
  const projectId = project.id as string;
  const guest = access.isGuest;
  const taskIdFilter = "project_tasks!inner(project_id)";

  const [tasks, dependencies, stats, checklist, comments, documents, members] =
    await Promise.all([
      projectTasks(ctx, projectId),
      projectDependencies(ctx, projectId),
      loadStats(ctx, [projectId]),
      ctx.admin
        .from("project_task_checklist_items")
        .select(
          `id, task_id, description, position, completed_at, ${taskIdFilter}`,
        )
        .eq("project_tasks.project_id", projectId)
        .order("position")
        .order("created_at")
        .limit(5000),
      (() => {
        let filter = ctx.admin
          .from("project_comments")
          .select(
            "id, task_id, author_id, visibility, body, edited_at, created_at",
          )
          .eq("project_id", projectId);
        if (guest) filter = filter.eq("visibility", "external");
        return filter.order("created_at").limit(1000);
      })(),
      (() => {
        let filter = ctx.admin
          .from("project_documents")
          .select(
            "id, title, body, visibility, position, updated_by, updated_at, created_at",
          )
          .eq("project_id", projectId);
        if (guest) filter = filter.eq("visibility", "external");
        return filter.order("position").order("created_at");
      })(),
      ctx.admin
        .from("project_members")
        .select("user_id, role, created_at")
        .eq("project_id", projectId),
    ]);

  const internal = guest
    ? null
    : await Promise.all([
        ctx.admin
          .from("ticket_time_entries")
          .select(
            `id, project_task_id, author_id, minutes, billing_kind, note, started_at, created_at, ${taskIdFilter}`,
          )
          .eq("project_tasks.project_id", projectId)
          .order("created_at", { ascending: false })
          .limit(2000),
        ctx.admin.rpc("project_link_details", {
          p_tenant_id: ctx.tenantId,
          p_project_id: projectId,
        }),
        ctx.admin
          .from("project_events")
          .select("id, task_id, actor_id, event_type, payload, created_at")
          .eq("project_id", projectId)
          .order("created_at", { ascending: false })
          .limit(100),
        projectAttachments(ctx, projectId).then((data) => ({ data })),
        ctx.admin
          .from("project_invitations")
          .select("id, email, role, expires_at, created_at")
          .eq("project_id", projectId)
          .eq("status", "sent"),
      ]);
  const [timeEntries, links, events, attachments, invitations] = internal ?? [];

  const lookup = await lookupFor(
    ctx,
    [project],
    [
      ...tasks.map((task) => task.assignee_id),
      ...(comments.data ?? []).map((row: Row) => row.author_id),
      ...(members.data ?? []).map((row: Row) => row.user_id),
      ...(timeEntries?.data ?? []).map((row: Row) => row.author_id),
      ...(events?.data ?? []).map((row: Row) => row.actor_id),
      ...(links?.data ?? []).map((row: Row) => row.assignee_id),
      ...(attachments?.data ?? []).map((row: Row) => row.uploaded_by),
      ...(documents.data ?? []).map((row: Row) => row.updated_by),
    ],
  );
  const person = (id: unknown) => lookup.people.get(id as string) ?? null;

  const booked = new Map<string, number>();
  for (const entry of (timeEntries?.data ?? []) as Row[]) {
    const key = entry.project_task_id as string;
    booked.set(key, (booked.get(key) ?? 0) + Number(entry.minutes));
  }
  const checklistByTask = new Map<string, Row[]>();
  for (const item of (checklist.data ?? []) as Row[]) {
    const key = item.task_id as string;
    checklistByTask.set(key, [...(checklistByTask.get(key) ?? []), item]);
  }

  const memberList = [
    ...(project.manager_id
      ? [
          {
            userId: project.manager_id,
            name: person(project.manager_id),
            role: "manager",
            lead: true,
          },
        ]
      : []),
    ...((members.data ?? []) as Row[])
      .filter((row) => row.user_id !== project.manager_id)
      .map((row) => ({
        userId: row.user_id,
        name: person(row.user_id),
        role: row.role,
        lead: false,
      })),
  ];

  return {
    project: projectDto(
      project,
      stats.get(projectId) ?? EMPTY_STATS,
      lookup,
      guest,
    ),
    access,
    tasks: tasks.map((task) => ({
      id: task.id,
      parentId: task.parent_task_id,
      kind: task.kind,
      title: task.title,
      description: task.description,
      status: task.status,
      priority: task.priority,
      assigneeId: task.assignee_id,
      assigneeName: person(task.assignee_id),
      teamId: guest ? null : task.team_id,
      startsOn: task.starts_on,
      dueOn: task.due_on,
      estimatedMinutes: guest ? null : task.estimated_minutes,
      progressPercent: task.progress_percent,
      position: task.position,
      completedAt: task.completed_at,
      bookedMinutes: guest ? 0 : (booked.get(task.id as string) ?? 0),
      checklist: (checklistByTask.get(task.id as string) ?? []).map((item) => ({
        id: item.id,
        description: item.description,
        done: !!item.completed_at,
      })),
    })),
    dependencies: dependencies.map((row) => ({
      id: row.id,
      predecessorId: row.predecessor_id,
      successorId: row.successor_id,
      type: row.dependency_type,
      lagDays: row.lag_days,
    })),
    comments: ((comments.data ?? []) as Row[]).map((row) => ({
      id: row.id,
      taskId: row.task_id,
      authorId: row.author_id,
      authorName: person(row.author_id) ?? "Unbekannte Person",
      visibility: row.visibility,
      body: row.body,
      createdAt: row.created_at,
      mine: row.author_id === ctx.actorId,
    })),
    documents: ((documents.data ?? []) as Row[]).map((row) => ({
      id: row.id,
      title: row.title,
      body: row.body,
      visibility: row.visibility,
      position: row.position,
      updatedByName: person(row.updated_by),
      updatedAt: row.updated_at,
    })),
    members: guest ? memberList.filter((member) => member.lead) : memberList,
    invitations: ((invitations?.data ?? []) as Row[]).map((row) => ({
      id: row.id,
      email: row.email,
      role: row.role,
      expiresAt: row.expires_at,
    })),
    timeEntries: ((timeEntries?.data ?? []) as Row[]).map((row) => ({
      id: row.id,
      taskId: row.project_task_id,
      authorId: row.author_id,
      authorName: person(row.author_id) ?? "Unbekannte Person",
      minutes: row.minutes,
      billingKind: row.billing_kind,
      note: row.note,
      startedAt: row.started_at,
      createdAt: row.created_at,
      mine: row.author_id === ctx.actorId,
    })),
    links: ((links?.data ?? []) as Row[]).map((row) => ({
      id: row.link_id,
      taskId: row.task_id,
      targetKind: row.target_kind,
      targetId: row.target_id,
      label: row.label ?? "Unbekannt",
      detail: row.detail,
      state: row.state,
      isClosed: row.is_closed === true,
      assigneeName: person(row.assignee_id),
      bookedMinutes: Number(row.booked_minutes ?? 0),
      note: row.note,
    })),
    events: ((events?.data ?? []) as Row[]).map((row) => ({
      id: row.id,
      taskId: row.task_id,
      actorName: person(row.actor_id),
      type: row.event_type,
      payload: row.payload,
      createdAt: row.created_at,
    })),
    attachments: ((attachments?.data ?? []) as Row[]).map((row) => ({
      id: row.id,
      taskId: row.project_task_id,
      filename: row.original_filename,
      contentType: row.content_type,
      byteSize: row.byte_size,
      uploadedByName: person(row.uploaded_by),
      createdAt: row.created_at,
    })),
  };
}

// ---------------------------------------------------------------------------
// Termine
// ---------------------------------------------------------------------------

type PlannedChange = {
  id: string;
  title: string;
  startsOn: string | null;
  dueOn: string | null;
  previousStartsOn: string | null;
  previousDueOn: string | null;
};

async function plannedChanges(
  ctx: Ctx,
  projectId: string,
): Promise<PlannedChange[]> {
  const [tasks, dependencies] = await Promise.all([
    projectTasks(ctx, projectId),
    projectDependencies(ctx, projectId),
  ]);
  let changes;
  try {
    changes = computeSchedule(
      tasks.map((task) => ({
        id: task.id as string,
        parentId: task.parent_task_id as string | null,
        startsOn: task.starts_on as string | null,
        dueOn: task.due_on as string | null,
        done: task.status === "done",
      })),
      dependencies.map((row) => ({
        predecessorId: row.predecessor_id as string,
        successorId: row.successor_id as string,
        type: row.dependency_type as DependencyType,
        lagDays: Number(row.lag_days),
      })),
    );
  } catch (error) {
    if (error instanceof ScheduleCycleError) {
      throw new HttpError(
        409,
        "dependency_cycle",
        "Die Abhängigkeiten bilden einen Kreis.",
      );
    }
    throw error;
  }
  const byId = new Map(tasks.map((task) => [task.id as string, task]));
  return changes.map((change) => {
    const task = byId.get(change.id)!;
    return {
      ...change,
      title: task.title as string,
      previousStartsOn: task.starts_on as string | null,
      previousDueOn: task.due_on as string | null,
    };
  });
}

async function applyChanges(
  ctx: Ctx,
  projectId: string,
  changes: PlannedChange[],
) {
  for (const change of changes) {
    const { error } = await ctx.admin
      .from("project_tasks")
      .update({
        starts_on: change.startsOn,
        due_on: change.dueOn,
        updated_by: ctx.actorId,
      })
      .eq("project_id", projectId)
      .eq("id", change.id);
    if (error) throw failed();
  }
  if (changes.length) {
    await logEvent(ctx, projectId, null, "schedule.shifted", {
      count: changes.length,
      titles: changes.slice(0, 10).map((change) => change.title),
    });
  }
}

/**
 * After anything that can move dates: in automatic mode the cascade is
 * applied at once, in manual mode it is only reported.
 */
async function settleSchedule(ctx: Ctx, project: Row) {
  const changes = await plannedChanges(ctx, project.id as string);
  if (project.schedule_mode === "auto") {
    await applyChanges(ctx, project.id as string, changes);
    return { applied: changes, pending: [] as PlannedChange[] };
  }
  return { applied: [] as PlannedChange[], pending: changes };
}

// ---------------------------------------------------------------------------
// Projekte
// ---------------------------------------------------------------------------

function projectFields(body: Row, partial: boolean): Row {
  const fields: Row = {};
  const set = (
    key: string,
    column: string,
    parse: (value: unknown) => unknown,
  ) => {
    if (!partial || has(body, key)) fields[column] = parse(body[key]);
  };
  if (!partial || has(body, "title"))
    fields.title = requiredText(body.title, 200, "Der Titel");
  set("description", "description", (v) =>
    optionalText(v, 20000, "Die Beschreibung"),
  );
  set("managerId", "manager_id", optionalUuid);
  set("departmentId", "department_id", optionalUuid);
  set("customerOrganizationId", "customer_organization_id", optionalUuid);
  set("locationId", "location_id", optionalUuid);
  set("startsOn", "starts_on", (v) => optionalDate(v, "Der Start"));
  set("endsOn", "ends_on", (v) => optionalDate(v, "Das Ende"));
  set("budgetMinutes", "budget_minutes", (v) =>
    optionalInteger(v, 0, 6000000, "Das Stundenbudget"),
  );
  set("budgetAmountCents", "budget_amount_cents", (v) =>
    optionalInteger(v, 0, 100000000000, "Das Budget"),
  );
  set("hourlyRateCents", "hourly_rate_cents", (v) =>
    optionalInteger(v, 0, 10000000, "Der Stundensatz"),
  );
  if (has(body, "status"))
    fields.status = oneOf(body.status, PROJECT_STATUSES, "Der Status");
  if (has(body, "health"))
    fields.health = oneOf(body.health, HEALTH, "Die Ampel");
  if (has(body, "healthNote"))
    fields.health_note = optionalText(body.healthNote, 500, "Die Begründung");
  if (has(body, "scheduleMode")) {
    fields.schedule_mode = oneOf(
      body.scheduleMode,
      new Set(["auto", "manual"]),
      "Die Terminplanung",
    );
  }
  return fields;
}

async function validateProjectReferences(ctx: Ctx, fields: Row) {
  await Promise.all([
    assertTenantMember(ctx, (fields.manager_id as string | null) ?? null),
    assertTenantRow(
      ctx,
      "departments",
      (fields.department_id as string | null) ?? null,
      "Die Abteilung",
    ),
    assertTenantRow(
      ctx,
      "customer_organizations",
      (fields.customer_organization_id as string | null) ?? null,
      "Der Kunde",
    ),
    assertTenantRow(
      ctx,
      "asset_locations",
      (fields.location_id as string | null) ?? null,
      "Der Standort",
    ),
  ]);
}

function assertDateOrder(start: unknown, end: unknown) {
  if (typeof start === "string" && typeof end === "string" && end < start) {
    throw invalid("Das Ende liegt vor dem Start.");
  }
}

async function insertProject(ctx: Ctx, fields: Row): Promise<Row> {
  const { data: number, error: numberError } = await ctx.admin.rpc(
    "project_next_number",
    {
      p_tenant_id: ctx.tenantId,
    },
  );
  if (numberError || typeof number !== "string") throw failed();
  const { data, error } = await ctx.admin
    .from("projects")
    .insert({
      ...fields,
      tenant_id: ctx.tenantId,
      project_number: number,
      created_by: ctx.actorId,
      updated_by: ctx.actorId,
    })
    .select(PROJECT_SELECT)
    .single();
  if (error || !data) throw failed();
  return data as Row;
}

type NewTask = {
  id: string;
  parentId: string | null;
  level: number;
  kind: string;
  title: string;
  description: string | null;
  priority: string;
  estimatedMinutes: number | null;
  startsOn: string | null;
  dueOn: string | null;
  position: number;
  checklist: string[];
};

/** Parents first, one statement per level, so the hierarchy trigger sees them. */
async function insertStructure(ctx: Ctx, projectId: string, tasks: NewTask[]) {
  const levels = [...new Set(tasks.map((task) => task.level))].sort(
    (a, b) => a - b,
  );
  for (const level of levels) {
    const rows = tasks
      .filter((task) => task.level === level)
      .map((task) => ({
        id: task.id,
        tenant_id: ctx.tenantId,
        project_id: projectId,
        parent_task_id: task.parentId,
        kind: task.kind,
        title: task.title,
        description: task.description,
        priority: task.priority,
        estimated_minutes: task.estimatedMinutes,
        starts_on: task.startsOn,
        due_on: task.dueOn,
        position: task.position,
        created_by: ctx.actorId,
        updated_by: ctx.actorId,
      }));
    const { error } = await ctx.admin.from("project_tasks").insert(rows);
    if (error) throw failed();
  }
  const checklist = tasks.flatMap((task) =>
    task.checklist.map((description, position) => ({
      tenant_id: ctx.tenantId,
      task_id: task.id,
      description,
      position,
      created_by: ctx.actorId,
    })),
  );
  if (checklist.length) {
    const { error } = await ctx.admin
      .from("project_task_checklist_items")
      .insert(checklist);
    if (error) throw failed();
  }
}

/** Removes a half-built project so a failed creation leaves nothing behind. */
async function discardProject(ctx: Ctx, projectId: string) {
  await ctx.admin
    .from("projects")
    .delete()
    .eq("tenant_id", ctx.tenantId)
    .eq("id", projectId);
}

async function createProject(ctx: Ctx, body: Row) {
  if (!ctx.permissions.create) throw forbidden();
  const fields = projectFields(body, false);
  if (!fields.manager_id) fields.manager_id = ctx.actorId;
  await validateProjectReferences(ctx, fields);

  const templateId = optionalUuid(body.templateId);
  let instance = null;
  if (templateId) {
    const { data: template } = await ctx.admin
      .from("project_templates")
      .select("id, snapshot")
      .eq("tenant_id", ctx.tenantId)
      .eq("id", templateId)
      .maybeSingle();
    const snapshot = normalizeSnapshot(template?.snapshot);
    if (!snapshot) throw invalid("Die Vorlage kann nicht verwendet werden.");
    instance = instantiateSnapshot(
      snapshot,
      fields.starts_on as string | null,
      () => crypto.randomUUID(),
    );
    fields.template_id = templateId;
    if (!fields.ends_on && instance.endsOn) fields.ends_on = instance.endsOn;
    if (fields.budget_minutes == null)
      fields.budget_minutes = instance.budgetMinutes;
  }
  assertDateOrder(fields.starts_on, fields.ends_on);

  const project = await insertProject(ctx, fields);
  const projectId = project.id as string;
  try {
    if (instance) {
      await insertStructure(ctx, projectId, instance.tasks);
      if (instance.dependencies.length) {
        const { error } = await ctx.admin
          .from("project_task_dependencies")
          .insert(
            instance.dependencies.map((dependency) => ({
              tenant_id: ctx.tenantId,
              project_id: projectId,
              predecessor_id: dependency.predecessorId,
              successor_id: dependency.successorId,
              dependency_type: dependency.type,
              lag_days: dependency.lagDays,
              created_by: ctx.actorId,
            })),
          );
        if (error) throw failed();
      }
      if (instance.documents.length) {
        const { error } = await ctx.admin.from("project_documents").insert(
          instance.documents.map((document, position) => ({
            tenant_id: ctx.tenantId,
            project_id: projectId,
            title: document.title,
            body: document.body,
            visibility: document.visibility,
            position,
            created_by: ctx.actorId,
            updated_by: ctx.actorId,
          })),
        );
        if (error) throw failed();
      }
    }
  } catch (error) {
    await discardProject(ctx, projectId);
    throw error;
  }
  await logEvent(
    ctx,
    projectId,
    null,
    "project.created",
    templateId ? { templateId } : {},
  );
  await audit(ctx, "project.created", projectId, {
    number: project.project_number,
  });
  return { projectId, number: project.project_number };
}

async function updateProject(ctx: Ctx, body: Row) {
  const { project, access } = await loadProject(ctx, body.projectId);
  requireAdmin(access);
  const fields = projectFields(body, true);
  if (!Object.keys(fields).length) return { updated: false };
  await validateProjectReferences(ctx, fields);
  assertDateOrder(
    fields.starts_on ?? project.starts_on,
    fields.ends_on ?? project.ends_on,
  );
  if (fields.status && fields.status !== project.status) {
    fields.completed_at =
      fields.status === "completed" ? new Date().toISOString() : null;
  }
  const { error } = await ctx.admin
    .from("projects")
    .update({ ...fields, updated_by: ctx.actorId })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", project.id);
  if (error) throw failed();
  const changed: Row = {};
  for (const key of [
    "status",
    "health",
    "manager_id",
    "starts_on",
    "ends_on",
    "schedule_mode",
  ]) {
    if (key in fields && fields[key] !== project[key])
      changed[key] = fields[key];
  }
  if (Object.keys(changed).length) {
    await logEvent(ctx, project.id as string, null, "project.updated", changed);
  }
  const schedule =
    fields.schedule_mode === "auto" && project.schedule_mode !== "auto"
      ? await settleSchedule(ctx, { ...project, schedule_mode: "auto" })
      : null;
  return { updated: true, shifted: schedule?.applied.length ?? 0 };
}

async function archiveProject(ctx: Ctx, body: Row) {
  const { project, access } = await loadProject(ctx, body.projectId);
  requireAdmin(access);
  const archived = body.archived !== false;
  const { error } = await ctx.admin
    .from("projects")
    .update({
      archived_at: archived ? new Date().toISOString() : null,
      updated_by: ctx.actorId,
    })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", project.id);
  if (error) throw failed();
  await logEvent(
    ctx,
    project.id as string,
    null,
    archived ? "project.archived" : "project.restored",
  );
  return { archived };
}

async function removeStoredFiles(ctx: Ctx, projectId: string) {
  const paths = (await projectAttachments(ctx, projectId)).map(
    (row) => row.storage_object_path as string,
  );
  if (paths.length) await ctx.admin.storage.from(BUCKET).remove(paths);
}

async function deleteProject(ctx: Ctx, body: Row) {
  const { project, access } = await loadProject(ctx, body.projectId);
  if (
    !(ctx.permissions.manage || project.manager_id === ctx.actorId) ||
    !access.canAdmin
  ) {
    throw forbidden();
  }
  await removeStoredFiles(ctx, project.id as string);
  const { error } = await ctx.admin
    .from("projects")
    .delete()
    .eq("tenant_id", ctx.tenantId)
    .eq("id", project.id);
  if (error) throw failed();
  await audit(ctx, "project.deleted", project.id as string, {
    number: project.project_number,
    title: project.title,
  });
  return { deleted: true };
}

// ---------------------------------------------------------------------------
// Elemente des Projektplans
// ---------------------------------------------------------------------------

function taskFields(body: Row, partial: boolean, current?: Row): Row {
  const fields: Row = {};
  const set = (
    key: string,
    column: string,
    parse: (value: unknown) => unknown,
  ) => {
    if (!partial || has(body, key)) fields[column] = parse(body[key]);
  };
  if (!partial || has(body, "title"))
    fields.title = requiredText(body.title, 240, "Der Titel");
  if (!partial)
    fields.kind = has(body, "kind")
      ? oneOf(body.kind, TASK_KINDS, "Die Art")
      : "task";
  else if (has(body, "kind"))
    fields.kind = oneOf(body.kind, TASK_KINDS, "Die Art");
  set("description", "description", (v) =>
    optionalText(v, 20000, "Die Beschreibung"),
  );
  set("parentId", "parent_task_id", optionalUuid);
  set("assigneeId", "assignee_id", optionalUuid);
  set("teamId", "team_id", optionalUuid);
  set("startsOn", "starts_on", (v) => optionalDate(v, "Der Start"));
  set("dueOn", "due_on", (v) => optionalDate(v, "Der Termin"));
  set("estimatedMinutes", "estimated_minutes", (v) =>
    optionalInteger(v, 0, 600000, "Die Schätzung"),
  );
  if (has(body, "status"))
    fields.status = oneOf(body.status, TASK_STATUSES, "Der Status");
  if (has(body, "priority"))
    fields.priority = oneOf(body.priority, PRIORITIES, "Die Priorität");
  if (has(body, "progressPercent")) {
    fields.progress_percent =
      optionalInteger(body.progressPercent, 0, 100, "Der Fortschritt") ?? 0;
  }
  if (has(body, "position")) {
    fields.position =
      optionalInteger(body.position, -100000, 100000, "Die Position") ?? 0;
  }

  const kind = (fields.kind ?? current?.kind) as string;
  let start = (
    has(fields, "starts_on") ? fields.starts_on : current?.starts_on
  ) as string | null;
  let due = (has(fields, "due_on") ? fields.due_on : current?.due_on) as
    string | null;
  if (kind === "milestone") {
    // A milestone is a single day.
    const day =
      (has(fields, "due_on") ? due : null) ??
      (has(fields, "starts_on") ? start : null) ??
      due ??
      start;
    start = day;
    due = day;
    fields.starts_on = day;
    fields.due_on = day;
  }
  assertDateOrder(start, due);
  return fields;
}

function applyStatus(ctx: Ctx, fields: Row, current?: Row) {
  if (!fields.status || fields.status === current?.status) return;
  if (fields.status === "done") {
    fields.completed_at = new Date().toISOString();
    fields.completed_by = ctx.actorId;
    fields.progress_percent = 100;
  } else {
    fields.completed_at = null;
    fields.completed_by = null;
    if (current?.status === "done" && !has(fields, "progress_percent"))
      fields.progress_percent = 0;
  }
}

async function validateTaskReferences(
  ctx: Ctx,
  projectId: string,
  fields: Row,
  taskId?: string,
) {
  await Promise.all([
    assertTenantMember(ctx, (fields.assignee_id as string | null) ?? null),
    assertTenantRow(
      ctx,
      "teams",
      (fields.team_id as string | null) ?? null,
      "Das Team",
    ),
  ]);
  if (fields.parent_task_id) {
    if (fields.parent_task_id === taskId)
      throw invalid("Ein Element kann nicht sich selbst untergeordnet sein.");
    const { data } = await ctx.admin
      .from("project_tasks")
      .select("id")
      .eq("project_id", projectId)
      .eq("id", fields.parent_task_id)
      .maybeSingle();
    if (!data)
      throw invalid(
        "Das übergeordnete Element gehört nicht zu diesem Projekt.",
      );
  }
}

function hierarchyError(error: { message?: string; details?: string } | null) {
  const text = `${error?.message ?? ""}`;
  if (
    text.includes("project_task_hierarchy_invalid") ||
    text.includes("project_task_kind_locked")
  ) {
    return new HttpError(
      422,
      "hierarchy_invalid",
      error?.details || "Diese Einordnung ist nicht möglich.",
    );
  }
  return failed();
}

async function createTask(ctx: Ctx, body: Row) {
  const { project, access } = await loadProject(ctx, body.projectId);
  requireEdit(access);
  const projectId = project.id as string;
  const fields = taskFields(body, false);
  applyStatus(ctx, fields);
  await validateTaskReferences(ctx, projectId, fields);
  const { count } = await ctx.admin
    .from("project_tasks")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId);
  if ((count ?? 0) >= MAX_TASKS)
    throw invalid(`Ein Projekt fasst höchstens ${MAX_TASKS} Elemente.`);
  if (!has(body, "position")) {
    const siblings = ctx.admin
      .from("project_tasks")
      .select("position")
      .eq("project_id", projectId);
    const { data } = await (
      fields.parent_task_id
        ? siblings.eq("parent_task_id", fields.parent_task_id)
        : siblings.is("parent_task_id", null)
    )
      .order("position", { ascending: false })
      .limit(1);
    fields.position = Number(data?.[0]?.position ?? -1) + 1;
  }
  const { data, error } = await ctx.admin
    .from("project_tasks")
    .insert({
      ...fields,
      tenant_id: ctx.tenantId,
      project_id: projectId,
      created_by: ctx.actorId,
      updated_by: ctx.actorId,
    })
    .select("id, title, kind")
    .single();
  if (error || !data) throw hierarchyError(error);
  await logEvent(ctx, projectId, data.id, "task.created", {
    title: data.title,
    kind: data.kind,
  });
  const schedule = await settleSchedule(ctx, project);
  return {
    taskId: data.id,
    shifted: schedule.applied.length,
    pending: schedule.pending.length,
  };
}

async function updateTask(ctx: Ctx, body: Row) {
  const { task, project, access } = await loadTask(ctx, body.taskId);
  requireEdit(access);
  const projectId = project.id as string;
  const fields = taskFields(body, true, task);
  applyStatus(ctx, fields, task);
  if (!Object.keys(fields).length)
    return { updated: false, shifted: 0, pending: 0 };
  await validateTaskReferences(ctx, projectId, fields, task.id as string);
  const { error } = await ctx.admin
    .from("project_tasks")
    .update({ ...fields, updated_by: ctx.actorId })
    .eq("project_id", projectId)
    .eq("id", task.id);
  if (error) throw hierarchyError(error);

  const changed: Row = {};
  for (const key of [
    "status",
    "assignee_id",
    "starts_on",
    "due_on",
    "parent_task_id",
    "title",
  ]) {
    if (key in fields && fields[key] !== task[key]) changed[key] = fields[key];
  }
  if (Object.keys(changed).length) {
    await logEvent(ctx, projectId, task.id as string, "task.updated", {
      title: fields.title ?? task.title,
      ...changed,
    });
  }
  const movesDates = [
    "starts_on",
    "due_on",
    "status",
    "parent_task_id",
    "kind",
  ].some((key) => key in changed || key in fields);
  const schedule = movesDates
    ? await settleSchedule(ctx, project)
    : { applied: [], pending: [] };
  return {
    updated: true,
    shifted: schedule.applied.length,
    pending: schedule.pending.length,
  };
}

async function bulkUpdateTasks(ctx: Ctx, body: Row) {
  const { project, access } = await loadProject(ctx, body.projectId);
  requireEdit(access);
  const projectId = project.id as string;
  if (
    !Array.isArray(body.taskIds) ||
    !body.taskIds.length ||
    body.taskIds.length > 200
  ) {
    throw invalid("Die Auswahl ist ungültig.");
  }
  const taskIds = [...new Set(body.taskIds.map(requiredUuid))];
  const patch = isRecord(body.patch) ? body.patch : {};
  const fields: Row = {};
  if (has(patch, "status"))
    fields.status = oneOf(patch.status, TASK_STATUSES, "Der Status");
  if (has(patch, "priority"))
    fields.priority = oneOf(patch.priority, PRIORITIES, "Die Priorität");
  if (has(patch, "assigneeId"))
    fields.assignee_id = optionalUuid(patch.assigneeId);
  if (has(patch, "teamId")) fields.team_id = optionalUuid(patch.teamId);
  const shiftDays = optionalInteger(
    patch.shiftDays,
    -365,
    365,
    "Die Verschiebung",
  );
  if (!Object.keys(fields).length && !shiftDays && patch.delete !== true) {
    throw invalid("Es ist keine Änderung ausgewählt.");
  }
  await validateTaskReferences(ctx, projectId, fields);

  const tasks = (
    await selectIn(ctx.admin, "project_tasks", TASK_SELECT, "id", taskIds)
  ).filter((task) => task.project_id === projectId);
  if (tasks.length !== taskIds.length) throw notFound("Ein Element");

  if (patch.delete === true) {
    await removeTaskFiles(ctx, taskIds);
    for (let index = 0; index < taskIds.length; index += 80) {
      const { error } = await ctx.admin
        .from("project_tasks")
        .delete()
        .eq("project_id", projectId)
        .in("id", taskIds.slice(index, index + 80));
      if (error) throw failed();
    }
    await logEvent(ctx, projectId, null, "task.bulk_deleted", {
      count: tasks.length,
    });
    const schedule = await settleSchedule(ctx, project);
    return {
      updated: tasks.length,
      shifted: schedule.applied.length,
      pending: schedule.pending.length,
    };
  }

  for (const task of tasks) {
    const update: Row = { ...fields, updated_by: ctx.actorId };
    applyStatus(ctx, update, task);
    if (shiftDays) {
      if (task.starts_on)
        update.starts_on = addCalendarDays(task.starts_on as string, shiftDays);
      if (task.due_on)
        update.due_on = addCalendarDays(task.due_on as string, shiftDays);
    }
    const { error } = await ctx.admin
      .from("project_tasks")
      .update(update)
      .eq("project_id", projectId)
      .eq("id", task.id);
    if (error) throw failed();
  }
  await logEvent(ctx, projectId, null, "task.bulk_updated", {
    count: tasks.length,
    ...fields,
    shiftDays,
  });
  const schedule = await settleSchedule(ctx, project);
  return {
    updated: tasks.length,
    shifted: schedule.applied.length,
    pending: schedule.pending.length,
  };
}

async function removeTaskFiles(ctx: Ctx, taskIds: string[]) {
  // Children go with their parent, so their files have to go too.
  const first = (
    await selectIn(ctx.admin, "project_tasks", "id", "parent_task_id", taskIds)
  ).map((row) => row.id as string);
  const second = (
    await selectIn(ctx.admin, "project_tasks", "id", "parent_task_id", first)
  ).map((row) => row.id as string);
  const all = [...new Set([...taskIds, ...first, ...second])];
  const paths = (
    await selectIn(
      ctx.admin,
      "record_attachments",
      "storage_object_path",
      "project_task_id",
      all,
    )
  ).map((row) => row.storage_object_path as string);
  if (paths.length) await ctx.admin.storage.from(BUCKET).remove(paths);
}

async function deleteTask(ctx: Ctx, body: Row) {
  const { task, project, access } = await loadTask(ctx, body.taskId);
  requireEdit(access);
  await removeTaskFiles(ctx, [task.id as string]);
  const { error } = await ctx.admin
    .from("project_tasks")
    .delete()
    .eq("project_id", project.id)
    .eq("id", task.id);
  if (error) throw failed();
  await logEvent(ctx, project.id as string, null, "task.deleted", {
    title: task.title,
    kind: task.kind,
  });
  const schedule = await settleSchedule(ctx, project);
  return {
    deleted: true,
    shifted: schedule.applied.length,
    pending: schedule.pending.length,
  };
}

async function checklistAction(ctx: Ctx, body: Row) {
  if (body.type === "addChecklistItem") {
    const { task, access } = await loadTask(ctx, body.taskId);
    requireEdit(access);
    const description = requiredText(body.description, 500, "Der Punkt");
    const { count } = await ctx.admin
      .from("project_task_checklist_items")
      .select("id", { count: "exact", head: true })
      .eq("task_id", task.id);
    if ((count ?? 0) >= 60)
      throw invalid("Eine Checkliste fasst höchstens 60 Punkte.");
    const { data, error } = await ctx.admin
      .from("project_task_checklist_items")
      .insert({
        tenant_id: ctx.tenantId,
        task_id: task.id,
        description,
        position: count ?? 0,
        created_by: ctx.actorId,
      })
      .select("id")
      .single();
    if (error || !data) throw failed();
    return { itemId: data.id };
  }
  const itemId = requiredUuid(body.itemId);
  const { data: item } = await ctx.admin
    .from("project_task_checklist_items")
    .select("id, task_id")
    .eq("tenant_id", ctx.tenantId)
    .eq("id", itemId)
    .maybeSingle();
  if (!item) throw notFound("Der Punkt");
  const { access } = await loadTask(ctx, item.task_id);
  requireEdit(access);
  if (body.type === "deleteChecklistItem") {
    const { error } = await ctx.admin
      .from("project_task_checklist_items")
      .delete()
      .eq("id", itemId);
    if (error) throw failed();
    return { deleted: true };
  }
  const done = body.done === true;
  const { error } = await ctx.admin
    .from("project_task_checklist_items")
    .update({
      completed_at: done ? new Date().toISOString() : null,
      completed_by: done ? ctx.actorId : null,
    })
    .eq("id", itemId);
  if (error) throw failed();
  return { done };
}

// ---------------------------------------------------------------------------
// Abhängigkeiten
// ---------------------------------------------------------------------------

async function addDependency(ctx: Ctx, body: Row) {
  const { project, access } = await loadProject(ctx, body.projectId);
  requireEdit(access);
  const predecessorId = requiredUuid(body.predecessorId);
  const successorId = requiredUuid(body.successorId);
  if (predecessorId === successorId)
    throw invalid("Ein Element kann nicht von sich selbst abhängen.");
  const { error } = await ctx.admin.from("project_task_dependencies").insert({
    tenant_id: ctx.tenantId,
    project_id: project.id,
    predecessor_id: predecessorId,
    successor_id: successorId,
    dependency_type: has(body, "dependencyType")
      ? oneOf(body.dependencyType, DEPENDENCY_TYPES, "Die Art der Abhängigkeit")
      : "finish_to_start",
    lag_days: optionalInteger(body.lagDays, -365, 365, "Der Abstand") ?? 0,
    created_by: ctx.actorId,
  });
  if (error) {
    const text = `${error.message ?? ""}`;
    if (text.includes("project_dependency_cycle")) {
      throw new HttpError(
        409,
        "dependency_cycle",
        "Die Abhängigkeit würde einen Kreis bilden.",
      );
    }
    if (error.code === "23505")
      throw new HttpError(409, "exists", "Diese Abhängigkeit gibt es bereits.");
    if (error.code === "23503")
      throw invalid("Die Elemente gehören nicht zu diesem Projekt.");
    throw failed();
  }
  let schedule;
  try {
    schedule = await settleSchedule(ctx, project);
  } catch (scheduleError) {
    // A phase that waits for its own child: the row is valid for the
    // database but can never be scheduled, so take it back.
    await ctx.admin
      .from("project_task_dependencies")
      .delete()
      .eq("project_id", project.id)
      .eq("predecessor_id", predecessorId)
      .eq("successor_id", successorId);
    throw scheduleError;
  }
  await logEvent(ctx, project.id as string, successorId, "dependency.added", {
    predecessorId,
  });
  return {
    added: true,
    shifted: schedule.applied.length,
    pending: schedule.pending.length,
  };
}

async function removeDependency(ctx: Ctx, body: Row) {
  const id = requiredUuid(body.dependencyId);
  const { data } = await ctx.admin
    .from("project_task_dependencies")
    .select("id, project_id, successor_id")
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id)
    .maybeSingle();
  if (!data) throw notFound("Die Abhängigkeit");
  const { access } = await loadProject(ctx, data.project_id);
  requireEdit(access);
  const { error } = await ctx.admin
    .from("project_task_dependencies")
    .delete()
    .eq("id", id);
  if (error) throw failed();
  await logEvent(ctx, data.project_id, data.successor_id, "dependency.removed");
  return { removed: true };
}

async function reschedule(ctx: Ctx, body: Row, apply: boolean) {
  const { project, access } = await loadProject(ctx, body.projectId);
  if (apply) requireEdit(access);
  const changes = await plannedChanges(ctx, project.id as string);
  if (apply) await applyChanges(ctx, project.id as string, changes);
  return { changes, applied: apply };
}

// ---------------------------------------------------------------------------
// Vorlagen
// ---------------------------------------------------------------------------

async function saveAsTemplate(ctx: Ctx, body: Row) {
  if (!ctx.permissions.manage) throw forbidden();
  const { project } = await loadProject(ctx, body.projectId);
  const projectId = project.id as string;
  const name = requiredText(body.name, 160, "Der Name");
  const [tasks, dependencies, checklist, documents] = await Promise.all([
    projectTasks(ctx, projectId),
    projectDependencies(ctx, projectId),
    ctx.admin
      .from("project_task_checklist_items")
      .select("task_id, description, position, project_tasks!inner(project_id)")
      .eq("project_tasks.project_id", projectId)
      .order("position"),
    ctx.admin
      .from("project_documents")
      .select("title, body, visibility")
      .eq("project_id", projectId)
      .order("position"),
  ]);
  const checklists = new Map<string, string[]>();
  for (const item of (checklist.data ?? []) as Row[]) {
    const key = item.task_id as string;
    checklists.set(key, [
      ...(checklists.get(key) ?? []),
      item.description as string,
    ]);
  }
  const snapshot = buildSnapshot(
    {
      startsOn: project.starts_on as string | null,
      endsOn: project.ends_on as string | null,
      budgetMinutes: project.budget_minutes as number | null,
    },
    tasks.map((task) => ({
      id: task.id as string,
      parentId: task.parent_task_id as string | null,
      kind: task.kind as string,
      title: task.title as string,
      description: task.description as string | null,
      priority: task.priority as string,
      estimatedMinutes: task.estimated_minutes as number | null,
      startsOn: task.starts_on as string | null,
      dueOn: task.due_on as string | null,
      position: Number(task.position),
    })),
    checklists,
    dependencies.map((row) => ({
      predecessorId: row.predecessor_id as string,
      successorId: row.successor_id as string,
      type: row.dependency_type as DependencyType,
      lagDays: Number(row.lag_days),
    })),
    body.includeDocuments === false
      ? []
      : ((documents.data ?? []) as Array<{
          title: string;
          body: string;
          visibility: string;
        }>),
  );
  const { data, error } = await ctx.admin
    .from("project_templates")
    .insert({
      tenant_id: ctx.tenantId,
      name,
      description: optionalText(body.description, 2000, "Die Beschreibung"),
      snapshot,
      source_project_id: projectId,
      created_by: ctx.actorId,
      updated_by: ctx.actorId,
    })
    .select("id")
    .single();
  if (error?.code === "23505")
    throw new HttpError(
      409,
      "exists",
      "Eine Vorlage mit diesem Namen gibt es bereits.",
    );
  if (error || !data) throw failed();
  await logEvent(ctx, projectId, null, "template.saved", { name });
  return { templateId: data.id };
}

async function deleteTemplate(ctx: Ctx, body: Row) {
  if (!ctx.permissions.manage) throw forbidden();
  const { error } = await ctx.admin
    .from("project_templates")
    .delete()
    .eq("tenant_id", ctx.tenantId)
    .eq("id", requiredUuid(body.templateId));
  if (error) throw failed();
  return { deleted: true };
}

// ---------------------------------------------------------------------------
// Zeiten
// ---------------------------------------------------------------------------

async function addTimeEntry(ctx: Ctx, body: Row) {
  const { task, project, access } = await loadTask(ctx, body.taskId);
  requireEdit(access);
  const minutes = optionalInteger(body.minutes, 1, 1440, "Die Dauer");
  if (!minutes) throw invalid("Die Dauer fehlt.");
  const startedAt =
    typeof body.startedAt === "string" &&
    Number.isFinite(Date.parse(body.startedAt))
      ? new Date(body.startedAt).toISOString()
      : null;
  const { data, error } = await ctx.admin
    .from("ticket_time_entries")
    .insert({
      project_task_id: task.id,
      author_id: ctx.actorId,
      minutes,
      billing_kind: has(body, "billingKind")
        ? oneOf(body.billingKind, BILLING_KINDS, "Die Verrechnung")
        : "internal",
      note: optionalText(body.note, 2000, "Die Notiz"),
      started_at: startedAt,
    })
    .select("id")
    .single();
  if (error || !data) throw failed();
  await logEvent(
    ctx,
    project.id as string,
    task.id as string,
    "time_entry.added",
    { minutes, title: task.title },
  );
  return { entryId: data.id };
}

async function deleteTimeEntry(ctx: Ctx, body: Row) {
  const id = requiredUuid(body.entryId);
  const { data } = await ctx.admin
    .from("ticket_time_entries")
    .select("id, project_task_id, author_id, minutes")
    .eq("id", id)
    .not("project_task_id", "is", null)
    .maybeSingle();
  if (!data) throw notFound("Der Zeiteintrag");
  const { task, project, access } = await loadTask(ctx, data.project_task_id);
  if (!(access.canAdmin || (access.canEdit && data.author_id === ctx.actorId)))
    throw forbidden();
  const { error } = await ctx.admin
    .from("ticket_time_entries")
    .delete()
    .eq("id", id);
  if (error) throw failed();
  await logEvent(
    ctx,
    project.id as string,
    task.id as string,
    "time_entry.deleted",
    { minutes: data.minutes, title: task.title },
  );
  return { deleted: true };
}

// ---------------------------------------------------------------------------
// Verknüpfungen und Umwandlung
// ---------------------------------------------------------------------------

async function canReadTicket(ctx: Ctx, ticketId: string) {
  const { data, error } = await ctx.userClient.rpc("can_read_ticket", {
    p_ticket_id: ticketId,
  });
  return !error && data === true;
}

async function isTicketStaff(ctx: Ctx) {
  const { data, error } = await ctx.userClient.rpc(
    "can_work_tickets_in_tenant",
    { p_tenant_id: ctx.tenantId },
  );
  return !error && data === true;
}

async function assertMayUseKind(ctx: Ctx, kind: LinkKind) {
  const anyOf = async (...codes: string[]) => {
    for (const code of codes) {
      if (await hasPermission(ctx.admin, ctx.actorId, ctx.tenantId, code)) {
        return true;
      }
    }
    return false;
  };
  let allowed: boolean;
  switch (kind) {
    case "ticket":
      // Each ticket is checked against the person's own ticket rights.
      allowed = true;
      break;
    case "shop_order":
      allowed = await anyOf("shop.fulfill", "shop.manage");
      break;
    case "ipam_prefix":
    case "ipam_vlan":
    case "ipam_address":
      allowed = await anyOf("ipam.read", "ipam.manage");
      break;
    case "service_task":
      allowed = await anyOf(
        "service_tasks.read",
        "service_tasks.execute",
        "service_tasks.manage",
      );
      break;
    case "monitoring_incident": {
      const { data, error } = await ctx.userClient.rpc("can_work_incidents", {
        p_tenant_id: ctx.tenantId,
      });
      allowed = !error && data === true;
      break;
    }
    default:
      allowed = await isTicketStaff(ctx);
  }
  if (!allowed) throw forbidden();
}

async function searchLinkable(ctx: Ctx, body: Row) {
  const kind = oneOf<LinkKind>(body.targetKind, LINK_KINDS, "Die Art");
  const query =
    typeof body.query === "string" ? body.query.trim().slice(0, 80) : "";
  await assertInternal(ctx);
  await assertMayUseKind(ctx, kind);
  if (kind === "ticket") {
    const needle = query.replace(/[%_,()\\]/g, " ").trim();
    let search = ctx.admin
      .from("tickets")
      .select("id, ticket_number, subject")
      .eq("tenant_id", ctx.tenantId)
      .is("deleted_at", null);
    if (needle) {
      search = search.or(
        `ticket_number.ilike.%${needle}%,subject.ilike.%${needle}%`,
      );
    }
    const { data } = await search
      .order("created_at", { ascending: false })
      .limit(25);
    const readable = await Promise.all(
      ((data ?? []) as Row[]).map(async (row) =>
        (await canReadTicket(ctx, row.id as string)) ? row : null,
      ),
    );
    return {
      results: readable
        .filter((row): row is Row => !!row)
        .slice(0, 15)
        .map((row) => ({
          id: row.id,
          label: row.ticket_number,
          detail: row.subject,
        })),
    };
  }
  const { data, error } = await ctx.admin.rpc("project_search_link_targets", {
    p_tenant_id: ctx.tenantId,
    p_kind: kind,
    p_query: query,
  });
  if (error) throw failed();
  return {
    results: ((data ?? []) as Row[]).map((row) => ({
      id: row.target_id,
      label: row.label,
      detail: row.detail,
    })),
  };
}

async function insertLink(
  ctx: Ctx,
  projectId: string,
  taskId: string | null,
  kind: LinkKind,
  targetId: string,
  note: string | null,
) {
  const { data, error } = await ctx.admin
    .from("project_links")
    .insert({
      tenant_id: ctx.tenantId,
      project_id: projectId,
      task_id: taskId,
      target_kind: kind,
      [LINK_COLUMNS[kind]]: targetId,
      note,
      created_by: ctx.actorId,
    })
    .select("id")
    .single();
  if (error?.code === "23505") {
    throw new HttpError(
      409,
      "exists",
      kind === "ticket"
        ? "Das Ticket ist bereits mit einem Projekt verknüpft."
        : "Diese Verknüpfung gibt es bereits.",
    );
  }
  if (error?.code === "23503") throw notFound("Der Eintrag");
  if (error || !data) throw failed();
  return data.id as string;
}

async function ticketEvent(
  ctx: Ctx,
  ticketId: string,
  type: string,
  project: Row,
) {
  await ctx.admin.from("ticket_events").insert({
    ticket_id: ticketId,
    actor_id: ctx.actorId,
    event_type: type,
    payload: {
      projectId: project.id,
      projectNumber: project.project_number,
      projectTitle: project.title,
    },
  });
}

async function linkRecord(ctx: Ctx, body: Row) {
  const { project, access } = await loadProject(ctx, body.projectId);
  requireEdit(access);
  const kind = oneOf<LinkKind>(body.targetKind, LINK_KINDS, "Die Art");
  const targetId = requiredUuid(body.targetId);
  const taskId = optionalUuid(body.taskId);
  await assertMayUseKind(ctx, kind);
  if (kind === "ticket" && !(await canReadTicket(ctx, targetId)))
    throw notFound("Das Ticket");
  if (taskId) {
    const { data } = await ctx.admin
      .from("project_tasks")
      .select("id")
      .eq("project_id", project.id)
      .eq("id", taskId)
      .maybeSingle();
    if (!data) throw invalid("Das Element gehört nicht zu diesem Projekt.");
  }
  const linkId = await insertLink(
    ctx,
    project.id as string,
    taskId,
    kind,
    targetId,
    optionalText(body.note, 300, "Die Notiz"),
  );
  if (kind === "ticket")
    await ticketEvent(ctx, targetId, "project.linked", project);
  await logEvent(ctx, project.id as string, taskId, "link.added", {
    targetKind: kind,
  });
  return { linkId };
}

async function unlinkRecord(ctx: Ctx, body: Row) {
  const id = requiredUuid(body.linkId);
  const { data } = await ctx.admin
    .from("project_links")
    .select("id, project_id, task_id, target_kind, ticket_id")
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id)
    .maybeSingle();
  if (!data) throw notFound("Die Verknüpfung");
  const { project, access } = await loadProject(ctx, data.project_id);
  requireEdit(access);
  const { error } = await ctx.admin.from("project_links").delete().eq("id", id);
  if (error) throw failed();
  if (data.ticket_id)
    await ticketEvent(ctx, data.ticket_id, "project.unlinked", project);
  await logEvent(ctx, project.id as string, data.task_id, "link.removed", {
    targetKind: data.target_kind,
  });
  return { removed: true };
}

/** Projects a ticket, order, network or device belongs to. */
async function projectsForRecord(ctx: Ctx, body: Row) {
  const kind = oneOf<LinkKind>(body.targetKind, LINK_KINDS, "Die Art");
  const targetId = requiredUuid(body.targetId);
  await assertInternal(ctx);
  const { data } = await ctx.admin
    .from("project_links")
    .select("id, project_id, task_id")
    .eq("tenant_id", ctx.tenantId)
    .eq(LINK_COLUMNS[kind], targetId);
  const links = (data ?? []) as Row[];
  if (!links.length) return { projects: [], canCreate: ctx.permissions.create };
  const visible = await visibleProjects(ctx, true);
  const byId = new Map(
    visible.map((project) => [project.id as string, project]),
  );
  return {
    canCreate: ctx.permissions.create,
    projects: links
      .filter((link) => byId.has(link.project_id as string))
      .map((link) => {
        const project = byId.get(link.project_id as string)!;
        return {
          linkId: link.id,
          projectId: project.id,
          number: project.project_number,
          title: project.title,
          status: project.status,
          health: project.health,
        };
      }),
  };
}

async function convertTicket(ctx: Ctx, body: Row) {
  if (!ctx.permissions.create) throw forbidden();
  const ticketId = requiredUuid(body.ticketId);
  const { data: ticket } = await ctx.admin
    .from("tickets")
    .select(
      "id, ticket_number, subject, description, department_id, customer_organization_id, due_at",
    )
    .eq("tenant_id", ctx.tenantId)
    .eq("id", ticketId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!ticket || !(await canReadTicket(ctx, ticketId)))
    throw notFound("Das Ticket");
  const { data: existing } = await ctx.admin
    .from("project_links")
    .select("id")
    .eq("ticket_id", ticketId)
    .maybeSingle();
  if (existing)
    throw new HttpError(
      409,
      "exists",
      "Das Ticket ist bereits mit einem Projekt verknüpft.",
    );
  const { data: checklist } = await ctx.admin
    .from("ticket_checklist_items")
    .select("description, position, completed_at")
    .eq("ticket_id", ticketId)
    .order("position")
    .limit(100);

  const today = swissToday();
  const project = await insertProject(ctx, {
    title: has(body, "title")
      ? requiredText(body.title, 200, "Der Titel")
      : String(ticket.subject).slice(0, 200),
    description:
      typeof ticket.description === "string"
        ? ticket.description.slice(0, 20000)
        : null,
    manager_id: ctx.actorId,
    department_id: ticket.department_id,
    customer_organization_id: ticket.customer_organization_id,
    starts_on: today,
    source_ticket_id: ticketId,
  });
  const projectId = project.id as string;
  try {
    const items = ((checklist ?? []) as Row[]).filter((item) =>
      String(item.description ?? "").trim(),
    );
    if (items.length) {
      const { error } = await ctx.admin.from("project_tasks").insert(
        items.map((item, position) => ({
          tenant_id: ctx.tenantId,
          project_id: projectId,
          kind: "task",
          title: String(item.description).trim().slice(0, 240),
          status: item.completed_at ? "done" : "todo",
          progress_percent: item.completed_at ? 100 : 0,
          completed_at: item.completed_at,
          position,
          created_by: ctx.actorId,
          updated_by: ctx.actorId,
        })),
      );
      if (error) throw failed();
    }
    await insertLink(ctx, projectId, null, "ticket", ticketId, null);
  } catch (error) {
    await discardProject(ctx, projectId);
    throw error;
  }
  await ticketEvent(ctx, ticketId, "project.converted", project);
  await logEvent(ctx, projectId, null, "project.created", {
    fromTicket: ticket.ticket_number,
  });
  await audit(ctx, "project.created", projectId, {
    number: project.project_number,
    ticketId,
  });
  return { projectId, number: project.project_number };
}

async function convertShopOrder(ctx: Ctx, body: Row) {
  if (!ctx.permissions.create) throw forbidden();
  const orderId = requiredUuid(body.orderId);
  const { data: order } = await ctx.admin
    .from("shop_orders")
    .select("id, order_number, requester_id, comment, needed_by")
    .eq("tenant_id", ctx.tenantId)
    .eq("id", orderId)
    .maybeSingle();
  if (!order) throw notFound("Die Bestellung");
  if (order.requester_id !== ctx.actorId)
    await assertMayUseKind(ctx, "shop_order");
  const { data: lines } = await ctx.admin
    .from("shop_order_lines")
    .select("item_name, quantity")
    .eq("order_id", orderId)
    .order("created_at")
    .limit(100);

  const today = swissToday();
  const neededBy =
    typeof order.needed_by === "string" && order.needed_by >= today
      ? order.needed_by
      : null;
  const project = await insertProject(ctx, {
    title: has(body, "title")
      ? requiredText(body.title, 200, "Der Titel")
      : `Bestellung ${order.order_number}`,
    description: typeof order.comment === "string" ? order.comment : null,
    manager_id: ctx.actorId,
    starts_on: today,
    ends_on: neededBy,
    source_shop_order_id: orderId,
  });
  const projectId = project.id as string;
  try {
    const rows = ((lines ?? []) as Row[]).map((line, position) => ({
      tenant_id: ctx.tenantId,
      project_id: projectId,
      kind: "task",
      title: `${line.quantity}× ${line.item_name}`.slice(0, 240),
      due_on: neededBy,
      position,
      created_by: ctx.actorId,
      updated_by: ctx.actorId,
    }));
    if (rows.length) {
      const { error } = await ctx.admin.from("project_tasks").insert(rows);
      if (error) throw failed();
    }
    await insertLink(ctx, projectId, null, "shop_order", orderId, null);
  } catch (error) {
    await discardProject(ctx, projectId);
    throw error;
  }
  await logEvent(ctx, projectId, null, "project.created", {
    fromShopOrder: order.order_number,
  });
  await audit(ctx, "project.created", projectId, {
    number: project.project_number,
    orderId,
  });
  return { projectId, number: project.project_number };
}

// ---------------------------------------------------------------------------
// Dokumentation, Kommentare, Anhänge
// ---------------------------------------------------------------------------

async function saveDocument(ctx: Ctx, body: Row) {
  const { project, access } = await loadProject(ctx, body.projectId);
  requireEdit(access);
  const fields = {
    title: requiredText(body.title, 200, "Der Titel"),
    body:
      typeof body.body === "string" && body.body.length <= 200000
        ? body.body
        : "",
    visibility: body.visibility === "external" ? "external" : "internal",
    updated_by: ctx.actorId,
  };
  if (typeof body.body === "string" && body.body.length > 200000)
    throw invalid("Das Dokument ist zu lang.");
  const documentId = optionalUuid(body.documentId);
  if (documentId) {
    const { data, error } = await ctx.admin
      .from("project_documents")
      .update(fields)
      .eq("project_id", project.id)
      .eq("id", documentId)
      .select("id")
      .maybeSingle();
    if (error) throw failed();
    if (!data) throw notFound("Das Dokument");
    return { documentId };
  }
  const { count } = await ctx.admin
    .from("project_documents")
    .select("id", { count: "exact", head: true })
    .eq("project_id", project.id);
  if ((count ?? 0) >= 100)
    throw invalid("Ein Projekt fasst höchstens 100 Dokumente.");
  const { data, error } = await ctx.admin
    .from("project_documents")
    .insert({
      ...fields,
      tenant_id: ctx.tenantId,
      project_id: project.id,
      position: count ?? 0,
      created_by: ctx.actorId,
    })
    .select("id")
    .single();
  if (error || !data) throw failed();
  await logEvent(ctx, project.id as string, null, "document.created", {
    title: fields.title,
  });
  return { documentId: data.id };
}

async function deleteDocument(ctx: Ctx, body: Row) {
  const { project, access } = await loadProject(ctx, body.projectId);
  requireEdit(access);
  const { data, error } = await ctx.admin
    .from("project_documents")
    .delete()
    .eq("project_id", project.id)
    .eq("id", requiredUuid(body.documentId))
    .select("title")
    .maybeSingle();
  if (error) throw failed();
  if (data)
    await logEvent(ctx, project.id as string, null, "document.deleted", {
      title: data.title,
    });
  return { deleted: true };
}

async function addComment(ctx: Ctx, body: Row) {
  const { project, access } = await loadProject(ctx, body.projectId);
  if (!access.canComment) throw forbidden();
  const taskId = optionalUuid(body.taskId);
  if (taskId) {
    const { data } = await ctx.admin
      .from("project_tasks")
      .select("id")
      .eq("project_id", project.id)
      .eq("id", taskId)
      .maybeSingle();
    if (!data) throw invalid("Das Element gehört nicht zu diesem Projekt.");
  }
  // Guests only ever write what guests can read.
  const visibility =
    access.isGuest || body.visibility === "external" ? "external" : "internal";
  const { data, error } = await ctx.admin
    .from("project_comments")
    .insert({
      tenant_id: ctx.tenantId,
      project_id: project.id,
      task_id: taskId,
      author_id: ctx.actorId,
      visibility,
      body: requiredText(body.body, 20000, "Der Kommentar"),
    })
    .select("id")
    .single();
  if (error || !data) throw failed();
  return { commentId: data.id };
}

async function deleteComment(ctx: Ctx, body: Row) {
  const id = requiredUuid(body.commentId);
  const { data } = await ctx.admin
    .from("project_comments")
    .select("id, project_id, author_id")
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id)
    .maybeSingle();
  if (!data) throw notFound("Der Kommentar");
  const { access } = await loadProject(ctx, data.project_id);
  if (!(access.canAdmin || data.author_id === ctx.actorId)) throw forbidden();
  const { error } = await ctx.admin
    .from("project_comments")
    .delete()
    .eq("id", id);
  if (error) throw failed();
  return { deleted: true };
}

async function attachmentParent(ctx: Ctx, body: Row) {
  const taskId = optionalUuid(body.taskId);
  if (taskId) {
    const loaded = await loadTask(ctx, taskId);
    return {
      ...loaded,
      column: "project_task_id",
      parentId: taskId,
      folder: "project-task",
    };
  }
  const loaded = await loadProject(ctx, body.projectId);
  return {
    ...loaded,
    column: "project_id",
    parentId: loaded.project.id as string,
    folder: "project",
  };
}

function attachmentInput(body: Row) {
  const filename = requiredText(body.filename, 240, "Der Dateiname");
  // deno-lint-ignore no-control-regex
  if (/[\u0000-\u001f\u007f/\\]/.test(filename))
    throw invalid("Der Dateiname ist ungültig.");
  const contentType = oneOf<string>(
    body.contentType,
    ATTACHMENT_CONTENT_TYPES,
    "Der Dateityp",
  );
  const byteSize = optionalInteger(
    body.byteSize,
    1,
    MAX_ATTACHMENT_BYTES,
    "Die Dateigrösse",
  );
  if (!byteSize) throw invalid("Die Dateigrösse fehlt.");
  return { filename, contentType, byteSize };
}

async function attachmentAction(ctx: Ctx, body: Row) {
  if (body.type === "createUpload" || body.type === "completeUpload") {
    const parent = await attachmentParent(ctx, body);
    requireEdit(parent.access);
    const input = attachmentInput(body);
    const prefix = `${ctx.tenantId}/${parent.folder}/${parent.parentId}`;

    if (body.type === "createUpload") {
      const { count } = await ctx.admin
        .from("record_attachments")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", ctx.tenantId)
        .eq(parent.column, parent.parentId);
      if ((count ?? 0) >= MAX_ATTACHMENTS)
        throw invalid(`Es sind höchstens ${MAX_ATTACHMENTS} Anhänge möglich.`);
      const storageObjectPath = `${prefix}/${crypto.randomUUID()}`;
      const { data, error } = await ctx.admin.storage
        .from(BUCKET)
        .createSignedUploadUrl(storageObjectPath, { upsert: false });
      if (error || !data?.signedUrl)
        throw new HttpError(
          500,
          "upload_failed",
          "Der Upload konnte nicht vorbereitet werden.",
        );
      return { storageObjectPath, signedUrl: data.signedUrl };
    }

    const path =
      typeof body.storageObjectPath === "string" ? body.storageObjectPath : "";
    const objectName = path.slice(prefix.length + 1);
    if (!path.startsWith(`${prefix}/`) || !isUuid(objectName))
      throw invalid("Der Speicherpfad ist ungültig.");
    const { data: listed, error: listError } = await ctx.admin.storage
      .from(BUCKET)
      .list(prefix, { limit: 10, search: objectName });
    if (listError) throw failed();
    // deno-lint-ignore no-explicit-any
    const object = (listed ?? []).find(
      (entry: any) => entry?.name === objectName,
    );
    const metadata = isRecord(object?.metadata) ? object.metadata : null;
    if (
      !metadata ||
      Number(metadata.size) !== input.byteSize ||
      String(metadata.mimetype ?? "").toLowerCase() !== input.contentType
    ) {
      throw invalid(
        "Die hochgeladene Datei wurde nicht gefunden oder stimmt nicht überein.",
      );
    }
    const { data, error } = await ctx.admin
      .from("record_attachments")
      .insert({
        tenant_id: ctx.tenantId,
        [parent.column]: parent.parentId,
        storage_object_path: path,
        original_filename: input.filename,
        content_type: input.contentType,
        byte_size: input.byteSize,
        uploaded_by: ctx.actorId,
      })
      .select("id")
      .single();
    if (error || !data) throw failed();
    await logEvent(
      ctx,
      parent.project.id as string,
      parent.column === "project_task_id" ? parent.parentId : null,
      "attachment.added",
      {
        filename: input.filename,
      },
    );
    return { attachmentId: data.id };
  }

  const id = requiredUuid(body.attachmentId);
  const { data: attachment } = await ctx.admin
    .from("record_attachments")
    .select(
      "id, project_id, project_task_id, storage_object_path, original_filename",
    )
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id)
    .maybeSingle();
  if (!attachment || (!attachment.project_id && !attachment.project_task_id))
    throw notFound("Der Anhang");
  const loaded = attachment.project_task_id
    ? await loadTask(ctx, attachment.project_task_id)
    : await loadProject(ctx, attachment.project_id);
  if (loaded.access.isGuest) throw notFound("Der Anhang");

  if (body.type === "attachmentUrl") {
    const { data, error } = await ctx.admin.storage
      .from(BUCKET)
      .createSignedUrl(attachment.storage_object_path, 600, {
        download: attachment.original_filename,
      });
    if (error || !data?.signedUrl) throw failed();
    return { url: data.signedUrl };
  }
  requireEdit(loaded.access);
  const { error: removeError } = await ctx.admin.storage
    .from(BUCKET)
    .remove([attachment.storage_object_path]);
  if (removeError) throw failed();
  const { error } = await ctx.admin
    .from("record_attachments")
    .delete()
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id);
  if (error) throw failed();
  return { deleted: true };
}

// ---------------------------------------------------------------------------
// Mitglieder und Gäste
// ---------------------------------------------------------------------------

const MEMBER_ROLES = new Set([
  "manager",
  "member",
  "guest_read",
  "guest_comment",
]);
const GUEST_ROLES = new Set(["guest_read", "guest_comment"]);

async function memberAction(ctx: Ctx, body: Row) {
  const { project, access } = await loadProject(ctx, body.projectId);
  requireAdmin(access);
  const projectId = project.id as string;

  if (body.type === "setMember") {
    const userId = requiredUuid(body.userId);
    const role = oneOf<string>(body.role, MEMBER_ROLES, "Die Rolle");
    await assertTenantMember(ctx, userId);
    const { error } = await ctx.admin.from("project_members").upsert(
      {
        project_id: projectId,
        tenant_id: ctx.tenantId,
        user_id: userId,
        role,
        invited_by: ctx.actorId,
      },
      { onConflict: "project_id,user_id" },
    );
    if (error) throw failed();
    await logEvent(ctx, projectId, null, "member.set", { userId, role });
    return { saved: true };
  }

  if (body.type === "removeMember") {
    const userId = requiredUuid(body.userId);
    const { error } = await ctx.admin
      .from("project_members")
      .delete()
      .eq("project_id", projectId)
      .eq("user_id", userId);
    if (error) throw failed();
    await logEvent(ctx, projectId, null, "member.removed", { userId });
    return { removed: true };
  }

  if (body.type === "revokeInvitation") {
    const { error } = await ctx.admin
      .from("project_invitations")
      .update({ status: "revoked" })
      .eq("project_id", projectId)
      .eq("id", requiredUuid(body.invitationId))
      .eq("status", "sent");
    if (error) throw failed();
    return { revoked: true };
  }

  // inviteGuest
  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) {
    throw invalid("Die E-Mail-Adresse ist ungültig.");
  }
  const role = oneOf<string>(body.role, GUEST_ROLES, "Die Rolle");
  const expiresAt = new Date(Date.now() + 14 * 86_400_000).toISOString();
  const { data: open } = await ctx.admin
    .from("project_invitations")
    .select("id")
    .eq("project_id", projectId)
    .eq("email", email)
    .eq("status", "sent")
    .maybeSingle();
  const result = open
    ? await ctx.admin
        .from("project_invitations")
        .update({ role, expires_at: expiresAt, invited_by: ctx.actorId })
        .eq("id", open.id)
    : await ctx.admin.from("project_invitations").insert({
        tenant_id: ctx.tenantId,
        project_id: projectId,
        email,
        role,
        invited_by: ctx.actorId,
        expires_at: expiresAt,
      });
  if (result.error) throw failed();
  const { error: mailError } = await ctx.admin.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: true,
      emailRedirectTo: "https://app.nextdesk.ch/",
    },
  });
  if (mailError) {
    throw new HttpError(
      502,
      "invitation_email_failed",
      "Die Einladung konnte nicht versendet werden.",
    );
  }
  await logEvent(ctx, projectId, null, "guest.invited", { email, role });
  await audit(ctx, "project.guest_invited", projectId, { email, role });
  return { sent: true, expiresAt };
}

// ---------------------------------------------------------------------------
// Auslastung und Einstellungen
// ---------------------------------------------------------------------------

async function workload(ctx: Ctx, body: Row) {
  if (!ctx.permissions.read) throw forbidden();
  const today = swissToday();
  const from = optionalDate(body.from, "Der Beginn") ?? today;
  const to = optionalDate(body.to, "Das Ende") ?? addCalendarDays(from, 27);
  if (to < from || addCalendarDays(from, 120) < to)
    throw invalid("Der Zeitraum ist ungültig.");
  const teamId = optionalUuid(body.teamId);

  let teamMembers: Set<string> | null = null;
  if (teamId) {
    const { data } = await ctx.admin
      .from("team_memberships")
      .select("user_id")
      .eq("tenant_id", ctx.tenantId)
      .eq("team_id", teamId);
    teamMembers = new Set(
      (data ?? []).map((row: Row) => row.user_id as string),
    );
  }

  const items: WorkItem[] = [];
  for (let offset = 0; offset < 10000; offset += 1000) {
    const { data, error } = await ctx.admin
      .from("work_items")
      .select(
        "kind, id, project_id, title, assignee_id, starts_on, due_on, estimated_minutes, progress_percent",
      )
      .eq("tenant_id", ctx.tenantId)
      .eq("is_open", true)
      .not("assignee_id", "is", null)
      .order("id")
      .range(offset, offset + 999);
    if (error) throw failed();
    for (const row of (data ?? []) as Row[]) {
      if (teamMembers && !teamMembers.has(row.assignee_id as string)) continue;
      items.push({
        kind: row.kind as WorkItemKind,
        id: row.id as string,
        projectId: (row.project_id as string | null) ?? null,
        title: row.title as string,
        assigneeId: row.assignee_id as string,
        startsOn: (row.starts_on as string | null) ?? null,
        dueOn: (row.due_on as string | null) ?? null,
        estimatedMinutes: (row.estimated_minutes as number | null) ?? null,
        progressPercent: Number(row.progress_percent ?? 0),
      });
    }
    if ((data ?? []).length < 1000) break;
  }

  const settings = await loadSettings(ctx);
  const people = computeWorkload(items, from, to, today, {
    ticketMinutes: settings.ticketWorkloadMinutes,
    dailyCapacityMinutes: settings.dailyCapacityMinutes,
  });
  const listed = new Set(people.map((person) => person.userId));
  const idle = [...(teamMembers ?? [])].filter((id) => !listed.has(id));
  const lookup = await names(ctx.admin, [...listed, ...idle]);
  const projectIds = [
    ...new Set(
      items.map((item) => item.projectId).filter((id): id is string => !!id),
    ),
  ];
  const projectRows = await selectIn(
    ctx.admin,
    "projects",
    "id, project_number, title",
    "id",
    projectIds,
  );
  const projectNames = new Map(
    projectRows.map((row) => [
      row.id as string,
      `${row.project_number} ${row.title}`,
    ]),
  );
  const days = people[0]?.days.map((day) => day.date) ?? [];
  return {
    from,
    to,
    today,
    settings,
    days,
    people: [
      ...people.map((person) => ({
        ...person,
        name: lookup.get(person.userId) ?? "Unbekannte Person",
        items: person.items.slice(0, 60).map((item) => ({
          ...item,
          projectName: item.projectId
            ? (projectNames.get(item.projectId) ?? null)
            : null,
        })),
      })),
      ...idle.map((userId) => ({
        userId,
        name: lookup.get(userId) ?? "Unbekannte Person",
        totalMinutes: 0,
        capacityMinutes: 0,
        utilizationPercent: 0,
        overloadedDays: 0,
        days: [],
        counts: { project_task: 0, ticket: 0, service_task: 0 },
        unestimated: 0,
        items: [],
      })),
    ],
  };
}

async function updateSettings(ctx: Ctx, body: Row) {
  if (!ctx.permissions.manage) throw forbidden();
  const ticketMinutes = optionalInteger(
    body.ticketWorkloadMinutes,
    0,
    1440,
    "Die Pauschale je Ticket",
  );
  const capacity = optionalInteger(
    body.dailyCapacityMinutes,
    30,
    1440,
    "Die Tageskapazität",
  );
  if (ticketMinutes === null || capacity === null)
    throw invalid("Die Angaben sind unvollständig.");
  const { error } = await ctx.admin.from("project_settings").upsert(
    {
      tenant_id: ctx.tenantId,
      ticket_workload_minutes: ticketMinutes,
      daily_capacity_minutes: capacity,
      updated_by: ctx.actorId,
    },
    { onConflict: "tenant_id" },
  );
  if (error) throw failed();
  return { saved: true };
}

/** What the navigation needs: is there anything to show, and is it a guest? */
async function accessSummary(ctx: Ctx) {
  const [members, led, roles] = await Promise.all([
    ctx.admin
      .from("project_members")
      .select("role")
      .eq("tenant_id", ctx.tenantId)
      .eq("user_id", ctx.actorId),
    ctx.admin
      .from("projects")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", ctx.tenantId)
      .eq("manager_id", ctx.actorId),
    ctx.admin
      .from("user_role_assignments")
      .select("role_id", { count: "exact", head: true })
      .eq("tenant_id", ctx.tenantId)
      .eq("user_id", ctx.actorId),
  ]);
  const memberRoles = ((members.data ?? []) as Row[]).map(
    (row) => row.role as string,
  );
  const hasProjects = memberRoles.length > 0 || (led.count ?? 0) > 0;
  return {
    enabled: true,
    ...ctx.permissions,
    hasProjects,
    visible: ctx.permissions.read || ctx.permissions.create || hasProjects,
    // A guest has no role in the tenant and only guest memberships.
    guestOnly:
      (roles.count ?? 0) === 0 &&
      (led.count ?? 0) === 0 &&
      memberRoles.length > 0 &&
      memberRoles.every((role) => GUEST_ROLES.has(role)),
  };
}

// ---------------------------------------------------------------------------
// Verteilung
// ---------------------------------------------------------------------------

/** Exported for tests; the handler below adds authentication and the module check. */
export async function dispatch(ctx: Ctx, body: Row): Promise<Row> {
  switch (body.type) {
    case "overview":
      return await overview(ctx, body);
    case "options":
      return await options(ctx);
    case "getProject":
      return await getProject(ctx, body);
    case "createProject":
      return await createProject(ctx, body);
    case "updateProject":
      return await updateProject(ctx, body);
    case "archiveProject":
      return await archiveProject(ctx, body);
    case "deleteProject":
      return await deleteProject(ctx, body);
    case "createTask":
      return await createTask(ctx, body);
    case "updateTask":
      return await updateTask(ctx, body);
    case "bulkUpdateTasks":
      return await bulkUpdateTasks(ctx, body);
    case "deleteTask":
      return await deleteTask(ctx, body);
    case "addChecklistItem":
    case "setChecklistItem":
    case "deleteChecklistItem":
      return await checklistAction(ctx, body);
    case "addDependency":
      return await addDependency(ctx, body);
    case "removeDependency":
      return await removeDependency(ctx, body);
    case "previewReschedule":
      return await reschedule(ctx, body, false);
    case "applyReschedule":
      return await reschedule(ctx, body, true);
    case "saveAsTemplate":
      return await saveAsTemplate(ctx, body);
    case "deleteTemplate":
      return await deleteTemplate(ctx, body);
    case "addTimeEntry":
      return await addTimeEntry(ctx, body);
    case "deleteTimeEntry":
      return await deleteTimeEntry(ctx, body);
    case "searchLinkable":
      return await searchLinkable(ctx, body);
    case "linkRecord":
      return await linkRecord(ctx, body);
    case "unlinkRecord":
      return await unlinkRecord(ctx, body);
    case "projectsForRecord":
      return await projectsForRecord(ctx, body);
    case "convertTicket":
      return await convertTicket(ctx, body);
    case "convertShopOrder":
      return await convertShopOrder(ctx, body);
    case "saveDocument":
      return await saveDocument(ctx, body);
    case "deleteDocument":
      return await deleteDocument(ctx, body);
    case "addComment":
      return await addComment(ctx, body);
    case "deleteComment":
      return await deleteComment(ctx, body);
    case "createUpload":
    case "completeUpload":
    case "attachmentUrl":
    case "deleteAttachment":
      return await attachmentAction(ctx, body);
    case "setMember":
    case "removeMember":
    case "inviteGuest":
    case "revokeInvitation":
      return await memberAction(ctx, body);
    case "workload":
      return await workload(ctx, body);
    case "updateSettings":
      return await updateSettings(ctx, body);
    default:
      throw new HttpError(400, "invalid_request", "Unbekannte Aktion.");
  }
}

const handler = withSupabase(
  { auth: "user", errors: { detailed: false } },
  async (request, context) => {
    try {
      if (request.method !== "POST") {
        return json(request, { error: { code: "method_not_allowed" } }, 405);
      }
      const body = await parseJsonObject(request);
      const actorId = context.userClaims?.id;
      if (!body || !isUuid(actorId)) {
        return json(request, { error: { code: "invalid_request" } }, 400);
      }
      const admin = context.supabaseAdmin;

      // Guests arrive without any membership; their invitation creates it.
      if (body.type === "acceptMyInvitations") {
        const email =
          typeof context.userClaims?.email === "string"
            ? context.userClaims.email
            : null;
        if (!email) return json(request, { data: { accepted: 0 } });
        const { data, error } = await admin.rpc("claim_project_invitations", {
          p_user_id: actorId,
          p_email: email,
        });
        if (error) throw failed();
        return json(request, {
          data: { accepted: typeof data === "number" ? data : 0 },
        });
      }

      if (!isUuid(body.tenantId)) {
        return json(request, { error: { code: "invalid_request" } }, 400);
      }
      const tenantId = body.tenantId.toLowerCase();
      if (!(await isActiveMember(admin, actorId, tenantId))) {
        return json(request, { error: { code: "forbidden" } }, 403);
      }
      const features = await resolveTenantFeatureStates(admin, tenantId, [
        FEATURE,
      ]);
      if (features?.[FEATURE] !== true) {
        if (body.type === "access") {
          return json(request, {
            data: {
              enabled: false,
              read: false,
              create: false,
              manage: false,
              hasProjects: false,
              visible: false,
              guestOnly: false,
            },
          });
        }
        return json(request, { error: { code: "feature_disabled" } }, 403);
      }
      const ctx: Ctx = {
        admin,
        userClient: context.supabase,
        actorId,
        tenantId,
        permissions: await loadPermissions(admin, actorId, tenantId),
      };
      if (body.type === "access")
        return json(request, { data: await accessSummary(ctx) });
      return json(request, { data: await dispatch(ctx, body) });
    } catch (error) {
      if (error instanceof HttpError) {
        return json(
          request,
          { error: { code: error.code, message: error.message } },
          error.status,
        );
      }
      console.error(
        "projects_failed",
        error instanceof Error ? error.name : "",
      );
      return json(
        request,
        {
          error: {
            code: "projects_failed",
            message: "Die Projekte sind gerade nicht erreichbar.",
          },
        },
        500,
      );
    }
  },
);

export default {
  fetch(request: Request): Response | Promise<Response> {
    if (request.method === "OPTIONS") return noContent(request);
    return handler(request);
  },
};
