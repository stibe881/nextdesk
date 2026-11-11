import { describe, expect, it } from "vitest";

import {
  deviceMeasures,
  internalIndicatorLabel,
  parseIocList,
  parseSecurityContext,
  parseSecurityDetail,
} from "./security-cases";

describe("Sicherheitsfälle: Kontext, Kampagne und IOC", () => {
  it("liest Kampagne, IOC-Treffer und Massnahmen am Fall", () => {
    const detail = parseSecurityDetail({
      data: {
        ticketId: "case-1",
        state: "actions",
        clickedAt: "2026-11-11T08:00:00Z",
        campaign: {
          id: "c1",
          reports: 4,
          reporters: 3,
          caseCount: 2,
          linkDomains: ["evil[.]example", 3],
          cases: [{ ticketId: "case-2", ticketNumber: "SEC-2", state: "x" }],
        },
        iocHits: [
          {
            id: "i1",
            kind: "domain",
            value: "evil[.]example",
            verdict: "phishing",
          },
          { id: "i2", kind: "virus", value: "x" },
        ],
        measures: [
          {
            id: "m1",
            label: "Sitzungen widerrufen",
            status: "failed",
            message: "Berechtigung fehlt",
          },
        ],
      },
    });
    expect(detail?.clickedAt).toBe("2026-11-11T08:00:00Z");
    expect(detail?.campaign?.linkDomains).toEqual(["evil[.]example"]);
    expect(detail?.campaign?.cases[0]?.state).toBe("triage");
    expect(detail?.iocHits.map((hit) => hit.id)).toEqual(["i1"]);
    expect(detail?.measures[0]?.status).toBe("failed");
  });

  it("liest Personen, Geräte und interne Adressen", () => {
    const context = parseSecurityContext({
      data: {
        people: [
          {
            key: "anna@example.ch",
            name: "Anna Muster",
            clicked: true,
            devicesVisible: true,
            devices: [
              {
                id: "a1",
                name: "NB-001",
                intuneActions: ["syncDevice", "windowsDefenderScan", "wipe"],
                network: [{ address: "10.1.2.3", prefix: "10.1.2.0/24" }],
              },
              { name: "ohne ID" },
            ],
          },
          { name: "ohne Schlüssel" },
        ],
        indicators: [
          {
            value: "10[.]1[.]2[.]9",
            kind: "ip",
            match: {
              match: "prefix",
              prefix: "10.1.2.0/24",
              vlan: "20 Verwaltung",
            },
          },
          { value: "192[.]168[.]1[.]1", kind: "ip", privateAddress: true },
        ],
        measures: { entraMessage: "Keine Verbindung" },
      },
    });
    expect(context?.people).toHaveLength(1);
    const device = context!.people[0]!.devices[0]!;
    expect(device.intuneActions).toEqual(["syncDevice", "windowsDefenderScan"]);
    expect(deviceMeasures(device)).toEqual([
      "intune_sync",
      "intune_defender_scan",
    ]);
    expect(internalIndicatorLabel(context!.indicators[0]!)).toBe(
      "Subnetz 10.1.2.0/24 · VLAN 20 Verwaltung",
    );
    expect(internalIndicatorLabel(context!.indicators[1]!)).toContain(
      "Private Adresse",
    );
    expect(context?.measures.entraMessage).toBe("Keine Verbindung");
  });

  it("liest die IOC-Liste", () => {
    expect(
      parseIocList({
        data: {
          iocs: [
            {
              id: "1",
              kind: "ip",
              value: "203.0.113.5",
              status: "harmless",
              hitCount: 2,
            },
            { id: "2", kind: "hash", value: "x" },
          ],
        },
      }),
    ).toEqual([
      expect.objectContaining({ id: "1", status: "harmless", hitCount: 2 }),
    ]);
    expect(parseIocList(null)).toBeNull();
  });
});
