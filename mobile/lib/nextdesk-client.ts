import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type NextDeskExtra = {
  nextDeskSupabaseUrl?: string;
  nextDeskSupabasePublishableKey?: string;
};

const extra = (Constants.expoConfig?.extra ?? {}) as NextDeskExtra;
const url = extra.nextDeskSupabaseUrl?.trim() ?? "";
const publishableKey = extra.nextDeskSupabasePublishableKey?.trim() ?? "";

export const isNextDeskConfigured = Boolean(url && publishableKey);

export const nextDesk: SupabaseClient | null = isNextDeskConfigured
  ? createClient(url, publishableKey, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: false,
        persistSession: true,
        storage: AsyncStorage,
      },
    })
  : null;

export function requireNextDesk(): SupabaseClient {
  if (!nextDesk) {
    throw new Error(
      "Die mobile nextDesk-Verbindung ist noch nicht konfiguriert. Bitte aktualisieren Sie die App.",
    );
  }
  return nextDesk;
}

export type MobileTenant = {
  id: string;
  name: string;
  slug: string;
};

export async function loadCurrentTenant(): Promise<MobileTenant> {
  const client = requireNextDesk();
  const { data, error } = await client
    .from("tenant_memberships")
    .select("tenant_id, tenants(id, name, slug)")
    .eq("status", "active");
  if (error) throw error;

  const tenants = (data ?? [])
    .map((membership) => membership.tenants as unknown as MobileTenant | null)
    .filter((tenant): tenant is MobileTenant => Boolean(tenant))
    .sort((left, right) => left.name.localeCompare(right.name, "de-CH"));
  const tenant = tenants[0];
  if (!tenant) {
    throw new Error(
      "Für dieses Konto ist kein aktiver nextDesk-Mandant verfügbar.",
    );
  }
  return tenant;
}

export async function invokeNextDesk<T>(
  functionName: string,
  body: Record<string, unknown>,
): Promise<T> {
  const client = requireNextDesk();
  const { data, error } = await client.functions.invoke(functionName, { body });
  if (error) throw error;
  return data as T;
}
