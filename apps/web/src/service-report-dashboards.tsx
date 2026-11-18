import { Frown, Meh, Smile } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { functionErrorMessage } from "./lib/function-error";
import { supabase } from "./lib/supabase";
import {
  drilldownLabel,
  drilldownPeriodLabel,
  type TicketDrilldown,
} from "./lib/ticket-drilldown";

/**
 * Drilldown into the ticket list: the open handler plus the report's own
 * team/agent filter, so the list shows the same subset as the figure.
 */
type ReportDrill = {
  open: (drilldown: TicketDrilldown) => void;
  scope: Pick<TicketDrilldown, "teamIds" | "agent">;
  scopeLabel: string;
};
const ReportDrillContext = createContext<ReportDrill | null>(null);

function useReportDrill(): ReportDrill | null {
  return useContext(ReportDrillContext);
}

function withScope(
  drill: ReportDrill,
  drilldown: TicketDrilldown,
): TicketDrilldown {
  return {
    ...drill.scope,
    ...drilldown,
    label: drilldownLabel(drilldown.label, drill.scopeLabel),
  };
}

export type PredefinedReportKey =
  "trends" | "overview" | "satisfaction" | "agents" | "themes" | "requesters";

export const PREDEFINED_REPORTS: readonly {
  key: PredefinedReportKey;
  label: string;
  description: string;
}[] = [
  {
    key: "trends",
    label: "Servicedesk-Trends",
    description:
      "Erhaltene, gelöste und offene Tickets pro Tag sowie Eingang nach Tageszeit und Kanal.",
  },
  {
    key: "overview",
    label: "Servicedesk-Übersicht",
    description:
      "Kernkennzahlen mit SLA-Einhaltung, Lösungszeiten und Vergleich zur Vorperiode.",
  },
  {
    key: "satisfaction",
    label: "Mitarbeiterzufriedenheit",
    description:
      "Bewertungen der Anfragenden, Verlauf pro Woche und Verteilung nach Team.",
  },
  {
    key: "agents",
    label: "Agentenleistung",
    description:
      "SLA-Einhaltung, Bearbeitungszeiten und Zufriedenheit pro Agent.",
  },
  {
    key: "themes",
    label: "Top-Themen",
    description:
      "Häufigste Kategorien und Stichworte im Vergleich zur Vorperiode – Hinweise auf fehlende Wissensartikel oder Automatisierungen.",
  },
  {
    key: "requesters",
    label: "Anfragende Abteilungen",
    description:
      "Tickets pro anfragender Abteilung mit Vorperiode, offenen Tickets und Lösungszeit.",
  },
];

type Period = "7d" | "30d" | "90d" | "custom";

type Aggregate = {
  received: number;
  resolved: number;
  unresolved: number;
  firstContactResolutionRate: number | null;
  resolutionSlaCompliance: number | null;
  averageResolutionMinutes: number | null;
  firstResponseSlaCompliance: number | null;
  averageFirstResponseMinutes: number | null;
  averageReactionMinutes: number | null;
};
type MoodShares = {
  responses: number;
  happy: number;
  neutral: number;
  unhappy: number;
  happyPercent: number | null;
  neutralPercent: number | null;
  unhappyPercent: number | null;
};
type AgentRow = {
  id: string | null;
  name: string | null;
  resolved: number;
  resolutionSlaCompliance: number | null;
  firstResponseSlaCompliance: number | null;
  firstContactResolutionRate: number | null;
  averageResolutionMinutes: number | null;
  averageFirstResponseMinutes: number | null;
  averageReactionMinutes: number | null;
  responses: number;
  happyPercent: number | null;
  neutralPercent: number | null;
  unhappyPercent: number | null;
};
type Insights = {
  period: { startsAt: string; endsAt: string };
  comparisonPeriod: { startsAt: string; endsAt: string };
  filters: {
    teams: { id: string; name: string }[];
    agents: { id: string; name: string }[];
  };
  trends: {
    daily: {
      date: string;
      received: number;
      resolved: number;
      unresolved: number;
    }[];
    byHour: ({ hour: number } & Record<string, number>)[];
  };
  overview: { current: Aggregate; previous: Aggregate };
  satisfaction: MoodShares & {
    surveysSent: number;
    previousSurveysSent: number;
    previousResponses: number;
    weekly: (MoodShares & { weekStart: string })[];
    byTeam: (MoodShares & { id: string | null; name: string | null })[];
  };
  agents: { rows: AgentRow[]; total: AgentRow };
  themes?: {
    total: number;
    previousTotal: number;
    categories: ThemeRow[];
    keywords: ThemeRow[];
  };
  requesterDepartments?: {
    name: string;
    received: number;
    previous: number;
    resolved: number;
    open: number;
    averageResolutionMinutes: number | null;
  }[];
};
type ThemeRow = {
  name: string;
  count: number;
  previous: number;
  share: number;
};

