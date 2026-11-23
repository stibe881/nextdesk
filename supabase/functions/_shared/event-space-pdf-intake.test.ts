import { assertEquals } from "jsr:@std/assert@1";
import {
  eventOrderIntakeInput,
  parseEventOrderPdf,
  type EventPdfTextItem,
} from "./event-space-pdf-intake.ts";
import { parseEventSpaceEmailIntake } from "./event-space-email-intake.ts";

// Positionen wie im PDF «Anlassdetails» der Anlässe-App (gekürzt).
const rows: [number, number, [number, string][]][] = [
  [1, 783, [[516, "ID 235"]]],
  [1, 782, [[39, "Allgmeine Details AnlassWeihnachtesessen Angebot Sehen"]]],
  [1, 755, [[39, "Anlassname"]]],
  [1, 754, [[288, "Weihnachtesessen Angebot Sehen"]]],
  [
    1,
    728,
    [
      [39, "Anlasstyp:"],
      [288, "Angebots-Anlass"],
    ],
  ],
  [
    1,
    707,
    [
      [39, "Kostenstellen verantwortliche Person Mail:"],
      [288, "c.f@example.test"],
    ],
  ],
  [1, 569, [[39, "Anlassdatum:"]]],
  [1, 568, [[242, "10.12.2026"]]],
  [
    1,
    548,
    [
      [39, "Anzahl Personen:"],
      [242, "20"],
    ],
  ],
  [1, 527, [[39, "Ort / Örtlichkeit:"]]],
  [1, 526, [[242, "S1 01 Cafeteria"]]],
  [1, 500, [[39, "Ort / Örtlichkeit Andere:"]]],
  [
    1,
    481,
    [
      [39, "Zeit Beginn Anlass:"],
      [272, ":"],
    ],
  ],
  [
    1,
    480,
    [
      [242, "17"],
      [288, "00"],
    ],
  ],
  [
    1,
    454,
    [
      [39, "Zeit Ende Anlass:"],
      [242, "22"],
      [272, ":"],
      [288, "00"],
    ],
  ],
  [
    1,
    428,
    [
      [39, "Kostenstelle Intern"],
      [250, "82100"],
    ],
  ],
  [
    1,
    401,
    [
      [39, "Raummiete"],
      [250, "Nein"],
    ],
  ],
  [1, 339, [[39, "Details Infrastruktur"]]],
  [1, 310, [[39, "Bestuhlung:"]]],
  [1, 309, [[242, "Keine"]]],
  [
    1,
    286,
    [
      [39, "Anzahl Stühle:"],
      [226, "12"],
    ],
  ],
  [
    1,
    262,
    [
      [39, "Anzahl Tische:"],
      [226, "0"],
    ],
  ],
  [1, 132, [[39, "Details ICT"]]],
  [1, 102, [[39, "ICT Material:"]]],
  [
    1,
    73,
    [
      [39, "Beamer:"],
      [242, "Ja"],
    ],
  ],
  [1, 43, [[39, "Leinwand:"]]],
  [2, 783, [[39, "Mikrofon:"]]],
  [2, 754, [[39, "Empfangslaptop:"]]],
  [2, 694, [[39, "Zugang Internet:"]]],
  [2, 668, [[39, "Details Service"]]],
  [2, 481, [[39, "Bemerkung"]]],
  [2, 460, [[39, "Bitte Tische festlich decken"]]],
  [2, 261, [[39, "Infobildschirm"]]],
  [3, 780, [[39, "Zusammenfassung Bestellung Artikel Gastro"]]],
  [
    3,
    754,
    [
      [43, "Artikel"],
      [262, "Menge"],
      [333, "Preis/Artikel"],
      [464, "Total/Artikel"],
    ],
  ],
  [3, 703, [[44, "Weisswein 0.75 lt."]]],
  [
    3,
    702,
    [
      [285, "4"],
      [377, "19,00"],
      [498, "76,00"],
    ],
  ],
  [4, 565, [[39, "Totale Kosten Essens- und Getränkebestellung"]]],
  [4, 527, [[323, "76,00 CHF"]]],
];
const items: EventPdfTextItem[] = rows.flatMap(([page, y, parts]) =>
  parts.map(([x, text]) => ({ page, x, y, text })),
);

