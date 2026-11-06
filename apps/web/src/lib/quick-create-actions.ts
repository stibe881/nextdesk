export type QuickCreateAction =
  | "followUp"
  | "ticket"
  | "problem"
  | "serviceTask"
  | "knowledge"
  | "inventoryItem"
  | "contract"
  | "license";

export type QuickCreateContext = {
  assetManagementEnabled: boolean;
  canWorkTickets: boolean;
  experienceWorkspaceEnabled: boolean;
  hasActiveTenant: boolean;
  knowledgeBaseEnabled: boolean;
  /** Menu sections the person can open (Serviceaufgaben, Lager, ...). */
  serviceTasksAvailable?: boolean;
  inventoryAvailable?: boolean;
  contractsAvailable?: boolean;
};

/** Actions in the order of the navigation on the left. */
export function quickCreateActionsForContext({
  assetManagementEnabled,
  canWorkTickets,
  experienceWorkspaceEnabled,
  hasActiveTenant,
  knowledgeBaseEnabled,
  serviceTasksAvailable = false,
  inventoryAvailable = false,
  contractsAvailable = false,
}: QuickCreateContext): readonly QuickCreateAction[] {
  if (!hasActiveTenant) return [];
  if (!canWorkTickets) return ["ticket"];

  return [
    ...(experienceWorkspaceEnabled ? (["followUp"] as const) : []),
    "ticket",
    ...(assetManagementEnabled ? (["problem"] as const) : []),
    ...(serviceTasksAvailable ? (["serviceTask"] as const) : []),
    ...(knowledgeBaseEnabled ? (["knowledge"] as const) : []),
    ...(inventoryAvailable ? (["inventoryItem"] as const) : []),
    ...(contractsAvailable ? (["contract", "license"] as const) : []),
  ];
}

export function quickCreateRequestMatchesTenant(
  requestTenantId: string | undefined,
  activeTenantId: string | null,
): boolean {
  return requestTenantId !== undefined && requestTenantId === activeTenantId;
}
