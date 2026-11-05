import { describe, expect, it } from "vitest";
import { buildKnowledgeArticleSaveRequest } from "./knowledge-article-save";

describe("Wissensartikel speichern", () => {
  it("sendet bei einer Bearbeitung nur den Artikelinhalt ohne Kategorienmutation", () => {
    const request = buildKnowledgeArticleSaveRequest({
      articleId: "article-1",
      bodyMarkdown: "# WLAN",
      tenantId: "tenant-1",
      title: "WLAN einrichten",
      visibility: "internal",
    });

    expect(request).toEqual({
      articleId: "article-1",
      bodyMarkdown: "# WLAN",
      tenantId: "tenant-1",
      title: "WLAN einrichten",
      type: "saveArticle",
      visibility: "internal",
    });
    expect(request).not.toHaveProperty("collectionIds");
  });

  it("erstellt neue Artikel ebenfalls ohne Kategorienzuordnung", () => {
    const request = buildKnowledgeArticleSaveRequest({
      bodyMarkdown: "Inhalt",
      tenantId: "tenant-1",
      title: "Neuer Artikel",
      visibility: "external",
    });

    expect(request).not.toHaveProperty("articleId");
    expect(request).not.toHaveProperty("collectionIds");
  });

  it("übermittelt die gewählte Abteilung nur, wenn eine gewählt ist", () => {
    expect(
      buildKnowledgeArticleSaveRequest({
        bodyMarkdown: "Inhalt",
        departmentId: "department-1",
        tenantId: "tenant-1",
        title: "Neuer Artikel",
        visibility: "internal",
      }),
    ).toMatchObject({ departmentId: "department-1" });
    expect(
      buildKnowledgeArticleSaveRequest({
        bodyMarkdown: "Inhalt",
        tenantId: "tenant-1",
        title: "Neuer Artikel",
        visibility: "internal",
      }),
    ).not.toHaveProperty("departmentId");
  });
});
