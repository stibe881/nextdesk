import { ArrowLeft, MoreHorizontal } from "lucide-react";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { confirmDialog, promptDialog } from "./app-dialog";
import {
  type PlannedChange,
  type ProjectDetailData,
  type ProjectDocument,
  type ProjectHealth,
  type ProjectModuleAccess,
  type ProjectOptions,
  type ProjectRole,
  type ProjectStatus,
  projectsCall,
  type ScheduleOutcome,
} from "./lib/projects-api";
import {
  buildTree,
  dateLabel,
  dateTimeLabel,
  HEALTH_LABELS,
  hoursLabel,
  isOverdue,
  LINK_KIND_LABELS,
  LINK_KINDS,
  linkStateLabel,
  localToday,
  moneyLabel,
  PROJECT_STATUS_LABELS,
  ROLE_LABELS,
  rollupTasks,
  suggestHealth,
  TASK_STATUS_LABELS,
} from "./lib/projects-model";
import { ProjectBoard, ProjectGantt, ProjectList } from "./project-plan";
import {
  AttachmentList,
  CommentThread,
  LinkList,
  LinkPicker,
  TaskPanel,
} from "./project-task-panel";
import { HealthDot, ProgressBar, ProjectForm } from "./project-form";

type Tab =
  | "overview"
  | "gantt"
  | "board"
  | "list"
  | "budget"
  | "docs"
  | "links"
  | "team";

type Run = (body: Record<string, unknown>) => Promise<unknown>;

const EVENT_LABELS: Record<string, string> = {
  "project.created": "Projekt angelegt",
  "project.updated": "Projekt geändert",
  "project.archived": "Projekt archiviert",
  "project.restored": "Projekt aus dem Archiv geholt",
  "task.created": "Element angelegt",
  "task.updated": "Element geändert",
  "task.deleted": "Element gelöscht",
  "task.bulk_updated": "Mehrere Elemente geändert",
  "task.bulk_deleted": "Mehrere Elemente gelöscht",
  "schedule.shifted": "Termine nachgeführt",
  "dependency.added": "Abhängigkeit hinzugefügt",
  "dependency.removed": "Abhängigkeit entfernt",
  "time_entry.added": "Zeit gebucht",
  "time_entry.deleted": "Zeiteintrag gelöscht",
  "link.added": "Verknüpfung hinzugefügt",
  "link.removed": "Verknüpfung entfernt",
  "document.created": "Dokument angelegt",
  "document.deleted": "Dokument gelöscht",
  "attachment.added": "Datei angehängt",
  "member.set": "Mitglied gespeichert",
  "member.removed": "Mitglied entfernt",
  "guest.invited": "Gast eingeladen",
  "template.saved": "Als Vorlage gespeichert",
};

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function eventDetail(payload: Record<string, unknown>): string {
  const parts: string[] = [];
  if (typeof payload.title === "string") parts.push(payload.title);
  if (
    typeof payload.status === "string" &&
    payload.status in TASK_STATUS_LABELS
  ) {
    parts.push(
      TASK_STATUS_LABELS[payload.status as keyof typeof TASK_STATUS_LABELS],
    );
  } else if (
    typeof payload.status === "string" &&
    payload.status in PROJECT_STATUS_LABELS
  ) {
    parts.push(PROJECT_STATUS_LABELS[payload.status as ProjectStatus]);
  }
  if (typeof payload.minutes === "number")
    parts.push(hoursLabel(payload.minutes));
  if (typeof payload.count === "number")
    parts.push(`${payload.count} Elemente`);
  if (typeof payload.email === "string") parts.push(payload.email);
  if (typeof payload.name === "string") parts.push(payload.name);
  if (typeof payload.fromTicket === "string")
    parts.push(`aus Ticket ${payload.fromTicket}`);
  if (typeof payload.fromShopOrder === "string") {
    parts.push(`aus Bestellung ${payload.fromShopOrder}`);
  }
  return parts.join(" · ");
}

// ---------------------------------------------------------------------------
// Reiter
// ---------------------------------------------------------------------------

