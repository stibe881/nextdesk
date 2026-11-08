/**
 * Snapshot for the home-screen widgets (iOS WidgetKit, Android App Widgets).
 *
 * Widgets cannot call Supabase with the user session. The app therefore
 * writes a small, token-free snapshot into shared storage whenever it loads
 * the priorities or the approval inbox, and the widgets only render it.
 *
 * Everything in this file is pure so it can be tested without native code.
 * The Swift widget (targets/widget/Snapshot.swift) decodes the same JSON:
 * keep the field names in sync.
 */
import type { PriorityList } from "@/lib/my-priorities";

export const WIDGET_SNAPSHOT_VERSION = 1;
/** Own tickets whose resolution is due within this window count as warning. */
export const SLA_WARNING_WINDOW_MS = 4 * 60 * 60 * 1_000;
export const WIDGET_PRIORITY_COUNT = 3;
export const WIDGET_URL_SCHEME = "ch.grossict.nextdesk";
/** AsyncStorage key of the snapshot (the Android widget task reads it). */
export const WIDGET_SNAPSHOT_STORAGE_KEY = "nextdesk:widget:snapshot:v1";
const MAX_SUBJECT_LENGTH = 120;
const MAX_REASON_LENGTH = 140;
const MAX_DUE_DATES = 60;

export type WidgetPriority = {
  id: string;
  ticketNumber: string;
  subject: string;
  reason: string | null;
};

/** Colours from the tenant design (Einstellungen → Design), per scheme. */
export type WidgetBrandColors = {
  /** Title and ticket numbers; readable on the widget surfaces. */
  accent: string;
  /** Background of the ticket rows. */
  surface: string;
};

export type WidgetBrand = {
  light: WidgetBrandColors;
  dark: WidgetBrandColors;
};

export type WidgetSnapshot = {
  version: typeof WIDGET_SNAPSHOT_VERSION;
  /** ISO timestamp of the last change («Stand HH:MM»). */
  updatedAt: string;
  tenantId: string;
  /** Top entries of «Meine Prioritäten»; null while unknown or unavailable. */
  priorities: WidgetPriority[] | null;
  /**
   * Resolution due dates (ISO) of all own open tickets, ascending. The
   * widgets recount SLA warnings from these at render time, so the number
   * stays correct while the app is closed.
   */
  slaDueAt: string[] | null;
  /** Open approvals that wait for the user's decision; null while unknown. */
  approvals: number | null;
  /** Tenant design colours; null uses the built-in nextDesk colours. */
  brand: WidgetBrand | null;
};

export type WidgetSnapshotUpdate = {
  tenantId: string;
  priorities?: PriorityList;
  approvals?: number;
  brand?: WidgetBrand | null;
};

function clip(value: string, max: number): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function validTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

/** Top priorities and SLA due dates from a `my-priorities` response. */
export function priorityPartFromList(
  list: PriorityList,
): Pick<WidgetSnapshot, "priorities" | "slaDueAt"> {
  const ordered = [...list.tickets].sort((a, b) => a.position - b.position);
  const priorities = ordered.slice(0, WIDGET_PRIORITY_COUNT).map((ticket) => ({
    id: ticket.id,
    ticketNumber: clip(ticket.ticketNumber, 40),
    subject: clip(ticket.subject, MAX_SUBJECT_LENGTH),
    reason: ticket.reason ? clip(ticket.reason, MAX_REASON_LENGTH) : null,
  }));
  const slaDueAt = ordered
    .map((ticket) => validTime(ticket.resolutionDueAt))
    .filter((time): time is number => time !== null)
    .sort((a, b) => a - b)
    .slice(0, MAX_DUE_DATES)
    .map((time) => new Date(time).toISOString());
  return { priorities, slaDueAt };
}

/**
 * Merges a partial update into the previous snapshot. A different tenant
 * discards everything that belonged to the previous one.
 */
