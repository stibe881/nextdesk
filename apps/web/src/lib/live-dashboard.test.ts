import { expect, test } from "vitest";
import {
  isAssignedToCurrentUser,
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
