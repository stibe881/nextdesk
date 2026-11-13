import { supabase } from "./supabase";

/** Client für die Edge Function `teams-provisioning` (Shop: Microsoft Teams). */

export type TeamPerson = {
  id: string;
  displayName: string;
  email: string | null;
  jobTitle?: string | null;
};

export type TeamsContext = {
  available: boolean;
  reason: "feature_disabled" | "denied" | "not_configured" | null;
  today: string;
  maxLifetimeMonths: number;
  allowGuests: boolean;
  me: TeamPerson | null;
};

export type TeamStatus =
  "queued" | "provisioning" | "ready" | "failed" | "archived";

export type TeamRequestSummary = {
  id: string;
  name: string;
  description: string | null;
  visibility: "public" | "private";
  allowGuests: boolean;
  status: TeamStatus;
  startDate: string;
  endDate: string;
  daysLeft: number | null;
  owners: string[];
  memberCount: number;
  guestCount: number;
  channelCount: number;
  warningCount: number;
  createdAt: string;
};

export type TeamChannelDraft = {
  name: string;
  isPrivate: boolean;
  tabs: { title: string; url: string }[];
};

export type TeamDraft = {
  name: string;
  description: string;
  visibility: "public" | "private";
  allowGuests: boolean;
  channels: TeamChannelDraft[];
  owners: TeamPerson[];
  members: TeamPerson[];
  guests: string[];
  startDate: string;
  endDate: string;
};

export const EXTENSIONS = [
  { months: 1, label: "+ 1 Monat" },
  { months: 3, label: "+ 3 Monate" },
  { months: 6, label: "+ 6 Monate" },
  { months: 12, label: "+ 1 Jahr" },
] as const;

const ERRORS: Record<string, string> = {
  name_invalid: "Bitte einen Namen mit 3 bis 120 Zeichen eingeben.",
  description_invalid: "Die Beschreibung ist zu lang oder ungültig.",
  visibility_invalid: "Bitte «Öffentlich» oder «Privat» wählen.",
  channel_invalid:
    "Ein Kanalname oder Tab ist ungültig (Kanalnamen ohne Sonderzeichen, Tabs mit https-Adresse).",
  channel_duplicate:
    "Kanalnamen dürfen sich nicht doppeln («Allgemein» gibt es immer).",
  channels_invalid: "Es sind höchstens 10 Kanäle möglich.",
  owner_required: "Bitte mindestens eine Person als Owner wählen.",
  members_invalid: "Die Mitgliederliste ist ungültig (höchstens 100 Personen).",
  guest_invalid: "Eine Gast-Adresse ist ungültig.",
  guests_invalid: "Es sind höchstens 20 Gäste möglich.",
  guests_not_allowed:
    "Gäste sind nur möglich, wenn «Gäste erlauben» aktiv ist.",
  dates_invalid: "Start und Ende müssen gültige Daten sein.",
  start_in_past: "Der Start darf nicht in der Vergangenheit liegen.",
  end_before_start: "Das Ende muss nach dem Start liegen.",
  lifetime_too_long: "Die Laufzeit ist länger als erlaubt.",
  person_unknown:
    "Eine gewählte Person ist im Verzeichnis nicht (mehr) aktiv. Bitte neu auswählen.",
  teams_not_configured:
    "Microsoft Teams ist für diese Organisation noch nicht eingerichtet. Bitte den Support informieren.",
  teams_order_denied: "Du darfst im Shop nicht bestellen.",
  feature_disabled: "Der Shop ist nicht aktiviert.",
  teams_extend_denied:
    "Nur Besteller und Owner können die Laufzeit verlängern.",
  teams_extend_not_possible: "Dieses Team lässt sich nicht mehr verlängern.",
  teams_request_not_found: "Das Team wurde nicht gefunden.",
};

async function call<T>(body: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error("nextDesk ist nicht konfiguriert.");
  const { data, error } = await supabase.functions.invoke(
    "teams-provisioning",
    {
      body,
    },
  );
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
    throw new Error("Microsoft Teams ist gerade nicht erreichbar.");
  }
  return (data as { data: T }).data;
}

