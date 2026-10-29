import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  DoorOpen,
  Mail,
  Plus,
  RefreshCw,
  UsersRound,
  Wrench,
} from "lucide-react";
import {
  swissEventSpaceOccurrences,
  swissWallTimeToInstant,
  swissWallValue,
} from "./lib/event-space-time";
import { functionErrorMessage } from "./lib/function-error";
import { supabase } from "./lib/supabase";

const EQUIPMENT = [
  ["ict_material", "ICT Material"],
  ["internet_access", "Zugang Internet"],
  ["sobe_network_access", "Zugang SOBE Netzwerk"],
  ["projector", "Beamer"],
  ["connections", "Anschlüsse"],
  ["display", "Bildschirm"],
  ["audio", "Audio"],
  ["videocall", "Videocall"],
  ["microphones", "Mikrofone"],
  ["screen", "Leinwand"],
  ["reception_laptop", "Empfangslaptop"],
] as const;

type EquipmentKey = (typeof EQUIPMENT)[number][0];
type RequestStatus =
  "planned" | "in_preparation" | "ready" | "conducted" | "completed";
type TaskStatus = "open" | "in_progress" | "completed";
type View = "calendar" | "list";
type Recurrence = "none" | "weekly" | "monthly";
type IntakeSource = "manual" | "email_ticket";

type Room = {
  id: string;
  name: string;
  kind: string;
  location: string | null;
  capacity: number | null;
};
type Person = { id: string; displayName: string };
type Task = { id: string; title: string; status: TaskStatus };
type RoomRequest = {
  id: string;
  spaceId: string;
  title: string;
  organizer: string | null;
  remarks: string | null;
  expectedParticipants: number | null;
  startsAt: string;
  endsAt: string;
  responsibleName: string | null;
  intakeSource: IntakeSource;
  status: RequestStatus;
  recurrence: Recurrence;
  seriesId: string | null;
  seriesIndex: number;
  conflictsAcknowledged: boolean;
  equipment: EquipmentKey[];
  tasks: Task[];
};
type ClarificationCase = {
  id: string;
  title: string;
  organizer: string | null;
  remarks: string | null;
  assignedAgent: Person | null;
  sourceOrderNumber: string | null;
  requestedSpaceText: string | null;
  requestedStartsAt: string | null;
  requestedEndsAt: string | null;
  requestedEquipment: string[];
  reasons: string[];
};
type EmailIntakeRecovery = {
  ticketId: string;
  state: "pending" | "failed" | "retrying";
  retryCount: number;
  canRetry: boolean;
};
type ConflictSummary = {
  hasConflicts: boolean;
  roomConflictCount: number;
  equipmentConflictCount: number;
};
type ConflictPreview = {
  conflicts: ConflictSummary;
  conflictSnapshot: string;
};
type Workspace = {
  rooms: Room[];
  people: Person[];
  agents: Person[];
  permissions: { canRequest: boolean; canManage: boolean };
  pagination: { hasMore: boolean; nextOffset: number | null };
  clarifications: ClarificationCase[];
  emailIntakes: EmailIntakeRecovery[];
  requests: RoomRequest[];
};
type RequestDraft = {
  spaceId: string;
  title: string;
  organizer: string;
  expectedParticipants: string;
  responsibleUserId: string;
  startsAt: string;
  endsAt: string;
  recurrence: Recurrence;
  occurrences: string;
  equipment: EquipmentKey[];
};

const statusLabels: Record<RequestStatus, string> = {
  planned: "Geplant",
  in_preparation: "In Vorbereitung",
  ready: "Bereit",
  conducted: "Durchgeführt",
  completed: "Abgeschlossen",
};
const taskStatusLabels: Record<TaskStatus, string> = {
  open: "Offen",
  in_progress: "In Arbeit",
  completed: "Erledigt",
};
const clarificationReasonLabels: Record<string, string> = {
  ambiguous_local_time: "Beginnzeit wegen Sommerzeit klären",
  duplicate_field: "Doppelte Angaben prüfen",
  equipment_invalid: "Technikangaben prüfen",
  equipment_conflict: "Techniküberschneidung prüfen",
  invalid_date: "Anlassdatum prüfen",
  invalid_description: "Angaben prüfen",
  invalid_https_url: "Link zum Auftrag prüfen",
  invalid_start_time: "Beginnzeit prüfen",
  invalid_yes_no: "Ja/Nein-Angaben prüfen",
  missing_required_field: "Fehlende Angaben ergänzen",
  missing_start_time: "Beginnzeit ergänzen",
  nonexistent_local_time: "Beginnzeit wegen Sommerzeit klären",
  room_conflict: "Raumüberschneidung prüfen",
  room_not_matched: "Raum zuordnen",
  room_unavailable: "Raum ist nicht verfügbar",
  start_time_invalid: "Beginnzeit ergänzen",
  task_template_unavailable: "Aufgabenvorlage prüfen",
  unknown_field: "Angaben prüfen",
};
const emailIntakeStateLabels: Record<EmailIntakeRecovery["state"], string> = {
  pending: "Ausstehend",
  failed: "Fehlgeschlagen",
  retrying: "Wird verarbeitet",
};
const equipmentLabels = new Map(EQUIPMENT);

function defaultDraft(): RequestDraft {
  const nextSwissDay = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const date = swissWallValue(nextSwissDay).slice(0, 10);
  return {
    spaceId: "",
    title: "",
    organizer: "",
    expectedParticipants: "",
    responsibleUserId: "",
    startsAt: `${date}T08:00`,
    endsAt: `${date}T09:00`,
    recurrence: "none",
    occurrences: "1",
    equipment: [],
  };
}

function dateLabel(value: string): string {
  return new Intl.DateTimeFormat("de-CH", {
    timeZone: "Europe/Zurich",
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  }).format(new Date(value));
}

