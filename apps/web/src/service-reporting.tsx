import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { functionErrorMessage } from "./lib/function-error";
import { supabase } from "./lib/supabase";

export type ServiceReportingBranding = {
  accentColor: string;
  logoUrl: string;
  name: string | null;
  primaryColor: string;
  secondaryColor: string;
};

export type ServiceReportingProps = {
  branding: ServiceReportingBranding;
  tenantId: string;
};

type ReportPeriod = "7d" | "30d" | "90d" | "custom";
type GetReportAction = {
  type: "getReport";
  tenantId: string;
  period: ReportPeriod;
  startsOn?: string;
  endsOn?: string;
};
type PeriodInfo = {
  key: ReportPeriod;
  startsAt: string;
  endsAt: string;
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
type ReportComparison = {
  period: PeriodInfo;
  ticketVolume: number;
  tickets: { open: number; resolved: number };
  averageFirstResponseMinutes: number | null;
  firstResponseSampleSize: number;
  averageResolutionMinutes: number | null;
  resolutionSampleSize: number;
  timeTrackingMinutes: number;
  timeTrackingEntryCount: number;
  openEscalations: number;
  averageSatisfaction: number | null;
  satisfactionSampleSize: number;
};
type ServiceReport = {
  period: PeriodInfo;
  comparison: ReportComparison;
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
  timeTrackingMinutes: number;
  timeTrackingEntryCount: number;
  openEscalations: number;
  averageSatisfaction: number | null;
  satisfactionSampleSize: number;
};
type ReportLoadState =
  "idle" | "loading" | "forbidden" | "unavailable" | "error";
type ReportSection = "overview" | "quality" | "distribution" | "time";

type SummaryMetricProps = {
  label: string;
  value: string;
  detail: string;
  comparison: string;
  tone?: "default" | "attention";
};

const PERIODS: readonly {
  key: Exclude<ReportPeriod, "custom">;
  label: string;
}[] = [
  { key: "7d", label: "7 Tage" },
  { key: "30d", label: "30 Tage" },
  { key: "90d", label: "90 Tage" },
];
const REPORT_SECTIONS: readonly { key: ReportSection; label: string }[] = [
  { key: "overview", label: "Übersicht" },
  { key: "quality", label: "Servicequalität" },
  { key: "distribution", label: "Verteilungen" },
  { key: "time", label: "Zeiterfassung" },
];
const DATE_INPUT = /^\d{4}-\d{2}-\d{2}$/;
const numberFormatter = new Intl.NumberFormat("de-CH");
const decimalFormatter = new Intl.NumberFormat("de-CH", {
  maximumFractionDigits: 2,
});
const dateFormatter = new Intl.DateTimeFormat("de-CH", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Zurich",
});
const dateOnlyFormatter = new Intl.DateTimeFormat("de-CH", {
  dateStyle: "medium",
  timeZone: "Europe/Zurich",
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isReportPeriod(value: unknown): value is ReportPeriod {
  return (
    value === "7d" || value === "30d" || value === "90d" || value === "custom"
  );
}

function isNullableNonNegativeNumber(value: unknown): value is number | null {
  return (
    value === null ||
    (typeof value === "number" && Number.isFinite(value) && value >= 0)
  );
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function parsePeriod(value: unknown): PeriodInfo | null {
  if (
    !isRecord(value) ||
    !isReportPeriod(value.key) ||
    typeof value.startsAt !== "string" ||
    typeof value.endsAt !== "string" ||
    Number.isNaN(Date.parse(value.startsAt)) ||
    Number.isNaN(Date.parse(value.endsAt))
  ) {
    return null;
  }
  return { key: value.key, startsAt: value.startsAt, endsAt: value.endsAt };
}

function parsePriorityMetric(value: unknown): PriorityMetric | null {
  if (
    !isRecord(value) ||
    !(typeof value.key === "string" || value.key === null) ||
    !(typeof value.label === "string" || value.label === null) ||
    !isNonNegativeNumber(value.ticketCount)
  ) {
    return null;
  }
  return { key: value.key, label: value.label, ticketCount: value.ticketCount };
}

function parseDepartmentMetric(value: unknown): DepartmentMetric | null {
  if (
    !isRecord(value) ||
    !(typeof value.id === "string" || value.id === null) ||
    !(typeof value.name === "string" || value.name === null) ||
    !isNonNegativeNumber(value.ticketCount)
  ) {
    return null;
  }
  return { id: value.id, name: value.name, ticketCount: value.ticketCount };
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

function responseData(value: unknown): Record<string, unknown> | null {
  return isRecord(value) && isRecord(value.data) ? value.data : null;
}

function parseComparison(value: unknown): ReportComparison | null {
  if (!isRecord(value)) return null;
  const period = parsePeriod(value.period);
  if (
    !period ||
    !isNonNegativeNumber(value.ticketVolume) ||
    !isRecord(value.tickets) ||
    !isNonNegativeNumber(value.tickets.open) ||
    !isNonNegativeNumber(value.tickets.resolved) ||
    !isNullableNonNegativeNumber(value.averageFirstResponseMinutes) ||
    !isNonNegativeNumber(value.firstResponseSampleSize) ||
    !isNullableNonNegativeNumber(value.averageResolutionMinutes) ||
    !isNonNegativeNumber(value.resolutionSampleSize) ||
    !isNonNegativeNumber(value.timeTrackingMinutes) ||
    !isNonNegativeNumber(value.timeTrackingEntryCount) ||
    !isNonNegativeNumber(value.openEscalations) ||
    !isNullableNonNegativeNumber(value.averageSatisfaction) ||
    !isNonNegativeNumber(value.satisfactionSampleSize)
  ) {
    return null;
  }
  return {
    period,
    ticketVolume: value.ticketVolume,
    tickets: { open: value.tickets.open, resolved: value.tickets.resolved },
    averageFirstResponseMinutes: value.averageFirstResponseMinutes,
    firstResponseSampleSize: value.firstResponseSampleSize,
    averageResolutionMinutes: value.averageResolutionMinutes,
    resolutionSampleSize: value.resolutionSampleSize,
    timeTrackingMinutes: value.timeTrackingMinutes,
    timeTrackingEntryCount: value.timeTrackingEntryCount,
    openEscalations: value.openEscalations,
    averageSatisfaction: value.averageSatisfaction,
    satisfactionSampleSize: value.satisfactionSampleSize,
  };
}

function parseServiceReport(value: unknown): ServiceReport {
  const data = responseData(value);
  if (
    !data ||
    !isRecord(data.tickets) ||
    !Array.isArray(data.tickets.byPriority)
  ) {
    throw new Error("Die Berichtsantwort ist unvollständig.");
  }
  const period = parsePeriod(data.period);
  const comparison = parseComparison(data.comparison);
  const priorities = data.tickets.byPriority.map(parsePriorityMetric);
  const departments = Array.isArray(data.tickets.byDepartment)
    ? data.tickets.byDepartment.map(parseDepartmentMetric)
    : [];
  const time = Array.isArray(data.timeTrackingByBillingKind)
    ? data.timeTrackingByBillingKind.map(parseTimeTrackingMetric)
    : [];
  if (
    !period ||
    !comparison ||
    priorities.some((entry) => entry === null) ||
    departments.some((entry) => entry === null) ||
    time.some((entry) => entry === null) ||
    !isNonNegativeNumber(data.ticketVolume) ||
    !isNonNegativeNumber(data.tickets.open) ||
    !isNonNegativeNumber(data.tickets.resolved) ||
    !isNullableNonNegativeNumber(data.averageFirstResponseMinutes) ||
    !isNonNegativeNumber(data.firstResponseSampleSize) ||
    !isNullableNonNegativeNumber(data.averageResolutionMinutes) ||
    !isNonNegativeNumber(data.resolutionSampleSize) ||
    !isNonNegativeNumber(data.timeTrackingMinutes) ||
    !isNonNegativeNumber(data.timeTrackingEntryCount) ||
    !isNonNegativeNumber(data.openEscalations) ||
    !isNullableNonNegativeNumber(data.averageSatisfaction) ||
    !isNonNegativeNumber(data.satisfactionSampleSize)
  ) {
    throw new Error("Die Berichtsantwort enthält ungültige Kennzahlen.");
  }
  return {
    period,
    comparison,
    ticketVolume: data.ticketVolume,
    tickets: {
      open: data.tickets.open,
      resolved: data.tickets.resolved,
      byPriority: priorities as PriorityMetric[],
      byDepartment: departments as DepartmentMetric[],
    },
    averageFirstResponseMinutes: data.averageFirstResponseMinutes,
    firstResponseSampleSize: data.firstResponseSampleSize,
    averageResolutionMinutes: data.averageResolutionMinutes,
    resolutionSampleSize: data.resolutionSampleSize,
    timeTrackingByBillingKind: time as TimeTrackingMetric[],
    timeTrackingMinutes: data.timeTrackingMinutes,
    timeTrackingEntryCount: data.timeTrackingEntryCount,
    openEscalations: data.openEscalations,
    averageSatisfaction: data.averageSatisfaction,
    satisfactionSampleSize: data.satisfactionSampleSize,
  };
}

async function invokeServiceReporting(
  action: GetReportAction,
): Promise<unknown> {
  if (!supabase)
    throw new Error("Die Verbindung zu Supabase ist nicht konfiguriert.");
  const { data, error } = await supabase.functions.invoke<unknown>(
    "service-reporting",
    { body: action },
  );
  if (error) {
    throw new Error(
      await functionErrorMessage(
        error,
        "Der Bericht konnte nicht geladen werden.",
      ),
    );
  }
  return data;
}

function errorStatus(error: unknown): number | null {
  if (!isRecord(error)) return null;
  if (typeof error.status === "number") return error.status;
  const context = error.context;
  if (context instanceof Response) return context.status;
  return isRecord(context) && typeof context.status === "number"
    ? context.status
    : null;
}

function toDateInput(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Zurich",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (kind: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === kind)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
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
  if (hours > 0) parts.push(`${hours} Std.`);
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

function formatReportPeriod(period: PeriodInfo): string {
  const startsAt = new Date(period.startsAt);
  const endsAt = new Date(period.endsAt);
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
    return "Zeitraum nicht verfügbar";
  }
  return `${dateOnlyFormatter.format(startsAt)} – ${dateOnlyFormatter.format(endsAt)}`;
}

function comparisonText(
  current: number | null,
  previous: number | null,
  formatter: (value: number | null) => string,
): string {
  if (previous === null) return "Vorperiode: Noch keine Daten";
  if (current === null) return `Vorperiode: ${formatter(previous)}`;
  const difference = current - previous;
  const change =
    difference === 0
      ? "unverändert"
      : `${difference > 0 ? "+" : "−"}${formatter(Math.abs(difference))}`;
  return `Vorperiode: ${formatter(previous)} · ${change}`;
}

function categoryLabel(
  label: string | null,
  key: string | null,
  fallback: string,
): string {
  return label?.trim() || key?.trim() || fallback;
}

function billingKindLabel(billingKind: string): string {
  return (
    { internal: "Intern", billable: "Verrechenbar", goodwill: "Kulanz" }[
      billingKind
    ] ?? billingKind
  );
}

function SummaryMetric({
  label,
  value,
  detail,
  comparison,
  tone = "default",
}: SummaryMetricProps) {
  return (
    <article
      className={`service-reporting__metric service-reporting__metric--${tone}`}
    >
      <p>{label}</p>
      <strong>{value}</strong>
      <span>{detail}</span>
      <small>{comparison}</small>
    </article>
  );
}

const serviceReportingStyles = `
  .service-reporting { --report-primary: var(--brand-primary, #4338ca); --report-secondary: var(--brand-primary-hover, #3730a3); --report-accent: var(--brand-accent, #075985); color: var(--ink); display: grid; gap: 18px; min-width: 0; }
  .service-reporting__header, .service-reporting__toolbar, .service-reporting__heading, .service-reporting__row, .service-reporting__section-heading { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; justify-content: space-between; }
  .service-reporting__header, .service-reporting__heading { align-items: flex-start; }
  .service-reporting__eyebrow { color: var(--report-accent); font-size: 11px; font-weight: 800; letter-spacing: .07em; margin: 0 0 5px; text-transform: uppercase; }
  .service-reporting h1, .service-reporting h2, .service-reporting h3 { color: var(--ink); margin: 0; }
  .service-reporting h1 { font-size: clamp(26px, 3vw, 34px); letter-spacing: -.04em; }
  .service-reporting h2 { font-size: 17px; letter-spacing: -.02em; }
  .service-reporting__intro, .service-reporting__period, .service-reporting__detail, .service-reporting__empty, .service-reporting__state p, .service-reporting__masthead-copy p { color: var(--muted); font-size: 13px; line-height: 1.5; margin: 7px 0 0; }
  .service-reporting__toolbar { justify-content: flex-end; }
  .service-reporting__period-switcher { background: var(--surface-subtle); border: 1px solid var(--border); border-radius: 10px; display: inline-flex; flex-wrap: wrap; gap: 3px; padding: 3px; }
  .service-reporting__period-button, .service-reporting__toolbar-button { appearance: none; border: 1px solid transparent; border-radius: 7px; color: var(--text); cursor: pointer; font: inherit; font-size: 12px; font-weight: 700; min-height: 34px; padding: 7px 10px; }
  .service-reporting__period-button { background: transparent; }
  .service-reporting__period-button[aria-pressed="true"] { background: var(--surface); box-shadow: var(--shadow-sm); color: var(--report-primary); }
  .service-reporting__toolbar-button { background: var(--surface); border-color: var(--border); }
  .service-reporting__toolbar-button--primary { background: var(--report-primary); border-color: var(--report-primary); color: #fff; }
  .service-reporting__period-button:hover:not(:disabled), .service-reporting__toolbar-button:hover:not(:disabled) { border-color: var(--report-primary); color: var(--report-primary); }
  .service-reporting__toolbar-button--primary:hover:not(:disabled) { background: var(--report-secondary); color: #fff; }
  .service-reporting__period-button:focus-visible, .service-reporting__toolbar-button:focus-visible, .service-reporting input:focus-visible { outline: 3px solid color-mix(in srgb, var(--report-primary) 28%, transparent); outline-offset: 2px; }
  .service-reporting__period-button:disabled, .service-reporting__toolbar-button:disabled { cursor: wait; opacity: .62; }
  .service-reporting__custom-period, .service-reporting__builder, .service-reporting__state, .service-reporting__panel, .service-reporting__metric { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-card); }
  .service-reporting__custom-period { display: flex; align-items: end; flex-wrap: wrap; gap: 12px; padding: 14px; }
  .service-reporting__custom-period label, .service-reporting__builder-title { display: grid; gap: 6px; color: var(--text); font-size: 12px; font-weight: 700; }
  .service-reporting__custom-period input, .service-reporting__builder-title input { min-height: 38px; border: 1px solid var(--control-border); border-radius: 8px; padding: 7px 9px; background: var(--surface); color: var(--ink); font: inherit; }
  .service-reporting__builder { display: grid; gap: 14px; padding: 16px; }
  .service-reporting__builder h2 { font-size: 16px; }
  .service-reporting__builder p { color: var(--muted); font-size: 13px; line-height: 1.45; margin: 5px 0 0; }
  .service-reporting__builder-grid { display: grid; grid-template-columns: minmax(220px, .8fr) minmax(0, 1.2fr); gap: 16px; }
  .service-reporting__builder-sections { display: flex; align-content: start; flex-wrap: wrap; gap: 8px; }
  .service-reporting__builder-sections label { display: inline-flex; align-items: center; gap: 7px; border: 1px solid var(--border); border-radius: 999px; min-height: 36px; padding: 6px 10px; color: var(--text); font-size: 12px; font-weight: 650; }
  .service-reporting__builder-sections input { accent-color: var(--report-primary); }
  .service-reporting__masthead { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 14px; border: 1px solid color-mix(in srgb, var(--report-primary) 28%, var(--border)); border-top: 4px solid var(--report-primary); border-radius: var(--radius-card); padding: 16px 18px; background: linear-gradient(115deg, color-mix(in srgb, var(--report-primary) 8%, var(--surface)), var(--surface) 52%); }
  .service-reporting__masthead img { width: 42px; height: 42px; object-fit: contain; }
  .service-reporting__masthead-copy strong { display: block; color: var(--ink); font-size: 15px; }
  .service-reporting__masthead-meta { color: var(--muted); font-size: 11px; line-height: 1.45; text-align: right; }
  .service-reporting__state, .service-reporting__panel { padding: 18px; }
  .service-reporting__state { max-width: 760px; }
  .service-reporting__state[role="alert"] { border-color: color-mix(in srgb, var(--danger) 40%, var(--border)); background: var(--danger-soft); }
  .service-reporting__state[role="alert"] h2, .service-reporting__state[role="alert"] p { color: var(--danger); }
  .service-reporting__summary { display: grid; gap: 12px; grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .service-reporting__metric { display: grid; align-content: start; gap: 6px; min-height: 142px; padding: 16px; }
  .service-reporting__metric--attention { border-top: 3px solid var(--warning); padding-top: 14px; }
  .service-reporting__metric p, .service-reporting__metric span, .service-reporting__metric small { color: var(--muted); font-size: 12px; line-height: 1.4; margin: 0; }
  .service-reporting__metric small { margin-top: auto; color: var(--report-accent); font-weight: 650; }
  .service-reporting__metric strong { color: var(--ink); font-size: 25px; font-variant-numeric: tabular-nums; letter-spacing: -.05em; overflow-wrap: anywhere; }
  .service-reporting__grid { display: grid; gap: 14px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .service-reporting__panel { min-width: 0; }
  .service-reporting__section-heading { align-items: flex-start; }
  .service-reporting__list { list-style: none; margin: 14px 0 0; padding: 0; }
  .service-reporting__list li { border-top: 1px solid var(--border); padding: 11px 0; }
  .service-reporting__list li:last-child { padding-bottom: 0; }
  .service-reporting__row { flex-wrap: nowrap; gap: 14px; }
  .service-reporting__row > div { min-width: 0; }
  .service-reporting__row strong { color: var(--report-primary); font-size: 13px; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .service-reporting__row-label { color: var(--text); font-size: 13px; font-weight: 700; overflow-wrap: anywhere; }
  .service-reporting__quality { display: grid; gap: 0; margin: 14px 0 0; }
  .service-reporting__quality div { border-top: 1px solid var(--border); display: grid; gap: 5px; padding: 12px 0; }
  .service-reporting__quality div:last-child { padding-bottom: 0; }
  .service-reporting__quality dt { color: var(--muted); font-size: 12px; }
  .service-reporting__quality dd { color: var(--ink); font-size: 16px; font-weight: 750; margin: 0; }
  .service-reporting__quality dd span { color: var(--muted); display: block; font-size: 11px; font-weight: 500; margin-top: 4px; }
  .service-reporting__comparison { color: var(--report-accent) !important; font-weight: 650 !important; }
  .service-reporting__time-total { margin: 12px 0 0; border: 1px solid color-mix(in srgb, var(--report-primary) 24%, var(--border)); border-radius: 9px; padding: 10px; background: color-mix(in srgb, var(--report-primary) 6%, var(--surface)); color: var(--text); font-size: 12px; line-height: 1.45; }
  .service-reporting__empty { margin: 16px 0 0; }
  @media (max-width: 920px) { .service-reporting__summary { grid-template-columns: repeat(2, minmax(0, 1fr)); } .service-reporting__builder-grid { grid-template-columns: 1fr; } }
  @media (max-width: 640px) { .service-reporting__header, .service-reporting__toolbar, .service-reporting__custom-period { align-items: stretch; justify-content: flex-start; } .service-reporting__period-switcher { width: fit-content; } .service-reporting__summary, .service-reporting__grid { grid-template-columns: 1fr; } .service-reporting__masthead { grid-template-columns: auto 1fr; } .service-reporting__masthead-meta { grid-column: 1 / -1; text-align: left; } }
  @media print {
    body.service-reporting--printing .command-rail, body.service-reporting--printing .topbar, body.service-reporting--printing .service-reporting__toolbar, body.service-reporting--printing .service-reporting__custom-period, body.service-reporting--printing .service-reporting__builder, body.service-reporting--printing .workspace > .preview-notice { display: none !important; }
    body.service-reporting--printing .workspace { display: block; padding: 0 !important; }
    body.service-reporting--printing .service-reporting { display: block; color: #12212c; }
    body.service-reporting--printing .service-reporting > * { margin: 0 0 14px; }
    body.service-reporting--printing .service-reporting__summary, body.service-reporting--printing .service-reporting__grid { display: grid; }
    body.service-reporting--printing .service-reporting__summary { grid-template-columns: repeat(4, minmax(0, 1fr)); }
    body.service-reporting--printing .service-reporting__grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    body.service-reporting--printing .service-reporting__masthead, body.service-reporting--printing .service-reporting__panel, body.service-reporting--printing .service-reporting__metric { break-inside: avoid; box-shadow: none; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
    body.service-reporting--printing .service-reporting__metric { min-height: 116px; }
  }
`;

export function ServiceReporting({
  branding,
  tenantId,
}: ServiceReportingProps) {
  const headingId = useId();
  const now = new Date();
  const [period, setPeriod] = useState<ReportPeriod>("30d");
  const [startsOn, setStartsOn] = useState(() =>
    toDateInput(new Date(Date.now() - 29 * 24 * 60 * 60 * 1_000)),
  );
  const [endsOn, setEndsOn] = useState(() => toDateInput(now));
  const [report, setReport] = useState<ServiceReport | null>(null);
  const [loadState, setLoadState] = useState<ReportLoadState>("idle");
  const [builderOpen, setBuilderOpen] = useState(false);
  const [reportTitle, setReportTitle] = useState("Servicebericht");
  const [sections, setSections] = useState<Record<ReportSection, boolean>>({
    overview: true,
    quality: true,
    distribution: true,
    time: true,
  });
  const requestVersion = useRef(0);
  const reportStyle = {
    "--report-primary": branding.primaryColor,
    "--report-secondary": branding.secondaryColor,
    "--report-accent": branding.accentColor,
  } as CSSProperties;

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
        ...(period === "custom" ? { startsOn, endsOn } : {}),
      });
      const parsedReport = parseServiceReport(response);
      if (requestVersion.current !== version) return;
      setReport(parsedReport);
      setLoadState("idle");
    } catch (error) {
      if (requestVersion.current !== version) return;
      setReport(null);
      const status = errorStatus(error);
      setLoadState(
        status === 403 ? "forbidden" : status === 503 ? "unavailable" : "error",
      );
    }
  }, [endsOn, period, startsOn, tenantId]);

  useEffect(() => {
    void loadReport();
    return () => {
      requestVersion.current += 1;
    };
  }, [loadReport]);

  useEffect(() => {
    const resetPrintMode = () =>
      document.body.classList.remove("service-reporting--printing");
    window.addEventListener("afterprint", resetPrintMode);
    return () => window.removeEventListener("afterprint", resetPrintMode);
  }, []);

  function selectPeriod(nextPeriod: ReportPeriod) {
    if (nextPeriod === period) return;
    setReport(null);
    setPeriod(nextPeriod);
  }

  function printReport() {
    document.body.classList.add("service-reporting--printing");
    window.requestAnimationFrame(() => window.print());
  }

  const isLoading = loadState === "loading";
  const selected = (key: ReportSection) => sections[key];

  return (
    <section
      className="service-reporting"
      aria-busy={isLoading}
      aria-labelledby={headingId}
      style={reportStyle}
    >
      <style>{serviceReportingStyles}</style>
      <header className="service-reporting__header">
        <div>
          <p className="service-reporting__eyebrow">Servicequalität</p>
          <h1 id={headingId}>Berichte</h1>
          <p className="service-reporting__intro">
            Kennzahlen des aktuellen Mandanten mit Vergleich zur unmittelbar
            vorhergehenden Periode.
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
                aria-pressed={period === option.key}
                className="service-reporting__period-button"
                disabled={isLoading}
                key={option.key}
                onClick={() => selectPeriod(option.key)}
                type="button"
              >
                {option.label}
              </button>
            ))}
            <button
              aria-pressed={period === "custom"}
              className="service-reporting__period-button"
              disabled={isLoading}
              onClick={() => selectPeriod("custom")}
              type="button"
            >
              Eigener Zeitraum
            </button>
          </div>
          <button
            className="service-reporting__toolbar-button"
            disabled={isLoading}
            onClick={() => void loadReport()}
            type="button"
          >
            {isLoading ? "Wird geladen …" : "Aktualisieren"}
          </button>
          <button
            className="service-reporting__toolbar-button"
            disabled={isLoading}
            onClick={() => setBuilderOpen((current) => !current)}
            type="button"
          >
            {builderOpen
              ? "Zusammenstellung schliessen"
              : "Bericht zusammenstellen"}
          </button>
        </div>
      </header>

      {period === "custom" ? (
        <form
          className="service-reporting__custom-period"
          onSubmit={(event) => {
            event.preventDefault();
            void loadReport();
          }}
        >
          <label>
            Von
            <input
              aria-label="Beginn des Berichtszeitraums"
              max={endsOn}
              onChange={(event) => setStartsOn(event.target.value)}
              pattern="\\d{4}-\\d{2}-\\d{2}"
              required
              type="date"
              value={startsOn}
            />
          </label>
          <label>
            Bis
            <input
              aria-label="Ende des Berichtszeitraums"
              max={toDateInput(new Date())}
              min={startsOn}
              onChange={(event) => setEndsOn(event.target.value)}
              pattern="\\d{4}-\\d{2}-\\d{2}"
              required
              type="date"
              value={endsOn}
            />
          </label>
          <button
            className="service-reporting__toolbar-button service-reporting__toolbar-button--primary"
            disabled={
              isLoading ||
              !DATE_INPUT.test(startsOn) ||
              !DATE_INPUT.test(endsOn)
            }
            type="submit"
          >
            Zeitraum anwenden
          </button>
        </form>
      ) : null}

      {builderOpen ? (
        <section
          className="service-reporting__builder"
          aria-labelledby={`${headingId}-builder`}
        >
          <div className="service-reporting__heading">
            <div>
              <h2 id={`${headingId}-builder`}>
                Eigenen Bericht zusammenstellen
              </h2>
              <p>
                Wählen Sie Titel und Abschnitte für die aktuelle, bereits
                autorisiert geladene Auswertung.
              </p>
            </div>
            <button
              className="service-reporting__toolbar-button service-reporting__toolbar-button--primary"
              disabled={
                !report || isLoading || !Object.values(sections).some(Boolean)
              }
              onClick={printReport}
              type="button"
            >
              Drucken
            </button>
          </div>
          <div className="service-reporting__builder-grid">
            <label className="service-reporting__builder-title">
              Berichtstitel
              <input
                maxLength={100}
                onChange={(event) => setReportTitle(event.target.value)}
                value={reportTitle}
              />
            </label>
            <div
              className="service-reporting__builder-sections"
              aria-label="Abschnitte im Bericht"
            >
              {REPORT_SECTIONS.map((section) => (
                <label key={section.key}>
                  <input
                    checked={sections[section.key]}
                    onChange={(event) =>
                      setSections((current) => ({
                        ...current,
                        [section.key]: event.target.checked,
                      }))
                    }
                    type="checkbox"
                  />
                  {section.label}
                </label>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {isLoading ? (
        <section className="service-reporting__state" aria-live="polite">
          <h2>Bericht wird geladen</h2>
          <p>Die aktuellen Kennzahlen werden abgerufen.</p>
        </section>
      ) : null}
      {loadState === "forbidden" ? (
        <section className="service-reporting__state" role="alert">
          <h2>Kein Zugriff auf Berichte</h2>
          <p>
            Sie haben für diesen Mandanten keine Berechtigung, Service-Berichte
            zu lesen.
          </p>
        </section>
      ) : null}
      {loadState === "unavailable" ? (
        <section className="service-reporting__state" role="alert">
          <h2>Bericht derzeit nicht verfügbar</h2>
          <p>
            Die Reporting-Daten oder die erforderliche Berechtigung können
            momentan nicht geprüft werden.
          </p>
        </section>
      ) : null}
      {loadState === "error" ? (
        <section className="service-reporting__state" role="alert">
          <h2>Bericht konnte nicht geladen werden</h2>
          <p>
            Bitte prüfen Sie den Zeitraum oder versuchen Sie es später erneut.
          </p>
        </section>
      ) : null}

      {report && !isLoading ? (
        <>
          <section
            className="service-reporting__masthead"
            aria-label="Berichtskopf"
          >
            <img
              alt={`${branding.name ?? "nextDesk"} Logo`}
              src={branding.logoUrl}
            />
            <div className="service-reporting__masthead-copy">
              <strong>{reportTitle.trim() || "Servicebericht"}</strong>
              <p>
                {branding.name ?? "nextDesk"} ·{" "}
                {formatReportPeriod(report.period)}
              </p>
            </div>
            <div className="service-reporting__masthead-meta">
              Vergleich: {formatReportPeriod(report.comparison.period)}
              <br />
              Erstellt: {dateFormatter.format(new Date())}
            </div>
          </section>

          {selected("overview") ? (
            <section aria-label="Kennzahlenübersicht">
              <div className="service-reporting__summary">
                <SummaryMetric
                  comparison={comparisonText(
                    report.ticketVolume,
                    report.comparison.ticketVolume,
                    formatNumber,
                  )}
                  detail="Im ausgewählten Zeitraum erstellt"
                  label="Ticketvolumen"
                  value={formatNumber(report.ticketVolume)}
                />
                <SummaryMetric
                  comparison={comparisonText(
                    report.tickets.open,
                    report.comparison.tickets.open,
                    formatNumber,
                  )}
                  detail="Aus der jeweiligen Ticketkohorte"
                  label="Offene Tickets"
                  tone={report.tickets.open > 0 ? "attention" : "default"}
                  value={formatNumber(report.tickets.open)}
                />
                <SummaryMetric
                  comparison={comparisonText(
                    report.tickets.resolved,
                    report.comparison.tickets.resolved,
                    formatNumber,
                  )}
                  detail="Aus der jeweiligen Ticketkohorte"
                  label="Gelöste Tickets"
                  value={formatNumber(report.tickets.resolved)}
                />
                <SummaryMetric
                  comparison={comparisonText(
                    report.openEscalations,
                    report.comparison.openEscalations,
                    formatNumber,
                  )}
                  detail="Im ausgewählten Zeitraum eröffnet"
                  label="Offene Eskalationen"
                  tone={report.openEscalations > 0 ? "attention" : "default"}
                  value={formatNumber(report.openEscalations)}
                />
              </div>
            </section>
          ) : null}

          <div className="service-reporting__grid">
            {selected("quality") ? (
              <section
                className="service-reporting__panel"
                aria-labelledby={`${headingId}-quality`}
              >
                <div className="service-reporting__section-heading">
                  <div>
                    <h2 id={`${headingId}-quality`}>Servicequalität</h2>
                    <p className="service-reporting__detail">
                      Durchschnittswerte basieren auf Tickets mit erfasstem
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
                      <span className="service-reporting__comparison">
                        {comparisonText(
                          report.averageFirstResponseMinutes,
                          report.comparison.averageFirstResponseMinutes,
                          formatDuration,
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
                      <span className="service-reporting__comparison">
                        {comparisonText(
                          report.averageResolutionMinutes,
                          report.comparison.averageResolutionMinutes,
                          formatDuration,
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
                      <span className="service-reporting__comparison">
                        {comparisonText(
                          report.averageSatisfaction,
                          report.comparison.averageSatisfaction,
                          (value) =>
                            value === null
                              ? "Noch keine Daten"
                              : `${decimalFormatter.format(value)} von 5`,
                        )}
                      </span>
                    </dd>
                  </div>
                </dl>
              </section>
            ) : null}

            {selected("distribution") ? (
              <section
                className="service-reporting__panel"
                aria-labelledby={`${headingId}-priorities`}
              >
                <div className="service-reporting__section-heading">
                  <div>
                    <h2 id={`${headingId}-priorities`}>
                      Tickets nach Priorität
                    </h2>
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
                <div
                  className="service-reporting__section-heading"
                  style={{ marginTop: 20 }}
                >
                  <div>
                    <h2>Tickets nach Abteilung</h2>
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
            ) : null}

            {selected("time") ? (
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
                <p className="service-reporting__time-total">
                  Aktuell:{" "}
                  <strong>{formatDuration(report.timeTrackingMinutes)}</strong>{" "}
                  in{" "}
                  {formatSampleSize(
                    report.timeTrackingEntryCount,
                    "Eintrag",
                    "Einträgen",
                  )}
                  <br />
                  <span className="service-reporting__comparison">
                    {comparisonText(
                      report.timeTrackingMinutes,
                      report.comparison.timeTrackingMinutes,
                      formatDuration,
                    )}
                  </span>
                </p>
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
            ) : null}
          </div>
        </>
      ) : null}
    </section>
  );
}
