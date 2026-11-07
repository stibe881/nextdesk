import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";

import {
  accessTokenRoles,
  availableIntuneActions,
  buildIntuneActionRequest,
  INTUNE_MISSING_PERMISSION_MESSAGE,
  INTUNE_PRIVILEGED_OPERATIONS_PERMISSION,
  IntuneActionError,
  intuneActionErrorMessage,
  intunePlatform,
  mapGraphActionFailure,
  requestIntuneActionAccessToken,
  runIntuneDeviceAction,
} from "./intune-device-actions-graph.ts";

const DEVICE_ID = "AAAAAAAA-1111-4222-8333-444444444444";
const ENTRA_TENANT = "11111111-1111-4111-8111-111111111111";
const credentials = { clientId: "client-id", clientSecret: "client-secret" };

function base64Url(value: string): string {
  return btoa(value)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function token(roles: string[] | null): string {
  const payload = roles === null ? {} : { roles };
  return `${base64Url('{"alg":"none"}')}.${base64Url(JSON.stringify(payload))}.sig`;
}

const privilegedToken = token([
  "DeviceManagementManagedDevices.Read.All",
  INTUNE_PRIVILEGED_OPERATIONS_PERMISSION,
]);

type Call = { url: string; init: RequestInit | undefined };

function fakeFetch(
  responder: (call: Call) => Response,
  calls: Call[] = [],
): typeof fetch {
  return (input, init) => {
    const call = { url: String(input), init };
    calls.push(call);
    return Promise.resolve(responder(call));
  };
}

Deno.test("platforms map to the supported actions", () => {
  assertEquals(intunePlatform("Windows"), "windows");
  assertEquals(intunePlatform("iOS"), "ios");
  assertEquals(intunePlatform("iPadOS"), "ios");
  assertEquals(intunePlatform("macOS"), "macos");
  assertEquals(intunePlatform("Android"), "android");
  assertEquals(intunePlatform("AndroidEnterprise"), "android");
  assertEquals(intunePlatform(null), "other");
  assertEquals(intunePlatform("Linux"), "other");

  assertEquals(availableIntuneActions("Windows"), [
    "syncDevice",
    "rebootNow",
    "rotateLocalAdminPassword",
    "windowsDefenderScan",
  ]);
  assertEquals(availableIntuneActions("iOS"), [
    "syncDevice",
    "rebootNow",
    "remoteLock",
    "resetPasscode",
  ]);
  assertEquals(availableIntuneActions("Android"), [
    "syncDevice",
    "remoteLock",
    "resetPasscode",
  ]);
  assertEquals(availableIntuneActions("macOS"), [
    "syncDevice",
    "rebootNow",
    "remoteLock",
  ]);
  assertEquals(availableIntuneActions("Linux"), []);
  // Windows never gets a passcode reset or a remote lock.
  assert(!availableIntuneActions("Windows").includes("resetPasscode"));
  assert(!availableIntuneActions("Windows").includes("remoteLock"));
});

Deno.test("requests use the documented Graph endpoints", () => {
  const sync = buildIntuneActionRequest("syncDevice", DEVICE_ID, "t");
  assertEquals(
    sync.url,
    "https://graph.microsoft.com/v1.0/deviceManagement/managedDevices/aaaaaaaa-1111-4222-8333-444444444444/syncDevice",
  );
  assertEquals(sync.init.method, "POST");
  assertEquals(sync.init.body, undefined);
  assertEquals(
    (sync.init.headers as Record<string, string>).Authorization,
    "Bearer t",
  );

  for (const action of ["rebootNow", "remoteLock", "resetPasscode"] as const) {
    const request = buildIntuneActionRequest(action, DEVICE_ID, "t");
    assertEquals(request.apiVersion, "v1.0");
    assert(
      request.url.endsWith(
        `/v1.0/deviceManagement/managedDevices/aaaaaaaa-1111-4222-8333-444444444444/${action}`,
      ),
    );
  }

  const scan = buildIntuneActionRequest("windowsDefenderScan", DEVICE_ID, "t");
  assertEquals(scan.apiVersion, "v1.0");
  assertEquals(scan.init.body, '{"quickScan":true}');
  assertEquals(
    (scan.init.headers as Record<string, string>)["Content-Type"],
    "application/json",
  );

  const laps = buildIntuneActionRequest(
    "rotateLocalAdminPassword",
    DEVICE_ID,
    "t",
  );
  assertEquals(laps.apiVersion, "beta");
  assert(laps.url.startsWith("https://graph.microsoft.com/beta/"));
});

Deno.test(
  "device IDs that are not GUIDs are rejected before any request",
  () => {
    for (const id of ["", "../users", "abc", `${DEVICE_ID}/x`]) {
      try {
        buildIntuneActionRequest("syncDevice", id, "t");
        throw new Error("accepted");
      } catch (error) {
        assert(error instanceof IntuneActionError);
        assertEquals(error.code, "invalid_device");
      }
    }
  },
);

Deno.test("Graph failures map to clear error codes", () => {
  assertEquals(
    mapGraphActionFailure(403, {
      error: {
        code: "Forbidden",
        message:
          "Application is not authorized to perform this operation. Application must have one of the following scopes: DeviceManagementManagedDevices.PrivilegedOperations.All",
      },
    }),
    "permission_missing",
  );
  assertEquals(mapGraphActionFailure(401, null), "permission_missing");
  assertEquals(mapGraphActionFailure(404, null), "device_not_found");
  assertEquals(mapGraphActionFailure(429, null), "rate_limited");
  assertEquals(mapGraphActionFailure(400, null), "action_not_supported");
  assertEquals(mapGraphActionFailure(501, null), "action_not_supported");
  assertEquals(
    mapGraphActionFailure(422, {
      error: { code: "NotSupported", message: "" },
    }),
    "action_not_supported",
  );
  assertEquals(mapGraphActionFailure(500, null), "provider_unavailable");
  assertEquals(mapGraphActionFailure(503, null), "provider_unavailable");
  assertEquals(
    intuneActionErrorMessage("permission_missing"),
    "In Entra fehlt die Berechtigung DeviceManagementManagedDevices.PrivilegedOperations.All.",
  );
  assertEquals(
    intuneActionErrorMessage("permission_missing"),
    INTUNE_MISSING_PERMISSION_MESSAGE,
  );
});

Deno.test("token roles are read from the access token", () => {
  assertEquals(accessTokenRoles(token(["A", "B"])), ["A", "B"]);
  assertEquals(accessTokenRoles(token(null)), null);
  assertEquals(accessTokenRoles("opaque"), null);
});

Deno.test(
  "a token without PrivilegedOperations.All never reaches Graph",
  async () => {
    const calls: Call[] = [];
    const error = await assertRejects(
      () =>
        runIntuneDeviceAction(
          "rebootNow",
          DEVICE_ID,
          token(["DeviceManagementManagedDevices.Read.All"]),
          fakeFetch(() => new Response(null, { status: 204 }), calls),
        ),
      IntuneActionError,
    );
    assertEquals(error.code, "permission_missing");
    assertEquals(calls.length, 0);
  },
);

Deno.test("a successful action returns the Graph status", async () => {
  const calls: Call[] = [];
  const result = await runIntuneDeviceAction(
    "windowsDefenderScan",
    DEVICE_ID,
    privilegedToken,
    fakeFetch(() => new Response(null, { status: 204 }), calls),
  );
  assertEquals(result, { graphStatus: 204, apiVersion: "v1.0" });
  assertEquals(calls.length, 1);
  assertEquals(calls[0].init?.method, "POST");
  assertEquals(calls[0].init?.redirect, "error");
  assert(calls[0].url.endsWith("/windowsDefenderScan"));
  assertEquals(calls[0].init?.body, '{"quickScan":true}');
});

Deno.test(
  "a Graph 403 becomes permission_missing with the status",
  async () => {
    const error = await assertRejects(
      () =>
        runIntuneDeviceAction(
          "syncDevice",
          DEVICE_ID,
          "opaque-token",
          fakeFetch(() =>
            Response.json(
              { error: { code: "Forbidden", message: "Not authorized" } },
              { status: 403 },
            ),
          ),
        ),
      IntuneActionError,
    );
    assertEquals(error.code, "permission_missing");
    assertEquals(error.graphStatus, 403);
  },
);

Deno.test("network failures become provider_unavailable", async () => {
  const error = await assertRejects(
    () =>
      runIntuneDeviceAction("syncDevice", DEVICE_ID, privilegedToken, () =>
        Promise.reject(new TypeError("network")),
      ),
    IntuneActionError,
  );
  assertEquals(error.code, "provider_unavailable");
  assertEquals(error.graphStatus, null);
});

Deno.test(
  "the token request uses client credentials for the Entra tenant",
  async () => {
    const calls: Call[] = [];
    const accessToken = await requestIntuneActionAccessToken(
      ENTRA_TENANT,
      credentials,
      fakeFetch(() => Response.json({ access_token: "abc" }), calls),
    );
    assertEquals(accessToken, "abc");
    assertEquals(
      calls[0].url,
      `https://login.microsoftonline.com/${ENTRA_TENANT}/oauth2/v2.0/token`,
    );
    const body = calls[0].init?.body as URLSearchParams;
    assertEquals(body.get("grant_type"), "client_credentials");
    assertEquals(body.get("scope"), "https://graph.microsoft.com/.default");
  },
);

Deno.test("token failures map to consent_missing or rate_limited", async () => {
  const consent = await assertRejects(
    () =>
      requestIntuneActionAccessToken(
        ENTRA_TENANT,
        credentials,
        fakeFetch(() =>
          Response.json({ error: "unauthorized_client" }, { status: 400 }),
        ),
      ),
    IntuneActionError,
  );
  assertEquals(consent.code, "consent_missing");
  const limited = await assertRejects(
    () =>
      requestIntuneActionAccessToken(
        ENTRA_TENANT,
        credentials,
        fakeFetch(() => new Response(null, { status: 429 })),
      ),
    IntuneActionError,
  );
  assertEquals(limited.code, "rate_limited");
  const invalidTenant = await assertRejects(
    () => requestIntuneActionAccessToken("not-a-tenant", credentials),
    IntuneActionError,
  );
  assertEquals(invalidTenant.code, "provider_not_configured");
});
