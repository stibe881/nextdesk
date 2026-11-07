import { withSupabase } from "@supabase/server";
import { isRecord, isUuid, json, noContent } from "../_shared/http.ts";
import { type Action, canEditSnippet, parseAction, type SaveAction, snippetResponse } from "./logic.ts";

/**
 * «Antwort-Bausteine»: personal and shared reply snippets of agents.
 *   - list / listForTicket: the caller's own and the shared active snippets;
 *     listForTicket also returns the placeholder values of a ticket the
 *     caller may read (requester, number, subject, first device, the caller's
 *     name, department). The placeholders are resolved in the composer.
 *   - save / archive: personal snippets by their owner, shared ones with the
 *     permission ticket.template.manage. Snippets are archived, never removed.
 * The table has no client policies; every access runs here after the checks.
 */

// deno-lint-ignore no-explicit-any
type Admin = any;
type Row = Record<string, unknown>;

const MAX_SNIPPETS = 500;
const SNIPPET_COLUMNS = "id, name, shortcut, body, department_id, owner_id";

class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

const databaseFailure = () =>
  new HttpError(503, "database_failure", "Die Antwort-Bausteine sind gerade nicht verfügbar.");

async function departmentNames(admin: Admin, tenantId: string) {
  const { data, error } = await admin
    .from("departments")
    .select("id, name")
    .eq("tenant_id", tenantId)
    .eq("active", true)
    .order("name");
  if (error) throw databaseFailure();
  return ((data ?? []) as Row[]).map((row) => ({ id: String(row.id), name: String(row.name) }));
}

