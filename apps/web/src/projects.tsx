import { Plus, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { confirmDialog } from "./app-dialog";
import { FormNote } from "./form-kit";
import {
  type ProjectModuleAccess,
  type ProjectOptions,
  type ProjectOverview,
  type ProjectSummary,
  projectsCall,
} from "./lib/projects-api";
import {
  plannedHoursPercent,
  type ProjectSortKey,
  sortProjects,
  dateLabel,
  hoursLabel,
  localToday,
  PROJECT_STATUS_LABELS,
} from "./lib/projects-model";
import {
  budgetTone,
  HealthDot,
  ProgressBar,
  ProjectForm,
  type ProjectFormState,
} from "./project-form";
import { ProjectDetail } from "./project-detail";
import { ProjectPortfolio } from "./project-portfolio";
import { ProjectWorkload } from "./project-workload";
import "./projects.css";

type View = "dashboard" | "timeline" | "workload" | "templates";
type StatusFilter = "running" | "completed" | "all";

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function Dashboard({
  guest,
  onOpen,
  projects,
  today,
}: {
  /** Gäste sehen weder Stunden noch Budget. */
  guest: boolean;
  onOpen: (projectId: string) => void;
  projects: ProjectSummary[];
  today: string;
}) {
  const [status, setStatus] = useState<StatusFilter>("running");
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<ProjectSortKey>("health");
  const [descending, setDescending] = useState(false);

  const running = projects.filter(
    (project) => project.status !== "completed" && !project.archivedAt,
  );
  const overdueMilestones = running.reduce(
    (sum, project) => sum + project.stats.overdueMilestones,
    0,
  );
  const critical = running.filter((project) => project.health !== "green");
  const booked = running.reduce(
    (sum, project) => sum + project.stats.bookedMinutes,
    0,
  );
  const planned = running.reduce(
    (sum, project) => sum + project.stats.estimatedMinutes,
    0,
  );

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matching = projects
      .filter((project) =>
        status === "all"
          ? true
          : status === "completed"
            ? project.status === "completed"
            : project.status !== "completed",
      )
      .filter(
        (project) =>
          !needle ||
          `${project.number} ${project.title} ${project.managerName ?? ""}`
            .toLowerCase()
            .includes(needle),
      );
    return sortProjects(matching, sortKey, descending);
  }, [descending, projects, query, sortKey, status]);

  // First click ascending, second descending, third back to the start order.
  const sortBy = (key: ProjectSortKey) => {
    if (sortKey !== key) {
      setSortKey(key);
      setDescending(false);
    } else if (!descending) {
      setDescending(true);
    } else {
      setSortKey("health");
      setDescending(false);
    }
  };
  const columns: readonly (readonly [ProjectSortKey, string])[] = [
    ["title", "Projekt"],
    ["status", "Status"],
    ["manager", "Leitung"],
    ["progress", "Fortschritt"],
    ...(guest ? [] : ([["time", "Zeit"]] as const)),
    ["milestone", "Nächster Meilenstein"],
    ["endsOn", "Ende"],
  ];

  return (
    <>
      <div className="pj-kpis">
        <article className="pj-card pj-kpi">
          <p>Laufende Projekte</p>
          <strong>{running.length}</strong>
          <small>
            {running.filter((project) => project.status === "active").length}{" "}
            aktiv
          </small>
        </article>
        <article
          className={`pj-card pj-kpi ${overdueMilestones ? "pj-kpi--bad" : "pj-kpi--good"}`}
        >
          <p>Überfällige Meilensteine</p>
          <strong>{overdueMilestones}</strong>
        </article>
        <article
          className={`pj-card pj-kpi ${critical.length ? "pj-kpi--warn" : "pj-kpi--good"}`}
        >
          <p>Ampel Gelb oder Rot</p>
          <strong>{critical.length}</strong>
          <small>
            {critical.filter((project) => project.health === "red").length} rot
          </small>
        </article>
        {guest ? null : (
          <article className="pj-card pj-kpi">
            <p>Gebuchte Stunden</p>
            <strong>{hoursLabel(booked)}</strong>
            <small>
              {planned
                ? `von ${hoursLabel(planned)} geplant`
                : "noch keine Schätzungen"}
            </small>
          </article>
        )}
      </div>

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
        <label className="pj-search">
          <Search aria-hidden="true" size={15} />
          <input
            aria-label="Projekte durchsuchen"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Nummer, Titel, Leitung"
            type="search"
            value={query}
          />
        </label>
      </div>

      <section className="pj-card pj-card--flush">
        {visible.length === 0 ? (
          <p className="pj-empty">
            {projects.length === 0
              ? "Es gibt noch keine Projekte."
              : "Kein Projekt passt zu diesem Filter."}
          </p>
        ) : (
          <div className="pj-table-wrap">
            <table className="pj-table">
              <thead>
                <tr>
                  {columns.map(([key, label]) => (
                    <th
                      aria-sort={
                        sortKey === key
                          ? descending
                            ? "descending"
                            : "ascending"
                          : "none"
                      }
                      key={key}
                    >
                      <button
                        className="pj-sort"
                        onClick={() => sortBy(key)}
                        title={`Nach ${label} sortieren`}
                        type="button"
                      >
                        {label}
                        {sortKey === key ? (descending ? " ↓" : " ↑") : ""}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((project) => {
                  const used = plannedHoursPercent(project);
                  const late =
                    project.endsOn &&
                    project.endsOn < today &&
                    project.status !== "completed";
                  return (
                    <tr key={project.id}>
                      <td>
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
                              {project.archivedAt ? " · archiviert" : ""}
                            </small>
                          </span>
                        </button>
                      </td>
                      <td>
                        <span className={`pj-chip pj-chip--${project.status}`}>
                          {PROJECT_STATUS_LABELS[project.status]}
                        </span>
                      </td>
                      <td>{project.managerName ?? "–"}</td>
                      <td>
                        <div className="pj-meter">
                          <ProgressBar
                            label={`Fortschritt ${project.stats.progressPercent} %`}
                            percent={project.stats.progressPercent}
                          />
                          <small>
                            {project.stats.progressPercent} % ·{" "}
                            {project.stats.doneCount}/{project.stats.taskCount}
                          </small>
                        </div>
                      </td>
                      {guest ? null : (
                        <td>
                          {project.role === "guest_read" ||
                          project.role === "guest_comment" ? (
                            "–"
                          ) : (
                            <div className="pj-meter">
                              <ProgressBar
                                label={
                                  used === null
                                    ? "Keine Schätzung"
                                    : `${used} % der geplanten Zeit gebucht`
                                }
                                percent={used ?? 0}
                                tone={budgetTone(used)}
                              />
                              <small>
                                {hoursLabel(project.stats.bookedMinutes)}
                                {project.stats.estimatedMinutes
                                  ? ` von ${hoursLabel(project.stats.estimatedMinutes)}`
                                  : ""}
                              </small>
                            </div>
                          )}
                        </td>
                      )}
                      <td>
                        {project.stats.overdueMilestones > 0 ? (
                          <span className="pj-chip pj-chip--bad">
                            {project.stats.overdueMilestones} überfällig
                          </span>
                        ) : project.stats.nextMilestone ? (
                          <span className="pj-two-line">
                            {dateLabel(project.stats.nextMilestone.on)}
                            <small>{project.stats.nextMilestone.title}</small>
                          </span>
                        ) : (
                          "–"
                        )}
                      </td>
                      <td className={late ? "pj-nowrap pj-late" : "pj-nowrap"}>
                        {dateLabel(project.endsOn)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function Templates({
  canManage,
  canCreate,
  onChanged,
  onUse,
  options,
  tenantId,
}: {
  canManage: boolean;
  canCreate: boolean;
  onChanged: () => void;
  onUse: (templateId: string) => void;
  options: ProjectOptions;
  tenantId: string;
}) {
  const [error, setError] = useState("");
  const remove = async (id: string, name: string) => {
    if (
      !(await confirmDialog(`Vorlage «${name}» löschen?`, {
        confirmLabel: "Löschen",
        tone: "danger",
      }))
    ) {
      return;
    }
    try {
      await projectsCall({ type: "deleteTemplate", tenantId, templateId: id });
      onChanged();
    } catch (nextError) {
      setError(errorText(nextError));
    }
  };
  return (
    <section className="pj-card">
      <FormNote>
        Eine Vorlage entsteht aus einem bestehenden Projekt: im Projekt unter
        «Mehr» den Punkt «Als Vorlage speichern» wählen.
      </FormNote>
      {error ? (
        <p className="pj-error" role="alert">
          {error}
        </p>
      ) : null}
      {options.templates.length === 0 ? (
        <p className="pj-empty">Es gibt noch keine Vorlagen.</p>
      ) : (
        <ul className="pj-rows">
          {options.templates.map((template) => (
            <li key={template.id}>
              <span className="pj-two-line">
                <strong>{template.name}</strong>
                <small>
                  {template.itemCount} Elemente
                  {template.durationDays !== null
                    ? ` · ${template.durationDays} Tage`
                    : ""}
                  {template.description ? ` · ${template.description}` : ""}
                </small>
              </span>
              <span className="pj-actions">
                {canCreate ? (
                  <button
                    className="pj-button"
                    onClick={() => onUse(template.id)}
                    type="button"
                  >
                    Projekt daraus anlegen
                  </button>
                ) : null}
                {canManage ? (
                  <button
                    className="pj-button pj-button--danger"
                    onClick={() => void remove(template.id, template.name)}
                    type="button"
                  >
                    Löschen
                  </button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function Projects({
  access,
  focusProjectId,
  focusTaskId,
  onFocusHandled,
  onOpenTicket,
  tenantId,
}: {
  access: ProjectModuleAccess;
  focusProjectId?: string | null;
  /** Element to open inside the focused project (from a notification). */
  focusTaskId?: string | null;
  onFocusHandled?: () => void;
  onOpenTicket?: ((ticketId: string) => void) | undefined;
  tenantId: string;
}) {
  const [view, setView] = useState<View>("dashboard");
  const [data, setData] = useState<ProjectOverview | null>(null);
  const [options, setOptions] = useState<ProjectOptions | null>(null);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [form, setForm] = useState<ProjectFormState | null>(null);
  const [error, setError] = useState("");
  const version = useRef(0);
  const today = localToday();

  const load = useCallback(async () => {
    const current = ++version.current;
    setError("");
    try {
      const next = await projectsCall<ProjectOverview>({
        type: "overview",
        tenantId,
        includeArchived,
      });
      if (version.current === current) setData(next);
    } catch (nextError) {
      if (version.current === current) setError(errorText(nextError));
    }
  }, [includeArchived, tenantId]);

  const loadOptions = useCallback(async () => {
    try {
      setOptions(
        await projectsCall<ProjectOptions>({ type: "options", tenantId }),
      );
    } catch (nextError) {
      setError(errorText(nextError));
    }
  }, [tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!access.guestOnly) void loadOptions();
  }, [access.guestOnly, loadOptions]);

  useEffect(() => {
    if (!focusProjectId) return;
    setOpenId(focusProjectId);
    setOpenTaskId(focusTaskId ?? null);
    onFocusHandled?.();
  }, [focusProjectId, focusTaskId, onFocusHandled]);

  if (openId) {
    return (
      <ProjectDetail
        initialTaskId={openTaskId}
        key={`${openId}-${openTaskId ?? ""}`}
        onBack={() => {
          setOpenId(null);
          setOpenTaskId(null);
          void load();
          if (!access.guestOnly) void loadOptions();
        }}
        onOpenTicket={onOpenTicket}
        options={options}
        permissions={access}
        projectId={openId}
        tenantId={tenantId}
      />
    );
  }

  const internal = !access.guestOnly;
  return (
    <div className="projects">
      <div className="pj-header">
        <p className="pj-intro">
          {internal
            ? "Projekte planen, steuern und mit Tickets, Netzen und Geräten verbinden."
            : "Projekte, an denen eine Beteiligung besteht."}
        </p>
        <div className="pj-actions">
          {internal && (view === "dashboard" || view === "timeline") ? (
            <label className="pj-check">
              <input
                checked={includeArchived}
                onChange={(event) => setIncludeArchived(event.target.checked)}
                type="checkbox"
              />
              Archiv anzeigen
            </label>
          ) : null}
          {access.create && options ? (
            <button
              className="pj-button pj-button--primary"
              onClick={() => setForm({ project: null, templateId: "" })}
              type="button"
            >
              <Plus aria-hidden="true" size={15} /> Neues Projekt
            </button>
          ) : null}
        </div>
      </div>

      {internal ? (
        <div className="pj-tabs" role="tablist" aria-label="Ansicht">
          {(
            [
              ["dashboard", "Übersicht"],
              ["timeline", "Zeitplan"],
              ...(access.read ? ([["workload", "Auslastung"]] as const) : []),
              ["templates", "Vorlagen"],
            ] as readonly (readonly [View, string])[]
          ).map(([key, label]) => (
            <button
              aria-selected={view === key}
              key={key}
              onClick={() => setView(key)}
              role="tab"
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}

      {error ? (
        <p className="pj-error" role="alert">
          {error}
        </p>
      ) : null}

      {view === "dashboard" ? (
        data ? (
          <Dashboard
            guest={access.guestOnly}
            onOpen={setOpenId}
            projects={data.projects}
            today={today}
          />
        ) : error ? null : (
          <p className="pj-empty">Projekte werden geladen …</p>
        )
      ) : view === "timeline" ? (
        data ? (
          <ProjectPortfolio
            onOpen={setOpenId}
            projects={data.projects}
            today={today}
          />
        ) : error ? null : (
          <p className="pj-empty">Projekte werden geladen …</p>
        )
      ) : view === "workload" ? (
        <ProjectWorkload
          canManage={access.manage}
          onOpenProject={setOpenId}
          onOpenTicket={onOpenTicket}
          teams={options?.teams ?? []}
          tenantId={tenantId}
        />
      ) : options ? (
        <Templates
          canCreate={access.create}
          canManage={access.manage}
          onChanged={() => void loadOptions()}
          onUse={(templateId) => setForm({ project: null, templateId })}
          options={options}
          tenantId={tenantId}
        />
      ) : (
        <p className="pj-empty">Vorlagen werden geladen …</p>
      )}

      {form && options ? (
        <ProjectForm
          onClose={() => setForm(null)}
          onSaved={(projectId) => {
            setForm(null);
            setOpenId(projectId);
          }}
          options={options}
          state={form}
          tenantId={tenantId}
        />
      ) : null}
    </div>
  );
}
