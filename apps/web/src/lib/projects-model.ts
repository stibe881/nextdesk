import type {
  DependencyType,
  LinkKind,
  ProjectHealth,
  ProjectLink,
  ProjectRole,
  ProjectStatus,
  ProjectSummary,
  ProjectTask,
  TaskKind,
  TaskPriority,
  TaskStatus,
} from "./projects-api";

/** Reine Berechnungen und Beschriftungen des Moduls Projekte. */

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  planning: "Planung",
  active: "Aktiv",
  paused: "Pausiert",
  completed: "Abgeschlossen",
};
export const HEALTH_LABELS: Record<ProjectHealth, string> = {
  green: "Grün",
  yellow: "Gelb",
  red: "Rot",
};
export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "Offen",
  in_progress: "In Arbeit",
  blocked: "Blockiert",
  done: "Erledigt",
};
export const TASK_STATUSES: readonly TaskStatus[] = [
  "todo",
  "in_progress",
  "blocked",
  "done",
];
export const TASK_KIND_LABELS: Record<TaskKind, string> = {
  phase: "Phase",
  milestone: "Meilenstein",
  task: "Aufgabe",
};
export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: "Niedrig",
  normal: "Normal",
  high: "Hoch",
  urgent: "Dringend",
};
export const DEPENDENCY_LABELS: Record<DependencyType, string> = {
  finish_to_start: "Ende → Anfang",
  start_to_start: "Anfang → Anfang",
  finish_to_finish: "Ende → Ende",
  start_to_finish: "Anfang → Ende",
};
export const ROLE_LABELS: Record<ProjectRole, string> = {
  manager: "Projektleitung",
  member: "Mitarbeit",
  viewer: "Lesend",
  guest_comment: "Gast (kommentierend)",
  guest_read: "Gast (lesend)",
};
export const LINK_KIND_LABELS: Record<LinkKind, string> = {
  ticket: "Ticket",
  shop_order: "Shop-Bestellung",
  ipam_prefix: "IP-Netz",
  ipam_vlan: "VLAN",
  ipam_address: "IP-Adresse",
  monitoring_sensor: "Monitoring-Sensor",
  asset: "Gerät",
  monitoring_incident: "Störung",
  service_task: "Serviceaufgabe",
};
export const LINK_KINDS = Object.keys(LINK_KIND_LABELS) as LinkKind[];

const LINK_STATE_LABELS: Record<string, string> = {
  active: "aktiv",
  reserved: "reserviert",
  deprecated: "veraltet",
  container: "Container",
  dhcp: "DHCP",
  resolved: "behoben",
  closed: "geschlossen",
  open: "offen",
  in_progress: "in Arbeit",
  done: "erledigt",
  skipped: "übersprungen",
  pending_approval: "wartet auf Genehmigung",
  submitted: "bestellt",
  ready: "bereit",
  issued: "ausgegeben",
  loaned: "ausgeliehen",
  returned: "zurückgegeben",
  rejected: "abgelehnt",
  cancelled: "storniert",
  ping: "Ping",
  tcp: "Port",
  http: "HTTP",
};

/** Ticket states arrive as labels; the other kinds send their stored value. */
export function linkStateLabel(state: string | null): string | null {
  if (!state) return null;
  return LINK_STATE_LABELS[state] ?? state;
}

// ---------------------------------------------------------------------------
// Datum
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;
const time = (date: string) => Date.parse(`${date}T00:00:00Z`);

export function addDays(date: string, days: number): string {
  return new Date(time(date) + days * DAY_MS).toISOString().slice(0, 10);
}

export function diffDays(from: string, to: string): number {
  return Math.round((time(to) - time(from)) / DAY_MS);
}

export function isWeekend(date: string): boolean {
  const weekday = new Date(time(date)).getUTCDay();
  return weekday === 0 || weekday === 6;
}

/** Monday of the week the date lies in. */
export function startOfWeek(date: string): string {
  const weekday = new Date(time(date)).getUTCDay();
  return addDays(date, weekday === 0 ? -6 : 1 - weekday);
}

