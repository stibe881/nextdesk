import { assert, assertEquals } from "jsr:@std/assert@1";

import {
  actionErrorStatus,
  handleAction,
  parseAction,
  requiresConfirmation,
  type Action,
  type RunDependencies,
} from "./index.ts";

const tenantId = "00000000-0000-4000-8000-000000000001";
const ticketId = "00000000-0000-4000-8000-000000000002";
const assetId = "00000000-0000-4000-8000-000000000003";
const departmentId = "00000000-0000-4000-8000-000000000004";
const actorId = "00000000-0000-4000-8000-000000000005";
const actionId = "00000000-0000-4000-8000-000000000006";
const entraTenant = "11111111-1111-4111-8111-111111111111";
const managedDeviceId = "aaaaaaaa-1111-4222-8333-444444444444";

type Row = Record<string, unknown>;

/** Minimal PostgREST-like query builder: every filter returns itself. */
function query(result: { data: unknown; error: unknown }) {
  const builder: Row = {};
  for (const method of ["select", "eq", "in", "is", "limit", "order"]) {
    builder[method] = () => builder;
  }
  builder.maybeSingle = () => Promise.resolve(result);
  builder.then = (resolve: (value: unknown) => unknown) =>
    Promise.resolve(result).then(resolve);
  return builder;
}

type RpcCall = { name: string; args: Row };

function fakeClients(options: {
  permission?: boolean;
  operatingSystem?: string;
  linkedToTicket?: boolean;
}) {
  const rpcCalls: RpcCall[] = [];
  const client = {
    rpc: (name: string, args: Row) => {
      rpcCalls.push({ name, args });
      if (name === "has_tenant_permission") {
        return Promise.resolve({
          data: options.permission ?? true,
          error: null,
        });
      }
      if (name === "has_ticket_permission") {
        return Promise.resolve({ data: true, error: null });
      }
      return Promise.resolve({ data: null, error: { code: "XX000" } });
    },
    from: (table: string) => {
      if (table === "tickets") {
        return query({
          data: {
            id: ticketId,
            tenant_id: tenantId,
            department_id: departmentId,
            requester_id: null,
            affected_user_id: null,
            requester_contact_id: null,
          },
          error: null,
        });
      }
      if (table === "assets") {
        return query({
          data: [{ id: assetId, name: "NB-0042", asset_tag: "NB-0042" }],
          error: null,
        });
      }
      return query({ data: [], error: null });
    },
  };
  const admin = {
    rpc: (name: string, args: Row) => {
      rpcCalls.push({ name, args });
      if (name === "user_feature_states") {
        return Promise.resolve({
          data: { "assets.management": true },
          error: null,
        });
      }
      if (name === "intune_device_action_targets") {
        return Promise.resolve({
          data: [
            {
              asset_id: assetId,
              operating_system: options.operatingSystem ?? "Windows",
              connection_ready: true,
            },
          ],
          error: null,
        });
      }
      if (name === "begin_intune_device_action") {
        return Promise.resolve({
          data: [
            {
              action_id: actionId,
              entra_tenant_id: entraTenant,
              managed_device_id: managedDeviceId,
              operating_system: options.operatingSystem ?? "Windows",
            },
          ],
          error: null,
        });
      }
      if (name === "finish_intune_device_action") {
        return Promise.resolve({ data: [{ id: actionId }], error: null });
      }
      return Promise.resolve({ data: null, error: { code: "XX000" } });
    },
    from: (table: string) => {
      if (table === "tenant_feature_flags") {
        return query({
          data: [{ feature_key: "assets.management", enabled: true }],
          error: null,
        });
      }
      if (table === "ticket_assets") {
        return query({
          data: options.linkedToTicket === false ? [] : [{ asset_id: assetId }],
          error: null,
        });
      }
      return query({ data: [], error: null });
    },
  };
  return { client, admin, rpcCalls };
}

function graphFetch(
  graphResponse: () => Response,
  urls: string[] = [],
): typeof fetch {
  return (input) => {
    const url = String(input);
    urls.push(url);
    if (url.startsWith("https://login.microsoftonline.com/")) {
      return Promise.resolve(Response.json({ access_token: "opaque-token" }));
    }
    return Promise.resolve(graphResponse());
  };
}

function dependencies(fetchImpl: typeof fetch): RunDependencies {
  return {
    fetchImpl,
    credentials: { clientId: "id", clientSecret: "secret" },
  };
}

