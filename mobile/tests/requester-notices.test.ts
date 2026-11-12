import { describe, expect, it } from "vitest";

import {
  isNoticeActionable,
  noticeColors,
  parseActiveNotices,
  pickNotice,
  resolveNoticeSymbol,
  resolveNoticeTarget,
  safeHttpsUrl,
  type NoticeView,
} from "../lib/requester-notices-model";

const UUID = "3f2b8c1e-5a47-4d9e-9b1a-0c6d2e7f8a90";

function notice(overrides: Partial<NoticeView> = {}): NoticeView {
  return {
    id: "n1",
    title: "Neu im Shop",
    body: "Jetzt bestellen",
    buttonLabel: "Zum Shop",
    linkKind: "shop",
    linkTarget: null,
    symbol: null,
    color: "brand",
    dismissible: true,
    ...overrides,
  };
}

describe("requester notice links", () => {
  it("resolves in-app targets", () => {
    expect(resolveNoticeTarget(notice({ linkKind: "shop" }))).toEqual({
      kind: "route",
      href: "/shop",
    });
    expect(resolveNoticeTarget(notice({ linkKind: "new_ticket" }))).toEqual({
      kind: "route",
      href: "/ticket/new",
    });
    expect(
      resolveNoticeTarget(notice({ linkKind: "knowledge", linkTarget: UUID })),
    ).toEqual({ kind: "route", href: `/knowledge/${UUID}` });
  });

  it("rejects knowledge links without a valid article id", () => {
    expect(
      resolveNoticeTarget(notice({ linkKind: "knowledge", linkTarget: null })),
    ).toBeNull();
    expect(
      resolveNoticeTarget(
        notice({ linkKind: "knowledge", linkTarget: "../settings" }),
      ),
    ).toBeNull();
  });

  it("opens only https addresses", () => {
    expect(
      resolveNoticeTarget(
        notice({ linkKind: "url", linkTarget: "https://example.ch/a?b=1" }),
      ),
    ).toEqual({ kind: "url", url: "https://example.ch/a?b=1" });
    for (const bad of [
      "http://example.ch",
      "javascript:alert(1)",
      "mailto:a@b.ch",
      "example.ch",
      "",
      null,
    ]) {
      expect(safeHttpsUrl(bad)).toBeNull();
      expect(
        isNoticeActionable(notice({ linkKind: "url", linkTarget: bad })),
      ).toBe(false);
    }
  });
});

describe("requester notice colours", () => {
  const palette = { primary: "#0a5", onPrimary: "#fff" };

  it("uses the app palette for brand", () => {
    expect(noticeColors("brand", palette)).toEqual({
      background: "#0a5",
      foreground: "#fff",
      buttonText: "#0a5",
    });
  });

  it("uses fixed dark fills with white text for status colours", () => {
    for (const color of ["info", "success", "warning"] as const) {
      const result = noticeColors(color, palette);
      expect(result.foreground).toBe("#FFFFFF");
      expect(result.buttonText).toBe(result.background);
    }
    expect(noticeColors("info", palette).background).not.toBe(
      noticeColors("warning", palette).background,
    );
  });
});

describe("requester notice symbols", () => {
  it("distinguishes icon names, emoji and the default", () => {
    expect(resolveNoticeSymbol("gift-outline")).toEqual({
      kind: "icon",
      name: "gift-outline",
    });
    expect(resolveNoticeSymbol("🎁")).toEqual({ kind: "text", text: "🎁" });
    expect(resolveNoticeSymbol(null)).toEqual({
      kind: "icon",
      name: "megaphone-outline",
    });
    expect(resolveNoticeSymbol("  ")).toEqual({
      kind: "icon",
      name: "megaphone-outline",
    });
  });
});

describe("requester notice parsing and filtering", () => {
  it("reads the response envelope and drops invalid entries", () => {
    const parsed = parseActiveNotices({
      data: {
        notices: [
          notice(),
          { id: "x" },
          null,
          notice({ id: "n1", title: "Doppelt" }),
          { ...notice({ id: "n2" }), color: "pink", linkKind: "shop" },
          { ...notice({ id: "n3" }), linkKind: "other" },
        ],
      },
    });
    expect(parsed.map((entry) => entry.id)).toEqual(["n1", "n2"]);
    expect(parsed[1]?.color).toBe("brand");
  });

  it("returns nothing for errors or unexpected shapes", () => {
    expect(parseActiveNotices(null)).toEqual([]);
    expect(parseActiveNotices({ error: { code: "x" } })).toEqual([]);
    expect(parseActiveNotices({ data: { notices: "no" } })).toEqual([]);
  });

  it("picks the first notice that was not dismissed", () => {
    const list = [notice({ id: "a" }), notice({ id: "b" })];
    expect(pickNotice(list, new Set())?.id).toBe("a");
    expect(pickNotice(list, new Set(["a"]))?.id).toBe("b");
    expect(pickNotice(list, new Set(["a", "b"]))).toBeNull();
    expect(pickNotice([], new Set())).toBeNull();
  });
});
