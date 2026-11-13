/**
 * «Ticket-Zeitachse»: builds a chronological timeline of a ticket from data
 * that already exists (ticket events, comments, SLA columns, vendor cases,
 * child tickets) and finds the gaps where time was lost.
 */

import { slaPauseEventLabel } from "./sla-pause";

export type TimelineTone =
  "neutral" | "info" | "success" | "warning" | "danger" | "accent";

export type TimelineEntryKind =
  | "created"
  | "status"
  | "assignment"
  | "priority"
  | "department"
  | "sla_due"
  | "sla_pause"
  | "first_response"
  | "requester_reply"
  | "agent_reply"
  | "internal_note"
  | "vendor"
  | "child"
  | "escalation"
  | "merge"
  | "resolved"
  | "closed";

export type TimelineEntry = {
  id: string;
  time: number;
  kind: TimelineEntryKind;
  title: string;
  detail: string | null;
  tone: TimelineTone;
  /** SLA due points that still lie ahead. */
  future: boolean;
};

export type TimelinePeriodKind = "vendor" | "child" | "waiting";

export type TimelinePeriod = {
  id: string;
  kind: TimelinePeriodKind;
  label: string;
  start: number;
  /** Null while the period is still running. */
  end: number | null;
  tone: TimelineTone;
};

export type TimelineGapReason =
  "waiting_vendor" | "waiting_customer" | "waiting" | "idle";

export type TimelineGap = {
  id: string;
  start: number;
  end: number;
  durationMs: number;
  reason: TimelineGapReason;
  label: string;
  /** The gap lasts until now (open ticket without activity). */
  ongoing: boolean;
};

export type TicketTimeline = {
  entries: TimelineEntry[];
  periods: TimelinePeriod[];
  gaps: TimelineGap[];
  start: number;
  end: number;
};

export type TimelineSequenceItem =
  { type: "entry"; entry: TimelineEntry } | { type: "gap"; gap: TimelineGap };

export type TimelineInput = {
  ticket: {
    createdAt: string;
    firstRespondedAt: string | null;
    responseDueAt: string | null;
    resolutionDueAt: string | null;
    resolvedAt: string | null;
    closedAt: string | null;
    isClosed: boolean;
    /** Start of a running SLA pause (waiting status, 0324). */
    slaPausedAt?: string | null;
  };
  events: {
    id: string;
    type: string;
    createdAt: string;
    payload: Record<string, unknown>;
  }[];
  comments: {
    id: string;
    visibility: "internal" | "external";
    createdAt: string;
    fromRequester: boolean;
  }[];
  vendorCases: {
    id: string;
    vendorName: string;
    externalCaseNumber: string | null;
    openedAt: string | null;
    closedAt: string | null;
  }[];
  children: {
    id: string;
    ticketNumber: string;
    createdAt: string | null;
    resolvedAt: string | null;
    closedAt: string | null;
    isClosed: boolean;
  }[];
  statuses: { key: string; label: string; isClosed: boolean }[];
};

export type TimelineOptions = {
  /** Minimum length of a highlighted gap; default 24 hours. */
  gapThresholdMs?: number;
};

const HOUR = 60 * 60 * 1000;
export const DEFAULT_GAP_THRESHOLD_MS = 24 * HOUR;

function time(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function textValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** «45 Min.», «3 Std. 20 Min.», «2 Tage 4 Std.» */
export function formatTimelineDuration(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60000));
  if (minutes < 60) return `${minutes} Min.`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return rest ? `${hours} Std. ${rest} Min.` : `${hours} Std.`;
  }
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  const dayLabel = `${days} ${days === 1 ? "Tag" : "Tage"}`;
  return restHours ? `${dayLabel} ${restHours} Std.` : dayLabel;
}

function statusTone(key: string | null, isClosed: boolean): TimelineTone {
  if (isClosed) return "success";
  if (key?.startsWith("waiting")) return "warning";
  return "info";
}

type StatusChange = { time: number; key: string | null };

