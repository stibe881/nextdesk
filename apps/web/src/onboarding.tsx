import { useEffect, useMemo, useState, type FormEvent } from "react";
import { OnboardingDepartmentTasks } from "./onboarding-department-tasks";
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
  departmentId?: string | null;
  departmentName?: string | null;
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
  kind?: "onboarding" | "offboarding";
  source?: "email" | "manual";
  sourceTicketNumber?: string | null;
  details?: Record<string, unknown>;
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
  kind: "onboarding" as "onboarding" | "offboarding",
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
const detailText = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;
const yesNo = (value: unknown): string | null =>
  typeof value === "boolean" ? (value ? "Ja" : "Nein") : null;

/** Angaben aus der Eintrittsmeldung der Personal-App als Beschriftung/Wert. */
function entryDetailRows(
  details: Record<string, unknown> | undefined,
): { label: string; value: string }[] {
  if (!details) return [];
  const functions = Array.isArray(details.functions)
    ? (details.functions as Record<string, unknown>[])
    : [];
  const rows: { label: string; value: string | null }[] = [
    { label: "Ausgefüllt von", value: detailText(details.filledBy) },
    { label: "Berufsbezeichnung", value: detailText(details.jobTitle) },
    { label: "Vorgesetzte Person", value: detailText(details.supervisor) },
    { label: "Geschlecht", value: detailText(details.gender) },
    ...functions.map((entry, index) => ({
      label: `Funktion ${index + 1}`,
      value:
        [entry.offer, entry.team, entry.role, entry.special]
          .map(detailText)
          .filter(Boolean)
          .join(" · ") || null,
    })),
    {
      label: "Anstellung",
      value:
        details.fixedTerm === true
          ? `befristet${detailText(details.endDate) ? ` bis ${dateLabel(String(details.endDate))}` : ""}`
          : details.fixedTerm === false
            ? "unbefristet"
            : null,
    },
    { label: "Raum", value: detailText(details.room) },
    { label: "Schlüssel", value: yesNo(details.needsKey) },
    { label: "ICT-Ausstattung", value: detailText(details.ictEquipment) },
    { label: "ICT-Zugänge", value: detailText(details.ictAccess) },
    { label: "Gruppenpostfächer", value: detailText(details.groupMailboxes) },
    {
      label: "Doppelname",
      value:
        details.doubleName === true
          ? (detailText(details.aliasName) ?? "Ja")
          : null,
    },
    { label: "Bemerkung", value: detailText(details.remarks) },
  ];
  return rows.filter(
    (row): row is { label: string; value: string } => row.value !== null,
  );
}
function departmentProgress(tasks: Task[]) {
  const groups = new Map<
    string,
    { name: string; done: number; total: number }
  >();
  for (const task of tasks) {
    if (!task.departmentName) continue;
    const group = groups.get(task.departmentName) ?? {
      name: task.departmentName,
      done: 0,
      total: 0,
    };
    group.total += 1;
    if (task.status === "completed") group.done += 1;
    groups.set(task.departmentName, group);
  }
  return [...groups.values()];
}

function progress(tasks: Task[]) {
  const done = tasks.filter((task) => task.status === "completed").length;
  return {
    done,
    total: tasks.length,
    percent: tasks.length ? Math.round((done / tasks.length) * 100) : 0,
  };
}

