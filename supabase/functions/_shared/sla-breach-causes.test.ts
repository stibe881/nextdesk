import { assertEquals } from "jsr:@std/assert@1";
import {
  detectBreaches,
  isPraise,
  isSlaBreachReasonCode,
  monthQueryRange,
  praiseExcerpt,
  summarizeCauses,
  zurichMonth,
} from "./sla-breach-causes.ts";

const NOW = Date.parse("2026-11-07T12:00:00Z");
const base = {
  responseDueAt: null,
  firstRespondedAt: null,
  resolutionDueAt: null,
  resolvedAt: null,
  closedAt: null,
};

Deno.test("detects late and still open SLA targets", () => {
  assertEquals(
    detectBreaches(
      {
        ...base,
        responseDueAt: "2026-11-07T08:00:00Z",
        firstRespondedAt: "2026-11-07T09:00:00Z",
        resolutionDueAt: "2026-11-07T11:00:00Z",
      },
      [],
      NOW,
    ).map((breach) => breach.kind),
    ["response", "resolution"],
  );
  // Answered in time and not due yet: nothing.
  assertEquals(
    detectBreaches(
      {
        ...base,
        responseDueAt: "2026-11-07T08:00:00Z",
        firstRespondedAt: "2026-11-07T07:00:00Z",
        resolutionDueAt: "2026-11-08T08:00:00Z",
      },
      [],
      NOW,
    ),
    [],
  );
  // Resolved in time.
  assertEquals(
    detectBreaches(
      {
        ...base,
        resolutionDueAt: "2026-11-07T08:00:00Z",
        resolvedAt: "2026-11-07T07:59:00Z",
      },
      [],
      NOW,
    ),
    [],
  );
});

Deno.test("recorded breach events always count", () => {
  assertEquals(
    detectBreaches(
      {
        ...base,
        resolutionDueAt: "2026-11-07T08:00:00Z",
        resolvedAt: "2026-11-07T07:00:00Z",
      },
      ["resolution_breached"],
      NOW,
    ).map((breach) => breach.kind),
    ["resolution"],
  );
  // No target at all: no breach even with an event.
  assertEquals(detectBreaches(base, ["response_breached"], NOW), []);
});

Deno.test("a paused SLA is measured at the pause start", () => {
  // Due while paused (after the pause began): not breached.
  assertEquals(
    detectBreaches(
      {
        ...base,
        responseDueAt: "2026-11-07T10:00:00Z",
        resolutionDueAt: "2026-11-07T11:00:00Z",
        slaPausedAt: "2026-11-07T09:00:00Z",
      },
      [],
      NOW,
    ),
    [],
  );
  // Already due before the pause began: still breached.
  assertEquals(
    detectBreaches(
      {
        ...base,
        resolutionDueAt: "2026-11-07T08:00:00Z",
        slaPausedAt: "2026-11-07T09:00:00Z",
      },
      [],
      NOW,
    ).map((breach) => breach.kind),
    ["resolution"],
  );
});

Deno.test("praise is a 5 or a 4 with a comment", () => {
  assertEquals(isPraise(5, null), true);
  assertEquals(isPraise(4, "  "), false);
  assertEquals(isPraise(4, "Danke!"), true);
  assertEquals(isPraise(3, "Super"), false);
  assertEquals(isPraise(null, "Super"), false);
});

Deno.test("summarizes causes with share without reason", () => {
  const summary = summarizeCauses([
    { departmentId: "d", teamId: null, kind: "response", reasonCode: "capacity" },
    { departmentId: "d", teamId: null, kind: "resolution", reasonCode: "capacity" },
    { departmentId: "d", teamId: null, kind: "resolution", reasonCode: "third_party" },
    { departmentId: "d", teamId: null, kind: "resolution", reasonCode: null },
  ]);
  assertEquals(summary.total, 4);
  assertEquals(summary.withoutReason, 1);
  assertEquals(summary.withoutReasonPercent, 25);
  assertEquals(summary.causes.map((cause) => [cause.code, cause.count, cause.percent]), [
    ["capacity", 2, 67],
    ["third_party", 1, 33],
  ]);
  assertEquals(summarizeCauses([]).withoutReasonPercent, null);
});

Deno.test("month helpers and validation", () => {
  // 23:30 UTC on Oct 31 is already November in Zurich.
  assertEquals(zurichMonth("2026-10-31T23:30:00Z"), "2026-11");
  assertEquals(zurichMonth("nope"), null);
  const range = monthQueryRange("2026-12");
  assertEquals(range.from < "2026-12-01T00:00:00.000Z", true);
  assertEquals(range.to > "2027-01-01T00:00:00.000Z", true);
  assertEquals(isSlaBreachReasonCode("capacity"), true);
  assertEquals(isSlaBreachReasonCode("bored"), false);
  assertEquals(praiseExcerpt("  Vielen   Dank  "), "Vielen Dank");
  assertEquals(praiseExcerpt("eins zwei drei vier", 12), "eins zwei…");
  assertEquals(praiseExcerpt(""), null);
});
