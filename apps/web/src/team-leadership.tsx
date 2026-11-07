import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AlertTriangle,
  Heart,
  Maximize2,
  Minimize2,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { callTeamSupervision as call } from "./team-supervision-api";
import {
  kudosAuthor,
  scoreStars,
  type KudosEntry,
} from "./lib/sla-breach-reasons";
import type { TicketDrilldown } from "./lib/ticket-drilldown";
import "./team-leadership.css";

type BoardAgent = {
  id: string;
  displayName: string;
  departmentIds: string[];
  state: "working" | "available" | "away" | "offline";
  awayUntil: string | null;
  currentTicket: {
    id: string;
    ticketNumber: string;
    subject: string;
    editing: boolean;
  } | null;
  openTickets: number;
  overdue: number;
  resolvedToday: number;
};
type BoardDepartment = {
  id: string;
  name: string;
  open: number;
  unassigned: number;
  overdue: number;
  atRisk: number;
  oldestUnassignedMinutes: number | null;
  agentsWorking: number;
};
type Board = {
  generatedAt: string;
  departments: BoardDepartment[];
  agents: BoardAgent[];
};

const STATE_LABEL: Record<BoardAgent["state"], string> = {
  working: "Im Ticket",
  available: "Eingecheckt",
  away: "Abwesend",
  offline: "Nicht aktiv",
};
const STATE_ORDER: Record<BoardAgent["state"], number> = {
  working: 0,
  available: 1,
  offline: 2,
  away: 3,
};

