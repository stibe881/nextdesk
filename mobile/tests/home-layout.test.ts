import { describe, expect, it } from "vitest";

import {
  DEFAULT_HOME_LAYOUT,
  isHomeLayoutDefault,
  moveHomeSection,
  normalizeHomeLayout,
  parseStoredHomeLayout,
  parseStoredHomeLayoutRecord,
  resolveHomeLayoutSync,
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

  it("gleicht Geräte nach der letzten Änderung ab", () => {
    const older = {
      layout: DEFAULT_HOME_LAYOUT,
      changedAt: "2026-11-09T10:00:00.000Z",
    };
    const newer = {
      layout: toggleHomeSection(DEFAULT_HOME_LAYOUT, "devices"),
      changedAt: "2026-11-09T12:00:00.000Z",
    };
    expect(resolveHomeLayoutSync(null, null)).toBe("none");
    expect(resolveHomeLayoutSync(null, older)).toBe("adopt-remote");
    expect(resolveHomeLayoutSync(newer, null)).toBe("push-local");
    expect(resolveHomeLayoutSync(newer, older)).toBe("push-local");
    expect(resolveHomeLayoutSync(older, newer)).toBe("adopt-remote");
    expect(resolveHomeLayoutSync(older, older)).toBe("adopt-remote");
  });

  it("liest die Geräte-Kopie, auch im älteren Format", () => {
    expect(parseStoredHomeLayoutRecord(null)).toBeNull();
    expect(parseStoredHomeLayoutRecord("{kaputt")).toBeNull();
    const legacy = parseStoredHomeLayoutRecord(
      JSON.stringify({ order: ["tickets"], hidden: ["search"] }),
    );
    expect(legacy?.layout.order[0]).toBe("tickets");
    expect(legacy?.changedAt).toBe("1970-01-01T00:00:00.000Z");
    const current = parseStoredHomeLayoutRecord(
      JSON.stringify({
        layout: DEFAULT_HOME_LAYOUT,
        changedAt: "2026-11-09T12:00:00.000Z",
      }),
    );
    expect(current?.changedAt).toBe("2026-11-09T12:00:00.000Z");
  });
});
