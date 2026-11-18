import { afterEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();

vi.mock("../lib/mobile-secure-storage", () => ({
  mobileSecureStorage: {
    getItem: async (key: string) => store.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: async (key: string) => {
      store.delete(key);
    },
  },
}));

import {
  getFormality,
  isFormality,
  resolveFormalityPairs,
  restoreStoredFormality,
  setFormality,
  tn,
} from "../lib/formality";
import { nextDeskErrorMessage } from "../lib/nextdesk-error-messages";
import { progressStepHint, progressStepLabel } from "../lib/requester-progress";

afterEach(() => {
  setFormality("du");
});

describe("form of address", () => {
  it("starts with du and picks the wording", () => {
    expect(getFormality()).toBe("du");
    expect(tn("Öffne die Einstellungen.", "Öffnen Sie die Einstellungen.")).toBe(
      "Öffne die Einstellungen.",
    );
    setFormality("sie");
    expect(tn("Öffne die Einstellungen.", "Öffnen Sie die Einstellungen.")).toBe(
      "Öffnen Sie die Einstellungen.",
    );
  });

  it("recognises valid values only", () => {
    expect(isFormality("du")).toBe(true);
    expect(isFormality("sie")).toBe(true);
    expect(isFormality("Sie")).toBe(false);
    expect(isFormality(null)).toBe(false);
  });

  it("resolves server pairs for the current form", () => {
    const text = "⟦Dir fehlt die Berechtigung.␞Ihnen fehlt die Berechtigung.⟧";
    expect(resolveFormalityPairs(text)).toBe("Dir fehlt die Berechtigung.");
    expect(resolveFormalityPairs(text, "sie")).toBe(
      "Ihnen fehlt die Berechtigung.",
    );
    expect(resolveFormalityPairs("Ohne Marker")).toBe("Ohne Marker");
    setFormality("sie");
    expect(resolveFormalityPairs(text)).toBe("Ihnen fehlt die Berechtigung.");
  });

  it("remembers the last value for the next start", async () => {
    setFormality("sie");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(store.get("nextdesk:mobile:formality:v1")).toBe("sie");
    setFormality("du");
    await new Promise((resolve) => setTimeout(resolve, 0));
    store.set("nextdesk:mobile:formality:v1", "sie");
    await restoreStoredFormality();
    expect(getFormality()).toBe("sie");
  });
});

describe("texts in both forms", () => {
  it("writes error messages in du and Sie", () => {
    expect(nextDeskErrorMessage("ticket_update_denied")).toBe(
      "Du darfst dieses Ticket nicht bearbeiten.",
    );
    setFormality("sie");
    expect(nextDeskErrorMessage("ticket_update_denied")).toBe(
      "Sie dürfen dieses Ticket nicht bearbeiten.",
    );
  });

  it("writes progress labels in du and Sie", () => {
    expect(progressStepLabel("waiting_for_requester")).toBe("Wartet auf dich");
    expect(progressStepHint("received")).toContain("Dein Anliegen");
    setFormality("sie");
    expect(progressStepLabel("waiting_for_requester")).toBe("Wartet auf Sie");
    expect(progressStepHint("received")).toContain("Ihr Anliegen");
  });
});
