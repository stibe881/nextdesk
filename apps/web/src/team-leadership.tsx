import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Maximize2,
  Minimize2,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { callTeamSupervision as call } from "./team-supervision-api";
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

/** Wall display of the team: refreshes every 30 seconds. */
export function LiveBoard({
  tenantId,
  onOpenTicket,
}: {
  tenantId: string;
  onOpenTicket: (ticketId: string) => void;
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
              <strong>{department.unassigned}</strong>
              <span>nicht zugewiesen</span>
            </div>
            <dl>
              <div>
                <dt>Offen</dt>
                <dd>{department.open}</dd>
              </div>
              <div className={department.overdue ? "is-bad" : ""}>
                <dt>SLA über</dt>
                <dd>{department.overdue}</dd>
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
              <span>{agent.openTickets} offen</span>
              {agent.overdue ? (
                <span className="is-bad">
                  <AlertTriangle aria-hidden="true" size={12} />
                  {agent.overdue} überfällig
                </span>
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
