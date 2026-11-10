// «Störungen» in the app: calls to the incidents edge function. The parsing
// and formatting helpers are shared with the web app (incidents-model.ts).
import {
  parseIncidentDetail,
  parseIncidentList,
  type IncidentCause,
  type IncidentDetail,
  type IncidentFilter,
  type IncidentStats,
  type IncidentSummary,
} from "@/lib/incidents-model";
import { invokeNextDesk, requireNextDesk } from "@/lib/nextdesk-client";

export * from "@/lib/incidents-model";

export async function listIncidents(
  tenantId: string,
  filter: IncidentFilter,
): Promise<{ incidents: IncidentSummary[]; stats: IncidentStats }> {
  const parsed = parseIncidentList(
    await invokeNextDesk<unknown>("incidents", {
      type: "list",
      tenantId,
      filter,
    }),
  );
  if (!parsed) throw new Error("Die Störungen konnten nicht gelesen werden.");
  return parsed;
}

async function detailCall(
  body: Record<string, unknown>,
): Promise<IncidentDetail> {
  const parsed = parseIncidentDetail(
    await invokeNextDesk<unknown>("incidents", body),
  );
  if (!parsed) throw new Error("Die Störung konnte nicht gelesen werden.");
  return parsed;
}

export const loadIncident = (tenantId: string, incidentId: string) =>
  detailCall({ type: "get", tenantId, incidentId });

export const acknowledgeIncident = (tenantId: string, incidentId: string) =>
  detailCall({ type: "acknowledge", tenantId, incidentId });

export const assignIncident = (
  tenantId: string,
  incidentId: string,
  agentId: string | null,
) => detailCall({ type: "assign", tenantId, incidentId, agentId });

export const addIncidentNote = (
  tenantId: string,
  incidentId: string,
  text: string,
) => detailCall({ type: "note", tenantId, incidentId, text });

export const closeIncident = (
  tenantId: string,
  incidentId: string,
  cause: IncidentCause,
  note: string | null,
) => detailCall({ type: "close", tenantId, incidentId, cause, note });

/** Whether the signed-in person is in the alarm team of the PRTG settings. */
export async function canWorkIncidents(tenantId: string): Promise<boolean> {
  const { data, error } = await requireNextDesk().rpc("can_work_incidents", {
    p_tenant_id: tenantId,
  });
  return !error && data === true;
}

/** Whether the signed-in person is in the security team (phishing). */
export async function canWorkSecurityCases(tenantId: string): Promise<boolean> {
  const { data, error } = await requireNextDesk().rpc(
    "can_work_security_cases",
    { p_tenant_id: tenantId },
  );
  return !error && data === true;
}

export async function currentUserId(): Promise<string | null> {
  const {
    data: { session },
  } = await requireNextDesk().auth.getSession();
  return session?.user?.id ?? null;
}
