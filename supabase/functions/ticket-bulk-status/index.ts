import { ticketIdsWithOpenSlaBreach } from "../_shared/sla-breach-gate.ts";
import { withSupabase } from "@supabase/server";

const APP_ORIGIN = "https://app.nextdesk.ch";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATUS_KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

type Action =
  | { type: "listStatusOptions"; tenantId: string }
  | {
      type: "applyStatus";
      tenantId: string;
      ticketIds: string[];
      statusKey: string;
      confirmClose: boolean;
    }
  | {
      type: "deleteTickets";
      tenantId: string;
      ticketIds: string[];
      confirmDelete: boolean;
    }
  // Papierkorb: gelöschte Tickets auflisten, ansehen, wiederherstellen.
  | { type: "listDeleted"; tenantId: string }
  | { type: "getDeleted"; tenantId: string; ticketId: string }
  | { type: "restoreTickets"; tenantId: string; ticketIds: string[] };

type AttachmentCleanupJob = {
  cleanupId: string;
  bucket: string;
  path: string;
};

const TICKET_ATTACHMENT_BUCKET = "ticket-attachments";

function headers(request: Request): HeadersInit {
  const origin = request.headers.get("origin");
  return {
    "Access-Control-Allow-Origin": origin === APP_ORIGIN ? APP_ORIGIN : "",
    "Access-Control-Allow-Headers":
      "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json; charset=utf-8",
    Vary: "Origin",
  };
}

function response(
  request: Request,
  body: Record<string, unknown>,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: headers(request),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function parseAction(value: unknown): Action | null {
  if (!isRecord(value) || !isUuid(value.tenantId)) return null;
  if (
    value.type === "listStatusOptions" &&
    hasOnlyKeys(value, ["type", "tenantId"])
  ) {
    return { type: value.type, tenantId: value.tenantId };
  }
  if (
    value.type === "applyStatus" &&
    hasOnlyKeys(value, [
      "type",
      "tenantId",
      "ticketIds",
      "statusKey",
      "confirmClose",
    ]) &&
    Array.isArray(value.ticketIds) &&
    value.ticketIds.length >= 1 &&
    value.ticketIds.length <= 50 &&
    value.ticketIds.every(isUuid) &&
    new Set(value.ticketIds).size === value.ticketIds.length &&
    typeof value.statusKey === "string" &&
    STATUS_KEY_PATTERN.test(value.statusKey) &&
    (typeof value.confirmClose === "undefined" ||
      typeof value.confirmClose === "boolean")
  ) {
    return {
      type: value.type,
      tenantId: value.tenantId,
      ticketIds: value.ticketIds,
      statusKey: value.statusKey,
      confirmClose: value.confirmClose === true,
    };
  }
  if (
    value.type === "deleteTickets" &&
    hasOnlyKeys(value, ["type", "tenantId", "ticketIds", "confirmDelete"]) &&
    Array.isArray(value.ticketIds) &&
    value.ticketIds.length >= 1 &&
    value.ticketIds.length <= 50 &&
    value.ticketIds.every(isUuid) &&
    new Set(value.ticketIds).size === value.ticketIds.length &&
    typeof value.confirmDelete === "boolean"
  ) {
    return {
      type: value.type,
      tenantId: value.tenantId,
      ticketIds: value.ticketIds,
      confirmDelete: value.confirmDelete,
    };
  }
  if (
    value.type === "listDeleted" &&
    hasOnlyKeys(value, ["type", "tenantId"])
  ) {
    return { type: value.type, tenantId: value.tenantId };
  }
  if (
    value.type === "getDeleted" &&
    hasOnlyKeys(value, ["type", "tenantId", "ticketId"]) &&
    isUuid(value.ticketId)
  ) {
    return {
      type: value.type,
      tenantId: value.tenantId,
      ticketId: value.ticketId.toLowerCase(),
    };
  }
  if (
    value.type === "restoreTickets" &&
    hasOnlyKeys(value, ["type", "tenantId", "ticketIds"]) &&
    Array.isArray(value.ticketIds) &&
    value.ticketIds.length >= 1 &&
    value.ticketIds.length <= 50 &&
    value.ticketIds.every(isUuid) &&
    new Set(value.ticketIds).size === value.ticketIds.length
  ) {
    return {
      type: value.type,
      tenantId: value.tenantId,
      ticketIds: value.ticketIds,
    };
  }
  return null;
}

/** Anzeigenamen zu Personen (für den Papierkorb). */
async function displayNames(
  admin: any,
  ids: (string | null | undefined)[],
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => isUuid(id)))];
  const names = new Map<string, string>();
  if (unique.length === 0) return names;
  const { data } = await admin
    .from("user_profiles")
    .select("id, display_name")
    .in("id", unique);
  for (const row of (data ?? []) as any[]) {
    if (typeof row.display_name === "string" && row.display_name.trim()) {
      names.set(String(row.id), row.display_name.trim());
    }
  }
  return names;
}

