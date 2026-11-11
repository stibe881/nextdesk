import { withSupabase } from "@supabase/server";
import { isRecord, isUuid, json, noContent } from "../_shared/http.ts";

/**
 * Problem management on top of the cases (table problems):
 *  - candidates: groups of similar open tickets that are not linked to a case
 *    yet (database function ticket_similarity_clusters, the same grouping as
 *    the incident hint in the ticket list),
 *  - createFromTickets: opens a case and links the chosen tickets,
 *  - analysis: structured root cause analysis (5 × why) and impact.
 * Requires asset.manage like the cases themselves. Tickets are read with the
 * caller's client, so only tickets the person may see appear.
 */

// deno-lint-ignore no-explicit-any
type Client = any;
type Row = Record<string, unknown>;

const MAX_REQUEST_BYTES = 32 * 1024;
const WINDOW_DAYS = 30;
const MIN_CLUSTER = 3;

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
  | { type: "candidates"; tenantId: string }
  | {
    type: "createFromTickets";
    tenantId: string;
    title: string;
    description: string;
    ticketIds: string[];
  }
  | { type: "getAnalysis"; tenantId: string; problemId: string }
  | {
    type: "saveAnalysis";
    tenantId: string;
    problemId: string;
    whys: string[];
    impact: string;
  };

function text(value: unknown, max: number): string | null {
  return typeof value === "string" && value.trim().length <= max
    ? value.trim()
    : null;
}

export function parseAction(value: unknown): Action | null {
  if (!isRecord(value) || !isUuid(value.tenantId)) return null;
  const tenantId = value.tenantId.toLowerCase();
  switch (value.type) {
    case "candidates":
      return { type: "candidates", tenantId };
    case "createFromTickets": {
      const title = text(value.title, 240);
      const description = text(value.description ?? "", 4000);
      const ids = value.ticketIds;
      if (
        !title || title.length < 3 || description === null ||
        !Array.isArray(ids) || ids.length < 1 || ids.length > 100 ||
        !ids.every(isUuid)
      ) {
        return null;
      }
      return {
        type: "createFromTickets",
        tenantId,
        title,
        description,
        ticketIds: [...new Set(ids.map((id) => (id as string).toLowerCase()))],
      };
    }
    case "getAnalysis":
      return isUuid(value.problemId)
        ? {
          type: "getAnalysis",
          tenantId,
          problemId: value.problemId.toLowerCase(),
        }
        : null;
    case "saveAnalysis": {
      const whys = value.whys;
      const impact = text(value.impact ?? "", 4000);
      if (
        !isUuid(value.problemId) || impact === null || !Array.isArray(whys) ||
        whys.length > 5 ||
        !whys.every((why) => typeof why === "string" && why.length <= 1000)
      ) {
        return null;
      }
      return {
        type: "saveAnalysis",
        tenantId,
        problemId: value.problemId.toLowerCase(),
        whys: (whys as string[]).map((why) => why.trim()),
        impact,
      };
    }
    default:
      return null;
  }
}

export type CandidateTicket = {
  id: string;
  ticketNumber: string;
  subject: string;
  createdAt: string;
};

export type CandidateGroup = {
  key: string;
  kind: "similar";
  label: string;
  tickets: CandidateTicket[];
};

/** Rows of ticket_similarity_clusters → groups for the case candidates. */
export function groupsFromClusters(rows: unknown): CandidateGroup[] {
  if (!Array.isArray(rows)) return [];
  const groups: CandidateGroup[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object" || !isUuid((row as Row).ticket_id)) {
      continue;
    }
    const cluster = row as Row;
    const tickets = (Array.isArray(cluster.tickets) ? cluster.tickets : [])
      .filter((ticket: unknown): ticket is Row =>
        typeof ticket === "object" && ticket !== null &&
        isUuid((ticket as Row).id)
      )
      .map((ticket: Row) => ({
        id: String(ticket.id),
        ticketNumber: String(ticket.ticket_number ?? ""),
        subject: String(ticket.subject ?? ""),
        createdAt: String(ticket.created_at ?? ""),
      }));
    if (tickets.length < MIN_CLUSTER) continue;
    groups.push({
      key: `similar:${String(cluster.ticket_id)}`,
      kind: "similar",
      label: String(cluster.subject ?? "").trim().slice(0, 120) ||
        tickets[0]!.subject,
      tickets,
    });
  }
  return groups;
}

