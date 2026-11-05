import { withSupabase } from "@supabase/server";
import {
  isRecord,
  isUuid,
  json,
  noContent,
  parseJsonObject,
} from "../_shared/http.ts";
import { resolveTenantFeatureStates } from "../_shared/tenant-features.ts";
import {
  addDays,
  describeRule,
  formatDate,
  nextOccurrences,
  normalizeRule,
  occurrencesBetween,
  parseDate,
  type RecurrenceRule,
} from "../_shared/service-task-recurrence.ts";
import {
  type ChecklistItem,
  fulfillment,
  GENERATION_HORIZON_DAYS,
  initialChecklist,
  normalizeTemplateChecklist,
  planOccurrences,
  swissDateTimeToUtc,
  swissHour,
  swissToday,
  weekBounds,
} from "./logic.ts";

/**
 * Serviceaufgaben: recurring maintenance and control tasks.
 *
 * Templates carry a recurrence rule; occurrences are stored up to 60 days
 * ahead (generated on read and by the periodic wake-up). Everything runs with
 * the service role after an explicit membership, feature and permission
 * check; the tables have no client policies.
 */

type Admin = any;
type Row = Record<string, unknown>;
type Access = { canRead: boolean; canExecute: boolean; canManage: boolean };

const FEATURE = "service.tasks";
const PRIORITIES = new Set(["low", "normal", "high", "urgent"]);
const TEMPLATE_SELECT =
  "id, tenant_id, title, instructions, category, priority, assignee_id, team_id, reference_label, estimated_minutes, recurrence, starts_on, ends_on, due_time, lead_days, checklist, require_note, remind, escalate_after_days, active, generated_until, created_at, updated_at";
const OCCURRENCE_SELECT =
  "id, tenant_id, template_id, scheduled_on, due_on, due_at, visible_from, status, assignee_id, checklist, note, skipped_reason, started_at, completed_at, completed_by, reminded_at, escalated_at, created_at, updated_at";
const OPEN_STATUSES = ["open", "in_progress"];

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes("\u0000")) return null;
  return Array.from(trimmed).length <= max ? trimmed : null;
}

function optionalText(value: unknown, max: number, field: string) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = text(value, max);
  if (parsed === null) {
    throw new HttpError(422, "invalid_data", `${field} ist ungültig.`);
  }
  return parsed;
}

function optionalUuid(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (!isUuid(value)) {
    throw new HttpError(422, "invalid_data", "Die Auswahl ist ungültig.");
  }
  return value.toLowerCase();
}

function integerOrNull(
  value: unknown,
  min: number,
  max: number,
  field: string,
) {
  if (value === undefined || value === null || value === "") return null;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  ) {
    throw new HttpError(422, "invalid_data", `${field} ist ungültig.`);
  }
  return value;
}

function databaseError(): HttpError {
  return new HttpError(
    500,
    "service_tasks_failed",
    "Die Serviceaufgaben konnten nicht gespeichert werden.",
  );
}

async function access(
  admin: Admin,
  userId: string,
  tenantId: string,
): Promise<Access> {
  const has = async (code: string) => {
    const { data, error } = await admin.rpc("shop_has_permission", {
      p_user_id: userId,
      p_tenant_id: tenantId,
      p_permission_code: code,
    });
    return !error && data === true;
  };
  const [read, execute, manage] = await Promise.all([
    has("service_tasks.read"),
    has("service_tasks.execute"),
    has("service_tasks.manage"),
  ]);
  return {
    canRead: read || execute || manage,
    canExecute: execute || manage,
    canManage: manage,
  };
}

async function featureEnabled(admin: Admin, tenantId: string) {
  const states = await resolveTenantFeatureStates(admin, tenantId, [FEATURE]);
  return states?.[FEATURE] === true;
}

async function names(
  admin: Admin,
  ids: Iterable<string | null | undefined>,
): Promise<Map<string, string>> {
  const unique = [...new Set([...ids].filter((id): id is string => !!id))];
  if (!unique.length) return new Map();
  const { data } = await admin
    .from("user_profiles")
    .select("id, display_name")
    .in("id", unique);
  return new Map(
    (data ?? []).map((row: Row) => [
      row.id as string,
      (row.display_name as string) || "Unbekannte Person",
    ]),
  );
}

function ruleOf(template: Row): RecurrenceRule | null {
  return normalizeRule(template.recurrence);
}

function ruleText(template: Row): string {
  const rule = ruleOf(template);
  return rule ? describeRule(rule) : "Unbekannte Wiederholung";
}

function templateDto(template: Row, today: string) {
  const rule = ruleOf(template);
  const from = [today, template.starts_on as string].sort().at(-1)!;
  const nextDates = rule
    ? nextOccurrences(rule, template.starts_on as string, from, 4).filter(
        (date) => !template.ends_on || date <= (template.ends_on as string),
      )
    : [];
  return {
    id: template.id,
    title: template.title,
    instructions: template.instructions,
    category: template.category,
    priority: template.priority,
    assigneeId: template.assignee_id,
    teamId: template.team_id,
    referenceLabel: template.reference_label,
    estimatedMinutes: template.estimated_minutes,
    recurrence: template.recurrence,
    startsOn: template.starts_on,
    endsOn: template.ends_on,
    dueTime: String(template.due_time).slice(0, 5),
    leadDays: template.lead_days,
    checklist: normalizeTemplateChecklist(template.checklist),
    requireNote: template.require_note,
    remind: template.remind,
    escalateAfterDays: template.escalate_after_days,
    active: template.active,
    ruleText: ruleText(template),
    nextDates,
  };
}

