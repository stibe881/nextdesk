import { invokeNextDesk, loadCurrentTenant } from "@/lib/nextdesk-client";
import { CHANGE_TYPES, type ChangeType } from "@/lib/onboarding-change";

export type OnboardingTaskStatus =
  "open" | "in_progress" | "blocked" | "completed";

export type OnboardingTask = {
  canUpdate: boolean;
  dueOn: string;
  id: string;
  responsibleName: string;
  status: OnboardingTaskStatus;
  title: string;
};

export type OnboardingEntry = {
  /** Eintritt, Austritt oder Mutation. */
  kind: "onboarding" | "offboarding" | "change";
  /** Mutationsarten einer Mutation. */
  changeTypes: ChangeType[];
  details: Record<string, unknown>;
  employeeName: string;
  id: string;
  ictResponsibleName: string;
  /** ICT-Verantwortung (Agent); änderbar, wenn «canAssign». */
  ictResponsibleUserId: string | null;
  canAssign: boolean;
  /** Sichtbar als Stellvertretung für diese Person. */
  delegatedFor: string | null;
  location: string | null;
  managerName: string;
  organisationUnit: string | null;
  source: "email" | "manual";
  sourceTicketNumber: string | null;
  /** Die Eintrittsmeldung (PDF) ist beim Eintritt gespeichert. */
  hasDocument: boolean;
  startsOn: string;
  tasks: OnboardingTask[];
};

const STATUSES: readonly string[] = [
  "open",
  "in_progress",
  "blocked",
  "completed",
];

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function task(value: unknown): OnboardingTask | null {
  const item = record(value);
  if (
    !item ||
    typeof item.id !== "string" ||
    typeof item.title !== "string" ||
    typeof item.dueOn !== "string" ||
    typeof item.status !== "string" ||
    !STATUSES.includes(item.status)
  ) {
    return null;
  }
  return {
    canUpdate: item.canUpdate === true,
    dueOn: item.dueOn,
    id: item.id,
    responsibleName:
      typeof item.responsibleName === "string" ? item.responsibleName : "",
    status: item.status as OnboardingTaskStatus,
    title: item.title,
  };
}

function entry(value: unknown): OnboardingEntry | null {
  const item = record(value);
  if (
    !item ||
    typeof item.id !== "string" ||
    typeof item.employeeName !== "string" ||
    typeof item.startsOn !== "string" ||
    !Array.isArray(item.tasks)
  ) {
    return null;
  }
  return {
    kind:
      item.kind === "offboarding" || item.kind === "change"
        ? item.kind
        : "onboarding",
    changeTypes: Array.isArray(item.changeTypes)
      ? item.changeTypes.filter((type): type is ChangeType =>
          (CHANGE_TYPES as readonly unknown[]).includes(type),
        )
      : [],
    details: record(item.details) ?? {},
    employeeName: item.employeeName,
    id: item.id,
    ictResponsibleName:
      typeof item.ictResponsibleName === "string"
        ? item.ictResponsibleName
        : "",
    ictResponsibleUserId:
      typeof item.ictResponsibleUserId === "string"
        ? item.ictResponsibleUserId
        : null,
    canAssign: item.canAssign === true,
    delegatedFor:
      typeof item.delegatedFor === "string" && item.delegatedFor.trim()
        ? item.delegatedFor
        : null,
    location: typeof item.location === "string" ? item.location : null,
    managerName: typeof item.managerName === "string" ? item.managerName : "",
    organisationUnit:
      typeof item.organisationUnit === "string" ? item.organisationUnit : null,
    source: item.source === "email" ? "email" : "manual",
    sourceTicketNumber:
      typeof item.sourceTicketNumber === "string"
        ? item.sourceTicketNumber
        : null,
    hasDocument: item.hasDocument === true,
    startsOn: item.startsOn,
    tasks: item.tasks.flatMap((candidate) => {
      const parsed = task(candidate);
      return parsed ? [parsed] : [];
    }),
  };
}

export type OnboardingAgent = { id: string; displayName: string };

/** Eintritte, die diese Person sehen darf (die Prüfung erfolgt auf dem Server). */
export async function loadOnboardingEntries(): Promise<OnboardingEntry[]> {
  return (await loadOnboardingWorkspace()).entries;
}

