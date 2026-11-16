import { describe, expect, it } from "vitest";

import { monitoringData } from "../lib/monitoring-response";

describe("Antwort der Überwachung", () => {
  it("packt die Daten aus der Hülle { data } aus", () => {
    const overview = { totals: { down: 1 }, devices: [] };
    expect(monitoringData({ data: overview })).toBe(overview);
  });

  it("meldet eine unerwartete Antwort als Fehler statt abzustürzen", () => {
    expect(() => monitoringData(null)).toThrow(/unerwartete Antwort/);
    expect(() => monitoringData({ totals: {} })).toThrow(/unerwartete Antwort/);
  });
});
