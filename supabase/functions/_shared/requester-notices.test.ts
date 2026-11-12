import { assertEquals } from "jsr:@std/assert@1";

import {
  chooseNotice,
  mailNoticeAllowed,
  noticeState,
  noticeTargetUrl,
  validateNoticeInput,
} from "./requester-notices.ts";
import { signNoticeLinkToken, verifyNoticeLinkToken } from "./notice-link-token.ts";

const TODAY = "2026-11-12";
const SECRET = "x".repeat(40);
const ID = "11111111-1111-4111-8111-111111111111";
const TENANT = "22222222-2222-4222-8222-222222222222";

function input(overrides: Record<string, unknown> = {}) {
  return {
    title: "Neu im Shop: Teams bestellen",
    body: "Ein Team bestellen Sie jetzt in 5 Schritten.",
    buttonLabel: "Zum Shop",
    linkKind: "shop",
    linkTarget: null,
    symbol: "T",
    color: "brand",
    showPortalBanner: true,
    showPortalBar: false,
    showMail: true,
    showApp: false,
    dismissible: true,
    startsOn: "",
    endsOn: "2026-12-31",
    ...overrides,
  };
}

const code = (overrides: Record<string, unknown>) => {
  const result = validateNoticeInput(input(overrides), TODAY);
  return result.ok ? "ok" : result.code;
};

Deno.test("validates texts, links, places and dates", () => {
  assertEquals(code({}), "ok");
  assertEquals(code({ title: "" }), "title_invalid");
  assertEquals(code({ title: "x".repeat(61) }), "title_invalid");
  assertEquals(code({ body: "x".repeat(221) }), "body_invalid");
  assertEquals(code({ buttonLabel: "" }), "button_invalid");
  assertEquals(code({ linkKind: "url", linkTarget: "http://x.ch" }), "link_invalid");
  assertEquals(code({ linkKind: "url", linkTarget: "https://x.ch/a" }), "ok");
  assertEquals(code({ linkKind: "knowledge", linkTarget: "kein-uuid" }), "link_invalid");
  assertEquals(code({ linkKind: "knowledge", linkTarget: ID }), "ok");
  assertEquals(
    code({ showPortalBanner: false, showMail: false }),
    "placement_required",
  );
  assertEquals(code({ endsOn: "" }), "dates_invalid");
  assertEquals(code({ endsOn: "2026-11-01" }), "dates_invalid");
  assertEquals(code({ startsOn: "2026-12-01", endsOn: "2026-11-20" }), "dates_invalid");
  assertEquals(code({ color: "pink" }), "invalid_request");
});

Deno.test("start defaults to today and the state follows the schedule", () => {
  const ok = validateNoticeInput(input(), TODAY);
  if (!ok.ok) throw new Error(ok.code);
  assertEquals(ok.value.startsOn, TODAY);
  const n = (status: string, starts_on: string, ends_on: string) =>
    noticeState({ status, starts_on, ends_on }, TODAY);
  assertEquals(n("draft", "2026-11-01", "2026-12-01"), "draft");
  assertEquals(n("active", "2026-11-20", "2026-12-01"), "scheduled");
  assertEquals(n("active", "2026-11-01", "2026-12-01"), "active");
  assertEquals(n("paused", "2026-11-01", "2026-12-01"), "paused");
  assertEquals(n("active", "2026-10-01", "2026-11-01"), "expired");
});

Deno.test("target urls", () => {
  assertEquals(noticeTargetUrl("shop", null), "https://app.nextdesk.ch/?ziel=shop");
  assertEquals(noticeTargetUrl("new_ticket", null), "https://app.nextdesk.ch/?ziel=neues-ticket");
  assertEquals(noticeTargetUrl("knowledge", ID), `https://app.nextdesk.ch/?wissen=${ID}`);
  assertEquals(noticeTargetUrl("url", "http://x.ch"), null);
  assertEquals(noticeTargetUrl("url", "https://x.ch/a"), "https://x.ch/a");
});

Deno.test("notices only in ticket mails without reminder actions", () => {
  assertEquals(mailNoticeAllowed("resolution", false), true);
  assertEquals(mailNoticeAllowed("acknowledgement", false), true);
  assertEquals(mailNoticeAllowed("agent_reply", false), true);
  assertEquals(mailNoticeAllowed("agent_reply", true), false);
  for (const kind of ["security_notice", "rating_reminder", "test", "notification", "ticket_copy", null]) {
    assertEquals(mailNoticeAllowed(kind, false), false);
  }
});

Deno.test("frequency limit and rotation", () => {
  const now = new Date("2026-11-12T10:00:00Z");
  const a = { id: "a" };
  const b = { id: "b" };
  assertEquals(chooseNotice([], [], 7, now), null);
  // never delivered: first one
  assertEquals(chooseNotice([a, b], [], 7, now)?.id, "a");
  // delivered 3 days ago: within 7 days -> none
  assertEquals(
    chooseNotice([a, b], [{ notice_id: "a", delivered_at: "2026-11-09T10:00:00Z" }], 7, now),
    null,
  );
  // delivered 10 days ago: next one rotates to b
  assertEquals(
    chooseNotice([a, b], [{ notice_id: "a", delivered_at: "2026-11-02T10:00:00Z" }], 7, now)?.id,
    "b",
  );
  // frequency 0: always allowed, least recent first
  assertEquals(
    chooseNotice(
      [a, b],
      [
        { notice_id: "a", delivered_at: "2026-11-11T10:00:00Z" },
        { notice_id: "b", delivered_at: "2026-11-05T10:00:00Z" },
      ],
      0,
      now,
    )?.id,
    "b",
  );
});

Deno.test("link tokens", async () => {
  const token = await signNoticeLinkToken(
    { noticeId: ID, tenantId: TENANT, expiresAt: 4_000_000_000 },
    SECRET,
  );
  const ok = await verifyNoticeLinkToken(token, SECRET, 1_700_000_000_000);
  assertEquals(ok.ok && ok.claims.noticeId, ID);
  assertEquals((await verifyNoticeLinkToken(token + "x", SECRET)).ok, false);
  assertEquals((await verifyNoticeLinkToken(token, "y".repeat(40))).ok, false);
  const expired = await verifyNoticeLinkToken(token, SECRET, 4_100_000_000_000);
  assertEquals(!expired.ok && expired.reason, "expired");
  assertEquals((await verifyNoticeLinkToken("n1.x", SECRET)).ok, false);
});