export const teamsApi = {
  context: (tenantId: string) =>
    call<TeamsContext>({ type: "getContext", tenantId }),
  searchPeople: (tenantId: string, query: string) =>
    call<{ people: TeamPerson[] }>({
      type: "searchPeople",
      tenantId,
      query,
    }).then((result) => result.people),
  list: (tenantId: string) =>
    call<{ requests?: TeamRequestSummary[] }>({
      type: "listMine",
      tenantId,
    }).then((result) =>
      Array.isArray(result?.requests) ? result.requests : [],
    ),
  create: (tenantId: string, draft: TeamDraft) =>
    call<{ id: string; status: TeamStatus }>({
      type: "createRequest",
      tenantId,
      request: {
        name: draft.name,
        description: draft.description,
        visibility: draft.visibility,
        allowGuests: draft.allowGuests,
        channels: draft.channels.map((channel) => ({
          name: channel.name,
          isPrivate: channel.isPrivate,
          tabs: channel.tabs.map((tab) => ({ type: "website", ...tab })),
        })),
        owners: draft.owners.map((person) => person.id),
        members: draft.members.map((person) => person.id),
        guests: draft.allowGuests ? draft.guests : [],
        startDate: draft.startDate,
        endDate: draft.endDate,
      },
    }),
  extend: (tenantId: string, requestId: string, months: number) =>
    call<{ endDate: string }>({ type: "extend", tenantId, requestId, months }),
};

/** Addiert Monate und kürzt auf den letzten Tag des Zielmonats. */
export function addMonthsIso(date: string, months: number): string {
  const [year, month, day] = date.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const target = month - 1 + months;
  const last = new Date(Date.UTC(year, target + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, target, Math.min(day, last)))
    .toISOString()
    .slice(0, 10);
}

/** «12» → «1 Jahr», «36» → «3 Jahre», «18» → «18 Monate». */
export function lifetimeLabel(months: number): string {
  if (months % 12 === 0) {
    const years = months / 12;
    return years === 1 ? "1 Jahr" : `${years} Jahre`;
  }
  return `${months} Monate`;
}

export function formatTeamDate(value: string): string {
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}.${month}.${year}` : value;
}

export function emptyDraft(context: TeamsContext): TeamDraft {
  return {
    name: "",
    description: "",
    visibility: "private",
    allowGuests: false,
    channels: [],
    owners: context.me ? [context.me] : [],
    members: [],
    guests: [],
    startDate: context.today,
    endDate: addMonthsIso(context.today, 12),
  };
}

export const WIZARD_STEPS = [
  "Grunddaten",
  "Kanäle & Tabs",
  "Personen",
  "Laufzeit",
  "Übersicht",
] as const;

/** Meldung, solange der Schritt nicht weiterführt (leer = ok). */
export function stepIssue(
  step: number,
  draft: TeamDraft,
  context: TeamsContext,
): string {
  if (step === 0) {
    return draft.name.trim().length < 3
      ? "Bitte einen Namen mit mindestens 3 Zeichen eingeben."
      : "";
  }
  if (step === 1) {
    for (const channel of draft.channels) {
      if (!channel.name.trim()) return "Jeder Kanal braucht einen Namen.";
      for (const tab of channel.tabs) {
        if (!tab.title.trim() || !/^https:\/\//i.test(tab.url.trim())) {
          return "Website-Tabs brauchen einen Titel und eine https-Adresse.";
        }
      }
    }
    return "";
  }
  if (step === 2) {
    return draft.owners.length < 1
      ? "Bitte mindestens eine Person als Owner wählen."
      : "";
  }
  if (step === 3) {
    if (!draft.startDate || !draft.endDate)
      return "Bitte Start und Ende wählen.";
    if (draft.startDate < context.today) {
      return "Der Start darf nicht in der Vergangenheit liegen.";
    }
    if (draft.endDate <= draft.startDate) {
      return "Das Ende muss nach dem Start liegen.";
    }
    if (
      draft.endDate > addMonthsIso(draft.startDate, context.maxLifetimeMonths)
    ) {
      return `Die Laufzeit darf höchstens ${lifetimeLabel(context.maxLifetimeMonths)} betragen.`;
    }
  }
  return "";
}
