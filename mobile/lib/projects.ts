import { invokeNextDesk } from "@/lib/nextdesk-client";
import {
  type MobileProject,
  type MobileProjectDetail,
  type ProjectTaskStatus,
  parseProjectDetail,
  parseProjectOverview,
} from "@/lib/projects-model";

export * from "@/lib/projects-model";

/**
 * Zugriffe der App auf die Funktion projects. Der Server prüft Modul
 * (projects.management), Recht und Projektrolle; eine Ablehnung kommt als
 * NextDeskRequestError mit Code feature_disabled oder forbidden (siehe
 * isProjectAccessDenied). Unerwartete Antworten werfen einen Fehler.
 */
function incomplete(): Error {
  return new Error("Die Antwort der Projekte ist unvollständig.");
}

/** Alle Projekte, die die Person sehen darf (ohne archivierte). */
export async function loadProjects(tenantId: string): Promise<MobileProject[]> {
  const response = await invokeNextDesk<unknown>("projects", {
    type: "overview",
    tenantId,
  });
  const parsed = parseProjectOverview(response);
  if (!parsed) throw incomplete();
  return parsed;
}

export async function loadProject(
  tenantId: string,
  projectId: string,
): Promise<MobileProjectDetail> {
  const response = await invokeNextDesk<unknown>("projects", {
    type: "getProject",
    tenantId,
    projectId,
  });
  const parsed = parseProjectDetail(response);
  if (!parsed) throw incomplete();
  return parsed;
}

export async function setProjectTaskStatus(
  tenantId: string,
  taskId: string,
  status: ProjectTaskStatus,
): Promise<void> {
  await invokeNextDesk<unknown>("projects", {
    type: "updateTask",
    tenantId,
    taskId,
    status,
  });
}

export async function setProjectChecklistItem(
  tenantId: string,
  itemId: string,
  done: boolean,
): Promise<void> {
  await invokeNextDesk<unknown>("projects", {
    type: "setChecklistItem",
    tenantId,
    itemId,
    done,
  });
}

export async function addProjectComment(
  tenantId: string,
  projectId: string,
  taskId: string | null,
  body: string,
): Promise<void> {
  await invokeNextDesk<unknown>("projects", {
    type: "addComment",
    tenantId,
    projectId,
    taskId,
    body: body.trim().slice(0, 20000),
  });
}
