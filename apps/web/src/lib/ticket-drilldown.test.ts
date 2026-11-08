import { describe, expect, it } from "vitest";
import {
  drilldownChipLabel,
  drilldownLabel,
  drilldownPeriodLabel,
  mergeDrilldownArguments,
  normalizeTicketDrilldown,
  ticketDrilldownRpcArguments,
} from "./ticket-drilldown";

const dep = "30000000-0000-4000-8000-000000000001";
const agent = "30000000-0000-4000-8000-000000000002";
const statuses = [
  { id: "s-open", label: "Offen", is_closed: false },
  { id: "s-work", label: "In Bearbeitung", is_closed: false },
  { id: "s-done", label: "Gelöst", is_closed: true },
];
const priorities = [
  { id: "p-high", label: "Hoch" },
  { id: "p-low", label: "Tief" },
];

describe("normalizeTicketDrilldown", () => {
  it("accepts valid dimensions and normalizes timestamps", () => {
    expect(
      normalizeTicketDrilldown({
        label: "Hoch",
        priorityLabels: ["Hoch"],
        departmentIds: [dep],
        createdFrom: "2026-10-01T00:00:00+02:00",
        slaBreached: true,
      }),
    ).toEqual({
      label: "Hoch",
      priorityLabels: ["Hoch"],
      departmentIds: [dep],
      createdFrom: "2026-09-30T22:00:00.000Z",
      slaBreached: true,
    });
  });

  it("rejects invalid ids, reversed ranges and empty drilldowns", () => {
    expect(
      normalizeTicketDrilldown({ label: "x", departmentIds: ["nope"] }),
    ).toBeNull();
    expect(
      normalizeTicketDrilldown({
        label: "x",
        createdFrom: "2026-10-02T00:00:00Z",
        createdTo: "2026-10-01T00:00:00Z",
      }),
    ).toBeNull();
    expect(normalizeTicketDrilldown({ label: "x" })).toBeNull();
    expect(
      normalizeTicketDrilldown({ label: "", slaBreached: true }),
    ).toBeNull();
    expect(
      normalizeTicketDrilldown({ label: "x", agent: "someone" }),
    ).toBeNull();
  });
});

describe("ticketDrilldownRpcArguments", () => {
  it("returns neutral arguments without drilldown", () => {
    const args = ticketDrilldownRpcArguments(null, statuses, priorities);
    expect(args.p_status_ids).toBeNull();
    expect(args.p_sla_breached).toBeNull();
    expect(args.p_only_unassigned).toBe(false);
  });

  it("resolves open/closed and labels to tenant ids", () => {
    const args = ticketDrilldownRpcArguments(
      {
        label: "Offen",
        statusClosed: false,
        priorityLabels: ["Hoch", "Unbekannt"],
        agent,
        createdFrom: "2026-10-01T00:00:00.000Z",
        createdTo: "2026-10-31T23:59:59.000Z",
      },
      statuses,
      priorities,
    );
    expect(args.p_status_ids).toEqual(["s-open", "s-work"]);
    expect(args.p_priority_ids).toEqual(["p-high"]);
    expect(args.p_assigned_agent_id).toBe(agent);
    expect(args.p_created_from).toBe("2026-10-01T00:00:00.000Z");
  });

  it("yields an empty list for unknown labels instead of all tickets", () => {
    const args = ticketDrilldownRpcArguments(
      { label: "x", priorityLabels: ["Kritisch"] },
      statuses,
      priorities,
    );
    expect(args.p_priority_ids).toEqual([]);
  });

  it("maps unassigned to the only-unassigned flag", () => {
    const args = ticketDrilldownRpcArguments(
      { label: "x", agent: "unassigned" },
      statuses,
      priorities,
    );
    expect(args.p_only_unassigned).toBe(true);
    expect(args.p_assigned_agent_id).toBeNull();
  });
});

describe("mergeDrilldownArguments", () => {
  it("intersects id lists of refinement and drilldown", () => {
    const merged = mergeDrilldownArguments(
      {
        p_status_ids: ["s-open"],
        p_priority_ids: null,
        p_department_ids: null,
        p_assigned_agent_id: null,
        p_only_unassigned: false,
        p_tenant_id: "t",
      },
      ticketDrilldownRpcArguments(
        { label: "x", statusClosed: false, departmentIds: [dep] },
        statuses,
        priorities,
      ),
    );
    expect(merged.p_status_ids).toEqual(["s-open"]);
    expect(merged.p_department_ids).toEqual([dep]);
    expect(merged.p_tenant_id).toBe("t");
  });
});

describe("labels", () => {
  it("formats chip and period labels", () => {
    expect(
      drilldownPeriodLabel("2026-09-30T22:00:00Z", "2026-10-31T22:59:59Z"),
    ).toBe("01.10.2026–31.10.2026");
    expect(drilldownLabel("Priorität Hoch", "", null, "Oktober")).toBe(
      "Priorität Hoch · Oktober",
    );
    expect(drilldownChipLabel({ label: "Gelöst", statusClosed: true })).toBe(
      "Aus Bericht: Gelöst",
    );
  });
});
