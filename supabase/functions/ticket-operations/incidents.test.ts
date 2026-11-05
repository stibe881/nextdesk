import { assertEquals } from "jsr:@std/assert@1";
import { clusterRecentTickets, similarityText } from "./incidents.ts";

const TENANT = "0b6a1c1e-4f7a-4d2b-9c1e-2a3b4c5d6e7f";
const id = (index: number) =>
  `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;

type Row = {
  id: string;
  ticket_number: string;
  subject: string;
  description: string;
  created_at: string;
};

/** Minimal stand-in for the caller's Supabase client. */
function fakeClient(recent: Row[], similar: (seed: string) => string[]) {
  const calls: string[] = [];
  const query = {
    select: () => query,
    eq: () => query,
    is: () => query,
    gte: () => query,
    order: () => query,
    limit: (count: number) =>
      Promise.resolve({ data: recent.slice(0, count), error: null }),
  };
  return {
    calls,
    client: {
      from: () => query,
      rpc: (
        _name: string,
        args: { p_text: string; p_exclude_ticket_id: string },
      ) => {
        calls.push(args.p_exclude_ticket_id);
        const rows = similar(args.p_exclude_ticket_id).map((ticketId) => ({
          ticket_id: ticketId,
          ticket_number: `T-${ticketId.slice(-2)}`,
          subject: "VPN geht nicht",
          created_at: "2026-11-05T10:00:00Z",
        }));
        return Promise.resolve({ data: rows, error: null });
      },
    },
  };
}

const rows = (count: number): Row[] =>
  Array.from({ length: count }, (_, index) => ({
    id: id(index + 1),
    ticket_number: `T-${index + 1}`,
    subject: index < 6 ? "VPN geht nicht" : `Anderes Thema ${index}`,
    description: "",
    created_at: "2026-11-05T10:00:00Z",
  }));

Deno.test("similarity text uses subject and description start", () => {
  assertEquals(
    similarityText({ subject: "VPN", description: "x".repeat(2000) }).length,
    4 + 1500,
  );
});

Deno.test(
  "fewer recent tickets than a cluster needs make no lookups",
  async () => {
    const { client, calls } = fakeClient(rows(4), () => []);
    assertEquals(await clusterRecentTickets(client, TENANT, "since"), []);
    assertEquals(calls.length, 0);
  },
);

Deno.test(
  "similar tickets form one cluster, members are no seeds",
  async () => {
    const vpn = [1, 2, 3, 4, 5, 6].map(id);
    const { client, calls } = fakeClient(rows(8), (seed) =>
      vpn.includes(seed) ? vpn.filter((ticketId) => ticketId !== seed) : [],
    );
    const clusters = await clusterRecentTickets(client, TENANT, "since");
    assertEquals(clusters?.length, 1);
    assertEquals(clusters?.[0]?.ticketCount, 6);
    assertEquals(clusters?.[0]?.subject, "VPN geht nicht");
    assertEquals(new Set(clusters?.[0]?.ticketIds), new Set(vpn));
    // Seed 1 found the cluster; 2–6 are skipped, 7 and 8 are looked up.
    assertEquals(calls, [id(1), id(7), id(8)]);
  },
);

Deno.test("clusters below the minimum are not reported", async () => {
  const { client } = fakeClient(rows(10), (seed) =>
    seed === id(1) ? [id(2), id(3)] : [],
  );
  assertEquals(await clusterRecentTickets(client, TENANT, "since"), []);
});

Deno.test("lookups are capped", async () => {
  const { client, calls } = fakeClient(rows(30), () => []);
  await clusterRecentTickets(client, TENANT, "since");
  assertEquals(calls.length, 12);
});

Deno.test("a failed lookup fails the overview", async () => {
  const { client } = fakeClient(rows(6), () => []);
  client.rpc = () =>
    Promise.resolve({ data: null, error: { message: "boom" } }) as never;
  assertEquals(await clusterRecentTickets(client, TENANT, "since"), null);
});
