import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type DragEvent,
} from "react";
import {
  AlertTriangle,
  CalendarClock,
  ClipboardCheck,
  FileBarChart,
  GraduationCap,
  Heart,
  LayoutDashboard,
  MonitorPlay,
  MessageSquareHeart,
  Printer,
  Shuffle,
  TimerOff,
  UserRound,
} from "lucide-react";
import {
  KudosBoard,
  LiveBoard,
  SkillMatrix,
  SlaBreachCauses,
} from "./team-leadership";
import {
  kudosAuthor,
  scoreStars,
  type KudosEntry,
} from "./lib/sla-breach-reasons";
import type { TicketDrilldown } from "./lib/ticket-drilldown";
import { callTeamSupervision } from "./team-supervision-api";
import { buildOneOnOneSheet } from "./lib/one-on-one-sheet";
import { supabase } from "./lib/supabase";
import "./team-supervision.css";

type Absence = {
  endsAt: string;
  delegateId: string;
  delegateName: string | null;
};
type TeamAgent = {
  id: string;
  displayName: string;
  departmentIds: string[];
  openTickets: number;
  overdue: number;
  atRisk: number;
  noFirstResponse: number;
  resolvedLast30Days: number;
  loadScore: number;
  absence: Absence | null;
};
type OverloadWarning = {
  agentId: string;
  agentName: string;
  openTickets: number;
  overdue: number;
  averageOpen: number;
  reason: "load" | "overdue";
};
type RebalanceMove = {
  ticketId: string;
  fromAgentId: string;
  toAgentId: string;
  toAgentName: string;
};
type TeamTicket = {
  id: string;
  ticketNumber: string;
  subject: string;
  departmentId: string;
  assignedAgentId: string | null;
  statusLabel: string;
  priorityLabel: string;
  createdAt: string;
  resolutionDueAt: string | null;
  overdue: boolean;
  atRisk: boolean;
  noFirstResponse: boolean;
};
type Overview = {
  departments: { id: string; name: string }[];
  agents: TeamAgent[];
  tickets: TeamTicket[];
  truncated: boolean;
  warnings: OverloadWarning[];
  suggestions: RebalanceMove[];
};
type ReviewTicket = {
  id: string;
  ticketNumber: string;
  subject: string;
  description: string;
  lastReply: string | null;
  agentName: string | null;
  resolvedAt: string;
};
type ReportAgent = {
  id: string;
  displayName: string;
  ticketsAssigned: number;
  ticketsResolved: number;
  averageFirstResponseMinutes: number | null;
  averageResolutionMinutes: number | null;
  slaCompliancePercent: number | null;
  satisfactionAverage: number | null;
  satisfactionResponses: number;
  qualityAverage: number | null;
  qualityReviews: number;
  externalReplies: number;
  knowledgeArticles: number;
  previous?: {
    ticketsResolved: number;
    averageResolutionMinutes: number | null;
    averageFirstResponseMinutes: number | null;
    slaCompliancePercent: number | null;
    satisfactionAverage: number | null;
    qualityAverage: number | null;
  } | null;
};
type Report = {
  month: string;
  departments: { id: string; name: string }[];
  agents: ReportAgent[];
};

type View =
  | "live"
  | "overview"
  | "redistribute"
  | "quality"
  | "skills"
  | "coaching"
  | "kudos"
  | "sla"
  | "report";

const call = callTeamSupervision;

const dateTime = (value: string) =>
  new Intl.DateTimeFormat("de-CH", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Zurich",
  }).format(new Date(value));
const shortDate = (value: string) =>
  new Intl.DateTimeFormat("de-CH", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Europe/Zurich",
  }).format(new Date(value));

function duration(minutes: number | null): string {
  if (minutes === null) return "–";
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 60 * 48) return `${Math.round(minutes / 6) / 10} h`;
  return `${Math.round(minutes / 144) / 10} Tage`;
}

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(month: string): string {
  const [year = 2000, value = 1] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("de-CH", {
    month: "long",
    year: "numeric",
  }).format(new Date(year, value - 1, 1));
}

