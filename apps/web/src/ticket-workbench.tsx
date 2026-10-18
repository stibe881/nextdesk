import {
  AlertCircle,
  BookOpenCheck,
  Check,
  ChevronDown,
  CircleCheck,
  Clock3,
  Lightbulb,
  LoaderCircle,
  MessageSquareMore,
  RefreshCw,
  RotateCcw,
  UserRoundCheck,
  UsersRound,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "./lib/supabase";
import "./ticket-workbench.css";

export type WorkbenchPerson = {
  id: string;
  displayName: string;
};

export type WorkbenchCategory = {
  id: string;
  name: string;
  parentId: string | null;
};

export type WorkbenchPriority = {
  id: string;
  label: string;
};

export type WorkbenchTicket = {
  id: string;
  ticketNumber: string;
  subject: string;
  statusLabel: string;
  priorityLabel: string;
  requesterName: string;
  isClosed: boolean;
  isResolved: boolean;
};

type Macro = {
  id: string;
  name: string;
  responseText: string | null;
  categoryId: string | null;
  subcategoryId: string | null;
  priorityId: string | null;
};

type MacroPreview = Pick<
  Macro,
  "responseText" | "categoryId" | "subcategoryId" | "priorityId"
>;

type AssigneeSuggestion = {
  userId: string;
  score: number;
  reasons: string[];
};

type PublicTimelineItem =
  | { type: "event"; id: string; eventType: string; occurredAt: string }
  | {
      type: "comment";
      id: string;
      body: string;
      occurredAt: string;
      authorDisplayName: string | null;
    };

type ReopenRequest = {
  id: string;
  ticketId: string;
  requestedBy: string;
  reason: string;
  status: "pending" | "accepted" | "declined";
  createdAt: string;
  decidedAt: string | null;
};

type SlaExpectation = {
  responseDueAt: string | null;
  resolutionDueAt: string | null;
  message: string;
};

type AgentContext = {
  requesterTickets: Array<Record<string, unknown>>;
  assets: Array<Record<string, unknown>>;
  assetHistory: Array<Record<string, unknown>>;
  resolutionConfirmations: Array<Record<string, unknown>>;
  sla: SlaExpectation | null;
};

type Availability = "checking" | "available" | "unavailable";

type TicketWorkbenchProps = {
  tenantId: string;
  currentUserId: string | null;
  ticket: WorkbenchTicket;
  isRequester: boolean;
  hasAgentAccess: boolean;
  canAssign: boolean;
  canUpdate: boolean;
  canUseInternalNotes: boolean;
  people: readonly WorkbenchPerson[];
  categories: readonly WorkbenchCategory[];
  priorities: readonly WorkbenchPriority[];
  onApplyMacro: (preview: MacroPreview) => Promise<void>;
  onPrefillAssignee: (agentId: string) => void;
};

type TicketMentionPickerProps = {
  disabled: boolean;
  enabled: boolean;
  people: readonly WorkbenchPerson[];
  selectedIds: readonly string[];
  onChange: (personIds: string[]) => void;
  onInsertMention: (displayName: string) => void;
};

type DraftOptions = {
  body: string;
  onRestore: (body: string) => void;
  tenantId: string;
  ticketId: string;
  userId: string | null;
  visibility: "external" | "internal";
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

function isTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 64 &&
    !value.includes("\u0000") &&
    Number.isFinite(Date.parse(value))
  );
}

function functionErrorStatus(error: unknown): number | null {
  const value = asRecord(error);
  if (!value) return null;
  if (typeof value.status === "number") return value.status;
  if (value.context instanceof Response) return value.context.status;
  const context = asRecord(value.context);
  return typeof context?.status === "number" ? context.status : null;
}

function isUnavailable(error: unknown): boolean {
  const status = functionErrorStatus(error);
  return status === null || status === 401 || status === 403 || status === 404;
}

