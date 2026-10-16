import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { CheckCircle2, Pencil, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { supabase } from "./lib/supabase";

type Department = {
  id: string;
  key: string;
  name: string;
  kind: string;
};

type Priority = {
  key: string;
  label: string;
  sort_order: number;
};

type TemplateChecklistItem = {
  id: string;
  description: string;
  position: number;
};

type TicketTemplate = {
  id: string;
  department_id: string | null;
  name: string;
  subject_template: string;
  description_template: string;
  priority_key: string | null;
  active: boolean;
  checklistItems: TemplateChecklistItem[];
};

type TemplateFields = {
  name: string;
  subjectTemplate: string;
  descriptionTemplate: string;
  priorityKey: string | null;
  departmentId: string | null;
  checklistItems: Array<{ description: string }>;
};

type ListTemplatesAction = {
  type: "listTemplates";
  tenantId: string;
};

type CreateTemplateAction = {
  type: "createTemplate";
  tenantId: string;
} & TemplateFields;

type UpdateTemplateAction = {
  type: "updateTemplate";
  tenantId: string;
  templateId: string;
  active: boolean;
} & TemplateFields;

type DeleteTemplateAction = {
  type: "deleteTemplate";
  tenantId: string;
  templateId: string;
};

type TemplateAction =
  | ListTemplatesAction
  | CreateTemplateAction
  | UpdateTemplateAction
  | DeleteTemplateAction;

type TemplateDraft = {
  name: string;
  subjectTemplate: string;
  descriptionTemplate: string;
  priorityKey: string;
  departmentId: string;
  active: boolean;
  checklistItems: string[];
};

type FormOptions = {
  departments: Department[];
  priorities: Priority[];
};

type SavingState = "create" | "update" | null;

const EMPTY_OPTIONS: FormOptions = { departments: [], priorities: [] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return typeof value === "string" || value === null;
}

function parseChecklistItem(
  value: unknown,
  position: number,
): TemplateChecklistItem | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== "string" || typeof value.description !== "string") {
    return null;
  }
  return {
    id: value.id,
    description: value.description,
    position: typeof value.position === "number" ? value.position : position,
  };
}

function parseTemplate(value: unknown): TicketTemplate | null {
  if (!isRecord(value) || !Array.isArray(value.checklistItems)) return null;
  if (
    typeof value.id !== "string" ||
    !isNullableString(value.department_id) ||
    typeof value.name !== "string" ||
    typeof value.subject_template !== "string" ||
    typeof value.description_template !== "string" ||
    !isNullableString(value.priority_key) ||
    typeof value.active !== "boolean"
  ) {
    return null;
  }

  const checklistItems = value.checklistItems.map(parseChecklistItem);
  if (checklistItems.some((item) => item === null)) return null;

  return {
    id: value.id,
    department_id: value.department_id,
    name: value.name,
    subject_template: value.subject_template,
    description_template: value.description_template,
    priority_key: value.priority_key,
    active: value.active,
    checklistItems: checklistItems as TemplateChecklistItem[],
  };
}

function responseData(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value) || !isRecord(value.data)) return null;
  return value.data;
}

function parseTemplateListResponse(value: unknown): TicketTemplate[] {
  const data = responseData(value);
  if (!data || !Array.isArray(data.templates)) {
    throw new Error("Vorlagenantwort ist unvollständig.");
  }

  const templates = data.templates.map(parseTemplate);
  if (templates.some((template) => template === null)) {
    throw new Error("Vorlagenantwort enthält ungültige Daten.");
  }
  return templates as TicketTemplate[];
}

function parseTemplateResponse(value: unknown): TicketTemplate {
  const data = responseData(value);
  const template = data ? parseTemplate(data.template) : null;
  if (!template) throw new Error("Vorlagenantwort ist unvollständig.");
  return template;
}

