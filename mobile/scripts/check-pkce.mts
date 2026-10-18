import { createHash, randomBytes } from "node:crypto";
import assert from "node:assert/strict";

import {
  base64UrlEncode,
  pkceS256Challenge,
  sha256,
  utf8Bytes,
  withTimeout,
} from "../lib/pkce.ts";

// FIPS 180-2 "abc" reference digest.
assert.equal(
  Buffer.from(sha256(utf8Bytes("abc"))).toString("hex"),
  "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
);

const samples = [
  "",
  "abc",
  "a".repeat(55),
  "a".repeat(56),
  "a".repeat(64),
  "äöü € 😀",
];
for (let length = 0; length < 200; length += 1)
  samples.push("x".repeat(length));
for (const sample of samples) {
  const expected = createHash("sha256").update(sample, "utf8").digest("hex");
  assert.equal(
    Buffer.from(sha256(utf8Bytes(sample))).toString("hex"),
    expected,
  );
  assert.deepEqual(Buffer.from(utf8Bytes(sample)), Buffer.from(sample, "utf8"));
}

for (let run = 0; run < 500; run += 1) {
  const bytes = randomBytes(run % 70);
  assert.equal(base64UrlEncode(bytes), bytes.toString("base64url"));
  const verifier = randomBytes(32).toString("base64url");
  assert.equal(
    pkceS256Challenge(verifier),
    createHash("sha256").update(verifier).digest("base64url"),
  );
}

await assert.rejects(
  withTimeout(new Promise(() => undefined), 20, "zeitlimit"),
  /zeitlimit/,
);
assert.equal(await withTimeout(Promise.resolve(7), 20, "zeitlimit"), 7);

console.log("PKCE/SHA-256 checks passed");
