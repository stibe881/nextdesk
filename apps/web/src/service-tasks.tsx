import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { functionErrorMessage } from "./lib/function-error";
import { supabase } from "./lib/supabase";
import {
  FormCard,
  FormChips,
  FormField,
  FormGrid,
  FormLayout,
  FormNote,
  FormSummary,
  FormSwitch,
} from "./form-kit";
import "./service-tasks.css";

type Access = { canRead: boolean; canExecute: boolean; canManage: boolean };
type Person = {
  id: string;
  name: string;
  /** Nur im Verzeichnis: Abteilungen und Teams der Person. */
  departmentIds?: string[];
  teamIds?: string[];
  /** Nur bei Teams: zugehörige Abteilung. */
  departmentId?: string | null;
};
type CheckItem = {
  id: string;
  label: string;
  done: boolean;
  doneAt: string | null;
  doneBy: string | null;
  doneByName: string | null;
};
type Occurrence = {
  id: string;
  templateId: string;
  title: string;
  category: string | null;
  priority: string;
  instructions: string | null;
  referenceLabel: string | null;
  estimatedMinutes: number | null;
  requireNote: boolean;
  ruleText: string;
  dueOn: string;
  dueAt: string;
  status: "open" | "in_progress" | "done" | "skipped";
  overdue: boolean;
  assignee: Person | null;
  checklist: CheckItem[];
  checklistDone: number;
  checklistTotal: number;
  note: string | null;
  skippedReason: string | null;
  completedAt: string | null;
  completedBy: string | null;
  projected?: boolean;
};
type Overview = {
  today: string;
  kpis: {
    overdue: number;
    dueToday: number;
    thisWeek: number;
    weekMinutes: number;
    fulfillment: { onTime: number; total: number; percent: number | null };
  };
  overdue: Occurrence[];
  dueToday: Occurrence[];
  upcoming: Occurrence[];
  done: Occurrence[];
  week: { date: string; count: number }[];
  categories: { name: string; count: number }[];
  templateCount: number;
  people: Person[];
  teams: Person[];
  departments: Person[];
  access: Access;
};
type Rule = {
  frequency: "daily" | "weekly" | "monthly" | "yearly" | "interval";
  interval: number;
  weekdays?: number[];
  monthlyMode?: "day" | "nth_weekday" | "first_workday" | "last_workday";
  dayOfMonth?: number;
  nth?: number;
  weekday?: number;
  month?: number;
  skipNonWorkdays: boolean;
};
type Template = {
  id: string;
  title: string;
  instructions: string | null;
  category: string | null;
  priority: string;
  assigneeId: string | null;
  teamId: string | null;
  departmentId: string | null;
  referenceLabel: string | null;
  estimatedMinutes: number | null;
  recurrence: Rule;
  startsOn: string;
  endsOn: string | null;
  dueTime: string;
  leadDays: number;
  checklist: { id: string; label: string }[];
  requireNote: boolean;
  remind: boolean;
  escalateAfterDays: number | null;
  active: boolean;
  ruleText: string;
  nextDates: string[];
};
type Detail = {
  occurrence: Occurrence;
  template: Template | null;
  nextDueOn: string | null;
  history: Occurrence[];
  events: {
    id: string;
    event: string;
    actor: string | null;
    details: Record<string, unknown>;
    createdAt: string;
  }[];
};
type View = "overview" | "templates" | "calendar" | "form";
type Scope = "mine" | "team" | "all" | "done";

const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const WEEKDAY_NAMES = [
  "Montag",
  "Dienstag",
  "Mittwoch",
  "Donnerstag",
  "Freitag",
  "Samstag",
  "Sonntag",
];
const MONTHS = [
  "Januar",
  "Februar",
  "März",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Dezember",
];
const PRIORITIES: Record<string, string> = {
  low: "Niedrig",
  normal: "Normal",
  high: "Hoch",
  urgent: "Dringend",
};
const CATEGORY_SUGGESTIONS = [
  "Backup & Restore",
  "Updates & Patching",
  "Sicherheit",
  "Infrastruktur",
  "Konten & Rechte",
  "Drucker & Geräte",
];
const CATEGORY_COLORS = [
  "#6d8cf5",
  "#a78bfa",
  "#f472b6",
  "#34d399",
  "#fbbf24",
  "#38bdf8",
  "#fb923c",
];

async function call<T>(body: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error("Die Verbindung ist nicht konfiguriert.");
  const { data, error } = await supabase.functions.invoke<{ data: T }>(
    "service-tasks",
    { body },
  );
  if (error) {
    throw new Error(
      await functionErrorMessage(
        error,
        "Die Serviceaufgaben konnten nicht geladen werden.",
      ),
    );
  }
  if (!data || typeof data !== "object" || !("data" in data)) {
    throw new Error("Die Antwort ist unvollständig.");
  }
  return data.data;
}

export async function loadServiceTaskAccess(
  tenantId: string,
): Promise<Access | null> {
  try {
    return await call<Access>({ type: "access", tenantId });
  } catch {
    return null;
  }
}

function dateLabel(date: string, withWeekday = true): string {
  const value = new Date(`${date}T12:00:00Z`);
  return new Intl.DateTimeFormat("de-CH", {
    weekday: withWeekday ? "short" : undefined,
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(value);
}

function timeLabel(iso: string): string {
  return new Intl.DateTimeFormat("de-CH", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Zurich",
  }).format(new Date(iso));
}

function dateTimeLabel(iso: string): string {
  return new Intl.DateTimeFormat("de-CH", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Zurich",
  }).format(new Date(iso));
}

function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      86_400_000,
  );
}

function minutesLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} Min.`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} Std. ${rest} Min.` : `${hours} Std.`;
}

