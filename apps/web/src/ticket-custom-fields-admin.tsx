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
  Plus,
  Settings2,
  Trash2,
} from "lucide-react";
import { functionErrorMessage } from "./lib/function-error";
import {
  createTicketFieldPresetDraft,
  ticketFieldPresetsByCategory,
  type TicketCustomFieldType,
  type TicketFieldPreset,
  type TicketFieldPresetCategory,
} from "./lib/ticket-form-builder-presets";
import { STANDARD_TICKET_FORM_PREVIEW_SECTIONS } from "./lib/ticket-form-preview";
import { supabase } from "./lib/supabase";
import {
  resolveTicketFieldDropPosition,
  ticketFieldDropInsertionIndex,
} from "./lib/ticket-form-builder-dnd";

type FieldType = TicketCustomFieldType;

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
const PALETTE_CATEGORIES: readonly TicketFieldPresetCategory[] = [
  "Feldtypen",
  "Ticketvorlagen",
];

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

type PreviewField = {
  contextual?: boolean;
  fieldType: FieldType | "textarea";
  label: string;
  optional?: boolean;
  options?: readonly string[];
  placeholder?: string;
  required?: boolean;
};

function FieldPreview({ definition }: { definition: PreviewField }) {
  const qualifiers = [
    definition.optional ? "optional" : null,
    definition.contextual ? "situationsabhängig" : null,
  ].filter((qualifier): qualifier is string => qualifier !== null);
  const label = (
    <span>
      {definition.label}
      {definition.required && (
        <>
          <strong aria-hidden="true"> *</strong>
          <span className="sr-only"> (Pflichtfeld)</span>
        </>
      )}
      {qualifiers.length > 0 && <small> {qualifiers.join(" · ")}</small>}
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
      {definition.fieldType === "textarea" ? (
        <textarea disabled placeholder={definition.placeholder} rows={4} />
      ) : definition.fieldType === "select" ? (
        <select disabled defaultValue="">
          <option value="">
            {definition.placeholder ?? "Bitte auswählen"}
          </option>
          {(definition.options ?? []).map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
      ) : (
        <input
          disabled
          placeholder={
            definition.placeholder ?? fieldTypeLabel(definition.fieldType)
          }
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
  const [draggedPresetId, setDraggedPresetId] = useState<string | null>(null);
  const [activeDropTarget, setActiveDropTarget] = useState<string | null>(null);
  const [sectionComposerOpen, setSectionComposerOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const activeDefinitions = useMemo(
    () => layout?.definitions.filter((definition) => definition.active) ?? [],
    [layout],
  );
  const existingFieldKeys = useMemo(
    () => layout?.definitions.map((definition) => definition.fieldKey) ?? [],
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
    setInspectorOpen(true);
    setEditingId(null);
    setDraft((current) => ({
      ...EMPTY_DRAFT,
      sectionId: current.sectionId || layout?.sections[0]?.id || "",
    }));
    setError("");
  }

  function beginEdit(definition: FieldDefinition) {
    setInspectorOpen(true);
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
      setSectionComposerOpen(false);
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
    if (!layout) {
      setError("Das Formularlayout wird noch geladen.");
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

    const layoutBeforeSave = layout;
    const fieldKey = draft.fieldKey.trim().toLocaleLowerCase("de-CH");
    setSaving(true);
    setError("");
    setMessage("");
    try {
      let savedDefinitionId = editingId;
      if (editingId) {
        const result = await request({
          type: "upsertDefinition",
          tenantId,
          definitionId: editingId,
          fieldKey,
          label: draft.label.trim(),
          fieldType: draft.fieldType,
          required: draft.required,
          options,
          expectedVersion: layoutBeforeSave.version,
        });
        if (
          isRecord(result) &&
          isRecord(result.data) &&
          typeof result.data.id === "string"
        ) {
          savedDefinitionId = result.data.id;
        }
      } else {
        const result = await request({
          type: "createDefinitionAtPosition",
          tenantId,
          fieldKey,
          label: draft.label.trim(),
          fieldType: draft.fieldType,
          required: draft.required,
          options,
          sectionId: draft.sectionId,
          position: activeDefinitions.filter(
            (definition) => definition.sectionId === draft.sectionId,
          ).length,
          expectedVersion: layoutBeforeSave.version,
        });
        savedDefinitionId =
          isRecord(result) &&
          isRecord(result.data) &&
          typeof result.data.id === "string"
            ? result.data.id
            : null;
      }

      const nextLayout = parseLayout(
        await request({ type: "getLayout", tenantId }),
      );
      const savedDefinition = nextLayout?.definitions.find(
        (definition) => definition.id === savedDefinitionId,
      );
      if (
        editingId &&
        nextLayout &&
        savedDefinitionId &&
        savedDefinition &&
        savedDefinition.sectionId !== draft.sectionId
      ) {
        await request({
          type: "moveDefinition",
          tenantId,
          definitionId: savedDefinitionId,
          sectionId: draft.sectionId,
          position: nextLayout.definitions.filter(
            (definition) =>
              definition.sectionId === draft.sectionId && definition.active,
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
      if (!editingId) {
        try {
          const recoveredLayout = parseLayout(
            await request({ type: "getLayout", tenantId }),
          );
          const recoveredDefinition = recoveredLayout?.definitions.find(
            (definition) =>
              definition.fieldKey === fieldKey && definition.active,
          );
          if (recoveredLayout && recoveredDefinition) {
            setLayout(recoveredLayout);
            beginEdit(recoveredDefinition);
            setMessage(`„${recoveredDefinition.label}“ wurde gespeichert.`);
            return;
          }
        } catch {
          // A failed refresh leaves the atomic server command untouched.
        }
      }
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
    if (!layout) return;
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
        expectedVersion: layout.version,
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

  async function addPreset(
    preset: TicketFieldPreset,
    sectionId: string,
    position: number,
  ) {
    if (!layout || saving) return;

    const presetDraft = createTicketFieldPresetDraft(preset, existingFieldKeys);
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const result = await request({
        type: "createDefinitionAtPosition",
        tenantId,
        fieldKey: presetDraft.fieldKey,
        label: presetDraft.label,
        fieldType: presetDraft.fieldType,
        required: presetDraft.required,
        options:
          presetDraft.fieldType === "select"
            ? (optionsFromDraft(presetDraft.options) ?? [])
            : [],
        sectionId,
        position,
        expectedVersion: layout.version,
      });
      const definitionId =
        isRecord(result) &&
        isRecord(result.data) &&
        typeof result.data.id === "string"
          ? result.data.id
          : null;
      if (!definitionId) throw new Error("Ungültige Feldantwort");

      const settledLayout = parseLayout(
        await request({ type: "getLayout", tenantId }),
      );
      if (!settledLayout) throw new Error("Ungültige Layoutantwort");
      setLayout(settledLayout);

      const insertedDefinition = settledLayout.definitions.find(
        (definition) => definition.id === definitionId,
      );
      if (insertedDefinition) beginEdit(insertedDefinition);
      setMessage(
        `„${preset.label}“ wurde eingefügt. Prüfen Sie die Einstellungen.`,
      );
    } catch (requestError) {
      try {
        const recoveredLayout = parseLayout(
          await request({ type: "getLayout", tenantId }),
        );
        const recoveredDefinition = recoveredLayout?.definitions.find(
          (definition) =>
            definition.fieldKey === presetDraft.fieldKey && definition.active,
        );
        if (recoveredLayout && recoveredDefinition) {
          setLayout(recoveredLayout);
          beginEdit(recoveredDefinition);
          setMessage(`„${recoveredDefinition.label}“ wurde gespeichert.`);
          return;
        }
      } catch {
        // The atomic server command leaves no partially placed field behind.
      }
      setError(
        await functionErrorMessage(
          requestError,
          "Das Feld konnte nicht zum Formular hinzugefügt werden.",
        ),
      );
    } finally {
      setSaving(false);
      setDraggedPresetId(null);
      setActiveDropTarget(null);
    }
  }

  function handleDrop(
    event: DragEvent<HTMLElement>,
    sectionId: string,
    insertionIndex: number,
  ) {
    event.preventDefault();
    setActiveDropTarget(null);
    const presetId = event.dataTransfer.getData(
      "application/x-nextdesk-field-preset",
    );
    const preset = [
      ...ticketFieldPresetsByCategory("Feldtypen"),
      ...ticketFieldPresetsByCategory("Ticketvorlagen"),
    ].find((candidate) => candidate.id === presetId);
    if (preset) {
      void addPreset(preset, sectionId, insertionIndex);
      return;
    }

    const definitionId =
      event.dataTransfer.getData("application/x-nextdesk-field") ||
      draggedDefinitionId;
    const definition = layout?.definitions.find(
      (candidate) => candidate.id === definitionId,
    );
    if (!definition) return;

    const sourceIndex = activeDefinitions
      .filter((candidate) => candidate.sectionId === definition.sectionId)
      .findIndex((candidate) => candidate.id === definition.id);
    void moveDefinition(
      definition,
      sectionId,
      resolveTicketFieldDropPosition(
        definition.sectionId,
        sourceIndex,
        sectionId,
        insertionIndex,
      ),
    );
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
        <div>
          <p className="eyebrow">FORMULARAUFBAU</p>
          <p className="ticket-form-builder__toolbar-copy">
            Ziehen Sie ein Feld in einen Abschnitt oder wählen Sie es mit einem
            Klick aus. Die Ticketbasis bleibt immer erhalten.
          </p>
        </div>
        <div className="ticket-form-builder__toolbar-actions">
          <button
            className="secondary-button"
            disabled={saving || loading}
            onClick={() => setSectionComposerOpen((open) => !open)}
            type="button"
          >
            <Plus aria-hidden="true" size={17} /> Abschnitt hinzufügen
          </button>
          <p className="tenant-admin-settings__hint">
            {layout
              ? `Layoutversion ${layout.version}`
              : "Layout wird geladen …"}
          </p>
        </div>
      </div>

      {sectionComposerOpen && (
        <form
          className="ticket-form-builder__section-composer"
          onSubmit={saveSection}
        >
          <label>
            Bezeichnung für den neuen Abschnitt
            <input
              autoFocus
              disabled={saving}
              maxLength={120}
              minLength={2}
              onChange={(event) => setSectionLabel(event.target.value)}
              placeholder="z. B. Gerätedaten"
              required
              value={sectionLabel}
            />
          </label>
          <div className="tenant-admin-settings__form-actions">
            <button
              className="secondary-button"
              disabled={saving}
              onClick={() => {
                setSectionComposerOpen(false);
                setSectionLabel("");
              }}
              type="button"
            >
              Abbrechen
            </button>
            <button className="primary-button" disabled={saving} type="submit">
              Abschnitt anlegen
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <p className="tenant-admin-settings__hint" role="status">
          Formular-Editor wird geladen …
        </p>
      ) : (
        <div className="ticket-form-builder__layout">
          <aside
            aria-labelledby="ticket-form-builder-palette-heading"
            className="ticket-form-builder__palette"
          >
            <div className="ticket-form-builder__palette-heading">
              <div>
                <p className="eyebrow">FELDPALETTE</p>
                <h3 id="ticket-form-builder-palette-heading">
                  Felder hinzufügen
                </h3>
              </div>
              <Plus aria-hidden="true" size={18} />
            </div>
            <p className="ticket-form-builder__palette-copy">
              Ziehen Sie ein Feld in einen Abschnitt. Ein Klick fügt es in den
              ersten Abschnitt ein und öffnet danach die Einstellungen.
            </p>
            {layout?.sections.length === 0 && (
              <p className="ticket-form-builder__palette-notice">
                Legen Sie zuerst einen Abschnitt an, bevor Sie Felder
                hinzufügen.
              </p>
            )}
            {PALETTE_CATEGORIES.map((category) => (
              <section
                className="ticket-form-builder__palette-group"
                key={category}
              >
                <h4>{category}</h4>
                <div>
                  {ticketFieldPresetsByCategory(category).map((preset) => {
                    const firstSection = layout?.sections[0];
                    const firstSectionFieldCount = activeDefinitions.filter(
                      (definition) => definition.sectionId === firstSection?.id,
                    ).length;
                    const disabled = saving || !firstSection;
                    return (
                      <button
                        aria-label={`${preset.label} zum Ticketformular hinzufügen`}
                        className={
                          draggedPresetId === preset.id
                            ? "ticket-form-builder__palette-card ticket-form-builder__palette-card--dragging"
                            : "ticket-form-builder__palette-card"
                        }
                        disabled={disabled}
                        draggable={!disabled}
                        key={preset.id}
                        onClick={() => {
                          if (!firstSection) return;
                          void addPreset(
                            preset,
                            firstSection.id,
                            firstSectionFieldCount,
                          );
                        }}
                        onDragEnd={() => setDraggedPresetId(null)}
                        onDragStart={(event) => {
                          setDraggedPresetId(preset.id);
                          event.dataTransfer.effectAllowed = "copy";
                          event.dataTransfer.setData(
                            "application/x-nextdesk-field-preset",
                            preset.id,
                          );
                        }}
                        type="button"
                      >
                        <span
                          aria-hidden="true"
                          className="ticket-form-builder__palette-symbol"
                        >
                          {preset.symbol}
                        </span>
                        <span>
                          <strong>{preset.label}</strong>
                          <small>{preset.description}</small>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </aside>

          <div
            aria-label="Konfigurierbare Formularstruktur"
            className="ticket-form-builder__canvas"
          >
            <div className="ticket-form-builder__canvas-heading">
              <div>
                <p className="eyebrow">FORMULARFLÄCHE</p>
                <h3>Ihr Ticketformular</h3>
                <p>Ordnen Sie Zusatzfelder nach dem tatsächlichen Ablauf an.</p>
              </div>
            </div>

            <section className="ticket-form-builder__standard-fields">
              <header>
                <div>
                  <p className="eyebrow">FESTE TICKETBASIS</p>
                  <h4>Immer enthalten</h4>
                </div>
                <span>Geschützt</span>
              </header>
              <p>
                Diese Felder gehören verbindlich zu jedem Ticket und können
                nicht entfernt oder verschoben werden.
              </p>
              <div>
                {[
                  "Anfragende Person",
                  "Betreff",
                  "Abteilung / Angebot",
                  "Priorität",
                  "Beschreibung",
                ].map((label) => (
                  <span key={label}>{label}</span>
                ))}
              </div>
            </section>

            {layout?.sections.length === 0 && (
              <p className="ticket-form-builder__section-empty">
                Noch keine zusätzlichen Abschnitte. Legen Sie einen Abschnitt
                an, um Felder aus der Palette einzufügen.
              </p>
            )}

            {layout?.sections.map((section) => {
              const fields = activeDefinitions.filter(
                (definition) => definition.sectionId === section.id,
              );
              const appendDropTarget = `${section.id}:${fields.length}`;
              return (
                <section
                  className="ticket-form-builder__section"
                  key={section.id}
                >
                  <header>
                    <div>
                      <p className="eyebrow">ZUSATZFELDER</p>
                      <h4>{section.label}</h4>
                    </div>
                    <span>{fields.length} Felder</span>
                  </header>
                  <ol>
                    {fields.map((definition, index) => {
                      const dropTarget = `${section.id}:${index}`;
                      return (
                        <li
                          className={
                            draggedDefinitionId === definition.id
                              ? "ticket-form-builder__field ticket-form-builder__field--dragging"
                              : activeDropTarget === dropTarget
                                ? "ticket-form-builder__field ticket-form-builder__field--drop-target"
                                : "ticket-form-builder__field"
                          }
                          draggable={!saving}
                          key={definition.id}
                          onDragEnd={() => {
                            setDraggedDefinitionId(null);
                            setActiveDropTarget(null);
                          }}
                          onDragLeave={() =>
                            setActiveDropTarget((current) =>
                              current === dropTarget ? null : current,
                            )
                          }
                          onDragOver={(event) => {
                            event.preventDefault();
                            const insertionIndex =
                              ticketFieldDropInsertionIndex(
                                event.clientY,
                                event.currentTarget.getBoundingClientRect().top,
                                event.currentTarget.getBoundingClientRect()
                                  .height,
                                index,
                              );
                            setActiveDropTarget(
                              `${section.id}:${insertionIndex}`,
                            );
                          }}
                          onDragStart={(event) => {
                            setDraggedDefinitionId(definition.id);
                            event.dataTransfer.effectAllowed = "move";
                            event.dataTransfer.setData(
                              "application/x-nextdesk-field",
                              definition.id,
                            );
                          }}
                          onDrop={(event) =>
                            handleDrop(
                              event,
                              section.id,
                              ticketFieldDropInsertionIndex(
                                event.clientY,
                                event.currentTarget.getBoundingClientRect().top,
                                event.currentTarget.getBoundingClientRect()
                                  .height,
                                index,
                              ),
                            )
                          }
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
                                {definition.required
                                  ? "Pflichtfeld"
                                  : "optional"}
                              </small>
                            </span>
                          </button>
                          <div className="ticket-form-builder__field-actions">
                            <button
                              aria-label={`${definition.label} nach oben verschieben`}
                              className="icon-button"
                              disabled={saving || index === 0}
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
                      );
                    })}
                    <li
                      aria-label={`Neues Feld am Ende von ${section.label} ablegen`}
                      className={
                        activeDropTarget === appendDropTarget
                          ? "ticket-form-builder__dropzone ticket-form-builder__dropzone--active"
                          : "ticket-form-builder__dropzone"
                      }
                      onDragEnter={(event) => {
                        event.preventDefault();
                        setActiveDropTarget(appendDropTarget);
                      }}
                      onDragLeave={() =>
                        setActiveDropTarget((current) =>
                          current === appendDropTarget ? null : current,
                        )
                      }
                      onDragOver={(event) => {
                        event.preventDefault();
                        setActiveDropTarget(appendDropTarget);
                      }}
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
                <p className="eyebrow">LIVE-VORSCHAU</p>
                <h3 id="ticket-form-builder-preview-heading">Ticketformular</h3>
              </div>
            </div>
            <p className="ticket-form-builder__preview-copy">
              So sehen Mitarbeitende das Formular später. Zusatzfelder folgen in
              der konfigurierten Reihenfolge.
            </p>
            {STANDARD_TICKET_FORM_PREVIEW_SECTIONS.map((section) => (
              <section
                className="ticket-form-builder__preview-section ticket-form-builder__preview-section--standard"
                key={section.label}
              >
                <h4>{section.label}</h4>
                <div>
                  {section.fields.map((field) => (
                    <FieldPreview definition={field} key={field.label} />
                  ))}
                </div>
              </section>
            ))}
            {activeDefinitions.length > 0 && (
              <p className="ticket-form-builder__preview-subheading">
                Zusätzliche Felder
              </p>
            )}
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
              <p className="ticket-form-builder__preview-empty-custom-fields">
                Ziehen Sie ein Feld aus der Palette in einen Abschnitt.
              </p>
            )}
          </aside>

          {inspectorOpen ? (
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
                <button
                  className="text-button"
                  onClick={() => setInspectorOpen(false)}
                  type="button"
                >
                  Schliessen
                </button>
              </div>
              <label>
                Abschnitt
                <select
                  disabled={saving}
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
          ) : (
            <section
              className="ticket-form-builder__inspector-empty"
              aria-label="Feldeinstellungen"
            >
              <p className="eyebrow">FELDINSPEKTOR</p>
              <h3>Feld auswählen</h3>
              <p>
                Wählen Sie eine Feldkarte oder ziehen Sie ein neues Feld aus der
                Palette in einen Abschnitt, um dessen Einstellungen zu
                bearbeiten.
              </p>
            </section>
          )}
        </div>
      )}
    </section>
  );
}
