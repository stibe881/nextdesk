import { withSupabase } from "@supabase/server";
import { isRecord, isUuid, json, noContent } from "../_shared/http.ts";
import {
  listAssignableAgentsForDepartments,
  type TicketAgent,
} from "../_shared/assignable-agents.ts";

/**
 * Team supervision for the role "Vorgesetzter Agent" (permission
 * team.supervise per department): team overview, redistribution, quality
 * reviews and monthly reports. Every action is limited to the departments the
 * caller supervises; data is read with the service role after that check.
 */

// deno-lint-ignore no-explicit-any
type Admin = any;
type Row = Record<string, unknown>;

const MAX_REQUEST_BYTES = 32 * 1024;
const MAX_REASSIGN = 100;
const OPEN_TICKET_LIMIT = 500;

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

type Action =
  | { type: "overview"; tenantId: string }
  | { type: "liveBoard"; tenantId: string }
  | { type: "skills"; tenantId: string }
  | { type: "saveSkill"; tenantId: string; skillId: string | null; name: string }
  | { type: "deleteSkill"; tenantId: string; skillId: string }
  | {
    type: "setSkillLevel";
    tenantId: string;
    skillId: string;
    agentId: string;
    level: number;
  }
  | {
    type: "reassign";
    tenantId: string;
    ticketIds: string[];
    agentId: string | null;
  }
  | { type: "reviewQueue"; tenantId: string }
  | {
    type: "saveReview";
    tenantId: string;
    ticketId: string;
    rating: number;
    solutionCorrect: boolean;
    toneAppropriate: boolean;
    documentationOk: boolean | null;
    comment: string | null;
  }
  | { type: "monthlyReport"; tenantId: string; month: string }
  | { type: "coachingNotes"; tenantId: string; agentId: string }
  | {
    type: "addCoachingNote";
    tenantId: string;
    agentId: string;
    body: string;
    kind: CoachingKind;
  }
  | { type: "deleteCoachingNote"; tenantId: string; noteId: string };

type CoachingKind = "note" | "praise" | "goal" | "concern";
const COACHING_KINDS: CoachingKind[] = ["note", "praise", "goal", "concern"];

function parseAction(value: unknown): Action | null {
  if (!isRecord(value) || !isUuid(value.tenantId)) return null;
  const tenantId = value.tenantId.toLowerCase();
  switch (value.type) {
    case "overview":
    case "reviewQueue":
    case "liveBoard":
    case "skills":
      return { type: value.type, tenantId };
    case "saveSkill": {
      const name = typeof value.name === "string" ? value.name.trim() : "";
      if (
        !name || name.length > 80 ||
        !(value.skillId === null || value.skillId === undefined ||
          isUuid(value.skillId))
      ) {
        return null;
      }
      return {
        type: "saveSkill",
        tenantId,
        skillId: isUuid(value.skillId) ? value.skillId.toLowerCase() : null,
        name,
      };
    }
    case "deleteSkill":
      return isUuid(value.skillId)
        ? { type: "deleteSkill", tenantId, skillId: value.skillId.toLowerCase() }
        : null;
    case "setSkillLevel": {
      const level = value.level;
      if (
        !isUuid(value.skillId) || !isUuid(value.agentId) ||
        typeof level !== "number" || !Number.isInteger(level) || level < 0 ||
        level > 3
      ) {
        return null;
      }
      return {
        type: "setSkillLevel",
        tenantId,
        skillId: value.skillId.toLowerCase(),
        agentId: value.agentId.toLowerCase(),
        level,
      };
    }
    case "reassign": {
      const ids = value.ticketIds;
      if (
        !Array.isArray(ids) || ids.length === 0 || ids.length > MAX_REASSIGN ||
        !ids.every(isUuid) ||
        !(value.agentId === null || isUuid(value.agentId))
      ) {
        return null;
      }
      return {
        type: "reassign",
        tenantId,
        ticketIds: [...new Set(ids.map((id) => (id as string).toLowerCase()))],
        agentId: value.agentId === null
          ? null
          : (value.agentId as string).toLowerCase(),
      };
    }
    case "saveReview": {
      const rating = value.rating;
      const comment = value.comment;
      if (
        !isUuid(value.ticketId) ||
        typeof rating !== "number" || !Number.isInteger(rating) ||
        rating < 1 || rating > 5 ||
        typeof value.solutionCorrect !== "boolean" ||
        typeof value.toneAppropriate !== "boolean" ||
        !(value.documentationOk === undefined || value.documentationOk === null ||
          typeof value.documentationOk === "boolean") ||
        !(comment === null || comment === undefined ||
          (typeof comment === "string" && comment.length <= 2000))
      ) {
        return null;
      }
      return {
        type: "saveReview",
        tenantId,
        ticketId: value.ticketId.toLowerCase(),
        rating,
        solutionCorrect: value.solutionCorrect,
        toneAppropriate: value.toneAppropriate,
        documentationOk: typeof value.documentationOk === "boolean"
          ? value.documentationOk
          : null,
        comment: typeof comment === "string" && comment.trim()
          ? comment.trim()
          : null,
      };
    }
    case "monthlyReport":
      if (
        typeof value.month !== "string" ||
        !/^\d{4}-(0[1-9]|1[0-2])$/.test(value.month)
      ) {
        return null;
      }
      return { type: "monthlyReport", tenantId, month: value.month };
    case "coachingNotes":
      return isUuid(value.agentId)
        ? {
          type: "coachingNotes",
          tenantId,
          agentId: value.agentId.toLowerCase(),
        }
        : null;
    case "addCoachingNote": {
      const body = typeof value.body === "string" ? value.body.trim() : "";
      const kind = COACHING_KINDS.includes(value.kind as CoachingKind)
        ? (value.kind as CoachingKind)
        : "note";
      return isUuid(value.agentId) && body.length >= 1 && body.length <= 4000
        ? {
          type: "addCoachingNote",
          tenantId,
          agentId: value.agentId.toLowerCase(),
          body,
          kind,
        }
        : null;
    }
    case "deleteCoachingNote":
      return isUuid(value.noteId)
        ? {
          type: "deleteCoachingNote",
          tenantId,
          noteId: value.noteId.toLowerCase(),
        }
        : null;
    default:
      return null;
  }
}

