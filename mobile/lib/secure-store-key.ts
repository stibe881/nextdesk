const SECURE_STORE_KEY_PATTERN = /^[A-Za-z0-9._-]+$/;
const PLAIN_KEY_CHARACTER = /^[A-Za-z0-9.-]$/;
// Escaped keys live in their own namespace. Application keys that are already
// valid never start with this prefix, so the two sets cannot collide.
const ESCAPED_KEY_PREFIX = "_x.";

/**
 * Expo SecureStore (iOS Keychain) accepts only non-empty keys made of
 * alphanumerics, ".", "-" and "_". Application keys use readable namespaces
 * such as "nextdesk:mobile:tenant:v1:<user>", so every other character
 * (including "_" itself inside an escaped key) is encoded deterministically as
 * "_uXXXX". Keys that are already valid – in particular the Supabase session
 * and PKCE verifier keys – stay unchanged, so existing sessions remain
 * readable and the Supabase client finds its verifier during the code exchange.
 */
export function toSecureStoreKey(key: string): string {
  if (key.length === 0) {
    throw new Error("Der sichere Gerätespeicher benötigt einen Schlüssel.");
  }
  if (
    SECURE_STORE_KEY_PATTERN.test(key) &&
    !key.startsWith(ESCAPED_KEY_PREFIX)
  ) {
    return key;
  }
  let escaped = ESCAPED_KEY_PREFIX;
  for (const character of key) {
    if (PLAIN_KEY_CHARACTER.test(character)) {
      escaped += character;
      continue;
    }
    const codePoint = character.codePointAt(0) ?? 0;
    escaped += `_u${codePoint.toString(16).padStart(4, "0")}`;
  }
  return escaped;
}

export function isValidSecureStoreKey(key: string): boolean {
  return SECURE_STORE_KEY_PATTERN.test(key);
}
