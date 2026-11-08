import { useEffect, useId, useState } from "react";
import {
  formatLevelMinutes,
  formatRate,
  loadSupportLevelReport,
  supportLevelLabel,
  type SupportLevelReport,
} from "./lib/support-levels";

/**
 * Eskalationsstufen im Service-Reporting: Erstlösungsquote im 1st Level,
 * Eskalationen pro Kategorie und durchschnittliche Zeit pro Stufe. Nutzt
 * denselben Zeitraum wie der übrige Bericht.
 */
export function SupportLevelReportPanel({
  range,
  tenantId,
}: {
  range: { startsAt: string; endsAt: string };
  tenantId: string;
}) {
  const headingId = useId();
  const [state, setState] = useState<{
    key: string;
    report: SupportLevelReport | null;
    error: string;
  } | null>(null);
  const key = `${tenantId}|${range.startsAt}|${range.endsAt}`;

  useEffect(() => {
    let active = true;
    loadSupportLevelReport(tenantId, range)
      .then((report) => {
        if (active) setState({ key, report, error: "" });
      })
      .catch((error: unknown) => {
        if (active)
          setState({
            key,
            report: null,
            error:
              error instanceof Error
                ? error.message
                : "Der Stufenbericht konnte nicht geladen werden.",
          });
      });
    return () => {
      active = false;
    };
    // range values are part of key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const current = state?.key === key ? state : null;
  if (current?.report && !current.report.levelsConfigured) return null;

  const report = current?.report ?? null;
  const flr = report?.firstLevelResolution;
  return (
    <section
      aria-labelledby={`${headingId}-levels`}
      className="service-reporting__panel"
    >
      <div className="service-reporting__section-heading">
        <div>
          <h2 id={`${headingId}-levels`}>Eskalationsstufen</h2>
          <p className="service-reporting__detail">
            1st/2nd/3rd Level nach den Supportstufen der Teams.
          </p>
        </div>
      </div>
      {!current ? (
        <p className="service-reporting__empty" role="status">
          Stufenbericht wird geladen …
        </p>
      ) : current.error ? (
        <p className="service-reporting__empty" role="alert">
          {current.error}
        </p>
      ) : report && flr ? (
        <>
          <p className="service-reporting__time-total">
            Erstlösungsquote im 1st Level:{" "}
            <strong>{formatRate(flr.rate)}</strong>
            <br />
            <span className="service-reporting__comparison">
              {flr.resolvedAtFirstLevel} von {flr.resolvedTickets} gelösten
              Tickets ohne Übergabe an eine höhere Stufe · {report.escalations}{" "}
              Übergaben nach oben, {report.returns} Rückgaben
            </span>
          </p>
          <dl className="service-reporting__quality">
            {report.averageTimeByLevel.map((entry) => (
              <div key={entry.level}>
                <dt>Ø Zeit im {supportLevelLabel(entry.level)}</dt>
                <dd>
                  {formatLevelMinutes(entry.averageMinutes)}
                  <span>
                    {entry.tickets === 1
                      ? "1 gelöstes Ticket"
                      : `${entry.tickets} gelöste Tickets`}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
          <h3 className="service-reporting__row-label">
            Eskalationen pro Kategorie
          </h3>
          {report.escalationsByCategory.length === 0 ? (
            <p className="service-reporting__empty">
              Keine Übergaben an eine höhere Stufe im Zeitraum.
            </p>
          ) : (
            <ul className="service-reporting__list">
              {report.escalationsByCategory.map((entry) => (
                <li key={entry.categoryId ?? "none"}>
                  <div className="service-reporting__row">
                    <div>
                      <div className="service-reporting__row-label">
                        {entry.categoryName}
                      </div>
                      <p className="service-reporting__detail">
                        {entry.tickets === 1
                          ? "1 Ticket"
                          : `${entry.tickets} Tickets`}
                      </p>
                    </div>
                    <strong>{entry.escalations}</strong>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}
    </section>
  );
}