Deno.test("Anlass-Bestellung aus dem PDF wird gelesen und eingeplant", () => {
  const order = parseEventOrderPdf(items);
  assertEquals(order?.orderId, "235");
  assertEquals(order?.date, "2026-12-10");
  assertEquals(order?.startTime, "17:00");
  assertEquals(order?.endTime, "22:00");
  assertEquals(order?.location, "S1 01 Cafeteria");
  assertEquals(order?.infrastructure, ["Stühle: 12"]);
  assertEquals(order?.articles, ["4× Weisswein 0.75 lt."]);
  assertEquals(order?.remarks, "Bitte Tische festlich decken");
  const input = eventOrderIntakeInput(order!, "Claudia Friedli");
  const parsed = parseEventSpaceEmailIntake({
    subject: input.subject,
    description: input.description,
  });
  assertEquals(parsed.status, "ready");
  if (parsed.status !== "ready") return;
  assertEquals(parsed.request.sourceOrderNumber, "Anlass-235");
  assertEquals(parsed.request.startAt, "2026-12-10T16:00:00.000Z");
  assertEquals(parsed.request.equipmentKeys.length > 0, true);
});

Deno.test("andere PDFs sind keine Anlass-Bestellung", () => {
  assertEquals(
    parseEventOrderPdf([{ page: 1, x: 10, y: 10, text: "Rechnung Nr. 5" }]),
    null,
  );
});

Deno.test(
  "Mail «Neue Bestellung Einrichten Anlässe» wird gelesen",
  async () => {
    const { parseEventOrderText, eventOrderSubjectTitle } =
      await import("./event-space-pdf-intake.ts");
    const body = `Hallo ICT Team

Es gibt eine neue Bestellung für Anlässe und Veranstaltungen von Franziska Elmer

Angaben Allgemeine

Anlassname: Führungskompetenz 4.0
Anlassdatum: 03.12.2026
Ort Räumlichkeiten: A1 10 Empfang Nord
Zeit Beginn: 13:00/ Zeit Ende: 17:00
Anzahl Personen: 10

Angaben ICT

Beamer: Ja
Leinwand: Ja
Mikrofon: Nein
Empfangslaptop: Nein
Presenter: Ja
Zugang Internet: Ja

Angaben Einrichtung

Redner*innenpult: Nein

Bestuhlung: U-Form
Anzahl Stühle: 14
Anzahl Tische: 8

Bemerkungen: U-Form vorne mit Tisch/Stühlen für 10 Personen.
Hinten zwei Tische plus 4 Stühle als Block.`;
    const order = parseEventOrderText(
      "Neue Bestellung Einrichten Anlässe 234",
      body,
    );
    assertEquals(order?.orderId, "234");
    assertEquals(order?.title, "Führungskompetenz 4.0");
    assertEquals(order?.startTime, "13:00");
    assertEquals(order?.endTime, "17:00");
    assertEquals(order?.location, "A1 10 Empfang Nord");
    assertEquals(order?.costCenterEmail, "Franziska Elmer");
    assertEquals(order?.infrastructure, [
      "Bestuhlung: U-Form",
      "Stühle: 14",
      "Tische: 8",
    ]);
    assertEquals(
      order?.remarks,
      "U-Form vorne mit Tisch/Stühlen für 10 Personen.\nHinten zwei Tische plus 4 Stühle als Block.",
    );
    const input = eventOrderIntakeInput(order!, "Franziska Elmer");
    const parsed = parseEventSpaceEmailIntake({
      subject: input.subject,
      description: input.description,
    });
    assertEquals(parsed.status, "ready");
    if (parsed.status === "ready") {
      assertEquals(parsed.request.requirements.projector, true);
      assertEquals(parsed.request.requirements.microphone, false);
      assertEquals(parsed.request.requirements.internetAccess, true);
    }
    assertEquals(
      eventOrderSubjectTitle(
        "WG: Bestellung Anlässe Essen und Einrichten für Anlass Führungskompetenz 4.0",
      ),
      "Führungskompetenz 4.0",
    );
    assertEquals(parseEventOrderText("Neue Bestellung Drucker 5", body), null);
  },
);

Deno.test("Anlass mit Endzeit wird mit ganzer Dauer geplant", async () => {
  const { eventOrderEndAt } = await import("./event-space-email-ticket-intake.ts");
  assertEquals(
    eventOrderEndAt("2026-12-10T16:00:00.000Z", { startTime: "17:00", endTime: "22:00" }),
    "2026-12-10T21:00:00.000Z",
  );
  assertEquals(
    eventOrderEndAt("2026-12-10T16:00:00.000Z", { startTime: "17:00", endTime: null }),
    null,
  );
  assertEquals(
    eventOrderEndAt("2026-12-10T16:00:00.000Z", { startTime: "17:00", endTime: "16:00" }),
    null,
  );
});
