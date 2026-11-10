import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { FormCard, FormField, FormGrid, FormSwitch } from "./form-kit";
import {
  MAX_TEMPLATE_FIELDS,
  TEMPLATE_FIELD_TYPES,
  formatAnswerValue,
  visibleFields,
  type FormAnswerValue,
  type FormAnswers,
  type TemplateCondition,
  type TemplateFieldType,
  type TemplateFormField,
} from "./lib/ticket-template-form";

export const FIELD_TYPE_LABELS: Record<TemplateFieldType, string> = {
  text: "Text (einzeilig)",
  textarea: "Text (mehrzeilig)",
  select: "Auswahl",
  checkbox: "Checkbox",
  date: "Datum",
  number: "Zahl",
};

// ---------------------------------------------------------------------------
// Ticket erfassen: Formularfelder einer Vorlage ausfüllen
// ---------------------------------------------------------------------------

export function TicketTemplateFormFields({
  answers,
  disabled,
  errors,
  fields,
  onChange,
}: {
  answers: FormAnswers;
  disabled: boolean;
  errors: Record<string, string>;
  fields: TemplateFormField[];
  onChange: (key: string, value: FormAnswerValue | null) => void;
}) {
  const shown = visibleFields(fields, answers);
  if (shown.length === 0) return null;

  return (
    <FormCard sub="Angaben zur Vorlage" title="Formular ausfüllen">
      <FormGrid cols={2}>
        {shown.map((field) => {
          const id = `ticket-template-field-${field.key}`;
          const errorId = `${id}-error`;
          const helpId = `${id}-help`;
          const error = errors[field.key];
          const describedBy =
            [field.helpText ? helpId : null, error ? errorId : null]
              .filter(Boolean)
              .join(" ") || undefined;
          const value = answers[field.key];
          const text =
            typeof value === "string"
              ? value
              : typeof value === "number"
                ? String(value)
                : "";
          const wide = field.fieldType === "textarea";
          const help = field.helpText ? (
            <span className="data-caption" id={helpId}>
              {field.helpText}
            </span>
          ) : null;
          const errorText = error ? (
            <span className="error" id={errorId} role="alert">
              {error}
            </span>
          ) : null;

          if (field.fieldType === "checkbox") {
            return (
              <div key={field.key} style={{ gridColumn: "1 / -1" }}>
                <FormSwitch
                  checked={value === true}
                  disabled={disabled}
                  label={field.label}
                  onChange={(checked) => onChange(field.key, checked)}
                />
                {help}
                {errorText}
              </div>
            );
          }

          const common = {
            "aria-describedby": describedBy,
            "aria-invalid": Boolean(error),
            "aria-required": field.required,
            disabled,
            id,
          };
          return (
            <div
              key={field.key}
              style={wide ? { gridColumn: "1 / -1" } : undefined}
            >
              <FormField label={field.label} required={field.required}>
                {field.fieldType === "select" ? (
                  <select
                    {...common}
                    onChange={(event) =>
                      onChange(field.key, event.target.value || null)
                    }
                    value={text}
                  >
                    <option value="">Bitte wählen …</option>
                    {field.options.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                ) : field.fieldType === "textarea" ? (
                  <textarea
                    {...common}
                    maxLength={10000}
                    onChange={(event) =>
                      onChange(field.key, event.target.value)
                    }
                    rows={3}
                    value={text}
                  />
                ) : (
                  <input
                    {...common}
                    inputMode={
                      field.fieldType === "number" ? "decimal" : undefined
                    }
                    maxLength={field.fieldType === "text" ? 1000 : undefined}
                    onChange={(event) =>
                      onChange(field.key, event.target.value)
                    }
                    type={field.fieldType === "date" ? "date" : "text"}
                    value={text}
                  />
                )}
                {help}
                {errorText}
              </FormField>
            </div>
          );
        })}
      </FormGrid>
    </FormCard>
  );
}

// ---------------------------------------------------------------------------
// Ticketdetail: gespeicherte Formularangaben anzeigen
// ---------------------------------------------------------------------------

export type StoredFormAnswers = {
  answers: Record<string, unknown>;
  fields: Array<{ key: string; label: string; fieldType: TemplateFieldType }>;
};

export function parseStoredFormAnswers(
  value: unknown,
): StoredFormAnswers | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const answers = record.answers;
  const fields = record.fields;
  if (
    typeof answers !== "object" ||
    answers === null ||
    Array.isArray(answers) ||
    !Array.isArray(fields)
  )
    return null;
  const parsedFields: StoredFormAnswers["fields"] = [];
  for (const field of fields) {
    if (
      typeof field === "object" &&
      field !== null &&
      typeof field.key === "string" &&
      typeof field.label === "string" &&
      (TEMPLATE_FIELD_TYPES as readonly string[]).includes(field.fieldType)
    )
      parsedFields.push({
        key: field.key,
        label: field.label,
        fieldType: field.fieldType as TemplateFieldType,
      });
  }
  return { answers: answers as Record<string, unknown>, fields: parsedFields };
}

