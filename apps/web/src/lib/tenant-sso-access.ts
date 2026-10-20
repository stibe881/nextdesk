import { supabase } from "./supabase";

export type TenantSsoAccess =
  | { scope: "unmanaged" }
  | {
      scope: "tenant";
      tenantId: string;
      ssoEnforced: boolean;
      tenant: { id: string; name: string; slug: string };
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function tenantSsoAccessFromResponse(value: unknown): TenantSsoAccess | null {
  if (!isRecord(value) || !isRecord(value.data)) return null;
  const data = value.data;
  if (data.scope === "unmanaged") return { scope: "unmanaged" };
  if (
    data.scope === "tenant" &&
    typeof data.tenantId === "string" &&
    typeof data.ssoEnforced === "boolean" &&
    isRecord(data.tenant) &&
    typeof data.tenant.id === "string" &&
    typeof data.tenant.name === "string" &&
    typeof data.tenant.slug === "string"
  ) {
    return {
      scope: "tenant",
      tenantId: data.tenantId,
      ssoEnforced: data.ssoEnforced,
      tenant: {
        id: data.tenant.id,
        name: data.tenant.name,
        slug: data.tenant.slug,
      },
    };
  }
  return null;
}

/**
 * Resolves a signed-in identity to one customer tenant after invitations have
 * been accepted. The Function keeps the tenant/domain decision server-side.
 */
export async function resolveTenantSsoAccess(): Promise<TenantSsoAccess> {
  if (!supabase) throw new Error("Supabase ist nicht konfiguriert.");
  const { data, error } = await supabase.functions.invoke("tenant-sso-access", {
    body: {},
  });
  if (error) throw error;
  const access = tenantSsoAccessFromResponse(data);
  if (!access) throw new Error("Ungültige Antwort der Mandanten-SSO-Prüfung.");
  return access;
}
