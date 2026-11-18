import { assertEquals } from "jsr:@std/assert@1";
import { sendExpoPush } from "./expo-push.ts";

const message = (token: string) => ({
  to: `ExponentPushToken[${token}]`,
  title: "Titel",
  body: "Text",
});

Deno.test("sendExpoPush ordnet die Tickets den Nachrichten zu", async () => {
  const fetcher = (async (_url: string | URL | Request, init?: RequestInit) => {
    const sent = JSON.parse(String(init?.body)) as unknown[];
    assertEquals(sent.length, 2);
    return new Response(
      JSON.stringify({
        data: [
          { status: "ok", id: "1" },
          { status: "error", details: { error: "DeviceNotRegistered" } },
        ],
      }),
      { status: 200 },
    );
  }) as typeof fetch;
  const results = await sendExpoPush(
    [message("aaaaaaaaaa"), message("bbbbbbbbbb")],
    fetcher,
  );
  assertEquals(
    results.map((entry) => [entry.ok, entry.error]),
    [
      [true, undefined],
      [false, "DeviceNotRegistered"],
    ],
  );
});

Deno.test(
  "sendExpoPush teilt in Pakete zu 100 und meldet Fehler pro Nachricht",
  async () => {
    let calls = 0;
    const fetcher = (async () => {
      calls += 1;
      return new Response("{}", { status: 500 });
    }) as typeof fetch;
    const many = Array.from({ length: 150 }, (_, i) =>
      message(`token${String(i).padStart(6, "0")}`),
    );
    const results = await sendExpoPush(many, fetcher);
    assertEquals(calls, 2);
    assertEquals(results.length, 150);
    assertEquals(
      results.every((entry) => !entry.ok && entry.error === "http_500"),
      true,
    );
  },
);

Deno.test("sendExpoPush fängt Netzwerkfehler ab", async () => {
  const fetcher = (async () => {
    throw new Error("offline");
  }) as typeof fetch;
  const results = await sendExpoPush([message("cccccccccc")], fetcher);
  assertEquals(results[0]!.error, "network_error");
});
