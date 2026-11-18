import {
  buildOnboardingTasks,
  looksLikeOnboardingPdf,
  parseOnboardingPdf,
  parseSwissDate,
  type PdfTextItem,
} from "./onboarding-pdf-intake.ts";

// Text und Koordinaten einer echten Eintrittsmeldung (Power Apps, zwei Seiten),
// mit erfundenen Namen.
const ITEMS: PdfTextItem[] = [
  { page: 1, text: "Ausgefüllt von:", x: 40, y: 759 },
  { page: 1, text: "Zusammmenfassung E intritt", x: 43, y: 785 },
  { page: 1, text: "Arbeitnehmer: (Vor- Nachname)", x: 40, y: 737 },
  { page: 1, text: "Hans Muster", x: 233, y: 759 },
  { page: 1, text: "Erika Muster-Beispiel", x: 233, y: 737 },
  { page: 1, text: "Eintritt per", x: 40, y: 715 },
  { page: 1, text: "16.10.2026", x: 233, y: 715 },
  { page: 1, text: "unbefristet", x: 42, y: 688 },
  { page: 1, text: "nein", x: 116, y: 688 },
  { page: 1, text: "befristet", x: 182, y: 688 },
  { page: 1, text: "ja", x: 245, y: 688 },
  { page: 1, text: "bis", x: 283, y: 688 },
  { page: 1, text: "02.07.2027", x: 306, y: 688 },
  { page: 1, text: "F unktion 1", x: 43, y: 643 },
  { page: 1, text: "Therapie", x: 141, y: 600 },
  { page: 1, text: "FD_THE_Logopädie", x: 144, y: 570 },
  {
    page: 1,
    text: "5.7 Päd. Therapeut*in Logopädie / Psychomotorik / Psychotherapie FH/UNI",
    x: 140,
    y: 539,
  },
  { page: 1, text: "Angebot/", x: 43, y: 607 },
  { page: 1, text: "Abteilung", x: 43, y: 592 },
  { page: 1, text: "Team", x: 43, y: 568 },
  { page: 1, text: "Funktion", x: 43, y: 539 },
  { page: 1, text: "SPIA, Praktikum,", x: 43, y: 506 },
  { page: 1, text: "Lernende, Ziv", x: 43, y: 491 },
  { page: 1, text: "F unktion 2", x: 43, y: 453 },
  { page: 1, text: "Angebot/", x: 43, y: 414 },
  { page: 1, text: "Abteilung", x: 43, y: 398 },
  { page: 1, text: "Team", x: 43, y: 380 },
  { page: 1, text: "Funktion", x: 43, y: 351 },
  { page: 1, text: "SPIA, Praktikum,", x: 43, y: 319 },
  { page: 1, text: "Lernende, Ziv", x: 43, y: 303 },
  { page: 1, text: "Weitere Angaben Infrastruktur und IC T:", x: 39, y: 259 },
  { page: 1, text: "Schlüssel", x: 43, y: 223 },
  { page: 1, text: "ja", x: 171, y: 223 },
  { page: 1, text: "Raumnummer", x: 43, y: 104 },
  { page: 1, text: "N1 05 Büro Team", x: 166, y: 104 },
  { page: 1, text: "ICT Ausstattung", x: 43, y: 76 },
  { page: 1, text: "Keine Ausstattung", x: 166, y: 77 },
  { page: 1, text: "Berufsbezeichnung", x: 45, y: 193 },
  { page: 1, text: "Logopäde*in", x: 168, y: 193 },
  { page: 1, text: "Geschlecht", x: 45, y: 136 },
  { page: 1, text: "weiblich", x: 168, y: 136 },
  { page: 1, text: "driekten Vorgesetzten", x: 45, y: 165 },
  { page: 1, text: "Petra Beispiel", x: 168, y: 165 },
  { page: 2, text: "ICT Zugänge", x: 43, y: 759 },
  { page: 2, text: "Keine Software", x: 166, y: 760 },
  { page: 2, text: "Gruppenpostfächer", x: 43, y: 697 },
  { page: 2, text: "Petra Beispiel", x: 166, y: 698 },
  { page: 2, text: "Doppelnamen", x: 43, y: 569 },
  { page: 2, text: "Ja", x: 166, y: 569 },
  { page: 2, text: "Doppelnamen", x: 45, y: 538 },
  { page: 2, text: "erika.beispiel", x: 168, y: 538 },
  { page: 2, text: "Bemerkung", x: 39, y: 507 },
  {
    page: 2,
    text: "direkte Vorgesetzte ist Hans Muster (kann man nicht auswählen).",
    x: 43,
    y: 474,
  },
  {
    page: 2,
    text: "Zugänge: Escola, Lohnabrechnung (Abacus), Mobatime (Stunden rapportieren)",
    x: 43,
    y: 460,
  },
];

