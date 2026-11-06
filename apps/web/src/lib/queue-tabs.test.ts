import { describe, expect, it } from "vitest";
import { normalizeQueueSelection, shouldShowQueueTabs } from "./queue-tabs";

describe("Queue-Register", () => {
  it("blendet die Leiste aus, wenn nur Alle Queues verfügbar ist", () => {
    expect(shouldShowQueueTabs([])).toBe(false);
  });

  it("blendet die Leiste bei nur einer Abteilung aus", () => {
    expect(shouldShowQueueTabs([["ict", "ICT"]])).toBe(false);
  });

  it("zeigt die Leiste ab zwei Abteilungen", () => {
    expect(
      shouldShowQueueTabs([
        ["ict", "ICT"],
        ["infrastruktur", "Infrastruktur"],
      ]),
    ).toBe(true);
  });

  it("behält nur Alle Queues oder eine noch autorisierte Auswahl bei", () => {
    const queueOptions = [["ict", "ICT"]] as const;

    expect(normalizeQueueSelection("alle", queueOptions)).toBe("alle");
    expect(normalizeQueueSelection("ict", queueOptions)).toBe("ict");
    expect(normalizeQueueSelection("infrastruktur", queueOptions)).toBe("alle");
  });
});