async function lookupLabels(
  admin: any,
  table: "ticket_statuses" | "ticket_priorities" | "departments",
  tenantId: string,
): Promise<Map<string, string>> {
  const column = table === "departments" ? "name" : "label";
  const { data } = await admin
    .from(table)
    .select(`id, ${column}`)
    .eq("tenant_id", tenantId);
  return new Map(
    ((data ?? []) as any[]).map((row) => [String(row.id), String(row[column])]),
  );
}

async function listDeletedTickets(
  admin: any,
  actorId: string,
  tenantId: string,
) {
  const { data, error } = await admin.rpc("list_deleted_tickets", {
    p_actor_id: actorId,
    p_tenant_id: tenantId,
    p_limit: 200,
  });
  if (error) return { error };
  const rows = (Array.isArray(data) ? data : []) as any[];
  const [names, statuses, priorities, departments] = await Promise.all([
    displayNames(
      admin,
      rows.flatMap((row) => [
        row.requester_id,
        row.assigned_agent_id,
        row.deleted_by,
      ]),
    ),
    lookupLabels(admin, "ticket_statuses", tenantId),
    lookupLabels(admin, "ticket_priorities", tenantId),
    lookupLabels(admin, "departments", tenantId),
  ]);
  return {
    tickets: rows.map((row) => ({
      id: row.id,
      ticketNumber: row.ticket_number,
      subject: row.subject,
      department: departments.get(String(row.department_id)) ?? null,
      status: statuses.get(String(row.status_id)) ?? null,
      priority: priorities.get(String(row.priority_id)) ?? null,
      requesterName: names.get(String(row.requester_id)) ?? null,
      assigneeName: names.get(String(row.assigned_agent_id)) ?? null,
      createdAt: row.created_at,
      deletedAt: row.deleted_at,
      deletedByName: names.get(String(row.deleted_by)) ?? null,
      purgeAt: row.purge_at,
    })),
  };
}

