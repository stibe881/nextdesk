import {
  ChevronDown,
  ChevronRight,
  Diamond,
  GripVertical,
  Plus,
} from "lucide-react";
import {
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { confirmDialog } from "./app-dialog";
import type {
  Named,
  ProjectDependency,
  ProjectSummary,
  ProjectTask,
  TaskKind,
  TaskPriority,
  TaskStatus,
} from "./lib/projects-api";
import {
  addDays,
  buildTree,
  dateLabel,
  dependencyPath,
  dropPlacement,
  type DropZone,
  diffDays,
  EMPTY_FILTER,
  filterTasks,
  GANTT_DAY_WIDTH,
  ganttBar,
  ganttRange,
  type GanttZoom,
  hoursLabel,
  isOverdue,
  monthSegments,
  type Placement,
  PRIORITY_LABELS,
  type Rollup,
  sortTasks,
  TASK_KIND_LABELS,
  TASK_STATUS_LABELS,
  TASK_STATUSES,
  type TaskFilter,
  type TaskSortKey,
  weekSegments,
} from "./lib/projects-model";

export type PlanProps = {
  canEdit: boolean;
  dependencies: ProjectDependency[];
  onOpenTask: (taskId: string) => void;
  /** Moves a row to a new place in the plan. */
  onMove: (taskId: string, placement: Placement) => void;
  /** Sends a change to the server and reloads the project. */
  run: (body: Record<string, unknown>) => Promise<unknown>;
  people: Named[];
  project: ProjectSummary;
  rollup: Map<string, Rollup>;
  tasks: ProjectTask[];
  today: string;
};

const ROW_HEIGHT = 34;

export function initials(name: string | null): string {
  if (!name) return "–";
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.at(-1)?.[0] ?? "")).toUpperCase();
}

/** Neue Phase, neuer Meilenstein oder neue Aufgabe in einer Zeile. */
export function QuickAdd({
  projectId,
  run,
  tasks,
}: {
  projectId: string;
  run: PlanProps["run"];
  tasks: ProjectTask[];
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<TaskKind>("task");
  const [title, setTitle] = useState("");
  const [parentId, setParentId] = useState("");
  const [busy, setBusy] = useState(false);

  const parents = useMemo(
    () =>
      buildTree(tasks).filter((row) =>
        kind === "milestone"
          ? row.task.kind === "phase"
          : kind === "task"
            ? row.task.kind === "phase" ||
              (row.task.kind === "task" &&
                row.depth <= 1 &&
                !isSubtask(row.task, tasks))
            : false,
      ),
    [kind, tasks],
  );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    try {
      await run({
        type: "createTask",
        projectId,
        kind,
        title,
        parentId: kind === "phase" ? null : parentId || null,
      });
      setTitle("");
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        className="pj-button pj-button--primary"
        onClick={() => setOpen(true)}
        type="button"
      >
        <Plus aria-hidden="true" size={15} /> Element hinzufügen
      </button>
    );
  }
  return (
    <form className="pj-quick-add" onSubmit={(event) => void submit(event)}>
      <select
        aria-label="Art"
        onChange={(event) => {
          setKind(event.target.value as TaskKind);
          setParentId("");
        }}
        value={kind}
      >
        <option value="task">Aufgabe</option>
        <option value="milestone">Meilenstein</option>
        <option value="phase">Phase</option>
      </select>
      <input
        aria-label="Titel"
        autoFocus
        maxLength={240}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="Titel"
        value={title}
      />
      {kind !== "phase" ? (
        <select
          aria-label="Einordnen unter"
          onChange={(event) => setParentId(event.target.value)}
          value={parentId}
        >
          <option value="">Oberste Ebene</option>
          {parents.map((row) => (
            <option key={row.task.id} value={row.task.id}>
              {"– ".repeat(row.depth)}
              {row.task.title}
            </option>
          ))}
        </select>
      ) : null}
      <button
        className="pj-button pj-button--primary"
        disabled={busy || !title.trim()}
        type="submit"
      >
        Hinzufügen
      </button>
      <button
        className="pj-button"
        onClick={() => setOpen(false)}
        type="button"
      >
        Schliessen
      </button>
    </form>
  );
}