export function Onboarding({
  focusEntryId,
  tenantId,
}: {
  focusEntryId?: string | undefined;
  tenantId: string;
}) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [editor, setEditor] = useState(false);
  const [departmentConfig, setDepartmentConfig] = useState(false);
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
        body: {
          type: "listWorkspace",
          tenantId,
          ...(focusEntryId ? { focusEntryId } : {}),
        },
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
  }, [focusEntryId, tenantId]);
  useEffect(() => {
    if (
      !focusEntryId ||
      !workspace?.entries.some((entry) => entry.id === focusEntryId)
    ) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      document
        .getElementById(`onboarding-entry-${focusEntryId}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusEntryId, workspace?.entries]);
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
          kind: draft.kind,
        },
      });
      if (error) throw error;
      setDraft(emptyDraft());
      setEditor(false);
      setNotice(
        draft.kind === "offboarding"
          ? "Der Austritt wurde geplant. Die Aufgaben sind relativ zum Austrittsdatum terminiert."
          : "Der Eintritt wurde geplant. Die Aufgaben sind relativ zum Eintrittsdatum terminiert.",
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
          <h2 id="onboarding-heading">Eintritte & Austritte</h2>
          <p>
            Ein- und Austritte werden mit klaren Verantwortlichkeiten
            vorbereitet. Die beteiligten Abteilungen erhalten ihre Teilaufgaben
            automatisch. Tickets entstehen nur bewusst bei Ausnahmen oder
            Verzögerungen.
          </p>
        </div>
        <div className="onboarding__actions">
          {canRequest ? (
            <button
              className="primary-button"
              onClick={() => setEditor(true)}
              type="button"
            >
              <Plus size={17} /> Eintritt oder Austritt planen
            </button>
          ) : null}
          {workspace?.permissions.canManage ? (
            <button
              className="secondary-button"
              onClick={() => setDepartmentConfig((current) => !current)}
              type="button"
            >
              Abteilungsaufgaben
            </button>
          ) : null}
        </div>
      </header>
      {departmentConfig && workspace?.permissions.canManage ? (
        <OnboardingDepartmentTasks tenantId={tenantId} />
      ) : null}
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
                Art
                <select
                  value={draft.kind}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      kind:
                        event.target.value === "offboarding"
                          ? "offboarding"
                          : "onboarding",
                    })
                  }
                >
                  <option value="onboarding">Eintritt</option>
                  <option value="offboarding">Austritt</option>
                </select>
              </label>
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
                {draft.kind === "offboarding"
                  ? "Austrittsdatum"
                  : "Eintrittsdatum"}
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
                <article
                  className={`onboarding__entry${focusEntryId === entry.id ? " global-search-target" : ""}`}
                  id={`onboarding-entry-${entry.id}`}
                  key={entry.id}
                >
                  <header>
                    <div>
                      <h4>
                        {entry.employeeName}{" "}
                        <span
                          className={`onboarding__kind onboarding__kind--${entry.kind ?? "onboarding"}`}
                        >
                          {entry.kind === "offboarding"
                            ? "Austritt"
                            : "Eintritt"}
                        </span>
                      </h4>
                      <p>
                        {entry.kind === "offboarding" ? "Austritt" : "Eintritt"}{" "}
                        am {dateLabel(entry.startsOn)}
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
                  {departmentProgress(entry.tasks).length ? (
                    <ul
                      aria-label="Fortschritt pro Abteilung"
                      className="onboarding__departments"
                    >
                      {departmentProgress(entry.tasks).map((department) => (
                        <li
                          className={
                            department.done === department.total
                              ? "is-done"
                              : ""
                          }
                          key={department.name}
                        >
                          <span>{department.name}</span>
                          <span
                            aria-hidden="true"
                            className="onboarding__department-bar"
                          >
                            <span
                              style={{
                                width: `${Math.round((department.done / department.total) * 100)}%`,
                              }}
                            />
                          </span>
                          <strong>
                            {department.done}/{department.total}
                          </strong>
                        </li>
                      ))}
                    </ul>
                  ) : null}
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
                  {entry.source === "email" ? (
                    <details className="onboarding__details">
                      <summary>
                        Angaben aus der Eintrittsmeldung
                        {entry.sourceTicketNumber
                          ? ` (E-Mail ${entry.sourceTicketNumber})`
                          : ""}
                      </summary>
                      <dl>
                        {entryDetailRows(entry.details).map((row) => (
                          <div key={row.label}>
                            <dt>{row.label}</dt>
                            <dd>{row.value}</dd>
                          </div>
                        ))}
                      </dl>
                    </details>
                  ) : null}
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
