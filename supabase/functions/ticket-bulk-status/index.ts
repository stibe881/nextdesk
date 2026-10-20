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
    };

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
  return null;
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