const SOURCE_LABELS: Record<string, string> = {
  email: "E-Mail",
  portal: "Portal",
  phone: "Telefon",
  api: "API",
  automation: "Automation",
};
// Theme tokens (status-tokens.css) so the charts follow brand and dark mode.
const COLORS = {
  received: "var(--chart-2)",
  resolved: "var(--chart-3)",
  unresolved: "var(--chart-4)",
  happy: "var(--chart-3)",
  neutral: "var(--chart-4)",
  unhappy: "var(--chart-6)",
  email: "var(--chart-8)",
  portal: "var(--chart-2)",
  phone: "var(--chart-5)",
  api: "var(--chart-label)",
  automation: "var(--chart-7)",
};
const numberFormat = new Intl.NumberFormat("de-CH");
const percentFormat = new Intl.NumberFormat("de-CH", {
  maximumFractionDigits: 2,
});
const shortDate = new Intl.DateTimeFormat("de-CH", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "UTC",
});
const longDate = new Intl.DateTimeFormat("de-CH", {
  dateStyle: "medium",
  timeZone: "Europe/Zurich",
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseInsights(value: unknown): Insights {
  const data = isRecord(value) && isRecord(value.data) ? value.data : null;
  if (
    !data ||
    !isRecord(data.trends) ||
    !Array.isArray(data.trends.daily) ||
    !isRecord(data.overview) ||
    !isRecord(data.satisfaction) ||
    !isRecord(data.agents) ||
    !Array.isArray(data.agents.rows) ||
    !isRecord(data.filters)
  ) {
    throw new Error("Die Berichtsantwort ist unvollständig.");
  }
  return data as unknown as Insights;
}

export function formatCompactDuration(minutes: number | null): string {
  if (minutes === null) return "–";
  const total = Math.round(minutes);
  const days = Math.floor(total / 1_440);
  const hours = Math.floor((total % 1_440) / 60);
  const rest = total % 60;
  const parts: string[] = [];
  if (days) parts.push(`${days} T`);
  if (hours) parts.push(`${hours} Std.`);
  if (rest || parts.length === 0) parts.push(`${rest} Min.`);
  return parts.join(" ");
}

function formatPercent(value: number | null): string {
  return value === null ? "–" : `${percentFormat.format(value)} %`;
}

function formatDay(date: string): string {
  return shortDate.format(new Date(`${date}T00:00:00Z`));
}

/** Relative change, or percentage points for rates. */
function delta(
  current: number | null,
  previous: number | null,
  kind: "relative" | "points",
): { text: string; direction: "up" | "down" | "flat" } | null {
  if (current === null || previous === null) return null;
  if (kind === "points") {
    const diff = Math.round((current - previous) * 100) / 100;
    if (diff === 0) return { text: "±0 Pp.", direction: "flat" };
    return {
      text: `${percentFormat.format(Math.abs(diff))} Pp.`,
      direction: diff > 0 ? "up" : "down",
    };
  }
  if (previous === 0) return null;
  const change = Math.round(((current - previous) / previous) * 10_000) / 100;
  if (change === 0) return { text: "±0 %", direction: "flat" };
  return {
    text: `${percentFormat.format(Math.abs(change))} %`,
    direction: change > 0 ? "up" : "down",
  };
}

function Delta({
  current,
  previous,
  kind,
  higherIsBetter,
}: {
  current: number | null;
  previous: number | null;
  kind: "relative" | "points";
  higherIsBetter: boolean;
}) {
  const change = delta(current, previous, kind);
  if (!change) return null;
  const good =
    change.direction === "flat"
      ? null
      : (change.direction === "up") === higherIsBetter;
  return (
    <span
      className={`predefined-report__delta predefined-report__delta--${good === null ? "flat" : good ? "good" : "bad"}`}
      title="Veränderung zur Vorperiode"
    >
      {change.direction === "up"
        ? "▲"
        : change.direction === "down"
          ? "▼"
          : "■"}{" "}
      {change.text}
    </span>
  );
}

type Series = { label: string; color: string; values: number[] };

function LineChart({
  labels,
  series,
  yLabel,
}: {
  labels: string[];
  series: Series[];
  yLabel?: string;
}) {
  const width = 900;
  const height = 260;
  const pad = { top: 18, right: 14, bottom: 52, left: 40 };
  const max = Math.max(1, ...series.flatMap((entry) => entry.values));
  const niceMax = max <= 4 ? 4 : Math.ceil(max / 4) * 4;
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const x = (index: number) =>
    pad.left +
    (labels.length <= 1 ? innerW / 2 : (index / (labels.length - 1)) * innerW);
  const y = (value: number) => pad.top + innerH - (value / niceMax) * innerH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((share) =>
    Math.round(niceMax * share),
  );
  const labelEvery = Math.max(1, Math.ceil(labels.length / 16));
  const showValues = labels.length <= 40;

  return (
    <figure className="predefined-report__chart">
      <svg
        role="img"
        aria-label={series.map((entry) => entry.label).join(", ")}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              className="predefined-report__grid-line"
              x1={pad.left}
              x2={width - pad.right}
              y1={y(tick)}
              y2={y(tick)}
            />
            <text
              className="predefined-report__axis"
              x={pad.left - 8}
              y={y(tick) + 4}
              textAnchor="end"
            >
              {tick}
            </text>
          </g>
        ))}
        {yLabel ? (
          <text
            className="predefined-report__axis"
            transform={`translate(11 ${pad.top + innerH / 2}) rotate(-90)`}
            textAnchor="middle"
          >
            {yLabel}
          </text>
        ) : null}
        {labels.map((label, index) =>
          index % labelEvery === 0 || index === labels.length - 1 ? (
            <text
              className="predefined-report__axis"
              key={`${label}-${index}`}
              textAnchor="end"
              transform={`translate(${x(index) + 4} ${height - pad.bottom + 14}) rotate(-40)`}
            >
              {label}
            </text>
          ) : null,
        )}
        {series.map((entry) => (
          <g key={entry.label}>
            <polyline
              fill="none"
              points={entry.values
                .map((value, index) => `${x(index)},${y(value)}`)
                .join(" ")}
              style={{ stroke: entry.color }}
              strokeLinejoin="round"
              strokeWidth={2.2}
            />
            {entry.values.map((value, index) => (
              <g key={index}>
                <circle
                  cx={x(index)}
                  cy={y(value)}
                  r={3}
                  style={{ fill: entry.color }}
                >
                  <title>{`${labels[index]} · ${entry.label}: ${value}`}</title>
                </circle>
                {showValues && value > 0 ? (
                  <text
                    className="predefined-report__point-label"
                    textAnchor="middle"
                    x={x(index)}
                    y={y(value) - 7}
                  >
                    {value}
                  </text>
                ) : null}
              </g>
            ))}
          </g>
        ))}
      </svg>
      <Legend items={series.map(({ label, color }) => ({ label, color }))} />
    </figure>
  );
}

