import {
  parseSoftwareLink,
  runSoftwareDeployments,
  softwareColumns,
  softwareFromRow,
} from "./software.ts";

const TENANT = "10000000-0000-4000-8000-000000000001";
const ENTRA_TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORDER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const APP = "11111111-1111-4111-8111-111111111111";
const GROUP = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";
const DEPLOYMENT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("parseSoftwareLink validates the Intune link", () => {
  assert(parseSoftwareLink(undefined) === undefined, "not sent");
  assert(parseSoftwareLink(null) === null, "cleared");
  assert(
    parseSoftwareLink({ appId: "x", groupId: GROUP }) === false,
    "bad app",
  );
  assert(
    parseSoftwareLink({ appId: APP, groupId: GROUP, mode: "other" }) === false,
    "bad mode",
  );
  const link = parseSoftwareLink({
    appId: APP.toUpperCase(),
    groupId: GROUP,
    appName: "  Visio ",
  });
  assert(link && link.appId === APP, "lower-cased app id");
  assert(link && link.mode === "user_group", "default mode");
  assert(link && link.appName === "Visio", "trimmed name");
  assert(link && link.ensureAppAssignment === false, "default no assignment");
  assert(
    softwareColumns(null).intune_app_id === null &&
      softwareColumns(null).intune_ensure_app_assignment === false,
    "clearing columns",
  );
  const row = softwareColumns(link || null);
  assert(softwareFromRow(row)?.groupId === GROUP, "round trip");
});

type RpcCall = { name: string; args: Record<string, unknown> };

function mockAdmin(claimed: Record<string, unknown>[]) {
  const rpcCalls: RpcCall[] = [];
  return {
    rpcCalls,
    admin: {
      rpc(name: string, args: Record<string, unknown>) {
        rpcCalls.push({ name, args });
        if (name === "shop_software_deployments_claim") {
          return Promise.resolve({ data: claimed, error: null });
        }
        if (name === "intune_device_action_entra_tenant") {
          return Promise.resolve({ data: ENTRA_TENANT, error: null });
        }
        return Promise.resolve({ data: "assigned", error: null });
      },
    },
  };
}

const claimedRow = (entraObjectId: string | null) => ({
  deployment_id: DEPLOYMENT,
  order_line_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  requester_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  intune_app_id: APP,
  app_name: "Visio",
  assignment_mode: "user_group",
  target_group_id: GROUP,
  ensure_app_assignment: false,
  entra_object_id: entraObjectId,
  attempts: 1,
});

Deno.test("runSoftwareDeployments assigns and records the result", async () => {
  const { admin, rpcCalls } = mockAdmin([claimedRow(USER)]);
  const urls: string[] = [];
  const fetchImpl = ((input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    if (url.startsWith("https://login.microsoftonline.com/")) {
      assert(url.includes(ENTRA_TENANT), "token for the customer tenant");
      return Promise.resolve(
        new Response(JSON.stringify({ access_token: "token" }), {
          status: 200,
        }),
      );
    }
    return Promise.resolve(new Response(null, { status: 204 }));
  }) as typeof fetch;
  const outcomes = await runSoftwareDeployments(admin, TENANT, ORDER, {
    fetchImpl,
    credentials: { clientId: "id", clientSecret: "secret" },
  });
  assert(
    outcomes.length === 1 && outcomes[0].status === "assigned",
    "assigned",
  );
  assert(
    urls.some((url) => url.endsWith(`/groups/${GROUP}/members/$ref`)),
    "group membership added",
  );
  const record = rpcCalls.find(
    (call) => call.name === "shop_software_deployment_record",
  );
  assert(record?.args.p_success === true, "success recorded");
  assert(record?.args.p_members_added === 1, "member count recorded");
  assert(record?.args.p_entra_object_id === USER, "object id recorded");
});

Deno.test(
  "runSoftwareDeployments records a failure without Entra account",
  async () => {
    const { admin, rpcCalls } = mockAdmin([claimedRow(null)]);
    const fetchImpl = (() =>
      Promise.resolve(
        new Response(JSON.stringify({ access_token: "token" }), {
          status: 200,
        }),
      )) as typeof fetch;
    const outcomes = await runSoftwareDeployments(admin, TENANT, ORDER, {
      fetchImpl,
      credentials: { clientId: "id", clientSecret: "secret" },
    });
    assert(outcomes[0].errorCode === "user_not_linked", "user not linked");
    const record = rpcCalls.find(
      (call) => call.name === "shop_software_deployment_record",
    );
    assert(record?.args.p_success === false, "failure recorded");
    assert(
      typeof record?.args.p_error_message === "string" &&
        record.args.p_error_message.includes("Entra-Konto"),
      "German message",
    );
  },
);

Deno.test(
  "runSoftwareDeployments without Intune credentials fails every deployment",
  async () => {
    const { admin, rpcCalls } = mockAdmin([
      claimedRow(USER),
      {
        ...claimedRow(USER),
        deployment_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      },
    ]);
    let fetched = false;
    const outcomes = await runSoftwareDeployments(admin, TENANT, ORDER, {
      fetchImpl: (() => {
        fetched = true;
        return Promise.resolve(new Response(null, { status: 500 }));
      }) as typeof fetch,
      credentials: null,
    });
    assert(!fetched, "no Graph call without credentials");
    assert(
      outcomes.every(
        (outcome) => outcome.errorCode === "provider_not_configured",
      ),
      "not configured",
    );
    assert(
      rpcCalls.filter((call) => call.name === "shop_software_deployment_record")
        .length === 2,
      "both recorded",
    );
  },
);

Deno.test("runSoftwareDeployments maps missing consent", async () => {
  const { admin } = mockAdmin([claimedRow(USER)]);
  const outcomes = await runSoftwareDeployments(admin, TENANT, ORDER, {
    fetchImpl: (() =>
      Promise.resolve(new Response("{}", { status: 401 }))) as typeof fetch,
    credentials: { clientId: "id", clientSecret: "secret" },
  });
  assert(outcomes[0].errorCode === "consent_missing", "consent missing");
});

Deno.test(
  "runSoftwareDeployments does nothing without claimed rows",
  async () => {
    const { admin, rpcCalls } = mockAdmin([]);
    const outcomes = await runSoftwareDeployments(admin, TENANT, ORDER, {
      credentials: { clientId: "id", clientSecret: "secret" },
    });
    assert(outcomes.length === 0, "nothing deployed");
    assert(rpcCalls.length === 1, "only the claim");
  },
);
