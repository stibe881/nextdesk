import { supabase } from "./supabase";

/** Client für die Edge Function `requester-notices` (Hinweise für Anfragende). */

export type NoticeLinkKind = "shop" | "knowledge" | "new_ticket" | "url";
export type NoticeColor = "brand" | "info" | "success" | "warning";
export type NoticeStatus = "draft" | "active" | "paused";
export type NoticeState =
  "draft" | "scheduled" | "active" | "paused" | "expired";

export type NoticeView = {
  id: string;
  title: string;
  body: string;
  buttonLabel: string;
  linkKind: NoticeLinkKind;
  /** knowledge: Artikel-UUID, url: https-Adresse, sonst null. */
  linkTarget: string | null;
  symbol: string | null;
  color: NoticeColor;
  dismissible: boolean;
};

export type NoticeStats = {
  views: number;
  clicks: number;
  dismissals: number;
  mailViews: number;
  mailClicks: number;
};

export type AdminNotice = NoticeView & {
  status: NoticeStatus;
  state: NoticeState;
  showPortalBanner: boolean;
  showPortalBar: boolean;
  showMail: boolean;
  showApp: boolean;
  startsOn: string;
  endsOn: string;
  stats: NoticeStats;
  updatedAt: string;
};

export type NoticeSettings = { frequencyDays: number };

export type NoticePlacement = "portal_banner" | "portal_bar" | "app";
export type NoticeEvent = "view" | "click" | "dismiss";
export type NoticeChannel = "portal" | "app";
export type MailPreviewKind = "acknowledgement" | "agent_reply" | "resolution";

/** Bearbeitungsstand im Editor (alles als Text, damit Eingaben frei bleiben). */
export type NoticeDraft = {
  id?: string;
  title: string;
  body: string;
  buttonLabel: string;
  linkKind: NoticeLinkKind;
  linkTarget: string;
  /** Anzeigename des gewählten Wissensartikels (nur Editor). */
  linkTargetLabel: string;
  symbol: string;
  color: NoticeColor;
  showPortalBanner: boolean;
  showPortalBar: boolean;
  showMail: boolean;
  showApp: boolean;
  dismissible: boolean;
  startsOn: string;
  endsOn: string;
};

export const TITLE_MAX = 60;
export const BODY_MAX = 300;
export const BUTTON_MAX = 30;
export const SYMBOL_MAX = 4;
export const FREQUENCY_MAX_DAYS = 30;
export const DEFAULT_FREQUENCY_DAYS = 0;

const ERRORS: Record<string, string> = {
  tenant_admin_required:
    "Nur die Mandanten-Administration darf Hinweise verwalten.",
  feature_disabled:
    "Die Funktion «Hinweise für Anfragende» ist nicht eingeschaltet.",
  invalid_request: "Die Anfrage ist ungültig. Bitte die Eingaben prüfen.",
  title_invalid: `Bitte einen Titel mit 1 bis ${TITLE_MAX} Zeichen eingeben.`,
  body_invalid: `Bitte einen Text mit 1 bis ${BODY_MAX} Zeichen eingeben.`,
  button_invalid: `Bitte einen Schaltflächentext mit 1 bis ${BUTTON_MAX} Zeichen eingeben.`,
  link_invalid:
    "Das Ziel ist ungültig (Wissensartikel wählen oder eine https-Adresse eingeben).",
  dates_invalid: "Das Ende ist Pflicht und muss am oder nach dem Start liegen.",
  notice_not_found: "Der Hinweis wurde nicht gefunden.",
  placement_required: "Bitte mindestens einen Ort wählen.",
  save_failed: "Der Hinweis konnte nicht gespeichert werden.",
};

async function call<T>(body: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error("nextDesk ist nicht konfiguriert.");
  const { data, error } = await supabase.functions.invoke("requester-notices", {
    body,
  });
  if (error) {
    const context =
      typeof error === "object" && error !== null && "context" in error
        ? (error as { context?: unknown }).context
        : undefined;
    if (context instanceof Response) {
      const payload = (await context
        .clone()
        .json()
        .catch(() => null)) as { error?: { code?: unknown } } | null;
      const code = payload?.error?.code;
      if (typeof code === "string" && ERRORS[code])
        throw new Error(ERRORS[code]);
    }
    throw new Error("Die Hinweise sind gerade nicht erreichbar.");
  }
  return (data as { data: T }).data;
}

