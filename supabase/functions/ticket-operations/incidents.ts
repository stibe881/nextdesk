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

const INCIDENT_OVERVIEW_MAX_CLUSTERS = 3;
const INCIDENT_OVERVIEW_CACHE_MS = 60_000;
const INCIDENT_OVERVIEW_CACHE_MAX_ENTRIES = 500;

type IncidentOverviewTicket = {
  id: string;
  ticketNumber: string;
  subject: string;
  createdAt: string;
};

export type IncidentCluster = {
  subject: string;
  ticketCount: number;
  ticketIds: string[];
  tickets: IncidentOverviewTicket[];
};

/**
 * Possible incidents for the ticket list: clusters of at least
 * INCIDENT_MIN_TICKETS similar tickets created in the incident window, from
 * one call of recent_incident_clusters (migration 0189). The call uses the
 * caller's client, so only tickets the caller can read are seeds or members;
 * the database caps the work and drops clusters that repeat earlier ones.
 */
export async function clusterRecentTickets(
  client: any,
  tenantId: string,
  since: string,
): Promise<IncidentCluster[] | null> {
  const { data, error } = await client.rpc("recent_incident_clusters", {
    p_tenant_id: tenantId,
    p_since: since,
    p_min_size: INCIDENT_MIN_TICKETS,
    p_limit: INCIDENT_OVERVIEW_MAX_CLUSTERS,
  });
  if (error || !Array.isArray(data)) return null;
  const clusters: IncidentCluster[] = [];
  for (const row of data) {
    if (!isUuid(row?.ticket_id) || !Array.isArray(row?.ticket_ids)) continue;
    const ticketIds = [
      row.ticket_id,
      ...row.ticket_ids.filter(
        (ticketId: unknown) => isUuid(ticketId) && ticketId !== row.ticket_id,
      ),
    ];
    const details = new Map<string, any>(
      (Array.isArray(row.tickets) ? row.tickets : [])
        .filter((ticket: any) => isUuid(ticket?.id))
        .map((ticket: any) => [ticket.id, ticket]),
    );
    clusters.push({
      subject: String(row.subject ?? ""),
      ticketCount: ticketIds.length,
      ticketIds,
      tickets: ticketIds.map((ticketId) => {
        const ticket = details.get(ticketId);
        return {
          id: ticketId,
          ticketNumber: String(ticket?.ticket_number ?? ""),
          subject: String(ticket?.subject ?? ""),
          createdAt: String(ticket?.created_at ?? ""),
        };
      }),
    });
  }
  return clusters.sort((left, right) => right.ticketCount - left.ticketCount);
}

/**
 * Short in-memory cache of the overview per tenant and person: every open
 * ticket list polls it, and the clusters rarely change within a minute. The
 * cache lives in one function instance only; access checks still run on
 * every request.
 */
export function createIncidentOverviewCache(
  ttlMs = INCIDENT_OVERVIEW_CACHE_MS,
  maxEntries = INCIDENT_OVERVIEW_CACHE_MAX_ENTRIES,
  now: () => number = Date.now,
) {
  const entries = new Map<
    string,
    { expiresAt: number; incidents: IncidentCluster[] }
  >();
  const key = (tenantId: string, userId: string) => `${tenantId}:${userId}`;
  return {
    get(tenantId: string, userId: string): IncidentCluster[] | null {
      const entry = entries.get(key(tenantId, userId));
      if (!entry) return null;
      if (entry.expiresAt <= now()) {
        entries.delete(key(tenantId, userId));
        return null;
      }
      return entry.incidents;
    },
    set(tenantId: string, userId: string, incidents: IncidentCluster[]) {
      const entryKey = key(tenantId, userId);
      entries.delete(entryKey);
      entries.set(entryKey, { expiresAt: now() + ttlMs, incidents });
      // Oldest entries first: Map keeps insertion order.
      while (entries.size > maxEntries) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        entries.delete(oldest);
      }
    },
    get size() {
      return entries.size;
    },
  };
}
