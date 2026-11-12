// Microsoft-Teams-Bestellung (Shop): Prüfung der Wizard-Eingaben, Laufzeit und
// Erinnerungs-Meilensteine. Rein und ohne Netzwerk, siehe teams-model.test.ts.

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@<>()]{1,64}@[^\s@<>()]{1,255}\.[A-Za-z]{2,}$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export const TEAM_LIMITS = {
  nameMin: 3,
  nameMax: 120,
  descriptionMax: 1000,
  channelsMax: 10,
  tabsPerChannelMax: 5,
  ownersMax: 10,
  membersMax: 100,
  guestsMax: 20,
  maxLifetimeMonths: 36,
} as const;

export const EXTENSION_MONTHS = [1, 3, 6, 12] as const;
export type ExtensionMonths = (typeof EXTENSION_MONTHS)[number];

/** Tage vor Ende, an denen die Owner erinnert werden (absteigend). */
export const REMINDER_DAYS = [14, 7, 1] as const;
export type ReminderDay = (typeof REMINDER_DAYS)[number];

export type TeamTab = { type: "website"; title: string; url: string };
export type TeamChannel = {
  name: string;
  isPrivate: boolean;
  tabs: TeamTab[];
};

export type TeamRequestInput = {
  name: string;
  description: string | null;
  visibility: "public" | "private";
  allowGuests: boolean;
  channels: TeamChannel[];
  owners: string[];
  members: string[];
  guests: string[];
  startDate: string;
  endDate: string;
};

export type TeamValidation =
  | { ok: true; value: TeamRequestInput }
  | { ok: false; code: string; field?: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clean(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/[\u0000-\u001f\u007f-\u009f]/gu, " ").trim();
  return text && [...text].length <= max ? text : null;
}

/** «YYYY-MM-DD» als UTC-Mitternacht, sonst null (auch bei 31.02.). */
export function parseDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const match = DATE.exec(value);
  if (!match) return null;
  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
  return date.toISOString().slice(0, 10) === value ? date : null;
}

export function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Addiert Monate und kürzt auf den letzten Tag des Zielmonats (31.01. + 1 = 28.02.). */
export function addMonths(date: string, months: number): string | null {
  const start = parseDate(date);
  if (!start || !Number.isInteger(months) || months < 1) return null;
  const year = start.getUTCFullYear();
  const month = start.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return formatDate(
    new Date(
      Date.UTC(year, month, Math.min(start.getUTCDate(), lastDay)),
    ),
  );
}

/** Ganze Tage von `from` bis `to` (negativ, wenn `to` früher liegt). */
export function daysBetween(from: string, to: string): number | null {
  const a = parseDate(from);
  const b = parseDate(to);
  if (!a || !b) return null;
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

function uniqueIds(value: unknown, max: number): string[] | null {
  if (!Array.isArray(value) || value.length > max) return null;
  const ids: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || !UUID.test(entry)) return null;
    const id = entry.toLowerCase();
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

function parseTab(value: unknown): TeamTab | null {
  if (!isRecord(value) || value.type !== "website") return null;
  const title = clean(value.title, 60);
  const url = typeof value.url === "string" ? value.url.trim() : "";
  if (!title || url.length > 500) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    return null;
  }
  return { type: "website", title, url: parsed.toString() };
}

