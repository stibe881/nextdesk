/**
 * Projektvorlagen: ein Projekt als Snapshot ablegen und daraus ein neues
 * Projekt aufbauen. Termine stehen im Snapshot als Kalendertage ab
 * Projektstart, damit die Vorlage an jedem Startdatum funktioniert.
 */
import {
  addCalendarDays,
  calendarDaysBetween,
  type DependencyType,
  isIsoDate,
} from "./project-schedule.ts";

export const TEMPLATE_VERSION = 1;
const KINDS = new Set(["phase", "milestone", "task"]);
const PRIORITIES = new Set(["low", "normal", "high", "urgent"]);
const DEPENDENCY_TYPES = new Set([
  "finish_to_start",
  "start_to_start",
  "finish_to_finish",
  "start_to_finish",
]);
const MAX_ITEMS = 500;

export type TemplateItem = {
  key: string;
  parentKey: string | null;
  kind: "phase" | "milestone" | "task";
  title: string;
  description: string | null;
  priority: "low" | "normal" | "high" | "urgent";
  estimatedMinutes: number | null;
  startOffset: number | null;
  dueOffset: number | null;
  position: number;
  checklist: string[];
};

export type TemplateSnapshot = {
  version: number;
  durationDays: number | null;
  budgetMinutes: number | null;
  items: TemplateItem[];
  dependencies: Array<{
    from: string;
    to: string;
    type: DependencyType;
    lagDays: number;
  }>;
  documents: Array<{
    title: string;
    body: string;
    visibility: "internal" | "external";
  }>;
};

export type SourceTask = {
  id: string;
  parentId: string | null;
  kind: string;
  title: string;
  description: string | null;
  priority: string;
  estimatedMinutes: number | null;
  startsOn: string | null;
  dueOn: string | null;
  position: number;
};

export type SourceProject = {
  startsOn: string | null;
  endsOn: string | null;
  budgetMinutes: number | null;
};

/** Anchor for the offsets: the project start, else the earliest task date. */
function anchorDate(project: SourceProject, tasks: readonly SourceTask[]) {
  if (project.startsOn) return project.startsOn;
  const dates = tasks
    .flatMap((task) => [task.startsOn, task.dueOn])
    .filter((date): date is string => !!date)
    .sort();
  return dates[0] ?? null;
}

