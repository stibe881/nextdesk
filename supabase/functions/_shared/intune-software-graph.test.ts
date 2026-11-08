import {
  addGroupMember,
  deploySoftware,
  getEntraGroup,
  isAlreadyMemberResponse,
  listIntuneMobileApps,
  SoftwareDeployError,
  softwareStatusLabel,
} from "./intune-software-graph.ts";

const APP = "11111111-1111-4111-8111-111111111111";
const GROUP = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";
const AZURE_DEVICE = "44444444-4444-4444-8444-444444444444";
const DEVICE_OBJECT = "55555555-5555-4555-8555-555555555555";

type Call = { url: string; method: string; body: string | null };

function mockFetch(responder: (call: Call) => Response): {
  fetch: typeof fetch;
  calls: Call[];
} {
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

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function rejectsWith(
  promise: Promise<unknown>,
  code: string,
): Promise<void> {
  try {
    await promise;
  } catch (error) {
    assert(
      error instanceof SoftwareDeployError && error.code === code,
      `expected ${code}, got ${String((error as Error).message)}`,
    );
    return;
  }
  throw new Error(`expected ${code}, but the call succeeded`);
}

Deno.test("addGroupMember posts a directoryObject reference", async () => {
  const mock = mockFetch(() => new Response(null, { status: 204 }));
  const added = await addGroupMember("token", GROUP, USER, mock.fetch);
  assert(added === true, "member should be added");
  assert(
    mock.calls[0].url ===
      `https://graph.microsoft.com/v1.0/groups/${GROUP}/members/$ref`,
    "wrong URL",
  );
  assert(mock.calls[0].method === "POST", "wrong method");
  assert(
    JSON.parse(mock.calls[0].body ?? "{}")["@odata.id"] ===
      `https://graph.microsoft.com/v1.0/directoryObjects/${USER}`,
    "wrong body",
  );
});

Deno.test(
  "addGroupMember treats an existing membership as success",
  async () => {
    const mock = mockFetch(() =>
      json(
        {
          error: {
            code: "Request_BadRequest",
            message:
              "One or more added object references already exist for the following modified properties: 'members'.",
          },
        },
        400,
      ),
    );
    assert(
      (await addGroupMember("token", GROUP, USER, mock.fetch)) === false,
      "existing member should return false",
    );
    assert(
      isAlreadyMemberResponse(400, { error: { message: "already exist" } }),
      "detector",
    );
    assert(!isAlreadyMemberResponse(403, {}), "403 is no membership");
  },
);

Deno.test(
  "addGroupMember maps permission and missing group errors",
  async () => {
    await rejectsWith(
      addGroupMember(
        "token",
        GROUP,
        USER,
        mockFetch(() =>
          json({ error: { code: "Authorization_RequestDenied" } }, 403),
        ).fetch,
      ),
      "permission_missing",
    );
    await rejectsWith(
      addGroupMember(
        "token",
        GROUP,
        USER,
        mockFetch(() => json({}, 404)).fetch,
      ),
      "group_not_found",
    );
    await rejectsWith(
      addGroupMember(
        "token",
        "not-a-guid",
        USER,
        mockFetch(() => json({})).fetch,
      ),
      "invalid_request",
    );
  },
);

Deno.test("deploySoftware adds the user to the group", async () => {
  const mock = mockFetch(() => new Response(null, { status: 204 }));
  const result = await deploySoftware(
    {
      appId: APP,
      mode: "user_group",
      groupId: GROUP,
      ensureAppAssignment: false,
      userObjectId: USER,
    },
    "token",
    mock.fetch,
  );
  assert(result.membersAdded === 1, "one member");
  assert(result.memberIds[0] === USER, "user is the member");
  assert(mock.calls.length === 1, "only one Graph call");
});

Deno.test("deploySoftware without an Entra account fails early", async () => {
  const mock = mockFetch(() => json({}));
  await rejectsWith(
    deploySoftware(
      {
        appId: APP,
        mode: "user_group",
        groupId: GROUP,
        ensureAppAssignment: false,
        userObjectId: null,
      },
      "token",
      mock.fetch,
    ),
    "user_not_linked",
  );
  assert(mock.calls.length === 0, "no Graph call");
});

Deno.test(
  "deploySoftware device_group adds the user's Entra devices",
  async () => {
    const mock = mockFetch((call) => {
      if (call.url.includes("/deviceManagement/managedDevices")) {
        assert(
          decodeURIComponent(call.url).includes(`userId eq '${USER}'`),
          "filters by user",
        );
        return json({
          value: [
            { id: "md-1", azureADDeviceId: AZURE_DEVICE },
            {
              id: "md-2",
              azureADDeviceId: "00000000-0000-0000-0000-000000000000",
            },
          ],
        });
      }
      if (call.url.includes("/devices?")) {
        assert(
          decodeURIComponent(call.url).includes(
            `deviceId eq '${AZURE_DEVICE}'`,
          ),
          "looks up by deviceId",
        );
        return json({ value: [{ id: DEVICE_OBJECT }] });
      }
      return new Response(null, { status: 204 });
    });
    const result = await deploySoftware(
      {
        appId: APP,
        mode: "device_group",
        groupId: GROUP,
        ensureAppAssignment: false,
        userObjectId: USER,
      },
      "token",
      mock.fetch,
    );
    assert(result.memberIds.join() === DEVICE_OBJECT, "device object added");
    const post = mock.calls.find((call) => call.method === "POST");
    assert(post?.body?.includes(DEVICE_OBJECT), "device posted to group");
  },
);

Deno.test("deploySoftware device_group without devices fails", async () => {
  await rejectsWith(
    deploySoftware(
      {
        appId: APP,
        mode: "device_group",
        groupId: GROUP,
        ensureAppAssignment: false,
        userObjectId: USER,
      },
      "token",
      mockFetch(() => json({ value: [] })).fetch,
    ),
    "no_managed_device",
  );
});

Deno.test(
  "deploySoftware creates the app assignment when it is missing",
  async () => {
    const mock = mockFetch((call) => {
      if (call.url.endsWith("/assignments") && call.method === "GET") {
        return json({
          value: [
            { target: { groupId: "99999999-9999-4999-8999-999999999999" } },
          ],
        });
      }
      if (call.url.endsWith("/assignments") && call.method === "POST") {
        return json({ id: "assignment" }, 201);
      }
      return new Response(null, { status: 204 });
    });
    const result = await deploySoftware(
      {
        appId: APP,
        mode: "user_group",
        groupId: GROUP,
        ensureAppAssignment: true,
        userObjectId: USER,
      },
      "token",
      mock.fetch,
    );
    assert(result.appAssignmentCreated, "assignment created");
    const created = mock.calls.find(
      (call) => call.method === "POST" && call.url.endsWith("/assignments"),
    );
    const body = JSON.parse(created?.body ?? "{}");
    assert(body.intent === "required", "required intent");
    assert(body.target.groupId === GROUP, "targets the group");
    assert(
      body.target["@odata.type"] === "#microsoft.graph.groupAssignmentTarget",
      "group target",
    );
  },
);

Deno.test("deploySoftware keeps an existing app assignment", async () => {
  const mock = mockFetch((call) =>
    call.url.endsWith("/assignments")
      ? json({ value: [{ target: { groupId: GROUP.toUpperCase() } }] })
      : new Response(null, { status: 204 }),
  );
  const result = await deploySoftware(
    {
      appId: APP,
      mode: "user_group",
      groupId: GROUP,
      ensureAppAssignment: true,
      userObjectId: USER,
    },
    "token",
    mock.fetch,
  );
  assert(!result.appAssignmentCreated, "no new assignment");
  assert(
    !mock.calls.some(
      (call) => call.method === "POST" && call.url.endsWith("/assignments"),
    ),
    "no assignment POST",
  );
});

Deno.test(
  "listIntuneMobileApps follows nextLink and selects fields",
  async () => {
    const mock = mockFetch((call) => {
      if (!call.url.includes("skiptoken")) {
        assert(
          decodeURIComponent(call.url).includes(
            "$select=id,displayName,publisher,isAssigned",
          ),
          "uses $select",
        );
        return json({
          value: [
            {
              "@odata.type": "#microsoft.graph.win32LobApp",
              id: APP,
              displayName: "Visio",
              publisher: "Microsoft",
              isAssigned: true,
            },
          ],
          "@odata.nextLink":
            "https://graph.microsoft.com/v1.0/deviceAppManagement/mobileApps?$skiptoken=abc",
        });
      }
      return json({
        value: [
          { id: GROUP, displayName: "Adobe Reader" },
          { id: "bad", displayName: "Ignored" },
        ],
      });
    });
    const apps = await listIntuneMobileApps("token", mock.fetch);
    assert(apps.length === 2, "two valid apps");
    assert(apps[0].displayName === "Adobe Reader", "sorted by name");
    assert(apps[1].appType === "win32LobApp", "app type");
    assert(mock.calls.length === 2, "two pages");
  },
);

Deno.test("listIntuneMobileApps refuses foreign nextLinks", async () => {
  await rejectsWith(
    listIntuneMobileApps(
      "token",
      mockFetch(() =>
        json({ value: [], "@odata.nextLink": "https://evil.example/next" }),
      ).fetch,
    ),
    "provider_unavailable",
  );
});

Deno.test("getEntraGroup returns the group name", async () => {
  const group = await getEntraGroup(
    "token",
    GROUP,
    mockFetch(() =>
      json({ id: GROUP, displayName: "SW-Visio", securityEnabled: true }),
    ).fetch,
  );
  assert(group.displayName === "SW-Visio" && group.securityEnabled, "group");
});

Deno.test("softwareStatusLabel uses the three order states", () => {
  assert(softwareStatusLabel("pending") === "Wird installiert", "pending");
  assert(
    softwareStatusLabel("installing") === "Wird installiert",
    "installing",
  );
  assert(softwareStatusLabel("assigned") === "Zugewiesen", "assigned");
  assert(softwareStatusLabel("failed") === "Fehler", "failed");
});
