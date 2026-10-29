import {
  EVENT_SPACE_EMAIL_INTAKE_DURATION_MINUTES,
  parseEventSpaceEmailIntake,
  type EventSpaceEmailIntakeClarificationCode,
  type EventSpaceEmailIntakeResult,
} from "./event-space-email-intake.ts";
import { eventSpaceEmailIntakeBodyFromStoredTicket } from "./event-space-email-ticket-intake.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const validSubject = "Neuer Auftrag Einrichten RAUM-2026-42 für Team Workshop";
const validDescription = `Erstellende Person: Ada Beispiel
Anlassname: Team Workshop
Anlassdatum: 2026-11-03
Beginn:   09 : 30   Uhr
Ort: Seminarraum Nord
Raumreservation: JA
Telefonnummer: +41 44 555 00 00
ICT Material: yes
Zugang Internet: Nein
Zugang SOBE Netzwerk: ja
Beamer: Ja
Leinwand: Nein
Mikrofon: YES
Empfangslaptop: no
Bemerkung: Bestuhlung im Halbkreis
Link zum Auftrag: <https://example.sharepoint.com/:x:/r/sites/Team/auftrag>`;

function clarificationCodes(
  result: EventSpaceEmailIntakeResult,
): EventSpaceEmailIntakeClarificationCode[] {
  assert(
    result.status === "needs_clarification",
    "Der Parser hätte eine Klärung zurückgeben müssen.",
  );
  return result.clarifications.map((item) => item.code);
}

function descriptionWith(source: string, from: string, to: string): string {
  assert(source.includes(from), `Testfeld fehlt: ${from}`);
  return source.replace(from, to);
}

Deno.test(
  "parst ein vollständiges Raumticket deterministisch und ordnet nur bekannte Equipment-Schlüssel zu",
  () => {
    const result = parseEventSpaceEmailIntake({
      subject: validSubject,
      description: validDescription,
    });
    assert(
      result.status === "ready",
      "Das vollständige Ticket muss gültig sein.",
    );
    if (result.status !== "ready") return;

    assert(
      result.request.sourceOrderNumber === "RAUM-2026-42",
      "Die Antragsnummer muss aus dem Betreff stammen.",
    );
    assert(
      result.request.title === "Team Workshop",
      "Der Anlassname muss aus dem Betreff stammen.",
    );
    assert(
      result.request.organiser === "Ada Beispiel",
      "Die erstellende Person muss erfasst werden.",
    );
    assert(
      result.request.startAt === "2026-11-03T08:30:00.000Z",
      "09:30 Europe/Zurich muss im November korrekt nach UTC aufgelöst werden.",
    );
    assert(
      result.request.endAt === "2026-11-03T09:00:00.000Z",
      "Die Endzeit muss exakt 30 Minuten nach dem Beginn liegen.",
    );
    assert(
      result.request.durationMinutes ===
        EVENT_SPACE_EMAIL_INTAKE_DURATION_MINUTES,
      "Die feste Dauer muss in der Ausgabe erkennbar sein.",
    );
    assert(
      result.request.requestedSpaceText === "Seminarraum Nord",
      "Der Ort muss als unverbindlicher Raumtext erhalten bleiben.",
    );
    assert(
      result.request.contactPhone === "+41 44 555 00 00",
      "Die optionale Telefonnummer muss bei Angabe erhalten bleiben.",
    );
    assert(
      result.request.notes === "Bestuhlung im Halbkreis",
      "Die optionale Bemerkung muss bei Angabe erhalten bleiben.",
    );
    assert(
      result.request.orderUrl ===
        "https://example.sharepoint.com/:x:/r/sites/Team/auftrag",
      "Nur die syntaktisch geprüfte HTTPS-URL darf ausgegeben werden.",
    );
    assert(
      result.request.equipmentKeys.join(",") ===
        "connections,projector,microphones",
      "Nur eindeutig abbildbare positive Materialanforderungen dürfen Equipment-Schlüssel erzeugen.",
    );
    assert(
      result.request.requirements.internetAccess === false &&
        result.request.requirements.sobeNetworkAccess === true &&
        result.request.requirements.receptionLaptop === false,
      "Ja/Nein-Felder müssen whitespace- und gross-/kleinschreibungstolerant sein.",
    );
  },
);

