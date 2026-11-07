import { assertEquals } from "jsr:@std/assert@1";
import {
  parseAction,
  parseFormAnswers,
  publicTicketTemplate,
} from "./index.ts";

const TENANT = "0b6a1c1e-4f7a-4d2b-9c1e-2a3b4c5d6e7f";
const DEPARTMENT = "1c7b2d2f-5a8b-4e3c-8d2f-3b4c5d6e7f80";
const TEMPLATE = "2d8c3e3f-6b9c-4f4d-9e3f-4c5d6e7f8091";
const REQUESTER = "3e9d4f4f-7cad-4a5e-8f4f-5d6e7f809102";

const baseTicket = {
  type: "createTicket",
  tenantId: TENANT,
  departmentId: DEPARTMENT,
  subject: "Neuer Laptop",
  description: "-",
  priorityKey: "normal",
  requesterContactId: REQUESTER,
};

Deno.test("form answers are parsed strictly", () => {
  assertEquals(parseFormAnswers({ person: "Erika", docking: true, ram: 16 }), {
    person: "Erika",
    docking: true,
    ram: 16,
  });
  assertEquals(parseFormAnswers({ Person: "Erika" }), null);
  assertEquals(parseFormAnswers({ person: { nested: true } }), null);
  assertEquals(parseFormAnswers({ person: "x".repeat(10001) }), null);
  assertEquals(parseFormAnswers(["Erika"]), null);
});

Deno.test("createTicket accepts form answers only with a template", () => {
  const withTemplate = parseAction({
    ...baseTicket,
    templateId: TEMPLATE,
    formAnswers: { person: "Erika", docking: true },
  });
  assertEquals(
    withTemplate && "formAnswers" in withTemplate
      ? withTemplate.formAnswers
      : null,
    { person: "Erika", docking: true },
  );
  assertEquals(
    parseAction({ ...baseTicket, formAnswers: { person: "Erika" } }),
    null,
  );
  assertEquals(
    parseAction({
      ...baseTicket,
      templateId: TEMPLATE,
      formAnswers: { person: [1] },
    }),
    null,
  );
});

Deno.test("available templates carry form fields and conditions", () => {
  const template = publicTicketTemplate({
    id: TEMPLATE,
    name: "Neuer Laptop",
    subject_template: "Laptop für {{anfragende_person}}",
    description_template: "Bitte vorbereiten.",
    priority_key: null,
    ticket_template_checklist_items: [
      {
        description: "Docking-Station bestellen",
        position: 1,
        condition: { fieldKey: "docking", equals: "true" },
      },
      { description: "Laptop bestellen", position: 0, condition: null },
    ],
    ticket_template_fields: [
      {
        key: "docking",
        label: "Docking-Station nötig",
        field_type: "checkbox",
        required: false,
        options: [],
        help_text: null,
        position: 1,
        condition: null,
      },
      {
        key: "modell",
        label: "Modell",
        field_type: "select",
        required: true,
        options: ["Standard", "Entwickler"],
        help_text: "Entwickler mit mehr Speicher",
        position: 0,
        condition: null,
      },
    ],
  });
  assertEquals(
    template?.formFields.map((field) => field.key),
    ["modell", "docking"],
  );
  assertEquals(
    template?.checklistItems.map((item) => item.condition),
    [null, { fieldKey: "docking", equals: "true" }],
  );

  // An invalid stored condition makes the template unavailable.
  assertEquals(
    publicTicketTemplate({
      id: TEMPLATE,
      name: "Kaputt",
      subject_template: "Betreff",
      description_template: "Text",
      priority_key: null,
      ticket_template_checklist_items: [
        { description: "Punkt", position: 0, condition: { fieldKey: 1 } },
      ],
    }),
    null,
  );
});

Deno.test(
  "ticket creation stores answers and filters checklist items",
  async () => {
    const source = await Deno.readTextFile(
      new URL("./index.ts", import.meta.url),
    );
    for (const snippet of [
      'from("ticket_form_answers")',
      "applicableChecklistItems(ticketTemplate.checklistItems, formAnswers)",
      "templateChecklistItems.map((item) => ({",
      "appendAnswersToDescription(",
      '"ticket_form_invalid"',
    ]) {
      if (!source.includes(snippet))
        throw new Error(`ticket-actions muss «${snippet}» enthalten.`);
    }
  },
);