async function loadSnippets(admin: Admin, tenantId: string, actorId: string) {
  const { data, error } = await admin
    .from("reply_snippets")
    .select(SNIPPET_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("active", true)
    .or(`owner_id.is.null,owner_id.eq.${actorId}`)
    .order("name")
    .limit(MAX_SNIPPETS);
  if (error) throw databaseFailure();
  return (data ?? []) as {
    id: string;
    name: string;
    shortcut: string | null;
    body: string;
    department_id: string | null;
    owner_id: string | null;
  }[];
}

/** Placeholder values of a ticket the caller can read (RLS via own client). */
async function ticketContext(
  admin: Admin,
  client: Admin,
  tenantId: string,
  ticketId: string,
  actorId: string,
) {
  const { data: ticket, error } = await client
    .from("tickets")
    .select("id, ticket_number, subject, department_id, requester_contact_id")
    .eq("tenant_id", tenantId)
    .eq("id", ticketId)
    .maybeSingle();
  if (error) throw databaseFailure();
  if (!ticket) throw new HttpError(404, "ticket_not_found", "Das Ticket ist nicht verfügbar.");
  const none = Promise.resolve({ data: null, error: null });
  const [requester, department, asset, agent] = await Promise.all([
    ticket.requester_contact_id
      ? admin.from("ticket_requesters").select("display_name")
        .eq("tenant_id", tenantId).eq("id", ticket.requester_contact_id).maybeSingle()
      : none,
    ticket.department_id
      ? admin.from("departments").select("name")
        .eq("tenant_id", tenantId).eq("id", ticket.department_id).maybeSingle()
      : none,
    admin.from("ticket_assets").select("created_at, assets(name)")
      .eq("tenant_id", tenantId).eq("ticket_id", ticketId)
      .order("created_at", { ascending: true }).limit(1).maybeSingle(),
    admin.from("user_profiles").select("display_name").eq("id", actorId).maybeSingle(),
  ]);
  const assetRow = isRecord(asset.data)
    ? (Array.isArray(asset.data.assets) ? asset.data.assets[0] : asset.data.assets) as Row | null
    : null;
  const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;
  return {
    departmentId: typeof ticket.department_id === "string" ? ticket.department_id : null,
    context: {
      requesterName: text((requester.data as Row | null)?.display_name),
      ticketNumber: text(ticket.ticket_number),
      subject: text(ticket.subject),
      device: text(assetRow?.name),
      agentName: text((agent.data as Row | null)?.display_name),
      departmentName: text((department.data as Row | null)?.name),
    },
  };
}

async function save(
  admin: Admin,
  action: SaveAction,
  actorId: string,
  canManageShared: boolean,
  departments: { id: string }[],
) {
  if (action.shared && !canManageShared) {
    throw new HttpError(
      403,
      "template_manage_required",
      "Gemeinsame Bausteine dürfen nur Personen mit der Berechtigung «Vorlagen verwalten» bearbeiten.",
    );
  }
  if (action.departmentId && !departments.some((department) => department.id === action.departmentId)) {
    throw new HttpError(422, "department_invalid", "Die Abteilung ist nicht verfügbar.");
  }
  const values = {
    name: action.name,
    shortcut: action.shortcut,
    body: action.body,
    department_id: action.departmentId,
    owner_id: action.shared ? null : actorId,
    updated_by: actorId,
  };
  let result;
  if (action.id) {
    const { data: existing, error } = await admin.from("reply_snippets")
      .select("id, owner_id").eq("tenant_id", action.tenantId).eq("id", action.id)
      .eq("active", true).maybeSingle();
    if (error) throw databaseFailure();
    if (!existing || !canEditSnippet(existing, actorId, canManageShared)) {
      throw new HttpError(404, "snippet_not_found", "Der Baustein ist nicht verfügbar.");
    }
    result = await admin.from("reply_snippets").update(values)
      .eq("tenant_id", action.tenantId).eq("id", action.id).select(SNIPPET_COLUMNS).single();
  } else {
    result = await admin.from("reply_snippets")
      .insert({ ...values, tenant_id: action.tenantId, created_by: actorId })
      .select(SNIPPET_COLUMNS).single();
  }
  if (result.error) {
    if (result.error.code === "23505") {
      throw new HttpError(409, "shortcut_taken", "Dieses Kürzel ist bereits vergeben.");
    }
    throw databaseFailure();
  }
  return result.data;
}

async function handle(
  request: Request,
  admin: Admin,
  client: Admin,
  action: Action,
  actorId: string,
) {
  const { data: canManage, error: permissionError } = await client.rpc("has_tenant_permission", {
    p_tenant_id: action.tenantId,
    p_permission_code: "ticket.template.manage",
  });
  if (permissionError) throw databaseFailure();
  const canManageShared = canManage === true;
  const departments = await departmentNames(admin, action.tenantId);
  const names = new Map(departments.map((department) => [department.id, department.name]));

  if (action.type === "save") {
    const row = await save(admin, action, actorId, canManageShared, departments);
    return json(request, { data: { snippet: snippetResponse(row, actorId, canManageShared, names) } });
  }
  if (action.type === "archive") {
    const { data: existing, error } = await admin.from("reply_snippets")
      .select("id, owner_id").eq("tenant_id", action.tenantId).eq("id", action.id)
      .eq("active", true).maybeSingle();
    if (error) throw databaseFailure();
    if (!existing || !canEditSnippet(existing, actorId, canManageShared)) {
      throw new HttpError(404, "snippet_not_found", "Der Baustein ist nicht verfügbar.");
    }
    const { error: updateError } = await admin.from("reply_snippets")
      .update({ active: false, updated_by: actorId })
      .eq("tenant_id", action.tenantId).eq("id", action.id);
    if (updateError) throw databaseFailure();
    return json(request, { data: { archived: true } });
  }
  const ticket = action.type === "listForTicket"
    ? await ticketContext(admin, client, action.tenantId, action.ticketId, actorId)
    : null;
  const snippets = await loadSnippets(admin, action.tenantId, actorId);
  return json(request, {
    data: {
      canManageShared,
      departments,
      snippets: snippets
        .filter((row) =>
          !ticket || !row.department_id || !ticket.departmentId || row.department_id === ticket.departmentId
        )
        .map((row) => snippetResponse(row, actorId, canManageShared, names)),
      ...(ticket ? { context: ticket.context } : {}),
    },
  });
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
      const action = parseAction(await request.json().catch(() => null));
      if (!action) {
        return json(
          request,
          { error: { code: "invalid_request", message: "Die Anfrage ist ungültig." } },
          422,
        );
      }
      const { data: canWork, error } = await context.supabase.rpc("can_work_tickets_in_tenant", {
        p_tenant_id: action.tenantId,
      });
      if (error) throw databaseFailure();
      if (canWork !== true) {
        return json(
          request,
          {
            error: {
              code: "forbidden",
              message: "Antwort-Bausteine stehen nur Mitarbeitenden im Support zur Verfügung.",
            },
          },
          403,
        );
      }
      return await handle(request, context.supabaseAdmin, context.supabase, action, actorId);
    } catch (error) {
      if (error instanceof HttpError) {
        return json(request, { error: { code: error.code, message: error.message } }, error.status);
      }
      console.error("reply_snippets_failed", error);
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
