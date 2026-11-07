import { describe, expect, it } from "vitest";

import {
  intuneActionEventLabel,
  intuneActionLabel,
  intuneConfirmationText,
  intuneErrorMessage,
  needsConfirmation,
  parseIntuneDeviceList,
} from "./intune-actions";

describe("Intune-Aktionen", () => {
  it("parses the device list and drops unknown actions", () => {
    const list = parseIntuneDeviceList({
      connectionReady: true,
      devices: [
        {
          assetId: "a1",
          name: "NB-0042",
          assetTag: null,
          operatingSystem: "Windows",
          actions: ["syncDevice", "wipe", "windowsDefenderScan"],
          confirmationRequired: [],
        },
        { name: "ohne ID" },
      ],
    });
    expect(list?.connectionReady).toBe(true);
    expect(list?.devices).toHaveLength(1);
    expect(list?.devices[0]?.actions).toEqual([
      "syncDevice",
      "windowsDefenderScan",
    ]);
    expect(parseIntuneDeviceList(null)).toBeNull();
  });

  it("always asks before restart, lock, passcode reset and LAPS", () => {
    const device = {
      assetId: "a1",
      name: "iPhone",
      assetTag: null,
      operatingSystem: "iOS",
      actions: [],
      confirmationRequired: [],
    };
    expect(needsConfirmation(device, "rebootNow")).toBe(true);
    expect(needsConfirmation(device, "remoteLock")).toBe(true);
    expect(needsConfirmation(device, "resetPasscode")).toBe(true);
    expect(needsConfirmation(device, "rotateLocalAdminPassword")).toBe(true);
    expect(needsConfirmation(device, "syncDevice")).toBe(false);
    expect(intuneConfirmationText("rebootNow", "NB-0042")).toContain(
      "«NB-0042»",
    );
  });

  it("labels the ticket history entry", () => {
    expect(
      intuneActionEventLabel({
        action: "rebootNow",
        assetName: "NB-0042",
        status: "succeeded",
      }),
    ).toBe("Intune: Neu starten für «NB-0042» ausgelöst");
    expect(
      intuneActionEventLabel({ action: "syncDevice", status: "failed" }),
    ).toBe("Intune: Synchronisieren fehlgeschlagen");
    expect(intuneActionLabel("windowsDefenderScan")).toBe(
      "Defender-Schnellscan",
    );
  });

  it("shows the server message, e.g. the missing Entra permission", () => {
    expect(
      intuneErrorMessage({
        error: {
          code: "intune_permission_missing",
          message:
            "In Entra fehlt die Berechtigung DeviceManagementManagedDevices.PrivilegedOperations.All.",
        },
      }),
    ).toContain("PrivilegedOperations.All");
    expect(intuneErrorMessage(null)).toBe(
      "Die Intune-Aktion konnte nicht ausgeführt werden.",
    );
  });
});