function parseFormOptions(value: unknown): FormOptions {
  const data = responseData(value);
  if (
    !data ||
    !Array.isArray(data.departments) ||
    !Array.isArray(data.priorities)
  ) {
    throw new Error("Formularoptionen sind unvollständig.");
  }

  const departments: Department[] = [];
  for (const department of data.departments) {
    if (
      !isRecord(department) ||
      typeof department.id !== "string" ||
      typeof department.key !== "string" ||
      typeof department.name !== "string" ||
      typeof department.kind !== "string"
    ) {
      throw new Error("Formularoptionen enthalten ungültige Abteilungen.");
    }
    departments.push({
      id: department.id,
      key: department.key,
      name: department.name,
      kind: department.kind,
    });
  }

  const priorities: Priority[] = [];
  for (const priority of data.priorities) {
    if (
      !isRecord(priority) ||
      typeof priority.key !== "string" ||
      typeof priority.label !== "string" ||
      typeof priority.sort_order !== "number"
    ) {
      throw new Error("Formularoptionen enthalten ungültige Prioritäten.");
    }
    priorities.push({
      key: priority.key,
      label: priority.label,
      sort_order: priority.sort_order,
    });
  }

  return { departments, priorities };
}

function emptyDraft(priorities: Priority[]): TemplateDraft {
  const normalPriority = priorities.find(
    (priority) => priority.key === "normal",
  );
  return {
    name: "",
    subjectTemplate: "",
    descriptionTemplate: "",
    priorityKey: normalPriority?.key ?? priorities[0]?.key ?? "",
    departmentId: "",
    active: true,
    checklistItems: [],
  };
}

function fieldsFromDraft(draft: TemplateDraft): TemplateFields {
  return {
    name: draft.name.trim(),
    subjectTemplate: draft.subjectTemplate.trim(),
    descriptionTemplate: draft.descriptionTemplate.trim(),
    priorityKey: draft.priorityKey || null,
    departmentId: draft.departmentId || null,
    checklistItems: draft.checklistItems.map((description) => ({
      description: description.trim(),
    })),
  };
}

function validateDraft(draft: TemplateDraft): string | null {
  if (!draft.name.trim())
    return "Bitte geben Sie einen Namen für die Vorlage ein.";
  if (!draft.subjectTemplate.trim()) {
    return "Bitte geben Sie eine Betreffvorlage ein.";
  }
  if (!draft.descriptionTemplate.trim()) {
    return "Bitte geben Sie eine Beschreibungsvorlage ein.";
  }
  if (draft.checklistItems.some((item) => !item.trim())) {
    return "Bitte füllen Sie jeden Checklistenpunkt aus oder entfernen Sie leere Punkte.";
  }
  return null;
}

function preview(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 190 ? `${normalized.slice(0, 187)}…` : normalized;
}

function genericError(action: "load" | "save" | "delete"): string {
  if (action === "load") {
    return "Die Vorlagen konnten nicht geladen werden. Bitte versuchen Sie es erneut.";
  }
  if (action === "delete") {
    return "Die Vorlage konnte nicht gelöscht werden. Bitte versuchen Sie es erneut.";
  }
  return "Die Vorlage konnte nicht gespeichert werden. Bitte prüfen Sie Ihre Eingaben und versuchen Sie es erneut.";
}

async function invokeTicketTemplates(action: TemplateAction): Promise<unknown> {
  if (!supabase) {
    throw new Error("Supabase ist nicht konfiguriert.");
  }

  const { data, error } = await supabase.functions.invoke("ticket-templates", {
    body: action,
  });
  if (error) throw error;
  return data;
}

