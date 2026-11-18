import { describe, expect, it } from "vitest";
import serverCopy from "../../../../supabase/functions/_shared/ticket-template-form.ts?raw";
import webCopy from "./ticket-template-form.ts?raw";
import {
  applicableChecklistItems,
  appendAnswersToDescription,
  conditionHolds,
  formatAnswersForDescription,
  parseCondition,
  parseTemplateFormField,
  sanitizeAnswers,
  validateAnswers,
  validateFieldDefinitions,
  visibleFields,
  type TemplateFormField,
} from "./ticket-template-form";

function field(
  partial: Partial<TemplateFormField> &
    Pick<TemplateFormField, "key" | "label">,
): TemplateFormField {
  return {
    fieldType: "text",
    required: false,
    options: [],
    helpText: null,
    position: 0,
    condition: null,
    ...partial,
  };
}

// Beispiel «Neuer Laptop».
const laptopFields: TemplateFormField[] = [
  field({ key: "person", label: "Name der Person", required: true }),
  field({
    key: "eintritt",
    label: "Eintrittsdatum",
    fieldType: "date",
    required: true,
    position: 1,
  }),
  field({
    key: "modell",
    label: "Modell",
    fieldType: "select",
    options: ["Standard", "Entwickler"],
    required: true,
    position: 2,
  }),
  field({
    key: "docking",
    label: "Docking-Station nötig",
    fieldType: "checkbox",
    position: 3,
  }),
  field({
    key: "docking_typ",
    label: "Typ der Docking-Station",
    position: 4,
    required: true,
    condition: { fieldKey: "docking", equals: "true" },
  }),
  field({
    key: "ram",
    label: "Arbeitsspeicher (GB)",
    fieldType: "number",
    position: 5,
    condition: { fieldKey: "modell", equals: "Entwickler" },
  }),
];

