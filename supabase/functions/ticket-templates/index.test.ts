import { assertEquals } from "jsr:@std/assert@1";
import {
  normalizeTemplate,
  parseAction,
  parseFormFields,
  templateFormError,
} from "./index.ts";

const TENANT = "0b6a1c1e-4f7a-4d2b-9c1e-2a3b4c5d6e7f";

const laptop = {
  type: "createTemplate",
  tenantId: TENANT,
  name: "Neuer Laptop",
  subjectTemplate: "Neuer Laptop für {{anfragende_person}}",
  descriptionTemplate: "Bitte bereiten Sie den Laptop vor.",
  formFields: [
    {
      key: "person",
      label: "Name der Person",
      fieldType: "text",
      required: true,
    },
    {
      key: "modell",
      label: "Modell",
      fieldType: "select",
      required: true,
      options: ["Standard", "Entwickler"],
    },
    { key: "docking", label: "Docking-Station nötig", fieldType: "checkbox" },
  ],
  checklistItems: [
    { description: "Laptop bestellen" },
    {
      description: "Docking-Station bestellen",
      condition: { fieldKey: "docking", equals: "true" },
    },
  ],
};

Deno.test("templates accept form fields and checklist conditions", () => {
  const action = parseAction(laptop);
  if (!action || action.type !== "createTemplate")
    throw new Error("Vorlage mit Formularfeldern wurde abgelehnt.");
  assertEquals(
    action.formFields?.map((field) => [field.key, field.position]),
    [
      ["person", 0],
      ["modell", 1],
      ["docking", 2],
    ],
  );
  assertEquals(action.checklistItems?.[1]?.condition, {
    fieldKey: "docking",
    equals: "true",
  });
  assertEquals(
    templateFormError(action.formFields ?? [], action.checklistItems ?? []),
    null,
  );
});

Deno.test("invalid field definitions are rejected", () => {
  assertEquals(
    parseFormFields([{ key: "x", label: "X", fieldType: "file" }]),
    null,
  );
  assertEquals(
    parseAction({
      ...laptop,
      checklistItems: [
        { description: "X", condition: { fieldKey: "docking" } },
      ],
    }),
    null,
  );
  const action = parseAction({
    ...laptop,
    checklistItems: [
      {
        description: "Lizenz",
        condition: { fieldKey: "modell", equals: "Gaming" },
      },
    ],
  });
  if (!action || action.type !== "createTemplate")
    throw new Error("Vorlage wurde unerwartet abgelehnt.");
  assertEquals(
    templateFormError(action.formFields ?? [], action.checklistItems ?? []),
    "Checklistenpunkt 1: Der Vergleichswert muss eine Option von «Modell» sein.",
  );
});

Deno.test("templates are returned with sorted fields", () => {
  const template = normalizeTemplate({
    id: "t",
    name: "Neuer Laptop",
    ticket_template_checklist_items: [
      { id: "b", description: "Zwei", position: 1, condition: null },
      {
        id: "a",
        description: "Eins",
        position: 0,
        condition: { fieldKey: "docking", equals: "true" },
      },
    ],
    ticket_template_fields: [
      {
        id: "f2",
        key: "docking",
        label: "Docking",
        field_type: "checkbox",
        required: false,
        options: [],
        help_text: null,
        position: 1,
        condition: null,
      },
      {
        id: "f1",
        key: "person",
        label: "Person",
        field_type: "text",
        required: true,
        options: [],
        help_text: "Vor- und Nachname",
        position: 0,
        condition: null,
      },
    ],
  });
  assertEquals(
    template.formFields.map((field: { key: string }) => field.key),
    ["person", "docking"],
  );
  assertEquals(template.checklistItems[0]?.condition, {
    fieldKey: "docking",
    equals: "true",
  });
});
