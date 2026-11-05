import { assertEquals } from "jsr:@std/assert@1";
import {
  clusterRecentTickets,
  createIncidentOverviewCache,
  similarityText,
} from "./incidents.ts";

const TENANT = "0b6a1c1e-4f7a-4d2b-9c1e-2a3b4c5d6e7f";
const USER = "1c7b2d2f-5a8b-4e3c-8d2f-3b4c5d6e7f80";
const id = (index: number) =>
  `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;

type ClusterRow = {
  ticket_id: string;
  subject: string;
  ticket_count: number;
  ticket_ids: string[];
  tickets: unknown;
};

const ticketsOf = (ids: string[]) =>
  ids.map((ticketId) => ({
    id: ticketId,
    ticket_number: `T-${ticketId.slice(-2)}`,
    subject: "VPN geht nicht",
    created_at: "2026-11-05T10:00:00Z",
  }));

const cluster = (subject: string, ids: string[]): ClusterRow => ({
  ticket_id: ids[0]!,
  subject,
  ticket_count: ids.length,
  ticket_ids: ids,
  tickets: ticketsOf(ids),
});

/** Minimal stand-in for the caller's Supabase client. */
function fakeClient(result: { data: unknown; error: unknown }) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  return {
    calls,
    client: {
      from: () => {
        throw new Error("The overview must not read tables directly");
      },
      rpc: (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        return Promise.resolve(result);
      },
    },
  };
}

Deno.test("similarity text uses subject and description start", () => {
  assertEquals(
    similarityText({ subject: "VPN", description: "x".repeat(2000) }).length,
    4 + 1500,
  );
});

Deno.test("the overview makes one clustering call", async () => {
  const vpn = [1, 2, 3, 4, 5, 6].map(id);
  const { client, calls } = fakeClient({
    data: [cluster("VPN geht nicht", vpn)],
    error: null,
  });
  const clusters = await clusterRecentTickets(client, TENANT, "since");
  assertEquals(calls, [
    {
      name: "recent_incident_clusters",
      args: {
        p_tenant_id: TENANT,
        p_since: "since",
        p_min_size: 5,
        p_limit: 3,
      },
    },
  ]);
  assertEquals(clusters?.length, 1);
  assertEquals(clusters?.[0]?.ticketCount, 6);
  assertEquals(clusters?.[0]?.subject, "VPN geht nicht");
  assertEquals(clusters?.[0]?.ticketIds, vpn);
  assertEquals(clusters?.[0]?.tickets[0], {
    id: id(1),
    ticketNumber: "T-01",
    subject: "VPN geht nicht",
    createdAt: "2026-11-05T10:00:00Z",
  });
});

Deno.test("clusters are sorted by size and keep the seed first", async () => {
  const small = [7, 8, 9, 10, 11].map(id);
  const large = [1, 2, 3, 4, 5, 6].map(id);
  const { client } = fakeClient({
    data: [
      cluster("Drucker", small),
      // The seed is listed first even if the database repeats it later.
      { ...cluster("VPN", large), ticket_ids: [...large.slice(1), large[0]] },
    ],
    error: null,
  });
  const clusters = await clusterRecentTickets(client, TENANT, "since");
  assertEquals(
    clusters?.map((item) => item.subject),
    ["VPN", "Drucker"],
  );
  assertEquals(clusters?.[0]?.ticketIds, large);
  assertEquals(clusters?.[0]?.ticketCount, 6);
});

Deno.test("invalid rows and ids are dropped", async () => {
  const { client } = fakeClient({
    data: [
      { ticket_id: "nope", subject: "x", ticket_ids: [id(1)] },
      { ...cluster("VPN", [id(1), id(2)]), ticket_ids: [id(1), "bad", id(2)] },
    ],
    error: null,
  });
  const clusters = await clusterRecentTickets(client, TENANT, "since");
  assertEquals(clusters?.length, 1);
  assertEquals(clusters?.[0]?.ticketIds, [id(1), id(2)]);
});

Deno.test("no clusters give an empty overview", async () => {
  const { client } = fakeClient({ data: [], error: null });
  assertEquals(await clusterRecentTickets(client, TENANT, "since"), []);
});

Deno.test("a failed lookup fails the overview", async () => {
  const { client } = fakeClient({ data: null, error: { message: "boom" } });
  assertEquals(await clusterRecentTickets(client, TENANT, "since"), null);
});

Deno.test("the overview cache is per tenant and person and expires", () => {
  let now = 1_000;
  const cache = createIncidentOverviewCache(60_000, 2, () => now);
  const incidents = [
    {
      subject: "VPN",
      ticketCount: 1,
      ticketIds: [id(1)],
      tickets: [],
    },
  ];
  cache.set(TENANT, USER, incidents);
  assertEquals(cache.get(TENANT, USER), incidents);
  assertEquals(cache.get(TENANT, id(9)), null);
  assertEquals(cache.get(id(8), USER), null);
  now += 59_999;
  assertEquals(cache.get(TENANT, USER), incidents);
  now += 1;
  assertEquals(cache.get(TENANT, USER), null);
  assertEquals(cache.size, 0);
});

Deno.test("the overview cache drops the oldest entries", () => {
  const cache = createIncidentOverviewCache(60_000, 2, () => 0);
  cache.set(TENANT, id(1), []);
  cache.set(TENANT, id(2), []);
  cache.set(TENANT, id(3), []);
  assertEquals(cache.size, 2);
  assertEquals(cache.get(TENANT, id(1)), null);
  assertEquals(cache.get(TENANT, id(3)), []);
});
