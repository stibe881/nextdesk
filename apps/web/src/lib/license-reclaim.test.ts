import { describe, expect, it, vi } from "vitest";

vi.mock("./supabase", () => ({ supabase: null }));

import { filterSeatPeople, reasonText, savingsLabel } from "./license-reclaim";

describe("license reclaim", () => {
  it("describes the reasons", () => {
    const now = new Date("2026-11-07T12:00:00Z");
    expect(
      reasonText(
        {
          reasons: ["inactive"],
          lastSignInAt: "2026-08-07T12:00:00Z",
          signInSource: "entra",
        },
        now,
      ),
    ).toEqual(["Keine Anmeldung seit 92 Tagen (Entra)"]);
    expect(
      reasonText(
        { reasons: ["inactive"], lastSignInAt: null, signInSource: "nextdesk" },
        now,
      ),
    ).toEqual(["Nie angemeldet (nextDesk)"]);
    expect(
      reasonText(
        {
          reasons: ["membership_inactive", "entra_disabled"],
          lastSignInAt: null,
          signInSource: null,
        },
        now,
      ),
    ).toEqual(["Kein aktives Mitglied mehr", "Entra-Konto deaktiviert"]);
  });

  it("formats the monthly saving per currency", () => {
    expect(savingsLabel({})).toBe("Keine Kosten erfasst");
    expect(savingsLabel({ CHF: 0 })).toBe("Keine Kosten erfasst");
    const label = savingsLabel({ CHF: 30, EUR: 12.5 });
    expect(label).toContain("30.00");
    expect(label).toContain("12.50");
    expect(label).toContain("/ Monat");
  });

  it("filters people by name and email", () => {
    const people = [
      { userId: "a", entraObjectId: null, label: "Erika Muster", email: null },
      {
        userId: null,
        entraObjectId: "b",
        label: "Max",
        email: "max@example.ch",
      },
    ];
    expect(filterSeatPeople(people, "example")).toHaveLength(1);
    expect(filterSeatPeople(people, "erika")[0]?.label).toBe("Erika Muster");
    expect(filterSeatPeople(people, "")).toHaveLength(2);
  });
});
