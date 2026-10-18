import Constants from "expo-constants";
import { Platform } from "react-native";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  clearMobilePrivateState,
  getSelectedTenantId,
  prepareMobileUserContext,
  setSelectedTenantId,
} from "@/lib/mobile-private-state";
import { mobileSecureStorage } from "@/lib/mobile-secure-storage";

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

export const nextDesk: SupabaseClient | null = isNextDeskConfigured
  ? createClient(url, publishableKey, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: false,
        flowType: "pkce",
        persistSession: true,
        // Expo SecureStore maps to the encrypted iOS Keychain. Browser Preview
        // deliberately retains its localStorage fallback inside the adapter.
        storage: mobileSecureStorage,
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

/**
 * Native Sign-in must return to the registered app scheme. In the browser
 * preview, however, the callback must stay on the same HTTPS origin so its
 * PKCE verifier and localStorage session remain available to Supabase.
 */
export function getNextDeskAuthRedirectUrl(): string {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    return new URL("/auth/callback", window.location.origin).toString();
  }
  return nextDeskAuthRedirectUrl;
}

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

type TenantMembershipRow = {
  tenant_id: string;
  tenants: MobileTenant | MobileTenant[] | null;
};

function tenantFromMembership(row: TenantMembershipRow): MobileTenant | null {
  const tenant = Array.isArray(row.tenants) ? row.tenants[0] : row.tenants;
  if (
    !tenant ||
    typeof tenant.id !== "string" ||
    typeof tenant.name !== "string" ||
    typeof tenant.slug !== "string"
  ) {
    return null;
  }
  return tenant;
}

export async function getMobileUserId(): Promise<string> {
  const {
    data: { user },
    error,
  } = await requireNextDesk().auth.getUser();
  if (error || !user?.id) throw new Error("Die Anmeldung ist abgelaufen.");
  await prepareMobileUserContext(user.id);
  return user.id;
}

export async function listMobileTenants(): Promise<MobileTenant[]> {
  const client = requireNextDesk();
  const userId = await getMobileUserId();
  const { data, error } = await client
    .from("tenant_memberships")
    .select("tenant_id, tenants(id, name, slug)")
    .eq("status", "active");
  if (error) throw error;

  const tenants = ((data ?? []) as TenantMembershipRow[])
    .map(tenantFromMembership)
    .filter((tenant): tenant is MobileTenant => Boolean(tenant))
    .sort((left, right) => left.name.localeCompare(right.name, "de-CH"));
  if (tenants.length === 0) {
    throw new Error(
      "Für dieses Konto ist kein aktiver nextDesk-Mandant verfügbar.",
    );
  }
  // Persisting this context is intentionally scoped to the authenticated user.
  // No tenant information is inferred from ticket content or URL parameters.
  await prepareMobileUserContext(userId);
  return tenants;
}

export async function selectMobileTenant(
  tenantId: string,
): Promise<MobileTenant> {
  const userId = await getMobileUserId();
  const tenants = await listMobileTenants();
  const tenant = tenants.find((candidate) => candidate.id === tenantId);
  if (!tenant) {
    throw new Error("Dieser Mandant ist für Ihr Konto nicht aktiv.");
  }
  await setSelectedTenantId(userId, tenant.id);
  return tenant;
}

export async function loadCurrentTenant(): Promise<MobileTenant> {
  const userId = await getMobileUserId();
  const tenants = await listMobileTenants();
  const selectedTenantId = await getSelectedTenantId(userId);
  const selectedTenant = tenants.find(
    (candidate) => candidate.id === selectedTenantId,
  );
  if (selectedTenant) return selectedTenant;

  // Accounts with one active tenant need no extra interaction. For multiple
  // tenants we retain one initial, user-scoped context and expose a picker in
  // the account screen; later calls never silently change that selection.
  const initialTenant = tenants[0];
  await setSelectedTenantId(userId, initialTenant.id);
  return initialTenant;
}

export async function clearMobileWorkspace(): Promise<void> {
  await clearMobilePrivateState();
}

/** Uses the production SSO access gate instead of trusting client-side profile data. */
export async function resolveMobileSsoEnforcement(): Promise<boolean> {
  const { data, error } = await requireNextDesk().functions.invoke(
    "tenant-sso-access",
    { body: {} },
  );
  if (error) throw error;
  if (typeof data !== "object" || data === null || !("data" in data)) {
    throw new Error("Die SSO-Zugangsprüfung ist unvollständig.");
  }
  const payload = (data as { data?: unknown }).data;
  if (typeof payload !== "object" || payload === null) {
    throw new Error("Die SSO-Zugangsprüfung ist unvollständig.");
  }
  const value = payload as { scope?: unknown; ssoEnforced?: unknown };
  if (value.scope === "unmanaged") return false;
  if (value.scope === "tenant" && typeof value.ssoEnforced === "boolean") {
    return value.ssoEnforced;
  }
  throw new Error("Die SSO-Zugangsprüfung ist unvollständig.");
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
