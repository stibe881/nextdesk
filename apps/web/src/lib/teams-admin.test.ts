import { describe, expect, it } from "vitest";

import { matchesTeamFilter, teamKpis, type AdminTeam } from "./teams-admin";

const base: AdminTeam = {
  teamId: "a",
  name: "A",
  description: null,
  visibility: "private",
  archived: false,
  webUrl: null,
  owners: ["X"],
  ownerCount: 1,
  source: "existing",
  requestId: null,
  requestStatus: null,
  endDate: null,
  daysLeft: null,
};

describe("teams admin filters", () => {
  const teams: AdminTeam[] = [
    base,
    {
      ...base,
      teamId: "b",
      source: "order",
      endDate: "2026-11-19",
      daysLeft: 7,
    },
    { ...base, teamId: "c", owners: [], ownerCount: 0 },
    { ...base, teamId: "d", archived: true, ownerCount: 0, daysLeft: 3 },
  ];

  it("filters by origin, expiry, owner and archive state", () => {
    const ids = (filter: Parameters<typeof matchesTeamFilter>[1]) =>
      teams
        .filter((team) => matchesTeamFilter(team, filter))
        .map((team) => team.teamId);
    expect(ids("all")).toEqual(["a", "b", "c", "d"]);
    expect(ids("ordered")).toEqual(["b"]);
    expect(ids("existing")).toEqual(["a", "c", "d"]);
    expect(ids("expiring")).toEqual(["b"]);
    expect(ids("no_owner")).toEqual(["c"]);
    expect(ids("archived")).toEqual(["d"]);
  });

  it("counts the tiles", () => {
    expect(teamKpis(teams)).toEqual({
      total: 4,
      expiring: 1,
      noOwner: 1,
      archived: 1,
    });
  });
});
