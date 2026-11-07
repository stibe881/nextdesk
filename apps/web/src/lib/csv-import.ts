/**
 * CSV import: parsing (delimiter detection, quotes, BOM), column mapping with
 * guessed defaults and value normalisation (Swiss dates and numbers).
 */

export type CsvTable = { headers: string[]; rows: string[][] };

export type ImportField = {
  key: string;
  label: string;
  required?: boolean;
  /** Header names that map to this field automatically (lower case). */
  aliases: string[];
  type?: "text" | "date" | "number" | "integer" | "enum";
  /** Allowed values (key → accepted spellings, lower case). */
  options?: Record<string, string[]>;
  maxLength?: number;
};

export type Mapping = Record<string, number | null>;

export type PreparedRow = {
  line: number;
  values: Record<string, string | number | null>;
  errors: string[];
};

function detectDelimiter(firstLine: string): string {
  const counts = [";", ",", "\t"].map((delimiter) => ({
    delimiter,
    count: firstLine.split(delimiter).length - 1,
  }));
  counts.sort((a, b) => b.count - a.count);
  return counts[0]!.count > 0 ? counts[0]!.delimiter : ";";
}

export function parseCsv(input: string): CsvTable {
  const text = input.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const firstLine = text.split("\n", 1)[0] ?? "";
  const delimiter = detectDelimiter(firstLine);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index]!;
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index++;
        } else {
          quoted = false;
        }
      } else {
        cell += character;
      }
    } else if (character === '"' && cell === "") {
      quoted = true;
    } else if (character === delimiter) {
      row.push(cell);
      cell = "";
    } else if (character === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const nonEmpty = rows.filter((entry) => entry.some((value) => value.trim()));
  const [headers = [], ...body] = nonEmpty;
  return {
    headers: headers.map((header) => header.trim()),
    rows: body.map((entry) => entry.map((value) => value.trim())),
  };
}

const normalizeHeader = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "");

/** Maps every field to the first header that matches its label or aliases. */
export function guessMapping(
  headers: string[],
  fields: ImportField[],
): Mapping {
  const normalized = headers.map(normalizeHeader);
  const used = new Set<number>();
  const mapping: Mapping = {};
  for (const field of fields) {
    const candidates = [field.key, field.label, ...field.aliases].map(
      normalizeHeader,
    );
    const index = normalized.findIndex(
      (header, position) => !used.has(position) && candidates.includes(header),
    );
    mapping[field.key] = index >= 0 ? index : null;
    if (index >= 0) used.add(index);
  }
  return mapping;
}

/** «31.03.2028», «31.3.28», «2028-03-31» → «2028-03-31». */
export function normalizeDate(value: string): string | null {
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  const swiss = /^(\d{1,2})[./](\d{1,2})[./](\d{2}|\d{4})$/.exec(value);
  let year: number;
  let month: number;
  let day: number;
  if (iso) {
    [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  } else if (swiss) {
    day = Number(swiss[1]);
    month = Number(swiss[2]);
    year = Number(swiss[3]);
    if (year < 100) year += 2000;
  } else {
    return null;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

/** «1'234.50», «1234,50», «CHF 349.90» → number. */
export function normalizeNumber(value: string): number | null {
  let cleaned = value.replace(/chf|fr\.?|\s|'|’/gi, "");
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(cleaned)) {
    cleaned = cleaned.replace(/\./g, "").replace(",", ".");
  } else {
    cleaned = cleaned.replace(",", ".");
  }
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  return Number(cleaned);
}

export function prepareRows(
  table: CsvTable,
  fields: ImportField[],
  mapping: Mapping,
): PreparedRow[] {
  return table.rows.map((row, index) => {
    const values: PreparedRow["values"] = {};
    const errors: string[] = [];
    for (const field of fields) {
      const column = mapping[field.key];
      const raw =
        column === null || column === undefined ? "" : (row[column] ?? "");
      if (!raw) {
        values[field.key] = null;
        if (field.required) errors.push(`${field.label} fehlt`);
        continue;
      }
      if (field.maxLength && raw.length > field.maxLength) {
        errors.push(`${field.label} ist zu lang`);
        continue;
      }
      switch (field.type) {
        case "date": {
          const date = normalizeDate(raw);
          if (!date) errors.push(`${field.label}: «${raw}» ist kein Datum`);
          values[field.key] = date;
          break;
        }
        case "number":
        case "integer": {
          const number = normalizeNumber(raw);
          if (
            number === null ||
            (field.type === "integer" && !Number.isInteger(number))
          ) {
            errors.push(`${field.label}: «${raw}» ist keine Zahl`);
            values[field.key] = null;
          } else {
            values[field.key] = number;
          }
          break;
        }
        case "enum": {
          const needle = raw.toLowerCase().trim();
          const match = Object.entries(field.options ?? {}).find(
            ([key, spellings]) => key === needle || spellings.includes(needle),
          );
          if (!match) errors.push(`${field.label}: «${raw}» ist unbekannt`);
          values[field.key] = match ? match[0] : null;
          break;
        }
        default:
          values[field.key] = raw;
      }
    }
    return { line: index + 2, values, errors };
  });
}
