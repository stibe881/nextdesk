// deno-lint-ignore-file no-explicit-any
// Incident detection helpers of ticket-operations: the similarity text and
// the clustering of recent tickets for the incident hint in the ticket list.

export const INCIDENT_WINDOW_HOURS = 2;
export const INCIDENT_MIN_TICKETS = 5;

const isUuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );

/** Subject and the start of the description, the text similar tickets use. */
export function similarityText(ticket: any): string {
  const subject = typeof ticket.subject === "string" ? ticket.subject : "";
  const description =
    typeof ticket.description === "string" ? ticket.description : "";
  return `${subject}\n${description.slice(0, 1500)}`.trim();
}

const INCIDENT_OVERVIEW_MAX_TICKETS = 30;
const INCIDENT_OVERVIEW_MAX_LOOKUPS = 12;
const INCIDENT_OVERVIEW_MAX_CLUSTERS = 3;

type IncidentOverviewTicket = {
  id: string;
  ticketNumber: string;
  subject: string;
  createdAt: string;
};

type IncidentCluster = {
  subject: string;
  ticketCount: number;
  ticketIds: string[];
  tickets: IncidentOverviewTicket[];
};

/**
 * Possible incidents for the ticket list: clusters of at least
 * INCIDENT_MIN_TICKETS similar tickets created in the incident window. Every
 * read uses the caller's client, so only tickets the caller can read are
 * seeds or members. The work is capped: the latest
 * INCIDENT_OVERVIEW_MAX_TICKETS tickets are seeds, at most
 * INCIDENT_OVERVIEW_MAX_LOOKUPS of them are looked up, and a ticket that is
 * already part of a cluster is not used as a seed again.
 */
export async function clusterRecentTickets(
  client: any,
  tenantId: string,
  since: string,
): Promise<IncidentCluster[] | null> {
  const { data: recent, error } = await client
    .from("tickets")
    .select("id, ticket_number, subject, description, created_at")
    .eq("tenant_id", tenantId)
    .is("merged_into_ticket_id", null)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(INCIDENT_OVERVIEW_MAX_TICKETS);
  if (error || !Array.isArray(recent)) return null;
  const seeds = recent.filter((row: any) => isUuid(row?.id));
  // Fewer readable tickets in the window than a cluster needs: no lookups.
  if (seeds.length < INCIDENT_MIN_TICKETS) return [];
  const clustered = new Set<string>();
  const clusters: IncidentCluster[] = [];
  let lookups = 0;
  for (const seed of seeds) {
    if (
      lookups >= INCIDENT_OVERVIEW_MAX_LOOKUPS ||
      clusters.length >= INCIDENT_OVERVIEW_MAX_CLUSTERS
    )
      break;
    if (clustered.has(seed.id)) continue;
    lookups += 1;
    const { data: rows, error: lookupError } = await client.rpc(
      "recent_similar_tickets",
      {
        p_tenant_id: tenantId,
        p_text: similarityText(seed),
        p_since: since,
        p_exclude_ticket_id: seed.id,
        p_limit: 50,
      },
    );
    if (lookupError) return null;
    const members: IncidentOverviewTicket[] = [
      {
        id: seed.id,
        ticketNumber: String(seed.ticket_number ?? ""),
        subject: String(seed.subject ?? ""),
        createdAt: String(seed.created_at ?? ""),
      },
      ...(Array.isArray(rows) ? rows : [])
        .filter(
          (row: any) => isUuid(row?.ticket_id) && row.ticket_id !== seed.id,
        )
        .map((row: any) => ({
          id: row.ticket_id,
          ticketNumber: String(row.ticket_number ?? ""),
          subject: String(row.subject ?? ""),
          createdAt: String(row.created_at ?? ""),
        })),
    ];
    // A cluster that mostly repeats an earlier one is not reported twice.
    const fresh = members.filter((member) => !clustered.has(member.id));
    if (
      members.length < INCIDENT_MIN_TICKETS ||
      fresh.length < INCIDENT_MIN_TICKETS
    )
      continue;
    for (const member of members) clustered.add(member.id);
    clusters.push({
      subject: String(seed.subject ?? ""),
      ticketCount: members.length,
      ticketIds: members.map((member) => member.id),
      tickets: members,
    });
  }
  return clusters.sort((left, right) => right.ticketCount - left.ticketCount);
}
