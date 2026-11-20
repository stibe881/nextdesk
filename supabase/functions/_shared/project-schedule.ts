/**
 * Terminlogik für Projekte: Arbeitstage (Montag bis Freitag) und die
 * Kaskade über Abhängigkeiten.
 *
 * Regeln der Kaskade:
 *  - Ein Nachfolger wird nur nach hinten geschoben, nie vorgezogen; ein
 *    bewusst eingeplanter Puffer bleibt erhalten.
 *  - Die Dauer in Arbeitstagen bleibt erhalten.
 *  - Erledigte Elemente bleiben stehen.
 *  - Elemente mit Kindern (Phasen, Aufgaben mit Unteraufgaben) übernehmen
 *    ihren Zeitraum von den Kindern; werden sie verschoben, wandern die Kinder
 *    mit.
 */

export type DependencyType =
  "finish_to_start" | "start_to_start" | "finish_to_finish" | "start_to_finish";

export type ScheduleTask = {
  id: string;
  parentId: string | null;
  startsOn: string | null;
  dueOn: string | null;
  done: boolean;
};

export type ScheduleDependency = {
  predecessorId: string;
  successorId: string;
  type: DependencyType;
  lagDays: number;
};

export type ScheduleChange = {
  id: string;
  startsOn: string | null;
  dueOn: string | null;
};

export class ScheduleCycleError extends Error {
  constructor() {
    super("project_schedule_cycle");
  }
}

const DAY_MS = 86_400_000;

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const time = Date.parse(`${value}T00:00:00Z`);
  return (
    Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value
  );
}

