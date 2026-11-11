import { assertEquals } from "jsr:@std/assert@1";
import { detectNetworkCandidates, networkLookupTerms } from "./detect.ts";

Deno.test("detector finds addresses, networks, MACs and host names", () => {
  const result = detectNetworkCandidates([
    "Drucker 10.20.30.22 im Netz 10.20.30.0/24 (Maske 255.255.255.0)",
    "MAC F0:9F:C2:11:08:3A an SW-A2-01 Gi1/0/22, Gateway fe80::1",
    "Termin 10:30:00, PC-Probleme, Ticket ICT-2026-000031, DRU-A2-KOPIE",
  ]);
  assertEquals(result.ipv4, ["10.20.30.22"]);
  assertEquals(result.cidrs, ["10.20.30.0/24"]);
  assertEquals(result.ipv6, ["fe80::1"]);
  assertEquals(result.macs, ["f0:9f:c2:11:08:3a"]);
  assertEquals(result.hostnames, ["SW-A2-01", "DRU-A2-KOPIE"]);
});

Deno.test("detector output becomes lookup terms", () => {
  assertEquals(
    networkLookupTerms(
      detectNetworkCandidates(["10.1.1.5 f09f.c211.083c AP7.schule.local"]),
    ),
    { ips: ["10.1.1.5"], macs: ["f0:9f:c2:11:08:3c"], hostnames: ["AP7"] },
  );
});
