import { useEffect, useMemo, useRef, useState } from "react";
import type { ProjectSummary } from "./lib/projects-api";
import {
  addDays,
  dateLabel,
  diffDays,
  ganttBar,
  ganttRange,
  HEALTH_LABELS,
  monthSegments,
  PROJECT_STATUS_LABELS,
  projectSpan,
  weekSegments,
} from "./lib/projects-model";
import { HealthDot } from "./project-form";

type Zoom = "week" | "month" | "quarter";
type StatusFilter = "running" | "completed" | "all";

const DAY_WIDTH: Record<Zoom, number> = { week: 13, month: 5, quarter: 2 };
const LABEL_WIDTH = 300;

/** Zeitleiste über alle Projekte: ein Balken je Projekt mit seinen Meilensteinen. */
export function ProjectPortfolio({
  onOpen,
  projects,
  today,
}: {
  onOpen: (projectId: string) => void;
  projects: ProjectSummary[];
  today: string;
}) {
  const [zoom, setZoom] = useState<Zoom>("month");
  const [status, setStatus] = useState<StatusFilter>("running");
  const scroller = useRef<HTMLDivElement | null>(null);
  const dayWidth = DAY_WIDTH[zoom];

  const rows = useMemo(
    () =>
      projects
        .filter((project) =>
          status === "all"
            ? true
            : status === "completed"
              ? project.status === "completed"
              : project.status !== "completed",
        )
        .map((project) => ({ project, span: projectSpan(project) }))
        .sort(
          (a, b) =>
            (a.span?.start ?? "9999").localeCompare(b.span?.start ?? "9999") ||
            a.project.title.localeCompare(b.project.title, "de"),
        ),
    [projects, status],
  );

  const range = useMemo(
    () =>
      ganttRange(
        { startsOn: null, endsOn: null },
        rows.map(({ span }) => ({
          startsOn: span?.start ?? null,
          dueOn: span?.end ?? null,
        })),
        today,
      ),
    [rows, today],
  );
  const width = range.days * dayWidth;
  const todayLeft = diffDays(range.start, today) * dayWidth;

  useEffect(() => {
    const element = scroller.current;
    if (element) element.scrollLeft = Math.max(0, todayLeft - 240);
    // Only when the scale changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom]);

  const months = monthSegments(range.start, range.days);
  const weeks = weekSegments(range.start, range.days);
  const undated = rows.filter((row) => !row.span).length;

  return (
    <>
      <div className="pj-toolbar">
        <div className="pj-segments" role="group" aria-label="Status">
          {(
            [
              ["running", "Laufend"],
              ["completed", "Abgeschlossen"],
              ["all", "Alle"],
            ] as const
          ).map(([key, label]) => (
            <button
              aria-pressed={status === key}
              key={key}
              onClick={() => setStatus(key)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
        <div className="pj-segments" role="group" aria-label="Massstab">
          {(
            [
              ["week", "Wochen"],
              ["month", "Monate"],
              ["quarter", "Quartale"],
            ] as const
          ).map(([key, label]) => (
            <button
              aria-pressed={zoom === key}
              key={key}
              onClick={() => setZoom(key)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <section className="pj-card">
          <p className="pj-empty">
            {projects.length === 0
              ? "Es gibt noch keine Projekte."
              : "Kein Projekt passt zu diesem Filter."}
          </p>
        </section>
      ) : (
        <section className="pj-card pj-card--flush">
          <div
            className={`pj-gantt pj-gantt--${zoom} pj-portfolio`}
            ref={scroller}
            style={{ ["--pj-day" as string]: `${dayWidth}px` }}
          >
            <div
              className="pj-gantt__inner"
              style={{ width: LABEL_WIDTH + width }}
            >
              <div className="pj-gantt__head">
                <div className="pj-gantt__corner">Projekt</div>
                <div className="pj-gantt__scale" style={{ width }}>
                  <div className="pj-gantt__months">
                    {months.map((segment) => {
                      const space = segment.days * dayWidth;
                      const [name = "", year = ""] = segment.label.split(" ");
                      return (
                        <span key={segment.start} style={{ width: space }}>
                          {space > 110
                            ? segment.label
                            : space > 44
                              ? `${name.slice(0, 3)} ${year.slice(2)}`
                              : ""}
                        </span>
                      );
                    })}
                  </div>
                  <div className="pj-gantt__units">
                    {weeks.map((segment) => (
                      <span
                        key={segment.start}
                        style={{ width: segment.days * dayWidth }}
                      >
                        {zoom === "week" ? segment.label : ""}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              <div className="pj-gantt__body">
                <div
                  aria-hidden="true"
                  className="pj-gantt__today"
                  style={{ left: LABEL_WIDTH + todayLeft + dayWidth / 2 }}
                />
                {rows.map(({ project, span }) => {
                  const bar = span
                    ? ganttBar(range.start, span.start, span.end, dayWidth)
                    : null;
                  const late =
                    project.status !== "completed" &&
                    !!span &&
                    span.end < today;
                  const title = `${project.number} ${project.title} · ${
                    span
                      ? `${dateLabel(span.start)} – ${dateLabel(span.end)}`
                      : "ohne Termin"
                  } · ${PROJECT_STATUS_LABELS[project.status]} · Ampel ${HEALTH_LABELS[project.health]} · ${project.stats.progressPercent} %`;
                  return (
                    <div
                      className="pj-gantt__row pj-portfolio__row"
                      key={project.id}
                    >
                      <div className="pj-gantt__label pj-portfolio__label">
                        <button
                          className="pj-project-link"
                          onClick={() => onOpen(project.id)}
                          type="button"
                        >
                          <HealthDot health={project.health} />
                          <span>
                            <strong>{project.title}</strong>
                            <small>
                              {project.number}
                              {project.managerName
                                ? ` · ${project.managerName}`
                                : ""}
                            </small>
                          </span>
                        </button>
                      </div>
                      <div className="pj-gantt__lane" style={{ width }}>
                        {bar ? (
                          <>
                            <button
                              aria-label={title}
                              className={`pj-portfolio__bar pj-portfolio__bar--${project.health}${late ? " is-late" : ""}${project.status === "completed" ? " is-done" : ""}`}
                              onClick={() => onOpen(project.id)}
                              style={{ left: bar.left, width: bar.width }}
                              title={title}
                              type="button"
                            >
                              <i
                                style={{
                                  width: `${project.stats.progressPercent}%`,
                                }}
                              />
                              {bar.width > 90 ? (
                                <span>{project.stats.progressPercent} %</span>
                              ) : null}
                            </button>
                            {(project.milestones ?? []).map((milestone) => (
                              <span
                                className={`pj-portfolio__milestone${milestone.done ? " is-done" : milestone.dueOn < today ? " is-late" : ""}`}
                                key={milestone.id}
                                role="img"
                                aria-label={`Meilenstein ${milestone.title}, ${dateLabel(milestone.dueOn)}`}
                                style={{
                                  left:
                                    diffDays(range.start, milestone.dueOn) *
                                      dayWidth +
                                    dayWidth / 2 -
                                    6,
                                }}
                                title={`${milestone.title} · ${dateLabel(milestone.dueOn)}${milestone.done ? " · erreicht" : milestone.dueOn < today ? " · überfällig" : ""}`}
                              />
                            ))}
                          </>
                        ) : (
                          <span
                            className="pj-portfolio__undated"
                            style={{ left: Math.max(8, todayLeft + 12) }}
                          >
                            ohne Termin
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>
      )}
      <p className="pj-legend">
        <span className="pj-dot pj-dot--green" /> Ampel Grün
        <span className="pj-dot pj-dot--yellow" /> Gelb
        <span className="pj-dot pj-dot--red" /> Rot
        <span className="pj-portfolio__milestone pj-portfolio__milestone--legend" />{" "}
        Meilenstein
        <span className="pj-muted">
          Der Balken reicht vom Start bis zum Ende des Projekts, die dunklere
          Füllung zeigt den Fortschritt. Ein Klick öffnet das Projekt.
          {undated > 0
            ? ` ${undated} Projekte haben weder Start noch Ende.`
            : ""}
        </span>
      </p>
    </>
  );
}
