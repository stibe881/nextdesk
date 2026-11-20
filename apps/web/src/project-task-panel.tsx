import { Paperclip, Trash2, X } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { confirmDialog } from "./app-dialog";
import {
  type DependencyType,
  type LinkKind,
  type Named,
  type ProjectAttachment,
  type ProjectComment,
  type ProjectDetailData,
  type ProjectLink,
  type ProjectTask,
  projectsCall,
  type TaskPriority,
  uploadProjectAttachment,
} from "./lib/projects-api";
import {
  buildTree,
  dateLabel,
  dateTimeLabel,
  DEPENDENCY_LABELS,
  hoursInput,
  hoursLabel,
  LINK_KIND_LABELS,
  LINK_KINDS,
  linkStateLabel,
  parseHours,
  PRIORITY_LABELS,
  type Rollup,
  TASK_KIND_LABELS,
  TASK_STATUS_LABELS,
  TASK_STATUSES,
} from "./lib/projects-model";

type Run = (body: Record<string, unknown>) => Promise<unknown>;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ---------------------------------------------------------------------------
// Gemeinsame Bausteine: Kommentare, Anhänge, Verknüpfungen
// ---------------------------------------------------------------------------

export function CommentThread({
  canComment,
  canModerate,
  comments,
  isGuest,
  projectId,
  run,
  taskId,
}: {
  canComment: boolean;
  canModerate: boolean;
  comments: ProjectComment[];
  isGuest: boolean;
  projectId: string;
  run: Run;
  taskId: string | null;
}) {
  const [body, setBody] = useState("");
  const [external, setExternal] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    try {
      await run({
        type: "addComment",
        projectId,
        taskId,
        body,
        visibility: external ? "external" : "internal",
      });
      setBody("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pj-thread">
      {comments.length === 0 ? (
        <p className="pj-hint">Noch keine Kommentare.</p>
      ) : (
        comments.map((comment) => (
          <article
            className={`pj-comment${comment.visibility === "external" && !isGuest ? " pj-comment--external" : ""}`}
            key={comment.id}
          >
            <header>
              <strong>{comment.authorName}</strong>
              <span className="pj-muted">
                {dateTimeLabel(comment.createdAt)}
              </span>
              {comment.visibility === "external" && !isGuest ? (
                <span className="pj-chip pj-chip--warn">
                  für Gäste sichtbar
                </span>
              ) : null}
              {comment.mine || canModerate ? (
                <button
                  aria-label="Kommentar löschen"
                  className="pj-icon"
                  onClick={() =>
                    void run({ type: "deleteComment", commentId: comment.id })
                  }
                  type="button"
                >
                  <Trash2 aria-hidden="true" size={13} />
                </button>
              ) : null}
            </header>
            <div className="pj-markdown">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {comment.body}
              </ReactMarkdown>
            </div>
          </article>
        ))
      )}
      {canComment ? (
        <form className="pj-compose" onSubmit={(event) => void submit(event)}>
          <textarea
            aria-label="Kommentar"
            maxLength={20000}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Kommentar schreiben (Markdown möglich)"
            rows={3}
            value={body}
          />
          <div className="pj-actions">
            {!isGuest ? (
              <label className="pj-check">
                <input
                  checked={external}
                  onChange={(event) => setExternal(event.target.checked)}
                  type="checkbox"
                />
                Für Gäste sichtbar
              </label>
            ) : null}
            <button
              className="pj-button pj-button--primary"
              disabled={busy || !body.trim()}
              type="submit"
            >
              Kommentieren
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

function sizeLabel(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function AttachmentList({
  attachments,
  canEdit,
  onChanged,
  projectId,
  taskId,
  tenantId,
}: {
  attachments: ProjectAttachment[];
  canEdit: boolean;
  onChanged: () => void;
  projectId: string;
  taskId: string | null;
  tenantId: string;
}) {
  const input = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    setError("");
    try {
      for (const file of [...files]) {
        await uploadProjectAttachment(tenantId, { projectId, taskId }, file);
      }
    } catch (nextError) {
      setError(errorText(nextError));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
      onChanged();
    }
  };

  const open = async (attachment: ProjectAttachment) => {
    try {
      const { url } = await projectsCall<{ url: string }>({
        type: "attachmentUrl",
        tenantId,
        attachmentId: attachment.id,
      });
      window.open(url, "_blank", "noopener");
    } catch (nextError) {
      setError(errorText(nextError));
    }
  };

  const remove = async (attachment: ProjectAttachment) => {
    if (
      !(await confirmDialog(`«${attachment.filename}» löschen?`, {
        confirmLabel: "Löschen",
        tone: "danger",
      }))
    ) {
      return;
    }
    try {
      await projectsCall({
        type: "deleteAttachment",
        tenantId,
        attachmentId: attachment.id,
      });
      onChanged();
    } catch (nextError) {
      setError(errorText(nextError));
    }
  };

  return (
    <div>
      {attachments.length === 0 ? (
        <p className="pj-hint">Keine Anhänge.</p>
      ) : (
        <ul className="pj-rows pj-rows--compact">
          {attachments.map((attachment) => (
            <li key={attachment.id}>
              <button
                className="pj-plain"
                onClick={() => void open(attachment)}
                type="button"
              >
                <span className="pj-two-line">
                  <strong>
                    <Paperclip aria-hidden="true" size={12} />{" "}
                    {attachment.filename}
                  </strong>
                  <small>
                    {sizeLabel(attachment.byteSize)} ·{" "}
                    {attachment.uploadedByName ?? "–"} ·{" "}
                    {dateTimeLabel(attachment.createdAt)}
                  </small>
                </span>
              </button>
              {canEdit ? (
                <button
                  aria-label={`${attachment.filename} löschen`}
                  className="pj-icon"
                  onClick={() => void remove(attachment)}
                  type="button"
                >
                  <Trash2 aria-hidden="true" size={13} />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {error ? (
        <p className="pj-error" role="alert">
          {error}
        </p>
      ) : null}
      {canEdit ? (
        <label className="pj-upload">
          <input
            accept="application/pdf,image/png,image/jpeg,image/webp"
            disabled={busy}
            multiple
            onChange={(event) => void upload(event.target.files)}
            ref={input}
            type="file"
          />
          <span className="pj-button">
            {busy ? "Lädt hoch …" : "Datei anhängen (PDF oder Bild)"}
          </span>
        </label>
      ) : null}
    </div>
  );
}

export function LinkList({
  canEdit,
  links,
  onOpenTicket,
  run,
}: {
  canEdit: boolean;
  links: ProjectLink[];
  onOpenTicket?: ((ticketId: string) => void) | undefined;
  run: Run;
}) {
  if (links.length === 0)
    return <p className="pj-hint">Keine Verknüpfungen.</p>;
  return (
    <ul className="pj-rows pj-rows--compact">
      {links.map((link) => {
        const body = (
          <span className="pj-two-line">
            <strong>
              {link.label}
              {link.detail ? ` · ${link.detail}` : ""}
            </strong>
            <small>
              {LINK_KIND_LABELS[link.targetKind]}
              {link.state ? ` · ${linkStateLabel(link.state)}` : ""}
              {link.assigneeName ? ` · ${link.assigneeName}` : ""}
              {link.bookedMinutes
                ? ` · ${hoursLabel(link.bookedMinutes)} gebucht`
                : ""}
            </small>
          </span>
        );
        return (
          <li key={link.id}>
            {link.targetKind === "ticket" && onOpenTicket ? (
              <button
                className="pj-plain"
                onClick={() => onOpenTicket(link.targetId)}
                type="button"
              >
                {body}
              </button>
            ) : (
              body
            )}
            {canEdit ? (
              <button
                aria-label={`Verknüpfung zu ${link.label} entfernen`}
                className="pj-icon"
                onClick={() =>
                  void run({ type: "unlinkRecord", linkId: link.id })
                }
                type="button"
              >
                <X aria-hidden="true" size={13} />
              </button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/** Sucht einen Eintrag einer Art und verknüpft ihn mit Projekt oder Element. */
export function LinkPicker({
  projectId,
  run,
  taskId,
  tenantId,
}: {
  projectId: string;
  run: Run;
  taskId: string | null;
  tenantId: string;
}) {
  const [kind, setKind] = useState<LinkKind>("ticket");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<
    { id: string; label: string; detail: string | null }[] | null
  >(null);
  const [error, setError] = useState("");
  const version = useRef(0);

  useEffect(() => {
    const current = ++version.current;
    setError("");
    const timer = window.setTimeout(() => {
      projectsCall<{
        results: { id: string; label: string; detail: string | null }[];
      }>({
        type: "searchLinkable",
        tenantId,
        targetKind: kind,
        query,
      })
        .then((data) => {
          if (version.current === current) setResults(data.results);
        })
        .catch((nextError) => {
          if (version.current !== current) return;
          setResults([]);
          setError(errorText(nextError));
        });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [kind, query, tenantId]);

  return (
    <div className="pj-picker">
      <div className="pj-actions">
        <select
          aria-label="Art der Verknüpfung"
          onChange={(event) => {
            setResults(null);
            setKind(event.target.value as LinkKind);
          }}
          value={kind}
        >
          {LINK_KINDS.map((value) => (
            <option key={value} value={value}>
              {LINK_KIND_LABELS[value]}
            </option>
          ))}
        </select>
        <input
          aria-label="Suchen"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Nummer, Name oder Adresse"
          type="search"
          value={query}
        />
      </div>
      {error ? (
        <p className="pj-error" role="alert">
          {error}
        </p>
      ) : results === null ? (
        <p className="pj-hint">Sucht …</p>
      ) : results.length === 0 ? (
        <p className="pj-hint">Nichts gefunden.</p>
      ) : (
        <ul className="pj-rows pj-rows--compact">
          {results.map((result) => (
            <li key={result.id}>
              <span className="pj-two-line">
                <strong>{result.label}</strong>
                {result.detail ? <small>{result.detail}</small> : null}
              </span>
              <button
                className="pj-button"
                onClick={() =>
                  void run({
                    type: "linkRecord",
                    projectId,
                    taskId,
                    targetKind: kind,
                    targetId: result.id,
                  })
                }
                type="button"
              >
                Verknüpfen
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Seitenleiste eines Elements
// ---------------------------------------------------------------------------

function Section({
  children,
  title,
}: {
  children: React.ReactNode;
  title: string;
}) {
  return (
    <section className="pj-panel__section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

export function TaskPanel({
  data,
  onClose,
  onOpenTask,
  onOpenTicket,
  onReload,
  people,
  rollup,
  run,
  task,
  teams,
  tenantId,
}: {
  data: ProjectDetailData;
  onClose: () => void;
  onOpenTask: (taskId: string) => void;
  onOpenTicket?: ((ticketId: string) => void) | undefined;
  onReload: () => void;
  people: Named[];
  rollup: Map<string, Rollup>;
  run: Run;
  task: ProjectTask;
  teams: Named[];
  tenantId: string;
}) {
  const { access, project } = data;
  const canEdit = access.canEdit;
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [estimate, setEstimate] = useState(hoursInput(task.estimatedMinutes));
  const [checkItem, setCheckItem] = useState("");
  const [hours, setHours] = useState("");
  const [note, setNote] = useState("");
  const [billing, setBilling] = useState("internal");
  const [predecessorId, setPredecessorId] = useState("");
  const [dependencyType, setDependencyType] =
    useState<DependencyType>("finish_to_start");
  const [lagDays, setLagDays] = useState("0");
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setTitle(task.title);
    setDescription(task.description ?? "");
    setEstimate(hoursInput(task.estimatedMinutes));
  }, [task.description, task.estimatedMinutes, task.id, task.title]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const patch = (fields: Record<string, unknown>) =>
    run({ type: "updateTask", taskId: task.id, ...fields });

  const children = data.tasks.filter((other) => other.parentId === task.id);
  const hasChildren = children.length > 0;
  const rolled = rollup.get(task.id);
  const byId = new Map(data.tasks.map((other) => [other.id, other]));
  const predecessors = data.dependencies.filter(
    (d) => d.successorId === task.id,
  );
  const successors = data.dependencies.filter(
    (d) => d.predecessorId === task.id,
  );
  const taken = new Set([task.id, ...predecessors.map((d) => d.predecessorId)]);
  const candidates = buildTree(data.tasks).filter(
    (row) => !taken.has(row.task.id),
  );
  const parentOptions = buildTree(data.tasks).filter((row) => {
    if (row.task.id === task.id || row.task.parentId === task.id) return false;
    if (task.kind === "phase") return false;
    if (task.kind === "milestone") return row.task.kind === "phase";
    if (row.task.kind === "phase") return true;
    // A task may sit under a task that is not itself a subtask, and only
    // while it has no subtasks of its own.
    return (
      row.task.kind === "task" &&
      !hasChildren &&
      byId.get(row.task.parentId ?? "")?.kind !== "task"
    );
  });
  const entries = data.timeEntries.filter((entry) => entry.taskId === task.id);
  const links = data.links.filter((link) => link.taskId === task.id);
  const comments = data.comments.filter(
    (comment) => comment.taskId === task.id,
  );
  const attachments = data.attachments.filter((a) => a.taskId === task.id);

  const saveEstimate = () => {
    const minutes = estimate.trim() ? parseHours(estimate) : null;
    if (estimate.trim() && minutes === null) {
      setError("Die Schätzung ist keine gültige Zahl.");
      return;
    }
    setError("");
    if (minutes !== task.estimatedMinutes)
      void patch({ estimatedMinutes: minutes });
  };

  const addTime = async (event: FormEvent) => {
    event.preventDefault();
    const minutes = parseHours(hours);
    if (!minutes || minutes > 1440) {
      setError("Die Dauer muss zwischen 0 und 24 Stunden liegen.");
      return;
    }
    setError("");
    await run({
      type: "addTimeEntry",
      taskId: task.id,
      minutes,
      note,
      billingKind: billing,
    });
    setHours("");
    setNote("");
  };

  const addDependency = async (event: FormEvent) => {
    event.preventDefault();
    if (!predecessorId) return;
    await run({
      type: "addDependency",
      projectId: project.id,
      predecessorId,
      successorId: task.id,
      dependencyType,
      lagDays: Number.isInteger(Number(lagDays)) ? Number(lagDays) : 0,
    });
    setPredecessorId("");
    setLagDays("0");
  };

  const remove = async () => {
    const message = hasChildren
      ? `«${task.title}» samt ${children.length} Unterelementen und gebuchten Zeiten löschen?`
      : `«${task.title}» löschen? Gebuchte Zeiten gehen dabei verloren.`;
    if (
      await confirmDialog(message, { confirmLabel: "Löschen", tone: "danger" })
    ) {
      onClose();
      await run({ type: "deleteTask", taskId: task.id });
    }
  };

  return (
    <aside
      aria-label={`${TASK_KIND_LABELS[task.kind]} ${task.title}`}
      className="pj-panel"
    >
      <header className="pj-panel__head">
        <div>
          <p className="pj-eyebrow">
            {TASK_KIND_LABELS[task.kind]}
            {task.parentId && byId.get(task.parentId)
              ? ` in ${byId.get(task.parentId)!.title}`
              : ""}
          </p>
          {canEdit ? (
            <input
              aria-label="Titel"
              className="pj-panel__title"
              maxLength={240}
              onBlur={() => {
                if (title.trim() && title !== task.title) void patch({ title });
                else setTitle(task.title);
              }}
              onChange={(event) => setTitle(event.target.value)}
              value={title}
            />
          ) : (
            <h2>{task.title}</h2>
          )}
        </div>
        <button
          aria-label="Schliessen"
          className="icon-button"
          onClick={onClose}
          type="button"
        >
          <X aria-hidden="true" size={18} />
        </button>
      </header>

      {error ? (
        <p className="pj-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="pj-panel__grid">
        <label>
          Status
          <select
            disabled={!canEdit}
            onChange={(event) => void patch({ status: event.target.value })}
            value={task.status}
          >
            {TASK_STATUSES.map((status) => (
              <option key={status} value={status}>
                {TASK_STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Priorität
          <select
            disabled={!canEdit}
            onChange={(event) => void patch({ priority: event.target.value })}
            value={task.priority}
          >
            {(Object.keys(PRIORITY_LABELS) as TaskPriority[]).map(
              (priority) => (
                <option key={priority} value={priority}>
                  {PRIORITY_LABELS[priority]}
                </option>
              ),
            )}
          </select>
        </label>
        <label>
          Zuständig
          {canEdit ? (
            <select
              onChange={(event) =>
                void patch({ assigneeId: event.target.value || null })
              }
              value={task.assigneeId ?? ""}
            >
              <option value="">Niemand</option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
          ) : (
            <output>{task.assigneeName ?? "–"}</output>
          )}
        </label>
        {!access.isGuest ? (
          <label>
            Team
            <select
              disabled={!canEdit}
              onChange={(event) =>
                void patch({ teamId: event.target.value || null })
              }
              value={task.teamId ?? ""}
            >
              <option value="">Kein Team</option>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {hasChildren ? (
          <label className="pj-span-2">
            Zeitraum
            <output>
              {dateLabel(rolled?.startsOn ?? null)} –{" "}
              {dateLabel(rolled?.dueOn ?? null)} (aus den Unterelementen)
            </output>
          </label>
        ) : task.kind === "milestone" ? (
          <label>
            Termin
            <input
              disabled={!canEdit}
              onChange={(event) =>
                void patch({ dueOn: event.target.value || null })
              }
              type="date"
              value={task.dueOn ?? ""}
            />
          </label>
        ) : (
          <>
            <label>
              Start
              <input
                disabled={!canEdit}
                max={task.dueOn ?? undefined}
                onChange={(event) =>
                  void patch({ startsOn: event.target.value || null })
                }
                type="date"
                value={task.startsOn ?? ""}
              />
            </label>
            <label>
              Termin
              <input
                disabled={!canEdit}
                min={task.startsOn ?? undefined}
                onChange={(event) =>
                  void patch({ dueOn: event.target.value || null })
                }
                type="date"
                value={task.dueOn ?? ""}
              />
            </label>
          </>
        )}
        {task.kind === "task" && !access.isGuest ? (
          hasChildren ? (
            <label>
              Schätzung
              <output>
                {hoursLabel(rolled?.estimatedMinutes ?? 0)} (Summe)
              </output>
            </label>
          ) : (
            <label>
              Schätzung (Stunden)
              <input
                disabled={!canEdit}
                inputMode="decimal"
                onBlur={saveEstimate}
                onChange={(event) => setEstimate(event.target.value)}
                value={estimate}
              />
            </label>
          )
        ) : null}
        {task.kind === "task" ? (
          hasChildren ? (
            <label>
              Fortschritt
              <output>{rolled?.progressPercent ?? 0} %</output>
            </label>
          ) : (
            <label>
              Fortschritt: {task.status === "done" ? 100 : task.progressPercent}{" "}
              %
              <input
                disabled={!canEdit || task.status === "done"}
                max={100}
                min={0}
                onChange={(event) =>
                  void patch({ progressPercent: Number(event.target.value) })
                }
                step={10}
                type="range"
                value={task.status === "done" ? 100 : task.progressPercent}
              />
            </label>
          )
        ) : null}
        {canEdit && task.kind !== "phase" ? (
          <label className="pj-span-2">
            Eingeordnet unter
            <select
              onChange={(event) =>
                void patch({ parentId: event.target.value || null })
              }
              value={task.parentId ?? ""}
            >
              <option value="">Oberste Ebene</option>
              {parentOptions.map((row) => (
                <option key={row.task.id} value={row.task.id}>
                  {"– ".repeat(row.depth)}
                  {row.task.title}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      <Section title="Beschreibung">
        {canEdit ? (
          <textarea
            aria-label="Beschreibung"
            maxLength={20000}
            onBlur={() => {
              if (description !== (task.description ?? ""))
                void patch({ description });
            }}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Was ist zu tun? (Markdown möglich)"
            rows={4}
            value={description}
          />
        ) : task.description ? (
          <div className="pj-markdown">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {task.description}
            </ReactMarkdown>
          </div>
        ) : (
          <p className="pj-hint">Keine Beschreibung.</p>
        )}
      </Section>

      {hasChildren ? (
        <Section title="Unterelemente">
          <ul className="pj-rows pj-rows--compact">
            {children.map((child) => (
              <li key={child.id}>
                <button
                  className="pj-plain"
                  onClick={() => onOpenTask(child.id)}
                  type="button"
                >
                  {child.title}
                </button>
                <span className={`pj-chip pj-chip--${child.status}`}>
                  {TASK_STATUS_LABELS[child.status]}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {task.kind !== "phase" ? (
        <Section
          title={`Checkliste${task.checklist.length ? ` (${task.checklist.filter((i) => i.done).length}/${task.checklist.length})` : ""}`}
        >
          {task.checklist.length === 0 && !canEdit ? (
            <p className="pj-hint">Keine Punkte.</p>
          ) : null}
          <ul className="pj-checklist">
            {task.checklist.map((item) => (
              <li key={item.id}>
                <label className={item.done ? "is-done" : undefined}>
                  <input
                    checked={item.done}
                    disabled={!canEdit}
                    onChange={(event) =>
                      void run({
                        type: "setChecklistItem",
                        itemId: item.id,
                        done: event.target.checked,
                      })
                    }
                    type="checkbox"
                  />
                  {item.description}
                </label>
                {canEdit ? (
                  <button
                    aria-label={`${item.description} entfernen`}
                    className="pj-icon"
                    onClick={() =>
                      void run({ type: "deleteChecklistItem", itemId: item.id })
                    }
                    type="button"
                  >
                    <X aria-hidden="true" size={13} />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          {canEdit ? (
            <form
              className="pj-inline"
              onSubmit={(event) => {
                event.preventDefault();
                if (!checkItem.trim()) return;
                void run({
                  type: "addChecklistItem",
                  taskId: task.id,
                  description: checkItem,
                }).then(() => setCheckItem(""));
              }}
            >
              <input
                aria-label="Neuer Punkt"
                maxLength={500}
                onChange={(event) => setCheckItem(event.target.value)}
                placeholder="Punkt hinzufügen"
                value={checkItem}
              />
              <button
                className="pj-button"
                disabled={!checkItem.trim()}
                type="submit"
              >
                Hinzufügen
              </button>
            </form>
          ) : null}
        </Section>
      ) : null}

      <Section title="Abhängigkeiten">
        {predecessors.length === 0 && successors.length === 0 ? (
          <p className="pj-hint">Keine Abhängigkeiten.</p>
        ) : (
          <ul className="pj-rows pj-rows--compact">
            {predecessors.map((dependency) => (
              <li key={dependency.id}>
                <button
                  className="pj-plain"
                  onClick={() => onOpenTask(dependency.predecessorId)}
                  type="button"
                >
                  <span className="pj-two-line">
                    <strong>
                      Wartet auf:{" "}
                      {byId.get(dependency.predecessorId)?.title ?? "–"}
                    </strong>
                    <small>
                      {DEPENDENCY_LABELS[dependency.type]}
                      {dependency.lagDays
                        ? `, ${dependency.lagDays > 0 ? "+" : ""}${dependency.lagDays} Arbeitstage`
                        : ""}
                    </small>
                  </span>
                </button>
                {canEdit ? (
                  <button
                    aria-label="Abhängigkeit entfernen"
                    className="pj-icon"
                    onClick={() =>
                      void run({
                        type: "removeDependency",
                        dependencyId: dependency.id,
                      })
                    }
                    type="button"
                  >
                    <X aria-hidden="true" size={13} />
                  </button>
                ) : null}
              </li>
            ))}
            {successors.map((dependency) => (
              <li key={dependency.id}>
                <button
                  className="pj-plain"
                  onClick={() => onOpenTask(dependency.successorId)}
                  type="button"
                >
                  <span className="pj-two-line">
                    <strong>
                      Danach folgt:{" "}
                      {byId.get(dependency.successorId)?.title ?? "–"}
                    </strong>
                    <small>{DEPENDENCY_LABELS[dependency.type]}</small>
                  </span>
                </button>
                {canEdit ? (
                  <button
                    aria-label="Abhängigkeit entfernen"
                    className="pj-icon"
                    onClick={() =>
                      void run({
                        type: "removeDependency",
                        dependencyId: dependency.id,
                      })
                    }
                    type="button"
                  >
                    <X aria-hidden="true" size={13} />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {canEdit && candidates.length > 0 ? (
          <form
            className="pj-inline pj-inline--wrap"
            onSubmit={(event) => void addDependency(event)}
          >
            <select
              aria-label="Vorgänger"
              onChange={(event) => setPredecessorId(event.target.value)}
              value={predecessorId}
            >
              <option value="">Wartet auf …</option>
              {candidates.map((row) => (
                <option key={row.task.id} value={row.task.id}>
                  {"– ".repeat(row.depth)}
                  {row.task.title}
                </option>
              ))}
            </select>
            <select
              aria-label="Art der Abhängigkeit"
              onChange={(event) =>
                setDependencyType(event.target.value as DependencyType)
              }
              value={dependencyType}
            >
              {(Object.keys(DEPENDENCY_LABELS) as DependencyType[]).map(
                (type) => (
                  <option key={type} value={type}>
                    {DEPENDENCY_LABELS[type]}
                  </option>
                ),
              )}
            </select>
            <input
              aria-label="Abstand in Arbeitstagen"
              className="pj-narrow"
              inputMode="numeric"
              onChange={(event) => setLagDays(event.target.value)}
              title="Abstand in Arbeitstagen"
              value={lagDays}
            />
            <button
              className="pj-button"
              disabled={!predecessorId}
              type="submit"
            >
              Hinzufügen
            </button>
          </form>
        ) : null}
      </Section>

      {!access.isGuest && task.kind !== "milestone" ? (
        <Section
          title={`Zeit: ${hoursLabel(rolled?.bookedMinutes ?? 0)} gebucht${rolled?.estimatedMinutes ? ` von ${hoursLabel(rolled.estimatedMinutes)}` : ""}`}
        >
          {canEdit ? (
            <form
              className="pj-inline pj-inline--wrap"
              onSubmit={(event) => void addTime(event)}
            >
              <input
                aria-label="Stunden"
                className="pj-narrow"
                inputMode="decimal"
                onChange={(event) => setHours(event.target.value)}
                placeholder="Std."
                value={hours}
              />
              <input
                aria-label="Notiz"
                maxLength={2000}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Was wurde gemacht?"
                value={note}
              />
              <select
                aria-label="Verrechnung"
                onChange={(event) => setBilling(event.target.value)}
                value={billing}
              >
                <option value="internal">Intern</option>
                <option value="billable">Verrechenbar</option>
                <option value="goodwill">Kulanz</option>
              </select>
              <button
                className="pj-button pj-button--primary"
                disabled={!hours.trim()}
                type="submit"
              >
                Zeit buchen
              </button>
            </form>
          ) : null}
          {entries.length > 0 ? (
            <ul className="pj-rows pj-rows--compact">
              {entries.map((entry) => (
                <li key={entry.id}>
                  <span className="pj-two-line">
                    <strong>
                      {hoursLabel(entry.minutes)} · {entry.authorName}
                    </strong>
                    <small>
                      {dateTimeLabel(entry.createdAt)}
                      {entry.note ? ` · ${entry.note}` : ""}
                    </small>
                  </span>
                  {access.canAdmin || (canEdit && entry.mine) ? (
                    <button
                      aria-label="Zeiteintrag löschen"
                      className="pj-icon"
                      onClick={() =>
                        void run({ type: "deleteTimeEntry", entryId: entry.id })
                      }
                      type="button"
                    >
                      <Trash2 aria-hidden="true" size={13} />
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </Section>
      ) : null}

      {!access.isGuest ? (
        <Section title="Verknüpfungen">
          <LinkList
            canEdit={canEdit}
            links={links}
            onOpenTicket={onOpenTicket}
            run={run}
          />
          {canEdit ? (
            linking ? (
              <LinkPicker
                projectId={project.id}
                run={run}
                taskId={task.id}
                tenantId={tenantId}
              />
            ) : (
              <button
                className="pj-button"
                onClick={() => setLinking(true)}
                type="button"
              >
                Ticket, Netz oder Gerät verknüpfen
              </button>
            )
          ) : null}
        </Section>
      ) : null}

      {!access.isGuest ? (
        <Section title="Anhänge">
          <AttachmentList
            attachments={attachments}
            canEdit={canEdit}
            onChanged={onReload}
            projectId={project.id}
            taskId={task.id}
            tenantId={tenantId}
          />
        </Section>
      ) : null}

      <Section title="Kommentare">
        <CommentThread
          canComment={access.canComment}
          canModerate={access.canAdmin}
          comments={comments}
          isGuest={access.isGuest}
          projectId={project.id}
          run={run}
          taskId={task.id}
        />
      </Section>

      {canEdit ? (
        <footer className="pj-panel__foot">
          <button
            className="pj-button pj-button--danger"
            onClick={() => void remove()}
            type="button"
          >
            Element löschen
          </button>
        </footer>
      ) : null}
    </aside>
  );
}