async function invokeWorkbench(
  functionName: "agent-workbench" | "requester-portal",
  body: Record<string, unknown>,
): Promise<unknown> {
  if (!supabase) throw new Error("Supabase ist nicht konfiguriert.");
  const { data, error } = await supabase.functions.invoke(functionName, {
    body,
  });
  if (error) throw error;
  return data;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Zeitpunkt nicht verfügbar";
  return new Intl.DateTimeFormat("de-CH", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function eventLabel(value: string): string {
  const labels: Record<string, string> = {
    "ticket.closed": "Ticket abgeschlossen",
    "ticket.comment.external": "Externe Nachricht",
    "ticket.created": "Ticket erstellt",
    "ticket.resolved": "Ticket gelöst",
    "ticket.status_changed": "Status geändert",
  };
  return (
    labels[value] ??
    value
      .replaceAll(/[._-]+/g, " ")
      .replace(/^./, (character) => character.toLocaleUpperCase("de-CH"))
  );
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : value === null ? null : null;
}

function toMacro(value: unknown): Macro | null {
  const row = asRecord(value);
  if (!row || !isUuid(row.id) || typeof row.name !== "string") return null;
  const responseText =
    typeof row.response_text === "string"
      ? row.response_text
      : typeof row.responseText === "string"
        ? row.responseText
        : row.response_text === null || row.responseText === null
          ? null
          : null;
  const categoryId = stringOrNull(row.category_id ?? row.categoryId);
  const subcategoryId = stringOrNull(row.subcategory_id ?? row.subcategoryId);
  const priorityId = stringOrNull(row.priority_id ?? row.priorityId);
  if (
    (categoryId !== null && !isUuid(categoryId)) ||
    (subcategoryId !== null && !isUuid(subcategoryId)) ||
    (priorityId !== null && !isUuid(priorityId))
  ) {
    return null;
  }
  return {
    id: row.id,
    name: row.name.trim(),
    responseText,
    categoryId,
    subcategoryId,
    priorityId,
  };
}

function parseMacros(value: unknown): Macro[] | null {
  const data = asRecord(asRecord(value)?.data);
  if (!data || !Array.isArray(data.macros) || data.macros.length > 500)
    return null;
  const macros = data.macros.map(toMacro);
  return macros.every((macro): macro is Macro => macro !== null)
    ? macros
    : null;
}

function parseMacroPreview(value: unknown): MacroPreview | null {
  const data = asRecord(asRecord(value)?.data);
  const preview = asRecord(data?.preview);
  if (!preview || data?.applied !== false) return null;
  const responseText = stringOrNull(
    preview.responseText ?? preview.response_text,
  );
  const categoryId = stringOrNull(preview.categoryId ?? preview.category_id);
  const subcategoryId = stringOrNull(
    preview.subcategoryId ?? preview.subcategory_id,
  );
  const priorityId = stringOrNull(preview.priorityId ?? preview.priority_id);
  if (
    (categoryId !== null && !isUuid(categoryId)) ||
    (subcategoryId !== null && !isUuid(subcategoryId)) ||
    (priorityId !== null && !isUuid(priorityId))
  ) {
    return null;
  }
  return { responseText, categoryId, subcategoryId, priorityId };
}

function parseSuggestions(value: unknown): {
  suggestions: AssigneeSuggestion[];
  notice: string;
} | null {
  const data = asRecord(asRecord(value)?.data);
  if (
    !data ||
    !Array.isArray(data.suggestions) ||
    typeof data.notice !== "string"
  )
    return null;
  const suggestions = data.suggestions.map((value) => {
    const item = asRecord(value);
    if (
      !item ||
      !isUuid(item.userId) ||
      typeof item.score !== "number" ||
      !Number.isFinite(item.score) ||
      !Array.isArray(item.reasons) ||
      !item.reasons.every((reason) => typeof reason === "string") ||
      item.automaticAssignment !== false
    ) {
      return null;
    }
    return {
      userId: item.userId,
      score: item.score,
      reasons: item.reasons,
    };
  });
  return suggestions.every(
    (suggestion): suggestion is AssigneeSuggestion => suggestion !== null,
  )
    ? { suggestions, notice: data.notice }
    : null;
}

function parseAgentContext(value: unknown): AgentContext | null {
  const data = asRecord(asRecord(value)?.data);
  if (
    !data ||
    !Array.isArray(data.requesterTickets) ||
    !Array.isArray(data.assets) ||
    !Array.isArray(data.assetHistory) ||
    !Array.isArray(data.resolutionConfirmations)
  ) {
    return null;
  }
  const toRecords = (
    items: unknown[],
  ): Array<Record<string, unknown>> | null => {
    const records = items.map(asRecord);
    return records.every(
      (item): item is Record<string, unknown> => item !== null,
    )
      ? records
      : null;
  };
  const requesterTickets = toRecords(data.requesterTickets);
  const assets = toRecords(data.assets);
  const assetHistory = toRecords(data.assetHistory);
  const resolutionConfirmations = toRecords(data.resolutionConfirmations);
  if (
    !requesterTickets ||
    !assets ||
    !assetHistory ||
    !resolutionConfirmations
  ) {
    return null;
  }
  const ticket = asRecord(data.ticket);
  const sla = ticket
    ? parseSlaExpectation({
        data: {
          expectation: {
            responseDueAt: ticket.response_due_at ?? null,
            resolutionDueAt: ticket.resolution_due_at ?? null,
            message: "SLA-Zeiten aus den Ticketdaten.",
          },
        },
      })
    : null;
  return {
    requesterTickets,
    assets,
    assetHistory,
    resolutionConfirmations,
    sla,
  };
}

function parseSlaExpectation(value: unknown): SlaExpectation | null {
  const data = asRecord(asRecord(value)?.data);
  const expectation = asRecord(data?.expectation);
  if (!expectation || typeof expectation.message !== "string") return null;
  const responseDueAt = stringOrNull(expectation.responseDueAt);
  const resolutionDueAt = stringOrNull(expectation.resolutionDueAt);
  if (
    (responseDueAt !== null && !isTimestamp(responseDueAt)) ||
    (resolutionDueAt !== null && !isTimestamp(resolutionDueAt))
  ) {
    return null;
  }
  return { responseDueAt, resolutionDueAt, message: expectation.message };
}

function parseTimeline(value: unknown): PublicTimelineItem[] | null {
  const data = asRecord(asRecord(value)?.data);
  if (!data || !Array.isArray(data.timeline) || data.timeline.length > 500)
    return null;
  const timeline = data.timeline.map((value) => {
    const item = asRecord(value);
    if (!item || !isUuid(item.id) || !isTimestamp(item.occurredAt)) return null;
    if (item.type === "event" && typeof item.eventType === "string") {
      return {
        type: "event" as const,
        id: item.id,
        eventType: item.eventType,
        occurredAt: item.occurredAt,
      };
    }
    if (
      item.type === "comment" &&
      typeof item.body === "string" &&
      (typeof item.authorDisplayName === "string" ||
        item.authorDisplayName === null)
    ) {
      return {
        type: "comment" as const,
        id: item.id,
        body: item.body,
        occurredAt: item.occurredAt,
        authorDisplayName: item.authorDisplayName,
      };
    }
    return null;
  });
  return timeline.every((item): item is PublicTimelineItem => item !== null)
    ? timeline
    : null;
}

function toReopenRequest(value: unknown): ReopenRequest | null {
  const item = asRecord(value);
  if (
    !item ||
    !isUuid(item.id) ||
    !isUuid(item.ticket_id ?? item.ticketId) ||
    !isUuid(item.requested_by ?? item.requestedBy) ||
    typeof item.reason !== "string" ||
    (item.status !== "pending" &&
      item.status !== "accepted" &&
      item.status !== "declined") ||
    !isTimestamp(item.created_at ?? item.createdAt)
  ) {
    return null;
  }
  const decidedAt = stringOrNull(item.decided_at ?? item.decidedAt);
  if (decidedAt !== null && !isTimestamp(decidedAt)) return null;
  return {
    id: item.id,
    ticketId: (item.ticket_id ?? item.ticketId) as string,
    requestedBy: (item.requested_by ?? item.requestedBy) as string,
    reason: item.reason,
    status: item.status,
    createdAt: (item.created_at ?? item.createdAt) as string,
    decidedAt,
  };
}

function parseReopenRequests(value: unknown): ReopenRequest[] | null {
  const data = asRecord(asRecord(value)?.data);
  if (
    !data ||
    !Array.isArray(data.reopenRequests) ||
    data.reopenRequests.length > 200
  )
    return null;
  const requests = data.reopenRequests.map(toReopenRequest);
  return requests.every((request): request is ReopenRequest => request !== null)
    ? requests
    : null;
}

function contextLabel(
  value: Record<string, unknown>,
  keys: readonly string[],
  fallback: string,
): string {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate;
  }
  return fallback;
}

function relativeSlaLabel(dueAt: string | null, now: number): string | null {
  if (!dueAt) return null;
  const due = Date.parse(dueAt);
  if (Number.isNaN(due)) return null;
  const differenceMinutes = Math.round((due - now) / 60_000);
  const absolute = Math.abs(differenceMinutes);
  const hours = Math.floor(absolute / 60);
  const minutes = absolute % 60;
  const duration =
    hours > 0 ? `${hours} Std. ${minutes} Min.` : `${minutes} Min.`;
  return differenceMinutes >= 0
    ? `noch ${duration}`
    : `seit ${duration} überfällig`;
}

function useNow(interval = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), interval);
    return () => window.clearInterval(timer);
  }, [interval]);
  return now;
}

