import { describe, expect, it } from "vitest";
import {
  matchesStatusSelection,
  splitStatusFilter,
  statusFilterOptions,
  toggleStatus,
} from "../lib/ticket-status-filter";

describe("ticket status filter", () => {
  it("splits saved view values", () => {
    expect(splitStatusFilter("all")).toEqual([]);
    expect(splitStatusFilter(undefined)).toEqual([]);
    expect(splitStatusFilter("Offen|In Bearbeitung")).toEqual([
      "Offen",
      "In Bearbeitung",
    ]);
  });
  it("toggles and matches", () => {
    const one = toggleStatus([], "Offen");
    expect(toggleStatus(one, "Neu")).toEqual(["Offen", "Neu"]);
    expect(toggleStatus(one, "Offen")).toEqual([]);
    expect(matchesStatusSelection("Neu", [])).toBe(true);
    expect(matchesStatusSelection("Neu", ["Offen"])).toBe(false);
    expect(matchesStatusSelection("Offen", ["Offen", "Neu"])).toBe(true);
  });
  it("lists unique sorted options including selected", () => {
    expect(
      statusFilterOptions(["Offen", "Neu", "Offen"], ["Erledigt"]),
    ).toEqual(["Erledigt", "Neu", "Offen"]);
  });
});
