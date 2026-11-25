import { describe, expect, it } from "vitest";

import type { OnboardingEntry } from "../lib/nextdesk-onboarding";
import {
  filterOnboardingEntries,
  onboardingEntryDone,
} from "../lib/onboarding-filter";

const entry = (name: string, statuses: string[]): OnboardingEntry =>
  ({
    details: {},
    employeeName: name,
    id: name,
    ictResponsibleName: "Stefan",
    location: "Baar",
    managerName: "Ronald Junkert",
    organisationUnit: "ZD_GASTRO",
    source: "email",
    sourceTicketNumber: name === "Ennio" ? "ICT-2026-000042" : null,
    hasDocument: false,
    startsOn: "2026-12-01",
    tasks: statuses.map((status, index) => ({ id: `${name}${index}`, status })),
  }) as unknown as OnboardingEntry;

describe("Eintritte in der App filtern", () => {
  const list = [
    entry("Luca", ["open"]),
    entry("Ennio", ["completed"]),
    entry("Leer", []),
  ];
  it("Offen, Erledigt, Alle und Suche", () => {
    expect(onboardingEntryDone(list[1]!)).toBe(true);
    expect(filterOnboardingEntries(list, "open", "").map((e) => e.id)).toEqual([
      "Luca",
      "Leer",
    ]);
    expect(filterOnboardingEntries(list, "done", "").map((e) => e.id)).toEqual([
      "Ennio",
    ]);
    expect(
      filterOnboardingEntries(list, "all", "000042").map((e) => e.id),
    ).toEqual(["Ennio"]);
  });
});
