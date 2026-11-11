/**
 * Signed links for the star rating in the «ticket resolved» e-mail.
 *
 * Format: `r1.<payload>.<signature>` (base64url). The signature is an
 * HMAC-SHA256 over `r1.<payload>` with the same database secret as the
 * reminder links (ticket_requester_action_secret). The version prefix keeps
 * both token kinds apart. The token only names a ticket and a score; opening
 * the link changes nothing, the person confirms on the web page first.
 */

export type RatingLinkClaims = {
  ticketId: string;
  tenantId: string;
  /** Chosen number of stars, 1 to 5. */
  score: number;
  /** Expiry as Unix seconds. */
  expiresAt: number;
};

export type RatingTokenVerification =
  | { ok: true; claims: RatingLinkClaims }
  | { ok: false; reason: "malformed" | "signature" | "expired" };

const VERSION = "r1";
const MAX_TOKEN_LENGTH = 1024;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function fromBase64url(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/u.test(value)) return null;
  try {
    const padded =
      value.replaceAll("-", "+").replaceAll("_", "/") +
      "=".repeat((4 - (value.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

async function hmac(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)),
  );
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index]! ^ right[index]!;
  }
  return difference === 0;
}

function assertSecret(secret: string): void {
  if (typeof secret !== "string" || secret.length < 32) {
    throw new Error("rating_link_secret_invalid");
  }
}

export async function signRatingLinkToken(
  claims: RatingLinkClaims,
  secret: string,
): Promise<string> {
  assertSecret(secret);
  if (
    !UUID.test(claims.ticketId) ||
    !UUID.test(claims.tenantId) ||
    !Number.isInteger(claims.score) ||
    claims.score < 1 ||
    claims.score > 5 ||
    !Number.isInteger(claims.expiresAt)
  ) {
    throw new Error("rating_link_claims_invalid");
  }
  const payload = base64url(
    new TextEncoder().encode(
      JSON.stringify({
        t: claims.ticketId.toLowerCase(),
        n: claims.tenantId.toLowerCase(),
        s: claims.score,
        e: claims.expiresAt,
      }),
    ),
  );
  const signature = base64url(await hmac(secret, `${VERSION}.${payload}`));
  return `${VERSION}.${payload}.${signature}`;
}

export async function verifyRatingLinkToken(
  token: unknown,
  secret: string,
  nowMs: number = Date.now(),
): Promise<RatingTokenVerification> {
  assertSecret(secret);
  if (typeof token !== "string" || token.length > MAX_TOKEN_LENGTH) {
    return { ok: false, reason: "malformed" };
  }
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== VERSION) {
    return { ok: false, reason: "malformed" };
  }
  const [, payload, signature] = parts as [string, string, string];
  const given = fromBase64url(signature);
  const payloadBytes = fromBase64url(payload);
  if (!given || !payloadBytes || payload.length === 0) {
    return { ok: false, reason: "malformed" };
  }
  const expected = await hmac(secret, `${VERSION}.${payload}`);
  if (!constantTimeEqual(given, expected)) {
    return { ok: false, reason: "signature" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(payloadBytes),
    );
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { ok: false, reason: "malformed" };
  }
  const value = parsed as Record<string, unknown>;
  if (
    typeof value.t !== "string" ||
    !UUID.test(value.t) ||
    typeof value.n !== "string" ||
    !UUID.test(value.n) ||
    typeof value.s !== "number" ||
    !Number.isInteger(value.s) ||
    value.s < 1 ||
    value.s > 5 ||
    typeof value.e !== "number" ||
    !Number.isInteger(value.e)
  ) {
    return { ok: false, reason: "malformed" };
  }
  if (value.e * 1000 <= nowMs) return { ok: false, reason: "expired" };
  return {
    ok: true,
    claims: {
      ticketId: value.t,
      tenantId: value.n,
      score: value.s,
      expiresAt: value.e,
    },
  };
}

/** Link to the web page that asks for confirmation; the token stays in the fragment. */
export function ratingLinkUrl(appOrigin: string, token: string): string {
  return `${appOrigin.replace(/\/+$/u, "")}/#ticket-bewertung=${encodeURIComponent(token)}`;
}

/** Five links, one per star count, valid for 14 days. */
export async function ratingLinks(
  appOrigin: string,
  ticketId: string,
  tenantId: string,
  secret: string,
  nowMs: number = Date.now(),
): Promise<{ score: number; url: string }[]> {
  const expiresAt = Math.floor(nowMs / 1000) + 14 * 24 * 60 * 60;
  const links: { score: number; url: string }[] = [];
  for (let score = 1; score <= 5; score += 1) {
    const token = await signRatingLinkToken(
      { ticketId, tenantId, score, expiresAt },
      secret,
    );
    links.push({ score, url: ratingLinkUrl(appOrigin, token) });
  }
  return links;
}
