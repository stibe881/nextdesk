import {
  INTUNE_MANAGED_DEVICE_SELECT,
  IntuneGraphError,
  readIntuneGraphCredentials,
  readIntuneManagedDevices,
  requestIntuneGraphAccessToken,
} from "./intune-managed-devices-graph.ts";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const credentials = { clientId: "client-id", clientSecret: "client-secret" };

Deno.test("Intune graph credentials remain separate and fail closed", () => {
  if (readIntuneGraphCredentials({}) !== null) {
    throw new Error("Missing Intune credentials must not be accepted.");
  }
  const configured = readIntuneGraphCredentials({
    INTUNE_MANAGED_DEVICES_CLIENT_ID: " client-id ",
    INTUNE_MANAGED_DEVICES_CLIENT_SECRET: " client-secret ",
  });
  if (
    configured?.clientId !== "client-id" ||
    configured.clientSecret !== "client-secret"
  ) {
    throw new Error("The dedicated Intune credentials were not parsed safely.");
  }
});

Deno.test(
  "Intune graph uses only token POST and managedDevices GET allowlists",
  async () => {
    const calls: Array<{ url: string; method: string; body?: string }> = [];
    const fakeFetch: typeof fetch = async (input, init) => {
      const url = String(input);
      calls.push({
        url,
        method: init?.method ?? "GET",
        body:
          init?.body instanceof URLSearchParams
            ? init.body.toString()
            : undefined,
      });
      if (url.includes("/token")) {
        return Response.json({ access_token: "token-value" });
      }
      return Response.json({
        value: [
          {
            id: "Device-A",
            deviceName: "ICT-001",
            serialNumber: "SERIAL-1",
            manufacturer: "Example",
            model: "Laptop",
            operatingSystem: "Windows",
            osVersion: "11",
            complianceState: "compliant",
            isEncrypted: true,
            lastSyncDateTime: "2026-10-21T05:00:00Z",
            enrolledDateTime: "2026-10-01T05:00:00Z",
            userId: "22222222-2222-4222-8222-222222222222",
            userPrincipalName: "must-not-be-read@example.invalid",
            imei: "must-not-be-read",
          },
        ],
      });
    };
    const token = await requestIntuneGraphAccessToken(
      TENANT_ID,
      credentials,
      fakeFetch,
    );
    const pages: unknown[] = [];
    await readIntuneManagedDevices(
      token,
      async (devices) => {
        pages.push(devices);
      },
      fakeFetch,
    );

    if (
      calls.length !== 2 ||
      calls[0].method !== "POST" ||
      calls[1].method !== "GET"
    ) {
      throw new Error("The Intune adapter used an unexpected provider method.");
    }
    if (
      !calls[0].url.startsWith(
        `https://login.microsoftonline.com/${TENANT_ID}/`,
      )
    ) {
      throw new Error("The token request was not tenant-bound.");
    }
    if (!calls[0].body?.includes("grant_type=client_credentials")) {
      throw new Error("The token request must use client credentials.");
    }
    if (
      !calls[1].url.startsWith(
        "https://graph.microsoft.com/v1.0/deviceManagement/managedDevices?",
      )
    ) {
      throw new Error("The graph request did not use the managedDevices path.");
    }
    for (const forbidden of [
      "userPrincipalName",
      "imei",
      "macAddress",
      "users",
    ]) {
      if (calls[1].url.includes(forbidden)) {
        throw new Error(
          `The Graph select list contains forbidden data: ${forbidden}`,
        );
      }
    }
    const device = (pages[0] as Array<Record<string, unknown>>)[0];
    if (
      device.external_device_id !== "device-a" ||
      device.primary_user_object_id !==
        "22222222-2222-4222-8222-222222222222" ||
      "userPrincipalName" in device ||
      "imei" in device
    ) {
      throw new Error("The normalized device projection leaked provider data.");
    }
  },
);

Deno.test(
  "Intune graph discards a malformed optional primary user object ID",
  async () => {
    const fakeFetch: typeof fetch = async (input) => {
      if (String(input).includes("/token")) {
        return Response.json({ access_token: "token-value" });
      }
      return Response.json({
        value: [{ id: "device-a", userId: "not-an-entra-object-id" }],
      });
    };
    const token = await requestIntuneGraphAccessToken(
      TENANT_ID,
      credentials,
      fakeFetch,
    );
    const pages: Array<Array<Record<string, unknown>>> = [];
    await readIntuneManagedDevices(
      token,
      async (devices) => pages.push(devices),
      fakeFetch,
    );
    if (pages[0]?.[0]?.primary_user_object_id !== null) {
      throw new Error("An untrusted provider user ID was retained.");
    }
  },
);

