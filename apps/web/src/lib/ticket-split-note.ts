/**
 * Vermerk «Aufgeteilt aus Ticket …» am Anfang der Beschreibung eines
 * Teil-Tickets. Die Edge Function ticket-coordination schreibt ihn beim
 * Aufteilen; Web und App zeigen ihn als Hinweis statt als Fliesstext.
 * Ältere Teil-Tickets beginnen mit «Teil von Ticket …».
 */
export type TicketSplitNote = {
  parentTicketNumber: string;
  part: number | null;
  total: number | null;
  siblingTicketNumbers: string[];
};

const CURRENT =
  /^Aufgeteilt aus Ticket (\S+) – Teil (\d+) von (\d+)\.(?: Weitere Teile: ([^\n]*?)\.)?[ \t]*(?:\r?\n|$)/u;
const LEGACY = /^Teil von Ticket (\S+)[ \t]*(?:\r?\n|$)/u;

export function parseTicketSplitNote(description: string): {
  note: TicketSplitNote | null;
  body: string;
} {
  const current = CURRENT.exec(description);
  if (current) {
    return {
      note: {
        parentTicketNumber: current[1]!,
        part: Number(current[2]),
        total: Number(current[3]),
        siblingTicketNumbers: (current[4] ?? "")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
      },
      body: description.slice(current[0].length).replace(/^\s*\n/u, ""),
    };
  }
  const legacy = LEGACY.exec(description);
  if (legacy) {
    return {
      note: {
        parentTicketNumber: legacy[1]!,
        part: null,
        total: null,
        siblingTicketNumbers: [],
      },
      body: description.slice(legacy[0].length).replace(/^\s*\n/u, ""),
    };
  }
  return { note: null, body: description };
}

/** Einzeiliger Text des Vermerks, z. B. für Vorschauen. */
export function ticketSplitNoteText(note: TicketSplitNote): string {
  return note.part && note.total
    ? `Teil ${note.part} von ${note.total} aus dem aufgeteilten Ticket ${note.parentTicketNumber}`
    : `Teil des aufgeteilten Tickets ${note.parentTicketNumber}`;
}