const ticketTemplateStyles = `
.ticket-templates {
  display: grid;
  gap: 18px;
}
.ticket-templates__header-actions,
.ticket-templates__actions,
.ticket-templates__form-actions,
.ticket-templates__checklist-heading {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.ticket-templates__header-actions {
  justify-content: flex-end;
}
.ticket-templates__button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px solid #c9d8dd;
  border-radius: 5px;
  background: #fff;
  color: #245268;
  padding: 8px 10px;
  font: inherit;
  font-size: 12px;
  font-weight: 700;
}
.ticket-templates__button:hover:not(:disabled) {
  background: #f1f7f8;
}
.ticket-templates__button:disabled,
.ticket-templates__save:disabled {
  cursor: wait;
  opacity: 0.62;
}
.ticket-templates__button--danger {
  border-color: #efc7bd;
  color: #a03422;
}
.ticket-templates__content {
  padding: 0 24px 24px;
}
.ticket-templates__list {
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.ticket-templates__item {
  border: 1px solid #dfe8ea;
  border-radius: 7px;
  padding: 15px;
}
.ticket-templates__item-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
}
.ticket-templates__item h3 {
  margin: 0;
  color: #173246;
  font-size: 15px;
}
.ticket-templates__subject,
.ticket-templates__description,
.ticket-templates__meta {
  margin: 6px 0 0;
}
.ticket-templates__subject {
  color: #34596a;
  font-size: 13px;
  font-weight: 700;
}
.ticket-templates__description {
  color: #687b84;
  font-size: 12px;
  line-height: 1.45;
}
.ticket-templates__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 5px 14px;
  color: #627780;
  font-size: 11px;
}
.ticket-templates__badge {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  border-radius: 999px;
  padding: 4px 8px;
  background: #e5f6f1;
  color: #177c69;
  font-size: 10px;
  font-weight: 800;
}
.ticket-templates__badge--inactive {
  background: #f0f3f4;
  color: #687b84;
}
.ticket-templates__actions {
  margin-top: 13px;
}
.ticket-templates__message {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 0;
  border-radius: 5px;
  padding: 11px 13px;
  font-size: 13px;
  line-height: 1.4;
}
.ticket-templates__message--error {
  border: 1px solid #f1c9c0;
  background: #fff5f2;
  color: #a03422;
}
.ticket-templates__message--success {
  border: 1px solid #bfe4db;
  background: #effaf7;
  color: #216c5e;
}
.ticket-templates__form-panel {
  padding: 0 24px 24px;
}
.ticket-templates__form {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}
.ticket-templates__form label {
  display: grid;
  gap: 6px;
  color: #12283a;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.ticket-templates__form input,
.ticket-templates__form select,
.ticket-templates__form textarea {
  width: 100%;
  border: 1px solid #c9d1d6;
  border-radius: 4px;
  background: #fff;
  color: #12283a;
  font: inherit;
  letter-spacing: normal;
  padding: 10px 11px;
  text-transform: none;
}
.ticket-templates__form textarea {
  min-height: 116px;
  resize: vertical;
}
.ticket-templates__full-width {
  grid-column: 1 / -1;
}
.ticket-templates__checkbox {
  display: flex !important;
  grid-column: 1 / -1;
  align-items: center;
  gap: 8px !important;
  font-size: 12px !important;
  letter-spacing: normal !important;
  text-transform: none !important;
}
.ticket-templates__checkbox input {
  width: 16px !important;
  height: 16px;
  padding: 0 !important;
}
.ticket-templates__checklist {
  display: grid;
  gap: 8px;
}
.ticket-templates__checklist-heading {
  justify-content: space-between;
}
.ticket-templates__checklist-heading strong {
  color: #12283a;
  font-size: 12px;
}
.ticket-templates__checklist-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
}
.ticket-templates__save {
  margin-top: 0;
}
@media (max-width: 680px) {
  .ticket-templates__content,
  .ticket-templates__form-panel {
    padding-left: 16px;
    padding-right: 16px;
  }
  .ticket-templates__item-header {
    display: grid;
  }
  .ticket-templates__form {
    grid-template-columns: 1fr;
  }
  .ticket-templates__full-width,
  .ticket-templates__checkbox {
    grid-column: auto;
  }
}
`;

