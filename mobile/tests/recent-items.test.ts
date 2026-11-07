import { describe, expect, it } from "vitest";

import {
  draftRestoredLabel,
  parseRecentItems,
  pickNewestDraft,
  recentItemAgeLabel,
  recentItemRoute,
} from "../lib/recent-items-model";

const id = "20000000-0000-4000-8000-00000000000a";
const now = Date.parse("2026-11-07T12:00:00Z");

describe("parseRecentItems", () => {
  it("keeps valid entries newest first", () => {
    const items = parseRecentItems({
      data: {
        items: [
          {
            itemType: "ticket",
            itemId: id,
            title: "Drucker",
            detail: "T-1",
            viewedAt: "2026-11-07T08:00:00Z",
          },
          {
            itemType: "knowledge_article",
            itemId: id,
            title: "VPN",
            detail: "Veröffentlicht",
            viewedAt: "2026-11-07T09:00:00Z",
          },
          { itemType: "other", itemId: id, title: "x", detail: "y" },
        ],
      },
    });
    expect(items?.map((item) => item.title)).toEqual(["VPN", "Drucker"]);
    expect(parseRecentItems({})).toBeNull();
  });
});

describe("recentItemRoute", () => {
  it("maps item types to app routes", () => {
    const base = { itemId: id, title: "", detail: "", viewedAt: "" };
    expect(recentItemRoute({ ...base, itemType: "ticket" })).toBe(
      `/ticket/${id}`,
    );
    expect(recentItemRoute({ ...base, itemType: "asset" })).toBe(
      `/assets/${id}`,
    );
    expect(recentItemRoute({ ...base, itemType: "knowledge_article" })).toBe(
      `/knowledge/${id}`,
    );
  });
});

describe("recentItemAgeLabel", () => {
  it("formats relative ages", () => {
    expect(recentItemAgeLabel("2026-11-07T11:50:00Z", now)).toBe("vor 10 Min.");
    expect(recentItemAgeLabel("2026-11-06T10:00:00Z", now)).toBe("gestern");
  });
});

describe("pickNewestDraft", () => {
  it("picks the newest allowed, non-empty draft", () => {
    const picked = pickNewestDraft(
      [
        {
          body: "Notiz",
          updatedAt: "2026-11-07T10:00:00Z",
          visibility: "internal",
        },
        {
          body: "Antwort vom Web",
          updatedAt: "2026-11-07T11:00:00Z",
          visibility: "external",
        },
        { body: "  ", updatedAt: "2026-11-07T11:30:00Z", visibility: "internal" },
      ],
      ["internal", "external"],
      now,
    );
    expect(picked?.body).toBe("Antwort vom Web");
  });

  it("respects permissions and retention", () => {
    expect(
      pickNewestDraft(
        [
          {
            body: "Intern",
            updatedAt: "2026-11-07T10:00:00Z",
            visibility: "internal",
          },
        ],
        ["external"],
        now,
      ),
    ).toBeNull();
    expect(
      pickNewestDraft(
        [{ body: "Alt", updatedAt: "2026-09-01T10:00:00Z", visibility: "external" }],
        ["external"],
        now,
      ),
    ).toBeNull();
  });
});

describe("draftRestoredLabel", () => {
  it("names the draft date", () => {
    expect(draftRestoredLabel("2026-11-07T10:05:00Z")).toBe(
      "Entwurf vom 07.11.2026, 11:05 wiederhergestellt",
    );
    expect(draftRestoredLabel(null)).toBe("Entwurf wiederhergestellt");
  });
});
