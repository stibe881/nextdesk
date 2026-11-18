import { describe, expect, it } from "vitest";

import {
  dialogConfirmLabel,
  dialogTone,
  splitDialogMessage,
} from "./dialog-text";

describe("dialog text", () => {
  it("labels destructive questions", () => {
    expect(dialogConfirmLabel("Kategorie «A» löschen?")).toBe("Löschen");
    expect(dialogConfirmLabel("Bestellung wirklich stornieren?")).toBe("Stornieren");
    expect(dialogTone("Rack «A» löschen?")).toBe("danger");
  });

  it("falls back to a neutral confirm", () => {
    expect(dialogConfirmLabel("Dieses Ticket zusammenführen?")).toBe("Bestätigen");
    expect(dialogTone("Dieses Ticket zusammenführen?")).toBe("default");
  });

  it("splits title and body", () => {
    expect(splitDialogMessage("Frage?\n\nErklärung\nzweite Zeile")).toEqual({
      title: "Frage?",
      body: "Erklärung\nzweite Zeile",
    });
    expect(splitDialogMessage("Nur Titel")).toEqual({ title: "Nur Titel", body: "" });
  });
});
