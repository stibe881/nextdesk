import { requireNextDesk } from "@/lib/nextdesk-client";

export const MOBILE_FEATURE_KEYS = [
  "ticketing.detail",
  "knowledge.base",
  "assets.management",
  "experience.workspace",
  "portal.self-service",
  "agent.workbench",
  "requester.portal",
  "requester.department-view",
] as const;

export type MobileFeatureKey = (typeof MOBILE_FEATURE_KEYS)[number];
export type MobileFeatureFlags = Record<MobileFeatureKey, boolean>;

const DISABLED_FEATURES: MobileFeatureFlags = {
  "ticketing.detail": false,
  "knowledge.base": false,
  "assets.management": false,
  "experience.workspace": false,
  "portal.self-service": false,
  "agent.workbench": false,
  "requester.portal": false,
  "requester.department-view": false,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Loads the effective feature set through the tenant-authorized Edge Function.
 * Missing, malformed or unavailable responses deliberately fail closed.
 */
export async function loadMobileFeatureFlags(
  tenantId: string,
): Promise<MobileFeatureFlags> {
  const { data, error } = await requireNextDesk().functions.invoke(
    "tenant-feature-flags",
    { body: { type: "list", tenantId } },
  );
  if (error) throw error;
  if (
    !isRecord(data) ||
    !isRecord(data.data) ||
    !Array.isArray(data.data.features)
  ) {
    throw new Error("Die Funktionsfreigaben konnten nicht geprüft werden.");
  }

  const flags = { ...DISABLED_FEATURES };
  for (const entry of data.data.features) {
    if (!isRecord(entry)) continue;
    if (
      typeof entry.key === "string" &&
      typeof entry.enabled === "boolean" &&
      (MOBILE_FEATURE_KEYS as readonly string[]).includes(entry.key)
    ) {
      flags[entry.key as MobileFeatureKey] = entry.enabled;
    }
  }
  return flags;
}
