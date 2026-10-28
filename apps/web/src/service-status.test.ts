import { describe, expect, it } from "vitest";
import {
  parsePublicServiceStatus,
  parseStatusOverview,
} from "./service-status";

const SERVICE_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_SERVICE_ID = "00000000-0000-4000-8000-000000000002";
const MAINTENANCE_ID = "00000000-0000-4000-8000-000000000003";
const PUBLIC_ID = "00000000-0000-4000-8000-000000000004";
const STARTS_AT = "2026-11-04T08:00:00.000Z";
const ENDS_AT = "2026-11-04T09:00:00.000Z";
const UPDATED_AT = "2026-10-28T12:00:00.000Z";

function uuidFor(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function internalService(id = SERVICE_ID) {
  return {
    id,
    name: "Kundenportal",
    status: "operational",
    statusPublic: true,
    updatedAt: UPDATED_AT,
  };
}

function internalMaintenance(overrides: Record<string, unknown> = {}) {
  return {
    id: MAINTENANCE_ID,
    title: "Datenbankwartung",
    description: "Kurzer Unterbruch für Updates.",
    startsAt: STARTS_AT,
    endsAt: ENDS_AT,
    state: "scheduled",
    publicEnabled: true,
    serviceIds: [SERVICE_ID],
    updatedAt: UPDATED_AT,
    ...overrides,
  };
}

function overviewResponse(
  maintenances: unknown = [internalMaintenance()],
  overrides: Record<string, unknown> = {},
) {
  return {
    data: {
      canManagePublication: true,
      page: {
        publicEnabled: true,
        publicId: PUBLIC_ID,
        title: "Systemstatus",
        updatedAt: UPDATED_AT,
      },
      services: [internalService()],
      events: [],
      maintenances,
      ...overrides,
    },
  };
}

function publicService() {
  return {
    name: "Kundenportal",
    status: "operational",
    updatedAt: UPDATED_AT,
    history: [],
  };
}

function publicMaintenance(overrides: Record<string, unknown> = {}) {
  return {
    title: "Datenbankwartung",
    description: "Kurzer Unterbruch für Updates.",
    startsAt: STARTS_AT,
    endsAt: ENDS_AT,
    state: "active",
    serviceNames: ["Kundenportal"],
    ...overrides,
  };
}

function publicResponse(
  maintenances: unknown = [publicMaintenance()],
  overrides: Record<string, unknown> = {},
) {
  return {
    data: {
      title: "Systemstatus",
      overallStatus: "maintenance",
      services: [publicService()],
      maintenances,
      accentColor: null,
      logoUrl: null,
      generatedAt: UPDATED_AT,
      ...overrides,
    },
  };
}

describe("Status-Wartungsparser", () => {
  it("liest eine vollständige interne Wartung nur mit bekannten Services", () => {
    const overview = parseStatusOverview(overviewResponse());

    expect(overview.maintenances).toEqual([
      {
        id: MAINTENANCE_ID,
        title: "Datenbankwartung",
        description: "Kurzer Unterbruch für Updates.",
        startsAt: STARTS_AT,
        endsAt: ENDS_AT,
        state: "scheduled",
        publicEnabled: true,
        serviceIds: [SERVICE_ID],
        updatedAt: UPDATED_AT,
      },
    ]);
  });

  it("normalisiert interne UUIDs klein und vergleicht Referenzen damit", () => {
    const response = overviewResponse([
      internalMaintenance({
        id: MAINTENANCE_ID.toUpperCase(),
        serviceIds: [SERVICE_ID.toUpperCase()],
      }),
    ]) as {
      data: {
        events: unknown[];
        page: { publicId: string };
        services: Array<{ id: string }>;
      };
    };
    response.data.page.publicId = PUBLIC_ID.toUpperCase();
    const firstService = response.data.services.at(0);
    if (!firstService) throw new Error("Testdaten ohne Service");
    firstService.id = SERVICE_ID.toUpperCase();
    response.data.events = [
      {
        serviceId: SERVICE_ID.toUpperCase(),
        status: "operational",
        changedAt: UPDATED_AT,
      },
    ];

    const overview = parseStatusOverview(response);

    expect(overview.page.publicId).toBe(PUBLIC_ID);
    expect(overview.services.at(0)?.id).toBe(SERVICE_ID);
    expect(overview.events.at(0)?.serviceId).toBe(SERVICE_ID);
    expect(overview.maintenances[0]).toMatchObject({
      id: MAINTENANCE_ID,
      serviceIds: [SERVICE_ID],
    });
  });

  it("weist unbekannte Wartungs-Service-IDs und ungültige Zustände ab", () => {
    expect(() =>
      parseStatusOverview(
        overviewResponse([
          internalMaintenance({ serviceIds: [OTHER_SERVICE_ID] }),
        ]),
      ),
    ).toThrow("Wartungsliste");
    expect(() =>
      parseStatusOverview(
        overviewResponse([internalMaintenance({ serviceIds: [] })]),
      ),
    ).toThrow("Wartungsliste");
    expect(() =>
      parseStatusOverview(
        overviewResponse([internalMaintenance({ state: "draft" })]),
      ),
    ).toThrow("Wartungsliste");
  });

  it("weist laxe Zeitwerte und einzeichige Wartungstitel ab", () => {
    expect(() =>
      parseStatusOverview(
        overviewResponse([
          internalMaintenance({ startsAt: "2026-11-04T08:00Z" }),
        ]),
      ),
    ).toThrow("Wartungsliste");
    expect(() =>
      parseStatusOverview(overviewResponse([internalMaintenance({ title: "W" })])),
    ).toThrow("Wartungsliste");
    expect(() =>
      parsePublicServiceStatus(
        publicResponse([publicMaintenance({ title: "W" })]),
      ),
    ).toThrow("nicht verfügbar");
  });

  it("weist Wartungen mit mehr als 100 Service-IDs ab", () => {
    const serviceIds = Array.from({ length: 101 }, (_, index) =>
      uuidFor(index + 100),
    );

    expect(() =>
      parseStatusOverview(
        overviewResponse(
          [internalMaintenance({ serviceIds })],
          { services: serviceIds.map((id) => internalService(id)) },
        ),
      ),
    ).toThrow("Wartungsliste");
  });

  it("weist unvollständige Overview-Antworten ohne Wartungsliste ab", () => {
    const response = overviewResponse() as {
      data: Record<string, unknown>;
    };
    delete response.data.maintenances;

    expect(() => parseStatusOverview(response)).toThrow("unvollständig");
  });

  it("weist alle überschrittenen internen Collection-Obergrenzen ab", () => {
    expect(() =>
      parseStatusOverview(
        overviewResponse(undefined, {
          services: Array.from({ length: 501 }, (_, index) =>
            internalService(uuidFor(index + 1_000)),
          ),
        }),
      ),
    ).toThrow("zulässige Grösse");
    expect(() =>
      parseStatusOverview(
        overviewResponse(undefined, {
          events: Array.from({ length: 15_001 }, () => ({
            serviceId: SERVICE_ID,
            status: "operational",
            changedAt: UPDATED_AT,
          })),
        }),
      ),
    ).toThrow("zulässige Grösse");
    expect(() =>
      parseStatusOverview(
        overviewResponse(
          Array.from({ length: 501 }, (_, index) =>
            internalMaintenance({ id: uuidFor(index + 2_000) }),
          ),
        ),
      ),
    ).toThrow("zulässige Grösse");
  });

  it("liest nur öffentliche geplante oder aktive Wartungen", () => {
    const payload = parsePublicServiceStatus(publicResponse());

    expect(payload.overallStatus).toBe("maintenance");
    expect(payload.maintenances).toEqual([
      {
        title: "Datenbankwartung",
        description: "Kurzer Unterbruch für Updates.",
        startsAt: STARTS_AT,
        endsAt: ENDS_AT,
        state: "active",
        serviceNames: ["Kundenportal"],
      },
    ]);
  });

  it("akzeptiert nur kanonische sichere Stilwerte", () => {
    expect(
      parsePublicServiceStatus(
        publicResponse(undefined, {
          accentColor: "#a1b2c3",
          logoUrl: "https://cdn.example.com/logo.svg",
        }),
      ),
    ).toMatchObject({
      accentColor: "#a1b2c3",
      logoUrl: "https://cdn.example.com/logo.svg",
    });
    expect(() =>
      parsePublicServiceStatus(publicResponse(undefined, { accentColor: "#abc" })),
    ).toThrow("nicht verfügbar");
    expect(() =>
      parsePublicServiceStatus(
        publicResponse(undefined, { accentColor: " #a1b2c3" }),
      ),
    ).toThrow("nicht verfügbar");
    expect(() =>
      parsePublicServiceStatus(
        publicResponse(undefined, {
          logoUrl: "https://name:secret@example.com/logo.svg",
        }),
      ),
    ).toThrow("nicht verfügbar");
    expect(() =>
      parsePublicServiceStatus(
        publicResponse(undefined, { logoUrl: "https://cdn.example.com" }),
      ),
    ).toThrow("nicht verfügbar");
  });

  it("weist nicht öffentliche Wartungszustände und ungültige Service-Namen ab", () => {
    expect(() =>
      parsePublicServiceStatus(
        publicResponse([publicMaintenance({ state: "completed" })]),
      ),
    ).toThrow("nicht verfügbar");
    expect(() =>
      parsePublicServiceStatus(
        publicResponse([publicMaintenance({ serviceNames: [null] })]),
      ),
    ).toThrow("nicht verfügbar");
    expect(() =>
      parsePublicServiceStatus(
        publicResponse([publicMaintenance({ serviceNames: [] })]),
      ),
    ).toThrow("nicht verfügbar");
  });

  it("weist alle überschrittenen öffentlichen Collection-Obergrenzen ab", () => {
    expect(() =>
      parsePublicServiceStatus(
        publicResponse(undefined, {
          services: Array.from({ length: 501 }, () => publicService()),
        }),
      ),
    ).toThrow("nicht verfügbar");
    expect(() =>
      parsePublicServiceStatus(
        publicResponse(
          Array.from({ length: 101 }, () => publicMaintenance()),
        ),
      ),
    ).toThrow("nicht verfügbar");
  });
});
