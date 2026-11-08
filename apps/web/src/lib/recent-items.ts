import { supabase } from "./supabase";

/**
 * «Zuletzt angesehen»: recently opened tickets, devices/assets and knowledge
 * articles of the signed-in user, stored server-side (recent-items function)
 * and shared with the mobile app. The server only returns entries the user
 * can still read.
 */

export type RecentItemType = "ticket" | "asset" | "knowledge_article";

export type RecentItem = {
  itemType: RecentItemType;
  itemId: string;
  title: string;
  detail: string;
  viewedAt: string;
};

export const RECENT_ITEM_TYPE_LABEL: Record<RecentItemType, string> = {
  ticket: "Ticket",
  asset: "Gerät",
  knowledge_article: "Wissensartikel",
};

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isRecentItemType(value: unknown): value is RecentItemType {
  return (
    value === "ticket" || value === "asset" || value === "knowledge_article"
  );
}

export function parseRecentItems(value: unknown): RecentItem[] | null {
  const data = isRecord(value) && isRecord(value.data) ? value.data : null;
  if (!data || !Array.isArray(data.items) || data.items.length > 50) {
    return null;
  }
  const items: RecentItem[] = [];
  for (const raw of data.items) {
    if (
      !isRecord(raw) ||
      !isRecentItemType(raw.itemType) ||
      typeof raw.itemId !== "string" ||
      !UUID.test(raw.itemId) ||
      typeof raw.title !== "string" ||
      typeof raw.detail !== "string" ||
      typeof raw.viewedAt !== "string" ||
      !Number.isFinite(Date.parse(raw.viewedAt))
    ) {
      continue;
    }
    items.push({
      itemType: raw.itemType,
      itemId: raw.itemId,
      title: raw.title.slice(0, 240),
      detail: raw.detail.slice(0, 240),
      viewedAt: raw.viewedAt,
    });
  }
  return items.sort((left, right) =>
    right.viewedAt.localeCompare(left.viewedAt),
  );
}

/** Short relative time, e.g. «vor 5 Min.», «gestern». */
export function recentItemAgeLabel(viewedAt: string, now = Date.now()): string {
  const minutes = Math.max(
    0,
    Math.round((now - Date.parse(viewedAt)) / 60_000),
  );
  if (!Number.isFinite(minutes)) return "";
  if (minutes < 1) return "gerade eben";
  if (minutes < 60) return `vor ${minutes} Min.`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `vor ${hours} Std.`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "gestern" : `vor ${days} Tagen`;
}

/** Fire-and-forget: a failed record never disturbs the opened item. */
export function recordRecentItem(
  tenantId: string,
  itemType: RecentItemType,
  itemId: string,
): void {
  if (!supabase || !UUID.test(tenantId) || !UUID.test(itemId)) return;
  void supabase.functions
    .invoke("recent-items", {
      body: { type: "record", tenantId, itemType, itemId },
    })
    .catch(() => undefined);
}

export async function loadRecentItems(tenantId: string): Promise<RecentItem[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.functions.invoke("recent-items", {
    body: { type: "list", tenantId },
  });
  if (error) throw error;
  const items = parseRecentItems(data);
  if (!items) throw new Error("invalid_recent_items_response");
  return items;
}

export async function clearRecentItems(tenantId: string): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.functions.invoke("recent-items", {
    body: { type: "clear", tenantId },
  });
  if (error) throw error;
}