async function readBody(request: Request): Promise<unknown> {
  const text = await request.text().catch(() => null);
  if (
    text === null || new TextEncoder().encode(text).length > MAX_REQUEST_BYTES
  ) {
    throw new HttpError(413, "payload_too_large", "Die Anfrage ist zu gross.");
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const dbFailure = () =>
  new HttpError(503, "database_failure", "Die Teamdaten sind gerade nicht verfügbar.");

type Scope = {
  departments: { id: string; name: string }[];
  departmentIds: string[];
  agents: TicketAgent[];
  agentDepartments: Map<string, string[]>;
};

/** Supervised departments and the agents working in them. */
async function loadScope(
  admin: Admin,
  tenantId: string,
  actorId: string,
): Promise<Scope> {
  const supervised = await admin.rpc("supervised_department_ids", {
    p_tenant_id: tenantId,
    p_user_id: actorId,
  });
  if (supervised.error) throw dbFailure();
  const departmentIds = Array.isArray(supervised.data)
    ? (supervised.data as unknown[]).filter(isUuid)
    : [];
  if (departmentIds.length === 0) {
    throw new HttpError(
      403,
      "supervision_required",
      "Diese Ansicht steht nur Vorgesetzten Agent:innen zur Verfügung.",
    );
  }
  const [departments, assignable] = await Promise.all([
    admin
      .from("departments")
      .select("id, name")
      .eq("tenant_id", tenantId)
      .in("id", departmentIds)
      .order("name"),
    listAssignableAgentsForDepartments(admin, tenantId, departmentIds),
  ]);
  if (departments.error || assignable.error) throw dbFailure();
  const agentsById = new Map<string, TicketAgent>();
  const agentDepartments = new Map<string, string[]>();
  for (const [departmentId, agents] of assignable.agentsByDepartmentId) {
    for (const agent of agents) {
      agentsById.set(agent.id, agent);
      agentDepartments.set(agent.id, [
        ...(agentDepartments.get(agent.id) ?? []),
        departmentId,
      ]);
    }
  }
  return {
    departments: ((departments.data ?? []) as Row[]).map((row) => ({
      id: row.id as string,
      name: row.name as string,
    })),
    departmentIds,
    agents: [...agentsById.values()].sort((a, b) =>
      a.displayName.localeCompare(b.displayName, "de-CH")
    ),
    agentDepartments,
  };
}

const minutesBetween = (from: unknown, to: unknown) => {
  const start = typeof from === "string" ? Date.parse(from) : NaN;
  const end = typeof to === "string" ? Date.parse(to) : NaN;
  return Number.isFinite(start) && Number.isFinite(end) && end >= start
    ? (end - start) / 60_000
    : null;
};
const average = (values: number[]) =>
  values.length
    ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
    : null;

async function overview(request: Request, admin: Admin, action: Action, actorId: string) {
  const scope = await loadScope(admin, action.tenantId, actorId);
  const now = Date.now();
  const [tickets, resolved] = await Promise.all([
    admin
      .from("tickets")
      .select(
        "id, ticket_number, subject, department_id, assigned_agent_id, created_at, first_responded_at, resolution_due_at, status:ticket_statuses!inner(label, is_closed), priority:ticket_priorities(label, sort_order)",
      )
      .eq("tenant_id", action.tenantId)
      .in("department_id", scope.departmentIds)
      .eq("status.is_closed", false)
      .is("merged_into_ticket_id", null)
      .order("created_at", { ascending: true })
      .limit(OPEN_TICKET_LIMIT),
    admin
      .from("tickets")
      .select("assigned_agent_id")
      .eq("tenant_id", action.tenantId)
      .in("department_id", scope.departmentIds)
      .gte("resolved_at", new Date(now - 30 * 86_400_000).toISOString())
      .limit(5000),
  ]);
  if (tickets.error || resolved.error) throw dbFailure();
  const activeDelegations = await admin
    .from("agent_delegations")
    .select("agent_id, delegate_id, ends_at")
    .eq("tenant_id", action.tenantId)
    .is("ended_at", null)
    .lte("starts_at", new Date(now).toISOString())
    .gt("ends_at", new Date(now).toISOString());
  if (activeDelegations.error) throw dbFailure();
  const absence = new Map<string, { delegateId: string; endsAt: string }>();
  for (const row of (activeDelegations.data ?? []) as Row[]) {
    absence.set(row.agent_id as string, {
      delegateId: row.delegate_id as string,
      endsAt: row.ends_at as string,
    });
  }
  const names = new Map(scope.agents.map((agent) => [agent.id, agent.displayName]));
  const resolvedCounts = new Map<string, number>();
  for (const row of (resolved.data ?? []) as Row[]) {
    const id = row.assigned_agent_id as string | null;
    if (id) resolvedCounts.set(id, (resolvedCounts.get(id) ?? 0) + 1);
  }
  const rows = ((tickets.data ?? []) as Row[]).map((row) => {
    const due = typeof row.resolution_due_at === "string"
      ? Date.parse(row.resolution_due_at)
      : NaN;
    const created = Date.parse(row.created_at as string);
    const status = isRecord(row.status) ? row.status : {};
    const priority = isRecord(row.priority) ? row.priority : {};
    return {
      id: row.id,
      ticketNumber: row.ticket_number,
      subject: row.subject,
      departmentId: row.department_id,
      assignedAgentId: row.assigned_agent_id ?? null,
      statusLabel: status.label ?? "",
      priorityLabel: priority.label ?? "",
      priorityWeight: priorityWeight(String(priority.label ?? "")),
      createdAt: row.created_at,
      resolutionDueAt: row.resolution_due_at ?? null,
      overdue: Number.isFinite(due) && due < now,
      atRisk: Number.isFinite(due) && due >= now && due - now <= 4 * 3_600_000,
      noFirstResponse: row.first_responded_at === null &&
        now - created >= 24 * 3_600_000,
    };
  });
  const agents = scope.agents.map((agent) => {
    const own = rows.filter((row) => row.assignedAgentId === agent.id);
    const away = absence.get(agent.id);
    return {
      id: agent.id,
      displayName: agent.displayName,
      departmentIds: scope.agentDepartments.get(agent.id) ?? [],
      openTickets: own.length,
      overdue: own.filter((row) => row.overdue).length,
      atRisk: own.filter((row) => row.atRisk).length,
      noFirstResponse: own.filter((row) => row.noFirstResponse).length,
      resolvedLast30Days: resolvedCounts.get(agent.id) ?? 0,
      loadScore: loadScore(own),
      absence: away
        ? {
          endsAt: away.endsAt,
          delegateId: away.delegateId,
          delegateName: names.get(away.delegateId) ?? null,
        }
        : null,
    };
  });
  return json(request, {
    data: {
      departments: scope.departments,
      agents,
      tickets: rows,
      truncated: rows.length >= OPEN_TICKET_LIMIT,
      warnings: overloadWarnings(agents),
      suggestions: planRebalance(agents, rows),
    },
  });
}

async function reassign(
  request: Request,
  admin: Admin,
  action: Extract<Action, { type: "reassign" }>,
  actorId: string,
) {
  const scope = await loadScope(admin, action.tenantId, actorId);
  const { data, error } = await admin
    .from("tickets")
    .select("id, department_id")
    .eq("tenant_id", action.tenantId)
    .in("id", action.ticketIds);
  if (error) throw dbFailure();
  const tickets = (data ?? []) as Row[];
  if (
    tickets.length !== action.ticketIds.length ||
    tickets.some((ticket) =>
      !scope.departmentIds.includes(ticket.department_id as string)
    )
  ) {
    throw new HttpError(
      403,
      "ticket_outside_supervision",
      "Mindestens ein Ticket gehört nicht zu Ihren Teams.",
    );
  }
  if (action.agentId) {
    const departments = scope.agentDepartments.get(action.agentId) ?? [];
    if (
      tickets.some((ticket) => !departments.includes(ticket.department_id as string))
    ) {
      throw new HttpError(
        422,
        "agent_not_assignable",
        "Die gewählte Person kann nicht allen Tickets zugewiesen werden.",
      );
    }
  }
  const { error: updateError } = await admin
    .from("tickets")
    .update({ assigned_agent_id: action.agentId })
    .eq("tenant_id", action.tenantId)
    .in("id", action.ticketIds)
    // Lets notification triggers recognise the acting supervisor.
    .setHeader("x-nextdesk-actor-id", actorId);
  if (updateError) throw dbFailure();
  await admin.from("audit_logs").insert({
    tenant_id: action.tenantId,
    actor_id: actorId,
    action: "team.tickets.reassigned",
    entity_type: "ticket",
    entity_id: action.ticketIds[0],
    metadata: { ticketCount: action.ticketIds.length, agentId: action.agentId },
  });
  return json(request, { data: { reassigned: action.ticketIds.length } });
}

async function reviewQueue(request: Request, admin: Admin, action: Action, actorId: string) {
  const scope = await loadScope(admin, action.tenantId, actorId);
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const [tickets, reviewed] = await Promise.all([
    admin
      .from("tickets")
      .select("id, ticket_number, subject, description, assigned_agent_id, resolved_at")
      .eq("tenant_id", action.tenantId)
      .in("department_id", scope.departmentIds)
      .not("assigned_agent_id", "is", null)
      .gte("resolved_at", since)
      .order("resolved_at", { ascending: false })
      .limit(300),
    admin
      .from("ticket_supervisor_reviews")
      .select("ticket_id")
      .eq("tenant_id", action.tenantId)
      .gte("created_at", new Date(Date.now() - 60 * 86_400_000).toISOString()),
  ]);
  if (tickets.error || reviewed.error) throw dbFailure();
  const done = new Set(((reviewed.data ?? []) as Row[]).map((row) => row.ticket_id));
  const names = new Map(scope.agents.map((agent) => [agent.id, agent.displayName]));
  const candidates = ((tickets.data ?? []) as Row[]).filter((row) =>
    !done.has(row.id)
  );
  // Random sample of up to five tickets.
  for (let index = candidates.length - 1; index > 0; index--) {
    const swap = Math.floor(Math.random() * (index + 1));
    [candidates[index], candidates[swap]] = [candidates[swap], candidates[index]];
  }
  const sample = candidates.slice(0, 5);
  const replies = sample.length
    ? await admin
      .from("ticket_comments")
      .select("ticket_id, body, created_at")
      .in("ticket_id", sample.map((row) => row.id))
      .eq("visibility", "external")
      .order("created_at", { ascending: false })
      .limit(200)
    : { data: [], error: null };
  if (replies.error) throw dbFailure();
  const lastReply = new Map<string, string>();
  for (const reply of (replies.data ?? []) as Row[]) {
    if (!lastReply.has(reply.ticket_id as string)) {
      lastReply.set(reply.ticket_id as string, String(reply.body ?? "").slice(0, 600));
    }
  }
  return json(request, {
    data: {
      tickets: sample.map((row) => ({
        id: row.id,
        ticketNumber: row.ticket_number,
        subject: row.subject,
        description: String(row.description ?? "").slice(0, 600),
        lastReply: lastReply.get(row.id as string) ?? null,
        agentId: row.assigned_agent_id,
        agentName: names.get(row.assigned_agent_id as string) ?? null,
        resolvedAt: row.resolved_at,
      })),
    },
  });
}

async function saveReview(
  request: Request,
  admin: Admin,
  action: Extract<Action, { type: "saveReview" }>,
  actorId: string,
) {
  const scope = await loadScope(admin, action.tenantId, actorId);
  const { data: ticket, error } = await admin
    .from("tickets")
    .select("id, department_id, assigned_agent_id")
    .eq("tenant_id", action.tenantId)
    .eq("id", action.ticketId)
    .maybeSingle();
  if (error) throw dbFailure();
  if (!ticket || !scope.departmentIds.includes(ticket.department_id)) {
    throw new HttpError(
      403,
      "ticket_outside_supervision",
      "Das Ticket gehört nicht zu Ihren Teams.",
    );
  }
  const { error: saveError } = await admin
    .from("ticket_supervisor_reviews")
    .upsert(
      {
        tenant_id: action.tenantId,
        ticket_id: action.ticketId,
        agent_id: ticket.assigned_agent_id,
        reviewer_id: actorId,
        rating: action.rating,
        solution_correct: action.solutionCorrect,
        tone_appropriate: action.toneAppropriate,
        documentation_ok: action.documentationOk,
        comment: action.comment,
        created_at: new Date().toISOString(),
      },
      { onConflict: "ticket_id" },
    );
  if (saveError) throw dbFailure();
  return json(request, { data: { saved: true } }, 201);
}

async function monthlyReport(
  request: Request,
  admin: Admin,
  action: Extract<Action, { type: "monthlyReport" }>,
  actorId: string,
) {
  const scope = await loadScope(admin, action.tenantId, actorId);
  const [year, month] = action.month.split("-").map(Number);
  const from = new Date(Date.UTC(year, month - 1, 1)).toISOString();
  const to = new Date(Date.UTC(year, month, 1)).toISOString();
  const agentIds = scope.agents.map((agent) => agent.id);
  if (agentIds.length === 0) {
    return json(request, { data: { month: action.month, agents: [] } });
  }
  const previousFrom = new Date(Date.UTC(year, month - 2, 1)).toISOString();
  const [current, previous] = await Promise.all([
    monthStats(admin, action.tenantId, scope, agentIds, from, to),
    monthStats(admin, action.tenantId, scope, agentIds, previousFrom, from),
  ]);
  const previousById = new Map(previous.map((agent) => [agent.id, agent]));
  return json(request, {
    data: {
      month: action.month,
      departments: scope.departments,
      agents: current.map((agent) => {
        const before = previousById.get(agent.id);
        return {
          ...agent,
          previous: before
            ? {
              ticketsResolved: before.ticketsResolved,
              averageResolutionMinutes: before.averageResolutionMinutes,
              averageFirstResponseMinutes: before.averageFirstResponseMinutes,
              slaCompliancePercent: before.slaCompliancePercent,
              satisfactionAverage: before.satisfactionAverage,
              qualityAverage: before.qualityAverage,
            }
            : null,
        };
      }),
    },
  });
}

async function requireSupervisedAgent(
  admin: Admin,
  tenantId: string,
  actorId: string,
  agentId: string,
) {
  const scope = await loadScope(admin, tenantId, actorId);
  if (!scope.agents.some((agent) => agent.id === agentId)) {
    throw new HttpError(
      403,
      "agent_not_supervised",
      "Diese Person gehört nicht zu Ihrem Team.",
    );
  }
}

async function coachingNotes(
  request: Request,
  admin: Admin,
  action: Extract<Action, { type: "coachingNotes" }>,
  actorId: string,
) {
  await requireSupervisedAgent(admin, action.tenantId, actorId, action.agentId);
  const [notes, reviews] = await Promise.all([
    admin
      .from("supervisor_coaching_notes")
      .select("id, body, kind, created_at")
      .eq("tenant_id", action.tenantId)
      .eq("author_id", actorId)
      .eq("agent_id", action.agentId)
      .order("created_at", { ascending: false })
      .limit(200),
    admin
      .from("ticket_supervisor_reviews")
      .select(
        "id, rating, solution_correct, tone_appropriate, documentation_ok, comment, created_at, ticket_id, tickets(ticket_number, subject)",
      )
      .eq("tenant_id", action.tenantId)
      .eq("agent_id", action.agentId)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);
  if (notes.error || reviews.error) throw dbFailure();
  return json(request, {
    data: {
      notes: ((notes.data ?? []) as Row[]).map((row) => ({
        id: row.id,
        body: row.body,
        kind: row.kind,
        createdAt: row.created_at,
      })),
      reviews: ((reviews.data ?? []) as Row[]).map((row) => {
        const ticket = (Array.isArray(row.tickets) ? row.tickets[0] : row.tickets) as
          | Row
          | null;
        return {
          id: row.id,
          rating: row.rating,
          solutionCorrect: row.solution_correct,
          toneAppropriate: row.tone_appropriate,
          documentationOk: row.documentation_ok ?? null,
          comment: row.comment ?? null,
          createdAt: row.created_at,
          ticketId: row.ticket_id,
          ticketNumber: ticket?.ticket_number ?? null,
          subject: ticket?.subject ?? null,
        };
      }),
    },
  });
}

async function addCoachingNote(
  request: Request,
  admin: Admin,
  action: Extract<Action, { type: "addCoachingNote" }>,
  actorId: string,
) {
  await requireSupervisedAgent(admin, action.tenantId, actorId, action.agentId);
  const { data, error } = await admin
    .from("supervisor_coaching_notes")
    .insert({
      tenant_id: action.tenantId,
      agent_id: action.agentId,
      author_id: actorId,
      body: action.body,
      kind: action.kind,
    })
    .select("id")
    .single();
  if (error || !data) throw dbFailure();
  return json(request, { data: { id: data.id } }, 201);
}

async function deleteCoachingNote(
  request: Request,
  admin: Admin,
  action: Extract<Action, { type: "deleteCoachingNote" }>,
  actorId: string,
) {
  const { error } = await admin
    .from("supervisor_coaching_notes")
    .delete()
    .eq("tenant_id", action.tenantId)
    .eq("author_id", actorId)
    .eq("id", action.noteId);
  if (error) throw dbFailure();
  return json(request, { data: { deleted: true } });
}

async function monthStats(
  admin: Admin,
  tenantId: string,
  scope: Awaited<ReturnType<typeof loadScope>>,
  agentIds: string[],
  from: string,
  to: string,
) {
  const action = { tenantId };
  const [created, resolved, reviews, articles, replies] = await Promise.all([
    admin
      .from("tickets")
      .select("id, assigned_agent_id, created_at, first_responded_at")
      .eq("tenant_id", action.tenantId)
      .in("department_id", scope.departmentIds)
      .in("assigned_agent_id", agentIds)
      .gte("created_at", from)
      .lt("created_at", to)
      .limit(10000),
    admin
      .from("tickets")
      .select("id, assigned_agent_id, created_at, resolved_at, resolution_due_at")
      .eq("tenant_id", action.tenantId)
      .in("department_id", scope.departmentIds)
      .in("assigned_agent_id", agentIds)
      .gte("resolved_at", from)
      .lt("resolved_at", to)
      .limit(10000),
    admin
      .from("ticket_supervisor_reviews")
      .select("agent_id, rating, solution_correct, tone_appropriate")
      .eq("tenant_id", action.tenantId)
      .in("agent_id", agentIds)
      .gte("created_at", from)
      .lt("created_at", to),
    admin
      .from("knowledge_articles")
      .select("created_by")
      .eq("tenant_id", action.tenantId)
      .in("created_by", agentIds)
      .gte("created_at", from)
      .lt("created_at", to),
    admin
      .from("ticket_comments")
      .select("author_id, tickets!inner(tenant_id)")
      .eq("tickets.tenant_id", action.tenantId)
      .in("author_id", agentIds)
      .eq("visibility", "external")
      .gte("created_at", from)
      .lt("created_at", to)
      .limit(20000),
  ]);
  if (
    created.error || resolved.error || reviews.error || articles.error ||
    replies.error
  ) {
    throw dbFailure();
  }
  const resolvedRows = (resolved.data ?? []) as Row[];
  const satisfaction = resolvedRows.length
    ? await admin
      .from("ticket_satisfaction")
      .select("ticket_id, score")
      .in("ticket_id", resolvedRows.map((row) => row.id))
    : { data: [], error: null };
  if (satisfaction.error) throw dbFailure();
  const scoreByTicket = new Map(
    ((satisfaction.data ?? []) as Row[]).map((row) => [row.ticket_id, Number(row.score)]),
  );
  const agents = scope.agents.map((agent) => {
    const mineCreated = ((created.data ?? []) as Row[]).filter((row) =>
      row.assigned_agent_id === agent.id
    );
    const mineResolved = resolvedRows.filter((row) => row.assigned_agent_id === agent.id);
    const mineReviews = ((reviews.data ?? []) as Row[]).filter((row) =>
      row.agent_id === agent.id
    );
    const firstResponse = mineCreated
      .map((row) => minutesBetween(row.created_at, row.first_responded_at))
      .filter((value): value is number => value !== null);
    const resolution = mineResolved
      .map((row) => minutesBetween(row.created_at, row.resolved_at))
      .filter((value): value is number => value !== null);
    const withDue = mineResolved.filter((row) => typeof row.resolution_due_at === "string");
    const slaMet = withDue.filter((row) =>
      Date.parse(row.resolved_at as string) <= Date.parse(row.resolution_due_at as string)
    ).length;
    const scores = mineResolved
      .map((row) => scoreByTicket.get(row.id))
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    return {
      id: agent.id,
      displayName: agent.displayName,
      ticketsAssigned: mineCreated.length,
      ticketsResolved: mineResolved.length,
      averageFirstResponseMinutes: average(firstResponse),
      averageResolutionMinutes: average(resolution),
      slaCompliancePercent: withDue.length
        ? Math.round((slaMet / withDue.length) * 100)
        : null,
      satisfactionAverage: scores.length
        ? Math.round((scores.reduce((sum, value) => sum + value, 0) / scores.length) * 10) / 10
        : null,
      satisfactionResponses: scores.length,
      qualityAverage: mineReviews.length
        ? Math.round(
          (mineReviews.reduce((sum, row) => sum + Number(row.rating), 0) /
            mineReviews.length) * 10,
        ) / 10
        : null,
      qualityReviews: mineReviews.length,
      externalReplies: ((replies.data ?? []) as Row[]).filter((row) =>
        row.author_id === agent.id
      ).length,
      knowledgeArticles: ((articles.data ?? []) as Row[]).filter((row) =>
        row.created_by === agent.id
      ).length,
    };
  });
  return agents;
}

/** Weight of a priority by its label (critical 4 … low 1, unknown 2). */
function priorityWeight(label: string): number {
  const value = label.toLowerCase();
  if (/(kritisch|critical|sehr hoch|urgent|dringend)/.test(value)) return 4;
  if (/(hoch|high)/.test(value)) return 3;
  if (/(niedrig|tief|low|gering)/.test(value)) return 1;
  return 2;
}

type LoadTicket = {
  id: unknown;
  departmentId: unknown;
  assignedAgentId: unknown;
  priorityWeight: number;
  overdue: boolean;
  atRisk: boolean;
  createdAt: unknown;
};

/** Open tickets weighted by priority, plus extra weight for SLA risk. */
function loadScore(tickets: LoadTicket[]): number {
  return tickets.reduce(
    (sum, ticket) =>
      sum + ticket.priorityWeight + (ticket.overdue ? 3 : ticket.atRisk ? 2 : 0),
    0,
  );
}

type LoadAgent = {
  id: string;
  displayName: string;
  departmentIds: string[];
  openTickets: number;
  overdue: number;
  loadScore: number;
  absence: unknown;
};

/** Agents clearly above the team average or with several overdue tickets. */
function overloadWarnings(agents: LoadAgent[]) {
  const present = agents.filter((agent) => !agent.absence);
  const holding = present.filter((agent) => agent.openTickets > 0);
  const averageOpen = holding.length
    ? holding.reduce((sum, agent) => sum + agent.openTickets, 0) / holding.length
    : 0;
  return present
    .filter((agent) =>
      (agent.openTickets >= 6 && agent.openTickets >= averageOpen * 1.5) ||
      agent.openTickets >= 12 ||
      agent.overdue >= 3
    )
    .map((agent) => ({
      agentId: agent.id,
      agentName: agent.displayName,
      openTickets: agent.openTickets,
      overdue: agent.overdue,
      averageOpen: Math.round(averageOpen * 10) / 10,
      reason: agent.overdue >= 3 ? "overdue" : "load",
    }));
}

/**
 * Suggests moves from clearly overloaded agents to the least loaded colleague
 * of the same department (absent agents only give tickets away). The newest
 * tickets move first because little work has gone into them yet.
 */
function planRebalance(agents: LoadAgent[], tickets: LoadTicket[], limit = 20) {
  const load = new Map(agents.map((agent) => [agent.id, agent.loadScore]));
  const present = agents.filter((agent) => !agent.absence);
  const average = present.length
    ? present.reduce((sum, agent) => sum + agent.loadScore, 0) / present.length
    : 0;
  const moves: {
    ticketId: string;
    fromAgentId: string;
    toAgentId: string;
    toAgentName: string;
  }[] = [];
  const donors = [...agents]
    .filter((agent) =>
      agent.absence ? agent.openTickets > 0 : agent.loadScore > average * 1.3 &&
        agent.openTickets >= 3
    )
    .sort((a, b) => b.loadScore - a.loadScore);
  for (const donor of donors) {
    const own = tickets
      .filter((ticket) => ticket.assignedAgentId === donor.id)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    for (const ticket of own) {
      if (moves.length >= limit) return moves;
      if (!donor.absence && (load.get(donor.id) ?? 0) <= average) break;
      const weight = ticket.priorityWeight +
        (ticket.overdue ? 3 : ticket.atRisk ? 2 : 0);
      const receiver = present
        .filter((agent) =>
          agent.id !== donor.id &&
          agent.departmentIds.includes(String(ticket.departmentId)) &&
          // Tickets of absent agents always move; otherwise the receiver must
          // stay at or below the average.
          (Boolean(donor.absence) ||
            (load.get(agent.id) ?? 0) + weight <= Math.max(average, weight))
        )
        .sort((a, b) => (load.get(a.id) ?? 0) - (load.get(b.id) ?? 0))[0];
      if (!receiver) continue;
      moves.push({
        ticketId: String(ticket.id),
        fromAgentId: donor.id,
        toAgentId: receiver.id,
        toAgentName: receiver.displayName,
      });
      load.set(donor.id, (load.get(donor.id) ?? 0) - weight);
      load.set(receiver.id, (load.get(receiver.id) ?? 0) + weight);
    }
  }
  return moves;
}

/** Live board: who works on what right now and where tickets pile up. */
async function liveBoard(request: Request, admin: Admin, action: Action, actorId: string) {
  const scope = await loadScope(admin, action.tenantId, actorId);
  const now = Date.now();
  const agentIds = scope.agents.map((agent) => agent.id);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" })
    .format(new Date(now));
  const dayStart = new Date(`${today}T00:00:00Z`).getTime() - 2 * 3_600_000;
  const [tickets, presence, checkins, delegations, resolvedToday] = await Promise.all([
    admin
      .from("tickets")
      .select(
        "id, ticket_number, subject, department_id, assigned_agent_id, created_at, resolution_due_at, status:ticket_statuses!inner(is_closed)",
      )
      .eq("tenant_id", action.tenantId)
      .in("department_id", scope.departmentIds)
      .eq("status.is_closed", false)
      .is("merged_into_ticket_id", null)
      .limit(OPEN_TICKET_LIMIT),
    agentIds.length
      ? admin
        .from("ticket_presence_sessions")
        .select("ticket_id, user_id, is_editing, last_seen_at")
        .eq("tenant_id", action.tenantId)
        .in("user_id", agentIds)
        .gte("last_seen_at", new Date(now - 3 * 60_000).toISOString())
        .order("last_seen_at", { ascending: false })
      : { data: [], error: null },
    agentIds.length
      ? admin
        .from("push_work_checkins")
        .select("user_id, checked_in_at, checked_out_at")
        .eq("tenant_id", action.tenantId)
        .eq("work_date", today)
        .in("user_id", agentIds)
      : { data: [], error: null },
    admin
      .from("agent_delegations")
      .select("agent_id, ends_at")
      .eq("tenant_id", action.tenantId)
      .is("ended_at", null)
      .lte("starts_at", new Date(now).toISOString())
      .gt("ends_at", new Date(now).toISOString()),
    agentIds.length
      ? admin
        .from("tickets")
        .select("assigned_agent_id")
        .eq("tenant_id", action.tenantId)
        .in("assigned_agent_id", agentIds)
        .gte("resolved_at", new Date(dayStart).toISOString())
        .limit(5000)
      : { data: [], error: null },
  ]);
  if (
    tickets.error || presence.error || checkins.error || delegations.error ||
    resolvedToday.error
  ) {
    throw dbFailure();
  }
  const openRows = (tickets.data ?? []) as Row[];
  const ticketById = new Map(openRows.map((row) => [row.id, row]));
  const presenceIds = [
    ...new Set(((presence.data ?? []) as Row[]).map((row) => row.ticket_id)),
  ].filter((id) => !ticketById.has(id));
  const extra = presenceIds.length
    ? await admin
      .from("tickets")
      .select("id, ticket_number, subject")
      .eq("tenant_id", action.tenantId)
      .in("id", presenceIds)
    : { data: [], error: null };
  if (extra.error) throw dbFailure();
  for (const row of (extra.data ?? []) as Row[]) ticketById.set(row.id, row);
  const current = new Map<string, Row>();
  for (const row of (presence.data ?? []) as Row[]) {
    if (!current.has(row.user_id as string)) current.set(row.user_id as string, row);
  }
  const checkedIn = new Map(
    ((checkins.data ?? []) as Row[]).map((row) => [row.user_id as string, row]),
  );
  const away = new Map(
    ((delegations.data ?? []) as Row[]).map((row) => [row.agent_id as string, row.ends_at]),
  );
  const resolvedCount = new Map<string, number>();
  for (const row of (resolvedToday.data ?? []) as Row[]) {
    const id = row.assigned_agent_id as string;
    resolvedCount.set(id, (resolvedCount.get(id) ?? 0) + 1);
  }
  const isOverdue = (row: Row) =>
    typeof row.resolution_due_at === "string" && Date.parse(row.resolution_due_at) < now;
  const isAtRisk = (row: Row) => {
    const due = typeof row.resolution_due_at === "string"
      ? Date.parse(row.resolution_due_at)
      : NaN;
    return Number.isFinite(due) && due >= now && due - now <= 4 * 3_600_000;
  };
  const agents = scope.agents.map((agent) => {
    const session = current.get(agent.id);
    const ticket = session ? ticketById.get(session.ticket_id) : undefined;
    const checkin = checkedIn.get(agent.id);
    const own = openRows.filter((row) => row.assigned_agent_id === agent.id);
    const state = away.has(agent.id)
      ? "away"
      : session
      ? "working"
      : checkin?.checked_in_at && !checkin.checked_out_at
      ? "available"
      : "offline";
    return {
      id: agent.id,
      displayName: agent.displayName,
      departmentIds: scope.agentDepartments.get(agent.id) ?? [],
      state,
      awayUntil: away.get(agent.id) ?? null,
      currentTicket: ticket
        ? {
          id: ticket.id,
          ticketNumber: ticket.ticket_number,
          subject: ticket.subject,
          editing: session?.is_editing === true,
        }
        : null,
      openTickets: own.length,
      overdue: own.filter(isOverdue).length,
      resolvedToday: resolvedCount.get(agent.id) ?? 0,
    };
  });
  const departments = scope.departments.map((department) => {
    const own = openRows.filter((row) => row.department_id === department.id);
    const unassigned = own.filter((row) => !row.assigned_agent_id);
    const oldest = unassigned
      .map((row) => Date.parse(row.created_at as string))
      .filter(Number.isFinite)
      .sort((a, b) => a - b)[0];
    return {
      id: department.id,
      name: department.name,
      open: own.length,
      unassigned: unassigned.length,
      overdue: own.filter(isOverdue).length,
      atRisk: own.filter(isAtRisk).length,
      oldestUnassignedMinutes: oldest ? Math.round((now - oldest) / 60_000) : null,
      agentsWorking: agents.filter((agent) =>
        agent.departmentIds.includes(department.id) &&
        (agent.state === "working" || agent.state === "available")
      ).length,
    };
  });
  return json(request, {
    data: { generatedAt: new Date(now).toISOString(), departments, agents },
  });
}

async function skills(request: Request, admin: Admin, action: Action, actorId: string) {
  const scope = await loadScope(admin, action.tenantId, actorId);
  const agentIds = scope.agents.map((agent) => agent.id);
  const [catalog, levels] = await Promise.all([
    admin
      .from("team_skills")
      .select("id, name")
      .eq("tenant_id", action.tenantId)
      .order("name"),
    agentIds.length
      ? admin
        .from("agent_skill_levels")
        .select("skill_id, user_id, level")
        .eq("tenant_id", action.tenantId)
        .in("user_id", agentIds)
      : { data: [], error: null },
  ]);
  if (catalog.error || levels.error) throw dbFailure();
  return json(request, {
    data: {
      skills: catalog.data ?? [],
      agents: scope.agents.map((agent) => ({
        id: agent.id,
        displayName: agent.displayName,
      })),
      levels: ((levels.data ?? []) as Row[]).map((row) => ({
        skillId: row.skill_id,
        agentId: row.user_id,
        level: row.level,
      })),
    },
  });
}

async function saveSkill(
  request: Request,
  admin: Admin,
  action: Extract<Action, { type: "saveSkill" }>,
  actorId: string,
) {
  await loadScope(admin, action.tenantId, actorId);
  const query = action.skillId
    ? admin
      .from("team_skills")
      .update({ name: action.name })
      .eq("tenant_id", action.tenantId)
      .eq("id", action.skillId)
      .select("id, name")
      .maybeSingle()
    : admin
      .from("team_skills")
      .insert({ tenant_id: action.tenantId, name: action.name })
      .select("id, name")
      .single();
  const { data, error } = await query;
  if (error?.code === "23505") {
    throw new HttpError(409, "skill_exists", "Diese Fähigkeit gibt es bereits.");
  }
  if (error) throw dbFailure();
  if (!data) throw new HttpError(404, "skill_not_found", "Fähigkeit nicht gefunden.");
  return json(request, { data: { skill: data } }, action.skillId ? 200 : 201);
}

async function deleteSkill(
  request: Request,
  admin: Admin,
  action: Extract<Action, { type: "deleteSkill" }>,
  actorId: string,
) {
  await loadScope(admin, action.tenantId, actorId);
  const { error } = await admin
    .from("team_skills")
    .delete()
    .eq("tenant_id", action.tenantId)
    .eq("id", action.skillId);
  if (error) throw dbFailure();
  return json(request, { data: { deleted: true } });
}

async function setSkillLevel(
  request: Request,
  admin: Admin,
  action: Extract<Action, { type: "setSkillLevel" }>,
  actorId: string,
) {
  await requireSupervisedAgent(admin, action.tenantId, actorId, action.agentId);
  const { data: skill, error: skillError } = await admin
    .from("team_skills")
    .select("id")
    .eq("tenant_id", action.tenantId)
    .eq("id", action.skillId)
    .maybeSingle();
  if (skillError) throw dbFailure();
  if (!skill) throw new HttpError(404, "skill_not_found", "Fähigkeit nicht gefunden.");
  const { error } = action.level === 0
    ? await admin
      .from("agent_skill_levels")
      .delete()
      .eq("skill_id", action.skillId)
      .eq("user_id", action.agentId)
    : await admin.from("agent_skill_levels").upsert(
      {
        tenant_id: action.tenantId,
        skill_id: action.skillId,
        user_id: action.agentId,
        level: action.level,
        updated_at: new Date().toISOString(),
        updated_by: actorId,
      },
      { onConflict: "skill_id,user_id" },
    );
  if (error) throw dbFailure();
  return json(request, { data: { saved: true } });
}

const handler = withSupabase(
  { auth: "user", errors: { detailed: false } },
  async (request, context) => {
    try {
      if (request.method !== "POST") {
        return json(request, { error: { code: "method_not_allowed" } }, 405);
      }
      const actorId = context.userClaims?.id;
      if (!isUuid(actorId)) {
        return json(request, { error: { code: "unauthorized" } }, 401);
      }
      const action = parseAction(await readBody(request));
      if (!action) {
        return json(
          request,
          { error: { code: "invalid_request", message: "Die Anfrage ist ungültig." } },
          422,
        );
      }
      const admin = context.supabaseAdmin;
      const { data: membership, error } = await admin
        .from("tenant_memberships")
        .select("tenant_id")
        .eq("tenant_id", action.tenantId)
        .eq("user_id", actorId)
        .eq("status", "active")
        .maybeSingle();
      if (error) throw dbFailure();
      if (!membership) {
        return json(
          request,
          { error: { code: "tenant_membership_required" } },
          403,
        );
      }
      switch (action.type) {
        case "overview":
          return await overview(request, admin, action, actorId);
        case "liveBoard":
          return await liveBoard(request, admin, action, actorId);
        case "skills":
          return await skills(request, admin, action, actorId);
        case "saveSkill":
          return await saveSkill(request, admin, action, actorId);
        case "deleteSkill":
          return await deleteSkill(request, admin, action, actorId);
        case "setSkillLevel":
          return await setSkillLevel(request, admin, action, actorId);
        case "reassign":
          return await reassign(request, admin, action, actorId);
        case "reviewQueue":
          return await reviewQueue(request, admin, action, actorId);
        case "saveReview":
          return await saveReview(request, admin, action, actorId);
        case "monthlyReport":
          return await monthlyReport(request, admin, action, actorId);
        case "coachingNotes":
          return await coachingNotes(request, admin, action, actorId);
        case "addCoachingNote":
          return await addCoachingNote(request, admin, action, actorId);
        case "deleteCoachingNote":
          return await deleteCoachingNote(request, admin, action, actorId);
      }
    } catch (error) {
      if (error instanceof HttpError) {
        return json(
          request,
          { error: { code: error.code, message: error.message } },
          error.status,
        );
      }
      console.error("team_supervision_failed", error);
      return json(request, { error: { code: "internal_error" } }, 500);
    }
  },
);

export default {
  fetch(request: Request): Response | Promise<Response> {
    if (request.method === "OPTIONS") return noContent(request);
    return handler(request);
  },
};

export { overloadWarnings, parseAction, planRebalance, priorityWeight };