export function TeamSupervision({
  tenantId,
  onOpenTicket,
  onOpenTicketList,
}: {
  tenantId: string;
  onOpenTicket: (ticketId: string) => void;
  /** Drilldown from the board figures into the filtered ticket list. */
  onOpenTicketList?: ((drilldown: TicketDrilldown) => void) | undefined;
}) {
  const [view, setView] = useState<View>("live");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setOverview(await call<Overview>({ type: "overview", tenantId }));
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : String(nextError),
      );
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Grouped so the nine areas read as three topics instead of one long row.
  const viewGroups: {
    label: string;
    views: { value: View; label: string; Icon: typeof UserRound }[];
  }[] = [
    {
      label: "Tagesgeschäft",
      views: [
        { value: "live", label: "Leitstand", Icon: MonitorPlay },
        { value: "overview", label: "Team-Übersicht", Icon: LayoutDashboard },
        { value: "redistribute", label: "Umverteilen", Icon: Shuffle },
      ],
    },
    {
      label: "Entwicklung",
      views: [
        { value: "quality", label: "Qualitätsprüfung", Icon: ClipboardCheck },
        { value: "skills", label: "Skill-Matrix", Icon: GraduationCap },
        { value: "coaching", label: "Coaching", Icon: MessageSquareHeart },
        { value: "kudos", label: "Pinnwand", Icon: Heart },
      ],
    },
    {
      label: "Auswertung",
      views: [
        { value: "sla", label: "SLA-Ursachen", Icon: TimerOff },
        { value: "report", label: "Monatsbericht", Icon: FileBarChart },
      ],
    },
  ];

  return (
    <section className="team-supervision" aria-label="Teamführung">
      <header className="team-supervision__header">
        <div>
          <p className="eyebrow">TEAMFÜHRUNG</p>
          <h2>
            {overview?.departments
              .map((department) => department.name)
              .join(", ") || "Mein Team"}
          </h2>
          <p>
            Auslastung, Umverteilung, Qualität und Monatsbericht Ihrer
            Agent:innen.
          </p>
        </div>
      </header>
      <nav aria-label="Bereiche der Teamführung" className="section-tabs">
        {viewGroups.map((group) => (
          <div
            aria-label={group.label}
            className="section-tabs__group"
            key={group.label}
            role="group"
          >
            <span aria-hidden="true" className="section-tabs__label">
              {group.label}
            </span>
            <div className="section-tabs__row">
              {group.views.map(({ value, label, Icon }) => (
                <button
                  aria-current={view === value ? "page" : undefined}
                  className={
                    view === value
                      ? "section-tabs__tab is-active"
                      : "section-tabs__tab"
                  }
                  key={value}
                  onClick={() => setView(value)}
                  type="button"
                >
                  <Icon aria-hidden="true" size={15} strokeWidth={1.9} />
                  {label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </nav>
      {error ? (
        <p className="form-message form-message--error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="form-message form-message--success" role="status">
          {notice}
        </p>
      ) : null}
      {loading && !overview ? (
        <p className="empty-state">Teamdaten werden geladen …</p>
      ) : overview ? (
        <>
          {view === "live" ? (
            <LiveBoard
              onOpenTicket={onOpenTicket}
              onOpenTicketList={onOpenTicketList}
              tenantId={tenantId}
            />
          ) : null}
          {view === "skills" ? <SkillMatrix tenantId={tenantId} /> : null}
          {view === "overview" ? (
            <TeamOverview overview={overview} onOpenTicket={onOpenTicket} />
          ) : null}
          {view === "redistribute" ? (
            <Redistribute
              onChanged={(message) => {
                setNotice(message);
                void load();
              }}
              onError={setError}
              onOpenTicket={onOpenTicket}
              overview={overview}
              tenantId={tenantId}
            />
          ) : null}
          {view === "quality" ? (
            <QualityReview onSaved={setNotice} tenantId={tenantId} />
          ) : null}
          {view === "coaching" ? (
            <Coaching
              agents={overview.agents.map((agent) => ({
                id: agent.id,
                displayName: agent.displayName,
              }))}
              onOpenTicket={onOpenTicket}
              tenantId={tenantId}
            />
          ) : null}
          {view === "kudos" ? (
            <KudosBoard onOpenTicket={onOpenTicket} tenantId={tenantId} />
          ) : null}
          {view === "sla" ? <SlaBreachCauses tenantId={tenantId} /> : null}
          {view === "report" ? <MonthlyReport tenantId={tenantId} /> : null}
        </>
      ) : null}
    </section>
  );
}

function TeamOverview({
  overview,
  onOpenTicket,
}: {
  overview: Overview;
  onOpenTicket: (ticketId: string) => void;
}) {
  const unassigned = overview.tickets.filter(
    (ticket) => !ticket.assignedAgentId,
  );
  const critical = overview.tickets
    .filter(
      (ticket) => ticket.overdue || ticket.atRisk || ticket.noFirstResponse,
    )
    .slice(0, 12);
  const totals = {
    open: overview.tickets.length,
    overdue: overview.tickets.filter((ticket) => ticket.overdue).length,
    atRisk: overview.tickets.filter((ticket) => ticket.atRisk).length,
    noResponse: overview.tickets.filter((ticket) => ticket.noFirstResponse)
      .length,
  };
  const maxLoad = Math.max(
    1,
    ...overview.agents.map((agent) => agent.loadScore),
  );
  return (
    <div className="team-supervision__overview">
      {overview.warnings.length ? (
        <section
          aria-label="Frühwarnung Überlastung"
          className="team-supervision__warnings"
        >
          {overview.warnings.map((warning) => (
            <p key={warning.agentId}>
              <AlertTriangle aria-hidden="true" size={15} />
              <strong>{warning.agentName}</strong>
              {warning.reason === "overdue"
                ? ` hat ${warning.overdue} Tickets mit überschrittener SLA.`
                : ` trägt ${warning.openTickets} offene Tickets (Teamschnitt ${warning.averageOpen}).`}
            </p>
          ))}
        </section>
      ) : null}
      <div className="team-supervision__kpis">
        <article>
          <p>Offene Tickets</p>
          <strong>{totals.open}</strong>
          <small>davon {unassigned.length} nicht zugewiesen</small>
        </article>
        <article className={totals.overdue ? "is-bad" : "is-good"}>
          <p>SLA überschritten</p>
          <strong>{totals.overdue}</strong>
        </article>
        <article className={totals.atRisk ? "is-warn" : "is-good"}>
          <p>SLA in &lt; 4 h fällig</p>
          <strong>{totals.atRisk}</strong>
        </article>
        <article className={totals.noResponse ? "is-warn" : "is-good"}>
          <p>Ohne Antwort &gt; 24 h</p>
          <strong>{totals.noResponse}</strong>
        </article>
      </div>
      <section className="team-supervision__agents" aria-label="Agent:innen">
        {overview.agents.map((agent) => (
          <article className="team-supervision__agent" key={agent.id}>
            <header>
              <span className="team-supervision__avatar" aria-hidden="true">
                <UserRound size={16} />
              </span>
              <div>
                <h3>{agent.displayName}</h3>
                {agent.absence ? (
                  <span className="team-supervision__absence">
                    <CalendarClock aria-hidden="true" size={13} />
                    Abwesend bis {shortDate(agent.absence.endsAt)}
                    {agent.absence.delegateName
                      ? `, vertreten durch ${agent.absence.delegateName}`
                      : ""}
                  </span>
                ) : null}
              </div>
            </header>
            <div
              aria-label={`Auslastung ${agent.loadScore} Punkte, ${agent.openTickets} offene Tickets`}
              className="team-supervision__load"
              role="img"
            >
              <span
                style={{ width: `${(agent.loadScore / maxLoad) * 100}%` }}
              />
            </div>
            <dl>
              <div>
                <dt>Offen</dt>
                <dd>{agent.openTickets}</dd>
              </div>
              <div className={agent.overdue ? "is-bad" : ""}>
                <dt>Überfällig</dt>
                <dd>{agent.overdue}</dd>
              </div>
              <div className={agent.atRisk ? "is-warn" : ""}>
                <dt>SLA &lt; 4 h</dt>
                <dd>{agent.atRisk}</dd>
              </div>
              <div className={agent.noFirstResponse ? "is-warn" : ""}>
                <dt>Ohne Antwort</dt>
                <dd>{agent.noFirstResponse}</dd>
              </div>
              <div>
                <dt>Gelöst (30 T.)</dt>
                <dd>{agent.resolvedLast30Days}</dd>
              </div>
              <div title="Offene Tickets gewichtet nach Priorität und SLA-Risiko">
                <dt>Last</dt>
                <dd>{agent.loadScore}</dd>
              </div>
            </dl>
          </article>
        ))}
      </section>
      <section className="panel team-supervision__critical">
        <h3>
          <AlertTriangle aria-hidden="true" size={16} /> Kritische Tickets
        </h3>
        {critical.length === 0 ? (
          <p className="empty-state">
            Keine kritischen Tickets – alles im Plan.
          </p>
        ) : (
          <ul>
            {critical.map((ticket) => (
              <li key={ticket.id}>
                <button onClick={() => onOpenTicket(ticket.id)} type="button">
                  <code>{ticket.ticketNumber}</code>
                  <strong>{ticket.subject}</strong>
                  <span>
                    {ticket.overdue
                      ? "SLA überschritten"
                      : ticket.atRisk
                        ? `SLA fällig ${ticket.resolutionDueAt ? dateTime(ticket.resolutionDueAt) : ""}`
                        : "Noch keine Antwort"}
                    {" · "}
                    {overview.agents.find(
                      (agent) => agent.id === ticket.assignedAgentId,
                    )?.displayName ?? "Nicht zugewiesen"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Redistribute({
  overview,
  tenantId,
  onChanged,
  onError,
  onOpenTicket,
}: {
  overview: Overview;
  tenantId: string;
  onChanged: (message: string) => void;
  onError: (message: string) => void;
  onOpenTicket: (ticketId: string) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState<string | null>(null);

  const columns = useMemo(
    () => [
      { id: "", name: "Nicht zugewiesen", absence: null as Absence | null },
      ...overview.agents.map((agent) => ({
        id: agent.id,
        name: agent.displayName,
        absence: agent.absence,
      })),
    ],
    [overview.agents],
  );

  async function reassign(ticketIds: string[], agentId: string) {
    if (ticketIds.length === 0) return;
    setBusy(true);
    try {
      await call({
        type: "reassign",
        tenantId,
        ticketIds,
        agentId: agentId || null,
      });
      const name = columns.find((column) => column.id === agentId)?.name;
      setSelected(new Set());
      onChanged(
        `${ticketIds.length} Ticket${ticketIds.length === 1 ? "" : "s"} ${
          agentId ? `${name} zugewiesen` : "freigegeben"
        }.`,
      );
    } catch (nextError) {
      onError(
        nextError instanceof Error ? nextError.message : String(nextError),
      );
    } finally {
      setBusy(false);
    }
  }

  function onDrop(event: DragEvent<HTMLElement>, agentId: string) {
    event.preventDefault();
    setDragOver(null);
    const ids = event.dataTransfer.getData("application/x-nextdesk-tickets");
    if (!ids) return;
    void reassign(ids.split(","), agentId);
  }

  async function applySuggestions() {
    const groups = new Map<string, string[]>();
    for (const move of overview.suggestions) {
      groups.set(move.toAgentId, [
        ...(groups.get(move.toAgentId) ?? []),
        move.ticketId,
      ]);
    }
    setBusy(true);
    try {
      for (const [agentId, ticketIds] of groups) {
        await call({ type: "reassign", tenantId, ticketIds, agentId });
      }
      onChanged(
        `${overview.suggestions.length} Tickets nach dem Vorschlag umverteilt.`,
      );
    } catch (nextError) {
      onError(
        nextError instanceof Error ? nextError.message : String(nextError),
      );
    } finally {
      setBusy(false);
    }
  }

  const ticketById = new Map(
    overview.tickets.map((ticket) => [ticket.id, ticket]),
  );
  const nameById = new Map(
    overview.agents.map((agent) => [agent.id, agent.displayName]),
  );

  return (
    <div className="team-supervision__redistribute">
      {overview.suggestions.length ? (
        <section
          aria-label="Vorschlag zur Lastverteilung"
          className="panel team-supervision__suggestions"
        >
          <header>
            <div>
              <h3>
                <Shuffle aria-hidden="true" size={16} /> Vorschlag zur
                Lastverteilung
              </h3>
              <p className="data-caption">
                Gewichtet nach Priorität und SLA-Risiko. Tickets abwesender
                Personen und die neuesten Tickets überlasteter Personen gehen an
                Kolleg:innen derselben Abteilung mit wenig Last.
              </p>
            </div>
            <button
              className="primary-button"
              disabled={busy}
              onClick={() => void applySuggestions()}
              type="button"
            >
              {busy ? "Wird umverteilt …" : "Vorschlag übernehmen"}
            </button>
          </header>
          <ul>
            {overview.suggestions.map((move) => {
              const ticket = ticketById.get(move.ticketId);
              return (
                <li key={move.ticketId}>
                  <code>{ticket?.ticketNumber}</code>
                  <span>{ticket?.subject}</span>
                  <small>
                    {nameById.get(move.fromAgentId)} → {move.toAgentName}
                  </small>
                </li>
              );
            })}
          </ul>
        </section>
      ) : (
        <p className="data-caption">
          Die Last ist ausgeglichen – kein Umverteilungsvorschlag.
        </p>
      )}
      <div
        className="team-supervision__bulk"
        role="group"
        aria-label="Mehrfachauswahl"
      >
        <span>
          {selected.size
            ? `${selected.size} Ticket${selected.size === 1 ? "" : "s"} ausgewählt`
            : "Tickets auswählen oder auf eine Person ziehen"}
        </span>
        <select
          aria-label="Zuweisen an"
          disabled={busy || selected.size === 0}
          onChange={(event) => setTarget(event.target.value)}
          value={target}
        >
          <option value="">Nicht zugewiesen</option>
          {overview.agents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.displayName}
              {agent.absence ? " (abwesend)" : ""}
            </option>
          ))}
        </select>
        <button
          className="primary-button"
          disabled={busy || selected.size === 0}
          onClick={() => void reassign([...selected], target)}
          type="button"
        >
          {busy ? "Wird zugewiesen …" : "Zuweisen"}
        </button>
      </div>
      {overview.truncated ? (
        <p className="data-caption">
          Es werden die ältesten 500 offenen Tickets angezeigt.
        </p>
      ) : null}
      <div className="team-supervision__board">
        {columns.map((column) => {
          const tickets = overview.tickets.filter(
            (ticket) => (ticket.assignedAgentId ?? "") === column.id,
          );
          return (
            <section
              aria-label={column.name}
              className={`team-supervision__column${dragOver === column.id ? " is-drop-target" : ""}`}
              key={column.id || "unassigned"}
              onDragLeave={() => setDragOver(null)}
              onDragOver={(event) => {
                event.preventDefault();
                setDragOver(column.id);
              }}
              onDrop={(event) => onDrop(event, column.id)}
            >
              <header>
                <strong>{column.name}</strong>
                <span>{tickets.length}</span>
              </header>
              {column.absence ? (
                <p className="team-supervision__absence">
                  Abwesend bis {shortDate(column.absence.endsAt)}
                </p>
              ) : null}
              <ul>
                {tickets.map((ticket) => {
                  const checked = selected.has(ticket.id);
                  return (
                    <li
                      className={[
                        "team-supervision__card",
                        ticket.overdue ? "is-bad" : "",
                        ticket.atRisk || ticket.noFirstResponse
                          ? "is-warn"
                          : "",
                        checked ? "is-selected" : "",
                      ].join(" ")}
                      draggable={!busy}
                      key={ticket.id}
                      onDragStart={(event) => {
                        const ids = checked ? [...selected] : [ticket.id];
                        event.dataTransfer.setData(
                          "application/x-nextdesk-tickets",
                          ids.join(","),
                        );
                        event.dataTransfer.effectAllowed = "move";
                      }}
                    >
                      <input
                        aria-label={`${ticket.ticketNumber} auswählen`}
                        checked={checked}
                        onChange={(event) =>
                          setSelected((current) => {
                            const next = new Set(current);
                            if (event.target.checked) next.add(ticket.id);
                            else next.delete(ticket.id);
                            return next;
                          })
                        }
                        type="checkbox"
                      />
                      <button
                        onClick={() => onOpenTicket(ticket.id)}
                        type="button"
                      >
                        <code>{ticket.ticketNumber}</code>
                        <span>{ticket.subject}</span>
                        <small>
                          {ticket.priorityLabel} · {ticket.statusLabel}
                          {ticket.resolutionDueAt
                            ? ` · SLA ${dateTime(ticket.resolutionDueAt)}`
                            : ""}
                        </small>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function QualityReview({
  tenantId,
  onSaved,
}: {
  tenantId: string;
  onSaved: (message: string) => void;
}) {
  const [tickets, setTickets] = useState<ReviewTicket[] | null>(null);
  const [error, setError] = useState("");
  const [forms, setForms] = useState<
    Record<
      string,
      {
        rating: number;
        solutionCorrect: boolean;
        toneAppropriate: boolean;
        documentationOk: boolean;
        comment: string;
      }
    >
  >({});
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError("");
    try {
      const data = await call<{ tickets: ReviewTicket[] }>({
        type: "reviewQueue",
        tenantId,
      });
      setTickets(data.tickets);
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : String(nextError),
      );
    }
  }, [tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(ticket: ReviewTicket) {
    const form = forms[ticket.id] ?? {
      rating: 4,
      solutionCorrect: true,
      toneAppropriate: true,
      documentationOk: true,
      comment: "",
    };
    setSaving(ticket.id);
    try {
      await call({
        type: "saveReview",
        tenantId,
        ticketId: ticket.id,
        rating: form.rating,
        solutionCorrect: form.solutionCorrect,
        toneAppropriate: form.toneAppropriate,
        documentationOk: form.documentationOk,
        comment: form.comment.trim() || null,
      });
      setTickets(
        (current) => current?.filter((item) => item.id !== ticket.id) ?? null,
      );
      onSaved(`Bewertung für ${ticket.ticketNumber} gespeichert.`);
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : String(nextError),
      );
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="team-supervision__quality">
      <p className="data-caption">
        Stichprobe von gelösten Tickets der letzten 30 Tagen, die noch nicht
        bewertet wurden. Die Bewertungen fliessen in den Monatsbericht ein.
      </p>
      <button
        className="secondary-button"
        onClick={() => void load()}
        type="button"
      >
        Neue Stichprobe
      </button>
      {error ? (
        <p className="form-message form-message--error" role="alert">
          {error}
        </p>
      ) : null}
      {tickets === null ? (
        <p className="empty-state">Stichprobe wird geladen …</p>
      ) : tickets.length === 0 ? (
        <p className="empty-state">Alle gelösten Tickets sind bewertet.</p>
      ) : (
        tickets.map((ticket) => {
          const form = forms[ticket.id] ?? {
            rating: 4,
            solutionCorrect: true,
            toneAppropriate: true,
            documentationOk: true,
            comment: "",
          };
          const update = (patch: Partial<typeof form>) =>
            setForms((current) => ({
              ...current,
              [ticket.id]: { ...form, ...patch },
            }));
          return (
            <article className="panel team-supervision__review" key={ticket.id}>
              <header>
                <code>{ticket.ticketNumber}</code>
                <h3>{ticket.subject}</h3>
                <span>
                  {ticket.agentName ?? "Unbekannt"} · gelöst{" "}
                  {dateTime(ticket.resolvedAt)}
                </span>
              </header>
              {ticket.description ? <p>{ticket.description}</p> : null}
              {ticket.lastReply ? (
                <blockquote>
                  <small>Letzte Antwort an die anfragende Person</small>
                  {ticket.lastReply}
                </blockquote>
              ) : null}
              <div className="team-supervision__review-form">
                <label>
                  Bewertung
                  <select
                    onChange={(event) =>
                      update({ rating: Number(event.target.value) })
                    }
                    value={form.rating}
                  >
                    <option value={5}>5 – hervorragend</option>
                    <option value={4}>4 – gut</option>
                    <option value={3}>3 – in Ordnung</option>
                    <option value={2}>2 – verbesserungswürdig</option>
                    <option value={1}>1 – ungenügend</option>
                  </select>
                </label>
                <label className="team-supervision__check">
                  <input
                    checked={form.solutionCorrect}
                    onChange={(event) =>
                      update({ solutionCorrect: event.target.checked })
                    }
                    type="checkbox"
                  />
                  Lösung korrekt
                </label>
                <label className="team-supervision__check">
                  <input
                    checked={form.toneAppropriate}
                    onChange={(event) =>
                      update({ toneAppropriate: event.target.checked })
                    }
                    type="checkbox"
                  />
                  Ton passend
                </label>
                <label className="team-supervision__check">
                  <input
                    checked={form.documentationOk}
                    onChange={(event) =>
                      update({ documentationOk: event.target.checked })
                    }
                    type="checkbox"
                  />
                  Dokumentation vollständig
                </label>
                <label className="team-supervision__wide">
                  Feedback (optional)
                  <textarea
                    maxLength={2000}
                    onChange={(event) =>
                      update({ comment: event.target.value })
                    }
                    rows={2}
                    value={form.comment}
                  />
                </label>
                <button
                  className="primary-button"
                  disabled={saving === ticket.id}
                  onClick={() => void save(ticket)}
                  type="button"
                >
                  {saving === ticket.id
                    ? "Wird gespeichert …"
                    : "Bewertung speichern"}
                </button>
              </div>
            </article>
          );
        })
      )}
    </div>
  );
}

function MonthlyReport({ tenantId }: { tenantId: string }) {
  const [month, setMonth] = useState(currentMonth);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void call<Report>({ type: "monthlyReport", tenantId, month })
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
    <div className="team-supervision__report">
      <div className="team-supervision__report-controls">
        <label>
          Monat
          <input
            max={currentMonth()}
            onChange={(event) =>
              event.target.value && setMonth(event.target.value)
            }
            type="month"
            value={month}
          />
        </label>
        <button
          className="secondary-button"
          disabled={!report}
          onClick={() => window.print()}
          type="button"
        >
          <Printer aria-hidden="true" size={16} /> Als PDF drucken
        </button>
      </div>
      {error ? (
        <p className="form-message form-message--error" role="alert">
          {error}
        </p>
      ) : null}
      {loading && !report ? (
        <p className="empty-state">Bericht wird erstellt …</p>
      ) : null}
      {report ? (
        <div className="team-supervision__print">
          <h3>
            Monatsbericht {monthLabel(report.month)} –{" "}
            {report.departments.map((department) => department.name).join(", ")}
          </h3>
          <div className="team-supervision__table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Agent:in</th>
                  <th scope="col">Zugewiesen</th>
                  <th scope="col">Gelöst</th>
                  <th scope="col">Ø Erstreaktion</th>
                  <th scope="col">Ø Lösungszeit</th>
                  <th scope="col">SLA eingehalten</th>
                  <th scope="col">Zufriedenheit</th>
                  <th scope="col">Qualität</th>
                  <th scope="col">Antworten</th>
                  <th scope="col">Wissensartikel</th>
                </tr>
              </thead>
              <tbody>
                {report.agents.map((agent) => (
                  <tr key={agent.id}>
                    <th scope="row">{agent.displayName}</th>
                    <td>{agent.ticketsAssigned}</td>
                    <td>
                      {agent.ticketsResolved}
                      <Trend
                        current={agent.ticketsResolved}
                        previous={agent.previous?.ticketsResolved}
                      />
                    </td>
                    <td>
                      {duration(agent.averageFirstResponseMinutes)}
                      <Trend
                        current={agent.averageFirstResponseMinutes}
                        lowerIsBetter
                        previous={agent.previous?.averageFirstResponseMinutes}
                      />
                    </td>
                    <td>
                      {duration(agent.averageResolutionMinutes)}
                      <Trend
                        current={agent.averageResolutionMinutes}
                        lowerIsBetter
                        previous={agent.previous?.averageResolutionMinutes}
                      />
                    </td>
                    <td>
                      {agent.slaCompliancePercent === null
                        ? "–"
                        : `${agent.slaCompliancePercent} %`}
                      <Trend
                        current={agent.slaCompliancePercent}
                        previous={agent.previous?.slaCompliancePercent}
                      />
                    </td>
                    <td>
                      {agent.satisfactionAverage === null
                        ? "–"
                        : `${agent.satisfactionAverage} (${agent.satisfactionResponses})`}
                      <Trend
                        current={agent.satisfactionAverage}
                        previous={agent.previous?.satisfactionAverage}
                      />
                    </td>
                    <td>
                      {agent.qualityAverage === null
                        ? "–"
                        : `${agent.qualityAverage} / 5 (${agent.qualityReviews})`}
                      <Trend
                        current={agent.qualityAverage}
                        previous={agent.previous?.qualityAverage}
                      />
                    </td>
                    <td>{agent.externalReplies}</td>
                    <td>{agent.knowledgeArticles}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="data-caption">
            Zugewiesen = im Monat erstellte Tickets der Person. Gelöst = im
            Monat gelöste Tickets. Qualität aus der Qualitätsprüfung. Pfeile
            zeigen die Veränderung zum Vormonat (grün = besser).
          </p>
        </div>
      ) : null}
    </div>
  );
}

function Trend({
  current,
  previous,
  lowerIsBetter = false,
}: {
  current: number | null;
  previous: number | null | undefined;
  lowerIsBetter?: boolean;
}) {
  if (current === null || previous === null || previous === undefined) {
    return null;
  }
  if (current === previous) {
    return (
      <span className="team-supervision__trend" title="Wie im Vormonat">
        →
      </span>
    );
  }
  const up = current > previous;
  const good = lowerIsBetter ? !up : up;
  return (
    <span
      className={`team-supervision__trend ${good ? "is-good" : "is-bad"}`}
      title={`Vormonat: ${previous}`}
    >
      {up ? "↑" : "↓"}
    </span>
  );
}

type CoachingKind = "note" | "praise" | "goal" | "concern";
const COACHING_LABEL: Record<CoachingKind, string> = {
  note: "Notiz",
  praise: "Lob",
  goal: "Ziel",
  concern: "Beobachtung",
};
type CoachingNote = {
  id: string;
  body: string;
  kind: CoachingKind;
  createdAt: string;
};
type CoachingReview = {
  id: string;
  rating: number;
  solutionCorrect: boolean;
  toneAppropriate: boolean;
  documentationOk: boolean | null;
  comment: string | null;
  createdAt: string;
  ticketId: string;
  ticketNumber: string | null;
  subject: string | null;
};

function Coaching({
  agents,
  tenantId,
  onOpenTicket,
}: {
  agents: { id: string; displayName: string }[];
  tenantId: string;
  onOpenTicket?: (ticketId: string) => void;
}) {
  const [agentId, setAgentId] = useState(agents[0]?.id ?? "");
  const [notes, setNotes] = useState<CoachingNote[]>([]);
  const [reviews, setReviews] = useState<CoachingReview[]>([]);
  const [kudos, setKudos] = useState<KudosEntry[]>([]);
  const [draft, setDraft] = useState("");
  const [kind, setKind] = useState<CoachingKind>("note");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!agentId) return;
    setError("");
    try {
      const data = await call<{
        notes: CoachingNote[];
        reviews: CoachingReview[];
        kudos?: KudosEntry[];
      }>({ type: "coachingNotes", tenantId, agentId });
      setNotes(data.notes);
      setReviews(data.reviews);
      setKudos(data.kudos ?? []);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Die Notizen konnten nicht geladen werden.",
      );
    }
  }, [agentId, tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function add() {
    if (!draft.trim()) return;
    setBusy(true);
    try {
      await call({
        type: "addCoachingNote",
        tenantId,
        agentId,
        body: draft.trim(),
        kind,
      });
      setDraft("");
      await load();
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Die Notiz konnte nicht gespeichert werden.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove(noteId: string) {
    if (!window.confirm("Notiz löschen?")) return;
    setBusy(true);
    try {
      await call({ type: "deleteCoachingNote", tenantId, noteId });
      await load();
    } finally {
      setBusy(false);
    }
  }

  /** Opens a print view (save as PDF) with metrics, goals, notes and reviews. */
  async function printSheet() {
    const sheetWindow = window.open("", "_blank");
    if (!sheetWindow) {
      setError("Bitte erlauben Sie Pop-ups, um das Gesprächsblatt zu öffnen.");
      return;
    }
    sheetWindow.document.write(
      '<p style="font-family:sans-serif">Wird vorbereitet …</p>',
    );
    try {
      const month = currentMonth();
      const report = await call<Report>({
        type: "monthlyReport",
        tenantId,
        month,
      });
      const agentReport =
        report.agents.find((entry) => entry.id === agentId) ?? null;
      const { data: session } = supabase
        ? await supabase.auth.getUser()
        : { data: { user: null } };
      const html = buildOneOnOneSheet({
        agentName:
          agents.find((entry) => entry.id === agentId)?.displayName ?? "",
        supervisorName:
          (session.user?.user_metadata?.full_name as string | undefined) ??
          session.user?.email ??
          "Vorgesetzte Person",
        monthLabel: monthLabel(month),
        current: agentReport,
        previous: agentReport?.previous
          ? { ...agentReport.previous, knowledgeArticles: 0 }
          : null,
        notes,
        reviews,
        kudos,
      });
      sheetWindow.document.open();
      sheetWindow.document.write(html);
      sheetWindow.document.close();
      sheetWindow.focus();
      window.setTimeout(() => sheetWindow.print(), 300);
    } catch (nextError) {
      sheetWindow.close();
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Das Gesprächsblatt konnte nicht erstellt werden.",
      );
    }
  }

  if (!agents.length) {
    return <p className="empty-state">Noch keine Agent:innen im Team.</p>;
  }
  const date = (value: string) =>
    new Date(value).toLocaleDateString("de-CH", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });

  return (
    <div className="team-supervision__coaching">
      <p className="data-caption">
        Private Notizen für Mitarbeitergespräche. Nur Sie sehen Ihre Notizen;
        daneben die letzten Qualitätsprüfungen und das Lob von Kund:innen.
      </p>
      <div className="team-supervision__coaching-toolbar">
        <label className="team-supervision__coaching-agent">
          Agent:in
          <select
            onChange={(event) => setAgentId(event.target.value)}
            value={agentId}
          >
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.displayName}
              </option>
            ))}
          </select>
        </label>
        <button
          className="secondary-button"
          disabled={busy || !agentId}
          onClick={() => void printSheet()}
          type="button"
        >
          <Printer aria-hidden="true" size={15} /> Gesprächsblatt (PDF)
        </button>
      </div>
      {error ? (
        <p className="form-message form-message--error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="team-supervision__coaching-grid">
        <section className="team-supervision__coaching-panel">
          <h3>Notizen</h3>
          <div className="team-supervision__coaching-form">
            <div
              aria-label="Art der Notiz"
              className="team-supervision__coaching-kinds"
              role="radiogroup"
            >
              {(Object.keys(COACHING_LABEL) as CoachingKind[]).map((value) => (
                <button
                  aria-checked={kind === value}
                  className={`is-${value}${kind === value ? " is-active" : ""}`}
                  key={value}
                  onClick={() => setKind(value)}
                  role="radio"
                  type="button"
                >
                  {COACHING_LABEL[value]}
                </button>
              ))}
            </div>
            <textarea
              maxLength={4000}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="z. B. «Sehr freundliche Antworten bei ICT-2026-000025» oder Ziel für das nächste Gespräch"
              rows={3}
              value={draft}
            />
            <button
              className="primary-button"
              disabled={busy || !draft.trim()}
              onClick={() => void add()}
              type="button"
            >
              Notiz speichern
            </button>
          </div>
          {notes.length ? (
            <ul className="team-supervision__coaching-list">
              {notes.map((note) => (
                <li className={`is-${note.kind}`} key={note.id}>
                  <div>
                    <span className="team-supervision__coaching-kind">
                      {COACHING_LABEL[note.kind] ?? "Notiz"}
                    </span>
                    <time>{date(note.createdAt)}</time>
                  </div>
                  <p>{note.body}</p>
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => void remove(note.id)}
                    type="button"
                  >
                    Löschen
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty-state">Noch keine Notizen.</p>
          )}
        </section>
        <section className="team-supervision__coaching-panel">
          <h3>Letzte Qualitätsprüfungen</h3>
          {reviews.length ? (
            <ul className="team-supervision__coaching-list">
              {reviews.map((review) => (
                <li key={review.id}>
                  <div>
                    <strong>{review.rating} / 5</strong>
                    <time>{date(review.createdAt)}</time>
                  </div>
                  <button
                    className="text-button"
                    onClick={() => onOpenTicket?.(review.ticketId)}
                    type="button"
                  >
                    {review.ticketNumber ?? "Ticket"} {review.subject ?? ""}
                  </button>
                  <p>
                    {review.solutionCorrect
                      ? "Lösung korrekt"
                      : "Lösung prüfen"}{" "}
                    · {review.toneAppropriate ? "Ton passend" : "Ton prüfen"}
                    {review.documentationOk === null
                      ? ""
                      : review.documentationOk
                        ? " · Dokumentation vollständig"
                        : " · Dokumentation lückenhaft"}
                    {review.comment ? ` · ${review.comment}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty-state">Noch keine Qualitätsprüfungen.</p>
          )}
        </section>
        <section className="team-supervision__coaching-panel">
          <h3>Lob von Kund:innen</h3>
          {kudos.length ? (
            <ul className="team-supervision__coaching-list">
              {kudos.map((entry) => (
                <li className="is-praise" key={entry.ticketId}>
                  <div>
                    <strong aria-label={`${entry.score} von 5`}>
                      {scoreStars(entry.score)}
                    </strong>
                    <time>{date(entry.createdAt)}</time>
                  </div>
                  <button
                    className="text-button"
                    onClick={() => onOpenTicket?.(entry.ticketId)}
                    type="button"
                  >
                    {entry.ticketNumber ?? "Ticket"} {entry.subject ?? ""}
                  </button>
                  <p>
                    {entry.comment
                      ? `«${entry.comment}»`
                      : "Top-Bewertung ohne Kommentar"}{" "}
                    – {kudosAuthor(entry.requesterName)}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty-state">
              Noch kein Lob in den letzten sechs Monaten.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
