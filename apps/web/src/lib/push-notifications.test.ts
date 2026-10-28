import { describe, expect, it } from "vitest";
import { pushCategoryMeta } from "./push-notifications";

describe("Push-Präferenzen für Lagerunterbestand", () => {
  it("bezeichnet die persönliche Opt-in-Kategorie neutral", () => {
    expect(pushCategoryMeta.inventory_low_stock).toEqual({
      description:
        "Wenn die Gesamtverfügbarkeit eines Artikels den Mindestbestand erreicht",
      label: "Lagerunterbestand",
    });
  });
});
