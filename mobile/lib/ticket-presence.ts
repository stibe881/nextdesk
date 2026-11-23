import { invokeNextDesk } from "@/lib/nextdesk-client";

/** Person, die das Ticket gerade ebenfalls offen hat. */
export type TicketPresencePerson = {
  displayName: string;
  photoUrl: string | null;
  role: "agent" | "requester";
  editing: boolean;
};

/**
 * Meldet «ich habe das Ticket offen» und liefert die anderen Personen, die es
 * in den letzten 90 Sekunden offen hatten (wie im Web). Fehler sind still:
 * die Anzeige ist eine Ergänzung.
 */
export async function refreshTicketPresence(
  tenantId: string,
  ticketId: string,
): Promise<TicketPresencePerson[]> {
  await invokeNextDesk<unknown>("ticket-presence", {
    type: "heartbeat",
    tenantId,
    ticketId,
    editing: false,
    composing: null,
  });
  const response = await invokeNextDesk<{ data?: { people?: unknown } }>(
    "ticket-presence",
    { type: "list", tenantId, ticketId },
  );
  const people = response?.data?.people;
  if (!Array.isArray(people)) return [];
  return people.flatMap((entry): TicketPresencePerson[] => {
    if (typeof entry !== "object" || entry === null) return [];
    const row = entry as Record<string, unknown>;
    if (typeof row.displayName !== "string" || !row.displayName.trim())
      return [];
    return [
      {
        displayName: row.displayName.trim(),
        photoUrl:
          typeof row.photoUrl === "string" &&
          row.photoUrl.startsWith("https://")
            ? row.photoUrl
            : null,
        role: row.role === "requester" ? "requester" : "agent",
        editing: row.editing === true,
      },
    ];
  });
}

/** «SG» für «Stefan Gross». */
export function presenceInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters =
    parts.length > 1
      ? `${parts[0]![0]}${parts[parts.length - 1]![0]}`
      : (parts[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
}
