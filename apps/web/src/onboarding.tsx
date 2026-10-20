import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  BadgeCheck,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Plus,
  RefreshCw,
  UserRound,
  Wrench,
} from "lucide-react";
import "./onboarding.css";
import { functionErrorMessage } from "./lib/function-error";
import { supabase } from "./lib/supabase";

type TaskStatus = "open" | "in_progress" | "blocked" | "completed";
type Person = { id: string; displayName: string };
type Template = { id: string; key: string; name: string };
type Task = {
  id: string;
  title: string;
  dueOn: string;
  responsibleName: string;
  status: TaskStatus;
  canUpdate: boolean;
  exception: { ticketNumber: string; reason: string } | null;
};
type Entry = {
  id: string;
  employeeName: string;
  startsOn: string;
  organisationUnit: string | null;
  location: string | null;
  managerName: string;
  ictResponsibleName: string;
  templateId: string;
  tasks: Task[];
};
type Workspace = {
  permissions: { canRequest: boolean; canManage: boolean };
  people: Person[];
  templates: Template[];
  entries: Entry[];
};
const statuses: Record<TaskStatus, string> = {
  open: "Offen",
  in_progress: "In Arbeit",
  blocked: "Blockiert",
  completed: "Erledigt",
};
const emptyDraft = () => ({
  employeeName: "",
  startsOn: new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Zurich",
  }).format(new Date()),
  organisationUnit: "",
  location: "",
  managerUserId: "",
  ictResponsibleUserId: "",
  templateId: "",
});
function isWorkspace(value: unknown): value is Workspace {
  return Boolean(
    value &&
    typeof value === "object" &&
    Array.isArray((value as Workspace).entries) &&
    Array.isArray((value as Workspace).people) &&
    Array.isArray((value as Workspace).templates),
  );
}
function dateLabel(value: string) {
  return new Intl.DateTimeFormat("de-CH", {
    timeZone: "Europe/Zurich",
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00Z`));
}
function progress(tasks: Task[]) {
  const done = tasks.filter((task) => task.status === "completed").length;
  return {
    done,
    total: tasks.length,
    percent: tasks.length ? Math.round((done / tasks.length) * 100) : 0,
  };
}

export function Onboarding({ tenantId }: { tenantId: string }) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [editor, setEditor] = useState(false);
  const [notice, setNotice] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [draft, setDraft] = useState(emptyDraft);
  const [exceptionTarget, setExceptionTarget] = useState<{
    entryId: string;
    taskId: string;
    taskTitle: string;
  } | null>(null);
  const [ticketNumber, setTicketNumber] = useState("");
  const [exceptionReason, setExceptionReason] = useState("");
  const load = async (preserve = false) => {
    if (!supabase) return;
    setLoading(true);
    if (!preserve) setErrorMessage("");
    try {
      const { data, error } = await supabase.functions.invoke("onboarding", {
        body: { type: "listWorkspace", tenantId },
      });
      if (error) throw error;
      const value =
        data && typeof data === "object"
          ? (data as { data?: unknown }).data
          : null;
      if (!isWorkspace(value)) throw new Error("invalid_onboarding_workspace");
      setWorkspace(value);
    } catch (error) {
      setErrorMessage(
        await functionErrorMessage(
          error,
          "Die Eintritte konnten nicht geladen werden. Bitte versuchen Sie es erneut.",
        ),
      );
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, [tenantId]);
  useEffect(() => {
    if (!workspace) return;
    setDraft((current) => ({
      ...current,
      templateId: current.templateId || workspace.templates[0]?.id || "",
    }));
  }, [workspace]);
  const counts = useMemo(() => {
    const entries = workspace?.entries ?? [];
    const tasks = entries.flatMap((entry) => entry.tasks);
    return {
      entries: entries.length,
      due: tasks.filter(
        (task) =>
          task.status !== "completed" &&
          task.dueOn <=
            new Intl.DateTimeFormat("en-CA", {
              timeZone: "Europe/Zurich",
            }).format(new Date()),
      ).length,
      completed: tasks.filter((task) => task.status === "completed").length,
    };
  }, [workspace]);
  async function createEntry(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    if (
      !draft.employeeName.trim() ||
      !draft.startsOn ||
      !draft.managerUserId ||
      !draft.ictResponsibleUserId ||
      !draft.templateId
    ) {
      setErrorMessage(
        "Bitte füllen Sie Name, Eintrittsdatum, Führungsperson, ICT-Verantwortung und Vorlage aus.",
      );
      return;
    }
    setPending(true);
    setErrorMessage("");
    try {
      const { error } = await supabase.functions.invoke("onboarding", {
        body: {
          type: "createEntry",
          tenantId,
          employeeName: draft.employeeName,
          startsOn: draft.startsOn,
          organisationUnit: draft.organisationUnit.trim() || null,
          location: draft.location.trim() || null,
          managerUserId: draft.managerUserId,
          ictResponsibleUserId: draft.ictResponsibleUserId,
          templateId: draft.templateId,
        },
      });
      if (error) throw error;
      setDraft(emptyDraft());
      setEditor(false);
      setNotice(
        "Der Eintritt wurde geplant. Die Aufgaben sind relativ zum Eintrittsdatum terminiert.",
      );
      await load(true);
    } catch (error) {
      setErrorMessage(
        await functionErrorMessage(
          error,
          "Der Eintritt konnte nicht erstellt werden. Bitte versuchen Sie es erneut.",
        ),
      );
    } finally {
      setPending(false);
    }
  }
  async function changeTask(taskId: string, status: TaskStatus) {
    if (!supabase) return;
    setPending(true);
    setErrorMessage("");
    try {
      const { error } = await supabase.functions.invoke("onboarding", {
        body: { type: "updateTaskStatus", tenantId, taskId, status },
      });
      if (error) throw error;
      await load(true);
    } catch (error) {
      setErrorMessage(
        await functionErrorMessage(
          error,
          "Der Aufgabenstatus konnte nicht aktualisiert werden.",
        ),
      );
    } finally {
      setPending(false);
    }
  }
  async function linkException(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !exceptionTarget) return;
    setPending(true);
    setErrorMessage("");
    try {
      const { error } = await supabase.functions.invoke("onboarding", {
        body: {
          type: "linkExceptionTicket",
          tenantId,
          entryId: exceptionTarget.entryId,
          taskId: exceptionTarget.taskId,
          ticketNumber,
          reason: exceptionReason,
        },
      });
      if (error) throw error;
      setNotice(
        "Das Ausnahmeticket wurde mit der Onboarding-Aufgabe verknüpft.",
      );
      setExceptionTarget(null);
      setTicketNumber("");
      setExceptionReason("");
      await load(true);
    } catch (error) {
      setErrorMessage(
        await functionErrorMessage(
          error,
          "Das Ausnahmeticket konnte nicht verknüpft werden.",
        ),
      );
    } finally {
      setPending(false);
    }
  }
  if (loading && !workspace)
    return (
      <section className="onboarding panel" aria-busy="true">
        <p className="empty-state">Eintritte werden geladen …</p>
      </section>
    );
  const entries = workspace?.entries ?? [];
  const canRequest = workspace?.permissions.canRequest ?? false;
  return (
    <section className="onboarding" aria-labelledby="onboarding-heading">
      <header className="onboarding__hero panel">
        <div>
          <p className="eyebrow">Planung statt Ticket</p>
          <h2 id="onboarding-heading">Eintritte</h2>
          <p>
            Neue Mitarbeitende werden mit klaren Verantwortlichkeiten
            vorbereitet. Tickets entstehen nur bewusst bei Ausnahmen oder
            Verzögerungen.
          </p>
        </div>
        <div className="onboarding__actions">
          <button
            className="secondary-button"
            onClick={() => void load()}
            disabled={loading}
            type="button"
          >
            <RefreshCw size={16} /> Aktualisieren
          </button>
          {canRequest ? (
            <button
              className="primary-button"
              onClick={() => setEditor(true)}
              type="button"
            >
              <Plus size={17} /> Eintritt planen
            </button>
          ) : null}
        </div>
      </header>
      <div className="onboarding__metrics">
        <article>
          <UserRound size={18} />
          <span>Geplante Eintritte</span>
          <strong>{counts.entries}</strong>
        </article>
        <article>
          <CalendarDays size={18} />
          <span>Offene Fälligkeiten</span>
          <strong>{counts.due}</strong>
        </article>
        <article>
          <CheckCircle2 size={18} />
          <span>Erledigte Aufgaben</span>
          <strong>{counts.completed}</strong>
        </article>
      </div>
      {errorMessage ? (
        <p
          className="onboarding__message onboarding__message--error"
          role="alert"
        >
          {errorMessage}
        </p>
      ) : null}
      {notice ? (
        <p
          className="onboarding__message onboarding__message--success"
          role="status"
        >
          {notice}
        </p>
      ) : null}
      {editor && canRequest ? (
        <section className="onboarding__editor panel">
          <div>
            <p className="eyebrow">Neuer Eintritt</p>
            <h3>Onboarding planen</h3>
          </div>
          <form onSubmit={createEntry}>
            <div className="onboarding__grid">
              <label>
                Name
                <input
                  required
                  minLength={2}
                  maxLength={160}
                  value={draft.employeeName}
                  onChange={(event) =>
                    setDraft({ ...draft, employeeName: event.target.value })
                  }
                  placeholder="Vor- und Nachname"
                />
              </label>
              <label>
                Eintrittsdatum
                <input
                  required
                  type="date"
                  value={draft.startsOn}
                  onChange={(event) =>
                    setDraft({ ...draft, startsOn: event.target.value })
                  }
                />
              </label>
              <label>
                Abteilung / Angebot
                <input
                  required
                  minLength={2}
                  maxLength={160}
                  value={draft.organisationUnit}
                  onChange={(event) =>
                    setDraft({ ...draft, organisationUnit: event.target.value })
                  }
                  placeholder="z. B. Schule oder ICT"
                />
              </label>
              <label>
                Standort
                <input
                  required
                  minLength={2}
                  maxLength={160}
                  value={draft.location}
                  onChange={(event) =>
                    setDraft({ ...draft, location: event.target.value })
                  }
                  placeholder="Optional"
                />
              </label>
              <label>
                Führungsperson
                <select
                  required
                  value={draft.managerUserId}
                  onChange={(event) =>
                    setDraft({ ...draft, managerUserId: event.target.value })
                  }
                >
                  <option value="">Person auswählen …</option>
                  {workspace?.people.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.displayName}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                ICT-Verantwortung
                <select
                  required
                  value={draft.ictResponsibleUserId}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      ictResponsibleUserId: event.target.value,
                    })
                  }
                >
                  <option value="">Person auswählen …</option>
                  {workspace?.people.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.displayName}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Onboarding-Vorlage
                <select
                  required
                  value={draft.templateId}
                  onChange={(event) =>
                    setDraft({ ...draft, templateId: event.target.value })
                  }
                >
                  {workspace?.templates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="onboarding__hint">
              Die Aufgaben werden jetzt einmalig relativ zum Eintrittsdatum
              terminiert. Es gibt keinen Scheduler und keine automatische
              Ticketanlage.
            </p>
            <div className="onboarding__actions">
              <button
                className="secondary-button"
                onClick={() => setEditor(false)}
                type="button"
              >
                Abbrechen
              </button>
              <button
                className="primary-button"
                disabled={pending}
                type="submit"
              >
                {pending ? "Wird geplant …" : "Eintritt planen"}
              </button>
            </div>
          </form>
        </section>
      ) : null}
      {exceptionTarget ? (
        <section
          className="onboarding__editor panel"
          aria-labelledby="onboarding-exception-heading"
        >
          <div>
            <p className="eyebrow">Bewusste Ausnahme</p>
            <h3 id="onboarding-exception-heading">Ausnahmeticket verknüpfen</h3>
          </div>
          <form onSubmit={linkException}>
            <p className="onboarding__hint">
              Erstellen Sie das Ticket zuerst bewusst im Bereich «Tickets».
              Danach verknüpfen Sie dessen Ticketnummer mit «
              {exceptionTarget.taskTitle}».
            </p>
            <div className="onboarding__grid">
              <label>
                Ticketnummer
                <input
                  required
                  minLength={2}
                  maxLength={80}
                  value={ticketNumber}
                  onChange={(event) => setTicketNumber(event.target.value)}
                  placeholder="z. B. ICT-2026-000123"
                />
              </label>
              <label>
                Grund der Ausnahme
                <input
                  required
                  minLength={3}
                  maxLength={500}
                  value={exceptionReason}
                  onChange={(event) => setExceptionReason(event.target.value)}
                  placeholder="z. B. Lieferverzögerung Gerät"
                />
              </label>
            </div>
            <div className="onboarding__actions">
              <button
                className="secondary-button"
                type="button"
                onClick={() => setExceptionTarget(null)}
              >
                Abbrechen
              </button>
              <button
                className="primary-button"
                disabled={pending}
                type="submit"
              >
                {pending ? "Wird verknüpft …" : "Ticket verknüpfen"}
              </button>
            </div>
          </form>
        </section>
      ) : null}
      <section className="onboarding__workspace panel">
        <div className="onboarding__workspace-heading">
          <div>
            <p className="eyebrow">Fortschritt</p>
            <h3>Meine sichtbaren Eintritte</h3>
          </div>
          <ClipboardList size={22} />
        </div>
        {entries.length ? (
          <div className="onboarding__list">
            {entries.map((entry) => {
              const state = progress(entry.tasks);
              return (
                <article className="onboarding__entry" key={entry.id}>
                  <header>
                    <div>
                      <h4>{entry.employeeName}</h4>
                      <p>
                        Eintritt am {dateLabel(entry.startsOn)}
                        {entry.organisationUnit
                          ? ` · ${entry.organisationUnit}`
                          : ""}
                        {entry.location ? ` · ${entry.location}` : ""}
                      </p>
                    </div>
                    <strong>
                      {state.done}/{state.total} erledigt
                    </strong>
                  </header>
                  <div
                    className="onboarding__progress"
                    aria-label={`${state.percent}% erledigt`}
                  >
                    <span style={{ width: `${state.percent}%` }} />
                  </div>
                  <dl>
                    <div>
                      <dt>Führung</dt>
                      <dd>{entry.managerName}</dd>
                    </div>
                    <div>
                      <dt>ICT</dt>
                      <dd>{entry.ictResponsibleName}</dd>
                    </div>
                  </dl>
                  <div className="onboarding__tasks">
                    {entry.tasks.map((task) => (
                      <div
                        className={`onboarding__task onboarding__task--${task.status}`}
                        key={task.id}
                      >
                        <div>
                          <strong>{task.title}</strong>
                          <span>
                            Fällig {dateLabel(task.dueOn)} ·{" "}
                            {task.responsibleName}
                          </span>
                          {task.exception ? (
                            <small>
                              Ausnahmeticket {task.exception.ticketNumber}{" "}
                              verknüpft
                            </small>
                          ) : null}
                        </div>
                        {task.canUpdate ? (
                          <label>
                            <span className="sr-only">
                              Status für {task.title}
                            </span>
                            <select
                              value={task.status}
                              disabled={pending}
                              onChange={(event) =>
                                void changeTask(
                                  task.id,
                                  event.target.value as TaskStatus,
                                )
                              }
                            >
                              {Object.entries(statuses).map(([key, label]) => (
                                <option key={key} value={key}>
                                  {label}
                                </option>
                              ))}
                            </select>
                          </label>
                        ) : (
                          <em>{statuses[task.status]}</em>
                        )}
                        {task.canUpdate && !task.exception ? (
                          <button
                            className="text-button"
                            disabled={pending}
                            onClick={() =>
                              setExceptionTarget({
                                entryId: entry.id,
                                taskId: task.id,
                                taskTitle: task.title,
                              })
                            }
                            type="button"
                          >
                            Ausnahmeticket
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                  <p className="onboarding__exception">
                    <Wrench size={15} /> Bei einer Ausnahme oder Verzögerung
                    wird ein Ticket bewusst im Bereich «Tickets» erstellt und
                    danach mit diesem Eintritt verknüpft; aus dem Onboarding
                    entstehen nie automatisch Tickets.
                  </p>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="onboarding__empty">
            <BadgeCheck size={25} />
            <div>
              <strong>Noch keine Eintritte sichtbar</strong>
              <p>
                Planen Sie einen Eintritt, damit Zuständigkeiten und
                Fälligkeiten vorbereitet sind.
              </p>
            </div>
          </div>
        )}
      </section>
    </section>
  );
}
