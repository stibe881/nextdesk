import { assertEquals } from "jsr:@std/assert@1";
import { msg, parseFormality, resolvePairs, tone } from "./formality.ts";

Deno.test("tone picks the wording for the form of address", () => {
  assertEquals(tone("du", "Öffne es.", "Öffnen Sie es."), "Öffne es.");
  assertEquals(tone("sie", "Öffne es.", "Öffnen Sie es."), "Öffnen Sie es.");
});

Deno.test("unknown values mean du", () => {
  assertEquals(parseFormality("sie"), "sie");
  assertEquals(parseFormality("Sie"), "du");
  assertEquals(parseFormality(null), "du");
});

Deno.test("a message pair resolves to either wording", () => {
  const text = `Fehler: ${msg("Dir fehlt das Recht.", "Ihnen fehlt das Recht.")}`;
  assertEquals(resolvePairs(text, "du"), "Fehler: Dir fehlt das Recht.");
  assertEquals(resolvePairs(text, "sie"), "Fehler: Ihnen fehlt das Recht.");
});
