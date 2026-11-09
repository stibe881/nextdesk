import { assertEquals } from "jsr:@std/assert@1";
import {
  cadreLevelOf,
  parseVisibleCadreLevels,
  visibleForCadre,
} from "./cadre-levels.ts";

Deno.test("parseVisibleCadreLevels accepts 1–3, dedupes and sorts", () => {
  assertEquals(parseVisibleCadreLevels(undefined), []);
  assertEquals(parseVisibleCadreLevels([]), []);
  assertEquals(parseVisibleCadreLevels([3, 1, 3]), [1, 3]);
  assertEquals(parseVisibleCadreLevels([0]), null);
  assertEquals(parseVisibleCadreLevels([4]), null);
  assertEquals(parseVisibleCadreLevels(["1"]), null);
  assertEquals(parseVisibleCadreLevels("1"), null);
});

Deno.test("visibleForCadre: empty means everybody, else exact levels", () => {
  assertEquals(visibleForCadre([], 0), true);
  assertEquals(visibleForCadre([1], 1), true);
  assertEquals(visibleForCadre([1], 0), false);
  // No inheritance: level 1 does not see an article for level 3 only.
  assertEquals(visibleForCadre([3], 1), false);
  assertEquals(visibleForCadre([2, 3], 3), true);
});

Deno.test("cadreLevelOf: manual override wins over the job title", () => {
  const rules = {
    titles: new Map([
      ["geschäftsleitung", 1],
      ["teamleitung", 3],
    ]),
    overrides: new Map([
      ["u-manual", 2],
      ["u-none", 0],
    ]),
  };
  assertEquals(cadreLevelOf(rules, "u1", " Geschäftsleitung "), 1);
  assertEquals(cadreLevelOf(rules, "u1", "TEAMLEITUNG"), 3);
  assertEquals(cadreLevelOf(rules, "u1", "Lehrperson"), 0);
  assertEquals(cadreLevelOf(rules, "u1", null), 0);
  assertEquals(cadreLevelOf(rules, "u-manual", "Lehrperson"), 2);
  assertEquals(cadreLevelOf(rules, "u-none", "Geschäftsleitung"), 0);
  assertEquals(cadreLevelOf(rules, null, "Teamleitung"), 3);
});