/** Zeichen nach Unicode-Codepunkten (Emojis zählen als eines). */
export function charCount(value: string): number {
  return Array.from(value).length;
}

/** Wire-Format des Hinweises (adminSave / adminPreviewMail). */
export function noticePayload(draft: NoticeDraft) {
  const target = draft.linkTarget.trim();
  const symbol = draft.symbol.trim();
  return {
    ...(draft.id ? { id: draft.id } : {}),
    title: draft.title.trim(),
    body: draft.body.trim(),
    buttonLabel: draft.buttonLabel.trim(),
    linkKind: draft.linkKind,
    linkTarget:
      draft.linkKind === "knowledge" || draft.linkKind === "url"
        ? target
        : null,
    symbol: symbol || null,
    color: draft.color,
    showPortalBanner: draft.showPortalBanner,
    showPortalBar: draft.showPortalBar,
    showMail: draft.showMail,
    showApp: draft.showApp,
    dismissible: draft.dismissible,
    startsOn: draft.startsOn,
    endsOn: draft.endsOn,
  };
}

export const noticeApi = {
  list: (tenantId: string) =>
    call<{ notices: AdminNotice[]; settings: NoticeSettings }>({
      type: "adminList",
      tenantId,
    }),
  save: (tenantId: string, draft: NoticeDraft, publish: boolean) =>
    call<{ id: string; status: NoticeStatus }>({
      type: "adminSave",
      tenantId,
      notice: noticePayload(draft),
      publish,
    }),
  setStatus: (
    tenantId: string,
    noticeId: string,
    status: "active" | "paused",
  ) =>
    call<{ ok: true }>({ type: "adminSetStatus", tenantId, noticeId, status }),
  remove: (tenantId: string, noticeId: string) =>
    call<{ ok: true }>({ type: "adminDelete", tenantId, noticeId }),
  saveSettings: (tenantId: string, frequencyDays: number) =>
    call<{ ok: true }>({ type: "adminSettings", tenantId, frequencyDays }),
  previewMail: (tenantId: string, draft: NoticeDraft, kind: MailPreviewKind) =>
    call<{ html: string; subject: string }>({
      type: "adminPreviewMail",
      tenantId,
      notice: noticePayload(draft),
      kind,
    }),
  articles: (tenantId: string, query?: string) =>
    call<{ articles: { id: string; title: string }[] }>({
      type: "adminArticles",
      tenantId,
      ...(query?.trim() ? { query: query.trim() } : {}),
    }).then((result) => result.articles),
  active: (tenantId: string, placement: NoticePlacement) =>
    call<{ notices: NoticeView[] }>({
      type: "active",
      tenantId,
      placement,
    }).then((result) => result.notices),
  track: (
    tenantId: string,
    noticeId: string,
    event: NoticeEvent,
    channel: NoticeChannel = "portal",
  ) =>
    call<{ ok: true }>({ type: "track", tenantId, noticeId, event, channel }),
};

/* ---------- Datum ---------- */

