import { useCallback, useEffect, useRef, useState } from "react";
import { functionErrorMessage } from "./lib/function-error";
import { supabase } from "./lib/supabase";
import { parseSpamReport, spamRange, type SpamReport } from "./lib/ticket-spam";

/**
 * Spam-Bericht im Service-Reporting: wie viel Spam eingestuft oder automatisch
 * abgefangen wurde, von welchen Absendern und in welchen Abteilungen. Spam
 * zählt sonst nirgends in die Statistik.
 */

const PERIODS = [
  { days: 7, label: "7 Tage" },
  { days: 30, label: "30 Tage" },
  { days: 90, label: "90 Tage" },
  { days: 365, label: "12 Monate" },
] as const;

const dateTime = new Intl.DateTimeFormat("de-CH", {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatDate(value: string): string {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? dateTime.format(parsed) : "";
}

function formatDay(value: string): string {
  const parsed = Date.parse(`${value}T12:00:00`);
  return Number.isFinite(parsed)
    ? new Date(parsed).toLocaleDateString("de-CH", {
        day: "2-digit",
        month: "2-digit",
      })
    : value;
}

export function SpamReportPanel({ tenantId }: { tenantId: string }) {
  const [days, setDays] = useState<number>(30);
  const [report, setReport] = useState<SpamReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const version = useRef(0);

  const load = useCallback(async () => {
    const current = version.current + 1;
    version.current = current;
    setLoading(true);
    setError("");
    try {
      if (!supabase) throw new Error("not_configured");
      const range = spamRange(days);
      const { data, error: invokeError } = await supabase.functions.invoke(
        "ticket-bulk-status",
        { body: { type: "spamReport", tenantId, ...range } },
      );
      if (invokeError) throw invokeError;
      const parsed = parseSpamReport(data);
      if (!parsed) throw new Error("invalid_spam_report");
      if (version.current === current) setReport(parsed);
    } catch (cause) {
      if (version.current !== current) return;
      setReport(null);
      setError(
        await functionErrorMessage(
          cause,
          "Der Spam-Bericht konnte nicht geladen werden.",
        ),
      );
    } finally {
      if (version.current === current) setLoading(false);
    }
  }, [days, tenantId]);

  useEffect(() => {
    void load();
    return () => {
      version.current += 1;
    };
  }, [load]);

  const maxDay = report
    ? Math.max(1, ...report.perDay.map((entry) => entry.auto + entry.manual))
    : 1;

  return (
    <section aria-label="Spam-Bericht" className="spam-report">
      <header className="spam-report__head">
        <div>
          <h3>Spam</h3>
          <p>
            Als Spam eingestufte und automatisch abgefangene Tickets. Diese
            Tickets zählen in keiner anderen Statistik.
          </p>
        </div>
        <div
          className="spam-report__periods"
          role="group"
          aria-label="Zeitraum"
        >
          {PERIODS.map((entry) => (
            <button
              aria-pressed={days === entry.days}
              className={
                days === entry.days ? "primary-button" : "secondary-button"
              }
              key={entry.days}
              onClick={() => setDays(entry.days)}
              type="button"
            >
              {entry.label}
            </button>
          ))}
        </div>
      </header>
      {loading && !report ? <p>Bericht wird geladen …</p> : null}
      {error ? (
        <p className="form-message form-message--error" role="alert">
          {error}
        </p>
      ) : null}
      {report ? (
        <>
          <dl className="spam-report__kpis">
            <div>
              <dt>Spam gesamt</dt>
              <dd>{report.total}</dd>
            </div>
            <div>
              <dt>Automatisch abgefangen</dt>
              <dd>{report.auto}</dd>
            </div>
            <div>
              <dt>Von Hand markiert</dt>
              <dd>{report.manual}</dd>
            </div>
            <div>
              <dt>Gesperrte Absender</dt>
              <dd>{report.blockedSenders}</dd>
            </div>
          </dl>

          <h4>Verlauf pro Tag</h4>
          {report.perDay.length === 0 ? (
            <p>Im Zeitraum gab es keinen Spam.</p>
          ) : (
            <ol className="spam-report__days">
              {report.perDay.map((entry) => (
                <li key={entry.day}>
                  <span>{formatDay(entry.day)}</span>
                  <div
                    aria-label={`${entry.auto} automatisch, ${entry.manual} von Hand`}
                    className="spam-report__bar"
                  >
                    <i
                      className="is-auto"
                      style={{ width: `${(entry.auto / maxDay) * 100}%` }}
                    />
                    <i
                      className="is-manual"
                      style={{ width: `${(entry.manual / maxDay) * 100}%` }}
                    />
                  </div>
                  <b>{entry.auto + entry.manual}</b>
                </li>
              ))}
            </ol>
          )}
          <p className="spam-report__legend">
            <i className="is-auto" /> automatisch <i className="is-manual" />{" "}
            von Hand
          </p>

          <div className="spam-report__columns">
            <div>
              <h4>Häufigste Absender</h4>
              {report.topSenders.length === 0 ? (
                <p>Keine Absender im Zeitraum.</p>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Absender</th>
                      <th>Anzahl</th>
                      <th>Zuletzt</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.topSenders.map((entry) => (
                      <tr key={entry.sender}>
                        <td>{entry.sender}</td>
                        <td>{entry.count}</td>
                        <td>{formatDate(entry.lastAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div>
              <h4>Nach Abteilung</h4>
              {report.byDepartment.length === 0 ? (
                <p>Keine Daten.</p>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Abteilung</th>
                      <th>Anzahl</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.byDepartment.map((entry) => (
                      <tr key={entry.name}>
                        <td>{entry.name}</td>
                        <td>{entry.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}