export function TicketTemplates({ tenantId }: { tenantId: string }) {
  const [templates, setTemplates] = useState<TicketTemplate[]>([]);
  const [options, setOptions] = useState<FormOptions>(EMPTY_OPTIONS);
  const [draft, setDraft] = useState<TemplateDraft>(() => emptyDraft([]));
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<SavingState>(null);
  const [deletingTemplateId, setDeletingTemplateId] = useState<string | null>(
    null,
  );
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const requestVersion = useRef(0);

  const departmentsById = useMemo(
    () =>
      new Map(
        options.departments.map((department) => [
          department.id,
          department.name,
        ]),
      ),
    [options.departments],
  );
  const prioritiesByKey = useMemo(
    () =>
      new Map(
        options.priorities.map((priority) => [priority.key, priority.label]),
      ),
    [options.priorities],
  );

  const loadTemplates = useCallback(async () => {
    const version = requestVersion.current + 1;
    requestVersion.current = version;
    setLoading(true);
    setError("");

    if (!supabase) {
      setError("Die Verbindung zu Supabase ist nicht konfiguriert.");
      setLoading(false);
      return;
    }

    try {
      const [templatesResponse, optionsResponse] = await Promise.all([
        supabase.functions.invoke("ticket-templates", {
          body: {
            type: "listTemplates",
            tenantId,
          } satisfies ListTemplatesAction,
        }),
        supabase.functions.invoke("ticket-actions", {
          body: { type: "getFormOptions", tenantId },
        }),
      ]);
      if (templatesResponse.error) throw templatesResponse.error;
      if (optionsResponse.error) throw optionsResponse.error;

      const nextTemplates = parseTemplateListResponse(templatesResponse.data);
      const nextOptions = parseFormOptions(optionsResponse.data);
      if (requestVersion.current !== version) return;

      setTemplates(nextTemplates);
      setOptions(nextOptions);
    } catch {
      if (requestVersion.current === version) setError(genericError("load"));
    } finally {
      if (requestVersion.current === version) setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void loadTemplates();
    return () => {
      requestVersion.current += 1;
    };
  }, [loadTemplates]);

  function resetForm() {
    setEditingTemplateId(null);
    setDraft(emptyDraft(options.priorities));
  }

  function beginEdit(template: TicketTemplate) {
    setEditingTemplateId(template.id);
    setDraft({
      name: template.name,
      subjectTemplate: template.subject_template,
      descriptionTemplate: template.description_template,
      priorityKey: template.priority_key ?? "",
      departmentId: template.department_id ?? "",
      active: template.active,
      checklistItems: template.checklistItems.map((item) => item.description),
    });
    setError("");
    setSuccess("");
  }

  function updateChecklistItem(index: number, description: string) {
    setDraft((current) => {
      if (current.checklistItems[index] === undefined) return current;
      const checklistItems = [...current.checklistItems];
      checklistItems[index] = description;
      return { ...current, checklistItems };
    });
  }

  function removeChecklistItem(index: number) {
    setDraft((current) => ({
      ...current,
      checklistItems: current.checklistItems.filter(
        (_, itemIndex) => itemIndex !== index,
      ),
    }));
  }

  async function saveTemplate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validationError = validateDraft(draft);
    if (validationError) {
      setError(validationError);
      setSuccess("");
      return;
    }

    const fields = fieldsFromDraft(draft);
    const isEditing = editingTemplateId !== null;
    let createdTemplate: TicketTemplate | null = null;
    setSaving(isEditing ? "update" : "create");
    setError("");
    setSuccess("");

    try {
      let savedTemplate: TicketTemplate;
      if (editingTemplateId) {
        const response = await invokeTicketTemplates({
          type: "updateTemplate",
          tenantId,
          templateId: editingTemplateId,
          active: draft.active,
          ...fields,
        });
        savedTemplate = parseTemplateResponse(response);
      } else {
        const response = await invokeTicketTemplates({
          type: "createTemplate",
          tenantId,
          ...fields,
        });
        createdTemplate = parseTemplateResponse(response);
        savedTemplate = createdTemplate;

        // Die Edge Function setzt neue Vorlagen standardmässig aktiv. Für eine
        // bewusst inaktive neue Vorlage wird der Zustand direkt danach gesetzt.
        if (!draft.active) {
          const activationResponse = await invokeTicketTemplates({
            type: "updateTemplate",
            tenantId,
            templateId: createdTemplate.id,
            active: false,
            ...fields,
          });
          savedTemplate = parseTemplateResponse(activationResponse);
        }
      }

      setTemplates((current) =>
        [
          ...current.filter((template) => template.id !== savedTemplate.id),
          savedTemplate,
        ].sort((left, right) => left.name.localeCompare(right.name, "de")),
      );
      resetForm();
      setSuccess(
        isEditing
          ? "Die Vorlage wurde aktualisiert."
          : "Die Vorlage wurde angelegt.",
      );
    } catch {
      if (createdTemplate) {
        setError(
          "Die Vorlage wurde angelegt, aber ihr Aktivstatus konnte nicht gesetzt werden. Bitte laden Sie die Liste neu und bearbeiten Sie die Vorlage.",
        );
      } else {
        setError(genericError("save"));
      }
    } finally {
      setSaving(null);
    }
  }

  async function deleteTemplate(template: TicketTemplate) {
    const confirmed = window.confirm(
      `Möchten Sie die Vorlage „${template.name}“ wirklich endgültig löschen?`,
    );
    if (!confirmed) return;

    setDeletingTemplateId(template.id);
    setError("");
    setSuccess("");
    try {
      await invokeTicketTemplates({
        type: "deleteTemplate",
        tenantId,
        templateId: template.id,
      });
      setTemplates((current) =>
        current.filter((item) => item.id !== template.id),
      );
      if (editingTemplateId === template.id) resetForm();
      setSuccess("Die Vorlage wurde gelöscht.");
    } catch {
      setError(genericError("delete"));
    } finally {
      setDeletingTemplateId(null);
    }
  }

  const isBusy = saving !== null || deletingTemplateId !== null;
  const editing = editingTemplateId !== null;

  return (
    <div className="ticket-templates">
      <style>{ticketTemplateStyles}</style>

      <section
        className="panel ticket-compose"
        aria-labelledby="ticket-templates-heading"
      >
        <div className="panel-heading">
          <div>
            <p className="eyebrow">TICKETVORLAGEN</p>
            <h2 id="ticket-templates-heading">Vorlagen verwalten</h2>
          </div>
          <div className="ticket-templates__header-actions">
            <button
              className="ticket-templates__button"
              disabled={loading || isBusy}
              onClick={() => void loadTemplates()}
              type="button"
            >
              <RefreshCw aria-hidden="true" size={15} />
              Aktualisieren
            </button>
            <button
              className="ticket-templates__button"
              disabled={isBusy}
              onClick={resetForm}
              type="button"
            >
              <Plus aria-hidden="true" size={15} />
              Neue Vorlage
            </button>
          </div>
        </div>

        <div className="ticket-templates__content">
          {loading ? (
            <p className="empty-state" aria-live="polite">
              Vorlagen und Auswahloptionen werden geladen …
            </p>
          ) : templates.length === 0 ? (
            <p className="empty-state">
              Es sind noch keine Ticketvorlagen vorhanden.
            </p>
          ) : (
            <ul
              className="ticket-templates__list"
              aria-label="Vorhandene Ticketvorlagen"
            >
              {templates.map((template) => {
                const departmentLabel = template.department_id
                  ? (departmentsById.get(template.department_id) ??
                    "Nicht verfügbare Abteilung")
                  : "Mandantenweit";
                const priorityLabel = template.priority_key
                  ? (prioritiesByKey.get(template.priority_key) ??
                    template.priority_key)
                  : "Keine Prioritätsvorgabe";
                const deleting = deletingTemplateId === template.id;

                return (
                  <li className="ticket-templates__item" key={template.id}>
                    <div className="ticket-templates__item-header">
                      <div>
                        <h3>{template.name}</h3>
                        <p className="ticket-templates__subject">
                          {template.subject_template}
                        </p>
                      </div>
                      <span
                        className={`ticket-templates__badge${template.active ? "" : " ticket-templates__badge--inactive"}`}
                      >
                        {template.active ? "Aktiv" : "Inaktiv"}
                      </span>
                    </div>
                    <p className="ticket-templates__description">
                      {preview(template.description_template)}
                    </p>
                    <p className="ticket-templates__meta">
                      <span>Abteilung: {departmentLabel}</span>
                      <span>Priorität: {priorityLabel}</span>
                      <span>
                        Checkliste: {template.checklistItems.length}{" "}
                        {template.checklistItems.length === 1
                          ? "Punkt"
                          : "Punkte"}
                      </span>
                    </p>
                    <div className="ticket-templates__actions">
                      <button
                        className="ticket-templates__button"
                        disabled={isBusy}
                        onClick={() => beginEdit(template)}
                        type="button"
                      >
                        <Pencil aria-hidden="true" size={14} />
                        Bearbeiten
                      </button>
                      <button
                        className="ticket-templates__button ticket-templates__button--danger"
                        disabled={isBusy}
                        onClick={() => void deleteTemplate(template)}
                        type="button"
                      >
                        <Trash2 aria-hidden="true" size={14} />
                        {deleting ? "Wird gelöscht …" : "Löschen"}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      <section className="panel" aria-labelledby="ticket-template-form-heading">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">
              {editing ? "VORLAGE BEARBEITEN" : "NEUE VORLAGE"}
            </p>
            <h2 id="ticket-template-form-heading">
              {editing ? "Ticketvorlage bearbeiten" : "Ticketvorlage anlegen"}
            </h2>
          </div>
          {editing && <span className="data-caption">Bearbeitungsmodus</span>}
        </div>

        <form
          className="ticket-templates__form ticket-templates__form-panel"
          onSubmit={saveTemplate}
        >
          <label>
            Name der Vorlage
            <input
              disabled={loading || isBusy}
              maxLength={160}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
              placeholder="Zum Beispiel: Zugriffsproblem"
              required
              value={draft.name}
            />
          </label>

          <label>
            Betreffvorlage
            <input
              disabled={loading || isBusy}
              maxLength={240}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  subjectTemplate: event.target.value,
                }))
              }
              placeholder="Zum Beispiel: Zugriff auf {{System}} fehlt"
              required
              value={draft.subjectTemplate}
            />
          </label>

          <label>
            Abteilung (optional)
            <select
              disabled={loading || isBusy}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  departmentId: event.target.value,
                }))
              }
              value={draft.departmentId}
            >
              <option value="">Mandantenweit</option>
              {options.departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            Prioritätsschlüssel (optional)
            <select
              disabled={loading || isBusy}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  priorityKey: event.target.value,
                }))
              }
              value={draft.priorityKey}
            >
              <option value="">Keine Prioritätsvorgabe</option>
              {options.priorities.map((priority) => (
                <option key={priority.key} value={priority.key}>
                  {priority.label} ({priority.key})
                </option>
              ))}
            </select>
          </label>

          <label className="ticket-templates__full-width">
            Beschreibungsvorlage
            <textarea
              disabled={loading || isBusy}
              maxLength={50000}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  descriptionTemplate: event.target.value,
                }))
              }
              placeholder="Beschreiben Sie den Standardablauf oder die benötigten Angaben."
              required
              rows={5}
              value={draft.descriptionTemplate}
            />
          </label>

          <div className="ticket-templates__checklist ticket-templates__full-width">
            <div className="ticket-templates__checklist-heading">
              <strong>Checklistenpunkte</strong>
              <button
                className="ticket-templates__button"
                disabled={
                  loading || isBusy || draft.checklistItems.length >= 100
                }
                onClick={() =>
                  setDraft((current) => ({
                    ...current,
                    checklistItems: [...current.checklistItems, ""],
                  }))
                }
                type="button"
              >
                <Plus aria-hidden="true" size={14} />
                Punkt hinzufügen
              </button>
            </div>
            {draft.checklistItems.length === 0 ? (
              <p className="ticket-templates__description">
                Keine Checklistenpunkte. Sie können die Vorlage auch ohne
                Checkliste speichern.
              </p>
            ) : (
              draft.checklistItems.map((item, index) => (
                <div className="ticket-templates__checklist-row" key={index}>
                  <input
                    aria-label={`Checklistenpunkt ${index + 1}`}
                    disabled={loading || isBusy}
                    maxLength={1000}
                    onChange={(event) =>
                      updateChecklistItem(index, event.target.value)
                    }
                    placeholder={`Checklistenpunkt ${index + 1}`}
                    required
                    value={item}
                  />
                  <button
                    aria-label={`Checklistenpunkt ${index + 1} entfernen`}
                    className="ticket-templates__button ticket-templates__button--danger"
                    disabled={loading || isBusy}
                    onClick={() => removeChecklistItem(index)}
                    type="button"
                  >
                    <X aria-hidden="true" size={15} />
                    Entfernen
                  </button>
                </div>
              ))
            )}
          </div>

          <label className="ticket-templates__checkbox">
            <input
              checked={draft.active}
              disabled={loading || isBusy}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  active: event.target.checked,
                }))
              }
              type="checkbox"
            />
            Vorlage ist aktiv und kann verwendet werden
          </label>

          <div className="ticket-templates__form-actions ticket-templates__full-width">
            <button
              className="primary-button ticket-templates__save"
              disabled={loading || isBusy}
              type="submit"
            >
              {saving === "create"
                ? "Vorlage wird angelegt …"
                : saving === "update"
                  ? "Vorlage wird gespeichert …"
                  : editing
                    ? "Änderungen speichern"
                    : "Vorlage anlegen"}
            </button>
            {editing && (
              <button
                className="ticket-templates__button"
                disabled={isBusy}
                onClick={resetForm}
                type="button"
              >
                Bearbeitung abbrechen
              </button>
            )}
          </div>
        </form>
      </section>

      {error && (
        <p
          className="ticket-templates__message ticket-templates__message--error"
          role="alert"
        >
          {error}
        </p>
      )}
      {success && (
        <p
          className="ticket-templates__message ticket-templates__message--success"
          role="status"
        >
          <CheckCircle2 aria-hidden="true" size={18} />
          {success}
        </p>
      )}
    </div>
  );
}
