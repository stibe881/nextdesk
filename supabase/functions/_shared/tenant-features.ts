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

const FEATURE_CACHE_TTL_MS = 30_000;
const FEATURE_CACHE_MAX_ENTRIES = 500;
const featureStateCache = new Map<
  string,
  { at: number; states: TenantFeatureStates }
>();

/**
 * Same result as resolveTenantFeatureStates, reused for 30 seconds inside one
 * warm function instance. Switching a module off therefore takes effect within
 * that window; failed lookups are never cached.
 */
export async function resolveTenantFeatureStatesCached(
  admin: any,
  tenantId: string,
  featureKeys: readonly string[],
): Promise<TenantFeatureStates | null> {
  const key = `${tenantId}|${[...new Set(featureKeys)].sort().join(",")}`;
  const cached = featureStateCache.get(key);
  if (cached && Date.now() - cached.at < FEATURE_CACHE_TTL_MS) {
    return { ...cached.states };
  }
  const states = await resolveTenantFeatureStates(admin, tenantId, featureKeys);
  if (states === null) return null;
  if (featureStateCache.size >= FEATURE_CACHE_MAX_ENTRIES) {
    featureStateCache.clear();
  }
  featureStateCache.set(key, { at: Date.now(), states: { ...states } });
  return states;
}

/**
 * Modules whose visibility and data are scoped per department. Switching one
 * off for a department hides it for that department's members.
 */
export const DEPARTMENT_SCOPED_FEATURES = [
  "service.tasks",
  "self_service.shop",
  "inventory.management",
  "assets.management",
  "knowledge.base",
  "contracts.management",
  "reporting.service",
  "event.spaces",
  "onboarding.entries",
] as const;

/**
 * Effective module switches for one person: the tenant switch plus the
 * switches of the departments the person belongs to (or, without any
 * membership, of all departments). Keys that are not department scoped keep
 * the plain tenant switch. Failed lookups return null (fail closed).
 */
export async function resolveUserFeatureStates(
  admin: any,
  tenantId: string,
  userId: string,
  featureKeys: readonly string[],
): Promise<TenantFeatureStates | null> {
  const tenantStates = await resolveTenantFeatureStates(
    admin,
    tenantId,
    featureKeys,
  );
  if (!tenantStates) return null;
  const scoped = featureKeys.filter((key) =>
    (DEPARTMENT_SCOPED_FEATURES as readonly string[]).includes(key),
  );
  if (!scoped.length) return tenantStates;
  const { data, error } = await admin.rpc("user_feature_states", {
    p_tenant_id: tenantId,
    p_user_id: userId,
    p_feature_keys: scoped,
  });
  if (error || typeof data !== "object" || data === null) return null;
  const states = { ...tenantStates };
  for (const key of scoped) {
    states[key] = tenantStates[key] === true && data[key] === true;
  }
  return states;
}

/** Departments whose data the person may see in a department-scoped module. */
export async function userFeatureDepartments(
  admin: any,
  tenantId: string,
  userId: string,
  featureKey: string,
): Promise<string[] | null> {
  const { data, error } = await admin.rpc("user_feature_departments", {
    p_tenant_id: tenantId,
    p_user_id: userId,
    p_feature_key: featureKey,
  });
  if (error || !Array.isArray(data)) return null;
  return data.filter((id): id is string => typeof id === "string");
}
