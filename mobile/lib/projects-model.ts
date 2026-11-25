// «Projekte» der App (Funktion projects, Aktionen overview und getProject):
// reine Auswertung und Formatierung, ohne Netzwerkzugriff.

type RecordValue = Record<string, unknown>;

export type ProjectStatus = "planning" | "active" | "paused" | "completed";
export type ProjectHealth = "green" | "yellow" | "red";
export type ProjectRole =
  "manager" | "member" | "viewer" | "guest_comment" | "guest_read";
export type ProjectTaskKind = "phase" | "milestone" | "task";
export type ProjectTaskStatus = "todo" | "in_progress" | "blocked" | "done";
export type ProjectTaskPriority = "low" | "normal" | "high" | "urgent";

export type MobileProject = {
  id: string;
  number: string;
  title: string;
  description: string | null;
  status: ProjectStatus;
  health: ProjectHealth;
  healthNote: string | null;
  managerName: string | null;
  startsOn: string | null;
  endsOn: string | null;
  archived: boolean;
  role: ProjectRole;
  taskCount: number;
  doneCount: number;
  progressPercent: number;
  overdueTasks: number;
  nextMilestone: { title: string; on: string } | null;
};

export type ProjectChecklistItem = {
  id: string;
  description: string;
  done: boolean;
};

export type MobileProjectTask = {
  id: string;
  parentId: string | null;
  kind: ProjectTaskKind;
  title: string;
  description: string | null;
  status: ProjectTaskStatus;
  priority: ProjectTaskPriority;
  assigneeId: string | null;
  assigneeName: string | null;
  startsOn: string | null;
  dueOn: string | null;
  position: number;
  checklist: ProjectChecklistItem[];
};

export type MobileProjectComment = {
  id: string;
  taskId: string | null;
  authorName: string;
  body: string;
  createdAt: string;
  mine: boolean;
  external: boolean;
};

export type MobileProjectMember = {
  userId: string;
  name: string | null;
  role: ProjectRole;
};

export type MobileProjectAccess = {
  canEdit: boolean;
  canComment: boolean;
  isGuest: boolean;
};

export type MobileProjectDetail = {
  project: MobileProject;
  access: MobileProjectAccess;
  tasks: MobileProjectTask[];
  comments: MobileProjectComment[];
  members: MobileProjectMember[];
};

// ---------------------------------------------------------------------------
// Parsing

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function dataOf(response: unknown): RecordValue | null {
  if (!isRecord(response)) return null;
  return isRecord(response.data) ? response.data : null;
}