function assertEquals(actual: unknown, expected: unknown, message: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message}: erwartet ${JSON.stringify(expected)}, erhalten ${JSON.stringify(actual)}`,
    );
  }
}

Deno.test("die Eintrittsmeldung wird vollständig gelesen", () => {
  const data = parseOnboardingPdf(ITEMS);
  if (!data) throw new Error("Eintrittsmeldung nicht erkannt");
  assertEquals(data.employeeName, "Erika Muster-Beispiel", "Name");
  assertEquals(data.startDate, "2026-10-16", "Eintritt");
  assertEquals(data.fixedTerm, true, "befristet");
  assertEquals(data.endDate, "2027-07-02", "Ende");
  assertEquals(data.filledBy, "Hans Muster", "ausgefüllt von");
  assertEquals(data.functions.length, 1, "nur die ausgefüllte Funktion");
  assertEquals(data.functions[0]?.offer, "Therapie", "Angebot");
  assertEquals(data.functions[0]?.team, "FD_THE_Logopädie", "Team");
  assertEquals(data.needsKey, true, "Schlüssel");
  assertEquals(data.supervisor, "Petra Beispiel", "Vorgesetzte Person");
  assertEquals(data.room, "N1 05 Büro Team", "Raum");
  assertEquals(data.groupMailboxes, "Petra Beispiel", "Gruppenpostfächer");
  assertEquals(data.doubleName, true, "Doppelname");
  assertEquals(data.aliasName, "erika.beispiel", "Alias");
  if (!data.remarks?.includes("Mobatime")) {
    throw new Error("Die Bemerkung wurde nicht vollständig gelesen");
  }
});

Deno.test("aus den Angaben entstehen die zusätzlichen Aufgaben", () => {
  const data = parseOnboardingPdf(ITEMS);
  if (!data) throw new Error("Eintrittsmeldung nicht erkannt");
  const titles = buildOnboardingTasks(data).map((task) => task.title);
  for (const expected of [
    "E-Mail-Alias für Doppelnamen einrichten: erika.beispiel",
    "Gruppenpostfächer berechtigen: Petra Beispiel",
    "Schlüssel bereitstellen: N1 05 Büro Team",
  ]) {
    if (!titles.includes(expected))
      throw new Error(`Aufgabe fehlt: ${expected}`);
  }
  if (titles.some((title) => title.startsWith("ICT-Ausstattung"))) {
    throw new Error('Bei "Keine Ausstattung" darf keine Aufgabe entstehen');
  }
});

Deno.test("fremde PDFs werden nicht als Eintritt erkannt", () => {
  assertEquals(
    parseOnboardingPdf([{ page: 1, text: "Rechnung 4711", x: 40, y: 700 }]),
    null,
    "fremdes PDF",
  );
  assertEquals(
    looksLikeOnboardingPdf("Zusammmenfassung E intritt"),
    true,
    "Titel mit Tippfehler",
  );
});

Deno.test("Datumsangaben werden geprüft", () => {
  assertEquals(parseSwissDate("16.10.2026"), "2026-10-16", "gültiges Datum");
  assertEquals(parseSwissDate("31.02.2026"), null, "ungültiges Datum");
  assertEquals(parseSwissDate(""), null, "leer");
});

Deno.test(
  "der Eintritts-Intake läuft erst nach der Anhangsspeicherung",
  async () => {
    const source = await Deno.readTextFile(
      new URL("./exchange-mail-processing.ts", import.meta.url),
    );
    const attachments = source.indexOf("if (inboundAttachments.length > 0)");
    const intake = source.indexOf(
      "await processOnboardingEmailTicketIntake(admin",
    );
    if (attachments < 0 || intake < 0 || intake < attachments) {
      throw new Error(
        "Der Eintritts-Intake darf das Ticket erst entfernen, wenn die Anhänge gespeichert sind.",
      );
    }
  },
);

// Neueres Layout der Personal-App: drei Funktionen, Badge neben dem Schlüssel,
// Standort statt Raumnummer (Koordinaten wie im echten PDF, Daten erfunden).
const NEWER_LAYOUT: PdfTextItem[] = [
  { page: 1, text: "Zusammmenfassung E intritt", x: 43, y: 785 },
  { page: 1, text: "Ausgefüllt von:", x: 40, y: 759 },
  { page: 1, text: "Petra Beispiel", x: 233, y: 759 },
  { page: 1, text: "Arbeitnehmer: (Vor- Nachname)", x: 40, y: 737 },
  { page: 1, text: "Max Muster", x: 233, y: 737 },
  { page: 1, text: "Eintritt per", x: 40, y: 715 },
  { page: 1, text: "01.01.2027", x: 233, y: 715 },
  { page: 1, text: "unbefristet", x: 42, y: 687 },
  { page: 1, text: "Nein", x: 116, y: 687 },
  { page: 1, text: "befristet", x: 181, y: 687 },
  { page: 1, text: "Ja", x: 238, y: 687 },
  { page: 1, text: "bis", x: 282, y: 687 },
  { page: 1, text: "31.12.2027", x: 323, y: 687 },
  { page: 1, text: "F unktion 1", x: 43, y: 622 },
  { page: 1, text: "Team", x: 43, y: 595 },
  { page: 1, text: "TEAM_A", x: 141, y: 597 },
  { page: 1, text: "Funktion", x: 43, y: 566 },
  { page: 1, text: "Fachlehrperson", x: 141, y: 566 },
  { page: 1, text: "F unktion 2", x: 43, y: 535 },
  { page: 1, text: "Team", x: 43, y: 509 },
  { page: 1, text: "F unktion 3", x: 43, y: 450 },
  { page: 1, text: "Team", x: 43, y: 424 },
  { page: 1, text: "Schlüssel", x: 43, y: 324 },
  { page: 1, text: "Ja", x: 171, y: 324 },
  { page: 1, text: "Badge", x: 218, y: 324.5 },
  { page: 1, text: "Ja", x: 298, y: 324.5 },
  { page: 1, text: "Standort", x: 45, y: 292 },
  { page: 1, text: "Baar (Landhausstrasse)", x: 168, y: 293 },
  { page: 1, text: "ICT Ausstattung", x: 43, y: 263 },
  { page: 1, text: "Notebook", x: 166, y: 265 },
];

Deno.test("das neuere Layout mit Badge und Standort wird gelesen", () => {
  const data = parseOnboardingPdf(NEWER_LAYOUT);
  assertEquals(data?.employeeName, "Max Muster", "data?.employeeName");
  assertEquals(data?.startDate, "2027-01-01", "data?.startDate");
  assertEquals(data?.fixedTerm, true, "data?.fixedTerm");
  assertEquals(data?.endDate, "2027-12-31", "data?.endDate");
  assertEquals(data?.needsKey, true, "data?.needsKey");
  assertEquals(data?.needsBadge, true, "data?.needsBadge");
  assertEquals(data?.location, "Baar (Landhausstrasse)", "data?.location");
  assertEquals(data?.functions, [
    { offer: "", role: "Fachlehrperson", special: "", team: "TEAM_A" },
  ], "data?.functions");
  const titles = buildOnboardingTasks(data!).map((task) => task.title);
  assertEquals(titles.includes("Badge bereitstellen: Baar (Landhausstrasse)"), true, "Badge");
  assertEquals(titles.includes("Schlüssel bereitstellen: Baar (Landhausstrasse)"), true, "Schlüssel");
});
