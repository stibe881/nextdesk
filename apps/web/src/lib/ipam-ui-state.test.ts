import { describe, expect, it } from "vitest";
import {
  isSearchShortcut,
  loadPrefs,
  prefixAncestors,
  savePrefs,
} from "./ipam-ui-state";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
}

describe("prefs", () => {
  it("stores view and selection per tenant", () => {
    const storage = memoryStorage();
    savePrefs("t1", { view: "networks", prefixId: "p1" }, storage);
    expect(loadPrefs("t1", storage)).toEqual({
      view: "networks",
      prefixId: "p1",
    });
    expect(loadPrefs("t2", storage)).toEqual({});
  });

  it("survives broken or blocked storage", () => {
    const broken = {
      getItem: () => "{nicht json",
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(loadPrefs("t1", broken)).toEqual({});
    expect(() => savePrefs("t1", { view: "vlans" }, broken)).not.toThrow();
    expect(
      loadPrefs("t1", {
        getItem: () => JSON.stringify({ view: 3, siteId: "s" }),
      }),
    ).toEqual({ siteId: "s" });
    expect(loadPrefs("t1", null)).toEqual({});
  });
});

describe("search shortcut", () => {
  const target = (tagName: string, isContentEditable = false) =>
    ({ tagName, isContentEditable }) as unknown as EventTarget;

  it("reacts to / outside of inputs only", () => {
    expect(isSearchShortcut({ key: "/", target: target("BODY") })).toBe(true);
    expect(isSearchShortcut({ key: "/", target: target("INPUT") })).toBe(false);
    expect(isSearchShortcut({ key: "/", target: target("SELECT") })).toBe(
      false,
    );
    expect(isSearchShortcut({ key: "/", target: target("DIV", true) })).toBe(
      false,
    );
    expect(isSearchShortcut({ key: "/", ctrlKey: true, target: null })).toBe(
      false,
    );
    expect(isSearchShortcut({ key: "a", target: null })).toBe(false);
  });
});

describe("breadcrumb", () => {
  it("lists the ancestors outermost first and stops on cycles", () => {
    const prefixes = [
      { id: "a", parentId: null },
      { id: "b", parentId: "a" },
      { id: "c", parentId: "b" },
    ];
    expect(prefixAncestors(prefixes, "c")).toEqual(["a", "b"]);
    expect(prefixAncestors(prefixes, "a")).toEqual([]);
    const cycle = prefixAncestors(
      [
        { id: "x", parentId: "y" },
        { id: "y", parentId: "x" },
      ],
      "x",
    );
    expect(cycle.length).toBeLessThanOrEqual(2);
  });
});