function id(value: unknown): string | null {
  return typeof value === "string" && UUID.test(value) ? value : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function date(value: unknown): string | null {
  return typeof value === "string" && DATE.test(value) ? value : null;
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return (allowed as readonly unknown[]).includes(value)
    ? (value as T)
    : fallback;
}

function list<T>(value: unknown, parse: (entry: unknown) => T | null): T[] {
  if (!Array.isArray(value)) return [];
  const rows: T[] = [];
  for (const entry of value) {
    const row = parse(entry);
    if (row) rows.push(row);
  }
  return rows;
}

const STATUSES = ["planning", "active", "paused", "completed"] as const;
const HEALTHS = ["green", "yellow", "red"] as const;
const ROLES = [
  "manager",
  "member",
  "viewer",
  "guest_comment",
  "guest_read",
] as const;
const KINDS = ["phase", "milestone", "task"] as const;
const TASK_STATUSES = ["todo", "in_progress", "blocked", "done"] as const;
const PRIORITIES = ["low", "normal", "high", "urgent"] as const;

/** Reihenfolge der Statuswahl in der Aufgabe. */
export const PROJECT_TASK_STATUSES: readonly ProjectTaskStatus[] =
  TASK_STATUSES;

function parseProject(value: unknown): MobileProject | null {
  if (!isRecord(value)) return null;
  const projectId = id(value.id);
  const title = text(value.title);
  if (!projectId || !title) return null;
  const stats = isRecord(value.stats) ? value.stats : {};
  const milestone = isRecord(stats.nextMilestone) ? stats.nextMilestone : null;
  const milestoneTitle = milestone ? text(milestone.title) : null;
  const milestoneOn = milestone ? date(milestone.on) : null;
  return {
    id: projectId,
    number: text(value.number) ?? "",
    title,
    description: text(value.description),
    status: oneOf(value.status, STATUSES, "planning"),
    health: oneOf(value.health, HEALTHS, "green"),
    healthNote: text(value.healthNote),
    managerName: text(value.managerName),
    startsOn: date(value.startsOn),
    endsOn: date(value.endsOn),
    archived: typeof value.archivedAt === "string",
    role: oneOf(value.role, ROLES, "viewer"),
    taskCount: count(stats.taskCount),
    doneCount: count(stats.doneCount),
    progressPercent: Math.min(100, count(stats.progressPercent)),
    overdueTasks: count(stats.overdueTasks),
    nextMilestone:
      milestoneTitle && milestoneOn
        ? { title: milestoneTitle, on: milestoneOn }
        : null,
  };
}

function parseTask(value: unknown): MobileProjectTask | null {
  if (!isRecord(value)) return null;
  const taskId = id(value.id);
  const title = text(value.title);
  if (!taskId || !title) return null;
  return {
    id: taskId,
    parentId: id(value.parentId),
    kind: oneOf(value.kind, KINDS, "task"),
    title,
    description: text(value.description),
    status: oneOf(value.status, TASK_STATUSES, "todo"),
    priority: oneOf(value.priority, PRIORITIES, "normal"),
    assigneeId: id(value.assigneeId),
    assigneeName: text(value.assigneeName),
    startsOn: date(value.startsOn),
    dueOn: date(value.dueOn),
    position: typeof value.position === "number" ? value.position : 0,
    checklist: list(value.checklist, (entry) => {
      if (!isRecord(entry)) return null;
      const itemId = id(entry.id);
      const description = text(entry.description);
      return itemId && description
        ? { id: itemId, description, done: entry.done === true }
        : null;
    }),
  };
}

function parseComment(value: unknown): MobileProjectComment | null {
  if (!isRecord(value)) return null;
  const commentId = id(value.id);
  const body = text(value.body);
  if (!commentId || !body || typeof value.createdAt !== "string") return null;
  return {
    id: commentId,
    taskId: id(value.taskId),
    authorName: text(value.authorName) ?? "Unbekannte Person",
    body,
    createdAt: value.createdAt,
    mine: value.mine === true,
    external: value.visibility === "external",
  };
}

function parseMember(value: unknown): MobileProjectMember | null {
  if (!isRecord(value)) return null;
  const userId = id(value.userId);
  return userId
    ? {
        userId,
        name: text(value.name),
        role: oneOf(value.role, ROLES, "member"),
      }
    : null;
}

/** Antwort der Aktion overview; null bei unerwarteter Form. */
export function parseProjectOverview(
  response: unknown,
): MobileProject[] | null {
  const data = dataOf(response);
  if (!data || !Array.isArray(data.projects)) return null;
  return list(data.projects, parseProject);
}

/** Antwort der Aktion getProject; null bei unerwarteter Form. */
export function parseProjectDetail(
  response: unknown,
): MobileProjectDetail | null {
  const data = dataOf(response);
  if (!data) return null;
  const project = parseProject(data.project);
  if (!project || !Array.isArray(data.tasks)) return null;
  const access = isRecord(data.access) ? data.access : {};
  return {
    project: { ...project, role: oneOf(access.role, ROLES, project.role) },
    access: {
      canEdit: access.canEdit === true,
      canComment: access.canComment === true,
      isGuest: access.isGuest === true,
    },
    tasks: list(data.tasks, parseTask),
    comments: list(data.comments, parseComment),
    members: list(data.members, parseMember),
  };
}

/** Fehlendes Modul oder Recht: freundlicher Hinweis statt Fehler. */
export function isProjectAccessDenied(error: unknown): boolean {
  if (!isRecord(error)) return false;
  const code = typeof error.code === "string" ? error.code : null;
  if (code === "feature_disabled" || code === "forbidden") return true;
  return error.status === 403 && code === null;
}

// ---------------------------------------------------------------------------
// Beschriftungen

const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  planning: "In Planung",
  active: "Aktiv",
  paused: "Pausiert",
  completed: "Abgeschlossen",
};

