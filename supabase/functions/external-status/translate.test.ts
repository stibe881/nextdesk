import {
  parseTranslation,
  translationHash,
  translationPrompt,
} from "./translate.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("translation answers are validated and trimmed", () => {
  const parsed = parseTranslation({
    title: "  Erhöhte Fehlerraten beim Microsoft-365-Connector ",
    message: "Ursache ist eine Störung bei Microsoft 365.\n",
  });
  assert(parsed?.title === "Erhöhte Fehlerraten beim Microsoft-365-Connector", "title");
  assert(parsed?.message === "Ursache ist eine Störung bei Microsoft 365.", "message");
  assert(parseTranslation({ title: "Titel", message: "" })?.message === null, "empty message");
  assert(parseTranslation({ title: " ", message: "x" }) === null, "empty title accepted");
  assert(parseTranslation(null) === null, "null accepted");
});

Deno.test("translation hash depends on title and text", async () => {
  const a = await translationHash("Outage", "Text");
  assert(/^[0-9a-f]{64}$/.test(a), "hash format");
  assert(a === await translationHash("Outage", "Text"), "hash not stable");
  assert(a !== await translationHash("Outage", "Other"), "text ignored");
  assert(translationPrompt("Claude", "T", null).includes("Anbieter: Claude"), "prompt");
});
