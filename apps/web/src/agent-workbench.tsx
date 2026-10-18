import {
  AlertTriangle,
  AtSign,
  BellRing,
  Check,
  CircleHelp,
  Clock3,
  LoaderCircle,
  ShieldCheck,
  UserRound,
  UsersRound,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { supabase } from "./lib/supabase";
import "./agent-workbench.css";

type WorkbenchView = "team" | "mentions" | "delegations" | "incidents";
type IncidentStatus =
  "investigating" | "identified" | "monitoring" | "resolved";

type TeamQueue = {
  departmentId: string;
  openTickets: number;
  teamId: string | null;
};
type Mention = {
  authorId: string;
  commentId: string | null;
  createdAt: string;
  id: string;
  mentionedUserId: string;
  readAt: string | null;
  ticketId: string;
};
type Delegation = {
  agentId: string;
  delegateId: string;
  endedAt: string | null;
  endsAt: string;
  id: string;
  note: string | null;
  startsAt: string;
};
type IncidentNotice = {
  categoryId: string | null;
  createdAt: string | null;
  departmentId: string | null;
  description: string;
  id: string;
  resolvedAt: string | null;
  startsAt: string;
  status: IncidentStatus;
  title: string;
  updatedAt: string;
};
type ActiveIncidentNotice = Pick<
  IncidentNotice,
  | "categoryId"
  | "departmentId"
  | "description"
  | "id"
  | "resolvedAt"
  | "startsAt"
  | "status"
  | "title"
  | "updatedAt"
>;
type Person = {
  id: string;
  name: string;
};

type Metrics = {
  dueFollowUps: number;
  medianFirstResponseMinutes: number | null;
  open: number;
  solvedToday: number;
  /** Fehlt bei älteren Serverständen. */
  slaDue?: number;
  ticketIds?: MetricTicketIds;
};

type MetricTicketIds = {
  assigned: string[];
  dueFollowUps: string[];
  firstResponse: string[];
  slaDue?: string[];
  solvedToday: string[];
};

export type { ActiveIncidentNotice, TeamQueue };

export function activeIncidentNoticesFromResponse(
  value: unknown,
): ActiveIncidentNotice[] | null {
  const data = responseData(value);
  if (!data || !Array.isArray(data.notices)) return null;
  const notices = data.notices.map(incidentNoticeFromValue);
  return notices.every((notice): notice is IncidentNotice => notice !== null)
    ? notices.map(
        ({
          categoryId,
          departmentId,
          description,
          id,
          resolvedAt,
          startsAt,
          status,
          title,
          updatedAt,
        }) => ({
          categoryId,
          departmentId,
          description,
          id,
          resolvedAt,
          startsAt,
          status,
          title,
          updatedAt,
        }),
      )
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function metricTicketIdsFromValue(value: unknown): MetricTicketIds | null {
  if (!isRecord(value)) return null;

  const keys = [
    "assigned",
    "solvedToday",
    "firstResponse",
    "dueFollowUps",
  ] as const;
  const ticketIds: Partial<MetricTicketIds> = {};
  for (const key of keys) {
    const ids = value[key];
    if (!Array.isArray(ids) || !ids.every(isUuid)) return null;
    ticketIds[key] = ids;
  }
  const slaDue = value.slaDue;
  if (Array.isArray(slaDue) && slaDue.every(isUuid)) ticketIds.slaDue = slaDue;

  return ticketIds as MetricTicketIds;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function responseData(value: unknown): Record<string, unknown> | null {
  return isRecord(value) && isRecord(value.data) ? value.data : null;
}

function responseStatus(error: unknown): number | null {
  if (!isRecord(error)) return null;
  if (typeof error.status === "number") return error.status;
  return error.context instanceof Response ? error.context.status : null;
}

function isQuietUnavailable(error: unknown): boolean {
  const status = responseStatus(error);
  return status === 401 || status === 403 || status === 404 || status === 503;
}

function shortId(value: string): string {
  return value.length > 12 ? `${value.slice(0, 8)}…` : value;
}

function initials(name: string): string {
  return (
    name
      .split(/\s+/u)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toLocaleUpperCase("de-CH"))
      .join("") || "P"
  );
}

function displayDateTime(value: string | null): string {
  if (!value || Number.isNaN(Date.parse(value))) return "Zeitpunkt unbekannt";
  return new Intl.DateTimeFormat("de-CH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Zurich",
  }).format(new Date(value));
}

function localDateTime(value: string | null): string {
  if (!value || Number.isNaN(Date.parse(value))) return "";
  const date = new Date(value);
  const part = (number: number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(
    date.getDate(),
  )}T${part(date.getHours())}:${part(date.getMinutes())}`;
}

function toIso(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function incidentStatusLabel(status: IncidentStatus): string {
  const labels: Record<IncidentStatus, string> = {
    identified: "Ursache identifiziert",
    investigating: "Untersuchung läuft",
    monitoring: "Beobachtung läuft",
    resolved: "Gelöst",
  };
  return labels[status];
}

function mentionFromValue(value: unknown): Mention | null {
  if (
    !isRecord(value) ||
    !isUuid(value.id) ||
    !isUuid(value.ticket_id) ||
    !isUuid(value.mentioned_user_id) ||
    !isUuid(value.author_id) ||
    (value.comment_id !== null && !isUuid(value.comment_id)) ||
    (value.read_at !== null && !isTimestamp(value.read_at)) ||
    !isTimestamp(value.created_at)
  ) {
    return null;
  }
  return {
    authorId: value.author_id,
    commentId: value.comment_id,
    createdAt: value.created_at,
    id: value.id,
    mentionedUserId: value.mentioned_user_id,
    readAt: value.read_at,
    ticketId: value.ticket_id,
  };
}

function delegationFromValue(value: unknown): Delegation | null {
  if (
    !isRecord(value) ||
    !isUuid(value.id) ||
    !isUuid(value.agent_id) ||
    !isUuid(value.delegate_id) ||
    !isTimestamp(value.starts_at) ||
    !isTimestamp(value.ends_at) ||
    (value.ended_at !== null && !isTimestamp(value.ended_at)) ||
    (value.note !== null && typeof value.note !== "string")
  ) {
    return null;
  }
  return {
    agentId: value.agent_id,
    delegateId: value.delegate_id,
    endedAt: value.ended_at,
    endsAt: value.ends_at,
    id: value.id,
    note: value.note,
    startsAt: value.starts_at,
  };
}

function incidentNoticeFromValue(value: unknown): IncidentNotice | null {
  if (
    !isRecord(value) ||
    !isUuid(value.id) ||
    typeof value.title !== "string" ||
    typeof value.description !== "string" ||
    !isTimestamp(value.starts_at) ||
    !isTimestamp(value.updated_at) ||
    (value.created_at !== undefined &&
      value.created_at !== null &&
      !isTimestamp(value.created_at)) ||
    (value.resolved_at !== null && !isTimestamp(value.resolved_at)) ||
    (value.category_id !== null && !isUuid(value.category_id)) ||
    (value.department_id !== null && !isUuid(value.department_id)) ||
    !["investigating", "identified", "monitoring", "resolved"].includes(
      String(value.status),
    )
  ) {
    return null;
  }
  return {
    categoryId: value.category_id,
    createdAt: typeof value.created_at === "string" ? value.created_at : null,
    departmentId: value.department_id,
    description: value.description,
    id: value.id,
    resolvedAt: value.resolved_at,
    startsAt: value.starts_at,
    status: value.status as IncidentStatus,
    title: value.title,
    updatedAt: value.updated_at,
  };
}

function queueFromValue(value: unknown): TeamQueue | null {
  if (
    !isRecord(value) ||
    !isUuid(value.departmentId) ||
    (value.teamId !== null && !isUuid(value.teamId)) ||
    typeof value.openTickets !== "number" ||
    value.openTickets < 0
  ) {
    return null;
  }
  return {
    departmentId: value.departmentId,
    openTickets: value.openTickets,
    teamId: value.teamId,
  };
}

function peopleFromRows(value: unknown): Person[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const people: Person[] = [];
  for (const raw of value) {
    if (!isRecord(raw) || !isUuid(raw.user_id) || seen.has(raw.user_id))
      continue;
    seen.add(raw.user_id);
    const profile = Array.isArray(raw.user_profiles)
      ? raw.user_profiles[0]
      : raw.user_profiles;
    const profileRecord = isRecord(profile) ? profile : null;
    const displayName = profileRecord?.display_name;
    people.push({
      id: raw.user_id,
      name:
        typeof displayName === "string" && displayName.trim()
          ? displayName.trim()
          : `Person ${shortId(raw.user_id)}`,
    });
  }
  return people.sort((left, right) =>
    left.name.localeCompare(right.name, "de-CH"),
  );
}

async function invokeAgentWorkbench(body: Record<string, unknown>) {
  if (!supabase) throw new Error("supabase_not_configured");
  const { data, error } = await supabase.functions.invoke("agent-workbench", {
    body,
  });
  if (error) throw error;
  return data;
}

function PersonChip({ id, name }: { id: string; name?: string | undefined }) {
  const label = name || `Person ${shortId(id)}`;
  return (
    <span className="workbench-person" title={id}>
      <span aria-hidden="true" className="workbench-avatar">
        {initials(label)}
      </span>
      <span>{label}</span>
    </span>
  );
}

function HelpHint({ children, label }: { children: ReactNode; label: string }) {
  return (
    <span className="workbench-help-wrap">
      <button
        aria-label={`${label}: Hilfe anzeigen`}
        className="workbench-help"
        title={label}
        type="button"
      >
        <CircleHelp aria-hidden="true" size={16} strokeWidth={1.9} />
      </button>
      <span className="workbench-help__text" role="tooltip">
        {children}
      </span>
    </span>
  );
}

function TeamQueuesPanel({
  onOpenQueue,
  tenantId,
}: {
  onOpenQueue: (queue: TeamQueue) => void;
  tenantId: string;
}) {
  const [queues, setQueues] = useState<TeamQueue[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "unavailable">(
    "loading",
  );

  useEffect(() => {
    let mounted = true;
    setState("loading");
    void invokeAgentWorkbench({ tenantId, type: "teamQueues" })
      .then((value) => {
        const data = responseData(value);
        const nextQueues = Array.isArray(data?.queues)
          ? data.queues.map(queueFromValue)
          : [];
        if (!nextQueues.every((queue): queue is TeamQueue => queue !== null)) {
          throw new Error("invalid_team_queues_response");
        }
        if (!mounted) return;
        setQueues(
          [...nextQueues].sort(
            (left, right) => right.openTickets - left.openTickets,
          ),
        );
        setState("ready");
      })
      .catch(() => {
        if (!mounted) return;
        setQueues([]);
        setState("unavailable");
      });
    return () => {
      mounted = false;
    };
  }, [tenantId]);

  return (
    <section
      aria-labelledby="workbench-team-heading"
      className="workbench-panel"
    >
      <div className="workbench-panel__heading">
        <div>
          <p className="eyebrow">TEAM</p>
          <h2 id="workbench-team-heading">Team-Warteschlangen</h2>
          <p>
            Öffnen Sie eine Abteilung, um die bereits für Sie sichtbare
            Ticketliste einzugrenzen.
          </p>
        </div>
        <HelpHint label="Team-Warteschlangen">
          Die Ticketrechte werden weiterhin serverseitig geprüft. Eine
          Warteschlange führt nie zu einer automatischen Zuweisung.
        </HelpHint>
      </div>
      {state === "loading" ? (
        <p aria-busy="true" className="workbench-empty" role="status">
          Warteschlangen werden geladen …
        </p>
      ) : state === "unavailable" ? (
        <p className="workbench-empty" role="status">
          Team-Warteschlangen sind für diesen Mandanten derzeit nicht verfügbar.
        </p>
      ) : queues.length === 0 ? (
        <p className="workbench-empty">
          Keine offenen Warteschlangen vorhanden.
        </p>
      ) : (
        <ul className="workbench-queue-list">
          {queues.map((queue) => (
            <li key={`${queue.departmentId}:${queue.teamId ?? "ohne-team"}`}>
              <button onClick={() => onOpenQueue(queue)} type="button">
                <span className="workbench-queue-list__icon">
                  <UsersRound aria-hidden="true" size={18} strokeWidth={1.8} />
                </span>
                <span>
                  <strong>Abteilung {shortId(queue.departmentId)}</strong>
                  <small>
                    {queue.teamId
                      ? `Team ${shortId(queue.teamId)}`
                      : "Ohne Teamzuordnung"}
                  </small>
                </span>
                <span className="workbench-count">
                  {queue.openTickets} offen
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function MentionsPanel({
  onOpenTicket,
  onUnreadChange,
  tenantId,
}: {
  onOpenTicket: (ticketId: string) => void;
  onUnreadChange: (count: number) => void;
  tenantId: string;
}) {
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "unavailable">(
    "loading",
  );
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let mounted = true;
    setState("loading");
    setMessage("");
    void invokeAgentWorkbench({
      onlyMine: true,
      tenantId,
      type: "listMentions",
    })
      .then((value) => {
        const data = responseData(value);
        const nextMentions = Array.isArray(data?.mentions)
          ? data.mentions.map(mentionFromValue)
          : [];
        if (!nextMentions.every((item): item is Mention => item !== null)) {
          throw new Error("invalid_mentions_response");
        }
        if (!mounted) return;
        setMentions(nextMentions);
        onUnreadChange(
          nextMentions.filter((item) => item.readAt === null).length,
        );
        setState("ready");
      })
      .catch(() => {
        if (!mounted) return;
        setMentions([]);
        onUnreadChange(0);
        setState("unavailable");
      });
    return () => {
      mounted = false;
    };
  }, [onUnreadChange, tenantId]);

  async function openMention(mention: Mention) {
    setMessage("");
    if (mention.readAt === null) {
      setPendingId(mention.id);
      try {
        const value = await invokeAgentWorkbench({
          mentionId: mention.id,
          tenantId,
          type: "markMentionRead",
        });
        const data = responseData(value);
        const readAt = isRecord(data?.mention) ? data.mention.read_at : null;
        if (!isTimestamp(readAt)) throw new Error("invalid_mention_response");
        setMentions((current) => {
          const next = current.map((item) =>
            item.id === mention.id ? { ...item, readAt } : item,
          );
          onUnreadChange(next.filter((item) => item.readAt === null).length);
          return next;
        });
      } catch (error) {
        if (isQuietUnavailable(error)) {
          setState("unavailable");
          onUnreadChange(0);
        } else {
          setMessage(
            "Die Erwähnung konnte nicht als gelesen markiert werden. Bitte versuchen Sie es erneut.",
          );
        }
      } finally {
        setPendingId(null);
      }
    }
    onOpenTicket(mention.ticketId);
  }

  return (
    <section
      aria-labelledby="workbench-mentions-heading"
      className="workbench-panel"
    >
      <div className="workbench-panel__heading">
        <div>
          <p className="eyebrow">EINGANG</p>
          <h2 id="workbench-mentions-heading">Erwähnungen</h2>
          <p>Interne Erwähnungen bleiben an das jeweilige Ticket gebunden.</p>
        </div>
        <HelpHint label="Erwähnungen">
          Beim Öffnen wird eine eigene ungelesene Erwähnung als gelesen
          markiert. Das Ticket und dessen Status werden dadurch nicht verändert.
        </HelpHint>
      </div>
      {state === "loading" ? (
        <p aria-busy="true" className="workbench-empty" role="status">
          Erwähnungen werden geladen …
        </p>
      ) : state === "unavailable" ? (
        <p className="workbench-empty" role="status">
          Erwähnungen sind für diesen Mandanten derzeit nicht verfügbar.
        </p>
      ) : mentions.length === 0 ? (
        <p className="workbench-empty">Keine Erwähnungen in Ihrem Eingang.</p>
      ) : (
        <ul className="workbench-mention-list">
          {mentions.map((mention) => (
            <li key={mention.id}>
              <button
                aria-label={`Erwähnung von Person ${shortId(
                  mention.authorId,
                )} in Ticket ${shortId(mention.ticketId)} öffnen${
                  mention.readAt ? "" : ", ungelesen"
                }`}
                className={
                  mention.readAt
                    ? "workbench-mention"
                    : "workbench-mention workbench-mention--unread"
                }
                disabled={pendingId === mention.id}
                onClick={() => void openMention(mention)}
                type="button"
              >
                <PersonChip id={mention.authorId} />
                <span className="workbench-mention__copy">
                  <strong>
                    Erwähnung in Ticket {shortId(mention.ticketId)}
                  </strong>
                  <small>{displayDateTime(mention.createdAt)}</small>
                </span>
                <span className="workbench-mention__state">
                  <AtSign aria-hidden="true" size={17} strokeWidth={1.9} />
                  {mention.readAt ? "Gelesen" : "Ungelesen"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {message && (
        <p className="workbench-message workbench-message--error" role="alert">
          {message}
        </p>
      )}
    </section>
  );
}

function DelegationsPanel({ tenantId }: { tenantId: string }) {
  const [delegations, setDelegations] = useState<Delegation[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "unavailable">(
    "loading",
  );
  const [delegateId, setDelegateId] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [note, setNote] = useState("");
  const [editing, setEditing] = useState<Delegation | null>(null);
  const [pending, setPending] = useState<"save" | string | null>(null);
  const [message, setMessage] = useState("");

  const peopleById = useMemo(
    () => new Map(people.map((person) => [person.id, person.name])),
    [people],
  );

  function resetEditor() {
    setDelegateId("");
    setStartsAt("");
    setEndsAt("");
    setNote("");
    setEditing(null);
  }

  async function reload() {
    const value = await invokeAgentWorkbench({
      tenantId,
      type: "listDelegations",
    });
    const data = responseData(value);
    const nextDelegations = Array.isArray(data?.delegations)
      ? data.delegations.map(delegationFromValue)
      : [];
    if (
      !nextDelegations.every(
        (delegation): delegation is Delegation => delegation !== null,
      )
    ) {
      throw new Error("invalid_delegations_response");
    }
    setDelegations(nextDelegations);
  }

  useEffect(() => {
    let mounted = true;
    setState("loading");
    setMessage("");
    void Promise.all([
      invokeAgentWorkbench({ tenantId, type: "listDelegations" }),
      supabase
        ? supabase
            .from("tenant_memberships")
            .select("user_id, user_profiles(display_name)")
            .eq("tenant_id", tenantId)
            .eq("status", "active")
        : Promise.resolve({ data: [], error: new Error("not_configured") }),
    ])
      .then(([delegationValue, peopleResult]) => {
        const data = responseData(delegationValue);
        const nextDelegations = Array.isArray(data?.delegations)
          ? data.delegations.map(delegationFromValue)
          : [];
        if (
          !nextDelegations.every(
            (delegation): delegation is Delegation => delegation !== null,
          ) ||
          peopleResult.error
        ) {
          throw new Error("invalid_delegations_response");
        }
        if (!mounted) return;
        setDelegations(nextDelegations);
        setPeople(peopleFromRows(peopleResult.data));
        setState("ready");
      })
      .catch(() => {
        if (!mounted) return;
        setDelegations([]);
        setPeople([]);
        setState("unavailable");
      });
    return () => {
      mounted = false;
    };
  }, [tenantId]);

  function startEdit(delegation: Delegation) {
    setEditing(delegation);
    setDelegateId(delegation.delegateId);
    setStartsAt(localDateTime(delegation.startsAt));
    setEndsAt(localDateTime(delegation.endsAt));
    setNote(delegation.note ?? "");
    setMessage("");
  }

  async function saveDelegation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const start = toIso(startsAt);
    const end = toIso(endsAt);
    if (
      !isUuid(delegateId) ||
      !start ||
      !end ||
      Date.parse(end) <= Date.parse(start)
    ) {
      setMessage(
        "Bitte wählen Sie eine aktive Person sowie einen gültigen, positiven Zeitraum.",
      );
      return;
    }
    setPending("save");
    setMessage("");
    try {
      await invokeAgentWorkbench({
        ...(editing ? { delegationId: editing.id } : {}),
        delegateId,
        endsAt: end,
        note: note.trim() || null,
        startsAt: start,
        tenantId,
        type: "saveDelegation",
      });
      await reload();
      resetEditor();
      setMessage(
        editing
          ? "Stellvertretung wurde aktualisiert."
          : "Stellvertretung wurde angelegt.",
      );
    } catch (error) {
      if (isQuietUnavailable(error)) setState("unavailable");
      else {
        setMessage(
          "Die Stellvertretung konnte nicht gespeichert werden. Prüfen Sie Zeitraum und Berechtigung.",
        );
      }
    } finally {
      setPending(null);
    }
  }

  async function endDelegation(delegation: Delegation) {
    setPending(delegation.id);
    setMessage("");
    try {
      await invokeAgentWorkbench({
        delegationId: delegation.id,
        tenantId,
        type: "endDelegation",
      });
      await reload();
      setMessage("Stellvertretung wurde beendet.");
    } catch (error) {
      if (isQuietUnavailable(error)) setState("unavailable");
      else {
        setMessage(
          "Die Stellvertretung konnte nicht beendet werden. Bitte versuchen Sie es erneut.",
        );
      }
    } finally {
      setPending(null);
    }
  }

  return (
    <section
      aria-labelledby="workbench-delegations-heading"
      className="workbench-panel"
    >
      <div className="workbench-panel__heading">
        <div>
          <p className="eyebrow">PERSÖNLICHE PLANUNG</p>
          <h2 id="workbench-delegations-heading">Stellvertretung</h2>
          <p>Verwalten Sie ausschliesslich Ihre eigenen Stellvertretungen.</p>
        </div>
        <HelpHint label="Stellvertretung">
          Eine Stellvertretung ist eine dokumentierte Vertretungsregel. Sie
          weist keine Tickets zu und ändert keine Rollen oder Agentenstatus.
        </HelpHint>
      </div>
      {state === "loading" ? (
        <p aria-busy="true" className="workbench-empty" role="status">
          Stellvertretungen werden geladen …
        </p>
      ) : state === "unavailable" ? (
        <p className="workbench-empty" role="status">
          Stellvertretungen sind für diesen Mandanten derzeit nicht verfügbar.
        </p>
      ) : (
        <>
          <form
            className="workbench-form"
            onSubmit={(event) => void saveDelegation(event)}
          >
            <div className="workbench-form__heading">
              <strong>
                {editing
                  ? "Stellvertretung bearbeiten"
                  : "Stellvertretung anlegen"}
              </strong>
              {editing && (
                <button
                  className="text-button"
                  onClick={resetEditor}
                  type="button"
                >
                  Abbrechen
                </button>
              )}
            </div>
            <div className="workbench-form__grid">
              <label>
                Stellvertretende Person
                <select
                  disabled={pending !== null}
                  onChange={(event) => setDelegateId(event.target.value)}
                  required
                  value={delegateId}
                >
                  <option value="">Aktive Person auswählen</option>
                  {people.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Beginn
                <input
                  disabled={pending !== null}
                  onChange={(event) => setStartsAt(event.target.value)}
                  required
                  type="datetime-local"
                  value={startsAt}
                />
              </label>
              <label>
                Ende
                <input
                  disabled={pending !== null}
                  onChange={(event) => setEndsAt(event.target.value)}
                  required
                  type="datetime-local"
                  value={endsAt}
                />
              </label>
            </div>
            <label>
              Notiz <span className="workbench-optional">optional</span>
              <textarea
                disabled={pending !== null}
                maxLength={2000}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Zuständigkeit oder Übergabe festhalten"
                rows={2}
                value={note}
              />
            </label>
            <div className="workbench-form__actions">
              <button
                className="primary-button"
                disabled={pending !== null}
                type="submit"
              >
                {pending === "save"
                  ? "Wird gespeichert …"
                  : "Stellvertretung speichern"}
              </button>
            </div>
          </form>
          <div className="workbench-list-heading">
            <strong>Meine Stellvertretungen</strong>
            <span>{delegations.length}</span>
          </div>
          {delegations.length === 0 ? (
            <p className="workbench-empty">
              Noch keine Stellvertretung erfasst.
            </p>
          ) : (
            <ul className="workbench-delegation-list">
              {delegations.map((delegation) => {
                const isEnded = delegation.endedAt !== null;
                return (
                  <li key={delegation.id}>
                    <div>
                      <PersonChip
                        id={delegation.delegateId}
                        name={peopleById.get(delegation.delegateId)}
                      />
                      <p>
                        {displayDateTime(delegation.startsAt)} bis{" "}
                        {displayDateTime(delegation.endsAt)}
                      </p>
                      {delegation.note && <small>{delegation.note}</small>}
                      {isEnded && (
                        <span className="workbench-status">Beendet</span>
                      )}
                    </div>
                    <div className="workbench-row-actions">
                      {!isEnded && (
                        <>
                          <button
                            disabled={pending !== null}
                            onClick={() => startEdit(delegation)}
                            type="button"
                          >
                            Bearbeiten
                          </button>
                          <button
                            className="secondary-button"
                            disabled={pending !== null}
                            onClick={() => void endDelegation(delegation)}
                            type="button"
                          >
                            {pending === delegation.id
                              ? "Wird beendet …"
                              : "Beenden"}
                          </button>
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
      {message && (
        <p
          className={`workbench-message${
            message.includes("konnte") || message.startsWith("Bitte")
              ? " workbench-message--error"
              : " workbench-message--success"
          }`}
          role="status"
        >
          {message}
        </p>
      )}
    </section>
  );
}

function IncidentsPanel({
  canManage,
  tenantId,
}: {
  canManage: boolean;
  tenantId: string;
}) {
  const [notices, setNotices] = useState<IncidentNotice[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "unavailable">(
    "loading",
  );
  const [editing, setEditing] = useState<IncidentNotice | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<IncidentStatus>("investigating");
  const [startsAt, setStartsAt] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function reload() {
    const value = await invokeAgentWorkbench({
      tenantId,
      type: "listIncidentNotices",
    });
    const data = responseData(value);
    const nextNotices = Array.isArray(data?.notices)
      ? data.notices.map(incidentNoticeFromValue)
      : [];
    if (
      !nextNotices.every((notice): notice is IncidentNotice => notice !== null)
    ) {
      throw new Error("invalid_incident_notices_response");
    }
    setNotices(nextNotices);
  }

  useEffect(() => {
    let mounted = true;
    setState("loading");
    setMessage("");
    void reload()
      .then(() => {
        if (mounted) setState("ready");
      })
      .catch(() => {
        if (!mounted) return;
        setNotices([]);
        setState("unavailable");
      });
    return () => {
      mounted = false;
    };
  }, [tenantId]);

  function resetEditor() {
    setEditing(null);
    setTitle("");
    setDescription("");
    setStatus("investigating");
    setStartsAt("");
    setCategoryId("");
    setDepartmentId("");
  }

  function startEdit(notice: IncidentNotice) {
    setEditing(notice);
    setTitle(notice.title);
    setDescription(notice.description);
    setStatus(notice.status);
    setStartsAt(localDateTime(notice.startsAt));
    setCategoryId(notice.categoryId ?? "");
    setDepartmentId(notice.departmentId ?? "");
    setMessage("");
  }

  async function saveNotice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedTitle = title.trim();
    const trimmedDescription = description.trim();
    const start = startsAt ? toIso(startsAt) : null;
    if (
      trimmedTitle.length < 3 ||
      trimmedDescription.length < 3 ||
      (startsAt && !start) ||
      (categoryId && !isUuid(categoryId)) ||
      (departmentId && !isUuid(departmentId))
    ) {
      setMessage(
        "Bitte prüfen Sie Titel, Beschreibung, Zeitpunkt sowie optionale Kategorie- und Abteilungs-ID.",
      );
      return;
    }
    setPending(true);
    setMessage("");
    try {
      await invokeAgentWorkbench({
        ...(editing ? { noticeId: editing.id } : {}),
        ...(start ? { startsAt: start } : {}),
        categoryId: categoryId || null,
        departmentId: departmentId || null,
        description: trimmedDescription,
        status,
        tenantId,
        title: trimmedTitle,
        type: "saveIncidentNotice",
      });
      await reload();
      resetEditor();
      setMessage(
        editing
          ? "Störungsmeldung wurde aktualisiert."
          : "Störungsmeldung wurde veröffentlicht.",
      );
    } catch (error) {
      if (isQuietUnavailable(error)) setState("unavailable");
      else {
        setMessage(
          "Die Störungsmeldung konnte nicht gespeichert werden. Prüfen Sie Ihre Berechtigung.",
        );
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <section
      aria-labelledby="workbench-incidents-heading"
      className="workbench-panel"
    >
      <div className="workbench-panel__heading">
        <div>
          <p className="eyebrow">SERVICEKOMMUNIKATION</p>
          <h2 id="workbench-incidents-heading">Störungsmeldungen</h2>
          <p>
            Aktive Meldungen erscheinen als Hinweis für berechtigte Personen im
            jeweiligen Mandanten.
          </p>
        </div>
        <HelpHint label="Störungsmeldungen">
          Eine Meldung informiert über eine Störung. Sie verändert keine
          Tickets, Zuweisungen oder Abschlüsse.
        </HelpHint>
      </div>
      {state === "loading" ? (
        <p aria-busy="true" className="workbench-empty" role="status">
          Störungsmeldungen werden geladen …
        </p>
      ) : state === "unavailable" ? (
        <p className="workbench-empty" role="status">
          Störungsmeldungen sind für diesen Mandanten derzeit nicht verfügbar.
        </p>
      ) : (
        <>
          {canManage && (
            <form
              className="workbench-form"
              onSubmit={(event) => void saveNotice(event)}
            >
              <div className="workbench-form__heading">
                <strong>
                  {editing
                    ? "Störungsmeldung bearbeiten"
                    : "Störungsmeldung erstellen"}
                </strong>
                {editing && (
                  <button
                    className="text-button"
                    onClick={resetEditor}
                    type="button"
                  >
                    Abbrechen
                  </button>
                )}
              </div>
              <div className="workbench-form__grid">
                <label>
                  Titel
                  <input
                    disabled={pending}
                    maxLength={240}
                    onChange={(event) => setTitle(event.target.value)}
                    required
                    value={title}
                  />
                </label>
                <label>
                  Status
                  <select
                    disabled={pending}
                    onChange={(event) =>
                      setStatus(event.target.value as IncidentStatus)
                    }
                    value={status}
                  >
                    {(
                      [
                        "investigating",
                        "identified",
                        "monitoring",
                        "resolved",
                      ] as const
                    ).map((option) => (
                      <option key={option} value={option}>
                        {incidentStatusLabel(option)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Beginn <span className="workbench-optional">optional</span>
                  <input
                    disabled={pending}
                    onChange={(event) => setStartsAt(event.target.value)}
                    type="datetime-local"
                    value={startsAt}
                  />
                </label>
              </div>
              <label>
                Beschreibung
                <textarea
                  disabled={pending}
                  maxLength={10000}
                  onChange={(event) => setDescription(event.target.value)}
                  required
                  rows={3}
                  value={description}
                />
              </label>
              <details className="workbench-details">
                <summary>Geltungsbereich eingrenzen (optional)</summary>
                <div className="workbench-form__grid">
                  <label>
                    Kategorie-ID
                    <input
                      disabled={pending}
                      onChange={(event) => setCategoryId(event.target.value)}
                      placeholder="UUID"
                      value={categoryId}
                    />
                  </label>
                  <label>
                    Abteilungs-ID
                    <input
                      disabled={pending}
                      onChange={(event) => setDepartmentId(event.target.value)}
                      placeholder="UUID"
                      value={departmentId}
                    />
                  </label>
                </div>
              </details>
              <div className="workbench-form__actions">
                <button
                  className="primary-button"
                  disabled={pending}
                  type="submit"
                >
                  {pending
                    ? "Wird gespeichert …"
                    : editing
                      ? "Änderungen speichern"
                      : "Meldung speichern"}
                </button>
              </div>
            </form>
          )}
          <div className="workbench-list-heading">
            <strong>Gemeldete Störungen</strong>
            <span>{notices.length}</span>
          </div>
          {notices.length === 0 ? (
            <p className="workbench-empty">
              Keine Störungsmeldungen vorhanden.
            </p>
          ) : (
            <ul className="workbench-incident-list">
              {notices.map((notice) => (
                <li key={notice.id}>
                  <div className="workbench-incident-list__main">
                    <span
                      className={`workbench-status workbench-status--${notice.status}`}
                    >
                      <span aria-hidden="true" />
                      {incidentStatusLabel(notice.status)}
                    </span>
                    <strong>{notice.title}</strong>
                    <p>{notice.description}</p>
                    <small>Beginn: {displayDateTime(notice.startsAt)}</small>
                  </div>
                  {canManage && (
                    <button
                      disabled={pending}
                      onClick={() => startEdit(notice)}
                      type="button"
                    >
                      Bearbeiten
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {message && (
        <p
          className={`workbench-message${
            message.includes("konnte") || message.startsWith("Bitte")
              ? " workbench-message--error"
              : " workbench-message--success"
          }`}
          role="status"
        >
          {message}
        </p>
      )}
    </section>
  );
}

export function AgentMetricsCard({
  onOpenTickets,
  tenantId,
}: {
  onOpenTickets?: (filter: { label: string; ticketIds: string[] }) => void;
  tenantId: string;
}) {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "unavailable">(
    "loading",
  );

  useEffect(() => {
    let mounted = true;
    setState("loading");
    void invokeAgentWorkbench({ tenantId, type: "myMetrics" })
      .then((value) => {
        const data = responseData(value);
        const raw = isRecord(data?.metrics) ? data.metrics : null;
        if (
          !raw ||
          typeof raw.open !== "number" ||
          typeof raw.solvedToday !== "number" ||
          typeof raw.dueFollowUps !== "number" ||
          (raw.medianFirstResponseMinutes !== null &&
            typeof raw.medianFirstResponseMinutes !== "number")
        ) {
          throw new Error("invalid_metrics_response");
        }
        const ticketIds = metricTicketIdsFromValue(raw.ticketIds);
        if (!mounted) return;
        setMetrics({
          dueFollowUps: raw.dueFollowUps,
          medianFirstResponseMinutes: raw.medianFirstResponseMinutes,
          open: raw.open,
          solvedToday: raw.solvedToday,
          ...(typeof raw.slaDue === "number" ? { slaDue: raw.slaDue } : {}),
          ...(ticketIds ? { ticketIds } : {}),
        });
        setState("ready");
      })
      .catch(() => {
        if (!mounted) return;
        setMetrics(null);
        setState("unavailable");
      });
    return () => {
      mounted = false;
    };
  }, [tenantId]);

  const responseTime =
    metrics?.medianFirstResponseMinutes === null ||
    metrics?.medianFirstResponseMinutes === undefined
      ? "–"
      : `${Math.round(metrics.medianFirstResponseMinutes)} Min.`;

  return (
    <article
      className="workbench-metrics panel"
      aria-labelledby="workbench-metrics-heading"
    >
      <div className="workbench-metrics__heading">
        <div>
          <p className="eyebrow">PERSÖNLICHE KENNZAHLEN</p>
          <h2 id="workbench-metrics-heading">Meine Kennzahlen</h2>
        </div>
        <HelpHint label="Meine Kennzahlen">
          Die Werte beziehen sich nur auf Ihre eigene Arbeit im aktiven
          Mandanten.
        </HelpHint>
      </div>
      {state === "loading" ? (
        <p aria-busy="true" className="workbench-metrics__empty" role="status">
          Kennzahlen werden geladen …
        </p>
      ) : state === "unavailable" || !metrics ? (
        <p className="workbench-metrics__empty" role="status">
          Meine Kennzahlen sind derzeit nicht verfügbar.
        </p>
      ) : (
        <dl>
          <div>
            <dt>Mir zugewiesen</dt>
            <dd>
              {onOpenTickets && metrics.ticketIds ? (
                <button
                  aria-label={`Mir zugewiesen: ${metrics.open} – passende Tickets anzeigen`}
                  className="workbench-metrics__value-button"
                  onClick={() =>
                    onOpenTickets({
                      label: "Mir zugewiesen",
                      ticketIds: metrics.ticketIds?.assigned ?? [],
                    })
                  }
                  type="button"
                >
                  {metrics.open}
                </button>
              ) : (
                metrics.open
              )}
            </dd>
          </div>
          <div>
            <dt>Heute gelöst</dt>
            <dd>
              {onOpenTickets && metrics.ticketIds ? (
                <button
                  aria-label={`Heute gelöst: ${metrics.solvedToday} – passende Tickets anzeigen`}
                  className="workbench-metrics__value-button"
                  onClick={() =>
                    onOpenTickets({
                      label: "Heute gelöst",
                      ticketIds: metrics.ticketIds?.solvedToday ?? [],
                    })
                  }
                  type="button"
                >
                  {metrics.solvedToday}
                </button>
              ) : (
                metrics.solvedToday
              )}
            </dd>
          </div>
          <div>
            <dt>Median erste Antwort</dt>
            <dd>
              {onOpenTickets && metrics.ticketIds ? (
                <button
                  aria-label={`Median erste Antwort: ${responseTime} – passende Tickets anzeigen`}
                  className="workbench-metrics__value-button"
                  onClick={() =>
                    onOpenTickets({
                      label: "Mit erster Antwort",
                      ticketIds: metrics.ticketIds?.firstResponse ?? [],
                    })
                  }
                  type="button"
                >
                  {responseTime}
                </button>
              ) : (
                responseTime
              )}
            </dd>
          </div>
          <div>
            <dt title="Offene Tickets, bei denen die Frist für die erste Antwort oder für die Lösung erreicht ist">
              Antwort/Lösung fällig
            </dt>
            <dd>
              {metrics.slaDue === undefined ? (
                "–"
              ) : onOpenTickets && metrics.ticketIds?.slaDue ? (
                <button
                  aria-label={`Antwort oder Lösung fällig: ${metrics.slaDue} – passende Tickets anzeigen`}
                  className="workbench-metrics__value-button"
                  onClick={() =>
                    onOpenTickets({
                      label: "Antwort oder Lösung fällig",
                      ticketIds: metrics.ticketIds?.slaDue ?? [],
                    })
                  }
                  type="button"
                >
                  {metrics.slaDue}
                </button>
              ) : (
                metrics.slaDue
              )}
            </dd>
          </div>
        </dl>
      )}
    </article>
  );
}

export function IncidentBanner({
  notices,
}: {
  notices: readonly ActiveIncidentNotice[];
}) {
  if (notices.length === 0) return null;
  const primary = notices[0];
  if (!primary) return null;
  return (
    <section
      aria-label="Aktive Störung"
      className="workbench-incident-banner"
      role="status"
    >
      <AlertTriangle aria-hidden="true" size={21} strokeWidth={1.9} />
      <div>
        <div className="workbench-incident-banner__heading">
          <strong>Aktive Störung: {primary.title}</strong>
          <span>
            {incidentStatusLabel(primary.status)} · Beginn{" "}
            {displayDateTime(primary.startsAt)}
          </span>
        </div>
        <p>{primary.description}</p>
      </div>
      {notices.length > 1 && (
        <span className="workbench-incident-banner__count">
          +{notices.length - 1} weitere
        </span>
      )}
    </section>
  );
}

export function AgentWorkbenchPanel({
  canManageIncidents,
  initialView = "team",
  onOpenQueue,
  onOpenTicket,
  onUnreadMentionsChange,
  tenantId,
}: {
  canManageIncidents: boolean;
  initialView?: WorkbenchView;
  onOpenQueue: (queue: TeamQueue) => void;
  onOpenTicket: (ticketId: string) => void;
  onUnreadMentionsChange: (count: number) => void;
  tenantId: string;
}) {
  const [view, setView] = useState<WorkbenchView>(initialView);

  useEffect(() => {
    setView(initialView);
  }, [initialView]);

  const views: Array<{
    Icon: typeof UsersRound;
    label: string;
    value: WorkbenchView;
  }> = [
    { Icon: UsersRound, label: "Team", value: "team" },
    { Icon: AtSign, label: "Erwähnungen", value: "mentions" },
    { Icon: UserRound, label: "Stellvertretung", value: "delegations" },
    { Icon: BellRing, label: "Störungen", value: "incidents" },
  ];

  return (
    <section className="agent-workbench" aria-label="Agentenwerkbank">
      <header className="agent-workbench__header">
        <div>
          <p className="eyebrow">ARBEITSPLATZ</p>
          <h2>Team und persönliche Arbeit</h2>
          <p>
            Die Werkbank bündelt nur mandantenlokale Arbeit. Vorschläge und
            Hinweise bleiben stets durch Menschen bestätigte Schritte.
          </p>
        </div>
        <ShieldCheck aria-hidden="true" size={24} strokeWidth={1.8} />
      </header>
      <nav
        aria-label="Bereiche der Agentenwerkbank"
        className="agent-workbench__tabs"
      >
        {views.map(({ Icon, label, value }) => (
          <button
            aria-pressed={view === value}
            className={view === value ? "is-active" : ""}
            key={value}
            onClick={() => setView(value)}
            type="button"
          >
            <Icon aria-hidden="true" size={17} strokeWidth={1.9} />
            {label}
          </button>
        ))}
      </nav>
      {view === "team" && (
        <TeamQueuesPanel onOpenQueue={onOpenQueue} tenantId={tenantId} />
      )}
      {view === "mentions" && (
        <MentionsPanel
          onOpenTicket={onOpenTicket}
          onUnreadChange={onUnreadMentionsChange}
          tenantId={tenantId}
        />
      )}
      {view === "delegations" && <DelegationsPanel tenantId={tenantId} />}
      {view === "incidents" && (
        <IncidentsPanel canManage={canManageIncidents} tenantId={tenantId} />
      )}
    </section>
  );
}