export function useTicketReplyDraft({
  body,
  onRestore,
  tenantId,
  ticketId,
  userId,
  visibility,
}: DraftOptions): { restored: boolean; clearRestoredNotice: () => void } {
  const [restored, setRestored] = useState(false);
  const restoredKey = useRef<string | null>(null);
  const storageKey = useMemo(
    () =>
      userId && isUuid(tenantId) && isUuid(ticketId)
        ? `nextdesk:ticket-reply-draft:${tenantId}:${ticketId}:${userId}:${visibility}`
        : null,
    [tenantId, ticketId, userId, visibility],
  );

  useEffect(() => {
    if (!storageKey || restoredKey.current === storageKey) return;
    restoredKey.current = storageKey;
    setRestored(false);
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (!stored) return;
      const draft = asRecord(JSON.parse(stored));
      if (
        !draft ||
        typeof draft.body !== "string" ||
        draft.body.length === 0 ||
        draft.body.length > 50_000 ||
        draft.body.includes("\u0000")
      ) {
        window.localStorage.removeItem(storageKey);
        return;
      }
      onRestore(draft.body);
      setRestored(true);
    } catch {
      // Storage is optional. A blocked or malformed local draft must not affect ticket work.
    }
  }, [onRestore, storageKey]);

  useEffect(() => {
    if (!storageKey || restoredKey.current !== storageKey) return;
    try {
      if (body) {
        window.localStorage.setItem(storageKey, JSON.stringify({ body }));
      } else {
        window.localStorage.removeItem(storageKey);
      }
    } catch {
      // Local draft storage may be unavailable in a restricted browser context.
    }
  }, [body, storageKey]);

  return {
    restored,
    clearRestoredNotice: () => setRestored(false),
  };
}

