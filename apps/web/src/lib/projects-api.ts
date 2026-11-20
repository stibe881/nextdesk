import { supabase } from "./supabase";

/** Aufrufe und Datentypen der Edge Function «projects». */

export type ProjectRole =
  "manager" | "member" | "viewer" | "guest_comment" | "guest_read";

export type ProjectAccess = {
  role: ProjectRole;
  canAdmin: boolean;
  canEdit: boolean;
  canComment: boolean;
  isGuest: boolean;
};

export type ProjectPermissions = {
  read: boolean;
  create: boolean;
  manage: boolean;
};

export type ProjectModuleAccess = ProjectPermissions & {
  enabled: boolean;
  hasProjects: boolean;
  visible: boolean;
  guestOnly: boolean;
};

export type ProjectStatus = "planning" | "active" | "paused" | "completed";
export type ProjectHealth = "green" | "yellow" | "red";
export type TaskKind = "phase" | "milestone" | "task";
export type TaskStatus = "todo" | "in_progress" | "blocked" | "done";
export type TaskPriority = "low" | "normal" | "high" | "urgent";
export type DependencyType =
  "finish_to_start" | "start_to_start" | "finish_to_finish" | "start_to_finish";
export type LinkKind =
  | "ticket"
  | "shop_order"
  | "ipam_prefix"
  | "ipam_vlan"
  | "ipam_address"
  | "monitoring_sensor"
  | "asset"
  | "monitoring_incident"
  | "service_task";

export type ProjectStats = {
  taskCount: number;
  doneCount: number;
  progressPercent: number;
  estimatedMinutes: number;
  bookedMinutes: number;
  overdueTasks: number;
  overdueMilestones: number;
  nextMilestone: { title: string; on: string } | null;
  latestDueOn: string | null;
  actualAmountCents: number | null;
};

export type ProjectSummary = {
  id: string;
  number: string;
  title: string;
  description: string | null;
  status: ProjectStatus;
  health: ProjectHealth;
  healthNote: string | null;
  managerId: string | null;
  managerName: string | null;
  departmentId: string | null;
  customerOrganizationId: string | null;
  customerName: string | null;
  locationId: string | null;
  locationName: string | null;
  startsOn: string | null;
  endsOn: string | null;
  budgetMinutes: number | null;
  budgetAmountCents: number | null;
  hourlyRateCents: number | null;
  currency: string;
  scheduleMode: "auto" | "manual";
  sourceTicketId: string | null;
  sourceShopOrderId: string | null;
  completedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  stats: ProjectStats;
  role?: ProjectRole;
};

export type ChecklistItem = { id: string; description: string; done: boolean };

export type ProjectTask = {
  id: string;
  parentId: string | null;
  kind: TaskKind;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeId: string | null;
  assigneeName: string | null;
  teamId: string | null;
  startsOn: string | null;
  dueOn: string | null;
  estimatedMinutes: number | null;
  progressPercent: number;
  position: number;
  completedAt: string | null;
  bookedMinutes: number;
  checklist: ChecklistItem[];
};

export type ProjectDependency = {
  id: string;
  predecessorId: string;
  successorId: string;
  type: DependencyType;
  lagDays: number;
};

export type ProjectComment = {
  id: string;
  taskId: string | null;
  authorId: string | null;
  authorName: string;
  visibility: "internal" | "external";
  body: string;
  createdAt: string;
  mine: boolean;
};

export type ProjectDocument = {
  id: string;
  title: string;
  body: string;
  visibility: "internal" | "external";
  position: number;
  updatedByName: string | null;
  updatedAt: string;
};

export type ProjectMember = {
  userId: string;
  name: string | null;
  role: ProjectRole;
  lead: boolean;
};

export type ProjectInvitation = {
  id: string;
  email: string;
  role: "guest_read" | "guest_comment";
  expiresAt: string;
};

export type ProjectTimeEntry = {
  id: string;
  taskId: string;
  authorId: string;
  authorName: string;
  minutes: number;
  billingKind: "internal" | "billable" | "goodwill";
  note: string | null;
  startedAt: string | null;
  createdAt: string;
  mine: boolean;
};

export type ProjectLink = {
  id: string;
  taskId: string | null;
  targetKind: LinkKind;
  targetId: string;
  label: string;
  detail: string | null;
  state: string | null;
  isClosed: boolean;
  assigneeName: string | null;
  bookedMinutes: number;
  note: string | null;
};

