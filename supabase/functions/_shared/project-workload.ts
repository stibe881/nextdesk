/**
 * Auslastung: verteilt den offenen Aufwand je Person auf Arbeitstage.
 *
 * Projektaufgaben zählen mit ihrem Restaufwand (Schätzung abzüglich
 * Fortschritt), Serviceaufgaben mit ihrer Schätzung, Tickets mit einer
 * Pauschale, weil sie keinen Aufwandswert haben. Der Aufwand wird
 * gleichmässig auf die Arbeitstage zwischen heute (oder dem Start, falls er
 * später liegt) und dem Termin verteilt; Überfälliges fällt auf heute.
 */
import { nextWorkday, workdaysInRange } from "./project-schedule.ts";

export type WorkItemKind = "project_task" | "ticket" | "service_task";

export type WorkItem = {
  kind: WorkItemKind;
  id: string;
  projectId: string | null;
  title: string;
  assigneeId: string | null;
  startsOn: string | null;
  dueOn: string | null;
  estimatedMinutes: number | null;
  progressPercent: number;
};

export type WorkloadSettings = {
  ticketMinutes: number;
  dailyCapacityMinutes: number;
};

export type WorkloadDay = {
  date: string;
  minutes: number;
  projectMinutes: number;
  ticketMinutes: number;
  serviceTaskMinutes: number;
};

export type WorkloadPerson = {
  userId: string;
  totalMinutes: number;
  capacityMinutes: number;
  /** 100 = genau ausgelastet. */
  utilizationPercent: number;
  overloadedDays: number;
  days: WorkloadDay[];
  counts: Record<WorkItemKind, number>;
  /** Aufgaben ohne Schätzung: sichtbar, aber ohne Minuten. */
  unestimated: number;
  items: Array<{
    kind: WorkItemKind;
    id: string;
    projectId: string | null;
    title: string;
    dueOn: string | null;
    minutes: number;
    overdue: boolean;
  }>;
};

export function remainingMinutes(
  item: WorkItem,
  settings: WorkloadSettings,
): number {
  if (item.kind === "ticket") return settings.ticketMinutes;
  const estimate = item.estimatedMinutes ?? 0;
  if (item.kind === "service_task") return estimate;
  const progress = Math.min(100, Math.max(0, item.progressPercent));
  return Math.round((estimate * (100 - progress)) / 100);
}

/** The workdays an item's remaining effort is spread over. */
export function workWindow(item: WorkItem, today: string): string[] {
  const start = item.startsOn && item.startsOn > today ? item.startsOn : today;
  const end = item.dueOn && item.dueOn > start ? item.dueOn : start;
  const days = workdaysInRange(start, end);
  return days.length ? days : [nextWorkday(end)];
}

export function computeWorkload(
  items: readonly WorkItem[],
  from: string,
  to: string,
  today: string,
  settings: WorkloadSettings,
): WorkloadPerson[] {
  const rangeDays = workdaysInRange(from, to);
  const people = new Map<string, WorkloadPerson>();
  const dayIndex = new Map<string, Map<string, WorkloadDay>>();

  for (const item of items) {
    if (!item.assigneeId) continue;
    let person = people.get(item.assigneeId);
    if (!person) {
      const days = rangeDays.map((date) => ({
        date,
        minutes: 0,
        projectMinutes: 0,
        ticketMinutes: 0,
        serviceTaskMinutes: 0,
      }));
      person = {
        userId: item.assigneeId,
        totalMinutes: 0,
        capacityMinutes: rangeDays.length * settings.dailyCapacityMinutes,
        utilizationPercent: 0,
        overloadedDays: 0,
        days,
        counts: { project_task: 0, ticket: 0, service_task: 0 },
        unestimated: 0,
        items: [],
      };
      people.set(item.assigneeId, person);
      dayIndex.set(
        item.assigneeId,
        new Map(days.map((day) => [day.date, day])),
      );
    }

    const minutes = remainingMinutes(item, settings);
    const window = workWindow(item, today);
    const share = minutes / window.length;
    let inRange = 0;
    const index = dayIndex.get(item.assigneeId)!;
    for (const date of window) {
      const day = index.get(date);
      if (!day) continue;
      day.minutes += share;
      if (item.kind === "project_task") day.projectMinutes += share;
      else if (item.kind === "ticket") day.ticketMinutes += share;
      else day.serviceTaskMinutes += share;
      inRange += share;
    }
    // Only what touches the visible range is listed.
    if (inRange <= 0 && !window.some((date) => date >= from && date <= to)) {
      continue;
    }
    person.counts[item.kind] += 1;
    if (item.kind !== "ticket" && item.estimatedMinutes === null) {
      person.unestimated += 1;
    }
    person.items.push({
      kind: item.kind,
      id: item.id,
      projectId: item.projectId,
      title: item.title,
      dueOn: item.dueOn,
      minutes: Math.round(inRange),
      overdue: !!item.dueOn && item.dueOn < today,
    });
  }

  for (const person of people.values()) {
    for (const day of person.days) {
      day.minutes = Math.round(day.minutes);
      day.projectMinutes = Math.round(day.projectMinutes);
      day.ticketMinutes = Math.round(day.ticketMinutes);
      day.serviceTaskMinutes = Math.round(day.serviceTaskMinutes);
      person.totalMinutes += day.minutes;
      if (day.minutes > settings.dailyCapacityMinutes)
        person.overloadedDays += 1;
    }
    person.utilizationPercent = person.capacityMinutes
      ? Math.round((person.totalMinutes / person.capacityMinutes) * 100)
      : 0;
    person.items.sort(
      (a, b) =>
        (a.dueOn ?? "9999").localeCompare(b.dueOn ?? "9999") ||
        b.minutes - a.minutes,
    );
  }

  return [...people.values()].sort(
    (a, b) => b.utilizationPercent - a.utilizationPercent,
  );
}