function timeLabel(value: string): string {
  return new Intl.DateTimeFormat("de-CH", {
    timeZone: "Europe/Zurich",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function fullDateTimeLabel(value: string): string {
  return new Intl.DateTimeFormat("de-CH", {
    timeZone: "Europe/Zurich",
    weekday: "long",
    day: "2-digit",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function startOfDay(value: Date): Date {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function dayKey(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return swissWallValue(date).slice(0, 10);
}

function taskProgress(tasks: readonly Task[]) {
  const total = tasks.length;
  const completed = tasks.filter((task) => task.status === "completed").length;
  return { total, completed };
}

function requestOccurrences(draft: RequestDraft) {
  const count = Number(draft.occurrences);
  return swissEventSpaceOccurrences({
    startsAt: draft.startsAt,
    endsAt: draft.endsAt,
    recurrence: draft.recurrence,
    count,
  });
}

function parseWorkspace(value: unknown): Workspace | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  if (
    !Array.isArray(data.rooms) ||
    !Array.isArray(data.people) ||
    !Array.isArray(data.agents) ||
    !Array.isArray(data.clarifications) ||
    !Array.isArray(data.emailIntakes) ||
    !Array.isArray(data.requests) ||
    !data.pagination ||
    typeof data.pagination !== "object"
  )
    return null;
  const permissions = data.permissions;
  if (!permissions || typeof permissions !== "object") return null;
  const permissionData = permissions as Record<string, unknown>;
  if (
    typeof permissionData.canRequest !== "boolean" ||
    typeof permissionData.canManage !== "boolean"
  )
    return null;
  const pagination = data.pagination as Record<string, unknown>;
  if (
    typeof pagination.hasMore !== "boolean" ||
    (pagination.nextOffset !== null &&
      (!Number.isInteger(pagination.nextOffset) ||
        typeof pagination.nextOffset !== "number" ||
        pagination.nextOffset < 0))
  ) {
    return null;
  }
  return data as unknown as Workspace;
}

function parseConflictSummary(value: unknown): ConflictSummary | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  return typeof data.hasConflicts === "boolean" &&
    typeof data.roomConflictCount === "number" &&
    typeof data.equipmentConflictCount === "number"
    ? (data as ConflictSummary)
    : null;
}

function parseConflictPreview(value: unknown): ConflictPreview | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  const conflicts = parseConflictSummary(data.conflicts);
  return conflicts &&
    typeof data.conflictSnapshot === "string" &&
    /^[a-f0-9]{64}\.[a-f0-9]{64}$/.test(data.conflictSnapshot)
    ? { conflicts, conflictSnapshot: data.conflictSnapshot }
    : null;
}

function nextTaskStatus(status: TaskStatus): TaskStatus {
  if (status === "open") return "in_progress";
  if (status === "in_progress") return "completed";
  return "open";
}

export function EventSpaces({
  focusRequestId,
  onAttentionChanged,
  tenantId,
}: {
  focusRequestId?: string | undefined;
  onAttentionChanged: () => void;
  tenantId: string;
}) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [notice, setNotice] = useState("");
  const [view, setView] = useState<View>("calendar");
  const [calendarStart, setCalendarStart] = useState(() =>
    startOfDay(new Date()),
  );
  const [editor, setEditor] = useState<"request" | "room" | null>(null);
  const [requestDraft, setRequestDraft] = useState<RequestDraft>(() =>
    defaultDraft(),
  );
  const [roomDraft, setRoomDraft] = useState({
    name: "",
    kind: "meeting_room",
    location: "",
    capacity: "",
  });
  const [pendingConflicts, setPendingConflicts] =
    useState<ConflictPreview | null>(null);
  const [pending, setPending] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [expandedRequestId, setExpandedRequestId] = useState<string | null>(
    null,
  );
  const [clarificationDrafts, setClarificationDrafts] = useState<
    Record<
      string,
      {
        responsibleUserId: string;
        spaceId: string;
        startsAt: string;
      }
    >
  >({});

  const loadWorkspace = async (
    offset: number,
    append: boolean,
    preserveNotice = false,
  ) => {
    if (!supabase) return;
    if (append) setLoadingMore(true);
    else setLoading(true);
    if (!preserveNotice) setErrorMessage("");
    try {
      const { data, error } = await supabase.functions.invoke("event-spaces", {
        body: { type: "listWorkspace", tenantId, offset },
      });
      if (error) throw error;
      const parsed = parseWorkspace(
        data && typeof data === "object"
          ? (data as { data?: unknown }).data
          : null,
      );
      if (!parsed) throw new Error("invalid_event_space_workspace");
      setWorkspace((current) => {
        if (!append || !current) return parsed;
        const requests = new Map(
          [...current.requests, ...parsed.requests].map((request) => [
            request.id,
            request,
          ]),
        );
        return {
          ...parsed,
          requests: [...requests.values()].sort(
            (first, second) =>
              new Date(first.startsAt).valueOf() -
              new Date(second.startsAt).valueOf(),
          ),
        };
      });
    } catch (error) {
      setErrorMessage(
        await functionErrorMessage(
          error,
          "Die Veranstaltungsräume konnten nicht geladen werden. Bitte versuchen Sie es erneut.",
        ),
      );
    } finally {
      if (append) setLoadingMore(false);
      else setLoading(false);
    }
  };

  const refresh = async (preserveNotice = false) =>
    loadWorkspace(0, false, preserveNotice);

  useEffect(() => {
    void refresh();
    // tenantId is the complete, server-scoped workspace identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  useEffect(() => {
    if (!focusRequestId || !workspace) return;
    if (!workspace.requests.some((request) => request.id === focusRequestId)) {
      if (workspace.pagination.nextOffset !== null && !loadingMore) {
        void loadWorkspace(workspace.pagination.nextOffset, true, true);
      }
      return;
    }
    setView("list");
    setExpandedRequestId(focusRequestId);
    const frame = window.requestAnimationFrame(() => {
      document
        .getElementById(`event-space-request-${focusRequestId}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusRequestId, loadingMore, workspace]);

  useEffect(() => {
    const cases = workspace?.clarifications ?? [];
    if (!cases.length) return;
    setClarificationDrafts((current) => {
      let changed = false;
      const next = { ...current };
      for (const item of cases) {
        const existing = next[item.id];
        if (existing) {
          if (!existing.responsibleUserId && item.assignedAgent?.id) {
            next[item.id] = {
              ...existing,
              responsibleUserId: item.assignedAgent.id,
            };
            changed = true;
          }
          continue;
        }
        next[item.id] = {
          responsibleUserId: item.assignedAgent?.id ?? "",
          spaceId: "",
          startsAt: item.requestedStartsAt
            ? swissWallValue(new Date(item.requestedStartsAt))
            : "",
        };
        changed = true;
      }
      return changed ? next : current;
    });
  }, [workspace?.clarifications]);

  const roomsById = useMemo(
    () => new Map((workspace?.rooms ?? []).map((room) => [room.id, room])),
    [workspace?.rooms],
  );
  const visibleDays = useMemo(
    () =>
      Array.from({ length: 7 }, (_, index) => {
        const day = new Date(calendarStart);
        day.setDate(day.getDate() + index);
        return day;
      }),
    [calendarStart],
  );
  const requestsByDay = useMemo(() => {
    const map = new Map<string, RoomRequest[]>();
    for (const request of workspace?.requests ?? []) {
      const key = dayKey(request.startsAt);
      const current = map.get(key) ?? [];
      current.push(request);
      map.set(key, current);
    }
    return map;
  }, [workspace?.requests]);
  const metrics = useMemo(() => {
    const requests = workspace?.requests ?? [];
    return {
      upcoming: requests.filter(
        (request) =>
          new Date(request.endsAt) >= new Date() &&
          request.status !== "completed",
      ).length,
      preparation: requests.filter(
        (request) => request.status === "in_preparation",
      ).length,
      ready: requests.filter((request) => request.status === "ready").length,
    };
  }, [workspace?.requests]);

  const updateDraft = <Key extends keyof RequestDraft>(
    key: Key,
    value: RequestDraft[Key],
  ) => {
    setRequestDraft((current) => ({ ...current, [key]: value }));
    setPendingConflicts(null);
  };

  const requestPayload = () => {
    const occurrences = requestOccurrences(requestDraft);
    const expectedParticipants = requestDraft.expectedParticipants.trim()
      ? Number(requestDraft.expectedParticipants)
      : null;
    if (
      !occurrences ||
      !requestDraft.spaceId ||
      !requestDraft.title.trim() ||
      !requestDraft.responsibleUserId ||
      (expectedParticipants !== null &&
        (!Number.isInteger(expectedParticipants) ||
          expectedParticipants < 0 ||
          expectedParticipants > 10000))
    ) {
      return null;
    }
    return {
      tenantId,
      spaceId: requestDraft.spaceId,
      title: requestDraft.title,
      organizer: requestDraft.organizer.trim() || null,
      expectedParticipants,
      responsibleUserId: requestDraft.responsibleUserId,
      equipmentKeys: requestDraft.equipment,
      recurrence: requestDraft.recurrence,
      occurrences,
    };
  };

  async function previewRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    const payload = requestPayload();
    if (!payload) {
      setErrorMessage(
        "Bitte füllen Sie Raum, Anlass, Zeitraum und die Wiederholung vollständig aus.",
      );
      return;
    }
    setPending(true);
    setErrorMessage("");
    setNotice("");
    try {
      const { data, error } = await supabase.functions.invoke("event-spaces", {
        body: { type: "previewConflicts", ...payload },
      });
      if (error) throw error;
      const preview = parseConflictPreview(
        data && typeof data === "object"
          ? (data as { data?: unknown }).data
          : null,
      );
      if (!preview) throw new Error("invalid_event_space_conflicts");
      if (preview.conflicts.hasConflicts) {
        setPendingConflicts(preview);
        return;
      }
      await createRequest(payload, false, null);
    } catch (error) {
      setErrorMessage(
        await functionErrorMessage(
          error,
          "Die Raumplanung konnte nicht geprüft werden. Bitte versuchen Sie es erneut.",
        ),
      );
    } finally {
      setPending(false);
    }
  }

  async function createRequest(
    payload: NonNullable<ReturnType<typeof requestPayload>>,
    confirmConflicts: boolean,
    conflictSnapshot: string | null,
  ) {
    if (!supabase) return;
    setPending(true);
    setErrorMessage("");
    try {
      const { data, error } = await supabase.functions.invoke("event-spaces", {
        body: {
          type: "createRequest",
          confirmConflicts,
          conflictSnapshot,
          ...payload,
        },
      });
      if (error) throw error;
      const createdCount =
        data && typeof data === "object"
          ? (data as { data?: { createdCount?: unknown } }).data?.createdCount
          : null;
      setNotice(
        typeof createdCount === "number" && createdCount > 1
          ? `${createdCount} Raumaufträge wurden geplant.`
          : "Der Raumauftrag wurde geplant.",
      );
      setRequestDraft(defaultDraft());
      setPendingConflicts(null);
      setEditor(null);
      await refresh(true);
      onAttentionChanged();
    } catch (error) {
      setPendingConflicts(null);
      setErrorMessage(
        await functionErrorMessage(
          error,
          "Der Raumauftrag konnte nicht gespeichert werden. Bitte prüfen Sie die Angaben und versuchen Sie es erneut.",
        ),
      );
    } finally {
      setPending(false);
    }
  }

  async function createRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    const capacity = roomDraft.capacity.trim()
      ? Number(roomDraft.capacity)
      : null;
    if (
      !roomDraft.name.trim() ||
      (capacity !== null &&
        (!Number.isInteger(capacity) || capacity < 1 || capacity > 10000))
    ) {
      setErrorMessage(
        "Bitte geben Sie einen Raumnamen und gegebenenfalls eine gültige Kapazität ein.",
      );
      return;
    }
    setPending(true);
    setErrorMessage("");
    try {
      const { error } = await supabase.functions.invoke("event-spaces", {
        body: {
          type: "createSpace",
          tenantId,
          name: roomDraft.name,
          kind: roomDraft.kind,
          location: roomDraft.location.trim() || null,
          capacity,
        },
      });
      if (error) throw error;
      setNotice("Der Veranstaltungsraum wurde angelegt.");
      setRoomDraft({
        name: "",
        kind: "meeting_room",
        location: "",
        capacity: "",
      });
      setEditor("request");
      await refresh(true);
    } catch (error) {
      setErrorMessage(
        await functionErrorMessage(
          error,
          "Der Raum konnte nicht angelegt werden. Bitte versuchen Sie es erneut.",
        ),
      );
    } finally {
      setPending(false);
    }
  }

  async function changeRequestStatus(requestId: string, status: RequestStatus) {
    if (!supabase) return;
    setPending(true);
    setErrorMessage("");
    try {
      const { error } = await supabase.functions.invoke("event-spaces", {
        body: { type: "updateRequestStatus", tenantId, requestId, status },
      });
      if (error) throw error;
      setNotice("Der Raumauftragsstatus wurde aktualisiert.");
      await refresh(true);
      onAttentionChanged();
    } catch (error) {
      setErrorMessage(
        await functionErrorMessage(
          error,
          "Der Status konnte nicht aktualisiert werden. Bitte versuchen Sie es erneut.",
        ),
      );
    } finally {
      setPending(false);
    }
  }

  async function assignResponsible(
    requestId: string,
    responsibleUserId: string,
  ) {
    if (!supabase || !responsibleUserId) return;
    setPending(true);
    setErrorMessage("");
    try {
      const { error } = await supabase.functions.invoke("event-spaces", {
        body: {
          type: "assignResponsible",
          tenantId,
          requestId,
          responsibleUserId,
        },
      });
      if (error) throw error;
      setNotice("Die verantwortliche Person wurde zugewiesen.");
      await refresh(true);
      onAttentionChanged();
    } catch (error) {
      setErrorMessage(
        await functionErrorMessage(
          error,
          "Die verantwortliche Person konnte nicht zugewiesen werden. Bitte versuchen Sie es erneut.",
        ),
      );
    } finally {
      setPending(false);
    }
  }

  async function assignEmailAgent(
    requestId: string,
    responsibleUserId: string,
  ) {
    if (!supabase) return;
    if (!responsibleUserId) {
      setErrorMessage("Bitte wählen Sie eine Agent:in aus.");
      return;
    }
    setPending(true);
    setErrorMessage("");
    setNotice("");
    try {
      const { error } = await supabase.functions.invoke("event-spaces", {
        body: {
          type: "assignAgent",
          tenantId,
          requestId,
          responsibleUserId,
        },
      });
      if (error) throw error;
      setNotice("Die Agent:in wurde der E-Mail-Anfrage zugewiesen.");
      await refresh(true);
      onAttentionChanged();
    } catch (error) {
      setErrorMessage(
        await functionErrorMessage(
          error,
          "Die Agent:in konnte nicht zugewiesen werden. Bitte versuchen Sie es erneut.",
        ),
      );
    } finally {
      setPending(false);
    }
  }

  function updateClarificationDraft(
    requestId: string,
    key: "responsibleUserId" | "spaceId" | "startsAt",
    value: string,
  ) {
    setClarificationDrafts((current) => ({
      ...current,
      [requestId]: {
        responsibleUserId: current[requestId]?.responsibleUserId ?? "",
        spaceId: current[requestId]?.spaceId ?? "",
        startsAt: current[requestId]?.startsAt ?? "",
        [key]: value,
      },
    }));
  }

  async function resolveClarification(item: ClarificationCase) {
    if (!supabase) return;
    const requestId = item.id;
    const draft = clarificationDrafts[requestId];
    const start = swissWallTimeToInstant(
      draft?.startsAt ??
        (item.requestedStartsAt
          ? swissWallValue(new Date(item.requestedStartsAt))
          : ""),
    );
    if (!draft?.spaceId || !draft.responsibleUserId || !start) {
      setErrorMessage(
        "Bitte geben Sie einen gültigen Schweizer Beginn sowie Raum und Agent:in an.",
      );
      return;
    }
    setPending(true);
    setErrorMessage("");
    try {
      const { error } = await supabase.functions.invoke("event-spaces", {
        body: {
          type: "resolveEmailIntake",
          tenantId,
          requestId,
          spaceId: draft.spaceId,
          responsibleUserId: draft.responsibleUserId,
          startsAt: start.toISOString(),
          endsAt: new Date(start.getTime() + 30 * 60 * 1_000).toISOString(),
        },
      });
      if (error) throw error;
      setNotice("Der E-Mail-Auftrag wurde konfliktfrei geplant.");
      setClarificationDrafts((current) => {
        const next = { ...current };
        delete next[requestId];
        return next;
      });
      await refresh(true);
      onAttentionChanged();
    } catch (error) {
      setErrorMessage(
        await functionErrorMessage(
          error,
          "Der Klärungsfall konnte nicht geplant werden. Bitte prüfen Sie Raum, Zeit und Technik.",
        ),
      );
    } finally {
      setPending(false);
    }
  }

  async function retryEmailTicketIntake(ticketId: string) {
    if (!supabase) return;
    setPending(true);
    setErrorMessage("");
    setNotice("");
    try {
      const { data, error } = await supabase.functions.invoke("event-spaces", {
        body: { type: "retryEmailTicketIntake", tenantId, ticketId },
      });
      if (error) throw error;
      const state =
        data && typeof data === "object"
          ? (data as { data?: { state?: unknown } }).data?.state
          : null;
      if (state === "processed") {
        setNotice("Der ausgewählte E-Mail-Import wurde einmalig wiederholt.");
      } else if (state === "failed") {
        setErrorMessage(
          "Der ausgewählte E-Mail-Import konnte nicht abgeschlossen werden. Der Ticketversand bleibt unverändert.",
        );
      } else {
        setNotice("Der E-Mail-Import ist nicht mehr erneut verfügbar.");
      }
      await refresh(true);
      onAttentionChanged();
    } catch (error) {
      setErrorMessage(
        await functionErrorMessage(
          error,
          "Der E-Mail-Import konnte nicht wiederholt werden. Der Ticketversand bleibt unverändert.",
        ),
      );
    } finally {
      setPending(false);
    }
  }

  async function changeTaskStatus(task: Task) {
    if (!supabase) return;
    setPending(true);
    setErrorMessage("");
    try {
      const { error } = await supabase.functions.invoke("event-spaces", {
        body: {
          type: "updateTaskStatus",
          tenantId,
          taskId: task.id,
          status: nextTaskStatus(task.status),
        },
      });
      if (error) throw error;
      await refresh(true);
    } catch (error) {
      setErrorMessage(
        await functionErrorMessage(
          error,
          "Die Aufgabe konnte nicht aktualisiert werden. Bitte versuchen Sie es erneut.",
        ),
      );
    } finally {
      setPending(false);
    }
  }

  if (loading && !workspace) {
    return (
      <section className="event-spaces panel" aria-busy="true">
        <p className="empty-state">Veranstaltungsräume werden geladen …</p>
      </section>
    );
  }

  const canRequest = workspace?.permissions.canRequest ?? false;
  const canManage = workspace?.permissions.canManage ?? false;
  const clarifications = workspace?.clarifications ?? [];
  const emailIntakes = workspace?.emailIntakes ?? [];
  const requests = workspace?.requests ?? [];

  return (
    <section className="event-spaces" aria-labelledby="event-spaces-heading">
      <header className="event-spaces__hero panel">
        <div>
          <p className="eyebrow">Planung statt Ticket</p>
          <h2 id="event-spaces-heading">Veranstaltungsräume</h2>
          <p>
            Planen Sie technische Einrichtungen für Aula und Sitzungszimmer. Ein
            Ticket entsteht nur bei einem tatsächlichen Problem.
          </p>
        </div>
        <div className="event-spaces__hero-actions">
          <button
            className="secondary-button"
            disabled={loading}
            onClick={() => void refresh()}
            type="button"
          >
            <RefreshCw aria-hidden="true" size={16} /> Aktualisieren
          </button>
          {canRequest ? (
            <button
              className="primary-button"
              onClick={() => {
                setEditor("request");
                setPendingConflicts(null);
              }}
              type="button"
            >
              <Plus aria-hidden="true" size={17} /> Raumauftrag erfassen
            </button>
          ) : null}
        </div>
      </header>

      <div className="event-spaces__metrics" aria-label="Planungsübersicht">
        <article>
          <CalendarDays aria-hidden="true" size={18} />
          <span>Bevorstehend</span>
          <strong>{metrics.upcoming}</strong>
        </article>
        <article>
          <Wrench aria-hidden="true" size={18} />
          <span>In Vorbereitung</span>
          <strong>{metrics.preparation}</strong>
        </article>
        <article>
          <Check aria-hidden="true" size={18} />
          <span>Bereit</span>
          <strong>{metrics.ready}</strong>
        </article>
      </div>

      {canManage && emailIntakes.length ? (
        <section className="event-spaces__email-recovery panel">
          <div className="event-spaces__email-recovery-heading">
            <div>
              <p className="eyebrow">Manuelle Wiederherstellung</p>
              <h3>E-Mail-Import erneut ausführen</h3>
              <p>
                Hier werden nur der Importzustand und die Anzahl bewusster
                Wiederholungen angezeigt. Ticket- und E-Mail-Inhalte bleiben
                ausgeblendet.
              </p>
            </div>
            <strong>{emailIntakes.length}</strong>
          </div>
          <ul>
            {emailIntakes.map((item) => (
              <li key={item.ticketId}>
                <span>
                  <strong>{emailIntakeStateLabels[item.state]}</strong>
                  <small>
                    Manuelle Wiederholungen: {item.retryCount} von 3
                  </small>
                </span>
                <button
                  className="secondary-button"
                  disabled={pending || !item.canRetry}
                  onClick={() => void retryEmailTicketIntake(item.ticketId)}
                  type="button"
                >
                  Einzelnen Import wiederholen
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {canManage && clarifications.length ? (
        <section className="event-spaces__clarifications panel">
          <div className="event-spaces__clarifications-heading">
            <div>
              <p className="eyebrow">Neue E-Mail-Anfragen</p>
              <h3>Klärung und Übernahme erforderlich</h3>
              <p>
                Neue Anfragen reservieren weder Raum noch Technik. Weisen Sie
                zuerst eine Agent:in zu und ergänzen Sie danach Raum und Zeit.
              </p>
            </div>
            <strong>{clarifications.length}</strong>
          </div>
          <ul>
            {clarifications.map((item) => (
              <li key={item.id}>
                <article>
                  <div className="event-spaces__clarification-summary">
                    <span className="event-spaces__email-intake-label">
                      <Mail aria-hidden="true" size={14} /> Neue E-Mail-Anfrage
                    </span>
                    <small>
                      {item.sourceOrderNumber
                        ? `Antrag ${item.sourceOrderNumber}`
                        : "E-Mail-Auftrag"}
                    </small>
                    <h4>{item.title}</h4>
                    <p>
                      {item.requestedSpaceText
                        ? `Gewünschter Raum: ${item.requestedSpaceText}`
                        : "Raum noch nicht eindeutig angegeben"}
                      {item.requestedStartsAt
                        ? ` · ${fullDateTimeLabel(item.requestedStartsAt)}`
                        : ""}
                    </p>
                  </div>
                  <dl className="event-spaces__clarification-meta">
                    <div>
                      <dt>Auftrag ausgelöst von</dt>
                      <dd>
                        {item.organizer ??
                          "Bei diesem bestehenden Auftrag nicht gespeichert"}
                      </dd>
                    </div>
                    <div>
                      <dt>Interne Agent:in</dt>
                      <dd>
                        {item.assignedAgent?.displayName ??
                          "Noch nicht zugewiesen"}
                      </dd>
                    </div>
                    {item.remarks ? (
                      <div>
                        <dt>Bemerkungen</dt>
                        <dd>{item.remarks}</dd>
                      </div>
                    ) : null}
                  </dl>
                  <p className="event-spaces__clarification-reasons">
                    {item.reasons.length
                      ? item.reasons
                          .map(
                            (reason) =>
                              clarificationReasonLabels[reason] ??
                              "Angaben prüfen",
                          )
                          .join(" · ")
                      : "Angaben prüfen"}
                  </p>
                  <div className="event-spaces__clarification-actions">
                    <label>
                      Agent:in
                      <select
                        value={
                          clarificationDrafts[item.id]?.responsibleUserId ?? ""
                        }
                        onChange={(event) =>
                          updateClarificationDraft(
                            item.id,
                            "responsibleUserId",
                            event.target.value,
                          )
                        }
                      >
                        <option value="">Agent:in auswählen …</option>
                        {workspace?.agents.map((agent) => (
                          <option key={agent.id} value={agent.id}>
                            {agent.displayName}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      className="secondary-button"
                      disabled={
                        pending ||
                        !clarificationDrafts[item.id]?.responsibleUserId ||
                        item.assignedAgent?.id ===
                          clarificationDrafts[item.id]?.responsibleUserId
                      }
                      onClick={() =>
                        void assignEmailAgent(
                          item.id,
                          clarificationDrafts[item.id]?.responsibleUserId ?? "",
                        )
                      }
                      type="button"
                    >
                      {item.assignedAgent
                        ? "Agent:in ändern"
                        : "Agent:in zuweisen"}
                    </button>
                    <label>
                      Beginn (Europe/Zurich)
                      <input
                        type="datetime-local"
                        value={
                          clarificationDrafts[item.id]?.startsAt ??
                          (item.requestedStartsAt
                            ? swissWallValue(new Date(item.requestedStartsAt))
                            : "")
                        }
                        onChange={(event) =>
                          updateClarificationDraft(
                            item.id,
                            "startsAt",
                            event.target.value,
                          )
                        }
                      />
                    </label>
                    <label>
                      Raum
                      <select
                        value={clarificationDrafts[item.id]?.spaceId ?? ""}
                        onChange={(event) =>
                          updateClarificationDraft(
                            item.id,
                            "spaceId",
                            event.target.value,
                          )
                        }
                      >
                        <option value="">Raum auswählen …</option>
                        {workspace?.rooms.map((room) => (
                          <option key={room.id} value={room.id}>
                            {room.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      className="primary-button"
                      disabled={
                        pending ||
                        !clarificationDrafts[item.id]?.spaceId ||
                        !clarificationDrafts[item.id]?.responsibleUserId
                      }
                      onClick={() => void resolveClarification(item)}
                      type="button"
                    >
                      Konfliktfrei planen (30 Min.)
                    </button>
                  </div>
                </article>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {errorMessage ? (
        <p
          className="event-spaces__message event-spaces__message--error"
          role="alert"
        >
          {errorMessage}
        </p>
      ) : null}
      {notice ? (
        <p
          className="event-spaces__message event-spaces__message--success"
          role="status"
        >
          {notice}
        </p>
      ) : null}

      {editor === "request" ? (
        <section
          className="event-spaces__editor panel"
          aria-labelledby="event-space-request-heading"
        >
          <div className="event-spaces__editor-heading">
            <div>
              <p className="eyebrow">Neuer Auftrag</p>
              <h3 id="event-space-request-heading">
                Technische Einrichtung planen
              </h3>
            </div>
            {canManage ? (
              <button
                className="text-button"
                onClick={() => setEditor("room")}
                type="button"
              >
                <DoorOpen aria-hidden="true" size={16} /> Raum anlegen
              </button>
            ) : null}
          </div>
          {workspace?.rooms.length ? (
            <form onSubmit={previewRequest}>
              <div className="event-spaces__form-grid">
                <label>
                  Raum
                  <select
                    required
                    value={requestDraft.spaceId}
                    onChange={(event) =>
                      updateDraft("spaceId", event.target.value)
                    }
                  >
                    <option value="">Raum auswählen …</option>
                    {workspace.rooms.map((room) => (
                      <option key={room.id} value={room.id}>
                        {room.name}
                        {room.location ? ` · ${room.location}` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Anlass
                  <input
                    maxLength={240}
                    minLength={3}
                    required
                    value={requestDraft.title}
                    onChange={(event) =>
                      updateDraft("title", event.target.value)
                    }
                    placeholder="z. B. Mitarbeitendenanlass"
                  />
                </label>
                <label>
                  Start
                  <input
                    required
                    type="datetime-local"
                    value={requestDraft.startsAt}
                    onChange={(event) =>
                      updateDraft("startsAt", event.target.value)
                    }
                  />
                </label>
                <label>
                  Ende
                  <input
                    required
                    type="datetime-local"
                    value={requestDraft.endsAt}
                    onChange={(event) =>
                      updateDraft("endsAt", event.target.value)
                    }
                  />
                </label>
                <label>
                  Verantwortliche Person
                  <select
                    required
                    value={requestDraft.responsibleUserId}
                    onChange={(event) =>
                      updateDraft("responsibleUserId", event.target.value)
                    }
                  >
                    <option value="">Person auswählen …</option>
                    {workspace.people.map((person) => (
                      <option key={person.id} value={person.id}>
                        {person.displayName}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Teilnehmende
                  <input
                    inputMode="numeric"
                    max="10000"
                    min="0"
                    type="number"
                    value={requestDraft.expectedParticipants}
                    onChange={(event) =>
                      updateDraft("expectedParticipants", event.target.value)
                    }
                    placeholder="Optional"
                  />
                </label>
                <label>
                  Kontakt / Organisation
                  <input
                    maxLength={160}
                    value={requestDraft.organizer}
                    onChange={(event) =>
                      updateDraft("organizer", event.target.value)
                    }
                    placeholder="Optional"
                  />
                </label>
                <label>
                  Wiederholung
                  <select
                    value={requestDraft.recurrence}
                    onChange={(event) => {
                      const recurrence = event.target.value as Recurrence;
                      updateDraft("recurrence", recurrence);
                      if (recurrence === "none")
                        updateDraft("occurrences", "1");
                      else if (requestDraft.occurrences === "1")
                        updateDraft("occurrences", "2");
                      else if (
                        recurrence === "monthly" &&
                        Number(requestDraft.occurrences) > 12
                      )
                        updateDraft("occurrences", "12");
                    }}
                  >
                    <option value="none">Einmalig</option>
                    <option value="weekly">Wöchentlich</option>
                    <option value="monthly">Monatlich</option>
                  </select>
                </label>
                {requestDraft.recurrence !== "none" ? (
                  <label>
                    Anzahl Termine
                    <input
                      max={requestDraft.recurrence === "monthly" ? "12" : "52"}
                      min="2"
                      required
                      type="number"
                      value={requestDraft.occurrences}
                      onChange={(event) =>
                        updateDraft("occurrences", event.target.value)
                      }
                    />
                  </label>
                ) : null}
              </div>
              <fieldset className="event-spaces__equipment">
                <legend>Benötigte Technik</legend>
                <p>
                  Diese Auswahl löst die standardisierten ICT-Aufgaben aus und
                  wird auf zeitgleiche Überschneidungen geprüft.
                </p>
                <div>
                  {EQUIPMENT.map(([key, label]) => (
                    <label key={key}>
                      <input
                        checked={requestDraft.equipment.includes(key)}
                        onChange={(event) =>
                          updateDraft(
                            "equipment",
                            event.target.checked
                              ? [...requestDraft.equipment, key]
                              : requestDraft.equipment.filter(
                                  (item) => item !== key,
                                ),
                          )
                        }
                        type="checkbox"
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="event-spaces__form-actions">
                <button
                  className="secondary-button"
                  onClick={() => {
                    setEditor(null);
                    setPendingConflicts(null);
                  }}
                  type="button"
                >
                  Abbrechen
                </button>
                <button
                  className="primary-button"
                  disabled={pending}
                  type="submit"
                >
                  {pending ? "Wird geprüft …" : "Auftrag prüfen"}
                </button>
              </div>
            </form>
          ) : (
            <div className="event-spaces__empty-room">
              <DoorOpen aria-hidden="true" size={26} />
              <div>
                <strong>Noch kein Raum vorhanden</strong>
                <p>
                  Legen Sie zuerst einen Raum an. Danach können Sie technische
                  Einrichtungen planen.
                </p>
                {canManage ? (
                  <button
                    className="primary-button"
                    onClick={() => setEditor("room")}
                    type="button"
                  >
                    Raum anlegen
                  </button>
                ) : null}
              </div>
            </div>
          )}
        </section>
      ) : null}

      {editor === "room" && canManage ? (
        <section
          className="event-spaces__editor panel"
          aria-labelledby="event-space-room-heading"
        >
          <div className="event-spaces__editor-heading">
            <div>
              <p className="eyebrow">Raumverwaltung</p>
              <h3 id="event-space-room-heading">Veranstaltungsraum anlegen</h3>
            </div>
          </div>
          <form onSubmit={createRoom}>
            <div className="event-spaces__form-grid">
              <label>
                Raumname
                <input
                  minLength={2}
                  required
                  value={roomDraft.name}
                  onChange={(event) =>
                    setRoomDraft((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  placeholder="z. B. Aula"
                />
              </label>
              <label>
                Raumart
                <select
                  value={roomDraft.kind}
                  onChange={(event) =>
                    setRoomDraft((current) => ({
                      ...current,
                      kind: event.target.value,
                    }))
                  }
                >
                  <option value="meeting_room">Sitzungszimmer</option>
                  <option value="event_room">Veranstaltungsraum</option>
                  <option value="other">Anderer Raum</option>
                </select>
              </label>
              <label>
                Standort
                <input
                  value={roomDraft.location}
                  onChange={(event) =>
                    setRoomDraft((current) => ({
                      ...current,
                      location: event.target.value,
                    }))
                  }
                  placeholder="z. B. Gebäude A, Erdgeschoss"
                />
              </label>
              <label>
                Kapazität
                <input
                  inputMode="numeric"
                  max="10000"
                  min="1"
                  type="number"
                  value={roomDraft.capacity}
                  onChange={(event) =>
                    setRoomDraft((current) => ({
                      ...current,
                      capacity: event.target.value,
                    }))
                  }
                  placeholder="Optional"
                />
              </label>
            </div>
            <div className="event-spaces__form-actions">
              <button
                className="secondary-button"
                onClick={() => setEditor("request")}
                type="button"
              >
                Zurück
              </button>
              <button
                className="primary-button"
                disabled={pending}
                type="submit"
              >
                {pending ? "Wird angelegt …" : "Raum anlegen"}
              </button>
            </div>
          </form>
        </section>
      ) : null}

      {pendingConflicts ? (
        <section
          className="event-spaces__conflict panel"
          aria-labelledby="event-space-conflict-heading"
          role="status"
        >
          <div>
            <ClipboardCheck aria-hidden="true" size={22} />
            <div>
              <p className="eyebrow">Überschneidung erkannt</p>
              <h3 id="event-space-conflict-heading">
                Auftrag bewusst bestätigen?
              </h3>
              <p>
                {pendingConflicts.conflicts.roomConflictCount
                  ? `${pendingConflicts.conflicts.roomConflictCount} Raumüberschneidung${pendingConflicts.conflicts.roomConflictCount === 1 ? "" : "en"}`
                  : ""}
                {pendingConflicts.conflicts.roomConflictCount &&
                pendingConflicts.conflicts.equipmentConflictCount
                  ? " und "
                  : ""}
                {pendingConflicts.conflicts.equipmentConflictCount
                  ? `${pendingConflicts.conflicts.equipmentConflictCount} Techniküberschneidung${pendingConflicts.conflicts.equipmentConflictCount === 1 ? "" : "en"}`
                  : ""}{" "}
                wurden erkannt. Es werden keine Angaben aus anderen Aufträgen
                angezeigt.
              </p>
            </div>
          </div>
          <div className="event-spaces__conflict-actions">
            <button
              className="secondary-button"
              disabled={pending}
              onClick={() => setPendingConflicts(null)}
              type="button"
            >
              Auftrag anpassen
            </button>
            <button
              className="primary-button"
              disabled={pending}
              onClick={() => {
                const payload = requestPayload();
                if (payload)
                  void createRequest(
                    payload,
                    true,
                    pendingConflicts.conflictSnapshot,
                  );
              }}
              type="button"
            >
              {pending ? "Wird gespeichert …" : "Trotzdem erfassen"}
            </button>
          </div>
        </section>
      ) : null}

      <section
        className="event-spaces__workspace panel"
        aria-labelledby="event-space-workspace-heading"
      >
        <div className="event-spaces__workspace-heading">
          <div>
            <p className="eyebrow">Nächste Einsätze</p>
            <h3 id="event-space-workspace-heading">Raumplanung</h3>
          </div>
          <div
            className="event-spaces__view-switch"
            role="group"
            aria-label="Ansicht wählen"
          >
            <button
              aria-pressed={view === "calendar"}
              onClick={() => setView("calendar")}
              type="button"
            >
              <CalendarDays aria-hidden="true" size={16} /> Kalender
            </button>
            <button
              aria-pressed={view === "list"}
              onClick={() => setView("list")}
              type="button"
            >
              Liste
            </button>
          </div>
        </div>
        {view === "calendar" ? (
          <div className="event-spaces__calendar">
            <div className="event-spaces__calendar-controls">
              <button
                aria-label="Vorherige Woche"
                className="icon-button"
                onClick={() =>
                  setCalendarStart((current) => {
                    const next = new Date(current);
                    next.setDate(next.getDate() - 7);
                    return next;
                  })
                }
                type="button"
              >
                <ChevronLeft aria-hidden="true" size={18} />
              </button>
              <strong>
                {dateLabel(visibleDays[0]!.toISOString())} –{" "}
                {dateLabel(visibleDays[6]!.toISOString())}
              </strong>
              <button
                aria-label="Nächste Woche"
                className="icon-button"
                onClick={() =>
                  setCalendarStart((current) => {
                    const next = new Date(current);
                    next.setDate(next.getDate() + 7);
                    return next;
                  })
                }
                type="button"
              >
                <ChevronRight aria-hidden="true" size={18} />
              </button>
            </div>
            <div className="event-spaces__calendar-days">
              {visibleDays.map((day) => {
                const dayRequests = requestsByDay.get(dayKey(day)) ?? [];
                return (
                  <article
                    className="event-spaces__calendar-day"
                    key={dayKey(day)}
                  >
                    <header>
                      <span>
                        {new Intl.DateTimeFormat("de-CH", {
                          weekday: "short",
                        }).format(day)}
                      </span>
                      <strong>{day.getDate()}</strong>
                    </header>
                    {dayRequests.length ? (
                      dayRequests.map((request) => (
                        <button
                          className={`event-spaces__calendar-item event-spaces__status--${request.status}`}
                          key={request.id}
                          onClick={() => setExpandedRequestId(request.id)}
                          type="button"
                        >
                          <time>{timeLabel(request.startsAt)}</time>
                          {request.intakeSource === "email_ticket" ? (
                            <span className="event-spaces__calendar-intake-label">
                              E-Mail-Auftrag
                            </span>
                          ) : null}
                          <strong>{request.title}</strong>
                          <span>
                            {roomsById.get(request.spaceId)?.name ?? "Raum"}
                          </span>
                        </button>
                      ))
                    ) : (
                      <p>Keine Einrichtung</p>
                    )}
                  </article>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="event-spaces__request-list">
            {requests.length ? (
              requests.map((request) => (
                <RequestCard
                  canManage={canManage}
                  expanded={expandedRequestId === request.id}
                  focused={focusRequestId === request.id}
                  key={request.id}
                  agents={workspace?.agents ?? []}
                  onAssignAgent={assignEmailAgent}
                  onAssignResponsible={assignResponsible}
                  onChangeRequestStatus={changeRequestStatus}
                  onChangeTaskStatus={changeTaskStatus}
                  onToggle={() =>
                    setExpandedRequestId((current) =>
                      current === request.id ? null : request.id,
                    )
                  }
                  people={workspace?.people ?? []}
                  request={request}
                  room={roomsById.get(request.spaceId) ?? null}
                />
              ))
            ) : (
              <p className="empty-state">
                Es sind noch keine Raumaufträge für die kommenden Monate
                geplant.
              </p>
            )}
          </div>
        )}
        {workspace?.pagination.hasMore &&
        workspace.pagination.nextOffset !== null ? (
          <div className="event-spaces__load-more">
            <p>
              Weitere Raumaufträge im Planungsjahr sind vorhanden. Laden Sie sie
              nach, bevor Sie in spätere Wochen wechseln.
            </p>
            <button
              className="secondary-button"
              disabled={loadingMore}
              onClick={() =>
                void loadWorkspace(workspace.pagination.nextOffset!, true, true)
              }
              type="button"
            >
              {loadingMore ? "Wird geladen …" : "Weitere Aufträge laden"}
            </button>
          </div>
        ) : null}
      </section>

      {!canRequest && !canManage ? (
        <p className="event-spaces__access-note">
          Sie können die Raumplanung sehen, aber noch keine Raumaufträge
          erfassen oder verwalten.
        </p>
      ) : null}
    </section>
  );
}

function RequestCard({
  agents,
  canManage,
  expanded,
  focused,
  onAssignAgent,
  onAssignResponsible,
  onChangeRequestStatus,
  onChangeTaskStatus,
  onToggle,
  people,
  request,
  room,
}: {
  agents: readonly Person[];
  canManage: boolean;
  expanded: boolean;
  focused: boolean;
  onAssignAgent: (requestId: string, responsibleUserId: string) => void;
  onAssignResponsible: (requestId: string, responsibleUserId: string) => void;
  onChangeRequestStatus: (
    requestId: string,
    status: RequestStatus,
  ) => Promise<void>;
  onChangeTaskStatus: (task: Task) => Promise<void>;
  onToggle: () => void;
  people: readonly Person[];
  request: RoomRequest;
  room: Room | null;
}) {
  const progress = taskProgress(request.tasks);
  return (
    <article
      className={`event-spaces__request event-spaces__status--${request.status}${focused ? " global-search-target" : ""}`}
      id={`event-space-request-${request.id}`}
    >
      <button
        aria-expanded={expanded}
        className="event-spaces__request-summary"
        onClick={onToggle}
        type="button"
      >
        <time>
          <strong>{dateLabel(request.startsAt)}</strong>
          <span>
            {timeLabel(request.startsAt)} – {timeLabel(request.endsAt)}
          </span>
        </time>
        <div>
          <div className="event-spaces__request-context">
            <span className="event-spaces__request-room">
              {room?.name ?? "Raum"}
            </span>
            {request.intakeSource === "email_ticket" ? (
              <span className="event-spaces__email-intake-label">
                <Mail aria-hidden="true" size={13} />
                {request.responsibleName
                  ? "E-Mail-Auftrag"
                  : "Neue E-Mail-Anfrage"}
              </span>
            ) : null}
          </div>
          <h4>{request.title}</h4>
          <p>
            {request.intakeSource === "email_ticket"
              ? request.organizer
                ? `Auftrag ausgelöst von: ${request.organizer}`
                : "Auftrag ausgelöst von: Nicht übermittelt"
              : request.responsibleName
                ? `Verantwortlich: ${request.responsibleName}`
                : "Verantwortung noch offen"}
            {request.intakeSource === "email_ticket"
              ? request.responsibleName
                ? ` · Agent:in: ${request.responsibleName}`
                : " · Agent:in noch offen"
              : ""}
            {request.expectedParticipants !== null
              ? ` · ${request.expectedParticipants} Teilnehmende`
              : ""}
          </p>
        </div>
        <span className="event-spaces__status-label">
          {statusLabels[request.status]}
        </span>
      </button>
      {expanded ? (
        <div className="event-spaces__request-detail">
          <div className="event-spaces__request-detail-grid">
            <div>
              <span>Raum</span>
              <strong>{room?.name ?? "Nicht verfügbar"}</strong>
              {room?.location ? <small>{room.location}</small> : null}
            </div>
            <div>
              <span>Technik</span>
              <p className="event-spaces__equipment-tags">
                {request.equipment.length
                  ? request.equipment.map((key) => (
                      <span key={key}>{equipmentLabels.get(key) ?? key}</span>
                    ))
                  : "Keine besondere Technik"}
              </p>
            </div>
            <div>
              <span>Aufgaben</span>
              <strong>
                {progress.completed} von {progress.total} erledigt
              </strong>
            </div>
            {request.intakeSource === "email_ticket" ? (
              <>
                <div>
                  <span>Auftrag ausgelöst von</span>
                  <strong>{request.organizer ?? "Nicht übermittelt"}</strong>
                </div>
                <div>
                  <span>Herkunft</span>
                  <strong>E-Mail-Auftrag</strong>
                </div>
                {request.remarks ? (
                  <div>
                    <span>Bemerkungen</span>
                    <p>{request.remarks}</p>
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
          {canManage && !request.responsibleName ? (
            <label className="event-spaces__status-control">
              {request.intakeSource === "email_ticket"
                ? "Agent:in zuweisen"
                : "Verantwortliche Person zuweisen"}
              <select
                defaultValue=""
                onChange={(event) => {
                  const responsibleUserId = event.target.value;
                  if (!responsibleUserId) return;
                  if (request.intakeSource === "email_ticket") {
                    onAssignAgent(request.id, responsibleUserId);
                  } else {
                    onAssignResponsible(request.id, responsibleUserId);
                  }
                }}
              >
                <option disabled value="">
                  {request.intakeSource === "email_ticket"
                    ? "Agent:in auswählen …"
                    : "Person auswählen …"}
                </option>
                {(request.intakeSource === "email_ticket"
                  ? agents
                  : people
                ).map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.displayName}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {canManage ? (
            <label className="event-spaces__status-control">
              Auftragsstatus
              <select
                value={request.status}
                onChange={(event) =>
                  void onChangeRequestStatus(
                    request.id,
                    event.target.value as RequestStatus,
                  )
                }
              >
                {Object.entries(statusLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <ol className="event-spaces__tasks">
            {request.tasks.map((task) => (
              <li
                className={`event-spaces__task--${task.status}`}
                key={task.id}
              >
                <button
                  aria-label={`${task.title}: Status ${taskStatusLabels[task.status]}. ${canManage ? "Status weiterführen" : ""}`}
                  disabled={!canManage}
                  onClick={() => void onChangeTaskStatus(task)}
                  type="button"
                >
                  <span>
                    {task.status === "completed" ? (
                      <Check aria-hidden="true" size={14} />
                    ) : null}
                  </span>
                  <strong>{task.title}</strong>
                  <small>{taskStatusLabels[task.status]}</small>
                </button>
              </li>
            ))}
          </ol>
          <p className="event-spaces__ticket-boundary">
            Bei einem Problem wird ein Ticket separat und bewusst erfasst.
            Dieser Auftrag erzeugt kein Ticket.
          </p>
        </div>
      ) : null}
    </article>
  );
}
