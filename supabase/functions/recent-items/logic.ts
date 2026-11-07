import { isRecord, isUuid } from "../_shared/http.ts";

/**
 * «Zuletzt angesehen»: pure helpers for the recent-items function. Kept free
 * of Supabase so they can be unit-tested.
 */

export const RECENT_ITEM_TYPES = ["ticket", "asset", "knowledge_article"] as const;
export type RecentItemType = (typeof RECENT_ITEM_TYPES)[number];

export const MAX_LIST = 20;
/** Stored entries per user and tenant (some may no longer be readable). */
export const KEEP_STORED = 30;

export type RecentItemsAction =
  | { type: "record"; tenantId: string; itemType: RecentItemType; itemId: string }
  | { type: "list"; tenantId: string; limit: number }
  | { type: "clear"; tenantId: string };

export function isRecentItemType(value: unknown): value is RecentItemType {
  return typeof value === "string" &&
    (RECENT_ITEM_TYPES as readonly string[]).includes(value);
}

export function parseAction(value: unknown): RecentItemsAction | null {
  if (!isRecord(value) || !isUuid(value.tenantId)) return null;
  const tenantId = value.tenantId.toLowerCase();
  switch (value.type) {
    case "record":
      if (!isRecentItemType(value.itemType) || !isUuid(value.itemId)) return null;
      return {
        type: "record",
        tenantId,
        itemType: value.itemType,
        itemId: value.itemId.toLowerCase(),
      };
    case "list": {
      const raw = value.limit;
      if (raw !== undefined && (typeof raw !== "number" || !Number.isInteger(raw))) {
        return null;
      }
      const limit = Math.min(
        Math.max(typeof raw === "number" ? raw : MAX_LIST, 1),
        MAX_LIST,
      );
      return { type: "list", tenantId, limit };
    }
    case "clear":
      return { type: "clear", tenantId };
    default:
      return null;
  }
}

export type StoredRecentRow = {
  item_type: string;
  item_id: string;
  viewed_at: string;
};

export type ReadableItem = { title: string; detail: string };

export type RecentItem = {
  itemType: RecentItemType;
  itemId: string;
  title: string;
  detail: string;
  viewedAt: string;
};

/**
 * Keeps the stored order (newest first) and drops every entry the caller can
 * no longer read: only ids returned by the caller's own RLS-scoped queries
 * are part of `readable`.
 */
export function mergeReadableRecentItems(
  rows: readonly StoredRecentRow[],
  readable: Readonly<Record<RecentItemType, ReadonlyMap<string, ReadableItem>>>,
  limit: number,
): RecentItem[] {
  const sorted = [...rows].sort((left, right) =>
    right.viewed_at.localeCompare(left.viewed_at)
  );
  const result: RecentItem[] = [];
  const seen = new Set<string>();
  for (const row of sorted) {
    if (result.length >= limit) break;
    if (!isRecentItemType(row.item_type)) continue;
    const key = `${row.item_type}:${row.item_id}`;
    if (seen.has(key)) continue;
    const item = readable[row.item_type].get(row.item_id);
    if (!item) continue;
    seen.add(key);
    result.push({
      itemType: row.item_type,
      itemId: row.item_id,
      title: item.title,
      detail: item.detail,
      viewedAt: row.viewed_at,
    });
  }
  return result;
}

export function idsByType(
  rows: readonly StoredRecentRow[],
): Record<RecentItemType, string[]> {
  const result: Record<RecentItemType, string[]> = {
    ticket: [],
    asset: [],
    knowledge_article: [],
  };
  for (const row of rows) {
    if (isRecentItemType(row.item_type) && isUuid(row.item_id)) {
      if (!result[row.item_type].includes(row.item_id)) {
        result[row.item_type].push(row.item_id);
      }
    }
  }
  return result;
}

const KNOWLEDGE_STATUS: Record<string, string> = {
  draft: "Entwurf",
  review: "In Prüfung",
  published: "Veröffentlicht",
  archived: "Archiviert",
};

export function ticketReadable(row: Record<string, unknown>): ReadableItem {
  return {
    title: String(row.subject ?? "").trim() || "Ticket",
    detail: String(row.ticket_number ?? "").trim() || "Ticket",
  };
}

export function assetReadable(row: Record<string, unknown>): ReadableItem {
  const tag = typeof row.asset_tag === "string" ? row.asset_tag.trim() : "";
  const kind = typeof row.kind === "string" ? row.kind.trim() : "";
  return {
    title: String(row.name ?? "").trim() || "Gerät",
    detail: [tag, kind].filter(Boolean).join(" · ") || "Gerät / Asset",
  };
}

export function knowledgeReadable(row: Record<string, unknown>): ReadableItem {
  const status = typeof row.status === "string" ? row.status : "";
  return {
    title: String(row.title ?? "").trim() || "Wissensartikel",
    detail: KNOWLEDGE_STATUS[status] ?? "Wissensartikel",
  };
}
