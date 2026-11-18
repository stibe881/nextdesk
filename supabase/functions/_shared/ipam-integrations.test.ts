import { assert, assertEquals, assertMatch } from "jsr:@std/assert@1";
import {
  API_KEY_PATTERN,
  deliverWebhook,
  fetchIntuneMacDevices,
  generateApiKey,
  generateWebhookSecret,
  isSafeWebhookUrl,
  normalizeMac,
  parseIntuneMacDevice,
  sha256Hex,
  signWebhook,
} from "./ipam-integrations.ts";

Deno.test("MAC normalization accepts Graph and common formats", () => {
  assertEquals(normalizeMac("AABBCCDDEEFF"), "aa:bb:cc:dd:ee:ff");
  assertEquals(normalizeMac("aa-bb-cc-dd-ee-0f"), "aa:bb:cc:dd:ee:0f");
  assertEquals(normalizeMac("aabb.ccdd.eeff"), "aa:bb:cc:dd:ee:ff");
  assertEquals(normalizeMac("000000000000"), null);
  assertEquals(normalizeMac("nope"), null);
});

Deno.test("Intune devices are parsed and paged", async () => {
  assertEquals(
    parseIntuneMacDevice({
      id: "ABC",
      deviceName: "PC-A2-009",
      wiFiMacAddress: "F09FC211083A",
      ethernetMacAddress: "",
      userPrincipalName: "anna@example.test",
      managementState: "managed",
      lastSyncDateTime: "2026-11-10T08:00:00Z",
    }),
    {
      id: "abc",
      device_name: "PC-A2-009",
      wifi_mac: "f0:9f:c2:11:08:3a",
      ethernet_mac: null,
      user_principal_name: "anna@example.test",
      management_state: "managed",
      last_sync_at: "2026-11-10T08:00:00.000Z",
    },
  );
  assertEquals(parseIntuneMacDevice({ deviceName: "ohne id" }), null);
  // Gemeinsamer Geräteabruf (mit dem Asset-Abgleich): Folgelinks müssen
  // dieselbe Auswahl tragen, fremde Hosts werden abgelehnt.
  const calls: string[] = [];
  let evil = false;
  const fakeFetch = ((input: URL | string) => {
    calls.push(String(input));
    const select = new URL(String(input)).searchParams.get("$select") ?? "";
    const next = new URL(
      "https://graph.microsoft.com/v1.0/deviceManagement/managedDevices",
    );
    next.searchParams.set("$skiptoken", "x");
    next.searchParams.set("$top", "100");
    next.searchParams.set("$select", select);
    const body =
      calls.length === 1
        ? {
            value: [{ id: "1", wiFiMacAddress: "AABBCCDDEE01" }],
            "@odata.nextLink": evil
              ? "https://evil.example/v1.0/deviceManagement/managedDevices"
              : next.toString(),
          }
        : { value: [{ id: "2", ethernetMacAddress: "aa-bb-cc-dd-ee-02" }] };
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  }) as typeof fetch;
  const devices = await fetchIntuneMacDevices("token", fakeFetch);
  assertEquals(
    devices.map((device) => [device.id, device.wifi_mac, device.ethernet_mac]),
    [
      ["1", "aa:bb:cc:dd:ee:01", null],
      ["2", null, "aa:bb:cc:dd:ee:02"],
    ],
  );
  assertEquals(calls.length, 2);
  assert(calls[0]!.includes("wiFiMacAddress"));
  assert(calls[0]!.includes("serialNumber"));
  calls.length = 0;
  evil = true;
  let rejected = false;
  await fetchIntuneMacDevices("token", fakeFetch).catch(() => {
    rejected = true;
  });
  assert(rejected);
});

Deno.test("keys, secrets and signatures", async () => {
  const generated = await generateApiKey();
  assertMatch(generated.key, API_KEY_PATTERN);
  assertEquals(generated.prefix, generated.key.slice(0, 17));
  assertEquals(generated.hash, await sha256Hex(generated.key));
  assertMatch(generateWebhookSecret(), /^whsec_[A-Za-z0-9_-]{43}$/);
  assertEquals(
    await sha256Hex("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
  // HMAC-SHA256("key", "1700000000.{}")
  const signature = await signWebhook("key", 1700000000, "{}");
  assertMatch(signature, /^t=1700000000,v1=[0-9a-f]{64}$/);
  assertEquals(signature, await signWebhook("key", 1700000000, "{}"));
  assert(signature !== (await signWebhook("other", 1700000000, "{}")));
});

Deno.test("webhook URLs must be public HTTPS", () => {
  assert(isSafeWebhookUrl("https://hooks.example.com/ipam"));
  assert(isSafeWebhookUrl("https://8.8.8.8/hook"));
  assert(!isSafeWebhookUrl("http://hooks.example.com/ipam"));
  assert(!isSafeWebhookUrl("https://localhost/hook"));
  assert(!isSafeWebhookUrl("https://10.0.0.5/hook"));
  assert(!isSafeWebhookUrl("https://192.168.1.1/hook"));
  assert(!isSafeWebhookUrl("https://[fd00::1]/hook"));
  assert(!isSafeWebhookUrl("https://user:pw@example.com/hook"));
  assert(!isSafeWebhookUrl("https://server.local/hook"));
  assert(!isSafeWebhookUrl("https://intranet/hook"));
});

Deno.test(
  "webhook delivery signs the body and reports the status",
  async () => {
    let seen: Request | null = null;
    const fakeFetch = ((input: string, init: RequestInit) => {
      seen = new Request(input, init);
      return Promise.resolve(new Response(null, { status: 204 }));
    }) as typeof fetch;
    const result = await deliverWebhook(
      {
        id: 7,
        event: "address.reserved",
        payload: { event: "address.reserved", data: { address: "10.0.0.5" } },
        url: "https://hooks.example.com/ipam",
        secret: "whsec_test",
      },
      fakeFetch,
      () => 1_700_000_000_000,
    );
    assertEquals(result, { ok: true, status: 204, error: null });
    const request = seen as unknown as Request;
    assertEquals(request.headers.get("X-NextDesk-Event"), "address.reserved");
    assertEquals(request.headers.get("X-NextDesk-Delivery"), "7");
    const body = await request.text();
    assertEquals(
      request.headers.get("X-NextDesk-Signature"),
      await signWebhook("whsec_test", 1_700_000_000, body),
    );

    const failing = await deliverWebhook(
      {
        id: 8,
        event: "ping",
        payload: {},
        url: "https://hooks.example.com/ipam",
        secret: "s",
      },
      (() =>
        Promise.resolve(new Response("", { status: 500 }))) as typeof fetch,
    );
    assertEquals(failing, { ok: false, status: 500, error: "HTTP 500" });
    const blocked = await deliverWebhook({
      id: 9,
      event: "ping",
      payload: {},
      url: "https://127.0.0.1/x",
      secret: "s",
    });
    assertEquals(blocked.ok, false);
  },
);
