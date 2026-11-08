import { describe, expect, it } from "vitest";

import {
  parseHandbook,
  parseHandbookBlocks,
  parseHandbookInline,
  parseHandbookList,
} from "../lib/handbooks-model";

const summary = {
  id: "mitarbeitende",
  title: "Handbuch für Mitarbeitende",
  description: "Anliegen melden",
  audienceLabel: "Mitarbeitende",
  updatedAt: "2026-11-08",
};

describe("handbook responses", () => {
  it("parses the list and a single handbook", () => {
    expect(parseHandbookList({ data: { handbooks: [summary] } })).toEqual([
      summary,
    ]);
    expect(
      parseHandbook({ data: { handbook: { ...summary, markdown: "Text" } } }),
    ).toEqual({ ...summary, markdown: "Text" });
  });

  it("rejects unknown ids and malformed payloads", () => {
    expect(() =>
      parseHandbookList({ data: { handbooks: [{ ...summary, id: "x" }] } }),
    ).toThrow();
    expect(() => parseHandbook({ data: { handbook: summary } })).toThrow();
  });
});

describe("parseHandbookBlocks", () => {
  it("turns the handbook Markdown subset into native blocks", () => {
    const image = "data:image/jpeg;base64,AAAA";
    const blocks = parseHandbookBlocks(
      [
        "# Titel",
        "",
        "## Anmelden",
        "",
        "Öffnen Sie die App",
        "im Browser.",
        "",
        "- **Mit SSO anmelden**",
        "- Anmeldelink",
        "",
        "1. Erstens",
        "   weiter",
        "2. Zweitens",
        "",
        "> Hinweis",
        "",
        "| Feld | Wert |",
        "| ---- | ---- |",
        "| Client-ID | `abc` |",
        "",
        "```text",
        "a=b",
        "```",
        "",
        `![Anmeldeseite](${image})`,
      ].join("\n"),
    );
    expect(blocks).toEqual([
      { kind: "heading", level: 2, text: "Anmelden" },
      { kind: "paragraph", text: "Öffnen Sie die App im Browser." },
      {
        kind: "list",
        ordered: false,
        items: ["**Mit SSO anmelden**", "Anmeldelink"],
      },
      { kind: "list", ordered: true, items: ["Erstens weiter", "Zweitens"] },
      { kind: "quote", text: "Hinweis" },
      {
        kind: "table",
        header: ["Feld", "Wert"],
        rows: [["Client-ID", "`abc`"]],
      },
      { kind: "code", text: "a=b" },
      { kind: "image", alt: "Anmeldeseite", uri: image },
    ]);
  });

  it("ignores images that are not embedded screenshots", () => {
    expect(
      parseHandbookBlocks("![x](https://example.com/a.png)")[0]?.kind,
    ).toBe("paragraph");
  });
});

describe("parseHandbookInline", () => {
  it("splits bold, italic, code and keeps link labels", () => {
    expect(
      parseHandbookInline(
        "Klicken **Speichern**, *nicht* `x` [Hilfe](https://a.b)",
      ),
    ).toEqual([
      { text: "Klicken " },
      { text: "Speichern", bold: true },
      { text: ", " },
      { text: "nicht", italic: true },
      { text: " " },
      { text: "x", code: true },
      { text: " Hilfe" },
    ]);
  });
});
