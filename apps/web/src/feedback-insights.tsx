import {
  LoaderCircle,
  MessageSquareQuote,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import {
  aiReasonText,
  dominantSentiment,
  monthLabel,
  parseFeedbackReport,
  ratingTotals,
  SENTIMENT_LABELS,
  teamsForDepartment,
  type FeedbackReport,
} from "./lib/feedback-insights";
import { functionErrorMessage } from "./lib/function-error";
import { supabase } from "./lib/supabase";
import "./feedback-insights.css";

/**
 * «Feedback-Auswertung mit KI» (Berichte): ratings per month and, when the
 * tenant's AI is on, the themes of the free-text comments with trend and
 * anonymised example quotes. Filter by department and team.
 */

type Months = 3 | 6 | 12;

async function call(body: Record<string, unknown>): Promise<unknown> {
  if (!supabase) throw new Error("Die Verbindung ist nicht konfiguriert.");
  const { data, error } = await supabase.functions.invoke("feedback-insights", {
    body,
  });
  if (error) {
    throw new Error(
      await functionErrorMessage(
        error,
        "Die Feedback-Auswertung ist gerade nicht verfügbar.",
      ),
    );
  }
  return data;
}

function formatAverage(value: number | null): string {
  return value === null
    ? "–"
    : value.toLocaleString("de-CH", {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      });
}

export function FeedbackInsights({ tenantId }: { tenantId: string }) {
  const headingId = useId();
  const [months, setMonths] = useState<Months>(6);
  const [departmentId, setDepartmentId] = useState<string>("");
  const [teamId, setTeamId] = useState<string>("");
  const [report, setReport] = useState<FeedbackReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [notice, setNotice] = useState("");
  const version = useRef(0);

  const load = useCallback(async () => {
    const current = version.current + 1;
    version.current = current;
    setLoading(true);
    setError("");
    try {
      const parsed = parseFeedbackReport(
        await call({
          type: "getReport",
          tenantId,
          months,
          departmentId: departmentId || null,
          teamId: teamId || null,
        }),
      );
      if (version.current !== current) return;
      if (!parsed) throw new Error("Die Antwort war unvollständig.");
      setReport(parsed);
    } catch (loadError) {
      if (version.current !== current) return;
      setError(
        loadError instanceof Error ? loadError.message : String(loadError),
      );
    } finally {
      if (version.current === current) setLoading(false);
    }
  }, [departmentId, months, teamId, tenantId]);

  useEffect(() => {
    void load();
    return () => {
      version.current += 1;
    };
  }, [load]);

  async function analyze() {
    if (analyzing) return;
    setAnalyzing(true);
    setNotice("");
    try {
      const result = (await call({ type: "analyze", tenantId })) as {
        data?: { analyzed?: number; pendingCount?: number };
      };
      const analyzed = result.data?.analyzed ?? 0;
      const pending = result.data?.pendingCount ?? 0;
      setNotice(
        analyzed === 0
          ? "Keine neuen Kommentare ausgewertet."
          : `${analyzed} Kommentar${analyzed === 1 ? "" : "e"} ausgewertet${pending ? `, ${pending} noch offen` : ""}.`,
      );
      await load();
    } catch (analyzeError) {
      setNotice(
        analyzeError instanceof Error
          ? analyzeError.message
          : String(analyzeError),
      );
    } finally {
      setAnalyzing(false);
    }
  }

  const totals = report ? ratingTotals(report.ratings) : null;
  const themes = report?.themes ?? null;
  const maxThemeCount = Math.max(1, ...(themes?.top.map((t) => t.count) ?? []));
  const maxTrend = Math.max(
    1,
    ...(themes?.trend.flatMap((entry) =>
      themes.top.map((theme) => entry.counts[theme.key] ?? 0),
    ) ?? []),
  );
  const teams = report
    ? teamsForDepartment(report.filters.teams, departmentId || null)
    : [];

  return (
    <section
      aria-busy={loading}
      aria-labelledby={headingId}
      className="feedback-insights"
    >
      <header className="feedback-insights__header">
        <div>
          <p className="eyebrow">ZUFRIEDENHEIT</p>
          <h2 id={headingId}>Feedback-Auswertung</h2>
          <p className="feedback-insights__intro">
            Bewertungen und Freitext-Kommentare der Zufriedenheitsumfrage. Mit
            freigegebener KI werden die Kommentare anonymisiert nach Themen
            gruppiert (nachts automatisch, nur neue Kommentare).
          </p>
        </div>
        <div className="feedback-insights__filters">
          <label>
            Zeitraum
            <select
              onChange={(event) =>
                setMonths(Number(event.target.value) as Months)
              }
              value={months}
            >
              <option value={3}>3 Monate</option>
              <option value={6}>6 Monate</option>
              <option value={12}>12 Monate</option>
            </select>
          </label>
          <label>
            Abteilung
            <select
              onChange={(event) => {
                setDepartmentId(event.target.value);
                setTeamId("");
              }}
              value={departmentId}
            >
              <option value="">Alle Abteilungen</option>
              {report?.filters.departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Team
            <select
              onChange={(event) => setTeamId(event.target.value)}
              value={teamId}
            >
              <option value="">Alle Teams</option>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>

      {error ? (
        <p className="feedback-insights__error" role="alert">
          {error}
        </p>
      ) : null}
      {loading && !report ? (
        <p className="feedback-insights__state" role="status">
          <LoaderCircle
            aria-hidden="true"
            className="feedback-insights__spin"
            size={16}
          />{" "}
          Auswertung wird geladen …
        </p>
      ) : null}

      {report && totals ? (
        <>
          <div className="feedback-insights__tiles">
            <div className="feedback-insights__tile">
              <span>Bewertungen</span>
              <strong>{totals.count.toLocaleString("de-CH")}</strong>
            </div>
            <div className="feedback-insights__tile">
              <span>Durchschnitt (1–5)</span>
              <strong>{formatAverage(totals.average)}</strong>
            </div>
            <div className="feedback-insights__tile">
              <span>Mit Kommentar</span>
              <strong>{totals.commentCount.toLocaleString("de-CH")}</strong>
            </div>
          </div>

          <section className="feedback-insights__panel">
            <h3>Bewertungen pro Monat</h3>
            <table className="feedback-insights__table">
              <thead>
                <tr>
                  <th scope="col">Monat</th>
                  <th scope="col">Anzahl</th>
                  <th scope="col">Ø</th>
                  <th scope="col">Verteilung 1–5</th>
                  <th scope="col">Kommentare</th>
                </tr>
              </thead>
              <tbody>
                {report.ratings.map((month) => (
                  <tr key={month.month}>
                    <th scope="row">{monthLabel(month.month)}</th>
                    <td>{month.count}</td>
                    <td>{formatAverage(month.average)}</td>
                    <td>
                      <span
                        aria-label={month.distribution
                          .map((value, index) => `${index + 1}: ${value}`)
                          .join(", ")}
                        className="feedback-insights__distribution"
                        role="img"
                      >
                        {month.distribution.map((value, index) => (
                          <span
                            className={`feedback-insights__score feedback-insights__score--${index + 1}`}
                            key={index}
                            style={{
                              flexGrow: value,
                              display: value ? undefined : "none",
                            }}
                            title={`${index + 1}: ${value}`}
                          />
                        ))}
                      </span>
                    </td>
                    <td>{month.commentCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {!report.aiEnabled ? (
            <p className="feedback-insights__notice">
              {aiReasonText(report.aiReason)} Deshalb werden nur Anzahl und
              Bewertungen angezeigt, keine Themen.
            </p>
          ) : themes ? (
            <section className="feedback-insights__panel">
              <div className="feedback-insights__panel-heading">
                <h3>
                  <Sparkles aria-hidden="true" size={16} /> Top-Themen
                </h3>
                <div className="feedback-insights__actions">
                  {themes.pendingCount > 0 ? (
                    <span className="feedback-insights__pending">
                      {themes.pendingCount >= 200
                        ? "200+"
                        : themes.pendingCount}{" "}
                      neue Kommentare offen
                    </span>
                  ) : null}
                  <button
                    className="secondary-button"
                    disabled={analyzing}
                    onClick={() => void analyze()}
                    type="button"
                  >
                    {analyzing ? (
                      <LoaderCircle
                        aria-hidden="true"
                        className="feedback-insights__spin"
                        size={15}
                      />
                    ) : (
                      <RefreshCw aria-hidden="true" size={15} />
                    )}
                    Jetzt auswerten
                  </button>
                </div>
              </div>
              {notice ? (
                <p className="feedback-insights__state" role="status">
                  {notice}
                </p>
              ) : null}
              {themes.top.length === 0 ? (
                <p className="feedback-insights__state">
                  Noch keine ausgewerteten Kommentare im Zeitraum.
                </p>
              ) : (
                <ul className="feedback-insights__themes">
                  {themes.top.map((theme) => {
                    const mood = dominantSentiment(theme.sentiments);
                    return (
                      <li key={theme.key}>
                        <div className="feedback-insights__theme-row">
                          <span className="feedback-insights__theme-label">
                            {theme.label}
                          </span>
                          <span
                            className={`feedback-insights__mood feedback-insights__mood--${mood}`}
                          >
                            {SENTIMENT_LABELS[mood]}
                          </span>
                          <strong>
                            {theme.count} ({theme.share.toLocaleString("de-CH")}{" "}
                            %)
                          </strong>
                        </div>
                        <span className="feedback-insights__bar">
                          <span
                            style={{
                              width: `${(theme.count / maxThemeCount) * 100}%`,
                            }}
                          />
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
              {themes.top.length > 0 ? (
                <>
                  <h4>Verlauf pro Monat</h4>
                  <div className="feedback-insights__scroll">
                    <table className="feedback-insights__table feedback-insights__trend">
                      <thead>
                        <tr>
                          <th scope="col">Thema</th>
                          {themes.trend.map((entry) => (
                            <th key={entry.month} scope="col">
                              {monthLabel(entry.month)}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {themes.top.map((theme) => (
                          <tr key={theme.key}>
                            <th scope="row">{theme.label}</th>
                            {themes.trend.map((entry) => {
                              const value = entry.counts[theme.key] ?? 0;
                              return (
                                <td
                                  key={entry.month}
                                  style={{
                                    background: value
                                      ? `color-mix(in srgb, var(--chart-1) ${Math.round(12 + (value / maxTrend) * 50)}%, transparent)`
                                      : undefined,
                                  }}
                                >
                                  {value || ""}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {themes.quotes.length > 0 ? (
                    <>
                      <h4>
                        <MessageSquareQuote aria-hidden="true" size={15} />{" "}
                        Beispiel-Zitate (anonymisiert)
                      </h4>
                      <ul className="feedback-insights__quotes">
                        {themes.quotes.map((quote, index) => (
                          <li key={`${quote.themeKey}-${index}`}>
                            <blockquote>«{quote.quote}»</blockquote>
                            <span>
                              {themes.top.find(
                                (theme) => theme.key === quote.themeKey,
                              )?.label ?? ""}{" "}
                              · {SENTIMENT_LABELS[quote.sentiment]}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : null}
                </>
              ) : null}
            </section>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