function waiting(minutes: number | null): string {
  if (minutes === null) return "–";
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)} h`;
  return `${Math.round(minutes / 1440)} Tage`;
}

const time = (value: string) =>
  new Intl.DateTimeFormat("de-CH", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "Europe/Zurich",
  }).format(new Date(value));

/**
 * A board figure that opens the matching ticket list when a drilldown handler
 * is available; otherwise plain text.
 */
function DrillValue({
  children,
  className,
  drilldown,
  onOpenTicketList,
}: {
  children: ReactNode;
  className?: string;
  drilldown: TicketDrilldown;
  onOpenTicketList: ((drilldown: TicketDrilldown) => void) | undefined;
}) {
  if (!onOpenTicketList) {
    return className ? (
      <span className={className}>{children}</span>
    ) : (
      <>{children}</>
    );
  }
  return (
    <button
      aria-label={`Tickets anzeigen: ${drilldown.label}`}
      className={["live-board__drill", className].filter(Boolean).join(" ")}
      onClick={() => onOpenTicketList(drilldown)}
      type="button"
    >
      {children}
    </button>
  );
}

/** Wall display of the team: refreshes every 30 seconds. */
export function LiveBoard({
  tenantId,
  onOpenTicket,
  onOpenTicketList,
}: {
  tenantId: string;
  onOpenTicket: (ticketId: string) => void;
  /** Drilldown: opens the ticket list filtered to a board figure. */
  onOpenTicketList?: ((drilldown: TicketDrilldown) => void) | undefined;
}) {
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState("");
  const [fullscreen, setFullscreen] = useState(false);
  const container = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    try {
      setBoard(await call<Board>({ type: "liveBoard", tenantId }));
      setError("");
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : String(nextError),
      );
    }
  }, [tenantId]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  function toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void container.current?.requestFullscreen?.();
  }

  const agents = [...(board?.agents ?? [])].sort(
    (a, b) =>
      STATE_ORDER[a.state] - STATE_ORDER[b.state] ||
      a.displayName.localeCompare(b.displayName, "de-CH"),
  );

  return (
    <div
      className={`live-board${fullscreen ? " is-fullscreen" : ""}`}
      ref={container}
    >
      <header className="live-board__header">
        <div>
          <h3>Leitstand</h3>
          <p className="data-caption">
            {board
              ? `Stand ${time(board.generatedAt)} · aktualisiert alle 30 Sekunden`
              : "Wird geladen …"}
          </p>
        </div>
        <div className="live-board__actions">
          <button
            aria-label="Jetzt aktualisieren"
            className="icon-button"
            onClick={() => void load()}
            type="button"
          >
            <RefreshCw aria-hidden="true" size={16} />
          </button>
          <button
            className="secondary-button"
            onClick={toggleFullscreen}
            type="button"
          >
            {fullscreen ? (
              <Minimize2 aria-hidden="true" size={16} />
            ) : (
              <Maximize2 aria-hidden="true" size={16} />
            )}
            {fullscreen ? "Vollbild beenden" : "Wandansicht"}
          </button>
        </div>
      </header>
      {error ? (
        <p className="form-message form-message--error" role="alert">
          {error}
        </p>
      ) : null}
      <section aria-label="Warteschlangen" className="live-board__queues">
        {board?.departments.map((department) => (
          <article
            className={[
              "live-board__queue",
              department.overdue ? "is-bad" : "",
              !department.overdue &&
              (department.atRisk || department.unassigned)
                ? "is-warn"
                : "",
            ].join(" ")}
            key={department.id}
          >
            <h4>{department.name}</h4>
            <div className="live-board__queue-main">
              <DrillValue
                drilldown={{
                  label: `${department.name} · offen, nicht zugewiesen`,
                  departmentIds: [department.id],
                  statusClosed: false,
                  agent: "unassigned",
                }}
                onOpenTicketList={onOpenTicketList}
              >
                <strong>{department.unassigned}</strong>
              </DrillValue>
              <span>nicht zugewiesen</span>
            </div>
            <dl>
              <div>
                <dt>Offen</dt>
                <dd>
                  <DrillValue
                    drilldown={{
                      label: `${department.name} · offen`,
                      departmentIds: [department.id],
                      statusClosed: false,
                    }}
                    onOpenTicketList={onOpenTicketList}
                  >
                    {department.open}
                  </DrillValue>
                </dd>
              </div>
              <div className={department.overdue ? "is-bad" : ""}>
                <dt>SLA über</dt>
                <dd>
                  <DrillValue
                    drilldown={{
                      label: `${department.name} · SLA überschritten`,
                      departmentIds: [department.id],
                      statusClosed: false,
                      slaBreached: true,
                    }}
                    onOpenTicketList={onOpenTicketList}
                  >
                    {department.overdue}
                  </DrillValue>
                </dd>
              </div>
              <div className={department.atRisk ? "is-warn" : ""}>
                <dt>SLA &lt; 4 h</dt>
                <dd>{department.atRisk}</dd>
              </div>
              <div>
                <dt>Älteste Wartezeit</dt>
                <dd>{waiting(department.oldestUnassignedMinutes)}</dd>
              </div>
              <div>
                <dt>Aktiv</dt>
                <dd>{department.agentsWorking}</dd>
              </div>
            </dl>
          </article>
        ))}
      </section>
      <section aria-label="Agent:innen" className="live-board__agents">
        {agents.map((agent) => (
          <article
            className={`live-board__agent is-${agent.state}`}
            key={agent.id}
          >
            <header>
              <span aria-hidden="true" className="live-board__dot" />
              <strong>{agent.displayName}</strong>
              <span className="live-board__state">
                {STATE_LABEL[agent.state]}
              </span>
            </header>
            {agent.currentTicket ? (
              <button
                className="live-board__current"
                onClick={() => onOpenTicket(agent.currentTicket!.id)}
                type="button"
              >
                <code>{agent.currentTicket.ticketNumber}</code>
                <span>{agent.currentTicket.subject}</span>
                {agent.currentTicket.editing ? <small>schreibt …</small> : null}
              </button>
            ) : (
              <p className="live-board__idle">
                {agent.state === "away" && agent.awayUntil
                  ? `Zurück am ${new Intl.DateTimeFormat("de-CH", {
                      day: "2-digit",
                      month: "2-digit",
                    }).format(new Date(agent.awayUntil))}`
                  : "Kein Ticket geöffnet"}
              </p>
            )}
            <footer>
              <DrillValue
                drilldown={{
                  label: `${agent.displayName} · offen`,
                  agent: agent.id,
                  statusClosed: false,
                }}
                onOpenTicketList={onOpenTicketList}
              >
                {agent.openTickets} offen
              </DrillValue>
              {agent.overdue ? (
                <DrillValue
                  className="is-bad"
                  drilldown={{
                    label: `${agent.displayName} · überfällig`,
                    agent: agent.id,
                    statusClosed: false,
                    slaBreached: true,
                  }}
                  onOpenTicketList={onOpenTicketList}
                >
                  <AlertTriangle aria-hidden="true" size={12} />
                  {agent.overdue} überfällig
                </DrillValue>
              ) : null}
              <span>{agent.resolvedToday} heute gelöst</span>
            </footer>
          </article>
        ))}
      </section>
    </div>
  );
}

type Skill = { id: string; name: string };
type SkillData = {
  skills: Skill[];
  agents: { id: string; displayName: string }[];
  levels: { skillId: string; agentId: string; level: number }[];
};

const LEVEL_LABEL = ["–", "Grundlagen", "Fortgeschritten", "Experte"];

/** Skill matrix: agents × skills with levels 1–3 and visible gaps. */
export function SkillMatrix({ tenantId }: { tenantId: string }) {
  const [data, setData] = useState<SkillData | null>(null);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await call<SkillData>({ type: "skills", tenantId }));
      setError("");
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : String(nextError),
      );
    }
  }, [tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  const levelOf = (skillId: string, agentId: string) =>
    data?.levels.find(
      (entry) => entry.skillId === skillId && entry.agentId === agentId,
    )?.level ?? 0;

  async function run(key: string, body: Record<string, unknown>) {
    setBusy(key);
    try {
      await call({ tenantId, ...body });
      await load();
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : String(nextError),
      );
    } finally {
      setBusy(null);
    }
  }

  async function cycle(skillId: string, agentId: string) {
    const next = (levelOf(skillId, agentId) + 1) % 4;
    // Optimistic update so clicking feels instant.
    setData((current) =>
      current
        ? {
            ...current,
            levels: [
              ...current.levels.filter(
                (entry) =>
                  !(entry.skillId === skillId && entry.agentId === agentId),
              ),
              ...(next ? [{ skillId, agentId, level: next }] : []),
            ],
          }
        : current,
    );
    try {
      await call({
        type: "setSkillLevel",
        tenantId,
        skillId,
        agentId,
        level: next,
      });
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : String(nextError),
      );
      void load();
    }
  }

  return (
    <div className="skill-matrix">
      <p className="data-caption">
        Klicken Sie auf ein Feld, um die Stufe zu wechseln: – → Grundlagen →
        Fortgeschritten → Experte. Fähigkeiten mit weniger als zwei
        fortgeschrittenen Personen sind als Lücke markiert.
      </p>
      <form
        className="skill-matrix__add"
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim()) return;
          void run("add", { type: "saveSkill", skillId: null, name }).then(() =>
            setName(""),
          );
        }}
      >
        <input
          aria-label="Neue Fähigkeit"
          maxLength={80}
          onChange={(event) => setName(event.target.value)}
          placeholder="Neue Fähigkeit, z. B. Netzwerk, M365, SAP"
          value={name}
        />
        <button
          className="secondary-button"
          disabled={busy === "add" || !name.trim()}
          type="submit"
        >
          <Plus aria-hidden="true" size={15} /> Hinzufügen
        </button>
      </form>
      {error ? (
        <p className="form-message form-message--error" role="alert">
          {error}
        </p>
      ) : null}
      {!data ? (
        <p className="empty-state">Skill-Matrix wird geladen …</p>
      ) : data.skills.length === 0 ? (
        <p className="empty-state">
          Noch keine Fähigkeiten erfasst. Legen Sie oben die erste an.
        </p>
      ) : (
        <div className="skill-matrix__scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">Person</th>
                {data.skills.map((skill) => {
                  const experts = data.agents.filter(
                    (agent) => levelOf(skill.id, agent.id) >= 2,
                  ).length;
                  return (
                    <th
                      className={experts < 2 ? "is-gap" : ""}
                      key={skill.id}
                      scope="col"
                    >
                      <span>{skill.name}</span>
                      <small>
                        {experts} fortgeschritten
                        {experts < 2 ? " · Lücke" : ""}
                      </small>
                      <button
                        aria-label={`${skill.name} löschen`}
                        className="icon-button"
                        disabled={busy === skill.id}
                        onClick={() => {
                          if (
                            window.confirm(
                              `Fähigkeit «${skill.name}» mit allen Einstufungen löschen?`,
                            )
                          ) {
                            void run(skill.id, {
                              type: "deleteSkill",
                              skillId: skill.id,
                            });
                          }
                        }}
                        type="button"
                      >
                        <Trash2 aria-hidden="true" size={13} />
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {data.agents.map((agent) => (
                <tr key={agent.id}>
                  <th scope="row">{agent.displayName}</th>
                  {data.skills.map((skill) => {
                    const level = levelOf(skill.id, agent.id);
                    return (
                      <td key={skill.id}>
                        <button
                          aria-label={`${agent.displayName}, ${skill.name}: ${LEVEL_LABEL[level]}`}
                          className={`skill-matrix__cell is-level-${level}`}
                          onClick={() => void cycle(skill.id, agent.id)}
                          title={LEVEL_LABEL[level]}
                          type="button"
                        >
                          {level ? "●".repeat(level) : "–"}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

type CauseSummary = {
  total: number;
  withoutReason: number;
  withoutReasonPercent: number | null;
  causes: { code: string; label: string; count: number; percent: number }[];
};
type CauseReport = {
  month: string;
  truncated: boolean;
  total: CauseSummary;
  departments: (CauseSummary & {
    id: string;
    name: string;
    response: number;
    resolution: number;
    teams: (CauseSummary & { id: string | null; name: string })[];
  })[];
};

const CAUSE_COLOR: Record<string, string> = {
  third_party: "var(--chart-1)",
  wrong_routing: "var(--chart-2)",
  missing_requester_info: "var(--chart-3)",
  capacity: "var(--chart-4)",
  complexity: "var(--chart-5)",
  other: "var(--chart-6)",
};

function thisMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function longMonth(month: string): string {
  const [year = 2000, value = 1] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("de-CH", {
    month: "long",
    year: "numeric",
  }).format(new Date(year, value - 1, 1));
}

function CauseBars({ summary }: { summary: CauseSummary }) {
  if (!summary.causes.length) {
    return (
      <p className="data-caption">
        {summary.total
          ? "Noch keine Ursachen erfasst."
          : "Keine SLA-Verletzungen."}
      </p>
    );
  }
  return (
    <ul className="sla-causes__bars">
      {summary.causes.map((cause) => (
        <li key={cause.code}>
          <span className="sla-causes__label">{cause.label}</span>
          <span aria-hidden="true" className="sla-causes__track">
            <span
              style={{
                width: `${Math.max(cause.percent, 3)}%`,
                background: CAUSE_COLOR[cause.code] ?? "var(--chart-8)",
              }}
            />
          </span>
          <span className="sla-causes__value">
            {cause.count} · {cause.percent} %
          </span>
        </li>
      ))}
    </ul>
  );
}

function MissingShare({ summary }: { summary: CauseSummary }) {
  if (!summary.total) return null;
  const percent = summary.withoutReasonPercent ?? 0;
  return (
    <span
      className={`sla-causes__missing${percent > 30 ? " is-warn" : ""}`}
      title="Anteil der Verletzungen ohne erfasste Ursache"
    >
      {summary.withoutReason} ohne Ursache ({percent} %)
    </span>
  );
}

/** Top causes of SLA breaches per department and team for one month. */
export function SlaBreachCauses({ tenantId }: { tenantId: string }) {
  const [month, setMonth] = useState(thisMonth);
  const [report, setReport] = useState<CauseReport | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void call<CauseReport>({ type: "slaBreachCauses", tenantId, month })
      .then((next) => {
        if (active) setReport(next);
      })
      .catch((nextError: unknown) => {
        if (active) {
          setError(
            nextError instanceof Error ? nextError.message : String(nextError),
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [month, tenantId]);

  return (
    <div className="sla-causes">
      <header className="sla-causes__header">
        <div>
          <h3>Ursachen für SLA-Verletzungen</h3>
          <p className="data-caption">
            Verletzungen nach Fälligkeit im gewählten Monat. Ursachen erfassen
            Agent:innen direkt im Ticket.
          </p>
        </div>
        <label>
          Monat
          <input
            max={thisMonth()}
            onChange={(event) =>
              event.target.value && setMonth(event.target.value)
            }
            type="month"
            value={month}
          />
        </label>
      </header>
      {error ? (
        <p className="form-message form-message--error" role="alert">
          {error}
        </p>
      ) : null}
      {loading && !report ? (
        <p className="empty-state">Auswertung wird erstellt …</p>
      ) : null}
      {report ? (
        <>
          <section className="sla-causes__total" aria-label="Gesamt">
            <div>
              <strong>{report.total.total}</strong>
              <span>Verletzungen {longMonth(report.month)}</span>
            </div>
            <MissingShare summary={report.total} />
            {report.truncated ? (
              <span className="data-caption">
                Sehr viele Tickets – Auswertung gekürzt.
              </span>
            ) : null}
          </section>
          <div className="sla-causes__grid">
            {report.departments.map((department) => (
              <article className="sla-causes__card" key={department.id}>
                <header>
                  <h4>{department.name}</h4>
                  <span className="data-caption">
                    {department.total} Verletzungen · {department.response}{" "}
                    Erstreaktion · {department.resolution} Lösung
                  </span>
                  <MissingShare summary={department} />
                </header>
                <CauseBars summary={department} />
                {department.teams.length > 1 ||
                (department.teams[0] && department.teams[0].id !== null) ? (
                  <details className="sla-causes__teams">
                    <summary>Nach Team</summary>
                    <table>
                      <thead>
                        <tr>
                          <th scope="col">Team</th>
                          <th scope="col">Verletzungen</th>
                          <th scope="col">Häufigste Ursache</th>
                          <th scope="col">Ohne Ursache</th>
                        </tr>
                      </thead>
                      <tbody>
                        {department.teams.map((team) => (
                          <tr key={team.id ?? "none"}>
                            <th scope="row">{team.name}</th>
                            <td>{team.total}</td>
                            <td>
                              {team.causes[0]
                                ? `${team.causes[0].label} (${team.causes[0].count})`
                                : "–"}
                            </td>
                            <td>
                              {team.withoutReasonPercent === null
                                ? "–"
                                : `${team.withoutReasonPercent} %`}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                ) : null}
              </article>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

type BoardKudos = KudosEntry & { agentName: string | null };
type KudosBoardData = {
  sinceDays: number;
  departments: {
    id: string;
    name: string;
    total: number;
    topAgents: { agentId: string; agentName: string; count: number }[];
    entries: BoardKudos[];
  }[];
};

/** Team pinboard with the latest praise from the satisfaction survey. */
export function KudosBoard({
  tenantId,
  onOpenTicket,
}: {
  tenantId: string;
  onOpenTicket: (ticketId: string) => void;
}) {
  const [data, setData] = useState<KudosBoardData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void call<KudosBoardData>({ type: "kudosBoard", tenantId })
      .then((next) => {
        if (active) setData(next);
      })
      .catch((nextError: unknown) => {
        if (active) {
          setError(
            nextError instanceof Error ? nextError.message : String(nextError),
          );
        }
      });
    return () => {
      active = false;
    };
  }, [tenantId]);

  const day = (value: string) =>
    new Intl.DateTimeFormat("de-CH", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      timeZone: "Europe/Zurich",
    }).format(new Date(value));

  return (
    <div className="kudos-board">
      <header>
        <h3>Pinnwand: Lob von Kund:innen</h3>
        <p className="data-caption">
          Top-Bewertungen aus der Zufriedenheitsumfrage der letzten{" "}
          {data?.sinceDays ?? 90} Tage. Angezeigt wird nur der Anzeigename der
          meldenden Person.
        </p>
      </header>
      {error ? (
        <p className="form-message form-message--error" role="alert">
          {error}
        </p>
      ) : null}
      {!data && !error ? (
        <p className="empty-state">Pinnwand wird geladen …</p>
      ) : null}
      {data?.departments.map((department) => (
        <section className="kudos-board__team" key={department.id}>
          <header>
            <h4>
              <Heart aria-hidden="true" size={16} /> {department.name}
            </h4>
            <span className="data-caption">{department.total} × Lob</span>
            {department.topAgents.length ? (
              <span className="kudos-board__top">
                Am meisten gelobt:{" "}
                {department.topAgents
                  .map((agent) => `${agent.agentName} (${agent.count})`)
                  .join(", ")}
              </span>
            ) : null}
          </header>
          {department.entries.length ? (
            <ul className="kudos-board__notes">
              {department.entries.map((entry) => (
                <li key={entry.ticketId}>
                  <span
                    aria-label={`${entry.score} von 5`}
                    className="kudos-board__stars"
                  >
                    {scoreStars(entry.score)}
                  </span>
                  <blockquote>
                    {entry.comment
                      ? `«${entry.comment}»`
                      : "Top-Bewertung ohne Kommentar"}
                  </blockquote>
                  <footer>
                    <span>
                      {kudosAuthor(entry.requesterName)} an{" "}
                      <strong>{entry.agentName ?? "Team"}</strong>
                    </span>
                    <button
                      className="text-button"
                      onClick={() => onOpenTicket(entry.ticketId)}
                      type="button"
                    >
                      {entry.ticketNumber ?? "Ticket"}
                    </button>
                    <time>{day(entry.createdAt)}</time>
                  </footer>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty-state">Noch kein Lob in diesem Zeitraum.</p>
          )}
        </section>
      ))}
    </div>
  );
}