async function readBody(request: Request): Promise<unknown> {
  const body = await request.text().catch(() => null);
  if (body === null || new TextEncoder().encode(body).length > MAX_REQUEST_BYTES) {
    throw new HttpError(413, "payload_too_large", "Die Anfrage ist zu gross.");
  }
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

async function requireCaseManager(client: Client, tenantId: string) {
  const { data, error } = await client.rpc("has_tenant_permission", {
    p_tenant_id: tenantId,
    p_permission_code: "asset.manage",
  });
  if (error) throw new HttpError(503, "permission_check_failed", "Die Berechtigung konnte nicht geprüft werden.");
  if (data !== true) {
    throw new HttpError(403, "case_manage_required", "Für Fälle fehlt Ihnen die Berechtigung.");
  }
}

async function candidates(request: Request, client: Client, tenantId: string) {
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();
  // Caller's client: only tickets the person may read are seeds or members.
  const { data, error } = await client.rpc("ticket_similarity_clusters", {
    p_tenant_id: tenantId,
    p_since: since,
    p_min_size: MIN_CLUSTER,
    p_limit: 8,
    p_open_unlinked: true,
  });
  if (error) throw new HttpError(500, "tickets_failed", "Die Tickets konnten nicht geladen werden.");
  return json(request, { data: { windowDays: WINDOW_DAYS, groups: groupsFromClusters(data) } });
}

async function createFromTickets(
  request: Request,
  client: Client,
  admin: Client,
  actorId: string,
  action: Extract<Action, { type: "createFromTickets" }>,
) {
  // Only tickets the person can read may be linked.
  const { data: visible, error } = await client
    .from("tickets")
    .select("id, department_id")
    .eq("tenant_id", action.tenantId)
    .in("id", action.ticketIds);
  if (error) throw new HttpError(500, "tickets_failed", "Die Tickets konnten nicht geladen werden.");
  const rows = (visible ?? []) as Row[];
  if (rows.length === 0) {
    throw new HttpError(422, "tickets_not_found", "Keines der Tickets ist verfügbar.");
  }
  const departments = new Set(rows.map((row) => row.department_id));
  const departmentId = departments.size === 1 ? [...departments][0] : null;
  const { data: problem, error: createError } = await admin
    .from("problems")
    .insert({
      tenant_id: action.tenantId,
      title: action.title,
      description: action.description,
      status: "investigating",
      owner_id: actorId,
      created_by: actorId,
      department_id: typeof departmentId === "string" ? departmentId : null,
    })
    .select("id")
    .single();
  if (createError || !problem) {
    throw new HttpError(500, "problem_create_failed", "Der Fall konnte nicht erstellt werden.");
  }
  const { error: linkError } = await admin.from("problem_tickets").insert(
    rows.map((row) => ({
      tenant_id: action.tenantId,
      problem_id: problem.id,
      ticket_id: row.id,
      linked_by: actorId,
    })),
  );
  if (linkError) {
    throw new HttpError(500, "problem_link_failed", "Die Tickets konnten nicht verknüpft werden.");
  }
  await admin.from("audit_logs").insert({
    tenant_id: action.tenantId,
    actor_id: actorId,
    action: "problem.created_from_tickets",
    entity_type: "problem",
    entity_id: problem.id,
    severity: "info",
    metadata: { ticketCount: rows.length },
  });
  return json(request, { data: { problemId: problem.id, linked: rows.length } }, 201);
}

async function getAnalysis(
  request: Request,
  admin: Client,
  action: Extract<Action, { type: "getAnalysis" }>,
) {
  const { data, error } = await admin
    .from("problems")
    .select("analysis, impact")
    .eq("tenant_id", action.tenantId)
    .eq("id", action.problemId)
    .maybeSingle();
  if (error) throw new HttpError(500, "analysis_failed", "Die Analyse konnte nicht geladen werden.");
  if (!data) throw new HttpError(404, "problem_not_found", "Der Fall ist nicht verfügbar.");
  const analysis = isRecord(data.analysis) ? data.analysis : {};
  return json(request, {
    data: {
      whys: Array.isArray(analysis.whys)
        ? (analysis.whys as unknown[]).filter((why) => typeof why === "string")
        : [],
      impact: typeof data.impact === "string" ? data.impact : "",
    },
  });
}

async function saveAnalysis(
  request: Request,
  admin: Client,
  actorId: string,
  action: Extract<Action, { type: "saveAnalysis" }>,
) {
  const whys = action.whys.filter((why, index, all) =>
    why.length > 0 || index < all.length - 1
  );
  const { data, error } = await admin
    .from("problems")
    .update({
      analysis: { whys, updatedBy: actorId, updatedAt: new Date().toISOString() },
      impact: action.impact || null,
    })
    .eq("tenant_id", action.tenantId)
    .eq("id", action.problemId)
    .select("id")
    .maybeSingle();
  if (error) throw new HttpError(500, "analysis_failed", "Die Analyse konnte nicht gespeichert werden.");
  if (!data) throw new HttpError(404, "problem_not_found", "Der Fall ist nicht verfügbar.");
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
      if (!isUuid(actorId)) return json(request, { error: { code: "unauthorized" } }, 401);
      const action = parseAction(await readBody(request));
      if (!action) {
        return json(
          request,
          { error: { code: "invalid_request", message: "Die Anfrage ist ungültig." } },
          422,
        );
      }
      await requireCaseManager(context.supabase, action.tenantId);
      const admin = context.supabaseAdmin;
      switch (action.type) {
        case "candidates":
          return await candidates(request, context.supabase, action.tenantId);
        case "createFromTickets":
          return await createFromTickets(request, context.supabase, admin, actorId, action);
        case "getAnalysis":
          return await getAnalysis(request, admin, action);
        case "saveAnalysis":
          return await saveAnalysis(request, admin, actorId, action);
      }
    } catch (error) {
      if (error instanceof HttpError) {
        return json(
          request,
          { error: { code: error.code, message: error.message } },
          error.status,
        );
      }
      console.error("problem_management_failed", error);
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
