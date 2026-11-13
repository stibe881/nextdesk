// Formularfelder von Ticketvorlagen: reine Logik ohne Abhängigkeiten.
//
// Diese Datei existiert identisch zweimal:
//   supabase/functions/_shared/ticket-template-form.ts (Edge Functions, Deno)
//   apps/web/src/lib/ticket-template-form.ts (Web-App, Vite)
// Ein Vitest-Test prüft, dass beide Kopien übereinstimmen. Änderungen immer in
// beiden Dateien vornehmen.

export const TEMPLATE_FIELD_TYPES = [
  "text",
  "textarea",
  "select",
  "checkbox",
  "date",
  "number",
] as const;

export type TemplateFieldType = (typeof TEMPLATE_FIELD_TYPES)[number];

export type TemplateCondition = { fieldKey: string; equals: string };

export type TemplateFormField = {
  key: string;
  label: string;
  fieldType: TemplateFieldType;
  required: boolean;
  options: string[];
  helpText: string | null;
  position: number;
  condition: TemplateCondition | null;
};

export type FormAnswerValue = string | number | boolean;
export type FormAnswers = Record<string, FormAnswerValue | null | undefined>;
export type SanitizedFormAnswers = Record<string, FormAnswerValue>;

export const MAX_TEMPLATE_FIELDS = 50;
export const MAX_FIELD_OPTIONS = 50;
export const FIELD_KEY_PATTERN = /^[a-z][a-z0-9_]{0,62}$/;
export const FORM_DESCRIPTION_HEADING = "## Angaben aus dem Formular";

const TEXT_MAX_LENGTH: Record<TemplateFieldType, number> = {
  text: 1000,
  textarea: 10000,
  select: 160,
  checkbox: 0,
  date: 10,
  number: 40,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isTemplateFieldType(
  value: unknown,
): value is TemplateFieldType {
  return (
    typeof value === "string" &&
    (TEMPLATE_FIELD_TYPES as readonly string[]).includes(value)
  );
}

/**
 * Liest eine Bedingung. Gibt `null` für «keine Bedingung» und `undefined` für
 * eine ungültige Bedingung zurück.
 */
export function parseCondition(
  value: unknown,
): TemplateCondition | null | undefined {
  if (value === null || value === undefined) return null;
  if (!isRecord(value) || Object.keys(value).length !== 2) return undefined;
  const { fieldKey, equals } = value;
  if (
    typeof fieldKey !== "string" ||
    !FIELD_KEY_PATTERN.test(fieldKey) ||
    typeof equals !== "string" ||
    equals.length < 1 ||
    equals.length > 160
  )
    return undefined;
  return { fieldKey, equals };
}

/** Wandelt eine Antwort in den Text um, mit dem Bedingungen verglichen werden. */
export function answerComparisonText(value: unknown): string {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number")
    return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "string") return value.trim();
  return "";
}

export function conditionHolds(
  condition: TemplateCondition | null | undefined,
  answers: FormAnswers,
): boolean {
  if (!condition) return true;
  const value = Object.prototype.hasOwnProperty.call(
    answers,
    condition.fieldKey,
  )
    ? answers[condition.fieldKey]
    : undefined;
  return answerComparisonText(value) === condition.equals;
}

function sortedFields(fields: readonly TemplateFormField[]) {
  return [...fields].sort(
    (left, right) =>
      left.position - right.position || left.key.localeCompare(right.key),
  );
}

/**
 * Felder, die bei den aktuellen Antworten sichtbar sind. Ein Feld ist nur
 * sichtbar, wenn seine Bedingung gilt und das Feld, auf das sie sich bezieht,
 * selbst sichtbar ist. Zyklen und Verweise auf unbekannte Felder gelten als
 * nicht erfüllt.
 */