function parseChannel(value: unknown): TeamChannel | null {
  if (!isRecord(value)) return null;
  const name = clean(value.name, 50);
  // Microsoft erlaubt keine Kanalnamen mit ~ # % & * { } + / \ : < > ? | ' "
  if (!name || /[~#%&*{}+/\\:<>?|'".]/u.test(name)) return null;
  const tabsInput = Array.isArray(value.tabs) ? value.tabs : [];
  if (tabsInput.length > TEAM_LIMITS.tabsPerChannelMax) return null;
  const tabs: TeamTab[] = [];
  for (const entry of tabsInput) {
    const tab = parseTab(entry);
    if (!tab) return null;
    tabs.push(tab);
  }
  return { name, isPrivate: value.isPrivate === true, tabs };
}

/**
 * Prüft die Wizard-Eingabe. `today` ist das heutige Datum (YYYY-MM-DD) in der
 * Zeitzone des Betriebs; Start darf nicht davor liegen.
 */
export function validateTeamRequest(
  input: unknown,
  today: string,
): TeamValidation {
  if (!isRecord(input)) return { ok: false, code: "invalid_request" };
  const name = clean(input.name, TEAM_LIMITS.nameMax);
  if (!name || [...name].length < TEAM_LIMITS.nameMin) {
    return { ok: false, code: "name_invalid", field: "name" };
  }
  let description: string | null = null;
  if (input.description !== undefined && input.description !== null) {
    if (typeof input.description !== "string") {
      return { ok: false, code: "description_invalid", field: "description" };
    }
    if (input.description.trim()) {
      description = clean(input.description, TEAM_LIMITS.descriptionMax);
      if (!description) {
        return { ok: false, code: "description_invalid", field: "description" };
      }
    }
  }
  if (input.visibility !== "public" && input.visibility !== "private") {
    return { ok: false, code: "visibility_invalid", field: "visibility" };
  }
  const channelsInput = Array.isArray(input.channels) ? input.channels : [];
  if (channelsInput.length > TEAM_LIMITS.channelsMax) {
    return { ok: false, code: "channels_invalid", field: "channels" };
  }
  const channels: TeamChannel[] = [];
  const seen = new Set<string>();
  for (const entry of channelsInput) {
    const channel = parseChannel(entry);
    if (!channel) return { ok: false, code: "channel_invalid", field: "channels" };
    const key = channel.name.toLocaleLowerCase("de-CH");
    // «Allgemein» legt Teams selbst an.
    if (seen.has(key) || key === "general" || key === "allgemein") {
      return { ok: false, code: "channel_duplicate", field: "channels" };
    }
    seen.add(key);
    channels.push(channel);
  }
  const owners = uniqueIds(input.owners, TEAM_LIMITS.ownersMax);
  if (!owners || owners.length < 1) {
    return { ok: false, code: "owner_required", field: "owners" };
  }
  const members = uniqueIds(input.members ?? [], TEAM_LIMITS.membersMax);
  if (!members) return { ok: false, code: "members_invalid", field: "members" };
  const memberIds = members.filter((id) => !owners.includes(id));

  const guestsInput = Array.isArray(input.guests) ? input.guests : [];
  if (guestsInput.length > TEAM_LIMITS.guestsMax) {
    return { ok: false, code: "guests_invalid", field: "guests" };
  }
  const guests: string[] = [];
  for (const entry of guestsInput) {
    const email = typeof entry === "string" ? entry.trim().toLowerCase() : "";
    if (!EMAIL.test(email)) {
      return { ok: false, code: "guest_invalid", field: "guests" };
    }
    if (!guests.includes(email)) guests.push(email);
  }
  const allowGuests = input.allowGuests === true;
  if (guests.length > 0 && !allowGuests) {
    return { ok: false, code: "guests_not_allowed", field: "guests" };
  }

  const start = parseDate(input.startDate);
  const end = parseDate(input.endDate);
  if (!start || !end) return { ok: false, code: "dates_invalid", field: "endDate" };
  const startDate = formatDate(start);
  const endDate = formatDate(end);
  if (startDate < today) {
    return { ok: false, code: "start_in_past", field: "startDate" };
  }
  if (endDate <= startDate) {
    return { ok: false, code: "end_before_start", field: "endDate" };
  }
  const limit = addMonths(startDate, TEAM_LIMITS.maxLifetimeMonths);
  if (!limit || endDate > limit) {
    return { ok: false, code: "lifetime_too_long", field: "endDate" };
  }
  return {
    ok: true,
    value: {
      name,
      description,
      visibility: input.visibility,
      allowGuests,
      channels,
      owners,
      members: memberIds,
      guests,
      startDate,
      endDate,
    },
  };
}

export function isExtensionMonths(value: unknown): value is ExtensionMonths {
  return (
    typeof value === "number" &&
    (EXTENSION_MONTHS as readonly number[]).includes(value)
  );
}

/**
 * Welche Erinnerung ist fällig? Gibt den kleinsten erreichten Meilenstein
 * zurück, der noch nicht gesendet wurde. `sent` nennt die bereits gesendeten
 * Meilensteine. Wer spät bestellt (z. B. Ende in 5 Tagen), bekommt nur die
 * Erinnerung, die zu seiner Restdauer passt, nicht drei auf einmal.
 */
export function dueReminder(
  daysLeft: number,
  sent: readonly ReminderDay[],
): ReminderDay | null {
  if (!Number.isInteger(daysLeft) || daysLeft < 0) return null;
  const reached = REMINDER_DAYS.filter((day) => daysLeft <= day);
  const smallest = reached[reached.length - 1];
  if (smallest === undefined) return null;
  return sent.includes(smallest) ? null : smallest;
}

/** Meilensteine, die nach dem Versand von `day` (und grösseren) als erledigt gelten. */
export function remindersCoveredBy(day: ReminderDay): ReminderDay[] {
  return REMINDER_DAYS.filter((entry) => entry >= day);
}
