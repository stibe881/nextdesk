import { describe, expect, it } from "vitest";

import {
  DEFAULT_REFINEMENT,
  activeRefinementCount,
  matchesRefinement,
  sortTickets,
} from "../lib/ticket-list-refinement";

const tickets = [
  { id: "1", assignedAgentId: "a", departmentId: "d1", priority: "Hoch", priorityRank: 1, status: "Neu" },
  { id: "2", assignedAgentId: null, departmentId: "d2", priority: "Niedrig", priorityRank: 3, status: "Gelöst" },
  { id: "3", assignedAgentId: "b", departmentId: "d1", priority: "Mittel", priorityRank: 2, status: "In Bearbeitung" },
];
const labels = {
  agentName: (id?: string | null) => ({ a: "Zora", b: "Anna" })[id ?? ""] ?? "",
  departmentName: (id?: string | null) => (id === "d1" ? "ICT" : "Haus"),
};

describe("ticket list refinement", () => {
  it("filters by agent, department and priority", () => {
    const r = { ...DEFAULT_REFINEMENT };
    expect(tickets.filter((t) => matchesRefinement(t, { ...r, agent: "mine" }, "b")).map((t) => t.id)).toEqual(["3"]);
    expect(tickets.filter((t) => matchesRefinement(t, { ...r, agent: "unassigned" }, "b")).map((t) => t.id)).toEqual(["2"]);
    expect(tickets.filter((t) => matchesRefinement(t, { ...r, department: "d1" }, null)).map((t) => t.id)).toEqual(["1", "3"]);
    expect(tickets.filter((t) => matchesRefinement(t, { ...r, priority: "Mittel" }, null)).map((t) => t.id)).toEqual(["3"]);
  });

  it("keeps server order for the default sort and reverses it ascending", () => {
    expect(sortTickets(tickets, DEFAULT_REFINEMENT, labels).map((t) => t.id)).toEqual(["1", "2", "3"]);
    expect(sortTickets(tickets, { ...DEFAULT_REFINEMENT, sortDirection: "asc" }, labels).map((t) => t.id)).toEqual(["3", "2", "1"]);
  });

  it("sorts by agent name and priority rank", () => {
    expect(sortTickets(tickets, { ...DEFAULT_REFINEMENT, sortBy: "agent", sortDirection: "asc" }, labels).map((t) => t.id)).toEqual(["2", "3", "1"]);
    expect(sortTickets(tickets, { ...DEFAULT_REFINEMENT, sortBy: "priority", sortDirection: "asc" }, labels).map((t) => t.id)).toEqual(["1", "3", "2"]);
  });

  it("counts active refinements", () => {
    expect(activeRefinementCount(DEFAULT_REFINEMENT)).toBe(0);
    expect(activeRefinementCount({ ...DEFAULT_REFINEMENT, agent: "mine", sortBy: "status" })).toBe(2);
  });
});