export function mergeWidgetSnapshot(
  previous: WidgetSnapshot | null,
  update: WidgetSnapshotUpdate,
  now: Date,
): WidgetSnapshot {
  const base: WidgetSnapshot =
    previous && previous.tenantId === update.tenantId
      ? previous
      : {
          version: WIDGET_SNAPSHOT_VERSION,
          updatedAt: now.toISOString(),
          tenantId: update.tenantId,
          priorities: null,
          slaDueAt: null,
          approvals: null,
          brand: null,
        };
  return {
    ...base,
    version: WIDGET_SNAPSHOT_VERSION,
    updatedAt: now.toISOString(),
    ...(update.priorities ? priorityPartFromList(update.priorities) : {}),
    ...(update.approvals !== undefined
      ? { approvals: Math.max(0, Math.floor(update.approvals)) }
      : {}),
    ...(update.brand !== undefined ? { brand: parseBrand(update.brand) } : {}),
  };
}

/** Number of own tickets that are overdue or due within four hours. */
export function countSlaWarnings(
  slaDueAt: readonly string[] | null,
  now: Date,
): number | null {
  if (!slaDueAt) return null;
  const limit = now.getTime() + SLA_WARNING_WINDOW_MS;
  return slaDueAt.filter((value) => {
    const time = validTime(value);
    return time !== null && time < limit;
  }).length;
}

/** Number of own tickets whose resolution is already overdue. */
export function countSlaBreaches(
  slaDueAt: readonly string[] | null,
  now: Date,
): number | null {
  if (!slaDueAt) return null;
  return slaDueAt.filter((value) => {
    const time = validTime(value);
    return time !== null && time <= now.getTime();
  }).length;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hexColor(value: unknown): string | null {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)
    ? value.toUpperCase()
    : null;
}

function parseBrandColors(value: unknown): WidgetBrandColors | null {
  if (!isRecord(value)) return null;
  const accent = hexColor(value.accent);
  const surface = hexColor(value.surface);
  return accent && surface ? { accent, surface } : null;
}

export function parseBrand(value: unknown): WidgetBrand | null {
  if (!isRecord(value)) return null;
  const light = parseBrandColors(value.light);
  const dark = parseBrandColors(value.dark);
  return light && dark ? { light, dark } : null;
}

function parsePriority(value: unknown): WidgetPriority | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== "string" ||
    typeof value.ticketNumber !== "string" ||
    typeof value.subject !== "string"
  ) {
    return null;
  }
  return {
    id: value.id,
    ticketNumber: value.ticketNumber,
    subject: value.subject,
    reason: typeof value.reason === "string" ? value.reason : null,
  };
}

/** Reads a stored snapshot; anything malformed or outdated yields null. */
export function parseWidgetSnapshot(
  raw: string | null | undefined,
): WidgetSnapshot | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (
    !isRecord(value) ||
    value.version !== WIDGET_SNAPSHOT_VERSION ||
    typeof value.tenantId !== "string" ||
    validTime(value.updatedAt as string) === null
  ) {
    return null;
  }
  const priorities = Array.isArray(value.priorities)
    ? value.priorities
        .map(parsePriority)
        .filter((item): item is WidgetPriority => item !== null)
        .slice(0, WIDGET_PRIORITY_COUNT)
    : null;
  const slaDueAt = Array.isArray(value.slaDueAt)
    ? value.slaDueAt.filter(
        (item): item is string =>
          typeof item === "string" && validTime(item) !== null,
      )
    : null;
  const approvals =
    typeof value.approvals === "number" &&
    Number.isFinite(value.approvals) &&
    value.approvals >= 0
      ? Math.floor(value.approvals)
      : null;
  return {
    version: WIDGET_SNAPSHOT_VERSION,
    updatedAt: value.updatedAt as string,
    tenantId: value.tenantId,
    priorities,
    slaDueAt,
    approvals,
    brand: parseBrand(value.brand),
  };
}

const pad = (value: number) => String(value).padStart(2, "0");

/** «Stand 14:05», or «Stand 06.11. 14:05» when it is not from today. */
export function formatSnapshotTime(updatedAt: string, now: Date): string {
  const time = validTime(updatedAt);
  if (time === null) return "Stand unbekannt";
  const date = new Date(time);
  const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  return sameDay
    ? `Stand ${clock}`
    : `Stand ${pad(date.getDate())}.${pad(date.getMonth() + 1)}. ${clock}`;
}

/** Deep link that the widgets open: a ticket, or «Meine Prioritäten». */
export function widgetDeepLink(ticketId?: string | null): string {
  return ticketId
    ? `${WIDGET_URL_SCHEME}://ticket/${encodeURIComponent(ticketId)}`
    : `${WIDGET_URL_SCHEME}://priorities`;
}
