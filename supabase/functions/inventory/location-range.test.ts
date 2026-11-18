import {
  MAX_RANGE_LOCATIONS,
  type RangeLocation,
  resolveLocationRange,
  splitPlaceName,
} from "./location-range.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`,
    );
  }
}

/** Every key of `expected` must equal the same key of `actual`. */
function assertObjectMatch(
  actual: unknown,
  expected: Record<string, unknown>,
): void {
  const record = actual as Record<string, unknown>;
  for (const [key, value] of Object.entries(expected)) {
    assertEquals(record[key], value);
  }
}

function places(...names: string[]): RangeLocation[] {
  return names.map((name, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    name,
    active: true,
  }));
}

function idOf(all: RangeLocation[], name: string): string {
  return all.find((place) => place.name === name)!.id;
}

Deno.test("splitPlaceName: only the last number is the running part", () => {
  assertEquals(splitPlaceName("G10.2.1"), {
    prefix: "G10.2.",
    digits: "1",
    number: 1,
  });
  assertEquals(splitPlaceName("G10.2.12")?.number, 12);
  assertEquals(splitPlaceName("Regal 7")?.prefix, "Regal ");
  assertEquals(splitPlaceName("A-03")?.digits, "03");
  assertEquals(splitPlaceName("Lager"), null);
  assertEquals(splitPlaceName("G10.2.A"), null);
});

Deno.test(
  "resolveLocationRange: G10.2.1 to G10.2.4 books four places in order",
  () => {
    const all = places("G10.2.3", "G10.2.1", "G10.2.4", "G10.2.2", "G10.2.5");
    const result = resolveLocationRange(
      all,
      idOf(all, "G10.2.1"),
      idOf(all, "G10.2.4"),
    );
    assertEquals(result.ok, true);
    if (result.ok) {
      assertEquals(result.locationIds, [
        idOf(all, "G10.2.1"),
        idOf(all, "G10.2.2"),
        idOf(all, "G10.2.3"),
        idOf(all, "G10.2.4"),
      ]);
      assertEquals(result.label, "G10.2.1–G10.2.4");
    }
  },
);

Deno.test(
  "resolveLocationRange: more than the last number may not differ",
  () => {
    const all = places("G10.2.1", "G10.2.4", "G11.2.1", "G11.2.4", "G10.3.1");
    for (const [from, to] of [
      ["G10.2.1", "G11.2.4"],
      ["G10.2.1", "G11.2.1"],
      ["G10.2.1", "G10.3.1"],
    ] as const) {
      const result = resolveLocationRange(all, idOf(all, from), idOf(all, to));
      assertObjectMatch(result, { ok: false, code: "range_different_prefix" });
    }
  },
);

Deno.test("resolveLocationRange: prefix comparison ignores case", () => {
  const all = places("g10.2.1", "G10.2.2");
  const result = resolveLocationRange(
    all,
    idOf(all, "g10.2.1"),
    idOf(all, "G10.2.2"),
  );
  assertEquals(result.ok, true);
});

Deno.test(
  "resolveLocationRange: every place must exist; nothing is resolved otherwise",
  () => {
    const all = places("G10.2.1", "G10.2.2", "G10.2.4");
    const result = resolveLocationRange(
      all,
      idOf(all, "G10.2.1"),
      idOf(all, "G10.2.4"),
    );
    assertObjectMatch(result, {
      ok: false,
      code: "range_place_missing",
      missing: ["G10.2.3"],
    });
  },
);

Deno.test("resolveLocationRange: inactive places count as missing", () => {
  const all = places("G10.2.1", "G10.2.2", "G10.2.3");
  all[1]!.active = false;
  const result = resolveLocationRange(
    all,
    idOf(all, "G10.2.1"),
    idOf(all, "G10.2.3"),
  );
  assertObjectMatch(result, {
    ok: false,
    code: "range_place_missing",
    missing: ["G10.2.2"],
  });
});

Deno.test(
  "resolveLocationRange: an inactive or unknown start or end is rejected",
  () => {
    const all = places("G10.2.1", "G10.2.2");
    all[1]!.active = false;
    assertObjectMatch(
      resolveLocationRange(all, idOf(all, "G10.2.1"), idOf(all, "G10.2.2")),
      { ok: false, code: "range_start_unknown" },
    );
    assertObjectMatch(
      resolveLocationRange(
        all,
        idOf(all, "G10.2.1"),
        "ffffffff-ffff-4fff-8fff-ffffffffffff",
      ),
      { ok: false, code: "range_start_unknown" },
    );
  },
);

Deno.test("resolveLocationRange: duplicate place names are ambiguous", () => {
  const all = places("G10.2.1", "G10.2.2", "G10.2.2", "G10.2.3");
  const result = resolveLocationRange(
    all,
    idOf(all, "G10.2.1"),
    idOf(all, "G10.2.3"),
  );
  assertObjectMatch(result, {
    ok: false,
    code: "range_place_ambiguous",
    missing: ["G10.2.2"],
  });
});

Deno.test(
  "resolveLocationRange: reversed, unnumbered and oversized ranges are rejected",
  () => {
    const all = places("G10.2.1", "G10.2.4", "Lager", "Keller");
    assertObjectMatch(
      resolveLocationRange(all, idOf(all, "G10.2.4"), idOf(all, "G10.2.1")),
      { ok: false, code: "range_reversed" },
    );
    assertObjectMatch(
      resolveLocationRange(all, idOf(all, "Lager"), idOf(all, "Keller")),
      { ok: false, code: "range_not_numbered" },
    );
    const many = places(
      ...Array.from(
        { length: MAX_RANGE_LOCATIONS + 1 },
        (_, i) => `R1.${i + 1}`,
      ),
    );
    assertObjectMatch(
      resolveLocationRange(
        many,
        idOf(many, "R1.1"),
        idOf(many, `R1.${MAX_RANGE_LOCATIONS + 1}`),
      ),
      { ok: false, code: "range_too_large" },
    );
  },
);

Deno.test("resolveLocationRange: leading zeros keep their width", () => {
  const all = places("A-01", "A-02", "A-03");
  const result = resolveLocationRange(
    all,
    idOf(all, "A-01"),
    idOf(all, "A-03"),
  );
  assertEquals(result.ok, true);
  if (result.ok) assertEquals(result.locationIds.length, 3);
});