function slaEntry(
  id: string,
  title: string,
  due: number,
  doneAt: number | null,
  now: number,
  pausedAt: number | null = null,
): TimelineEntry {
  if (doneAt === null && pausedAt !== null && due > pausedAt) {
    // Paused SLA: the stored due date is frozen; the remaining time runs
    // again on resume, so the target lies ahead by that remaining time.
    const remaining = due - pausedAt;
    return {
      id,
      time: now + remaining,
      kind: "sla_due",
      title,
      detail: `SLA pausiert, Restzeit ${formatTimelineDuration(remaining)}`,
      tone: "neutral",
      future: true,
    };
  }
  if (doneAt !== null) {
    const met = doneAt <= due;
    return {
      id,
      time: due,
      kind: "sla_due",
      title,
      detail: met
        ? "eingehalten"
        : `verletzt um ${formatTimelineDuration(doneAt - due)}`,
      tone: met ? "success" : "danger",
      future: false,
    };
  }
  if (now > due) {
    return {
      id,
      time: due,
      kind: "sla_due",
      title,
      detail: `verletzt, seit ${formatTimelineDuration(now - due)} überfällig`,
      tone: "danger",
      future: false,
    };
  }
  return {
    id,
    time: due,
    kind: "sla_due",
    title,
    detail: `fällig in ${formatTimelineDuration(due - now)}`,
    tone: due - now <= 4 * HOUR ? "warning" : "neutral",
    future: true,
  };
}

