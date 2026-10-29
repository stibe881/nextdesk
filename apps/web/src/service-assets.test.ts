import { describe, expect, it } from "vitest";
import {
  canArchiveServices,
  catalogRequest,
  parseCatalog,
} from "./service-assets";

const SERVICE = {
  id: "00000000-0000-4000-8000-000000000001",
  tenant_id: "00000000-0000-4000-8000-000000000002",
  name: "Kundenportal",
  description: "Zentraler Zugang für Kund:innen.",
  criticality: "high",
  status: "operational",
  status_public: true,
  active: true,
  created_at: "2026-10-29T09:00:00.000Z",
  updated_at: "2026-10-29T09:00:00.000Z",
};

function legacyCatalogResponse() {
  return {
    data: {
      services: [SERVICE],
      assets: [],
      problems: [],
    },
  };
}

describe("Servicekatalog-Compatibility", () => {
  it("sendet den Archivparameter erst nach bestätigter Katalog-Capability", () => {
    expect(catalogRequest(SERVICE.tenant_id, false, true)).toEqual({
      type: "listCatalog",
      tenantId: SERVICE.tenant_id,
    });
    expect(catalogRequest(SERVICE.tenant_id, true, true)).toEqual({
      type: "listCatalog",
      tenantId: SERVICE.tenant_id,
      includeArchivedServices: true,
    });
  });

  it("liest Services einer älteren Function ohne Archiv- und Verantwortlichkeitsfelder", () => {
    const catalog = parseCatalog(legacyCatalogResponse());

    expect(catalog.services).toEqual([
      expect.objectContaining({
        id: SERVICE.id,
        primary_responsible_id: null,
        secondary_responsible_id: null,
      }),
    ]);
    expect(catalog.archivedServices).toEqual([]);
    expect(catalog.canManageServices).toBe(false);
    expect(catalog.supportsArchivedServices).toBe(false);
    expect(canArchiveServices(catalog.canManageServices, false)).toBe(false);
  });

  it("erkennt den erweiterten Contract nur bei einer serverseitigen Archivantwort", () => {
    const catalog = parseCatalog({
      data: {
        ...legacyCatalogResponse().data,
        archivedServices: [],
        canManageServices: true,
      },
    });

    expect(catalog.canManageServices).toBe(true);
    expect(catalog.supportsArchivedServices).toBe(true);
    expect(
      canArchiveServices(
        catalog.canManageServices,
        catalog.supportsArchivedServices,
      ),
    ).toBe(true);
  });

  it("bleibt bei einem partiellen Contract ohne Archivantwort fail-closed", () => {
    const catalog = parseCatalog({
      data: {
        ...legacyCatalogResponse().data,
        canManageServices: true,
      },
    });

    expect(catalog.canManageServices).toBe(true);
    expect(catalog.supportsArchivedServices).toBe(false);
    expect(
      canArchiveServices(
        catalog.canManageServices,
        catalog.supportsArchivedServices,
      ),
    ).toBe(false);
  });
});
