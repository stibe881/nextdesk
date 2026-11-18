import assert from "node:assert/strict";
import { test } from "node:test";

import {
  cidrContains,
  ipv4Hosts,
  isUsefulAddress,
  normalizeMac,
  parseCidr,
} from "./net.ts";
import {
  parseNeighborOutput,
  parseOuiList,
  parsePingOutput,
  pingArgs,
} from "./parsers.ts";

test("ping output: Linux, Windows (de/en), unreachable", () => {
  const linux = `PING 10.20.30.21 (10.20.30.21) 56(84) bytes of data.
64 bytes from 10.20.30.21: icmp_seq=1 ttl=64 time=0.412 ms

--- 10.20.30.21 ping statistics ---
1 packets transmitted, 1 received, 0% packet loss, time 0ms`;
  assert.deepEqual(parsePingOutput(linux), {
    alive: true,
    timeMs: 0.412,
    ttl: 64,
  });

  const windowsDe = `Ping wird ausgeführt für 10.20.30.21 mit 32 Bytes Daten:
Antwort von 10.20.30.21: Bytes=32 Zeit<1ms TTL=128

Ping-Statistik für 10.20.30.21:
    Pakete: Gesendet = 1, Empfangen = 1, Verloren = 0`;
  assert.deepEqual(parsePingOutput(windowsDe), {
    alive: true,
    timeMs: 1,
    ttl: 128,
  });

  const windowsEn = "Reply from 10.20.30.21: bytes=32 time=3ms TTL=63";
  assert.equal(parsePingOutput(windowsEn).timeMs, 3);

  const unreachable = `Antwort von 10.20.30.1: Zielhost nicht erreichbar.
Ping-Statistik für 10.20.30.99:
    Pakete: Gesendet = 1, Empfangen = 1, Verloren = 0`;
  assert.equal(parsePingOutput(unreachable).alive, false);
  assert.equal(
    parsePingOutput("From 10.20.30.1 icmp_seq=1 Destination Host Unreachable")
      .alive,
    false,
  );
  assert.equal(parsePingOutput("").alive, false);
});

test("ping arguments per platform", () => {
  assert.deepEqual(pingArgs("linux", "10.0.0.1", 800), [
    "-n",
    "-c",
    "1",
    "-W",
    "1",
    "10.0.0.1",
  ]);
  assert.deepEqual(pingArgs("win32", "10.0.0.1", 800), [
    "-n",
    "1",
    "-w",
    "800",
    "10.0.0.1",
  ]);
  assert.deepEqual(pingArgs("darwin", "10.0.0.1", 800), [
    "-n",
    "-c",
    "1",
    "-W",
    "800",
    "10.0.0.1",
  ]);
});

test("neighbour tables: ip neigh, arp -a (de), netsh, BSD arp", () => {
  const linux = `10.20.30.21 dev eth0 lladdr 00:1e:0b:7a:41:c9 REACHABLE
10.20.30.22 dev eth0 lladdr f0:9f:c2:11:08:3a STALE
10.20.30.99 dev eth0  FAILED
10.20.30.98 dev eth0 INCOMPLETE
fd12:3456::21 dev eth0 lladdr 00:1e:0b:7a:41:c9 router REACHABLE
fe80::1 dev eth0 lladdr 00:1e:0b:7a:41:c9 router STALE`;
  assert.deepEqual(parseNeighborOutput(linux), [
    { address: "10.20.30.21", mac: "00:1e:0b:7a:41:c9", family: 4 },
    { address: "10.20.30.22", mac: "f0:9f:c2:11:08:3a", family: 4 },
    { address: "fd12:3456::21", mac: "00:1e:0b:7a:41:c9", family: 6 },
  ]);

  const windows = `
Schnittstelle: 10.20.30.5 --- 0xb
  Internetadresse       Physische Adresse     Typ
  10.20.30.1            00-0b-86-aa-bb-cc     dynamisch
  10.20.30.21           00-1e-0b-7a-41-c9     dynamisch
  10.20.30.255          ff-ff-ff-ff-ff-ff     statisch
  224.0.0.22            01-00-5e-00-00-16     statisch
`;
  assert.deepEqual(
    parseNeighborOutput(windows).map((entry) => entry.address),
    ["10.20.30.1", "10.20.30.21"],
  );

  const netsh = `
Schnittstelle 11: Ethernet

Internetadresse                               Physische Adresse   Typ
--------------------------------------------  -----------------  -----------
fd12:3456::1                                  00-0b-86-aa-bb-cc  Erreichbar (Router)
fe80::1                                       00-0b-86-aa-bb-cc  Veraltet (Router)
ff02::1                                       33-33-00-00-00-01  Permanent
`;
  assert.deepEqual(parseNeighborOutput(netsh), [
    { address: "fd12:3456::1", mac: "00:0b:86:aa:bb:cc", family: 6 },
  ]);

  const bsd = `? (10.20.30.21) at 0:1e:b:7a:41:c9 on en0 ifscope [ethernet]
? (10.20.30.40) at (incomplete) on en0 ifscope [ethernet]`;
  assert.deepEqual(parseNeighborOutput(bsd), [
    { address: "10.20.30.21", mac: "00:1e:0b:7a:41:c9", family: 4 },
  ]);
});

test("IEEE OUI list (txt and csv)", () => {
  const list = parseOuiList(`00-1E-0B   (hex)\t\tHewlett Packard
001E0B     (base 16)\t\tHewlett Packard
MA-L,F09FC2,"Ubiquiti Inc",123 Street
MA-L,00155D,Microsoft Corporation,One Microsoft Way`);
  assert.equal(list.get("001e0b"), "Hewlett Packard");
  assert.equal(list.get("f09fc2"), "Ubiquiti Inc");
  assert.equal(list.get("00155d"), "Microsoft Corporation");
});

test("IP and MAC helpers", () => {
  assert.equal(normalizeMac("001E.0B7A.41C9"), "00:1e:0b:7a:41:c9");
  assert.equal(normalizeMac("01:00:5e:00:00:16"), null);
  const cidr = parseCidr("10.20.30.0/24")!;
  assert.ok(cidrContains(cidr, "10.20.30.200"));
  assert.ok(!cidrContains(cidr, "10.20.31.1"));
  assert.ok(cidrContains(parseCidr("fd12:3456::/48")!, "fd12:3456:0:1::5"));
  const hosts = ipv4Hosts(cidr);
  assert.equal(hosts.length, 254);
  assert.equal(hosts[0], "10.20.30.1");
  assert.equal(hosts.at(-1), "10.20.30.254");
  assert.equal(ipv4Hosts(parseCidr("10.0.0.0/31")!).length, 2);
  assert.equal(ipv4Hosts(parseCidr("10.0.0.0/16")!, 100).length, 100);
  assert.ok(!isUsefulAddress("169.254.10.1"));
  assert.ok(!isUsefulAddress("fe80::1"));
});