function eventEntries(
  event: TimelineInput["events"][number],
  statusLabels: Map<string, { label: string; isClosed: boolean }>,
  statusChanges: StatusChange[],
): TimelineEntry[] {
  const at = time(event.createdAt);
  if (at === null) return [];
  const payload = event.payload ?? {};
  const base = { time: at, future: false };
  const entries: TimelineEntry[] = [];
  switch (event.type) {
    case "ticket.updated":
    case "ticket.closed": {
      const fields = Array.isArray(payload.changedFields)
        ? payload.changedFields.filter(
            (field): field is string => typeof field === "string",
          )
        : [];
      const transition =
        typeof payload.statusTransition === "object" &&
        payload.statusTransition !== null
          ? (payload.statusTransition as Record<string, unknown>)
          : null;
      const statusKey = transition ? textValue(transition.toStatusKey) : null;
      if (transition || event.type === "ticket.closed") {
        const status = statusKey ? statusLabels.get(statusKey) : undefined;
        const isClosed =
          transition?.isClosed === true ||
          status?.isClosed === true ||
          event.type === "ticket.closed";
        statusChanges.push({ time: at, key: statusKey });
        entries.push({
          ...base,
          id: `${event.id}:status`,
          kind: isClosed ? "resolved" : "status",
          title: `Status: ${status?.label ?? (isClosed ? "Gelöst" : "Geändert")}`,
          detail: null,
          tone: statusTone(statusKey, isClosed),
        });
      }
      if (fields.includes("assignedAgent") || fields.includes("assignedTeam")) {
        entries.push({
          ...base,
          id: `${event.id}:assignment`,
          kind: "assignment",
          title: fields.includes("assignedAgent")
            ? "Zuweisung geändert"
            : "Team geändert",
          detail: null,
          tone: "neutral",
        });
      }
      if (fields.includes("priority")) {
        entries.push({
          ...base,
          id: `${event.id}:priority`,
          kind: "priority",
          title: "Priorität geändert",
          detail: null,
          tone: "neutral",
        });
      }
      return entries;
    }
    case "ticket.sla.paused":
    case "ticket.sla.resumed":
      return [
        {
          ...base,
          id: event.id,
          kind: "sla_pause",
          title: slaPauseEventLabel(event.type, payload) ?? "SLA",
          detail: null,
          tone: event.type === "ticket.sla.paused" ? "warning" : "info",
        },
      ];
    case "ticket.department_changed":
      return [
        {
          ...base,
          id: event.id,
          kind: "department",
          title: "Abteilung gewechselt",
          detail: null,
          tone: "neutral",
        },
      ];
    case "ticket.phishing_suspicion":
      return [
        {
          ...base,
          id: event.id,
          kind: "escalation",
          title: "Spam-/Phishing-Verdacht gemeldet",
          detail: textValue(payload.teamName),
          tone: "warning",
        },
      ];
    case "ticket.escalation_opened":
      return [
        {
          ...base,
          id: event.id,
          kind: "escalation",
          title: "Eskalation eröffnet",
          detail: null,
          tone: "danger",
        },
      ];
    case "ticket.support_level_changed": {
      // Level handover (1st/2nd/3rd Level), not a management escalation.
      const toLevel = payload.toLevel;
      const label =
        toLevel === 1 || toLevel === 2 || toLevel === 3
          ? ["1st", "2nd", "3rd"][toLevel - 1] + " Level"
          : "andere Stufe";
      const team = textValue(payload.toTeamName);
      return [
        {
          ...base,
          id: event.id,
          kind: "assignment",
          title:
            payload.direction === "returned"
              ? `Zurück an ${label}`
              : `Übergabe an ${label}`,
          detail: team,
          tone: payload.direction === "returned" ? "neutral" : "warning",
        },
      ];
    }
    case "ticket.escalation_resolved":
      return [
        {
          ...base,
          id: event.id,
          kind: "escalation",
          title: "Eskalation aufgehoben",
          detail: null,
          tone: "success",
        },
      ];
    case "ticket.merged":
    case "ticket.merge_received":
      return [
        {
          ...base,
          id: event.id,
          kind: "merge",
          title:
            event.type === "ticket.merged"
              ? "In anderes Ticket zusammengeführt"
              : "Duplikat zusammengeführt",
          detail: null,
          tone: "neutral",
        },
      ];
    case "ticket.split": {
      const numbers = Array.isArray(payload.children)
        ? payload.children.filter(
            (value): value is string => typeof value === "string",
          )
        : [];
      return [
        {
          ...base,
          id: event.id,
          kind: "child",
          title:
            numbers.length === 1
              ? "Aufgeteilt in 1 Teil-Ticket"
              : `Aufgeteilt in ${numbers.length} Teil-Tickets`,
          detail: numbers.length ? numbers.join(", ") : null,
          tone: "accent",
        },
      ];
    }
    case "ticket.children_done":
      return [
        {
          ...base,
          id: event.id,
          kind: "child",
          title: "Alle Teil-Tickets erledigt",
          detail: textValue(payload.lastChildTicketNumber)
            ? `Zuletzt ${textValue(payload.lastChildTicketNumber)}`
            : null,
          tone: "success",
        },
      ];
    case "ticket.vendor_case_opened": {
      const vendor = textValue(payload.vendorName) ?? "Drittanbieter";
      const caseNumber = textValue(payload.externalCaseNumber);
      return [
        {
          ...base,
          id: event.id,
          kind: "vendor",
          title: `An ${vendor} übergeben`,
          detail: caseNumber ? `Fallnummer ${caseNumber}` : null,
          tone: "warning",
        },
      ];
    }
    case "ticket.vendor_update":
      return [
        {
          ...base,
          id: event.id,
          kind: "vendor",
          title: `Rückmeldung von ${textValue(payload.vendorName) ?? "Drittanbieter"}`,
          detail: textValue(payload.note),
          tone: "info",
        },
      ];
    case "ticket.vendor_reminder":
      return [
        {
          ...base,
          id: event.id,
          kind: "vendor",
          title: `Erinnerung: ${textValue(payload.vendorName) ?? "Drittanbieter"} ohne Rückmeldung`,
          detail: null,
          tone: "warning",
        },
      ];
    case "ticket.resolved_by_requester":
    case "ticket.requester_needs_help": {
      const resolved = event.type === "ticket.resolved_by_requester";
      statusChanges.push({
        time: at,
        key: resolved ? "resolved" : "in_progress",
      });
      const channel = textValue(payload.channel);
      return [
        {
          ...base,
          id: event.id,
          kind: resolved ? "resolved" : "status",
          title: resolved
            ? "Von der meldenden Person als gelöst bestätigt"
            : "Meldende Person braucht noch Hilfe",
          detail:
            channel === "email"
              ? "Über den Link in der Erinnerung"
              : channel === "app"
                ? "In der App"
                : channel === "portal"
                  ? "Im Portal"
                  : null,
          tone: resolved ? "success" : "warning",
        },
      ];
    }
    case "ticket.vendor_case_closed":
      return [
        {
          ...base,
          id: event.id,
          kind: "vendor",
          title: `Fall bei ${textValue(payload.vendorName) ?? "Drittanbieter"} abgeschlossen`,
          detail: textValue(payload.note),
          tone: "success",
        },
      ];
    default:
      return [];
  }
}

