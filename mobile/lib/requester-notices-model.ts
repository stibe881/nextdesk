/**
 * Hinweise für Anfragende (interne Werbehinweise der ICT): reine Logik für die
 * Startseiten-Karte. Keine React-/Expo-Importe, damit sie direkt testbar ist.
 */

export type NoticeLinkKind = "shop" | "knowledge" | "new_ticket" | "url";
export type NoticeColor = "brand" | "info" | "success" | "warning";

export type NoticeView = {
  id: string;
  title: string;
  body: string;
  buttonLabel: string;
  linkKind: NoticeLinkKind;
  linkTarget: string | null;
  symbol: string | null;
  color: NoticeColor;
  dismissible: boolean;
};

export type NoticeEvent = "view" | "click" | "dismiss";

const LINK_KINDS: readonly NoticeLinkKind[] = [
  "shop",
  "knowledge",
  "new_ticket",
  "url",
];
const COLORS: readonly NoticeColor[] = ["brand", "info", "success", "warning"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Prüft einen einzelnen Hinweis; unvollständige Einträge werden verworfen. */
export function parseNotice(value: unknown): NoticeView | null {
  if (!isRecord(value)) return null;
  const id = nonEmptyString(value.id);
  const title = nonEmptyString(value.title);
  const buttonLabel = nonEmptyString(value.buttonLabel);
  const linkKind = LINK_KINDS.find((kind) => kind === value.linkKind);
  if (!id || !title || !buttonLabel || !linkKind) return null;
  const color = COLORS.find((name) => name === value.color) ?? "brand";
  return {
    id,
    title,
    body: typeof value.body === "string" ? value.body.trim() : "",
    buttonLabel,
    linkKind,
    linkTarget: nonEmptyString(value.linkTarget),
    symbol: nonEmptyString(value.symbol),
    color,
    dismissible: value.dismissible === true,
  };
}

/** Liest die Antwort `{ data: { notices } }` der Funktion `requester-notices`. */
export function parseActiveNotices(response: unknown): NoticeView[] {
  const data = isRecord(response) && "data" in response ? response.data : null;
  const list =
    isRecord(data) && Array.isArray(data.notices) ? data.notices : [];
  const notices: NoticeView[] = [];
  for (const entry of list) {
    const notice = parseNotice(entry);
    if (notice && !notices.some((known) => known.id === notice.id)) {
      notices.push(notice);
    }
  }
  return notices;
}

/** Der anzuzeigende Hinweis: der erste, den die Person nicht weggeklickt hat. */
export function pickNotice(
  notices: readonly NoticeView[],
  dismissedIds: ReadonlySet<string>,
): NoticeView | null {
  return notices.find((notice) => !dismissedIds.has(notice.id)) ?? null;
}

export type NoticeTarget =
  { kind: "route"; href: string } | { kind: "url"; url: string };

/** Nur https-Adressen mit Host werden extern geöffnet. */
export function safeHttpsUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && url.hostname ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Ziel des Buttons; `null`, wenn der Link ungültig ist (Button bleibt ohne Wirkung). */
export function resolveNoticeTarget(
  notice: Pick<NoticeView, "linkKind" | "linkTarget">,
): NoticeTarget | null {
  switch (notice.linkKind) {
    case "shop":
      return { kind: "route", href: "/shop" };
    case "new_ticket":
      return { kind: "route", href: "/ticket/new" };
    case "knowledge":
      return notice.linkTarget && UUID.test(notice.linkTarget)
        ? { kind: "route", href: `/knowledge/${notice.linkTarget}` }
        : null;
    case "url": {
      const url = safeHttpsUrl(notice.linkTarget);
      return url ? { kind: "url", url } : null;
    }
  }
}

/** Ein Hinweis mit ungültigem Link wird gar nicht erst angezeigt. */
export function isNoticeActionable(notice: NoticeView): boolean {
  return resolveNoticeTarget(notice) !== null;
}

export type NoticePalette = { primary: string; onPrimary: string };
export type NoticeColors = {
  /** Kartenfläche */
  background: string;
  /** Text und Symbol auf der Fläche */
  foreground: string;
  /** Beschriftung des weissen Buttons */
  buttonText: string;
};

const WHITE = "#FFFFFF";
// Feste, dunkle Flächen: weisse Schrift bleibt in Hell und Dunkel lesbar
// (die Statusfarben des Dunkel-Themes sind hell und eignen sich nicht als Fläche).
const FIXED_FILLS: Record<Exclude<NoticeColor, "brand">, string> = {
  info: "#07738D",
  success: "#166534",
  warning: "#8A5B0D",
};

export function noticeColors(
  color: NoticeColor,
  palette: NoticePalette,
): NoticeColors {
  if (color === "brand") {
    return {
      background: palette.primary,
      foreground: palette.onPrimary,
      buttonText: palette.primary,
    };
  }
  const fill = FIXED_FILLS[color];
  return { background: fill, foreground: WHITE, buttonText: fill };
}

/** Symbol als Ionicons-Name (`megaphone-outline`) oder als kurzes Textzeichen (Emoji). */
export type NoticeSymbol =
  { kind: "icon"; name: string } | { kind: "text"; text: string };

export const DEFAULT_NOTICE_ICON = "megaphone-outline";

export function resolveNoticeSymbol(symbol: string | null): NoticeSymbol {
  const value = symbol?.trim();
  if (!value) return { kind: "icon", name: DEFAULT_NOTICE_ICON };
  if (/^[a-z][a-z0-9-]*$/.test(value)) return { kind: "icon", name: value };
  return { kind: "text", text: Array.from(value).slice(0, 4).join("") };
}
