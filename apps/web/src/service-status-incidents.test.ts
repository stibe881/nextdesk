import { describe, expect, it } from "vitest";
import {
  formatAvailability,
  incidentMessagesToPublic,
  parseIncidentMessages,
  parsePublicIncidents,
} from "./service-status-incidents";
import { failingDevices, parseServiceInsights } from "./service-insights";
import { parseAvailability } from "./service-status";
import { ASSET_PAGE_SIZE, catalogRequest } from "./service-assets";
import { parseServiceAvailability } from "./service-reporting";
import { defaultMaintenanceWindow, localDateTimeToIso } from "./service-tasks";

const TENANT = "10000000-0000-4000-8000-000000000001";
const NOTICE = "40000000-0000-4000-8000-000000000004";
const SERVICE = "30000000-0000-4000-8000-000000000003";

describe("Störungsmeldungen", () => {
  const message = {
    id: NOTICE,
    state: "monitoring",
    title: "Mail gestört",
    body: "Wir beobachten.",
    publicEnabled: false,
    monitoringIncidentId: null,
    serviceIds: [SERVICE, "kaputt"],
    startsAt: "2026-11-10T08:00:00Z",
    resolvedAt: null,
    createdAt: "2026-11-10T08:00:00Z",
    updatedAt: "2026-11-10T09:00:00Z",
    updates: [
      {
        id: "u2",
        state: "monitoring",
        title: "Mail gestört",
        body: "Wir beobachten.",
        createdAt: "2026-11-10T09:00:00Z",
      },
      { id: "u1", state: "kaputt" },
    ],
  };

  it("liest gültige Meldungen und lässt ungültige Teile weg", () => {
    const [parsed, ...rest] = parseIncidentMessages([message, { id: "x" }]);
    expect(rest).toHaveLength(0);
    expect(parsed?.serviceIds).toEqual([SERVICE]);
    expect(parsed?.updates).toHaveLength(1);
    expect(parseIncidentMessages(null)).toEqual([]);
  });

  it("zeigt intern alle, öffentlich nur veröffentlichte Meldungen", () => {
    const parsed = parseIncidentMessages([message]);
    const names = new Map([[SERVICE, "Mail"]]);
    expect(
      incidentMessagesToPublic(parsed, names, false)[0]?.serviceNames,
    ).toEqual(["Mail"]);
    expect(incidentMessagesToPublic(parsed, names, true)).toHaveLength(0);
  });

  it("liest die öffentliche Sicht ohne interne Kennungen", () => {
    const [incident] = parsePublicIncidents([
      {
        title: "Mail gestört",
        body: "Behoben.",
        state: "resolved",
        startsAt: "2026-11-10T08:00:00Z",
        resolvedAt: "2026-11-10T10:00:00Z",
        updatedAt: "2026-11-10T10:00:00Z",
        serviceNames: ["Mail", 3],
        updates: [
          {
            state: "resolved",
            body: "Behoben.",
            createdAt: "2026-11-10T10:00:00Z",
          },
        ],
      },
      { title: "ungültig" },
    ]);
    expect(incident?.serviceNames).toEqual(["Mail"]);
    expect(incident).not.toHaveProperty("id");
  });

  it("formatiert die Verfügbarkeit in Schweizer Schreibweise", () => {
    expect(formatAvailability(99.8)).toBe("99.8 %");
    expect(formatAvailability(100)).toBe("100 %");
    expect(formatAvailability(null)).toBe("–");
  });
});

describe("Verfügbarkeit und Dienstansicht", () => {
  it("übernimmt nur Verfügbarkeit bekannter Dienste", () => {
    expect(
      parseAvailability(
        [
          {
            serviceId: SERVICE,
            days30: 100,
            days90: 99.5,
            maintenance90Percent: 1,
          },
          { serviceId: NOTICE, days30: 50 },
          { serviceId: SERVICE.toUpperCase(), days30: 140 },
        ],
        new Set([SERVICE]),
      ),
    ).toEqual([
      {
        serviceId: SERVICE,
        days30: 100,
        days90: 99.5,
        maintenance90Percent: 1,
      },
      {
        serviceId: SERVICE,
        days30: null,
        days90: null,
        maintenance90Percent: null,
      },
    ]);
    expect(parseServiceAvailability(undefined)).toBeNull();
    expect(
      parseServiceAvailability([
        { serviceId: SERVICE, name: "Mail", days90: 99 },
      ]),
    ).toEqual([
      {
        serviceId: SERVICE,
        name: "Mail",
        days30: null,
        days90: 99,
        maintenance90Percent: null,
      },
    ]);
  });

  it("erkennt ausgefallene Geräte eines Dienstes", () => {
    const insights = parseServiceInsights({
      data: {
        availability: { days30: 100, days90: 99.9 },
        dependencies: {
          devices: [
            { assetId: "a1", name: "Switch", openAlerts: 0 },
            {
              assetId: "a2",
              name: "Server",
              incidentNumber: "STO-7",
              openAlerts: 1,
            },
          ],
          subnets: [{ prefix: "10.0.0.0/24", addressCount: 3 }],
          incidents: [],
        },
      },
    });
    expect(insights?.devices).toHaveLength(2);
    expect(
      failingDevices(insights?.devices ?? []).map((device) => device.name),
    ).toEqual(["Server"]);
    expect(insights?.subnets[0]?.prefix).toBe("10.0.0.0/24");
    expect(parseServiceInsights(null)).toBeNull();
  });
});

describe("Katalog seitenweise", () => {
  it("sendet Seite und Filter nur bei Bedarf", () => {
    expect(catalogRequest(TENANT, false, false)).toEqual({
      type: "listCatalog",
      tenantId: TENANT,
    });
    expect(
      catalogRequest(
        TENANT,
        true,
        false,
        {
          offset: 100,
          query: " Drucker ",
          serviceFilter: "all",
          statusFilter: "active",
        },
        ["assets"],
      ),
    ).toEqual({
      type: "listCatalog",
      tenantId: TENANT,
      includeArchivedServices: false,
      sections: ["assets"],
      assetOffset: 100,
      assetLimit: ASSET_PAGE_SIZE,
      assetQuery: "Drucker",
      assetStatus: "active",
    });
  });
});

describe("Wartungsfenster aus Serviceaufgaben", () => {
  it("schlägt den Abend des Fälligkeitstags vor", () => {
    expect(defaultMaintenanceWindow("2026-11-12")).toEqual({
      startsAt: "2026-11-12T18:00",
      endsAt: "2026-11-12T20:00",
    });
    expect(localDateTimeToIso("2026-11-12T18:00")).toMatch(
      /^2026-11-12T\d{2}:00:00\.000Z$/,
    );
    expect(localDateTimeToIso("morgen")).toBeNull();
  });
});
