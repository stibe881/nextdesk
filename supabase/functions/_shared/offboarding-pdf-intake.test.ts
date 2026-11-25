import {
  buildOffboardingTasks,
  looksLikeOffboardingPdf,
  parseOffboardingPdf,
} from "./offboarding-pdf-intake.ts";
import type { PdfTextItem } from "./onboarding-pdf-intake.ts";

// Text und Koordinaten einer echten Austrittsmeldung (pdf.js, y von unten),
// mit erfundenen Namen. Der Wert zu «ICT Ausstattung» steht höher als seine
// Bezeichnung.
const ITEMS: PdfTextItem[] = [
  { page: 1, text: "Zusammenfassung Austritt", x: 43, y: 800 },
  { page: 1, text: "Ausgefüllt von:", x: 40, y: 753 },
  { page: 1, text: "Hans Muster", x: 233, y: 753 },
  { page: 1, text: "Arbeitnehmer: (Vor- Nachname)", x: 40, y: 725 },
  { page: 1, text: "Erika Muster", x: 233, y: 725 },
  { page: 1, text: "Personalnummer", x: 40, y: 695 },
  { page: 1, text: "1211", x: 233, y: 695 },
  { page: 1, text: "Austritt per", x: 40, y: 667 },
  { page: 1, text: "31.07.2026", x: 233, y: 667 },
  {
    page: 1,
    text: "Rückgabe ICT Zugänge / Material / Gruppenpostfächer",
    x: 43,
    y: 628,
  },
  { page: 1, text: "ICT Ausstattung", x: 44, y: 602 },
  { page: 1, text: "Notebook, Docking", x: 233, y: 594 },
  { page: 1, text: "Gruppenpostfächer", x: 44, y: 550 },
  {
    page: 1,
    text: "braucht auf keine Gruppenpostfächer zugriff",
    x: 233,
    y: 551,
  },
];

Deno.test("erkennt die Austrittsmeldung", () => {
  if (!looksLikeOffboardingPdf("Zusam menfassung  A ustritt"))
    throw new Error("x");
  if (looksLikeOffboardingPdf("Zusammenfassung Eintritt")) throw new Error("y");
});

Deno.test("liest Name, Austrittsdatum und Rückgabe", () => {
  const data = parseOffboardingPdf(ITEMS);
  if (!data) throw new Error("kein Ergebnis");
  if (data.employeeName !== "Erika Muster") throw new Error(data.employeeName);
  if (data.exitDate !== "2026-07-31") throw new Error(data.exitDate);
  if (data.filledBy !== "Hans Muster") throw new Error(String(data.filledBy));
  if (data.ictEquipment !== "Notebook, Docking")
    throw new Error(String(data.ictEquipment));
});

Deno.test("Aufgaben: «keine» ergibt keine Rückgabeaufgabe", () => {
  const data = parseOffboardingPdf(ITEMS)!;
  const titles = buildOffboardingTasks(data).map((task) => task.title);
  if (
    titles.length !== 2 ||
    !titles[0]!.startsWith("ICT-Ausstattung zurücknehmen")
  ) {
    throw new Error(titles.join("|"));
  }
});
