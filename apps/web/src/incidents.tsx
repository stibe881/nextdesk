import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  CheckCircle2,
  Clock3,
  LoaderCircle,
  Network,
  Search,
  Wrench,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";

import {
  IncidentKnowledgeCard,
  IncidentNetworkCard,
  IncidentPublicMessageCard,
  IncidentTicketsCard,
} from "./incidents-extras";
import { functionErrorMessage } from "./lib/function-error";
import {
  ACTIVE_FILTERS,
  CAUSE_LABELS,
  CAUSES,
  EVENT_LABELS,
  formatAvailability,
  formatDuration,
  liveMinutes,
  parseCaseResult,
  parseCloseResult,
  parseIncidentDetail,
  parseIncidentList,
  parseIncidentReport,
  SKIP_REASON_LABELS,
  SENSOR_TONE_LABELS,
  sensorTone,
  STATE_LABELS,
  ticketReplyText,
  type IncidentCause,
  type IncidentCloseResult,
  type IncidentDetail,
  type IncidentFilter,
  type IncidentReport,
  type IncidentStats,
  type IncidentSummary,
} from "./lib/incidents";
import { supabase } from "./lib/supabase";
import { useVisibleInterval } from "./lib/use-visible-interval";
import "./incidents.css";

async function call(body: Record<string, unknown>): Promise<unknown> {
  if (!supabase) throw new Error("Die Verbindung ist nicht konfiguriert.");
  const { data, error } = await supabase.functions.invoke("incidents", {
    body,
  });
  if (error) {
    throw new Error(
      await functionErrorMessage(
        error,
        "Die Störungen sind gerade nicht verfügbar.",
      ),
    );
  }
  return data;
}

const DATE_TIME = new Intl.DateTimeFormat("de-CH", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Europe/Zurich",
});
const TIME = new Intl.DateTimeFormat("de-CH", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  timeZone: "Europe/Zurich",
});
const dateTime = (value: string | null) =>
  value ? DATE_TIME.format(new Date(value)) : "–";

/** Re-renders every 30 seconds (visible tab only) so durations run live. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useVisibleInterval(() => setNow(Date.now()), 30_000);
  return now;
}

/**
 * Reloads when an incident of the tenant changes (Supabase Realtime, only
 * rows the incident team may read), debounced. A slow poll on the visible tab
 * covers dropped realtime connections.
 */
