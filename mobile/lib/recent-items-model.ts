/**
 * «Zuletzt angesehen» und Antwortentwürfe: reine Logik ohne Expo-Abhängigkeiten
 * (testbar mit vitest).
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
  knowledge_article: "Wissen",
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

/** Route in der App für einen Eintrag. */
export function recentItemRoute(item: RecentItem): string {
  const id = encodeURIComponent(item.itemId);
  if (item.itemType === "ticket") return `/ticket/${id}`;
  if (item.itemType === "asset") return `/assets/${id}`;
  return `/knowledge/${id}`;
}

/** Kurze relative Zeitangabe, z. B. «vor 5 Min.», «gestern». */
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

export type DraftCandidate = {
  body: string;
  updatedAt: string | null;
  visibility: "internal" | "external";
};

const DRAFT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Wählt den neuesten nicht-leeren Antwortentwurf (Server oder Gerät) unter
 * den erlaubten Sichtbarkeiten. Abgelaufene Entwürfe (älter als 30 Tage)
 * werden ignoriert; ein lokaler Entwurf ohne Zeitstempel gewinnt nur, wenn
 * es sonst keinen gibt.
 */
export function pickNewestDraft<T extends DraftCandidate>(
  candidates: readonly T[],
  allowed: readonly ("internal" | "external")[],
  now = Date.now(),
): T | null {
  const usable = candidates.filter(
    (candidate) =>
      allowed.includes(candidate.visibility) &&
      candidate.body.trim().length > 0 &&
      (candidate.updatedAt === null ||
        (Number.isFinite(Date.parse(candidate.updatedAt)) &&
          now - Date.parse(candidate.updatedAt) <= DRAFT_RETENTION_MS)),
  );
  if (usable.length === 0) return null;
  return [...usable].sort((left, right) => {
    const l = left.updatedAt === null ? -1 : Date.parse(left.updatedAt);
    const r = right.updatedAt === null ? -1 : Date.parse(right.updatedAt);
    return r - l;
  })[0]!;
}

const draftDateFormatter = new Intl.DateTimeFormat("de-CH", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Zurich",
});

export function draftRestoredLabel(updatedAt: string | null): string {
  if (!updatedAt || !Number.isFinite(Date.parse(updatedAt))) {
    return "Entwurf wiederhergestellt";
  }
  return `Entwurf vom ${draftDateFormatter.format(new Date(updatedAt))} wiederhergestellt`;
}
