import { describe, expect, it } from "vitest";
import { pushCategoryMeta } from "./push-notifications";

describe("Push-Präferenzen für das Lager", () => {
  it("bezeichnet die persönliche Opt-in-Kategorie neutral", () => {
    expect(pushCategoryMeta.inventory_low_stock).toEqual({
      description:
        "Mindestbestand erreicht, Nachbestellung und fällige Inventur",
      label: "Lager",
    });
  });
});

describe("Kategorie IP-Adressverwaltung", () => {
  it("ist eine eigene Kategorie", () => {
    expect(pushCategoryMeta.ipam.label).toBe("IP-Adressverwaltung");
  });
});
