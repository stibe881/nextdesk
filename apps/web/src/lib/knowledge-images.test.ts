import { describe, expect, it } from "vitest";
import {
  insertMarkdownBlock,
  knowledgeImageUrlTransform,
  parseKnowledgeImageUrls,
  parseUploadedKnowledgeImage,
} from "./knowledge-images";

const imageId = "0b6f6f3e-5d2c-4c41-9a43-2f1d7c0f9e11";

describe("Bilder in Wissensartikeln", () => {
  it("liest die signierten Bild-URLs streng", () => {
    expect(parseKnowledgeImageUrls(undefined)).toEqual({});
    expect(
      parseKnowledgeImageUrls({ [imageId]: "https://cdn.example/bild.png" }),
    ).toEqual({ [imageId]: "https://cdn.example/bild.png" });
    expect(parseKnowledgeImageUrls({ "kein-id": "https://x" })).toBeNull();
    expect(
      parseKnowledgeImageUrls({ [imageId]: "javascript:alert(1)" }),
    ).toBeNull();
    expect(parseKnowledgeImageUrls([])).toBeNull();
  });

  it("prüft die Antwort des Bild-Uploads", () => {
    expect(
      parseUploadedKnowledgeImage({
        data: {
          id: imageId,
          markdown: `![Ablauf](kb-image:${imageId})`,
          url: "https://cdn.example/bild.png",
        },
      }),
    ).toEqual({
      id: imageId,
      markdown: `![Ablauf](kb-image:${imageId})`,
      url: "https://cdn.example/bild.png",
    });
    expect(
      parseUploadedKnowledgeImage({
        data: { id: imageId, markdown: "![x](https://fremd)", url: null },
      }),
    ).toBeNull();
  });

  it("löst kb-image-Verweise über die URL-Liste auf", () => {
    const transform = knowledgeImageUrlTransform({
      [imageId]: "https://cdn.example/bild.png",
    });
    expect(transform(`kb-image:${imageId}`)).toBe(
      "https://cdn.example/bild.png",
    );
    expect(transform("kb-image:00000000-0000-4000-8000-000000000000")).toBe("");
    expect(transform("https://example.ch/a")).toBe("https://example.ch/a");
    expect(transform("javascript:alert(1)")).toBe("");
  });

  it("fügt das Bild als eigenen Absatz an der Cursorposition ein", () => {
    expect(insertMarkdownBlock("", 0, 0, "![a](kb-image:1)")).toEqual({
      text: "![a](kb-image:1)\n",
      cursor: 17,
    });
    const result = insertMarkdownBlock(
      "Erster Satz.Zweiter",
      12,
      12,
      "![a](x)",
    );
    expect(result.text).toBe("Erster Satz.\n\n![a](x)\nZweiter");
    expect(result.text.slice(0, result.cursor)).toBe(
      "Erster Satz.\n\n![a](x)\n",
    );
    expect(insertMarkdownBlock("A\n\nB", 3, 4, "![a](x)").text).toBe(
      "A\n\n![a](x)\n",
    );
  });
});
