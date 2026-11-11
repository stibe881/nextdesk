/**
 * Reads an uploaded file into a workbook (sheet name → rows). XLSX is parsed
 * with read-excel-file, loaded only when needed (dynamic import).
 */

import { workbookFromCsv, workbookFromSheets } from "./ipam-import";
import type { Workbook } from "./ipam-import-model";

export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

function decodeText(buffer: ArrayBuffer): string {
  // Excel often saves CSV as Windows-1252; fall back when UTF-8 fails.
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder("windows-1252").decode(buffer);
  }
}

export function isSpreadsheetName(name: string): boolean {
  return /\.(xlsx|xlsm)$/i.test(name);
}

export async function readWorkbookFile(file: File): Promise<Workbook> {
  if (file.size > MAX_IMPORT_BYTES) {
    throw new Error("Die Datei ist zu gross (höchstens 10 MB).");
  }
  if (!isSpreadsheetName(file.name)) {
    if (/\.xls$/i.test(file.name)) {
      throw new Error(
        "Das alte Excel-Format (.xls) wird nicht unterstützt. Bitte speichern Sie die Datei als .xlsx oder .csv.",
      );
    }
    return workbookFromCsv(
      decodeText(await file.arrayBuffer()),
      file.name.replace(/\.[^.]+$/, "") || "CSV",
    );
  }
  const { default: readXlsxFile } = await import("read-excel-file/browser");
  const sheets = await readXlsxFile(file);
  return workbookFromSheets(
    sheets.map((sheet) => ({
      name: sheet.sheet,
      rows: sheet.data as unknown[][],
    })),
  );
}
