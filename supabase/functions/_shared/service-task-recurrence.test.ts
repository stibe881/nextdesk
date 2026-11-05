import { assertEquals } from "jsr:@std/assert@1";
import {
  describeRule,
  easterSunday,
  formatDate,
  holidayName,
  nextOccurrences,
  normalizeRule,
  occurrencesBetween,
  parseDate,
  type RecurrenceRule,
} from "./service-task-recurrence.ts";

function rule(value: Record<string, unknown>): RecurrenceRule {
  const parsed = normalizeRule({ interval: 1, skipNonWorkdays: true, ...value });
  if (!parsed) throw new Error(`invalid rule ${JSON.stringify(value)}`);
  return parsed;
}

Deno.test("Easter and the holidays of the canton of Zug", () => {
  assertEquals(formatDate(easterSunday(2026)), "2026-04-05");
  assertEquals(formatDate(easterSunday(2027)), "2027-03-28");
  assertEquals(holidayName(parseDate("2026-04-03")!), "Karfreitag");
  assertEquals(holidayName(parseDate("2026-05-14")!), "Auffahrt");
  assertEquals(holidayName(parseDate("2026-06-04")!), "Fronleichnam");
  assertEquals(holidayName(parseDate("2026-12-08")!), "Mariä Empfängnis");
  assertEquals(holidayName(parseDate("2026-11-05")!), null);
});

Deno.test("monthly on the first working day skips New Year and Berchtoldstag", () => {
  assertEquals(
    nextOccurrences(
      rule({ frequency: "monthly", monthlyMode: "first_workday" }),
      "2026-12-01",
      "2026-12-01",
      4,
    ),
    ["2026-12-01", "2027-01-04", "2027-02-01", "2027-03-01"],
  );
});

Deno.test("monthly on the 2nd Tuesday (patch day)", () => {
  assertEquals(
    nextOccurrences(
      rule({ frequency: "monthly", monthlyMode: "nth_weekday", nth: 2, weekday: 2 }),
      "2026-11-01",
      "2026-11-01",
      3,
    ),
    ["2026-11-10", "2026-12-08", "2027-01-12"],
  );
});

Deno.test("monthly last working day and day clamped to month end", () => {
  assertEquals(
    occurrencesBetween(
      rule({ frequency: "monthly", monthlyMode: "last_workday" }),
      "2026-10-01",
      "2026-10-01",
      "2026-11-30",
    ),
    ["2026-10-30", "2026-11-30"],
  );
  assertEquals(
    occurrencesBetween(
      rule({ frequency: "monthly", dayOfMonth: 31, skipNonWorkdays: false }),
      "2027-01-01",
      "2027-01-01",
      "2027-03-31",
    ),
    ["2027-01-31", "2027-02-28", "2027-03-31"],
  );
});

Deno.test("weekly on Monday and Thursday", () => {
  assertEquals(
    occurrencesBetween(
      rule({ frequency: "weekly", weekdays: [4, 1] }),
      "2026-11-02",
      "2026-11-01",
      "2026-11-13",
    ),
    ["2026-11-02", "2026-11-05", "2026-11-09", "2026-11-12"],
  );
});

Deno.test("daily on working days drops holidays and weekends", () => {
  assertEquals(
    occurrencesBetween(
      rule({ frequency: "daily" }),
      "2026-12-23",
      "2026-12-23",
      "2026-12-28",
    ),
    ["2026-12-23", "2026-12-24", "2026-12-28"],
  );
});

Deno.test("every 42 days, moved to the next working day", () => {
  assertEquals(
    nextOccurrences(
      rule({ frequency: "interval", interval: 42 }),
      "2026-11-06",
      "2026-11-06",
      3,
    ),
    ["2026-11-06", "2026-12-18", "2027-01-29"],
  );
});

Deno.test("yearly on 30 November and invalid rules", () => {
  assertEquals(
    nextOccurrences(
      rule({ frequency: "yearly", month: 11, dayOfMonth: 30 }),
      "2026-01-01",
      "2026-11-05",
      2,
    ),
    ["2026-11-30", "2027-11-30"],
  );
  assertEquals(normalizeRule({ frequency: "weekly", skipNonWorkdays: true }), null);
  assertEquals(normalizeRule({ frequency: "hourly", skipNonWorkdays: true }), null);
});

Deno.test("German descriptions", () => {
  assertEquals(
    describeRule(rule({ frequency: "monthly", monthlyMode: "first_workday" })),
    "Monatlich am 1. Werktag",
  );
  assertEquals(
    describeRule(
      rule({ frequency: "monthly", monthlyMode: "nth_weekday", nth: 2, weekday: 2 }),
    ),
    "Monatlich am 2. Dienstag",
  );
  assertEquals(
    describeRule(rule({ frequency: "weekly", weekdays: [1, 4] })),
    "Wöchentlich am Mo, Do",
  );
});
