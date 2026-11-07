import { assertEquals } from "jsr:@std/assert@1";
import { parseAction, parseSuggestion, type TriageCandidates } from "./index.ts";

const candidates: TriageCandidates = {
  categories: [{ id: "c1", name: "Drucker" }],
  priorities: [
    { id: "p1", key: "normal", label: "Normal" },
    { id: "p2", key: "high", label: "Hoch" },
  ],
  teams: [{ id: "t1", name: "Support" }],
  assets: [{ id: "a1", name: "Laptop" }],
};

Deno.test("suggestion keeps only known ids and clamps confidence", () => {
  assertEquals(
    parseSuggestion(
      {
        categoryId: "c1",
        priorityKey: "high",
        teamId: "unknown",
        assetId: "a1",
        confidence: 1.7,
        reason: "Drucker im 2. Stock",
      },
      candidates,
    ),
    {
      categoryId: "c1",
      priorityId: "p2",
      teamId: null,
      assetId: "a1",
      confidence: 1,
      reason: "Drucker im 2. Stock",
    },
  );
  assertEquals(parseSuggestion("nope", candidates), null);
});

Deno.test("settings threshold must lie between 0.5 and 1", () => {
  const tenantId = "00000000-0000-4000-8000-000000000001";
  assertEquals(
    parseAction({ type: "saveSettings", tenantId, enabled: true, applyThreshold: 0.3 }),
    null,
  );
  assertEquals(
    parseAction({ type: "saveSettings", tenantId, enabled: true, applyThreshold: 0.75 })?.type,
    "saveSettings",
  );
});