const request = new Request("https://example.test/intune-actions", {
  method: "POST",
});

function run(
  action: string,
  extra: Row = {},
): Extract<Action, { type: "runAction" }> {
  const parsed = parseAction({
    type: "runAction",
    tenantId,
    assetId,
    ticketId,
    action,
    ...extra,
  });
  if (!parsed || parsed.type !== "runAction") throw new Error("invalid");
  return parsed;
}

Deno.test("parseAction accepts only known actions and fields", () => {
  assertEquals(
    parseAction({ type: "listTicketDevices", tenantId, ticketId })?.type,
    "listTicketDevices",
  );
  assertEquals(
    parseAction({ type: "listAssetActions", tenantId, assetIds: [assetId] }),
    { type: "listAssetActions", tenantId, assetIds: [assetId] },
  );
  assertEquals(run("syncDevice").confirmed, false);
  assertEquals(run("rebootNow", { confirmed: true }).confirmed, true);
  assertEquals(
    parseAction({
      type: "runAction",
      tenantId,
      assetId,
      ticketId: null,
      action: "syncDevice",
    })?.type,
    "runAction",
  );
  assertEquals(
    parseAction({ type: "runAction", tenantId, assetId, action: "wipe" }),
    null,
  );
  assertEquals(
    parseAction({
      type: "runAction",
      tenantId,
      assetId,
      action: "syncDevice",
      managedDeviceId,
    }),
    null,
  );
  assertEquals(
    parseAction({
      type: "listAssetActions",
      tenantId,
      assetIds: Array.from({ length: 101 }, () => assetId),
    }),
    null,
  );
});

Deno.test("reboot, lock, passcode and LAPS need a confirmation", () => {
  assert(requiresConfirmation("rebootNow"));
  assert(requiresConfirmation("remoteLock"));
  assert(requiresConfirmation("resetPasscode"));
  assert(requiresConfirmation("rotateLocalAdminPassword"));
  assert(!requiresConfirmation("syncDevice"));
  assert(!requiresConfirmation("windowsDefenderScan"));
  assertEquals(actionErrorStatus("permission_missing"), 403);
  assertEquals(actionErrorStatus("rate_limited"), 429);
  assertEquals(actionErrorStatus("provider_unavailable"), 502);
});

Deno.test(
  "an unconfirmed reboot is refused before Graph is contacted",
  async () => {
    const { client, admin, rpcCalls } = fakeClients({});
    const urls: string[] = [];
    const result = await handleAction(
      request,
      client,
      admin,
      actorId,
      run("rebootNow"),
      dependencies(graphFetch(() => new Response(null, { status: 204 }), urls)),
    ).catch((error) => error);
    assertEquals(result.status, 428);
    assertEquals(result.code, "confirmation_required");
    assertEquals(urls.length, 0);
    assert(
      !rpcCalls.some((call) => call.name === "begin_intune_device_action"),
    );
  },
);

Deno.test("a missing permission stops every action", async () => {
  const { client, admin } = fakeClients({ permission: false });
  const result = await handleAction(
    request,
    client,
    admin,
    actorId,
    run("syncDevice"),
    dependencies(graphFetch(() => new Response(null, { status: 204 }))),
  ).catch((error) => error);
  assertEquals(result.status, 403);
  assertEquals(result.code, "intune_actions_permission_required");
});

Deno.test(
  "a successful Defender scan is logged with the Graph status",
  async () => {
    const { client, admin, rpcCalls } = fakeClients({});
    const urls: string[] = [];
    const response = await handleAction(
      request,
      client,
      admin,
      actorId,
      run("windowsDefenderScan"),
      dependencies(graphFetch(() => new Response(null, { status: 204 }), urls)),
    );
    assertEquals(response.status, 200);
    const body = await response.json();
    assertEquals(body.data.status, "succeeded");
    assertEquals(body.data.graphStatus, 204);
    assertEquals(
      urls[1],
      `https://graph.microsoft.com/v1.0/deviceManagement/managedDevices/${managedDeviceId}/windowsDefenderScan`,
    );
    const finish = rpcCalls.find(
      (call) => call.name === "finish_intune_device_action",
    );
    assertEquals(finish?.args, {
      p_tenant_id: tenantId,
      p_action_id: actionId,
      p_succeeded: true,
      p_graph_api_version: "v1.0",
      p_graph_status: 204,
      p_error_code: null,
    });
    const begin = rpcCalls.find(
      (call) => call.name === "begin_intune_device_action",
    );
    assertEquals(begin?.args.p_ticket_id, ticketId);
  },
);