export function buildSnapshot(
  project: SourceProject,
  tasks: readonly SourceTask[],
  checklists: ReadonlyMap<string, string[]>,
  dependencies: ReadonlyArray<{
    predecessorId: string;
    successorId: string;
    type: DependencyType;
    lagDays: number;
  }>,
  documents: ReadonlyArray<{ title: string; body: string; visibility: string }>,
): TemplateSnapshot {
  const anchor = anchorDate(project, tasks);
  const keys = new Map(tasks.map((task, index) => [task.id, `t${index + 1}`]));
  const offset = (date: string | null) =>
    anchor && date ? calendarDaysBetween(anchor, date) : null;
  const lastDate = [project.endsOn, ...tasks.map((task) => task.dueOn)]
    .filter((date): date is string => !!date)
    .sort()
    .at(-1);
  return {
    version: TEMPLATE_VERSION,
    durationDays:
      anchor && lastDate ? calendarDaysBetween(anchor, lastDate) : null,
    budgetMinutes: project.budgetMinutes,
    items: tasks.map((task) => ({
      key: keys.get(task.id)!,
      parentKey: task.parentId ? (keys.get(task.parentId) ?? null) : null,
      kind: task.kind as TemplateItem["kind"],
      title: task.title,
      description: task.description,
      priority: task.priority as TemplateItem["priority"],
      estimatedMinutes: task.estimatedMinutes,
      startOffset: offset(task.startsOn),
      dueOffset: offset(task.dueOn),
      position: task.position,
      checklist: checklists.get(task.id) ?? [],
    })),
    dependencies: dependencies
      .filter(
        (dependency) =>
          keys.has(dependency.predecessorId) &&
          keys.has(dependency.successorId),
      )
      .map((dependency) => ({
        from: keys.get(dependency.predecessorId)!,
        to: keys.get(dependency.successorId)!,
        type: dependency.type,
        lagDays: dependency.lagDays,
      })),
    documents: documents.map((document) => ({
      title: document.title,
      body: document.body,
      visibility: document.visibility === "external" ? "external" : "internal",
    })),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function intOrNull(value: unknown, min: number, max: number): number | null {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= min &&
    value <= max
    ? value
    : null;
}

/** Reads a stored snapshot defensively; null when it cannot be used. */
export function normalizeSnapshot(value: unknown): TemplateSnapshot | null {
  if (!isRecord(value) || !Array.isArray(value.items)) return null;
  if (value.items.length > MAX_ITEMS) return null;
  const items: TemplateItem[] = [];
  const seen = new Set<string>();
  for (const raw of value.items) {
    if (!isRecord(raw)) return null;
    const key = typeof raw.key === "string" ? raw.key : "";
    const title = typeof raw.title === "string" ? raw.title.trim() : "";
    if (!key || seen.has(key) || !title || title.length > 240) return null;
    if (typeof raw.kind !== "string" || !KINDS.has(raw.kind)) return null;
    seen.add(key);
    items.push({
      key,
      parentKey: typeof raw.parentKey === "string" ? raw.parentKey : null,
      kind: raw.kind as TemplateItem["kind"],
      title,
      description:
        typeof raw.description === "string" && raw.description.length <= 20000
          ? raw.description
          : null,
      priority: (typeof raw.priority === "string" &&
      PRIORITIES.has(raw.priority)
        ? raw.priority
        : "normal") as TemplateItem["priority"],
      estimatedMinutes: intOrNull(raw.estimatedMinutes, 0, 600000),
      startOffset: intOrNull(raw.startOffset, -3650, 3650),
      dueOffset: intOrNull(raw.dueOffset, -3650, 3650),
      position: intOrNull(raw.position, -100000, 100000) ?? 0,
      checklist: Array.isArray(raw.checklist)
        ? raw.checklist
            .filter((entry): entry is string => typeof entry === "string")
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0 && entry.length <= 500)
            .slice(0, 60)
        : [],
    });
  }
  for (const item of items) {
    if (item.parentKey && !seen.has(item.parentKey)) item.parentKey = null;
  }
  const dependencies = (
    Array.isArray(value.dependencies) ? value.dependencies : []
  )
    .filter(isRecord)
    .filter(
      (raw) =>
        typeof raw.from === "string" &&
        typeof raw.to === "string" &&
        seen.has(raw.from) &&
        seen.has(raw.to) &&
        raw.from !== raw.to &&
        typeof raw.type === "string" &&
        DEPENDENCY_TYPES.has(raw.type),
    )
    .map((raw) => ({
      from: raw.from as string,
      to: raw.to as string,
      type: raw.type as DependencyType,
      lagDays: intOrNull(raw.lagDays, -365, 365) ?? 0,
    }));
  const documents = (Array.isArray(value.documents) ? value.documents : [])
    .filter(isRecord)
    .filter(
      (raw) =>
        typeof raw.title === "string" &&
        raw.title.trim().length > 0 &&
        raw.title.length <= 200 &&
        typeof raw.body === "string" &&
        raw.body.length <= 200000,
    )
    .slice(0, 50)
    .map((raw) => ({
      title: (raw.title as string).trim(),
      body: raw.body as string,
      visibility: (raw.visibility === "external" ? "external" : "internal") as
        "internal" | "external",
    }));
  return {
    version: TEMPLATE_VERSION,
    durationDays: intOrNull(value.durationDays, 0, 3650),
    budgetMinutes: intOrNull(value.budgetMinutes, 0, 6000000),
    items,
    dependencies,
    documents,
  };
}

export type InstantiatedTask = {
  id: string;
  parentId: string | null;
  level: number;
  kind: TemplateItem["kind"];
  title: string;
  description: string | null;
  priority: TemplateItem["priority"];
  estimatedMinutes: number | null;
  startsOn: string | null;
  dueOn: string | null;
  position: number;
  checklist: string[];
};

export type InstantiatedProject = {
  endsOn: string | null;
  budgetMinutes: number | null;
  /** Parents always come before their children. */
  tasks: InstantiatedTask[];
  dependencies: Array<{
    predecessorId: string;
    successorId: string;
    type: DependencyType;
    lagDays: number;
  }>;
  documents: TemplateSnapshot["documents"];
};

export function instantiateSnapshot(
  snapshot: TemplateSnapshot,
  startsOn: string | null,
  newId: () => string,
): InstantiatedProject {
  const start = isIsoDate(startsOn) ? startsOn : null;
  const ids = new Map(snapshot.items.map((item) => [item.key, newId()]));
  const byKey = new Map(snapshot.items.map((item) => [item.key, item]));
  const levelOf = (item: TemplateItem): number => {
    let level = 0;
    let current: TemplateItem | undefined = item;
    while (current?.parentKey && level < 10) {
      current = byKey.get(current.parentKey);
      level += 1;
    }
    return level;
  };
  const date = (offset: number | null) =>
    start !== null && offset !== null ? addCalendarDays(start, offset) : null;
  const tasks = snapshot.items
    .map((item) => {
      const starts = date(item.startOffset);
      const due = date(item.dueOffset);
      return {
        id: ids.get(item.key)!,
        parentId: item.parentKey ? ids.get(item.parentKey)! : null,
        level: levelOf(item),
        kind: item.kind,
        title: item.title,
        description: item.description,
        priority: item.priority,
        estimatedMinutes: item.estimatedMinutes,
        startsOn: item.kind === "milestone" ? (due ?? starts) : starts,
        dueOn: item.kind === "milestone" ? (due ?? starts) : due,
        position: item.position,
        checklist: item.checklist,
      };
    })
    .sort((a, b) => a.level - b.level || a.position - b.position);
  return {
    endsOn: date(snapshot.durationDays),
    budgetMinutes: snapshot.budgetMinutes,
    tasks,
    dependencies: snapshot.dependencies.map((dependency) => ({
      predecessorId: ids.get(dependency.from)!,
      successorId: ids.get(dependency.to)!,
      type: dependency.type,
      lagDays: dependency.lagDays,
    })),
    documents: snapshot.documents,
  };
}
