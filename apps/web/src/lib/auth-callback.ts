import type {
  EmailOtpType,
  Session,
  SupabaseClient,
} from "@supabase/supabase-js";

type BrowserAuthClient = Pick<
  SupabaseClient["auth"],
  "exchangeCodeForSession" | "getSession" | "setSession" | "verifyOtp"
>;

export type BrowserAuthBootstrapResult = {
  cleanUrl: string | null;
  error: Error | null;
  session: Session | null;
};

const EMAIL_OTP_TYPES = new Set<EmailOtpType>([
  "email",
  "email_change",
  "invite",
  "magiclink",
  "recovery",
  "signup",
]);

const CALLBACK_PARAMETER_KEYS = [
  "access_token",
  "code",
  "error",
  "error_code",
  "error_description",
  "expires_at",
  "expires_in",
  "provider_refresh_token",
  "provider_token",
  "refresh_token",
  "sb_flow_id",
  "state",
  "token_hash",
  "token_type",
  "type",
] as const;

const CALLBACK_INDICATOR_KEYS = CALLBACK_PARAMETER_KEYS;

function callbackValues(url: URL, key: string): string[] {
  const fragment = new URLSearchParams(url.hash.slice(1));
  return [...url.searchParams.getAll(key), ...fragment.getAll(key)];
}

function callbackValue(url: URL, key: string): string | null {
  return callbackValues(url, key).find((value) => value.length > 0) ?? null;
}

function hasCallbackParameter(url: URL, key: string): boolean {
  const fragment = new URLSearchParams(url.hash.slice(1));
  return url.searchParams.has(key) || fragment.has(key);
}

function cleanCallbackUrl(url: URL): string {
  for (const key of CALLBACK_PARAMETER_KEYS) url.searchParams.delete(key);
  const fragment = new URLSearchParams(url.hash.slice(1));
  for (const key of CALLBACK_PARAMETER_KEYS) fragment.delete(key);
  url.hash = fragment.toString();
  return url.toString();
}

export function cleanBrowserAuthCallbackUrl(callbackUrl: string): string {
  return cleanCallbackUrl(new URL(callbackUrl));
}

function callbackError(url: URL): Error | null {
  const hasError = ["error", "error_code", "error_description"].some((key) =>
    hasCallbackParameter(url, key),
  );
  if (!hasError) return null;

  const description = callbackValue(url, "error_description");
  const code = callbackValue(url, "error") ?? callbackValue(url, "error_code");
  return new Error(description ?? code ?? "Anmeldung fehlgeschlagen.");
}

function emailOtpType(value: string | null): EmailOtpType | null {
  return value && EMAIL_OTP_TYPES.has(value as EmailOtpType)
    ? (value as EmailOtpType)
    : null;
}

export function hasBrowserAuthCallback(callbackUrl: string): boolean {
  const url = new URL(callbackUrl);
  return Boolean(
    callbackError(url) ||
    CALLBACK_INDICATOR_KEYS.some((key) => hasCallbackParameter(url, key)),
  );
}

export function createBrowserAuthSessionGate(callbackInProgress: boolean) {
  let phase: "failed" | "pending" | "settled" = callbackInProgress
    ? "pending"
    : "settled";

  return {
    accepts(session: Session | null): boolean {
      if (!callbackInProgress) return true;
      if (phase !== "settled") return false;
      // The callback result itself is applied directly. All later session
      // events are discarded, so a delayed persisted session cannot restart a
      // tenant bootstrap under the same or a different user identity.
      return session === null;
    },
    complete(_session: Session): void {
      if (!callbackInProgress) return;
      phase = "settled";
    },
    fail(): void {
      if (callbackInProgress) phase = "failed";
    },
  };
}

/**
 * Resolves the session explicitly after a browser redirect. This keeps PKCE
 * callback handling in the mounted application, so a newly authenticated user
 * always reaches the tenant SSO guard with a persisted session.
 */
export async function bootstrapBrowserAuthSession(
  auth: BrowserAuthClient,
  callbackUrl: string,
): Promise<BrowserAuthBootstrapResult> {
  const url = new URL(callbackUrl);
  const callbackDetected = hasBrowserAuthCallback(callbackUrl);

  try {
    const redirectError = callbackError(url);
    if (redirectError) {
      return {
        cleanUrl: cleanCallbackUrl(url),
        error: redirectError,
        session: null,
      };
    }

    const code = callbackValue(url, "code");
    if (code) {
      const flowId = callbackValue(url, "sb_flow_id");
      const { data, error } = await auth.exchangeCodeForSession(
        code,
        flowId ? { flowId } : undefined,
      );
      return {
        cleanUrl: cleanCallbackUrl(url),
        error,
        session: data.session,
      };
    }

    const tokenHash = callbackValue(url, "token_hash");
    const type = emailOtpType(callbackValue(url, "type"));
    if (tokenHash && type) {
      const { data, error } = await auth.verifyOtp({
        token_hash: tokenHash,
        type,
      });
      return {
        cleanUrl: cleanCallbackUrl(url),
        error,
        session: data.session,
      };
    }

    const accessToken = callbackValue(url, "access_token");
    const refreshToken = callbackValue(url, "refresh_token");
    if (accessToken && refreshToken) {
      const { data, error } = await auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      return {
        cleanUrl: cleanCallbackUrl(url),
        error,
        session: data.session,
      };
    }

    if (callbackDetected) {
      return {
        cleanUrl: cleanCallbackUrl(url),
        error: new Error(
          "Die Anmelderückkehr war unvollständig oder ungültig.",
        ),
        session: null,
      };
    }

    const { data, error } = await auth.getSession();
    return { cleanUrl: null, error, session: data.session };
  } catch (error) {
    return {
      cleanUrl: callbackDetected ? cleanCallbackUrl(url) : null,
      error:
        error instanceof Error
          ? error
          : new Error("Die Anmeldung konnte nicht abgeschlossen werden."),
      session: null,
    };
  }
}