function useIncidentChanges(
  tenantId: string,
  incidentId: string | null,
  onChange: () => void,
): void {
  const latest = useRef(onChange);
  latest.current = onChange;
  useEffect(() => {
    if (!supabase) return;
    const client = supabase;
    let timer: number | null = null;
    const schedule = () => {
      if (timer !== null || document.visibilityState !== "visible") return;
      timer = window.setTimeout(() => {
        timer = null;
        latest.current();
      }, 400);
    };
    const channel = client
      .channel(`incidents:${tenantId}:${incidentId ?? "list"}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          filter: incidentId
            ? `id=eq.${incidentId}`
            : `tenant_id=eq.${tenantId}`,
          schema: "public",
          table: "monitoring_incidents",
        },
        schedule,
      )
      .subscribe();
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      void client.removeChannel(channel);
    };
  }, [incidentId, tenantId]);
  useVisibleInterval(() => latest.current(), 60_000);
}

const TABS: { key: IncidentFilter; label: string }[] = [
  { key: "active", label: "Aktiv" },
  { key: "resolved", label: "Behoben" },
  { key: "closed", label: "Abgeschlossen" },
  { key: "all", label: "Alle" },
];

const TILE_FILTER_LABELS: Partial<Record<IncidentFilter, string>> = {
  unacknowledged: "Aktive Störungen, die noch niemand bestätigt hat",
  services: "Aktive Störungen mit betroffenen Diensten",
  recent: "In den letzten 30 Tagen behobene Störungen",
};

const EMPTY_TEXT: Record<IncidentFilter, string> = {
  active: "Keine aktiven Störungen. Alles läuft.",
  unacknowledged: "Alle aktiven Störungen sind bestätigt.",
  services: "Keine Dienste betroffen.",
  recent: "In den letzten 30 Tagen wurde keine Störung behoben.",
  resolved: "Keine behobenen Störungen, die noch abgeschlossen werden müssen.",
  closed: "Noch keine abgeschlossenen Störungen.",
  all: "Noch keine Störungen.",
};

function severityClass(entry: { severity: string; state: string }): string {
  if (entry.state !== "active") return "ok";
  return entry.severity === "warning" ? "warn" : "bad";
}

function Tile({
  active,
  detail,
  hot = false,
  label,
  onClick,
  value,
}: {
  active: boolean;
  detail: string;
  hot?: boolean;
  label: string;
  onClick: () => void;
  value: string | number;
}) {
  return (
    <button
      aria-pressed={active}
      className={`incident-tile${hot ? " incident-tile--hot" : ""}${active ? " incident-tile--active" : ""}`}
      onClick={onClick}
      type="button"
    >
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </button>
  );
}

/**
 * «Störungen»: messages from PRTG, one incident per device, with follow-ups
 * behind a failed device. Handled here completely, without tickets.
 */
export function Incidents({
  tenantId,
  focusId,
  onFocusConsumed,
  onOpenTicket,
}: {
  tenantId: string;
  focusId?: string | null;
  onFocusConsumed?: () => void;
  onOpenTicket?: (ticketId: string) => void;
}) {
  const [filter, setFilter] = useState<IncidentFilter>("active");
  const [incidents, setIncidents] = useState<IncidentSummary[] | null>(null);
  const [stats, setStats] = useState<IncidentStats | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string | null>(focusId ?? null);
  const [view, setView] = useState<"list" | "report">("list");
  const [revision, setRevision] = useState(0);
  const now = useNow();
  const request = useRef(0);

  useEffect(() => {
    if (focusId) {
      setSelected(focusId);
      onFocusConsumed?.();
    }
  }, [focusId, onFocusConsumed]);

  // Search waits for a short pause in typing.
  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  // The first page (history: the newest 50; active: all of them).
  const loadFirst = useCallback(() => {
    const version = ++request.current;
    return call({ type: "list", tenantId, filter, search: search || null })
      .then((value) => {
        if (request.current !== version) return;
        const parsed = parseIncidentList(value);
        if (!parsed) {
          setError("Die Störungen konnten nicht gelesen werden.");
          return;
        }
        setError("");
        setIncidents(parsed.incidents);
        setNextCursor(parsed.nextCursor);
        if (parsed.stats) setStats(parsed.stats);
      })
      .catch((cause: Error) => {
        if (request.current === version) setError(cause.message);
      });
  }, [filter, search, tenantId]);

  useEffect(() => {
    setIncidents(null);
    void loadFirst();
  }, [loadFirst, revision]);

  // New PRTG messages show up without reloading the page (realtime, else a
  // slow poll while the tab is visible). Further pages stay as they are.
  useIncidentChanges(tenantId, null, () => {
    if (!selected && !nextCursor) void loadFirst();
    else if (!selected && ACTIVE_FILTERS.includes(filter)) void loadFirst();
  });

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    const version = request.current;
    try {
      const parsed = parseIncidentList(
        await call({
          type: "list",
          tenantId,
          filter,
          search: search || null,
          cursor: nextCursor,
        }),
      );
      if (!parsed || request.current !== version) return;
      setIncidents((current) => {
        const known = new Set((current ?? []).map((entry) => entry.id));
        return [
          ...(current ?? []),
          ...parsed.incidents.filter((entry) => !known.has(entry.id)),
        ];
      });
      setNextCursor(parsed.nextCursor);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoadingMore(false);
    }
  }

  if (selected) {
    return (
      <IncidentView
        incidentId={selected}
        onBack={() => {
          setSelected(null);
          setRevision((value) => value + 1);
        }}
        onOpen={setSelected}
        onOpenTicket={onOpenTicket}
        tenantId={tenantId}
      />
    );
  }

  return (
    <section className="incidents" aria-labelledby="incidents-title">
      <header className="incidents__hero">
        <div>
          <p className="eyebrow">BETRIEB</p>
          <h2 id="incidents-title">Störungen</h2>
          <p>
            Meldungen aus PRTG: eine Störung pro Gerät, Geräte hinter einem
            gestörten Gerät als Folgestörung. Bestätigen Sie eine Störung,
            sobald Sie sich darum kümmern. Meldet PRTG wieder OK, gilt sie als
            behoben; abgeschlossen wird sie von Ihnen mit der Ursache.
          </p>
        </div>
        <button
          className={view === "report" ? "primary-button" : "secondary-button"}
          onClick={() => setView(view === "report" ? "list" : "report")}
          type="button"
        >
          <BarChart3 aria-hidden="true" size={16} />
          {view === "report" ? "Zur Liste" : "Auswertung"}
        </button>
      </header>

      {view === "report" ? (
        <IncidentReportView tenantId={tenantId} />
      ) : (
        <>
          {stats ? (
            <div className="incidents__tiles">
              <Tile
                active={filter === "active"}
                detail={
                  stats.active
                    ? `${stats.activeDown} ${stats.activeDown === 1 ? "Ausfall" : "Ausfälle"}, ${stats.activeWarning} ${stats.activeWarning === 1 ? "Warnung" : "Warnungen"}`
                    : "alles in Betrieb"
                }
                hot={stats.activeDown > 0}
                label="Aktiv"
                onClick={() => setFilter("active")}
                value={stats.active}
              />
              <Tile
                active={filter === "unacknowledged"}
                detail={
                  stats.oldestUnacknowledgedAt && stats.unacknowledged
                    ? `älteste seit ${formatDuration(liveMinutes(stats.oldestUnacknowledgedAt, null, now))}`
                    : "alle bestätigt"
                }
                hot={stats.unacknowledged > 0}
                label="Unbestätigt"
                onClick={() => setFilter("unacknowledged")}
                value={stats.unacknowledged}
              />
              <Tile
                active={filter === "services"}
                detail={
                  stats.affectedServices.length
                    ? stats.affectedServices.slice(0, 3).join(", ")
                    : "keine"
                }
                label="Betroffene Dienste"
                onClick={() => setFilter("services")}
                value={stats.affectedServices.length}
              />
              <Tile
                active={filter === "recent"}
                detail="Median, 30 Tage"
                label="Behebungszeit"
                onClick={() => setFilter("recent")}
                value={formatDuration(stats.medianResolveMinutes)}
              />
              <Tile
                active={false}
                detail={
                  stats.monitoredDevices
                    ? `30 Tage, ${stats.monitoredDevices} überwachte Geräte`
                    : "keine überwachten Geräte"
                }
                label="Verfügbarkeit"
                onClick={() => setView("report")}
                value={formatAvailability(stats.availability)}
              />
            </div>
          ) : null}

          <div
            aria-label="Störungen filtern"
            className="queue-tabs incidents__tabs"
            role="group"
          >
            {TABS.map((entry) => (
              <button
                aria-pressed={filter === entry.key}
                className={
                  filter === entry.key ? "queue-tab selected" : "queue-tab"
                }
                key={entry.key}
                onClick={() => setFilter(entry.key)}
                type="button"
              >
                {entry.label}
              </button>
            ))}
          </div>
          <label className="incidents__search">
            <Search aria-hidden="true" size={15} />
            <span className="sr-only">Störungen durchsuchen</span>
            <input
              maxLength={120}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Nummer, Gerät oder Titel suchen …"
              type="search"
              value={searchInput}
            />
          </label>
          {TILE_FILTER_LABELS[filter] ? (
            <p className="incidents__tile-filter" role="status">
              {TILE_FILTER_LABELS[filter]}
              <button
                className="text-button"
                onClick={() => setFilter("active")}
                type="button"
              >
                Filter aufheben
              </button>
            </p>
          ) : null}

          {error ? (
            <p className="ticket-detail-message error" role="alert">
              <AlertTriangle aria-hidden="true" size={16} />
              {error}
            </p>
          ) : null}
          {!incidents && !error ? (
            <p className="incidents__empty" role="status">
              <LoaderCircle
                aria-hidden="true"
                className="ticket-detail-spinner"
                size={16}
              />{" "}
              Störungen werden geladen …
            </p>
          ) : null}
          {incidents && incidents.length === 0 ? (
            <p className="incidents__empty">
              <CheckCircle2 aria-hidden="true" size={18} />
              {search ? "Keine Störung passt zur Suche." : EMPTY_TEXT[filter]}
            </p>
          ) : null}
          {incidents && incidents.length > 0 ? (
            <ul className="incidents__list">
              {incidents.map((entry) => (
                <li key={entry.id}>
                  <IncidentRow
                    entry={entry}
                    now={now}
                    onOpen={() => setSelected(entry.id)}
                  />
                  {entry.children.length ? (
                    <button
                      className="incident-row incident-row--child"
                      onClick={() => setSelected(entry.id)}
                      type="button"
                    >
                      <span
                        aria-hidden="true"
                        className={`incident-row__sev incident-sev--${severityClass(entry.children[0] ?? entry)}`}
                      />
                      <span className="incident-row__main">
                        <span className="incident-row__chips">
                          <span className="incident-chip incident-chip--line">
                            {entry.children.length === 1
                              ? "Folgestörung"
                              : `${entry.children.length} Folgestörungen`}
                          </span>
                          <span className="incident-row__number">
                            hinter {entry.deviceName ?? entry.number}
                          </span>
                        </span>
                        <strong>
                          {entry.children
                            .map((child) => child.deviceName ?? child.title)
                            .join(", ")}
                        </strong>
                        <small>
                          keine eigene Alarmierung, behebt sich mit der Ursache
                        </small>
                      </span>
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          {nextCursor ? (
            <button
              className="secondary-button incidents__more"
              disabled={loadingMore}
              onClick={() => void loadMore()}
              type="button"
            >
              {loadingMore ? "Wird geladen …" : "Weitere Störungen laden"}
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}

function IncidentRow({
  entry,
  now,
  onOpen,
}: {
  entry: IncidentSummary;
  now: number;
  onOpen: () => void;
}) {
  const minutes = liveMinutes(entry.openedAt, entry.resolvedAt, now);
  return (
    <button className="incident-row" onClick={onOpen} type="button">
      <span
        aria-hidden="true"
        className={`incident-row__sev incident-sev--${severityClass(entry)}`}
      />
      <span className="incident-row__main">
        <span className="incident-row__chips">
          <span className="incident-row__number">{entry.number}</span>
          {entry.state === "active" ? (
            <span
              className={`incident-chip incident-chip--${entry.severity === "warning" ? "warn" : "bad"}`}
            >
              {entry.severity === "warning" ? "Warnung" : "Ausfall"}
            </span>
          ) : (
            <span className="incident-chip incident-chip--ok">
              {STATE_LABELS[entry.state]}
            </span>
          )}
          {entry.state === "active" && !entry.acknowledgedAt ? (
            <span className="incident-chip incident-chip--bad">
              Unbestätigt
            </span>
          ) : null}
          {entry.acknowledgedAt ? (
            <span className="incident-chip incident-chip--ok">
              Bestätigt
              {entry.assignedAgentName ? ` · ${entry.assignedAgentName}` : ""}
            </span>
          ) : null}
          {entry.maintenance ? (
            <span className="incident-chip incident-chip--line">
              <Wrench aria-hidden="true" size={12} /> Wartung
            </span>
          ) : null}
          {entry.location ? (
            <span className="incident-chip incident-chip--line">
              {entry.location}
            </span>
          ) : null}
        </span>
        <strong>{entry.title}</strong>
        <small>
          seit {dateTime(entry.openedAt)}
          {entry.services.length
            ? ` · Dienste: ${entry.services.map((service) => service.name).join(", ")}`
            : ""}
          {entry.cause ? ` · Ursache: ${CAUSE_LABELS[entry.cause]}` : ""}
        </small>
      </span>
      <span className="incident-row__duration">
        <strong>{formatDuration(minutes)}</strong>
        {entry.state === "active" ? "läuft" : "Dauer"}
      </span>
    </button>
  );
}

function IncidentView({
  tenantId,
  incidentId,
  onBack,
  onOpen,
  onOpenTicket,
}: {
  tenantId: string;
  incidentId: string;
  onBack: () => void;
  onOpen: (id: string) => void;
  onOpenTicket?: ((ticketId: string) => void) | undefined;
}) {
  const [detail, setDetail] = useState<IncidentDetail | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [cause, setCause] = useState<IncidentCause | "">("");
  const [closingNote, setClosingNote] = useState("");
  const [notifyTickets, setNotifyTickets] = useState(true);
  const [ticketMessage, setTicketMessage] = useState("");
  const [messageEdited, setMessageEdited] = useState(false);
  const [withCase, setWithCase] = useState(false);
  const [caseTitle, setCaseTitle] = useState("");
  const [caseRecurring, setCaseRecurring] = useState(true);
  const [caseFormOpen, setCaseFormOpen] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const now = useNow();

  const run = useCallback(
    async (key: string, body: Record<string, unknown>) => {
      setBusy(key);
      setError("");
      setNotice("");
      try {
        const value = await call({ tenantId, incidentId, ...body });
        const parsed = parseIncidentDetail(value);
        if (!parsed)
          throw new Error("Die Störung konnte nicht gelesen werden.");
        setDetail(parsed);
        return value;
      } catch (cause) {
        setError((cause as Error).message);
        return null;
      } finally {
        setBusy(null);
      }
    },
    [incidentId, tenantId],
  );

  useEffect(() => {
    setDetail(null);
    void run("load", { type: "get" });
  }, [incidentId, run]);

  // Changes of this incident (PRTG messages, colleagues) show up live.
  useIncidentChanges(tenantId, incidentId, () => {
    void call({ type: "get", tenantId, incidentId })
      .then((value) => {
        const parsed = parseIncidentDetail(value);
        if (parsed) setDetail(parsed);
      })
      .catch(() => undefined);
  });

  // The reply to the tickets follows cause and note until edited by hand.
  useEffect(() => {
    if (!detail || !cause || messageEdited) return;
    setTicketMessage(
      ticketReplyText(detail, cause, closingNote.trim() || null),
    );
  }, [cause, closingNote, detail, messageEdited]);

  useEffect(() => {
    if (detail && !caseTitle) {
      setCaseTitle(
        `Wiederkehrende Störung: ${detail.deviceName ?? detail.title}`.slice(
          0,
          240,
        ),
      );
    }
  }, [caseTitle, detail]);

  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getSession().then(({ data }) => {
      setCurrentUserId(data.session?.user.id ?? null);
    });
  }, []);

  async function addNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!note.trim()) return;
    if (await run("note", { type: "note", text: note.trim() })) setNote("");
  }

  const openTickets = detail?.tickets.filter((ticket) => !ticket.closed) ?? [];

  async function close(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!cause) return;
    const sendReplies = notifyTickets && openTickets.length > 0;
    const value = await run("close", {
      type: "close",
      cause,
      note: closingNote.trim() || null,
      notifyTickets: sendReplies,
      ticketMessage: sendReplies ? ticketMessage.trim() || null : null,
      openCase:
        withCase && caseTitle.trim().length >= 3
          ? { title: caseTitle.trim(), includeRecurring: caseRecurring }
          : null,
    });
    if (value) setNotice(closeNotice(parseCloseResult(value)));
  }

  async function openCase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = await run("case", {
      type: "openCase",
      title: caseTitle.trim(),
      includeRecurring: caseRecurring,
    });
    if (value && parseCaseResult(value)) {
      setCaseFormOpen(false);
      setNotice("Der Fall wurde eröffnet. Sie finden ihn unter «Fälle».");
    }
  }

  const day = 24 * 60 * 60_000;
  const minutes = detail
    ? liveMinutes(detail.openedAt, detail.resolvedAt, now)
    : 0;

  return (
    <section className="incidents incident" aria-labelledby="incident-title">
      <button
        className="text-button incident__back"
        onClick={onBack}
        type="button"
      >
        <ArrowLeft aria-hidden="true" size={16} /> Zurück zu den Störungen
      </button>
      {!detail && !error ? (
        <p className="incidents__empty" role="status">
          <LoaderCircle
            aria-hidden="true"
            className="ticket-detail-spinner"
            size={16}
          />{" "}
          Störung wird geladen …
        </p>
      ) : null}
      {error ? (
        <p className="ticket-detail-message error" role="alert">
          <AlertTriangle aria-hidden="true" size={16} />
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="ticket-detail-message" role="status">
          <CheckCircle2 aria-hidden="true" size={16} />
          {notice}
        </p>
      ) : null}
      {detail ? (
        <>
          <header className="incident__head">
            <div>
              <div className="incident-row__chips">
                <span className="incident-row__number">{detail.number}</span>
                {detail.state === "active" ? (
                  <span
                    className={`incident-chip incident-chip--${detail.severity === "warning" ? "warn" : "bad"}`}
                  >
                    {detail.severity === "warning" ? "Warnung" : "Ausfall"} ·{" "}
                    {formatDuration(minutes)}
                  </span>
                ) : (
                  <span className="incident-chip incident-chip--ok">
                    {STATE_LABELS[detail.state]} · Dauer{" "}
                    {formatDuration(minutes)}
                  </span>
                )}
                {detail.maintenance ? (
                  <span className="incident-chip incident-chip--line">
                    <Wrench aria-hidden="true" size={12} /> Wartung
                  </span>
                ) : null}
              </div>
              <h2 id="incident-title">{detail.title}</h2>
              {detail.parent ? (
                <p className="incident__parent">
                  Folgestörung von{" "}
                  <button
                    className="text-button"
                    onClick={() => onOpen(detail.parent!.id)}
                    type="button"
                  >
                    {detail.parent.number} · {detail.parent.title}
                  </button>
                </p>
              ) : null}
            </div>
            {detail.state !== "closed" && !detail.acknowledgedAt ? (
              <button
                className="primary-button"
                disabled={busy !== null}
                onClick={() => void run("ack", { type: "acknowledge" })}
                type="button"
              >
                {busy === "ack" ? (
                  <LoaderCircle
                    aria-hidden="true"
                    className="ticket-detail-spinner"
                    size={15}
                  />
                ) : (
                  <CheckCircle2 aria-hidden="true" size={15} />
                )}
                Bestätigen: ich kümmere mich
              </button>
            ) : null}
          </header>

          <div className="incident__grid">
            <div className="incident__main">
              <article className="incident-card">
                <div className="incident-card__head">
                  <h3>Verlauf</h3>
                  <span className="incident-muted">PRTG und nextDesk</span>
                </div>
                <ol className="incident-timeline">
                  {detail.events.map((event) => (
                    <li
                      className={`incident-timeline__${event.kind === "prtg" ? (/(ok|up|beendet|ended)/i.test(event.status ?? "") ? "ok" : /(warn|ungew)/i.test(event.status ?? "") ? "warn" : "bad") : event.kind === "resolved" || event.kind === "closed" ? "ok" : event.kind === "realert" ? "warn" : "info"}`}
                      key={event.id}
                    >
                      <time dateTime={event.at}>
                        {TIME.format(new Date(event.at))}
                        {Date.now() - Date.parse(event.at) > day
                          ? ` · ${new Date(event.at).toLocaleDateString("de-CH")}`
                          : ""}
                      </time>
                      <span>
                        <strong>
                          {event.kind === "prtg"
                            ? `${event.sensor ?? "PRTG"}: ${event.status ?? ""}`
                            : (EVENT_LABELS[event.kind] ?? event.kind)}
                        </strong>
                        {event.message ? ` · ${event.message}` : ""}
                        {event.actor ? <small> · {event.actor}</small> : null}
                      </span>
                    </li>
                  ))}
                </ol>
                {detail.state !== "closed" ? (
                  <form
                    className="incident-note"
                    onSubmit={(event) => void addNote(event)}
                  >
                    <label className="sr-only" htmlFor="incident-note">
                      Notiz
                    </label>
                    <input
                      disabled={busy !== null}
                      id="incident-note"
                      maxLength={4000}
                      onChange={(event) => setNote(event.target.value)}
                      placeholder="Notiz zum Verlauf hinzufügen …"
                      type="text"
                      value={note}
                    />
                    <button
                      className="secondary-button"
                      disabled={busy !== null || !note.trim()}
                      type="submit"
                    >
                      Hinzufügen
                    </button>
                  </form>
                ) : null}
              </article>

              <IncidentTicketsCard
                busy={busy !== null}
                detail={detail}
                onLink={async (ticket) =>
                  (await run("link", { type: "linkTicket", ticket })) !== null
                }
                onOpenTicket={onOpenTicket}
                onUnlink={(ticketId) =>
                  void run("unlink", { type: "unlinkTicket", ticketId })
                }
              />

              <article className="incident-card">
                <div className="incident-card__head">
                  <h3>Letzte 24 Stunden</h3>
                  <span className="incident-muted">
                    {detail.history.weekCount === 1
                      ? "1 Störung in 7 Tagen"
                      : `${detail.history.weekCount} Störungen in 7 Tagen`}
                  </span>
                </div>
                <div className="incident-strip" aria-hidden="true">
                  {detail.history.segments.map((segment) => {
                    const start = Date.parse(segment.start);
                    const end = Date.parse(segment.end);
                    const left = ((start - (now - day)) / day) * 100;
                    const width = Math.max(0.6, ((end - start) / day) * 100);
                    return (
                      <span
                        className={`incident-strip__${segment.severity === "warning" ? "warn" : "bad"}`}
                        key={segment.start}
                        style={{
                          left: `${Math.max(0, left)}%`,
                          width: `${width}%`,
                        }}
                      />
                    );
                  })}
                </div>
                <div className="incident-strip__scale">
                  <span>vor 24 h</span>
                  <span>jetzt</span>
                </div>
                {detail.history.weekCount >= 3 ? (
                  <p className="incident-muted">
                    Das Gerät war diese Woche mehrfach gestört. Häufung prüfen
                    (z. B. Hardware oder Stromversorgung).
                  </p>
                ) : null}
              </article>

              {detail.recurrence.suggestCase || detail.problems.length ? (
                <article className="incident-card">
                  <div className="incident-card__head">
                    <h3>Fall</h3>
                    {detail.recurrence.suggestCase &&
                    detail.permissions.openCase &&
                    !caseFormOpen ? (
                      <button
                        className="text-button"
                        onClick={() => setCaseFormOpen(true)}
                        type="button"
                      >
                        Fall vorschlagen
                      </button>
                    ) : null}
                  </div>
                  {detail.recurrence.suggestCase ? (
                    <p className="incident-muted">
                      {detail.recurrence.sameCause30d >= 3
                        ? `Dieselbe Ursache trat an diesem Gerät in 30 Tagen ${detail.recurrence.sameCause30d}-mal auf.`
                        : `Das Gerät war in 30 Tagen ${detail.recurrence.sameDevice30d}-mal gestört.`}{" "}
                      Ein Fall (Problem-Management) hilft, die Ursache dauerhaft
                      zu beheben.
                    </p>
                  ) : null}
                  {detail.problems.length ? (
                    <ul className="incident-sensors">
                      {detail.problems.map((problem) => (
                        <li key={problem.id}>
                          <strong>{problem.title}</strong>
                          <span
                            className={`incident-chip incident-chip--${problem.status === "resolved" ? "ok" : "line"}`}
                          >
                            {problem.status === "resolved"
                              ? "Gelöst"
                              : problem.status === "known_error"
                                ? "Bekannter Fehler"
                                : "In Untersuchung"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {caseFormOpen ? (
                    <form
                      className="incident-close"
                      onSubmit={(event) => void openCase(event)}
                    >
                      <label className="incident-field">
                        Titel des Falls
                        <input
                          disabled={busy !== null}
                          maxLength={240}
                          minLength={3}
                          onChange={(event) => setCaseTitle(event.target.value)}
                          required
                          type="text"
                          value={caseTitle}
                        />
                      </label>
                      <label className="incident-check">
                        <input
                          checked={caseRecurring}
                          disabled={busy !== null}
                          onChange={(event) =>
                            setCaseRecurring(event.target.checked)
                          }
                          type="checkbox"
                        />
                        Frühere Störungen dieses Geräts (30 Tage) verknüpfen
                      </label>
                      <div className="incident-actions">
                        <button
                          className="primary-button"
                          disabled={
                            busy !== null || caseTitle.trim().length < 3
                          }
                          type="submit"
                        >
                          Fall eröffnen
                        </button>
                        <button
                          className="secondary-button"
                          disabled={busy !== null}
                          onClick={() => setCaseFormOpen(false)}
                          type="button"
                        >
                          Abbrechen
                        </button>
                      </div>
                    </form>
                  ) : null}
                </article>
              ) : null}

              <article className="incident-card">
                <h3>Sensoren</h3>
                <ul className="incident-sensors">
                  {detail.sensors.map((sensor, index) => (
                    <li key={`${sensor.name}-${index}`}>
                      <span>
                        <strong>{sensor.name}</strong>
                        <small>
                          {sensor.message ?? ""}
                          {sensor.lastEventAt
                            ? ` · ${dateTime(sensor.lastEventAt)}`
                            : ""}
                        </small>
                      </span>
                      {/* Like the ticket status: red error, yellow warning. */}
                      <span
                        className={`incident-chip incident-chip--${{ down: "bad", warning: "warn", ok: "ok" }[sensorTone(sensor)]}`}
                        title={sensor.status ?? undefined}
                      >
                        {SENSOR_TONE_LABELS[sensorTone(sensor)]}
                      </span>
                    </li>
                  ))}
                </ul>
              </article>
            </div>

            <div className="incident__side">
              <article className="incident-card">
                <div className="incident-card__head">
                  <h3>Zuständig</h3>
                  {currentUserId &&
                  detail.state !== "closed" &&
                  detail.assignedAgentId !== currentUserId &&
                  detail.agents.some((agent) => agent.id === currentUserId) ? (
                    <button
                      className="text-button"
                      disabled={busy !== null}
                      onClick={() =>
                        void run("assign", {
                          type: "assign",
                          agentId: currentUserId,
                        })
                      }
                      type="button"
                    >
                      Mir zuweisen
                    </button>
                  ) : null}
                </div>
                <label className="incident-field">
                  <span className="sr-only">Zuständige Person</span>
                  <select
                    disabled={busy !== null || detail.state === "closed"}
                    onChange={(event) =>
                      void run("assign", {
                        type: "assign",
                        agentId: event.target.value || null,
                      })
                    }
                    value={detail.assignedAgentId ?? ""}
                  >
                    <option value="">Nicht zugewiesen</option>
                    {detail.agents.map((agent) => (
                      <option key={agent.id} value={agent.id}>
                        {agent.name}
                      </option>
                    ))}
                  </select>
                </label>
                {detail.acknowledgedAt ? (
                  <p className="incident-muted">
                    Bestätigt von {detail.acknowledgedBy ?? "–"},{" "}
                    {dateTime(detail.acknowledgedAt)}
                  </p>
                ) : null}
              </article>

              {detail.device ? (
                <article className="incident-card">
                  <h3>Gerät</h3>
                  <dl className="incident-kv">
                    <dt>Name</dt>
                    <dd>{detail.device.name ?? detail.deviceName}</dd>
                    {detail.device.category || detail.device.model ? (
                      <>
                        <dt>Typ</dt>
                        <dd>
                          {[
                            detail.device.category,
                            [detail.device.manufacturer, detail.device.model]
                              .filter(Boolean)
                              .join(" "),
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </dd>
                      </>
                    ) : null}
                    {detail.device.location ? (
                      <>
                        <dt>Ort</dt>
                        <dd>{detail.device.location}</dd>
                      </>
                    ) : null}
                    {detail.device.ipAddress || detail.device.hostname ? (
                      <>
                        <dt>Adresse</dt>
                        <dd className="incident-mono">
                          {[detail.device.hostname, detail.device.ipAddress]
                            .filter(Boolean)
                            .join(" · ")}
                        </dd>
                      </>
                    ) : null}
                    {detail.device.prtgObjectId ? (
                      <>
                        <dt>PRTG</dt>
                        <dd>Objekt {detail.device.prtgObjectId}</dd>
                      </>
                    ) : null}
                  </dl>
                </article>
              ) : (
                <article className="incident-card">
                  <h3>Gerät</h3>
                  <p className="incident-muted">
                    «{detail.deviceName ?? detail.title}» ist keinem Gerät der
                    Infrastruktur zugeordnet. Tragen Sie beim Gerät die
                    PRTG-Objekt-ID ein, dann erscheinen Ort, Abhängigkeiten und
                    Dienste.
                  </p>
                </article>
              )}

              <IncidentNetworkCard detail={detail} onOpen={onOpen} />

              {detail.dependencies.upstream.length || detail.children.length ? (
                <article className="incident-card">
                  <h3>
                    <Network aria-hidden="true" size={15} /> Abhängigkeiten
                  </h3>
                  <ul className="incident-topology">
                    {detail.dependencies.upstream.map((node, index) => (
                      <li
                        key={node.assetId}
                        style={{ paddingLeft: index * 16 }}
                      >
                        <span
                          className={`incident-dot incident-dot--${node.failing ? "bad" : "ok"}`}
                        />
                        {node.name}
                      </li>
                    ))}
                    <li
                      style={{
                        paddingLeft: detail.dependencies.upstream.length * 16,
                      }}
                    >
                      <span
                        className={`incident-dot incident-dot--${severityClass(detail)}`}
                      />
                      <strong>{detail.deviceName ?? detail.title}</strong>
                      {detail.children.length ? " · Ursache" : ""}
                    </li>
                    {detail.children.map((child) => (
                      <li
                        key={child.id}
                        style={{
                          paddingLeft:
                            (detail.dependencies.upstream.length + 1) * 16,
                        }}
                      >
                        <span
                          className={`incident-dot incident-dot--${severityClass(child)}`}
                        />
                        <button
                          className="text-button"
                          onClick={() => onOpen(child.id)}
                          type="button"
                        >
                          {child.deviceName ?? child.title}
                        </button>
                      </li>
                    ))}
                  </ul>
                </article>
              ) : null}

              {detail.services.length ? (
                <article className="incident-card">
                  <h3>Betroffene Dienste</h3>
                  <div className="incident-row__chips">
                    {detail.services.map((service) => (
                      <span
                        className={`incident-chip incident-chip--${service.status === "operational" ? "ok" : service.status === "maintenance" ? "line" : "warn"}`}
                        key={service.id}
                      >
                        {service.name}
                      </span>
                    ))}
                  </div>
                  <p className="incident-muted">
                    Der Systemstatus wird automatisch gesetzt und nach der
                    Behebung zurückgesetzt.
                  </p>
                </article>
              ) : null}

              <IncidentPublicMessageCard detail={detail} tenantId={tenantId} />

              {detail.state === "closed" ? (
                <article className="incident-card">
                  <h3>Abgeschlossen</h3>
                  <dl className="incident-kv">
                    <dt>Ursache</dt>
                    <dd>{detail.cause ? CAUSE_LABELS[detail.cause] : "–"}</dd>
                    <dt>Von</dt>
                    <dd>
                      {detail.closedBy ?? "automatisch (PRTG meldet OK)"},{" "}
                      {dateTime(detail.closedAt)}
                    </dd>
                    {detail.closingNote ? (
                      <>
                        <dt>Notiz</dt>
                        <dd>{detail.closingNote}</dd>
                      </>
                    ) : null}
                  </dl>
                </article>
              ) : null}
              {detail.state !== "closed" || !detail.cause ? (
                <article className="incident-card">
                  <h3>
                    {detail.state === "closed"
                      ? "Ursache nachtragen (optional)"
                      : "Abschliessen"}
                  </h3>
                  {detail.state === "active" ? (
                    <p className="incident-muted">
                      <Clock3 aria-hidden="true" size={13} /> PRTG meldet noch
                      eine Störung. Meldet PRTG wieder OK, gilt sie als behoben.
                      Abschliessen beendet sie auch ohne OK-Meldung.
                    </p>
                  ) : detail.state === "resolved" ? (
                    <p className="incident-muted">
                      PRTG meldet wieder OK. Schliessen Sie die Störung mit der
                      Ursache ab.
                    </p>
                  ) : null}
                  <form
                    className="incident-close"
                    onSubmit={(event) => void close(event)}
                  >
                    <label className="incident-field">
                      Ursache
                      <select
                        disabled={busy !== null}
                        onChange={(event) =>
                          setCause(event.target.value as IncidentCause | "")
                        }
                        required
                        value={cause}
                      >
                        <option value="">Bitte wählen</option>
                        {CAUSES.map((entry) => (
                          <option key={entry} value={entry}>
                            {CAUSE_LABELS[entry]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="incident-field">
                      Lösung / Notiz (optional)
                      <textarea
                        disabled={busy !== null}
                        maxLength={4000}
                        onChange={(event) => setClosingNote(event.target.value)}
                        rows={3}
                        value={closingNote}
                      />
                    </label>
                    {openTickets.length ? (
                      <>
                        <label className="incident-check">
                          <input
                            checked={notifyTickets}
                            disabled={busy !== null}
                            onChange={(event) =>
                              setNotifyTickets(event.target.checked)
                            }
                            type="checkbox"
                          />
                          {openTickets.length === 1
                            ? "Das offene Ticket informieren (öffentliche Antwort mit Ursache) und auf «Gelöst» setzen"
                            : `Die ${openTickets.length} offenen Tickets informieren (öffentliche Antwort mit Ursache) und auf «Gelöst» setzen`}
                        </label>
                        {notifyTickets && cause ? (
                          <label className="incident-field">
                            Antwort an die Tickets
                            <textarea
                              disabled={busy !== null}
                              maxLength={10000}
                              onChange={(event) => {
                                setMessageEdited(true);
                                setTicketMessage(event.target.value);
                              }}
                              rows={7}
                              value={ticketMessage}
                            />
                          </label>
                        ) : null}
                      </>
                    ) : null}
                    {detail.permissions.openCase &&
                    detail.state !== "closed" ? (
                      <>
                        <label className="incident-check">
                          <input
                            checked={withCase}
                            disabled={busy !== null}
                            onChange={(event) =>
                              setWithCase(event.target.checked)
                            }
                            type="checkbox"
                          />
                          Fall eröffnen (Problem-Management)
                          {detail.recurrence.suggestCase
                            ? " – empfohlen, das Gerät war mehrfach gestört"
                            : ""}
                        </label>
                        {withCase ? (
                          <>
                            <label className="incident-field">
                              Titel des Falls
                              <input
                                disabled={busy !== null}
                                maxLength={240}
                                onChange={(event) =>
                                  setCaseTitle(event.target.value)
                                }
                                type="text"
                                value={caseTitle}
                              />
                            </label>
                            <label className="incident-check">
                              <input
                                checked={caseRecurring}
                                disabled={busy !== null}
                                onChange={(event) =>
                                  setCaseRecurring(event.target.checked)
                                }
                                type="checkbox"
                              />
                              Frühere Störungen dieses Geräts (30 Tage)
                              verknüpfen
                            </label>
                          </>
                        ) : null}
                      </>
                    ) : null}
                    <button
                      className={
                        detail.state === "resolved"
                          ? "primary-button"
                          : "secondary-button"
                      }
                      disabled={
                        busy !== null ||
                        !cause ||
                        (withCase && caseTitle.trim().length < 3)
                      }
                      type="submit"
                    >
                      <CheckCircle2 aria-hidden="true" size={15} />
                      {detail.state === "closed"
                        ? "Ursache speichern"
                        : "Störung abschliessen"}
                    </button>
                  </form>
                </article>
              ) : null}
              <IncidentKnowledgeCard detail={detail} tenantId={tenantId} />
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}

/** Summary after closing: tickets informed, case opened. */
function closeNotice(result: IncidentCloseResult | null): string {
  const parts = ["Die Störung ist abgeschlossen."];
  if (result?.tickets) {
    const { notified, resolved, skipped } = result.tickets;
    if (notified) {
      parts.push(
        `${notified} ${notified === 1 ? "Ticket" : "Tickets"} informiert, ${resolved} auf «Gelöst» gesetzt.`,
      );
    }
    if (skipped.length) {
      parts.push(
        `Ausgelassen: ${skipped
          .map(
            (entry) =>
              `${entry.ticketNumber} (${SKIP_REASON_LABELS[entry.reason] ?? entry.reason})`,
          )
          .join(", ")}.`,
      );
    }
  }
  if (result?.problemId) {
    parts.push("Der Fall wurde eröffnet (unter «Fälle»).");
  }
  return parts.join(" ");
}

function IncidentReportView({ tenantId }: { tenantId: string }) {
  const [days, setDays] = useState<30 | 90>(30);
  const [report, setReport] = useState<IncidentReport | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setReport(null);
    void call({ type: "report", tenantId, days })
      .then((value) => {
        if (!active) return;
        const parsed = parseIncidentReport(value);
        if (parsed) setReport(parsed);
        else setError("Die Auswertung konnte nicht gelesen werden.");
      })
      .catch((cause: Error) => active && setError(cause.message));
    return () => {
      active = false;
    };
  }, [days, tenantId]);

  const maxCause = Math.max(
    1,
    ...(report?.causes.map((entry) => entry.count) ?? [1]),
  );

  return (
    <div className="incident-report">
      <div
        aria-label="Zeitraum"
        className="queue-tabs incidents__tabs"
        role="group"
      >
        {([30, 90] as const).map((value) => (
          <button
            aria-pressed={days === value}
            className={days === value ? "queue-tab selected" : "queue-tab"}
            key={value}
            onClick={() => setDays(value)}
            type="button"
          >
            {value} Tage
          </button>
        ))}
      </div>
      {error ? (
        <p className="ticket-detail-message error" role="alert">
          {error}
        </p>
      ) : null}
      {!report && !error ? (
        <p className="incidents__empty" role="status">
          <LoaderCircle
            aria-hidden="true"
            className="ticket-detail-spinner"
            size={16}
          />{" "}
          Auswertung wird geladen …
        </p>
      ) : null}
      {report ? (
        <>
          <div className="incidents__tiles incidents__tiles--three">
            <div className="incident-tile">
              <span>Störungen</span>
              <strong>{report.total}</strong>
              <small>ohne Folgestörungen</small>
            </div>
            <div className="incident-tile">
              <span>Behebungszeit</span>
              <strong>{formatDuration(report.medianResolveMinutes)}</strong>
              <small>Median</small>
            </div>
            <div className="incident-tile">
              <span>Verfügbarkeit</span>
              <strong>{formatAvailability(report.availability)}</strong>
              <small>überwachte Geräte, nur Ausfälle</small>
            </div>
          </div>
          <div className="incident__grid">
            <article className="incident-card">
              <h3>Ursachen</h3>
              {report.causes.length ? (
                <ul className="incident-bars">
                  {report.causes.map((entry) => (
                    <li key={entry.cause}>
                      <span>{entry.label}</span>
                      <span className="incident-bars__track">
                        <i
                          style={{
                            width: `${(entry.count / maxCause) * 100}%`,
                          }}
                        />
                      </span>
                      <strong>{entry.count}</strong>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="incident-muted">Keine Störungen im Zeitraum.</p>
              )}
            </article>
            <article className="incident-card">
              <h3>
                <Activity aria-hidden="true" size={15} /> Häufigste Geräte
              </h3>
              {report.devices.length ? (
                <table className="incident-table">
                  <thead>
                    <tr>
                      <th>Gerät</th>
                      <th>Störungen</th>
                      <th>Dauer gesamt</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.devices.map((entry) => (
                      <tr key={entry.name}>
                        <td>{entry.name}</td>
                        <td>{entry.count}</td>
                        <td>{formatDuration(entry.minutes)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="incident-muted">Keine Störungen im Zeitraum.</p>
              )}
            </article>
          </div>
        </>
      ) : null}
    </div>
  );
}
