import { describe, expect, it } from "vitest";
import {
  deliveryWindowFromPreferences,
  preferencesWithDeliveryWindow,
  type PushPreferences,
} from "./push-notifications";

const base: PushPreferences = {
  enabledCategories: [],
  quietHoursEnabled: false,
  quietStart: 22,
  quietEnd: 7,
  timezone: "Europe/Zurich",
};

describe("persönliche Benachrichtigungszeit", () => {
  it("ohne Ruhezeit gilt «Jederzeit»", () => {
    expect(deliveryWindowFromPreferences(base)).toEqual({ mode: "always" });
  });

  it("speichert 06–17 als Ruhezeit 17–06 und liest sie zurück", () => {
    const saved = preferencesWithDeliveryWindow(base, {
      mode: "window",
      startHour: 6,
      endHour: 17,
    });
    expect(saved).toMatchObject({
      quietHoursEnabled: true,
      quietStart: 17,
      quietEnd: 6,
    });
    expect(deliveryWindowFromPreferences(saved)).toEqual({
      mode: "window",
      startHour: 6,
      endHour: 17,
    });
  });

  it("ein Fenster bis Mitternacht wird als 24:00 angezeigt", () => {
    const saved = preferencesWithDeliveryWindow(base, {
      mode: "window",
      startHour: 7,
      endHour: 24,
    });
    expect(saved).toMatchObject({ quietStart: 0, quietEnd: 7 });
    expect(deliveryWindowFromPreferences(saved)).toEqual({
      mode: "window",
      startHour: 7,
      endHour: 24,
    });
  });

  it("ein Fenster über Mitternacht bleibt erhalten", () => {
    const saved = preferencesWithDeliveryWindow(base, {
      mode: "window",
      startHour: 22,
      endHour: 6,
    });
    expect(saved).toMatchObject({ quietStart: 6, quietEnd: 22 });
    expect(deliveryWindowFromPreferences(saved)).toEqual({
      mode: "window",
      startHour: 22,
      endHour: 6,
    });
  });

  it("«Jederzeit» schaltet die Ruhezeit aus", () => {
    const saved = preferencesWithDeliveryWindow(
      { ...base, quietHoursEnabled: true },
      { mode: "always" },
    );
    expect(saved.quietHoursEnabled).toBe(false);
  });
});