const HEALTH_LABELS: Record<ProjectHealth, string> = {
  green: "Im Plan",
  yellow: "Gefährdet",
  red: "Kritisch",
};

const TASK_STATUS_LABELS: Record<ProjectTaskStatus, string> = {
  todo: "Offen",
  in_progress: "In Arbeit",
  blocked: "Blockiert",
  done: "Erledigt",
};

const KIND_LABELS: Record<ProjectTaskKind, string> = {
  phase: "Phase",
  milestone: "Meilenstein",
  task: "Aufgabe",
};

const PRIORITY_LABELS: Record<ProjectTaskPriority, string> = {
  low: "Niedrig",
  normal: "Normal",
  high: "Hoch",
  urgent: "Dringend",
};

const ROLE_LABELS: Record<ProjectRole, string> = {
  manager: "Projektleitung",
  member: "Mitarbeit",
  viewer: "Lesend",
  guest_comment: "Gast (kommentierend)",
  guest_read: "Gast (lesend)",
};

export const projectStatusLabel = (status: ProjectStatus) =>
  PROJECT_STATUS_LABELS[status];
export const projectHealthLabel = (health: ProjectHealth) =>
  HEALTH_LABELS[health];
export const projectTaskStatusLabel = (status: ProjectTaskStatus) =>
  TASK_STATUS_LABELS[status];
export const projectTaskKindLabel = (kind: ProjectTaskKind) =>
  KIND_LABELS[kind];
export const projectPriorityLabel = (priority: ProjectTaskPriority) =>
  PRIORITY_LABELS[priority];
export const projectRoleLabel = (role: ProjectRole) => ROLE_LABELS[role];

// ---------------------------------------------------------------------------
// Datum

