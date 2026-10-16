import { useCallback, useEffect, useId, useRef, useState } from "react";
import { supabase } from "./lib/supabase";

export type ServiceReportingProps = {
  tenantId: string;
};

type ReportPeriod = "7d" | "30d" | "90d";

type GetReportAction = {
  type: "getReport";
  tenantId: string;
  period: ReportPeriod;
};

type PriorityMetric = {
  key: string | null;
  label: string | null;
  ticketCount: number;
};

type DepartmentMetric = {
  id: string | null;
  name: string | null;
  ticketCount: number;
};

type TimeTrackingMetric = {
  billingKind: string;
  entryCount: number;
  minutes: number;
};

type ServiceReport = {
  period: {
    key: ReportPeriod;
    startsAt: string;
    endsAt: string;
  };
  ticketVolume: number;
  tickets: {
    open: number;
    resolved: number;
    byPriority: PriorityMetric[];
    byDepartment: DepartmentMetric[];
  };
  averageFirstResponseMinutes: number | null;
  firstResponseSampleSize: number;
  averageResolutionMinutes: number | null;
  resolutionSampleSize: number;
  timeTrackingByBillingKind: TimeTrackingMetric[];
  openEscalations: number;
  averageSatisfaction: number | null;
  satisfactionSampleSize: number;
};

type ReportLoadState =
  "idle" | "loading" | "forbidden" | "unavailable" | "error";

type SummaryMetricProps = {
  label: string;
  value: string;
  detail: string;
  tone?: "default" | "attention";
};

const PERIODS: readonly { key: ReportPeriod; label: string }[] = [
  { key: "7d", label: "7 Tage" },
  { key: "30d", label: "30 Tage" },
  { key: "90d", label: "90 Tage" },
];

