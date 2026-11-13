// Hinweise für Anfragende: Prüfung der Eingaben, Zielverweise, Auswahl für
// Ticket-Mails. Die reinen Teile sind in requester-notices.test.ts getestet.

import { resolveTenantFeatureStates } from "./tenant-features.ts";
import { signNoticeLinkToken } from "./notice-link-token.ts";

// deno-lint-ignore no-explicit-any
type Admin = any;
type Row = Record<string, unknown>;

export const NOTICE_FEATURE = "portal.notices";
export const APP_ORIGIN = "https://app.nextdesk.ch";
export const DEFAULT_FREQUENCY_DAYS = 0;
/** Mail-Arten, in denen ein Hinweis erscheinen darf (nie Sicherheits-, Phishing-, Erinnerungs-, Freigabemails). */
export const NOTICE_MAIL_KINDS = ["acknowledgement", "agent_reply", "resolution"] as const;
export const NOTICE_COLORS = ["brand", "info", "success", "warning"] as const;
export const NOTICE_LINK_KINDS = ["shop", "knowledge", "new_ticket", "url"] as const;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type NoticeColor = (typeof NOTICE_COLORS)[number];
export type NoticeLinkKind = (typeof NOTICE_LINK_KINDS)[number];

export type NoticeInput = {
  title: string;
  body: string;
  buttonLabel: string;
  linkKind: NoticeLinkKind;
  linkTarget: string | null;
  symbol: string | null;
  color: NoticeColor;
  showPortalBanner: boolean;
  showPortalBar: boolean;
  showMail: boolean;
  showApp: boolean;
  dismissible: boolean;
  startsOn: string;
  endsOn: string;
};

export type NoticeValidation =
  | { ok: true; value: NoticeInput }
  | { ok: false; code: string };

function isRecord(value: unknown): value is Row {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, min: number, max: number): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[\u0000-\u001f\u007f-\u009f]/gu, " ").trim();
  const length = [...cleaned].length;
  return length >= min && length <= max ? cleaned : null;
}

function validDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value
    ? null
    : value;
}

/** Heutiges Datum (YYYY-MM-DD) in der Zeitzone des Betriebs. */
export function zurichToday(now = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Zurich" }).format(now);
}

export function validateNoticeInput(input: unknown, today: string): NoticeValidation {
  if (!isRecord(input)) return { ok: false, code: "invalid_request" };
  const title = text(input.title, 1, 60);
  if (!title) return { ok: false, code: "title_invalid" };
  const body = text(input.body, 1, 300);
  if (!body) return { ok: false, code: "body_invalid" };
  const buttonLabel = text(input.buttonLabel, 1, 30);
  if (!buttonLabel) return { ok: false, code: "button_invalid" };

  const linkKind = input.linkKind;
  if (!(NOTICE_LINK_KINDS as readonly unknown[]).includes(linkKind)) {
    return { ok: false, code: "link_invalid" };
  }
  let linkTarget: string | null = null;
  if (linkKind === "knowledge") {
    if (typeof input.linkTarget !== "string" || !UUID.test(input.linkTarget)) {
      return { ok: false, code: "link_invalid" };
    }
    linkTarget = input.linkTarget.toLowerCase();
  } else if (linkKind === "url") {
    try {
      const url = new URL(String(input.linkTarget ?? "").trim());
      if (url.protocol !== "https:" || url.username || url.password) {
        return { ok: false, code: "link_invalid" };
      }
      linkTarget = url.toString();
      if (linkTarget.length > 500) return { ok: false, code: "link_invalid" };
    } catch {
      return { ok: false, code: "link_invalid" };
    }
  }

  let symbol: string | null = null;
  if (typeof input.symbol === "string" && input.symbol.trim()) {
    symbol = text(input.symbol, 1, 4);
    if (!symbol) return { ok: false, code: "invalid_request" };
  }
  const color = input.color;
  if (!(NOTICE_COLORS as readonly unknown[]).includes(color)) {
    return { ok: false, code: "invalid_request" };
  }

  const flags = {
    showPortalBanner: input.showPortalBanner === true,
    showPortalBar: input.showPortalBar === true,
    showMail: input.showMail === true,
    showApp: input.showApp === true,
  };
  if (!Object.values(flags).some(Boolean)) {
    return { ok: false, code: "placement_required" };
  }

  const startsOn =
    input.startsOn === undefined || input.startsOn === null || input.startsOn === ""
      ? today
      : validDate(input.startsOn);
  const endsOn = validDate(input.endsOn);
  if (!startsOn || !endsOn || endsOn < startsOn || endsOn < today) {
    return { ok: false, code: "dates_invalid" };
  }

  return {
    ok: true,
    value: {
      title,
      body,
      buttonLabel,
      linkKind: linkKind as NoticeLinkKind,
      linkTarget,
      symbol,
      color: color as NoticeColor,
      ...flags,
      dismissible: input.dismissible !== false,
      startsOn,
      endsOn,
    },
  };
}