function toTime(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

function fromTime(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

export function addCalendarDays(date: string, days: number): string {
  return fromTime(toTime(date) + days * DAY_MS);
}

export function calendarDaysBetween(from: string, to: string): number {
  return Math.round((toTime(to) - toTime(from)) / DAY_MS);
}

export function isWorkday(date: string): boolean {
  const weekday = new Date(toTime(date)).getUTCDay();
  return weekday !== 0 && weekday !== 6;
}

/** The date itself when it is a workday, otherwise the following Monday. */
export function nextWorkday(date: string): string {
  let current = date;
  while (!isWorkday(current)) current = addCalendarDays(current, 1);
  return current;
}

/**
 * Moves by whole workdays. 0 keeps a workday and moves a weekend day to
 * Monday; negative values move backwards.
 */
export function addWorkdays(date: string, days: number): string {
  if (days === 0) return nextWorkday(date);
  const step = days > 0 ? 1 : -1;
  let remaining = Math.abs(days);
  let current = date;
  while (remaining > 0) {
    current = addCalendarDays(current, step);
    if (isWorkday(current)) remaining -= 1;
  }
  return current;
}

/** Workdays in the closed range; 0 when the range is empty. */
export function workdaysInRange(from: string, to: string): string[] {
  const days: string[] = [];
  for (
    let current = from;
    current <= to;
    current = addCalendarDays(current, 1)
  ) {
    if (isWorkday(current)) days.push(current);
  }
  return days;
}

/** How many workdays `from` has to move forward to reach at least `to`. */
function workdayGap(from: string, to: string): number {
  if (to <= from) return 0;
  let gap = 0;
  let current = from;
  while (current < to) {
    current = addWorkdays(current, 1);
    gap += 1;
  }
  return gap;
}

type Working = Map<string, { startsOn: string | null; dueOn: string | null }>;

function childrenOf(tasks: readonly ScheduleTask[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const task of tasks) {
    if (!task.parentId) continue;
    const list = map.get(task.parentId) ?? [];
    list.push(task.id);
    map.set(task.parentId, list);
  }
  return map;
}

function rollUp(
  tasks: readonly ScheduleTask[],
  children: Map<string, string[]>,
  working: Working,
): void {
  const visit = (id: string, depth: number): void => {
    const kids = children.get(id);
    if (!kids?.length || depth > 8) return;
    let start: string | null = null;
    let due: string | null = null;
    for (const kid of kids) {
      visit(kid, depth + 1);
      const dates = working.get(kid);
      if (!dates) continue;
      const kidStart = dates.startsOn ?? dates.dueOn;
      const kidDue = dates.dueOn ?? dates.startsOn;
      if (kidStart && (!start || kidStart < start)) start = kidStart;
      if (kidDue && (!due || kidDue > due)) due = kidDue;
    }
    if (start && due) working.set(id, { startsOn: start, dueOn: due });
  };
  for (const task of tasks) {
    if (!task.parentId) visit(task.id, 0);
  }
}

function shiftTree(
  id: string,
  days: number,
  children: Map<string, string[]>,
  working: Working,
  done: Set<string>,
  depth = 0,
): void {
  if (depth > 8) return;
  const kids = children.get(id);
  if (kids?.length) {
    for (const kid of kids) {
      shiftTree(kid, days, children, working, done, depth + 1);
    }
    return;
  }
  if (done.has(id)) return;
  const dates = working.get(id);
  if (!dates) return;
  working.set(id, {
    startsOn: dates.startsOn ? addWorkdays(dates.startsOn, days) : null,
    dueOn: dates.dueOn ? addWorkdays(dates.dueOn, days) : null,
  });
}

function requiredShift(
  dependency: ScheduleDependency,
  working: Working,
): number {
  const predecessor = working.get(dependency.predecessorId);
  const successor = working.get(dependency.successorId);
  if (!predecessor || !successor) return 0;
  const predecessorStart = predecessor.startsOn ?? predecessor.dueOn;
  const predecessorDue = predecessor.dueOn ?? predecessor.startsOn;
  const successorStart = successor.startsOn ?? successor.dueOn;
  const successorDue = successor.dueOn ?? successor.startsOn;
  switch (dependency.type) {
    case "finish_to_start":
      if (!predecessorDue || !successorStart) return 0;
      return workdayGap(
        successorStart,
        addWorkdays(predecessorDue, 1 + dependency.lagDays),
      );
    case "start_to_start":
      if (!predecessorStart || !successorStart) return 0;
      return workdayGap(
        successorStart,
        addWorkdays(predecessorStart, dependency.lagDays),
      );
    case "finish_to_finish":
      if (!predecessorDue || !successorDue) return 0;
      return workdayGap(
        successorDue,
        addWorkdays(predecessorDue, dependency.lagDays),
      );
    case "start_to_finish":
      if (!predecessorStart || !successorDue) return 0;
      return workdayGap(
        successorDue,
        addWorkdays(predecessorStart, dependency.lagDays),
      );
  }
}

/** True when the dependencies contain a circle. */
export function hasDependencyCycle(
  dependencies: readonly Pick<
    ScheduleDependency,
    "predecessorId" | "successorId"
  >[],
): boolean {
  const next = new Map<string, string[]>();
  const incoming = new Map<string, number>();
  for (const dependency of dependencies) {
    next.set(dependency.predecessorId, [
      ...(next.get(dependency.predecessorId) ?? []),
      dependency.successorId,
    ]);
    incoming.set(
      dependency.successorId,
      (incoming.get(dependency.successorId) ?? 0) + 1,
    );
    if (!incoming.has(dependency.predecessorId)) {
      incoming.set(dependency.predecessorId, 0);
    }
  }
  const queue = [...incoming]
    .filter(([, count]) => count === 0)
    .map(([id]) => id);
  let visited = 0;
  while (queue.length) {
    const id = queue.shift()!;
    visited += 1;
    for (const target of next.get(id) ?? []) {
      const count = (incoming.get(target) ?? 0) - 1;
      incoming.set(target, count);
      if (count === 0) queue.push(target);
    }
  }
  return visited !== incoming.size;
}

/**
 * Returns every element whose dates have to change so that all dependencies
 * hold and parents span their children.
 */
export function computeSchedule(
  tasks: readonly ScheduleTask[],
  dependencies: readonly ScheduleDependency[],
): ScheduleChange[] {
  const known = new Set(tasks.map((task) => task.id));
  const relevant = dependencies.filter(
    (dependency) =>
      known.has(dependency.predecessorId) && known.has(dependency.successorId),
  );
  if (hasDependencyCycle(relevant)) throw new ScheduleCycleError();

  const children = childrenOf(tasks);
  const done = new Set(
    tasks.filter((task) => task.done).map((task) => task.id),
  );
  const working: Working = new Map(
    tasks.map((task) => [
      task.id,
      { startsOn: task.startsOn, dueOn: task.dueOn },
    ]),
  );

  // Each pass moves at least one element further out; hierarchy and
  // dependencies together can need several passes.
  const maxPasses = tasks.length * 4 + 10;
  let pass = 0;
  for (;;) {
    rollUp(tasks, children, working);
    let moved = false;
    for (const dependency of relevant) {
      const shift = requiredShift(dependency, working);
      if (shift <= 0) continue;
      const before = JSON.stringify([...working]);
      shiftTree(dependency.successorId, shift, children, working, done);
      if (JSON.stringify([...working]) !== before) {
        moved = true;
        rollUp(tasks, children, working);
      }
    }
    if (!moved) break;
    pass += 1;
    // A parent that depends on its own child can never settle.
    if (pass > maxPasses) throw new ScheduleCycleError();
  }

  const changes: ScheduleChange[] = [];
  for (const task of tasks) {
    const dates = working.get(task.id)!;
    if (dates.startsOn !== task.startsOn || dates.dueOn !== task.dueOn) {
      changes.push({
        id: task.id,
        startsOn: dates.startsOn,
        dueOn: dates.dueOn,
      });
    }
  }
  return changes;
}