function OverviewTab({
  data,
  onOpenTask,
  run,
  today,
}: {
  data: ProjectDetailData;
  onOpenTask: (taskId: string) => void;
  run: Run;
  today: string;
}) {
  const { access, project } = data;
  const milestones = data.tasks
    .filter((task) => task.kind === "milestone")
    .sort((a, b) => (a.dueOn ?? "9999").localeCompare(b.dueOn ?? "9999"));
  const mine = data.tasks.filter(
    (task) =>
      task.kind === "task" && task.status !== "done" && isOverdue(task, today),
  );
  const facts: [string, string][] = [
    ["Projektleitung", project.managerName ?? "–"],
    [
      "Zeitraum",
      `${dateLabel(project.startsOn)} – ${dateLabel(project.endsOn)}`,
    ],
  ];
  if (!access.isGuest) {
    facts.push([
      "Terminplanung",
      project.scheduleMode === "auto" ? "Automatisch" : "Manuell",
    ]);
  }
  return (
    <div className="pj-layout">
      <div className="pj-stack">
        <section className="pj-card">
          <h3>Beschreibung</h3>
          {project.description ? (
            <div className="pj-markdown">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {project.description}
              </ReactMarkdown>
            </div>
          ) : (
            <p className="pj-hint">Keine Beschreibung.</p>
          )}
        </section>
        <section className="pj-card">
          <h3>Meilensteine</h3>
          {milestones.length === 0 ? (
            <p className="pj-hint">Noch keine Meilensteine.</p>
          ) : (
            <ul className="pj-rows pj-rows--compact">
              {milestones.map((milestone) => (
                <li key={milestone.id}>
                  <button
                    className="pj-plain"
                    onClick={() => onOpenTask(milestone.id)}
                    type="button"
                  >
                    {milestone.title}
                  </button>
                  <span className="pj-actions">
                    <span className="pj-muted">
                      {dateLabel(milestone.dueOn)}
                    </span>
                    <span
                      className={`pj-chip ${
                        milestone.status === "done"
                          ? "pj-chip--done"
                          : isOverdue(milestone, today)
                            ? "pj-chip--bad"
                            : "pj-chip--todo"
                      }`}
                    >
                      {milestone.status === "done"
                        ? "erreicht"
                        : isOverdue(milestone, today)
                          ? "überfällig"
                          : "offen"}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
        {mine.length > 0 ? (
          <section className="pj-card">
            <h3>Überfällige Aufgaben</h3>
            <ul className="pj-rows pj-rows--compact">
              {mine.slice(0, 12).map((task) => (
                <li key={task.id}>
                  <button
                    className="pj-plain"
                    onClick={() => onOpenTask(task.id)}
                    type="button"
                  >
                    <span className="pj-two-line">
                      <strong>{task.title}</strong>
                      <small>{task.assigneeName ?? "Nicht zugewiesen"}</small>
                    </span>
                  </button>
                  <span className="pj-late">{dateLabel(task.dueOn)}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <section className="pj-card">
          <h3>Kommentare zum Projekt</h3>
          <CommentThread
            canComment={access.canComment}
            canModerate={access.canAdmin}
            comments={data.comments.filter((comment) => !comment.taskId)}
            isGuest={access.isGuest}
            projectId={project.id}
            run={run}
            taskId={null}
          />
        </section>
      </div>
      <div className="pj-stack">
        <section className="pj-card">
          <h3>Eckdaten</h3>
          <dl className="pj-facts">
            {facts.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </section>
        {!access.isGuest ? (
          <section className="pj-card">
            <h3>Verlauf</h3>
            {data.events.length === 0 ? (
              <p className="pj-hint">Noch keine Einträge.</p>
            ) : (
              <ul className="pj-timeline">
                {data.events.slice(0, 25).map((event) => (
                  <li key={event.id}>
                    <strong>{EVENT_LABELS[event.type] ?? event.type}</strong>
                    {eventDetail(event.payload) ? (
                      <span>{eventDetail(event.payload)}</span>
                    ) : null}
                    <small>
                      {event.actorName ?? "System"} ·{" "}
                      {dateTimeLabel(event.createdAt)}
                    </small>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}
      </div>
    </div>
  );
}

function BudgetTab({
  data,
  onOpenTask,
  onOpenTicket,
}: {
  data: ProjectDetailData;
  onOpenTask: (taskId: string) => void;
  onOpenTicket?: ((ticketId: string) => void) | undefined;
}) {
  const { project } = data;
  const rollup = useMemo(
    () => rollupTasks(data.tasks, data.links),
    [data.links, data.tasks],
  );
  const rows = buildTree(data.tasks).filter(
    (row) => row.task.kind !== "milestone",
  );
  const estimated = rows
    .filter((row) => row.depth === 0)
    .reduce(
      (sum, row) => sum + (rollup.get(row.task.id)?.estimatedMinutes ?? 0),
      0,
    );
  const booked = project.stats.bookedMinutes;
  const tickets = data.links.filter((link) => link.targetKind === "ticket");
  const projectTickets = tickets.filter((link) => !link.taskId);
  const used = estimated ? Math.round((booked / estimated) * 100) : null;
  const tone = (percent: number | null) =>
    percent === null || percent < 80 ? "good" : percent <= 100 ? "warn" : "bad";

  return (
    <>
      <div className="pj-kpis">
        <article className={`pj-card pj-kpi pj-kpi--${tone(used)}`}>
          <p>Gebucht</p>
          <strong>{hoursLabel(booked)}</strong>
          <small>
            {used !== null
              ? `${used} % der geplanten Zeit`
              : "noch keine Schätzungen"}
          </small>
        </article>
        <article className="pj-card pj-kpi">
          <p>Geplant (Schätzungen)</p>
          <strong>{hoursLabel(estimated)}</strong>
          <small>
            {estimated > booked
              ? `${hoursLabel(estimated - booked)} noch offen`
              : estimated
                ? "vollständig gebucht"
                : ""}
          </small>
        </article>
        <article className="pj-card pj-kpi">
          <p>Budget</p>
          <strong>
            {project.budgetAmountCents === null
              ? "–"
              : moneyLabel(project.budgetAmountCents, project.currency)}
          </strong>
          <small>
            {project.budgetAmountCents === null ? "kein Budget erfasst" : ""}
          </small>
        </article>
        <article className="pj-card pj-kpi">
          <p>Fortschritt</p>
          <strong>{project.stats.progressPercent} %</strong>
          <small>
            {used !== null
              ? used > project.stats.progressPercent + 10
                ? "Verbrauch liegt über dem Fortschritt"
                : "Verbrauch passt zum Fortschritt"
              : ""}
          </small>
        </article>
      </div>

      <section className="pj-card pj-card--flush">
        <div className="pj-table-wrap">
          <table className="pj-table pj-table--list">
            <thead>
              <tr>
                <th>Element</th>
                <th>Soll</th>
                <th>Ist</th>
                <th>Abweichung</th>
                <th>Verbrauch</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ task, depth }) => {
                const rolled = rollup.get(task.id);
                const soll = rolled?.estimatedMinutes ?? 0;
                const ist = rolled?.bookedMinutes ?? 0;
                const percent = soll ? Math.round((ist / soll) * 100) : null;
                return (
                  <tr className={`pj-row--${task.kind}`} key={task.id}>
                    <td>
                      <button
                        className="pj-plain"
                        onClick={() => onOpenTask(task.id)}
                        style={{ paddingLeft: depth * 18 }}
                        type="button"
                      >
                        {task.title}
                      </button>
                    </td>
                    <td>{soll ? hoursLabel(soll) : "–"}</td>
                    <td>{ist ? hoursLabel(ist) : "–"}</td>
                    <td className={soll && ist > soll ? "pj-late" : undefined}>
                      {soll || ist
                        ? `${ist > soll ? "+" : ""}${hoursLabel(ist - soll)}`
                        : "–"}
                    </td>
                    <td>
                      {percent === null ? (
                        "–"
                      ) : (
                        <div className="pj-meter">
                          <ProgressBar
                            label={`${percent} % verbraucht`}
                            percent={percent}
                            tone={tone(percent)}
                          />
                          <small>{percent} %</small>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {projectTickets.map((link) => (
                <tr key={link.id}>
                  <td>
                    <button
                      className="pj-plain"
                      disabled={!onOpenTicket}
                      onClick={() => onOpenTicket?.(link.targetId)}
                      type="button"
                    >
                      Ticket {link.label}
                      {link.detail ? ` · ${link.detail}` : ""}
                    </button>
                  </td>
                  <td>–</td>
                  <td>
                    {link.bookedMinutes ? hoursLabel(link.bookedMinutes) : "–"}
                  </td>
                  <td>–</td>
                  <td>–</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Projekt gesamt</th>
                <td>{hoursLabel(estimated)}</td>
                <td>{hoursLabel(booked)}</td>
                <td
                  className={
                    estimated && booked > estimated ? "pj-late" : undefined
                  }
                >
                  {booked > estimated ? "+" : ""}
                  {hoursLabel(booked - estimated)}
                </td>
                <td>
                  {estimated
                    ? `${Math.round((booked / estimated) * 100)} %`
                    : "–"}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
      <p className="pj-legend">
        <span className="pj-muted">
          Soll ist die Summe der Schätzungen, Ist die gebuchte Zeit des
          Elements, seiner Unterelemente und der daran verknüpften Tickets.
        </span>
      </p>
    </>
  );
}

function DocsTab({
  data,
  onReload,
  run,
  tenantId,
}: {
  data: ProjectDetailData;
  onReload: () => void;
  run: Run;
  tenantId: string;
}) {
  const { access, project } = data;
  const [selectedId, setSelectedId] = useState<string | null>(
    data.documents[0]?.id ?? null,
  );
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [external, setExternal] = useState(false);
  const selected: ProjectDocument | null =
    data.documents.find((document) => document.id === selectedId) ?? null;

  const startEdit = (document: ProjectDocument | null) => {
    setSelectedId(document?.id ?? null);
    setTitle(document?.title ?? "");
    setBody(document?.body ?? "");
    setExternal(document?.visibility === "external");
    setEditing(true);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const result = (await run({
      type: "saveDocument",
      projectId: project.id,
      documentId: selected?.id ?? null,
      title,
      body,
      visibility: external ? "external" : "internal",
    })) as { documentId?: string } | undefined;
    if (result?.documentId) {
      setSelectedId(result.documentId);
      setEditing(false);
    }
  };

  const remove = async () => {
    if (!selected) return;
    if (
      await confirmDialog(`Dokument «${selected.title}» löschen?`, {
        confirmLabel: "Löschen",
        tone: "danger",
      })
    ) {
      await run({
        type: "deleteDocument",
        projectId: project.id,
        documentId: selected.id,
      });
      setSelectedId(null);
      setEditing(false);
    }
  };

  return (
    <div className="pj-docs">
      <nav aria-label="Dokumente" className="pj-card pj-docs__nav">
        {data.documents.length === 0 ? (
          <p className="pj-hint">Noch keine Dokumente.</p>
        ) : null}
        {data.documents.map((document) => (
          <button
            aria-current={
              document.id === selectedId && !(!selected && editing)
                ? "page"
                : undefined
            }
            key={document.id}
            onClick={() => {
              setSelectedId(document.id);
              setEditing(false);
            }}
            type="button"
          >
            {document.title}
            {document.visibility === "external" && !access.isGuest ? (
              <small>für Gäste sichtbar</small>
            ) : null}
          </button>
        ))}
        {access.canEdit ? (
          <button
            className="pj-button"
            onClick={() => startEdit(null)}
            type="button"
          >
            Neues Dokument
          </button>
        ) : null}
        {!access.isGuest ? (
          <div className="pj-docs__files">
            <h3>Dateien zum Projekt</h3>
            <AttachmentList
              attachments={data.attachments.filter(
                (attachment) => !attachment.taskId,
              )}
              canEdit={access.canEdit}
              onChanged={onReload}
              projectId={project.id}
              taskId={null}
              tenantId={tenantId}
            />
          </div>
        ) : null}
      </nav>
      <section className="pj-card pj-docs__main">
        {editing ? (
          <form className="pj-doc-form" onSubmit={(event) => void save(event)}>
            <input
              aria-label="Titel"
              autoFocus
              maxLength={200}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Titel, z. B. Netzwerkkonzept"
              required
              value={title}
            />
            <div className="pj-doc-edit">
              <textarea
                aria-label="Inhalt in Markdown"
                maxLength={200000}
                onChange={(event) => setBody(event.target.value)}
                placeholder={
                  "# Überschrift\n\nText, Listen, Tabellen und Codeblöcke in Markdown."
                }
                value={body}
              />
              <div aria-label="Vorschau" className="pj-markdown pj-doc-preview">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {body || "_Vorschau_"}
                </ReactMarkdown>
              </div>
            </div>
            <div className="pj-actions pj-actions--between">
              <label className="pj-check">
                <input
                  checked={external}
                  onChange={(event) => setExternal(event.target.checked)}
                  type="checkbox"
                />
                Für Gäste sichtbar
              </label>
              <span className="pj-actions">
                <button
                  className="pj-button"
                  onClick={() => setEditing(false)}
                  type="button"
                >
                  Abbrechen
                </button>
                <button
                  className="pj-button pj-button--primary"
                  disabled={!title.trim()}
                  type="submit"
                >
                  Speichern
                </button>
              </span>
            </div>
          </form>
        ) : selected ? (
          <>
            <header className="pj-actions pj-actions--between">
              <div>
                <h3>{selected.title}</h3>
                <p className="pj-muted">
                  Zuletzt geändert {dateTimeLabel(selected.updatedAt)}
                  {selected.updatedByName
                    ? ` von ${selected.updatedByName}`
                    : ""}
                </p>
              </div>
              {access.canEdit ? (
                <span className="pj-actions">
                  <button
                    className="pj-button"
                    onClick={() => startEdit(selected)}
                    type="button"
                  >
                    Bearbeiten
                  </button>
                  <button
                    className="pj-button pj-button--danger"
                    onClick={() => void remove()}
                    type="button"
                  >
                    Löschen
                  </button>
                </span>
              ) : null}
            </header>
            <div className="pj-markdown">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {selected.body || "_Dieses Dokument ist noch leer._"}
              </ReactMarkdown>
            </div>
          </>
        ) : (
          <p className="pj-empty">
            Konzepte, Netzwerkpläne und Protokolle zum Projekt stehen hier.
          </p>
        )}
      </section>
    </div>
  );
}

function LinksTab({
  data,
  onOpenTask,
  onOpenTicket,
  run,
  tenantId,
}: {
  data: ProjectDetailData;
  onOpenTask: (taskId: string) => void;
  onOpenTicket?: ((ticketId: string) => void) | undefined;
  run: Run;
  tenantId: string;
}) {
  const { access, project } = data;
  const byTask = new Map(data.tasks.map((task) => [task.id, task]));
  return (
    <div className="pj-layout">
      <div className="pj-stack">
        {LINK_KINDS.map((kind) => {
          const links = data.links.filter((link) => link.targetKind === kind);
          if (!links.length) return null;
          const onProject = links.filter((link) => !link.taskId);
          const onTasks = links.filter((link) => link.taskId);
          return (
            <section className="pj-card" key={kind}>
              <h3>
                {LINK_KIND_LABELS[kind]} ({links.length})
              </h3>
              {onProject.length ? (
                <LinkList
                  canEdit={access.canEdit}
                  links={onProject}
                  onOpenTicket={onOpenTicket}
                  run={run}
                />
              ) : null}
              {onTasks.length ? (
                <ul className="pj-rows pj-rows--compact">
                  {onTasks.map((link) => (
                    <li key={link.id}>
                      <span className="pj-two-line">
                        <strong>
                          {link.label}
                          {link.detail ? ` · ${link.detail}` : ""}
                        </strong>
                        <small>{linkStateLabel(link.state) ?? ""}</small>
                      </span>
                      <button
                        className="pj-plain pj-muted"
                        onClick={() => onOpenTask(link.taskId!)}
                        type="button"
                      >
                        an «{byTask.get(link.taskId!)?.title ?? "Element"}»
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          );
        })}
        {data.links.length === 0 ? (
          <section className="pj-card">
            <p className="pj-empty">
              Noch nichts verknüpft. Tickets, Störungen, Serviceaufgaben,
              Shop-Bestellungen, IP-Netze, VLANs, IP-Adressen,
              Monitoring-Sensoren und Geräte lassen sich mit dem Projekt oder
              mit einzelnen Elementen verbinden.
            </p>
          </section>
        ) : null}
      </div>
      {access.canEdit ? (
        <section className="pj-card">
          <h3>Mit dem Projekt verknüpfen</h3>
          <LinkPicker
            projectId={project.id}
            run={run}
            taskId={null}
            tenantId={tenantId}
          />
        </section>
      ) : null}
    </div>
  );
}

type PersonMatch = {
  id: string;
  name: string;
  detail: string;
  hasAccount: boolean;
};

const MEMBER_ROLES: ProjectRole[] = [
  "manager",
  "member",
  "guest_comment",
  "guest_read",
];

function TeamTab({
  data,
  options,
  run,
  tenantId,
}: {
  data: ProjectDetailData;
  options: ProjectOptions | null;
  run: Run;
  tenantId: string;
}) {
  const { access, project } = data;
  const [personQuery, setPersonQuery] = useState("");
  const [directory, setDirectory] = useState<PersonMatch[] | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const searchVersion = useRef(0);
  const [role, setRole] = useState<ProjectRole>("member");
  const [email, setEmail] = useState("");
  const [guestRole, setGuestRole] = useState("guest_read");
  const [notice, setNotice] = useState("");
  const present = new Set(data.members.map((member) => member.userId));

  const needle = personQuery.trim().toLocaleLowerCase("de-CH");
  useEffect(() => {
    const current = ++searchVersion.current;
    setDirectory(null);
    if (needle.length < 2) return;
    const timer = window.setTimeout(() => {
      projectsCall<{ results: PersonMatch[] }>({
        type: "searchPeople",
        tenantId,
        query: needle,
      })
        .then((result) => {
          if (searchVersion.current === current) setDirectory(result.results);
        })
        .catch(() => {
          // Members of the tenant are still found without the directory.
          if (searchVersion.current === current) setDirectory([]);
        });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [needle, tenantId]);

  // Directory people plus members who are not in the directory.
  const matches = useMemo(() => {
    if (needle.length < 2 || directory === null) return null;
    const seen = new Set(directory.map((person) => person.id));
    const local = (options?.people ?? [])
      .filter(
        (person) =>
          !seen.has(person.id) &&
          person.name.toLocaleLowerCase("de-CH").includes(needle),
      )
      .map((person) => ({
        id: person.id,
        name: person.name,
        detail: "",
        hasAccount: true,
      }));
    return [...directory, ...local]
      .filter((person) => !present.has(person.id))
      .sort((a, b) => a.name.localeCompare(b.name, "de"))
      .slice(0, 20);
    // `present` is derived from data.members.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.members, directory, needle, options]);

  const add = async (userId: string) => {
    setAdding(userId);
    try {
      const result = (await run({
        type: "setMember",
        projectId: project.id,
        userId,
        role,
      })) as { saved?: boolean } | undefined;
      if (result?.saved) setPersonQuery("");
    } finally {
      setAdding(null);
    }
  };
  const invite = async (event: FormEvent) => {
    event.preventDefault();
    setNotice("");
    const result = (await run({
      type: "inviteGuest",
      projectId: project.id,
      email,
      role: guestRole,
    })) as { sent?: boolean } | undefined;
    if (result?.sent) {
      setNotice(`Die Einladung an ${email} ist unterwegs.`);
      setEmail("");
    }
  };

  return (
    <div className="pj-layout">
      <div className="pj-stack">
        <section className="pj-card">
          <h3>Mitglieder</h3>
          <ul className="pj-rows">
            {data.members.map((member) => (
              <li key={member.userId}>
                <span className="pj-two-line">
                  <strong>{member.name ?? "Unbekannte Person"}</strong>
                  <small>
                    {member.lead ? "Projektleitung" : ROLE_LABELS[member.role]}
                  </small>
                </span>
                {access.canAdmin && !member.lead ? (
                  <span className="pj-actions">
                    <select
                      aria-label={`Rolle von ${member.name ?? "Mitglied"}`}
                      onChange={(event) =>
                        void run({
                          type: "setMember",
                          projectId: project.id,
                          userId: member.userId,
                          role: event.target.value,
                        })
                      }
                      value={member.role}
                    >
                      {MEMBER_ROLES.map((value) => (
                        <option key={value} value={value}>
                          {ROLE_LABELS[value]}
                        </option>
                      ))}
                    </select>
                    <button
                      className="pj-button pj-button--danger"
                      onClick={() =>
                        void run({
                          type: "removeMember",
                          projectId: project.id,
                          userId: member.userId,
                        })
                      }
                      type="button"
                    >
                      Entfernen
                    </button>
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
        {data.invitations.length > 0 ? (
          <section className="pj-card">
            <h3>Offene Einladungen</h3>
            <ul className="pj-rows pj-rows--compact">
              {data.invitations.map((invitation) => (
                <li key={invitation.id}>
                  <span className="pj-two-line">
                    <strong>{invitation.email}</strong>
                    <small>
                      {ROLE_LABELS[invitation.role]} · gültig bis{" "}
                      {dateLabel(invitation.expiresAt.slice(0, 10))}
                    </small>
                  </span>
                  {access.canAdmin ? (
                    <button
                      className="pj-button"
                      onClick={() =>
                        void run({
                          type: "revokeInvitation",
                          projectId: project.id,
                          invitationId: invitation.id,
                        })
                      }
                      type="button"
                    >
                      Zurückziehen
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
      {access.canAdmin ? (
        <div className="pj-stack">
          <section className="pj-card">
            <h3>Person aus dem Mandanten hinzufügen</h3>
            <div className="pj-inline pj-inline--wrap">
              <input
                aria-label="Person suchen"
                onChange={(event) => setPersonQuery(event.target.value)}
                placeholder="Name, Funktion oder E-Mail suchen"
                type="search"
                value={personQuery}
              />
              <select
                aria-label="Rolle"
                onChange={(event) => setRole(event.target.value as ProjectRole)}
                value={role}
              >
                {MEMBER_ROLES.map((value) => (
                  <option key={value} value={value}>
                    {ROLE_LABELS[value]}
                  </option>
                ))}
              </select>
            </div>
            {personQuery.trim().length < 2 ? (
              <p className="pj-hint pj-hint--below">
                Gesucht wird im ganzen Mandanten, auch unter Personen aus dem
                Verzeichnis, die sich noch nie angemeldet haben.
              </p>
            ) : matches === null ? (
              <p className="pj-hint pj-hint--below">Sucht …</p>
            ) : matches.length === 0 ? (
              <p className="pj-hint pj-hint--below">Keine Person gefunden.</p>
            ) : (
              <ul className="pj-rows pj-rows--compact">
                {matches.map((person) => (
                  <li key={person.id}>
                    <span className="pj-two-line">
                      <strong>{person.name}</strong>
                      <small>
                        {[
                          person.detail,
                          person.hasAccount ? null : "noch nie angemeldet",
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </small>
                    </span>
                    <button
                      className="pj-button pj-button--primary"
                      disabled={adding !== null}
                      onClick={() => void add(person.id)}
                      type="button"
                    >
                      {adding === person.id ? "Fügt hinzu …" : "Hinzufügen"}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="pj-card">
            <h3>Externen Gast einladen</h3>
            <p className="pj-hint">
              Gäste sehen nur dieses Projekt: den Plan sowie Dokumente und
              Kommentare, die als «für Gäste sichtbar» markiert sind. Zeiten,
              Budget, Verknüpfungen und alle anderen Module bleiben verborgen.
            </p>
            <form
              className="pj-inline pj-inline--wrap"
              onSubmit={(event) => void invite(event)}
            >
              <input
                aria-label="E-Mail-Adresse"
                onChange={(event) => setEmail(event.target.value)}
                placeholder="name@firma.ch"
                required
                type="email"
                value={email}
              />
              <select
                aria-label="Rolle des Gastes"
                onChange={(event) => setGuestRole(event.target.value)}
                value={guestRole}
              >
                <option value="guest_read">Lesend</option>
                <option value="guest_comment">Kommentierend</option>
              </select>
              <button className="pj-button pj-button--primary" type="submit">
                Einladen
              </button>
            </form>
            {notice ? <p className="pj-notice">{notice}</p> : null}
          </section>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Projektdetail
// ---------------------------------------------------------------------------

export function ProjectDetail({
  onBack,
  onOpenTicket,
  options,
  permissions,
  projectId,
  tenantId,
}: {
  onBack: () => void;
  onOpenTicket?: ((ticketId: string) => void) | undefined;
  options: ProjectOptions | null;
  permissions: ProjectModuleAccess;
  projectId: string;
  tenantId: string;
}) {
  const [data, setData] = useState<ProjectDetailData | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [taskId, setTaskId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [changes, setChanges] = useState<PlannedChange[] | null>(null);
  const version = useRef(0);
  const today = localToday();

  const load = useCallback(async () => {
    const current = ++version.current;
    try {
      const next = await projectsCall<ProjectDetailData>({
        type: "getProject",
        tenantId,
        projectId,
      });
      if (version.current === current) setData(next);
    } catch (nextError) {
      if (version.current === current) setError(errorText(nextError));
    }
  }, [projectId, tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  const run: Run = useCallback(
    async (body) => {
      setError("");
      setNotice("");
      try {
        const result = await projectsCall<
          ScheduleOutcome & Record<string, unknown>
        >({
          tenantId,
          ...body,
        });
        if (result.shifted) {
          setNotice(
            result.shifted === 1
              ? "1 abhängiger Termin wurde nachgeführt."
              : `${result.shifted} abhängige Termine wurden nachgeführt.`,
          );
        } else if (result.pending) {
          setNotice(
            `${result.pending} Termine passen nicht mehr zu den Abhängigkeiten. Unter «Mehr» lassen sie sich prüfen und anwenden.`,
          );
        }
        await load();
        return result;
      } catch (nextError) {
        setError(errorText(nextError));
        await load();
        return undefined;
      }
    },
    [load, tenantId],
  );

  const rollup = useMemo(
    () => (data ? rollupTasks(data.tasks, data.links) : new Map()),
    [data],
  );

  if (!data) {
    return (
      <div className="projects">
        <button className="pj-back" onClick={onBack} type="button">
          <ArrowLeft aria-hidden="true" size={15} /> Alle Projekte
        </button>
        {error ? (
          <p className="pj-error" role="alert">
            {error}
          </p>
        ) : (
          <p className="pj-empty">Projekt wird geladen …</p>
        )}
      </div>
    );
  }

  const { access, project } = data;
  const suggestion = suggestHealth(project);
  const openTask = taskId
    ? (data.tasks.find((task) => task.id === taskId) ?? null)
    : null;
  const tabs: readonly (readonly [Tab, string])[] = access.isGuest
    ? [
        ["overview", "Überblick"],
        ["gantt", "Zeitplan"],
        ["board", "Board"],
        ["list", "Liste"],
        ["docs", "Dokumentation"],
      ]
    : [
        ["overview", "Überblick"],
        ["gantt", "Zeitplan"],
        ["board", "Board"],
        ["list", "Liste"],
        ["budget", "Zeiten & Budget"],
        ["docs", "Dokumentation"],
        [
          "links",
          `Verknüpfungen${data.links.length ? ` (${data.links.length})` : ""}`,
        ],
        ["team", "Team & Gäste"],
      ];

  const plan = {
    canEdit: access.canEdit,
    dependencies: data.dependencies,
    onOpenTask: setTaskId,
    people: options?.people ?? [],
    project,
    rollup,
    run,
    tasks: data.tasks,
    today,
  };

  const saveTemplate = async () => {
    setMenuOpen(false);
    const name = await promptDialog("Name der Vorlage", {
      confirmLabel: "Vorlage speichern",
      defaultValue: project.title,
      multiline: false,
    });
    if (!name?.trim()) return;
    const result = (await run({ type: "saveAsTemplate", projectId, name })) as
      { templateId?: string } | undefined;
    if (result?.templateId)
      setNotice(`Die Vorlage «${name.trim()}» ist gespeichert.`);
  };

  const preview = async () => {
    setMenuOpen(false);
    try {
      const result = await projectsCall<{ changes: PlannedChange[] }>({
        type: "previewReschedule",
        tenantId,
        projectId,
      });
      setChanges(result.changes);
    } catch (nextError) {
      setError(errorText(nextError));
    }
  };

  const archive = async () => {
    setMenuOpen(false);
    await run({
      type: "archiveProject",
      projectId,
      archived: !project.archivedAt,
    });
  };

  const remove = async () => {
    setMenuOpen(false);
    if (
      !(await confirmDialog(
        `Projekt ${project.number} «${project.title}» mit Plan, Zeiten, Dokumenten und Anhängen endgültig löschen?`,
        { confirmLabel: "Endgültig löschen", tone: "danger" },
      ))
    ) {
      return;
    }
    try {
      await projectsCall({ type: "deleteProject", tenantId, projectId });
      onBack();
    } catch (nextError) {
      setError(errorText(nextError));
    }
  };

  return (
    <div className="projects">
      <button className="pj-back" onClick={onBack} type="button">
        <ArrowLeft aria-hidden="true" size={15} /> Alle Projekte
      </button>

      <header className="pj-card pj-hero">
        <div className="pj-hero__title">
          <p className="pj-eyebrow">
            {project.number}
            {project.archivedAt ? " · archiviert" : ""}
          </p>
          <h2>
            <HealthDot health={project.health} /> {project.title}
          </h2>
          <div className="pj-meter pj-meter--wide">
            <ProgressBar
              label={`Fortschritt ${project.stats.progressPercent} %`}
              percent={project.stats.progressPercent}
            />
            <small>
              {project.stats.progressPercent} % · {project.stats.doneCount} von{" "}
              {project.stats.taskCount} Aufgaben erledigt
              {project.endsOn ? ` · Ende ${dateLabel(project.endsOn)}` : ""}
            </small>
          </div>
        </div>
        <div className="pj-hero__controls">
          <label>
            Status
            <select
              disabled={!access.canAdmin}
              onChange={(event) =>
                void run({
                  type: "updateProject",
                  projectId,
                  status: event.target.value,
                })
              }
              value={project.status}
            >
              {(Object.keys(PROJECT_STATUS_LABELS) as ProjectStatus[]).map(
                (status) => (
                  <option key={status} value={status}>
                    {PROJECT_STATUS_LABELS[status]}
                  </option>
                ),
              )}
            </select>
          </label>
          <label>
            Ampel
            <select
              disabled={!access.canAdmin}
              onChange={(event) =>
                void run({
                  type: "updateProject",
                  projectId,
                  health: event.target.value,
                })
              }
              value={project.health}
            >
              {(Object.keys(HEALTH_LABELS) as ProjectHealth[]).map((health) => (
                <option key={health} value={health}>
                  {HEALTH_LABELS[health]}
                </option>
              ))}
            </select>
          </label>
          {access.canAdmin || permissions.manage ? (
            <div className="pj-menu">
              <button
                aria-expanded={menuOpen}
                aria-haspopup="menu"
                className="pj-button"
                onClick={() => setMenuOpen((value) => !value)}
                type="button"
              >
                <MoreHorizontal aria-hidden="true" size={15} /> Mehr
              </button>
              {menuOpen ? (
                <div className="pj-menu__list" role="menu">
                  {access.canAdmin && options ? (
                    <button
                      onClick={() => {
                        setMenuOpen(false);
                        setEditing(true);
                      }}
                      role="menuitem"
                      type="button"
                    >
                      Projekt bearbeiten
                    </button>
                  ) : null}
                  <button
                    onClick={() => void preview()}
                    role="menuitem"
                    type="button"
                  >
                    Termine prüfen
                  </button>
                  {permissions.manage ? (
                    <button
                      onClick={() => void saveTemplate()}
                      role="menuitem"
                      type="button"
                    >
                      Als Vorlage speichern
                    </button>
                  ) : null}
                  {access.canAdmin ? (
                    <button
                      onClick={() => void archive()}
                      role="menuitem"
                      type="button"
                    >
                      {project.archivedAt
                        ? "Aus dem Archiv holen"
                        : "Archivieren"}
                    </button>
                  ) : null}
                  {access.canAdmin ? (
                    <button
                      className="is-danger"
                      onClick={() => void remove()}
                      role="menuitem"
                      type="button"
                    >
                      Projekt löschen
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
        {access.canAdmin &&
        suggestion.health !== project.health &&
        suggestion.reasons.length ? (
          <p className="pj-suggest">
            Die Zahlen sprechen für Ampel {HEALTH_LABELS[suggestion.health]}:{" "}
            {suggestion.reasons.join("; ")}.
            <button
              className="pj-button"
              onClick={() =>
                void run({
                  type: "updateProject",
                  projectId,
                  health: suggestion.health,
                  healthNote: suggestion.reasons.join("; ").slice(0, 500),
                })
              }
              type="button"
            >
              Auf {HEALTH_LABELS[suggestion.health]} setzen
            </button>
          </p>
        ) : null}
      </header>

      {error ? (
        <p className="pj-error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="pj-notice" role="status">
          {notice}
        </p>
      ) : null}

      <div className="pj-tabs" role="tablist" aria-label="Bereich des Projekts">
        {tabs.map(([key, label]) => (
          <button
            aria-selected={tab === key}
            key={key}
            onClick={() => setTab(key)}
            role="tab"
            type="button"
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "overview" ? (
        <OverviewTab
          data={data}
          onOpenTask={setTaskId}
          run={run}
          today={today}
        />
      ) : tab === "gantt" ? (
        <ProjectGantt {...plan} />
      ) : tab === "board" ? (
        <ProjectBoard {...plan} />
      ) : tab === "list" ? (
        <ProjectList {...plan} />
      ) : tab === "budget" ? (
        <BudgetTab
          data={data}
          onOpenTask={setTaskId}
          onOpenTicket={onOpenTicket}
        />
      ) : tab === "docs" ? (
        <DocsTab
          data={data}
          onReload={() => void load()}
          run={run}
          tenantId={tenantId}
        />
      ) : tab === "links" ? (
        <LinksTab
          data={data}
          onOpenTask={setTaskId}
          onOpenTicket={onOpenTicket}
          run={run}
          tenantId={tenantId}
        />
      ) : (
        <TeamTab data={data} options={options} run={run} tenantId={tenantId} />
      )}

      {openTask ? (
        <>
          <div
            className="pj-panel-backdrop"
            onClick={() => setTaskId(null)}
            role="presentation"
          />
          <TaskPanel
            data={data}
            onClose={() => setTaskId(null)}
            onOpenTask={setTaskId}
            onOpenTicket={onOpenTicket}
            onReload={() => void load()}
            people={options?.people ?? []}
            rollup={rollup}
            run={run}
            task={openTask}
            teams={options?.teams ?? []}
            tenantId={tenantId}
          />
        </>
      ) : null}

      {editing && options ? (
        <ProjectForm
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            void load();
          }}
          options={options}
          state={{ project, templateId: "" }}
          tenantId={tenantId}
        />
      ) : null}

      {changes ? (
        <div
          className="fk-backdrop"
          onClick={() => setChanges(null)}
          role="presentation"
        >
          <div
            aria-label="Termine prüfen"
            aria-modal="true"
            className="pj-dialog"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <h2>Termine prüfen</h2>
            {changes.length === 0 ? (
              <p>Alle Termine passen zu den Abhängigkeiten.</p>
            ) : (
              <>
                <p>
                  Diese {changes.length} Termine müssten sich ändern, damit alle
                  Abhängigkeiten eingehalten sind:
                </p>
                <div className="pj-table-wrap">
                  <table className="pj-table pj-table--list">
                    <thead>
                      <tr>
                        <th>Element</th>
                        <th>Bisher</th>
                        <th>Neu</th>
                      </tr>
                    </thead>
                    <tbody>
                      {changes.map((change) => (
                        <tr key={change.id}>
                          <td>{change.title}</td>
                          <td>
                            {dateLabel(change.previousStartsOn)} –{" "}
                            {dateLabel(change.previousDueOn)}
                          </td>
                          <td>
                            {dateLabel(change.startsOn)} –{" "}
                            {dateLabel(change.dueOn)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            <div className="pj-actions pj-actions--end">
              <button
                className="pj-button"
                onClick={() => setChanges(null)}
                type="button"
              >
                Schliessen
              </button>
              {changes.length > 0 && access.canEdit ? (
                <button
                  className="pj-button pj-button--primary"
                  onClick={() => {
                    setChanges(null);
                    void run({ type: "applyReschedule", projectId });
                  }}
                  type="button"
                >
                  Termine anwenden
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
