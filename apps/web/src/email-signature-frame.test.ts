import { expect, test } from "vitest";
import {
  signatureDocument,
  splitPlainTextSignature,
} from "./email-signature-frame";

test("cuts the plain-text signature section off the description", () => {
  expect(
    splitPlainTextSignature(
      "Hallo\n\nLiebe Grüsse\nStefan\n\nE-Mail-Signatur\nInhaber\n+41 41",
    ),
  ).toEqual({
    message: "Hallo\n\nLiebe Grüsse\nStefan",
    hasPlainSignature: true,
  });
  expect(splitPlainTextSignature("Nur Text")).toEqual({
    message: "Nur Text",
    hasPlainSignature: false,
  });
});

test("the signature document blocks scripts and remote resources", () => {
  const document = signatureDocument("<p>Inhaber</p>");
  expect(document).toContain("default-src 'none'; img-src data:");
  expect(document).toContain("<p>Inhaber</p>");
});
