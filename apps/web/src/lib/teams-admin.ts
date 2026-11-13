import { tn } from "./formality";
import { supabase } from "./supabase";

/** Client für die Edge Function `teams-admin` (Menü «Teams»). */

export type AdminTeam = {
  teamId: string;
  name: string;
  description: string | null;
  visibility: string | null;
  archived: boolean;
  webUrl: string | null;
  owners: string[];
  ownerCount: number;
  source: "order" | "import" | "existing";
  requestId: string | null;
  requestStatus: string | null;
  startDate: string | null;
  endDate: string | null;
  daysLeft: number | null;
  createdAt: string | null;
  memberCount: number | null;
  guestCount: number | null;
};

export type AdminTeamMember = {
  membershipId: string;
  userId: string | null;
  displayName: string;
  email: string | null;
  isOwner: boolean;
  isGuest: boolean;
};

export type TeamsAdminContext = {
  canManage: boolean;
  configured: boolean;
  today: string;
  syncedAt: string | null;
};

const errors = (): Record<string, string> => ({
  teams_manage_denied: tn(
    "Du darfst Teams nicht verwalten.",
    "Sie dürfen Teams nicht verwalten.",
  ),
  graph_consent_missing:
    "Microsoft verweigert den Zugriff: Die Berechtigung für Teams fehlt oder ist noch nicht übernommen.",
  graph_token_failed:
    "Die Anmeldung der Microsoft-App ist fehlgeschlagen (Geheimnis falsch oder abgelaufen).",
  graph_rate_limited:
    "Microsoft bremst gerade. Bitte in einer Minute erneut versuchen.",
  graph_unavailable: "Microsoft Teams ist gerade nicht erreichbar.",
  graph_invalid: "Microsoft hat die Anfrage abgelehnt.",
  graph_not_ready:
    "Das Team ist bei Microsoft noch nicht bereit. Bitte kurz warten.",
  last_owner: "Ein Team braucht mindestens einen Owner.",
  no_owner: "Dieses Team hat keinen Owner. Bitte zuerst einen Owner festlegen.",
  person_unknown: "Die Person ist im Verzeichnis nicht (mehr) aktiv.",
  dates_invalid: "Das Ende muss in der Zukunft liegen.",
  lifetime_too_long: "Die Laufzeit darf höchstens 3 Jahre betragen.",
  teams_extend_not_possible: "Für dieses Team lässt sich kein Ende setzen.",
  teams_team_not_found:
    "Das Team ist nicht (mehr) in der Liste. Bitte abgleichen.",
  teams_member_not_found: "Die Person ist nicht (mehr) im Team.",
  teams_sync_failed: "Der Abgleich ist fehlgeschlagen.",
});

async function call<T>(body: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error("nextDesk ist nicht konfiguriert.");
  const { data, error } = await supabase.functions.invoke("teams-admin", {
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
      const message = typeof code === "string" ? errors()[code] : undefined;
      if (message) throw new Error(message);
    }
    throw new Error("Die Teams-Verwaltung ist gerade nicht erreichbar.");
  }
  return (data as { data: T }).data;
}

export const teamsAdminApi = {
  context: (tenantId: string) =>
    call<TeamsAdminContext>({ type: "getContext", tenantId }),
  list: (tenantId: string) =>
    call<{ teams: AdminTeam[]; syncedAt: string | null }>({
      type: "list",
      tenantId,
    }),
  sync: (tenantId: string) =>
    call<{ count: number }>({ type: "sync", tenantId }),
  members: (tenantId: string, teamId: string) =>
    call<{ members: AdminTeamMember[] }>({
      type: "members",
      tenantId,
      teamId,
    }).then((result) => result.members),
  addMember: (
    tenantId: string,
    teamId: string,
    userId: string,
    owner: boolean,
  ) =>
    call<{ ok: true }>({ type: "addMember", tenantId, teamId, userId, owner }),
  removeMember: (tenantId: string, teamId: string, membershipId: string) =>
    call<{ ok: true }>({
      type: "removeMember",
      tenantId,
      teamId,
      membershipId,
    }),
  setOwner: (
    tenantId: string,
    teamId: string,
    membershipId: string,
    owner: boolean,
  ) =>
    call<{ ok: true }>({
      type: "setOwner",
      tenantId,
      teamId,
      membershipId,
      owner,
    }),
  archive: (tenantId: string, teamId: string, archive: boolean) =>
    call<{ ok: true }>({
      type: archive ? "archive" : "unarchive",
      tenantId,
      teamId,
    }),
  history: (tenantId: string, teamId: string) =>
    call<{ events: TeamHistoryEvent[] }>({
      type: "history",
      tenantId,
      teamId,
    }).then((result) => result.events),
  setEnd: (tenantId: string, teamId: string, endDate: string) =>
    call<{ endDate: string }>({ type: "setEnd", tenantId, teamId, endDate }),
  clearEnd: (tenantId: string, teamId: string) =>
    call<{ ok: true }>({ type: "clearEnd", tenantId, teamId }),
};

export type TeamHistoryEvent = {
  action: string;
  at: string;
  actor: string | null;
  details: Record<string, unknown>;
};

export type TeamFilter =
  | "all"
  | "ordered"
  | "existing"
  | "expiring"
  | "no_owner"
  | "guests"
  | "no_end"
  | "archived";

export const TEAM_FILTERS: { key: TeamFilter; label: string }[] = [
  { key: "all", label: "Alle" },
  { key: "ordered", label: "Über nextDesk bestellt" },
  { key: "existing", label: "Bestehend" },
  { key: "expiring", label: "Läuft bald ab" },
  { key: "no_owner", label: "Ohne Owner" },
  { key: "guests", label: "Mit Gästen" },
  { key: "no_end", label: "Ohne Ende" },
  { key: "archived", label: "Archiviert" },
];

