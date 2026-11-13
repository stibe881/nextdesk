import { assertEquals } from "jsr:@std/assert@1";
import {
  appendAnswersToDescription,
  applicableChecklistItems,
  sanitizeAnswers,
  validateAnswers,
  type TemplateFormField,
} from "./ticket-template-form.ts";

const fields: TemplateFormField[] = [
  {
    key: "person",
    label: "Name der Person",
    fieldType: "text",
    required: true,
    options: [],
    helpText: null,
    position: 0,
    condition: null,
  },
  {
    key: "docking",
    label: "Docking-Station nötig",
    fieldType: "checkbox",
    required: false,
    options: [],
    helpText: null,
    position: 1,
    condition: null,
  },
];

Deno.test("conditional checklist items follow the sanitized answers", () => {
  const items = [
    { description: "Laptop bestellen", condition: null },
    {
      description: "Docking-Station bestellen",
      condition: { fieldKey: "docking", equals: "true" },
    },
  ];
  assertEquals(
    applicableChecklistItems(
      items,
      sanitizeAnswers(fields, { person: "Erika" }),
    ).map((item) => item.description),
    ["Laptop bestellen"],
  );
  assertEquals(
    applicableChecklistItems(
      items,
      sanitizeAnswers(fields, { person: "Erika", docking: true }),
    ).length,
    2,
  );
});

Deno.test("answers are validated and appended to the description", () => {
  assertEquals(validateAnswers(fields, {}), {
    person: "Bitte das Feld «Name der Person» ausfüllen.",
  });
  assertEquals(
    appendAnswersToDescription(
      "Bitte vorbereiten.",
      fields,
      sanitizeAnswers(fields, { person: "Erika" }),
    ),
    "Bitte vorbereiten.\n\n## Angaben aus dem Formular\n\n- **Name der Person:** Erika\n- **Docking-Station nötig:** Nein",
  );
});