describe("ticket template form", () => {
  it("keeps the web and the Edge Function copy identical", () => {
    expect(webCopy).toBe(serverCopy);
  });

  it("evaluates conditions as text", () => {
    expect(conditionHolds(null, {})).toBe(true);
    expect(conditionHolds({ fieldKey: "docking", equals: "true" }, {})).toBe(
      false,
    );
    expect(
      conditionHolds(
        { fieldKey: "docking", equals: "true" },
        { docking: true },
      ),
    ).toBe(true);
    expect(
      conditionHolds(
        { fieldKey: "modell", equals: "Entwickler" },
        { modell: " Entwickler " },
      ),
    ).toBe(true);
    expect(conditionHolds({ fieldKey: "n", equals: "2" }, { n: 2 })).toBe(true);
  });

  it("parses conditions strictly", () => {
    expect(parseCondition(null)).toBeNull();
    expect(parseCondition({ fieldKey: "a", equals: "x" })).toEqual({
      fieldKey: "a",
      equals: "x",
    });
    expect(parseCondition({ fieldKey: "A", equals: "x" })).toBeUndefined();
    expect(parseCondition({ fieldKey: "a", equals: "" })).toBeUndefined();
    expect(
      parseCondition({ fieldKey: "a", equals: "x", extra: 1 }),
    ).toBeUndefined();
  });

  it("shows conditional fields only when their condition holds", () => {
    expect(visibleFields(laptopFields, {}).map((item) => item.key)).toEqual([
      "person",
      "eintritt",
      "modell",
      "docking",
    ]);
    expect(
      visibleFields(laptopFields, {
        docking: true,
        modell: "Entwickler",
      }).map((item) => item.key),
    ).toEqual([
      "person",
      "eintritt",
      "modell",
      "docking",
      "docking_typ",
      "ram",
    ]);
  });

  it("hides fields whose parent is hidden", () => {
    const chained = [
      field({ key: "a", label: "A", fieldType: "checkbox" }),
      field({
        key: "b",
        label: "B",
        position: 1,
        condition: { fieldKey: "a", equals: "true" },
      }),
      field({
        key: "c",
        label: "C",
        position: 2,
        condition: { fieldKey: "b", equals: "ja" },
      }),
    ];
    // b answered with «ja» but hidden because a is not checked.
    expect(
      visibleFields(chained, { a: false, b: "ja" }).map((item) => item.key),
    ).toEqual(["a"]);
    expect(
      visibleFields(chained, { a: true, b: "ja" }).map((item) => item.key),
    ).toEqual(["a", "b", "c"]);
  });

  it("validates required fields and types with German messages", () => {
    expect(validateAnswers(laptopFields, {})).toEqual({
      person: "Bitte das Feld «Name der Person» ausfüllen.",
      eintritt: "Bitte das Feld «Eintrittsdatum» ausfüllen.",
      modell: "Bitte eine Option für «Modell» wählen.",
    });
    expect(
      validateAnswers(laptopFields, {
        person: "Erika Muster",
        eintritt: "2026-02-30",
        modell: "Gaming",
        docking: true,
        docking_typ: " ",
      }),
    ).toEqual({
      eintritt: "Bitte bei «Eintrittsdatum» ein gültiges Datum eingeben.",
      modell: "Bitte für «Modell» eine der angebotenen Optionen wählen.",
      docking_typ: "Bitte das Feld «Typ der Docking-Station» ausfüllen.",
    });
    expect(
      validateAnswers(laptopFields, {
        person: "Erika Muster",
        eintritt: "2026-03-01",
        modell: "Entwickler",
        ram: "viel",
      }),
    ).toEqual({
      ram: "Bitte bei «Arbeitsspeicher (GB)» eine Zahl eingeben.",
    });
    expect(
      validateAnswers(laptopFields, {
        person: "Erika Muster",
        eintritt: "2026-03-01",
        modell: "Standard",
        // Hidden: not validated.
        ram: "viel",
      }),
    ).toEqual({});
  });

  it("requires a required checkbox to be checked", () => {
    const fields = [
      field({
        key: "ok",
        label: "Richtlinie gelesen",
        fieldType: "checkbox",
        required: true,
      }),
    ];
    expect(validateAnswers(fields, {})).toEqual({
      ok: "Bitte «Richtlinie gelesen» bestätigen.",
    });
    expect(validateAnswers(fields, { ok: true })).toEqual({});
    expect(validateAnswers(fields, { ok: "true" })).toEqual({
      ok: "Die Angabe «Richtlinie gelesen» ist ungültig.",
    });
  });

  it("sanitizes answers to visible, typed values", () => {
    expect(
      sanitizeAnswers(laptopFields, {
        person: " Erika Muster ",
        eintritt: "2026-03-01",
        modell: "Standard",
        ram: "16",
        unknown: "x",
      }),
    ).toEqual({
      person: "Erika Muster",
      eintritt: "2026-03-01",
      modell: "Standard",
      docking: false,
    });
    expect(
      sanitizeAnswers(laptopFields, { modell: "Entwickler", ram: "32,5" }),
    ).toEqual({ modell: "Entwickler", docking: false, ram: 32.5 });
  });

  it("creates conditional checklist items only when the condition holds", () => {
    const items = [
      { description: "Laptop bestellen", condition: null },
      {
        description: "Docking-Station bestellen",
        condition: { fieldKey: "docking", equals: "true" },
      },
      {
        description: "Entwicklerlizenz bereitstellen",
        condition: { fieldKey: "modell", equals: "Entwickler" },
      },
    ];
    const without = sanitizeAnswers(laptopFields, { modell: "Standard" });
    expect(
      applicableChecklistItems(items, without).map((item) => item.description),
    ).toEqual(["Laptop bestellen"]);
    const withDocking = sanitizeAnswers(laptopFields, {
      modell: "Entwickler",
      docking: true,
    });
    expect(
      applicableChecklistItems(items, withDocking).map(
        (item) => item.description,
      ),
    ).toEqual([
      "Laptop bestellen",
      "Docking-Station bestellen",
      "Entwicklerlizenz bereitstellen",
    ]);
  });

  it("formats answers as a Markdown section", () => {
    expect(
      formatAnswersForDescription(laptopFields, {
        person: "Erika *Muster*",
        eintritt: "2026-03-01",
        modell: "Standard",
        docking: true,
        docking_typ: "USB-C",
      }),
    ).toBe(
      [
        "## Angaben aus dem Formular",
        "",
        "- **Name der Person:** Erika \\*Muster\\*",
        "- **Eintrittsdatum:** 01.03.2026",
        "- **Modell:** Standard",
        "- **Docking-Station nötig:** Ja",
        "- **Typ der Docking-Station:** USB-C",
      ].join("\n"),
    );
    expect(formatAnswersForDescription([], {})).toBe("");
    const multiline = [
      field({ key: "notiz", label: "Notiz", fieldType: "textarea" }),
    ];
    expect(
      appendAnswersToDescription("Bitte vorbereiten.\n", multiline, {
        notiz: "Zeile 1\nZeile 2",
      }),
    ).toBe(
      "Bitte vorbereiten.\n\n## Angaben aus dem Formular\n\n- **Notiz:**\n  Zeile 1\n  Zeile 2",
    );
  });

  it("validates field definitions", () => {
    expect(
      validateFieldDefinitions(laptopFields, [
        null,
        { fieldKey: "docking", equals: "true" },
      ]),
    ).toBeNull();
    expect(
      validateFieldDefinitions([
        field({ key: "a", label: "A" }),
        field({ key: "a", label: "B" }),
      ]),
    ).toBe("Der Schlüssel «a» ist mehrfach vergeben.");
    expect(
      validateFieldDefinitions([
        field({ key: "m", label: "Modell", fieldType: "select" }),
      ]),
    ).toBe(
      "Bitte für das Auswahlfeld «Modell» mindestens eine Option erfassen.",
    );
    expect(
      validateFieldDefinitions(laptopFields, [
        { fieldKey: "modell", equals: "Gaming" },
      ]),
    ).toBe(
      "Checklistenpunkt 1: Der Vergleichswert muss eine Option von «Modell» sein.",
    );
    expect(
      validateFieldDefinitions([
        field({
          key: "a",
          label: "A",
          condition: { fieldKey: "b", equals: "x" },
        }),
        field({
          key: "b",
          label: "B",
          condition: { fieldKey: "a", equals: "x" },
        }),
      ]),
    ).toBe("Die Bedingungen von «A» bilden einen Kreis.");
    expect(
      validateFieldDefinitions([field({ key: "1a", label: "A" })]),
    ).toContain("Der Schlüssel von Feld 1 ist ungültig.");
  });

  it("parses field definitions in camelCase and snake_case", () => {
    expect(
      parseTemplateFormField(
        {
          key: "modell",
          label: " Modell ",
          field_type: "select",
          required: true,
          options: [" Standard", "Entwickler "],
          help_text: "",
          position: 3,
          condition: null,
        },
        0,
      ),
    ).toEqual({
      key: "modell",
      label: "Modell",
      fieldType: "select",
      required: true,
      options: ["Standard", "Entwickler"],
      helpText: null,
      position: 3,
      condition: null,
    });
    expect(
      parseTemplateFormField({ key: "x", label: "X", fieldType: "file" }, 0),
    ).toBeNull();
  });
});
