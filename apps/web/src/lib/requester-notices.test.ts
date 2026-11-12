import { describe, expect, it } from "vitest";
import {
  charCount,
  clickRate,
  datesIssue,
  draftFromNotice,
  emptyNoticeDraft,
  frequencyIssue,
  noticeColors,
  noticeIssue,
  noticePayload,
  noticePeriodLabel,
  noticeStateLabel,
  resolveNoticeLink,
  todayIso,
  type AdminNotice,
  type NoticeDraft,
} from "./requester-notices";

const ID = "0b9f6c3e-1d2a-4c55-9d1e-3a7b8c9d0e1f";

function valid(overrides: Partial<NoticeDraft> = {}): NoticeDraft {
  return {
    ...emptyNoticeDraft("2026-11-12"),
    title: "Neu im Shop",
    body: "Teams bestellen Sie jetzt im Shop.",
    endsOn: "2026-12-31",
    ...overrides,
  };
}

describe("Hinweise: Validierung", () => {
  it("akzeptiert einen vollständigen Entwurf", () => {
    expect(noticeIssue(valid())).toBe("");
  });

  it("prüft Titel, Text und Schaltfläche", () => {
    expect(noticeIssue(valid({ title: "  " }))).toMatch(/Titel/);
    expect(noticeIssue(valid({ title: "x".repeat(61) }))).toMatch(/Titel/);
    expect(noticeIssue(valid({ body: "" }))).toMatch(/Text/);
    expect(noticeIssue(valid({ body: "x".repeat(221) }))).toMatch(/Text/);
    expect(noticeIssue(valid({ buttonLabel: "" }))).toMatch(/Schaltfläche/);
    expect(noticeIssue(valid({ buttonLabel: "x".repeat(31) }))).toMatch(
      /Schaltfläche/,
    );
  });

  it("zählt Emojis als ein Zeichen", () => {
    expect(charCount("🛡T")).toBe(2);
    expect(noticeIssue(valid({ symbol: "🛡🛡🛡🛡" }))).toBe("");
    expect(noticeIssue(valid({ symbol: "12345" }))).toMatch(/Symbol/);
  });

  it("verlangt ein gültiges Ziel", () => {
    expect(noticeIssue(valid({ linkKind: "knowledge" }))).toMatch(/Wissen/);
    expect(noticeIssue(valid({ linkKind: "knowledge", linkTarget: ID }))).toBe(
      "",
    );
    expect(
      noticeIssue(valid({ linkKind: "url", linkTarget: "http://a.ch" })),
    ).toMatch(/https/);
    expect(
      noticeIssue(valid({ linkKind: "url", linkTarget: "https://a.ch/x" })),
    ).toBe("");
  });

  it("verlangt mindestens einen Ort", () => {
    expect(noticeIssue(valid({ showPortalBanner: false }))).toMatch(/Ort/);
    expect(
      noticeIssue(valid({ showPortalBanner: false, showMail: true })),
    ).toBe("");
  });

  it("verlangt ein Ende nach dem Start", () => {
    expect(datesIssue(valid({ endsOn: "" }))).toMatch(/Ende/);
    expect(datesIssue(valid({ endsOn: "2026-11-01" }))).toMatch(/Ende/);
    expect(datesIssue(valid({ endsOn: "2026-11-12" }))).toBe("");
    expect(datesIssue(valid({ startsOn: "" }))).toBe("");
  });

  it("prüft die Häufigkeit", () => {
    expect(frequencyIssue(0)).toBe("");
    expect(frequencyIssue(30)).toBe("");
    expect(frequencyIssue(31)).not.toBe("");
    expect(frequencyIssue(1.5)).not.toBe("");
    expect(frequencyIssue(Number.NaN)).not.toBe("");
  });
});

describe("Hinweise: Nutzlast und Darstellung", () => {
  it("sendet linkTarget nur für Wissen und Adresse", () => {
    expect(
      noticePayload(valid({ linkKind: "shop", linkTarget: "alt" })).linkTarget,
    ).toBeNull();
    expect(
      noticePayload(valid({ linkKind: "url", linkTarget: " https://a.ch " }))
        .linkTarget,
    ).toBe("https://a.ch");
    expect(noticePayload(valid({ symbol: " " })).symbol).toBeNull();
    expect("id" in noticePayload(valid())).toBe(false);
    expect(noticePayload(valid({ id: ID })).id).toBe(ID);
  });

  it("übernimmt einen Hinweis in den Entwurf", () => {
    const notice: AdminNotice = {
      id: ID,
      title: "T",
      body: "B",
      buttonLabel: "Go",
      linkKind: "shop",
      linkTarget: null,
      symbol: null,
      color: "info",
      dismissible: false,
      status: "active",
      state: "active",
      showPortalBanner: true,
      showPortalBar: false,
      showMail: true,
      showApp: false,
      startsOn: "2026-11-01",
      endsOn: "2026-12-31",
      stats: {
        views: 0,
        clicks: 0,
        dismissals: 0,
        mailViews: 0,
        mailClicks: 0,
      },
      updatedAt: "2026-11-01T00:00:00Z",
    };
    const draft = draftFromNotice(notice);
    expect(draft.id).toBe(ID);
    expect(draft.linkTarget).toBe("");
    expect(draft.symbol).toBe("");
    expect(noticePeriodLabel(notice, "2026-11-12")).toBe("bis 31.12.2026");
    expect(
      noticePeriodLabel({ ...notice, startsOn: "2026-12-01" }, "2026-11-12"),
    ).toBe("ab 01.12.2026 bis 31.12.2026");
  });

  it("beschriftet Zustände und Farben", () => {
    expect(noticeStateLabel("scheduled")).toBe("Geplant");
    expect(noticeStateLabel("expired")).toBe("Abgelaufen");
    expect(noticeColors("warning").from).toMatch(/^#/);
    expect(clickRate(15, 100)).toBe(15);
    expect(clickRate(1, 0)).toBe(0);
    expect(todayIso(new Date(2026, 10, 2))).toBe("2026-11-02");
  });
});

describe("Hinweise: Ziel auflösen", () => {
  it("löst alle Zielarten auf", () => {
    expect(resolveNoticeLink({ linkKind: "shop", linkTarget: null })).toEqual({
      kind: "section",
      section: "Shop",
    });
    expect(
      resolveNoticeLink({ linkKind: "new_ticket", linkTarget: null }),
    ).toEqual({ kind: "new_ticket" });
    expect(
      resolveNoticeLink({
        linkKind: "knowledge",
        linkTarget: ID.toUpperCase(),
      }),
    ).toEqual({ kind: "knowledge", id: ID });
    expect(
      resolveNoticeLink({ linkKind: "knowledge", linkTarget: null }),
    ).toEqual({ kind: "section", section: "Wissen" });
    expect(
      resolveNoticeLink({ linkKind: "url", linkTarget: "https://a.ch" }),
    ).toEqual({ kind: "url", href: "https://a.ch" });
  });

  it("verwirft unsichere Adressen", () => {
    expect(
      resolveNoticeLink({ linkKind: "url", linkTarget: "javascript:alert(1)" }),
    ).toBeNull();
    expect(
      resolveNoticeLink({ linkKind: "url", linkTarget: "http://a.ch" }),
    ).toBeNull();
    expect(resolveNoticeLink({ linkKind: "url", linkTarget: null })).toBeNull();
  });
});
