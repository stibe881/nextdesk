import * as Crypto from "expo-crypto";

import { invokeNextDesk } from "@/lib/nextdesk-client";

type RecordValue = Record<string, unknown>;

export type Option = { id: string; name: string };

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function options(value: unknown): Option[] {
  return Array.isArray(value)
    ? value.flatMap((entry) =>
        isRecord(entry) &&
        typeof entry.id === "string" &&
        typeof entry.name === "string"
          ? [{ id: entry.id, name: entry.name }]
          : [],
      )
    : [];
}

function data(value: unknown): RecordValue {
  return isRecord(value) && isRecord(value.data) ? value.data : {};
}

/** Follow-up (Wiedervorlage) for the signed-in agent. */
export async function createMobileFollowUp(input: {
  tenantId: string;
  title: string;
  description: string;
  dueAt: string | null;
  priority: "low" | "normal" | "high";
}): Promise<void> {
  await invokeNextDesk("experience-hub", {
    type: "saveFollowUp",
    tenantId: input.tenantId,
    title: input.title,
    description: input.description.trim() || null,
    dueAt: input.dueAt,
    priority: input.priority,
    ticketId: null,
  });
}

export type ServiceTaskSetup = {
  canManage: boolean;
  departments: Option[];
  people: Option[];
  today: string;
};

/** Rights and pickers for a new service task. */
export async function loadServiceTaskSetup(
  tenantId: string,
): Promise<ServiceTaskSetup> {
  const result = data(
    await invokeNextDesk<unknown>("service-tasks", {
      type: "overview",
      tenantId,
      scope: "mine",
    }),
  );
  const access = isRecord(result.access) ? result.access : {};
  return {
    canManage: access.canManage === true,
    departments: options(result.departments),
    people: options(result.people),
    today:
      typeof result.today === "string"
        ? result.today
        : new Date().toISOString().slice(0, 10),
  };
}

export type ServiceTaskRepeat = "daily" | "weekly" | "monthly" | "yearly";

function recurrence(repeat: ServiceTaskRepeat, startsOn: string) {
  const start = new Date(`${startsOn}T12:00:00Z`);
  // ISO weekday 1 (Mon) … 7 (Sun).
  const weekday = ((start.getUTCDay() + 6) % 7) + 1;
  switch (repeat) {
    case "daily":
      return { frequency: "daily", interval: 1, skipNonWorkdays: true };
    case "weekly":
      return {
        frequency: "weekly",
        interval: 1,
        skipNonWorkdays: false,
        weekdays: [weekday],
      };
    case "monthly":
      return {
        frequency: "monthly",
        interval: 1,
        skipNonWorkdays: false,
        monthlyMode: "day",
        dayOfMonth: start.getUTCDate(),
      };
    case "yearly":
      return {
        frequency: "yearly",
        interval: 1,
        skipNonWorkdays: false,
        month: start.getUTCMonth() + 1,
        dayOfMonth: start.getUTCDate(),
      };
  }
}

export async function createMobileServiceTask(input: {
  tenantId: string;
  title: string;
  instructions: string;
  repeat: ServiceTaskRepeat;
  startsOn: string;
  dueTime: string;
  assigneeId: string | null;
  departmentId: string | null;
}): Promise<void> {
  await invokeNextDesk("service-tasks", {
    type: "saveTemplate",
    tenantId: input.tenantId,
    title: input.title,
    instructions: input.instructions.trim() || null,
    category: null,
    priority: "normal",
    assigneeId: input.assigneeId,
    teamId: null,
    departmentId: input.departmentId,
    referenceLabel: null,
    estimatedMinutes: null,
    recurrence: recurrence(input.repeat, input.startsOn),
    startsOn: input.startsOn,
    endsOn: null,
    dueTime: input.dueTime,
    leadDays: 3,
    checklist: [],
    requireNote: false,
    remind: true,
    escalateAfterDays: 2,
    active: true,
  });
}

export type InventorySetup = { canManage: boolean; departments: Option[] };

export async function loadInventorySetup(
  tenantId: string,
): Promise<InventorySetup> {
  const result = data(
    await invokeNextDesk<unknown>("inventory", { type: "workspace", tenantId }),
  );
  const permissions = isRecord(result.permissions) ? result.permissions : {};
  return {
    canManage: permissions.canManage === true,
    departments: options(result.departments),
  };
}

export async function createMobileInventoryItem(input: {
  tenantId: string;
  articleNumber: string;
  name: string;
  category: string;
  unit: string;
  minimumStock: number;
  targetStock: number;
  departmentId: string | null;
}): Promise<void> {
  await invokeNextDesk("inventory", {
    type: "manageItem",
    tenantId: input.tenantId,
    operation: "create",
    values: {
      articleNumber: input.articleNumber,
      name: input.name,
      category: input.category,
      unit: input.unit,
      trackingMode: "quantity",
      minimumStock: input.minimumStock,
      targetStock: input.targetStock,
      ...(input.departmentId ? { departmentId: input.departmentId } : {}),
    },
    clientRequestId: Crypto.randomUUID(),
  });
}
