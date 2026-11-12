import { describe, expect, it } from "vitest";

import {
  addMonthsIso,
  emptyDraft,
  stepIssue,
  type TeamsContext,
} from "./teams";

const context: TeamsContext = {
  available: true,
  reason: null,
  today: "2026-11-12",
  maxLifetimeMonths: 36,
  me: {
    id: "11111111-1111-4111-8111-111111111111",
    displayName: "Stefan",
    email: null,
  },
};

describe("teams wizard model", () => {
  it("adds months and clamps to the end of the month", () => {
    expect(addMonthsIso("2027-01-31", 1)).toBe("2027-02-28");
    expect(addMonthsIso("2026-11-12", 12)).toBe("2027-11-12");
  });

  it("starts with the requester as owner and a one-year term", () => {
    const draft = emptyDraft(context);
    expect(draft.owners).toHaveLength(1);
    expect(draft.startDate).toBe("2026-11-12");
    expect(draft.endDate).toBe("2027-11-12");
    expect(draft.visibility).toBe("private");
  });

  it("blocks steps until their required fields are valid", () => {
    const draft = emptyDraft(context);
    expect(stepIssue(0, draft, context)).not.toBe("");
    draft.name = "Projekt Neubau";
    expect(stepIssue(0, draft, context)).toBe("");
    draft.channels = [
      {
        name: "Kamera",
        isPrivate: false,
        tabs: [{ title: "Live", url: "http://x.ch" }],
      },
    ];
    expect(stepIssue(1, draft, context)).not.toBe("");
    draft.channels[0]!.tabs[0]!.url = "https://x.ch";
    expect(stepIssue(1, draft, context)).toBe("");
    draft.owners = [];
    expect(stepIssue(2, draft, context)).not.toBe("");
    draft.endDate = draft.startDate;
    expect(stepIssue(3, draft, context)).toBe(
      "Das Ende muss nach dem Start liegen.",
    );
    draft.endDate = "2031-01-01";
    expect(stepIssue(3, draft, context)).toContain("höchstens 3 Jahre");
  });
});
