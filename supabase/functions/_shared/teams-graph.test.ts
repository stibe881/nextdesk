import { assertEquals, assertRejects } from "jsr:@std/assert@1";

import {
  archiveTeam,
  createTeam,
  finishTeam,
  parseTeamLocation,
  teamCreationStatus,
  TeamsGraphError,
} from "./teams-graph.ts";

const TEAM = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OP = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OWNER = "11111111-1111-4111-8111-111111111111";
const MEMBER = "22222222-2222-4222-8222-222222222222";

type Call = { method: string; url: string; body: unknown };

function fakeFetch(
  responses: (call: Call) => Response,
): { fetcher: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetcher = ((url: string, init: RequestInit) => {
    const entry = {
      method: String(init.method),
      url: String(url),
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(entry);
    return Promise.resolve(responses(entry));
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}

Deno.test("parses team id and operation from the 202 headers", () => {
  assertEquals(
    parseTeamLocation(`/teams('${TEAM}')`, `/teams('${TEAM}')/operations('${OP}')`),
    { teamId: TEAM, operation: OP },
  );
  assertEquals(parseTeamLocation(null, null), null);
});

Deno.test("createTeam sends owners with the owner role and reads the ids", async () => {
  const { fetcher, calls } = fakeFetch(
    () =>
      new Response(null, {
        status: 202,
        headers: {
          "Content-Location": `/teams('${TEAM}')`,
          Location: `/teams('${TEAM}')/operations('${OP}')`,
        },
      }),
  );
  const result = await createTeam(
    "token",
    {
      name: "Projekt",
      description: null,
      visibility: "private",
      owners: [OWNER],
      members: [MEMBER],
    },
    fetcher,
  );
  assertEquals(result, { teamId: TEAM, operation: OP });
  const body = calls[0]!.body as {
    visibility: string;
    members: { roles: string[]; "user@odata.bind": string }[];
  };
  assertEquals(body.visibility, "Private");
  assertEquals(body.members[0]!.roles, ["owner"]);
  assertEquals(body.members[1]!.roles, []);
  assertEquals(calls[0]!.url, "https://graph.microsoft.com/v1.0/teams");
});

Deno.test("403 means the consent is missing", async () => {
  const { fetcher } = fakeFetch(() => new Response("{}", { status: 403 }));
  const error = await assertRejects(
    () =>
      createTeam(
        "token",
        { name: "x", description: null, visibility: "public", owners: [OWNER], members: [] },
        fetcher,
      ),
    TeamsGraphError,
  );
  assertEquals((error as TeamsGraphError).code, "consent_missing");
});

Deno.test("creation status follows the operation", async () => {
  const run = async (status: string) => {
    const { fetcher } = fakeFetch(
      () => new Response(JSON.stringify({ status }), { status: 200 }),
    );
    return await teamCreationStatus("t", TEAM, OP, fetcher);
  };
  assertEquals(await run("succeeded"), "succeeded");
  assertEquals(await run("inProgress"), "inProgress");
  assertEquals(await run("failed"), "failed");
});

Deno.test("finishTeam creates channels and website tabs; a failed tab is a warning", async () => {
  const { fetcher, calls } = fakeFetch((call) => {
    if (call.url.endsWith("/channels")) {
      return new Response(JSON.stringify({ id: "channel-1" }), { status: 201 });
    }
    if (call.url.endsWith("/tabs")) return new Response("{}", { status: 400 });
    return new Response("{}", { status: 200 });
  });
  const warnings = await finishTeam(
    "t",
    TEAM,
    {
      owners: [OWNER],
      guests: [],
      allowGuests: false,
      channels: [
        {
          name: "Bauleitung",
          isPrivate: true,
          tabs: [{ type: "website", title: "Kamera", url: "https://x.ch/" }],
        },
      ],
    },
    fetcher,
  );
  assertEquals(warnings, [{ step: "tab:Bauleitung:Kamera", code: "invalid" }]);
  const channel = calls[0]!.body as { membershipType: string; members: unknown[] };
  assertEquals(channel.membershipType, "private");
  assertEquals(channel.members.length, 1);
});

Deno.test("finishTeam reuses an existing channel on conflict", async () => {
  const { fetcher, calls } = fakeFetch((call) => {
    if (call.method === "POST" && call.url.endsWith("/channels")) {
      return new Response("{}", { status: 409 });
    }
    if (call.method === "GET") {
      return new Response(
        JSON.stringify({ value: [{ id: "channel-9", displayName: "planung" }] }),
        { status: 200 },
      );
    }
    return new Response("{}", { status: 201 });
  });
  const warnings = await finishTeam(
    "t",
    TEAM,
    {
      owners: [OWNER],
      guests: [],
      allowGuests: false,
      channels: [
        { name: "Planung", isPrivate: false, tabs: [{ type: "website", title: "A", url: "https://x.ch/" }] },
      ],
    },
    fetcher,
  );
  assertEquals(warnings, []);
  assertEquals(calls.at(-1)!.url.includes("/channels/channel-9/tabs"), true);
});

Deno.test("archiveTeam treats an already archived team as done", async () => {
  const { fetcher } = fakeFetch(() => new Response("{}", { status: 409 }));
  await archiveTeam("t", TEAM, fetcher);
});
