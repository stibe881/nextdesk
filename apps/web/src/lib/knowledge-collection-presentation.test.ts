import { describe, expect, it } from "vitest";
import {
  articleMatchesKnowledgeCollectionFilter,
  formatKnowledgeCollectionPaths,
  knowledgeTopicCategories,
  knowledgeTopicSubcategories,
  resolveKnowledgeTopicSelection,
  visibleKnowledgeArticleRevision,
} from "./knowledge-collection-presentation";

const collections = [
  {
    active: true,
    id: "hardware",
    name: "Hardware",
    parentId: null,
    slug: "hardware",
  },
  {
    active: true,
    id: "hardware-drucker",
    name: "Drucker",
    parentId: "hardware",
    slug: "drucker",
  },
  {
    active: false,
    id: "legacy",
    name: "Altbestand",
    parentId: null,
    slug: "altbestand",
  },
  {
    active: true,
    id: "orphan",
    name: "Ohne Oberkategorie",
    parentId: "missing",
    slug: "ohne-oberkategorie",
  },
  {
    active: true,
    id: "too-deep",
    name: "Zu tief",
    parentId: "hardware-drucker",
    slug: "zu-tief",
  },
];

const importedVisibilityCollections = [
  {
    active: true,
    id: "ict-internal",
    name: "ICT intern",
    parentId: null,
    slug: "legacy-root-ict-intern",
  },
  {
    active: true,
    id: "ict-public",
    name: "ICT öffentlich",
    parentId: null,
    slug: "legacy-root-ict-oeffentlich",
  },
  {
    active: true,
    id: "wlan",
    name: "WLAN",
    parentId: "ict-public",
    slug: "wlan",
  },
  {
    active: true,
    id: "toniebox",
    name: "Toniebox",
    parentId: "ict-internal",
    slug: "toniebox",
  },
  {
    active: false,
    id: "old-topic",
    name: "Alt",
    parentId: "ict-public",
    slug: "alt",
  },
];

describe("Wissenskategorie-Darstellung", () => {
  it("fasst eine zugeordnete Ober- und Unterkategorie zu einem Pfad zusammen", () => {
    expect(
      formatKnowledgeCollectionPaths(
        ["hardware", "hardware-drucker"],
        collections,
      ),
    ).toEqual(["Hardware · Drucker"]);
  });

  it("zeigt bei einer bekannten Unterkategorie die bekannte Oberkategorie als Kontext", () => {
    expect(
      formatKnowledgeCollectionPaths(["hardware-drucker"], collections),
    ).toEqual(["Hardware · Drucker"]);
  });

  it("zeigt bei importierten Sichtbarkeitsgruppen nur das fachliche Thema", () => {
    expect(
      formatKnowledgeCollectionPaths(
        ["ict-public", "wlan", "ict-internal", "toniebox"],
        importedVisibilityCollections,
      ),
    ).toEqual(["WLAN", "Toniebox"]);
  });

  it("blendet unbekannte, inaktive und unvollständige Hierarchien fail-soft aus", () => {
    expect(
      formatKnowledgeCollectionPaths(
        ["unknown", "legacy", "orphan", "too-deep"],
        collections,
      ),
    ).toEqual([]);
  });
});

