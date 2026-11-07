import { describe, expect, it, vi } from "vitest";

vi.mock("./supabase", () => ({ supabase: null }));

import { parseRecentItems, recentItemAgeLabel } from "./recent-items";

const id = (suffix: string) => `20000000-0000-4000-8000-00000000000${suffix}`;

describe("parseRecentItems", () => {
  it("keeps valid entries newest first and skips invalid ones", () => {
    const items = parseRecentItems({
      data: {
        items: [
          {
            itemType: "ticket",
            itemId: id("a"),
            title: "Drucker",
            detail: "T-1",
            viewedAt: "2026-11-07T08:00:00Z",
          },
          {
            itemType: "asset",
            itemId: id("b"),
            title: "Laptop",
            detail: "A-1",
            viewedAt: "2026-11-07T09:00:00Z",
          },
          {
            itemType: "user",
            itemId: id("c"),
            title: "x",
            detail: "y",
            viewedAt: "2026-11-07T09:00:00Z",
          },
          {
            itemType: "ticket",
            itemId: "nope",
            title: "x",
            detail: "y",
            viewedAt: "2026-11-07T09:00:00Z",
          },
        ],
      },
    });
    expect(items?.map((item) => item.title)).toEqual(["Laptop", "Drucker"]);
  });

  it("rejects malformed envelopes", () => {
    expect(parseRecentItems(null)).toBeNull();
    expect(parseRecentItems({ data: { items: "x" } })).toBeNull();
  });
});

describe("recentItemAgeLabel", () => {
  const now = Date.parse("2026-11-07T12:00:00Z");
  it("formats relative ages", () => {
    expect(recentItemAgeLabel("2026-11-07T11:59:40Z", now)).toBe("gerade eben");
    expect(recentItemAgeLabel("2026-11-07T11:30:00Z", now)).toBe("vor 30 Min.");
    expect(recentItemAgeLabel("2026-11-07T09:00:00Z", now)).toBe("vor 3 Std.");
    expect(recentItemAgeLabel("2026-11-06T09:00:00Z", now)).toBe("gestern");
    expect(recentItemAgeLabel("2026-11-01T09:00:00Z", now)).toBe("vor 6 Tagen");
  });
});
