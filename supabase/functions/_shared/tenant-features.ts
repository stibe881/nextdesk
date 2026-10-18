export type TenantFeatureStates = Record<string, boolean>;

type TenantFeatureRow = {
  feature_key?: unknown;
  enabled?: unknown;
  pilot_ends_at?: unknown;
};

/**
 * Resolves tenant feature switches directly from the server-side source of
 * truth. Missing, expired, malformed, or disabled rows intentionally remain
 * false so an API call can never bypass a hidden tenant module.
 */
export async function resolveTenantFeatureStates(
  admin: any,
  tenantId: string,
  featureKeys: readonly string[],
): Promise<TenantFeatureStates | null> {
  const uniqueKeys = [...new Set(featureKeys.filter(Boolean))];
  const states: TenantFeatureStates = Object.fromEntries(
    uniqueKeys.map((featureKey) => [featureKey, false]),
  );
  if (uniqueKeys.length === 0) return states;

  const { data, error } = await admin
    .from("tenant_feature_flags")
    .select("feature_key, enabled, pilot_ends_at")
    .eq("tenant_id", tenantId)
    .in("feature_key", uniqueKeys);
  if (error) return null;

  const now = Date.now();
  for (const row of (data ?? []) as TenantFeatureRow[]) {
    if (
      typeof row.feature_key !== "string" ||
      !Object.hasOwn(states, row.feature_key) ||
      row.enabled !== true
    ) {
      continue;
    }
    if (row.pilot_ends_at === null || row.pilot_ends_at === undefined) {
      states[row.feature_key] = true;
      continue;
    }
    if (
      typeof row.pilot_ends_at === "string" &&
      Number.isFinite(Date.parse(row.pilot_ends_at)) &&
      Date.parse(row.pilot_ends_at) > now
    ) {
      states[row.feature_key] = true;
    }
  }

  return states;
}
