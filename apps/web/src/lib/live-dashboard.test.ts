import { expect, test } from "vitest";
import {
  formatSlaRemaining,
  isAssignedToCurrentUser,
  ticketAgentsFromResponse,
  ticketListRpcArguments,
} from "./live-dashboard";

test("only treats the current agent assignment as a personal assignment", () => {
  expect(isAssignedToCurrentUser("agent-1", "agent-1")).toBe(true);
  expect(isAssignedToCurrentUser(null, "agent-1")).toBe(false);
  expect(isAssignedToCurrentUser("agent-2", "agent-1")).toBe(false);
  expect(isAssignedToCurrentUser("agent-1", null)).toBe(false);
});

test("sends only usable ticket full-text terms to the authorized list RPC", () => {
  const args = ticketListRpcArguments(
    "10000000-0000-4000-8000-000000000001",
    undefined,
    undefined,
    [],
    [],
    [],
    0,
    {
      metricTicketIds: null,
      query: "a VPN Verbindung",
      queue: "alle",
      scope: "all",
    },
    [],
  );

  expect(args.p_search_free_text).toEqual(["VPN", "Verbindung"]);
});

test("accepts queue departments only from the server-authorized agent directory", () => {
  const directory = ticketAgentsFromResponse({
    data: {
      agents: [],
      assignedAgentNames: {},
      departments: [
        {
          id: "10000000-0000-4000-8000-000000000001",
          key: "ict",
          label: "ICT",
        },
      ],
    },
  });

  expect(directory?.departments).toEqual([
    {
      id: "10000000-0000-4000-8000-000000000001",
      key: "ict",
      label: "ICT",
    },
  ]);
  expect(
    ticketAgentsFromResponse({
      data: { agents: [], assignedAgentNames: {}, departments: [] },
    }),
  ).not.toBeNull();
  expect(
    ticketAgentsFromResponse({
      data: {
        agents: [],
        assignedAgentNames: {},
        departments: [{ id: "not-a-uuid", key: "ict", label: "ICT" }],
      },
    }),
  ).toBeNull();
});

test("shows SLA time left in minutes, hours or days", () => {
  expect(formatSlaRemaining(42)).toBe("42 min");
  expect(formatSlaRemaining(60)).toBe("1 h");
  expect(formatSlaRemaining(23 * 60 + 59)).toBe("23 h");
  expect(formatSlaRemaining(24 * 60)).toBe("1 Tag");
  expect(formatSlaRemaining(99 * 60 + 54)).toBe("4 Tagen");
});
