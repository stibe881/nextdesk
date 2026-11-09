import { expect, test } from "vitest";
import {
  parseEmailSenderContacts,
  phoneHref,
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

test("reads the stored sender contacts", () => {
  expect(
    parseEmailSenderContacts({
      phones: ["041 000 00 00", ""],
      emails: ["a@b.ch"],
    }),
  ).toEqual({ phones: ["041 000 00 00"], emails: ["a@b.ch"] });
  expect(parseEmailSenderContacts({ phones: [], emails: [] })).toBeNull();
  expect(parseEmailSenderContacts(null)).toBeNull();
  expect(phoneHref("+41 (0)79 123 45 67")).toBe("tel:+410791234567");
  expect(phoneHref("041 000 00 00")).toBe("tel:0410000000");
});
