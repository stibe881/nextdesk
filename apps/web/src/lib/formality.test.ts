import { afterEach, describe, expect, it } from "vitest";
import {
  getFormality,
  isFormality,
  resolveFormalityPairs,
  setFormality,
  tn,
} from "./formality";

describe("formality", () => {
  afterEach(() => setFormality("du"));

  it("defaults to du and switches texts", () => {
    expect(getFormality()).toBe("du");
    expect(
      tn("Öffne die Einstellungen.", "Öffnen Sie die Einstellungen."),
    ).toBe("Öffne die Einstellungen.");
    setFormality("sie");
    expect(
      tn("Öffne die Einstellungen.", "Öffnen Sie die Einstellungen."),
    ).toBe("Öffnen Sie die Einstellungen.");
  });

  it("accepts only known values", () => {
    expect(isFormality("du")).toBe(true);
    expect(isFormality("sie")).toBe(true);
    expect(isFormality("Sie")).toBe(false);
    expect(isFormality(null)).toBe(false);
  });

  it("resolves server pairs inside JSON text", () => {
    const body = JSON.stringify({
      error: {
        message: "⟦Dir fehlt die Berechtigung.␞Ihnen fehlt die Berechtigung.⟧",
      },
      other: "unverändert",
    });
    expect(resolveFormalityPairs(body, "du")).toContain(
      "Dir fehlt die Berechtigung.",
    );
    expect(resolveFormalityPairs(body, "sie")).toContain(
      "Ihnen fehlt die Berechtigung.",
    );
    expect(resolveFormalityPairs("ohne Paar", "sie")).toBe("ohne Paar");
  });
});