describe("Wissenskategorie-Filter", () => {
  it("findet über eine Kategorie direkte und untergeordnete Artikelzuordnungen", () => {
    expect(
      articleMatchesKnowledgeCollectionFilter(["hardware"], collections, {
        categoryId: "hardware",
        subcategoryId: "",
      }),
    ).toBe(true);
    expect(
      articleMatchesKnowledgeCollectionFilter(
        ["hardware-drucker"],
        collections,
        { categoryId: "hardware", subcategoryId: "" },
      ),
    ).toBe(true);
  });

  it("grenzt eine Unterkategorie auf ihre exakte Zuordnung ein", () => {
    expect(
      articleMatchesKnowledgeCollectionFilter(
        ["hardware-drucker"],
        collections,
        { categoryId: "hardware", subcategoryId: "hardware-drucker" },
      ),
    ).toBe(true);
    expect(
      articleMatchesKnowledgeCollectionFilter(["hardware"], collections, {
        categoryId: "hardware",
        subcategoryId: "hardware-drucker",
      }),
    ).toBe(false);
  });

  it("bietet Themen unter importierten Sichtbarkeitsgruppen als Kategorien an", () => {
    expect(
      knowledgeTopicCategories(importedVisibilityCollections).map(
        (collection) => collection.name,
      ),
    ).toEqual(["Toniebox", "WLAN"]);
    expect(
      knowledgeTopicSubcategories(importedVisibilityCollections, "wlan"),
    ).toEqual([]);
    expect(
      articleMatchesKnowledgeCollectionFilter(
        ["wlan"],
        importedVisibilityCollections,
        { categoryId: "wlan", subcategoryId: "" },
      ),
    ).toBe(true);
    expect(
      articleMatchesKnowledgeCollectionFilter(
        ["ict-public"],
        importedVisibilityCollections,
        { categoryId: "wlan", subcategoryId: "" },
      ),
    ).toBe(false);
  });

  it("erkennt importierte Sichtbarkeitsgruppen trotz Umbenennung über ihren stabilen Import-Slug", () => {
    const renamedCollections = importedVisibilityCollections.map(
      (collection) =>
        collection.id === "ict-public"
          ? { ...collection, name: "Öffentliche Anleitungen" }
          : collection,
    );

    expect(
      knowledgeTopicCategories(renamedCollections).map(
        (collection) => collection.name,
      ),
    ).toEqual(["Toniebox", "WLAN"]);
    expect(
      formatKnowledgeCollectionPaths(["wlan"], renamedCollections),
    ).toEqual(["WLAN"]);
  });

  it("blendet eine unvollständige importierte Sichtbarkeitsgruppe weiterhin fail-soft aus", () => {
    const incompleteCollections = importedVisibilityCollections.filter(
      (collection) => collection.id !== "wlan" && collection.id !== "toniebox",
    );

    expect(knowledgeTopicCategories(incompleteCollections)).toEqual([]);
    expect(
      formatKnowledgeCollectionPaths(["ict-public"], incompleteCollections),
    ).toEqual([]);
  });

  it("behält eine reguläre Kategorie mit dem Namen Intern sichtbar", () => {
    const regularCollections = [
      {
        active: true,
        id: "internal-processes",
        name: "Intern",
        parentId: null,
        slug: "interne-prozesse",
      },
      {
        active: true,
        id: "internal-processes-hr",
        name: "HR",
        parentId: "internal-processes",
        slug: "hr",
      },
    ];

    expect(
      knowledgeTopicCategories(regularCollections).map(
        (collection) => collection.name,
      ),
    ).toEqual(["Intern"]);
    expect(
      knowledgeTopicSubcategories(regularCollections, "internal-processes").map(
        (collection) => collection.name,
      ),
    ).toEqual(["HR"]);
  });

  it("stellt die Editorwahl für reguläre Unterkategorien und importierte Themen sicher wieder her", () => {
    expect(
      resolveKnowledgeTopicSelection(
        ["hardware", "hardware-drucker"],
        collections,
      ),
    ).toEqual({ categoryId: "hardware", subcategoryId: "hardware-drucker" });
    expect(
      resolveKnowledgeTopicSelection(
        ["ict-public", "wlan"],
        importedVisibilityCollections,
      ),
    ).toEqual({ categoryId: "wlan", subcategoryId: "" });
    expect(
      resolveKnowledgeTopicSelection(["unknown", "orphan"], collections),
    ).toEqual({ categoryId: "", subcategoryId: "" });
  });

  it("zeigt eine falsch platzierte technische Importgruppe nie als fachliche Einordnung", () => {
    const malformedLegacyGroup = [
      ...collections,
      {
        active: true,
        id: "misplaced-legacy-root",
        name: "Technische Gruppe",
        parentId: "hardware",
        slug: "legacy-root-ict-oeffentlich",
      },
    ];

    expect(
      knowledgeTopicSubcategories(malformedLegacyGroup, "hardware").map(
        (collection) => collection.id,
      ),
    ).toEqual(["hardware-drucker"]);
    expect(
      formatKnowledgeCollectionPaths(
        ["misplaced-legacy-root"],
        malformedLegacyGroup,
      ),
    ).toEqual([]);
    expect(
      articleMatchesKnowledgeCollectionFilter(
        ["misplaced-legacy-root"],
        malformedLegacyGroup,
        { categoryId: "misplaced-legacy-root", subcategoryId: "" },
      ),
    ).toBe(false);
  });

  it("grenzt Sichtbarkeitsgruppen weiterhin aus der Kategorienfilterung aus", () => {
    expect(
      articleMatchesKnowledgeCollectionFilter(
        ["wlan"],
        importedVisibilityCollections,
        { categoryId: "ict-public", subcategoryId: "" },
      ),
    ).toBe(false);
  });

  it("findet bei unbekannten, inaktiven oder unvollständigen Filtern nichts", () => {
    expect(
      articleMatchesKnowledgeCollectionFilter(["hardware"], collections, {
        categoryId: "legacy",
        subcategoryId: "",
      }),
    ).toBe(false);
    expect(
      articleMatchesKnowledgeCollectionFilter(["orphan"], collections, {
        categoryId: "",
        subcategoryId: "orphan",
      }),
    ).toBe(false);
  });
});

describe("Sichtbare Wissensartikelversion", () => {
  it("bevorzugt immer die vom Backend gelieferte sichtbare Revision", () => {
    expect(
      visibleKnowledgeArticleRevision(
        {
          collectionIds: [],
          currentRevision: 7,
          publishedRevision: 4,
          visibility: "external",
        },
        { revision: 4 },
      ),
    ).toBe(4);
  });

  it("fällt intern auf die aktuelle und extern nur auf die veröffentlichte Revision zurück", () => {
    expect(
      visibleKnowledgeArticleRevision(
        {
          collectionIds: [],
          currentRevision: 7,
          publishedRevision: 4,
          visibility: "internal",
        },
        null,
      ),
    ).toBe(7);
    expect(
      visibleKnowledgeArticleRevision(
        {
          collectionIds: [],
          currentRevision: 7,
          publishedRevision: 4,
          visibility: "external",
        },
        null,
      ),
    ).toBe(4);
  });
});
