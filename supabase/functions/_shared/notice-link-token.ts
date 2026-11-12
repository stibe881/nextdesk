/**
 * Signierte Links für die Hinweise in Ticket-Mails («Zählerlink»).
 *
 * Format: `n1.<payload>.<signature>` (base64url), HMAC-SHA256 mit dem
 * Datenbankgeheimnis `ticket_requester_action_secret` (wie bei den
 * Bewertungslinks). Der Token nennt nur Hinweis und Mandant, nie eine Person.
 */

export type NoticeLinkClaims = {
  noticeId: string;
  tenantId: string;
  /** Ablauf als Unix-Sekunden. */
  expiresAt: number;
};

export type NoticeTokenVerification =
  | { ok: true; claims: NoticeLinkClaims }
  | { ok: false; reason: "malformed" | "signature" | "expired" };

const VERSION = "n1";
const MAX_TOKEN_LENGTH = 512;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
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

function equal(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index]! ^ right[index]!;
  }
  return difference === 0;
}

function assertSecret(secret: string): void {
  if (typeof secret !== "string" || secret.length < 32) {
    throw new Error("notice_link_secret_invalid");
  }
}

export async function signNoticeLinkToken(
  claims: NoticeLinkClaims,
  secret: string,
): Promise<string> {
  assertSecret(secret);
  if (
    !UUID.test(claims.noticeId) ||
    !UUID.test(claims.tenantId) ||
    !Number.isInteger(claims.expiresAt)
  ) {
    throw new Error("notice_link_claims_invalid");
  }
  const payload = base64url(
    new TextEncoder().encode(
      JSON.stringify({
        i: claims.noticeId.toLowerCase(),
        n: claims.tenantId.toLowerCase(),
        e: claims.expiresAt,
      }),
    ),
  );
  const signature = base64url(await hmac(secret, `${VERSION}.${payload}`));
  return `${VERSION}.${payload}.${signature}`;
}

export async function verifyNoticeLinkToken(
  token: unknown,
  secret: string,
  nowMs: number = Date.now(),
): Promise<NoticeTokenVerification> {
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
  if (!equal(given, await hmac(secret, `${VERSION}.${payload}`))) {
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
  const record = parsed as { i?: unknown; n?: unknown; e?: unknown } | null;
  if (
    !record ||
    typeof record.i !== "string" ||
    typeof record.n !== "string" ||
    !UUID.test(record.i) ||
    !UUID.test(record.n) ||
    typeof record.e !== "number" ||
    !Number.isInteger(record.e)
  ) {
    return { ok: false, reason: "malformed" };
  }
  if (record.e * 1000 <= nowMs) return { ok: false, reason: "expired" };
  return {
    ok: true,
    claims: { noticeId: record.i, tenantId: record.n, expiresAt: record.e },
  };
}