function occurrenceDto(
  occurrence: Row,
  template: Row | undefined,
  people: Map<string, string>,
  now: Date,
) {
  const checklist = (
    Array.isArray(occurrence.checklist) ? occurrence.checklist : []
  ) as ChecklistItem[];
  const open = OPEN_STATUSES.includes(occurrence.status as string);
  return {
    id: occurrence.id,
    templateId: occurrence.template_id,
    title: template?.title ?? "Serviceaufgabe",
    category: template?.category ?? null,
    priority: template?.priority ?? "normal",
    instructions: template?.instructions ?? null,
    referenceLabel: template?.reference_label ?? null,
    estimatedMinutes: template?.estimated_minutes ?? null,
    requireNote: template?.require_note === true,
    ruleText: template ? ruleText(template) : "",
    scheduledOn: occurrence.scheduled_on,
    dueOn: occurrence.due_on,
    dueAt: occurrence.due_at,
    visibleFrom: occurrence.visible_from,
    status: occurrence.status,
    overdue: open && Date.parse(occurrence.due_at as string) < now.getTime(),
    assignee: occurrence.assignee_id
      ? {
          id: occurrence.assignee_id,
          name:
            people.get(occurrence.assignee_id as string) ?? "Unbekannte Person",
        }
      : null,
    checklist: checklist.map((item) => ({
      ...item,
      doneByName: item.doneBy ? (people.get(item.doneBy) ?? null) : null,
    })),
    checklistDone: checklist.filter((item) => item.done).length,
    checklistTotal: checklist.length,
    note: occurrence.note,
    skippedReason: occurrence.skipped_reason,
    startedAt: occurrence.started_at,
    completedAt: occurrence.completed_at,
    completedBy: occurrence.completed_by
      ? (people.get(occurrence.completed_by as string) ?? null)
      : null,
  };
}

function peopleIdsOf(occurrences: Row[]): string[] {
  return occurrences.flatMap((occurrence) => [
    occurrence.assignee_id as string,
    occurrence.completed_by as string,
    ...(
      (Array.isArray(occurrence.checklist)
        ? occurrence.checklist
        : []) as ChecklistItem[]
    ).map((item) => item.doneBy as string),
  ]);
}

async function logEvent(
  admin: Admin,
  tenantId: string,
  event: string,
  actorId: string | null,
  ids: { occurrenceId?: string; templateId?: string },
  details: Row = {},
) {
  await admin.from("service_task_events").insert({
    tenant_id: tenantId,
    occurrence_id: ids.occurrenceId ?? null,
    template_id: ids.templateId ?? null,
    actor_id: actorId,
    event,
    details,
  });
}

/** Stores due occurrences up to the horizon for the given templates. */
async function generate(admin: Admin, templates: Row[], today: string) {
  const horizon = formatDate(
    addDays(parseDate(today)!, GENERATION_HORIZON_DAYS),
  );
  for (const template of templates) {
    if (!template.active) continue;
    if (template.generated_until && template.generated_until >= horizon)
      continue;
    const rule = ruleOf(template);
    if (!rule) continue;
    const { planned, generatedUntil } = planOccurrences(
      {
        recurrence: rule,
        starts_on: template.starts_on as string,
        ends_on: (template.ends_on as string) ?? null,
        due_time: String(template.due_time),
        lead_days: template.lead_days as number,
        generated_until: (template.generated_until as string) ?? null,
      },
      today,
    );
    if (planned.length) {
      const checklist = initialChecklist(template.checklist);
      const { error } = await admin.from("service_task_occurrences").upsert(
        planned.map((occurrence) => ({
          ...occurrence,
          tenant_id: template.tenant_id,
          template_id: template.id,
          assignee_id: template.assignee_id,
          checklist,
        })),
        { onConflict: "template_id,scheduled_on", ignoreDuplicates: true },
      );
      if (error) continue;
    }
    await admin
      .from("service_task_templates")
      .update({ generated_until: generatedUntil })
      .eq("id", template.id);
  }
}

async function loadTemplates(admin: Admin, tenantId: string): Promise<Row[]> {
  const { data, error } = await admin
    .from("service_task_templates")
    .select(TEMPLATE_SELECT)
    .eq("tenant_id", tenantId)
    .order("title");
  if (error) throw databaseError();
  return data ?? [];
}

