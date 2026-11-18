import { availability, median, minutesBetween, parseAction } from "./index.ts";

const tenantId = "d119bcc1-89e6-4c73-b1c1-c14ea71a88c3";
const incidentId = "fbc3ecd4-a48c-4990-8011-b296a4e6f107";

Deno.test("Störungen: Aktionen werden streng geprüft", () => {
  if (parseAction({ type: "list", tenantId })?.type !== "list") throw new Error("list");
  if (parseAction({ type: "list", tenantId, filter: "x" }) !== null) throw new Error("filter");
  if (parseAction({ type: "close", tenantId, incidentId, cause: "hardware" })?.type !== "close") {
    throw new Error("close");
  }
  if (parseAction({ type: "close", tenantId, incidentId, cause: "aliens" }) !== null) {
    throw new Error("cause");
  }
  if (parseAction({ type: "note", tenantId, incidentId, text: "  " }) !== null) throw new Error("note");
  if (parseAction({ type: "assign", tenantId, incidentId, agentId: null })?.type !== "assign") {
    throw new Error("assign");
  }
});

Deno.test("Störungen: Dauer, Median und Verfügbarkeit", () => {
  const now = Date.parse("2026-11-10T12:00:00Z");
  if (minutesBetween("2026-11-10T11:00:00Z", null, now) !== 60) throw new Error("duration");
  if (median([10, 30, 20]) !== 20 || median([]) !== null) throw new Error("median");
  const start = now - 10 * 60 * 60_000; // 10 hours
  const value = availability(
    [
      { severity: "down", opened_at: "2026-11-10T11:00:00Z", resolved_at: null },
      { severity: "warning", opened_at: "2026-11-10T03:00:00Z", resolved_at: "2026-11-10T05:00:00Z" },
    ],
    2,
    start,
    now,
  );
  // 60 down minutes over 2 devices × 600 minutes.
  if (value === null || Math.abs(value - (1 - 60 / 1200)) > 1e-9) throw new Error(`availability ${value}`);
  if (availability([], 0, start, now) !== null) throw new Error("no devices");
});
