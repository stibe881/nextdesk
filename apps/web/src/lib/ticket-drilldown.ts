/**
 * Drilldown from reports (Berichte, Teamführung) into the ticket list. A
 * drilldown is a set of server-side filters for the authorised ticket list
 * RPC (list_authorized_ticket_list_page_v2) plus a label for the
 * «Aus Bericht: …» chip.
 */

export type TicketDrilldown = {
  /** Human readable description, shown as «Aus Bericht: <label>». */
  label: string;
  /** Where the filter comes from; «queue»: team queue in the workbench. */
  source?: "report" | "queue";
  /** true: closed/resolved status, false: open status. */
  statusClosed?: boolean;
  statusLabels?: string[];
  priorityLabels?: string[];
  departmentIds?: string[];
  categoryIds?: string[];
  teamIds?: string[];
  /** An agent id or «unassigned». */
  agent?: string;
  createdFrom?: string;
  createdTo?: string;
  resolvedFrom?: string;
  resolvedTo?: string;
  slaBreached?: boolean;
};

export type DrilldownStatusRecord = {
  id: string;
  label: string;
  is_closed: boolean;
};
export type DrilldownPriorityRecord = { id: string; label: string };

export type DrilldownRpcArguments = {
  p_status_ids: string[] | null;
  p_priority_ids: string[] | null;
  p_department_ids: string[] | null;
  p_assigned_agent_id: string | null;
  p_only_unassigned: boolean;
  p_category_ids: string[] | null;
  p_team_ids: string[] | null;
  p_created_from: string | null;
  p_created_to: string | null;
  p_resolved_from: string | null;
  p_resolved_to: string | null;
  p_sla_breached: boolean | null;
};

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function uuidList(value: unknown, max = 200): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > max) {
    return null;
  }
  return value.every((entry) => typeof entry === "string" && UUID.test(entry))
    ? [...new Set(value as string[])]
    : null;
}

function labelList(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 50) {
    return null;
  }
  const labels = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry && entry.length <= 120 && !CONTROL.test(entry));
  return labels.length === value.length ? [...new Set(labels)] : null;
}

function timestamp(value: unknown): string | null {
  return typeof value === "string" && Number.isFinite(Date.parse(value))
    ? new Date(value).toISOString()
    : null;
}

/** Validates a drilldown (e.g. from a report component or a stored state). */
export function normalizeTicketDrilldown(
  value: unknown,
): TicketDrilldown | null {
  if (!isRecord(value) || typeof value.label !== "string") return null;
  const label = value.label.trim();
  if (!label || label.length > 200 || CONTROL.test(label)) return null;
  const result: TicketDrilldown = { label };
  let dimensions = 0;
  if (typeof value.statusClosed === "boolean") {
    result.statusClosed = value.statusClosed;
    dimensions += 1;
  }
  const lists = [
    ["statusLabels", labelList(value.statusLabels)],
    ["priorityLabels", labelList(value.priorityLabels)],
    ["departmentIds", uuidList(value.departmentIds)],
    ["categoryIds", uuidList(value.categoryIds)],
    ["teamIds", uuidList(value.teamIds)],
  ] as const;
  for (const [key, list] of lists) {
    if (value[key] === undefined) continue;
    if (!list) return null;
    result[key] = list;
    dimensions += 1;
  }
  if (value.agent !== undefined) {
    if (
      typeof value.agent !== "string" ||
      (value.agent !== "unassigned" && !UUID.test(value.agent))
    ) {
      return null;
    }
    result.agent = value.agent;
    dimensions += 1;
  }
  for (const key of [
    "createdFrom",
    "createdTo",
    "resolvedFrom",
    "resolvedTo",
  ] as const) {
    if (value[key] === undefined) continue;
    const parsed = timestamp(value[key]);
    if (!parsed) return null;
    result[key] = parsed;
    dimensions += 1;
  }
  for (const [from, to] of [
    ["createdFrom", "createdTo"],
    ["resolvedFrom", "resolvedTo"],
  ] as const) {
    const start = result[from];
    const end = result[to];
    if (start && end && Date.parse(start) > Date.parse(end)) return null;
  }
  if (typeof value.slaBreached === "boolean") {
    result.slaBreached = value.slaBreached;
    dimensions += 1;
  }
  return dimensions > 0 ? result : null;
}

