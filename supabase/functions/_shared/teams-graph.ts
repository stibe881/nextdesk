// Microsoft Graph: Teams anlegen, Kanäle/Tabs/Gäste ergänzen, archivieren.
// Anwendungsberechtigungen der Intune-/Graph-App des Mandanten (siehe
// entra-graph-token.ts): Team.Create, TeamMember.ReadWrite.All,
// Channel.Create, TeamsTab.Create, TeamSettings.ReadWrite.All, User.Invite.All.

import type { TeamChannel, TeamRequestInput } from "./teams-model.ts";

type FetchLike = typeof fetch;

const GRAPH = "https://graph.microsoft.com/v1.0";
const TIMEOUT_MS = 30_000;
const WEBSITE_TAB_APP = "com.microsoft.teamspace.tab.web";

export type TeamsGraphErrorCode =
  | "consent_missing"
  | "token_failed"
  | "rate_limited"
  | "not_ready"
  | "conflict"
  | "invalid"
  | "unavailable";

export class TeamsGraphError extends Error {
  constructor(
    readonly code: TeamsGraphErrorCode,
    readonly status = 0,
  ) {
    super(code);
  }
}

function codeForStatus(status: number): TeamsGraphErrorCode {
  if (status === 401 || status === 403) return "consent_missing";
  if (status === 429) return "rate_limited";
  if (status === 404) return "not_ready";
  if (status === 409) return "conflict";
  if (status >= 400 && status < 500) return "invalid";
  return "unavailable";
}

