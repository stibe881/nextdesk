import { describe, expect, it } from "vitest";
import { pastedImageFiles } from "./clipboard-images";

function clipboard(
  files: File[],
  extra: { kind: string; type: string }[] = [],
) {
  return {
    items: [
      ...files.map((file) => ({
        kind: "file",
        type: file.type,
        getAsFile: () => file,
      })),
      ...extra.map((item) => ({ ...item, getAsFile: () => null })),
    ],
  } as unknown as Pick<DataTransfer, "items">;
}

describe("Bilder aus der Zwischenablage", () => {
  const now = new Date("2026-11-25T09:15:30Z");

  it("benennt einen Screenshot mit Datum und Uhrzeit", () => {
    const [file] = pastedImageFiles(
      clipboard([new File(["x"], "image.png", { type: "image/png" })]),
      now,
    );
    expect(file?.name).toBe("Bild 2026-11-25 10-15-30.png");
    expect(file?.type).toBe("image/png");
  });

  it("behält echte Dateinamen und ignoriert Text", () => {
    const files = pastedImageFiles(
      clipboard(
        [new File(["x"], "Fehler.jpg", { type: "image/jpeg" })],
        [{ kind: "string", type: "text/plain" }],
      ),
      now,
    );
    expect(files.map((file) => file.name)).toEqual(["Fehler.jpg"]);
  });

  it("liefert nichts ohne Bild", () => {
    expect(
      pastedImageFiles(clipboard([], [{ kind: "string", type: "text/plain" }])),
    ).toEqual([]);
  });
});
