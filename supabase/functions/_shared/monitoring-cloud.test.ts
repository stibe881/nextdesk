import { assertEquals } from "jsr:@std/assert@1";

import { daysUntil, isPublicAddress, mapLimit, parseCloudChecks, publicTarget, runCloudCheck } from "./monitoring-cloud.ts";

Deno.test("only public addresses may be checked from the cloud", () => {
  for (const address of ["8.8.8.8", "151.248.237.222", "2a00:1450:400a:800::200e", "172.32.0.1", "100.128.0.1"]) {
    assertEquals(isPublicAddress(address), true, address);
  }
  for (
    const address of [
      "10.0.0.1",
      "127.0.0.1",
      "169.254.169.254",
      "172.16.64.220",
      "172.31.255.255",
      "192.168.1.1",
      "100.64.0.1",
      "0.0.0.0",
      "224.0.0.1",
      "255.255.255.255",
      "192.0.2.10",
      "999.1.1.1",
      "::1",
      "::",
      "fe80::1",
      "fd00::1",
      "fc00::1",
      "ff02::1",
      "::ffff:10.0.0.1",
      "::ffff:127.0.0.1",
      "2001:db8::1",
      "localhost",
      "",
    ]
  ) {
    assertEquals(isPublicAddress(address), false, address);
  }
  assertEquals(isPublicAddress("::ffff:8.8.8.8"), true);
});

Deno.test("targets: literal addresses, names and names pointing inside", async () => {
  const resolver = (addresses: string[]) => () => Promise.resolve(addresses);
  assertEquals(await publicTarget("8.8.8.8"), ["8.8.8.8"]);
  assertEquals(await publicTarget("10.0.0.5"), "Interne Adressen misst nur eine Sonde, nicht die Cloud.");
  assertEquals(await publicTarget("[::1]"), "Interne Adressen misst nur eine Sonde, nicht die Cloud.");
  assertEquals(await publicTarget("intranet", resolver(["8.8.8.8"])), "Der Hostname ist ungültig.");
  assertEquals(await publicTarget("www.example.ch", resolver(["93.184.216.34"])), ["93.184.216.34"]);
  assertEquals(await publicTarget("weg.example.ch", resolver([])), "Der Name lässt sich nicht auflösen.");
  // One internal address among the answers is enough to refuse (DNS rebinding).
  assertEquals(
    await publicTarget("mixed.example.ch", resolver(["93.184.216.34", "10.0.0.1"])),
    "Der Name zeigt auf eine interne Adresse. Interne Ziele misst nur eine Sonde.",
  );
});

const base = { id: "a", tenantId: "t", host: null, port: null, url: null, expect: null, timeoutMs: 2000 };

Deno.test("dns check: resolves, compares the expected address", async () => {
  const resolve = () => Promise.resolve(["93.184.216.34"]);
  const ok = await runCloudCheck({ ...base, kind: "dns", host: "www.example.ch" }, resolve);
  assertEquals([ok.ok, ok.message], [true, "93.184.216.34"]);
  const wrong = await runCloudCheck({ ...base, kind: "dns", host: "www.example.ch", expect: "1.2.3.4" }, resolve);
  assertEquals([wrong.ok, wrong.message], [false, "Erwartet 1.2.3.4, erhalten 93.184.216.34"]);
  const missing = await runCloudCheck({ ...base, kind: "dns", host: "weg.example.ch" }, () => Promise.resolve([]));
  assertEquals([missing.ok, missing.value], [false, null]);
});

Deno.test("http and certificate checks refuse internal targets before connecting", async () => {
  const inside = () => Promise.resolve(["10.0.0.1"]);
  assertEquals(
    (await runCloudCheck({ ...base, kind: "http", url: "http://intern.example.ch/" }, inside)).message,
    "Der Name zeigt auf eine interne Adresse. Interne Ziele misst nur eine Sonde.",
  );
  assertEquals(
    (await runCloudCheck({ ...base, kind: "http", url: "http://169.254.169.254/latest/meta-data" })).ok,
    false,
  );
  assertEquals((await runCloudCheck({ ...base, kind: "http", url: "file:///etc/passwd" })).message, "Die Adresse ist ungültig.");
  assertEquals(
    (await runCloudCheck({ ...base, kind: "cert", host: "srv01.example.ch", port: 443 }, inside)).ok,
    false,
  );
});

Deno.test("helpers: days until expiry, due rows, limited concurrency", async () => {
  const now = Date.parse("2026-11-16T10:00:00Z");
  assertEquals(daysUntil("2026-11-28T09:00:00Z", now), 11);
  assertEquals(daysUntil("2026-11-15T10:00:00Z", now), -1);
  assertEquals(daysUntil("kaputt", now), null);
  assertEquals(
    parseCloudChecks([
      { id: "a", tenantId: "t", kind: "cert", host: " WWW.Example.ch ", port: 443, timeoutMs: 99999 },
      { id: "b", tenantId: "t", kind: "ping", host: "1.1.1.1" },
      null,
    ]),
    [{ id: "a", tenantId: "t", kind: "cert", host: "www.example.ch", port: 443, url: null, expect: null, timeoutMs: 15000 }],
  );
  let running = 0;
  let peak = 0;
  const results = await mapLimit([1, 2, 3, 4, 5], 2, async (value) => {
    running += 1;
    peak = Math.max(peak, running);
    await new Promise((resolve) => setTimeout(resolve, 5));
    running -= 1;
    return value * 2;
  });
  assertEquals(results, [2, 4, 6, 8, 10]);
  assertEquals(peak, 2);
});
