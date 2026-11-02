import { getDocumentProxy } from "npm:unpdf@1.9.1";
import type { PdfTextItem } from "./onboarding-pdf-intake.ts";

const MAX_PAGES = 6;

/** Liest den Text eines PDFs mit Koordinaten (Seite, x, y je Textstück). */
export async function extractPdfTextItems(
  bytes: Uint8Array,
): Promise<PdfTextItem[]> {
  // pdf.js darf den Puffer übernehmen; die Anhänge bleiben unverändert.
  const document = await getDocumentProxy(new Uint8Array(bytes));
  const items: PdfTextItem[] = [];
  const pages = Math.min(document.numPages, MAX_PAGES);
  for (let page = 1; page <= pages; page += 1) {
    const content = await (await document.getPage(page)).getTextContent();
    for (const item of content.items) {
      if (
        "str" in item &&
        typeof item.str === "string" &&
        item.str.trim() !== "" &&
        Array.isArray(item.transform)
      ) {
        items.push({
          page,
          text: item.str,
          x: Number(item.transform[4]),
          y: Number(item.transform[5]),
        });
      }
    }
  }
  return items;
}