const numberFormatter = new Intl.NumberFormat("de-CH");
const decimalFormatter = new Intl.NumberFormat("de-CH", {
  maximumFractionDigits: 2,
});
const dateFormatter = new Intl.DateTimeFormat("de-CH", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Zurich",
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isReportPeriod(value: unknown): value is ReportPeriod {
  return value === "7d" || value === "30d" || value === "90d";
}

function isNullableString(value: unknown): value is string | null {
  return typeof value === "string" || value === null;
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isNullableNonNegativeNumber(value: unknown): value is number | null {
  return value === null || isNonNegativeNumber(value);
}

function responseData(value: unknown): Record<string, unknown> | null {
  return isRecord(value) && isRecord(value.data) ? value.data : null;
}

function parsePriorityMetric(value: unknown): PriorityMetric | null {
  if (
    !isRecord(value) ||
    !isNullableString(value.key) ||
    !isNullableString(value.label) ||
    !isNonNegativeNumber(value.ticketCount)
  ) {
    return null;
  }

  return {
    key: value.key,
    label: value.label,
    ticketCount: value.ticketCount,
  };
}

function parseDepartmentMetric(value: unknown): DepartmentMetric | null {
  if (
    !isRecord(value) ||
    !isNullableString(value.id) ||
    !isNullableString(value.name) ||
    !isNonNegativeNumber(value.ticketCount)
  ) {
    return null;
  }

  return {
    id: value.id,
    name: value.name,
    ticketCount: value.ticketCount,
  };
}

function parseTimeTrackingMetric(value: unknown): TimeTrackingMetric | null {
  if (
    !isRecord(value) ||
    typeof value.billingKind !== "string" ||
    !value.billingKind.trim() ||
    !isNonNegativeNumber(value.entryCount) ||
    !isNonNegativeNumber(value.minutes)
  ) {
    return null;
  }

  return {
    billingKind: value.billingKind,
    entryCount: value.entryCount,
    minutes: value.minutes,
  };
}

function parseServiceReport(value: unknown): ServiceReport {
  const data = responseData(value);
  if (!data || !isRecord(data.period) || !isRecord(data.tickets)) {
    throw new Error("Die Berichtsantwort ist unvollständig.");
  }

  if (
    !isReportPeriod(data.period.key) ||
    typeof data.period.startsAt !== "string" ||
    typeof data.period.endsAt !== "string" ||
    !isNonNegativeNumber(data.ticketVolume) ||
    !isNonNegativeNumber(data.tickets.open) ||
    !isNonNegativeNumber(data.tickets.resolved) ||
    !Array.isArray(data.tickets.byPriority) ||
    !Array.isArray(data.tickets.byDepartment) ||
    !isNullableNonNegativeNumber(data.averageFirstResponseMinutes) ||
    !isNonNegativeNumber(data.firstResponseSampleSize) ||
    !isNullableNonNegativeNumber(data.averageResolutionMinutes) ||
    !isNonNegativeNumber(data.resolutionSampleSize) ||
    !Array.isArray(data.timeTrackingByBillingKind) ||
    !isNonNegativeNumber(data.openEscalations) ||
    !isNullableNonNegativeNumber(data.averageSatisfaction) ||
    !isNonNegativeNumber(data.satisfactionSampleSize)
  ) {
    throw new Error("Die Berichtsantwort enthält ungültige Kennzahlen.");
  }

  const byPriority = data.tickets.byPriority.map(parsePriorityMetric);
  const byDepartment = data.tickets.byDepartment.map(parseDepartmentMetric);
  const timeTrackingByBillingKind = data.timeTrackingByBillingKind.map(
    parseTimeTrackingMetric,
  );
  if (
    byPriority.some((metric) => metric === null) ||
    byDepartment.some((metric) => metric === null) ||
    timeTrackingByBillingKind.some((metric) => metric === null)
  ) {
    throw new Error("Die Berichtsantwort enthält ungültige Detailkennzahlen.");
  }

  return {
    period: {
      key: data.period.key,
      startsAt: data.period.startsAt,
      endsAt: data.period.endsAt,
    },
    ticketVolume: data.ticketVolume,
    tickets: {
      open: data.tickets.open,
      resolved: data.tickets.resolved,
      byPriority: byPriority as PriorityMetric[],
      byDepartment: byDepartment as DepartmentMetric[],
    },
    averageFirstResponseMinutes: data.averageFirstResponseMinutes,
    firstResponseSampleSize: data.firstResponseSampleSize,
    averageResolutionMinutes: data.averageResolutionMinutes,
    resolutionSampleSize: data.resolutionSampleSize,
    timeTrackingByBillingKind:
      timeTrackingByBillingKind as TimeTrackingMetric[],
    openEscalations: data.openEscalations,
    averageSatisfaction: data.averageSatisfaction,
    satisfactionSampleSize: data.satisfactionSampleSize,
  };
}

async function invokeServiceReporting(
  action: GetReportAction,
): Promise<unknown> {
  if (!supabase) {
    throw new Error("Die Verbindung zu Supabase ist nicht konfiguriert.");
  }

  const { data, error } = await supabase.functions.invoke<unknown>(
    "service-reporting",
    { body: action },
  );
  if (error) throw error;
  return data;
}

function errorStatus(error: unknown): number | null {
  if (!isRecord(error)) return null;
  if (typeof error.status === "number") return error.status;

  const context = error.context;
  if (context instanceof Response) return context.status;
  if (isRecord(context) && typeof context.status === "number") {
    return context.status;
  }
  return null;
}

function formatNumber(value: number | null): string {
  return value === null ? "Noch keine Daten" : numberFormatter.format(value);
}

function formatDuration(value: number | null): string {
  if (value === null) return "Noch keine Daten";

  const totalMinutes = Math.round(value);
  const days = Math.floor(totalMinutes / 1_440);
  const hours = Math.floor((totalMinutes % 1_440) / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];

  if (days > 0) parts.push(`${days} ${days === 1 ? "Tag" : "Tage"}`);
  if (hours > 0) parts.push(`${hours} ${hours === 1 ? "Std." : "Std."}`);
  if (minutes > 0 || parts.length === 0) parts.push(`${minutes} Min.`);
  return parts.join(" ");
}

function formatSampleSize(
  size: number,
  singular: string,
  plural: string,
): string {
  if (size === 0) return "Noch keine Daten";
  return `${formatNumber(size)} ${size === 1 ? singular : plural}`;
}

function formatReportPeriod(period: ServiceReport["period"]): string {
  const startsAt = new Date(period.startsAt);
  const endsAt = new Date(period.endsAt);
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
    return "Zeitraum nicht verfügbar";
  }
  return `${dateFormatter.format(startsAt)} – ${dateFormatter.format(endsAt)}`;
}

function categoryLabel(
  label: string | null,
  key: string | null,
  fallback: string,
): string {
  return label?.trim() || key?.trim() || fallback;
}

function billingKindLabel(billingKind: string): string {
  const labels: Record<string, string> = {
    internal: "Intern",
    billable: "Verrechenbar",
    goodwill: "Kulanz",
  };
  return labels[billingKind] ?? billingKind;
}

function SummaryMetric({
  label,
  value,
  detail,
  tone = "default",
}: SummaryMetricProps) {
  return (
    <article
      className={`service-reporting__metric service-reporting__metric--${tone}`}
    >
      <p>{label}</p>
      <strong>{value}</strong>
      <span>{detail}</span>
    </article>
  );
}

const serviceReportingStyles = `
  .service-reporting {
    color: #173246;
    display: grid;
    gap: 18px;
  }
  .service-reporting__header,
  .service-reporting__toolbar,
  .service-reporting__section-heading,
  .service-reporting__row {
    align-items: center;
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    justify-content: space-between;
  }
  .service-reporting__header { align-items: flex-start; gap: 16px; }
  .service-reporting__eyebrow {
    color: #617983;
    font-size: 11px;
    font-weight: 800;
    letter-spacing: .06em;
    margin: 0 0 5px;
    text-transform: uppercase;
  }
  .service-reporting h1,
  .service-reporting h2,
  .service-reporting h3 { color: #173246; margin: 0; }
  .service-reporting h1 { font-size: clamp(24px, 3vw, 32px); letter-spacing: -.04em; }
  .service-reporting h2 { font-size: 16px; letter-spacing: -.02em; }
  .service-reporting__intro,
  .service-reporting__period,
  .service-reporting__detail,
  .service-reporting__empty,
  .service-reporting__state p { color: #627780; font-size: 13px; line-height: 1.5; margin: 7px 0 0; }
  .service-reporting__toolbar { justify-content: flex-end; }
  .service-reporting__period-switcher {
    background: #ebf0f1;
    border: 1px solid #d9e2e5;
    border-radius: 7px;
    display: inline-flex;
    gap: 2px;
    padding: 3px;
  }
  .service-reporting__period-button,
  .service-reporting__refresh {
    appearance: none;
    border: 0;
    border-radius: 5px;
    color: #365767;
    cursor: pointer;
    font: inherit;
    font-size: 12px;
    font-weight: 700;
  }
  .service-reporting__period-button { background: transparent; padding: 7px 10px; }
  .service-reporting__period-button[aria-pressed="true"] { background: #fff; box-shadow: 0 1px 2px rgba(21, 48, 63, .1); color: #143145; }
  .service-reporting__refresh { background: #fff; border: 1px solid #b9cbd2; padding: 8px 11px; }
  .service-reporting__period-button:hover:not(:disabled),
  .service-reporting__refresh:hover:not(:disabled) { background: #f1f7f8; }
  .service-reporting__period-button:focus-visible,
  .service-reporting__refresh:focus-visible { outline: 3px solid #8ed6cd; outline-offset: 2px; }
  .service-reporting__period-button:disabled,
  .service-reporting__refresh:disabled { cursor: wait; opacity: .62; }
  .service-reporting__state,
  .service-reporting__panel {
    background: #fff;
    border: 1px solid #dce7ea;
    border-radius: 8px;
    padding: 18px;
  }
  .service-reporting__state { max-width: 760px; }
  .service-reporting__state[role="alert"] { border-color: #efc6be; background: #fff5f2; }
  .service-reporting__state[role="alert"] h2,
  .service-reporting__state[role="alert"] p { color: #923d2d; }
  .service-reporting__summary {
    display: grid;
    gap: 12px;
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
  .service-reporting__metric {
    background: #fff;
    border: 1px solid #dce7ea;
    border-radius: 8px;
    display: grid;
    gap: 7px;
    min-height: 132px;
    padding: 17px;
  }
  .service-reporting__metric--attention { border-top: 3px solid #ef7d54; padding-top: 15px; }
  .service-reporting__metric p,
  .service-reporting__metric span { color: #627780; font-size: 12px; line-height: 1.4; margin: 0; }
  .service-reporting__metric strong { color: #173246; font-family: "IBM Plex Mono", ui-monospace, monospace; font-size: 25px; letter-spacing: -.06em; overflow-wrap: anywhere; }
  .service-reporting__metric--attention strong { color: #a34c35; }
  .service-reporting__grid {
    display: grid;
    gap: 14px;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .service-reporting__panel { min-width: 0; }
  .service-reporting__section-heading { align-items: flex-start; }
  .service-reporting__section-heading > div { min-width: 0; }
  .service-reporting__list {
    list-style: none;
    margin: 14px 0 0;
    padding: 0;
  }
  .service-reporting__list li { border-top: 1px solid #e9eff0; padding: 11px 0; }
  .service-reporting__list li:last-child { padding-bottom: 0; }
  .service-reporting__row { flex-wrap: nowrap; gap: 14px; }
  .service-reporting__row > div { min-width: 0; }
  .service-reporting__row strong { color: #234d5f; font-family: "IBM Plex Mono", ui-monospace, monospace; font-size: 13px; white-space: nowrap; }
  .service-reporting__row-label { color: #294858; font-size: 13px; font-weight: 700; overflow-wrap: anywhere; }
  .service-reporting__detail { font-size: 12px; margin-top: 3px; }
  .service-reporting__quality { display: grid; gap: 0; margin: 14px 0 0; }
  .service-reporting__quality div { border-top: 1px solid #e9eff0; display: grid; gap: 5px; padding: 12px 0; }
  .service-reporting__quality div:last-child { padding-bottom: 0; }
  .service-reporting__quality dt { color: #627780; font-size: 12px; }
  .service-reporting__quality dd { color: #173246; font-family: "IBM Plex Mono", ui-monospace, monospace; font-size: 15px; font-weight: 700; margin: 0; }
  .service-reporting__quality dd span { color: #627780; display: block; font-family: inherit; font-size: 11px; font-weight: 400; margin-top: 4px; }
  .service-reporting__empty { margin: 16px 0 0; }
  @media (max-width: 900px) {
    .service-reporting__summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }
  @media (max-width: 620px) {
    .service-reporting__header { display: grid; }
    .service-reporting__toolbar { align-items: stretch; justify-content: flex-start; }
    .service-reporting__period-switcher { width: fit-content; }
    .service-reporting__refresh { width: fit-content; }
    .service-reporting__summary,
    .service-reporting__grid { grid-template-columns: 1fr; }
    .service-reporting__panel,
    .service-reporting__state { padding: 15px; }
  }
`;

export function ServiceReporting({ tenantId }: ServiceReportingProps) {
  const headingId = useId();
  const [period, setPeriod] = useState<ReportPeriod>("30d");
  const [report, setReport] = useState<ServiceReport | null>(null);
  const [loadState, setLoadState] = useState<ReportLoadState>("idle");
  const requestVersion = useRef(0);

  const loadReport = useCallback(async () => {
    const version = requestVersion.current + 1;
    requestVersion.current = version;
    setLoadState("loading");
    setReport(null);

    try {
      const response = await invokeServiceReporting({
        type: "getReport",
        tenantId,
        period,
      });
      const parsedReport = parseServiceReport(response);
      if (requestVersion.current !== version) return;
      setReport(parsedReport);
      setLoadState("idle");
    } catch (requestError) {
      if (requestVersion.current !== version) return;
      setReport(null);
      const status = errorStatus(requestError);
      setLoadState(
        status === 403 ? "forbidden" : status === 503 ? "unavailable" : "error",
      );
    }
  }, [period, tenantId]);

  useEffect(() => {
    void loadReport();
    return () => {
      requestVersion.current += 1;
    };
  }, [loadReport]);

  function selectPeriod(nextPeriod: ReportPeriod) {
    if (nextPeriod === period) return;
    setReport(null);
    setPeriod(nextPeriod);
  }

  const isLoading = loadState === "loading";

  return (
    <section
      className="service-reporting"
      aria-labelledby={headingId}
      aria-busy={isLoading}
    >
      <style>{serviceReportingStyles}</style>
      <header className="service-reporting__header">
        <div>
          <p className="service-reporting__eyebrow">Servicequalität</p>
          <h1 id={headingId}>Service-Reporting</h1>
          <p className="service-reporting__intro">
            Reale Kennzahlen für den ausgewählten Berichtszeitraum dieses
            Mandanten.
          </p>
        </div>
        <div className="service-reporting__toolbar">
          <div
            className="service-reporting__period-switcher"
            role="group"
            aria-label="Berichtszeitraum auswählen"
          >
            {PERIODS.map((option) => (
              <button
                className="service-reporting__period-button"
                type="button"
                key={option.key}
                aria-pressed={period === option.key}
                onClick={() => selectPeriod(option.key)}
                disabled={isLoading}
              >
                {option.label}
              </button>
            ))}
          </div>
          <button
            className="service-reporting__refresh"
            type="button"
            onClick={() => void loadReport()}
            disabled={isLoading}
          >
            {isLoading ? "Wird geladen …" : "Aktualisieren"}
          </button>
        </div>
      </header>

      {isLoading && (
        <section className="service-reporting__state" aria-live="polite">
          <h2>Bericht wird geladen</h2>
          <p>Die aktuellen Kennzahlen werden abgerufen.</p>
        </section>
      )}

      {loadState === "forbidden" && (
        <section className="service-reporting__state" role="alert">
          <h2>Kein Zugriff auf Berichte</h2>
          <p>
            Sie haben für diesen Mandanten keine Berechtigung, Service-Berichte
            zu lesen. Wenden Sie sich an eine Person mit der Berechtigung
            „Berichte lesen“.
          </p>
        </section>
      )}

      {loadState === "unavailable" && (
        <section className="service-reporting__state" role="alert">
          <h2>Bericht derzeit nicht verfügbar</h2>
          <p>
            Die Reporting-Daten oder die erforderliche Berechtigung können
            momentan nicht geprüft werden. Bitte versuchen Sie es später erneut.
          </p>
        </section>
      )}

      {loadState === "error" && (
        <section className="service-reporting__state" role="alert">
          <h2>Bericht konnte nicht geladen werden</h2>
          <p>
            Die Kennzahlen konnten nicht vollständig abgerufen werden. Bitte
            aktualisieren Sie den Bericht oder versuchen Sie es später erneut.
          </p>
        </section>
      )}

      {report && !isLoading && (
        <>
          <p className="service-reporting__period">
            Zeitraum: {formatReportPeriod(report.period)}
          </p>

          <div
            className="service-reporting__summary"
            aria-label="Übersicht der Kennzahlen"
          >
            <SummaryMetric
              label="Ticketvolumen"
              value={formatNumber(report.ticketVolume)}
              detail="Im ausgewählten Zeitraum erstellt"
            />
            <SummaryMetric
              label="Offene Tickets"
              value={formatNumber(report.tickets.open)}
              detail="Zum Zeitpunkt der Berichtsabfrage"
              tone={report.tickets.open > 0 ? "attention" : "default"}
            />
            <SummaryMetric
              label="Gelöste Tickets"
              value={formatNumber(report.tickets.resolved)}
              detail="Im ausgewählten Zeitraum erstellt und geschlossen"
            />
            <SummaryMetric
              label="Offene Eskalationen"
              value={formatNumber(report.openEscalations)}
              detail="Im ausgewählten Zeitraum eröffnet"
              tone={report.openEscalations > 0 ? "attention" : "default"}
            />
          </div>

          <div className="service-reporting__grid">
            <section
              className="service-reporting__panel"
              aria-labelledby={`${headingId}-priorities`}
            >
              <div className="service-reporting__section-heading">
                <div>
                  <h2 id={`${headingId}-priorities`}>Tickets nach Priorität</h2>
                  <p className="service-reporting__detail">
                    Verteilung des tatsächlichen Ticketvolumens.
                  </p>
                </div>
              </div>
              {report.tickets.byPriority.length === 0 ? (
                <p className="service-reporting__empty">Noch keine Daten</p>
              ) : (
                <ul className="service-reporting__list">
                  {report.tickets.byPriority.map((metric, index) => (
                    <li key={`${metric.key ?? "ohne-prioritaet"}-${index}`}>
                      <div className="service-reporting__row">
                        <span className="service-reporting__row-label">
                          {categoryLabel(
                            metric.label,
                            metric.key,
                            "Nicht zugeordnet",
                          )}
                        </span>
                        <strong>{formatNumber(metric.ticketCount)}</strong>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section
              className="service-reporting__panel"
              aria-labelledby={`${headingId}-departments`}
            >
              <div className="service-reporting__section-heading">
                <div>
                  <h2 id={`${headingId}-departments`}>
                    Tickets nach Abteilung
                  </h2>
                  <p className="service-reporting__detail">
                    Zuordnung der tatsächlich erfassten Tickets.
                  </p>
                </div>
              </div>
              {report.tickets.byDepartment.length === 0 ? (
                <p className="service-reporting__empty">Noch keine Daten</p>
              ) : (
                <ul className="service-reporting__list">
                  {report.tickets.byDepartment.map((metric, index) => (
                    <li key={`${metric.id ?? "ohne-abteilung"}-${index}`}>
                      <div className="service-reporting__row">
                        <span className="service-reporting__row-label">
                          {metric.name?.trim() || "Nicht zugeordnet"}
                        </span>
                        <strong>{formatNumber(metric.ticketCount)}</strong>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section
              className="service-reporting__panel"
              aria-labelledby={`${headingId}-quality`}
            >
              <div className="service-reporting__section-heading">
                <div>
                  <h2 id={`${headingId}-quality`}>Servicequalität</h2>
                  <p className="service-reporting__detail">
                    Durchschnittswerte basieren nur auf Tickets mit erfasstem
                    Zeitpunkt beziehungsweise Feedback.
                  </p>
                </div>
              </div>
              <dl className="service-reporting__quality">
                <div>
                  <dt>Durchschnittliche Erstreaktion</dt>
                  <dd>
                    {formatDuration(report.averageFirstResponseMinutes)}
                    <span>
                      Grundlage:{" "}
                      {formatSampleSize(
                        report.firstResponseSampleSize,
                        "Ticket",
                        "Tickets",
                      )}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt>Durchschnittliche Lösungszeit</dt>
                  <dd>
                    {formatDuration(report.averageResolutionMinutes)}
                    <span>
                      Grundlage:{" "}
                      {formatSampleSize(
                        report.resolutionSampleSize,
                        "Ticket",
                        "Tickets",
                      )}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt>Zufriedenheit</dt>
                  <dd>
                    {report.averageSatisfaction === null
                      ? "Noch keine Daten"
                      : `${decimalFormatter.format(report.averageSatisfaction)} von 5`}
                    <span>
                      Grundlage:{" "}
                      {formatSampleSize(
                        report.satisfactionSampleSize,
                        "Bewertung",
                        "Bewertungen",
                      )}
                    </span>
                  </dd>
                </div>
              </dl>
            </section>

            <section
              className="service-reporting__panel"
              aria-labelledby={`${headingId}-time`}
            >
              <div className="service-reporting__section-heading">
                <div>
                  <h2 id={`${headingId}-time`}>Zeiterfassung nach Zeitart</h2>
                  <p className="service-reporting__detail">
                    Erfasste Zeit im ausgewählten Zeitraum.
                  </p>
                </div>
              </div>
              {report.timeTrackingByBillingKind.length === 0 ? (
                <p className="service-reporting__empty">Noch keine Daten</p>
              ) : (
                <ul className="service-reporting__list">
                  {report.timeTrackingByBillingKind.map((metric) => (
                    <li key={metric.billingKind}>
                      <div className="service-reporting__row">
                        <div>
                          <div className="service-reporting__row-label">
                            {billingKindLabel(metric.billingKind)}
                          </div>
                          <p className="service-reporting__detail">
                            {formatSampleSize(
                              metric.entryCount,
                              "Eintrag",
                              "Einträge",
                            )}
                          </p>
                        </div>
                        <strong>{formatDuration(metric.minutes)}</strong>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      )}
    </section>
  );
}
