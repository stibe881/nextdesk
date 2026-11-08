import { describe, expect, it } from "vitest";

import {
  softwareHint,
  softwareStatusLabel,
  softwareTone,
} from "../lib/shop-software";

describe("shop software status", () => {
  it("uses the three order states", () => {
    expect(softwareStatusLabel("pending")).toBe("Wird installiert");
    expect(softwareStatusLabel("installing")).toBe("Wird installiert");
    expect(softwareStatusLabel("assigned")).toBe("Zugewiesen");
    expect(softwareStatusLabel("failed")).toBe("Fehler");
    expect(softwareStatusLabel("unknown")).toBe("Wird installiert");
  });

  it("maps the tones", () => {
    expect(softwareTone("assigned")).toBe("success");
    expect(softwareTone("failed")).toBe("danger");
    expect(softwareTone("installing")).toBe("info");
  });

  it("explains the state", () => {
    const base = {
      deploymentId: "d",
      label: "",
      appName: "Visio",
      assignedAt: null,
      canRetry: false,
    };
    expect(
      softwareHint({ ...base, status: "failed", errorMessage: "Kein Konto" }),
    ).toBe("Kein Konto");
    expect(
      softwareHint({ ...base, status: "pending", errorMessage: null }),
    ).toContain("deinem Konto");
  });
});