export type ProjectEvent = {
  id: string;
  taskId: string | null;
  actorName: string | null;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type ProjectAttachment = {
  id: string;
  taskId: string | null;
  filename: string;
  contentType: string;
  byteSize: number;
  uploadedByName: string | null;
  createdAt: string;
};

export type ProjectDetailData = {
  project: ProjectSummary;
  access: ProjectAccess;
  tasks: ProjectTask[];
  dependencies: ProjectDependency[];
  comments: ProjectComment[];
  documents: ProjectDocument[];
  members: ProjectMember[];
  invitations: ProjectInvitation[];
  timeEntries: ProjectTimeEntry[];
  links: ProjectLink[];
  events: ProjectEvent[];
  attachments: ProjectAttachment[];
};

export type Named = { id: string; name: string };

export type ProjectTemplate = {
  id: string;
  name: string;
  description: string | null;
  itemCount: number;
  durationDays: number | null;
  updatedAt: string;
};

export type ProjectSettings = {
  ticketWorkloadMinutes: number;
  dailyCapacityMinutes: number;
};

export type ProjectOptions = {
  people: Named[];
  teams: Named[];
  customers: Named[];
  locations: Named[];
  departments: Named[];
  templates: ProjectTemplate[];
  settings: ProjectSettings;
};

export type ProjectOverview = {
  permissions: ProjectPermissions;
  projects: ProjectSummary[];
};

export type PlannedChange = {
  id: string;
  title: string;
  startsOn: string | null;
  dueOn: string | null;
  previousStartsOn: string | null;
  previousDueOn: string | null;
};

export type ScheduleOutcome = { shifted?: number; pending?: number };

export type WorkloadDay = {
  date: string;
  minutes: number;
  projectMinutes: number;
  ticketMinutes: number;
  serviceTaskMinutes: number;
};

export type WorkloadPerson = {
  userId: string;
  name: string;
  totalMinutes: number;
  capacityMinutes: number;
  utilizationPercent: number;
  overloadedDays: number;
  days: WorkloadDay[];
  counts: { project_task: number; ticket: number; service_task: number };
  unestimated: number;
  items: Array<{
    kind: "project_task" | "ticket" | "service_task";
    id: string;
    projectId: string | null;
    projectName: string | null;
    title: string;
    dueOn: string | null;
    minutes: number;
    overdue: boolean;
  }>;
};

export type WorkloadData = {
  from: string;
  to: string;
  today: string;
  settings: ProjectSettings;
  days: string[];
  people: WorkloadPerson[];
};

export type LinkedProject = {
  linkId: string;
  projectId: string;
  number: string;
  title: string;
  status: ProjectStatus;
  health: ProjectHealth;
};

const FALLBACK = "Die Projekte sind gerade nicht erreichbar.";

/** Die Funktion liefert bereits verständliche, unkritische Meldungen. */
async function errorMessage(error: unknown): Promise<string> {
  const context = (error as { context?: unknown } | null)?.context;
  if (context instanceof Response) {
    try {
      const parsed = (await context.clone().json()) as {
        error?: { code?: unknown; message?: unknown };
      };
      if (typeof parsed.error?.message === "string")
        return parsed.error.message;
      if (parsed.error?.code === "feature_disabled") {
        return "Das Modul Projekte ist nicht eingeschaltet.";
      }
      if (parsed.error?.code === "forbidden") {
        return "Dafür fehlt die Berechtigung.";
      }
    } catch {
      // Fällt auf die allgemeine Meldung zurück.
    }
  }
  return FALLBACK;
}

export async function projectsCall<T>(
  body: Record<string, unknown>,
): Promise<T> {
  if (!supabase) throw new Error("Die Verbindung ist nicht konfiguriert.");
  const { data, error } = await supabase.functions.invoke<{ data: T }>(
    "projects",
    { body },
  );
  if (error) throw new Error(await errorMessage(error));
  if (!data || typeof data !== "object" || !("data" in data)) {
    throw new Error("Die Antwort ist unvollständig.");
  }
  return data.data;
}

export async function loadProjectModuleAccess(
  tenantId: string,
): Promise<ProjectModuleAccess | null> {
  try {
    return await projectsCall<ProjectModuleAccess>({
      type: "access",
      tenantId,
    });
  } catch {
    return null;
  }
}

/** Löst offene Gast-Einladungen der angemeldeten Person ein. */
export async function acceptProjectInvitations(): Promise<number> {
  try {
    const result = await projectsCall<{ accepted: number }>({
      type: "acceptMyInvitations",
    });
    return typeof result.accepted === "number" ? result.accepted : 0;
  } catch {
    return 0;
  }
}

export const ATTACHMENT_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/** Lädt eine Datei in den privaten Speicher und hängt sie an. */
export async function uploadProjectAttachment(
  tenantId: string,
  target: { projectId: string; taskId?: string | null },
  file: File,
): Promise<void> {
  if (!(ATTACHMENT_TYPES as readonly string[]).includes(file.type)) {
    throw new Error("Möglich sind PDF sowie Bilder als PNG, JPEG oder WebP.");
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error("Die Datei ist grösser als 25 MB.");
  }
  const meta = {
    tenantId,
    projectId: target.projectId,
    taskId: target.taskId ?? null,
    filename: file.name,
    contentType: file.type,
    byteSize: file.size,
  };
  const upload = await projectsCall<{
    storageObjectPath: string;
    signedUrl: string;
  }>({ type: "createUpload", ...meta });
  const response = await fetch(upload.signedUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type },
    body: file,
  });
  if (!response.ok)
    throw new Error("Die Datei konnte nicht hochgeladen werden.");
  await projectsCall({
    type: "completeUpload",
    ...meta,
    storageObjectPath: upload.storageObjectPath,
  });
}