export function localToday(now = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

export function dateLabel(date: string | null, withYear = true): string {
  if (!date) return "–";
  const [year, month, day] = date.slice(0, 10).split("-");
  return withYear ? `${day}.${month}.${year}` : `${day}.${month}.`;
}

export function dateTimeLabel(iso: string): string {
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return "–";
  return value.toLocaleString("de-CH", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function hoursLabel(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return "–";
  const hours = minutes / 60;
  const rounded = Math.round(hours * 10) / 10;
  return `${rounded.toLocaleString("de-CH", { maximumFractionDigits: 1 })} h`;
}

export function moneyLabel(cents: number | null, currency: string): string {
  if (cents === null) return "–";
  return new Intl.NumberFormat("de-CH", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

/** «1.5» or «1,5» hours to minutes; null when it is not a number. */
export function parseHours(value: string): number | null {
  const trimmed = value.trim().replace(",", ".");
  if (!trimmed) return null;
  const hours = Number(trimmed);
  if (!Number.isFinite(hours) || hours < 0) return null;
  return Math.round(hours * 60);
}

export function hoursInput(minutes: number | null): string {
  if (minutes === null) return "";
  return String(Math.round((minutes / 60) * 100) / 100);
}

// ---------------------------------------------------------------------------
// Baum und Kennzahlen
// ---------------------------------------------------------------------------

export type TreeRow = {
  task: ProjectTask;
  depth: number;
  hasChildren: boolean;
};

function sortSiblings(tasks: ProjectTask[]): ProjectTask[] {
  return [...tasks].sort(
    (a, b) => a.position - b.position || a.title.localeCompare(b.title, "de"),
  );
}

/** Depth-first rows in display order; collapsed parents hide their children. */
export function buildTree(
  tasks: readonly ProjectTask[],
  collapsed: ReadonlySet<string> = new Set(),
): TreeRow[] {
  const ids = new Set(tasks.map((task) => task.id));
  const byParent = new Map<string | null, ProjectTask[]>();
  for (const task of tasks) {
    const parent =
      task.parentId && ids.has(task.parentId) ? task.parentId : null;
    byParent.set(parent, [...(byParent.get(parent) ?? []), task]);
  }
  const rows: TreeRow[] = [];
  const visit = (parent: string | null, depth: number) => {
    if (depth > 6) return;
    for (const task of sortSiblings(byParent.get(parent) ?? [])) {
      const children = byParent.get(task.id) ?? [];
      rows.push({ task, depth, hasChildren: children.length > 0 });
      if (children.length && !collapsed.has(task.id)) visit(task.id, depth + 1);
    }
  };
  visit(null, 0);
  return rows;
}

export type Rollup = {
  estimatedMinutes: number;
  bookedMinutes: number;
  progressPercent: number;
  startsOn: string | null;
  dueOn: string | null;
  openCount: number;
  doneCount: number;
};

const weightOf = (task: ProjectTask) => task.estimatedMinutes || 60;
const valueOf = (task: ProjectTask) =>
  task.status === "done" ? 100 : task.progressPercent;

/**
 * Sums per element including everything below it. Estimates come from the
 * elements without children; booked time also counts linked tickets.
 */
export function rollupTasks(
  tasks: readonly ProjectTask[],
  links: readonly Pick<ProjectLink, "taskId" | "bookedMinutes">[] = [],
): Map<string, Rollup> {
  const children = new Map<string, ProjectTask[]>();
  for (const task of tasks) {
    if (!task.parentId) continue;
    children.set(task.parentId, [...(children.get(task.parentId) ?? []), task]);
  }
  const linked = new Map<string, number>();
  for (const link of links) {
    if (!link.taskId) continue;
    linked.set(
      link.taskId,
      (linked.get(link.taskId) ?? 0) + link.bookedMinutes,
    );
  }
  const result = new Map<string, Rollup>();
  type Acc = Rollup & { weight: number; weighted: number };
  const visit = (task: ProjectTask, depth: number): Acc => {
    const kids = depth < 6 ? (children.get(task.id) ?? []) : [];
    const own = task.bookedMinutes + (linked.get(task.id) ?? 0);
    let acc: Acc;
    if (!kids.length) {
      const counts = task.kind === "task";
      acc = {
        estimatedMinutes: task.estimatedMinutes ?? 0,
        bookedMinutes: own,
        progressPercent: valueOf(task),
        startsOn: task.startsOn ?? task.dueOn,
        dueOn: task.dueOn ?? task.startsOn,
        openCount: counts && task.status !== "done" ? 1 : 0,
        doneCount: counts && task.status === "done" ? 1 : 0,
        weight: counts ? weightOf(task) : 0,
        weighted: counts ? weightOf(task) * valueOf(task) : 0,
      };
    } else {
      acc = {
        estimatedMinutes: 0,
        bookedMinutes: own,
        progressPercent: 0,
        startsOn: null,
        dueOn: null,
        openCount: 0,
        doneCount: 0,
        weight: 0,
        weighted: 0,
      };
      for (const kid of kids) {
        const sub = visit(kid, depth + 1);
        acc.estimatedMinutes += sub.estimatedMinutes;
        acc.bookedMinutes += sub.bookedMinutes;
        acc.openCount += sub.openCount;
        acc.doneCount += sub.doneCount;
        acc.weight += sub.weight;
        acc.weighted += sub.weighted;
        if (sub.startsOn && (!acc.startsOn || sub.startsOn < acc.startsOn)) {
          acc.startsOn = sub.startsOn;
        }
        if (sub.dueOn && (!acc.dueOn || sub.dueOn > acc.dueOn)) {
          acc.dueOn = sub.dueOn;
        }
      }
      acc.startsOn ??= task.startsOn;
      acc.dueOn ??= task.dueOn;
      acc.progressPercent = acc.weight
        ? Math.round(acc.weighted / acc.weight)
        : valueOf(task);
    }
    result.set(task.id, {
      estimatedMinutes: acc.estimatedMinutes,
      bookedMinutes: acc.bookedMinutes,
      progressPercent: acc.progressPercent,
      startsOn: acc.startsOn,
      dueOn: acc.dueOn,
      openCount: acc.openCount,
      doneCount: acc.doneCount,
    });
    return acc;
  };
  const ids = new Set(tasks.map((task) => task.id));
  for (const task of tasks) {
    if (!task.parentId || !ids.has(task.parentId)) visit(task, 0);
  }
  return result;
}

export function isOverdue(task: ProjectTask, today: string): boolean {
  return task.status !== "done" && !!task.dueOn && task.dueOn < today;
}

export type HealthSuggestion = { health: ProjectHealth; reasons: string[] };

/** What the figures say about the traffic light; the person decides. */
export function suggestHealth(
  project: Pick<ProjectSummary, "budgetMinutes" | "endsOn" | "stats">,
): HealthSuggestion {
  const { stats } = project;
  const red: string[] = [];
  const yellow: string[] = [];
  if (stats.overdueMilestones > 0) {
    red.push(
      stats.overdueMilestones === 1
        ? "1 Meilenstein ist überfällig"
        : `${stats.overdueMilestones} Meilensteine sind überfällig`,
    );
  }
  if (project.budgetMinutes) {
    const used = stats.bookedMinutes / project.budgetMinutes;
    if (used > 1) red.push("Das Stundenbudget ist überschritten");
    else if (used >= 0.8 && stats.progressPercent < 80) {
      yellow.push("Über 80 % des Stundenbudgets sind verbraucht");
    }
  }
  if (stats.overdueTasks > 0) {
    yellow.push(
      stats.overdueTasks === 1
        ? "1 Aufgabe ist überfällig"
        : `${stats.overdueTasks} Aufgaben sind überfällig`,
    );
  }
  if (
    project.endsOn &&
    stats.latestDueOn &&
    stats.latestDueOn > project.endsOn
  ) {
    yellow.push("Der Plan reicht über das Projektende hinaus");
  }
  if (red.length) return { health: "red", reasons: [...red, ...yellow] };
  if (yellow.length) return { health: "yellow", reasons: yellow };
  return { health: "green", reasons: [] };
}

export function budgetPercent(project: ProjectSummary): number | null {
  if (!project.budgetMinutes) return null;
  return Math.round(
    (project.stats.bookedMinutes / project.budgetMinutes) * 100,
  );
}

// ---------------------------------------------------------------------------
// Liste: Filter und Sortierung
// ---------------------------------------------------------------------------

export type TaskFilter = {
  query: string;
  status: TaskStatus | "all" | "open" | "overdue";
  assigneeId: string | "all" | "none";
  kind: TaskKind | "all";
};

export const EMPTY_FILTER: TaskFilter = {
  query: "",
  status: "all",
  assigneeId: "all",
  kind: "all",
};

export function filterTasks(
  tasks: readonly ProjectTask[],
  filter: TaskFilter,
  today: string,
): ProjectTask[] {
  const needle = filter.query.trim().toLowerCase();
  return tasks.filter((task) => {
    if (needle && !task.title.toLowerCase().includes(needle)) return false;
    if (filter.kind !== "all" && task.kind !== filter.kind) return false;
    if (filter.status === "open" && task.status === "done") return false;
    if (filter.status === "overdue" && !isOverdue(task, today)) return false;
    if (
      filter.status !== "all" &&
      filter.status !== "open" &&
      filter.status !== "overdue" &&
      task.status !== filter.status
    ) {
      return false;
    }
    if (filter.assigneeId === "none" && task.assigneeId) return false;
    if (
      filter.assigneeId !== "all" &&
      filter.assigneeId !== "none" &&
      task.assigneeId !== filter.assigneeId
    ) {
      return false;
    }
    return true;
  });
}

export type TaskSortKey =
  "plan" | "title" | "status" | "assignee" | "startsOn" | "dueOn" | "priority";

const PRIORITY_RANK: Record<TaskPriority, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
};

export function sortTasks(
  tasks: readonly ProjectTask[],
  key: TaskSortKey,
  descending: boolean,
  planOrder: ReadonlyMap<string, number>,
): ProjectTask[] {
  const text = (value: string | null) => value ?? "￿";
  const compare = (a: ProjectTask, b: ProjectTask): number => {
    switch (key) {
      case "title":
        return a.title.localeCompare(b.title, "de");
      case "status":
        return (
          TASK_STATUSES.indexOf(a.status) - TASK_STATUSES.indexOf(b.status)
        );
      case "assignee":
        return text(a.assigneeName).localeCompare(text(b.assigneeName), "de");
      case "startsOn":
        return text(a.startsOn).localeCompare(text(b.startsOn));
      case "dueOn":
        return text(a.dueOn).localeCompare(text(b.dueOn));
      case "priority":
        return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
      default:
        return (planOrder.get(a.id) ?? 0) - (planOrder.get(b.id) ?? 0);
    }
  };
  const sorted = [...tasks].sort(
    (a, b) =>
      compare(a, b) || (planOrder.get(a.id) ?? 0) - (planOrder.get(b.id) ?? 0),
  );
  return descending ? sorted.reverse() : sorted;
}

// ---------------------------------------------------------------------------
// Zeitleiste
// ---------------------------------------------------------------------------

export type GanttZoom = "day" | "week" | "month";
export const GANTT_DAY_WIDTH: Record<GanttZoom, number> = {
  day: 30,
  week: 13,
  month: 5,
};

/** Visible range: everything dated, today, and some air on both sides. */
export function ganttRange(
  project: Pick<ProjectSummary, "startsOn" | "endsOn">,
  tasks: readonly Pick<ProjectTask, "startsOn" | "dueOn">[],
  today: string,
): { start: string; end: string; days: number } {
  const dates = [
    project.startsOn,
    project.endsOn,
    today,
    ...tasks.flatMap((task) => [task.startsOn, task.dueOn]),
  ]
    .filter((date): date is string => !!date)
    .sort();
  const start = startOfWeek(addDays(dates[0]!, -7));
  const end = addDays(startOfWeek(addDays(dates.at(-1)!, 21)), 6);
  return { start, end, days: diffDays(start, end) + 1 };
}

/**
 * Period a project covers on the timeline across all projects: its own dates,
 * completed by the plan (latest due date, milestones) where one is missing.
 */
export function projectSpan(
  project: Pick<ProjectSummary, "startsOn" | "endsOn" | "stats" | "milestones">,
): { start: string; end: string } | null {
  const planned = [
    project.stats.latestDueOn,
    ...(project.milestones ?? []).map((milestone) => milestone.dueOn),
  ]
    .filter((date): date is string => !!date)
    .sort();
  const start = project.startsOn ?? planned[0] ?? project.endsOn;
  const end = project.endsOn ?? planned.at(-1) ?? project.startsOn;
  if (!start || !end) return null;
  return end < start ? { start, end: start } : { start, end };
}

export type GanttSegment = { label: string; days: number; start: string };

const MONTHS = [
  "Januar",
  "Februar",
  "März",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Dezember",
];

export function monthSegments(start: string, days: number): GanttSegment[] {
  const segments: GanttSegment[] = [];
  for (let index = 0; index < days; index += 1) {
    const date = addDays(start, index);
    const key = date.slice(0, 7);
    const last = segments.at(-1);
    if (last && last.start.slice(0, 7) === key) last.days += 1;
    else {
      segments.push({
        label: `${MONTHS[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`,
        days: 1,
        start: date,
      });
    }
  }
  return segments;
}

/** ISO week number. */
export function weekNumber(date: string): number {
  const value = new Date(time(date));
  const weekday = value.getUTCDay() || 7;
  value.setUTCDate(value.getUTCDate() + 4 - weekday);
  const yearStart = Date.UTC(value.getUTCFullYear(), 0, 1);
  return Math.ceil(((value.getTime() - yearStart) / DAY_MS + 1) / 7);
}

export function weekSegments(start: string, days: number): GanttSegment[] {
  const segments: GanttSegment[] = [];
  for (let index = 0; index < days; index += 7) {
    const date = addDays(start, index);
    segments.push({
      label: `KW ${weekNumber(date)}`,
      days: Math.min(7, days - index),
      start: date,
    });
  }
  return segments;
}

export type GanttBar = { left: number; width: number };

export function ganttBar(
  rangeStart: string,
  startsOn: string | null,
  dueOn: string | null,
  dayWidth: number,
): GanttBar | null {
  const from = startsOn ?? dueOn;
  const to = dueOn ?? startsOn;
  if (!from || !to) return null;
  return {
    left: diffDays(rangeStart, from) * dayWidth,
    width: Math.max(1, diffDays(from, to) + 1) * dayWidth,
  };
}

/** Elbow line from one bar to the next, for the dependency arrows. */
export function dependencyPath(
  type: DependencyType,
  from: GanttBar & { y: number },
  to: GanttBar & { y: number },
): string {
  const fromX = type.startsWith("finish") ? from.left + from.width : from.left;
  const toX = type.endsWith("start") ? to.left : to.left + to.width;
  const out = type.startsWith("finish") ? 10 : -10;
  const into = type.endsWith("start") ? -10 : 10;
  const middleY = from.y + (to.y > from.y ? 14 : -14);
  if (
    (out > 0 && into < 0 && toX + into >= fromX + out) ||
    (out < 0 && into > 0 && toX + into <= fromX + out)
  ) {
    return `M${fromX},${from.y} H${fromX + out} V${to.y} H${toX}`;
  }
  return `M${fromX},${from.y} H${fromX + out} V${middleY} H${toX + into} V${to.y} H${toX}`;
}

/** Colour step of a workload cell: share of the day that is planned. */
export function loadLevel(
  minutes: number,
  capacity: number,
): 0 | 1 | 2 | 3 | 4 {
  if (minutes <= 0 || capacity <= 0) return 0;
  const share = minutes / capacity;
  if (share <= 0.5) return 1;
  if (share <= 0.85) return 2;
  if (share <= 1) return 3;
  return 4;
}