Deno.test(
  "a Graph 403 is logged and returned as the German Entra message",
  async () => {
    const { client, admin, rpcCalls } = fakeClients({});
    const result = await handleAction(
      request,
      client,
      admin,
      actorId,
      run("syncDevice"),
      dependencies(
        graphFetch(() =>
          Response.json(
            { error: { code: "Forbidden", message: "Not authorized" } },
            { status: 403 },
          ),
        ),
      ),
    ).catch((error) => error);
    assertEquals(result.status, 403);
    assertEquals(result.code, "intune_permission_missing");
    assertEquals(
      result.message,
      "In Entra fehlt die Berechtigung DeviceManagementManagedDevices.PrivilegedOperations.All.",
    );
    const finish = rpcCalls.find(
      (call) => call.name === "finish_intune_device_action",
    );
    assertEquals(finish?.args.p_succeeded, false);
    assertEquals(finish?.args.p_graph_status, 403);
    assertEquals(finish?.args.p_error_code, "permission_missing");
  },
);

Deno.test("a passcode reset is not offered for Windows devices", async () => {
  const { client, admin, rpcCalls } = fakeClients({});
  const result = await handleAction(
    request,
    client,
    admin,
    actorId,
    run("resetPasscode", { confirmed: true }),
    dependencies(graphFetch(() => new Response(null, { status: 204 }))),
  ).catch((error) => error);
  assertEquals(result.status, 422);
  assertEquals(result.code, "intune_action_not_supported");
  assert(!rpcCalls.some((call) => call.name === "begin_intune_device_action"));
});

Deno.test(
  "a device that does not belong to the ticket is refused",
  async () => {
    const { client, admin } = fakeClients({ linkedToTicket: false });
    const result = await handleAction(
      request,
      client,
      admin,
      actorId,
      run("syncDevice"),
      dependencies(graphFetch(() => new Response(null, { status: 204 }))),
    ).catch((error) => error);
    assertEquals(result.status, 404);
    assertEquals(result.code, "intune_device_not_found");
  },
);

Deno.test(
  "missing server credentials are logged as provider_not_configured",
  async () => {
    const { client, admin, rpcCalls } = fakeClients({ operatingSystem: "iOS" });
    const result = await handleAction(
      request,
      client,
      admin,
      actorId,
      run("remoteLock", { confirmed: true }),
      {
        fetchImpl: () => Promise.reject(new Error("no network expected")),
        credentials: null,
      },
    ).catch((error) => error);
    assertEquals(result.status, 409);
    const finish = rpcCalls.find(
      (call) => call.name === "finish_intune_device_action",
    );
    assertEquals(finish?.args.p_error_code, "provider_not_configured");
    assertEquals(finish?.args.p_graph_status, null);
  },
);

Deno.test(
  "listTicketDevices returns platform actions without device IDs",
  async () => {
    const { client, admin } = fakeClients({ operatingSystem: "Android" });
    const response = await handleAction(
      request,
      client,
      admin,
      actorId,
      { type: "listTicketDevices", tenantId, ticketId },
      dependencies(graphFetch(() => new Response(null, { status: 204 }))),
    );
    const body = await response.json();
    assertEquals(body.data.connectionReady, true);
    assertEquals(body.data.devices, [
      {
        assetId,
        name: "NB-0042",
        assetTag: "NB-0042",
        operatingSystem: "Android",
        platform: "android",
        actions: ["syncDevice", "remoteLock", "resetPasscode"],
        confirmationRequired: ["remoteLock", "resetPasscode"],
      },
    ]);
    assert(!JSON.stringify(body).includes(managedDeviceId));
  },
);

Deno.test(
  "the endpoint keeps provider IDs and secrets server-side",
  async () => {
    const source = await Deno.readTextFile(
      new URL("./index.ts", import.meta.url),
    );
    for (const forbidden of [
      'client\n    .from("asset_intune_asset_links")',
      "INTUNE_MANAGED_DEVICES_CLIENT_SECRET",
      "console.log",
    ]) {
      assert(!source.includes(forbidden), forbidden);
    }
    assert(source.includes('auth: "user"'));
  },
);