function StackedBars({
  labels,
  series,
}: {
  labels: string[];
  series: Series[];
}) {
  const width = 900;
  const height = 240;
  const pad = { top: 16, right: 14, bottom: 40, left: 40 };
  const totals = labels.map((_, index) =>
    series.reduce((sum, entry) => sum + (entry.values[index] ?? 0), 0),
  );
  const max = Math.max(1, ...totals);
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const slot = innerW / Math.max(1, labels.length);
  const barW = Math.min(140, slot * 0.6);
  return (
    <figure className="predefined-report__chart">
      <svg
        role="img"
        aria-label="Balkendiagramm"
        viewBox={`0 0 ${width} ${height}`}
      >
        {[0, 0.5, 1].map((share) => {
          const value = Math.round(max * share);
          const yPos = pad.top + innerH - (value / max) * innerH;
          return (
            <g key={share}>
              <line
                className="predefined-report__grid-line"
                x1={pad.left}
                x2={width - pad.right}
                y1={yPos}
                y2={yPos}
              />
              <text
                className="predefined-report__axis"
                textAnchor="end"
                x={pad.left - 8}
                y={yPos + 4}
              >
                {value}
              </text>
            </g>
          );
        })}
        {labels.map((label, index) => {
          let offset = 0;
          const xPos = pad.left + slot * index + (slot - barW) / 2;
          return (
            <g key={label}>
              {series.map((entry) => {
                const value = entry.values[index] ?? 0;
                const barH = (value / max) * innerH;
                offset += barH;
                return value > 0 ? (
                  <rect
                    style={{ fill: entry.color }}
                    height={barH}
                    key={entry.label}
                    width={barW}
                    x={xPos}
                    y={pad.top + innerH - offset}
                  >
                    <title>{`${label} · ${entry.label}: ${value}`}</title>
                  </rect>
                ) : null;
              })}
              <text
                className="predefined-report__axis"
                textAnchor="middle"
                x={xPos + barW / 2}
                y={height - pad.bottom + 18}
              >
                {label}
              </text>
            </g>
          );
        })}
      </svg>
      <Legend items={series.map(({ label, color }) => ({ label, color }))} />
    </figure>
  );
}

function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <figcaption className="predefined-report__legend">
      {items.map((item) => (
        <span key={item.label}>
          <i style={{ background: item.color }} />
          {item.label}
        </span>
      ))}
    </figcaption>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="predefined-report__panel">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function Kpi({
  label,
  value,
  current,
  previous,
  kind = "relative",
  higherIsBetter = true,
  drilldown,
}: {
  label: string;
  value: string;
  current?: number | null;
  previous?: number | null;
  kind?: "relative" | "points";
  higherIsBetter?: boolean;
  drilldown?: TicketDrilldown | undefined;
}) {
  const drill = useReportDrill();
  return (
    <article className="predefined-report__kpi">
      <p>{label}</p>
      {drill && drilldown ? (
        <button
          aria-label={`${label}: ${value} – Tickets anzeigen`}
          className="predefined-report__drill"
          onClick={() => drill.open(withScope(drill, drilldown))}
          type="button"
        >
          <strong>{value}</strong>
        </button>
      ) : (
        <strong>{value}</strong>
      )}
      {current !== undefined && previous !== undefined ? (
        <Delta
          current={current}
          kind={kind}
          previous={previous}
          higherIsBetter={higherIsBetter}
        />
      ) : null}
    </article>
  );
}

function TrendsReport({ insights }: { insights: Insights }) {
  const daily = insights.trends.daily;
  const sources = Object.keys(SOURCE_LABELS).filter((source) =>
    insights.trends.byHour.some((hour) => (hour[source] ?? 0) > 0),
  );
  return (
    <>
      <Panel title="Tickets erhalten vs. gelöst vs. nicht gelöst">
        {daily.length === 0 ? (
          <p className="predefined-report__empty">Noch keine Daten</p>
        ) : (
          <LineChart
            labels={daily.map((day) => formatDay(day.date))}
            series={[
              {
                label: "Erhaltene Tickets",
                color: COLORS.received,
                values: daily.map((day) => day.received),
              },
              {
                label: "Gelöste Tickets",
                color: COLORS.resolved,
                values: daily.map((day) => day.resolved),
              },
              {
                label: "Nicht gelöste Tickets",
                color: COLORS.unresolved,
                values: daily.map((day) => day.unresolved),
              },
            ]}
          />
        )}
      </Panel>
      <Panel title="Tickets nach Zeitpunkt der Erstellung (Tageszeit, Kanal)">
        {sources.length === 0 ? (
          <p className="predefined-report__empty">Noch keine Daten</p>
        ) : (
          <LineChart
            labels={insights.trends.byHour.map(
              (hour) => `${String(hour.hour).padStart(2, "0")}:00`,
            )}
            series={sources.map((source) => ({
              label: SOURCE_LABELS[source] ?? source,
              color: COLORS[source as keyof typeof COLORS] ?? "#64748b",
              values: insights.trends.byHour.map((hour) => hour[source] ?? 0),
            }))}
            yLabel="Erhaltene Tickets"
          />
        )}
      </Panel>
    </>
  );
}

function OverviewReport({ insights }: { insights: Insights }) {
  const { current, previous } = insights.overview;
  const { startsAt, endsAt } = insights.period;
  const period = drilldownPeriodLabel(startsAt, endsAt);
  return (
    <div className="predefined-report__kpis">
      <Kpi
        label="Erhaltene Tickets"
        value={numberFormat.format(current.received)}
        current={current.received}
        previous={previous.received}
        drilldown={{
          label: drilldownLabel("Erhalten", period),
          createdFrom: startsAt,
          createdTo: endsAt,
        }}
      />
      <Kpi
        label="Nicht gelöste Tickets"
        value={numberFormat.format(current.unresolved)}
        current={current.unresolved}
        previous={previous.unresolved}
        higherIsBetter={false}
        drilldown={{
          label: drilldownLabel("Nicht gelöst", period),
          statusClosed: false,
          createdTo: endsAt,
        }}
      />
      <Kpi
        label="Gelöste Tickets"
        value={numberFormat.format(current.resolved)}
        current={current.resolved}
        previous={previous.resolved}
        drilldown={{
          label: drilldownLabel("Gelöst", period),
          resolvedFrom: startsAt,
          resolvedTo: endsAt,
        }}
      />
      <Kpi
        label="Erstkontakt-Lösungsrate"
        value={formatPercent(current.firstContactResolutionRate)}
        current={current.firstContactResolutionRate}
        previous={previous.firstContactResolutionRate}
        kind="points"
      />
      <Kpi
        label="Lösungs-SLA-Einhaltung"
        value={formatPercent(current.resolutionSlaCompliance)}
        current={current.resolutionSlaCompliance}
        previous={previous.resolutionSlaCompliance}
        kind="points"
        drilldown={{
          label: drilldownLabel("Lösungs-SLA verletzt", period),
          resolvedFrom: startsAt,
          resolvedTo: endsAt,
          slaBreached: true,
        }}
      />
      <Kpi
        label="Durchschnittliche Lösungszeit"
        value={formatCompactDuration(current.averageResolutionMinutes)}
        current={current.averageResolutionMinutes}
        previous={previous.averageResolutionMinutes}
        higherIsBetter={false}
      />
      <Kpi
        label="Erstantwort-SLA-Einhaltung"
        value={formatPercent(current.firstResponseSlaCompliance)}
        current={current.firstResponseSlaCompliance}
        previous={previous.firstResponseSlaCompliance}
        kind="points"
      />
      <Kpi
        label="Durchschnittliche Erstantwortzeit"
        value={formatCompactDuration(current.averageFirstResponseMinutes)}
        current={current.averageFirstResponseMinutes}
        previous={previous.averageFirstResponseMinutes}
        higherIsBetter={false}
      />
    </div>
  );
}

