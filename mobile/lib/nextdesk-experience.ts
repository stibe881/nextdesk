import { loadCurrentTenant, requireNextDesk } from "@/lib/nextdesk-client";

export type FollowUpPriority = "low" | "normal" | "high";

export type ExperienceFollowUp = {
  id: string;
  ticketId: string | null;
  title: string;
  description: string | null;
  dueAt: string | null;
  priority: FollowUpPriority;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WorkspacePreferences = {
  theme?: "system" | "light" | "dark";
  density?: "comfortable" | "compact";
  landingPage?: string;
  showKeyboardShortcuts?: boolean;
};

export type ResolutionConfirmation = {
  id: string;
  ticketId: string;
  confirmed: boolean;
  comment: string | null;
  confirmedAt: string;
  confirmedByDisplayName: string | null;
};

export type ServiceCatalogItem = {
  id: string;
  name: string;
  description: string | null;
  criticality: "low" | "medium" | "high" | "critical";
};

export type ExperienceHubErrorCode =
  | "experience_feature_disabled"
  | "tenant_feature_lookup_failed"
  | "experience_hub_not_configured"
  | "authentication_required"
  | "tenant_membership_required"
  | "permission_denied"
  | "resolution_confirmation_not_allowed"
  | "ticket_not_available"
  | "ticket_not_resolved"
  | "operation_failed"
  | "invalid_response";

export class ExperienceHubError extends Error {
  readonly code: string;

  constructor(code: ExperienceHubErrorCode | string, message: string) {
    super(message);
    this.name = "ExperienceHubError";
    this.code = code;
  }
}

/**
 * These errors deliberately result in no Experience UI. The server remains the
 * source of truth: a stale client-side feature flag can never reveal data.
 */
export function isExperienceUnavailableError(error: unknown): boolean {
  return (
    error instanceof ExperienceHubError &&
    [
      "experience_feature_disabled",
      "experience_hub_not_configured",
      "tenant_feature_lookup_failed",
    ].includes(error.code)
  );
}

type ExperienceEnvelope<T> = { data: T };
type ExperienceErrorEnvelope = {
  error: { code?: unknown; message?: unknown };
};

type ExperienceAction =
  | { type: "getWorkspacePreferences"; tenantId: string }
  | {
      type: "saveWorkspacePreferences";
      tenantId: string;
      preferences: WorkspacePreferences;
    }
  | {
      type: "listFollowUps";
      tenantId: string;
      includeResolved?: boolean;
      limit?: number;
      ticketId?: string;
    }
  | {
      type: "saveFollowUp";
      tenantId: string;
      followUpId?: string;
      title: string;
      description: string | null;
      dueAt: string | null;
      priority: FollowUpPriority;
      ticketId: string | null;
    }
  | { type: "resolveFollowUp"; tenantId: string; followUpId: string }
  | { type: "listServiceCatalog"; tenantId: string }
  | {
      type: "confirmResolution";
      tenantId: string;
      ticketId: string;
      confirmed: boolean;
      comment: string | null;
    }
  | { type: "listResolutionConfirmations"; tenantId: string; ticketId: string };

type ActionWithoutTenant = ExperienceAction extends infer Action
  ? Action extends { tenantId: string }
    ? Omit<Action, "tenantId">
    : never
  : never;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidResponse(): never {
  throw new ExperienceHubError(
    "invalid_response",
    "Die Antwort des Experience Hub ist unvollständig.",
  );
}

function parseErrorEnvelope(value: unknown): ExperienceHubError | null {
  if (!isRecord(value) || !isRecord(value.error)) return null;
  const code = value.error.code;
  const message = value.error.message;
  if (typeof code !== "string") return null;
  return new ExperienceHubError(
    code,
    typeof message === "string" && message.trim()
      ? message
      : "Die Experience-Funktion ist derzeit nicht verfügbar.",
  );
}

async function errorFromInvoke(
  error: unknown,
): Promise<ExperienceHubError | null> {
  const context =
    typeof error === "object" && error !== null && "context" in error
      ? (error as { context?: unknown }).context
      : undefined;
  if (!(context instanceof Response)) return null;
  const payload = await context
    .clone()
    .json()
    .catch(() => null);
  return parseErrorEnvelope(payload);
}

async function invokeExperience<T>(action: ActionWithoutTenant): Promise<T> {
  const tenant = await loadCurrentTenant();
  const body: ExperienceAction = {
    ...action,
    tenantId: tenant.id,
  } as ExperienceAction;
  const { data, error } = await requireNextDesk().functions.invoke(
    "experience-hub",
    { body },
  );

  if (error) {
    const parsedError = await errorFromInvoke(error);
    if (parsedError) throw parsedError;
    throw new ExperienceHubError(
      "operation_failed",
      "Die Experience-Funktion konnte nicht erreicht werden.",
    );
  }

  const serverError = parseErrorEnvelope(data);
  if (serverError) throw serverError;
  if (!isRecord(data) || !("data" in data)) invalidResponse();
  return (data as ExperienceEnvelope<T>).data;
}

export async function getWorkspacePreferences(): Promise<{
  workspacePreferences: {
    preferences: WorkspacePreferences;
    updatedAt: string | null;
  } | null;
}> {
  return invokeExperience({ type: "getWorkspacePreferences" });
}

export async function saveWorkspacePreferences(
  preferences: WorkspacePreferences,
): Promise<{
  workspacePreferences: {
    preferences: WorkspacePreferences;
    updatedAt: string | null;
  };
}> {
  return invokeExperience({ type: "saveWorkspacePreferences", preferences });
}

export async function listFollowUps(input?: {
  includeResolved?: boolean;
  limit?: number;
  ticketId?: string;
}): Promise<{ followUps: ExperienceFollowUp[]; truncated: boolean }> {
  return invokeExperience({ type: "listFollowUps", ...input });
}

export async function saveFollowUp(input: {
  followUpId?: string;
  title: string;
  description: string | null;
  dueAt: string | null;
  priority: FollowUpPriority;
  ticketId: string | null;
}): Promise<{ followUp: ExperienceFollowUp }> {
  return invokeExperience({ type: "saveFollowUp", ...input });
}

export async function resolveFollowUp(
  followUpId: string,
): Promise<{ followUp: ExperienceFollowUp; changed: boolean }> {
  return invokeExperience({ type: "resolveFollowUp", followUpId });
}

export async function listServiceCatalog(): Promise<{
  services: ServiceCatalogItem[];
}> {
  return invokeExperience({ type: "listServiceCatalog" });
}

export async function confirmResolution(input: {
  ticketId: string;
  confirmed: boolean;
  comment: string | null;
}): Promise<{
  confirmation: Pick<
    ResolutionConfirmation,
    "id" | "ticketId" | "confirmed" | "confirmedAt"
  >;
}> {
  return invokeExperience({ type: "confirmResolution", ...input });
}

export async function listResolutionConfirmations(
  ticketId: string,
): Promise<{ confirmations: ResolutionConfirmation[] }> {
  return invokeExperience({ type: "listResolutionConfirmations", ticketId });
}
