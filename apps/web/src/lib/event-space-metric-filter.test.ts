import { describe, expect, it } from "vitest";
import {
  eventSpaceMetricCounts,
  matchesEventSpaceMetricFilter,
} from "./event-space-metric-filter";

const now = new Date("2026-10-29T10:00:00.000Z");

const requests = [
  { endsAt: "2026-10-29T10:30:00.000Z", status: "planned" },
  { endsAt: "2026-10-29T11:00:00.000Z", status: "in_preparation" },
  { endsAt: "2026-10-29T11:30:00.000Z", status: "ready" },
  { endsAt: "2026-10-29T09:30:00.000Z", status: "completed" },
] as const;

describe("Raumplanungskennzahlen", () => {
  it("zählt die sichtbaren Kennzahlen mit derselben Regel wie die gefilterte Liste", () => {
    expect(eventSpaceMetricCounts(requests, now)).toEqual({
      upcoming: 3,
      in_preparation: 1,
      ready: 1,
    });
  });

  it("zeigt bei bevorstehenden Aufträgen keine abgeschlossenen Einträge", () => {
    expect(
      requests.filter((request) =>
        matchesEventSpaceMetricFilter(request, "upcoming", now),
      ),
    ).toEqual([requests[0], requests[1], requests[2]]);
  });

  it("filtert Vorbereitung und Bereit exakt nach dem Auftragsstatus", () => {
    expect(
      requests.filter((request) =>
        matchesEventSpaceMetricFilter(request, "in_preparation", now),
      ),
    ).toEqual([requests[1]]);
    expect(
      requests.filter((request) =>
        matchesEventSpaceMetricFilter(request, "ready", now),
      ),
    ).toEqual([requests[2]]);
  });
});
