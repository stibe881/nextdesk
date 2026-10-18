import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type DragEvent,
  type FormEvent,
} from "react";
import {
  ArrowDown,
  ArrowUp,
  Eye,
  GripVertical,
  Pencil,
  Plus,
  Settings2,
  Trash2,
} from "lucide-react";
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
  sectionId: string;
  position: number;
};

type FormSection = {
  id: string;
  label: string;
  position: number;
};

type FormLayout = {
  version: number;
  sections: FormSection[];
  definitions: FieldDefinition[];
};

type Props = { tenantId: string };

type Draft = {
  fieldKey: string;
  label: string;
  fieldType: FieldType;
  required: boolean;
  options: string;
  sectionId: string;
};

const EMPTY_DRAFT: Draft = {
  fieldKey: "",
  label: "",
  fieldType: "text",
  required: false,
  options: "",
  sectionId: "",
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

function isText(
  value: unknown,
  minimum: number,
  maximum: number,
): value is string {
  return (
    typeof value === "string" &&
    value === value.trim() &&
    Array.from(value).length >= minimum &&
    Array.from(value).length <= maximum &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

function isPosition(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function parseLayout(value: unknown): FormLayout | null {
  if (!isRecord(value) || !isRecord(value.data)) return null;
  const data = value.data;
  if (
    Object.keys(data).length !== 3 ||
    !["version", "sections", "definitions"].every((key) => key in data) ||
    typeof data.version !== "number" ||
    !Number.isSafeInteger(data.version) ||
    data.version < 1 ||
    !Array.isArray(data.sections) ||
    !Array.isArray(data.definitions)
  ) {
    return null;
  }

  const sections: FormSection[] = [];
  for (const entry of data.sections) {
    if (
      !isRecord(entry) ||
      Object.keys(entry).length !== 3 ||
      !["id", "label", "position"].every((key) => key in entry) ||
      !isText(entry.id, 36, 36) ||
      !UUID.test(entry.id) ||
      !isText(entry.label, 2, 120) ||
      !isPosition(entry.position)
    ) {
      return null;
    }
    sections.push({
      id: entry.id,
      label: entry.label,
      position: entry.position,
    });
  }

  const definitions: FieldDefinition[] = [];
  for (const entry of data.definitions) {
    if (
      !isRecord(entry) ||
      Object.keys(entry).length !== 9 ||
      ![
        "id",
        "fieldKey",
        "label",
        "fieldType",
        "required",
        "active",
        "options",
        "sectionId",
        "position",
      ].every((key) => key in entry) ||
      !isText(entry.id, 36, 36) ||
      !UUID.test(entry.id) ||
      !isText(entry.fieldKey, 2, 63) ||
      !/^[a-z][a-z0-9_]{1,62}$/u.test(entry.fieldKey) ||
      !isText(entry.label, 2, 120) ||
      typeof entry.fieldType !== "string" ||
      !FIELD_TYPES.has(entry.fieldType as FieldType) ||
      typeof entry.required !== "boolean" ||
      typeof entry.active !== "boolean" ||
      !Array.isArray(entry.options) ||
      entry.options.length > 50 ||
      !entry.options.every((option) => isText(option, 1, 100)) ||
      !isText(entry.sectionId, 36, 36) ||
      !UUID.test(entry.sectionId) ||
      !isPosition(entry.position)
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
      sectionId: entry.sectionId,
      position: entry.position,
    });
  }

  const sectionIds = new Set(sections.map((section) => section.id));
  if (
    sectionIds.size !== sections.length ||
    definitions.some((definition) => !sectionIds.has(definition.sectionId))
  ) {
    return null;
  }

  return {
    version: data.version,
    sections: sections.sort((left, right) => left.position - right.position),
    definitions: definitions.sort(
      (left, right) => left.position - right.position,
    ),
  };
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
    { body: action },
  );
  if (error) throw error;
  return data;
}

function FieldPreview({ definition }: { definition: FieldDefinition }) {
  const label = (
    <span>
      {definition.label}
      {definition.required && <strong aria-hidden="true"> *</strong>}
    </span>
  );
  if (definition.fieldType === "checkbox") {
    return (
      <label className="ticket-form-builder__preview-checkbox">
        <input disabled type="checkbox" /> {label}
      </label>
    );
  }
  return (
    <label>
      {label}
      {definition.fieldType === "select" ? (
        <select disabled defaultValue="">
          <option value="">Bitte auswählen</option>
          {definition.options.map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
      ) : (
        <input
          disabled
          placeholder={fieldTypeLabel(definition.fieldType)}
          type={definition.fieldType}
        />
      )}
    </label>
  );
}

export function TicketCustomFieldsAdmin({ tenantId }: Props) {
  const [layout, setLayout] = useState<FormLayout | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [sectionLabel, setSectionLabel] = useState("");
  const [draggedDefinitionId, setDraggedDefinitionId] = useState<string | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const activeDefinitions = useMemo(
    () => layout?.definitions.filter((definition) => definition.active) ?? [],
    [layout],
  );

  const loadLayout = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const parsed = parseLayout(
        await request({ type: "getLayout", tenantId }),
      );
      if (!parsed) throw new Error("Ungültige Layoutantwort");
      setLayout(parsed);
      setDraft((current) => ({
        ...current,
        sectionId: current.sectionId || parsed.sections[0]?.id || "",
      }));
    } catch (requestError) {
      setError(
        await functionErrorMessage(
          requestError,
          "Der Ticketformular-Editor konnte nicht geladen werden.",
        ),
      );
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void loadLayout();
  }, [loadLayout]);

  function beginCreate() {
    setEditingId(null);
    setDraft((current) => ({
      ...EMPTY_DRAFT,
      sectionId: current.sectionId || layout?.sections[0]?.id || "",
    }));
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
      sectionId: definition.sectionId,
    });
    setMessage("");
    setError("");
  }

  async function saveSection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!layout) return;
    const label = sectionLabel.trim();
    if (label.length < 2) {
      setError(
        "Ein Abschnitt benötigt eine Bezeichnung mit mindestens zwei Zeichen.",
      );
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await request({
        type: "saveSection",
        tenantId,
        sectionId: null,
        label,
        expectedVersion: layout.version,
      });
      setSectionLabel("");
      setMessage(`Abschnitt „${label}“ wurde angelegt.`);
      await loadLayout();
    } catch (requestError) {
      setError(
        await functionErrorMessage(
          requestError,
          "Der Abschnitt konnte nicht gespeichert werden.",
        ),
      );
    } finally {
      setSaving(false);
    }
  }

  async function saveField(event: FormEvent<HTMLFormElement>) {
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
    if (!draft.sectionId) {
      setError("Wählen Sie zuerst einen Abschnitt aus.");
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");
    try {
      const result = await request({
        type: "upsertDefinition",
        tenantId,
        definitionId: editingId,
        fieldKey: draft.fieldKey.trim().toLocaleLowerCase("de-CH"),
        label: draft.label.trim(),
        fieldType: draft.fieldType,
        required: draft.required,
        options,
      });
      const createdId =
        isRecord(result) &&
        isRecord(result.data) &&
        typeof result.data.id === "string"
          ? result.data.id
          : null;
      await loadLayout();
      const nextLayout = parseLayout(
        await request({ type: "getLayout", tenantId }),
      );
      if (
        nextLayout &&
        draft.sectionId !== nextLayout.sections[0]?.id &&
        (editingId ?? createdId)
      ) {
        await request({
          type: "moveDefinition",
          tenantId,
          definitionId: editingId ?? createdId,
          sectionId: draft.sectionId,
          position: nextLayout.definitions.filter(
            (definition) => definition.sectionId === draft.sectionId,
          ).length,
          expectedVersion: nextLayout.version,
        });
      }
      beginCreate();
      setMessage(
        editingId ? "Feld aktualisiert." : "Feld zum Formular hinzugefügt.",
      );
      await loadLayout();
    } catch (requestError) {
      setError(
        await functionErrorMessage(
          requestError,
          "Das Formularfeld konnte nicht gespeichert werden.",
        ),
      );
    } finally {
      setSaving(false);
    }
  }

  async function retire(definition: FieldDefinition) {
    if (
      !window.confirm(
        `„${definition.label}“ aus neuen Formularen entfernen? Bereits gespeicherte Ticketwerte bleiben erhalten.`,
      )
    ) {
      return;
    }
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
      setMessage(`„${definition.label}“ wurde aus neuen Formularen entfernt.`);
      await loadLayout();
    } catch (requestError) {
      setError(
        await functionErrorMessage(
          requestError,
          "Das Formularfeld konnte nicht entfernt werden.",
        ),
      );
    } finally {
      setSaving(false);
    }
  }

  async function moveDefinition(
    definition: FieldDefinition,
    sectionId: string,
    position: number,
  ) {
    if (!layout || saving) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await request({
        type: "moveDefinition",
        tenantId,
        definitionId: definition.id,
        sectionId,
        position,
        expectedVersion: layout.version,
      });
      setMessage(`„${definition.label}“ wurde im Formular verschoben.`);
      await loadLayout();
    } catch (requestError) {
      setError(
        await functionErrorMessage(
          requestError,
          "Die Reihenfolge konnte nicht gespeichert werden. Bitte laden Sie den Editor neu.",
        ),
      );
      await loadLayout();
    } finally {
      setSaving(false);
      setDraggedDefinitionId(null);
    }
  }

  function handleDrop(
    event: DragEvent<HTMLElement>,
    sectionId: string,
    position: number,
  ) {
    event.preventDefault();
    const definitionId =
      event.dataTransfer.getData("application/x-nextdesk-field") ||
      draggedDefinitionId;
    const definition = layout?.definitions.find(
      (candidate) => candidate.id === definitionId,
    );
    if (definition) void moveDefinition(definition, sectionId, position);
  }

  return (
    <section
      aria-labelledby="ticket-custom-fields-admin-heading"
      className="tenant-admin-settings__section ticket-custom-fields-admin"
    >
      <div className="tenant-admin-settings__section-heading">
        <div>
          <p className="eyebrow">FORMULAR-EDITOR</p>
          <h2 id="ticket-custom-fields-admin-heading">
            Ticketformular gestalten
          </h2>
          <p>
            Ordnen Sie zusätzliche Felder per Drag-and-Drop oder mit den
            Pfeiltasten in Abschnitten an. Die Vorschau zeigt das Formular, wie
            es später im Ticket erscheint.
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

      <div className="ticket-form-builder__toolbar">
        <form
          className="ticket-form-builder__section-form"
          onSubmit={saveSection}
        >
          <label>
            Neuer Abschnitt
            <input
              disabled={saving}
              maxLength={120}
              minLength={2}
              onChange={(event) => setSectionLabel(event.target.value)}
              placeholder="z. B. Gerätedaten"
              required
              value={sectionLabel}
            />
          </label>
          <button
            className="secondary-button"
            disabled={saving || loading}
            type="submit"
          >
            <Plus aria-hidden="true" size={17} /> Abschnitt hinzufügen
          </button>
        </form>
        <p className="tenant-admin-settings__hint">
          {layout ? `Layoutversion ${layout.version}` : "Layout wird geladen …"}
        </p>
      </div>

      {loading ? (
        <p className="tenant-admin-settings__hint" role="status">
          Formular-Editor wird geladen …
        </p>
      ) : (
        <div className="ticket-form-builder__layout">
          <div
            className="ticket-form-builder__canvas"
            aria-label="Formularstruktur"
          >
            <div className="ticket-form-builder__canvas-heading">
              <div>
                <h3>Formularstruktur</h3>
                <p>Felder können zwischen Abschnitten verschoben werden.</p>
              </div>
              <button
                className="text-button"
                onClick={beginCreate}
                type="button"
              >
                <Plus aria-hidden="true" size={16} /> Feld hinzufügen
              </button>
            </div>

            {layout?.sections.map((section) => {
              const fields = activeDefinitions.filter(
                (definition) => definition.sectionId === section.id,
              );
              return (
                <section
                  className="ticket-form-builder__section"
                  key={section.id}
                >
                  <header>
                    <div>
                      <p className="eyebrow">ABSCHNITT</p>
                      <h4>{section.label}</h4>
                    </div>
                    <span>{fields.length} Felder</span>
                  </header>
                  <ol>
                    {fields.map((definition, index) => (
                      <li
                        className={
                          draggedDefinitionId === definition.id
                            ? "ticket-form-builder__field ticket-form-builder__field--dragging"
                            : "ticket-form-builder__field"
                        }
                        draggable={!saving}
                        key={definition.id}
                        onDragEnd={() => setDraggedDefinitionId(null)}
                        onDragOver={(event) => event.preventDefault()}
                        onDragStart={(event) => {
                          setDraggedDefinitionId(definition.id);
                          event.dataTransfer.effectAllowed = "move";
                          event.dataTransfer.setData(
                            "application/x-nextdesk-field",
                            definition.id,
                          );
                        }}
                        onDrop={(event) => handleDrop(event, section.id, index)}
                      >
                        <button
                          aria-label={`${definition.label} bearbeiten`}
                          className="ticket-form-builder__field-main"
                          disabled={saving}
                          onClick={() => beginEdit(definition)}
                          type="button"
                        >
                          <GripVertical aria-hidden="true" size={18} />
                          <span>
                            <strong>{definition.label}</strong>
                            <small>
                              {fieldTypeLabel(definition.fieldType)} ·{" "}
                              {definition.required ? "Pflichtfeld" : "optional"}
                            </small>
                          </span>
                        </button>
                        <div className="ticket-form-builder__field-actions">
                          <button
                            aria-label={`${definition.label} nach oben verschieben`}
                            className="icon-button"
                            disabled={
                              saving || (index === 0 && fields.length === 1)
                            }
                            onClick={() =>
                              void moveDefinition(
                                definition,
                                section.id,
                                Math.max(0, index - 1),
                              )
                            }
                            type="button"
                          >
                            <ArrowUp aria-hidden="true" size={16} />
                          </button>
                          <button
                            aria-label={`${definition.label} nach unten verschieben`}
                            className="icon-button"
                            disabled={saving || index === fields.length - 1}
                            onClick={() =>
                              void moveDefinition(
                                definition,
                                section.id,
                                index + 1,
                              )
                            }
                            type="button"
                          >
                            <ArrowDown aria-hidden="true" size={16} />
                          </button>
                          <button
                            aria-label={`${definition.label} aus dem Formular entfernen`}
                            className="icon-button"
                            disabled={saving}
                            onClick={() => void retire(definition)}
                            type="button"
                          >
                            <Trash2 aria-hidden="true" size={16} />
                          </button>
                        </div>
                      </li>
                    ))}
                    <li
                      className="ticket-form-builder__dropzone"
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) =>
                        handleDrop(event, section.id, fields.length)
                      }
                    >
                      Feld hier ablegen
                    </li>
                  </ol>
                </section>
              );
            })}
          </div>

          <aside
            className="ticket-form-builder__preview"
            aria-labelledby="ticket-form-builder-preview-heading"
          >
            <div className="ticket-form-builder__preview-heading">
              <Eye aria-hidden="true" size={18} />
              <div>
                <p className="eyebrow">VORSCHAU</p>
                <h3 id="ticket-form-builder-preview-heading">Ticketformular</h3>
              </div>
            </div>
            {layout?.sections.map((section) => {
              const fields = activeDefinitions.filter(
                (definition) => definition.sectionId === section.id,
              );
              if (fields.length === 0) return null;
              return (
                <section
                  className="ticket-form-builder__preview-section"
                  key={section.id}
                >
                  <h4>{section.label}</h4>
                  <div>
                    {fields.map((definition) => (
                      <FieldPreview
                        definition={definition}
                        key={definition.id}
                      />
                    ))}
                  </div>
                </section>
              );
            })}
            {activeDefinitions.length === 0 && (
              <p className="tenant-admin-settings__hint">
                Fügen Sie ein erstes Feld hinzu, um die Vorschau zu sehen.
              </p>
            )}
          </aside>

          <form
            className="ticket-form-builder__field-editor"
            onSubmit={saveField}
          >
            <div className="tenant-admin-settings__section-heading">
              <div>
                <p className="eyebrow">FELD</p>
                <h3>{editingId ? "Feld bearbeiten" : "Feld hinzufügen"}</h3>
                {editingId && (
                  <p>
                    Typ und technischer Schlüssel bleiben nach dem Anlegen
                    unveränderlich.
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
              Abschnitt
              <select
                disabled={saving || Boolean(editingId)}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    sectionId: event.target.value,
                  }))
                }
                required
                value={draft.sectionId}
              >
                <option value="">Abschnitt auswählen</option>
                {layout?.sections.map((section) => (
                  <option key={section.id} value={section.id}>
                    {section.label}
                  </option>
                ))}
              </select>
            </label>
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
              <button
                className="primary-button"
                disabled={saving}
                type="submit"
              >
                {saving
                  ? "Wird gespeichert …"
                  : editingId
                    ? "Feld speichern"
                    : "Zum Formular hinzufügen"}
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
