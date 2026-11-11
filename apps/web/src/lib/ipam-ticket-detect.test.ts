import { describe, expect, it } from "vitest";
import {
  detectNetworkCandidates,
  hasNetworkCandidates,
  networkLookupTerms,
} from "./ipam-ticket-detect";

describe("detectNetworkCandidates", () => {
  it("findet IPv4-Adressen und Netze, aber keine Masken oder Versionen", () => {
    const result = detectNetworkCandidates([
      "Drucker 10.20.30.22 antwortet nicht.",
      "Netz 10.20.30.0/24, Maske 255.255.255.0, Version 1.2.3.4.5",
      "Ungültig: 300.1.1.1 und 10.0.0.01",
    ]);
    expect(result.ipv4).toEqual(["10.20.30.22"]);
    expect(result.cidrs).toEqual(["10.20.30.0/24"]);
  });

  it("findet IPv6-Adressen, aber keine Uhrzeiten", () => {
    const result = detectNetworkCandidates([
      "Gateway fe80::1 und 2001:db8:0:0:0:0:0:42, Netz 2001:db8:10::/64",
      "Termin um 10:30:00",
    ]);
    expect(result.ipv6).toEqual(["fe80::1", "2001:db8:0:0:0:0:0:42"]);
    expect(result.cidrs).toEqual(["2001:db8:10::/64"]);
  });

  it("normalisiert MAC-Adressen in allen Schreibweisen", () => {
    const result = detectNetworkCandidates([
      "MAC F0:9F:C2:11:08:3A, alt f0-9f-c2-11-08-3b, Cisco f09f.c211.083c",
      "ff:ff:ff:ff:ff:ff ist Broadcast",
    ]);
    expect(result.macs).toEqual([
      "f0:9f:c2:11:08:3a",
      "f0:9f:c2:11:08:3b",
      "f0:9f:c2:11:08:3c",
    ]);
    expect(result.ipv6).toEqual([]);
  });

  it("erkennt Hostnamen nach dem Namensschema", () => {
    const result = detectNetworkCandidates([
      "Was hängt an SW-A2-01 Port 14? AP101 und pc-a2-009.schule.local",
      "Kopierer DRU-A2-KOPIE, Notebook SOBE-NB-0123, SW012",
      "PC-Probleme seit gestern, Ticket ICT-2026-000031, Apple",
    ]);
    expect(result.hostnames).toEqual([
      "SW-A2-01",
      "AP101",
      "PC-A2-009",
      "DRU-A2-KOPIE",
      "SOBE-NB-0123",
      "SW012",
    ]);
  });

  it("nimmt eigene Präfixe an und meldet leere Texte", () => {
    const result = detectNetworkCandidates(["Gerät XY-12 und SW-01"], {
      hostnamePrefixes: ["XY", "1nvalid"],
    });
    expect(result.hostnames).toEqual(["XY-12"]);
    const empty = detectNetworkCandidates([null, undefined, "  "]);
    expect(hasNetworkCandidates(empty)).toBe(false);
    expect(hasNetworkCandidates(result)).toBe(true);
  });

  it("begrenzt die Treffer und liefert Suchbegriffe", () => {
    const text = Array.from({ length: 40 }, (_, i) => `10.1.1.${i + 1}`).join(
      " ",
    );
    const result = detectNetworkCandidates([text, "10.1.1.1 doppelt"]);
    expect(result.ipv4).toHaveLength(20);
    const terms = networkLookupTerms(
      detectNetworkCandidates(["10.1.1.5 10.1.2.0/24 aa:bb:cc:dd:ee:01 AP7"]),
    );
    expect(terms).toEqual({
      ips: ["10.1.1.5", "10.1.2.0/24"],
      macs: ["aa:bb:cc:dd:ee:01"],
      hostnames: ["AP7"],
    });
  });
});
