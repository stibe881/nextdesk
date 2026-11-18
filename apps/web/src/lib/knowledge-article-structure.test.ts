import { describe, expect, it } from "vitest";
import {
  knowledgeReadingMinutes,
  structureKnowledgeArticle,
} from "./knowledge-article-structure";

describe("Struktur eines Wissensartikels", () => {
  it("nimmt den ersten Absatz als «Kurz gesagt» und gliedert in Abschnitte", () => {
    const structure = structureKnowledgeArticle(
      "Mit dem VPN arbeiten Sie sicher von zu Hause.\n\nWeitere Hinweise folgen.\n\n## Voraussetzungen\nLaptop\n\n## Schritte\n1. Öffnen\n2. Anmelden\n\n## Probleme\nSiehe Support",
      null,
    );
    expect(structure.lead).toBe(
      "Mit dem VPN arbeiten Sie sicher von zu Hause.",
    );
    expect(structure.intro).toBe("Weitere Hinweise folgen.");
    expect(structure.sections.map((section) => section.title)).toEqual([
      "Voraussetzungen",
      "Schritte",
      "Probleme",
    ]);
    expect(structure.folding).toBe(true);
    expect(structure.kind).toBe("steps");
  });

  it("bevorzugt die Kurzfassung und lässt den Text davor stehen", () => {
    const structure = structureKnowledgeArticle(
      "Einleitung.\n\n## A\nText",
      "Kurz.",
    );
    expect(structure.lead).toBe("Kurz.");
    expect(structure.intro).toBe("Einleitung.");
    expect(structure.folding).toBe(false);
  });

  it("nimmt keine Liste und keine Überschrift als «Kurz gesagt»", () => {
    expect(structureKnowledgeArticle("- eins\n- zwei", null).lead).toBe("");
    expect(
      structureKnowledgeArticle("Hinweis: Vorsicht\n\nText", null).lead,
    ).toBe("");
  });

  it("erkennt FAQ, Störung, Referenz und Information", () => {
    expect(
      structureKnowledgeArticle(
        "## Wie geht das?\na\n\n## Was kostet es?\nb",
        null,
      ).kind,
    ).toBe("faq");
    expect(
      structureKnowledgeArticle(
        "## Symptom\na\n\n## Ursache\nb\n\n## Lösung\nc",
        null,
      ).kind,
    ).toBe("trouble");
    expect(
      structureKnowledgeArticle("| A | B |\n| --- | --- |\n| 1 | 2 |", null)
        .kind,
    ).toBe("reference");
    expect(structureKnowledgeArticle("Nur ein Absatz.", null).kind).toBe(
      "info",
    );
  });

  it("ignoriert Überschriften in Codeblöcken", () => {
    const structure = structureKnowledgeArticle(
      "Text\n\n```\n## kein Abschnitt\n```\n\n## Echt\nx",
      null,
    );
    expect(structure.sections.map((section) => section.title)).toEqual([
      "Echt",
    ]);
  });

  it("schätzt die Lesezeit", () => {
    expect(knowledgeReadingMinutes("wort ".repeat(450))).toBe(2);
    expect(knowledgeReadingMinutes("")).toBe(1);
  });
});
