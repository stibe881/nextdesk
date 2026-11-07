import { useMemo } from "react";
import { AlertTriangle, Clock3 } from "lucide-react";
import {
  buildTicketTimeline,
  formatTimelineDuration,
  timelinePosition,
  timelineSequence,
  type TimelineInput,
  type TimelinePeriod,
} from "./lib/ticket-timeline";
import "./ticket-coordination.css";

const DATE_TIME = new Intl.DateTimeFormat("de-CH", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Europe/Zurich",
});

function formatPoint(value: number): string {
  return DATE_TIME.format(new Date(value));
}

const PERIOD_LABELS: Record<TimelinePeriod["kind"], string> = {
  vendor: "Drittanbieter",
  child: "Teil-Ticket",
  waiting: "Wartestatus",
};

/**
 * «Ticket-Zeitachse»: proportional overview (status, SLA points, periods,
 * gaps) plus a chronological list. The list runs horizontally on wide
 * screens and vertically on narrow ones (see ticket-coordination.css).
 */
export function TicketTimeline({
  input,
  now,
}: {
  input: TimelineInput;
  now: number;
}) {
  const timeline = useMemo(() => buildTicketTimeline(input, now), [input, now]);
  const sequence = useMemo(() => timelineSequence(timeline), [timeline]);
  const longestGap = timeline.gaps.reduce<number>(
    (longest, gap) => Math.max(longest, gap.durationMs),
    0,
  );
  const position = (value: number) => `${timelinePosition(timeline, value)}%`;
  const width = (start: number, end: number) =>
    `${Math.max(0.8, timelinePosition(timeline, end) - timelinePosition(timeline, start))}%`;

  return (
    <section
      aria-labelledby="ticket-timeline-heading"
      className="ticket-detail-primary ticket-timeline"
    >
      <div className="ticket-detail-section-heading">
        <div>
          <p className="eyebrow">VERLAUF</p>
          <h3 id="ticket-timeline-heading">Ticket-Zeitachse</h3>
        </div>
        <span className="data-caption">
          {timeline.gaps.length === 0
            ? "Keine längeren Lücken"
            : `${timeline.gaps.length} ${timeline.gaps.length === 1 ? "Lücke" : "Lücken"} · längste ${formatTimelineDuration(longestGap)}`}
        </span>
      </div>

      <div aria-hidden="true" className="ticket-timeline__overview">
        <div className="ticket-timeline__track">
          {timeline.gaps.map((gap) => (
            <span
              className="ticket-timeline__gap-band"
              key={gap.id}
              style={{
                left: position(gap.start),
                width: width(gap.start, gap.end),
              }}
              title={gap.label}
            />
          ))}
          <span className="ticket-timeline__axis" />
          {timeline.entries.map((entry) => (
            <span
              className={`ticket-timeline__marker ticket-timeline__marker--${entry.tone}${entry.kind === "sla_due" ? " ticket-timeline__marker--sla" : ""}${entry.future ? " ticket-timeline__marker--future" : ""}`}
              key={entry.id}
              style={{ left: position(entry.time) }}
              title={`${entry.title}${entry.detail ? ` – ${entry.detail}` : ""} (${formatPoint(entry.time)})`}
            />
          ))}
          <span
            className="ticket-timeline__now"
            style={{ left: position(Math.min(now, timeline.end)) }}
            title={`Jetzt (${formatPoint(now)})`}
          />
        </div>
        {timeline.periods.length > 0 ? (
          <div className="ticket-timeline__lanes">
            {timeline.periods.map((period) => (
              <div className="ticket-timeline__lane" key={period.id}>
                <span
                  className={`ticket-timeline__period ticket-timeline__period--${period.tone}${period.end === null ? " ticket-timeline__period--open" : ""}`}
                  style={{
                    left: position(period.start),
                    width: width(period.start, period.end ?? now),
                  }}
                  title={`${PERIOD_LABELS[period.kind]}: ${period.label}`}
                >
                  <span>{period.label}</span>
                </span>
              </div>
            ))}
          </div>
        ) : null}
        <div className="ticket-timeline__scale">
          <span>{formatPoint(timeline.start)}</span>
          <span>{formatPoint(timeline.end)}</span>
        </div>
      </div>

      <ol className="ticket-timeline__list">
        {sequence.map((item) =>
          item.type === "gap" ? (
            <li
              className={`ticket-timeline__gap ticket-timeline__gap--${item.gap.reason}`}
              key={item.gap.id}
            >
              <AlertTriangle aria-hidden="true" size={15} />
              <span>
                <strong>{item.gap.label}</strong>
                <small>
                  {formatPoint(item.gap.start)} –{" "}
                  {item.gap.ongoing ? "jetzt" : formatPoint(item.gap.end)}
                </small>
              </span>
            </li>
          ) : (
            <li
              className={`ticket-timeline__entry ticket-timeline__entry--${item.entry.tone}${item.entry.future ? " ticket-timeline__entry--future" : ""}`}
              key={item.entry.id}
            >
              <span aria-hidden="true" className="ticket-timeline__dot">
                {item.entry.kind === "sla_due" ? <Clock3 size={11} /> : null}
              </span>
              <span className="ticket-timeline__entry-body">
                <time dateTime={new Date(item.entry.time).toISOString()}>
                  {formatPoint(item.entry.time)}
                </time>
                <strong>{item.entry.title}</strong>
                {item.entry.detail ? <small>{item.entry.detail}</small> : null}
              </span>
            </li>
          ),
        )}
      </ol>
    </section>
  );
}
