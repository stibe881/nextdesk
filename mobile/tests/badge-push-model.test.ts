import { describe, expect, it } from "vitest";

import { badgeCountFromPush, isSilentPush } from "../lib/badge-push-model";

describe("Zahl-Push", () => {
  it("liest die Zahl in allen Android-Formen", () => {
    expect(badgeCountFromPush({ kind: "badge", badgeCount: 3 })).toBe(3);
    expect(badgeCountFromPush({ data: { kind: "badge", badgeCount: 0 } })).toBe(
      0,
    );
    expect(
      badgeCountFromPush({
        data: { body: JSON.stringify({ kind: "badge", badgeCount: 7 }) },
      }),
    ).toBe(7);
    expect(
      badgeCountFromPush({
        notification: {
          request: { content: { data: { kind: "badge", badgeCount: 2 } } },
        },
      }),
    ).toBe(2);
    expect(badgeCountFromPush({ kind: "ticket", badgeCount: 2 })).toBeNull();
    expect(badgeCountFromPush("kaputt")).toBeNull();
  });

  it("zeigt Zahl-Pushs nicht als Mitteilung", () => {
    expect(
      isSilentPush({ title: null, body: null, data: { kind: "badge" } }),
    ).toBe(true);
    expect(isSilentPush({ title: "", body: "", data: {} })).toBe(true);
    expect(isSilentPush({ title: "T-1", body: "Neue Antwort", data: {} })).toBe(
      false,
    );
  });
});
