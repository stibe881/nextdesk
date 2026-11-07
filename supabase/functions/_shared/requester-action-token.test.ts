import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  requesterActionUrl,
  signRequesterActionToken,
  verifyRequesterActionToken,
} from "./requester-action-token.ts";

const SECRET = "a".repeat(64);
const claims = {
  reminderId: "11111111-1111-4111-8111-111111111111",
  ticketId: "22222222-2222-4222-8222-222222222222",
  tenantId: "33333333-3333-4333-8333-333333333333",
  action: "resolved" as const,
  expiresAt: 2_000_000_000,
};

Deno.test("signed token verifies and returns its claims", async () => {
  const token = await signRequesterActionToken(claims, SECRET);
  assert(token.startsWith("v1."));
  const result = await verifyRequesterActionToken(token, SECRET, 1_000_000_000_000);
  assert(result.ok);
  if (result.ok) assertEquals(result.claims, claims);
});

Deno.test("tampered payload or other secret fails the signature", async () => {
  const token = await signRequesterActionToken(claims, SECRET);
  const other = await signRequesterActionToken(
    { ...claims, action: "need_help" },
    SECRET,
  );
  const [version, , signature] = token.split(".");
  const swapped = `${version}.${other.split(".")[1]}.${signature}`;
  assertEquals(
    await verifyRequesterActionToken(swapped, SECRET, 0),
    { ok: false, reason: "signature" },
  );
  assertEquals(
    await verifyRequesterActionToken(token, "b".repeat(64), 0),
    { ok: false, reason: "signature" },
  );
});

Deno.test("expired token is rejected", async () => {
  const token = await signRequesterActionToken(claims, SECRET);
  assertEquals(
    await verifyRequesterActionToken(token, SECRET, claims.expiresAt * 1000),
    { ok: false, reason: "expired" },
  );
});

Deno.test("malformed tokens are rejected", async () => {
  for (const value of [null, "", "v1.abc", "v2.a.b", "v1..", "v1.a+b.c", 42]) {
    const result = await verifyRequesterActionToken(value, SECRET, 0);
    assertEquals(result.ok, false);
  }
});

Deno.test("invalid claims and short secrets are refused when signing", async () => {
  let failed = 0;
  try {
    await signRequesterActionToken({ ...claims, ticketId: "x" }, SECRET);
  } catch {
    failed += 1;
  }
  try {
    await signRequesterActionToken(claims, "short");
  } catch {
    failed += 1;
  }
  assertEquals(failed, 2);
});

Deno.test("link keeps the token in the fragment", () => {
  assertEquals(
    requesterActionUrl("https://app.nextdesk.ch/", "v1.a.b"),
    "https://app.nextdesk.ch/#ticket-aktion=v1.a.b",
  );
});