export function projectToday(now = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/** «2026-11-24» → «24.11.2026». */
export function projectDateLabel(value: string | null): string {
  if (!value || !DATE.test(value)) return "–";
  const [year, month, day] = value.split("-");
  return `${day}.${month}.${year}`;
}

export function projectRangeLabel(
  startsOn: string | null,
  endsOn: string | null,
): string | null {
  if (startsOn && endsOn) {
    return `${projectDateLabel(startsOn)} – ${projectDateLabel(endsOn)}`;
  }
  if (startsOn) return `ab ${projectDateLabel(startsOn)}`;
  if (endsOn) return `bis ${projectDateLabel(endsOn)}`;
  return null;
}

/** «24.11.2026, 14:05» in der Zeit des Geräts. */
export function projectDateTimeLabel(iso: string): string {
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return "";
  const two = (part: number) => String(part).padStart(2, "0");
  return `${two(value.getDate())}.${two(value.getMonth() + 1)}.${value.getFullYear()}, ${two(value.getHours())}:${two(value.getMinutes())}`;
}

export function isProjectTaskOverdue(
  task: Pick<MobileProjectTask, "status" | "dueOn">,
  today: string,
): boolean {
  return task.status !== "done" && !!task.dueOn && task.dueOn < today;
}

// ---------------------------------------------------------------------------
// Listen

const STATUS_ORDER: Record<ProjectStatus, number> = {
  active: 0,
  planning: 1,
  paused: 2,
  completed: 3,
};

export function isProjectOpen(project: MobileProject): boolean {
  return project.status !== "completed" && !project.archived;
}

/** Aktive zuerst, danach nach Titel. */
export function sortProjects(
  projects: readonly MobileProject[],
): MobileProject[] {
  return [...projects].sort(
    (a, b) =>
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
      a.title.localeCompare(b.title, "de"),
  );
}

export function filterProjects(
  projects: readonly MobileProject[],
  query: string,
): MobileProject[] {
  const needle = query.trim().toLocaleLowerCase("de");
  if (!needle) return [...projects];
  return projects.filter((project) =>
    [project.title, project.number, project.managerName]
      .filter((part): part is string => !!part)
      .some((part) => part.toLocaleLowerCase("de").includes(needle)),
  );
}

export type ProjectTaskRow = { task: MobileProjectTask; depth: number };

/**
 * Plan als flache Liste in Planreihenfolge: Phasen mit ihren Aufgaben und
 * Unteraufgaben eingerückt. Elemente ohne bekanntes Elternelement stehen auf
 * der obersten Ebene.
 */
export function projectTaskRows(
  tasks: readonly MobileProjectTask[],
): ProjectTaskRow[] {
  const known = new Set(tasks.map((task) => task.id));
  const children = new Map<string | null, MobileProjectTask[]>();
  for (const task of tasks) {
    const parent =
      task.parentId && known.has(task.parentId) && task.parentId !== task.id
        ? task.parentId
        : null;
    const siblings = children.get(parent);
    if (siblings) siblings.push(task);
    else children.set(parent, [task]);
  }
  const rows: ProjectTaskRow[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    const siblings = [...(children.get(parent) ?? [])].sort(
      (a, b) => a.position - b.position || a.title.localeCompare(b.title, "de"),
    );
    for (const task of siblings) {
      if (seen.has(task.id)) continue;
      seen.add(task.id);
      rows.push({ task, depth });
      walk(task.id, depth + 1);
    }
  };
  walk(null, 0);
  return rows;
}

/** Offene Aufgaben und Meilensteine einer Person, früheste Fälligkeit zuerst. */
export function myProjectTasks(
  tasks: readonly MobileProjectTask[],
  userId: string | null,
): MobileProjectTask[] {
  if (!userId) return [];
  return tasks
    .filter(
      (task) =>
        task.kind !== "phase" &&
        task.assigneeId === userId &&
        task.status !== "done",
    )
    .sort(
      (a, b) =>
        (a.dueOn ?? "9999").localeCompare(b.dueOn ?? "9999") ||
        a.position - b.position,
    );
}

export function projectTaskMeta(
  task: MobileProjectTask,
  today: string,
): string {
  const parts: string[] = [];
  if (task.kind !== "task") parts.push(KIND_LABELS[task.kind]);
  if (task.assigneeName) parts.push(task.assigneeName);
  if (task.dueOn) {
    parts.push(
      isProjectTaskOverdue(task, today)
        ? `überfällig seit ${projectDateLabel(task.dueOn)}`
        : `fällig ${projectDateLabel(task.dueOn)}`,
    );
  }
  if (task.checklist.length) {
    const done = task.checklist.filter((item) => item.done).length;
    parts.push(`${done}/${task.checklist.length} Punkte`);
  }
  return parts.join(" · ");
}

export function projectProgressLabel(project: MobileProject): string {
  return project.taskCount
    ? `${project.doneCount} von ${project.taskCount} erledigt · ${project.progressPercent} %`
    : "Noch keine Aufgaben";
}

// ---------------------------------------------------------------------------
// Routen

export function projectHref(projectId: string): string | null {
  return UUID.test(projectId) ? `/projects/${projectId}` : null;
}

export function projectTaskHref(
  projectId: string,
  taskId: string,
): string | null {
  return UUID.test(projectId) && UUID.test(taskId)
    ? `/projects/${projectId}/task/${taskId}`
    : null;
}