export type NoticeState = "draft" | "scheduled" | "active" | "paused" | "expired";

export function noticeState(
  notice: { status: string; starts_on: string; ends_on: string },
  today: string,
): NoticeState {
  if (notice.status === "draft") return "draft";
  if (notice.ends_on < today) return "expired";
  if (notice.status === "paused") return "paused";
  return notice.starts_on > today ? "scheduled" : "active";
}

/** Zieladresse für Mails und die Zählerweiterleitung. */
export function noticeTargetUrl(
  linkKind: string,
  linkTarget: string | null,
  origin = APP_ORIGIN,
): string | null {
  if (linkKind === "shop") return `${origin}/?ziel=shop`;
  if (linkKind === "new_ticket") return `${origin}/?ziel=neues-ticket`;
  if (linkKind === "knowledge" && linkTarget && UUID.test(linkTarget)) {
    return `${origin}/?wissen=${linkTarget.toLowerCase()}`;
  }
  if (linkKind === "url" && linkTarget) {
    try {
      const url = new URL(linkTarget);
      return url.protocol === "https:" && !url.username && !url.password
        ? url.toString()
        : null;
    } catch {
      return null;
    }
  }
  return null;
}

export function mailNoticeAllowed(
  messageKind: string | null,
  hasReminderActions: boolean,
): boolean {
  return (
    !hasReminderActions &&
    (NOTICE_MAIL_KINDS as readonly string[]).includes(messageKind ?? "")
  );
}

/**
 * Wählt den Hinweis für eine Mail: kein Treffer, wenn der Empfänger innerhalb
 * der Häufigkeitsgrenze schon einen erhielt; sonst reihum (noch nie
 * ausgelieferter zuerst, dann der am längsten zurückliegende).
 */
export function chooseNotice<T extends { id: string }>(
  eligible: readonly T[],
  deliveries: readonly { notice_id: string; delivered_at: string }[],
  frequencyDays: number,
  now: Date,
): T | null {
  if (eligible.length === 0) return null;
  if (frequencyDays > 0) {
    const limit = now.getTime() - frequencyDays * 86_400_000;
    if (deliveries.some((row) => Date.parse(row.delivered_at) > limit)) return null;
  }
  const lastById = new Map<string, number>();
  for (const row of deliveries) {
    const at = Date.parse(row.delivered_at);
    if (!(lastById.get(row.notice_id) !== undefined && lastById.get(row.notice_id)! >= at)) {
      lastById.set(row.notice_id, at);
    }
  }
  return [...eligible].sort(
    (a, b) => (lastById.get(a.id) ?? -Infinity) - (lastById.get(b.id) ?? -Infinity),
  )[0]!;
}