export function matchesTeamFilter(
  team: AdminTeam,
  filter: TeamFilter,
): boolean {
  switch (filter) {
    case "ordered":
      return team.source === "order";
    case "existing":
      return team.source !== "order";
    case "expiring":
      return !team.archived && team.daysLeft !== null && team.daysLeft <= 30;
    case "no_owner":
      return !team.archived && team.ownerCount === 0;
    case "guests":
      return !team.archived && (team.guestCount ?? 0) > 0;
    case "no_end":
      return !team.archived && team.endDate === null;
    case "archived":
      return team.archived;
    default:
      return true;
  }
}

export function teamKpis(teams: AdminTeam[]) {
  return {
    total: teams.length,
    expiring: teams.filter((team) => matchesTeamFilter(team, "expiring"))
      .length,
    noOwner: teams.filter((team) => matchesTeamFilter(team, "no_owner")).length,
    archived: teams.filter((team) => team.archived).length,
  };
}

export type TeamSort = "name" | "created" | "end" | "members";

export const TEAM_SORTS: { key: TeamSort; label: string }[] = [
  { key: "name", label: "Name" },
  { key: "created", label: "Neueste zuerst" },
  { key: "end", label: "Ende (bald zuerst)" },
  { key: "members", label: "Meiste Mitglieder" },
];

export function sortTeams(teams: AdminTeam[], sort: TeamSort): AdminTeam[] {
  const byName = (a: AdminTeam, b: AdminTeam) =>
    a.name.localeCompare(b.name, "de", { sensitivity: "base" });
  return [...teams].sort((a, b) => {
    if (sort === "created") {
      return (
        (b.createdAt ?? "").localeCompare(a.createdAt ?? "") || byName(a, b)
      );
    }
    if (sort === "end") {
      if (a.endDate === b.endDate) return byName(a, b);
      if (a.endDate === null) return 1;
      if (b.endDate === null) return -1;
      return a.endDate.localeCompare(b.endDate);
    }
    if (sort === "members") {
      return (b.memberCount ?? -1) - (a.memberCount ?? -1) || byName(a, b);
    }
    return byName(a, b);
  });
}

/** Anteil der verstrichenen Laufzeit (0 bis 100) oder null ohne Ende. */
export function lifeProgress(team: AdminTeam, today: string): number | null {
  if (!team.startDate || !team.endDate || team.archived) return null;
  const day = (value: string) => Date.parse(`${value}T00:00:00Z`);
  const total = day(team.endDate) - day(team.startDate);
  if (!(total > 0)) return null;
  return Math.min(
    100,
    Math.max(0, Math.round(((day(today) - day(team.startDate)) / total) * 100)),
  );
}

const PALETTE = [
  "#5b5fc7",
  "#0f7b6c",
  "#c2410c",
  "#0369a1",
  "#9333ea",
  "#b45309",
  "#be123c",
  "#4d7c0f",
];

export function teamColor(name: string): string {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  return PALETTE[hash % PALETTE.length]!;
}

export function teamInitials(name: string): string {
  const all = name
    .replace(/[^\p{L}\p{N} ]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  const lettered = all.filter((word) => /\p{L}/u.test(word));
  const words = lettered.length > 0 ? lettered : all;
  const letters =
    words.length >= 2
      ? words[0]![0]! + words[1]![0]!
      : (words[0] ?? name).slice(0, 2);
  return letters.toLocaleUpperCase("de-CH");
}

/** Lesbarer Eintrag des Verlaufs aus einem Protokolleintrag. */
export function describeHistory(event: TeamHistoryEvent): {
  title: string;
  detail: string;
} {
  const d = event.details;
  const num = (value: unknown) => (typeof value === "number" ? value : null);
  const text = (value: unknown) => (typeof value === "string" ? value : null);
  switch (event.action) {
    case "teams.request.created":
      return {
        title: "Team bestellt",
        detail: text(d.endDate) ? `Ende ${d.endDate}` : "",
      };
    case "teams.request.ready":
      return {
        title: "Team in Microsoft Teams angelegt",
        detail: num(d.warnings) ? `${d.warnings} Hinweis(e)` : "",
      };
    case "teams.request.failed":
      return { title: "Anlegen fehlgeschlagen", detail: text(d.reason) ?? "" };
    case "teams.request.extended":
      return {
        title: `Laufzeit verlängert${num(d.months) ? ` um ${d.months} Monat(e)` : ""}`,
        detail: text(d.endDate) ? `neues Ende ${d.endDate}` : "",
      };
    case "teams.request.expiry_reminder":
      return {
        title: "Erinnerung an die Owner gesendet",
        detail: num(d.daysLeft) !== null ? `${d.daysLeft} Tag(e) vor Ende` : "",
      };
    case "teams.request.archived":
      return {
        title: "Automatisch archiviert (Laufzeit abgelaufen)",
        detail: "",
      };
    case "teams.team.archived":
      return { title: "Archiviert", detail: "" };
    case "teams.team.unarchived":
      return { title: "Wiederhergestellt", detail: "" };
    case "teams.team.end_set":
      return { title: "Ende gesetzt", detail: text(d.endDate) ?? "" };
    case "teams.team.end_cleared":
      return { title: "Ende entfernt", detail: "" };
    case "teams.member.added":
      return {
        title: d.owner === true ? "Owner hinzugefügt" : "Person hinzugefügt",
        detail: "",
      };
    case "teams.member.removed":
      return { title: "Person entfernt", detail: "" };
    case "teams.member.role_changed":
      return {
        title: d.owner === true ? "Zum Owner gemacht" : "Owner-Rolle entzogen",
        detail: "",
      };
    default:
      return { title: event.action, detail: "" };
  }
}
