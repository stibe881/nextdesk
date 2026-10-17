import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type NextDeskExtra = {
  nextDeskSupabaseUrl?: string;
  nextDeskSupabasePublishableKey?: string;
};

const extra = (Constants.expoConfig?.extra ?? {}) as NextDeskExtra;
// Expo Web can omit `Constants.expoConfig.extra` in a development iframe,
// although the same public values are available to Metro at bundle time.
// Native release builds retain the `extra` values from app.config.ts.
const url =
  extra.nextDeskSupabaseUrl?.trim() ??
  process.env.EXPO_PUBLIC_NEXTDESK_SUPABASE_URL?.trim() ??
  "";
const publishableKey =
  extra.nextDeskSupabasePublishableKey?.trim() ??
  process.env.EXPO_PUBLIC_NEXTDESK_SUPABASE_PUBLISHABLE_KEY?.trim() ??
  "";

export const isNextDeskConfigured = Boolean(url && publishableKey);

const serverStorage = {
  getItem: async (_key: string) => null,
  setItem: async (_key: string, _value: string) => undefined,
  removeItem: async (_key: string) => undefined,
};

const webStorage =
  typeof window === "undefined"
    ? serverStorage
    : {
        getItem: async (key: string) => window.localStorage.getItem(key),
        setItem: async (key: string, value: string) =>
          window.localStorage.setItem(key, value),
        removeItem: async (key: string) => window.localStorage.removeItem(key),
      };

const authStorage = Platform.OS === "web" ? webStorage : AsyncStorage;

export const nextDesk: SupabaseClient | null = isNextDeskConfigured
  ? createClient(url, publishableKey, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: false,
        flowType: "pkce",
        persistSession: true,
        storage: authStorage,
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

let pendingAuthCompletion:
  | { callbackUrl: string; promise: Promise<void> }
  | undefined;
let lastCompletedCallbackUrl: string | undefined;

export const nextDeskAuthRedirectUrl = "nextdesk://auth/callback";

export function isNextDeskAuthCallback(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "nextdesk:" &&
      parsed.pathname.replace(/\/+$/, "") === "/auth/callback"
    );
  } catch {
    return false;
  }
}

/** Completes either the PKCE callback used by SSO or the token fragment used by magic links. */
export async function completeNextDeskAuth(callbackUrl: string): Promise<void> {
  if (lastCompletedCallbackUrl === callbackUrl) return;
  if (pendingAuthCompletion?.callbackUrl === callbackUrl) {
    return pendingAuthCompletion.promise;
  }

  const promise = (async () => {
    const callback = new URL(callbackUrl);
    const fragment = new URLSearchParams(callback.hash.replace(/^#/, ""));
    const code = callback.searchParams.get("code");
    const providerError =
      callback.searchParams.get("error_description") ??
      callback.searchParams.get("error") ??
      fragment.get("error_description") ??
      fragment.get("error");
    if (providerError) throw new Error("Die Anmeldung wurde nicht bestätigt.");

    if (code) {
      const { error } =
        await requireNextDesk().auth.exchangeCodeForSession(code);
      if (error) throw error;
    } else {
      const accessToken =
        callback.searchParams.get("access_token") ??
        fragment.get("access_token");
      const refreshToken =
        callback.searchParams.get("refresh_token") ??
        fragment.get("refresh_token");
      if (!accessToken || !refreshToken) {
        throw new Error("Der Anmeldelink ist ungültig oder abgelaufen.");
      }
      const { error } = await requireNextDesk().auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      if (error) throw error;
    }

    const {
      data: { session },
    } = await requireNextDesk().auth.getSession();
    if (!session) throw new Error("Die Anmeldung wurde nicht gespeichert.");
    lastCompletedCallbackUrl = callbackUrl;
  })();

  pendingAuthCompletion = { callbackUrl, promise };
  try {
    await promise;
  } finally {
    if (pendingAuthCompletion?.promise === promise) {
      pendingAuthCompletion = undefined;
    }
  }
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
