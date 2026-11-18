import { tn } from "./lib/formality";
import { Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import { functionErrorMessage } from "./lib/function-error";
import { supabase } from "./lib/supabase";

type Kind = "onboarding" | "offboarding";
type Department = { id: string; name: string };
type DepartmentTask = {
  id: string;
  kind: Kind;
  departmentId: string;
  title: string;
  dueOffsetDays: number;
  active: boolean;
};

const KIND_LABEL: Record<Kind, string> = {
  onboarding: "Eintritt",
  offboarding: "Austritt",
};

function offsetLabel(days: number, kind: Kind) {
  const reference = kind === "offboarding" ? "Austritt" : "Eintritt";
  if (days === 0) return `am Tag des ${reference}s`;
  return days < 0
    ? `${-days} Tage vor dem ${reference}`
    : `${days} Tage nach dem ${reference}`;
}

/**
 * Defines which departments get which sub-tasks for every new onboarding or
 * offboarding. Members of the department can complete them.
 */
export function OnboardingDepartmentTasks({ tenantId }: { tenantId: string }) {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [tasks, setTasks] = useState<DepartmentTask[]>([]);
  const [kind, setKind] = useState<Kind>("onboarding");
  const [draft, setDraft] = useState({
    departmentId: "",
    title: "",
    dueOffsetDays: 0,
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!supabase) return;
    const { data, error: loadError } = await supabase.functions.invoke(
      "onboarding",
      { body: { type: "listDepartmentTasks", tenantId } },
    );
    if (loadError) {
      setError(
        await functionErrorMessage(
          loadError,
          "Die Abteilungsaufgaben konnten nicht geladen werden.",
        ),
      );
      return;
    }
    const payload = (data as { data?: unknown })?.data as
      { departments?: Department[]; tasks?: DepartmentTask[] } | undefined;
    setDepartments(payload?.departments ?? []);
    setTasks(payload?.tasks ?? []);
  }, [tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function call(body: Record<string, unknown>, fallback: string) {
    if (!supabase) return false;
    setPending(true);
    setError("");
    const { error: callError } = await supabase.functions.invoke("onboarding", {
      body: { tenantId, ...body },
    });
    setPending(false);
    if (callError) {
      setError(await functionErrorMessage(callError, fallback));
      return false;
    }
    await load();
    return true;
  }

  async function add(event: FormEvent) {
    event.preventDefault();
    if (!draft.departmentId || draft.title.trim().length < 2) return;
    const saved = await call(
      {
        type: "saveDepartmentTask",
        id: null,
        kind,
        departmentId: draft.departmentId,
        title: draft.title.trim(),
        dueOffsetDays: draft.dueOffsetDays,
        active: true,
      },
      "Die Teilaufgabe konnte nicht gespeichert werden.",
    );
    if (saved) setDraft({ ...draft, title: "" });
  }

  const visible = tasks.filter((task) => task.kind === kind);
  const grouped = departments
    .map((department) => ({
      department,
      tasks: visible.filter((task) => task.departmentId === department.id),
    }))
    .filter((group) => group.tasks.length > 0);

  return (
    <section
      aria-labelledby="onboarding-department-tasks-heading"
      className="onboarding__editor panel onboarding-department-tasks"
    >
      <div className="onboarding-department-tasks__heading">
        <div>
          <p className="eyebrow">KONFIGURATION</p>
          <h3 id="onboarding-department-tasks-heading">
            Teilaufgaben der Abteilungen
          </h3>
          <p className="onboarding__hint">
            {tn(
              "Lege fest, welche Abteilungen bei jedem neuen Ein- oder Austritt welche Aufgaben erhalten. Alle Mitglieder der Abteilung können ihre Aufgaben erledigen.",
              "Legen Sie fest, welche Abteilungen bei jedem neuen Ein- oder Austritt welche Aufgaben erhalten. Alle Mitglieder der Abteilung können ihre Aufgaben erledigen.",
            )}
          </p>
        </div>
        <div
          aria-label="Art"
          className="onboarding-department-tasks__switch"
          role="tablist"
        >
          {(Object.keys(KIND_LABEL) as Kind[]).map((value) => (
            <button
              aria-selected={kind === value}
              className={kind === value ? "is-active" : ""}
              key={value}
              onClick={() => setKind(value)}
              role="tab"
              type="button"
            >
              {KIND_LABEL[value]}
            </button>
          ))}
        </div>
      </div>
      {error ? (
        <p
          className="onboarding__message onboarding__message--error"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      {grouped.length ? (
        <div className="onboarding-department-tasks__groups">
          {grouped.map(({ department, tasks: departmentTasks }) => (
            <div key={department.id}>
              <h4>{department.name}</h4>
              <ul>
                {departmentTasks.map((task) => (
                  <li
                    className={task.active ? "" : "is-inactive"}
                    key={task.id}
                  >
                    <div>
                      <strong>{task.title}</strong>
                      <span>{offsetLabel(task.dueOffsetDays, task.kind)}</span>
                    </div>
                    <label className="onboarding-department-tasks__active">
                      <input
                        checked={task.active}
                        disabled={pending}
                        onChange={(event) =>
                          void call(
                            {
                              type: "saveDepartmentTask",
                              id: task.id,
                              kind: task.kind,
                              departmentId: task.departmentId,
                              title: task.title,
                              dueOffsetDays: task.dueOffsetDays,
                              active: event.target.checked,
                            },
                            "Die Teilaufgabe konnte nicht gespeichert werden.",
                          )
                        }
                        type="checkbox"
                      />
                      Aktiv
                    </label>
                    <button
                      aria-label={`${task.title} entfernen`}
                      className="icon-button"
                      disabled={pending}
                      onClick={() =>
                        void call(
                          { type: "deleteDepartmentTask", id: task.id },
                          "Die Teilaufgabe konnte nicht entfernt werden.",
                        )
                      }
                      type="button"
                    >
                      <Trash2 aria-hidden="true" size={16} />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : (
        <p className="onboarding__hint">
          Noch keine Teilaufgaben für den {KIND_LABEL[kind]} festgelegt.
        </p>
      )}
      <form className="onboarding-department-tasks__form" onSubmit={add}>
        <label>
          Abteilung
          <select
            required
            value={draft.departmentId}
            onChange={(event) =>
              setDraft({ ...draft, departmentId: event.target.value })
            }
          >
            <option value="">Abteilung wählen</option>
            {departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </select>
        </label>
        <label className="onboarding-department-tasks__title">
          Teilaufgabe
          <input
            maxLength={240}
            minLength={2}
            onChange={(event) =>
              setDraft({ ...draft, title: event.target.value })
            }
            placeholder={
              kind === "offboarding"
                ? "z. B. Schlüssel und Badge zurücknehmen"
                : "z. B. Arbeitsplatz einrichten"
            }
            required
            value={draft.title}
          />
        </label>
        <label>
          Fällig (Tage relativ)
          <input
            max={90}
            min={-60}
            onChange={(event) =>
              setDraft({ ...draft, dueOffsetDays: Number(event.target.value) })
            }
            type="number"
            value={draft.dueOffsetDays}
          />
        </label>
        <button className="primary-button" disabled={pending} type="submit">
          <Plus aria-hidden="true" size={16} /> Hinzufügen
        </button>
      </form>
      <p className="onboarding__hint">
        Gilt für neu geplante {KIND_LABEL[kind]}e. Bereits geplante bleiben
        unverändert.
      </p>
    </section>
  );
}