async function call(
  fetcher: FetchLike,
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  let response: Response;
  try {
    response = await fetcher(
      path.startsWith("https://") ? path : `${GRAPH}${path}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: "error",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
  } catch {
    throw new TeamsGraphError("unavailable");
  }
  if (!response.ok) {
    // Nur Status und Fehlercode von Microsoft ins Protokoll (keine Inhalte).
    let detail = "";
    try {
      const payload = (await response.json()) as {
        error?: { code?: unknown };
      } | null;
      if (typeof payload?.error?.code === "string") {
        detail = payload.error.code.slice(0, 80);
      }
    } catch {
      // Kein JSON.
    }
    console.error(
      `teams-graph ${method} ${path.replace(/[0-9a-f-]{36}/gi, "{id}").slice(0, 80)} -> ${response.status} ${detail}`,
    );
    throw new TeamsGraphError(codeForStatus(response.status), response.status);
  }
  return response;
}

const userRef = (id: string) => `${GRAPH}/users('${id}')`;

function memberBody(userId: string, owner: boolean) {
  return {
    "@odata.type": "#microsoft.graph.aadUserConversationMember",
    roles: owner ? ["owner"] : [],
    "user@odata.bind": userRef(userId),
  };
}

/** «/teams('<id>')» bzw. «/teams('<id>')/operations('<op>')» → Ids. */
export function parseTeamLocation(
  contentLocation: string | null,
  location: string | null,
): { teamId: string; operation: string | null } | null {
  const team =
    /teams\('([0-9a-f-]{36})'\)/i.exec(contentLocation ?? "") ??
    /teams\('([0-9a-f-]{36})'\)/i.exec(location ?? "");
  if (!team) return null;
  const operation = /operations\('([0-9a-f-]{36})'\)/i.exec(location ?? "");
  return { teamId: team[1]!.toLowerCase(), operation: operation?.[1] ?? null };
}

/**
 * Legt das Team an (asynchron bei Microsoft). Owner und Mitglieder gehören
 * zur Anfrage; Kanäle, Tabs und Gäste folgen mit finishTeam, sobald das Team
 * bereit ist.
 */
export async function createTeam(
  token: string,
  request: Pick<
    TeamRequestInput,
    "name" | "description" | "visibility" | "owners" | "members"
  >,
  fetcher: FetchLike = fetch,
): Promise<{ teamId: string; operation: string | null }> {
  const response = await call(fetcher, token, "POST", "/teams", {
    "template@odata.bind": `${GRAPH}/teamsTemplates('standard')`,
    displayName: request.name,
    description: request.description ?? "",
    visibility: request.visibility === "public" ? "Public" : "Private",
    members: [
      ...request.owners.map((id) => memberBody(id, true)),
      ...request.members.map((id) => memberBody(id, false)),
    ],
  });
  const parsed = parseTeamLocation(
    response.headers.get("Content-Location"),
    response.headers.get("Location"),
  );
  if (!parsed) throw new TeamsGraphError("unavailable");
  return parsed;
}

/** `succeeded` | `inProgress` | `failed` für eine Team-Erstellung. */
export async function teamCreationStatus(
  token: string,
  teamId: string,
  operation: string | null,
  fetcher: FetchLike = fetch,
): Promise<"succeeded" | "inProgress" | "failed"> {
  if (operation) {
    const response = await call(
      fetcher,
      token,
      "GET",
      `/teams/${teamId}/operations/${operation}`,
    );
    const body = (await response.json().catch(() => null)) as {
      status?: unknown;
    } | null;
    if (body?.status === "succeeded") return "succeeded";
    if (body?.status === "failed") return "failed";
    return "inProgress";
  }
  try {
    await call(fetcher, token, "GET", `/teams/${teamId}`);
    return "succeeded";
  } catch (error) {
    if (error instanceof TeamsGraphError && error.code === "not_ready") {
      return "inProgress";
    }
    throw error;
  }
}

async function channelIdByName(
  fetcher: FetchLike,
  token: string,
  teamId: string,
  name: string,
): Promise<string | null> {
  const response = await call(
    fetcher,
    token,
    "GET",
    `/teams/${teamId}/channels?$select=id,displayName`,
  );
  const body = (await response.json().catch(() => null)) as {
    value?: { id?: unknown; displayName?: unknown }[];
  } | null;
  const found = body?.value?.find(
    (channel) =>
      typeof channel.displayName === "string" &&
      channel.displayName.toLocaleLowerCase("de-CH") ===
        name.toLocaleLowerCase("de-CH"),
  );
  return typeof found?.id === "string" ? found.id : null;
}

export type FinishWarning = { step: string; code: TeamsGraphErrorCode };

/**
 * Ergänzt Kanäle, Tabs und Gäste. Ein einzelner Fehler stoppt die übrigen
 * Schritte nicht; er wird als Warnung zurückgegeben. Bereits vorhandene
 * Kanäle (409) werden wiederverwendet, ein erneuter Lauf ist daher gefahrlos.
 */
export async function finishTeam(
  token: string,
  teamId: string,
  request: Pick<
    TeamRequestInput,
    "channels" | "owners" | "guests" | "allowGuests"
  >,
  fetcher: FetchLike = fetch,
): Promise<FinishWarning[]> {
  const warnings: FinishWarning[] = [];
  const failed = (step: string, error: unknown) =>
    warnings.push({
      step,
      code: error instanceof TeamsGraphError ? error.code : "unavailable",
    });

  for (const channel of request.channels) {
    try {
      const id = await ensureChannel(
        fetcher,
        token,
        teamId,
        channel,
        request.owners[0]!,
      );
      for (const tab of channel.tabs) {
        try {
          await call(
            fetcher,
            token,
            "POST",
            `/teams/${teamId}/channels/${id}/tabs`,
            {
              displayName: tab.title,
              "teamsApp@odata.bind": `${GRAPH}/appCatalogs/teamsApps('${WEBSITE_TAB_APP}')`,
              configuration: { contentUrl: tab.url, websiteUrl: tab.url },
            },
          );
        } catch (error) {
          failed(`tab:${channel.name}:${tab.title}`, error);
        }
      }
    } catch (error) {
      failed(`channel:${channel.name}`, error);
    }
  }

  if (request.allowGuests) {
    for (const email of request.guests) {
      try {
        const invited = await call(fetcher, token, "POST", "/invitations", {
          invitedUserEmailAddress: email,
          inviteRedirectUrl: "https://teams.microsoft.com",
          sendInvitationMessage: true,
        });
        const body = (await invited.json().catch(() => null)) as {
          invitedUser?: { id?: unknown };
        } | null;
        const guestId = body?.invitedUser?.id;
        if (typeof guestId !== "string") throw new TeamsGraphError("invalid");
        await call(fetcher, token, "POST", `/teams/${teamId}/members`, {
          ...memberBody(guestId, false),
          "@odata.type": "#microsoft.graph.aadUserConversationMember",
        });
      } catch (error) {
        if (!(error instanceof TeamsGraphError && error.code === "conflict")) {
          failed(`guest:${email}`, error);
        }
      }
    }
  }
  return warnings;
}

async function ensureChannel(
  fetcher: FetchLike,
  token: string,
  teamId: string,
  channel: TeamChannel,
  ownerId: string,
): Promise<string> {
  try {
    const response = await call(
      fetcher,
      token,
      "POST",
      `/teams/${teamId}/channels`,
      {
        displayName: channel.name,
        membershipType: channel.isPrivate ? "private" : "standard",
        ...(channel.isPrivate ? { members: [memberBody(ownerId, true)] } : {}),
      },
    );
    const body = (await response.json().catch(() => null)) as {
      id?: unknown;
    } | null;
    if (typeof body?.id === "string") return body.id;
  } catch (error) {
    if (!(error instanceof TeamsGraphError && error.code === "conflict")) {
      throw error;
    }
  }
  const existing = await channelIdByName(fetcher, token, teamId, channel.name);
  if (!existing) throw new TeamsGraphError("unavailable");
  return existing;
}

/** Archiviert das Team (schreibgeschützt, in Teams wiederherstellbar). */
export async function archiveTeam(
  token: string,
  teamId: string,
  fetcher: FetchLike = fetch,
): Promise<void> {
  try {
    await call(fetcher, token, "POST", `/teams/${teamId}/archive`, {
      shouldSetSpoSiteReadOnlyForMembers: true,
    });
  } catch (error) {
    // Bereits archiviert.
    if (error instanceof TeamsGraphError && error.code === "conflict") return;
    throw error;
  }
}

// ----------------------------------------------------------------- Verwaltung
// Menü «Teams»: bestehende Teams lesen, Mitglieder pflegen, (de)archivieren.

export type GraphTeamSummary = {
  id: string;
  displayName: string;
  description: string | null;
  visibility: string | null;
  createdAt: string | null;
};

type Json = Record<string, unknown>;

async function getJson(
  fetcher: FetchLike,
  token: string,
  path: string,
): Promise<Json> {
  const response = await call(fetcher, token, "GET", path);
  return ((await response.json().catch(() => null)) ?? {}) as Json;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

/** Alle Teams (Microsoft-365-Gruppen mit Team), höchstens 2000. */
export async function listAllTeams(
  token: string,
  fetcher: FetchLike = fetch,
): Promise<GraphTeamSummary[]> {
  const teams: GraphTeamSummary[] = [];
  let next: string | null =
    `${GRAPH}/groups?$filter=${encodeURIComponent(
      "resourceProvisioningOptions/Any(x:x eq 'Team')",
    )}&$select=id,displayName,description,visibility,createdDateTime&$top=100`;
  for (let page = 0; next && page < 20; page += 1) {
    if (!next.startsWith(`${GRAPH}/`)) throw new TeamsGraphError("invalid");
    const body = await getJson(fetcher, token, next);
    for (const entry of Array.isArray(body.value) ? body.value : []) {
      const row = entry as Json;
      const id = text(row.id);
      if (!id) continue;
      teams.push({
        id: id.toLowerCase(),
        displayName: text(row.displayName) ?? "(ohne Namen)",
        description: text(row.description),
        visibility: text(row.visibility)?.toLowerCase() ?? null,
        createdAt: text(row.createdDateTime),
      });
    }
    next = text(body["@odata.nextLink"]);
  }
  return teams;
}

/** Owner-Ids, Archivstatus und Web-Adresse eines Teams. */
export async function teamDetails(
  token: string,
  teamId: string,
  fetcher: FetchLike = fetch,
): Promise<{ ownerIds: string[]; isArchived: boolean; webUrl: string | null }> {
  const [owners, team] = await Promise.all([
    getJson(fetcher, token, `/groups/${teamId}/owners?$select=id&$top=50`),
    getJson(fetcher, token, `/teams/${teamId}?$select=isArchived,webUrl`),
  ]);
  return {
    ownerIds: (Array.isArray(owners.value) ? owners.value : [])
      .map((row) => text((row as Json).id)?.toLowerCase())
      .filter((id): id is string => id !== undefined && id !== null),
    isArchived: team.isArchived === true,
    webUrl: text(team.webUrl),
  };
}

export type TeamMemberInfo = {
  membershipId: string;
  userId: string | null;
  displayName: string;
  email: string | null;
  isOwner: boolean;
  isGuest: boolean;
};

export async function listTeamMembers(
  token: string,
  teamId: string,
  fetcher: FetchLike = fetch,
  top = 200,
): Promise<TeamMemberInfo[]> {
  const body = await getJson(fetcher, token, `/teams/${teamId}/members?$top=${top}`);
  const members: TeamMemberInfo[] = [];
  for (const entry of Array.isArray(body.value) ? body.value : []) {
    const row = entry as Json;
    const membershipId = text(row.id);
    if (!membershipId) continue;
    const roles = Array.isArray(row.roles) ? (row.roles as unknown[]) : [];
    members.push({
      membershipId,
      userId: text(row.userId)?.toLowerCase() ?? null,
      displayName: text(row.displayName) ?? "Unbekannt",
      email: text(row.email),
      isOwner: roles.includes("owner"),
      isGuest: roles.includes("guest"),
    });
  }
  return members;
}

export async function addTeamMember(
  token: string,
  teamId: string,
  userId: string,
  owner: boolean,
  fetcher: FetchLike = fetch,
): Promise<void> {
  try {
    await call(fetcher, token, "POST", `/teams/${teamId}/members`, memberBody(userId, owner));
  } catch (error) {
    if (error instanceof TeamsGraphError && error.code === "conflict") return;
    throw error;
  }
}

export async function removeTeamMember(
  token: string,
  teamId: string,
  membershipId: string,
  fetcher: FetchLike = fetch,
): Promise<void> {
  await call(fetcher, token, "DELETE", `/teams/${teamId}/members/${membershipId}`);
}

export async function setTeamMemberOwner(
  token: string,
  teamId: string,
  membershipId: string,
  owner: boolean,
  fetcher: FetchLike = fetch,
): Promise<void> {
  await call(fetcher, token, "PATCH", `/teams/${teamId}/members/${membershipId}`, {
    "@odata.type": "#microsoft.graph.aadUserConversationMember",
    roles: owner ? ["owner"] : [],
  });
}

export async function unarchiveTeam(
  token: string,
  teamId: string,
  fetcher: FetchLike = fetch,
): Promise<void> {
  try {
    await call(fetcher, token, "POST", `/teams/${teamId}/unarchive`);
  } catch (error) {
    if (error instanceof TeamsGraphError && error.code === "conflict") return;
    throw error;
  }
}

/** Zahl der Mitglieder (ohne Gäste) und Gäste eines Teams (höchstens 999 gelesen). */
export async function teamMemberCounts(
  token: string,
  teamId: string,
  fetcher: FetchLike = fetch,
): Promise<{ members: number; guests: number }> {
  const members = await listTeamMembers(token, teamId, fetcher, 999);
  const guests = members.filter((member) => member.isGuest).length;
  return { members: members.length - guests, guests };
}
