// Spam der Ticketliste (Edge Function ticket-bulk-status).

export type SpamTicket = {
  id: string;
  ticketNumber: string;
  subject: string;
  department: string | null;
  senderEmail: string | null;
  spamAt: string;
  markedByName: string | null;
  purgeAt: string;
};

export type SpamSender = {
  id: string;
  email: string;
  createdAt: string;
  hits: number;
  lastHitAt: string | null;
};

export type SpamReport = {
  total: number;
  auto: number;
  manual: number;
  blockedSenders: number;
  perDay: { day: string; auto: number; manual: number }[];
  topSenders: { sender: string; count: number; lastAt: string }[];
  byDepartment: { name: string; count: number }[];
};

function isRow(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value : null;
const num = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

export function parseSpamTickets(response: unknown): SpamTicket[] {
  if (!isRow(response) || !isRow(response.data)) return [];
  const tickets = response.data.tickets;
  if (!Array.isArray(tickets)) return [];
  return tickets.flatMap((entry) => {
    if (!isRow(entry)) return [];
    const id = text(entry.id);
    const ticketNumber = text(entry.ticketNumber);
    const spamAt = text(entry.spamAt);
    if (!id || !ticketNumber || !spamAt) return [];
    return [
      {
        id,
        ticketNumber,
        subject: text(entry.subject) ?? "",
        department: text(entry.department),
        senderEmail: text(entry.senderEmail),
        spamAt,
        markedByName: text(entry.markedByName),
        purgeAt: text(entry.purgeAt) ?? spamAt,
      },
    ];
  });
}

export function parseSpamSenders(response: unknown): SpamSender[] {
  if (!isRow(response) || !isRow(response.data)) return [];
  const senders = response.data.senders;
  if (!Array.isArray(senders)) return [];
  return senders.flatMap((entry) => {
    if (!isRow(entry)) return [];
    const id = text(entry.id);
    const email = text(entry.email);
    if (!id || !email) return [];
    return [
      {
        id,
        email,
        createdAt: text(entry.createdAt) ?? "",
        hits: num(entry.hits),
        lastHitAt: text(entry.lastHitAt),
      },
    ];
  });
}

export function parseSpamReport(response: unknown): SpamReport | null {
  if (!isRow(response) || !isRow(response.data)) return null;
  const data = response.data;
  const list = (value: unknown) => (Array.isArray(value) ? value : []);
  return {
    total: num(data.total),
    auto: num(data.auto),
    manual: num(data.manual),
    blockedSenders: num(data.blockedSenders),
    perDay: list(data.perDay).flatMap((entry) =>
      isRow(entry) && text(entry.day)
        ? [
            {
              day: String(entry.day),
              auto: num(entry.auto),
              manual: num(entry.manual),
            },
          ]
        : [],
    ),
    topSenders: list(data.topSenders).flatMap((entry) =>
      isRow(entry) && text(entry.sender)
        ? [
            {
              sender: String(entry.sender),
              count: num(entry.count),
              lastAt: text(entry.lastAt) ?? "",
            },
          ]
        : [],
    ),
    byDepartment: list(data.byDepartment).flatMap((entry) =>
      isRow(entry)
        ? [
            {
              name: text(entry.name) ?? "Ohne Abteilung",
              count: num(entry.count),
            },
          ]
        : [],
    ),
  };
}

/** Bereich der letzten N Tage als ISO-Zeiten für den Bericht. */
export function spamRange(
  days: number,
  now = new Date(),
): { from: string; to: string } {
  const to = new Date(now.getTime() + 60_000);
  const from = new Date(now.getTime() - days * 86_400_000);
  return { from: from.toISOString(), to: to.toISOString() };
}
