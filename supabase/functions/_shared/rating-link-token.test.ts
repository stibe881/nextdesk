import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  ratingLinks,
  signRatingLinkToken,
  verifyRatingLinkToken,
} from "./rating-link-token.ts";
import { signRequesterActionToken } from "./requester-action-token.ts";

const SECRET = "a".repeat(64);
const claims = {
  ticketId: "22222222-2222-4222-8222-222222222222",
  tenantId: "33333333-3333-4333-8333-333333333333",
  score: 4,
  expiresAt: 2_000_000_000,
};

Deno.test("signed rating token verifies and returns its claims", async () => {
  const token = await signRatingLinkToken(claims, SECRET);
  assert(token.startsWith("r1."));
  const result = await verifyRatingLinkToken(token, SECRET, 1_000_000_000_000);
  assert(result.ok);
  if (result.ok) assertEquals(result.claims, claims);
});

Deno.test("other secret, expiry and reminder tokens are rejected", async () => {
  const token = await signRatingLinkToken(claims, SECRET);
  const other = await verifyRatingLinkToken(token, "b".repeat(64), 1_000_000_000_000);
  assertEquals(other.ok ? null : other.reason, "signature");
  const expired = await verifyRatingLinkToken(token, SECRET, 2_000_000_001_000);
  assertEquals(expired.ok ? null : expired.reason, "expired");
  const reminder = await signRequesterActionToken(
    {
      reminderId: "11111111-1111-4111-8111-111111111111",
      ticketId: claims.ticketId,
      tenantId: claims.tenantId,
      action: "resolved",
      expiresAt: claims.expiresAt,
    },
    SECRET,
  );
  const crossed = await verifyRatingLinkToken(reminder, SECRET, 1_000_000_000_000);
  assertEquals(crossed.ok ? null : crossed.reason, "malformed");
});

Deno.test("scores outside 1 to 5 cannot be signed", async () => {
  for (const score of [0, 6, 2.5]) {
    let failed = false;
    try {
      await signRatingLinkToken({ ...claims, score }, SECRET);
    } catch {
      failed = true;
    }
    assert(failed);
  }
});

Deno.test("five links, one per star count, on the fragment page", async () => {
  const links = await ratingLinks(
    "https://app.nextdesk.ch/",
    claims.ticketId,
    claims.tenantId,
    SECRET,
    1_000_000_000_000,
  );
  assertEquals(links.map((link) => link.score), [1, 2, 3, 4, 5]);
  for (const link of links) {
    assert(link.url.startsWith("https://app.nextdesk.ch/#ticket-bewertung=r1."));
  }
});