export type MailNotice = {
  noticeId: string;
  recipientKey: string;
  notice: {
    title: string;
    body: string;
    buttonLabel: string;
    url: string;
    symbol: string | null;
    color: NoticeColor;
  };
};

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Hinweis für eine Ticket-Mail oder null. Fehler führen nie zu einem
 * fehlenden Mailversand: wer aufruft, fängt Ausnahmen ab.
 */
export async function pickMailNotice(
  admin: Admin,
  input: {
    tenantId: string;
    recipient: string;
    messageKind: string | null;
    hasReminderActions: boolean;
    now?: Date;
  },
): Promise<MailNotice | null> {
  if (!mailNoticeAllowed(input.messageKind, input.hasReminderActions)) return null;
  const features = await resolveTenantFeatureStates(admin, input.tenantId, [NOTICE_FEATURE]);
  if (!features || features[NOTICE_FEATURE] !== true) return null;
  const now = input.now ?? new Date();
  const today = zurichToday(now);

  const { data: notices } = await admin
    .from("requester_notices")
    .select("id, title, body, button_label, link_kind, link_target, symbol, color")
    .eq("tenant_id", input.tenantId)
    .eq("status", "active")
    .eq("show_mail", true)
    .lte("starts_on", today)
    .gte("ends_on", today)
    .limit(50);
  const eligible = ((notices ?? []) as Row[]).filter(
    (row) => noticeTargetUrl(String(row.link_kind), (row.link_target as string | null) ?? null) !== null,
  );
  if (eligible.length === 0) return null;

  const { data: settings } = await admin
    .from("requester_notice_settings")
    .select("frequency_days")
    .eq("tenant_id", input.tenantId)
    .maybeSingle();
  const frequencyDays = Number.isInteger(settings?.frequency_days)
    ? Number(settings.frequency_days)
    : DEFAULT_FREQUENCY_DAYS;

  const recipientKey = await sha256Hex(input.recipient.trim().toLowerCase());
  const { data: deliveries } = await admin
    .from("requester_notice_deliveries")
    .select("notice_id, delivered_at")
    .eq("tenant_id", input.tenantId)
    .eq("recipient_key", recipientKey)
    .gte("delivered_at", new Date(now.getTime() - 120 * 86_400_000).toISOString())
    .order("delivered_at", { ascending: false })
    .limit(200);

  const chosen = chooseNotice<Row & { id: string }>(
    eligible.map((row) => ({ ...row, id: String(row.id) })),
    (deliveries ?? []) as { notice_id: string; delivered_at: string }[],
    frequencyDays,
    now,
  );
  if (!chosen) return null;

  const secret = await admin.rpc("ticket_requester_action_secret");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  if (secret.error || typeof secret.data !== "string" || !supabaseUrl) return null;
  const token = await signNoticeLinkToken(
    {
      noticeId: chosen.id,
      tenantId: input.tenantId,
      expiresAt: Math.floor(now.getTime() / 1000) + 400 * 86_400,
    },
    secret.data,
  );
  return {
    noticeId: chosen.id,
    recipientKey,
    notice: {
      title: String(chosen.title),
      body: String(chosen.body),
      buttonLabel: String(chosen.button_label),
      url: `${supabaseUrl.replace(/\/$/, "")}/functions/v1/notice-click?t=${encodeURIComponent(token)}`,
      symbol: typeof chosen.symbol === "string" ? chosen.symbol : null,
      color: chosen.color as NoticeColor,
    },
  };
}

/** Nach erfolgreichem Versand: Auslieferung und Ansicht zählen. */
export async function recordMailNotice(
  admin: Admin,
  tenantId: string,
  picked: MailNotice,
): Promise<void> {
  await admin.from("requester_notice_deliveries").insert({
    tenant_id: tenantId,
    notice_id: picked.noticeId,
    recipient_key: picked.recipientKey,
  });
  await admin.rpc("requester_notice_count", {
    p_notice_id: picked.noticeId,
    p_channel: "mail",
    p_event: "view",
  });
}
