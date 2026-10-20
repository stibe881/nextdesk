import { assertEquals } from "jsr:@std/assert@1";
import { parseTicketCustomFieldsAction } from "./index.ts";

const tenantId = "10000000-0000-4000-8000-000000000001";
const sectionId = "90000000-0000-4000-8000-000000000001";
const definitionId = "80000000-0000-4000-8000-000000000001";

Deno.test(
  "Ticketfeld-Function akzeptiert nur atomare, versionierte Paletteneinfügungen",
  () => {
    assertEquals(
      parseTicketCustomFieldsAction({
        type: "createDefinitionAtPosition",
        tenantId,
        fieldKey: "geraetestandort",
        label: "Gerätestandort",
        fieldType: "select",
        required: false,
        options: ["Büro", "Homeoffice"],
        sectionId,
        position: 1,
        expectedVersion: 7,
      }),
      {
        type: "createDefinitionAtPosition",
        tenantId,
        fieldKey: "geraetestandort",
        label: "Gerätestandort",
        fieldType: "select",
        required: false,
        options: ["Büro", "Homeoffice"],
        sectionId,
        position: 1,
        expectedVersion: 7,
      },
    );
  },
);

Deno.test(
  "Ticketfeld-Function akzeptiert eine atomare Bearbeitung mit Abschnittswechsel",
  () => {
    assertEquals(
      parseTicketCustomFieldsAction({
        type: "updateDefinitionAtPosition",
        tenantId,
        definitionId,
        fieldKey: "geraetestandort",
        label: "Gerätestandort aktualisiert",
        fieldType: "select",
        required: true,
        options: ["Büro", "Homeoffice"],
        sectionId,
        position: 0,
        expectedVersion: 8,
      }),
      {
        type: "updateDefinitionAtPosition",
        tenantId,
        definitionId,
        fieldKey: "geraetestandort",
        label: "Gerätestandort aktualisiert",
        fieldType: "select",
        required: true,
        options: ["Büro", "Homeoffice"],
        sectionId,
        position: 0,
        expectedVersion: 8,
      },
    );
  },
);

Deno.test(
  "Ticketfeld-Function verwirft unversionierte oder unvollständige Mutationen",
  () => {
    assertEquals(
      parseTicketCustomFieldsAction({
        type: "upsertDefinition",
        tenantId,
        definitionId,
        fieldKey: "geraetestandort",
        label: "Gerätestandort",
        fieldType: "text",
        required: false,
        options: [],
      }),
      null,
    );
    assertEquals(
      parseTicketCustomFieldsAction({
        type: "updateDefinitionAtPosition",
        tenantId,
        definitionId,
        fieldKey: "geraetestandort",
        label: "Gerätestandort",
        fieldType: "text",
        required: false,
        options: [],
        sectionId,
        position: 0,
      }),
      null,
    );
    assertEquals(
      parseTicketCustomFieldsAction({
        type: "retireDefinition",
        tenantId,
        definitionId,
      }),
      null,
    );
  },
);