function initials(name: string): string {
  return name
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function categoryColor(name: string | null): string {
  if (!name) return "#94a3b8";
  let hash = 0;
  for (const character of name)
    hash = (hash * 31 + character.charCodeAt(0)) | 0;
  return CATEGORY_COLORS[Math.abs(hash) % CATEGORY_COLORS.length] ?? "#94a3b8";
}

function dueChip(occurrence: Occurrence, today: string) {
  if (occurrence.status === "done") return { text: "erledigt", tone: "good" };
  if (occurrence.status === "skipped") {
    return { text: "übersprungen", tone: "muted" };
  }
  if (occurrence.overdue) {
    const days = daysBetween(occurrence.dueOn, today);
    return {
      text:
        days <= 0
          ? "überfällig"
          : days === 1
            ? "seit 1 Tag"
            : `seit ${days} Tagen`,
      tone: "bad",
    };
  }
  if (occurrence.dueOn === today) {
    return { text: `bis ${timeLabel(occurrence.dueAt)}`, tone: "warn" };
  }
  return { text: dateLabel(occurrence.dueOn), tone: "muted" };
}

function TaskRow({
  occurrence,
  today,
  onOpen,
}: {
  occurrence: Occurrence;
  today: string;
  onOpen: () => void;
}) {
  const chip = dueChip(occurrence, today);
  const done = occurrence.status === "done";
  const progress = occurrence.checklistTotal
    ? Math.round((occurrence.checklistDone / occurrence.checklistTotal) * 100)
    : done
      ? 100
      : 0;
  const meta = [
    occurrence.ruleText,
    occurrence.referenceLabel,
    occurrence.checklistTotal
      ? `Checkliste ${occurrence.checklistDone}/${occurrence.checklistTotal}`
      : null,
    done && occurrence.completedBy && occurrence.completedAt
      ? `erledigt ${dateTimeLabel(occurrence.completedAt)} von ${occurrence.completedBy}`
      : null,
  ].filter(Boolean);
  return (
    <button className="st-row" onClick={onOpen} type="button">
      <span
        aria-hidden="true"
        className={`st-box${done ? " st-box--done" : ""}`}
      />
      <span className="st-row__copy">
        <strong className={done ? "st-done-title" : undefined}>
          {occurrence.title}
        </strong>
        <small>{meta.join(" · ")}</small>
      </span>
      <span className="st-progress" aria-hidden="true">
        <i
          style={{ width: `${progress}%` }}
          className={done ? "st-progress--done" : undefined}
        />
      </span>
      <span className={`st-chip st-chip--${chip.tone}`}>{chip.text}</span>
      <span
        className="st-avatar"
        title={occurrence.assignee?.name ?? "Nicht zugewiesen"}
      >
        {occurrence.assignee ? initials(occurrence.assignee.name) : "–"}
      </span>
    </button>
  );
}

function OverviewView({
  data,
  scope,
  onScope,
  onOpen,
}: {
  data: Overview;
  scope: Scope;
  onScope: (scope: Scope) => void;
  onOpen: (id: string) => void;
}) {
  const { kpis } = data;
  const sections =
    scope === "done"
      ? [
          {
            title: "Erledigt und übersprungen (30 Tage)",
            tone: "",
            items: data.done,
          },
        ]
      : [
          { title: "Überfällig", tone: "bad", items: data.overdue },
          { title: "Heute", tone: "warn", items: data.dueToday },
          { title: "Nächste Tage", tone: "", items: data.upcoming },
        ];
  const empty = sections.every((section) => section.items.length === 0);
  return (
    <>
      <div className="st-tabs" role="tablist" aria-label="Ansicht">
        {(
          [
            ["mine", "Meine Aufgaben"],
            ["team", "Mein Team"],
            ["all", "Alle"],
            ["done", "Erledigt"],
          ] as const
        ).map(([key, label]) => (
          <button
            aria-selected={scope === key}
            key={key}
            onClick={() => onScope(key)}
            role="tab"
            type="button"
          >
            {label}
          </button>
        ))}
      </div>
      <div className="st-kpis">
        {/* Nothing overdue or due today is good news: shown in green. */}
        <article
          className={`st-card st-kpi ${kpis.overdue === 0 ? "st-kpi--good" : "st-kpi--bad"}`}
        >
          <p>Überfällig</p>
          <strong>{kpis.overdue}</strong>
        </article>
        <article
          className={`st-card st-kpi ${kpis.dueToday === 0 ? "st-kpi--good" : "st-kpi--warn"}`}
        >
          <p>Heute fällig</p>
          <strong>{kpis.dueToday}</strong>
        </article>
        <article className="st-card st-kpi">
          <p>Diese Woche</p>
          <strong>{kpis.thisWeek}</strong>
          <small>
            {kpis.weekMinutes
              ? `geschätzt ${minutesLabel(kpis.weekMinutes)}`
              : "ohne Zeitschätzung"}
          </small>
        </article>
        <article className="st-card st-kpi st-kpi--good">
          <p>Erfüllungsquote 30 Tage</p>
          <strong>
            {kpis.fulfillment.percent === null
              ? "–"
              : `${kpis.fulfillment.percent} %`}
          </strong>
          <small>
            {kpis.fulfillment.total
              ? `${kpis.fulfillment.onTime} von ${kpis.fulfillment.total} termingerecht`
              : "noch keine fälligen Aufgaben"}
          </small>
        </article>
      </div>
      <div className="st-layout">
        <section className="st-card">
          {empty ? (
            <p className="st-empty">
              {scope === "done"
                ? "In den letzten 30 Tagen wurde nichts erledigt."
                : scope === "mine"
                  ? "Für dich stehen keine Serviceaufgaben an."
                  : "Es stehen keine Serviceaufgaben an."}
            </p>
          ) : (
            sections
              .filter((section) => section.items.length > 0)
              .map((section) => (
                <div className="st-section" key={section.title}>
                  <p className={`st-label st-label--${section.tone}`}>
                    {section.title}
                  </p>
                  {section.items.map((occurrence) => (
                    <TaskRow
                      key={occurrence.id}
                      occurrence={occurrence}
                      onOpen={() => onOpen(occurrence.id)}
                      today={data.today}
                    />
                  ))}
                </div>
              ))
          )}
        </section>
        <aside className="st-side">
          <section className="st-card">
            <p className="st-label">Diese Woche</p>
            <div className="st-week">
              {data.week.map((day, index) => (
                <div
                  className={`st-week__day${day.date === data.today ? " st-week__day--today" : ""}`}
                  key={day.date}
                >
                  <span>
                    {WEEKDAYS[index]} {Number(day.date.slice(8))}
                  </span>
                  <strong>{day.count}</strong>
                </div>
              ))}
            </div>
          </section>
          <section className="st-card">
            <p className="st-label">Nach Kategorie</p>
            {data.categories.length === 0 ? (
              <p className="st-muted">Keine offenen Aufgaben.</p>
            ) : (
              data.categories.map((category) => (
                <div className="st-category" key={category.name}>
                  <span>
                    <i style={{ background: categoryColor(category.name) }} />
                    {category.name}
                  </span>
                  <strong>{category.count}</strong>
                </div>
              ))
            )}
          </section>
        </aside>
      </div>
    </>
  );
}

const EVENT_LABELS: Record<string, string> = {
  start: "hat begonnen",
  toggleCheck: "hat die Checkliste bearbeitet",
  note_saved: "hat die Notiz gespeichert",
  completed: "hat abgeschlossen",
  skipped: "hat übersprungen",
  reopened: "hat wieder geöffnet",
  reschedule: "hat den Termin verschoben",
  assign: "hat die Zuständigkeit geändert",
  escalated: "Ans Team übergeben (überfällig)",
};

function DetailPanel({
  tenantId,
  occurrenceId,
  access,
  people,
  today,
  onClose,
  onChanged,
}: {
  tenantId: string;
  occurrenceId: string;
  access: Access;
  people: Person[];
  today: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [skipOpen, setSkipOpen] = useState(false);
  const [skipReason, setSkipReason] = useState("");

  useEffect(() => {
    let active = true;
    setDetail(null);
    call<Detail>({ type: "getOccurrence", tenantId, occurrenceId })
      .then((next) => {
        if (!active) return;
        setDetail(next);
        setNote(next.occurrence.note ?? "");
      })
      .catch((nextError) => {
        if (active) setError(nextError.message);
      });
    return () => {
      active = false;
    };
  }, [occurrenceId, tenantId]);

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      const next = await call<Detail>({
        type: "updateOccurrence",
        tenantId,
        occurrenceId,
        ...body,
      });
      setDetail(next);
      setNote(next.occurrence.note ?? "");
      setSkipOpen(false);
      onChanged();
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : String(nextError),
      );
    } finally {
      setBusy(false);
    }
  }

  const occurrence = detail?.occurrence;
  const open =
    occurrence?.status === "open" || occurrence?.status === "in_progress";
  const canWork = access.canExecute && open;
  const chip = occurrence ? dueChip(occurrence, today) : null;

  return (
    <div className="st-overlay" role="presentation" onClick={onClose}>
      <aside
        aria-label="Serviceaufgabe"
        className="st-panel"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          aria-label="Schliessen"
          className="st-panel__close"
          onClick={onClose}
          type="button"
        >
          ×
        </button>
        {!occurrence ? (
          <p className="st-muted">{error || "Wird geladen …"}</p>
        ) : (
          <>
            <p className="st-crumb">
              Serviceaufgabe · {dateLabel(occurrence.dueOn)}
            </p>
            <h2>{occurrence.title}</h2>
            <div className="st-chips">
              {chip ? (
                <span className={`st-chip st-chip--${chip.tone}`}>
                  {chip.text}
                </span>
              ) : null}
              {occurrence.category ? (
                <span className="st-chip st-chip--info">
                  {occurrence.category}
                </span>
              ) : null}
              <span className="st-chip">
                Priorität{" "}
                {PRIORITIES[occurrence.priority] ?? occurrence.priority}
              </span>
              {occurrence.referenceLabel ? (
                <span className="st-chip">{occurrence.referenceLabel}</span>
              ) : null}
              <span className="st-chip">{occurrence.ruleText}</span>
            </div>
            {error ? <p className="st-error">{error}</p> : null}
            <div className="st-actions">
              {canWork ? (
                <>
                  <button
                    className="st-button"
                    disabled={busy}
                    onClick={() => setSkipOpen((value) => !value)}
                    type="button"
                  >
                    Überspringen …
                  </button>
                  <button
                    className="st-button st-button--primary"
                    disabled={busy}
                    onClick={() => void act({ action: "complete", note })}
                    type="button"
                  >
                    Als erledigt abschliessen
                  </button>
                </>
              ) : null}
              {!open && access.canExecute ? (
                <button
                  className="st-button"
                  disabled={busy}
                  onClick={() => void act({ action: "reopen" })}
                  type="button"
                >
                  Wieder öffnen
                </button>
              ) : null}
            </div>
            {skipOpen ? (
              <div className="st-card st-skip">
                <label>
                  Grund fürs Überspringen
                  <input
                    maxLength={500}
                    onChange={(event) => setSkipReason(event.target.value)}
                    placeholder="z. B. kein Update verfügbar, Gerät ausser Betrieb"
                    value={skipReason}
                  />
                </label>
                <button
                  className="st-button"
                  disabled={busy || !skipReason.trim()}
                  onClick={() =>
                    void act({ action: "skip", reason: skipReason })
                  }
                  type="button"
                >
                  Überspringen bestätigen
                </button>
              </div>
            ) : null}
            {occurrence.status === "skipped" && occurrence.skippedReason ? (
              <p className="st-muted">
                Übersprungen: «{occurrence.skippedReason}»
              </p>
            ) : null}
            {occurrence.instructions ? (
              <section className="st-card">
                <p className="st-label">Anleitung</p>
                <p className="st-pre">{occurrence.instructions}</p>
              </section>
            ) : null}
            {occurrence.checklistTotal ? (
              <section className="st-card">
                <div className="st-between">
                  <p className="st-label">Checkliste</p>
                  <span className="st-muted">
                    {occurrence.checklistDone} von {occurrence.checklistTotal}
                  </span>
                </div>
                <span
                  className="st-progress st-progress--wide"
                  aria-hidden="true"
                >
                  <i
                    style={{
                      width: `${Math.round((occurrence.checklistDone / occurrence.checklistTotal) * 100)}%`,
                    }}
                  />
                </span>
                {occurrence.checklist.map((item) => (
                  <label
                    className={`st-check${item.done ? " st-check--done" : ""}`}
                    key={item.id}
                  >
                    <input
                      checked={item.done}
                      disabled={!canWork || busy}
                      onChange={(event) =>
                        void act({
                          action: "toggleCheck",
                          checkId: item.id,
                          done: event.target.checked,
                        })
                      }
                      type="checkbox"
                    />
                    <span>{item.label}</span>
                    {item.done && item.doneAt ? (
                      <small>
                        {item.doneByName
                          ? `${initials(item.doneByName)} · `
                          : ""}
                        {timeLabel(item.doneAt)}
                      </small>
                    ) : null}
                  </label>
                ))}
              </section>
            ) : null}
            <section className="st-card">
              <p className="st-label">
                Ergebnis &amp; Notiz{occurrence.requireNote ? " (Pflicht)" : ""}
              </p>
              <textarea
                disabled={!canWork || busy}
                maxLength={4000}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Was wurde gemacht? Auffälligkeiten?"
                rows={3}
                value={note}
              />
              {canWork && note !== (occurrence.note ?? "") ? (
                <button
                  className="st-button"
                  disabled={busy}
                  onClick={() => void act({ action: "saveNote", note })}
                  type="button"
                >
                  Notiz speichern
                </button>
              ) : null}
            </section>
            <section className="st-card">
              <p className="st-label">Details</p>
              <dl className="st-details">
                <dt>Fällig</dt>
                <dd>
                  {dateLabel(occurrence.dueOn)} · {timeLabel(occurrence.dueAt)}
                </dd>
                <dt>Verantwortlich</dt>
                <dd>
                  {access.canManage && open ? (
                    <select
                      disabled={busy}
                      onChange={(event) =>
                        void act({
                          action: "assign",
                          assigneeId: event.target.value || null,
                        })
                      }
                      value={occurrence.assignee?.id ?? ""}
                    >
                      <option value="">Nicht zugewiesen</option>
                      {people.map((person) => (
                        <option key={person.id} value={person.id}>
                          {person.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    (occurrence.assignee?.name ?? "Nicht zugewiesen")
                  )}
                </dd>
                {access.canManage && open ? (
                  <>
                    <dt>Termin verschieben</dt>
                    <dd>
                      <input
                        disabled={busy}
                        onChange={(event) =>
                          event.target.value &&
                          void act({
                            action: "reschedule",
                            dueOn: event.target.value,
                          })
                        }
                        type="date"
                        value={occurrence.dueOn}
                      />
                    </dd>
                  </>
                ) : null}
                {occurrence.estimatedMinutes ? (
                  <>
                    <dt>Geschätzt</dt>
                    <dd>{minutesLabel(occurrence.estimatedMinutes)}</dd>
                  </>
                ) : null}
                {detail?.nextDueOn ? (
                  <>
                    <dt>Nächster Termin</dt>
                    <dd>{dateLabel(detail.nextDueOn)}</dd>
                  </>
                ) : null}
              </dl>
            </section>
            {detail && detail.history.length ? (
              <section className="st-card">
                <p className="st-label">Verlauf dieser Aufgabe</p>
                {detail.history.map((entry) => {
                  const late =
                    entry.status === "done" &&
                    entry.completedAt &&
                    Date.parse(entry.completedAt) > Date.parse(entry.dueAt);
                  return (
                    <div className="st-history" key={entry.id}>
                      <span>{dateLabel(entry.dueOn, false)}</span>
                      <span>
                        {entry.status === "done"
                          ? `✔ erledigt${entry.completedBy ? ` · ${entry.completedBy}` : ""}`
                          : entry.status === "skipped"
                            ? `↷ übersprungen · «${entry.skippedReason ?? ""}»`
                            : entry.overdue
                              ? "offen, überfällig"
                              : "offen"}
                      </span>
                      <span
                        className={`st-chip st-chip--${
                          entry.status === "done"
                            ? late
                              ? "warn"
                              : "good"
                            : entry.status === "skipped"
                              ? "muted"
                              : "bad"
                        }`}
                      >
                        {entry.status === "done"
                          ? late
                            ? "zu spät"
                            : "termingerecht"
                          : entry.status === "skipped"
                            ? "übersprungen"
                            : "offen"}
                      </span>
                    </div>
                  );
                })}
              </section>
            ) : null}
            {detail && detail.events.length ? (
              <section className="st-card">
                <p className="st-label">Aktivität</p>
                {detail.events.map((event) => (
                  <p className="st-event" key={event.id}>
                    {dateTimeLabel(event.createdAt)} ·{" "}
                    {event.actor ? `${event.actor} ` : ""}
                    {EVENT_LABELS[event.event] ?? event.event}
                  </p>
                ))}
              </section>
            ) : null}
          </>
        )}
      </aside>
    </div>
  );
}

function emptyTemplate(today: string): Template {
  return {
    id: "",
    title: "",
    instructions: "",
    category: "",
    priority: "normal",
    assigneeId: null,
    teamId: null,
    departmentId: null,
    referenceLabel: "",
    estimatedMinutes: null,
    recurrence: {
      frequency: "monthly",
      interval: 1,
      monthlyMode: "first_workday",
      skipNonWorkdays: true,
    },
    startsOn: today,
    endsOn: null,
    dueTime: "16:00",
    leadDays: 3,
    checklist: [],
    requireNote: false,
    remind: true,
    escalateAfterDays: 2,
    active: true,
    ruleText: "",
    nextDates: [],
  };
}

function TemplateForm({
  tenantId,
  initial,
  people,
  teams,
  departments,
  onCancel,
  onSaved,
}: {
  tenantId: string;
  initial: Template;
  people: Person[];
  teams: Person[];
  departments: Person[];
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<Template>(() =>
    initial.departmentId || departments.length !== 1
      ? initial
      : { ...initial, departmentId: departments[0]?.id ?? null },
  );
  const [newCheck, setNewCheck] = useState("");
  const [preview, setPreview] = useState<{
    dates: string[];
    ruleText: string | null;
  }>({
    dates: initial.nextDates,
    ruleText: initial.ruleText || null,
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const rule = form.recurrence;
  const set = <K extends keyof Template>(key: K, value: Template[K]) =>
    setForm((current) => ({ ...current, [key]: value }));
  // Teams der Abteilung; Verantwortliche nur aus Abteilung und Team.
  const visibleTeams = teams.filter(
    (team) =>
      !form.departmentId ||
      !team.departmentId ||
      team.departmentId === form.departmentId ||
      team.id === form.teamId,
  );
  const eligiblePeople = people.filter(
    (person) =>
      person.id === form.assigneeId ||
      ((!form.departmentId ||
        (person.departmentIds ?? []).includes(form.departmentId)) &&
        (!form.teamId || (person.teamIds ?? []).includes(form.teamId))),
  );
  const changeDepartment = (departmentId: string | null) =>
    setForm((current) => {
      const team = teams.find((entry) => entry.id === current.teamId);
      const teamStays =
        !team ||
        !departmentId ||
        !team.departmentId ||
        team.departmentId === departmentId;
      const teamId = teamStays ? current.teamId : null;
      const assignee = people.find((entry) => entry.id === current.assigneeId);
      const assigneeStays =
        !assignee ||
        ((!departmentId ||
          (assignee.departmentIds ?? []).includes(departmentId)) &&
          (!teamId || (assignee.teamIds ?? []).includes(teamId)));
      return {
        ...current,
        departmentId,
        teamId,
        assigneeId: assigneeStays ? current.assigneeId : null,
      };
    });
  const changeTeam = (teamId: string | null) =>
    setForm((current) => {
      const assignee = people.find((entry) => entry.id === current.assigneeId);
      const assigneeStays =
        !assignee || !teamId || (assignee.teamIds ?? []).includes(teamId);
      return {
        ...current,
        teamId,
        assigneeId: assigneeStays ? current.assigneeId : null,
      };
    });
  const setRule = (patch: Partial<Rule>) =>
    setForm((current) => ({
      ...current,
      recurrence: { ...current.recurrence, ...patch },
    }));

  useEffect(() => {
    const timer = window.setTimeout(() => {
      call<{ dates: string[]; ruleText: string | null }>({
        type: "previewRule",
        tenantId,
        recurrence: form.recurrence,
        startsOn: form.startsOn,
      })
        .then(setPreview)
        .catch(() => setPreview({ dates: [], ruleText: null }));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [form.recurrence, form.startsOn, tenantId]);

  function frequency(next: Rule["frequency"]) {
    const base = { interval: 1, skipNonWorkdays: rule.skipNonWorkdays };
    if (next === "daily")
      setForm((c) => ({ ...c, recurrence: { ...base, frequency: next } }));
    if (next === "weekly") {
      setForm((c) => ({
        ...c,
        recurrence: { ...base, frequency: next, weekdays: [1] },
      }));
    }
    if (next === "monthly") {
      setForm((c) => ({
        ...c,
        recurrence: { ...base, frequency: next, monthlyMode: "first_workday" },
      }));
    }
    if (next === "yearly") {
      setForm((c) => ({
        ...c,
        recurrence: { ...base, frequency: next, month: 1, dayOfMonth: 15 },
      }));
    }
    if (next === "interval") {
      setForm((c) => ({
        ...c,
        recurrence: { ...base, frequency: next, interval: 42 },
      }));
    }
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      await call({
        type: "saveTemplate",
        tenantId,
        ...(form.id ? { templateId: form.id } : {}),
        title: form.title,
        instructions: form.instructions || null,
        category: form.category || null,
        priority: form.priority,
        assigneeId: form.assigneeId,
        teamId: form.teamId,
        departmentId: form.departmentId,
        referenceLabel: form.referenceLabel || null,
        estimatedMinutes: form.estimatedMinutes,
        recurrence: form.recurrence,
        startsOn: form.startsOn,
        endsOn: form.endsOn || null,
        dueTime: form.dueTime,
        leadDays: form.leadDays,
        checklist: form.checklist,
        requireNote: form.requireNote,
        remind: form.remind,
        escalateAfterDays: form.escalateAfterDays,
        active: form.active,
      });
      onSaved();
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : String(nextError),
      );
    } finally {
      setSaving(false);
    }
  }

  const monthlyValue =
    rule.monthlyMode === "nth_weekday"
      ? `nth:${rule.nth}:${rule.weekday}`
      : rule.monthlyMode === "day"
        ? `day:${rule.dayOfMonth}`
        : (rule.monthlyMode ?? "first_workday");

  return (
    <FormLayout
      side={
        <>
          <FormSummary
            eyebrow="Wiederholt sich"
            rows={[
              ["Rhythmus", preview.ruleText ?? "Wiederholung prüfen"],
              [
                "Dauer",
                form.estimatedMinutes ? `${form.estimatedMinutes} Min.` : "",
              ],
              [
                "Nächste Termine",
                preview.dates.length
                  ? preview.dates.map((date) => dateLabel(date)).join(" · ")
                  : "Keine Termine mit diesen Angaben.",
              ],
            ]}
            title={form.title}
          />
          {rule.skipNonWorkdays ? (
            <FormNote>Wochenenden und Feiertage werden übersprungen.</FormNote>
          ) : null}
        </>
      }
    >
      <FormCard title="Aufgabe">
        <FormGrid cols={2}>
          <FormField label="Titel" required>
            <input
              maxLength={160}
              onChange={(event) => set("title", event.target.value)}
              placeholder="z. B. Backup-Wiederherstellungstest"
              value={form.title}
            />
          </FormField>
          {departments.length > 1 ? (
            <FormField label="Abteilung">
              <select
                onChange={(event) =>
                  changeDepartment(event.target.value || null)
                }
                value={form.departmentId ?? ""}
              >
                <option disabled value="">
                  Abteilung wählen
                </option>
                {departments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
              </select>
            </FormField>
          ) : null}
          <FormField label="Team (Vertretung & Übergabe)">
            <select
              onChange={(event) => changeTeam(event.target.value || null)}
              value={form.teamId ?? ""}
            >
              <option value="">Kein Team</option>
              {visibleTeams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Verantwortlich">
            <select
              onChange={(event) =>
                set("assigneeId", event.target.value || null)
              }
              value={form.assigneeId ?? ""}
            >
              <option value="">Nicht zugewiesen</option>
              {eligiblePeople.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
          </FormField>
          <FormField
            hint={
              form.teamId
                ? "Ist die Aufgabe so lange überfällig, geht sie vom Verantwortlichen ans Team."
                : "Wähle zuerst ein Team."
            }
            label="Ans Team übergeben nach (Tagen)"
          >
            <input
              disabled={!form.teamId}
              max={30}
              min={1}
              onChange={(event) =>
                set(
                  "escalateAfterDays",
                  event.target.value ? Number(event.target.value) : null,
                )
              }
              placeholder="leer = nie"
              type="number"
              value={form.escalateAfterDays ?? ""}
            />
          </FormField>
          <FormField label="Kategorie">
            <input
              list="service-task-categories"
              maxLength={60}
              onChange={(event) => set("category", event.target.value)}
              value={form.category ?? ""}
            />
            <datalist id="service-task-categories">
              {CATEGORY_SUGGESTIONS.map((category) => (
                <option key={category} value={category} />
              ))}
            </datalist>
          </FormField>
          <FormField label="Priorität">
            <select
              onChange={(event) => set("priority", event.target.value)}
              value={form.priority}
            >
              {Object.entries(PRIORITIES).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Geschätzte Dauer (Minuten)">
            <input
              min={1}
              max={1440}
              onChange={(event) =>
                set(
                  "estimatedMinutes",
                  event.target.value ? Number(event.target.value) : null,
                )
              }
              type="number"
              value={form.estimatedMinutes ?? ""}
            />
          </FormField>
        </FormGrid>
        <FormField label="Anleitung">
          <textarea
            maxLength={4000}
            onChange={(event) => set("instructions", event.target.value)}
            rows={3}
            value={form.instructions ?? ""}
          />
        </FormField>
      </FormCard>
      <FormCard title="Checkliste">
        {form.checklist.map((item, index) => (
          <div className="st-check-edit" key={item.id}>
            <input
              maxLength={300}
              onChange={(event) =>
                set(
                  "checklist",
                  form.checklist.map((entry) =>
                    entry.id === item.id
                      ? { ...entry, label: event.target.value }
                      : entry,
                  ),
                )
              }
              value={item.label}
            />
            <button
              aria-label="Nach oben"
              className="st-icon"
              disabled={index === 0}
              onClick={() => {
                const next = [...form.checklist];
                const above = next[index - 1];
                const current = next[index];
                if (!above || !current) return;
                next[index - 1] = current;
                next[index] = above;
                set("checklist", next);
              }}
              type="button"
            >
              ↑
            </button>
            <button
              aria-label="Entfernen"
              className="st-icon"
              onClick={() =>
                set(
                  "checklist",
                  form.checklist.filter((entry) => entry.id !== item.id),
                )
              }
              type="button"
            >
              ×
            </button>
          </div>
        ))}
        <div className="st-check-edit">
          <input
            maxLength={300}
            onChange={(event) => setNewCheck(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && newCheck.trim()) {
                event.preventDefault();
                set("checklist", [
                  ...form.checklist,
                  {
                    id: crypto.randomUUID().slice(0, 8),
                    label: newCheck.trim(),
                  },
                ]);
                setNewCheck("");
              }
            }}
            placeholder="Neuer Punkt, mit Enter hinzufügen"
            value={newCheck}
          />
          <button
            className="st-button"
            disabled={!newCheck.trim() || form.checklist.length >= 40}
            onClick={() => {
              set("checklist", [
                ...form.checklist,
                {
                  id: crypto.randomUUID().slice(0, 8),
                  label: newCheck.trim(),
                },
              ]);
              setNewCheck("");
            }}
            type="button"
          >
            + Punkt
          </button>
        </div>
      </FormCard>
      <FormCard title="Wiederholung">
        <FormChips
          label="Wiederholung"
          onChange={(next) => {
            const [key] = next;
            if (key) frequency(key);
          }}
          options={
            [
              { label: "Täglich", value: "daily" },
              { label: "Wöchentlich", value: "weekly" },
              { label: "Monatlich", value: "monthly" },
              { label: "Jährlich", value: "yearly" },
              { label: "Alle X Tage", value: "interval" },
            ] as const
          }
          value={[rule.frequency]}
        />
        {rule.frequency === "weekly" ? (
          <div className="st-days">
            {WEEKDAYS.map((label, index) => {
              const day = index + 1;
              const active = rule.weekdays?.includes(day) ?? false;
              return (
                <button
                  aria-pressed={active}
                  key={label}
                  onClick={() => {
                    const current = rule.weekdays ?? [];
                    const next = active
                      ? current.filter((value) => value !== day)
                      : [...current, day];
                    if (next.length) setRule({ weekdays: next });
                  }}
                  type="button"
                >
                  {label}
                </button>
              );
            })}
          </div>
        ) : null}
        {rule.frequency === "monthly" ? (
          <FormField label="Am">
            <select
              onChange={(event) => {
                const value = event.target.value;
                if (value === "first_workday" || value === "last_workday") {
                  setRule({ monthlyMode: value });
                } else if (value.startsWith("day:")) {
                  setRule({
                    monthlyMode: "day",
                    dayOfMonth: Number(value.slice(4)),
                  });
                } else {
                  const [, nth, weekday] = value.split(":");
                  setRule({
                    monthlyMode: "nth_weekday",
                    nth: Number(nth),
                    weekday: Number(weekday),
                  });
                }
              }}
              value={monthlyValue}
            >
              <option value="first_workday">1. Werktag des Monats</option>
              <option value="last_workday">Letzter Werktag des Monats</option>
              <optgroup label="Bestimmter Tag">
                {Array.from({ length: 31 }, (_, index) => (
                  <option key={index} value={`day:${index + 1}`}>
                    am {index + 1}.
                  </option>
                ))}
              </optgroup>
              <optgroup label="Bestimmter Wochentag">
                {[1, 2, 3, 4, -1].flatMap((nth) =>
                  WEEKDAY_NAMES.slice(0, 5).map((name, index) => (
                    <option
                      key={`${nth}-${index}`}
                      value={`nth:${nth}:${index + 1}`}
                    >
                      {nth === -1 ? "letzter" : `${nth}.`} {name}
                    </option>
                  )),
                )}
              </optgroup>
            </select>
          </FormField>
        ) : null}
        {rule.frequency === "yearly" ? (
          <FormGrid cols={2}>
            <FormField label="Tag">
              <input
                max={31}
                min={1}
                onChange={(event) =>
                  setRule({ dayOfMonth: Number(event.target.value) || 1 })
                }
                type="number"
                value={rule.dayOfMonth ?? 1}
              />
            </FormField>
            <FormField label="Monat">
              <select
                onChange={(event) =>
                  setRule({ month: Number(event.target.value) })
                }
                value={rule.month ?? 1}
              >
                {MONTHS.map((month, index) => (
                  <option key={month} value={index + 1}>
                    {month}
                  </option>
                ))}
              </select>
            </FormField>
          </FormGrid>
        ) : null}
        {rule.frequency !== "yearly" ? (
          <FormField
            label={
              rule.frequency === "interval"
                ? "Alle … Tage"
                : rule.frequency === "daily"
                  ? "Alle … Tage"
                  : rule.frequency === "weekly"
                    ? "Alle … Wochen"
                    : "Alle … Monate"
            }
          >
            <input
              max={366}
              min={1}
              onChange={(event) =>
                setRule({ interval: Number(event.target.value) || 1 })
              }
              type="number"
              value={rule.interval}
            />
          </FormField>
        ) : null}
        <FormGrid cols={2}>
          <FormField label="Fällig bis">
            <input
              onChange={(event) => set("dueTime", event.target.value)}
              type="time"
              value={form.dueTime}
            />
          </FormField>
          <FormField label="Sichtbar ab (Tage vorher)">
            <input
              max={60}
              min={0}
              onChange={(event) =>
                set("leadDays", Number(event.target.value) || 0)
              }
              type="number"
              value={form.leadDays}
            />
          </FormField>
          <FormField label="Beginnt am">
            <input
              onChange={(event) => set("startsOn", event.target.value)}
              type="date"
              value={form.startsOn}
            />
          </FormField>
          <FormField label="Endet am">
            <input
              min={form.startsOn}
              onChange={(event) => set("endsOn", event.target.value || null)}
              type="date"
              value={form.endsOn ?? ""}
            />
          </FormField>
        </FormGrid>
        <FormSwitch
          checked={rule.skipNonWorkdays}
          hint="Feiertage nach Kalender CH, Kanton Zug."
          label="Wochenenden und Feiertage überspringen"
          onChange={(checked) => setRule({ skipNonWorkdays: checked })}
        />
      </FormCard>
      <FormCard title="Erledigung & Erinnerung">
        <FormSwitch
          checked={form.requireNote}
          label="Notiz beim Abschliessen verlangen"
          onChange={(checked) => set("requireNote", checked)}
        />
        <FormSwitch
          checked={form.remind}
          hint="Push an die verantwortliche Person."
          label="Erinnerung am Fälligkeitstag"
          onChange={(checked) => set("remind", checked)}
        />
      </FormCard>
      <FormCard collapsed title="Weitere Angaben">
        <FormField label="Bezug">
          <input
            maxLength={200}
            onChange={(event) => set("referenceLabel", event.target.value)}
            placeholder="z. B. Server SRV-FILE01"
            value={form.referenceLabel ?? ""}
          />
        </FormField>
      </FormCard>
      {error ? <p className="st-error">{error}</p> : null}
      <div className="st-actions st-actions--end">
        <button className="st-button" onClick={onCancel} type="button">
          Abbrechen
        </button>
        <button
          className="st-button st-button--primary"
          disabled={saving || !form.title.trim()}
          onClick={() => void save()}
          type="button"
        >
          {saving ? "Wird gespeichert …" : "Serviceaufgabe speichern"}
        </button>
      </div>
    </FormLayout>
  );
}

function TemplatesView({
  tenantId,
  canManage,
  onEdit,
  reloadKey,
}: {
  tenantId: string;
  canManage: boolean;
  onEdit: (
    template: Template,
    people: Person[],
    teams: Person[],
    departments: Person[],
  ) => void;
  reloadKey: number;
}) {
  const [state, setState] = useState<{
    templates: Template[];
    people: Person[];
    teams: Person[];
    departments: Person[];
  } | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(() => {
    call<{
      templates: Template[];
      people: Person[];
      teams: Person[];
      departments: Person[];
    }>({
      type: "listTemplates",
      tenantId,
    })
      .then(setState)
      .catch((nextError) => setError(nextError.message));
  }, [tenantId]);
  useEffect(load, [load, reloadKey]);
  if (error) return <p className="st-error">{error}</p>;
  if (!state) return <p className="st-muted">Vorlagen werden geladen …</p>;
  const peopleById = new Map(
    state.people.map((person) => [person.id, person.name]),
  );
  const departmentById = new Map(
    (state.departments ?? []).map((department) => [
      department.id,
      department.name,
    ]),
  );
  const showDepartment = (state.departments ?? []).length > 1;
  return (
    <section className="st-card">
      {state.templates.length === 0 ? (
        <p className="st-empty">Noch keine Serviceaufgaben angelegt.</p>
      ) : (
        state.templates.map((template) => (
          <div
            className={`st-template${template.active ? "" : " st-template--inactive"}`}
            key={template.id}
          >
            <i style={{ background: categoryColor(template.category) }} />
            <div>
              <strong>{template.title}</strong>
              <small>
                {[
                  template.ruleText,
                  showDepartment && template.departmentId
                    ? departmentById.get(template.departmentId)
                    : null,
                  template.category,
                  template.assigneeId
                    ? peopleById.get(template.assigneeId)
                    : "Nicht zugewiesen",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </small>
              <small>
                {template.active
                  ? template.nextDates.length
                    ? `Nächste: ${template.nextDates
                        .slice(0, 3)
                        .map((date) => dateLabel(date))
                        .join(", ")}`
                    : "Keine weiteren Termine"
                  : "Archiviert"}
              </small>
            </div>
            {canManage ? (
              <div className="st-actions">
                <button
                  className="st-button"
                  onClick={() =>
                    void call({
                      type: "setTemplateActive",
                      tenantId,
                      templateId: template.id,
                      active: !template.active,
                    }).then(load, (nextError) => setError(nextError.message))
                  }
                  type="button"
                >
                  {template.active ? "Archivieren" : "Reaktivieren"}
                </button>
                <button
                  className="st-button"
                  onClick={() =>
                    onEdit(
                      template,
                      state.people,
                      state.teams,
                      state.departments ?? [],
                    )
                  }
                  type="button"
                >
                  Bearbeiten
                </button>
              </div>
            ) : null}
          </div>
        ))
      )}
    </section>
  );
}

function CalendarView({
  tenantId,
  onOpen,
}: {
  tenantId: string;
  onOpen: (id: string) => void;
}) {
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
  const [data, setData] = useState<{
    from: string;
    today: string;
    entries: Occurrence[];
  } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setData(null);
    call<{ from: string; today: string; entries: Occurrence[] }>({
      type: "calendar",
      tenantId,
      month,
    })
      .then((next) => active && setData(next))
      .catch((nextError) => active && setError(nextError.message));
    return () => {
      active = false;
    };
  }, [month, tenantId]);
  const shift = (delta: number) => {
    const [year = 2026, monthIndex = 1] = month.split("-").map(Number);
    const date = new Date(Date.UTC(year, monthIndex - 1 + delta, 1));
    setMonth(
      `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`,
    );
  };
  const days = useMemo(() => {
    if (!data) return [];
    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(
        Date.parse(`${data.from}T00:00:00Z`) + index * 86_400_000,
      )
        .toISOString()
        .slice(0, 10);
      return {
        date,
        entries: data.entries.filter((entry) => entry.dueOn === date),
      };
    }).filter(
      (_, index, list) => index < 35 || list[35]?.date.slice(0, 7) === month,
    );
  }, [data, month]);
  const [year = 2026, monthIndex = 1] = month.split("-").map(Number);
  return (
    <>
      <div className="st-between st-calendar-head">
        <h2>
          {MONTHS[monthIndex - 1]} {year}
        </h2>
        <div className="st-actions">
          <button className="st-button" onClick={() => shift(-1)} type="button">
            ‹
          </button>
          <button
            className="st-button"
            onClick={() => {
              const now = new Date();
              setMonth(
                `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`,
              );
            }}
            type="button"
          >
            Heute
          </button>
          <button className="st-button" onClick={() => shift(1)} type="button">
            ›
          </button>
        </div>
      </div>
      {error ? <p className="st-error">{error}</p> : null}
      <div className="st-calendar">
        {WEEKDAYS.map((day) => (
          <span className="st-calendar__weekday" key={day}>
            {day}
          </span>
        ))}
        {days.map((day) => (
          <div
            className={`st-calendar__day${day.date.slice(0, 7) === month ? "" : " st-calendar__day--outside"}${day.date === data?.today ? " st-calendar__day--today" : ""}`}
            key={day.date}
          >
            <span>{Number(day.date.slice(8))}</span>
            {day.entries.map((entry) => (
              <button
                className={`st-calendar__entry${entry.status === "done" ? " st-calendar__entry--done" : ""}${entry.overdue ? " st-calendar__entry--overdue" : ""}`}
                disabled={entry.projected}
                key={entry.id}
                onClick={() => onOpen(entry.id)}
                style={{
                  ["--entry-color" as string]: categoryColor(entry.category),
                }}
                title={`${entry.title}${entry.assignee ? ` · ${entry.assignee.name}` : ""}`}
                type="button"
              >
                {entry.title}
              </button>
            ))}
          </div>
        ))}
      </div>
      <p className="st-muted">
        Termine nach den nächsten 60 Tagen sind eine Vorschau und werden
        automatisch angelegt.
      </p>
    </>
  );
}

export function ServiceTasks({
  tenantId,
  createRequestId,
  onCreateRequestConsumed,
  focusOccurrenceId,
  onFocusHandled,
}: {
  tenantId: string;
  createRequestId?: number | undefined;
  onCreateRequestConsumed?: (requestId: number) => void;

  focusOccurrenceId?: string | null;
  onFocusHandled?: () => void;
}) {
  const [view, setView] = useState<View>("overview");
  const [scope, setScope] = useState<Scope>("mine");
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{
    template: Template;
    people: Person[];
    teams: Person[];
    departments: Person[];
  } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const version = useRef(0);

  const load = useCallback(async () => {
    const current = ++version.current;
    setError("");
    try {
      const next = await call<Overview>({ type: "overview", tenantId, scope });
      if (version.current === current) setData(next);
    } catch (nextError) {
      if (version.current === current) {
        setError(
          nextError instanceof Error ? nextError.message : String(nextError),
        );
      }
    }
  }, [scope, tenantId]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  useEffect(() => {
    if (!focusOccurrenceId) return;
    setOpenId(focusOccurrenceId);
    onFocusHandled?.();
  }, [focusOccurrenceId, onFocusHandled]);

  const access = data?.access ?? {
    canRead: true,
    canExecute: false,
    canManage: false,
  };
  const today = data?.today ?? new Date().toISOString().slice(0, 10);
  // "+" menu: open a new service task once the data has loaded.
  const handledCreateRequest = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (
      createRequestId === undefined ||
      !data ||
      handledCreateRequest.current === createRequestId
    ) {
      return;
    }
    handledCreateRequest.current = createRequestId;
    onCreateRequestConsumed?.(createRequestId);
    if (!data.access.canManage) return;
    setEditing({
      template: emptyTemplate(data.today),
      people: data.people ?? [],
      teams: data.teams ?? [],
      departments: data.departments ?? [],
    });
    setView("form");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createRequestId, data]);

  return (
    <section className="service-tasks" aria-label="Serviceaufgaben">
      <header className="st-header">
        <p className="st-intro">
          Wiederkehrende Wartungs- und Kontrollaufgaben – automatisch fällig,
          mit Checkliste und Nachweis.
        </p>
        <div className="st-actions">
          {view !== "overview" ? (
            <button
              className="st-button"
              onClick={() => setView("overview")}
              type="button"
            >
              ‹ Übersicht
            </button>
          ) : null}
          <button
            aria-pressed={view === "calendar"}
            className="st-button"
            onClick={() => setView("calendar")}
            type="button"
          >
            Kalender
          </button>
          <button
            aria-pressed={view === "templates"}
            className="st-button"
            onClick={() => setView("templates")}
            type="button"
          >
            Vorlagen{data ? ` (${data.templateCount})` : ""}
          </button>
          {access.canManage ? (
            <button
              className="st-button st-button--primary"
              onClick={() => {
                setEditing({
                  template: emptyTemplate(today),
                  people: data?.people ?? [],
                  teams: data?.teams ?? [],
                  departments: data?.departments ?? [],
                });
                setView("form");
              }}
              type="button"
            >
              + Neue Serviceaufgabe
            </button>
          ) : null}
        </div>
      </header>
      {error ? <p className="st-error">{error}</p> : null}
      {view === "overview" ? (
        data ? (
          <OverviewView
            data={data}
            onOpen={setOpenId}
            onScope={setScope}
            scope={scope}
          />
        ) : !error ? (
          <p className="st-muted">Serviceaufgaben werden geladen …</p>
        ) : null
      ) : null}
      {view === "templates" ? (
        <TemplatesView
          canManage={access.canManage}
          onEdit={(template, people, teams, departments) => {
            setEditing({ template, people, teams, departments });
            setView("form");
          }}
          reloadKey={reloadKey}
          tenantId={tenantId}
        />
      ) : null}
      {view === "calendar" ? (
        <CalendarView onOpen={setOpenId} tenantId={tenantId} />
      ) : null}
      {view === "form" && editing ? (
        <TemplateForm
          initial={editing.template}
          onCancel={() =>
            setView(editing.template.id ? "templates" : "overview")
          }
          onSaved={() => {
            setReloadKey((key) => key + 1);
            setView(editing.template.id ? "templates" : "overview");
          }}
          people={editing.people}
          teams={editing.teams}
          departments={editing.departments}
          tenantId={tenantId}
        />
      ) : null}
      {openId ? (
        <DetailPanel
          access={access}
          occurrenceId={openId}
          onChanged={() => setReloadKey((key) => key + 1)}
          onClose={() => setOpenId(null)}
          people={data?.people ?? []}
          tenantId={tenantId}
          today={today}
        />
      ) : null}
    </section>
  );
}
