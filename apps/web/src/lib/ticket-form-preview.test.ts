import { describe, expect, it } from "vitest";
import {
  STANDARD_TICKET_FORM_PREVIEW_SECTIONS,
  standardTicketFormPreviewLabels,
} from "./ticket-form-preview";

describe("ticket form preview", () => {
  it("shows the complete standard ticket form before any configured custom fields", () => {
    expect(
      STANDARD_TICKET_FORM_PREVIEW_SECTIONS.map((section) => section.label),
    ).toEqual(["Ticket erfassen", "Ticket einordnen", "Anliegen"]);

    expect(standardTicketFormPreviewLabels()).toEqual([
      "Anfragende Person",
      "Betreff",
      "Abteilung / Angebot",
      "Ticketvorlage",
      "Zugewiesener Agent",
      "Kategorie",
      "Unterkategorie",
      "Priorität",
      "Beschreibung",
    ]);
  });

  it("marks the existing mandatory fields without making optional routing fields mandatory", () => {
    const fields = STANDARD_TICKET_FORM_PREVIEW_SECTIONS.flatMap(
      (section) => section.fields,
    );

    expect(
      fields.filter((field) => field.required).map((field) => field.label),
    ).toEqual([
      "Anfragende Person",
      "Betreff",
      "Abteilung / Angebot",
      "Priorität",
      "Beschreibung",
    ]);
    expect(fields.find((field) => field.label === "Kategorie")?.optional).toBe(
      true,
    );
    expect(
      fields.filter((field) => field.contextual).map((field) => field.label),
    ).toEqual([
      "Abteilung / Angebot",
      "Zugewiesener Agent",
      "Kategorie",
      "Unterkategorie",
    ]);
  });
});
