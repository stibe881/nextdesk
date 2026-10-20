import {
  DIRECTORY_CONNECTION_TEST_PATH,
  EntraDirectoryGraphError,
  graphUsers,
  testEntraDirectoryConnection,
} from "./entra-directory-graph.ts";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function expectGraphFailure(operation: () => Promise<unknown>) {
  try {
    await operation();
  } catch (error) {
    assert(
      error instanceof EntraDirectoryGraphError,
      "The helper must expose only a generic graph error",
    );
    return;
  }
  throw new Error("The graph helper unexpectedly succeeded");
}

Deno.test(
  "Entra connection test uses only the fixed count endpoint",
  async () => {
    const previousClientId = Deno.env.get("ENTRA_DIRECTORY_CLIENT_ID");
    const previousClientSecret = Deno.env.get("ENTRA_DIRECTORY_CLIENT_SECRET");
    Deno.env.set("ENTRA_DIRECTORY_CLIENT_ID", "test-client-id");
    Deno.env.set("ENTRA_DIRECTORY_CLIENT_SECRET", "test-client-secret");

    const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, init });
      if (
        url ===
        `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`
      ) {
        return new Response(JSON.stringify({ access_token: "token-value" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (
        url === `https://graph.microsoft.com${DIRECTORY_CONNECTION_TEST_PATH}`
      ) {
        return new Response("42", { status: 200 });
      }
      throw new Error("Unexpected request");
    }) as typeof fetch;

    try {
      await testEntraDirectoryConnection(TENANT_ID, fetcher);
      assert(
        requests.length === 2,
        "Expected exactly token and count requests",
      );
      assert(
        requests[1]?.url === "https://graph.microsoft.com/v1.0/users/$count",
        "Connection test must use the fixed count endpoint rather than a user collection request",
      );
      assert(
        new Headers(requests[1]?.init?.headers).get("ConsistencyLevel") ===
          "eventual",
        "Count endpoint requires the eventual consistency header",
      );
      assert(
        new Headers(requests[1]?.init?.headers).get("Authorization") ===
          "Bearer token-value",
        "Graph request must use only the token acquired for the bound tenant",
      );
      assert(
        requests[1]?.init?.redirect === "error",
        "Graph redirects must be rejected",
      );
    } finally {
      if (previousClientId === undefined)
        Deno.env.delete("ENTRA_DIRECTORY_CLIENT_ID");
      else Deno.env.set("ENTRA_DIRECTORY_CLIENT_ID", previousClientId);
      if (previousClientSecret === undefined)
        Deno.env.delete("ENTRA_DIRECTORY_CLIENT_SECRET");
      else Deno.env.set("ENTRA_DIRECTORY_CLIENT_SECRET", previousClientSecret);
    }
  },
);

Deno.test(
  "Entra connection test rejects invalid tenant IDs and malformed count replies",
  async () => {
    await expectGraphFailure(() =>
      testEntraDirectoryConnection("not-a-tenant-id", fetch),
    );

    const previousClientId = Deno.env.get("ENTRA_DIRECTORY_CLIENT_ID");
    const previousClientSecret = Deno.env.get("ENTRA_DIRECTORY_CLIENT_SECRET");
    Deno.env.set("ENTRA_DIRECTORY_CLIENT_ID", "test-client-id");
    Deno.env.set("ENTRA_DIRECTORY_CLIENT_SECRET", "test-client-secret");
    const fetcher = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/oauth2/v2.0/token")) {
        return new Response(JSON.stringify({ access_token: "token-value" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("not-a-count", { status: 200 });
    }) as typeof fetch;

    try {
      await expectGraphFailure(() =>
        testEntraDirectoryConnection(TENANT_ID, fetcher),
      );
    } finally {
      if (previousClientId === undefined)
        Deno.env.delete("ENTRA_DIRECTORY_CLIENT_ID");
      else Deno.env.set("ENTRA_DIRECTORY_CLIENT_ID", previousClientId);
      if (previousClientSecret === undefined)
        Deno.env.delete("ENTRA_DIRECTORY_CLIENT_SECRET");
      else Deno.env.set("ENTRA_DIRECTORY_CLIENT_SECRET", previousClientSecret);
    }
  },
);

Deno.test(
  "Entra user paging renews the caller fence after every Graph page",
  async () => {
    const requestedUrls: string[] = [];
    const fetcher = (async (input: RequestInfo | URL) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url.includes("$skiptoken=")) {
        return new Response(JSON.stringify({ value: [{ id: "second" }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({
          value: [{ id: "first" }],
          "@odata.nextLink":
            "https://graph.microsoft.com/v1.0/users?$skiptoken=next-page",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;
    let heartbeatCount = 0;

    const users = await graphUsers(
      "non-sensitive-test-token",
      fetcher,
      async () => {
        heartbeatCount += 1;
      },
    );

    assert(users.length === 2, "Both Graph pages should be collected");
    assert(
      heartbeatCount === 2,
      "Each received Graph page must renew the fence",
    );
    assert(
      requestedUrls.every((url) =>
        url.startsWith("https://graph.microsoft.com/v1.0/users"),
      ),
      "Graph paging must remain constrained to the fixed user endpoint",
    );
  },
);
