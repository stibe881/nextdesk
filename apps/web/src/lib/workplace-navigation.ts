export type WorkplaceRequestedView = "followUps";

export type MigratedWorkplaceStartSection = {
  requestedView: WorkplaceRequestedView | null;
  section: unknown;
};

type WorkspaceNavigationReadiness = {
  activeTenantAvailable: boolean;
  isSupabaseConfigured: boolean;
  sessionResolved: boolean;
  signedIn: boolean;
  tenantFeaturesLoading: boolean;
  ticketAccessLoading: boolean;
};

export function isWorkplaceAvailable(
  agentWorkbenchEnabled: boolean,
  experienceWorkspaceEnabled: boolean,
): boolean {
  return agentWorkbenchEnabled || experienceWorkspaceEnabled;
}

export function isWorkspaceNavigationReady({
  activeTenantAvailable,
  isSupabaseConfigured,
  sessionResolved,
  signedIn,
  tenantFeaturesLoading,
  ticketAccessLoading,
}: WorkspaceNavigationReadiness): boolean {
  if (!isSupabaseConfigured) return true;
  if (!sessionResolved) return false;
  if (!signedIn) return true;
  return (
    activeTenantAvailable && !ticketAccessLoading && !tenantFeaturesLoading
  );
}

export function requestedWorkplaceViewForFollowUps(
  followUpsEnabled: boolean,
  followUpsRequested: boolean,
): WorkplaceRequestedView | undefined {
  return followUpsEnabled && followUpsRequested ? "followUps" : undefined;
}

export function migrateWorkplaceStartSection(
  value: unknown,
): MigratedWorkplaceStartSection {
  if (value === "Wiedervorlagen") {
    return { requestedView: "followUps", section: "Arbeitsplatz" };
  }
  if (value === "Erwähnungen") {
    return { requestedView: null, section: "Arbeitsplatz" };
  }
  return { requestedView: null, section: value };
}
