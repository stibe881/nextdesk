import { resolveSupportContact } from "./support-contact.ts";

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(
      `${message}: expected ${String(expected)}, got ${String(actual)}`,
    );
  }
}

Deno.test("configured tenant support email takes precedence", () => {
  const result = resolveSupportContact(" help@example.test ", [
    "support@example.test",
  ]);

  assertEqual(result.email, "help@example.test", "email");
  assertEqual(result.source, "tenant_setting", "source");
  assertEqual(
    result.hasMultipleActiveExchangeMailboxes,
    false,
    "multiple mailbox flag",
  );
});

Deno.test("one active Exchange mailbox becomes the support contact fallback", () => {
  const result = resolveSupportContact(null, ["Support@Example.Test"]);

  assertEqual(result.email, "support@example.test", "email");
  assertEqual(result.source, "exchange_mailbox", "source");
  assertEqual(
    result.hasMultipleActiveExchangeMailboxes,
    false,
    "multiple mailbox flag",
  );
});

Deno.test("multiple active Exchange mailboxes never select an arbitrary address", () => {
  const result = resolveSupportContact(null, [
    "one@example.test",
    "two@example.test",
  ]);

  assertEqual(result.email, null, "email");
  assertEqual(result.source, null, "source");
  assertEqual(
    result.hasMultipleActiveExchangeMailboxes,
    true,
    "multiple mailbox flag",
  );
});
