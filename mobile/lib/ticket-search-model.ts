// Ticketsuche in der App: sucht über alle Tickets (unabhängig von Filtern)
// und findet zusätzlich Personen. Rein, ohne Expo-Abhängigkeiten.
import {
  parsePersonSearchHits,
  type PersonSearchHit,
} from "./person-overview-model";

export type TicketSearchHit = {
  ticketId: string;
  title: string;
  detail: string;
};

export type WorkspaceSearch = {
  tickets: TicketSearchHit[];
  people: PersonSearchHit[];
};

type Row = Record<string, unknown>;
const isRecord = (value: unknown): value is Row =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Mindestlänge, ab der gesucht wird (wie die globale Suche). */
export const MIN_SEARCH_LENGTH = 2;

/** Liest die Antwort der Funktion «global-search»: Tickets und Personen. */
export function parseWorkspaceSearch(value: unknown): WorkspaceSearch {
  const data = isRecord(value) && isRecord(value.data) ? value.data : {};
  const results = Array.isArray(data.results) ? data.results : [];
  const tickets: TicketSearchHit[] = [];
  const seen = new Set<string>();
  for (const row of results) {
    if (
      !isRecord(row) ||
      row.resultType !== "ticket" ||
      typeof row.ticketId !== "string" ||
      typeof row.title !== "string" ||
      seen.has(row.ticketId)
    ) {
      continue;
    }
    seen.add(row.ticketId);
    tickets.push({
      ticketId: row.ticketId,
      title: row.title,
      detail: typeof row.detail === "string" ? row.detail : "",
    });
  }
  return { tickets, people: parsePersonSearchHits(data.people) };
}

/**
 * Trifft ein Ticket die Suche? Alle Wörter müssen vorkommen, in Nummer,
 * Betreff, Beschreibung, Status, Priorität oder Name der anfragenden Person.
 */
export function ticketMatchesSearch(
  ticket: {
    ticketNumber: string;
    subject: string;
    description: string;
    status: string;
    priority: string;
    requesterName?: string | null;
  },
  query: string,
): boolean {
  const words = query.toLocaleLowerCase("de-CH").split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const text = [
    ticket.ticketNumber,
    ticket.subject,
    ticket.description,
    ticket.status,
    ticket.priority,
    ticket.requesterName ?? "",
  ]
    .join(" ")
    .toLocaleLowerCase("de-CH");
  return words.every((word) => text.includes(word));
}
