import { describe, expect, it } from "vitest";

import {
  isReminderActionHash,
  parseReminderActionResponse,
  reminderActionErrorText,
  reminderActionTokenFromHash,
} from "./requester-reminder-action";

describe("reminder action link", () => {
  it("reads the token from the fragment", () => {
    expect(isReminderActionHash("#ticket-aktion=v1.abc.def")).toBe(true);
    expect(reminderActionTokenFromHash("#ticket-aktion=v1.abc_-.d-e_f")).toBe(
      "v1.abc_-.d-e_f",
    );
  });

  it("rejects other fragments and malformed tokens", () => {
    expect(reminderActionTokenFromHash("#other=v1.a.b")).toBeNull();
    expect(reminderActionTokenFromHash("#ticket-aktion=v2.a.b")).toBeNull();
    expect(reminderActionTokenFromHash("#ticket-aktion=v1.a b.c")).toBeNull();
    expect(reminderActionTokenFromHash("#ticket-aktion=%E0%A4%A")).toBeNull();
  });

  it("parses previews", () => {
    expect(
      parseReminderActionResponse({
        data: {
          action: "resolved",
          state: "open",
          ticketNumber: "ICT-2026-000001",
          subject: "Drucker",
        },
      }),
    ).toEqual({
      action: "resolved",
      state: "open",
      ticketNumber: "ICT-2026-000001",
      subject: "Drucker",
    });
    expect(
      parseReminderActionResponse({ data: { action: "close", state: "open" } }),
    ).toBeNull();
  });

  it("explains used and expired links", () => {
    expect(reminderActionErrorText("token_used")).toContain("bereits");
    expect(reminderActionErrorText("expired")).toContain("abgelaufen");
    expect(reminderActionErrorText("anything")).toContain("später");
  });
});
