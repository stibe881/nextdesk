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
  | { callbackKey: string; promise: Promise<void> }
  | undefined;
let lastCompletedCallbackKey: string | undefined;

export type NextDeskAuthFailureCode =
  | "provider_email_missing"
  | "provider_rejected"
  | "pkce_verifier_missing"
  | "callback_invalid"
  | "session_not_saved"
  | "exchange_failed";

class NextDeskAuthFailure extends Error {
  constructor(readonly code: NextDeskAuthFailureCode) {
    super(code);
    this.name = "NextDeskAuthFailure";
  }
}

function getNextDeskAuthFailureCode(error: unknown): NextDeskAuthFailureCode {
  if (error instanceof NextDeskAuthFailure) return error.code;

  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (
    message.includes("email") &&
    (message.includes("external provider") || message.includes("provider"))
  ) {
    return "provider_email_missing";
  }
  if (message.includes("code verifier") || message.includes("pkce")) {
    return "pkce_verifier_missing";
  }
  return "exchange_failed";
}

export function nextDeskAuthFailureCode(
  error: unknown,
): NextDeskAuthFailureCode {
  return getNextDeskAuthFailureCode(error);
}

export function nextDeskAuthFailureMessage(
  code: NextDeskAuthFailureCode | string | undefined,
): string {
  switch (code) {
    case "provider_email_missing":
      return "Microsoft Entra hat für dieses Konto keine E-Mail-Adresse an nextDesk übermittelt. Die Entra-Anmeldung benötigt den E-Mail-Anspruch.";
    case "pkce_verifier_missing":
      return "Die sichere Anmelderückkehr ist abgelaufen. Bitte starten Sie die SSO-Anmeldung erneut in dieser App.";
    case "provider_rejected":
      return "Die Microsoft-Anmeldung wurde nicht bestätigt. Bitte versuchen Sie es erneut.";
    case "callback_invalid":
      return "Die Anmelderückkehr ist ungültig oder abgelaufen. Bitte starten Sie die SSO-Anmeldung erneut.";
    case "session_not_saved":
      return "Die Anmeldung konnte nicht sicher auf diesem Gerät gespeichert werden. Bitte versuchen Sie es erneut.";
    default:
      return "Die SSO-Anmeldung konnte nicht abgeschlossen werden. Bitte versuchen Sie es erneut.";
  }
}

/**
 * This exact address is registered in Supabase Authentication and is handled
 * by the production iOS bundle.  Keep it aligned with `app.config.ts`.
 */
export const nextDeskAuthRedirectUrl = "ch.grossict.nextdesk://auth/callback";

const acceptedAuthCallbackSchemes = new Set([
  "ch.grossict.nextdesk:",
  // Existing TestFlight installations used this shorter scheme. Accepting it
  // here lets a callback that was already opened finish safely during an
  // in-place update, while all new sign-ins use the canonical address above.
  "nextdesk:",
]);

export function isNextDeskAuthCallback(url: string): boolean {
  try {
    const parsed = new URL(url);
    const callbackPath = parsed.pathname.replace(/\/+$/, "");
    return (
      acceptedAuthCallbackSchemes.has(parsed.protocol) &&
      // `scheme://auth/callback` is represented by the native URL parser as
      // host `auth` and path `/callback`. Web/Expo tooling can also emit the
      // equivalent path-only form `scheme:///auth/callback`; accept both.
      ((parsed.hostname === "auth" && callbackPath === "/callback") ||
        callbackPath === "/auth/callback")
    );
  } catch {
    return false;
  }
}

/** Completes either the PKCE callback used by SSO or the token fragment used by magic links. */
export async function completeNextDeskAuth(callbackUrl: string): Promise<void> {
  const callback = new URL(callbackUrl);
  const fragment = new URLSearchParams(callback.hash.replace(/^#/, ""));
  const code = callback.searchParams.get("code");
  const accessToken =
    callback.searchParams.get("access_token") ?? fragment.get("access_token");
  const refreshToken =
    callback.searchParams.get("refresh_token") ?? fragment.get("refresh_token");
  // A provider code is single-use. Dedupe by the callback credential rather
  // than the raw URL because Expo and WebBrowser can normalize one deep link
  // differently while returning it to the already running app.
  const callbackKey = code
    ? `pkce:${code}`
    : accessToken && refreshToken
      ? `tokens:${accessToken}:${refreshToken}`
      : "invalid";

  if (lastCompletedCallbackKey === callbackKey) return;
  if (pendingAuthCompletion?.callbackKey === callbackKey) {
    return pendingAuthCompletion.promise;
  }

  const promise = (async () => {
    const providerError =
      callback.searchParams.get("error_description") ??
      callback.searchParams.get("error") ??
      fragment.get("error_description") ??
      fragment.get("error");
    if (providerError) {
      throw new NextDeskAuthFailure(
        getNextDeskAuthFailureCode(new Error(providerError)),
      );
    }

    if (code) {
      const { error } =
        await requireNextDesk().auth.exchangeCodeForSession(code);
      if (error) {
        throw new NextDeskAuthFailure(getNextDeskAuthFailureCode(error));
      }
    } else {
      if (!accessToken || !refreshToken) {
        throw new NextDeskAuthFailure("callback_invalid");
      }
      const { error } = await requireNextDesk().auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      if (error) {
        throw new NextDeskAuthFailure(getNextDeskAuthFailureCode(error));
      }
    }

    const {
      data: { session },
    } = await requireNextDesk().auth.getSession();
    if (!session) throw new NextDeskAuthFailure("session_not_saved");
    lastCompletedCallbackKey = callbackKey;
  })();

  pendingAuthCompletion = { callbackKey, promise };
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
  if (error) {
    const context =
      typeof error === "object" && error !== null && "context" in error
        ? (error as { context?: unknown }).context
        : undefined;
    if (context instanceof Response) {
      const payload = await context
        .clone()
        .json()
        .catch(() => null);
      const message =
        typeof payload === "object" &&
        payload !== null &&
        "error" in payload &&
        typeof (payload as { error?: unknown }).error === "object" &&
        (payload as { error?: unknown }).error !== null &&
        typeof (payload as { error: { message?: unknown } }).error.message ===
          "string"
          ? (payload as { error: { message: string } }).error.message
          : null;
      if (message) throw new Error(message);
    }
    throw error;
  }
  return data as T;
}
