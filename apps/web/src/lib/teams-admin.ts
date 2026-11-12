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
  endDate: string | null;
  daysLeft: number | null;
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

const ERRORS: Record<string, string> = {
  teams_manage_denied: "Du darfst Teams nicht verwalten.",
  graph_consent_missing:
    "Die Microsoft-Berechtigung fehlt. Bitte den Support informieren.",
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
};

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
      if (typeof code === "string" && ERRORS[code])
        throw new Error(ERRORS[code]);
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
  setEnd: (tenantId: string, teamId: string, endDate: string) =>
    call<{ endDate: string }>({ type: "setEnd", tenantId, teamId, endDate }),
  clearEnd: (tenantId: string, teamId: string) =>
    call<{ ok: true }>({ type: "clearEnd", tenantId, teamId }),
};

export type TeamFilter =
  "all" | "ordered" | "existing" | "expiring" | "no_owner" | "archived";

export const TEAM_FILTERS: { key: TeamFilter; label: string }[] = [
  { key: "all", label: "Alle" },
  { key: "ordered", label: "Über nextDesk bestellt" },
  { key: "existing", label: "Bestehend" },
  { key: "expiring", label: "Läuft bald ab" },
  { key: "no_owner", label: "Ohne Owner" },
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