/** Ein gelöschtes Ticket mit Beschreibung und Verlauf (nur lesen). */
async function getDeletedTicket(
  admin: any,
  actorId: string,
  tenantId: string,
  ticketId: string,
) {
  const { data: ticket } = await admin
    .from("tickets")
    .select(
      "id, ticket_number, subject, description, department_id, status_id, priority_id, requester_id, assigned_agent_id, created_at, deleted_at, deleted_by",
    )
    .eq("tenant_id", tenantId)
    .eq("id", ticketId)
    .not("deleted_at", "is", null)
    .maybeSingle();
  if (!ticket) return null;
  const { data: allowed } = await admin.rpc("ticket_trash_allowed", {
    p_actor_id: actorId,
    p_tenant_id: tenantId,
    p_department_id: ticket.department_id,
  });
  if (allowed !== true) return null;
  const [{ data: comments }, { data: attachments }] = await Promise.all([
    admin
      .from("ticket_comments")
      .select("id, author_id, visibility, body, created_at")
      .eq("ticket_id", ticketId)
      .order("created_at")
      .limit(200),
    admin
      .from("ticket_attachments")
      .select("original_filename, comment_id")
      .eq("ticket_id", ticketId)
      .limit(200),
  ]);
  const commentRows = (comments ?? []) as any[];
  const [names, statuses, priorities, departments] = await Promise.all([
    displayNames(admin, [
      ticket.requester_id,
      ticket.assigned_agent_id,
      ticket.deleted_by,
      ...commentRows.map((comment) => comment.author_id),
    ]),
    lookupLabels(admin, "ticket_statuses", tenantId),
    lookupLabels(admin, "ticket_priorities", tenantId),
    lookupLabels(admin, "departments", tenantId),
  ]);
  const purgeAt = new Date(
    Date.parse(ticket.deleted_at) + 90 * 24 * 60 * 60 * 1000,
  ).toISOString();
  return {
    id: ticket.id,
    ticketNumber: ticket.ticket_number,
    subject: ticket.subject,
    description: ticket.description ?? null,
    department: departments.get(String(ticket.department_id)) ?? null,
    status: statuses.get(String(ticket.status_id)) ?? null,
    priority: priorities.get(String(ticket.priority_id)) ?? null,
    requesterName: names.get(String(ticket.requester_id)) ?? null,
    assigneeName: names.get(String(ticket.assigned_agent_id)) ?? null,
    createdAt: ticket.created_at,
    deletedAt: ticket.deleted_at,
    deletedByName: names.get(String(ticket.deleted_by)) ?? null,
    purgeAt,
    comments: commentRows.map((comment) => ({
      id: comment.id,
      authorName: names.get(String(comment.author_id)) ?? null,
      internal: comment.visibility !== "public",
      body: comment.body ?? "",
      createdAt: comment.created_at,
    })),
    attachmentNames: ((attachments ?? []) as any[])
      .map((attachment) => attachment.original_filename)
      .filter((name): name is string => typeof name === "string"),
  };
}

