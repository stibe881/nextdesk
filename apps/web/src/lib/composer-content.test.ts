import { describe, expect, it } from "vitest";
import {
  composerParts,
  composerPlainText,
  finalizeComposerBody,
  keepComposerImages,
  pendingImageKeys,
  pendingImageMarker,
} from "./composer-content";

describe("Nachrichtenfeld mit Bildern", () => {
  const value = `Hallo\n\n${pendingImageMarker("a1")}\nDanach weiter\n${pendingImageMarker("b2")}`;

  it("zerlegt Text und Bilder in Reihenfolge", () => {
    expect(composerParts(value)).toEqual([
      { kind: "text", value: "Hallo\n\n" },
      { kind: "image", key: "a1" },
      { kind: "text", value: "\nDanach weiter\n" },
      { kind: "image", key: "b2" },
    ]);
    expect(pendingImageKeys(value)).toEqual(["a1", "b2"]);
  });

  it("setzt beim Senden die Anhänge ein und entfernt fehlende Bilder", () => {
    const id = "6f1c2b8e-1d2a-4b3c-9d4e-5f6a7b8c9d0e";
    expect(finalizeComposerBody(value, new Map([["a1", id]]))).toBe(
      `Hallo\n\n[[nextdesk-inline-image:${id}]]\nDanach weiter`,
    );
  });

  it("liefert den sichtbaren Text ohne Bilder", () => {
    expect(composerPlainText(pendingImageMarker("x"))).toBe("");
    expect(composerPlainText(value)).toBe("Hallo\n\n\nDanach weiter");
  });

  it("behält Bilder nach einer Umformulierung", () => {
    expect(keepComposerImages(value, "Guten Tag")).toBe(
      `Guten Tag\n\n${pendingImageMarker("a1")}\n${pendingImageMarker("b2")}`,
    );
  });
});
