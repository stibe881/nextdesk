import { describe, expect, it } from "vitest";

import { SENSOR_TONE_LABELS, sensorTone } from "./incidents";

describe("sensorTone", () => {
  it("unterscheidet Fehler, Warnung und OK wie PRTG", () => {
    expect(sensorTone({ state: "open", status: "Fehler" })).toBe("down");
    expect(sensorTone({ state: "open", status: "Warnung" })).toBe("warning");
    expect(sensorTone({ state: "open", status: "Down" })).toBe("down");
    expect(sensorTone({ state: "open", status: "Warning" })).toBe("warning");
    expect(sensorTone({ state: "resolved", status: "Fehler" })).toBe("ok");
  });

  it("nimmt bei Übergängen den Zustand in Klammern", () => {
    expect(
      sensorTone({ state: "open", status: "Warnung beendet (jetzt: Fehler)" }),
    ).toBe("down");
    expect(
      sensorTone({ state: "open", status: "Fehler beendet (jetzt: Warnung)" }),
    ).toBe("warning");
    expect(
      sensorTone({ state: "open", status: "Warnung (vorher: Fehler)" }),
    ).toBe("warning");
    expect(SENSOR_TONE_LABELS.warning).toBe("Warnung");
  });
});