function isSubtask(task: ProjectTask, tasks: ProjectTask[]): boolean {
  if (!task.parentId) return false;
  return tasks.find((other) => other.id === task.parentId)?.kind === "task";
}

// ---------------------------------------------------------------------------
// Zeitplan (Gantt)
// ---------------------------------------------------------------------------

type Drag = {
  id: string;
  mode: "move" | "resize";
  startX: number;
  deltaDays: number;
};

export function ProjectGantt(props: PlanProps) {
  const {
    canEdit,
    dependencies,
    onMove,
    onOpenTask,
    project,
    rollup,
    run,
    tasks,
    today,
  } = props;
  const [zoom, setZoom] = useState<GanttZoom>("week");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [drag, setDrag] = useState<Drag | null>(null);
  // Reordering rows: the row being dragged and where it would land.
  const [rowDrag, setRowDrag] = useState<string | null>(null);
  const [rowDrop, setRowDrop] = useState<{
    id: string;
    zone: DropZone;
    placement: Placement;
  } | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);
  const dayWidth = GANTT_DAY_WIDTH[zoom];

  const rows = useMemo(() => buildTree(tasks, collapsed), [collapsed, tasks]);
  const range = useMemo(
    () =>
      ganttRange(
        project,
        tasks.map((task) => {
          const rolled = rollup.get(task.id);
          return {
            startsOn: rolled?.startsOn ?? task.startsOn,
            dueOn: rolled?.dueOn ?? task.dueOn,
          };
        }),
        today,
      ),
    [project, rollup, tasks, today],
  );
  const width = range.days * dayWidth;
  const todayLeft = diffDays(range.start, today) * dayWidth;

  useEffect(() => {
    const element = scroller.current;
    if (element) element.scrollLeft = Math.max(0, todayLeft - 160);
    // Only when the scale changes; not on every reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom]);

  const datesOf = (task: ProjectTask, hasChildren: boolean) => {
    const rolled = hasChildren ? rollup.get(task.id) : null;
    let startsOn = rolled?.startsOn ?? task.startsOn ?? task.dueOn;
    let dueOn = rolled?.dueOn ?? task.dueOn ?? task.startsOn;
    if (drag?.id === task.id && startsOn && dueOn) {
      if (drag.mode === "move") startsOn = addDays(startsOn, drag.deltaDays);
      dueOn = addDays(dueOn, drag.deltaDays);
      if (dueOn < startsOn) dueOn = startsOn;
    }
    return { startsOn, dueOn };
  };

  const bars = new Map<string, { left: number; width: number; y: number }>();
  rows.forEach((row, index) => {
    const dates = datesOf(row.task, row.hasChildren);
    const bar = ganttBar(range.start, dates.startsOn, dates.dueOn, dayWidth);
    if (bar)
      bars.set(row.task.id, { ...bar, y: index * ROW_HEIGHT + ROW_HEIGHT / 2 });
  });

  const pointerDown = (
    event: ReactPointerEvent<HTMLElement>,
    task: ProjectTask,
    mode: Drag["mode"],
  ) => {
    if (!canEdit || event.button !== 0) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ id: task.id, mode, startX: event.clientX, deltaDays: 0 });
  };
  const pointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    if (!drag) return;
    const deltaDays = Math.round((event.clientX - drag.startX) / dayWidth);
    if (deltaDays !== drag.deltaDays) setDrag({ ...drag, deltaDays });
  };
  const pointerUp = (task: ProjectTask) => {
    if (!drag) return;
    const { deltaDays, mode } = drag;
    setDrag(null);
    if (deltaDays === 0) {
      onOpenTask(task.id);
      return;
    }
    const startsOn = task.startsOn ?? task.dueOn;
    const dueOn = task.dueOn ?? task.startsOn;
    if (!startsOn || !dueOn) return;
    const nextDue = addDays(dueOn, deltaDays);
    void run({
      type: "updateTask",
      taskId: task.id,
      startsOn: mode === "move" ? addDays(startsOn, deltaDays) : startsOn,
      dueOn: nextDue < startsOn && mode === "resize" ? startsOn : nextDue,
    });
  };

  const dropOn = (
    event: React.DragEvent<HTMLDivElement>,
    task: ProjectTask,
    hasChildren: boolean,
  ) => {
    if (!rowDrag) return null;
    const box = event.currentTarget.getBoundingClientRect();
    const share = (event.clientY - box.top) / box.height;
    // The middle of a row means «into it», where that is possible.
    const zones: DropZone[] =
      share < 0.3
        ? ["before"]
        : share > 0.7
          ? ["after"]
          : ["into", share < 0.5 ? "before" : "after"];
    for (const zone of zones) {
      const placement = dropPlacement(
        tasks,
        rowDrag,
        task.id,
        zone,
        hasChildren && !collapsed.has(task.id),
      );
      if (placement) return { id: task.id, zone, placement };
    }
    return null;
  };

  const toggle = (id: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const months = monthSegments(range.start, range.days);
  const weeks = weekSegments(range.start, range.days);
  const undated = tasks.filter(
    (task) => !task.startsOn && !task.dueOn && !rollup.get(task.id)?.dueOn,
  ).length;

  return (
    <>
      <div className="pj-toolbar">
        {canEdit ? (
          <QuickAdd projectId={project.id} run={run} tasks={tasks} />
        ) : (
          <span />
        )}
        <div className="pj-segments" role="group" aria-label="Massstab">
          {(
            [
              ["day", "Tage"],
              ["week", "Wochen"],
              ["month", "Monate"],
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
            Der Projektplan ist noch leer. Mit «Element hinzufügen» entstehen
            Phasen, Meilensteine und Aufgaben.
          </p>
        </section>
      ) : (
        <section className="pj-card pj-card--flush">
          <div
            className={`pj-gantt pj-gantt--${zoom}`}
            ref={scroller}
            style={{ ["--pj-day" as string]: `${dayWidth}px` }}
          >
            <div className="pj-gantt__inner" style={{ width: 300 + width }}>
              <div className="pj-gantt__head">
                <div className="pj-gantt__corner">Element</div>
                <div className="pj-gantt__scale" style={{ width }}>
                  <div className="pj-gantt__months">
                    {months.map((segment) => (
                      <span
                        key={segment.start}
                        style={{ width: segment.days * dayWidth }}
                      >
                        {segment.days * dayWidth > 70 ? segment.label : ""}
                      </span>
                    ))}
                  </div>
                  <div className="pj-gantt__units">
                    {zoom === "day"
                      ? Array.from({ length: range.days }, (_, index) => {
                          const date = addDays(range.start, index);
                          return (
                            <span
                              className={date === today ? "is-today" : ""}
                              key={date}
                              style={{ width: dayWidth }}
                            >
                              {date.slice(8, 10)}
                            </span>
                          );
                        })
                      : weeks.map((segment) => (
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
                  style={{ left: 300 + todayLeft + dayWidth / 2 }}
                />
                <svg
                  aria-hidden="true"
                  className="pj-gantt__links"
                  height={rows.length * ROW_HEIGHT}
                  style={{ left: 300 }}
                  width={width}
                >
                  <defs>
                    <marker
                      id="pj-arrow"
                      markerHeight="6"
                      markerWidth="6"
                      orient="auto"
                      refX="5"
                      refY="3"
                    >
                      <path d="M0,0 L6,3 L0,6 z" />
                    </marker>
                  </defs>
                  {dependencies.map((dependency) => {
                    const from = bars.get(dependency.predecessorId);
                    const to = bars.get(dependency.successorId);
                    if (!from || !to) return null;
                    return (
                      <path
                        d={dependencyPath(dependency.type, from, to)}
                        key={dependency.id}
                        markerEnd="url(#pj-arrow)"
                      />
                    );
                  })}
                </svg>
                {rows.map(({ task, depth, hasChildren }) => {
                  const bar = bars.get(task.id);
                  const rolled = rollup.get(task.id);
                  const progress = hasChildren
                    ? (rolled?.progressPercent ?? 0)
                    : task.status === "done"
                      ? 100
                      : task.progressPercent;
                  const draggable = canEdit && !hasChildren && !!bar;
                  const overdue = isOverdue(task, today);
                  return (
                    <div
                      className={`pj-gantt__row${rowDrag === task.id ? " is-dragging" : ""}${rowDrop?.id === task.id ? ` is-drop-${rowDrop.zone}` : ""}`}
                      key={task.id}
                      onDragLeave={(event) => {
                        if (
                          !event.currentTarget.contains(
                            event.relatedTarget as Node | null,
                          )
                        ) {
                          setRowDrop((current) =>
                            current?.id === task.id ? null : current,
                          );
                        }
                      }}
                      onDragOver={(event) => {
                        const next = dropOn(event, task, hasChildren);
                        if (next) {
                          event.preventDefault();
                          event.dataTransfer.dropEffect = "move";
                        }
                        setRowDrop((current) =>
                          current?.id === next?.id &&
                          current?.zone === next?.zone
                            ? current
                            : next,
                        );
                      }}
                      onDrop={(event) => {
                        const next = dropOn(event, task, hasChildren);
                        const moved = rowDrag;
                        setRowDrag(null);
                        setRowDrop(null);
                        if (!next || !moved) return;
                        event.preventDefault();
                        onMove(moved, next.placement);
                      }}
                    >
                      <div
                        className="pj-gantt__label"
                        draggable={canEdit}
                        onDragEnd={() => {
                          setRowDrag(null);
                          setRowDrop(null);
                        }}
                        onDragStart={(event) => {
                          event.dataTransfer.effectAllowed = "move";
                          event.dataTransfer.setData("text/plain", task.id);
                          setRowDrag(task.id);
                        }}
                        style={{ paddingLeft: 4 + depth * 16 }}
                      >
                        {canEdit ? (
                          <GripVertical
                            aria-hidden="true"
                            className="pj-gantt__handle"
                            size={13}
                          />
                        ) : null}
                        {hasChildren ? (
                          <button
                            aria-expanded={!collapsed.has(task.id)}
                            aria-label={
                              collapsed.has(task.id)
                                ? "Aufklappen"
                                : "Zuklappen"
                            }
                            className="pj-twist"
                            onClick={() => toggle(task.id)}
                            type="button"
                          >
                            {collapsed.has(task.id) ? (
                              <ChevronRight aria-hidden="true" size={14} />
                            ) : (
                              <ChevronDown aria-hidden="true" size={14} />
                            )}
                          </button>
                        ) : (
                          <span className="pj-twist" />
                        )}
                        <button
                          className={`pj-gantt__title pj-gantt__title--${task.kind}${task.status === "done" ? " is-done" : ""}`}
                          onClick={() => onOpenTask(task.id)}
                          title={task.title}
                          type="button"
                        >
                          {task.kind === "milestone" ? (
                            <Diamond aria-hidden="true" size={11} />
                          ) : null}
                          {task.title}
                        </button>
                      </div>
                      <div className="pj-gantt__lane" style={{ width }}>
                        {bar ? (
                          task.kind === "milestone" ? (
                            <button
                              aria-label={`${task.title}, ${dateLabel(task.dueOn)}`}
                              className={`pj-gantt__milestone${task.status === "done" ? " is-done" : overdue ? " is-late" : ""}`}
                              onPointerDown={(event) =>
                                pointerDown(event, task, "move")
                              }
                              onPointerMove={pointerMove}
                              onPointerUp={() => pointerUp(task)}
                              onClick={
                                canEdit ? undefined : () => onOpenTask(task.id)
                              }
                              style={{
                                left: bar.left + dayWidth / 2 - 8,
                                cursor: draggable ? "grab" : "pointer",
                              }}
                              title={`${task.title} · ${dateLabel(task.dueOn)}`}
                              type="button"
                            />
                          ) : (
                            <div
                              className={`pj-gantt__bar pj-gantt__bar--${hasChildren ? "group" : task.status}${overdue ? " is-late" : ""}`}
                              onClick={
                                draggable
                                  ? undefined
                                  : () => onOpenTask(task.id)
                              }
                              onPointerDown={
                                draggable
                                  ? (event) => pointerDown(event, task, "move")
                                  : undefined
                              }
                              onPointerMove={
                                draggable ? pointerMove : undefined
                              }
                              onPointerUp={
                                draggable ? () => pointerUp(task) : undefined
                              }
                              role="button"
                              style={{
                                left: bar.left,
                                width: bar.width,
                                cursor: draggable ? "grab" : "pointer",
                              }}
                              tabIndex={0}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") onOpenTask(task.id);
                              }}
                              title={`${task.title} · ${dateLabel(rolled?.startsOn ?? task.startsOn)} – ${dateLabel(rolled?.dueOn ?? task.dueOn)}`}
                            >
                              <i style={{ width: `${progress}%` }} />
                              {draggable ? (
                                <span
                                  aria-hidden="true"
                                  className="pj-gantt__grip"
                                  onPointerDown={(event) =>
                                    pointerDown(event, task, "resize")
                                  }
                                  onPointerMove={pointerMove}
                                  onPointerUp={() => pointerUp(task)}
                                />
                              ) : null}
                            </div>
                          )
                        ) : null}
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
        <span className="pj-swatch pj-swatch--todo" /> offen
        <span className="pj-swatch pj-swatch--in_progress" /> in Arbeit
        <span className="pj-swatch pj-swatch--blocked" /> blockiert
        <span className="pj-swatch pj-swatch--done" /> erledigt
        <span className="pj-muted">
          {canEdit
            ? "Balken ziehen verschiebt, der rechte Rand ändert das Ende. Zeilen lassen sich am Namen in eine neue Reihenfolge oder in eine Phase ziehen. "
            : ""}
          Pfeile zeigen Abhängigkeiten.
          {undated > 0 ? ` ${undated} Elemente haben noch keinen Termin.` : ""}
        </span>
      </p>
    </>
  );
}

// ---------------------------------------------------------------------------
// Board (Kanban)
// ---------------------------------------------------------------------------

export function ProjectBoard(props: PlanProps) {
  const { canEdit, onOpenTask, run, tasks, today } = props;
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<TaskStatus | null>(null);
  const byId = useMemo(
    () => new Map(tasks.map((task) => [task.id, task])),
    [tasks],
  );
  const cards = useMemo(() => {
    const parents = new Set(tasks.map((task) => task.parentId).filter(Boolean));
    // Work happens on the elements without children.
    return buildTree(tasks)
      .map((row) => row.task)
      .filter((task) => task.kind === "task" && !parents.has(task.id));
  }, [tasks]);

  const drop = (status: TaskStatus) => {
    const task = dragId ? byId.get(dragId) : null;
    setDragId(null);
    setOver(null);
    if (!task || task.status === status) return;
    void run({ type: "updateTask", taskId: task.id, status });
  };

  return (
    <div className="pj-board">
      {TASK_STATUSES.map((status) => {
        const column = cards.filter((task) => task.status === status);
        return (
          <section
            aria-label={TASK_STATUS_LABELS[status]}
            className={`pj-column${over === status ? " is-over" : ""}`}
            key={status}
            onDragLeave={() =>
              setOver((value) => (value === status ? null : value))
            }
            onDragOver={(event) => {
              if (!dragId) return;
              event.preventDefault();
              setOver(status);
            }}
            onDrop={(event) => {
              event.preventDefault();
              drop(status);
            }}
          >
            <header>
              <span className={`pj-swatch pj-swatch--${status}`} />
              <strong>{TASK_STATUS_LABELS[status]}</strong>
              <span className="pj-count">{column.length}</span>
            </header>
            {column.length === 0 ? (
              <p className="pj-column__empty">Keine Aufgaben</p>
            ) : (
              column.map((task) => {
                const parent = task.parentId ? byId.get(task.parentId) : null;
                const done = task.checklist.filter((item) => item.done).length;
                return (
                  <article
                    className={`pj-ticket pj-ticket--${task.priority}`}
                    draggable={canEdit}
                    key={task.id}
                    onDragEnd={() => {
                      setDragId(null);
                      setOver(null);
                    }}
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", task.id);
                      setDragId(task.id);
                    }}
                  >
                    <button onClick={() => onOpenTask(task.id)} type="button">
                      {parent ? <small>{parent.title}</small> : null}
                      <strong>{task.title}</strong>
                    </button>
                    <footer>
                      {task.dueOn ? (
                        <span
                          className={`pj-chip${isOverdue(task, today) ? " pj-chip--bad" : ""}`}
                        >
                          {dateLabel(task.dueOn, false)}
                        </span>
                      ) : null}
                      {task.checklist.length ? (
                        <span className="pj-muted">
                          {done}/{task.checklist.length}
                        </span>
                      ) : null}
                      {task.priority === "high" ||
                      task.priority === "urgent" ? (
                        <span className="pj-chip pj-chip--warn">
                          {PRIORITY_LABELS[task.priority]}
                        </span>
                      ) : null}
                      <span
                        className="pj-avatar"
                        title={task.assigneeName ?? "Nicht zugewiesen"}
                      >
                        {initials(task.assigneeName)}
                      </span>
                    </footer>
                    {canEdit ? (
                      <label className="pj-visually-hidden">
                        Status von {task.title}
                        <select
                          onChange={(event) =>
                            void run({
                              type: "updateTask",
                              taskId: task.id,
                              status: event.target.value,
                            })
                          }
                          value={task.status}
                        >
                          {TASK_STATUSES.map((value) => (
                            <option key={value} value={value}>
                              {TASK_STATUS_LABELS[value]}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                  </article>
                );
              })
            )}
          </section>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Liste mit Filter, Sortierung und Massenbearbeitung
// ---------------------------------------------------------------------------

const COLUMNS: readonly (readonly [TaskSortKey, string])[] = [
  ["title", "Element"],
  ["status", "Status"],
  ["assignee", "Zuständig"],
  ["startsOn", "Start"],
  ["dueOn", "Termin"],
  ["priority", "Priorität"],
];

export function ProjectList(props: PlanProps) {
  const { canEdit, onOpenTask, people, project, rollup, run, tasks, today } =
    props;
  const [filter, setFilter] = useState<TaskFilter>(EMPTY_FILTER);
  const [sortKey, setSortKey] = useState<TaskSortKey>("plan");
  const [descending, setDescending] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState("");
  const [bulkAssignee, setBulkAssignee] = useState("");
  const [bulkPriority, setBulkPriority] = useState("");
  const [bulkShift, setBulkShift] = useState("");
  const [busy, setBusy] = useState(false);

  const tree = useMemo(() => buildTree(tasks), [tasks]);
  const depths = useMemo(
    () => new Map(tree.map((row) => [row.task.id, row.depth])),
    [tree],
  );
  const order = useMemo(
    () => new Map(tree.map((row, index) => [row.task.id, index])),
    [tree],
  );
  const visible = useMemo(
    () =>
      sortTasks(filterTasks(tasks, filter, today), sortKey, descending, order),
    [descending, filter, order, sortKey, tasks, today],
  );
  const assignees = useMemo(() => {
    const seen = new Map<string, string>();
    for (const task of tasks) {
      if (task.assigneeId) seen.set(task.assigneeId, task.assigneeName ?? "–");
    }
    return [...seen].sort((a, b) => a[1].localeCompare(b[1], "de"));
  }, [tasks]);

  // Selection only ever refers to rows that are still shown.
  const chosen = visible.filter((task) => selected.has(task.id));
  const allChosen = visible.length > 0 && chosen.length === visible.length;

  const sortBy = (key: TaskSortKey) => {
    if (sortKey === key) {
      if (descending) {
        setSortKey("plan");
        setDescending(false);
      } else setDescending(true);
    } else {
      setSortKey(key);
      setDescending(false);
    }
  };

  const applyBulk = async (patch: Record<string, unknown>) => {
    setBusy(true);
    try {
      await run({
        type: "bulkUpdateTasks",
        projectId: project.id,
        taskIds: chosen.map((task) => task.id),
        patch,
      });
      setSelected(new Set());
      setBulkStatus("");
      setBulkAssignee("");
      setBulkPriority("");
      setBulkShift("");
    } finally {
      setBusy(false);
    }
  };

  const submitBulk = (event: FormEvent) => {
    event.preventDefault();
    const patch: Record<string, unknown> = {};
    if (bulkStatus) patch.status = bulkStatus;
    if (bulkPriority) patch.priority = bulkPriority;
    if (bulkAssignee)
      patch.assigneeId = bulkAssignee === "none" ? null : bulkAssignee;
    const shift = Number(bulkShift);
    if (bulkShift.trim() && Number.isInteger(shift) && shift !== 0) {
      patch.shiftDays = shift;
    }
    if (Object.keys(patch).length) void applyBulk(patch);
  };

  const removeChosen = async () => {
    if (
      await confirmDialog(
        `${chosen.length} Elemente samt Unterelementen und gebuchten Zeiten löschen?`,
        { confirmLabel: "Löschen", tone: "danger" },
      )
    ) {
      void applyBulk({ delete: true });
    }
  };

  return (
    <>
      <div className="pj-toolbar">
        <div className="pj-actions">
          <input
            aria-label="Elemente durchsuchen"
            onChange={(event) =>
              setFilter({ ...filter, query: event.target.value })
            }
            placeholder="Titel suchen"
            type="search"
            value={filter.query}
          />
          <select
            aria-label="Status filtern"
            onChange={(event) =>
              setFilter({
                ...filter,
                status: event.target.value as TaskFilter["status"],
              })
            }
            value={filter.status}
          >
            <option value="all">Alle Status</option>
            <option value="open">Nicht erledigt</option>
            <option value="overdue">Überfällig</option>
            {TASK_STATUSES.map((status) => (
              <option key={status} value={status}>
                {TASK_STATUS_LABELS[status]}
              </option>
            ))}
          </select>
          <select
            aria-label="Zuständige Person filtern"
            onChange={(event) =>
              setFilter({ ...filter, assigneeId: event.target.value })
            }
            value={filter.assigneeId}
          >
            <option value="all">Alle Personen</option>
            <option value="none">Nicht zugewiesen</option>
            {assignees.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
          <select
            aria-label="Art filtern"
            onChange={(event) =>
              setFilter({
                ...filter,
                kind: event.target.value as TaskFilter["kind"],
              })
            }
            value={filter.kind}
          >
            <option value="all">Alle Arten</option>
            <option value="task">Aufgaben</option>
            <option value="milestone">Meilensteine</option>
            <option value="phase">Phasen</option>
          </select>
        </div>
        {canEdit ? (
          <QuickAdd projectId={project.id} run={run} tasks={tasks} />
        ) : null}
      </div>

      {canEdit && chosen.length > 0 ? (
        <form className="pj-bulk" onSubmit={submitBulk}>
          <strong>{chosen.length} ausgewählt</strong>
          <select
            aria-label="Status setzen"
            onChange={(event) => setBulkStatus(event.target.value)}
            value={bulkStatus}
          >
            <option value="">Status …</option>
            {TASK_STATUSES.map((status) => (
              <option key={status} value={status}>
                {TASK_STATUS_LABELS[status]}
              </option>
            ))}
          </select>
          <select
            aria-label="Zuweisen an"
            onChange={(event) => setBulkAssignee(event.target.value)}
            value={bulkAssignee}
          >
            <option value="">Zuweisen …</option>
            <option value="none">Niemand</option>
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Priorität setzen"
            onChange={(event) => setBulkPriority(event.target.value)}
            value={bulkPriority}
          >
            <option value="">Priorität …</option>
            {(Object.keys(PRIORITY_LABELS) as TaskPriority[]).map(
              (priority) => (
                <option key={priority} value={priority}>
                  {PRIORITY_LABELS[priority]}
                </option>
              ),
            )}
          </select>
          <input
            aria-label="Termine um Tage verschieben"
            className="pj-narrow"
            inputMode="numeric"
            onChange={(event) => setBulkShift(event.target.value)}
            placeholder="± Tage"
            value={bulkShift}
          />
          <button
            className="pj-button pj-button--primary"
            disabled={busy}
            type="submit"
          >
            Anwenden
          </button>
          <button
            className="pj-button pj-button--danger"
            disabled={busy}
            onClick={() => void removeChosen()}
            type="button"
          >
            Löschen
          </button>
        </form>
      ) : null}

      <section className="pj-card pj-card--flush">
        {visible.length === 0 ? (
          <p className="pj-empty">
            {tasks.length === 0
              ? "Der Projektplan ist noch leer."
              : "Kein Element passt zu diesem Filter."}
          </p>
        ) : (
          <div className="pj-table-wrap">
            <table className="pj-table pj-table--list">
              <thead>
                <tr>
                  {canEdit ? (
                    <th className="pj-check-cell">
                      <input
                        aria-label="Alle auswählen"
                        checked={allChosen}
                        onChange={() =>
                          setSelected(
                            allChosen
                              ? new Set()
                              : new Set(visible.map((task) => task.id)),
                          )
                        }
                        type="checkbox"
                      />
                    </th>
                  ) : null}
                  {COLUMNS.map(([key, label]) => (
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
                        type="button"
                      >
                        {label}
                        {sortKey === key ? (descending ? " ↓" : " ↑") : ""}
                      </button>
                    </th>
                  ))}
                  <th>Fortschritt</th>
                  <th>Soll</th>
                  <th>Ist</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((task) => {
                  const rolled = rollup.get(task.id);
                  const indent =
                    sortKey === "plan" ? (depths.get(task.id) ?? 0) : 0;
                  return (
                    <tr className={`pj-row--${task.kind}`} key={task.id}>
                      {canEdit ? (
                        <td className="pj-check-cell">
                          <input
                            aria-label={`${task.title} auswählen`}
                            checked={selected.has(task.id)}
                            onChange={() =>
                              setSelected((current) => {
                                const next = new Set(current);
                                if (next.has(task.id)) next.delete(task.id);
                                else next.add(task.id);
                                return next;
                              })
                            }
                            type="checkbox"
                          />
                        </td>
                      ) : null}
                      <td>
                        <button
                          className="pj-plain"
                          onClick={() => onOpenTask(task.id)}
                          style={{ paddingLeft: indent * 18 }}
                          type="button"
                        >
                          <span className="pj-two-line">
                            <strong>{task.title}</strong>
                            {task.kind !== "task" ? (
                              <small>{TASK_KIND_LABELS[task.kind]}</small>
                            ) : null}
                          </span>
                        </button>
                      </td>
                      <td>
                        {task.kind === "phase" ? (
                          "–"
                        ) : (
                          <span className={`pj-chip pj-chip--${task.status}`}>
                            {TASK_STATUS_LABELS[task.status]}
                          </span>
                        )}
                      </td>
                      <td>{task.assigneeName ?? "–"}</td>
                      <td>{dateLabel(rolled?.startsOn ?? task.startsOn)}</td>
                      <td
                        className={
                          isOverdue(task, today) ? "pj-late" : undefined
                        }
                      >
                        {dateLabel(rolled?.dueOn ?? task.dueOn)}
                      </td>
                      <td>
                        {task.kind === "phase"
                          ? "–"
                          : PRIORITY_LABELS[task.priority]}
                      </td>
                      <td>{rolled?.progressPercent ?? 0} %</td>
                      <td>
                        {rolled?.estimatedMinutes
                          ? hoursLabel(rolled.estimatedMinutes)
                          : "–"}
                      </td>
                      <td>
                        {rolled?.bookedMinutes
                          ? hoursLabel(rolled.bookedMinutes)
                          : "–"}
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
