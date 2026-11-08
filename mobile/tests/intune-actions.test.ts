import { describe, expect, it } from "vitest";

import {
  mobileIntuneConfirmationText,
  mobileIntuneNeedsConfirmation,
  parseMobileIntuneDevice,
} from "../lib/intune-actions-model";

describe("Intune-Aktionen (mobil)", () => {
  it("liest die Aktionen des Geräts und ignoriert unbekannte", () => {
    const device = parseMobileIntuneDevice(
      {
        data: {
          connectionReady: true,
          devices: [
            {
              assetId: "a1",
              name: "iPhone Anna",
              actions: ["syncDevice", "remoteLock", "wipe"],
            },
          ],
        },
      },
      "a1",
    );
    expect(device).toEqual({
      assetId: "a1",
      name: "iPhone Anna",
      actions: ["syncDevice", "remoteLock"],
      connectionReady: true,
    });
    expect(parseMobileIntuneDevice({ data: { devices: [] } }, "a1")).toBeNull();
  });

  it("verlangt eine Bestätigung für Neustart, Sperren und Code", () => {
    expect(mobileIntuneNeedsConfirmation("rebootNow")).toBe(true);
    expect(mobileIntuneNeedsConfirmation("remoteLock")).toBe(true);
    expect(mobileIntuneNeedsConfirmation("resetPasscode")).toBe(true);
    expect(mobileIntuneNeedsConfirmation("syncDevice")).toBe(false);
    expect(mobileIntuneConfirmationText("remoteLock", "iPhone")).toContain(
      "«iPhone»",
    );
  });
});
