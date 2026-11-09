import { describe, expect, it } from "vitest";

import {
  DEFAULT_HOME_LAYOUT,
  isHomeLayoutDefault,
  moveHomeSection,
  normalizeHomeLayout,
  parseStoredHomeLayout,
  toggleHomeSection,
  visibleHomeSections,
} from "../lib/home-layout";

describe("Home-Layout der App", () => {
  it("beginnt mit allen Bereichen in Standardreihenfolge", () => {
    expect(visibleHomeSections(DEFAULT_HOME_LAYOUT)).toEqual(
      DEFAULT_HOME_LAYOUT.order,
    );
    expect(isHomeLayoutDefault(DEFAULT_HOME_LAYOUT)).toBe(true);
  });

  it("verschiebt Bereiche nach oben und unten, aber nicht über den Rand", () => {
    const down = moveHomeSection(DEFAULT_HOME_LAYOUT, "search", 1);
    expect(down.order[0]).toBe("focus");
    expect(down.order[1]).toBe("search");
    expect(moveHomeSection(DEFAULT_HOME_LAYOUT, "search", -1)).toBe(
      DEFAULT_HOME_LAYOUT,
    );
    expect(isHomeLayoutDefault(down)).toBe(false);
  });

  it("blendet Bereiche aus und wieder ein", () => {
    const hidden = toggleHomeSection(DEFAULT_HOME_LAYOUT, "devices");
    expect(visibleHomeSections(hidden)).not.toContain("devices");
    expect(visibleHomeSections(toggleHomeSection(hidden, "devices"))).toContain(
      "devices",
    );
  });

  it("macht gespeicherte Werte gültig", () => {
    const layout = normalizeHomeLayout({
      order: ["tickets", "unbekannt", "tickets", "search"],
      hidden: ["search", "gibtsnicht", "search"],
    });
    expect(layout.order.slice(0, 2)).toEqual(["tickets", "search"]);
    expect(layout.order).toHaveLength(DEFAULT_HOME_LAYOUT.order.length);
    expect(layout.hidden).toEqual(["search"]);
  });

  it("fällt bei kaputten Daten auf den Standard zurück", () => {
    expect(parseStoredHomeLayout(null)).toBe(DEFAULT_HOME_LAYOUT);
    expect(parseStoredHomeLayout("{kaputt")).toBe(DEFAULT_HOME_LAYOUT);
    expect(parseStoredHomeLayout("42").order).toEqual(
      DEFAULT_HOME_LAYOUT.order,
    );
  });
});
