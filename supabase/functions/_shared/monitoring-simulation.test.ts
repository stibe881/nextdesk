import { assertEquals } from "jsr:@std/assert@1";
import { SIMULATION_MESSAGE, simulateResults } from "./monitoring-simulation.ts";

const result = (id: string, at: string) => ({ id, at, ok: true, value: 3, value2: null, message: null });

Deno.test("simulated sensors fail, others stay as measured", () => {
  const out = simulateResults(
    [result("a", "2026-11-16T10:00:10.000Z"), result("b", "2026-11-16T10:00:10.000Z")],
    new Map([["a", { failuresToDown: 3, down: false }]]),
  );
  // Two extra failures before the real one reach the threshold of three.
  assertEquals(out.map((entry) => [entry.id, entry.ok, entry.at]), [
    ["a", false, "2026-11-16T10:00:08.000Z"],
    ["a", false, "2026-11-16T10:00:09.000Z"],
    ["a", false, "2026-11-16T10:00:10.000Z"],
    ["b", true, "2026-11-16T10:00:10.000Z"],
  ]);
  assertEquals(out[0]!.message, SIMULATION_MESSAGE);
  assertEquals(out[0]!.value, null);
});

Deno.test("a sensor that is already down is not boosted again", () => {
  const out = simulateResults(
    [result("a", "2026-11-16T10:00:10.000Z"), result("a", "2026-11-16T10:01:10.000Z")],
    new Map([["a", { failuresToDown: 5, down: true }]]),
  );
  assertEquals(out.length, 2);
  assertEquals(out.every((entry) => !entry.ok), true);
});

Deno.test("several results of one sensor are boosted once", () => {
  const out = simulateResults(
    [result("a", "2026-11-16T10:00:10.000Z"), result("a", "2026-11-16T10:01:10.000Z")],
    new Map([["a", { failuresToDown: 2, down: false }]]),
  );
  assertEquals(out.length, 3);
});
