import {
  EntraLicenseError,
  fetchSignInActivity,
  latestSignIn,
  mapSignInFailure,
  monthlySeatCost,
  removeUserLicense,
  savingsByCurrency,
} from "./entra-license-graph.ts";

const USER = "33333333-3333-4333-8333-333333333333";
const SKU = "6fd2c87f-b296-42f0-b197-1e91e994b900";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

type Call = { url: string; method: string; body: string | null };

function mockFetch(responder: (call: Call) => Response) {
  const calls: Call[] = [];
  const impl = (input: RequestInfo | URL, init?: RequestInit) => {
    const call = {
      url: String(input),
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : null,
    };
    calls.push(call);
    return Promise.resolve(responder(call));
  };
  return { fetch: impl as typeof fetch, calls };
}

async function rejectsWith(promise: Promise<unknown>, code: string) {
  try {
    await promise;
  } catch (error) {
    assert(
      error instanceof EntraLicenseError && error.code === code,
      `expected ${code}, got ${(error as Error).message}`,
    );
    return;
  }
  throw new Error(`expected ${code}`);
}

Deno.test("latestSignIn takes the newest sign-in and ignores «never»", () => {
  assert(
    latestSignIn({
      lastSignInDateTime: "2026-09-01T08:00:00Z",
      lastNonInteractiveSignInDateTime: "2026-10-15T08:00:00Z",
    }) === "2026-10-15T08:00:00.000Z",
    "newest wins",
  );
  assert(
    latestSignIn({ lastSignInDateTime: "0001-01-01T00:00:00Z" }) === null,
    "never",
  );
  assert(latestSignIn(null) === null, "missing activity");
});

Deno.test("fetchSignInActivity pages through all users", async () => {
  const mock = mockFetch((call) => {
    if (!call.url.includes("skiptoken")) {
      assert(
        decodeURIComponent(call.url).includes(
          "$select=id,accountEnabled,signInActivity",
        ),
        "selects signInActivity",
      );
      return json({
        value: [
          {
            id: USER,
            accountEnabled: false,
            signInActivity: { lastSignInDateTime: "2026-08-01T10:00:00Z" },
          },
          { id: "not-a-guid" },
        ],
        "@odata.nextLink":
          "https://graph.microsoft.com/v1.0/users?$skiptoken=next",
      });
    }
    return json({
      value: [{ id: SKU, accountEnabled: true, signInActivity: null }],
    });
  });
  const rows = await fetchSignInActivity("token", mock.fetch);
  assert(rows.length === 2, "two users");
  assert(rows[0].account_enabled === false, "account state");
  assert(rows[0].last_sign_in_at === "2026-08-01T10:00:00.000Z", "date");
  assert(rows[1].last_sign_in_at === null, "no activity");
});

Deno.test(
  "fetchSignInActivity reports missing permission and premium",
  async () => {
    await rejectsWith(
      fetchSignInActivity(
        "token",
        mockFetch(() =>
          json(
            {
              error: {
                code: "Authorization_RequestDenied",
                message: "Insufficient privileges",
              },
            },
            403,
          ),
        ).fetch,
      ),
      "permission_missing",
    );
    assert(
      mapSignInFailure(403, {
        error: {
          code: "Authentication_RequestFromNonPremiumTenantOrB2CTenant",
          message:
            "Neither tenant is B2C or tenant doesn't have premium license",
        },
      }) === "premium_required",
      "premium",
    );
  },
);

Deno.test("removeUserLicense removes exactly the SKU", async () => {
  const mock = mockFetch(() => json({ id: USER }));
  await removeUserLicense("token", USER, SKU, mock.fetch);
  assert(
    mock.calls[0].url ===
      `https://graph.microsoft.com/v1.0/users/${USER}/assignLicense`,
    "assignLicense URL",
  );
  const body = JSON.parse(mock.calls[0].body ?? "{}");
  assert(
    Array.isArray(body.addLicenses) && body.addLicenses.length === 0,
    "adds nothing",
  );
  assert(body.removeLicenses[0] === SKU, "removes the SKU");
});

Deno.test("removeUserLicense distinguishes an unassigned license", async () => {
  await rejectsWith(
    removeUserLicense(
      "token",
      USER,
      SKU,
      mockFetch(() =>
        json(
          {
            error: {
              code: "Request_BadRequest",
              message: "User does not have a corresponding license.",
            },
          },
          400,
        ),
      ).fetch,
    ),
    "license_not_assigned",
  );
  await rejectsWith(
    removeUserLicense("token", USER, SKU, mockFetch(() => json({}, 403)).fetch),
    "permission_missing",
  );
  await rejectsWith(
    removeUserLicense("token", "x", SKU, mockFetch(() => json({})).fetch),
    "invalid_request",
  );
});

Deno.test("monthlySeatCost normalizes the period", () => {
  assert(monthlySeatCost(120, "yearly") === 10, "yearly");
  assert(monthlySeatCost(30, "quarterly") === 10, "quarterly");
  assert(monthlySeatCost(12.5, "monthly") === 12.5, "monthly");
  assert(monthlySeatCost(500, "one_time") === 0, "one time");
  assert(monthlySeatCost(null, "monthly") === null, "unknown");
});

Deno.test("savingsByCurrency sums per currency", () => {
  const totals = savingsByCurrency([
    { monthlySaving: 10.1, currency: "CHF" },
    { monthlySaving: 0.2, currency: "CHF" },
    { monthlySaving: 5, currency: "EUR" },
    { monthlySaving: null, currency: "USD" },
  ]);
  assert(totals.CHF === 10.3, `CHF ${totals.CHF}`);
  assert(totals.EUR === 5, "EUR");
  assert(!("USD" in totals), "unknown costs are left out");
});