export function visibleFields(
  fields: readonly TemplateFormField[],
  answers: FormAnswers,
): TemplateFormField[] {
  const byKey = new Map(fields.map((field) => [field.key, field]));
  const memo = new Map<string, boolean>();

  const isVisible = (field: TemplateFormField, trail: Set<string>): boolean => {
    const known = memo.get(field.key);
    if (known !== undefined) return known;
    let visible = true;
    if (field.condition) {
      const parent = byKey.get(field.condition.fieldKey);
      if (!parent || trail.has(parent.key)) visible = false;
      else {
        const nextTrail = new Set(trail).add(field.key);
        visible =
          isVisible(parent, nextTrail) &&
          conditionHolds(
            field.condition,
            effectiveValueMap(parent, answers[parent.key]),
          );
      }
    }
    memo.set(field.key, visible);
    return visible;
  };

  return sortedFields(fields).filter((field) =>
    isVisible(field, new Set([field.key])),
  );
}

function effectiveValueMap(
  field: TemplateFormField,
  value: FormAnswerValue | null | undefined,
): FormAnswers {
  const normalized = normalizeAnswer(field, value);
  return normalized === undefined ? {} : { [field.key]: normalized };
}

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function parseNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Normalisiert eine einzelne Antwort auf ihren Feldtyp. `undefined` bedeutet
 * «nicht beantwortet». Checkboxen sind ohne Antwort `false`.
 */
function normalizeAnswer(
  field: TemplateFormField,
  value: unknown,
): FormAnswerValue | undefined {
  if (field.fieldType === "checkbox") return value === true;
  if (field.fieldType === "number") {
    if (value === null || value === undefined || value === "") return undefined;
    const parsed = parseNumber(value);
    return parsed === null ? undefined : parsed;
  }
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Prüft die Antworten aller sichtbaren Felder. Gibt pro Feldschlüssel eine
 * deutsche Fehlermeldung zurück; ein leeres Objekt bedeutet «gültig».
 */
export function validateAnswers(
  fields: readonly TemplateFormField[],
  answers: FormAnswers,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of visibleFields(fields, answers)) {
    const value = answers[field.key];
    const label = field.label.trim();
    const empty =
      value === undefined ||
      value === null ||
      (typeof value === "string" && !value.trim());

    if (field.fieldType === "checkbox") {
      if (value !== undefined && value !== null && typeof value !== "boolean") {
        errors[field.key] = `Die Angabe «${label}» ist ungültig.`;
      } else if (field.required && value !== true) {
        errors[field.key] = `Bitte «${label}» bestätigen.`;
      }
      continue;
    }

    if (empty) {
      if (field.required)
        errors[field.key] =
          field.fieldType === "select"
            ? `Bitte eine Option für «${label}» wählen.`
            : `Bitte das Feld «${label}» ausfüllen.`;
      continue;
    }

    if (field.fieldType === "number") {
      if (parseNumber(value) === null)
        errors[field.key] = `Bitte bei «${label}» eine Zahl eingeben.`;
      continue;
    }

    if (typeof value !== "string") {
      errors[field.key] = `Die Angabe «${label}» ist ungültig.`;
      continue;
    }
    const trimmed = value.trim();
    if (trimmed.length > TEXT_MAX_LENGTH[field.fieldType]) {
      errors[field.key] =
        `Die Angabe «${label}» darf höchstens ${TEXT_MAX_LENGTH[field.fieldType]} Zeichen lang sein.`;
      continue;
    }
    if (field.fieldType === "select" && !field.options.includes(trimmed)) {
      errors[field.key] =
        `Bitte für «${label}» eine der angebotenen Optionen wählen.`;
      continue;
    }
    if (field.fieldType === "date" && !isValidIsoDate(trimmed)) {
      errors[field.key] = `Bitte bei «${label}» ein gültiges Datum eingeben.`;
    }
  }
  return errors;
}

/**
 * Antworten, wie sie gespeichert werden: nur sichtbare, bekannte Felder,
 * typgerecht (Zahl als number, Checkbox als boolean), leere Antworten
 * weggelassen.
 */
export function sanitizeAnswers(
  fields: readonly TemplateFormField[],
  answers: FormAnswers,
): SanitizedFormAnswers {
  const sanitized: SanitizedFormAnswers = {};
  for (const field of visibleFields(fields, answers)) {
    const value = normalizeAnswer(field, answers[field.key]);
    if (value !== undefined) sanitized[field.key] = value;
  }
  return sanitized;
}

/**
 * Checklistenpunkte, deren Bedingung bei den (bereinigten) Antworten gilt.
 * Punkte ohne Bedingung gelten immer.
 */
