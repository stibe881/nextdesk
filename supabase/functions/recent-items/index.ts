import { withSupabase } from "@supabase/server";
import { isRecord, isUuid, json, noContent } from "../_shared/http.ts";
import {
  assetReadable,
  idsByType,
  KEEP_STORED,
  knowledgeReadable,
  mergeReadableRecentItems,
  parseAction,
  type ReadableItem,
  type RecentItemType,
  type StoredRecentRow,
  ticketReadable,
} from "./logic.ts";

/**
 * «Zuletzt angesehen»: per-user list of recently opened tickets, assets and
 * knowledge articles, shared by web and mobile. Storage is service_role only;
 * every read check runs with the caller's own client, so RLS decides which
 * entries are still visible.
 */

// deno-lint-ignore no-explicit-any
type Client = any;

const ITEM_QUERIES: Record<
  RecentItemType,
  { table: string; columns: string; map: (row: Record<string, unknown>) => ReadableItem }
> = {
  ticket: {
    table: "tickets",
    columns: "id, ticket_number, subject",
    map: ticketReadable,
  },
  asset: {
    table: "assets",
    columns: "id, name, asset_tag, kind",
    map: assetReadable,
  },
  knowledge_article: {
    table: "knowledge_articles",
    columns: "id, title, status",
    map: knowledgeReadable,
  },
};

async function readableItems(
  userClient: Client,
  tenantId: string,
  itemType: RecentItemType,
  ids: string[],
): Promise<Map<string, ReadableItem>> {
  const result = new Map<string, ReadableItem>();
  if (ids.length === 0) return result;
  const query = ITEM_QUERIES[itemType];
  const { data, error } = await userClient
    .from(query.table)
    .select(query.columns)
    .eq("tenant_id", tenantId)
    .in("id", ids);
  // A failing lookup (e.g. module disabled) hides the entries instead of
  // failing the whole list.
  if (error || !Array.isArray(data)) return result;
  for (const row of data) {
    if (isRecord(row) && isUuid(row.id)) {
      result.set(row.id.toLowerCase(), query.map(row));
    }
  }
  return result;
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
      const action = parseAction(await request.json().catch(() => null));
      if (!action) {
        return json(
          request,
          { error: { code: "invalid_request", message: "Die Anfrage ist ungültig." } },
          422,
        );
      }
      const admin: Client = context.supabaseAdmin;
      const userClient: Client = context.supabase;

      if (action.type === "record") {
        const readable = await readableItems(
          userClient,
          action.tenantId,
          action.itemType,
          [action.itemId],
        );
        if (!readable.has(action.itemId)) {
          return json(request, { error: { code: "not_found" } }, 404);
        }
        const { error } = await admin.rpc("record_user_recent_item", {
          p_user_id: actorId,
          p_tenant_id: action.tenantId,
          p_item_type: action.itemType,
          p_item_id: action.itemId,
          p_keep: KEEP_STORED,
        });
        if (error) {
          return json(request, { error: { code: "database_failure" } }, 503);
        }
        return json(request, { data: { recorded: true } });
      }

      if (action.type === "clear") {
        const { error } = await admin
          .from("user_recent_items")
          .delete()
          .eq("user_id", actorId)
          .eq("tenant_id", action.tenantId);
        if (error) {
          return json(request, { error: { code: "database_failure" } }, 503);
        }
        return json(request, { data: { items: [] } });
      }

      const { data: rows, error } = await admin
        .from("user_recent_items")
        .select("item_type, item_id, viewed_at")
        .eq("user_id", actorId)
        .eq("tenant_id", action.tenantId)
        .order("viewed_at", { ascending: false })
        .limit(KEEP_STORED);
      if (error) {
        return json(request, { error: { code: "database_failure" } }, 503);
      }
      const stored = ((rows ?? []) as StoredRecentRow[]).filter(
        (row) => typeof row.viewed_at === "string",
      );
      const ids = idsByType(stored);
      const [ticket, asset, knowledge_article] = await Promise.all([
        readableItems(userClient, action.tenantId, "ticket", ids.ticket),
        readableItems(userClient, action.tenantId, "asset", ids.asset),
        readableItems(
          userClient,
          action.tenantId,
          "knowledge_article",
          ids.knowledge_article,
        ),
      ]);
      const items = mergeReadableRecentItems(
        stored,
        { ticket, asset, knowledge_article },
        action.limit,
      );
      return json(request, { data: { items } });
    } catch (error) {
      console.error("recent_items_failed", error);
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
