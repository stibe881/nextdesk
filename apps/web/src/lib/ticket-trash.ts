// Papierkorb der Ticketliste (Edge Function ticket-bulk-status).

export type DeletedTicket = {
  id: string;
  ticketNumber: string;
  subject: string;
  department: string | null;
  status: string | null;
  priority: string | null;
  requesterName: string | null;
  assigneeName: string | null;
  createdAt: string;
  deletedAt: string;
  deletedByName: string | null;
  purgeAt: string;
};

export type DeletedTicketDetail = DeletedTicket & {
  description: string | null;
  comments: {
    id: string;
    authorName: string | null;
    internal: boolean;
    body: string;
    createdAt: string;
  }[];
  attachmentNames: string[];
};

type Row = Record<string, unknown>;

function isRow(value: unknown): value is Row {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function parseTicket(value: unknown): DeletedTicket | null {
  if (!isRow(value)) return null;
  const id = text(value.id);
  const ticketNumber = text(value.ticketNumber);
  const deletedAt = text(value.deletedAt);
  const purgeAt = text(value.purgeAt);
  if (!id || !ticketNumber || !deletedAt || !purgeAt) return null;
  return {
    id,
    ticketNumber,
    subject: text(value.subject) ?? "(ohne Betreff)",
    department: text(value.department),
    status: text(value.status),
    priority: text(value.priority),
    requesterName: text(value.requesterName),
    assigneeName: text(value.assigneeName),
    createdAt: text(value.createdAt) ?? deletedAt,
    deletedAt,
    deletedByName: text(value.deletedByName),
    purgeAt,
  };
}

/** Antwort von `listDeleted` → Liste (ungültige Einträge werden verworfen). */
export function parseDeletedTickets(response: unknown): DeletedTicket[] {
  if (!isRow(response) || !isRow(response.data)) return [];
  const tickets = response.data.tickets;
  return Array.isArray(tickets)
    ? tickets.flatMap((entry) => {
        const ticket = parseTicket(entry);
        return ticket ? [ticket] : [];
      })
    : [];
}

/** Antwort von `getDeleted` → Detail. */
export function parseDeletedTicket(
  response: unknown,
): DeletedTicketDetail | null {
  if (!isRow(response) || !isRow(response.data)) return null;
  const raw = response.data.ticket;
  const ticket = parseTicket(raw);
  if (!ticket || !isRow(raw)) return null;
  return {
    ...ticket,
    description: text(raw.description),
    comments: Array.isArray(raw.comments)
      ? raw.comments.flatMap((comment) => {
          if (!isRow(comment) || !text(comment.id)) return [];
          return [
            {
              id: String(comment.id),
              authorName: text(comment.authorName),
              internal: comment.internal === true,
              body: typeof comment.body === "string" ? comment.body : "",
              createdAt: text(comment.createdAt) ?? "",
            },
          ];
        })
      : [],
    attachmentNames: Array.isArray(raw.attachmentNames)
      ? raw.attachmentNames.filter(
          (name): name is string => typeof name === "string",
        )
      : [],
  };
}

/** Ganze Tage bis zur endgültigen Löschung (aufgerundet, nie negativ). */
export function daysUntilPurge(purgeAt: string, now: number): number {
  const parsed = Date.parse(purgeAt);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.ceil((parsed - now) / (24 * 60 * 60 * 1000)));
}
