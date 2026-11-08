import {
  anonymizeComment,
  batchContent,
  buildBatches,
  buildRatingMonths,
  buildThemeReport,
  MAX_BATCH_CHARACTERS,
  monthOf,
  parseThemeResponse,
  recentMonths,
} from "./feedback-themes.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function equal<T>(actual: T, expected: T, message: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
  }
}

Deno.test("Kommentare werden vor dem Versand anonymisiert", () => {
  const text = anonymizeComment(
    "Herr Meier war super, danke Petra Muster! Mail: p.muster@contoso.ch, Tel. 079 123 45 67, Ticket IT-1234.",
    ["Petra Muster"],
  );
  assert(!text.includes("Meier"), `Anrede mit Name: ${text}`);
  assert(!text.includes("Petra") && !text.includes("Muster"), `Name: ${text}`);
  assert(!text.includes("contoso.ch"), `E-Mail: ${text}`);
  assert(!text.includes("079"), `Telefon: ${text}`);
  assert(text.includes("[Ticket]"), `Ticketnummer: ${text}`);
  assert(text.includes("war super"), "Inhalt bleibt erhalten");
  // Name parts inside other words stay untouched.
  equal(anonymizeComment("Annahme war gut", ["Ann Beispiel"]), "Annahme war gut", "Wortteile");
});

Deno.test("Stapel bleiben im KI-Eingabebudget", () => {
  const items = Array.from({ length: 30 }, (_value, index) => ({
    id: `t${index}`,
    text: `Kommentar ${index} `.repeat(index % 5 === 0 ? 60 : 3),
  }));
  const batches = buildBatches([...items, { id: "leer", text: "   " }]);
  equal(batches.flat().length, 30, "alle nicht leeren Kommentare");
  for (const batch of batches) {
    assert(batchContent(batch).length <= MAX_BATCH_CHARACTERS, `Stapel zu gross: ${batchContent(batch).length}`);
    assert(batch.length <= 8, "höchstens 8 pro Stapel");
  }
});

Deno.test("KI-Antwort wird validiert", () => {
  const batch = [{ id: "a", text: "x" }, { id: "b", text: "y" }, { id: "c", text: "z" }];
  const parsed = parseThemeResponse({
    items: [
      { n: 1, themes: ["long_wait", "communication", "long_wait", "erfunden"], sentiment: "negative" },
      { n: 2, themes: [], sentiment: "unbekannt" },
      { n: 9, themes: ["other"], sentiment: "positive" },
      { n: 1, themes: ["fast_resolution"], sentiment: "positive" },
    ],
  }, batch);
  equal(parsed.get("a"), { themes: ["long_wait", "communication"], sentiment: "negative" }, "Eintrag a");
  equal(parsed.get("b"), { themes: ["other"], sentiment: "neutral" }, "Rückfall auf Sonstiges/neutral");
  equal(parsed.has("c"), false, "fehlender Eintrag bleibt offen");
  equal(parseThemeResponse("unsinn", batch).size, 0, "ungültige Antwort");
});

Deno.test("Monatsaggregate ergeben Top-Themen und Verlauf", () => {
  const months = ["2026-09-01", "2026-10-01", "2026-11-01"];
  const report = buildThemeReport([
    { month: "2026-09-01", themeKey: "long_wait", sentiment: "negative", count: 4 },
    { month: "2026-10-01", themeKey: "long_wait", sentiment: "negative", count: 2 },
    { month: "2026-10-01", themeKey: "friendly_competent", sentiment: "positive", count: 3 },
    { month: "2026-11-01", themeKey: "friendly_competent", sentiment: "mixed", count: 1 },
    { month: "2026-11-01", themeKey: "unclear_answer", sentiment: "negative", count: 0 },
    { month: "2025-01-01", themeKey: "long_wait", sentiment: "negative", count: 99 },
    { month: "2026-11-01", themeKey: "erfunden", sentiment: "negative", count: 5 },
  ], months);
  equal(report.totalMentions, 10, "Summe im Zeitraum");
  equal(report.top.map((theme) => [theme.key, theme.count, theme.share]), [
    ["long_wait", 6, 60],
    ["friendly_competent", 4, 40],
  ], "Top-Themen");
  equal(report.top[1]!.sentiments, { positive: 3, neutral: 0, negative: 0, mixed: 1 }, "Stimmung");
  equal(report.trend.map((entry) => entry.counts.long_wait ?? 0), [4, 2, 0], "Verlauf");
});

Deno.test("Bewertungen pro Monat und Monatsgrenzen", () => {
  const months = recentMonths(3, new Date("2026-11-07T10:00:00Z"));
  equal(months, ["2026-09-01", "2026-10-01", "2026-11-01"], "Monate");
  const ratings = buildRatingMonths([
    { month: "2026-11-01", score: 5, hasComment: true },
    { month: "2026-11-01", score: 2, hasComment: false },
    { month: "2026-10-01", score: null, hasComment: true },
  ], months);
  equal(ratings[2], { month: "2026-11-01", count: 2, average: 3.5, distribution: [0, 1, 0, 0, 1], commentCount: 1 }, "November");
  equal(ratings[1]!.commentCount, 1, "Kommentar ohne Bewertung");
  equal(monthOf("2026-10-31T23:30:00Z"), "2026-11-01", "Zürcher Zeit");
});
