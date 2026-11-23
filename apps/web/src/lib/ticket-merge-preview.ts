/** Ein Ticket in der Vorschau einer Zusammenführung (RPC `ticket_merge_preview`). */
export type MergePreviewTicket = {
  id: string;
  ticketNumber: string;
  subject: string;
  isClosed: boolean;
  mergedInto: string | null;
  comments: number;
  requesterName: string | null;
  requesterEmail: string | null;
  priorityLabel: string | null;
  prioritySort: number | null;
  resolutionDueAt: string | null;
  assignedAgentName: string | null;
  teamName: string | null;
  timeMinutes: number;
  openChecklistItems: number;
  mailChannel: boolean;
};

export type MergePreview = {
  /** Vorschlag: meiste Aktivität, dann zugewiesen, dann ältestes offenes Ticket. */
  suggestedPrimaryId: string | null;
  primaryId: string | null;
  tickets: MergePreviewTicket[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value : null;
const num = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

export function parseMergePreview(value: unknown): MergePreview | null {
  const record = asRecord(value);
  if (!record || !Array.isArray(record.tickets)) return null;
  const tickets = record.tickets.flatMap((item): MergePreviewTicket[] => {
    const row = asRecord(item);
    const id = text(row?.id);
    const ticketNumber = text(row?.ticketNumber);
    if (!row || !id || !ticketNumber) return [];
    return [
      {
        id,
        ticketNumber,
        subject: text(row.subject) ?? "",
        isClosed: row.isClosed === true,
        mergedInto: text(row.mergedInto),
        comments: num(row.comments),
        requesterName: text(row.requesterName),
        requesterEmail: text(row.requesterEmail),
        priorityLabel: text(row.priorityLabel),
        prioritySort:
          typeof row.prioritySort === "number" ? row.prioritySort : null,
        resolutionDueAt: text(row.resolutionDueAt),
        assignedAgentName: text(row.assignedAgentName),
        teamName: text(row.teamName),
        timeMinutes: num(row.timeMinutes),
        openChecklistItems: num(row.openChecklistItems),
        mailChannel: row.mailChannel === true,
      },
    ];
  });
  if (!tickets.length) return null;
  const ids = new Set(tickets.map((ticket) => ticket.id));
  const suggested = text(record.suggestedPrimaryId);
  const primary = text(record.primaryId);
  return {
    suggestedPrimaryId: suggested && ids.has(suggested) ? suggested : null,
    primaryId: primary && ids.has(primary) ? primary : null,
    tickets,
  };
}

/** Kurztext für die App und Listen: was beim Zusammenführen passiert. */
export function mergePreviewLines(preview: MergePreview): string[] {
  const primary = preview.tickets.find(
    (ticket) => ticket.id === preview.primaryId,
  );
  if (!primary) return [];
  const others = preview.tickets.filter(
    (ticket) => ticket.id !== primary.id && !ticket.mergedInto,
  );
  const all = [primary, ...others];
  const highest = all.reduce((best, ticket) =>
    (ticket.prioritySort ?? -1) > (best.prioritySort ?? -1) ? ticket : best,
  );
  const people = new Set(
    all.map(
      (ticket) => ticket.requesterEmail ?? ticket.requesterName ?? ticket.id,
    ),
  );
  const mails = others.filter((ticket) => ticket.mailChannel).length;
  return [
    `Haupt-Ticket: ${primary.ticketNumber}`,
    `Priorität danach: ${highest.priorityLabel ?? "–"}`,
    `${people.size} ${people.size === 1 ? "Person" : "Personen"} betroffen`,
    mails > 0
      ? `${mails} Info-${mails === 1 ? "Mail" : "Mails"} an anfragende Personen`
      : "Keine Info-Mail",
  ];
}
