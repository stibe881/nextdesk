import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  type Named,
  projectsCall,
  type WorkloadData,
  type WorkloadPerson,
} from "./lib/projects-api";
import {
  addDays,
  dateLabel,
  hoursLabel,
  loadLevel,
  localToday,
  startOfWeek,
  weekNumber,
} from "./lib/projects-model";

const WEEKS = 4;
const KIND_LABELS = {
  project_task: "Projektaufgabe",
  ticket: "Ticket",
  service_task: "Serviceaufgabe",
} as const;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function PersonRow({
  capacity,
  days,
  onOpenProject,
  onOpenTicket,
  person,
  today,
}: {
  capacity: number;
  days: string[];
  onOpenProject: (projectId: string) => void;
  onOpenTicket?: ((ticketId: string) => void) | undefined;
  person: WorkloadPerson;
  today: string;
}) {
  const [open, setOpen] = useState(false);
  const byDate = new Map(person.days.map((day) => [day.date, day]));
  const tone =
    person.utilizationPercent > 100
      ? "bad"
      : person.utilizationPercent >= 85
        ? "warn"
        : "good";
  return (
    <>
      <tr>
        <th scope="row">
          <button
            aria-expanded={open}
            className="pj-person"
            onClick={() => setOpen((value) => !value)}
            type="button"
          >
            <strong>{person.name}</strong>
            <small>
              {person.counts.project_task} Projektaufgaben ·{" "}
              {person.counts.ticket} Tickets · {person.counts.service_task}{" "}
              Serviceaufgaben
            </small>
          </button>
        </th>
        <td className={`pj-load-total pj-load-total--${tone}`}>
          {person.utilizationPercent} %
          <small>{hoursLabel(person.totalMinutes)}</small>
        </td>
        {days.map((date) => {
          const day = byDate.get(date);
          const minutes = day?.minutes ?? 0;
          const title = day
            ? `${dateLabel(date)}: ${hoursLabel(minutes)} (Projekte ${hoursLabel(day.projectMinutes)}, Tickets ${hoursLabel(day.ticketMinutes)}, Serviceaufgaben ${hoursLabel(day.serviceTaskMinutes)})`
            : dateLabel(date);
          return (
            <td
              className={`pj-load pj-load--${loadLevel(minutes, capacity)}${date === today ? " pj-load--today" : ""}`}
              key={date}
              title={title}
            >
              {minutes > 0 ? (minutes / 60).toFixed(1) : ""}
            </td>
          );
        })}
      </tr>
      {open ? (
        <tr className="pj-load-detail">
          <td colSpan={days.length + 2}>
            {person.unestimated > 0 ? (
              <p className="pj-hint">
                {person.unestimated} Aufgaben haben keine Schätzung und zählen
                deshalb nicht in die Stunden.
              </p>
            ) : null}
            {person.items.length === 0 ? (
              <p className="pj-hint">Nichts geplant in diesem Zeitraum.</p>
            ) : (
              <ul className="pj-rows pj-rows--compact">
                {person.items.map((item) => {
                  const target =
                    item.kind === "ticket"
                      ? onOpenTicket
                        ? () => onOpenTicket(item.id)
                        : null
                      : item.projectId
                        ? () => onOpenProject(item.projectId!)
                        : null;
                  const body = (
                    <span className="pj-two-line">
                      <strong>{item.title}</strong>
                      <small>
                        {KIND_LABELS[item.kind]}
                        {item.projectName ? ` · ${item.projectName}` : ""}
                      </small>
                    </span>
                  );
                  return (
                    <li key={`${item.kind}-${item.id}`}>
                      {target ? (
                        <button
                          className="pj-plain"
                          onClick={target}
                          type="button"
                        >
                          {body}
                        </button>
                      ) : (
                        body
                      )}
                      <span className="pj-actions">
                        {item.overdue ? (
                          <span className="pj-chip pj-chip--bad">
                            überfällig
                          </span>
                        ) : null}
                        <span className="pj-muted">
                          {item.dueOn ? dateLabel(item.dueOn) : "ohne Termin"}
                        </span>
                        <strong>{hoursLabel(item.minutes)}</strong>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </td>
        </tr>
      ) : null}
    </>
  );
}

export function ProjectWorkload({
  canManage,
  onOpenProject,
  onOpenTicket,
  teams,
  tenantId,
}: {
  canManage: boolean;
  onOpenProject: (projectId: string) => void;
  onOpenTicket?: ((ticketId: string) => void) | undefined;
  teams: Named[];
  tenantId: string;
}) {
  const [from, setFrom] = useState(() => startOfWeek(localToday()));
  const [teamId, setTeamId] = useState("");
  const [data, setData] = useState<WorkloadData | null>(null);
  const [error, setError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [ticketMinutes, setTicketMinutes] = useState("30");
  const [capacityHours, setCapacityHours] = useState("8");
  const version = useRef(0);

  const load = useCallback(async () => {
    const current = ++version.current;
    setError("");
    try {
      const next = await projectsCall<WorkloadData>({
        type: "workload",
        tenantId,
        from,
        to: addDays(from, WEEKS * 7 - 1),
        teamId: teamId || null,
      });
      if (version.current !== current) return;
      setData(next);
      setTicketMinutes(String(next.settings.ticketWorkloadMinutes));
      setCapacityHours(String(next.settings.dailyCapacityMinutes / 60));
    } catch (nextError) {
      if (version.current === current) setError(errorText(nextError));
    }
  }, [from, teamId, tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveSettings = async (event: FormEvent) => {
    event.preventDefault();
    const minutes = Number(ticketMinutes);
    const capacity = Math.round(Number(capacityHours.replace(",", ".")) * 60);
    if (!Number.isInteger(minutes) || !Number.isFinite(capacity)) {
      setError("Die Angaben müssen Zahlen sein.");
      return;
    }
    try {
      await projectsCall({
        type: "updateSettings",
        tenantId,
        ticketWorkloadMinutes: minutes,
        dailyCapacityMinutes: capacity,
      });
      setSettingsOpen(false);
      await load();
    } catch (nextError) {
      setError(errorText(nextError));
    }
  };

  const days =
    data?.days ??
    Array.from({ length: WEEKS * 7 }, (_, index) =>
      addDays(from, index),
    ).filter((date) => {
      const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
      return weekday !== 0 && weekday !== 6;
    });
  const weeks = days.reduce<{ week: number; count: number }[]>((list, date) => {
    const week = weekNumber(date);
    const last = list.at(-1);
    if (last && last.week === week) last.count += 1;
    else list.push({ week, count: 1 });
    return list;
  }, []);
  const capacity = data?.settings.dailyCapacityMinutes ?? 480;

  return (
    <>
      <div className="pj-toolbar">
        <div className="pj-actions">
          <button
            aria-label="Vier Wochen zurück"
            className="pj-button"
            onClick={() => setFrom(addDays(from, -WEEKS * 7))}
            type="button"
          >
            <ChevronLeft aria-hidden="true" size={15} />
          </button>
          <button
            className="pj-button"
            onClick={() => setFrom(startOfWeek(localToday()))}
            type="button"
          >
            Heute
          </button>
          <button
            aria-label="Vier Wochen vor"
            className="pj-button"
            onClick={() => setFrom(addDays(from, WEEKS * 7))}
            type="button"
          >
            <ChevronRight aria-hidden="true" size={15} />
          </button>
          <span className="pj-muted">
            {dateLabel(from)} – {dateLabel(addDays(from, WEEKS * 7 - 1))}
          </span>
        </div>
        <div className="pj-actions">
          <select
            aria-label="Team"
            onChange={(event) => setTeamId(event.target.value)}
            value={teamId}
          >
            <option value="">Alle Personen mit Arbeit</option>
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
          {canManage ? (
            <button
              aria-expanded={settingsOpen}
              className="pj-button"
              onClick={() => setSettingsOpen((value) => !value)}
              type="button"
            >
              Annahmen
            </button>
          ) : null}
        </div>
      </div>

      {settingsOpen ? (
        <form
          className="pj-card pj-inline-form"
          onSubmit={(event) => void saveSettings(event)}
        >
          <label>
            Pauschale je offenem Ticket (Minuten)
            <input
              inputMode="numeric"
              onChange={(event) => setTicketMinutes(event.target.value)}
              value={ticketMinutes}
            />
          </label>
          <label>
            Arbeitszeit je Tag (Stunden)
            <input
              inputMode="decimal"
              onChange={(event) => setCapacityHours(event.target.value)}
              value={capacityHours}
            />
          </label>
          <button className="pj-button pj-button--primary" type="submit">
            Speichern
          </button>
        </form>
      ) : null}

      {error ? (
        <p className="pj-error" role="alert">
          {error}
        </p>
      ) : null}

      <section className="pj-card pj-card--flush">
        {!data ? (
          error ? null : (
            <p className="pj-empty">Auslastung wird berechnet …</p>
          )
        ) : data.people.length === 0 ? (
          <p className="pj-empty">
            In diesem Zeitraum ist niemandem Arbeit zugewiesen.
          </p>
        ) : (
          <div className="pj-table-wrap">
            <table className="pj-workload">
              <thead>
                <tr>
                  <th rowSpan={2} scope="col">
                    Person
                  </th>
                  <th rowSpan={2} scope="col">
                    Auslastung
                  </th>
                  {weeks.map((week) => (
                    <th colSpan={week.count} key={week.week} scope="colgroup">
                      KW {week.week}
                    </th>
                  ))}
                </tr>
                <tr>
                  {days.map((date) => (
                    <th
                      className={date === data.today ? "pj-load--today" : ""}
                      key={date}
                      scope="col"
                    >
                      {date.slice(8, 10)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.people.map((person) => (
                  <PersonRow
                    capacity={capacity}
                    days={days}
                    key={person.userId}
                    onOpenProject={onOpenProject}
                    onOpenTicket={onOpenTicket}
                    person={person}
                    today={data.today}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="pj-legend">
        <span className="pj-load pj-load--1" /> bis 50 %
        <span className="pj-load pj-load--2" /> bis 85 %
        <span className="pj-load pj-load--3" /> voll
        <span className="pj-load pj-load--4" /> überlastet
        <span className="pj-muted">
          Stunden je Arbeitstag aus Projektaufgaben (Restaufwand),
          Serviceaufgaben und offenen Tickets (
          {data?.settings.ticketWorkloadMinutes ?? 30} Minuten je Ticket), bei{" "}
          {hoursLabel(capacity)} Arbeitszeit je Tag.
        </span>
      </p>
    </>
  );
}
