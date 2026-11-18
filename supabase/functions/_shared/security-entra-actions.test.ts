import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  buildEntraActionRequest,
  EntraActionError,
  entraActionErrorMessage,
  mapEntraFailure,
  runEntraSecurityAction,
} from "./security-entra-actions.ts";

const user = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

function token(roles: string[]): string {
  const encode = (value: unknown) =>
    btoa(JSON.stringify(value)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  return `${encode({ alg: "none" })}.${encode({ roles })}.sig`;
}

Deno.test("Entra: Anfragen an Microsoft Graph", () => {
  const revoke = buildEntraActionRequest("revokeSessions", user, "t");
  assertEquals(revoke.url, `https://graph.microsoft.com/v1.0/users/${user}/revokeSignInSessions`);
  assertEquals(revoke.init.method, "POST");
  const reset = buildEntraActionRequest("forcePasswordChange", user.toUpperCase(), "t");
  assertEquals(reset.url, `https://graph.microsoft.com/v1.0/users/${user}`);
  assertEquals(reset.init.method, "PATCH");
  assertEquals(JSON.parse(String(reset.init.body)), {
    passwordProfile: { forceChangePasswordNextSignIn: true },
  });
});

Deno.test("Entra: fehlende Berechtigung wird klar gemeldet", async () => {
  let called = false;
  const fetchImpl = () => {
    called = true;
    return Promise.resolve(new Response(null, { status: 204 }));
  };
  const error = await assertRejects(
    () => runEntraSecurityAction("forcePasswordChange", user, token(["User.Read.All"]), fetchImpl),
    EntraActionError,
  );
  assertEquals(error.code, "permission_missing");
  assertEquals(called, false);
  assertEquals(
    entraActionErrorMessage("permission_missing", "forcePasswordChange").includes(
      "User-PasswordProfile.ReadWrite.All",
    ),
    true,
  );
  assertEquals(
    entraActionErrorMessage("permission_missing", "revokeSessions").includes(
      "User.RevokeSessions.All",
    ),
    true,
  );
});

Deno.test("Entra: Antwort von Graph", async () => {
  const ok = await runEntraSecurityAction(
    "revokeSessions",
    user,
    token(["User.RevokeSessions.All"]),
    () => Promise.resolve(new Response('{"value":true}', { status: 200 })),
  );
  assertEquals(ok.graphStatus, 200);
  const denied = await assertRejects(
    () =>
      runEntraSecurityAction(
        "forcePasswordChange",
        user,
        token(["User.ReadWrite.All"]),
        () => Promise.resolve(new Response("{}", { status: 403 })),
      ),
    EntraActionError,
  );
  assertEquals(denied.code, "permission_missing");
  assertEquals(mapEntraFailure(404), "user_not_found");
  assertEquals(mapEntraFailure(429), "rate_limited");
  assertEquals(mapEntraFailure(500), "provider_unavailable");
  await assertRejects(
    () => runEntraSecurityAction("revokeSessions", "kein-guid", "t"),
    EntraActionError,
  );
});
