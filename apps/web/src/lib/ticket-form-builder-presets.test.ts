import { describe, expect, it } from "vitest";
import {
  TICKET_FIELD_PRESETS,
  createTicketFieldPresetDraft,
  createUniqueTicketFieldKey,
  ticketFieldPresetsByCategory,
} from "./ticket-form-builder-presets";

describe("ticket form builder presets", () => {
  it("offers only supported ticket custom field types", () => {
    expect(TICKET_FIELD_PRESETS.map((preset) => preset.fieldType)).toEqual([
      "text",
      "select",
      "date",
      "number",
      "checkbox",
      "text",
      "text",
      "date",
      "number",
      "checkbox",
    ]);
    expect(
      ticketFieldPresetsByCategory("Ticketvorlagen").map((preset) => preset.id),
    ).toEqual([
      "asset-reference",
      "location",
      "desired-date",
      "affected-people",
      "callback-requested",
    ]);
  });

  it("uses practical default values and valid select options", () => {
    const selection = TICKET_FIELD_PRESETS.find(
      (preset) => preset.id === "selection",
    );
    const requestedDate = TICKET_FIELD_PRESETS.find(
      (preset) => preset.id === "desired-date",
    );

    expect(selection).toMatchObject({
      fieldType: "select",
      options: ["Option 1", "Option 2"],
    });
    expect(requestedDate).toMatchObject({
      label: "Gewünschter Termin",
      fieldType: "date",
    });
  });

  it("creates a valid collision-free technical field key for each inserted preset", () => {
    expect(
      createUniqueTicketFieldKey("Geräte-/Inventarnummer", [
        "geraete_inventarnummer",
        "geraete_inventarnummer_2",
      ]),
    ).toBe("geraete_inventarnummer_3");

    const preset = TICKET_FIELD_PRESETS.find(
      (candidate) => candidate.id === "callback-requested",
    );
    expect(preset).toBeDefined();
    expect(
      createTicketFieldPresetDraft(preset!, ["rueckruf_erwuenscht"]),
    ).toEqual({
      fieldKey: "rueckruf_erwuenscht_2",
      fieldType: "checkbox",
      label: "Rückruf erwünscht",
      options: "",
      required: false,
    });
  });
});
