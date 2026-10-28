import { describe, expect, it } from "vitest";
import { searchTicketCatalogItems } from "./ticket-catalog-search";

const catalog = [
  {
    kind: "asset" as const,
    id: "asset-1",
    label: "NB001",
    description: "Asset-Kennung: NB001 · Typ: Notebook · Status: Active",
  },
  {
    kind: "service" as const,
    id: "service-1",
    label: "VPN",
    description:
      "Zugang für Mitarbeitende im Aussendienst · Kritikalität: Mittel",
  },
  {
    kind: "problem" as const,
    id: "problem-1",
    label: "Drucker im Gebäude A",
    description: "Papierstau im dritten Stock · Status: open",
  },
];

describe("searchTicketCatalogItems", () => {
  it("findet Assets nach Name, Asset-Kennung und mehreren Suchbegriffen", () => {
    expect(searchTicketCatalogItems(catalog, "nb001")).toEqual([catalog[0]]);
    expect(searchTicketCatalogItems(catalog, "kennung nb001")).toEqual([
      catalog[0],
    ]);
  });

  it("findet weitere erlaubte Katalogtypen über Beschreibung und unterscheidet Umlaute nicht", () => {
    expect(searchTicketCatalogItems(catalog, "aussendienst")).toEqual([
      catalog[1],
    ]);
    expect(searchTicketCatalogItems(catalog, "papierstau")).toEqual([
      catalog[2],
    ]);
    expect(searchTicketCatalogItems(catalog, "gebaude")).toEqual([catalog[2]]);
  });

  it("liefert ohne Suchbegriff keine unaufgeforderte Trefferliste", () => {
    expect(searchTicketCatalogItems(catalog, "")).toEqual([]);
    expect(searchTicketCatalogItems(catalog, "  ")).toEqual([]);
  });

  it("begrenzt die Trefferanzahl ohne die Ausgangsdaten zu verändern", () => {
    expect(searchTicketCatalogItems(catalog, "status", 1)).toEqual([
      catalog[0],
    ]);
    expect(catalog).toHaveLength(3);
  });
});
