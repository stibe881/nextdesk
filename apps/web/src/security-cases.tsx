import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock3,
  LoaderCircle,
  Mail,
  MessageCircleQuestion,
  Paperclip,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { useCallback, useEffect, useState, type CSSProperties } from "react";

import { functionErrorMessage } from "./lib/function-error";
import {
  AUTH_LABELS,
  authTone,
  formatAgo,
  formatMinutes,
  parseSecurityDetail,
  parseSecurityList,
  RISK_LABELS,
  STATE_LABELS,
  VERDICT_LABELS,
  VERDICTS,
  type SecurityCaseDetail,
  type SecurityCaseSummary,
  type SecurityStateFilter,
  type SecurityStats,
  type SecurityVerdict,
} from "./lib/security-cases";
import { supabase } from "./lib/supabase";
import {
  SecurityCaseContextPanel,
  SecurityCaseIntelCards,
  SecurityIntelView,
} from "./security-case-intel";
import "./security-cases.css";

async function call(body: Record<string, unknown>): Promise<unknown> {
  if (!supabase) throw new Error("Die Verbindung ist nicht konfiguriert.");
  const { data, error } = await supabase.functions.invoke("security-cases", {
    body,
  });
  if (error) {
    throw new Error(
      await functionErrorMessage(
        error,
        "Die Sicherheitsfälle sind gerade nicht verfügbar.",
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
function dateTime(value: string | null): string {
  return value ? DATE_TIME.format(new Date(value)) : "–";
}

const FILTERS: { key: SecurityStateFilter; label: string }[] = [
  { key: "triage", label: "Zu beurteilen" },
  { key: "actions", label: "Massnahmen" },
  { key: "closed", label: "Abgeschlossen" },
  { key: "all", label: "Alle" },
];

const TILE_FILTER_LABELS: Partial<Record<SecurityStateFilter, string>> = {
  today: "Fälle mit Meldungen von heute",
  decided: "Fälle mit Urteil in den letzten 30 Tagen",
  clicked: "Fälle, bei denen jemand angegeben hat, geklickt zu haben (30 Tage)",
};

const EMPTY_TEXT: Record<SecurityStateFilter, string> = {
  triage: "Keine Meldungen zu beurteilen.",
  actions: "Keine Fälle mit offenen Massnahmen.",
  closed: "Keine abgeschlossenen Fälle.",
  all: "Noch keine Sicherheitsfälle.",
  today: "Heute wurde noch nichts gemeldet.",
  decided: "In den letzten 30 Tagen wurde kein Fall beurteilt.",
  clicked: "Niemand hat angegeben, geklickt zu haben.",
};

function SecurityTile({
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
  value: number | string;
}) {
  return (
    <button
      aria-pressed={active}
      className={`security-tile${hot ? " security-tile--hot" : ""}${active ? " security-tile--active" : ""}`}
      onClick={onClick}
      type="button"
    >
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </button>
  );
}

const CHANNEL_LABELS: Record<string, string> = {
  email: "Outlook / E-Mail",
  portal: "Portal",
  mobile: "App",
};

/**
 * «Sicherheitsfälle»: reported phishing mails, separate from the support
 * tickets. Reports of the same mail are one case; the security team gives a
 * verdict, works through the checklist and every reporter gets the result.
 */
export function SecurityCases({
  tenantId,
  focusId = null,
  onFocusConsumed,
}: {
  tenantId: string;
  /** Opens this case (global search, notification, priorities). */
  focusId?: string | null;
  onFocusConsumed?: () => void;
}) {
  const [filter, setFilter] = useState<SecurityStateFilter>("triage");
  const [view, setView] = useState<"cases" | "intel">("cases");
  const [cases, setCases] = useState<SecurityCaseSummary[] | null>(null);
  const [stats, setStats] = useState<SecurityStats | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!focusId) return;
    setSelected(focusId);
    onFocusConsumed?.();
  }, [focusId, onFocusConsumed]);

  useEffect(() => {
    let active = true;
    setError("");
    void call({ type: "list", tenantId, state: filter })
      .then((value) => {
        if (!active) return;
        const parsed = parseSecurityList(value);
        if (!parsed) {
          setError("Die Sicherheitsfälle konnten nicht gelesen werden.");
          return;
        }
        setCases(parsed.cases);
        setStats(parsed.stats);
      })
      .catch((cause: Error) => {
        if (active) setError(cause.message);
      });
    return () => {
      active = false;
    };
  }, [filter, revision, tenantId]);

  if (selected) {
    return (
      <SecurityCaseView
        key={selected}
        onBack={() => {
          setSelected(null);
          setRevision((value) => value + 1);
        }}
        onOpenCase={setSelected}
        tenantId={tenantId}
        ticketId={selected}
      />
    );
  }

  return (
    <section className="security-cases" aria-labelledby="security-cases-title">
      <header className="security-cases__hero">
        <p className="eyebrow">SICHERHEIT</p>
        <h2 id="security-cases-title">Sicherheitsfälle</h2>
        <p>
          Gemeldete Phishing-Mails, getrennt von den Support-Tickets. Meldungen
          derselben Mail sind ein Fall. Beurteilen Sie den Fall, arbeiten Sie
          die Massnahmen ab; alle Melder erhalten das Ergebnis automatisch.
        </p>
      </header>

      {stats ? (
        <div className="security-cases__tiles">
          <SecurityTile
            active={filter === "triage"}
            hot={stats.triageHigh > 0 || stats.overdue > 0}
            label="Zu beurteilen"
            onClick={() => setFilter("triage")}
            value={stats.triage}
            detail={
              stats.overdue
                ? `${stats.overdue} überfällig`
                : stats.triageHigh
                  ? `${stats.triageHigh} mit hohem Risiko`
                  : "keine dringenden"
            }
          />
          <SecurityTile
            active={filter === "actions"}
            label="Massnahmen offen"
            onClick={() => setFilter("actions")}
            value={stats.actions}
            detail="Fälle in Arbeit"
          />
          <SecurityTile
            active={filter === "today"}
            label="Meldungen heute"
            onClick={() => setFilter("today")}
            value={stats.reportsToday}
            detail={`von ${stats.reportersToday} ${stats.reportersToday === 1 ? "Person" : "Personen"}`}
          />
          <SecurityTile
            active={filter === "decided"}
            label="Zeit bis Urteil"
            onClick={() => setFilter("decided")}
            value={formatMinutes(stats.medianVerdictMinutes)}
            detail="Median, 30 Tage"
          />
          <SecurityTile
            active={filter === "clicked"}
            label="Geklickt"
            onClick={() => setFilter("clicked")}
            value={
              stats.clickAnswers
                ? `${Math.round((stats.clickYes / stats.clickAnswers) * 100)} %`
                : "–"
            }
            detail={
              stats.clickAnswers
                ? `${stats.clickYes} von ${stats.clickAnswers} Antworten`
                : "noch keine Antworten"
            }
          />
        </div>
      ) : null}

      <div
        aria-label="Sicherheitsfälle filtern"
        className="queue-tabs security-cases__filter"
        role="group"
      >
        {FILTERS.map((entry) => (
          <button
            aria-pressed={view === "cases" && filter === entry.key}
            className={
              view === "cases" && filter === entry.key
                ? "queue-tab selected"
                : "queue-tab"
            }
            key={entry.key}
            onClick={() => {
              setView("cases");
              setFilter(entry.key);
            }}
            type="button"
          >
            {entry.label}
          </button>
        ))}
        <button
          aria-pressed={view === "intel"}
          className={view === "intel" ? "queue-tab selected" : "queue-tab"}
          onClick={() => setView("intel")}
          type="button"
        >
          Kampagnen & IOC
        </button>
      </div>
      {view === "intel" ? (
        <SecurityIntelView onOpenCase={setSelected} tenantId={tenantId} />
      ) : null}
      {view === "cases" && TILE_FILTER_LABELS[filter] ? (
        <p className="security-cases__tile-filter" role="status">
          {TILE_FILTER_LABELS[filter]}
          <button
            className="text-button"
            onClick={() => setFilter("triage")}
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
      {view === "cases" && !cases && !error ? (
        <p className="security-cases__empty" role="status">
          <LoaderCircle
            aria-hidden="true"
            className="ticket-detail-spinner"
            size={16}
          />{" "}
          Sicherheitsfälle werden geladen …
        </p>
      ) : null}
      {view === "cases" && cases && cases.length === 0 ? (
        <p className="security-cases__empty">
          <ShieldCheck aria-hidden="true" size={18} />
          {EMPTY_TEXT[filter]}
        </p>
      ) : null}
      {view === "cases" && cases && cases.length > 0 ? (
        <ul className="security-cases__list">
          {cases.map((entry) => (
            <li key={entry.ticketId}>
              <button
                className="security-case-row"
                onClick={() => setSelected(entry.ticketId)}
                type="button"
              >
                <span
                  aria-hidden="true"
                  className={`security-case-row__sev security-sev--${entry.verdict === "harmless" ? "ok" : entry.riskLevel}`}
                />
                <span className="security-case-row__main">
                  <span className="security-case-row__chips">
                    <span className="security-case-row__number">
                      {entry.ticketNumber}
                    </span>
                    <span
                      className={`security-chip security-chip--${entry.riskLevel}`}
                    >
                      Risiko {RISK_LABELS[entry.riskLevel]} · {entry.riskScore}
                    </span>
                    {entry.verdict ? (
                      <span className="security-chip security-chip--line">
                        {VERDICT_LABELS[entry.verdict]}
                      </span>
                    ) : null}
                    {entry.reporters > 1 ? (
                      <span className="security-chip security-chip--medium">
                        Kampagne
                      </span>
                    ) : null}
                    {entry.overdue ? (
                      <span className="security-chip security-chip--high">
                        <Clock3 aria-hidden="true" size={12} /> Urteil
                        überfällig
                      </span>
                    ) : null}
                  </span>
                  <strong>{entry.subject ?? "Ohne Betreff"}</strong>
                  <small>
                    {entry.from ?? "Absender unbekannt"} · zuerst gemeldet{" "}
                    {formatAgo(entry.firstReportedAt)}
                    {entry.state !== "triage"
                      ? ` · ${STATE_LABELS[entry.state]}`
                      : ""}
                    {entry.assignedAgentName
                      ? ` · zuständig: ${entry.assignedAgentName}`
                      : " · nicht zugewiesen"}
                  </small>
                </span>
                <span className="security-case-row__reporters">
                  <strong>{entry.reporters}</strong>
                  {entry.reporters === 1 ? "Melder" : "Melder"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function SecurityCaseView({
  tenantId,
  ticketId,
  onBack,
  onOpenCase,
}: {
  tenantId: string;
  ticketId: string;
  onBack: () => void;
  onOpenCase: (ticketId: string) => void;
}) {
  const [detail, setDetail] = useState<SecurityCaseDetail | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [pendingVerdict, setPendingVerdict] = useState<SecurityVerdict | null>(
    null,
  );
  const [agents, setAgents] = useState<{ id: string; name: string }[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const run = useCallback(
    async (key: string, body: Record<string, unknown>) => {
      setBusy(key);
      setError("");
      try {
        const value = await call({ tenantId, ticketId, ...body });
        const parsed = parseSecurityDetail(value);
        if (!parsed) throw new Error("Der Fall konnte nicht gelesen werden.");
        setDetail(parsed);
        return value as { data?: Record<string, unknown> };
      } catch (cause) {
        setError((cause as Error).message);
        return null;
      } finally {
        setBusy(null);
      }
    },
    [tenantId, ticketId],
  );

  useEffect(() => {
    void run("load", { type: "get" });
  }, [run]);

  // Agents who may work on this case (team rules of the ticket apply).
  useEffect(() => {
    let active = true;
    if (!supabase) return;
    void supabase.auth.getSession().then(({ data }) => {
      if (active) setCurrentUserId(data.session?.user.id ?? null);
    });
    void supabase.functions
      .invoke("ticket-agent-assignment", {
        body: { type: "list", tenantId, ticketId },
      })
      .then(({ data, error: listError }) => {
        if (!active || listError) return;
        const rows = (data as { data?: { agents?: unknown } } | null)?.data
          ?.agents;
        setAgents(
          Array.isArray(rows)
            ? rows.flatMap((row) =>
                row &&
                typeof row === "object" &&
                typeof (row as { id?: unknown }).id === "string"
                  ? [
                      {
                        id: (row as { id: string }).id,
                        name:
                          typeof (row as { displayName?: unknown })
                            .displayName === "string"
                            ? (row as { displayName: string }).displayName
                            : "Agent",
                      },
                    ]
                  : [],
              )
            : [],
        );
      });
    return () => {
      active = false;
    };
  }, [tenantId, ticketId]);

  async function assign(agentId: string | null) {
    if (!supabase) return;
    setBusy("assign");
    setError("");
    try {
      const { error: assignError } = await supabase.functions.invoke(
        "ticket-agent-assignment",
        {
          body: {
            type: "assign",
            tenantId,
            ticketId,
            assignedAgentId: agentId,
          },
        },
      );
      if (assignError) {
        throw new Error(
          await functionErrorMessage(
            assignError,
            "Der Fall konnte nicht zugewiesen werden.",
          ),
        );
      }
      setNotice(
        agentId
          ? `Fall zugewiesen an ${agents.find((agent) => agent.id === agentId)?.name ?? "Agent"}.`
          : "Zuweisung entfernt.",
      );
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(null);
    }
    await run("load", { type: "get" });
  }

  async function decide(verdict: SecurityVerdict) {
    const result = await run(`verdict:${verdict}`, {
      type: "setVerdict",
      verdict,
    });
    setPendingVerdict(null);
    const notified = Number(result?.data?.notified ?? 0);
    if (result) {
      setNotice(
        notified
          ? `Urteil gespeichert. Das Ergebnis geht an ${notified} meldende ${notified === 1 ? "Person" : "Personen"}.`
          : "Urteil gespeichert.",
      );
    }
  }

  async function ask() {
    const result = await run("ask", { type: "askClicked" });
    const asked = Number(result?.data?.asked ?? 0);
    if (result) {
      setNotice(
        asked
          ? `Rückfrage an ${asked} ${asked === 1 ? "Person" : "Personen"} gesendet.`
          : "Alle Melder wurden bereits gefragt.",
      );
    }
  }

  const done = detail?.actions.filter((entry) => entry.doneAt).length ?? 0;
  const total = detail?.actions.length ?? 0;
  const analysis = detail?.analysis;
  const clickedYes =
    detail?.reporters.filter((entry) => entry.answer === "yes").length ?? 0;

  return (
    <section
      aria-labelledby="security-case-title"
      className="security-cases security-case"
    >
      <button
        className="text-button security-case__back"
        onClick={onBack}
        type="button"
      >
        <ArrowLeft aria-hidden="true" size={16} /> Zurück zu den
        Sicherheitsfällen
      </button>
      {!detail && !error ? (
        <p className="security-cases__empty" role="status">
          <LoaderCircle
            aria-hidden="true"
            className="ticket-detail-spinner"
            size={16}
          />{" "}
          Fall wird geladen …
        </p>
      ) : null}
      {error ? (
        <p className="ticket-detail-message error" role="alert">
          <AlertTriangle aria-hidden="true" size={16} />
          {error}
        </p>
      ) : null}
      {detail && analysis ? (
        <>
          <header className="security-case__head">
            <div>
              <div className="security-case-row__chips">
                <span className="security-case-row__number">
                  {detail.ticketNumber}
                </span>
                <span
                  className={`security-chip security-chip--${detail.state === "triage" ? "high" : detail.state === "actions" ? "medium" : "low"}`}
                >
                  {STATE_LABELS[detail.state]}
                </span>
                {detail.teamName ? (
                  <span className="security-chip security-chip--line">
                    Team {detail.teamName}
                  </span>
                ) : null}
                {detail.state === "triage" && detail.decisionDueAt ? (
                  <span className="security-chip security-chip--line">
                    <Clock3 aria-hidden="true" size={12} /> Urteil bis{" "}
                    {dateTime(detail.decisionDueAt)}
                  </span>
                ) : null}
              </div>
              <h2 id="security-case-title">
                {analysis.subject ?? detail.subject ?? "Ohne Betreff"}
              </h2>
            </div>
          </header>
          {notice ? (
            <p className="security-case__notice" role="status">
              <CheckCircle2 aria-hidden="true" size={16} />
              {notice}
            </p>
          ) : null}
          {clickedYes ? (
            <p className="ticket-detail-message error" role="alert">
              <AlertTriangle aria-hidden="true" size={16} />
              {clickedYes === 1
                ? "Eine meldende Person hat angegeben, geklickt oder Daten eingegeben zu haben."
                : `${clickedYes} meldende Personen haben angegeben, geklickt oder Daten eingegeben zu haben.`}{" "}
              Massnahmen unten unter «Kontext und Massnahmen».
            </p>
          ) : null}
          {detail.escalatedAt && detail.state === "triage" ? (
            <p className="ticket-detail-message error" role="status">
              <Clock3 aria-hidden="true" size={16} />
              Urteil seit über 24 Stunden überfällig – die Vorgesetzten wurden
              am {dateTime(detail.escalatedAt)} informiert.
            </p>
          ) : null}

          <div className="security-case__grid">
            <div className="security-case__main">
              <article className="security-card">
                <div className="security-card__head">
                  <h3>Gemeldete E-Mail</h3>
                  <span className="security-chip security-chip--line">
                    Sichere Ansicht
                  </span>
                </div>
                <dl className="security-mail-head">
                  <dt>Von</dt>
                  <dd>
                    {analysis.fromName ? `${analysis.fromName} ` : ""}
                    {analysis.from ? `<${analysis.from}>` : "unbekannt"}
                  </dd>
                  {analysis.replyTo ? (
                    <>
                      <dt>Antwort an</dt>
                      <dd>{analysis.replyTo}</dd>
                    </>
                  ) : null}
                  {analysis.returnPath ? (
                    <>
                      <dt>Return-Path</dt>
                      <dd>{analysis.returnPath}</dd>
                    </>
                  ) : null}
                  <dt>Datum</dt>
                  <dd>{analysis.date ?? "–"}</dd>
                  {analysis.sendingIp ? (
                    <>
                      <dt>Server-IP</dt>
                      <dd>{analysis.sendingIp}</dd>
                    </>
                  ) : null}
                  <dt>Prüfung</dt>
                  <dd className="security-auth">
                    {(["spf", "dkim", "dmarc"] as const).map((key) => (
                      <span
                        className={`security-chip security-chip--${authTone(analysis.auth[key]) === "ok" ? "low" : authTone(analysis.auth[key]) === "bad" ? "high" : "medium"}`}
                        key={key}
                      >
                        {key.toUpperCase()}{" "}
                        {AUTH_LABELS[analysis.auth[key]] ?? analysis.auth[key]}
                      </span>
                    ))}
                  </dd>
                </dl>
                {detail.description ? (
                  <pre className="security-mail-body">{detail.description}</pre>
                ) : null}
                {analysis.links.length ? (
                  <div className="security-card__block">
                    <h4>Links ({analysis.links.length})</h4>
                    <ul className="security-links">
                      {analysis.links.map((link, index) => (
                        <li key={`${link.href}-${index}`}>
                          {link.text ? <span>{link.text}</span> : null}
                          <code>{link.href}</code>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {analysis.attachments.length ? (
                  <div className="security-card__block">
                    <h4>Anhänge</h4>
                    <ul className="security-links">
                      {analysis.attachments.map((file, index) => (
                        <li key={`${file.filename}-${index}`}>
                          <span>
                            <Paperclip aria-hidden="true" size={13} />{" "}
                            {file.filename}
                          </span>
                          <small>
                            {[
                              file.contentType,
                              file.size !== null
                                ? `${Math.max(1, Math.round(file.size / 1024))} KB`
                                : null,
                            ]
                              .filter(Boolean)
                              .join(" · ")}{" "}
                            · nicht herunterladbar
                          </small>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <p className="security-safe-note">
                  <ShieldCheck aria-hidden="true" size={15} />
                  Links sind entschärft und nicht anklickbar, Bilder werden
                  nicht geladen und Anhänge nicht geöffnet.
                </p>
              </article>

              <article className="security-card">
                <h3>Befunde der Analyse</h3>
                {analysis.findings.length ? (
                  <ul className="security-findings">
                    {analysis.findings.map((finding, index) => (
                      <li key={`${finding.message}-${index}`}>
                        <span
                          aria-hidden="true"
                          className={`security-dot security-dot--${finding.severity === "high" ? "high" : finding.severity === "medium" ? "medium" : "low"}`}
                        />
                        {finding.message}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="security-muted">Keine auffälligen Befunde.</p>
                )}
              </article>

              <SecurityCaseIntelCards detail={detail} onOpenCase={onOpenCase} />
              <SecurityCaseContextPanel
                detail={detail}
                onDetail={setDetail}
                tenantId={tenantId}
              />
            </div>

            <div className="security-case__side">
              <article className="security-card">
                <div className="security-card__head">
                  <h3>Zuständig</h3>
                  {currentUserId &&
                  detail.assignedAgentId !== currentUserId &&
                  agents.some((agent) => agent.id === currentUserId) ? (
                    <button
                      className="text-button"
                      disabled={busy !== null}
                      onClick={() => void assign(currentUserId)}
                      type="button"
                    >
                      Mir zuweisen
                    </button>
                  ) : null}
                </div>
                <label className="security-assign">
                  <span className="sr-only">Zuständige Person</span>
                  <select
                    disabled={busy !== null || detail.state === "closed"}
                    onChange={(event) =>
                      void assign(event.target.value || null)
                    }
                    value={detail.assignedAgentId ?? ""}
                  >
                    <option value="">Nicht zugewiesen</option>
                    {detail.assignedAgentId &&
                    !agents.some(
                      (agent) => agent.id === detail.assignedAgentId,
                    ) ? (
                      <option value={detail.assignedAgentId}>
                        {detail.assignedAgentName ?? "Zugewiesen"}
                      </option>
                    ) : null}
                    {agents.map((agent) => (
                      <option key={agent.id} value={agent.id}>
                        {agent.name}
                      </option>
                    ))}
                  </select>
                </label>
                {detail.teamName ? (
                  <p className="security-muted">
                    Auswahl aus dem Team {detail.teamName}.
                  </p>
                ) : null}
              </article>
              <article className="security-card">
                <div className="security-score">
                  <span
                    className={`security-gauge security-gauge--${analysis.level}`}
                    style={
                      {
                        "--score": `${Math.min(100, analysis.score)}%`,
                      } as CSSProperties
                    }
                  >
                    <span>{analysis.score}</span>
                  </span>
                  <span>
                    <strong>Risiko {RISK_LABELS[analysis.level]}</strong>
                    <small>
                      Automatische Einschätzung, ersetzt das Urteil nicht
                    </small>
                  </span>
                </div>
                <h3>Urteil</h3>
                {detail.verdict ? (
                  <p className="security-verdict">
                    <strong>{VERDICT_LABELS[detail.verdict]}</strong>
                    <small>
                      {[detail.verdictBy, dateTime(detail.verdictAt)]
                        .filter(Boolean)
                        .join(" · ")}
                      {detail.reportersNotifiedAt
                        ? " · Ergebnis an Melder gesendet"
                        : ""}
                    </small>
                  </p>
                ) : pendingVerdict ? (
                  <div className="security-confirm">
                    <p>
                      Urteil <strong>«{VERDICT_LABELS[pendingVerdict]}»</strong>{" "}
                      speichern? Alle {detail.reporters.length} Melder erhalten
                      danach automatisch das Ergebnis per E-Mail.
                    </p>
                    <div className="security-confirm__actions">
                      <button
                        className="secondary-button"
                        disabled={busy !== null}
                        onClick={() => setPendingVerdict(null)}
                        type="button"
                      >
                        Abbrechen
                      </button>
                      <button
                        className="primary-button"
                        disabled={busy !== null}
                        onClick={() => void decide(pendingVerdict)}
                        type="button"
                      >
                        {busy?.startsWith("verdict") ? (
                          <LoaderCircle
                            aria-hidden="true"
                            className="ticket-detail-spinner"
                            size={15}
                          />
                        ) : null}
                        Urteil speichern
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="security-verdicts">
                    {VERDICTS.map((entry) => (
                      <button
                        className={`security-verdict-button security-verdict-button--${entry}`}
                        disabled={busy !== null || detail.state === "closed"}
                        key={entry}
                        onClick={() => setPendingVerdict(entry)}
                        type="button"
                      >
                        {VERDICT_LABELS[entry]}
                      </button>
                    ))}
                  </div>
                )}
              </article>

              {total > 0 ? (
                <article className="security-card">
                  <div className="security-card__head">
                    <h3>Massnahmen</h3>
                    <span className="security-muted">
                      {done} von {total} erledigt
                    </span>
                  </div>
                  <span className="security-progress" aria-hidden="true">
                    <i
                      style={{ width: `${total ? (done / total) * 100 : 0}%` }}
                    />
                  </span>
                  <ul className="security-checks">
                    {detail.actions.map((entry) => (
                      <li key={entry.id}>
                        <label>
                          <input
                            checked={entry.doneAt !== null}
                            disabled={
                              busy !== null || detail.state === "closed"
                            }
                            onChange={(event) =>
                              void run(`action:${entry.id}`, {
                                type: "toggleAction",
                                actionId: entry.id,
                                done: event.target.checked,
                              })
                            }
                            type="checkbox"
                          />
                          <span>
                            {entry.label}
                            {entry.doneAt ? (
                              <small>
                                {[entry.doneBy, dateTime(entry.doneAt)]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </small>
                            ) : null}
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                  {detail.state !== "closed" ? (
                    <button
                      className={
                        done === total ? "primary-button" : "secondary-button"
                      }
                      disabled={busy !== null}
                      onClick={() => void run("close", { type: "close" })}
                      type="button"
                    >
                      <CheckCircle2 aria-hidden="true" size={15} />
                      Fall abschliessen
                    </button>
                  ) : null}
                </article>
              ) : null}

              <article className="security-card">
                <div className="security-card__head">
                  <h3>Melder</h3>
                  <span className="security-muted">
                    {detail.reporters.length}{" "}
                    {detail.reporters.length === 1 ? "Meldung" : "Meldungen"}
                  </span>
                </div>
                <ul className="security-reporters">
                  {detail.reporters.map((entry, index) => (
                    <li key={`${entry.email ?? entry.name}-${index}`}>
                      <span>
                        <strong>{entry.name}</strong>
                        <small>
                          {dateTime(entry.reportedAt)}
                          {entry.channel
                            ? ` · ${CHANNEL_LABELS[entry.channel] ?? entry.channel}`
                            : ""}
                        </small>
                      </span>
                      {entry.answer === "yes" ? (
                        <span className="security-chip security-chip--high">
                          Geklickt
                        </span>
                      ) : entry.answer === "no" ? (
                        <span className="security-chip security-chip--low">
                          Nicht geklickt
                        </span>
                      ) : entry.asked ? (
                        <span className="security-chip security-chip--line">
                          Gefragt
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
                {detail.state !== "closed" ? (
                  <button
                    className="secondary-button"
                    disabled={busy !== null}
                    onClick={() => void ask()}
                    type="button"
                  >
                    {busy === "ask" ? (
                      <LoaderCircle
                        aria-hidden="true"
                        className="ticket-detail-spinner"
                        size={15}
                      />
                    ) : (
                      <MessageCircleQuestion aria-hidden="true" size={15} />
                    )}
                    Melder fragen: geklickt?
                  </button>
                ) : null}
                <p className="security-muted">
                  <Mail aria-hidden="true" size={13} /> Die Rückfrage geht per
                  E-Mail an alle Melder, die noch nicht gefragt wurden.
                </p>
              </article>

              {detail.state === "triage" ? null : detail.state === "closed" ? (
                <p className="security-muted security-case__closed">
                  <ShieldAlert aria-hidden="true" size={14} /> Abgeschlossen am{" "}
                  {dateTime(detail.closedAt)}
                </p>
              ) : null}
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}