function SatisfactionReport({ insights }: { insights: Insights }) {
  const satisfaction = insights.satisfaction;
  const moods = [
    {
      key: "happy",
      label: "Zufrieden",
      Icon: Smile,
      value: satisfaction.happyPercent,
    },
    {
      key: "neutral",
      label: "Neutral",
      Icon: Meh,
      value: satisfaction.neutralPercent,
    },
    {
      key: "unhappy",
      label: "Unzufrieden",
      Icon: Frown,
      value: satisfaction.unhappyPercent,
    },
  ] as const;
  return (
    <>
      <div className="predefined-report__grid">
        <Panel title="Mitarbeiterzufriedenheit">
          <div className="predefined-report__moods">
            {moods.map((entry) => (
              <div key={entry.key}>
                <span
                  aria-hidden="true"
                  className="predefined-report__mood-icon"
                >
                  <entry.Icon aria-hidden="true" size={28} />
                </span>
                <strong>{formatPercent(entry.value)}</strong>
                <small>{entry.label}</small>
              </div>
            ))}
          </div>
          <p className="predefined-report__note">
            {numberFormat.format(satisfaction.responses)} erhaltene Antworten
          </p>
        </Panel>
        <Panel title="Gelöste Tickets vs. erhaltene Bewertungen">
          <div className="predefined-report__kpis predefined-report__kpis--two">
            <Kpi
              label="Gelöste Tickets (Bewertung möglich)"
              value={numberFormat.format(satisfaction.surveysSent)}
              current={satisfaction.surveysSent}
              previous={satisfaction.previousSurveysSent}
            />
            <Kpi
              label="Erhaltene Bewertungen"
              value={numberFormat.format(satisfaction.responses)}
              current={satisfaction.responses}
              previous={satisfaction.previousResponses}
            />
          </div>
        </Panel>
      </div>
      <Panel title="Zufriedenheit – Verlauf pro Woche (Wochenbeginn)">
        {satisfaction.weekly.length === 0 ? (
          <p className="predefined-report__empty">Noch keine Bewertungen</p>
        ) : (
          <LineChart
            labels={satisfaction.weekly.map((week) =>
              formatDay(week.weekStart),
            )}
            series={[
              {
                label: "Zufrieden",
                color: COLORS.happy,
                values: satisfaction.weekly.map((week) => week.happy),
              },
              {
                label: "Neutral",
                color: COLORS.neutral,
                values: satisfaction.weekly.map((week) => week.neutral),
              },
              {
                label: "Unzufrieden",
                color: COLORS.unhappy,
                values: satisfaction.weekly.map((week) => week.unhappy),
              },
            ]}
          />
        )}
      </Panel>
      <Panel title="Zufriedenheit nach Team">
        {satisfaction.byTeam.length === 0 ? (
          <p className="predefined-report__empty">Noch keine Bewertungen</p>
        ) : (
          <StackedBars
            labels={satisfaction.byTeam.map((team) => team.name ?? "Ohne Team")}
            series={[
              {
                label: "Unzufrieden",
                color: COLORS.unhappy,
                values: satisfaction.byTeam.map((team) => team.unhappy),
              },
              {
                label: "Neutral",
                color: COLORS.neutral,
                values: satisfaction.byTeam.map((team) => team.neutral),
              },
              {
                label: "Zufrieden",
                color: COLORS.happy,
                values: satisfaction.byTeam.map((team) => team.happy),
              },
            ]}
          />
        )}
      </Panel>
    </>
  );
}

type AgentTab = "compliance" | "tat" | "esat";
const AGENT_TABS: { key: AgentTab; label: string; title: string }[] = [
  { key: "compliance", label: "SLA-Einhaltung", title: "SLA-Einhaltung" },
  { key: "tat", label: "Bearbeitungszeit", title: "Bearbeitungszeit" },
  { key: "esat", label: "Zufriedenheit", title: "Mitarbeiterzufriedenheit" },
];

