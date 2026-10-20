export type QuickCreateAction = "ticket" | "problem" | "followUp" | "knowledge";

export type QuickCreateContext = {
  assetManagementEnabled: boolean;
  canWorkTickets: boolean;
  experienceWorkspaceEnabled: boolean;
  hasActiveTenant: boolean;
  knowledgeBaseEnabled: boolean;
};

export function quickCreateActionsForContext({
  assetManagementEnabled,
  canWorkTickets,
  experienceWorkspaceEnabled,
  hasActiveTenant,
  knowledgeBaseEnabled,
}: QuickCreateContext): readonly QuickCreateAction[] {
  if (!hasActiveTenant) return [];

  return [
    "ticket",
    ...(canWorkTickets && assetManagementEnabled ? (["problem"] as const) : []),
    ...(canWorkTickets && experienceWorkspaceEnabled
      ? (["followUp"] as const)
      : []),
    ...(canWorkTickets && knowledgeBaseEnabled ? (["knowledge"] as const) : []),
  ];
}

export function quickCreateRequestMatchesTenant(
  requestTenantId: string | undefined,
  activeTenantId: string | null,
): boolean {
  return requestTenantId !== undefined && requestTenantId === activeTenantId;
}