Deno.test(
  "akzeptiert das reale Betreffformat und die ursprünglichen Formularetiketten",
  () => {
    const result = parseEventSpaceEmailIntake({
      subject: "Neuer Auftrag Einrichten 276 für Basismodul OM",
      description: `Erstellt von: Franziska Elmer
Anlassname: Basismodul OM
Anlassdatum (Jahr-Monat-Tag): 2026-11-11
Beginn Anlass Zeit: 14:00
Ort: A1 09 Aula
Raumreservation: Ja
Telefonnummer: 000 000 00 00
ICT Material: Ja
Zugang Internet: Ja
Zugang SOBE Netzwerk: Ja
Beamer: Ja
Leinwand: Ja
Mikrofon: Nein
Empfangslaptop: Nein`,
    });
    assert(
      result.status === "ready",
      "Das ursprüngliche Raumformular muss vollständig verarbeitet werden.",
    );
    if (result.status !== "ready") return;

    assert(
      result.request.sourceOrderNumber === "276" &&
        result.request.title === "Basismodul OM",
      "Auftragsnummer und Anlassname müssen aus dem Betreff stammen.",
    );
    assert(
      result.request.organiser === "Franziska Elmer",
      "«Erstellt von» muss als organisierende Person übernommen werden.",
    );
    assert(
      result.request.startAt === "2026-11-11T13:00:00.000Z" &&
        result.request.endAt === "2026-11-11T13:30:00.000Z",
      "Die Beginnzeit muss in Europe/Zurich mit fester Dauer verarbeitet werden.",
    );
  },
);

Deno.test(
  "akzeptiert vollständig geklammerte Altbetreffe weiterhin ohne Klammern in den Daten",
  () => {
    const result = parseEventSpaceEmailIntake({
      subject: "Neuer Auftrag Einrichten [RAUM-2026-42] für [Team Workshop]",
      description: validDescription,
    });
    assert(
      result.status === "ready",
      "Der Altbetreff muss weiter gültig sein.",
    );
    if (result.status !== "ready") return;
    assert(
      result.request.sourceOrderNumber === "RAUM-2026-42" &&
        result.request.title === "Team Workshop",
      "Altbetreffklammern dürfen nicht in den gespeicherten Werten bleiben.",
    );
  },
);

Deno.test("weist nur teilweise geklammerte Betreffe zurück", () => {
  const result = parseEventSpaceEmailIntake({
    subject: "Neuer Auftrag Einrichten [276] für Basismodul OM",
    description: validDescription,
  });
  assert(
    clarificationCodes(result).includes("subject_not_supported"),
    "Gemischte Betreffformate dürfen nicht mehrdeutig verarbeitet werden.",
  );
});

Deno.test("weist doppelt geklammerte Altbetreffe zurück", () => {
  const result = parseEventSpaceEmailIntake({
    subject: "Neuer Auftrag Einrichten [[276] für [Basismodul OM]",
    description: validDescription,
  });
  assert(
    clarificationCodes(result).includes("subject_not_supported"),
    "Nur vollständig und einfach geklammerte Altbetreffe dürfen gültig sein.",
  );
});

Deno.test(
  "weist einen Betreff ausserhalb des exakt erwarteten Formats zurück",
  () => {
    const result = parseEventSpaceEmailIntake({
      subject: `Re: ${validSubject}`,
      description: validDescription,
    });
    assert(
      clarificationCodes(result).includes("subject_not_supported"),
      "Ein abweichender Betreff muss eine Klärung auslösen.",
    );
  },
);

Deno.test(
  "fordert eine fehlende Beginnzeit ohne Teildaten zurückzugeben",
  () => {
    const result = parseEventSpaceEmailIntake({
      subject: validSubject,
      description: descriptionWith(
        validDescription,
        "Beginn:   09 : 30   Uhr\n",
        "",
      ),
    });
    const codes = clarificationCodes(result);
    assert(
      codes.includes("missing_start_time"),
      "Die fehlende Zeit muss benannt sein.",
    );
    assert(
      !("request" in result),
      "Bei Klärungsbedarf dürfen keine partiellen personenbezogenen Daten zurückgegeben werden.",
    );
  },
);

Deno.test("lehnt ein kalendarisch ungültiges Anlassdatum ab", () => {
  const result = parseEventSpaceEmailIntake({
    subject: validSubject,
    description: descriptionWith(
      validDescription,
      "Anlassdatum: 2026-11-03",
      "Anlassdatum: 2026-02-30",
    ),
  });
  assert(
    clarificationCodes(result).includes("invalid_date"),
    "Ein nicht existierendes Datum darf nicht normalisiert werden.",
  );
});

Deno.test(
  "weist doppelte Feldlabels als nicht eindeutiges Formular zurück",
  () => {
    const result = parseEventSpaceEmailIntake({
      subject: validSubject,
      description: `${validDescription}\nBeamer: Nein`,
    });
    assert(
      clarificationCodes(result).includes("duplicate_field"),
      "Doppelte Labels dürfen nicht nach Reihenfolge erraten werden.",
    );
  },
);

Deno.test("akzeptiert keinen Nicht-HTTPS-Link und ruft ihn nie ab", () => {
  const result = parseEventSpaceEmailIntake({
    subject: validSubject,
    description: descriptionWith(
      validDescription,
      "Link zum Auftrag: <https://example.sharepoint.com/:x:/r/sites/Team/auftrag>",
      "Link zum Auftrag: http://example.invalid/auftrag",
    ),
  });
  assert(
    clarificationCodes(result).includes("invalid_https_url"),
    "HTTP oder andere Linkformate dürfen nicht als Auftragslink ausgegeben werden.",
  );
});

