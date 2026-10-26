import { describe, expect, it } from "vitest";
import { normalizeQueueSelection, shouldShowQueueTabs } from "./queue-tabs";

describe("Queue-Register", () => {
  it("blendet die Leiste aus, wenn nur Alle Queues verfügbar ist", () => {
    expect(shouldShowQueueTabs([])).toBe(false);
  });

  it("zeigt die Leiste, sobald eine autorisierte Queue zusätzlich verfügbar ist", () => {
    expect(shouldShowQueueTabs([["ict", "ICT"]])).toBe(true);
  });

  it("behält nur Alle Queues oder eine noch autorisierte Auswahl bei", () => {
    const queueOptions = [["ict", "ICT"]] as const;

    expect(normalizeQueueSelection("alle", queueOptions)).toBe("alle");
    expect(normalizeQueueSelection("ict", queueOptions)).toBe("ict");
    expect(normalizeQueueSelection("infrastruktur", queueOptions)).toBe("alle");
  });
});
