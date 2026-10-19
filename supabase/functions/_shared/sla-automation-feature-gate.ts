export type SlaAutomationCandidate = {
  ticket: { tenant_id: string };
};

type TenantFeatureResolver = (tenantId: string) => Promise<boolean>;

/**
 * Limits a shared scheduler batch to tenants that explicitly enabled SLA
 * automation. A resolver error is intentionally equivalent to disabled, so a
 * background worker cannot mutate tickets when the flag cannot be verified.
 */
export async function filterSlaAutomationCandidates<
  T extends SlaAutomationCandidate,
>(
  candidates: readonly T[],
  featureEnabled: TenantFeatureResolver,
): Promise<{ candidates: T[]; skippedInactiveTenants: number }> {
  const stateByTenant = new Map<string, boolean>();
  const skippedTenantIds = new Set<string>();
  const allowed: T[] = [];

  for (const candidate of candidates) {
    const tenantId = candidate.ticket.tenant_id;
    let enabled = stateByTenant.get(tenantId);
    if (enabled === undefined) {
      try {
        enabled = (await featureEnabled(tenantId)) === true;
      } catch {
        enabled = false;
      }
      stateByTenant.set(tenantId, enabled);
    }

    if (enabled) {
      allowed.push(candidate);
    } else {
      skippedTenantIds.add(tenantId);
    }
  }

  return { candidates: allowed, skippedInactiveTenants: skippedTenantIds.size };
}
