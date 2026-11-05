import { describe, expect, it } from "vitest";
import {
  listIncidentHeadline,
  parseIncident,
  parseIncidentOverview,
} from "./ticket-learning";

const ID = "0b6a1c1e-4f7a-4d2b-9c1e-2a3b4c5d6e7f";
const DEPARTMENT = "1c7b2d2f-5a8b-4e3c-8d2f-3b4c5d6e7f80";

describe("incident overview of the ticket list", () => {
  it("parses clusters and drops invalid ticket ids", () => {
    expect(
      parseIncidentOverview({
        windowHours: 2,
        incidents: [
          { subject: "VPN geht nicht", ticketCount: 6, ticketIds: [ID, "x"] },
          { subject: "Leer", ticketCount: 5, ticketIds: [] },
        ],
      }),
    ).toEqual({
      windowHours: 2,
      incidents: [
        { subject: "VPN geht nicht", ticketCount: 6, ticketIds: [ID] },
      ],
    });
    expect(parseIncidentOverview({ incidents: [] })).toBeNull();
  });

  it("names subject, count and window", () => {
    expect(
      listIncidentHeadline(
        { subject: "VPN geht nicht", ticketCount: 6, ticketIds: [ID] },
        2,
      ),
    ).toBe(
      "Möglicher Störfall: «VPN geht nicht» – 6 ähnliche Tickets in den letzten 2 Stunden",
    );
  });
});

describe("incident of a ticket", () => {
  it("carries the department choice for a new problem", () => {
    const incident = parseIncident({
      incident: {
        windowHours: 2,
        ticketCount: 5,
        tickets: [{ id: ID, ticketNumber: "T-1", subject: "VPN" }],
        departmentId: ID,
        problemDepartmentId: null,
        problemDepartments: [
          { id: DEPARTMENT, name: "ICT" },
          { id: "kaputt", name: "Ungültig" },
        ],
        canCreateProblem: true,
      },
    });
    expect(incident?.problemDepartmentId).toBeNull();
    expect(incident?.problemDepartments).toEqual([
      { id: DEPARTMENT, name: "ICT" },
    ]);
  });
});
