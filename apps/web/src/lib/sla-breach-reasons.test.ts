import { describe, expect, it } from "vitest";
import { setFormality } from "./formality";
import {
  breachesWithoutReason,
  describeBreachKinds,
  kudosAuthor,
  scoreStars,
  slaBreachReasonLabel,
  validateReasonDraft,
  type SlaBreach,
} from "./sla-breach-reasons";

const breach = (kind: SlaBreach["kind"], withReason = false): SlaBreach => ({
  kind,
  dueAt: "2026-11-01T10:00:00Z",
  reason: withReason
    ? {
        code: "capacity",
        label: "Kapazität / Überlastung",
        note: null,
        recordedAt: "2026-11-02T10:00:00Z",
        recordedByName: "Anna",
      }
    : null,
});

describe("SLA breach reasons", () => {
  it("finds breaches without reason and describes them", () => {
    const list = [breach("resolution"), breach("response", true)];
    expect(breachesWithoutReason(list).map((entry) => entry.kind)).toEqual([
      "resolution",
    ]);
    expect(
      describeBreachKinds([breach("resolution"), breach("response")]),
    ).toBe("Erstreaktion und Lösungsziel");
    expect(slaBreachReasonLabel("third_party")).toBe("Drittanbieter");
  });

  it("validates the reason form", () => {
    expect(validateReasonDraft("", "")).toMatch(/Ursache/);
    expect(validateReasonDraft("other", "  ")).toMatch(/beschreibe/);
    expect(validateReasonDraft("other", "Stromausfall")).toBeNull();
    expect(validateReasonDraft("capacity", "")).toBeNull();
    expect(validateReasonDraft("capacity", "x".repeat(501))).toMatch(/500/);
  });
});

describe("customer praise", () => {
  it("renders stars and hides e-mail addresses", () => {
    expect(scoreStars(4)).toBe("4 von 5 Sternen");
    expect(scoreStars(9)).toBe("5 von 5 Sternen");
    expect(kudosAuthor("Anna Muster")).toBe("Anna Muster");
    expect(kudosAuthor("anna@example.ch")).toBe("Meldende Person");
    expect(kudosAuthor(null)).toBe("Meldende Person");
  });
});

describe("Anrede", () => {
  it("liefert die Sie-Fassung nach der Umschaltung", () => {
    setFormality("sie");
    try {
      expect(validateReasonDraft("", "")).toBe(
        "Bitte wählen Sie eine Ursache.",
      );
    } finally {
      setFormality("du");
    }
  });
});