export function todayIso(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

export function formatNoticeDate(value: string): string {
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}.${month}.${year}` : value;
}

/** Zeitraum für die Liste, z. B. «ab 01.12.2026 bis 31.12.2026». */
export function noticePeriodLabel(
  notice: Pick<AdminNotice, "startsOn" | "endsOn" | "state">,
  today: string = todayIso(),
): string {
  const end = `bis ${formatNoticeDate(notice.endsOn)}`;
  return notice.startsOn > today
    ? `ab ${formatNoticeDate(notice.startsOn)} ${end}`
    : end;
}

/* ---------- Validierung (leer = ok) ---------- */

export function emptyNoticeDraft(today: string = todayIso()): NoticeDraft {
  return {
    title: "",
    body: "",
    buttonLabel: "Mehr erfahren",
    linkKind: "shop",
    linkTarget: "",
    linkTargetLabel: "",
    symbol: "",
    color: "brand",
    showPortalBanner: true,
    showPortalBar: false,
    showMail: false,
    showApp: false,
    dismissible: true,
    startsOn: today,
    endsOn: "",
  };
}

export function draftFromNotice(notice: AdminNotice): NoticeDraft {
  return {
    id: notice.id,
    title: notice.title,
    body: notice.body,
    buttonLabel: notice.buttonLabel,
    linkKind: notice.linkKind,
    linkTarget: notice.linkTarget ?? "",
    linkTargetLabel: "",
    symbol: notice.symbol ?? "",
    color: notice.color,
    showPortalBanner: notice.showPortalBanner,
    showPortalBar: notice.showPortalBar,
    showMail: notice.showMail,
    showApp: notice.showApp,
    dismissible: notice.dismissible,
    startsOn: notice.startsOn,
    endsOn: notice.endsOn,
  };
}

export function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && url.hostname.length > 0;
  } catch {
    return false;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Meldung für den Inhalt (Titel, Text, Schaltfläche, Ziel, Symbol). */
export function contentIssue(draft: NoticeDraft): string {
  const title = charCount(draft.title.trim());
  if (title < 1 || title > TITLE_MAX)
    return `Bitte einen Titel mit 1 bis ${TITLE_MAX} Zeichen eingeben.`;
  const body = charCount(draft.body.trim());
  if (body < 1 || body > BODY_MAX)
    return `Bitte einen Text mit 1 bis ${BODY_MAX} Zeichen eingeben.`;
  const button = charCount(draft.buttonLabel.trim());
  if (button < 1 || button > BUTTON_MAX)
    return `Bitte einen Schaltflächentext mit 1 bis ${BUTTON_MAX} Zeichen eingeben.`;
  if (draft.linkKind === "knowledge" && !UUID.test(draft.linkTarget.trim()))
    return "Bitte einen Wissensartikel als Ziel wählen.";
  if (draft.linkKind === "url" && !isHttpsUrl(draft.linkTarget))
    return "Bitte eine Adresse mit https:// eingeben.";
  if (charCount(draft.symbol.trim()) > SYMBOL_MAX)
    return `Das Symbol darf höchstens ${SYMBOL_MAX} Zeichen haben.`;
  return "";
}

export function placementIssue(draft: NoticeDraft): string {
  return draft.showPortalBanner ||
    draft.showPortalBar ||
    draft.showMail ||
    draft.showApp
    ? ""
    : "Bitte mindestens einen Ort wählen.";
}

export function datesIssue(draft: NoticeDraft): string {
  if (!draft.endsOn) return "Bitte ein Ende wählen.";
  if (!draft.startsOn) return "";
  return draft.endsOn < draft.startsOn
    ? "Das Ende darf nicht vor dem Start liegen."
    : "";
}

/** Erste Meldung, solange der Hinweis nicht gespeichert werden kann. */
export function noticeIssue(draft: NoticeDraft): string {
  return contentIssue(draft) || placementIssue(draft) || datesIssue(draft);
}

export function frequencyIssue(value: number): string {
  return Number.isInteger(value) && value >= 0 && value <= FREQUENCY_MAX_DAYS
    ? ""
    : `Bitte eine ganze Zahl von 0 bis ${FREQUENCY_MAX_DAYS} eingeben.`;
}

/* ---------- Darstellung ---------- */

const STATE_LABELS: Record<NoticeState, string> = {
  draft: "Entwurf",
  scheduled: "Geplant",
  active: "Aktiv",
  paused: "Pausiert",
  expired: "Abgelaufen",
};

export function noticeStateLabel(state: NoticeState): string {
  return STATE_LABELS[state];
}

export type NoticeStateTone = "ok" | "warn" | "mute" | "info";

export function noticeStateTone(state: NoticeState): NoticeStateTone {
  if (state === "active") return "ok";
  if (state === "scheduled") return "info";
  if (state === "paused") return "warn";
  return "mute";
}

export type NoticeColors = {
  /** Verlauf des grossen Banners (weisse Schrift darauf). */
  from: string;
  to: string;
  /** Schmale Leiste: Hintergrund, Schrift, Rand (Theme-Variablen). */
  barBackground: string;
  barText: string;
  barBorder: string;
};

const COLORS: Record<NoticeColor, NoticeColors> = {
  brand: {
    from: "#4338ca",
    to: "#075985",
    barBackground: "var(--primary-soft, #eef0ff)",
    barText: "var(--primary, #4338ca)",
    barBorder: "var(--primary, #4338ca)",
  },
  info: {
    from: "#075985",
    to: "#0e7490",
    barBackground: "var(--info-soft, #eff8ff)",
    barText: "var(--info, #075985)",
    barBorder: "var(--info, #075985)",
  },
  success: {
    from: "#11664e",
    to: "#0f7b6c",
    barBackground: "var(--success-soft, #edf8f3)",
    barText: "var(--success, #11664e)",
    barBorder: "var(--success, #11664e)",
  },
  warning: {
    from: "#9a3412",
    to: "#c2410c",
    barBackground: "var(--warning-soft, #fff4ed)",
    barText: "var(--warning, #9a3412)",
    barBorder: "var(--warning, #9a3412)",
  },
};

export function noticeColors(color: NoticeColor): NoticeColors {
  return COLORS[color] ?? COLORS.brand;
}

export const COLOR_OPTIONS = [
  { value: "brand", label: "Markenfarbe" },
  { value: "info", label: "Blau (Info)" },
  { value: "success", label: "Grün (Neu)" },
  { value: "warning", label: "Orange (Wichtig)" },
] as const satisfies readonly { value: NoticeColor; label: string }[];

export const LINK_OPTIONS = [
  { value: "shop", label: "Shop" },
  { value: "knowledge", label: "Wissensartikel" },
  { value: "new_ticket", label: "Ticket erfassen" },
  { value: "url", label: "Eigene Adresse (https)" },
] as const satisfies readonly { value: NoticeLinkKind; label: string }[];

/** Orte als Text, z. B. «Portal-Banner · E-Mail». */
export function noticePlacementLabels(
  notice: Pick<
    AdminNotice,
    "showPortalBanner" | "showPortalBar" | "showMail" | "showApp"
  >,
): string[] {
  const labels: string[] = [];
  if (notice.showPortalBanner) labels.push("Portal-Banner");
  if (notice.showPortalBar) labels.push("Hinweisleiste");
  if (notice.showMail) labels.push("E-Mail");
  if (notice.showApp) labels.push("App");
  return labels;
}

/** Klickrate in Prozent (ganze Zahl), 0 ohne Ansichten. */
export function clickRate(clicks: number, views: number): number {
  return views > 0 ? Math.round((clicks / views) * 100) : 0;
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat("de-CH").format(value);
}

/* ---------- Ziel auflösen ---------- */

export type NoticeLink =
  | { kind: "section"; section: "Shop" | "Wissen" }
  | { kind: "knowledge"; id: string }
  | { kind: "new_ticket" }
  | { kind: "url"; href: string };

/** Wohin ein Klick führt; `null`, wenn das Ziel nicht (mehr) gültig ist. */
export function resolveNoticeLink(
  notice: Pick<NoticeView, "linkKind" | "linkTarget">,
): NoticeLink | null {
  switch (notice.linkKind) {
    case "shop":
      return { kind: "section", section: "Shop" };
    case "new_ticket":
      return { kind: "new_ticket" };
    case "knowledge": {
      const id = notice.linkTarget?.trim() ?? "";
      return UUID.test(id)
        ? { kind: "knowledge", id: id.toLowerCase() }
        : { kind: "section", section: "Wissen" };
    }
    case "url": {
      const href = notice.linkTarget?.trim() ?? "";
      return isHttpsUrl(href) ? { kind: "url", href } : null;
    }
    default:
      return null;
  }
}