export function TicketFormAnswersBlock({
  stored,
}: {
  stored: StoredFormAnswers;
}) {
  const rows = stored.fields
    .filter((field) =>
      Object.prototype.hasOwnProperty.call(stored.answers, field.key),
    )
    .map((field) => ({
      key: field.key,
      label: field.label,
      text: formatAnswerValue(field.fieldType, stored.answers[field.key]),
    }))
    .filter((row) => row.text);
  if (rows.length === 0) return null;
  return (
    <section
      aria-labelledby="ticket-form-answers-heading"
      className="ticket-form-answers"
    >
      <h3 id="ticket-form-answers-heading">Formularangaben</h3>
      <dl>
        {rows.map((row) => (
          <div key={row.key}>
            <dt>{row.label}</dt>
            <dd>{row.text}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Vorlagenverwaltung: Felder bearbeiten und Bedingungen wählen
// ---------------------------------------------------------------------------

export type FieldDraft = {
  uid: string;
  key: string;
  keyTouched: boolean;
  label: string;
  fieldType: TemplateFieldType;
  required: boolean;
  optionsText: string;
  helpText: string;
  condition: TemplateCondition | null;
};

let draftCounter = 0;
function nextUid(): string {
  draftCounter += 1;
  return `field-${draftCounter}`;
}

/** Erzeugt einen Feldschlüssel aus einer Bezeichnung («Eintrittsdatum» → «eintrittsdatum»). */
export function slugifyFieldKey(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const prefixed = /^[a-z]/.test(slug) ? slug : `feld_${slug}`;
  return prefixed.replace(/_+$/g, "").slice(0, 63);
}

export function fieldDraftFromField(field: TemplateFormField): FieldDraft {
  return {
    uid: nextUid(),
    key: field.key,
    keyTouched: true,
    label: field.label,
    fieldType: field.fieldType,
    required: field.required,
    optionsText: field.options.join("\n"),
    helpText: field.helpText ?? "",
    condition: field.condition,
  };
}

export function fieldFromDraft(
  draft: FieldDraft,
  position: number,
): TemplateFormField {
  return {
    key: draft.key.trim(),
    label: draft.label.trim(),
    fieldType: draft.fieldType,
    required: draft.required,
    options:
      draft.fieldType === "select"
        ? draft.optionsText
            .split("\n")
            .map((option) => option.trim())
            .filter(Boolean)
        : [],
    helpText: draft.helpText.trim() || null,
    position,
    condition: draft.condition,
  };
}

function emptyFieldDraft(existingKeys: Set<string>): FieldDraft {
  let index = existingKeys.size + 1;
  while (existingKeys.has(`feld_${index}`)) index += 1;
  return {
    uid: nextUid(),
    key: `feld_${index}`,
    keyTouched: false,
    label: "",
    fieldType: "text",
    required: false,
    optionsText: "",
    helpText: "",
    condition: null,
  };
}

/**
 * Auswahl «nur anzeigen/erstellen wenn Feld X = Wert». Ohne gewähltes Feld
 * gilt das Element immer.
 */
export function ConditionPicker({
  candidates,
  condition,
  disabled,
  label,
  onChange,
}: {
  candidates: TemplateFormField[];
  condition: TemplateCondition | null;
  disabled: boolean;
  label: string;
  onChange: (condition: TemplateCondition | null) => void;
}) {
  const target = condition
    ? candidates.find((field) => field.key === condition.fieldKey)
    : undefined;

  function defaultEquals(field: TemplateFormField): string {
    if (field.fieldType === "checkbox") return "true";
    if (field.fieldType === "select") return field.options[0] ?? "";
    return "";
  }

  return (
    <div className="ticket-template-condition" role="group" aria-label={label}>
      <span className="ticket-template-condition__label">{label}</span>
      <select
        aria-label={`${label}: Feld`}
        disabled={disabled || candidates.length === 0}
        onChange={(event) => {
          const field = candidates.find(
            (candidate) => candidate.key === event.target.value,
          );
          onChange(
            field
              ? { fieldKey: field.key, equals: defaultEquals(field) }
              : null,
          );
        }}
        value={target?.key ?? (condition ? condition.fieldKey : "")}
      >
        <option value="">Immer</option>
        {condition && !target && (
          <option value={condition.fieldKey}>
            Unbekanntes Feld «{condition.fieldKey}»
          </option>
        )}
        {candidates.map((field) => (
          <option key={field.key} value={field.key}>
            wenn «{field.label || field.key}»
          </option>
        ))}
      </select>
      {condition && target && (
        <>
          <span aria-hidden="true">=</span>
          {target.fieldType === "checkbox" ? (
            <select
              aria-label={`${label}: Wert`}
              disabled={disabled}
              onChange={(event) =>
                onChange({ ...condition, equals: event.target.value })
              }
              value={condition.equals}
            >
              <option value="true">angekreuzt</option>
              <option value="false">nicht angekreuzt</option>
            </select>
          ) : target.fieldType === "select" ? (
            <select
              aria-label={`${label}: Wert`}
              disabled={disabled}
              onChange={(event) =>
                onChange({ ...condition, equals: event.target.value })
              }
              value={condition.equals}
            >
              {!target.options.includes(condition.equals) && (
                <option value={condition.equals}>
                  {condition.equals || "Bitte wählen …"}
                </option>
              )}
              {target.options.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          ) : (
            <input
              aria-label={`${label}: Wert`}
              disabled={disabled}
              maxLength={160}
              onChange={(event) =>
                onChange({ ...condition, equals: event.target.value })
              }
              placeholder={target.fieldType === "date" ? "JJJJ-MM-TT" : "Wert"}
              value={condition.equals}
            />
          )}
        </>
      )}
    </div>
  );
}

export function TemplateFieldsEditor({
  disabled,
  drafts,
  onChange,
}: {
  disabled: boolean;
  drafts: FieldDraft[];
  onChange: (next: FieldDraft[]) => void;
}) {
  const fields = drafts.map(fieldFromDraft);

  function update(index: number, patch: Partial<FieldDraft>) {
    onChange(
      drafts.map((draft, draftIndex) => {
        if (draftIndex !== index) return draft;
        const next = { ...draft, ...patch };
        if (patch.label !== undefined && !draft.keyTouched) {
          next.key = slugifyFieldKey(patch.label) || draft.key;
        }
        return next;
      }),
    );
  }

  function move(index: number, offset: -1 | 1) {
    const target = index + offset;
    if (target < 0 || target >= drafts.length) return;
    const next = [...drafts];
    const [moved] = next.splice(index, 1);
    if (!moved) return;
    next.splice(target, 0, moved);
    onChange(next);
  }

  return (
    <div className="ticket-templates__checklist ticket-templates__full-width">
      <div className="ticket-templates__checklist-heading">
        <span />
        <button
          className="ticket-templates__button"
          disabled={disabled || drafts.length >= MAX_TEMPLATE_FIELDS}
          onClick={() =>
            onChange([
              ...drafts,
              emptyFieldDraft(new Set(drafts.map((draft) => draft.key))),
            ])
          }
          type="button"
        >
          <Plus aria-hidden="true" size={14} />
          Feld hinzufügen
        </button>
      </div>
      {drafts.length === 0 ? (
        <p className="ticket-templates__description">
          Keine Formularfelder. Mit Feldern fragen Sie beim Erfassen
          strukturierte Angaben ab, zum Beispiel Name der Person oder
          Eintrittsdatum. Die Antworten werden an die Beschreibung angehängt.
        </p>
      ) : (
        <ol className="ticket-template-fields">
          {drafts.map((draft, index) => {
            const number = index + 1;
            const candidates = fields.filter(
              (field, fieldIndex) => fieldIndex !== index && field.key,
            );
            return (
              <li className="ticket-template-fields__item" key={draft.uid}>
                <div className="ticket-template-fields__grid">
                  <label>
                    Bezeichnung
                    <input
                      disabled={disabled}
                      maxLength={160}
                      onChange={(event) =>
                        update(index, { label: event.target.value })
                      }
                      placeholder="Zum Beispiel: Eintrittsdatum"
                      required
                      value={draft.label}
                    />
                  </label>
                  <label>
                    Schlüssel
                    <input
                      disabled={disabled}
                      maxLength={63}
                      onChange={(event) =>
                        update(index, {
                          key: event.target.value,
                          keyTouched: true,
                        })
                      }
                      pattern="[a-z][a-z0-9_]{0,62}"
                      required
                      title="Kleinbuchstaben, Ziffern und Unterstriche; zuerst ein Buchstabe."
                      value={draft.key}
                    />
                  </label>
                  <label>
                    Feldtyp
                    <select
                      disabled={disabled}
                      onChange={(event) =>
                        update(index, {
                          fieldType: event.target.value as TemplateFieldType,
                        })
                      }
                      value={draft.fieldType}
                    >
                      {TEMPLATE_FIELD_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {FIELD_TYPE_LABELS[type]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="ticket-templates__checkbox ticket-template-fields__required">
                    <input
                      checked={draft.required}
                      disabled={disabled}
                      onChange={(event) =>
                        update(index, { required: event.target.checked })
                      }
                      type="checkbox"
                    />
                    Pflichtfeld
                  </label>
                  {draft.fieldType === "select" && (
                    <label className="ticket-templates__full-width">
                      Optionen (eine pro Zeile)
                      <textarea
                        disabled={disabled}
                        onChange={(event) =>
                          update(index, { optionsText: event.target.value })
                        }
                        placeholder={"Standard\nEntwickler"}
                        rows={3}
                        value={draft.optionsText}
                      />
                    </label>
                  )}
                  <label className="ticket-templates__full-width">
                    Hilfetext (optional)
                    <input
                      disabled={disabled}
                      maxLength={500}
                      onChange={(event) =>
                        update(index, { helpText: event.target.value })
                      }
                      value={draft.helpText}
                    />
                  </label>
                  <div className="ticket-templates__full-width">
                    <ConditionPicker
                      candidates={candidates}
                      condition={draft.condition}
                      disabled={disabled}
                      label={`Feld ${number} nur anzeigen`}
                      onChange={(condition) => update(index, { condition })}
                    />
                  </div>
                </div>
                <div className="ticket-templates__actions">
                  <button
                    aria-label={`Feld ${number} nach oben verschieben`}
                    className="ticket-templates__button"
                    disabled={disabled || index === 0}
                    onClick={() => move(index, -1)}
                    type="button"
                  >
                    <ArrowUp aria-hidden="true" size={14} />
                  </button>
                  <button
                    aria-label={`Feld ${number} nach unten verschieben`}
                    className="ticket-templates__button"
                    disabled={disabled || index === drafts.length - 1}
                    onClick={() => move(index, 1)}
                    type="button"
                  >
                    <ArrowDown aria-hidden="true" size={14} />
                  </button>
                  <button
                    aria-label={`Feld ${number} entfernen`}
                    className="ticket-templates__button ticket-templates__button--danger"
                    disabled={disabled}
                    onClick={() =>
                      onChange(
                        drafts.filter((_, draftIndex) => draftIndex !== index),
                      )
                    }
                    type="button"
                  >
                    <X aria-hidden="true" size={15} />
                    Entfernen
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
