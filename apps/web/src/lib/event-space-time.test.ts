import { describe, expect, it } from "vitest";
import {
  swissEventSpaceOccurrences,
  swissWallTimeToInstant,
} from "./event-space-time";

describe("Swiss event-space time", () => {
  it("keeps a weekly series at the same Europe/Zurich wall time across daylight saving", () => {
    const occurrences = swissEventSpaceOccurrences({
      startsAt: "2026-03-22T08:00",
      endsAt: "2026-03-22T10:00",
      recurrence: "weekly",
      count: 2,
    });

    expect(occurrences).toEqual([
      {
        startsAt: "2026-03-22T07:00:00.000Z",
        endsAt: "2026-03-22T09:00:00.000Z",
      },
      {
        startsAt: "2026-03-29T06:00:00.000Z",
        endsAt: "2026-03-29T08:00:00.000Z",
      },
    ]);
  });

  it("rejects a nonexistent Swiss wall time instead of silently shifting it", () => {
    expect(swissWallTimeToInstant("2026-03-29T02:30")).toBeNull();
  });

  it("uses the last day when a monthly series starts on the 31st", () => {
    const occurrences = swissEventSpaceOccurrences({
      startsAt: "2026-01-31T08:00",
      endsAt: "2026-01-31T10:00",
      recurrence: "monthly",
      count: 3,
    });

    expect(occurrences?.map((occurrence) => occurrence.startsAt)).toEqual([
      "2026-01-31T07:00:00.000Z",
      "2026-02-28T07:00:00.000Z",
      "2026-03-31T06:00:00.000Z",
    ]);
  });
});