async function isActiveMember(admin: any, userId: string, tenantId: string) {
  const { data, error } = await admin
    .from("tenant_memberships")
    .select("tenant_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  return !error && Boolean(data);
}

export function rpcError(
  request: Request,
  error: any,
  operation: "status" | "delete",
): Response {
  if (error?.hint === "ticket_children_open") {
    return response(request, { error: { code: "ticket_children_open" } }, 409);
  }
  if (error?.message === "Bulk ticket close confirmation required") {
    return response(
      request,
      { error: { code: "bulk_status_close_confirmation_required" } },
      409,
    );
  }
  if (error?.message === "Bulk ticket delete confirmation required") {
    return response(
      request,
      { error: { code: "bulk_ticket_delete_confirmation_required" } },
      409,
    );
  }
  if (error?.message === "Ticket deletion blocked by legal hold") {
    return response(
      request,
      { error: { code: "bulk_ticket_delete_legal_hold" } },
      409,
    );
  }
  const prefix = operation === "delete" ? "bulk_ticket_delete" : "bulk_status";
  if (error?.code === "42501") {
    return response(
      request,
      { error: { code: `${prefix}_permission_denied` } },
      403,
    );
  }
  if (error?.code === "P0002") {
    return response(
      request,
      { error: { code: `${prefix}_target_missing` } },
      404,
    );
  }
  if (error?.code === "22023") {
    return response(request, { error: { code: `${prefix}_invalid` } }, 422);
  }
  if (operation === "delete" && error?.code === "23503") {
    return response(
      request,
      { error: { code: "bulk_ticket_delete_dependency_blocked" } },
      409,
    );
  }
  return response(request, { error: { code: `${prefix}_failed` } }, 500);
}

function parseAttachmentCleanupJobs(
  value: unknown,
  tenantId: string,
): AttachmentCleanupJob[] | null {
  if (!Array.isArray(value)) return null;
  const prefix = `${tenantId}/`;
  const jobs: AttachmentCleanupJob[] = [];
  for (const entry of value) {
    if (
      !isRecord(entry) ||
      !isUuid(entry.cleanup_id) ||
      entry.storage_bucket !== TICKET_ATTACHMENT_BUCKET ||
      typeof entry.storage_object_path !== "string" ||
      entry.storage_object_path.length < prefix.length + 38 ||
      entry.storage_object_path.length > 256 ||
      !entry.storage_object_path.startsWith(prefix)
    )
      return null;
    jobs.push({
      cleanupId: entry.cleanup_id,
      bucket: entry.storage_bucket,
      path: entry.storage_object_path,
    });
  }
  return jobs;
}

async function processAttachmentCleanupQueue(
  admin: any,
  tenantId: string,
): Promise<number | null> {
  const { data, error } = await admin.rpc(
    "claim_ticket_deletion_attachment_cleanup",
    { p_tenant_id: tenantId, p_limit: 100 },
  );
  const jobs = error ? null : parseAttachmentCleanupJobs(data, tenantId);
  if (!jobs) return null;

  let pending = 0;
  for (let index = 0; index < jobs.length; index += 100) {
    const batch = jobs.slice(index, index + 100);
    const { error } = await admin.storage
      .from(TICKET_ATTACHMENT_BUCKET)
      .remove(batch.map((job) => job.path));
    const cleanupIds = batch.map((job) => job.cleanupId);
    const rpcName = error
      ? "release_ticket_deletion_attachment_cleanup"
      : "complete_ticket_deletion_attachment_cleanup";
    const { data: completed, error: completionError } = await admin.rpc(
      rpcName,
      { p_cleanup_ids: cleanupIds },
    );
    if (error || completionError || completed !== batch.length) {
      pending += batch.length;
      if (!error && !completionError) {
        await admin.rpc("release_ticket_deletion_attachment_cleanup", {
          p_cleanup_ids: cleanupIds,
        });
      }
    }
  }
  return pending;
}

const handler = withSupabase({ auth: "user" }, async (request, context) => {
  if (request.method !== "POST") {
    return response(request, { error: { code: "method_not_allowed" } }, 405);
  }

  const action = parseAction(await request.json().catch(() => null));
  const actorId = context.userClaims?.id;
  if (!action || !isUuid(actorId)) {
    return response(request, { error: { code: "invalid_request" } }, 400);
  }
  if (
    !(await isActiveMember(context.supabaseAdmin, actorId, action.tenantId))
  ) {
    return response(
      request,
      { error: { code: "bulk_status_tenant_access_denied" } },
      403,
    );
  }

  // Storage cleanup is best-effort here: all paths were already persisted in
  // the server-only queue inside the deletion transaction and failures remain
  // eligible for a later, tenant-scoped retry.
  await processAttachmentCleanupQueue(context.supabaseAdmin, action.tenantId);

  if (action.type === "listStatusOptions") {
    const { data, error } = await context.supabaseAdmin
      .from("ticket_statuses")
      .select("key, label, is_closed, sort_order")
      .eq("tenant_id", action.tenantId)
      .order("sort_order")
      .order("label");
    if (error) {
      return response(
        request,
        {
          error: { code: "bulk_status_options_failed" },
        },
        500,
      );
    }
    return response(request, {
      data: {
        statuses: (data ?? []).map((status: any) => ({
          key: status.key,
          label: status.label,
          isClosed: Boolean(status.is_closed),
        })),
      },
    });
  }

  if (action.type === "listDeleted") {
    const result = await listDeletedTickets(
      context.supabaseAdmin,
      actorId,
      action.tenantId,
    );
    if ("error" in result) {
      return response(request, { error: { code: "ticket_trash_failed" } }, 500);
    }
    return response(request, { data: result });
  }

  if (action.type === "getDeleted") {
    const ticket = await getDeletedTicket(
      context.supabaseAdmin,
      actorId,
      action.tenantId,
      action.ticketId,
    );
    if (!ticket) {
      return response(
        request,
        { error: { code: "ticket_trash_not_found" } },
        404,
      );
    }
    return response(request, { data: { ticket } });
  }

  if (action.type === "restoreTickets") {
    const { data, error } = await context.supabaseAdmin.rpc(
      "restore_deleted_tickets",
      {
        p_actor_id: actorId,
        p_tenant_id: action.tenantId,
        p_ticket_ids: action.ticketIds,
      },
    );
    if (error) {
      const code =
        error.code === "42501"
          ? "ticket_restore_permission_denied"
          : error.code === "P0002"
            ? "ticket_restore_target_missing"
            : "ticket_restore_failed";
      const status =
        error.code === "42501" ? 403 : error.code === "P0002" ? 404 : 500;
      return response(request, { error: { code } }, status);
    }
    return response(request, {
      data: {
        restored:
          isRecord(data) && typeof data.restored === "number"
            ? data.restored
            : 0,
      },
    });
  }

  if (action.type === "deleteTickets") {
    const { data, error } = await context.supabaseAdmin.rpc(
      "bulk_delete_tickets",
      {
        p_actor_id: actorId,
        p_tenant_id: action.tenantId,
        p_ticket_ids: action.ticketIds,
        p_confirm_delete: action.confirmDelete,
      },
    );
    if (error) return rpcError(request, error, "delete");
    if (!isRecord(data) || typeof data.deleted !== "number") {
      return response(
        request,
        { error: { code: "bulk_ticket_delete_failed" } },
        500,
      );
    }
    const cleanupPending = await processAttachmentCleanupQueue(
      context.supabaseAdmin,
      action.tenantId,
    );
    return response(request, {
      data: {
        requested: typeof data.requested === "number" ? data.requested : 0,
        deleted: data.deleted,
        cleanupPending:
          cleanupPending === null
            ? typeof data.cleanupQueued === "number"
              ? data.cleanupQueued
              : 0
            : cleanupPending,
      },
    });
  }

  // Resolving or closing needs the cause of every SLA breach first.
  const { data: targetStatus } = await context.supabaseAdmin
    .from("ticket_statuses")
    .select("is_closed")
    .eq("tenant_id", action.tenantId)
    .eq("key", action.statusKey)
    .maybeSingle();
  if (targetStatus?.is_closed === true) {
    const openBreaches = await ticketIdsWithOpenSlaBreach(
      context.supabaseAdmin,
      action.tenantId,
      action.ticketIds,
    );
    if (openBreaches === null) {
      return response(
        request,
        { error: { code: "sla_breach_lookup_failed" } },
        503,
      );
    }
    if (openBreaches.length > 0) {
      return response(
        request,
        {
          error: {
            code: "sla_breach_reason_required",
            message: `${openBreaches.length === 1 ? "Bei einem Ticket fehlt" : `Bei ${openBreaches.length} Tickets fehlt`} die Ursache der SLA-Verletzung. Bitte zuerst im Ticket erfassen.`,
          },
        },
        422,
      );
    }
  }

  const { data, error } = await context.supabaseAdmin.rpc(
    "bulk_update_ticket_statuses",
    {
      p_actor_id: actorId,
      p_tenant_id: action.tenantId,
      p_ticket_ids: action.ticketIds,
      p_status_key: action.statusKey,
      p_confirm_close: action.confirmClose,
    },
  );
  if (error) return rpcError(request, error, "status");
  if (!isRecord(data) || typeof data.updated !== "number") {
    return response(request, { error: { code: "bulk_status_failed" } }, 500);
  }
  return response(request, {
    data: {
      requested: typeof data.requested === "number" ? data.requested : 0,
      statusKey:
        typeof data.statusKey === "string" ? data.statusKey : action.statusKey,
      updated: data.updated,
    },
  });
});

export default {
  fetch(request: Request): Response | Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: headers(request) });
    }
    return handler(request);
  },
};
