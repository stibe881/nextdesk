import { invokeNextDesk } from "@/lib/nextdesk-client";
import {
  parseServiceTaskAccess,
  parseServiceTaskDetail,
  type ServiceTaskAccess,
  type ServiceTaskDetail,
} from "@/lib/service-task-model";

export async function loadServiceTask(
  tenantId: string,
  occurrenceId: string,
): Promise<{ task: ServiceTaskDetail; access: ServiceTaskAccess }> {
  const [detail, access] = await Promise.all([
    invokeNextDesk<unknown>("service-tasks", {
      type: "getOccurrence",
      tenantId,
      occurrenceId,
    }),
    invokeNextDesk<unknown>("service-tasks", { type: "access", tenantId }),
  ]);
  const task = parseServiceTaskDetail(detail);
  if (!task) throw new Error("Die Serviceaufgabe konnte nicht geladen werden.");
  return { task, access: parseServiceTaskAccess(access) };
}

export async function updateServiceTask(
  tenantId: string,
  occurrenceId: string,
  action: "start" | "complete" | "toggleCheck",
  extra: Record<string, unknown> = {},
): Promise<void> {
  await invokeNextDesk("service-tasks", {
    type: "updateOccurrence",
    tenantId,
    occurrenceId,
    action,
    ...extra,
  });
}
