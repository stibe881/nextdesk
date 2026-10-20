import { expect, test } from "vitest";
import { isAssignedToCurrentUser } from "./live-dashboard";

test("only treats the current agent assignment as a personal assignment", () => {
  expect(isAssignedToCurrentUser("agent-1", "agent-1")).toBe(true);
  expect(isAssignedToCurrentUser(null, "agent-1")).toBe(false);
  expect(isAssignedToCurrentUser("agent-2", "agent-1")).toBe(false);
  expect(isAssignedToCurrentUser("agent-1", null)).toBe(false);
});
