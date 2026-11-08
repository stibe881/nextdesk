import { invokeNextDesk } from "@/lib/nextdesk-client";
import {
  parseRecentItems,
  type RecentItem,
  type RecentItemType,
} from "@/lib/recent-items-model";

export type { RecentItem, RecentItemType } from "@/lib/recent-items-model";

/**
 * «Zuletzt angesehen»: serverseitig gespeichert (Funktion recent-items) und
 * mit dem Web geteilt. Der Server liefert nur Einträge, die du noch lesen
 * darfst.
 */
export async function loadRecentItems(tenantId: string): Promise<RecentItem[]> {
  const response = await invokeNextDesk<unknown>("recent-items", {
    type: "list",
    tenantId,
  });
  const items = parseRecentItems(response);
  if (!items) throw new Error("Die zuletzt angesehenen Elemente sind unvollständig.");
  return items;
}

/** Ohne Rückmeldung: ein Fehler stört das geöffnete Element nie. */
export function recordRecentItem(
  tenantId: string,
  itemType: RecentItemType,
  itemId: string,
): void {
  void invokeNextDesk<unknown>("recent-items", {
    type: "record",
    tenantId,
    itemType,
    itemId,
  }).catch(() => undefined);
}
