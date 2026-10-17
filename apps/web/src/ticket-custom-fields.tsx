import { useEffect, useState, type FormEvent } from "react";
import { functionErrorMessage } from "./lib/function-error";
import { supabase } from "./lib/supabase";

type FieldType = "text" | "number" | "date" | "select" | "checkbox";
type FieldValue = string | number | boolean | null;
type DraftValue = string | boolean;

type TicketCustomFieldDefinition = {
  id: string;
  fieldKey: string;
  label: string;
  fieldType: FieldType;
  required: boolean;
  active: boolean;
  options: string[];
};

type StoredTicketCustomFieldValue = {
  definitionId: string;
  textValue: string | null;
  numberValue: number | null;
  dateValue: string | null;
  booleanValue: boolean | null;
  selectValue: string | null;
};

type TicketCustomFieldsProps = {
  tenantId: string;
  ticketId: string;
  canUpdate: boolean;
};

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FIELD_TYPES = new Set<FieldType>([
  "text",
  "number",
  "date",
  "select",
  "checkbox",
]);
const LOAD_ERROR =
  "Die Ticket-Zusatzfelder konnten nicht geladen werden. Bitte laden Sie die Ansicht erneut.";
const SAVE_ERROR =
  "Die Ticket-Zusatzfelder konnten nicht gespeichert werden. Bitte versuchen Sie es erneut.";

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const allowedKeys = new Set(keys);
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function hasExactlyKeys(
  value: Record<string, unknown>,
  keys: string[],
): boolean {
  return Object.keys(value).length === keys.length && hasOnlyKeys(value, keys);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

function isTrimmedText(
  value: unknown,
  minimumLength: number,
  maximumLength: number,
): value is string {
  return (
    typeof value === "string" &&
    value === value.trim() &&
    Array.from(value).length >= minimumLength &&
    Array.from(value).length <= maximumLength &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

function isDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    return false;
  }

  const [year = Number.NaN, month = Number.NaN, day = Number.NaN] = value
    .split("-")
    .map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function parseOptions(value: unknown, fieldType: FieldType): string[] | null {
  if (!Array.isArray(value) || value.length > 50) return null;
  if (!value.every((option) => isTrimmedText(option, 1, 100))) return null;

  const options = value as string[];
  const normalizedOptions = options.map((option) =>
    option.toLocaleLowerCase("de-CH"),
  );
  if (new Set(normalizedOptions).size !== options.length) return null;
  if ((fieldType === "select") !== options.length > 0) return null;

  return options;
}

function parseDefinition(value: unknown): TicketCustomFieldDefinition | null {
  const definition = asRecord(value);
  if (
    !definition ||
    !hasExactlyKeys(definition, [
      "id",
      "fieldKey",
      "label",
      "fieldType",
      "required",
      "active",
      "options",
    ]) ||
    !isUuid(definition.id) ||
    !isTrimmedText(definition.fieldKey, 2, 63) ||
    !/^[a-z][a-z0-9_]{1,62}$/u.test(definition.fieldKey) ||
    !isTrimmedText(definition.label, 2, 120) ||
    typeof definition.fieldType !== "string" ||
    !FIELD_TYPES.has(definition.fieldType as FieldType) ||
    typeof definition.required !== "boolean" ||
    typeof definition.active !== "boolean"
  ) {
    return null;
  }

  const fieldType = definition.fieldType as FieldType;
  const options = parseOptions(definition.options, fieldType);
  if (options === null) return null;

  return {
    id: definition.id,
    fieldKey: definition.fieldKey,
    label: definition.label,
    fieldType,
    required: definition.required,
    active: definition.active,
    options,
  };
}

function parseDefinitions(
  value: unknown,
): TicketCustomFieldDefinition[] | null {
  const envelope = asRecord(value);
  if (
    !envelope ||
    !hasExactlyKeys(envelope, ["data"]) ||
    !Array.isArray(envelope.data)
  ) {
    return null;
  }

  const definitions = envelope.data.map(parseDefinition);
  if (
    !definitions.every(
      (definition): definition is TicketCustomFieldDefinition =>
        definition !== null,
    ) ||
    new Set(definitions.map((definition) => definition.id)).size !==
      definitions.length ||
    new Set(definitions.map((definition) => definition.fieldKey)).size !==
      definitions.length
  ) {
    return null;
  }

  return definitions;
}

function parseStoredValue(value: unknown): StoredTicketCustomFieldValue | null {
  const fieldValue = asRecord(value);
  if (
    !fieldValue ||
    !hasExactlyKeys(fieldValue, [
      "definitionId",
      "textValue",
      "numberValue",
      "dateValue",
      "booleanValue",
      "selectValue",
    ]) ||
    !isUuid(fieldValue.definitionId) ||
    (fieldValue.textValue !== null &&
      !isTrimmedText(fieldValue.textValue, 1, 2_000)) ||
    (fieldValue.numberValue !== null &&
      (typeof fieldValue.numberValue !== "number" ||
        !Number.isFinite(fieldValue.numberValue))) ||
    (fieldValue.dateValue !== null && !isDate(fieldValue.dateValue)) ||
    (fieldValue.booleanValue !== null &&
      typeof fieldValue.booleanValue !== "boolean") ||
    (fieldValue.selectValue !== null &&
      !isTrimmedText(fieldValue.selectValue, 1, 100))
  ) {
    return null;
  }

  const populatedValues = [
    fieldValue.textValue,
    fieldValue.numberValue,
    fieldValue.dateValue,
    fieldValue.booleanValue,
    fieldValue.selectValue,
  ].filter((entry) => entry !== null);
  if (populatedValues.length !== 1) return null;

  return {
    definitionId: fieldValue.definitionId,
    textValue: fieldValue.textValue as string | null,
    numberValue: fieldValue.numberValue as number | null,
    dateValue: fieldValue.dateValue as string | null,
    booleanValue: fieldValue.booleanValue as boolean | null,
    selectValue: fieldValue.selectValue as string | null,
  };
}

function valueMatchesDefinition(
  value: StoredTicketCustomFieldValue,
  definition: TicketCustomFieldDefinition,
): boolean {
  switch (definition.fieldType) {
    case "text":
      return value.textValue !== null;
    case "number":
      return value.numberValue !== null;
    case "date":
      return value.dateValue !== null;
    case "select":
      return value.selectValue !== null;
    case "checkbox":
      return value.booleanValue !== null;
  }
}

function parseStoredValues(
  value: unknown,
  definitions: TicketCustomFieldDefinition[],
): Record<string, StoredTicketCustomFieldValue> | null {
  const envelope = asRecord(value);
  if (
    !envelope ||
    !hasExactlyKeys(envelope, ["data"]) ||
    !Array.isArray(envelope.data)
  ) {
    return null;
  }

  const values = envelope.data.map(parseStoredValue);
  if (
    !values.every(
      (fieldValue): fieldValue is StoredTicketCustomFieldValue =>
        fieldValue !== null,
    ) ||
    new Set(values.map((fieldValue) => fieldValue.definitionId)).size !==
      values.length
  ) {
    return null;
  }

  const definitionsById = new Map(
    definitions.map((definition) => [definition.id, definition]),
  );
  if (
    !values.every((fieldValue) => {
      const definition = definitionsById.get(fieldValue.definitionId);
      return (
        definition !== undefined &&
        valueMatchesDefinition(fieldValue, definition)
      );
    })
  ) {
    return null;
  }

  return Object.fromEntries(
    values.map((fieldValue) => [fieldValue.definitionId, fieldValue]),
  );
}

function initialDraft(
  definitions: TicketCustomFieldDefinition[],
  values: Record<string, StoredTicketCustomFieldValue>,
): Record<string, DraftValue> {
  return Object.fromEntries(
    definitions
      .filter((definition) => definition.active)
      .map((definition) => {
        const value = values[definition.id];
        switch (definition.fieldType) {
          case "text":
            return [definition.id, value?.textValue ?? ""];
          case "number":
            return [
              definition.id,
              value?.numberValue === undefined || value.numberValue === null
                ? ""
                : String(value.numberValue),
            ];
          case "date":
            return [definition.id, value?.dateValue ?? ""];
          case "select":
            return [definition.id, value?.selectValue ?? ""];
          case "checkbox":
            return [definition.id, value?.booleanValue ?? false];
        }
      }),
  );
}

function valueForSubmission(
  definition: TicketCustomFieldDefinition,
  draftValue: DraftValue | undefined,
): FieldValue {
  if (definition.fieldType === "checkbox") {
    return draftValue === true;
  }

  const value = typeof draftValue === "string" ? draftValue.trim() : "";
  if (!value) return null;

  if (definition.fieldType === "number") {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : null;
  }

  return value;
}

function updatedStoredValues(
  previousValues: Record<string, StoredTicketCustomFieldValue>,
  definitions: TicketCustomFieldDefinition[],
  values: Array<{ definitionId: string; value: FieldValue }>,
): Record<string, StoredTicketCustomFieldValue> {
  const definitionsById = new Map(
    definitions.map((definition) => [definition.id, definition]),
  );
  const nextValues = { ...previousValues };

  for (const entry of values) {
    const definition = definitionsById.get(entry.definitionId);
    if (!definition) continue;
    if (entry.value === null) {
      delete nextValues[entry.definitionId];
      continue;
    }

    nextValues[entry.definitionId] = {
      definitionId: entry.definitionId,
      textValue:
        definition.fieldType === "text" ? (entry.value as string) : null,
      numberValue:
        definition.fieldType === "number" ? (entry.value as number) : null,
      dateValue:
        definition.fieldType === "date" ? (entry.value as string) : null,
      booleanValue:
        definition.fieldType === "checkbox" ? (entry.value as boolean) : null,
      selectValue:
        definition.fieldType === "select" ? (entry.value as string) : null,
    };
  }

  return nextValues;
}

function formatValue(
  definition: TicketCustomFieldDefinition,
  value: StoredTicketCustomFieldValue | undefined,
): string {
  if (!value) return "Nicht angegeben";

  switch (definition.fieldType) {
    case "text":
      return value.textValue ?? "Nicht angegeben";
    case "number":
      return value.numberValue === null
        ? "Nicht angegeben"
        : new Intl.NumberFormat("de-CH").format(value.numberValue);
    case "date": {
      if (value.dateValue === null) return "Nicht angegeben";
      const [year = Number.NaN, month = Number.NaN, day = Number.NaN] =
        value.dateValue.split("-").map(Number);
      return new Intl.DateTimeFormat("de-CH", {
        dateStyle: "medium",
        timeZone: "UTC",
      }).format(new Date(Date.UTC(year, month - 1, day)));
    }
    case "select":
      return value.selectValue ?? "Nicht angegeben";
    case "checkbox":
      if (value.booleanValue === null) return "Nicht angegeben";
      return value.booleanValue ? "Ja" : "Nein";
  }
}

function isSetValuesResponse(value: unknown): boolean {
  const envelope = asRecord(value);
  return Boolean(
    envelope &&
    hasExactlyKeys(envelope, ["data"]) &&
    typeof envelope.data === "number" &&
    Number.isSafeInteger(envelope.data) &&
    envelope.data >= 0,
  );
}

async function invokeTicketCustomFields(action: Record<string, unknown>) {
  if (!supabase) throw new Error("Supabase is not configured");

  const { data, error } = await supabase.functions.invoke(
    "ticket-custom-fields",
    {
      body: action,
    },
  );
  if (error) throw error;
  return data;
}

export function TicketCustomFields({
  tenantId,
  ticketId,
  canUpdate,
}: TicketCustomFieldsProps) {
  const [definitions, setDefinitions] = useState<TicketCustomFieldDefinition[]>(
    [],
  );
  const [storedValues, setStoredValues] = useState<
    Record<string, StoredTicketCustomFieldValue>
  >({});
  const [draft, setDraft] = useState<Record<string, DraftValue>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadCustomFields() {
      setLoading(true);
      setErrorMessage(null);
      setStatusMessage(null);
      setDefinitions([]);
      setStoredValues({});
      setDraft({});

      try {
        const [definitionsResponse, valuesResponse] = await Promise.all([
          invokeTicketCustomFields({ type: "listDefinitions", tenantId }),
          invokeTicketCustomFields({ type: "listValues", tenantId, ticketId }),
        ]);
        const parsedDefinitions = parseDefinitions(definitionsResponse);
        if (!parsedDefinitions) {
          if (!cancelled) setErrorMessage(LOAD_ERROR);
          return;
        }

        const parsedValues = parseStoredValues(
          valuesResponse,
          parsedDefinitions,
        );
        if (!parsedValues) {
          if (!cancelled) setErrorMessage(LOAD_ERROR);
          return;
        }

        if (cancelled) return;
        setDefinitions(parsedDefinitions);
        setStoredValues(parsedValues);
        setDraft(initialDraft(parsedDefinitions, parsedValues));
      } catch (error) {
        const message = await functionErrorMessage(error, LOAD_ERROR);
        if (!cancelled) setErrorMessage(message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadCustomFields();
    return () => {
      cancelled = true;
    };
  }, [tenantId, ticketId]);

  const activeDefinitions = definitions.filter(
    (definition) => definition.active,
  );

  async function saveCustomFields(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    const values = activeDefinitions.map((definition) => ({
      definitionId: definition.id,
      value: valueForSubmission(definition, draft[definition.id]),
    }));
    const missingRequiredDefinition = activeDefinitions.find(
      (definition) =>
        definition.required &&
        valueForSubmission(definition, draft[definition.id]) === null,
    );
    if (missingRequiredDefinition) {
      setStatusMessage(null);
      setErrorMessage(
        `Bitte füllen Sie das Pflichtfeld „${missingRequiredDefinition.label}“ aus.`,
      );
      return;
    }

    setSaving(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const response = await invokeTicketCustomFields({
        type: "setValues",
        tenantId,
        ticketId,
        values,
      });
      if (!isSetValuesResponse(response)) {
        setErrorMessage(SAVE_ERROR);
        return;
      }

      setStoredValues((previousValues) =>
        updatedStoredValues(previousValues, activeDefinitions, values),
      );
      setStatusMessage("Die Ticket-Zusatzfelder wurden gespeichert.");
    } catch (error) {
      setErrorMessage(await functionErrorMessage(error, SAVE_ERROR));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <p className="data-caption" role="status">
        Ticket-Zusatzfelder werden geladen …
      </p>
    );
  }

  if (errorMessage && definitions.length === 0) {
    return (
      <p className="ticket-detail-message error" role="alert">
        {errorMessage}
      </p>
    );
  }

  if (activeDefinitions.length === 0) return null;

  return (
    <section
      aria-labelledby="ticket-custom-fields-heading"
      className="ticket-custom-fields ticket-detail-primary"
    >
      <div className="ticket-detail-section-heading">
        <div>
          <p className="eyebrow">ZUSATZFELDER</p>
          <h3 id="ticket-custom-fields-heading">Ticket-Zusatzfelder</h3>
        </div>
      </div>

      {canUpdate ? (
        <form
          aria-busy={saving}
          className="ticket-custom-fields__form"
          onSubmit={saveCustomFields}
        >
          {activeDefinitions.map((definition) => {
            const inputId = `ticket-custom-field-${definition.id}`;
            const value = draft[definition.id];
            const label = (
              <>
                {definition.label}
                {definition.required && <span aria-hidden="true"> *</span>}
              </>
            );

            if (definition.fieldType === "checkbox") {
              return (
                <label key={definition.id} htmlFor={inputId}>
                  <input
                    checked={value === true}
                    disabled={saving}
                    id={inputId}
                    onChange={(event) =>
                      setDraft((currentDraft) => ({
                        ...currentDraft,
                        [definition.id]: event.target.checked,
                      }))
                    }
                    required={definition.required}
                    type="checkbox"
                  />{" "}
                  {label}
                </label>
              );
            }

            return (
              <label
                className="ticket-comment-body"
                htmlFor={inputId}
                key={definition.id}
              >
                {label}
                {definition.fieldType === "select" ? (
                  <select
                    disabled={saving}
                    id={inputId}
                    onChange={(event) =>
                      setDraft((currentDraft) => ({
                        ...currentDraft,
                        [definition.id]: event.target.value,
                      }))
                    }
                    required={definition.required}
                    value={typeof value === "string" ? value : ""}
                  >
                    <option value="">Bitte auswählen</option>
                    {definition.options.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    disabled={saving}
                    id={inputId}
                    maxLength={
                      definition.fieldType === "text" ? 2_000 : undefined
                    }
                    onChange={(event) =>
                      setDraft((currentDraft) => ({
                        ...currentDraft,
                        [definition.id]: event.target.value,
                      }))
                    }
                    required={definition.required}
                    type={definition.fieldType}
                    value={typeof value === "string" ? value : ""}
                  />
                )}
              </label>
            );
          })}

          {errorMessage && (
            <p className="ticket-detail-message error" role="alert">
              {errorMessage}
            </p>
          )}
          {statusMessage && (
            <p className="data-caption" role="status">
              {statusMessage}
            </p>
          )}
          <div className="ticket-detail-actions">
            <button className="primary-button" disabled={saving} type="submit">
              {saving
                ? "Zusatzfelder werden gespeichert …"
                : "Zusatzfelder speichern"}
            </button>
          </div>
        </form>
      ) : (
        <dl className="ticket-custom-fields__summary">
          {activeDefinitions.map((definition) => (
            <div key={definition.id}>
              <dt>{definition.label}</dt>
              <dd>{formatValue(definition, storedValues[definition.id])}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
