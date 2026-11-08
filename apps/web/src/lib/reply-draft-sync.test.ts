import { describe, expect, it } from "vitest";
import {
  parseStoredReplyDraft,
  pickReplyDraftToRestore,
  replyDraftRestoredLabel,
  serializeStoredReplyDraft,
} from "./reply-draft-sync";

const now = Date.parse("2026-11-07T12:00:00Z");

describe("parseStoredReplyDraft", () => {
  it("reads the new and the legacy format", () => {
    expect(
      parseStoredReplyDraft(
        serializeStoredReplyDraft("Hallo", "2026-11-07T10:00:00Z"),
      ),
    ).toEqual({ body: "Hallo", savedAt: "2026-11-07T10:00:00Z" });
    expect(parseStoredReplyDraft(JSON.stringify({ body: "Alt" }))).toEqual({
      body: "Alt",
      savedAt: null,
    });
  });

  it("rejects empty, malformed or oversized drafts", () => {
    expect(parseStoredReplyDraft(null)).toBeNull();
    expect(parseStoredReplyDraft("{")).toBeNull();
    expect(parseStoredReplyDraft(JSON.stringify({ body: "  " }))).toBeNull();
    expect(
      parseStoredReplyDraft(JSON.stringify({ body: "x".repeat(50_001) })),
    ).toBeNull();
  });
});

describe("pickReplyDraftToRestore", () => {
  it("prefers the newer draft", () => {
    expect(
      pickReplyDraftToRestore(
        { body: "Lokal", savedAt: "2026-11-07T11:00:00Z" },
        { body: "Server", updatedAt: "2026-11-07T10:00:00Z" },
        now,
      ),
    ).toEqual({
      body: "Lokal",
      savedAt: "2026-11-07T11:00:00Z",
      source: "local",
    });
    expect(
      pickReplyDraftToRestore(
        { body: "Lokal", savedAt: "2026-11-07T09:00:00Z" },
        { body: "Vom Handy", updatedAt: "2026-11-07T10:00:00Z" },
        now,
      )?.source,
    ).toBe("server");
  });

  it("lets a server draft win over a legacy local copy", () => {
    expect(
      pickReplyDraftToRestore(
        { body: "Lokal", savedAt: null },
        { body: "Server", updatedAt: "2026-11-07T10:00:00Z" },
        now,
      )?.body,
    ).toBe("Server");
    expect(
      pickReplyDraftToRestore({ body: "Lokal", savedAt: null }, null, now),
    ).toEqual({ body: "Lokal", savedAt: null, source: "local" });
  });

  it("ignores empty and expired drafts", () => {
    expect(pickReplyDraftToRestore(null, null, now)).toBeNull();
    expect(
      pickReplyDraftToRestore(
        null,
        { body: " ", updatedAt: "2026-11-07T10:00:00Z" },
        now,
      ),
    ).toBeNull();
    expect(
      pickReplyDraftToRestore(
        null,
        { body: "Alt", updatedAt: "2026-09-01T10:00:00Z" },
        now,
      ),
    ).toBeNull();
  });
});

describe("replyDraftRestoredLabel", () => {
  it("names the draft date in Swiss format", () => {
    expect(replyDraftRestoredLabel("2026-11-07T10:05:00Z")).toBe(
      "Entwurf vom 07.11.2026, 11:05 wiederhergestellt.",
    );
    expect(replyDraftRestoredLabel(null)).toBe("Entwurf wiederhergestellt.");
  });
});