Deno.test("fordert Klärung für eine nicht eindeutige Ja/Nein-Angabe", () => {
  const result = parseEventSpaceEmailIntake({
    subject: validSubject,
    description: descriptionWith(
      validDescription,
      "Beamer: Ja",
      "Beamer: Vielleicht",
    ),
  });
  assert(
    clarificationCodes(result).includes("invalid_yes_no"),
    "Unbekannte Ja/Nein-Werte dürfen nicht als Ja oder Nein geraten werden.",
  );
});

Deno.test(
  "lehnt eine in Europe/Zurich nicht existente Sommerzeit-Ortszeit ab",
  () => {
    const result = parseEventSpaceEmailIntake({
      subject: validSubject,
      description: descriptionWith(
        descriptionWith(
          validDescription,
          "Anlassdatum: 2026-11-03",
          "Anlassdatum: 2026-03-29",
        ),
        "Beginn:   09 : 30   Uhr",
        "Beginn: 02:30",
      ),
    });
    assert(
      clarificationCodes(result).includes("nonexistent_local_time"),
      "Eine Zeit in der Frühjahrs-Lücke darf nicht verschoben werden.",
    );
  },
);

Deno.test(
  "lehnt eine in Europe/Zurich doppeldeutige Winterzeit-Ortszeit ab",
  () => {
    const result = parseEventSpaceEmailIntake({
      subject: validSubject,
      description: descriptionWith(
        descriptionWith(
          validDescription,
          "Anlassdatum: 2026-11-03",
          "Anlassdatum: 2026-10-25",
        ),
        "Beginn:   09 : 30   Uhr",
        "Beginn: 02:30",
      ),
    });
    const codes = clarificationCodes(result);
    assert(
      codes.includes("ambiguous_local_time"),
      "Eine Zeit in der Herbst-Überlappung darf nicht einseitig aufgelöst werden.",
    );
    assert(
      !codes.includes("nonexistent_local_time"),
      "Die Herbst-Überlappung ist mehrdeutig, nicht nicht-existent.",
    );
  },
);

Deno.test(
  "gibt unbekannte strukturierte Felder ohne Werte in der Klärung zurück",
  () => {
    const sensitiveSentinel = "UNIQUE-SENSITIVE-VALUE-DO-NOT-ECHO";
    const result = parseEventSpaceEmailIntake({
      subject: validSubject,
      description: `${validDescription}\nAnderes Feld: ${sensitiveSentinel}`,
    });
    assert(
      clarificationCodes(result).includes("unknown_field"),
      "Unbekannte Feldlabels müssen eine Klärung auslösen.",
    );
    if (result.status !== "needs_clarification") return;
    assert(
      !JSON.stringify(result).includes(sensitiveSentinel),
      "Klärungsnachrichten dürfen keine eingereichten Werte spiegeln.",
    );
  },
);

Deno.test(
  "gleicht Betreff- und Formulargrenzen vor der Datenbankanlage ab",
  () => {
    const tooLongTitle = "A".repeat(241);
    const subjectResult = parseEventSpaceEmailIntake({
      subject: `Neuer Auftrag Einrichten [RAUM-42] für [${tooLongTitle}]`,
      description: validDescription,
    });
    assert(
      clarificationCodes(subjectResult).includes("subject_not_supported"),
      "Ein Betreff über der Titellänge der Datenbank muss vor der RPC eine Klärung ergeben.",
    );

    const formResult = parseEventSpaceEmailIntake({
      subject: validSubject,
      description: descriptionWith(
        validDescription,
        "Erstellende Person: Ada Beispiel",
        "Erstellende Person: A",
      ),
    });
    assert(
      clarificationCodes(formResult).includes("invalid_description"),
      "Ein zu kurzer Organisationsname darf keinen unsichtbaren Datenbankfehler erzeugen.",
    );
  },
);

Deno.test(
  "akzeptiert für einen manuellen Retry nur den bekannten gespeicherten E-Mail-Umschlag",
  () => {
    const replayBody = eventSpaceEmailIntakeBodyFromStoredTicket(
      `Eingegangene E-Mail von Ada Beispiel\n\n${validDescription}`,
    );
    assert(
      replayBody === validDescription,
      "Ein manueller Retry muss genau den ursprünglichen Formularbody erhalten.",
    );
    assert(
      eventSpaceEmailIntakeBodyFromStoredTicket(validDescription) === null,
      "Ein geänderter oder beliebiger Tickettext darf nicht als E-Mail-Intake erneut verarbeitet werden.",
    );
    assert(
      eventSpaceEmailIntakeBodyFromStoredTicket(
        "Eingegangene E-Mail von Ada\nOhne sichere Leerzeile",
      ) === null,
      "Ein unvollständiger gespeicherter Umschlag darf keine Recovery-Eingabe erzeugen.",
    );
  },
);