export function TicketMentionPicker({
  disabled,
  enabled,
  people,
  selectedIds,
  onChange,
  onInsertMention,
}: TicketMentionPickerProps) {
  const [expanded, setExpanded] = useState(false);
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);

  useEffect(() => {
    if (!enabled) setExpanded(false);
  }, [enabled]);

  if (!enabled || people.length === 0) return null;

  return (
    <section
      className="ticket-workbench__mentions"
      aria-label="Personen erwähnen"
    >
      <button
        aria-expanded={expanded}
        className="text-button ticket-workbench__mention-toggle"
        disabled={disabled}
        onClick={() => setExpanded((current) => !current)}
        type="button"
      >
        <MessageSquareMore aria-hidden="true" size={16} />
        Personen mit @ erwähnen{selected.size > 0 ? ` (${selected.size})` : ""}
        <ChevronDown aria-hidden="true" size={15} />
      </button>
      {expanded && (
        <div className="ticket-workbench__mention-picker">
          <p>
            Erwähnungen werden erst nach dem Speichern dieser internen Notiz an
            ausgewählte aktive Mandantenpersonen angelegt.
          </p>
          <ul>
            {people.map((person) => {
              const checked = selected.has(person.id);
              return (
                <li key={person.id}>
                  <label>
                    <input
                      checked={checked}
                      disabled={disabled}
                      onChange={() => {
                        onChange(
                          checked
                            ? selectedIds.filter((id) => id !== person.id)
                            : [...selectedIds, person.id],
                        );
                        if (!checked) onInsertMention(person.displayName);
                      }}
                      type="checkbox"
                    />
                    <span>{person.displayName}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

function SlaLine({ expectation }: { expectation: SlaExpectation | null }) {
  const now = useNow();
  const resolution = relativeSlaLabel(
    expectation?.resolutionDueAt ?? null,
    now,
  );
  const response = relativeSlaLabel(expectation?.responseDueAt ?? null, now);
  const value = resolution ?? response;
  return (
    <span className="ticket-workbench__context-value">
      <Clock3 aria-hidden="true" size={15} />
      {value
        ? `SLA ${resolution ? "Lösung" : "Antwort"}: ${value}`
        : (expectation?.message ?? "SLA-Zeit nicht verfügbar")}
    </span>
  );
}

function TicketContextHeader({
  ticket,
  expectation,
}: {
  ticket: WorkbenchTicket;
  expectation: SlaExpectation | null;
}) {
  return (
    <section
      className="ticket-workbench__context-header"
      aria-label="Aktueller Ticketkontext"
    >
      <div className="ticket-workbench__context-ticket">
        <span>{ticket.ticketNumber}</span>
        <strong>{ticket.statusLabel}</strong>
      </div>
      <div className="ticket-workbench__context-meta">
        <span className="ticket-workbench__context-value">
          Priorität: {ticket.priorityLabel}
        </span>
        <span className="ticket-workbench__context-value">
          Anfragende Person: {ticket.requesterName}
        </span>
        <SlaLine expectation={expectation} />
      </div>
    </section>
  );
}

function MacroPanel({
  tenantId,
  ticket,
  categories,
  priorities,
  onApplyMacro,
}: {
  tenantId: string;
  ticket: WorkbenchTicket;
  categories: readonly WorkbenchCategory[];
  priorities: readonly WorkbenchPriority[];
  onApplyMacro: (preview: MacroPreview) => Promise<void>;
}) {
  const [availability, setAvailability] = useState<Availability>("checking");
  const [macros, setMacros] = useState<Macro[]>([]);
  const [selectedMacroId, setSelectedMacroId] = useState("");
  const [preview, setPreview] = useState<MacroPreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [applying, setApplying] = useState(false);
  const [notice, setNotice] = useState("");
  const requestSequence = useRef(0);

  const selectedMacro = useMemo(
    () => macros.find((macro) => macro.id === selectedMacroId) ?? null,
    [macros, selectedMacroId],
  );
  const categoryName = useCallback(
    (id: string | null) =>
      id
        ? (categories.find((category) => category.id === id)?.name ??
          "Unbekannt")
        : "Keine Änderung",
    [categories],
  );
  const priorityName = useCallback(
    (id: string | null) =>
      id
        ? (priorities.find((priority) => priority.id === id)?.label ??
          "Unbekannt")
        : "Keine Änderung",
    [priorities],
  );

  const load = useCallback(async () => {
    const requestId = ++requestSequence.current;
    try {
      const result = parseMacros(
        await invokeWorkbench("agent-workbench", {
          type: "listMacros",
          tenantId,
        }),
      );
      if (!result) throw new Error("invalid_macro_response");
      if (requestId !== requestSequence.current) return;
      setMacros(result);
      setAvailability("available");
    } catch (error) {
      if (requestId !== requestSequence.current) return;
      setMacros([]);
      setAvailability(isUnavailable(error) ? "unavailable" : "unavailable");
    }
  }, [tenantId]);

  useEffect(() => {
    setAvailability("checking");
    setMacros([]);
    setSelectedMacroId("");
    setPreview(null);
    setNotice("");
    void load();
    return () => {
      requestSequence.current += 1;
    };
  }, [load, ticket.id]);

  async function previewSelectedMacro() {
    if (!selectedMacro || loadingPreview) return;
    setLoadingPreview(true);
    setNotice("");
    try {
      const result = parseMacroPreview(
        await invokeWorkbench("agent-workbench", {
          type: "previewMacro",
          tenantId,
          ticketId: ticket.id,
          macroId: selectedMacro.id,
        }),
      );
      if (!result) throw new Error("invalid_macro_preview");
      setPreview(result);
    } catch (error) {
      if (isUnavailable(error)) setAvailability("unavailable");
      else setNotice("Die Makrovorschau ist derzeit nicht verfügbar.");
    } finally {
      setLoadingPreview(false);
    }
  }

  async function applyPreview() {
    if (!preview || applying) return;
    setApplying(true);
    setNotice("");
    try {
      await onApplyMacro(preview);
      setPreview(null);
      setNotice(
        "Makro wurde in den Antwortentwurf und die bestehenden Ticketfelder übernommen. Bitte prüfen und speichern Sie Ihre Antwort getrennt.",
      );
    } catch {
      setNotice(
        "Das Makro konnte nicht übernommen werden. Bitte versuchen Sie es erneut.",
      );
    } finally {
      setApplying(false);
    }
  }

  if (availability === "unavailable") return null;

  return (
    <section
      className="ticket-workbench__panel"
      aria-labelledby="ticket-macro-heading"
    >
      <div className="ticket-workbench__panel-heading">
        <div>
          <p className="eyebrow">ANTWORTVORLAGE</p>
          <h3 id="ticket-macro-heading">Makro anwenden</h3>
        </div>
        <button
          aria-label="Makros aktualisieren"
          className="more-button"
          disabled={availability === "checking" || loadingPreview || applying}
          onClick={() => void load()}
          type="button"
        >
          <RefreshCw aria-hidden="true" size={16} />
        </button>
      </div>
      {availability === "checking" ? (
        <p className="data-caption" role="status">
          Makros werden geladen …
        </p>
      ) : macros.length === 0 ? (
        <p className="data-caption">
          Für diesen Mandanten sind keine Makros verfügbar.
        </p>
      ) : (
        <div className="ticket-workbench__macro-controls">
          <label>
            Makro auswählen
            <select
              disabled={loadingPreview || applying}
              onChange={(event) => {
                setSelectedMacroId(event.target.value);
                setPreview(null);
              }}
              value={selectedMacroId}
            >
              <option value="">Bitte wählen</option>
              {macros.map((macro) => (
                <option key={macro.id} value={macro.id}>
                  {macro.name}
                </option>
              ))}
            </select>
          </label>
          <button
            className="secondary-button"
            disabled={!selectedMacro || loadingPreview || applying}
            onClick={() => void previewSelectedMacro()}
            type="button"
          >
            {loadingPreview ? (
              <LoaderCircle
                aria-hidden="true"
                className="ticket-detail-spinner"
                size={16}
              />
            ) : (
              <Lightbulb aria-hidden="true" size={16} />
            )}
            Vorschau anzeigen
          </button>
        </div>
      )}
      {preview && (
        <div
          className="ticket-workbench__confirmation"
          role="group"
          aria-label="Makrovorschau bestätigen"
        >
          <strong>Änderungen prüfen</strong>
          <dl>
            <div>
              <dt>Antworttext</dt>
              <dd>{preview.responseText || "Keine Änderung"}</dd>
            </div>
            <div>
              <dt>Kategorie</dt>
              <dd>{categoryName(preview.categoryId)}</dd>
            </div>
            <div>
              <dt>Unterkategorie</dt>
              <dd>{categoryName(preview.subcategoryId)}</dd>
            </div>
            <div>
              <dt>Priorität</dt>
              <dd>{priorityName(preview.priorityId)}</dd>
            </div>
          </dl>
          <p>
            Das Makro weist niemanden zu, ändert keinen Status und schliesst
            kein Ticket.
          </p>
          <div className="ticket-workbench__actions">
            <button
              className="primary-button"
              disabled={applying}
              onClick={() => void applyPreview()}
              type="button"
            >
              {applying ? (
                <LoaderCircle
                  aria-hidden="true"
                  className="ticket-detail-spinner"
                  size={16}
                />
              ) : (
                <Check aria-hidden="true" size={16} />
              )}
              Übernehmen
            </button>
            <button
              className="secondary-button"
              disabled={applying}
              onClick={() => setPreview(null)}
              type="button"
            >
              Abbrechen
            </button>
          </div>
        </div>
      )}
      {notice && (
        <p className="ticket-workbench__notice" role="status">
          {notice}
        </p>
      )}
    </section>
  );
}

function AssigneePanel({
  tenantId,
  ticketId,
  people,
  canAssign,
  onPrefillAssignee,
}: {
  tenantId: string;
  ticketId: string;
  people: readonly WorkbenchPerson[];
  canAssign: boolean;
  onPrefillAssignee: (agentId: string) => void;
}) {
  const [availability, setAvailability] = useState<Availability>("checking");
  const [suggestions, setSuggestions] = useState<AssigneeSuggestion[]>([]);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);

  const personById = useMemo(
    () => new Map(people.map((person) => [person.id, person])),
    [people],
  );

  const load = useCallback(async () => {
    if (!canAssign) return;
    setLoading(true);
    setNotice("");
    try {
      const result = parseSuggestions(
        await invokeWorkbench("agent-workbench", {
          type: "suggestAssignees",
          tenantId,
          ticketId,
        }),
      );
      if (!result) throw new Error("invalid_assignee_suggestions");
      setSuggestions(result.suggestions);
      setNotice(result.notice);
      setAvailability("available");
    } catch (error) {
      setSuggestions([]);
      setAvailability(isUnavailable(error) ? "unavailable" : "unavailable");
    } finally {
      setLoading(false);
    }
  }, [canAssign, tenantId, ticketId]);

  useEffect(() => {
    setAvailability(canAssign ? "checking" : "unavailable");
    setSuggestions([]);
    setNotice("");
    if (canAssign) void load();
  }, [canAssign, load]);

  if (!canAssign || availability === "unavailable") return null;

  return (
    <section
      className="ticket-workbench__panel"
      aria-labelledby="ticket-assignee-suggestions-heading"
    >
      <div className="ticket-workbench__panel-heading">
        <div>
          <p className="eyebrow">VORSCHLAG</p>
          <h3 id="ticket-assignee-suggestions-heading">Zuweisungsvorschläge</h3>
        </div>
        <button
          aria-label="Zuweisungsvorschläge aktualisieren"
          className="more-button"
          disabled={loading}
          onClick={() => void load()}
          type="button"
        >
          <RefreshCw aria-hidden="true" size={16} />
        </button>
      </div>
      {availability === "checking" ? (
        <p className="data-caption" role="status">
          Vorschläge werden vorbereitet …
        </p>
      ) : suggestions.length === 0 ? (
        <p className="data-caption">
          Derzeit liegt kein geeigneter Vorschlag vor.
        </p>
      ) : (
        <ol className="ticket-workbench__suggestions">
          {suggestions.map((suggestion) => {
            const person = personById.get(suggestion.userId);
            const absence = suggestion.reasons.some((reason) =>
              reason.toLocaleLowerCase("de-CH").includes("abwesend"),
            );
            return (
              <li key={suggestion.userId}>
                <div>
                  <strong>{person?.displayName ?? "Verfügbare Person"}</strong>
                  <span>Bewertung: {Math.round(suggestion.score)} von 100</span>
                  <ul>
                    {suggestion.reasons.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                  {absence && (
                    <p className="ticket-workbench__absence">
                      Abwesenheit erfasst: Bitte Stellvertretung prüfen und die
                      Zuweisung bewusst bestätigen.
                    </p>
                  )}
                </div>
                <button
                  className="secondary-button"
                  disabled={!person || loading}
                  onClick={() => {
                    if (!person) return;
                    onPrefillAssignee(person.id);
                    setNotice(
                      `${person.displayName} ist in der bestehenden manuellen Zuweisung vorausgewählt. Es wurde noch nichts zugewiesen.`,
                    );
                  }}
                  type="button"
                >
                  <UserRoundCheck aria-hidden="true" size={16} />
                  Manuell vorwählen
                </button>
              </li>
            );
          })}
        </ol>
      )}
      <p className="ticket-workbench__notice" role="status">
        {notice || "Vorschläge führen nie zu einer automatischen Zuweisung."}
      </p>
    </section>
  );
}

function ContextPanel({
  tenantId,
  ticketId,
  enabled,
  onSla,
}: {
  tenantId: string;
  ticketId: string;
  enabled: boolean;
  onSla: (expectation: SlaExpectation | null) => void;
}) {
  const [availability, setAvailability] = useState<Availability>("checking");
  const [context, setContext] = useState<AgentContext | null>(null);

  const load = useCallback(async () => {
    if (!enabled) return;
    try {
      const result = parseAgentContext(
        await invokeWorkbench("agent-workbench", {
          type: "ticketContext",
          tenantId,
          ticketId,
        }),
      );
      if (!result) throw new Error("invalid_ticket_context");
      setContext(result);
      onSla(result.sla);
      setAvailability("available");
    } catch (error) {
      onSla(null);
      setContext(null);
      setAvailability(isUnavailable(error) ? "unavailable" : "unavailable");
    }
  }, [enabled, onSla, tenantId, ticketId]);

  useEffect(() => {
    setAvailability(enabled ? "checking" : "unavailable");
    setContext(null);
    if (enabled) void load();
  }, [enabled, load]);

  if (!enabled || availability === "unavailable") return null;

  return (
    <aside
      className="ticket-workbench__context-panel"
      aria-labelledby="ticket-context-heading"
    >
      <div className="ticket-workbench__panel-heading">
        <div>
          <p className="eyebrow">360°-KONTEXT</p>
          <h3 id="ticket-context-heading">Zusammenhang</h3>
        </div>
        <button
          aria-label="Kontext aktualisieren"
          className="more-button"
          disabled={availability === "checking"}
          onClick={() => void load()}
          type="button"
        >
          <RefreshCw aria-hidden="true" size={16} />
        </button>
      </div>
      {availability === "checking" || !context ? (
        <p className="data-caption" role="status">
          Kontext wird geladen …
        </p>
      ) : (
        <div className="ticket-workbench__context-groups">
          <section>
            <h4>Weitere Tickets der anfragenden Person</h4>
            {context.requesterTickets.length === 0 ? (
              <p>Keine weiteren sichtbaren Tickets.</p>
            ) : (
              <ul>
                {context.requesterTickets.slice(0, 5).map((item) => (
                  <li key={String(item.id)}>
                    <strong>
                      {contextLabel(
                        item,
                        ["ticket_number", "ticketNumber"],
                        "Ticket",
                      )}
                    </strong>
                    <span>
                      {contextLabel(item, ["subject"], "Ohne Betreff")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section>
            <h4>Betroffene Assets</h4>
            {context.assets.length === 0 ? (
              <p>Keine betroffenen Assets verknüpft.</p>
            ) : (
              <ul>
                {context.assets.slice(0, 5).map((item) => (
                  <li key={String(item.id)}>
                    <strong>{contextLabel(item, ["name"], "Asset")}</strong>
                    <span>
                      {contextLabel(
                        item,
                        ["asset_tag", "lifecycle_state"],
                        "Status nicht verfügbar",
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section>
            <h4>Asset-Verlauf</h4>
            {context.assetHistory.length === 0 ? (
              <p>Kein Asset-Verlauf vorhanden.</p>
            ) : (
              <ul>
                {context.assetHistory.slice(0, 3).map((item, index) => (
                  <li key={`${String(item.asset_id)}-${index}`}>
                    <strong>
                      {contextLabel(
                        item,
                        ["next_state", "previous_state"],
                        "Statusänderung",
                      )}
                    </strong>
                    <span>
                      {contextLabel(item, ["reason"], "Ohne Begründung")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section>
            <h4>Lösungsrückmeldungen</h4>
            {context.resolutionConfirmations.length === 0 ? (
              <p>Keine Rückmeldung zur Lösung vorhanden.</p>
            ) : (
              <ul>
                {context.resolutionConfirmations.slice(0, 3).map((item) => (
                  <li key={String(item.id)}>
                    <strong>
                      {item.confirmed === true
                        ? "Als gelöst bestätigt"
                        : "Noch nicht gelöst"}
                    </strong>
                    <span>
                      {typeof item.confirmed_at === "string"
                        ? formatDateTime(item.confirmed_at)
                        : "Zeitpunkt nicht verfügbar"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </aside>
  );
}

function KnowledgeDraftButton({
  tenantId,
  ticket,
  canUpdate,
}: {
  tenantId: string;
  ticket: WorkbenchTicket;
  canUpdate: boolean;
}) {
  const [confirmation, setConfirmation] = useState(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  const [available, setAvailable] = useState(true);

  if (!canUpdate || !available) return null;

  async function createDraft() {
    setPending(true);
    setNotice("");
    try {
      const result = asRecord(
        asRecord(
          await invokeWorkbench("agent-workbench", {
            type: "knowledgeDraftFromTicket",
            tenantId,
            ticketId: ticket.id,
          }),
        )?.data,
      );
      const article = asRecord(result?.article);
      if (
        !article ||
        article.status !== "review" ||
        result?.published !== false
      ) {
        throw new Error("invalid_knowledge_draft");
      }
      setConfirmation(false);
      setNotice(
        "Wissensentwurf wurde zur Prüfung erstellt und nicht veröffentlicht.",
      );
    } catch (error) {
      if (isUnavailable(error)) setAvailable(false);
      else
        setNotice(
          "Der Wissensentwurf konnte nicht erstellt werden. Bitte versuchen Sie es erneut.",
        );
    } finally {
      setPending(false);
    }
  }

  return (
    <section
      className="ticket-workbench__knowledge"
      aria-label="Wissensentwurf"
    >
      <button
        className="secondary-button"
        disabled={pending}
        onClick={() => setConfirmation(true)}
        type="button"
      >
        <BookOpenCheck aria-hidden="true" size={16} />
        Wissensentwurf erstellen
      </button>
      {confirmation && (
        <div
          className="ticket-workbench__confirmation"
          role="group"
          aria-label="Wissensentwurf bestätigen"
        >
          <strong>Wissensentwurf aus Ticket erstellen?</strong>
          <p>
            Es wird ein interner Entwurf mit Prüfantrag erzeugt. Er wird nicht
            veröffentlicht und ändert dieses Ticket nicht.
          </p>
          <div className="ticket-workbench__actions">
            <button
              className="primary-button"
              disabled={pending}
              onClick={() => void createDraft()}
              type="button"
            >
              {pending ? (
                <LoaderCircle
                  aria-hidden="true"
                  className="ticket-detail-spinner"
                  size={16}
                />
              ) : (
                <Check aria-hidden="true" size={16} />
              )}{" "}
              Entwurf bestätigen
            </button>
            <button
              className="secondary-button"
              disabled={pending}
              onClick={() => setConfirmation(false)}
              type="button"
            >
              Abbrechen
            </button>
          </div>
        </div>
      )}
      {notice && (
        <p className="ticket-workbench__notice" role="status">
          {notice}
        </p>
      )}
    </section>
  );
}

function RequesterPortal({
  tenantId,
  ticket,
  enabled,
  onSla,
}: {
  tenantId: string;
  ticket: WorkbenchTicket;
  enabled: boolean;
  onSla: (expectation: SlaExpectation | null) => void;
}) {
  const [availability, setAvailability] = useState<Availability>("checking");
  const [timeline, setTimeline] = useState<PublicTimelineItem[]>([]);
  const [reason, setReason] = useState("");
  const [showReopen, setShowReopen] = useState(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    if (!enabled) return;
    try {
      const [timelineResponse, slaResponse] = await Promise.all([
        invokeWorkbench("requester-portal", {
          type: "myTicketTimeline",
          tenantId,
          ticketId: ticket.id,
        }),
        invokeWorkbench("requester-portal", {
          type: "slaExpectation",
          tenantId,
          ticketId: ticket.id,
        }),
      ]);
      const nextTimeline = parseTimeline(timelineResponse);
      const expectation = parseSlaExpectation(slaResponse);
      if (!nextTimeline || !expectation)
        throw new Error("invalid_requester_portal");
      setTimeline(nextTimeline);
      onSla(expectation);
      setAvailability("available");
    } catch (error) {
      setTimeline([]);
      onSla(null);
      setAvailability(isUnavailable(error) ? "unavailable" : "unavailable");
    }
  }, [enabled, onSla, tenantId, ticket.id]);

  useEffect(() => {
    setAvailability(enabled ? "checking" : "unavailable");
    setTimeline([]);
    setShowReopen(false);
    setReason("");
    setNotice("");
    if (enabled) void load();
  }, [enabled, load]);

  async function requestReopen() {
    const cleaned = reason.trim();
    if (cleaned.length < 3 || cleaned.length > 3_000 || pending) {
      setNotice(
        "Bitte begründen Sie die Wiedereröffnung mit 3 bis 3'000 Zeichen.",
      );
      return;
    }
    setPending(true);
    setNotice("");
    try {
      const result = asRecord(
        asRecord(
          await invokeWorkbench("requester-portal", {
            type: "requestReopen",
            tenantId,
            ticketId: ticket.id,
            reason: cleaned,
          }),
        )?.data,
      );
      if (!asRecord(result?.reopenRequest) || result?.ticketChanged !== false) {
        throw new Error("invalid_reopen_response");
      }
      setShowReopen(false);
      setReason("");
      setNotice(
        "Ihre Wiedereröffnungsanfrage wurde übermittelt. Der Ticketstatus wurde nicht automatisch geändert.",
      );
    } catch (error) {
      if (isUnavailable(error)) setAvailability("unavailable");
      else
        setNotice(
          "Die Wiedereröffnungsanfrage konnte nicht übermittelt werden. Bitte versuchen Sie es erneut.",
        );
    } finally {
      setPending(false);
    }
  }

  if (!enabled || availability === "unavailable") return null;

  return (
    <section
      className="ticket-workbench__requester"
      aria-labelledby="ticket-public-timeline-heading"
    >
      <div className="ticket-workbench__panel-heading">
        <div>
          <p className="eyebrow">ÖFFENTLICHER VERLAUF</p>
          <h3 id="ticket-public-timeline-heading">Ihr Ticketverlauf</h3>
        </div>
        <button
          aria-label="Ticketverlauf aktualisieren"
          className="more-button"
          disabled={availability === "checking" || pending}
          onClick={() => void load()}
          type="button"
        >
          <RefreshCw aria-hidden="true" size={16} />
        </button>
      </div>
      {availability === "checking" ? (
        <p className="data-caption" role="status">
          Verlauf wird geladen …
        </p>
      ) : timeline.length === 0 ? (
        <p className="data-caption">
          Noch keine öffentlichen Einträge vorhanden.
        </p>
      ) : (
        <ol className="ticket-workbench__public-timeline">
          {timeline.map((item) => (
            <li key={item.id}>
              <time dateTime={item.occurredAt}>
                {formatDateTime(item.occurredAt)}
              </time>
              {item.type === "event" ? (
                <span>{eventLabel(item.eventType)}</span>
              ) : (
                <div>
                  <strong>{item.authorDisplayName ?? "nextDesk"}</strong>
                  <p>{item.body}</p>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
      {(ticket.isClosed || ticket.isResolved) && (
        <div className="ticket-workbench__reopen">
          {!showReopen ? (
            <button
              className="secondary-button"
              disabled={pending}
              onClick={() => setShowReopen(true)}
              type="button"
            >
              <RotateCcw aria-hidden="true" size={16} /> Wiedereröffnung
              beantragen
            </button>
          ) : (
            <div className="ticket-workbench__confirmation">
              <label>
                Begründung für die Wiedereröffnung
                <textarea
                  disabled={pending}
                  maxLength={3000}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Was ist noch offen?"
                  rows={3}
                  value={reason}
                />
              </label>
              <p>
                Der Antrag ändert den Ticketstatus nicht automatisch. Ein
                berechtigter Agent entscheidet darüber.
              </p>
              <div className="ticket-workbench__actions">
                <button
                  className="primary-button"
                  disabled={pending || reason.trim().length < 3}
                  onClick={() => void requestReopen()}
                  type="button"
                >
                  {pending ? (
                    <LoaderCircle
                      aria-hidden="true"
                      className="ticket-detail-spinner"
                      size={16}
                    />
                  ) : (
                    <Check aria-hidden="true" size={16} />
                  )}{" "}
                  Antrag bestätigen
                </button>
                <button
                  className="secondary-button"
                  disabled={pending}
                  onClick={() => setShowReopen(false)}
                  type="button"
                >
                  Abbrechen
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {notice && (
        <p className="ticket-workbench__notice" role="status">
          {notice}
        </p>
      )}
    </section>
  );
}

function ReopenRequests({
  tenantId,
  ticketId,
  enabled,
}: {
  tenantId: string;
  ticketId: string;
  enabled: boolean;
}) {
  const [availability, setAvailability] = useState<Availability>("checking");
  const [requests, setRequests] = useState<ReopenRequest[]>([]);
  const [decision, setDecision] = useState<{
    id: string;
    value: "accepted" | "declined";
  } | null>(null);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    if (!enabled) return;
    try {
      const result = parseReopenRequests(
        await invokeWorkbench("agent-workbench", {
          type: "listReopenRequests",
          tenantId,
        }),
      );
      if (!result) throw new Error("invalid_reopen_requests");
      setRequests(result.filter((request) => request.ticketId === ticketId));
      setAvailability("available");
    } catch (error) {
      setRequests([]);
      setAvailability(isUnavailable(error) ? "unavailable" : "unavailable");
    }
  }, [enabled, tenantId, ticketId]);

  useEffect(() => {
    setAvailability(enabled ? "checking" : "unavailable");
    setRequests([]);
    setDecision(null);
    setNotice("");
    if (enabled) void load();
  }, [enabled, load]);

  async function saveDecision() {
    if (!decision || pending) return;
    setPending(true);
    setNotice("");
    try {
      const data = asRecord(
        asRecord(
          await invokeWorkbench("agent-workbench", {
            type: "decideReopenRequest",
            tenantId,
            reopenRequestId: decision.id,
            decision: decision.value,
          }),
        )?.data,
      );
      if (
        !asRecord(data?.reopenRequest) ||
        data?.ticketReopened !== false ||
        typeof data?.notice !== "string"
      ) {
        throw new Error("invalid_reopen_decision");
      }
      setDecision(null);
      setNotice(data.notice);
      await load();
    } catch (error) {
      if (isUnavailable(error)) setAvailability("unavailable");
      else
        setNotice(
          "Die Entscheidung konnte nicht gespeichert werden. Bitte versuchen Sie es erneut.",
        );
    } finally {
      setPending(false);
    }
  }

  if (!enabled || availability === "unavailable") return null;
  const pendingRequests = requests.filter(
    (request) => request.status === "pending",
  );
  if (availability === "checking")
    return (
      <p className="data-caption" role="status">
        Wiedereröffnungsanfragen werden geladen …
      </p>
    );
  if (pendingRequests.length === 0 && !notice) return null;

  return (
    <section
      className="ticket-workbench__reopen-requests"
      aria-labelledby="ticket-reopen-requests-heading"
    >
      <div className="ticket-workbench__panel-heading">
        <div>
          <p className="eyebrow">ANFRAGEN</p>
          <h3 id="ticket-reopen-requests-heading">Wiedereröffnungsanfragen</h3>
        </div>
        <button
          aria-label="Wiedereröffnungsanfragen aktualisieren"
          className="more-button"
          disabled={pending}
          onClick={() => void load()}
          type="button"
        >
          <RefreshCw aria-hidden="true" size={16} />
        </button>
      </div>
      {pendingRequests.map((request) => (
        <article key={request.id}>
          <p>{request.reason}</p>
          <span>Beantragt am {formatDateTime(request.createdAt)}</span>
          {decision?.id === request.id ? (
            <div className="ticket-workbench__confirmation">
              <strong>
                {decision.value === "accepted"
                  ? "Annahme bestätigen?"
                  : "Ablehnung bestätigen?"}
              </strong>
              <p>Dieser Entscheid ändert den Ticketstatus nicht automatisch.</p>
              <div className="ticket-workbench__actions">
                <button
                  className="primary-button"
                  disabled={pending}
                  onClick={() => void saveDecision()}
                  type="button"
                >
                  {pending ? (
                    <LoaderCircle
                      aria-hidden="true"
                      className="ticket-detail-spinner"
                      size={16}
                    />
                  ) : (
                    <Check aria-hidden="true" size={16} />
                  )}{" "}
                  Entscheidung bestätigen
                </button>
                <button
                  className="secondary-button"
                  disabled={pending}
                  onClick={() => setDecision(null)}
                  type="button"
                >
                  Abbrechen
                </button>
              </div>
            </div>
          ) : (
            <div className="ticket-workbench__actions">
              <button
                className="secondary-button"
                disabled={pending}
                onClick={() =>
                  setDecision({ id: request.id, value: "accepted" })
                }
                type="button"
              >
                Annahme vorbereiten
              </button>
              <button
                className="secondary-button"
                disabled={pending}
                onClick={() =>
                  setDecision({ id: request.id, value: "declined" })
                }
                type="button"
              >
                Ablehnung vorbereiten
              </button>
            </div>
          )}
        </article>
      ))}
      {notice && (
        <p className="ticket-workbench__notice" role="status">
          {notice}
        </p>
      )}
    </section>
  );
}

export function TicketWorkbench({
  tenantId,
  currentUserId: _currentUserId,
  ticket,
  isRequester,
  hasAgentAccess,
  canAssign,
  canUpdate,
  canUseInternalNotes: _canUseInternalNotes,
  people,
  categories,
  priorities,
  onApplyMacro,
  onPrefillAssignee,
}: TicketWorkbenchProps) {
  const [slaExpectation, setSlaExpectation] = useState<SlaExpectation | null>(
    null,
  );
  const updateSla = useCallback((expectation: SlaExpectation | null) => {
    setSlaExpectation(expectation);
  }, []);
  const availablePeople = useMemo(
    () => people.filter((person) => isUuid(person.id)),
    [people],
  );

  return (
    <section className="ticket-workbench" aria-label="Ticketwerkbank">
      <TicketContextHeader expectation={slaExpectation} ticket={ticket} />
      <div className="ticket-workbench__grid">
        <div className="ticket-workbench__main">
          {hasAgentAccess && (
            <MacroPanel
              categories={categories}
              onApplyMacro={onApplyMacro}
              priorities={priorities}
              tenantId={tenantId}
              ticket={ticket}
            />
          )}
          {hasAgentAccess && (
            <AssigneePanel
              canAssign={canAssign}
              onPrefillAssignee={onPrefillAssignee}
              people={availablePeople}
              tenantId={tenantId}
              ticketId={ticket.id}
            />
          )}
          {hasAgentAccess && (
            <KnowledgeDraftButton
              canUpdate={canUpdate}
              tenantId={tenantId}
              ticket={ticket}
            />
          )}
          <RequesterPortal
            enabled={isRequester}
            onSla={updateSla}
            tenantId={tenantId}
            ticket={ticket}
          />
          <ReopenRequests
            enabled={hasAgentAccess && canUpdate}
            tenantId={tenantId}
            ticketId={ticket.id}
          />
        </div>
        <ContextPanel
          enabled={hasAgentAccess}
          onSla={updateSla}
          tenantId={tenantId}
          ticketId={ticket.id}
        />
      </div>
    </section>
  );
}
