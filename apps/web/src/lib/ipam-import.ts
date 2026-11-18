/**
 * IPAM import entry point: detects the format of a workbook and returns the
 * normalized batch. Everything here is pure and runs in Node, so a workbook
 * can be converted without the browser:
 *
 *   import readXlsxFile from "read-excel-file/node";
 *   const sheets = await readXlsxFile("liste.xlsx");
 *   const workbook = workbookFromSheets(sheets.map((s) => ({ name: s.sheet, rows: s.data })));
 *   const batch = parseWorkbook(detectSource(workbook), workbook);
 */

import type { Mapping } from "./csv-import";
import { parseCsv } from "./csv-import";
import {
  type Cell,
  type ImportBatch,
  type ImportSource,
  type Workbook,
} from "./ipam-import-model";
import {
  detectTable,
  guessTableMapping,
  parseTable,
  tableFromRows,
  type Table,
  type TableFlavor,
  type TableTarget,
} from "./ipam-import-generic";
import {
  isAccessPointList,
  isSwitchList,
  parseAccessPointList,
  parseSwitchList,
} from "./ipam-import-inventory";
import {
  isSonnenbergWorkbook,
  parseSonnenbergWorkbook,
} from "./ipam-import-sonnenberg";

export * from "./ipam-import-model";
export {
  parseSonnenbergWorkbook,
  classifySheet,
} from "./ipam-import-sonnenberg";
export { parseSwitchList, parseAccessPointList } from "./ipam-import-inventory";
export {
  TABLE_FIELDS,
  TARGET_LABELS,
  detectTable,
  guessTableMapping,
  parseTable,
  tableFromRows,
  type Table,
  type TableFlavor,
  type TableTarget,
} from "./ipam-import-generic";

export const SOURCE_LABELS: Record<ImportSource, string> = {
  sonnenberg: "IP-Liste (Übersicht + Subnetzblätter)",
  switch_list: "Switch-Liste",
  aruba_ap: "Access-Point-Liste (Aruba)",
  generic: "Tabelle mit Spaltenzuordnung (CSV/XLSX)",
  phpipam: "phpIPAM-Export (CSV)",
  netbox: "NetBox-Export (CSV)",
};

/** Cells from read-excel-file (Date objects included) → plain cells. */
export function toCell(value: unknown): Cell {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  return String(value);
}

export function workbookFromSheets(
  sheets: { name: string; rows: unknown[][] }[],
): Workbook {
  const workbook: Workbook = {};
  for (const sheet of sheets) {
    workbook[sheet.name] = sheet.rows.map((row) => row.map(toCell));
  }
  return workbook;
}

/** CSV text → one-sheet workbook. */
export function workbookFromCsv(textContent: string, name = "CSV"): Workbook {
  const table = parseCsv(textContent);
  return { [name]: [table.headers, ...table.rows] };
}

/** Best guess of the source for a workbook. */
export function detectSource(workbook: Workbook): ImportSource {
  if (isSonnenbergWorkbook(workbook)) return "sonnenberg";
  if (isAccessPointList(workbook)) return "aruba_ap";
  if (isSwitchList(workbook)) return "switch_list";
  const first = Object.values(workbook)[0];
  const table = first ? tableFromRows(first) : null;
  if (table) {
    const { flavor } = detectTable(table.headers);
    if (flavor !== "generic") return flavor;
  }
  return "generic";
}

export type TableSelection = {
  sheet: string;
  target: TableTarget;
  mapping: Mapping;
};

/** Default table selection (first sheet with a header) for table sources. */
export function defaultTableSelection(
  workbook: Workbook,
): (TableSelection & { table: Table; flavor: TableFlavor }) | null {
  for (const [sheet, rows] of Object.entries(workbook)) {
    const table = tableFromRows(rows);
    if (!table) continue;
    const { flavor, target } = detectTable(table.headers);
    return {
      sheet,
      table,
      flavor,
      target,
      mapping: guessTableMapping(table.headers, target),
    };
  }
  return null;
}

/**
 * Parses a workbook. For table sources (generic, phpIPAM, NetBox) pass the
 * chosen sheet, target and mapping; without one the guessed defaults apply.
 */
export function parseWorkbook(
  source: ImportSource,
  workbook: Workbook,
  selection?: TableSelection,
): ImportBatch {
  switch (source) {
    case "sonnenberg":
      return parseSonnenbergWorkbook(workbook);
    case "switch_list":
      return parseSwitchList(workbook);
    case "aruba_ap":
      return parseAccessPointList(workbook);
    default: {
      const fallback = defaultTableSelection(workbook);
      const sheet = selection?.sheet ?? fallback?.sheet;
      const rows = sheet ? workbook[sheet] : undefined;
      const table = rows ? tableFromRows(rows) : null;
      if (!sheet || !table) {
        return parseTable(
          { headers: [], rows: [] },
          "addresses",
          {},
          { flavor: source, sheet: sheet ?? "Tabelle" },
        );
      }
      const target = selection?.target ?? fallback?.target ?? "addresses";
      const mapping =
        selection?.mapping ?? guessTableMapping(table.headers, target);
      return parseTable(table, target, mapping, { flavor: source, sheet });
    }
  }
}
