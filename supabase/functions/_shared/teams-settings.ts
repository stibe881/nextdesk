import { TEAM_LIMITS } from "./teams-model.ts";

// deno-lint-ignore no-explicit-any
type Admin = any;

export type TeamsSettings = { maxLifetimeMonths: number; allowGuests: boolean };

export const TEAMS_FEATURE = "teams.provisioning";

export async function loadTeamsSettings(
  admin: Admin,
  tenantId: string,
): Promise<TeamsSettings> {
  const { data } = await admin
    .from("tenant_teams_settings")
    .select("max_lifetime_months, allow_guests")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  const months = Number(data?.max_lifetime_months);
  return {
    maxLifetimeMonths:
      Number.isInteger(months) && months >= 1 && months <= 60
        ? months
        : TEAM_LIMITS.maxLifetimeMonths,
    allowGuests: data?.allow_guests !== false,
  };
}
