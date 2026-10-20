export type TicketFormPreviewField = {
  contextual?: boolean;
  fieldType: "text" | "textarea" | "select" | "number" | "date" | "checkbox";
  label: string;
  optional?: boolean;
  options?: readonly string[];
  placeholder?: string;
  required?: boolean;
};

export type TicketFormPreviewSection = {
  fields: readonly TicketFormPreviewField[];
  label: string;
};

/**
 * Standard and situationsabhängige Felder, die der nextDesk-Ticket-Composer
 * zeigen kann. Configured custom fields are rendered separately after these
 * sections.
 */
export const STANDARD_TICKET_FORM_PREVIEW_SECTIONS: readonly TicketFormPreviewSection[] =
  [
    {
      label: "Ticket erfassen",
      fields: [
        {
          label: "Anfragende Person",
          fieldType: "text",
          placeholder: "Ausgewählte anfragende Person",
          required: true,
        },
        {
          label: "Betreff",
          fieldType: "text",
          placeholder: "Worum geht es?",
          required: true,
        },
      ],
    },
    {
      label: "Ticket einordnen",
      fields: [
        {
          label: "Abteilung / Angebot",
          contextual: true,
          fieldType: "select",
          placeholder: "Abteilung auswählen",
          required: true,
        },
        {
          label: "Ticketvorlage",
          fieldType: "select",
          optional: true,
          placeholder: "Ohne Vorlage erfassen",
        },
        {
          label: "Zugewiesener Agent",
          contextual: true,
          fieldType: "select",
          optional: true,
          placeholder: "Nicht zugewiesen",
        },
        {
          label: "Kategorie",
          contextual: true,
          fieldType: "select",
          optional: true,
          placeholder: "Keine Auswahl",
        },
        {
          label: "Unterkategorie",
          contextual: true,
          fieldType: "select",
          optional: true,
          placeholder: "Keine Auswahl",
        },
        {
          label: "Priorität",
          fieldType: "select",
          placeholder: "Priorität auswählen",
          required: true,
        },
      ],
    },
    {
      label: "Anliegen",
      fields: [
        {
          label: "Beschreibung",
          fieldType: "textarea",
          placeholder: "Beschreiben Sie das Anliegen so konkret wie möglich.",
          required: true,
        },
      ],
    },
  ];

export function standardTicketFormPreviewLabels(): string[] {
  return STANDARD_TICKET_FORM_PREVIEW_SECTIONS.flatMap((section) =>
    section.fields.map((field) => field.label),
  );
}
