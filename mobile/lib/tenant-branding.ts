import { requireNextDesk } from "@/lib/nextdesk-client";

/**
 * Mandantenbranding wie im Web: Portalname aus tenant_settings sowie Logo und
 * Farben aus tenant_branding. RLS gibt beide Zeilen nur aktiven Mitgliedern des
 * eigenen Mandanten frei; zusätzlich wird ausdrücklich nach tenant_id gefiltert.
 */
export type TenantBranding = {
  accentColor: string | null;
  logoUrl: string | null;
  portalName: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
};

export type TenantBrandColors = Pick<
  TenantBranding,
  "accentColor" | "primaryColor" | "secondaryColor"
>;

const maxPortalNameLength = 120;
const maxLogoUrlLength = 2_048;
const HEX_COLOR = /^#[0-9A-F]{6}$/i;

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

function usableColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  return HEX_COLOR.test(normalized) ? normalized : null;
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
      .select("logo_path, primary_color, secondary_color, accent_color")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
  ]);
  if (settingsResult.error || brandingResult.error) {
    throw new Error("Das Mandantenbranding konnte nicht geladen werden.");
  }
  return {
    accentColor: usableColor(brandingResult.data?.accent_color),
    logoUrl: usableLogoUrl(brandingResult.data?.logo_path),
    portalName: usablePortalName(settingsResult.data?.portal_name),
    primaryColor: usableColor(brandingResult.data?.primary_color),
    secondaryColor: usableColor(brandingResult.data?.secondary_color),
  };
}