function AgentTable({ insights, tab }: { insights: Insights; tab: AgentTab }) {
  const drill = useReportDrill();
  const { startsAt, endsAt } = insights.period;
  const rows = [...insights.agents.rows, insights.agents.total];
  const columns: { label: string; value: (row: AgentRow) => string }[] =
    tab === "compliance"
      ? [
          {
            label: "Lösungs-SLA-Einhaltung",
            value: (row) => formatPercent(row.resolutionSlaCompliance),
          },
          {
            label: "Erstantwort-SLA-Einhaltung",
            value: (row) => formatPercent(row.firstResponseSlaCompliance),
          },
          {
            label: "Erstkontakt-Lösungsrate",
            value: (row) => formatPercent(row.firstContactResolutionRate),
          },
        ]
      : tab === "tat"
        ? [
            {
              label: "Durchschnittliche Lösungszeit",
              value: (row) =>
                formatCompactDuration(row.averageResolutionMinutes),
            },
            {
              label: "Durchschnittliche Erstantwortzeit",
              value: (row) =>
                formatCompactDuration(row.averageFirstResponseMinutes),
            },
            {
              label: "Durchschnittliche Reaktionszeit",
              value: (row) => formatCompactDuration(row.averageReactionMinutes),
            },
          ]
        : [
            {
              label: "Zufrieden",
              value: (row) => formatPercent(row.happyPercent),
            },
            {
              label: "Neutral",
              value: (row) => formatPercent(row.neutralPercent),
            },
            {
              label: "Unzufrieden",
              value: (row) => formatPercent(row.unhappyPercent),
            },
          ];
  const visibleRows =
    tab === "esat"
      ? rows.filter((row) => row.responses > 0 || row === insights.agents.total)
      : rows;
  return (
    <div className="predefined-report__table-wrap">
      <table className="predefined-report__table">
        <thead>
          <tr>
            <th scope="col">Name des Agenten</th>
            {columns.map((column) => (
              <th key={column.label} scope="col">
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((row) => (
            <tr
              className={
                row === insights.agents.total
                  ? "predefined-report__total"
                  : undefined
              }
              key={
                row === insights.agents.total
                  ? "total"
                  : (row.id ?? "unassigned")
              }
            >
              <th scope="row">
                {drill && row !== insights.agents.total && row.resolved > 0 ? (
                  <button
                    aria-label={`Gelöste Tickets von ${row.name ?? "nicht zugewiesen"} anzeigen`}
                    className="predefined-report__drill predefined-report__drill--inline"
                    onClick={() =>
                      drill.open(
                        withScope(drill, {
                          label: drilldownLabel(
                            `Gelöst von ${row.name ?? "nicht zugewiesen"}`,
                            drilldownPeriodLabel(startsAt, endsAt),
                          ),
                          agent: row.id ?? "unassigned",
                          resolvedFrom: startsAt,
                          resolvedTo: endsAt,
                        }),
                      )
                    }
                    type="button"
                  >
                    {row.name ?? "Nicht zugewiesen"}
                  </button>
                ) : (
                  (row.name ?? "Nicht zugewiesen")
                )}
              </th>
              {columns.map((column) => (
                <td key={column.label}>{column.value(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AgentsReport({
  insights,
  printing,
}: {
  insights: Insights;
  printing: boolean;
}) {
  const [tab, setTab] = useState<AgentTab>("compliance");
  if (printing) {
    return (
      <>
        {AGENT_TABS.map((entry) => (
          <Panel key={entry.key} title={entry.title}>
            <AgentTable insights={insights} tab={entry.key} />
          </Panel>
        ))}
      </>
    );
  }
  return (
    <Panel title={AGENT_TABS.find((entry) => entry.key === tab)!.title}>
      <div
        className="predefined-report__tabs"
        role="tablist"
        aria-label="Agentenleistung"
      >
        {AGENT_TABS.map((entry) => (
          <button
            aria-selected={tab === entry.key}
            key={entry.key}
            onClick={() => setTab(entry.key)}
            role="tab"
            type="button"
          >
            {entry.label}
          </button>
        ))}
      </div>
      <AgentTable insights={insights} tab={tab} />
    </Panel>
  );
}

function ChangeBadge({
  current,
  previous,
  higherIsWorse = true,
}: {
  current: number;
  previous: number;
  higherIsWorse?: boolean;
}) {
  if (previous === 0 && current === 0) return null;
  if (previous === 0)
    return (
      <span className="predefined-report__delta predefined-report__delta--flat">
        neu
      </span>
    );
  return (
    <Delta
      current={current}
      higherIsBetter={!higherIsWorse}
      kind="relative"
      previous={previous}
    />
  );
}

function ThemeTable({ rows, label }: { rows: ThemeRow[]; label: string }) {
  if (!rows.length)
    return <p className="predefined-report__empty">Keine Daten im Zeitraum.</p>;
  const max = Math.max(...rows.map((row) => row.count), 1);
  return (
    <div className="predefined-report__table-wrap">
      <table className="predefined-report__table predefined-report__themes">
        <thead>
          <tr>
            <th scope="col">{label}</th>
            <th scope="col">Tickets</th>
            <th scope="col">Anteil</th>
            <th scope="col">Vorperiode</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.name}>
              <th scope="row">
                <span className="predefined-report__theme-name">
                  {row.name}
                </span>
                <span
                  aria-hidden="true"
                  className="predefined-report__theme-bar"
                  style={{ width: `${Math.round((row.count / max) * 100)}%` }}
                />
              </th>
              <td>{numberFormat.format(row.count)}</td>
              <td>{formatPercent(row.share)}</td>
              <td>
                {numberFormat.format(row.previous)}{" "}
                <ChangeBadge current={row.count} previous={row.previous} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ThemesReport({ insights }: { insights: Insights }) {
  const themes = insights.themes;
  if (!themes)
    return (
      <p className="predefined-report__empty">
        Dieser Bericht ist nach dem nächsten Update verfügbar.
      </p>
    );
  return (
    <>
      <div className="predefined-report__kpis">
        <Kpi
          current={themes.total}
          higherIsBetter={false}
          label="Tickets im Zeitraum"
          previous={themes.previousTotal}
          value={numberFormat.format(themes.total)}
        />
        <Kpi
          label="Häufigste Kategorie"
          value={themes.categories[0]?.name ?? "–"}
        />
        <Kpi
          label="Häufigstes Stichwort"
          value={themes.keywords[0]?.name ?? "–"}
        />
      </div>
      <Panel title="Top-Kategorien">
        <ThemeTable label="Kategorie" rows={themes.categories} />
      </Panel>
      <Panel title="Häufige Stichworte im Betreff">
        <ThemeTable label="Stichwort" rows={themes.keywords} />
        <p className="predefined-report__note">
          Wiederkehrende Stichworte sind gute Kandidaten für einen
          Wissensartikel, eine Ticketvorlage oder eine Regel im Regel-Baukasten.
        </p>
      </Panel>
    </>
  );
}

function RequesterDepartmentsReport({ insights }: { insights: Insights }) {
  const rows = insights.requesterDepartments;
  if (!rows)
    return (
      <p className="predefined-report__empty">
        Dieser Bericht ist nach dem nächsten Update verfügbar.
      </p>
    );
  if (!rows.length)
    return <p className="predefined-report__empty">Keine Daten im Zeitraum.</p>;
  const max = Math.max(...rows.map((row) => row.received), 1);
  return (
    <Panel title="Tickets pro anfragender Abteilung">
      <div className="predefined-report__table-wrap">
        <table className="predefined-report__table predefined-report__themes">
          <thead>
            <tr>
              <th scope="col">Abteilung</th>
              <th scope="col">Erhalten</th>
              <th scope="col">Vorperiode</th>
              <th scope="col">Gelöst</th>
              <th scope="col">Offen</th>
              <th scope="col">Ø Lösungszeit</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.name}>
                <th scope="row">
                  <span className="predefined-report__theme-name">
                    {row.name}
                  </span>
                  <span
                    aria-hidden="true"
                    className="predefined-report__theme-bar"
                    style={{
                      width: `${Math.round((row.received / max) * 100)}%`,
                    }}
                  />
                </th>
                <td>{numberFormat.format(row.received)}</td>
                <td>
                  {numberFormat.format(row.previous)}{" "}
                  <ChangeBadge current={row.received} previous={row.previous} />
                </td>
                <td>{numberFormat.format(row.resolved)}</td>
                <td>{numberFormat.format(row.open)}</td>
                <td>{formatCompactDuration(row.averageResolutionMinutes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="predefined-report__note">
        Die Abteilung stammt aus dem Profil der anfragenden Person (z. B. aus
        Entra ID). Tickets ohne diese Angabe erscheinen unter «Ohne Abteilung».
      </p>
    </Panel>
  );
}

export function ReportBody({
  report,
  insights,
  printing,
}: {
  report: PredefinedReportKey;
  insights: Insights;
  printing: boolean;
}) {
  if (report === "trends") return <TrendsReport insights={insights} />;
  if (report === "overview") return <OverviewReport insights={insights} />;
  if (report === "satisfaction")
    return <SatisfactionReport insights={insights} />;
  if (report === "themes") return <ThemesReport insights={insights} />;
  if (report === "requesters")
    return <RequesterDepartmentsReport insights={insights} />;
  return <AgentsReport insights={insights} printing={printing} />;
}

export type PredefinedReportsProps = {
  /** Drilldown into the filtered ticket list. */
  onOpenTicketList?: ((drilldown: TicketDrilldown) => void) | undefined;
  tenantId: string;
  report: PredefinedReportKey;
  period: Period;
  startsOn: string;
  endsOn: string;
  refreshKey: number;
  branding: { logoUrl: string; name: string | null };
};

export function PredefinedReports({
  onOpenTicketList,
  tenantId,
  report,
  period,
  startsOn,
  endsOn,
  refreshKey,
  branding,
}: PredefinedReportsProps) {
  const [teamId, setTeamId] = useState("");
  const [agentId, setAgentId] = useState("");
  const [insights, setInsights] = useState<Insights | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [pdfOpen, setPdfOpen] = useState(false);
  const [pdfSelection, setPdfSelection] = useState<
    Record<PredefinedReportKey, boolean>
  >({
    trends: false,
    overview: false,
    satisfaction: false,
    agents: false,
    themes: false,
    requesters: false,
  });
  const [printReports, setPrintReports] = useState<
    PredefinedReportKey[] | null
  >(null);
  const version = useRef(0);

  const load = useCallback(async () => {
    const current = ++version.current;
    setLoading(true);
    setError("");
    try {
      if (!supabase)
        throw new Error("Die Verbindung zu Supabase ist nicht konfiguriert.");
      const { data, error: invokeError } =
        await supabase.functions.invoke<unknown>("service-reporting", {
          body: {
            type: "getInsights",
            tenantId,
            period,
            ...(period === "custom" ? { startsOn, endsOn } : {}),
            ...(teamId ? { teamId } : {}),
            ...(agentId ? { agentId } : {}),
          },
        });
      if (invokeError) {
        throw new Error(
          await functionErrorMessage(
            invokeError,
            "Der Bericht konnte nicht geladen werden.",
          ),
        );
      }
      const parsed = parseInsights(data);
      if (version.current === current) setInsights(parsed);
    } catch (nextError) {
      if (version.current !== current) return;
      setInsights(null);
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Der Bericht konnte nicht geladen werden.",
      );
    } finally {
      if (version.current === current) setLoading(false);
    }
    // refreshKey re-runs the query when the parent asks for a refresh.
  }, [agentId, endsOn, period, refreshKey, startsOn, teamId, tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const reset = () => {
      document.body.classList.remove("predefined-report--printing");
      setPrintReports(null);
    };
    window.addEventListener("afterprint", reset);
    return () => window.removeEventListener("afterprint", reset);
  }, []);

  useEffect(() => {
    if (!printReports) return;
    document.body.classList.add("predefined-report--printing");
    const frame = window.requestAnimationFrame(() => window.print());
    return () => window.cancelAnimationFrame(frame);
  }, [printReports]);

  function openPdf() {
    setPdfSelection({
      trends: report === "trends",
      overview: report === "overview",
      satisfaction: report === "satisfaction",
      agents: report === "agents",
      themes: report === "themes",
      requesters: report === "requesters",
    });
    setPdfOpen(true);
  }

  function exportPdf() {
    const selected = PREDEFINED_REPORTS.map((entry) => entry.key).filter(
      (key) => pdfSelection[key],
    );
    if (!selected.length) return;
    setPdfOpen(false);
    setPrintReports(selected);
  }

  const filterText = [
    teamId
      ? `Team: ${insights?.filters.teams.find((team) => team.id === teamId)?.name ?? "–"}`
      : null,
    agentId
      ? `Agent: ${insights?.filters.agents.find((agent) => agent.id === agentId)?.name ?? "–"}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const shownReports = printReports ?? [report];
  const meta = PREDEFINED_REPORTS.find((entry) => entry.key === report)!;

  return (
    <div className="predefined-report">
      <style>{predefinedReportStyles}</style>
      <div className="predefined-report__controls">
        <p className="predefined-report__description">{meta.description}</p>
        <label>
          Team
          <select
            onChange={(event) => setTeamId(event.target.value)}
            value={teamId}
          >
            <option value="">Alle Teams</option>
            {(insights?.filters.teams ?? []).map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Agent
          <select
            onChange={(event) => setAgentId(event.target.value)}
            value={agentId}
          >
            <option value="">Alle Agenten</option>
            {(insights?.filters.agents ?? []).map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
        </label>
        <button
          className="predefined-report__button predefined-report__button--primary"
          disabled={!insights || loading}
          onClick={openPdf}
          type="button"
        >
          Als PDF exportieren
        </button>
      </div>

      {pdfOpen ? (
        <section className="predefined-report__pdf" aria-label="PDF-Export">
          <div>
            <h3>Bericht als PDF exportieren</h3>
            <p>
              Wähle die Berichte für das PDF. Im Druckdialog des Browsers «Als
              PDF speichern» wählen. Zeitraum und Filter werden übernommen.
            </p>
          </div>
          <div className="predefined-report__pdf-options">
            {PREDEFINED_REPORTS.map((entry) => (
              <label key={entry.key}>
                <input
                  checked={pdfSelection[entry.key]}
                  onChange={(event) =>
                    setPdfSelection((current) => ({
                      ...current,
                      [entry.key]: event.target.checked,
                    }))
                  }
                  type="checkbox"
                />
                {entry.label}
              </label>
            ))}
          </div>
          <div className="predefined-report__pdf-actions">
            <button
              className="predefined-report__button"
              onClick={() => setPdfOpen(false)}
              type="button"
            >
              Abbrechen
            </button>
            <button
              className="predefined-report__button predefined-report__button--primary"
              disabled={!Object.values(pdfSelection).some(Boolean)}
              onClick={exportPdf}
              type="button"
            >
              PDF erstellen
            </button>
          </div>
        </section>
      ) : null}

      {loading ? (
        <p className="predefined-report__state" aria-live="polite">
          Bericht wird geladen …
        </p>
      ) : null}
      {error ? (
        <p
          className="predefined-report__state predefined-report__state--error"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      {insights && !loading
        ? shownReports.map((key, index) => (
            <section
              className={`predefined-report__page${index > 0 ? " predefined-report__page--break" : ""}`}
              key={key}
            >
              <header className="predefined-report__masthead">
                <img alt="" src={branding.logoUrl} />
                <div>
                  <strong>
                    {
                      PREDEFINED_REPORTS.find((entry) => entry.key === key)!
                        .label
                    }
                  </strong>
                  <p>
                    {branding.name ?? "nextDesk"} ·{" "}
                    {longDate.format(new Date(insights.period.startsAt))} –{" "}
                    {longDate.format(new Date(insights.period.endsAt))}
                    {filterText ? ` · ${filterText}` : ""}
                  </p>
                </div>
                <small>
                  Vergleich:{" "}
                  {longDate.format(
                    new Date(insights.comparisonPeriod.startsAt),
                  )}{" "}
                  –{" "}
                  {longDate.format(new Date(insights.comparisonPeriod.endsAt))}
                  <br />
                  Erstellt: {longDate.format(new Date())}
                </small>
              </header>
              <ReportDrillContext.Provider
                value={
                  onOpenTicketList && printReports === null
                    ? {
                        open: onOpenTicketList,
                        scope: {
                          ...(teamId ? { teamIds: [teamId] } : {}),
                          ...(agentId ? { agent: agentId } : {}),
                        },
                        scopeLabel: filterText,
                      }
                    : null
                }
              >
                <ReportBody
                  insights={insights}
                  printing={printReports !== null}
                  report={key}
                />
              </ReportDrillContext.Provider>
            </section>
          ))
        : null}
    </div>
  );
}

export const predefinedReportStyles = `
  .predefined-report { display: grid; gap: 16px; min-width: 0; }
  .predefined-report__controls { display: flex; flex-wrap: wrap; align-items: end; gap: 12px; }
  .predefined-report__description { flex: 1 1 280px; margin: 0; color: var(--muted); font-size: 13px; line-height: 1.5; }
  .predefined-report__controls label { display: grid; gap: 5px; color: var(--text); font-size: 12px; font-weight: 700; }
  .predefined-report__controls select { min-height: 36px; min-width: 180px; border: 1px solid var(--control-border, var(--border)); border-radius: 8px; padding: 6px 9px; background: var(--surface); color: var(--ink); font: inherit; font-size: 13px; }
  .predefined-report__button { appearance: none; min-height: 36px; border: 1px solid var(--border); border-radius: 8px; padding: 7px 12px; background: var(--surface); color: var(--text); font: inherit; font-size: 12px; font-weight: 700; cursor: pointer; }
  .predefined-report__button--primary { background: var(--report-primary, #4338ca); border-color: var(--report-primary, #4338ca); color: #fff; }
  .predefined-report__button:disabled { opacity: .6; cursor: not-allowed; }
  .predefined-report__drill { appearance: none; background: none; border: 0; border-radius: 6px; color: inherit; cursor: pointer; font: inherit; padding: 0; text-align: left; text-decoration: none; }
  .predefined-report__drill:hover strong { color: var(--primary); }
  .predefined-report__drill:focus-visible { outline: 3px solid color-mix(in srgb, var(--primary) 40%, transparent); outline-offset: 2px; }
  .predefined-report__drill--inline { font-weight: inherit; }
  .predefined-report__pdf, .predefined-report__panel, .predefined-report__kpi, .predefined-report__masthead { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-card, 12px); }
  .predefined-report__pdf { display: grid; gap: 12px; padding: 16px; }
  .predefined-report__pdf h3, .predefined-report__panel h3 { margin: 0; color: var(--ink); font-size: 15px; }
  .predefined-report__pdf p { margin: 5px 0 0; color: var(--muted); font-size: 13px; line-height: 1.45; }
  .predefined-report__pdf-options { display: flex; flex-wrap: wrap; gap: 8px; }
  .predefined-report__pdf-options label { display: inline-flex; align-items: center; gap: 7px; min-height: 36px; border: 1px solid var(--border); border-radius: 999px; padding: 6px 11px; color: var(--text); font-size: 12px; font-weight: 650; }
  .predefined-report__pdf-actions { display: flex; justify-content: flex-end; gap: 8px; }
  .predefined-report__state { margin: 0; color: var(--muted); font-size: 13px; }
  .predefined-report__state--error { color: var(--danger); }
  .predefined-report__page { display: grid; gap: 14px; }
  .predefined-report__masthead { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 14px; padding: 14px 16px; border-top: 4px solid var(--report-primary, #4338ca); }
  .predefined-report__masthead img { width: 38px; height: 38px; object-fit: contain; }
  .predefined-report__masthead strong { color: var(--ink); font-size: 16px; }
  .predefined-report__masthead p { margin: 4px 0 0; color: var(--muted); font-size: 12px; }
  .predefined-report__masthead small { color: var(--muted); font-size: 11px; line-height: 1.45; text-align: right; }
  .predefined-report__panel { display: grid; gap: 12px; min-width: 0; padding: 16px; }
  .predefined-report__grid { display: grid; gap: 14px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .predefined-report__kpis { display: grid; gap: 12px; grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .predefined-report__kpis--two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .predefined-report__kpi { display: grid; align-content: center; justify-items: center; gap: 6px; min-height: 130px; padding: 16px; text-align: center; }
  .predefined-report__kpi p { margin: 0; color: var(--muted); font-size: 12px; }
  .predefined-report__kpi strong { color: var(--ink); font-size: 26px; font-variant-numeric: tabular-nums; letter-spacing: -.03em; }
  .predefined-report__delta { font-size: 12px; font-weight: 700; }
  .predefined-report__delta--good { color: #16a34a; }
  .predefined-report__delta--bad { color: #dc2626; }
  .predefined-report__delta--flat { color: var(--muted); }
  .predefined-report__chart { margin: 0; min-width: 0; }
  .predefined-report__chart svg { display: block; width: 100%; height: auto; }
  .predefined-report__grid-line { stroke: var(--border); stroke-width: 1; }
  .predefined-report__axis { fill: var(--muted); font-size: 11px; }
  .predefined-report__point-label { fill: var(--text); font-size: 10px; font-weight: 600; }
  .predefined-report__legend { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 6px; color: var(--text); font-size: 12px; }
  .predefined-report__legend span { display: inline-flex; align-items: center; gap: 6px; }
  .predefined-report__legend i { display: inline-block; width: 12px; height: 12px; border-radius: 3px; }
  .predefined-report__moods { display: flex; flex-wrap: wrap; justify-content: center; gap: 28px; padding: 18px 0 6px; }
  .predefined-report__moods div { display: grid; justify-items: center; gap: 3px; }
  .predefined-report__mood-icon { font-size: 30px; line-height: 1; }
  .predefined-report__moods strong { color: var(--ink); font-size: 22px; }
  .predefined-report__moods small, .predefined-report__note { color: var(--muted); font-size: 12px; }
  .predefined-report__note { margin: 0; text-align: center; font-weight: 700; }
  .predefined-report__empty { margin: 0; color: var(--muted); font-size: 13px; }
  .predefined-report__tabs { display: inline-flex; flex-wrap: wrap; gap: 3px; width: fit-content; padding: 3px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface-subtle, var(--surface)); }
  .predefined-report__tabs button { appearance: none; min-height: 32px; border: 0; border-radius: 7px; padding: 6px 12px; background: transparent; color: var(--text); font: inherit; font-size: 12px; font-weight: 700; cursor: pointer; }
  .predefined-report__tabs button[aria-selected="true"] { background: var(--surface); box-shadow: var(--shadow-sm); color: var(--report-primary, #4338ca); }
  .predefined-report__table-wrap { overflow-x: auto; }
  .predefined-report__table { width: 100%; border-collapse: collapse; font-size: 13px; }
  .predefined-report__table th, .predefined-report__table td { border-bottom: 1px solid var(--border); padding: 10px 12px; text-align: left; white-space: nowrap; }
  .predefined-report__table thead th { background: var(--surface-subtle, var(--surface)); color: var(--text); font-size: 12px; }
  .predefined-report__table tbody th { color: var(--ink); font-weight: 600; }
  .predefined-report__table td { color: var(--text); font-variant-numeric: tabular-nums; }
  .predefined-report__themes tbody th { position: relative; min-width: 180px; }
  .predefined-report__theme-name { position: relative; z-index: 1; }
  .predefined-report__theme-bar { position: absolute; left: 0; bottom: 3px; height: 3px; border-radius: 99px; background: var(--report-primary, #4338ca); opacity: 0.35; }
  .predefined-report__total th, .predefined-report__total td { background: var(--surface-subtle, var(--surface)); font-weight: 800; }
  @media (max-width: 920px) { .predefined-report__kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); } .predefined-report__grid { grid-template-columns: 1fr; } }
  @media (max-width: 560px) { .predefined-report__kpis, .predefined-report__kpis--two { grid-template-columns: 1fr; } .predefined-report__masthead { grid-template-columns: auto 1fr; } .predefined-report__masthead small { grid-column: 1 / -1; text-align: left; } }
  @media print {
    body.predefined-report--printing .command-rail, body.predefined-report--printing .topbar, body.predefined-report--printing .service-reporting__header, body.predefined-report--printing .service-reporting__views, body.predefined-report--printing .service-reporting__custom-period, body.predefined-report--printing .predefined-report__controls, body.predefined-report--printing .predefined-report__pdf, body.predefined-report--printing .workspace > .preview-notice { display: none !important; }
    body.predefined-report--printing .workspace { display: block; padding: 0 !important; }
    body.predefined-report--printing .predefined-report__page--break { break-before: page; }
    body.predefined-report--printing .predefined-report__panel, body.predefined-report--printing .predefined-report__kpi, body.predefined-report--printing .predefined-report__masthead { break-inside: avoid; box-shadow: none; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
    body.predefined-report--printing .predefined-report__kpis { grid-template-columns: repeat(4, minmax(0, 1fr)); }
    body.predefined-report--printing .predefined-report__grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }
`;
