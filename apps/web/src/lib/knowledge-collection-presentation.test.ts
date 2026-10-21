import { describe, expect, it } from "vitest";
import {
  formatKnowledgeCollectionPaths,
  visibleKnowledgeArticleRevision,
} from "./knowledge-collection-presentation";

const collections = [
  { active: true, id: "hardware", name: "Hardware", parentId: null },
  {
    active: true,
    id: "hardware-drucker",
    name: "Drucker",
    parentId: "hardware",
  },
  { active: false, id: "legacy", name: "Altbestand", parentId: null },
  {
    active: true,
    id: "orphan",
    name: "Ohne Oberkategorie",
    parentId: "missing",
  },
  {
    active: true,
    id: "too-deep",
    name: "Zu tief",
    parentId: "hardware-drucker",
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

  it("blendet unbekannte, inaktive und unvollständige Hierarchien fail-soft aus", () => {
    expect(
      formatKnowledgeCollectionPaths(
        ["unknown", "legacy", "orphan", "too-deep"],
        collections,
      ),
    ).toEqual([]);
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
