import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Settings2, Trash2 } from "lucide-react";
import { functionErrorMessage } from "./lib/function-error";
import { supabase } from "./lib/supabase";

type FieldType = "text" | "number" | "date" | "select" | "checkbox";

type FieldDefinition = {
  id: string;
  fieldKey: string;
  label: string;
  fieldType: FieldType;
  required: boolean;
  active: boolean;
  options: string[];
};

type Props = { tenantId: string };

type Draft = {
  fieldKey: string;
  label: string;
  fieldType: FieldType;
  required: boolean;
  options: string;
};

const EMPTY_DRAFT: Draft = {
  fieldKey: "",
  label: "",
  fieldType: "text",
  required: false,
  options: "",
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(value: unknown, min: number, max: number): value is string {
  return (
    typeof value === "string" &&
    value === value.trim() &&
    Array.from(value).length >= min &&
    Array.from(value).length <= max &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

function parseDefinitions(value: unknown): FieldDefinition[] | null {
  if (!isRecord(value) || !Array.isArray(value.data)) return null;
  const definitions: FieldDefinition[] = [];
  for (const entry of value.data) {
    if (!isRecord(entry)) return null;
    const keys = Object.keys(entry);
    if (
      keys.length !== 7 ||
      ![
        "id",
        "fieldKey",
        "label",
        "fieldType",
        "required",
        "active",
        "options",
      ].every((key) => keys.includes(key)) ||
      typeof entry.id !== "string" ||
      !UUID.test(entry.id) ||
      !isText(entry.fieldKey, 2, 63) ||
      !isText(entry.label, 2, 120) ||
      typeof entry.fieldType !== "string" ||
      !FIELD_TYPES.has(entry.fieldType as FieldType) ||
      typeof entry.required !== "boolean" ||
      typeof entry.active !== "boolean" ||
      !Array.isArray(entry.options) ||
      entry.options.length > 50 ||
      !entry.options.every((option) => isText(option, 1, 100))
    ) {
      return null;
    }
    definitions.push({
      id: entry.id,
      fieldKey: entry.fieldKey,
      label: entry.label,
      fieldType: entry.fieldType as FieldType,
      required: entry.required,
      active: entry.active,
      options: entry.options,
    });
  }
  return definitions;
}

function fieldTypeLabel(fieldType: FieldType): string {
  return {
    text: "Text",
    number: "Zahl",
    date: "Datum",
    select: "Auswahl",
    checkbox: "Ja / Nein",
  }[fieldType];
}

function optionsFromDraft(value: string): string[] | null {
  const options = value
    .split(/\n|,/u)
    .map((item) => item.trim())
    .filter(Boolean);
  if (
    options.length === 0 ||
    options.length > 50 ||
    options.some((option) => !isText(option, 1, 100)) ||
    new Set(options.map((option) => option.toLocaleLowerCase("de-CH"))).size !==
      options.length
  ) {
    return null;
  }
  return options;
}

async function request(action: Record<string, unknown>): Promise<unknown> {
  if (!supabase) throw new Error("Supabase ist nicht konfiguriert.");
  const { data, error } = await supabase.functions.invoke(
    "ticket-custom-fields",
    {
      body: action,
    },
  );
  if (error) throw error;
  return data;
}

export function TicketCustomFieldsAdmin({ tenantId }: Props) {
  const [definitions, setDefinitions] = useState<FieldDefinition[]>([]);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const loadDefinitions = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await request({ type: "listDefinitions", tenantId });
      const parsed = parseDefinitions(response);
      if (!parsed) throw new Error("Ungültige Antwort");
      setDefinitions(parsed);
    } catch (requestError) {
      setError(
        await functionErrorMessage(
          requestError,
          "Die Ticket-Zusatzfelder konnten nicht geladen werden.",
        ),
      );
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void loadDefinitions();
  }, [loadDefinitions]);

  function beginCreate() {
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
    setError("");
  }

  function beginEdit(definition: FieldDefinition) {
    setEditingId(definition.id);
    setDraft({
      fieldKey: definition.fieldKey,
      label: definition.label,
      fieldType: definition.fieldType,
      required: definition.required,
      options: definition.options.join("\n"),
    });
    setMessage("");
    setError("");
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    const options =
      draft.fieldType === "select" ? optionsFromDraft(draft.options) : [];
    if (options === null) {
      setError(
        "Für ein Auswahlfeld benötigen Sie mindestens eine eindeutige Option pro Zeile.",
      );
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");
    try {
      await request({
        type: "upsertDefinition",
        tenantId,
        definitionId: editingId,
        fieldKey: draft.fieldKey.trim().toLocaleLowerCase("de-CH"),
        label: draft.label.trim(),
        fieldType: draft.fieldType,
        required: draft.required,
        options,
      });
      const successMessage = editingId
        ? "Zusatzfeld aktualisiert."
        : "Zusatzfeld angelegt.";
      beginCreate();
      setMessage(successMessage);
      await loadDefinitions();
    } catch (requestError) {
      setError(
        await functionErrorMessage(
          requestError,
          "Das Zusatzfeld konnte nicht gespeichert werden.",
        ),
      );
    } finally {
      setSaving(false);
    }
  }

  async function retire(definition: FieldDefinition) {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await request({
        type: "retireDefinition",
        tenantId,
        definitionId: definition.id,
      });
      if (editingId === definition.id) beginCreate();
      setMessage(`„${definition.label}“ wurde stillgelegt.`);
      await loadDefinitions();
    } catch (requestError) {
      setError(
        await functionErrorMessage(
          requestError,
          "Das Zusatzfeld konnte nicht stillgelegt werden.",
        ),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      className="tenant-admin-settings__section ticket-custom-fields-admin"
      aria-labelledby="ticket-custom-fields-admin-heading"
    >
      <div className="tenant-admin-settings__section-heading">
        <div>
          <h2 id="ticket-custom-fields-admin-heading">Ticket-Zusatzfelder</h2>
          <p>
            Definieren Sie mandantenweit zusätzliche Angaben, etwa Gerätenummer,
            Standort oder einen Auswahlwert. Diese Felder stehen danach in jedem
            Ticket zur Verfügung.
          </p>
        </div>
        <Settings2 aria-hidden="true" size={22} />
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="success" role="status">
          {message}
        </p>
      )}

      <div className="ticket-custom-fields-admin__layout">
        <div>
          <h3>Aktive Felder</h3>
          {loading ? (
            <p className="tenant-admin-settings__hint" role="status">
              Zusatzfelder werden geladen …
            </p>
          ) : definitions.filter((definition) => definition.active).length ===
            0 ? (
            <p className="tenant-admin-settings__hint">
              Noch keine Zusatzfelder definiert.
            </p>
          ) : (
            <ul className="ticket-custom-fields-admin__list">
              {definitions
                .filter((definition) => definition.active)
                .map((definition) => (
                  <li key={definition.id}>
                    <button
                      className="ticket-custom-fields-admin__definition"
                      disabled={saving}
                      onClick={() => beginEdit(definition)}
                      type="button"
                    >
                      <span>{definition.label}</span>
                      <small>
                        {fieldTypeLabel(definition.fieldType)}
                        {definition.required ? " · Pflichtfeld" : " · optional"}
                      </small>
                    </button>
                    <button
                      aria-label={`Zusatzfeld ${definition.label} stilllegen`}
                      className="icon-button"
                      disabled={saving}
                      onClick={() => void retire(definition)}
                      title="Stilllegen"
                      type="button"
                    >
                      <Trash2 aria-hidden="true" size={17} />
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </div>

        <form className="ticket-custom-fields-admin__form" onSubmit={save}>
          <div className="tenant-admin-settings__section-heading">
            <div>
              <h3>
                {editingId ? "Zusatzfeld bearbeiten" : "Zusatzfeld anlegen"}
              </h3>
              {editingId && (
                <p>
                  Typ und technischer Schlüssel bleiben nach dem Anlegen
                  unverändert.
                </p>
              )}
            </div>
            {editingId && (
              <button
                className="text-button"
                onClick={beginCreate}
                type="button"
              >
                Neues Feld
              </button>
            )}
          </div>
          <label>
            Bezeichnung
            <input
              disabled={saving}
              maxLength={120}
              minLength={2}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  label: event.target.value,
                }))
              }
              required
              value={draft.label}
            />
          </label>
          <label>
            Technischer Schlüssel
            <input
              disabled={saving || Boolean(editingId)}
              maxLength={63}
              minLength={2}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  fieldKey: event.target.value
                    .replace(/[^a-zA-Z0-9_]/gu, "_")
                    .toLowerCase(),
                }))
              }
              pattern="[a-z][a-z0-9_]{1,62}"
              placeholder="z. B. geraetenummer"
              required
              value={draft.fieldKey}
            />
            <span className="tenant-admin-settings__hint">
              Wird nur intern verwendet und kann danach nicht mehr geändert
              werden.
            </span>
          </label>
          <label>
            Feldtyp
            <select
              disabled={saving || Boolean(editingId)}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  fieldType: event.target.value as FieldType,
                  options:
                    event.target.value === "select" ? current.options : "",
                }))
              }
              value={draft.fieldType}
            >
              <option value="text">Text</option>
              <option value="number">Zahl</option>
              <option value="date">Datum</option>
              <option value="select">Auswahl</option>
              <option value="checkbox">Ja / Nein</option>
            </select>
          </label>
          {draft.fieldType === "select" && (
            <label>
              Auswahloptionen
              <textarea
                disabled={saving}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    options: event.target.value,
                  }))
                }
                placeholder={"Kritisch\nHoch\nNormal"}
                required
                value={draft.options}
              />
              <span className="tenant-admin-settings__hint">
                Eine Option pro Zeile.
              </span>
            </label>
          )}
          <label className="tenant-admin-settings__checkbox">
            <input
              checked={draft.required}
              disabled={saving}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  required: event.target.checked,
                }))
              }
              type="checkbox"
            />
            Als Pflichtfeld führen
          </label>
          <div className="tenant-admin-settings__form-actions">
            <button className="primary-button" disabled={saving} type="submit">
              {saving
                ? "Wird gespeichert …"
                : editingId
                  ? "Zusatzfeld speichern"
                  : "Zusatzfeld anlegen"}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}
