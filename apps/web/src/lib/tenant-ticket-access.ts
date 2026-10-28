export type TenantTicketAccess = {
  canManageContracts: boolean;
  canManageServiceStatus: boolean;
  canReadReports: boolean;
  canWorkTickets: boolean;
  isTenantAdmin: boolean;
};

export function tenantTicketAccessFromResponse(
  value: unknown,
): TenantTicketAccess | null {
  if (!value || typeof value !== "object" || !("data" in value)) {
    return null;
  }
  const data = value.data;
  if (!data || typeof data !== "object") return null;
  const parsed = data as Record<string, unknown>;
  return typeof parsed.canWorkTickets === "boolean" &&
    typeof parsed.canManageContracts === "boolean" &&
    typeof parsed.canManageServiceStatus === "boolean" &&
    typeof parsed.canReadReports === "boolean" &&
    typeof parsed.isTenantAdmin === "boolean"
    ? {
        canWorkTickets: parsed.canWorkTickets,
        canManageContracts: parsed.canManageContracts,
        canManageServiceStatus: parsed.canManageServiceStatus,
        canReadReports: parsed.canReadReports,
        isTenantAdmin: parsed.isTenantAdmin,
      }
    : null;
}

export function isServiceStatusAvailable({
  assetManagementEnabled,
  canManageServiceStatus,
}: {
  assetManagementEnabled: boolean;
  canManageServiceStatus: boolean;
}): boolean {
  return assetManagementEnabled && canManageServiceStatus;
}