/** Status segments (key, start, end) from the recorded status changes. */
function statusSegments(
  changes: StatusChange[],
  end: number,
): { key: string | null; start: number; end: number }[] {
  const sorted = [...changes].sort((a, b) => a.time - b.time);
  return sorted.map((change, index) => ({
    key: change.key,
    start: change.time,
    end: sorted[index + 1]?.time ?? end,
  }));
}

function overlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

const GAP_LABELS: Record<TimelineGapReason, string> = {
  waiting_vendor: "Wartet auf Drittanbieter",
  waiting_customer: "Wartet auf Kundenrückmeldung",
  waiting: "Wartend",
  idle: "Keine Aktivität",
};

export function buildTicketTimeline(
  input: TimelineInput,
  now: number = Date.now(),
  options: TimelineOptions = {},
): TicketTimeline {
  const threshold = options.gapThresholdMs ?? DEFAULT_GAP_THRESHOLD_MS;
  const createdAt = time(input.ticket.createdAt) ?? now;
  const statusLabels = new Map(
    input.statuses.map((status) => [
      status.key,
      { label: status.label, isClosed: status.isClosed },
    ]),
  );
  const statusChanges: StatusChange[] = [];
  const entries: TimelineEntry[] = [
    {
      id: "created",
      time: createdAt,
      kind: "created",
      title: "Ticket erstellt",
      detail: null,
      tone: "info",
      future: false,
    },
  ];

  for (const event of input.events) {
    entries.push(...eventEntries(event, statusLabels, statusChanges));
  }

  const firstResponse = time(input.ticket.firstRespondedAt);
  if (firstResponse !== null) {
    entries.push({
      id: "first-response",
      time: firstResponse,
      kind: "first_response",
      title: "Erste Reaktion",
      detail: `nach ${formatTimelineDuration(firstResponse - createdAt)}`,
      tone: "success",
      future: false,
    });
  }

  for (const comment of input.comments) {
    const at = time(comment.createdAt);
    if (at === null) continue;
    entries.push({
      id: `comment:${comment.id}`,
      time: at,
      kind:
        comment.visibility === "internal"
          ? "internal_note"
          : comment.fromRequester
            ? "requester_reply"
            : "agent_reply",
      title:
        comment.visibility === "internal"
          ? "Interne Notiz"
          : comment.fromRequester
            ? "Antwort der anfragenden Person"
            : "Antwort an die anfragende Person",
      detail: null,
      tone:
        comment.visibility === "internal"
          ? "accent"
          : comment.fromRequester
            ? "info"
            : "neutral",
      future: false,
    });
  }

  const resolvedAt =
    time(input.ticket.resolvedAt) ?? time(input.ticket.closedAt);
  const closedAt = time(input.ticket.closedAt);
  const responseDue = time(input.ticket.responseDueAt);
  const slaPausedAt = input.ticket.isClosed
    ? null
    : time(input.ticket.slaPausedAt ?? null);
  if (responseDue !== null) {
    entries.push(
      slaEntry(
        "sla-response",
        "Reaktionsfrist",
        responseDue,
        firstResponse,
        now,
        slaPausedAt,
      ),
    );
  }
  const resolutionDue = time(input.ticket.resolutionDueAt);
  if (resolutionDue !== null) {
    entries.push(
      slaEntry(
        "sla-resolution",
        "Lösungsfrist",
        resolutionDue,
        input.ticket.isClosed ? resolvedAt : null,
        now,
        slaPausedAt,
      ),
    );
  }
  const hasClosingStatus = entries.some((entry) => entry.kind === "resolved");
  if (input.ticket.isClosed && !hasClosingStatus && resolvedAt !== null) {
    entries.push({
      id: "resolved",
      time: resolvedAt,
      kind: "resolved",
      title: "Gelöst",
      detail: null,
      tone: "success",
      future: false,
    });
    if (closedAt !== null && closedAt - resolvedAt > 60_000) {
      entries.push({
        id: "closed",
        time: closedAt,
        kind: "closed",
        title: "Geschlossen",
        detail: null,
        tone: "success",
        future: false,
      });
    }
  }

  entries.sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));

  // SLA due points are no activity: they neither end a gap nor the timeline.
  const pastEntries = entries.filter(
    (entry) => !entry.future && entry.kind !== "sla_due",
  );
  const lastActivity = pastEntries.reduce(
    (latest, entry) => Math.max(latest, entry.time),
    createdAt,
  );
  const timelineEnd = input.ticket.isClosed ? lastActivity : now;

  const periods: TimelinePeriod[] = [];
  for (const vendorCase of input.vendorCases) {
    const start = time(vendorCase.openedAt);
    if (start === null) continue;
    periods.push({
      id: `vendor:${vendorCase.id}`,
      kind: "vendor",
      label: vendorCase.externalCaseNumber
        ? `${vendorCase.vendorName} (${vendorCase.externalCaseNumber})`
        : vendorCase.vendorName,
      start,
      end: time(vendorCase.closedAt),
      tone: "warning",
    });
  }
  for (const child of input.children) {
    const start = time(child.createdAt);
    if (start === null) continue;
    periods.push({
      id: `child:${child.id}`,
      kind: "child",
      label: child.ticketNumber,
      start,
      end: child.isClosed
        ? (time(child.closedAt) ?? time(child.resolvedAt))
        : null,
      tone: child.isClosed ? "success" : "accent",
    });
  }
  const segments = statusSegments(statusChanges, timelineEnd);
  for (const segment of segments) {
    if (!segment.key?.startsWith("waiting")) continue;
    periods.push({
      id: `waiting:${segment.start}`,
      kind: "waiting",
      label: statusLabels.get(segment.key)?.label ?? "Wartend",
      start: segment.start,
      end:
        segment.end >= timelineEnd && !input.ticket.isClosed
          ? null
          : segment.end,
      tone: "warning",
    });
  }
  periods.sort((a, b) => a.start - b.start);

  // Gaps between consecutive activities (and until now for open tickets).
  const points = [...new Set(pastEntries.map((entry) => entry.time))]
    .filter((value) => value <= now)
    .sort((a, b) => a - b);
  if (!input.ticket.isClosed) points.push(now);
  const gaps: TimelineGap[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1] ?? now;
    const end = points[index] ?? now;
    const duration = end - start;
    if (duration < threshold) continue;
    let reason: TimelineGapReason = "idle";
    let best = 0;
    for (const segment of segments) {
      if (!segment.key?.startsWith("waiting")) continue;
      const covered = overlap(start, end, segment.start, segment.end);
      if (covered > best && covered >= duration / 2) {
        best = covered;
        reason =
          segment.key === "waiting_vendor"
            ? "waiting_vendor"
            : segment.key === "waiting_customer"
              ? "waiting_customer"
              : "waiting";
      }
    }
    if (reason === "idle") {
      const vendorCovered = periods
        .filter((period) => period.kind === "vendor")
        .some(
          (period) =>
            overlap(start, end, period.start, period.end ?? now) >=
            duration / 2,
        );
      if (vendorCovered) reason = "waiting_vendor";
    }
    const ongoing = !input.ticket.isClosed && index === points.length - 1;
    gaps.push({
      id: `gap:${start}`,
      start,
      end,
      durationMs: duration,
      reason,
      label: `${GAP_LABELS[reason]} · ${formatTimelineDuration(duration)}`,
      ongoing,
    });
  }

  const futureEnd = entries.reduce(
    (latest, entry) => Math.max(latest, entry.time),
    timelineEnd,
  );
  return {
    entries,
    periods,
    gaps,
    start: Math.min(createdAt, ...entries.map((entry) => entry.time)),
    end: Math.max(futureEnd, createdAt + 60_000),
  };
}

/** Entries in order with the gaps placed between the entries they separate. */
export function timelineSequence(
  timeline: TicketTimeline,
): TimelineSequenceItem[] {
  const items: TimelineSequenceItem[] = [];
  const gaps = [...timeline.gaps].sort((a, b) => a.start - b.start);
  for (const entry of timeline.entries) {
    while (gaps[0] && gaps[0].end <= entry.time) {
      items.push({ type: "gap", gap: gaps.shift()! });
    }
    items.push({ type: "entry", entry });
  }
  for (const gap of gaps) items.push({ type: "gap", gap });
  return items;
}

/** Position of a point on the timeline in percent (0–100). */
export function timelinePosition(
  timeline: Pick<TicketTimeline, "start" | "end">,
  value: number,
): number {
  const span = timeline.end - timeline.start;
  if (span <= 0) return 0;
  return Math.min(100, Math.max(0, ((value - timeline.start) / span) * 100));
}
