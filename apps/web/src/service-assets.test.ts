import { describe, expect, it } from "vitest";
import {
  canArchiveServices,
  catalogRequest,
  parseCatalog,
  sortServiceCategories,
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

const SERVICE_CATEGORY = {
  id: "00000000-0000-4000-8000-000000000003",
  tenant_id: SERVICE.tenant_id,
  name: "Verwaltung",
  parent_id: null,
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

  it("liest eine serverbestätigte Servicehierarchie und die optionale Zuordnung", () => {
    const catalog = parseCatalog({
      data: {
        ...legacyCatalogResponse().data,
        services: [{ ...SERVICE, service_category_id: SERVICE_CATEGORY.id }],
        archivedServices: [],
        canManageServices: true,
        serviceCategories: [SERVICE_CATEGORY],
      },
    });

    expect(catalog.supportsServiceCategories).toBe(true);
    expect(catalog.serviceCategories).toEqual([SERVICE_CATEGORY]);
    expect(catalog.services[0]?.service_category_id).toBe(SERVICE_CATEGORY.id);
  });

  it("ordnet Unterkategorien unmittelbar unter ihrer alphabetisch sortierten Wurzel ein", () => {
    const root = { ...SERVICE_CATEGORY, id: "root", name: "Verwaltung" };
    const child = {
      ...SERVICE_CATEGORY,
      id: "child",
      name: "Abacus",
      parent_id: root.id,
    };
    const detail = {
      ...SERVICE_CATEGORY,
      id: "detail",
      name: "Berechtigungen",
      parent_id: child.id,
    };
    const otherRoot = {
      ...SERVICE_CATEGORY,
      id: "other-root",
      name: "Arbeitsplatz",
    };

    expect(
      sortServiceCategories([child, detail, root, otherRoot]).map(
        (category) => category.id,
      ),
    ).toEqual([otherRoot.id, root.id, child.id, detail.id]);
  });
});
