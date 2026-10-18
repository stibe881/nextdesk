import Constants from "expo-constants";
import * as Crypto from "expo-crypto";
import { Platform } from "react-native";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  clearMobilePrivateState,
  getSelectedTenantId,
  prepareMobileUserContext,
  setSelectedTenantId,
} from "@/lib/mobile-private-state";
import { mobileSecureStorage } from "@/lib/mobile-secure-storage";
import { base64UrlEncode, pkceS256Challenge, withTimeout } from "@/lib/pkce";

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

const AUTH_TRANSACTION_KEY = "nextdesk:mobile:auth-transaction:v1";
const AUTH_TRANSACTION_TTL_MS = 10 * 60 * 1_000;
const AUTH_STORAGE_STEP_TIMEOUT_MS = 6_000;
const AUTH_STORAGE_TIMEOUT_MESSAGE =
  "Der sichere Gerätespeicher hat nicht rechtzeitig geantwortet. Bitte entsperren Sie das iPhone und versuchen Sie es erneut.";
const SUPABASE_AUTH_STORAGE_KEY = (() => {
  try {
    return `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
  } catch {
    return "nextdesk-auth-token";
  }
})();

export const nextDesk: SupabaseClient | null = isNextDeskConfigured
  ? createClient(url, publishableKey, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: false,
        flowType: "pkce",
        persistSession: true,
        storageKey: SUPABASE_AUTH_STORAGE_KEY,
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
  | "callback_unexpected"
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
    case "callback_unexpected":
      return "Diese Anmelderückkehr gehört nicht zur aktuellen nextDesk-Anmeldung. Bitte starten Sie die SSO-Anmeldung erneut.";
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

type AuthTransaction = {
  expiresAt: number;
  kind: "magic" | "oauth";
};

function isTrustedWebCallback(url: URL): boolean {
  return (
    Platform.OS === "web" &&
    typeof window !== "undefined" &&
    url.origin === window.location.origin &&
    url.pathname.replace(/\/+$/, "") === "/auth/callback"
  );
}

export function isNextDeskAuthCallback(url: string): boolean {
  try {
    const parsed = new URL(url);
    const callbackPath = parsed.pathname.replace(/\/+$/, "");
    return (
      parsed.protocol === "ch.grossict.nextdesk:" &&
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

function parseAuthTransaction(value: string | null): AuthTransaction | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<AuthTransaction>;
    if (
      (parsed.kind !== "oauth" && parsed.kind !== "magic") ||
      typeof parsed.expiresAt !== "number" ||
      !Number.isFinite(parsed.expiresAt) ||
      parsed.expiresAt <= Date.now()
    ) {
      return null;
    }
    return parsed as AuthTransaction;
  } catch {
    return null;
  }
}

async function readAuthTransaction(): Promise<AuthTransaction | null> {
  const stored = await mobileSecureStorage.getItem(AUTH_TRANSACTION_KEY);
  const transaction = parseAuthTransaction(stored);
  if (!transaction && stored) {
    await mobileSecureStorage.removeItem(AUTH_TRANSACTION_KEY);
  }
  return transaction;
}

export async function beginNextDeskOAuth(): Promise<void> {
  const transaction: AuthTransaction = {
    expiresAt: Date.now() + AUTH_TRANSACTION_TTL_MS,
    kind: "oauth",
  };
  await withTimeout(
    mobileSecureStorage.setItem(
      AUTH_TRANSACTION_KEY,
      JSON.stringify(transaction),
    ),
    AUTH_STORAGE_STEP_TIMEOUT_MS,
    AUTH_STORAGE_TIMEOUT_MESSAGE,
  );
}

function secureRandomBytes(length: number): Uint8Array {
  try {
    // Synchronous OS CSPRNG; no promise can stall the sign-in start.
    return Crypto.getRandomBytes(length);
  } catch {
    const bytes = new Uint8Array(length);
    const webCrypto = (
      globalThis as {
        crypto?: { getRandomValues?: (array: Uint8Array) => Uint8Array };
      }
    ).crypto;
    if (!webCrypto?.getRandomValues) {
      throw new Error(
        "Dieses Gerät stellt keinen sicheren Zufallsgenerator für die Anmeldung bereit.",
      );
    }
    webCrypto.getRandomValues(bytes);
    return bytes;
  }
}

/**
 * Native SSO start without asynchronous platform crypto: the verifier comes
 * from the synchronous OS CSPRNG, the S256 challenge is computed in pure
 * JavaScript and the verifier is stored only in the encrypted iOS Keychain in
 * exactly the JSON format Supabase reads during `exchangeCodeForSession`.
 */
export async function createNativeNextDeskOAuthUrl(
  redirectTo: string,
): Promise<string> {
  if (Platform.OS === "web") {
    throw new Error(
      "Der native SSO-Start ist nur in der mobilen App verfügbar.",
    );
  }
  if (!url)
    throw new Error("Die mobile nextDesk-Verbindung ist nicht konfiguriert.");

  const verifier = base64UrlEncode(secureRandomBytes(32));
  const codeChallenge = pkceS256Challenge(verifier);
  await withTimeout(
    mobileSecureStorage.setItem(
      `${SUPABASE_AUTH_STORAGE_KEY}-code-verifier`,
      JSON.stringify(verifier),
    ),
    AUTH_STORAGE_STEP_TIMEOUT_MS,
    AUTH_STORAGE_TIMEOUT_MESSAGE,
  );

  const authorizationUrl = new URL(
    "auth/v1/authorize",
    `${url.replace(/\/$/, "")}/`,
  );
  authorizationUrl.search = new URLSearchParams({
    provider: "azure",
    redirect_to: redirectTo,
    scopes: "email",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  }).toString();
  return authorizationUrl.toString();
}

export async function beginNextDeskMagicLink(): Promise<void> {
  const transaction: AuthTransaction = {
    expiresAt: Date.now() + AUTH_TRANSACTION_TTL_MS,
    kind: "magic",
  };
  await mobileSecureStorage.setItem(
    AUTH_TRANSACTION_KEY,
    JSON.stringify(transaction),
  );
}

export async function clearNextDeskAuthTransaction(): Promise<void> {
  await mobileSecureStorage.removeItem(AUTH_TRANSACTION_KEY);
}

/** Completes only a PKCE code callback bound to an app-initiated transaction. */
export async function completeNextDeskAuth(callbackUrl: string): Promise<void> {
  const callback = new URL(callbackUrl);
  if (!isNextDeskAuthCallback(callbackUrl) && !isTrustedWebCallback(callback)) {
    throw new NextDeskAuthFailure("callback_invalid");
  }
  const code = callback.searchParams.get("code");
  // A provider code is single-use. Dedupe by the callback credential rather
  // than the raw URL because Expo and WebBrowser can normalize one deep link
  // differently while returning it to the already running app.
  const callbackKey = code ? `pkce:${code}` : "invalid";

  if (lastCompletedCallbackKey === callbackKey) return;
  if (pendingAuthCompletion?.callbackKey === callbackKey) {
    return pendingAuthCompletion.promise;
  }

  const promise = (async () => {
    const providerError =
      callback.searchParams.get("error_description") ??
      callback.searchParams.get("error");
    if (providerError) {
      await clearNextDeskAuthTransaction();
      throw new NextDeskAuthFailure(
        getNextDeskAuthFailureCode(new Error(providerError)),
      );
    }

    if (!code) {
      throw new NextDeskAuthFailure("callback_invalid");
    }

    const transaction = await readAuthTransaction();
    if (!transaction) {
      throw new NextDeskAuthFailure("callback_unexpected");
    }

    const { error } = await requireNextDesk().auth.exchangeCodeForSession(code);
    if (error) {
      throw new NextDeskAuthFailure(getNextDeskAuthFailureCode(error));
    }

    const {
      data: { session },
    } = await requireNextDesk().auth.getSession();
    if (!session) throw new NextDeskAuthFailure("session_not_saved");
    await clearNextDeskAuthTransaction();
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
