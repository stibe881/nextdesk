import { describe, expect, it } from "vitest";
import { shouldShowTeamQueuesPanel } from "./team-queues-visibility";

describe("Team-Warteschlangen im Arbeitsplatz", () => {
  it("blendet den Bereich aus, wenn der Mandant keine Warteschlangen anbietet", () => {
    expect(shouldShowTeamQueuesPanel("unavailable")).toBe(false);
  });

  it("zeigt eine Rückmeldung nur während des Ladens oder bei verfügbaren Daten", () => {
    expect(shouldShowTeamQueuesPanel("loading")).toBe(true);
    expect(shouldShowTeamQueuesPanel("ready")).toBe(true);
  });
});
