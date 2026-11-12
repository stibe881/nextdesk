import { describe, expect, it } from "vitest";

import {
  lifeProgress,
  matchesTeamFilter,
  sortTeams,
  teamInitials,
  teamKpis,
  type AdminTeam,
} from "./teams-admin";

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
  startDate: null,
  endDate: null,
  daysLeft: null,
  createdAt: null,
  memberCount: null,
  guestCount: null,
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

describe("teams admin list helpers", () => {
  const mk = (patch: Partial<AdminTeam>): AdminTeam => ({
    teamId: "x",
    name: "X",
    description: null,
    visibility: "private",
    archived: false,
    webUrl: null,
    owners: ["O"],
    ownerCount: 1,
    source: "existing",
    requestId: null,
    requestStatus: null,
    startDate: null,
    endDate: null,
    daysLeft: null,
    createdAt: null,
    memberCount: null,
    guestCount: null,
    ...patch,
  });

  it("filters guests and teams without an end", () => {
    expect(matchesTeamFilter(mk({ guestCount: 2 }), "guests")).toBe(true);
    expect(matchesTeamFilter(mk({ guestCount: 0 }), "guests")).toBe(false);
    expect(matchesTeamFilter(mk({}), "no_end")).toBe(true);
    expect(matchesTeamFilter(mk({ endDate: "2027-01-01" }), "no_end")).toBe(
      false,
    );
  });

  it("sorts by end date (soonest first, none last) and by members", () => {
    const list = [
      mk({ teamId: "a", name: "A" }),
      mk({ teamId: "b", name: "B", endDate: "2027-05-01", memberCount: 3 }),
      mk({ teamId: "c", name: "C", endDate: "2026-12-01", memberCount: 9 }),
    ];
    expect(sortTeams(list, "end").map((t) => t.teamId)).toEqual([
      "c",
      "b",
      "a",
    ]);
    expect(sortTeams(list, "members").map((t) => t.teamId)).toEqual([
      "c",
      "b",
      "a",
    ]);
    expect(sortTeams(list, "name").map((t) => t.teamId)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("computes the elapsed share of the term and initials", () => {
    const team = mk({ startDate: "2026-01-01", endDate: "2026-01-11" });
    expect(lifeProgress(team, "2026-01-06")).toBe(50);
    expect(lifeProgress(mk({}), "2026-01-06")).toBeNull();
    expect(teamInitials("Klasse Kuhles")).toBe("KK");
    expect(teamInitials("1:1 DP-SG")).toBe("DS");
  });
});