async function teamIdsOf(admin: Admin, tenantId: string, userId: string) {
  const { data } = await admin
    .from("team_memberships")
    .select("team_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId);
  return new Set((data ?? []).map((row: Row) => row.team_id as string));
}

async function directory(admin: Admin, tenantId: string) {
  const [members, teams] = await Promise.all([
    admin
      .from("tenant_memberships")
      .select("user_id")
      .eq("tenant_id", tenantId)
      .eq("status", "active"),
    admin
      .from("teams")
      .select("id, name")
      .eq("tenant_id", tenantId)
      .eq("active", true)
      .order("name"),
  ]);
  const people = await names(
    admin,
    (members.data ?? []).map((row: Row) => row.user_id as string),
  );
  return {
    people: [...people.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "de-CH")),
    teams: (teams.data ?? []).map((row: Row) => ({
      id: row.id,
      name: row.name,
    })),
  };
}

async function overview(
  admin: Admin,
  tenantId: string,
  userId: string,
  scope: string,
) {
  const now = new Date();
  const today = swissToday(now);
  const templates = await loadTemplates(admin, tenantId);
  await generate(admin, templates, today);
  const templateById = new Map(templates.map((t) => [t.id as string, t]));
  const myTeams = await teamIdsOf(admin, tenantId, userId);
  const thirtyDaysAgo = formatDate(addDays(parseDate(today)!, -30));
  const twoWeeks = formatDate(addDays(parseDate(today)!, 14));

  const { data, error } = await admin
    .from("service_task_occurrences")
    .select(OCCURRENCE_SELECT)
    .eq("tenant_id", tenantId)
    .gte("due_on", formatDate(addDays(parseDate(today)!, -365)))
    .lte("due_on", twoWeeks)
    .order("due_at")
    .limit(2000);
  if (error) throw databaseError();
  const all = (data ?? []) as Row[];
  const inScope = (occurrence: Row) => {
    const template = templateById.get(occurrence.template_id as string);
    if (scope === "mine") return occurrence.assignee_id === userId;
    if (scope === "team") {
      return (
        occurrence.assignee_id === userId ||
        (!!template?.team_id && myTeams.has(template.team_id as string))
      );
    }
    return true;
  };
  const scoped = all.filter(inScope);
  const people = await names(admin, peopleIdsOf(scoped));
  const dto = (occurrence: Row) =>
    occurrenceDto(
      occurrence,
      templateById.get(occurrence.template_id as string),
      people,
      now,
    );
  const isOpen = (o: Row) => OPEN_STATUSES.includes(o.status as string);
  const overdue = scoped.filter(
    (o) => isOpen(o) && Date.parse(o.due_at as string) < now.getTime(),
  );
  const overdueIds = new Set(overdue.map((o) => o.id));
  const dueToday = scoped.filter(
    (o) => o.due_on === today && !overdueIds.has(o.id),
  );
  const upcoming = scoped.filter(
    (o) =>
      isOpen(o) && String(o.due_on) > today && String(o.due_on) <= twoWeeks,
  );
  const week = weekBounds(today);
  const thisWeek = scoped.filter(
    (o) =>
      String(o.due_on) >= week.start &&
      String(o.due_on) <= week.end &&
      o.status !== "skipped",
  );
  const weekMinutes = thisWeek.reduce((sum, o) => {
    const minutes = templateById.get(
      o.template_id as string,
    )?.estimated_minutes;
    return sum + (typeof minutes === "number" ? minutes : 0);
  }, 0);
  const done = scoped
    .filter(
      (o) =>
        (o.status === "done" || o.status === "skipped") &&
        String(o.due_on) >= thirtyDaysAgo,
    )
    .sort((a, b) =>
      String(b.completed_at ?? b.updated_at).localeCompare(
        String(a.completed_at ?? a.updated_at),
      ),
    );
  const categories = new Map<string, number>();
  for (const o of [...overdue, ...thisWeek.filter(isOpen)]) {
    const name =
      (templateById.get(o.template_id as string)?.category as string) ||
      "Ohne Kategorie";
    categories.set(name, (categories.get(name) ?? 0) + 1);
  }
  const days: { date: string; count: number }[] = [];
  for (let i = 0; i < 7; i += 1) {
    const date = formatDate(addDays(parseDate(week.start)!, i));
    days.push({
      date,
      count: scoped.filter((o) => o.due_on === date && o.status !== "skipped")
        .length,
    });
  }
  return {
    today,
    kpis: {
      overdue: overdue.length,
      dueToday: dueToday.filter(isOpen).length,
      thisWeek: thisWeek.length,
      weekMinutes,
      fulfillment: fulfillment(
        scoped.map((o) => ({
          status: o.status as string,
          due_on: o.due_on as string,
          due_at: o.due_at as string,
          completed_at: (o.completed_at as string) ?? null,
        })),
        today,
        now,
      ),
    },
    overdue: overdue.map(dto),
    dueToday: dueToday.map(dto),
    upcoming: upcoming.map(dto),
    done: done.slice(0, 50).map(dto),
    week: days,
    categories: [...categories.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
    templateCount: templates.filter((t) => t.active).length,
  };
}

function parseTemplate(body: Row) {
  const title = text(body.title, 160);
  if (!title) throw new HttpError(422, "invalid_data", "Der Titel fehlt.");
  const recurrence = normalizeRule(body.recurrence);
  if (!recurrence) {
    throw new HttpError(422, "invalid_data", "Die Wiederholung ist ungültig.");
  }
  const startsOn =
    typeof body.startsOn === "string" && parseDate(body.startsOn)
      ? body.startsOn
      : null;
  if (!startsOn) {
    throw new HttpError(422, "invalid_data", "Das Startdatum ist ungültig.");
  }
  const endsOn =
    body.endsOn === undefined || body.endsOn === null || body.endsOn === ""
      ? null
      : typeof body.endsOn === "string" &&
          parseDate(body.endsOn) &&
          body.endsOn >= startsOn
        ? body.endsOn
        : undefined;
  if (endsOn === undefined) {
    throw new HttpError(422, "invalid_data", "Das Enddatum ist ungültig.");
  }
  const dueTime =
    typeof body.dueTime === "string" &&
    /^([01]\d|2[0-3]):[0-5]\d$/u.test(body.dueTime)
      ? body.dueTime
      : null;
  if (!dueTime) {
    throw new HttpError(
      422,
      "invalid_data",
      "Die Fälligkeitszeit ist ungültig.",
    );
  }
  const priority = typeof body.priority === "string" ? body.priority : "normal";
  if (!PRIORITIES.has(priority)) {
    throw new HttpError(422, "invalid_data", "Die Priorität ist ungültig.");
  }
  if (!Array.isArray(body.checklist) || body.checklist.length > 40) {
    throw new HttpError(422, "invalid_data", "Die Checkliste ist ungültig.");
  }
  return {
    title,
    instructions: optionalText(body.instructions, 4000, "Die Anleitung"),
    category: optionalText(body.category, 60, "Die Kategorie"),
    priority,
    assignee_id: optionalUuid(body.assigneeId),
    team_id: optionalUuid(body.teamId),
    reference_label: optionalText(body.referenceLabel, 200, "Der Bezug"),
    estimated_minutes: integerOrNull(
      body.estimatedMinutes,
      1,
      1440,
      "Die Dauer",
    ),
    recurrence,
    starts_on: startsOn,
    ends_on: endsOn,
    due_time: dueTime,
    lead_days: integerOrNull(body.leadDays, 0, 60, "Die Vorlaufzeit") ?? 0,
    checklist: normalizeTemplateChecklist(body.checklist),
    require_note: body.requireNote === true,
    remind: body.remind !== false,
    escalate_after_days: integerOrNull(
      body.escalateAfterDays,
      1,
      30,
      "Die Eskalation",
    ),
    active: body.active !== false,
  };
}

async function assertMember(admin: Admin, tenantId: string, userId: string) {
  const { data } = await admin
    .from("tenant_memberships")
    .select("user_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  if (!data) {
    throw new HttpError(
      422,
      "invalid_data",
      "Die Person gehört nicht zum Arbeitsbereich.",
    );
  }
}

async function saveTemplate(
  admin: Admin,
  tenantId: string,
  actorId: string,
  body: Row,
) {
  const fields = parseTemplate(body);
  if (fields.assignee_id)
    await assertMember(admin, tenantId, fields.assignee_id);
  if (fields.team_id) {
    const { data } = await admin
      .from("teams")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("id", fields.team_id)
      .maybeSingle();
    if (!data)
      throw new HttpError(422, "invalid_data", "Das Team ist ungültig.");
  }
  const today = swissToday();
  let templateId: string;
  if (body.templateId !== undefined) {
    if (!isUuid(body.templateId)) {
      throw new HttpError(422, "invalid_data", "Die Vorlage ist ungültig.");
    }
    templateId = body.templateId.toLowerCase();
    const { data: existing } = await admin
      .from("service_task_templates")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("id", templateId)
      .maybeSingle();
    if (!existing)
      throw new HttpError(404, "not_found", "Vorlage nicht gefunden.");
    const { error } = await admin
      .from("service_task_templates")
      .update({
        ...fields,
        generated_until: null,
        updated_by: actorId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", templateId)
      .eq("tenant_id", tenantId);
    if (error) throw databaseError();
    // Upcoming, untouched occurrences follow the new rule; anything already
    // started, completed or in the past stays as history.
    await admin
      .from("service_task_occurrences")
      .delete()
      .eq("template_id", templateId)
      .eq("status", "open")
      .is("started_at", null)
      .gte("due_on", today);
    await logEvent(admin, tenantId, "template_updated", actorId, {
      templateId,
    });
  } else {
    const { data, error } = await admin
      .from("service_task_templates")
      .insert({
        ...fields,
        tenant_id: tenantId,
        created_by: actorId,
        updated_by: actorId,
      })
      .select("id")
      .single();
    if (error || !data) throw databaseError();
    templateId = data.id;
    await logEvent(admin, tenantId, "template_created", actorId, {
      templateId,
    });
  }
  const { data: template } = await admin
    .from("service_task_templates")
    .select(TEMPLATE_SELECT)
    .eq("id", templateId)
    .single();
  if (template) await generate(admin, [template], today);
  return templateDto(template, today);
}

async function loadOccurrence(admin: Admin, tenantId: string, id: unknown) {
  if (!isUuid(id))
    throw new HttpError(422, "invalid_data", "Die Aufgabe ist ungültig.");
  const { data } = await admin
    .from("service_task_occurrences")
    .select(OCCURRENCE_SELECT)
    .eq("tenant_id", tenantId)
    .eq("id", id.toLowerCase())
    .maybeSingle();
  if (!data) throw new HttpError(404, "not_found", "Aufgabe nicht gefunden.");
  return data as Row;
}

async function occurrenceDetail(admin: Admin, tenantId: string, id: unknown) {
  const occurrence = await loadOccurrence(admin, tenantId, id);
  const [{ data: template }, { data: history }, { data: events }] =
    await Promise.all([
      admin
        .from("service_task_templates")
        .select(TEMPLATE_SELECT)
        .eq("id", occurrence.template_id)
        .single(),
      admin
        .from("service_task_occurrences")
        .select(OCCURRENCE_SELECT)
        .eq("template_id", occurrence.template_id)
        .lt("due_on", occurrence.due_on)
        .order("due_on", { ascending: false })
        .limit(12),
      admin
        .from("service_task_events")
        .select("id, event, actor_id, details, created_at")
        .eq("occurrence_id", occurrence.id)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);
  const people = await names(admin, [
    ...peopleIdsOf([occurrence, ...(history ?? [])]),
    ...(events ?? []).map((event: Row) => event.actor_id as string),
  ]);
  const now = new Date();
  const today = swissToday(now);
  const rule = template ? ruleOf(template) : null;
  const next = rule
    ? (nextOccurrences(
        rule,
        template.starts_on,
        formatDate(addDays(parseDate(occurrence.scheduled_on as string)!, 1)),
        1,
      )[0] ?? null)
    : null;
  return {
    occurrence: occurrenceDto(occurrence, template ?? undefined, people, now),
    template: template ? templateDto(template, today) : null,
    nextDueOn: next,
    history: (history ?? []).map((row: Row) =>
      occurrenceDto(row, template ?? undefined, people, now),
    ),
    events: (events ?? []).map((event: Row) => ({
      id: event.id,
      event: event.event,
      actor: event.actor_id
        ? (people.get(event.actor_id as string) ?? null)
        : null,
      details: event.details,
      createdAt: event.created_at,
    })),
  };
}

async function updateOccurrence(
  admin: Admin,
  tenantId: string,
  actorId: string,
  rights: Access,
  body: Row,
) {
  const occurrence = await loadOccurrence(admin, tenantId, body.occurrenceId);
  const action = body.action;
  const open = OPEN_STATUSES.includes(occurrence.status as string);
  const nowIso = new Date().toISOString();
  const update: Row = { updated_at: nowIso };
  let event = String(action);
  let details: Row = {};

  if ((action === "reschedule" || action === "assign") && !rights.canManage) {
    throw new HttpError(403, "forbidden", "Dafür fehlt die Berechtigung.");
  }
  if (action !== "reopen" && action !== "assign" && !open) {
    throw new HttpError(
      409,
      "closed",
      "Die Aufgabe ist bereits abgeschlossen.",
    );
  }

  switch (action) {
    case "start":
      update.status = "in_progress";
      update.started_at = occurrence.started_at ?? nowIso;
      break;
    case "toggleCheck": {
      const checklist = (
        Array.isArray(occurrence.checklist) ? occurrence.checklist : []
      ) as ChecklistItem[];
      const item = checklist.find((entry) => entry.id === body.checkId);
      if (!item)
        throw new HttpError(422, "invalid_data", "Punkt nicht gefunden.");
      const done = body.done === true;
      update.checklist = checklist.map((entry) =>
        entry.id === item.id
          ? {
              ...entry,
              done,
              doneAt: done ? nowIso : null,
              doneBy: done ? actorId : null,
            }
          : entry,
      );
      update.status = "in_progress";
      update.started_at = occurrence.started_at ?? nowIso;
      details = { label: item.label, done };
      break;
    }
    case "saveNote":
      update.note = optionalText(body.note, 4000, "Die Notiz");
      event = "note_saved";
      break;
    case "complete": {
      const note =
        optionalText(body.note, 4000, "Die Notiz") ??
        (occurrence.note as string | null);
      const { data: template } = await admin
        .from("service_task_templates")
        .select("require_note")
        .eq("id", occurrence.template_id)
        .single();
      if (template?.require_note && !note) {
        throw new HttpError(
          422,
          "note_required",
          "Bitte eine Notiz zum Ergebnis erfassen.",
        );
      }
      update.status = "done";
      update.note = note;
      update.completed_at = nowIso;
      update.completed_by = actorId;
      event = "completed";
      details = {
        onTime: Date.parse(nowIso) <= Date.parse(occurrence.due_at as string),
      };
      break;
    }
    case "skip": {
      const reason = text(body.reason, 500);
      if (!reason) {
        throw new HttpError(
          422,
          "reason_required",
          "Bitte einen Grund angeben.",
        );
      }
      update.status = "skipped";
      update.skipped_reason = reason;
      update.completed_at = nowIso;
      update.completed_by = actorId;
      event = "skipped";
      details = { reason };
      break;
    }
    case "reopen":
      if (open)
        throw new HttpError(409, "open", "Die Aufgabe ist bereits offen.");
      update.status = "open";
      update.completed_at = null;
      update.completed_by = null;
      update.skipped_reason = null;
      event = "reopened";
      break;
    case "reschedule": {
      const dueOn =
        typeof body.dueOn === "string" && parseDate(body.dueOn)
          ? body.dueOn
          : null;
      if (!dueOn)
        throw new HttpError(422, "invalid_data", "Das Datum ist ungültig.");
      const { data: template } = await admin
        .from("service_task_templates")
        .select("due_time, lead_days")
        .eq("id", occurrence.template_id)
        .single();
      const dueAt = swissDateTimeToUtc(
        dueOn,
        String(template?.due_time ?? "16:00").slice(0, 5),
      );
      if (!dueAt)
        throw new HttpError(422, "invalid_data", "Das Datum ist ungültig.");
      update.due_on = dueOn;
      update.due_at = dueAt.toISOString();
      update.visible_from = formatDate(
        addDays(parseDate(dueOn)!, -Number(template?.lead_days ?? 0)),
      );
      update.reminded_at = null;
      update.escalated_at = null;
      details = { from: occurrence.due_on, to: dueOn };
      break;
    }
    case "assign": {
      const assigneeId = optionalUuid(body.assigneeId);
      if (assigneeId) await assertMember(admin, tenantId, assigneeId);
      update.assignee_id = assigneeId;
      update.reminded_at = null;
      details = { assigneeId };
      break;
    }
    default:
      throw new HttpError(400, "invalid_request", "Unbekannte Aktion.");
  }

  const { error } = await admin
    .from("service_task_occurrences")
    .update(update)
    .eq("id", occurrence.id)
    .eq("tenant_id", tenantId)
    .eq("updated_at", occurrence.updated_at as string);
  if (error) throw databaseError();
  await logEvent(
    admin,
    tenantId,
    event,
    actorId,
    {
      occurrenceId: occurrence.id as string,
      templateId: occurrence.template_id as string,
    },
    details,
  );
  return occurrenceDetail(admin, tenantId, occurrence.id);
}

async function calendar(admin: Admin, tenantId: string, month: unknown) {
  if (typeof month !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/u.test(month)) {
    throw new HttpError(422, "invalid_data", "Der Monat ist ungültig.");
  }
  const first = parseDate(`${month}-01`)!;
  const last = addDays(
    new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 1)),
    -1,
  );
  // Calendar grid: Monday before the 1st to Sunday after the last day.
  const from = formatDate(
    addDays(first, 1 - (((first.getUTCDay() + 6) % 7) + 1)),
  );
  const to = formatDate(addDays(last, 7 - (((last.getUTCDay() + 6) % 7) + 1)));
  const now = new Date();
  const today = swissToday(now);
  const templates = await loadTemplates(admin, tenantId);
  await generate(admin, templates, today);
  const templateById = new Map(templates.map((t) => [t.id as string, t]));
  const { data, error } = await admin
    .from("service_task_occurrences")
    .select(OCCURRENCE_SELECT)
    .eq("tenant_id", tenantId)
    .gte("due_on", from)
    .lte("due_on", to)
    .order("due_at")
    .limit(3000);
  if (error) throw databaseError();
  const stored = (data ?? []) as Row[];
  const people = await names(admin, peopleIdsOf(stored));
  const entries = stored.map((occurrence) => ({
    ...occurrenceDto(
      occurrence,
      templateById.get(occurrence.template_id as string),
      people,
      now,
    ),
    projected: false,
  }));
  // Beyond the stored horizon, show what the rules will produce.
  const storedKeys = new Set(
    stored.map((o) => `${o.template_id}|${o.scheduled_on}`),
  );
  for (const template of templates) {
    if (!template.active) continue;
    const rule = ruleOf(template);
    if (!rule) continue;
    const start = [from, today, template.starts_on as string].sort().at(-1)!;
    const end =
      template.ends_on && template.ends_on < to
        ? (template.ends_on as string)
        : to;
    if (start > end) continue;
    for (const date of occurrencesBetween(
      rule,
      template.starts_on as string,
      start,
      end,
    )) {
      if (storedKeys.has(`${template.id}|${date}`)) continue;
      if (
        template.generated_until &&
        date <= (template.generated_until as string)
      ) {
        continue;
      }
      entries.push({
        ...occurrenceDto(
          {
            id: `${template.id}:${date}`,
            template_id: template.id,
            scheduled_on: date,
            due_on: date,
            due_at:
              swissDateTimeToUtc(
                date,
                String(template.due_time).slice(0, 5),
              )?.toISOString() ?? `${date}T15:00:00.000Z`,
            visible_from: date,
            status: "open",
            assignee_id: template.assignee_id,
            checklist: initialChecklist(template.checklist),
          },
          template,
          people,
          now,
        ),
        projected: true,
      });
    }
  }
  entries.sort((a, b) => String(a.dueAt).localeCompare(String(b.dueAt)));
  return { month, from, to, today, entries };
}

async function notify(
  admin: Admin,
  rows: { tenant_id: string; user_id: string; kind: string; payload: Row }[],
) {
  if (!rows.length) return;
  await admin
    .from("ticket_notifications")
    .insert(rows.map((row) => ({ ...row, ticket_id: null })));
}

/** Periodic run: generation, due-day reminders and overdue escalation. */
async function cron(admin: Admin) {
  const now = new Date();
  const today = swissToday(now);
  const { data: templates } = await admin
    .from("service_task_templates")
    .select(TEMPLATE_SELECT)
    .eq("active", true)
    .limit(5000);
  const byTenant = new Map<string, Row[]>();
  for (const template of (templates ?? []) as Row[]) {
    const list = byTenant.get(template.tenant_id as string) ?? [];
    list.push(template);
    byTenant.set(template.tenant_id as string, list);
  }
  let reminders = 0;
  let escalations = 0;
  for (const [tenantId, list] of byTenant) {
    if (!(await featureEnabled(admin, tenantId))) continue;
    await generate(admin, list, today);
    if (swissHour(now) < 7 || swissHour(now) >= 20) continue;
    const templateById = new Map(list.map((t) => [t.id as string, t]));

    // Reminder on the due day (from 07:00 Swiss time) to the assignee.
    const { data: due } = await admin
      .from("service_task_occurrences")
      .select("id, template_id, assignee_id, due_on, due_at")
      .eq("tenant_id", tenantId)
      .in("status", OPEN_STATUSES)
      .eq("due_on", today)
      .is("reminded_at", null)
      .not("assignee_id", "is", null)
      .limit(500);
    const dueRows = ((due ?? []) as Row[]).filter(
      (o) => templateById.get(o.template_id as string)?.remind !== false,
    );
    await notify(
      admin,
      dueRows.map((o) => ({
        tenant_id: tenantId,
        user_id: o.assignee_id as string,
        kind: "service_task.due",
        payload: {
          occurrenceId: o.id,
          title: templateById.get(o.template_id as string)?.title,
          dueOn: o.due_on,
          dueAt: o.due_at,
        },
      })),
    );
    if (dueRows.length) {
      await admin
        .from("service_task_occurrences")
        .update({ reminded_at: now.toISOString() })
        .in(
          "id",
          dueRows.map((o) => o.id),
        );
      reminders += dueRows.length;
    }

    // Escalation after n days overdue: assignee plus the template's team.
    const { data: late } = await admin
      .from("service_task_occurrences")
      .select("id, template_id, assignee_id, due_on, due_at")
      .eq("tenant_id", tenantId)
      .in("status", OPEN_STATUSES)
      .is("escalated_at", null)
      .lt("due_at", now.toISOString())
      .limit(500);
    for (const occurrence of (late ?? []) as Row[]) {
      const template = templateById.get(occurrence.template_id as string);
      const days = template?.escalate_after_days as number | null | undefined;
      if (!template || !days) continue;
      const threshold =
        Date.parse(occurrence.due_at as string) + days * 24 * 60 * 60 * 1000;
      if (threshold > now.getTime()) continue;
      const recipients = new Set<string>();
      if (occurrence.assignee_id)
        recipients.add(occurrence.assignee_id as string);
      if (template.team_id) {
        const { data: members } = await admin
          .from("team_memberships")
          .select("user_id")
          .eq("tenant_id", tenantId)
          .eq("team_id", template.team_id);
        for (const member of members ?? []) recipients.add(member.user_id);
      }
      await notify(
        admin,
        [...recipients].map((userId) => ({
          tenant_id: tenantId,
          user_id: userId,
          kind: "service_task.overdue",
          payload: {
            occurrenceId: occurrence.id,
            title: template.title,
            dueOn: occurrence.due_on,
            overdueDays: days,
          },
        })),
      );
      await admin
        .from("service_task_occurrences")
        .update({ escalated_at: now.toISOString() })
        .eq("id", occurrence.id);
      await logEvent(
        admin,
        tenantId,
        "escalated",
        null,
        {
          occurrenceId: occurrence.id as string,
          templateId: template.id as string,
        },
        { recipients: recipients.size },
      );
      escalations += 1;
    }
  }
  return { reminders, escalations };
}

const userHandler = withSupabase(
  { auth: "user", errors: { detailed: false } },
  async (request, context) => {
    try {
      if (request.method !== "POST") {
        return json(request, { error: { code: "method_not_allowed" } }, 405);
      }
      const body = await parseJsonObject(request);
      const actorId = context.userClaims?.id;
      if (!body || !isUuid(body.tenantId) || !isUuid(actorId)) {
        return json(request, { error: { code: "invalid_request" } }, 400);
      }
      const tenantId = body.tenantId.toLowerCase();
      const admin = context.supabaseAdmin;
      if (!(await featureEnabled(admin, tenantId))) {
        return json(request, { error: { code: "feature_disabled" } }, 403);
      }
      const rights = await access(admin, actorId, tenantId);
      if (body.type === "access") return json(request, { data: rights });
      if (!rights.canRead) {
        return json(request, { error: { code: "forbidden" } }, 403);
      }
      switch (body.type) {
        case "overview": {
          const scope = ["mine", "team", "all", "done"].includes(
            String(body.scope),
          )
            ? String(body.scope)
            : "mine";
          const [data, dir] = await Promise.all([
            overview(
              admin,
              tenantId,
              actorId,
              scope === "done" ? "all" : scope,
            ),
            directory(admin, tenantId),
          ]);
          return json(request, { data: { ...data, ...dir, access: rights } });
        }
        case "listTemplates": {
          const today = swissToday();
          const [templates, dir] = await Promise.all([
            loadTemplates(admin, tenantId),
            directory(admin, tenantId),
          ]);
          return json(request, {
            data: {
              templates: templates.map((t) => templateDto(t, today)),
              ...dir,
            },
          });
        }
        case "previewRule": {
          const rule = normalizeRule(body.recurrence);
          const start =
            typeof body.startsOn === "string" && parseDate(body.startsOn)
              ? body.startsOn
              : null;
          if (!rule || !start) {
            return json(request, { data: { dates: [], ruleText: null } });
          }
          const from = [swissToday(), start].sort().at(-1)!;
          return json(request, {
            data: {
              dates: nextOccurrences(rule, start, from, 4),
              ruleText: describeRule(rule),
            },
          });
        }
        case "saveTemplate": {
          if (!rights.canManage) {
            return json(request, { error: { code: "forbidden" } }, 403);
          }
          return json(request, {
            data: {
              template: await saveTemplate(admin, tenantId, actorId, body),
            },
          });
        }
        case "setTemplateActive": {
          if (!rights.canManage) {
            return json(request, { error: { code: "forbidden" } }, 403);
          }
          if (!isUuid(body.templateId) || typeof body.active !== "boolean") {
            return json(request, { error: { code: "invalid_request" } }, 400);
          }
          const { error } = await admin
            .from("service_task_templates")
            .update({
              active: body.active,
              generated_until: null,
              updated_by: actorId,
              updated_at: new Date().toISOString(),
            })
            .eq("tenant_id", tenantId)
            .eq("id", body.templateId);
          if (error) throw databaseError();
          if (!body.active) {
            await admin
              .from("service_task_occurrences")
              .delete()
              .eq("template_id", body.templateId)
              .eq("status", "open")
              .is("started_at", null)
              .gte("due_on", swissToday());
          }
          await logEvent(
            admin,
            tenantId,
            body.active ? "template_activated" : "template_archived",
            actorId,
            { templateId: body.templateId as string },
          );
          return json(request, { data: { active: body.active } });
        }
        case "getOccurrence":
          return json(request, {
            data: await occurrenceDetail(admin, tenantId, body.occurrenceId),
          });
        case "updateOccurrence": {
          if (!rights.canExecute) {
            return json(request, { error: { code: "forbidden" } }, 403);
          }
          return json(request, {
            data: await updateOccurrence(
              admin,
              tenantId,
              actorId,
              rights,
              body,
            ),
          });
        }
        case "calendar":
          return json(request, {
            data: await calendar(admin, tenantId, body.month),
          });
        default:
          return json(request, { error: { code: "invalid_request" } }, 400);
      }
    } catch (error) {
      if (error instanceof HttpError) {
        return json(
          request,
          { error: { code: error.code, message: error.message } },
          error.status,
        );
      }
      console.error(
        "service_tasks_failed",
        error instanceof Error ? error.name : "",
      );
      return json(
        request,
        {
          error: {
            code: "service_tasks_failed",
            message: "Die Serviceaufgaben sind gerade nicht erreichbar.",
          },
        },
        500,
      );
    }
  },
);

const cronHandler = withSupabase(
  { auth: "none", cors: "disabled", errors: { detailed: false } },
  async (request, context) => {
    // The shared secret lives only in the database; it is compared there.
    const provided = request.headers.get("x-nextdesk-dispatch-secret") ?? "";
    const { data: valid, error: verifyError } =
      provided.length >= 32 && provided.length <= 200
        ? await context.supabaseAdmin.rpc(
            "service_task_verify_dispatch_secret",
            { p_secret: provided },
          )
        : { data: false, error: null };
    if (verifyError || valid !== true) {
      return new Response(null, { status: 401 });
    }
    try {
      const result = await cron(context.supabaseAdmin);
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error(
        "service_tasks_cron_failed",
        error instanceof Error ? error.name : "",
      );
      return new Response(null, { status: 500 });
    }
  },
);

export default {
  fetch(request: Request): Response | Promise<Response> {
    if (request.method === "OPTIONS") return noContent(request);
    if (request.headers.has("x-nextdesk-dispatch-secret")) {
      return cronHandler(request);
    }
    return userHandler(request);
  },
};