Deno.test("Intune graph rejects an off-origin provider next link", async () => {
  const fakeFetch: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes("/token"))
      return Response.json({ access_token: "token-value" });
    return Response.json({
      value: [],
      "@odata.nextLink":
        "https://attacker.invalid/v1.0/deviceManagement/managedDevices?$skiptoken=x",
    });
  };
  const token = await requestIntuneGraphAccessToken(
    TENANT_ID,
    credentials,
    fakeFetch,
  );
  try {
    await readIntuneManagedDevices(token, async () => {}, fakeFetch);
  } catch (error) {
    if (
      error instanceof IntuneGraphError &&
      error.code === "provider_payload_invalid"
    ) {
      return;
    }
    throw error;
  }
  throw new Error("An off-origin Graph next link was accepted.");
});

Deno.test(
  "Intune graph renews the server fence before every provider page",
  async () => {
    const sequence: string[] = [];
    let graphCalls = 0;
    const fakeFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("/token"))
        return Response.json({ access_token: "token-value" });
      graphCalls += 1;
      sequence.push(`get:${graphCalls}`);
      if (graphCalls === 1) {
        const next = new URL(
          "https://graph.microsoft.com/v1.0/deviceManagement/managedDevices",
        );
        next.searchParams.set(
          "$select",
          INTUNE_MANAGED_DEVICE_SELECT.join(","),
        );
        next.searchParams.set("$top", "100");
        next.searchParams.set("$skiptoken", "page-two");
        return Response.json({
          value: [{ id: "page-one" }],
          "@odata.nextLink": next.toString(),
        });
      }
      return Response.json({ value: [{ id: "page-two" }] });
    };
    const token = await requestIntuneGraphAccessToken(
      TENANT_ID,
      credentials,
      fakeFetch,
    );
    await readIntuneManagedDevices(
      token,
      async () => {
        sequence.push(`stage:${graphCalls}`);
      },
      fakeFetch,
      async () => {
        sequence.push(`fence:${graphCalls + 1}`);
      },
    );
    const expected = [
      "fence:1",
      "get:1",
      "stage:1",
      "fence:2",
      "get:2",
      "stage:2",
    ];
    if (sequence.join("|") !== expected.join("|")) {
      throw new Error(
        `Graph pages were not fenced before each GET: ${sequence.join("|")}`,
      );
    }
  },
);

Deno.test(
  "Intune graph rejects unexpected continuation query parameters",
  async () => {
    const fakeFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("/token")) {
        return Response.json({ access_token: "token-value" });
      }
      return Response.json({
        value: [],
        "@odata.nextLink":
          "https://graph.microsoft.com/v1.0/deviceManagement/managedDevices?$skiptoken=page-two&$filter=deviceName%20ne%20null",
      });
    };
    const token = await requestIntuneGraphAccessToken(
      TENANT_ID,
      credentials,
      fakeFetch,
    );
    try {
      await readIntuneManagedDevices(token, async () => {}, fakeFetch);
    } catch (error) {
      if (
        error instanceof IntuneGraphError &&
        error.code === "provider_payload_invalid"
      ) {
        return;
      }
      throw error;
    }
    throw new Error("An unexpected continuation parameter was accepted.");
  },
);

for (const [label, continuation] of [
  [
    "missing select",
    "https://graph.microsoft.com/v1.0/deviceManagement/managedDevices?$top=100&$skiptoken=page-two",
  ],
  [
    "missing page size",
    `https://graph.microsoft.com/v1.0/deviceManagement/managedDevices?$select=${encodeURIComponent(INTUNE_MANAGED_DEVICE_SELECT.join(","))}&$skiptoken=page-two`,
  ],
  [
    "blank skip token",
    `https://graph.microsoft.com/v1.0/deviceManagement/managedDevices?$select=${encodeURIComponent(INTUNE_MANAGED_DEVICE_SELECT.join(","))}&$top=100&$skiptoken=%20`,
  ],
] as const) {
  Deno.test(`Intune graph rejects a continuation with ${label}`, async () => {
    const fakeFetch: typeof fetch = async (input) => {
      if (String(input).includes("/token")) {
        return Response.json({ access_token: "token-value" });
      }
      return Response.json({ value: [], "@odata.nextLink": continuation });
    };
    const token = await requestIntuneGraphAccessToken(
      TENANT_ID,
      credentials,
      fakeFetch,
    );
    try {
      await readIntuneManagedDevices(token, async () => {}, fakeFetch);
    } catch (error) {
      if (
        error instanceof IntuneGraphError &&
        error.code === "provider_payload_invalid"
      ) {
        return;
      }
      throw error;
    }
    throw new Error(`A continuation with ${label} was accepted.`);
  });
}
