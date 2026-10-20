export type TicketCustomFieldType =
  "text" | "number" | "date" | "select" | "checkbox";

export type TicketFieldPresetCategory = "Feldtypen" | "Ticketvorlagen";

export type TicketFieldPreset = {
  category: TicketFieldPresetCategory;
  description: string;
  fieldKeyBase: string;
  fieldType: TicketCustomFieldType;
  id: string;
  label: string;
  options: readonly string[];
  required: boolean;
  symbol: string;
};

export type TicketFieldPresetDraft = {
  fieldKey: string;
  fieldType: TicketCustomFieldType;
  label: string;
  options: string;
  required: boolean;
};

export const TICKET_FIELD_PRESETS: readonly TicketFieldPreset[] = [
  {
    id: "short-text",
    category: "Feldtypen",
    symbol: "T",
    label: "Kurzer Text",
    description: "Für Angaben wie Raum, Gerät oder Referenz.",
    fieldKeyBase: "zusatzinformation",
    fieldType: "text",
    required: false,
    options: [],
  },
  {
    id: "selection",
    category: "Feldtypen",
    symbol: "⌄",
    label: "Auswahl",
    description: "Eine klar definierte Auswahl pro Ticket.",
    fieldKeyBase: "auswahl",
    fieldType: "select",
    required: false,
    options: ["Option 1", "Option 2"],
  },
  {
    id: "date",
    category: "Feldtypen",
    symbol: "▣",
    label: "Datum",
    description: "Für Termine, Fristen oder gewünschte Daten.",
    fieldKeyBase: "datum",
    fieldType: "date",
    required: false,
    options: [],
  },
  {
    id: "number",
    category: "Feldtypen",
    symbol: "#",
    label: "Zahl",
    description: "Für Mengen und Anzahl betroffener Personen.",
    fieldKeyBase: "anzahl",
    fieldType: "number",
    required: false,
    options: [],
  },
  {
    id: "yes-no",
    category: "Feldtypen",
    symbol: "✓",
    label: "Ja / Nein",
    description: "Für eine eindeutige Bestätigung oder Anfrage.",
    fieldKeyBase: "bestaetigung",
    fieldType: "checkbox",
    required: false,
    options: [],
  },
  {
    id: "asset-reference",
    category: "Ticketvorlagen",
    symbol: "▤",
    label: "Geräte- / Inventarnummer",
    description: "Erfasst ein betroffenes Gerät eindeutig.",
    fieldKeyBase: "geraete_inventarnummer",
    fieldType: "text",
    required: false,
    options: [],
  },
  {
    id: "location",
    category: "Ticketvorlagen",
    symbol: "⌖",
    label: "Standort / Raum",
    description: "Hilft bei Vor-Ort-Aufträgen und Raumtechnik.",
    fieldKeyBase: "standort_raum",
    fieldType: "text",
    required: false,
    options: [],
  },
  {
    id: "desired-date",
    category: "Ticketvorlagen",
    symbol: "▣",
    label: "Gewünschter Termin",
    description: "Für planbare Unterstützung und Einrichtung.",
    fieldKeyBase: "gewuenschter_termin",
    fieldType: "date",
    required: false,
    options: [],
  },
  {
    id: "affected-people",
    category: "Ticketvorlagen",
    symbol: "#",
    label: "Betroffene Personen",
    description: "Macht die Reichweite einer Störung sichtbar.",
    fieldKeyBase: "betroffene_personen",
    fieldType: "number",
    required: false,
    options: [],
  },
  {
    id: "callback-requested",
    category: "Ticketvorlagen",
    symbol: "✓",
    label: "Rückruf erwünscht",
    description: "Erfasst einen gewünschten telefonischen Rückruf.",
    fieldKeyBase: "rueckruf_erwuenscht",
    fieldType: "checkbox",
    required: false,
    options: [],
  },
] as const;

function normaliseFieldKeyBase(value: string): string {
  const normalised = value
    .toLocaleLowerCase("de-CH")
    .replace(/ä/gu, "ae")
    .replace(/ö/gu, "oe")
    .replace(/ü/gu, "ue")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-zA-Z0-9_]/gu, "_")
    .replace(/_+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .toLowerCase();

  const withPrefix = /^[a-z]/u.test(normalised)
    ? normalised
    : `feld_${normalised}`;
  return withPrefix.slice(0, 63).replace(/_+$/u, "") || "zusatzfeld";
}

export function createUniqueTicketFieldKey(
  base: string,
  existingKeys: Iterable<string>,
): string {
  const usedKeys = new Set(
    Array.from(existingKeys, (key) => key.toLocaleLowerCase("de-CH")),
  );
  const normalisedBase = normaliseFieldKeyBase(base);
  if (!usedKeys.has(normalisedBase)) return normalisedBase;

  for (let suffix = 2; suffix < 10_000; suffix += 1) {
    const suffixText = `_${suffix}`;
    const candidate = `${normalisedBase.slice(0, 63 - suffixText.length)}${suffixText}`;
    if (!usedKeys.has(candidate)) return candidate;
  }

  throw new Error("Kein eindeutiger technischer Schlüssel verfügbar.");
}

export function createTicketFieldPresetDraft(
  preset: TicketFieldPreset,
  existingKeys: Iterable<string>,
): TicketFieldPresetDraft {
  return {
    fieldKey: createUniqueTicketFieldKey(preset.fieldKeyBase, existingKeys),
    fieldType: preset.fieldType,
    label: preset.label,
    options: preset.options.join("\n"),
    required: preset.required,
  };
}

export function ticketFieldPresetsByCategory(
  category: TicketFieldPresetCategory,
): readonly TicketFieldPreset[] {
  return TICKET_FIELD_PRESETS.filter((preset) => preset.category === category);
}
