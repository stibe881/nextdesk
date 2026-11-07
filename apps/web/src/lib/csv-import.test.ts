import { describe, expect, it } from "vitest";
import {
  guessMapping,
  normalizeDate,
  normalizeNumber,
  parseCsv,
  prepareRows,
  type ImportField,
} from "./csv-import";

const fields: ImportField[] = [
  {
    key: "name",
    label: "Name",
    required: true,
    aliases: ["bezeichnung", "gerät"],
  },
  {
    key: "category",
    label: "Kategorie",
    required: true,
    aliases: ["typ"],
    type: "enum",
    options: { switch: ["switch"], access_point: ["access point", "ap"] },
  },
  {
    key: "warrantyUntil",
    label: "Garantie bis",
    aliases: ["garantie"],
    type: "date",
  },
  {
    key: "purchasePrice",
    label: "Kaufpreis",
    aliases: ["preis"],
    type: "number",
  },
];

describe("csv import", () => {
  it("parses semicolon CSV with quotes and BOM", () => {
    const table = parseCsv(
      '﻿Bezeichnung;Typ;Notiz\n"AP ""Büro"" 1";AP;"a;b"\n\nSW1;Switch;\n',
    );
    expect(table.headers).toEqual(["Bezeichnung", "Typ", "Notiz"]);
    expect(table.rows).toEqual([
      ['AP "Büro" 1', "AP", "a;b"],
      ["SW1", "Switch", ""],
    ]);
  });

  it("guesses the mapping from headers", () => {
    expect(guessMapping(["Gerät", "Typ", "Garantie", "Preis"], fields)).toEqual(
      {
        name: 0,
        category: 1,
        warrantyUntil: 2,
        purchasePrice: 3,
      },
    );
  });

  it("normalises Swiss dates and numbers", () => {
    expect(normalizeDate("31.03.2028")).toBe("2028-03-31");
    expect(normalizeDate("1.4.27")).toBe("2027-04-01");
    expect(normalizeDate("31.02.2028")).toBeNull();
    expect(normalizeNumber("1'234.50")).toBe(1234.5);
    expect(normalizeNumber("CHF 349,90")).toBe(349.9);
    expect(normalizeNumber("1.234,50")).toBe(1234.5);
    expect(normalizeNumber("abc")).toBeNull();
  });

  it("reports row errors with line numbers", () => {
    const table = parseCsv(
      "Name;Typ;Garantie\nSW1;Router;31.13.2028\n;switch;",
    );
    const rows = prepareRows(
      table,
      fields,
      guessMapping(table.headers, fields),
    );
    expect(rows[0]!.line).toBe(2);
    expect(rows[0]!.errors).toEqual([
      "Kategorie: «Router» ist unbekannt",
      "Garantie bis: «31.13.2028» ist kein Datum",
    ]);
    expect(rows[1]!.errors).toEqual(["Name fehlt"]);
    expect(rows[1]!.values.category).toBe("switch");
  });
});
