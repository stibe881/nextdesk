import { requireNextDesk } from "@/lib/nextdesk-client";

/**
 * Mandantenbranding wie im Web: Portalname aus tenant_settings und Logo aus
 * tenant_branding. RLS gibt beide Zeilen nur aktiven Mitgliedern des eigenen
 * Mandanten frei; zusätzlich wird ausdrücklich nach tenant_id gefiltert.
 */
export type TenantBranding = {
  logoUrl: string | null;
  portalName: string | null;
};

const maxPortalNameLength = 120;
const maxLogoUrlLength = 2_048;

function usablePortalName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized || Array.from(normalized).length > maxPortalNameLength)
    return null;
  return normalized;
}

function usableLogoUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLogoUrlLength) return null;
  try {
    const url = new URL(normalized);
    const normalizedUrl = url.toString();
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      normalizedUrl.length <= maxLogoUrlLength
      ? normalizedUrl
      : null;
  } catch {
    return null;
  }
}

export async function loadTenantBranding(
  tenantId: string,
): Promise<TenantBranding> {
  const client = requireNextDesk();
  const [settingsResult, brandingResult] = await Promise.all([
    client
      .from("tenant_settings")
      .select("portal_name")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    client
      .from("tenant_branding")
      .select("logo_path")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
  ]);
  if (settingsResult.error || brandingResult.error) {
    throw new Error("Das Mandantenbranding konnte nicht geladen werden.");
  }
  const branding: TenantBranding = {
    logoUrl: usableLogoUrl(brandingResult.data?.logo_path),
    portalName: usablePortalName(settingsResult.data?.portal_name),
  };
  return branding;
}
