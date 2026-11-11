// Serviceaufgabe (Fälligkeit) für die Detailansicht der App. Reine Logik,
// getestet in tests/service-task-model.test.ts. Quelle: Edge Function
// «service-tasks» (getOccurrence, access).

export type ServiceTaskChecklistItem = {
  id: string;
  label: string;
  done: boolean;
  doneByName: string | null;
};

export type ServiceTaskDetail = {
  id: string;
  title: string;
  category: string | null;
  instructions: string | null;
  referenceLabel: string | null;
  dueOn: string | null;
  status: "open" | "in_progress" | "done" | "skipped";
  overdue: boolean;
  assigneeName: string | null;
  requireNote: boolean;
  note: string | null;
  skippedReason: string | null;
  completedBy: string | null;
  checklist: ServiceTaskChecklistItem[];
};

export type ServiceTaskAccess = { canExecute: boolean };

export const SERVICE_TASK_STATUS_LABEL: Record<
  ServiceTaskDetail["status"],
  string
> = {
  open: "Offen",
  in_progress: "In Arbeit",
  done: "Erledigt",
  skipped: "Ausgelassen",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function envelope(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  return isRecord(value.data) ? value.data : value;
}

export function parseServiceTaskDetail(
  value: unknown,
): ServiceTaskDetail | null {
  const data = envelope(value);
  const occurrence = data && isRecord(data.occurrence) ? data.occurrence : null;
  if (!occurrence || typeof occurrence.id !== "string") return null;
  const status =
    occurrence.status === "in_progress" ||
    occurrence.status === "done" ||
    occurrence.status === "skipped"
      ? occurrence.status
      : "open";
  const assignee = isRecord(occurrence.assignee) ? occurrence.assignee : null;
  const checklist = Array.isArray(occurrence.checklist)
    ? occurrence.checklist.flatMap((entry): ServiceTaskChecklistItem[] =>
        isRecord(entry) &&
        typeof entry.id === "string" &&
        typeof entry.label === "string"
          ? [
              {
                id: entry.id,
                label: entry.label,
                done: entry.done === true,
                doneByName: text(entry.doneByName),
              },
            ]
          : [],
      )
    : [];
  return {
    id: occurrence.id,
    title: text(occurrence.title) ?? "Serviceaufgabe",
    category: text(occurrence.category),
    instructions: text(occurrence.instructions),
    referenceLabel: text(occurrence.referenceLabel),
    dueOn: text(occurrence.dueOn),
    status,
    overdue: occurrence.overdue === true,
    assigneeName: assignee ? text(assignee.name) : null,
    requireNote: occurrence.requireNote === true,
    note: text(occurrence.note),
    skippedReason: text(occurrence.skippedReason),
    completedBy: text(occurrence.completedBy),
    checklist,
  };
}

export function parseServiceTaskAccess(value: unknown): ServiceTaskAccess {
  const data = envelope(value);
  return { canExecute: data?.canExecute === true };
}

/** «2026-11-11» → «11.11.2026». */
export function formatServiceTaskDay(value: string | null): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "");
  return match ? `${match[3]}.${match[2]}.${match[1]}` : null;
}

export function isServiceTaskOpen(task: ServiceTaskDetail): boolean {
  return task.status === "open" || task.status === "in_progress";
}
