/**
 * Signed one-click links for reminder e-mails («Problem ist gelöst» /
 * «Ich brauche noch Hilfe»).
 *
 * Format: `v1.<payload>.<signature>` (base64url). The signature is an
 * HMAC-SHA256 over `v1.<payload>` with a secret that lives in the database
 * (ticket_requester_private.action_secret). The token itself is not secret
 * storage: single use and expiry are enforced again in the database
 * (ticket_requester_respond), so a verified signature alone never changes a
 * ticket.
 */

export type RequesterAction = "resolved" | "need_help";

export type RequesterActionClaims = {
  reminderId: string;
  ticketId: string;
  tenantId: string;
  action: RequesterAction;
  /** Expiry as Unix seconds. */
  expiresAt: number;
};

export type TokenVerification =
  | { ok: true; claims: RequesterActionClaims }
  | { ok: false; reason: "malformed" | "signature" | "expired" };

const VERSION = "v1";
const MAX_TOKEN_LENGTH = 1024;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isRequesterAction(value: unknown): value is RequesterAction {
  return value === "resolved" || value === "need_help";
}

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
    const padded = value.replaceAll("-", "+").replaceAll("_", "/") +
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
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

function assertSecret(secret: string): void {
  if (typeof secret !== "string" || secret.length < 32) {
    throw new Error("requester_action_secret_invalid");
  }
}

export async function signRequesterActionToken(
  claims: RequesterActionClaims,
  secret: string,
): Promise<string> {
  assertSecret(secret);
  if (
    !UUID.test(claims.reminderId) ||
    !UUID.test(claims.ticketId) ||
    !UUID.test(claims.tenantId) ||
    !isRequesterAction(claims.action) ||
    !Number.isInteger(claims.expiresAt)
  ) {
    throw new Error("requester_action_claims_invalid");
  }
  const payload = base64url(
    new TextEncoder().encode(
      JSON.stringify({
        r: claims.reminderId.toLowerCase(),
        t: claims.ticketId.toLowerCase(),
        n: claims.tenantId.toLowerCase(),
        a: claims.action,
        e: claims.expiresAt,
      }),
    ),
  );
  const signature = base64url(await hmac(secret, `${VERSION}.${payload}`));
  return `${VERSION}.${payload}.${signature}`;
}

export async function verifyRequesterActionToken(
  token: unknown,
  secret: string,
  nowMs: number = Date.now(),
): Promise<TokenVerification> {
  assertSecret(secret);
  if (typeof token !== "string" || token.length > MAX_TOKEN_LENGTH) {
    return { ok: false, reason: "malformed" };
  }
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== VERSION) {
    return { ok: false, reason: "malformed" };
  }
  const [, payload, signature] = parts;
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
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(payloadBytes));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { ok: false, reason: "malformed" };
  }
  const value = parsed as Record<string, unknown>;
  if (
    typeof value.r !== "string" || !UUID.test(value.r) ||
    typeof value.t !== "string" || !UUID.test(value.t) ||
    typeof value.n !== "string" || !UUID.test(value.n) ||
    !isRequesterAction(value.a) ||
    typeof value.e !== "number" || !Number.isInteger(value.e)
  ) {
    return { ok: false, reason: "malformed" };
  }
  if (value.e * 1000 <= nowMs) return { ok: false, reason: "expired" };
  return {
    ok: true,
    claims: {
      reminderId: value.r,
      ticketId: value.t,
      tenantId: value.n,
      action: value.a,
      expiresAt: value.e,
    },
  };
}

/** Link to the web page that asks for confirmation; the token stays in the fragment. */
export function requesterActionUrl(appOrigin: string, token: string): string {
  return `${appOrigin.replace(/\/+$/u, "")}/#ticket-aktion=${encodeURIComponent(token)}`;
}