function intersect(
  left: string[] | null,
  right: string[] | null,
): string[] | null {
  if (left === null) return right;
  if (right === null) return left;
  const allowed = new Set(right);
  return left.filter((entry) => allowed.has(entry));
}

/**
 * Translates a drilldown into RPC filter arguments. Status and priority
 * labels resolve to the tenant's ids; an unknown label yields an empty id
 * list, so the list correctly shows no tickets instead of all.
 */
export function ticketDrilldownRpcArguments(
  drilldown: TicketDrilldown | null | undefined,
  statuses: readonly DrilldownStatusRecord[],
  priorities: readonly DrilldownPriorityRecord[],
): DrilldownRpcArguments {
  if (!drilldown) {
    return {
      p_status_ids: null,
      p_priority_ids: null,
      p_department_ids: null,
      p_assigned_agent_id: null,
      p_only_unassigned: false,
      p_category_ids: null,
      p_team_ids: null,
      p_created_from: null,
      p_created_to: null,
      p_resolved_from: null,
      p_resolved_to: null,
      p_sla_breached: null,
    };
  }
  const closedFilter =
    drilldown.statusClosed === undefined
      ? null
      : statuses
          .filter((status) => status.is_closed === drilldown.statusClosed)
          .map((status) => status.id);
  const labelFilter = drilldown.statusLabels
    ? statuses
        .filter((status) => drilldown.statusLabels!.includes(status.label))
        .map((status) => status.id)
    : null;
  const priorityIds = drilldown.priorityLabels
    ? priorities
        .filter((priority) =>
          drilldown.priorityLabels!.includes(priority.label),
        )
        .map((priority) => priority.id)
    : null;
  return {
    p_status_ids: intersect(closedFilter, labelFilter),
    p_priority_ids: priorityIds,
    p_department_ids: drilldown.departmentIds ?? null,
    p_assigned_agent_id:
      drilldown.agent && drilldown.agent !== "unassigned"
        ? drilldown.agent
        : null,
    p_only_unassigned: drilldown.agent === "unassigned",
    p_category_ids: drilldown.categoryIds ?? null,
    p_team_ids: drilldown.teamIds ?? null,
    p_created_from: drilldown.createdFrom ?? null,
    p_created_to: drilldown.createdTo ?? null,
    p_resolved_from: drilldown.resolvedFrom ?? null,
    p_resolved_to: drilldown.resolvedTo ?? null,
    p_sla_breached: drilldown.slaBreached ?? null,
  };
}

/**
 * Combines the list refinement arguments with a drilldown: id lists are
 * intersected (both must match), a drilldown agent wins over «all».
 */
export function mergeDrilldownArguments<
  Base extends {
    p_status_ids: string[] | null;
    p_priority_ids: string[] | null;
    p_department_ids: string[] | null;
    p_assigned_agent_id: string | null;
    p_only_unassigned: boolean;
  },
>(base: Base, drilldown: DrilldownRpcArguments): Base & DrilldownRpcArguments {
  return {
    ...base,
    ...drilldown,
    p_status_ids: intersect(base.p_status_ids, drilldown.p_status_ids),
    p_priority_ids: intersect(base.p_priority_ids, drilldown.p_priority_ids),
    p_department_ids: intersect(
      base.p_department_ids,
      drilldown.p_department_ids,
    ),
    p_assigned_agent_id:
      drilldown.p_assigned_agent_id ?? base.p_assigned_agent_id,
    p_only_unassigned: base.p_only_unassigned || drilldown.p_only_unassigned,
  };
}

export function drilldownChipLabel(drilldown: TicketDrilldown): string {
  return drilldown.source === "queue"
    ? `Warteschlange: ${drilldown.label}`
    : `Aus Bericht: ${drilldown.label}`;
}

const dayFormatter = new Intl.DateTimeFormat("de-CH", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "Europe/Zurich",
});

/** «01.10.2026–31.10.2026» for a report period. */
export function drilldownPeriodLabel(startsAt: string, endsAt: string): string {
  const start = Date.parse(startsAt);
  const end = Date.parse(endsAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "";
  const from = dayFormatter.format(new Date(start));
  const to = dayFormatter.format(new Date(end));
  return from === to ? from : `${from}–${to}`;
}

/** Joins label parts, skipping empty ones: «Priorität Hoch · 01.10.–…». */
export function drilldownLabel(
  ...parts: (string | null | undefined)[]
): string {
  return parts
    .map((part) => part?.trim() ?? "")
    .filter(Boolean)
    .join(" · ");
}
