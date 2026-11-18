// Zustand der IPAM-Oberfläche: zuletzt gewählte Ansicht/Netz (pro Browser),
// Tastenkürzel und Brotkrumen (reine Logik).

import type { IpamPrefix } from "./ipam-model";

export type IpamPrefs = {
  view?: string;
  prefixId?: string | null;
  siteId?: string | null;
  findingsMode?: string;
};

const key = (tenantId: string) => `nextdesk:ipam:${tenantId}`;

/** Last view/selection; empty when storage is unavailable or invalid. */
export function loadPrefs(
  tenantId: string,
  storage: Pick<Storage, "getItem"> | null = safeStorage(),
): IpamPrefs {
  try {
    const raw = storage?.getItem(key(tenantId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const value = parsed as Record<string, unknown>;
    const text = (entry: unknown) =>
      typeof entry === "string" ? entry : undefined;
    const prefs: IpamPrefs = {};
    if (text(value.view)) prefs.view = text(value.view)!;
    if (text(value.prefixId)) prefs.prefixId = text(value.prefixId)!;
    if (text(value.siteId)) prefs.siteId = text(value.siteId)!;
    if (text(value.findingsMode))
      prefs.findingsMode = text(value.findingsMode)!;
    return prefs;
  } catch {
    return {};
  }
}

export function savePrefs(
  tenantId: string,
  prefs: IpamPrefs,
  storage: Pick<Storage, "setItem"> | null = safeStorage(),
): void {
  try {
    storage?.setItem(key(tenantId), JSON.stringify(prefs));
  } catch {
    // Private mode or blocked storage: the module works without it.
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** «/» focuses the search unless the person is typing somewhere. */
export function isSearchShortcut(event: {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  target: EventTarget | null;
}): boolean {
  if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey)
    return false;
  const target = event.target as
    (EventTarget & { tagName?: string; isContentEditable?: boolean }) | null;
  const tag = target?.tagName?.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return false;
  return !target?.isContentEditable;
}

/** Ancestors of a prefix, outermost first (for the breadcrumb). */
export function prefixAncestors(
  prefixes: Pick<IpamPrefix, "id" | "parentId">[],
  prefixId: string,
): string[] {
  const byId = new Map(prefixes.map((prefix) => [prefix.id, prefix]));
  const result: string[] = [];
  let parentId = byId.get(prefixId)?.parentId ?? null;
  while (parentId && !result.includes(parentId)) {
    result.unshift(parentId);
    parentId = byId.get(parentId)?.parentId ?? null;
  }
  return result;
}
