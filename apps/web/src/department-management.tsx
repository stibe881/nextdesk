import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";

import { Archive, Pencil, Plus, RefreshCw, UsersRound } from "lucide-react";

import { functionErrorMessage } from "./lib/function-error";
import { supabase } from "./lib/supabase";

export type DepartmentManagementProps = {
  tenantId: string;
};

type Department = {
  id: string;
  key: string;
  name: string;
  kind: "ict" | "infrastructure" | "custom";
  active: boolean;
  createdAt: string;
};

type DepartmentForm = {
  id: string | null;
  name: string;
};

type DepartmentRequest =
  | { type: "listDepartments"; tenantId: string }
  | { type: "saveDepartment"; tenantId: string; id?: string; name: string }
  | { type: "archiveDepartment"; tenantId: string; id: string };

const EMPTY_FORM: DepartmentForm = { id: null, name: "" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseDepartment(value: unknown): Department | null {
  if (!isRecord(value)) return null;
  const id = value.id;
  const key = value.key;
  const name = value.name;
  const kind = value.kind;
  const active = value.active;
  const createdAt = value.created_at;
  if (
    typeof id !== "string" ||
    typeof key !== "string" ||
    typeof name !== "string" ||
    (kind !== "ict" && kind !== "infrastructure" && kind !== "custom") ||
    typeof active !== "boolean" ||
    typeof createdAt !== "string"
  ) {
    return null;
  }
  return { id, key, name, kind, active, createdAt };
}

function departmentKindLabel(kind: Department["kind"]): string {
  if (kind === "ict") return "ICT";
  if (kind === "infrastructure") return "Infrastruktur";
  return "Eigene Abteilung";
}

async function requestDepartments(body: DepartmentRequest): Promise<unknown> {
  if (!supabase) {
    throw new Error("Die Verbindung zu nextDesk ist nicht konfiguriert.");
  }
  const { data, error } = await supabase.functions.invoke<unknown>(
    "tenant-admin-settings",
    { body },
  );
  if (error) {
    throw new Error(
      await functionErrorMessage(
        error,
        "Die Abteilungsverwaltung ist derzeit nicht erreichbar.",
      ),
    );
  }
  if (!isRecord(data) || !isRecord(data.data)) {
    throw new Error(
      "Die Abteilungsverwaltung hat keine verwertbaren Daten geliefert.",
    );
  }
  return data.data;
}

function parseDepartmentList(value: unknown): Department[] {
  if (!isRecord(value) || !Array.isArray(value.departments)) {
    throw new Error("Die Abteilungsliste ist unvollständig.");
  }
  const departments = value.departments.map(parseDepartment);
  if (departments.some((department) => department === null)) {
    throw new Error("Die Abteilungsliste enthält ungültige Daten.");
  }
  return departments as Department[];
}

function parseDepartmentSave(value: unknown): Department {
  if (!isRecord(value)) {
    throw new Error("Die Abteilungsantwort ist unvollständig.");
  }
  const department = parseDepartment(value.department);
  if (!department) {
    throw new Error("Die gespeicherte Abteilung ist unvollständig.");
  }
  return department;
}

export function DepartmentManagement({ tenantId }: DepartmentManagementProps) {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [form, setForm] = useState<DepartmentForm>(EMPTY_FORM);
  const [formVisible, setFormVisible] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const activeDepartments = useMemo(
    () => departments.filter((department) => department.active),
    [departments],
  );
  const archivedDepartments = useMemo(
    () => departments.filter((department) => !department.active),
    [departments],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await requestDepartments({
        type: "listDepartments",
        tenantId,
      });
      setDepartments(parseDepartmentList(data));
    } catch (nextError) {
      setDepartments([]);
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Die Abteilungen konnten nicht geladen werden.",
      );
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setForm(EMPTY_FORM);
    setFormVisible(false);
    setMessage("");
    setError("");
  }, [tenantId]);

  function startCreate() {
    setForm(EMPTY_FORM);
    setFormVisible(true);
    setMessage("");
    setError("");
  }

  function startEdit(department: Department) {
    setForm({ id: department.id, name: department.name });
    setFormVisible(true);
    setMessage("");
    setError("");
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = form.name.trim();
    if (Array.from(name).length < 2 || Array.from(name).length > 120) {
      setError("Der Abteilungsname muss zwischen 2 und 120 Zeichen lang sein.");
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const data = await requestDepartments({
        type: "saveDepartment",
        tenantId,
        ...(form.id ? { id: form.id } : {}),
        name,
      });
      const saved = parseDepartmentSave(data);
      setDepartments((current) =>
        [
          ...current.filter((department) => department.id !== saved.id),
          saved,
        ].sort((left, right) => left.name.localeCompare(right.name, "de-CH")),
      );
      setForm(EMPTY_FORM);
      setFormVisible(false);
      setMessage(
        form.id
          ? `Die Abteilung „${saved.name}“ wurde gespeichert.`
          : `Die Abteilung „${saved.name}“ wurde angelegt.`,
      );
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Die Abteilung konnte nicht gespeichert werden.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function archive(department: Department) {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const data = await requestDepartments({
        type: "archiveDepartment",
        tenantId,
        id: department.id,
      });
      const saved = parseDepartmentSave(data);
      setDepartments((current) =>
        current
          .map((item) => (item.id === saved.id ? saved : item))
          .sort((left, right) => left.name.localeCompare(right.name, "de-CH")),
      );
      if (form.id === saved.id) {
        setForm(EMPTY_FORM);
        setFormVisible(false);
      }
      setMessage(`Die Abteilung „${saved.name}“ wurde archiviert.`);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Die Abteilung konnte nicht archiviert werden.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      aria-labelledby="department-management-heading"
      className="tenant-admin-settings__section department-management"
    >
      <div className="tenant-admin-settings__section-heading department-management__heading">
        <div>
          <p className="eyebrow">STRUKTUR</p>
          <h2 id="department-management-heading">Abteilungen</h2>
          <p>
            Abteilungen steuern Zuständigkeiten, Ticketzuordnung und die Auswahl
            von Agent*innen. Personen werden im Bereich „Personen“ einer
            Abteilung zugeordnet.
          </p>
        </div>
        <div className="department-management__header-actions">
          <button
            disabled={loading || saving}
            onClick={() => void load()}
            type="button"
          >
            <RefreshCw aria-hidden="true" size={16} /> Aktualisieren
          </button>
          <button
            className="primary-button"
            disabled={saving}
            onClick={startCreate}
            type="button"
          >
            <Plus aria-hidden="true" size={16} /> Abteilung anlegen
          </button>
        </div>
      </div>

      {error ? (
        <p
          className="tenant-admin-settings__notice tenant-admin-settings__notice--error"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      {message ? (
        <p
          className="tenant-admin-settings__notice tenant-admin-settings__notice--success"
          role="status"
        >
          {message}
        </p>
      ) : null}

      {formVisible ? (
        <form className="department-management__form" onSubmit={save}>
          <div>
            <h3>{form.id ? "Abteilung bearbeiten" : "Neue Abteilung"}</h3>
            <p>
              Die technische Kennung wird beim Anlegen sicher aus dem Namen
              erzeugt und danach beibehalten.
            </p>
          </div>
          <label>
            Name der Abteilung
            <input
              autoFocus
              disabled={saving}
              maxLength={120}
              onChange={(event) =>
                setForm((current) => ({ ...current, name: event.target.value }))
              }
              placeholder="Zum Beispiel ICT oder Finanzen"
              required
              value={form.name}
            />
          </label>
          <div className="department-management__form-actions">
            <button className="primary-button" disabled={saving} type="submit">
              {saving
                ? "Wird gespeichert …"
                : form.id
                  ? "Änderungen speichern"
                  : "Abteilung anlegen"}
            </button>
            <button
              disabled={saving}
              onClick={() => {
                setForm(EMPTY_FORM);
                setFormVisible(false);
              }}
              type="button"
            >
              Abbrechen
            </button>
          </div>
        </form>
      ) : null}

      {loading ? (
        <p className="tenant-admin-settings__loading" role="status">
          Abteilungen werden geladen …
        </p>
      ) : (
        <div className="department-management__groups">
          <section aria-labelledby="active-departments-heading">
            <div className="department-management__group-heading">
              <h3 id="active-departments-heading">Aktive Abteilungen</h3>
              <span>{activeDepartments.length}</span>
            </div>
            {activeDepartments.length === 0 ? (
              <p className="department-management__empty">
                Es gibt noch keine aktive Abteilung.
              </p>
            ) : (
              <ul className="department-management__list">
                {activeDepartments.map((department) => (
                  <li key={department.id}>
                    <div className="department-management__item-main">
                      <span className="department-management__icon">
                        <UsersRound aria-hidden="true" size={18} />
                      </span>
                      <div>
                        <strong>{department.name}</strong>
                        <span>
                          {departmentKindLabel(department.kind)} · Kennung:{" "}
                          {department.key}
                        </span>
                      </div>
                    </div>
                    <div className="department-management__item-actions">
                      <button
                        disabled={saving}
                        onClick={() => startEdit(department)}
                        type="button"
                      >
                        <Pencil aria-hidden="true" size={15} /> Bearbeiten
                      </button>
                      <button
                        disabled={saving}
                        onClick={() => void archive(department)}
                        type="button"
                      >
                        <Archive aria-hidden="true" size={15} /> Archivieren
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {archivedDepartments.length > 0 ? (
            <section aria-labelledby="archived-departments-heading">
              <div className="department-management__group-heading">
                <h3 id="archived-departments-heading">Archiviert</h3>
                <span>{archivedDepartments.length}</span>
              </div>
              <ul className="department-management__list department-management__list--archived">
                {archivedDepartments.map((department) => (
                  <li key={department.id}>
                    <div className="department-management__item-main">
                      <span className="department-management__icon">
                        <Archive aria-hidden="true" size={18} />
                      </span>
                      <div>
                        <strong>{department.name}</strong>
                        <span>
                          {departmentKindLabel(department.kind)} · Kennung:{" "}
                          {department.key}
                        </span>
                      </div>
                    </div>
                    <button
                      disabled={saving}
                      onClick={() => startEdit(department)}
                      type="button"
                    >
                      <Pencil aria-hidden="true" size={15} /> Öffnen
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      )}
    </section>
  );
}
