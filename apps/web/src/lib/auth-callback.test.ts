import { expect, test } from "vitest";
import {
  AuthError,
  type Session,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";
import {
  bootstrapBrowserAuthSession,
  cleanBrowserAuthCallbackUrl,
  createBrowserAuthSessionGate,
  hasBrowserAuthCallback,
} from "./auth-callback";

type BrowserAuthClient = Pick<
  SupabaseClient["auth"],
  "exchangeCodeForSession" | "getSession" | "setSession" | "verifyOtp"
>;

const user = { id: "test-user" } as User;
const session = { user } as Session;

function authClient(overrides: Partial<BrowserAuthClient>): BrowserAuthClient {
  return {
    exchangeCodeForSession: async () => ({
      data: { user: null, session: null },
      error: null,
    }),
    getSession: async () => ({ data: { session: null }, error: null }),
    setSession: async () => ({
      data: { user: null, session: null },
      error: null,
    }),
    verifyOtp: async () => ({
      data: { user: null, session: null },
      error: null,
    }),
    ...overrides,
  } as BrowserAuthClient;
}

test("recognises all supported browser auth callbacks before an existing session is loaded", () => {
  expect(
    hasBrowserAuthCallback("https://app.nextdesk.ch/?code=one-time-code"),
  ).toBe(true);
  expect(
    hasBrowserAuthCallback(
      "https://app.nextdesk.ch/#access_token=access&refresh_token=refresh",
    ),
  ).toBe(true);
  expect(hasBrowserAuthCallback("https://app.nextdesk.ch/overview")).toBe(
    false,
  );
  expect(
    hasBrowserAuthCallback(
      "https://app.nextdesk.ch/#error=access_denied&error_description=abgebrochen",
    ),
  ).toBe(true);
  expect(
    hasBrowserAuthCallback(
      "https://app.nextdesk.ch/?error_description=abgebrochen",
    ),
  ).toBe(true);
  expect(
    hasBrowserAuthCallback("https://app.nextdesk.ch/?state=state-value"),
  ).toBe(true);
});

test("allows no later session event after a callback, even for the same user", () => {
  const oldSession = { user: { id: "old-user" } } as Session;
  const callbackSession = { user: { id: "callback-user" } } as Session;
  const sameUserOldSession = { user: { id: "callback-user" } } as Session;
  const gate = createBrowserAuthSessionGate(true);

  expect(gate.accepts(oldSession)).toBe(false);
  gate.complete(callbackSession);
  expect(gate.accepts(oldSession)).toBe(false);
  expect(gate.accepts(sameUserOldSession)).toBe(false);
  expect(gate.accepts(callbackSession)).toBe(false);
  expect(gate.accepts(null)).toBe(true);
});

test("keeps all session events blocked after a failed callback", () => {
  const gate = createBrowserAuthSessionGate(true);

  gate.fail();
  expect(gate.accepts(session)).toBe(false);
  expect(gate.accepts(null)).toBe(false);
});

test("handles a fragment error before restoring an existing session and removes callback values", async () => {
  const result = await bootstrapBrowserAuthSession(
    authClient({
      getSession: async () => {
        throw new Error("Eine alte Sitzung darf nicht geladen werden.");
      },
    }),
    "https://app.nextdesk.ch/#error=access_denied&error_description=abgebrochen&access_token=secret",
  );

  expect(result.error?.message).toBe("abgebrochen");
  expect(result.session).toBeNull();
  expect(result.cleanUrl).toBe("https://app.nextdesk.ch/");
});

test("handles a query error description before restoring an existing session", async () => {
  const result = await bootstrapBrowserAuthSession(
    authClient({
      getSession: async () => {
        throw new Error("Eine alte Sitzung darf nicht geladen werden.");
      },
    }),
    "https://app.nextdesk.ch/?error_description=abgebrochen&state=state-value",
  );

  expect(result.error?.message).toBe("abgebrochen");
  expect(result.session).toBeNull();
  expect(result.cleanUrl).toBe("https://app.nextdesk.ch/");
});

test("does not let empty or duplicated error fields conceal a callback error", async () => {
  const callbackUrl =
    "https://app.nextdesk.ch/?error_description=&error_description=abgebrochen#error_description=fragment";
  const result = await bootstrapBrowserAuthSession(
    authClient({
      getSession: async () => {
        throw new Error("Eine alte Sitzung darf nicht geladen werden.");
      },
    }),
    callbackUrl,
  );

  expect(hasBrowserAuthCallback(callbackUrl)).toBe(true);
  expect(result.error?.message).toBe("abgebrochen");
  expect(result.cleanUrl).toBe("https://app.nextdesk.ch/");
});

test("rejects incomplete callbacks instead of restoring an old session", async () => {
  const result = await bootstrapBrowserAuthSession(
    authClient({
      getSession: async () => {
        throw new Error("Eine alte Sitzung darf nicht geladen werden.");
      },
    }),
    "https://app.nextdesk.ch/?token_hash=one-time-token&type=ungültig",
  );

  expect(result.error?.message).toBe(
    "Die Anmelderückkehr war unvollständig oder ungültig.",
  );
  expect(result.cleanUrl).toBe("https://app.nextdesk.ch/");
});

test("rejects a state-only callback instead of restoring an old session", async () => {
  const result = await bootstrapBrowserAuthSession(
    authClient({
      getSession: async () => {
        throw new Error("Eine alte Sitzung darf nicht geladen werden.");
      },
    }),
    "https://app.nextdesk.ch/?state=state-value",
  );

  expect(result.error?.message).toBe(
    "Die Anmelderückkehr war unvollständig oder ungültig.",
  );
  expect(result.cleanUrl).toBe("https://app.nextdesk.ch/");
});

test("removes all callback secrets from query and fragment", () => {
  expect(
    cleanBrowserAuthCallbackUrl(
      "https://app.nextdesk.ch/?error=access_denied&access_token=access&refresh_token=refresh&provider_token=provider&state=state#provider_refresh_token=provider-refresh&token_hash=hash",
    ),
  ).toBe("https://app.nextdesk.ch/");
});

test("exchanges a PKCE code before the workspace boots and removes callback parameters", async () => {
  const calls: unknown[][] = [];
  const result = await bootstrapBrowserAuthSession(
    authClient({
      exchangeCodeForSession: async (...args) => {
        calls.push(args);
        return { data: { user, session }, error: null };
      },
    }),
    "https://app.nextdesk.ch/?code=one-time-code&sb_flow_id=flow-id-12345678&view=overview",
  );

  expect(calls).toEqual([["one-time-code", { flowId: "flow-id-12345678" }]]);
  expect(result.error).toBeNull();
  expect(result.session).toBe(session);
  expect(result.cleanUrl).toBe("https://app.nextdesk.ch/?view=overview");
});

test("keeps a failed PKCE callback visible instead of silently falling back to no session", async () => {
  const result = await bootstrapBrowserAuthSession(
    authClient({
      exchangeCodeForSession: async () => ({
        data: { user: null, session: null },
        error: new AuthError("Codeaustausch fehlgeschlagen."),
      }),
    }),
    "https://app.nextdesk.ch/?code=one-time-code",
  );

  expect(result.cleanUrl).toBe("https://app.nextdesk.ch/");
  expect(result.error?.message).toBe("Codeaustausch fehlgeschlagen.");
  expect(result.session).toBeNull();
});

test("cleans a callback URL when the PKCE exchange throws", async () => {
  const result = await bootstrapBrowserAuthSession(
    authClient({
      exchangeCodeForSession: async () => {
        throw new Error("Transportfehler");
      },
    }),
    "https://app.nextdesk.ch/?code=one-time-code&sb_flow_id=flow-id-12345678&state=state-value",
  );

  expect(result.error?.message).toBe("Transportfehler");
  expect(result.cleanUrl).toBe("https://app.nextdesk.ch/");
});

test("preserves implicit magic-link support when an access and refresh token return in the URL fragment", async () => {
  const calls: unknown[][] = [];
  const result = await bootstrapBrowserAuthSession(
    authClient({
      setSession: async (...args) => {
        calls.push(args);
        return { data: { user, session }, error: null };
      },
    }),
    "https://app.nextdesk.ch/#access_token=access&refresh_token=refresh",
  );

  expect(calls).toEqual([
    [{ access_token: "access", refresh_token: "refresh" }],
  ]);
  expect(result.cleanUrl).toBe("https://app.nextdesk.ch/");
  expect(result.error).toBeNull();
  expect(result.session).toBe(session);
});