export function applicableChecklistItems<
  T extends { condition?: TemplateCondition | null },
>(items: readonly T[], answers: FormAnswers): T[] {
  return items.filter((item) =>
    conditionHolds(item.condition ?? null, answers),
  );
}

function escapeMarkdownInline(value: string): string {
  return value.replace(/([\\`*_[\]<>#|])/g, "\\$1");
}

function formatDate(value: string): string {
  if (!isValidIsoDate(value)) return value;
  const [year, month, day] = value.split("-");
  return `${day}.${month}.${year}`;
}

/** Lesbarer Text einer Antwort, z. B. «Ja» für eine gesetzte Checkbox. */
export function formatAnswerValue(
  fieldType: TemplateFieldType,
  value: unknown,
): string {
  if (fieldType === "checkbox") return value === true ? "Ja" : "Nein";
  if (fieldType === "number") {
    const parsed = parseNumber(value);
    return parsed === null ? "" : String(parsed);
  }
  if (typeof value !== "string") return "";
  if (fieldType === "date") return formatDate(value.trim());
  return value.trim();
}

/**
 * Markdown-Abschnitt mit allen sichtbaren, beantworteten Feldern. Gibt einen
 * leeren Text zurück, wenn es nichts anzuzeigen gibt.
 */
export function formatAnswersForDescription(
  fields: readonly TemplateFormField[],
  answers: FormAnswers,
): string {
  const lines: string[] = [];
  for (const field of visibleFields(fields, answers)) {
    const value = normalizeAnswer(field, answers[field.key]);
    if (value === undefined) continue;
    const text = formatAnswerValue(field.fieldType, value);
    if (!text) continue;
    const label = escapeMarkdownInline(field.label.trim());
    const textLines = text.split(/\r?\n/).map(escapeMarkdownInline);
    if (textLines.length === 1) {
      lines.push(`- **${label}:** ${textLines[0]}`);
    } else {
      lines.push(`- **${label}:**`);
      for (const line of textLines) lines.push(`  ${line}`);
    }
  }
  if (lines.length === 0) return "";
  return `${FORM_DESCRIPTION_HEADING}\n\n${lines.join("\n")}`;
}

/** Hängt den Formularabschnitt an eine Beschreibung an. */
export function appendAnswersToDescription(
  description: string,
  fields: readonly TemplateFormField[],
  answers: FormAnswers,
): string {
  const section = formatAnswersForDescription(fields, answers);
  if (!section) return description;
  const base = description.trimEnd();
  return base ? `${base}\n\n${section}` : section;
}

/**
 * Prüft die Felddefinitionen einer Vorlage (Editor und Server). Gibt eine
 * deutsche Fehlermeldung oder `null` zurück. Checklisten-Bedingungen werden
 * gegen dieselben Felder geprüft.
 */
export function validateFieldDefinitions(
  fields: readonly TemplateFormField[],
  checklistConditions: ReadonlyArray<TemplateCondition | null> = [],
): string | null {
  if (fields.length > MAX_TEMPLATE_FIELDS)
    return `Eine Vorlage darf höchstens ${MAX_TEMPLATE_FIELDS} Formularfelder enthalten.`;
  const byKey = new Map<string, TemplateFormField>();
  for (const [index, field] of fields.entries()) {
    const number = index + 1;
    if (!FIELD_KEY_PATTERN.test(field.key))
      return `Der Schlüssel von Feld ${number} ist ungültig. Erlaubt sind Kleinbuchstaben, Ziffern und Unterstriche; das erste Zeichen muss ein Buchstabe sein.`;
    if (byKey.has(field.key))
      return `Der Schlüssel «${field.key}» ist mehrfach vergeben.`;
    const label = field.label.trim();
    if (!label || label.length > 160)
      return `Bitte für Feld ${number} eine Bezeichnung mit höchstens 160 Zeichen eingeben.`;
    if (!isTemplateFieldType(field.fieldType))
      return `Der Feldtyp von «${label}» ist ungültig.`;
    if (field.helpText !== null && field.helpText.length > 500)
      return `Der Hilfetext von «${label}» darf höchstens 500 Zeichen lang sein.`;
    if (field.fieldType === "select") {
      if (field.options.length === 0)
        return `Bitte für das Auswahlfeld «${label}» mindestens eine Option erfassen.`;
      if (field.options.length > MAX_FIELD_OPTIONS)
        return `Das Auswahlfeld «${label}» darf höchstens ${MAX_FIELD_OPTIONS} Optionen haben.`;
      if (
        field.options.some(
          (option) =>
            !option.trim() || option.trim() !== option || option.length > 160,
        )
      )
        return `Die Optionen von «${label}» dürfen nicht leer sein und höchstens 160 Zeichen haben.`;
      if (new Set(field.options).size !== field.options.length)
        return `Die Optionen von «${label}» müssen eindeutig sein.`;
    } else if (field.options.length > 0) {
      return `Nur Auswahlfelder können Optionen haben («${label}»).`;
    }
    byKey.set(field.key, field);
  }

  const checkCondition = (
    condition: TemplateCondition | null,
    ownKey: string | null,
    subject: string,
  ): string | null => {
    if (!condition) return null;
    if (condition.fieldKey === ownKey)
      return `${subject} kann nicht von sich selbst abhängen.`;
    const target = byKey.get(condition.fieldKey);
    if (!target)
      return `${subject} verweist auf ein Feld, das es nicht gibt («${condition.fieldKey}»).`;
    if (!condition.equals || condition.equals.length > 160)
      return `${subject}: Bitte einen Vergleichswert mit höchstens 160 Zeichen angeben.`;
    if (
      target.fieldType === "checkbox" &&
      condition.equals !== "true" &&
      condition.equals !== "false"
    )
      return `${subject}: Eine Checkbox kann nur «angekreuzt» oder «nicht angekreuzt» sein.`;
    if (
      target.fieldType === "select" &&
      !target.options.includes(condition.equals)
    )
      return `${subject}: Der Vergleichswert muss eine Option von «${target.label.trim()}» sein.`;
    return null;
  };

  for (const field of fields) {
    const error = checkCondition(
      field.condition,
      field.key,
      `Das Feld «${field.label.trim()}»`,
    );
    if (error) return error;
  }
  for (const [index, condition] of checklistConditions.entries()) {
    const error = checkCondition(
      condition,
      null,
      `Checklistenpunkt ${index + 1}`,
    );
    if (error) return error;
  }

  // Zyklen (A hängt von B ab, B von A) würden beide Felder dauerhaft
  // verstecken.
  for (const field of fields) {
    const seen = new Set<string>([field.key]);
    let current = field.condition ? byKey.get(field.condition.fieldKey) : null;
    while (current) {
      if (seen.has(current.key))
        return `Die Bedingungen von «${field.label.trim()}» bilden einen Kreis.`;
      seen.add(current.key);
      current = current.condition
        ? byKey.get(current.condition.fieldKey)
        : null;
    }
  }
  return null;
}

/**
 * Liest eine Felddefinition aus unbekannten Daten (API-Eingabe oder
 * Datenbankzeile in camelCase). Gibt `null` bei ungültigen Daten zurück.
 */
export function parseTemplateFormField(
  value: unknown,
  fallbackPosition: number,
): TemplateFormField | null {
  if (!isRecord(value)) return null;
  const fieldType = value.fieldType ?? value.field_type;
  const helpText = value.helpText ?? value.help_text ?? null;
  const condition = parseCondition(value.condition);
  const options = value.options ?? [];
  if (
    typeof value.key !== "string" ||
    typeof value.label !== "string" ||
    !isTemplateFieldType(fieldType) ||
    (value.required !== undefined && typeof value.required !== "boolean") ||
    !Array.isArray(options) ||
    options.some((option) => typeof option !== "string") ||
    (helpText !== null && typeof helpText !== "string") ||
    condition === undefined
  )
    return null;
  const position =
    typeof value.position === "number" && Number.isSafeInteger(value.position)
      ? value.position
      : fallbackPosition;
  const trimmedHelp = typeof helpText === "string" ? helpText.trim() : "";
  return {
    key: value.key.trim(),
    label: value.label.trim(),
    fieldType,
    required: value.required === true,
    options: (options as string[]).map((option) => option.trim()),
    helpText: trimmedHelp ? trimmedHelp : null,
    position,
    condition,
  };
}