/** Eintritte und die Agenten, denen sie sich zuweisen lassen. */
export async function loadOnboardingWorkspace(): Promise<{
  entries: OnboardingEntry[];
  agents: OnboardingAgent[];
}> {
  const tenant = await loadCurrentTenant();
  const body = record(
    await invokeNextDesk<unknown>("onboarding", {
      type: "listWorkspace",
      tenantId: tenant.id,
    }),
  );
  const data = record(body?.data);
  if (!data || !Array.isArray(data.entries)) {
    throw new Error("Die Eintritte konnten nicht geladen werden.");
  }
  return {
    entries: data.entries.flatMap((candidate) => {
      const parsed = entry(candidate);
      return parsed ? [parsed] : [];
    }),
    agents: (Array.isArray(data.agents) ? data.agents : []).flatMap(
      (candidate) => {
        const item = record(candidate);
        return item &&
          typeof item.id === "string" &&
          typeof item.displayName === "string"
          ? [{ id: item.id, displayName: item.displayName }]
          : [];
      },
    ),
  };
}

/**
 * Weist einen Ein- oder Austritt einem Agenten zu. Ist die Person abwesend,
 * geht er an ihre Stellvertretung («redirected»).
 */
export async function assignOnboardingEntry(
  entryId: string,
  userId: string,
): Promise<{
  assignedName: string | null;
  redirected: boolean;
  requestedName: string | null;
}> {
  const tenant = await loadCurrentTenant();
  const body = record(
    await invokeNextDesk<unknown>("onboarding", {
      type: "assignEntry",
      tenantId: tenant.id,
      entryId,
      userId,
    }),
  );
  const data = record(body?.data) ?? {};
  return {
    assignedName:
      typeof data.assignedName === "string" ? data.assignedName : null,
    redirected: data.redirected === true,
    requestedName:
      typeof data.requestedName === "string" ? data.requestedName : null,
  };
}

/** Kurz gültige Adresse der Eintrittsmeldung (PDF) eines Eintritts. */
export async function onboardingDocumentUrl(entryId: string): Promise<string> {
  const tenant = await loadCurrentTenant();
  const body = record(
    await invokeNextDesk<unknown>("onboarding", {
      type: "documentUrl",
      tenantId: tenant.id,
      entryId,
    }),
  );
  const url = record(body?.data)?.url;
  if (typeof url !== "string") {
    throw new Error("Die Eintrittsmeldung konnte nicht geöffnet werden.");
  }
  return url;
}

export async function setOnboardingTaskStatus(
  taskId: string,
  status: OnboardingTaskStatus,
): Promise<void> {
  const tenant = await loadCurrentTenant();
  await invokeNextDesk<unknown>("onboarding", {
    type: "updateTaskStatus",
    tenantId: tenant.id,
    taskId,
    status,
  });
}

export function onboardingProgress(tasks: readonly OnboardingTask[]): {
  done: number;
  percent: number;
  total: number;
} {
  const done = tasks.filter((item) => item.status === "completed").length;
  return {
    done,
    percent: tasks.length ? Math.round((done / tasks.length) * 100) : 0,
    total: tasks.length,
  };
}

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

/** Angaben aus der Eintrittsmeldung als Beschriftung und Wert. */
export function onboardingDetailRows(
  details: Record<string, unknown>,
): { label: string; value: string }[] {
  const functions = Array.isArray(details.functions)
    ? (details.functions as unknown[]).map(record).filter(Boolean)
    : [];
  const rows: { label: string; value: string | null }[] = [
    { label: "Ausgefüllt von", value: text(details.filledBy) },
    { label: "Berufsbezeichnung", value: text(details.jobTitle) },
    { label: "Vorgesetzte Person", value: text(details.supervisor) },
    ...functions.map((item, index) => ({
      label: `Funktion ${index + 1}`,
      value:
        [item?.offer, item?.team, item?.role, item?.special]
          .map(text)
          .filter(Boolean)
          .join(" · ") || null,
    })),
    {
      label: "Anstellung",
      value:
        details.fixedTerm === true
          ? `befristet${text(details.endDate) ? ` bis ${text(details.endDate)}` : ""}`
          : details.fixedTerm === false
            ? "unbefristet"
            : null,
    },
    { label: "Raum", value: text(details.room) },
    {
      label: "Schlüssel",
      value:
        details.needsKey === true
          ? "Ja"
          : details.needsKey === false
            ? "Nein"
            : null,
    },
    { label: "ICT-Ausstattung", value: text(details.ictEquipment) },
    { label: "ICT-Zugänge", value: text(details.ictAccess) },
    { label: "Gruppenpostfächer", value: text(details.groupMailboxes) },
    {
      label: "Doppelname",
      value:
        details.doubleName === true ? (text(details.aliasName) ?? "Ja") : null,
    },
    { label: "Bemerkung", value: text(details.remarks) },
  ];
  return rows.filter(
    (row): row is { label: string; value: string } => row.value !== null,
  );
}
