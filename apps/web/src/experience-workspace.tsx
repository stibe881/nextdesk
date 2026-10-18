import {
  AlarmClock,
  CalendarClock,
  Check,
  CircleCheckBig,
  Flag,
  ListTodo,
  Pencil,
  Plus,
  Ticket,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { supabase } from "./lib/supabase";
import "./experience-workspace.css";

export type WorkspaceTicket = {
  assignedToCurrentUser: boolean;
  id: string;
  isClosed: boolean;
  priority?: string;
  recordId?: string;
  state: string;
  subject: string;
};

type FollowUpPriority = "low" | "normal" | "high";
type FollowUp = {
  createdAt: string;
  description: string | null;
  dueAt: string | null;
  id: string;
  priority: FollowUpPriority;
  resolvedAt: string | null;
  ticketId: string | null;
  title: string;
  updatedAt: string;
};
type FollowUpForm = {
  description: string;
  dueAt: string;
  priority: FollowUpPriority;
  ticketId: string;
  title: string;
};
type NoticeTone = "error" | "success";
type ExperienceErrorCode =
  | "experience_feature_disabled"
  | "experience_hub_not_configured"
  | "tenant_feature_lookup_failed";

type ExperienceWorkspaceProps = {
  onChanged: () => void;
  onNotice: (message: string, tone: NoticeTone) => void;
  onOpenTicket: (ticketId: string) => void;
  tenantId: string;
  tickets: readonly WorkspaceTicket[];
};
type MyDayCardProps = {
  onOpenFollowUps: () => void;
  onOpenTicket: (ticketId: string) => void;
  refreshKey: number;
  tenantId: string;
  tickets: readonly WorkspaceTicket[];
};

type PriorityMeta = {
  Icon: LucideIcon;
  label: string;
};

const priorityMeta: Record<FollowUpPriority, PriorityMeta> = {
  high: { Icon: Flag, label: "Hoch" },
  low: { Icon: Flag, label: "Niedrig" },
  normal: { Icon: Flag, label: "Normal" },
};

const emptyForm = (): FollowUpForm => ({
  description: "",
  dueAt: "",
  priority: "normal",
  ticketId: "",
  title: "",
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPriority(value: unknown): value is FollowUpPriority {
  return value === "low" || value === "normal" || value === "high";
}

function followUpFromValue(value: unknown): FollowUp | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.title !== "string" ||
    (typeof value.description !== "string" && value.description !== null) ||
    (typeof value.dueAt !== "string" && value.dueAt !== null) ||
    !isPriority(value.priority) ||
    (typeof value.ticketId !== "string" && value.ticketId !== null) ||
    (typeof value.resolvedAt !== "string" && value.resolvedAt !== null) ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string"
  ) {
    return null;
  }

  return {
    createdAt: value.createdAt,
    description: value.description,
    dueAt: value.dueAt,
    id: value.id,
    priority: value.priority,
    resolvedAt: value.resolvedAt,
    ticketId: value.ticketId,
    title: value.title,
    updatedAt: value.updatedAt,
  };
}

function followUpsFromResponse(value: unknown): FollowUp[] | null {
  if (
    !isRecord(value) ||
    !isRecord(value.data) ||
    !Array.isArray(value.data.followUps)
  ) {
    return null;
  }

  const followUps = value.data.followUps.map(followUpFromValue);
  return followUps.every((followUp): followUp is FollowUp => followUp !== null)
    ? followUps
    : null;
}

function followUpFromResponse(value: unknown): FollowUp | null {
  if (!isRecord(value) || !isRecord(value.data)) return null;
  return followUpFromValue(value.data.followUp);
}

async function experienceErrorCode(
  error: unknown,
): Promise<ExperienceErrorCode | null> {
  if (!isRecord(error) || !(error.context instanceof Response)) return null;

  try {
    const payload = await error.context.clone().json();
    if (!isRecord(payload) || !isRecord(payload.error)) return null;
    const code = payload.error.code;
    return code === "experience_feature_disabled" ||
      code === "experience_hub_not_configured" ||
      code === "tenant_feature_lookup_failed"
      ? code
      : null;
  } catch {
    return null;
  }
}

async function isUnavailableExperienceHub(error: unknown): Promise<boolean> {
  const code = await experienceErrorCode(error);
  if (code) return true;
  if (!isRecord(error)) return false;
  if (typeof error.status === "number" && error.status === 404) return true;
  return error.context instanceof Response && error.context.status === 404;
}

function startOfToday(): Date {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function dateKey(value: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return [date.getFullYear(), date.getMonth(), date.getDate()].join("-");
}

function localDateTimeValue(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function isoFromLocalDateTime(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function quickDueValue(
  kind: "today" | "tomorrow" | "three-days" | "next-week",
): string {
  const date = new Date();
  date.setSeconds(0, 0);
  if (kind === "today") {
    date.setHours(16, 0, 0, 0);
  } else if (kind === "tomorrow") {
    date.setDate(date.getDate() + 1);
    date.setHours(9, 0, 0, 0);
  } else if (kind === "three-days") {
    date.setDate(date.getDate() + 3);
    date.setHours(9, 0, 0, 0);
  } else {
    const day = date.getDay();
    const untilNextMonday = (8 - day) % 7 || 7;
    date.setDate(date.getDate() + untilNextMonday);
    date.setHours(9, 0, 0, 0);
  }
  return localDateTimeValue(date.toISOString());
}

function dueLabel(value: string | null): string {
  if (!value) return "Ohne Fälligkeit";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Fälligkeit nicht verfügbar";
  return new Intl.DateTimeFormat("de-CH", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
  }).format(date);
}

function sortByDue(followUps: readonly FollowUp[]): FollowUp[] {
  return [...followUps].sort((left, right) => {
    if (!left.dueAt && !right.dueAt)
      return left.createdAt.localeCompare(right.createdAt);
    if (!left.dueAt) return 1;
    if (!right.dueAt) return -1;
    return left.dueAt.localeCompare(right.dueAt);
  });
}

function ticketLabel(
  ticketId: string,
  tickets: readonly WorkspaceTicket[],
): string {
  const ticket = tickets.find(
    (item) => (item.recordId ?? item.id) === ticketId,
  );
  return ticket
    ? `${ticket.id} · ${ticket.subject}`
    : "Verknüpftes Ticket öffnen";
}

function FollowUpPriorityLabel({ priority }: { priority: FollowUpPriority }) {
  const { Icon, label } = priorityMeta[priority];
  return (
    <span className={`experience-priority experience-priority--${priority}`}>
      <Icon aria-hidden="true" size={15} strokeWidth={2} />
      {label}
    </span>
  );
}

function FollowUpItem({
  followUp,
  onEdit,
  onOpenTicket,
  onResolve,
  resolving,
  tickets,
}: {
  followUp: FollowUp;
  onEdit: () => void;
  onOpenTicket: (ticketId: string) => void;
  onResolve: () => void;
  resolving: boolean;
  tickets: readonly WorkspaceTicket[];
}) {
  const isResolved = Boolean(followUp.resolvedAt);
  return (
    <article
      className={`experience-follow-up${isResolved ? " is-resolved" : ""}`}
    >
      <div className="experience-follow-up__main">
        <div className="experience-follow-up__meta">
          <FollowUpPriorityLabel priority={followUp.priority} />
          <span className="experience-due">
            <CalendarClock aria-hidden="true" size={15} strokeWidth={1.9} />
            {isResolved
              ? `Erledigt am ${dueLabel(followUp.resolvedAt)}`
              : dueLabel(followUp.dueAt)}
          </span>
        </div>
        <h3>{followUp.title}</h3>
        {followUp.description && <p>{followUp.description}</p>}
        {followUp.ticketId && (
          <button
            className="experience-ticket-link"
            onClick={() => onOpenTicket(followUp.ticketId!)}
            type="button"
          >
            <Ticket aria-hidden="true" size={15} strokeWidth={1.9} />
            {ticketLabel(followUp.ticketId, tickets)}
          </button>
        )}
      </div>
      <div className="experience-follow-up__actions">
        {!isResolved && (
          <button
            aria-label={`Wiedervorlage ${followUp.title} erledigen`}
            className="experience-complete-button"
            disabled={resolving}
            onClick={onResolve}
            type="button"
          >
            <CircleCheckBig aria-hidden="true" size={17} strokeWidth={1.9} />
            {resolving ? "Wird erledigt …" : "Erledigen"}
          </button>
        )}
        {!isResolved && (
          <button
            aria-label={`Wiedervorlage ${followUp.title} bearbeiten`}
            className="experience-icon-button"
            onClick={onEdit}
            type="button"
          >
            <Pencil aria-hidden="true" size={16} strokeWidth={1.9} />
            <span>Bearbeiten</span>
          </button>
        )}
      </div>
    </article>
  );
}

function FollowUpGroups({
  followUps,
  onEdit,
  onOpenTicket,
  onResolve,
  resolvingId,
  tickets,
}: {
  followUps: readonly FollowUp[];
  onEdit: (followUp: FollowUp) => void;
  onOpenTicket: (ticketId: string) => void;
  onResolve: (followUp: FollowUp) => void;
  resolvingId: string | null;
  tickets: readonly WorkspaceTicket[];
}) {
  const today = startOfToday();
  const todayKey = dateKey(today.toISOString());
  const groups: Array<{ entries: FollowUp[]; label: string }> = [
    {
      entries: sortByDue(
        followUps.filter((followUp) => {
          if (!followUp.dueAt) return false;
          const due = new Date(followUp.dueAt);
          return !Number.isNaN(due.getTime()) && due < today;
        }),
      ),
      label: "Überfällig",
    },
    {
      entries: sortByDue(
        followUps.filter(
          (followUp) =>
            followUp.dueAt !== null && dateKey(followUp.dueAt) === todayKey,
        ),
      ),
      label: "Heute",
    },
    {
      entries: sortByDue(
        followUps.filter((followUp) => {
          if (!followUp.dueAt) return false;
          const due = new Date(followUp.dueAt);
          return (
            !Number.isNaN(due.getTime()) &&
            due >= today &&
            dateKey(followUp.dueAt) !== todayKey
          );
        }),
      ),
      label: "Demnächst",
    },
    {
      entries: followUps.filter((followUp) => followUp.dueAt === null),
      label: "Ohne Fälligkeit",
    },
  ];

  return (
    <div className="experience-groups">
      {groups.map(
        (group) =>
          group.entries.length > 0 && (
            <section
              aria-labelledby={`follow-up-group-${group.label}`}
              key={group.label}
            >
              <div className="experience-group-heading">
                <h2 id={`follow-up-group-${group.label}`}>{group.label}</h2>
                <span>{group.entries.length}</span>
              </div>
              <div className="experience-follow-up-list">
                {group.entries.map((followUp) => (
                  <FollowUpItem
                    followUp={followUp}
                    key={followUp.id}
                    onEdit={() => onEdit(followUp)}
                    onOpenTicket={onOpenTicket}
                    onResolve={() => onResolve(followUp)}
                    resolving={resolvingId === followUp.id}
                    tickets={tickets}
                  />
                ))}
              </div>
            </section>
          ),
      )}
    </div>
  );
}

function FollowUpFormDialog({
  followUp,
  onClose,
  onNotice,
  onSaved,
  tenantId,
  tickets,
}: {
  followUp: FollowUp | null;
  onClose: () => void;
  onNotice: (message: string, tone: NoticeTone) => void;
  onSaved: (followUp: FollowUp) => void;
  tenantId: string;
  tickets: readonly WorkspaceTicket[];
}) {
  const [form, setForm] = useState<FollowUpForm>(() =>
    followUp
      ? {
          description: followUp.description ?? "",
          dueAt: localDateTimeValue(followUp.dueAt),
          priority: followUp.priority,
          ticketId: followUp.ticketId ?? "",
          title: followUp.title,
        }
      : emptyForm(),
  );
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  const ticketOptions = useMemo(() => {
    const known = new Map<string, WorkspaceTicket>();
    for (const ticket of tickets)
      known.set(ticket.recordId ?? ticket.id, ticket);
    return [...known.entries()];
  }, [tickets]);
  const selectedTicketKnown =
    !form.ticketId || ticketOptions.some(([id]) => id === form.ticketId);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const title = form.title.trim();
    const description = form.description.trim();
    const dueAt = isoFromLocalDateTime(form.dueAt);
    if (!title) {
      setFormError("Bitte geben Sie einen Titel ein.");
      return;
    }
    if (form.dueAt && !dueAt) {
      setFormError(
        "Die Fälligkeit ist ungültig. Bitte prüfen Sie Datum und Uhrzeit.",
      );
      return;
    }
    if (!supabase) {
      setFormError("Wiedervorlagen sind in dieser Umgebung nicht verfügbar.");
      return;
    }

    setSaving(true);
    setFormError("");
    try {
      const { data, error } = await supabase.functions.invoke(
        "experience-hub",
        {
          body: {
            ...(followUp ? { followUpId: followUp.id } : {}),
            description: description || null,
            dueAt,
            priority: form.priority,
            tenantId,
            ticketId: form.ticketId || null,
            title,
            type: "saveFollowUp",
          },
        },
      );
      if (error) throw error;
      const saved = followUpFromResponse(data);
      if (!saved) throw new Error("invalid_experience_hub_response");
      onSaved(saved);
      onNotice(
        followUp
          ? "Wiedervorlage wurde aktualisiert."
          : "Wiedervorlage wurde angelegt.",
        "success",
      );
      onClose();
    } catch (error) {
      if (await isUnavailableExperienceHub(error)) {
        setFormError(
          "Wiedervorlagen sind für diesen Mandanten derzeit nicht verfügbar.",
        );
      } else {
        setFormError(
          "Die Wiedervorlage konnte nicht gespeichert werden. Bitte versuchen Sie es erneut.",
        );
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      aria-label={
        followUp ? "Wiedervorlage bearbeiten" : "Wiedervorlage anlegen"
      }
      aria-modal="true"
      className="experience-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !saving) onClose();
      }}
      role="dialog"
    >
      <section
        className="experience-dialog"
        onKeyDown={(event) => event.key === "Escape" && !saving && onClose()}
      >
        <header>
          <div>
            <p className="eyebrow">WIEDERVORLAGE</p>
            <h2>
              {followUp ? "Wiedervorlage bearbeiten" : "Wiedervorlage anlegen"}
            </h2>
          </div>
          <button
            aria-label="Dialog schliessen"
            className="experience-dialog__close"
            disabled={saving}
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" size={19} strokeWidth={1.9} />
          </button>
        </header>
        <form onSubmit={(event) => void submit(event)}>
          <label>
            Titel
            <input
              autoFocus
              maxLength={240}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  title: event.target.value,
                }))
              }
              placeholder="Nächsten Schritt festhalten"
              required
              value={form.title}
            />
          </label>
          <label>
            Beschreibung <span className="experience-optional">optional</span>
            <textarea
              maxLength={5000}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  description: event.target.value,
                }))
              }
              placeholder="Was ist zu prüfen oder zu erledigen?"
              value={form.description}
            />
          </label>
          <label>
            Fälligkeit <span className="experience-optional">optional</span>
            <input
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  dueAt: event.target.value,
                }))
              }
              type="datetime-local"
              value={form.dueAt}
            />
          </label>
          <div
            className="experience-quick-dates"
            aria-label="Fälligkeit schnell wählen"
          >
            <button
              onClick={() =>
                setForm((current) => ({
                  ...current,
                  dueAt: quickDueValue("today"),
                }))
              }
              type="button"
            >
              Heute 16:00
            </button>
            <button
              onClick={() =>
                setForm((current) => ({
                  ...current,
                  dueAt: quickDueValue("tomorrow"),
                }))
              }
              type="button"
            >
              Morgen 09:00
            </button>
            <button
              onClick={() =>
                setForm((current) => ({
                  ...current,
                  dueAt: quickDueValue("three-days"),
                }))
              }
              type="button"
            >
              In 3 Tagen
            </button>
            <button
              onClick={() =>
                setForm((current) => ({
                  ...current,
                  dueAt: quickDueValue("next-week"),
                }))
              }
              type="button"
            >
              Nächste Woche
            </button>
          </div>
          <label>
            Priorität
            <select
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  priority: event.target.value as FollowUpPriority,
                }))
              }
              value={form.priority}
            >
              {(Object.keys(priorityMeta) as FollowUpPriority[]).map(
                (priority) => (
                  <option key={priority} value={priority}>
                    {priorityMeta[priority].label}
                  </option>
                ),
              )}
            </select>
          </label>
          <label>
            Ticketbezug <span className="experience-optional">optional</span>
            <select
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  ticketId: event.target.value,
                }))
              }
              value={form.ticketId}
            >
              <option value="">Kein Ticket verknüpfen</option>
              {!selectedTicketKnown && (
                <option value={form.ticketId}>
                  Aktuell verknüpftes Ticket
                </option>
              )}
              {ticketOptions.map(([ticketId, ticket]) => (
                <option key={ticketId} value={ticketId}>
                  {ticket.id} · {ticket.subject}
                </option>
              ))}
            </select>
            <span className="experience-field-note">
              Es werden nur bereits geladene, für Sie sichtbare Tickets
              angeboten.
            </span>
          </label>
          {formError && (
            <p
              aria-live="polite"
              className="experience-form-error"
              role="alert"
            >
              {formError}
            </p>
          )}
          <footer>
            <button disabled={saving} onClick={onClose} type="button">
              Abbrechen
            </button>
            <button className="primary-button" disabled={saving} type="submit">
              {saving
                ? "Wird gespeichert …"
                : followUp
                  ? "Änderungen speichern"
                  : "Wiedervorlage anlegen"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

export function ExperienceWorkspace({
  onChanged,
  onNotice,
  onOpenTicket,
  tenantId,
  tickets,
}: ExperienceWorkspaceProps) {
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [showResolved, setShowResolved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [availabilityNote, setAvailabilityNote] = useState("");
  const [reloadVersion, setReloadVersion] = useState(0);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [editorFollowUp, setEditorFollowUp] = useState<
    FollowUp | null | undefined
  >(undefined);

  useEffect(() => {
    if (!supabase) {
      setFollowUps([]);
      setAvailabilityNote(
        "Wiedervorlagen sind in dieser Umgebung noch nicht verfügbar.",
      );
      setLoading(false);
      return;
    }

    let mounted = true;
    setLoading(true);
    setAvailabilityNote("");
    void supabase.functions
      .invoke("experience-hub", {
        body: {
          includeResolved: showResolved,
          limit: 100,
          tenantId,
          type: "listFollowUps",
        },
      })
      .then(({ data, error }) => {
        if (error) throw error;
        const nextFollowUps = followUpsFromResponse(data);
        if (!nextFollowUps) throw new Error("invalid_experience_hub_response");
        if (mounted) setFollowUps(nextFollowUps);
      })
      .catch(async (error: unknown) => {
        if (!mounted) return;
        setFollowUps([]);
        if (await isUnavailableExperienceHub(error)) {
          setAvailabilityNote(
            "Wiedervorlagen sind für diesen Mandanten derzeit nicht verfügbar.",
          );
          return;
        }
        setAvailabilityNote(
          "Wiedervorlagen konnten nicht geladen werden. Bitte versuchen Sie es erneut.",
        );
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [reloadVersion, showResolved, tenantId]);

  const openFollowUps = useMemo(
    () => followUps.filter((followUp) => followUp.resolvedAt === null),
    [followUps],
  );
  const resolvedFollowUps = useMemo(
    () => followUps.filter((followUp) => followUp.resolvedAt !== null),
    [followUps],
  );

  const saveFollowUp = (saved: FollowUp) => {
    setFollowUps((current) => {
      const existingIndex = current.findIndex(
        (followUp) => followUp.id === saved.id,
      );
      if (existingIndex === -1) return [saved, ...current];
      return current.map((followUp) =>
        followUp.id === saved.id ? saved : followUp,
      );
    });
    onChanged();
  };

  const resolveFollowUp = async (followUp: FollowUp) => {
    if (!supabase) return;
    setResolvingId(followUp.id);
    try {
      const { data, error } = await supabase.functions.invoke(
        "experience-hub",
        {
          body: { followUpId: followUp.id, tenantId, type: "resolveFollowUp" },
        },
      );
      if (error) throw error;
      const resolved = followUpFromResponse(data);
      if (!resolved) throw new Error("invalid_experience_hub_response");
      setFollowUps((current) =>
        showResolved
          ? current.map((item) => (item.id === resolved.id ? resolved : item))
          : current.filter((item) => item.id !== resolved.id),
      );
      onChanged();
      onNotice("Wiedervorlage erledigt.", "success");
    } catch (error) {
      if (await isUnavailableExperienceHub(error)) {
        setAvailabilityNote(
          "Wiedervorlagen sind für diesen Mandanten derzeit nicht verfügbar.",
        );
      } else {
        onNotice(
          "Die Wiedervorlage konnte nicht erledigt werden. Bitte versuchen Sie es erneut.",
          "error",
        );
      }
    } finally {
      setResolvingId(null);
    }
  };

  const displayedFollowUps = showResolved ? resolvedFollowUps : openFollowUps;

  return (
    <section
      className="experience-workspace"
      aria-labelledby="follow-ups-heading"
    >
      <header className="experience-workspace__header">
        <div>
          <p className="eyebrow">PERSÖNLICHE ARBEIT</p>
          <h2 id="follow-ups-heading">Wiedervorlagen</h2>
          <p>
            Behalten Sie Ihre nächsten Schritte und verknüpfte Tickets im Blick.
          </p>
        </div>
        <button
          className="primary-button experience-create-button"
          onClick={() => setEditorFollowUp(null)}
          type="button"
        >
          <Plus aria-hidden="true" size={17} strokeWidth={2} />
          Wiedervorlage anlegen
        </button>
      </header>
      <div className="experience-toolbar">
        <div
          className="experience-segmented"
          aria-label="Status der Wiedervorlagen"
        >
          <button
            aria-pressed={!showResolved}
            className={!showResolved ? "is-active" : ""}
            onClick={() => setShowResolved(false)}
            type="button"
          >
            Offen
          </button>
          <button
            aria-pressed={showResolved}
            className={showResolved ? "is-active" : ""}
            onClick={() => setShowResolved(true)}
            type="button"
          >
            Erledigt
          </button>
        </div>
        <span className="data-caption">
          {loading
            ? "Wird geladen …"
            : `${displayedFollowUps.length} ${showResolved ? "erledigt" : "offen"}`}
        </span>
      </div>
      {loading ? (
        <div aria-busy="true" className="experience-empty-state" role="status">
          Wiedervorlagen werden geladen …
        </div>
      ) : availabilityNote ? (
        <div
          aria-live="polite"
          className="experience-empty-state experience-empty-state--notice"
          role="status"
        >
          <AlarmClock aria-hidden="true" size={21} strokeWidth={1.8} />
          <div>
            <strong>Hinweis</strong>
            <span>{availabilityNote}</span>
          </div>
          <button
            onClick={() => setReloadVersion((current) => current + 1)}
            type="button"
          >
            Erneut versuchen
          </button>
        </div>
      ) : displayedFollowUps.length === 0 ? (
        <div className="experience-empty-state">
          <CircleCheckBig aria-hidden="true" size={23} strokeWidth={1.8} />
          <div>
            <strong>
              {showResolved
                ? "Noch keine erledigten Wiedervorlagen."
                : "Keine offenen Wiedervorlagen."}
            </strong>
            <span>
              {showResolved
                ? "Erledigte Wiedervorlagen bleiben hier als persönlicher Verlauf sichtbar."
                : "Legen Sie eine Wiedervorlage an, um einen nächsten Schritt verbindlich festzuhalten."}
            </span>
          </div>
        </div>
      ) : showResolved ? (
        <div className="experience-follow-up-list">
          {sortByDue(displayedFollowUps).map((followUp) => (
            <FollowUpItem
              followUp={followUp}
              key={followUp.id}
              onEdit={() => undefined}
              onOpenTicket={onOpenTicket}
              onResolve={() => undefined}
              resolving={false}
              tickets={tickets}
            />
          ))}
        </div>
      ) : (
        <FollowUpGroups
          followUps={displayedFollowUps}
          onEdit={(followUp) => setEditorFollowUp(followUp)}
          onOpenTicket={onOpenTicket}
          onResolve={(followUp) => void resolveFollowUp(followUp)}
          resolvingId={resolvingId}
          tickets={tickets}
        />
      )}
      {editorFollowUp !== undefined && (
        <FollowUpFormDialog
          followUp={editorFollowUp}
          onClose={() => setEditorFollowUp(undefined)}
          onNotice={onNotice}
          onSaved={saveFollowUp}
          tenantId={tenantId}
          tickets={tickets}
        />
      )}
    </section>
  );
}

export function MyDayCard({
  onOpenFollowUps,
  onOpenTicket,
  refreshKey,
  tenantId,
  tickets,
}: MyDayCardProps) {
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    if (!supabase) {
      setFollowUps([]);
      setUnavailable(true);
      setLoading(false);
      return;
    }

    let mounted = true;
    setLoading(true);
    setUnavailable(false);
    void supabase.functions
      .invoke("experience-hub", {
        body: { limit: 100, tenantId, type: "listFollowUps" },
      })
      .then(({ data, error }) => {
        if (error) throw error;
        const nextFollowUps = followUpsFromResponse(data);
        if (!nextFollowUps) throw new Error("invalid_experience_hub_response");
        if (mounted) setFollowUps(nextFollowUps);
      })
      .catch(async (error: unknown) => {
        if (!mounted) return;
        setFollowUps([]);
        setUnavailable(await isUnavailableExperienceHub(error));
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [refreshKey, tenantId]);

  const today = startOfToday();
  const todayKey = dateKey(today.toISOString());
  const relevantFollowUps = useMemo(
    () =>
      sortByDue(
        followUps.filter((followUp) => {
          if (!followUp.dueAt) return false;
          const due = new Date(followUp.dueAt);
          return (
            !Number.isNaN(due.getTime()) &&
            (due < today || dateKey(followUp.dueAt) === todayKey)
          );
        }),
      ),
    [followUps, today, todayKey],
  );
  const assignedTickets = useMemo(
    () =>
      tickets.filter(
        (ticket) => ticket.assignedToCurrentUser && !ticket.isClosed,
      ),
    [tickets],
  );

  return (
    <article className="panel my-day-card" aria-labelledby="my-day-heading">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">PERSÖNLICHE AGENDA</p>
          <h2 id="my-day-heading">Mein Tag</h2>
        </div>
        <button className="text-button" onClick={onOpenFollowUps} type="button">
          Alle Wiedervorlagen
          <ListTodo aria-hidden="true" size={16} strokeWidth={1.8} />
        </button>
      </div>
      {loading ? (
        <p aria-busy="true" className="my-day-card__empty" role="status">
          Ihr Tag wird vorbereitet …
        </p>
      ) : (
        <div className="my-day-card__body">
          <section aria-labelledby="my-day-follow-ups-heading">
            <div className="my-day-card__section-heading">
              <h3 id="my-day-follow-ups-heading">
                <AlarmClock aria-hidden="true" size={16} strokeWidth={1.9} />{" "}
                Fällig oder überfällig
              </h3>
              <span>{relevantFollowUps.length}</span>
            </div>
            {unavailable ? (
              <p className="my-day-card__empty">
                Wiedervorlagen sind momentan nicht verfügbar.
              </p>
            ) : relevantFollowUps.length === 0 ? (
              <p className="my-day-card__empty">
                Keine Wiedervorlage ist heute fällig. Planen Sie den nächsten
                Schritt in Ruhe.
              </p>
            ) : (
              <ul className="my-day-card__list">
                {relevantFollowUps.slice(0, 4).map((followUp) => (
                  <li key={followUp.id}>
                    <div>
                      <strong>{followUp.title}</strong>
                      <span>
                        {dueLabel(followUp.dueAt)} ·{" "}
                        <FollowUpPriorityLabel priority={followUp.priority} />
                      </span>
                    </div>
                    {followUp.ticketId && (
                      <button
                        aria-label={`${ticketLabel(followUp.ticketId, tickets)} öffnen`}
                        className="my-day-card__ticket"
                        onClick={() => onOpenTicket(followUp.ticketId!)}
                        type="button"
                      >
                        <Ticket
                          aria-hidden="true"
                          size={15}
                          strokeWidth={1.9}
                        />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section aria-labelledby="my-day-tickets-heading">
            <div className="my-day-card__section-heading">
              <h3 id="my-day-tickets-heading">
                <Ticket aria-hidden="true" size={16} strokeWidth={1.9} /> Mir
                zugewiesene Tickets
              </h3>
              <span>{assignedTickets.length}</span>
            </div>
            {assignedTickets.length === 0 ? (
              <p className="my-day-card__empty">
                Keine offenen, Ihnen zugewiesenen Tickets in den geladenen
                Daten.
              </p>
            ) : (
              <ul className="my-day-card__list">
                {assignedTickets.slice(0, 4).map((ticket) => (
                  <li key={ticket.recordId ?? ticket.id}>
                    <button
                      className="my-day-card__ticket-copy"
                      onClick={() => onOpenTicket(ticket.recordId ?? ticket.id)}
                      type="button"
                    >
                      <strong>{ticket.id}</strong>
                      <span>
                        {ticket.subject} · {ticket.state}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
      {!loading &&
        (relevantFollowUps.length > 4 || assignedTickets.length > 4) && (
          <p className="my-day-card__more">
            Weitere Aufgaben finden Sie in Wiedervorlagen beziehungsweise
            Tickets.
          </p>
        )}
    </article>
  );
}
