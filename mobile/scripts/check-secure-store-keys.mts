import assert from "node:assert/strict";

import {
  isValidSecureStoreKey,
  toSecureStoreKey,
} from "../lib/secure-store-key.ts";

const userId = "3f0c2a8e-6c1b-4f7a-9a51-0f1e2d3c4b5a";
const supabaseKey = "sb-ewizsylzrwogsztsthbl-auth-token";
const appKeys = [
  "nextdesk:mobile:auth-transaction:v1",
  "nextdesk:mobile:theme-preferences:v1",
  "nextdesk:mobile:active-user:v1",
  `nextdesk:mobile:tenant:v1:${userId}`,
  `nextdesk:mobile:private-state:v1:${userId}`,
  `nextdesk:mobile:ticket-cache:v1:${userId}:0`,
  `nextdesk:mobile:ticket-cache:v1:${userId}:1`,
  `nextdesk:mobile:ticket-cache:v1:${userId}:10`,
];

// Supabase keys are already valid and must stay byte-identical, otherwise
// existing sessions and the PKCE verifier would no longer be found.
for (const key of [
  supabaseKey,
  `${supabaseKey}-code-verifier`,
  `${supabaseKey}-user`,
]) {
  assert.equal(toSecureStoreKey(key), key, `unverändert: ${key}`);
  assert.ok(isValidSecureStoreKey(key));
}

const mapped = new Map<string, string>();
for (const key of appKeys) {
  const safe = toSecureStoreKey(key);
  assert.ok(isValidSecureStoreKey(safe), `ungültig: ${key} -> ${safe}`);
  assert.equal(toSecureStoreKey(key), safe, "deterministisch");
  assert.ok(!mapped.has(safe), `Kollision: ${key}`);
  mapped.set(safe, key);
}

// Escaped keys must not collide with an already valid key that happens to look
// like an escape sequence.
assert.notEqual(
  toSecureStoreKey("a:b"),
  toSecureStoreKey("a_u003ab"),
  "Escape-Kollision",
);
assert.notEqual(
  toSecureStoreKey("a:b"),
  toSecureStoreKey("_x.a_u003ab"),
  "Präfix-Kollision",
);
assert.throws(() => toSecureStoreKey(""));

console.log(
  `SecureStore-Schlüssel ok: ${appKeys.length} App-Schlüssel gültig und kollisionsfrei, Supabase-Schlüssel unverändert.`,
);
