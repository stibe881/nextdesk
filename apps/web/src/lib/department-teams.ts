import { functionErrorMessage } from "./function-error";
import { supabase } from "./supabase";

export type TeamDepartment = {
  id: string;
  name: string;
  active: boolean;
};

export type TeamMember = {
  userId: string;
  displayName: string;
};

export type DepartmentTeam = {
  id: string;
  departmentId: string;
  name: string;
  active: boolean;
  members: TeamMember[];
};

export type TeamCandidate = {
  id: string;
  displayName: string;
  departmentIds: string[];
};

export type DepartmentTeamsList = {
  departments: TeamDepartment[];
  teams: DepartmentTeam[];
  candidates: TeamCandidate[];
};

type DepartmentTeamsRequest =
  | { type: "list"; tenantId: string }
  | {
      type: "save";
      tenantId: string;
      id?: string;
      departmentId: string;
      name: string;
    }
  | { type: "archive"; tenantId: string; id: string }
  | {
      type: "replaceMembers";
      tenantId: string;
      teamId: string;
      userIds: string[];
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

async function requestDepartmentTeams(
  body: DepartmentTeamsRequest,
): Promise<unknown> {
  if (!supabase) {
    throw new Error("Die Verbindung zu nextDesk ist nicht konfiguriert.");
  }

  const { data, error } = await supabase.functions.invoke<unknown>(
    "department-teams",
    { body },
  );
  if (error) {
    throw new Error(
      await functionErrorMessage(
        error,
        "Die Teamverwaltung ist derzeit nicht erreichbar.",
      ),
    );
  }
  if (!isRecord(data) || !("data" in data)) {
    throw new Error(
      "Die Teamverwaltung hat keine verwertbare Antwort geliefert.",
    );
  }

  return data.data;
}

function parseDepartment(value: unknown): TeamDepartment | null {
  if (!isRecord(value)) return null;
  if (
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.name) ||
    typeof value.active !== "boolean"
  ) {
    return null;
  }
  return { id: value.id, name: value.name, active: value.active };
}

function parseMember(value: unknown): TeamMember | null {
  if (!isRecord(value)) return null;
  if (!isNonEmptyString(value.userId) || !isNonEmptyString(value.displayName)) {
    return null;
  }
  return { userId: value.userId, displayName: value.displayName };
}

function parseTeam(value: unknown): DepartmentTeam | null {
  if (!isRecord(value) || !Array.isArray(value.members)) return null;
  if (
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.departmentId) ||
    !isNonEmptyString(value.name) ||
    typeof value.active !== "boolean"
  ) {
    return null;
  }

  const members = value.members.map(parseMember);
  if (members.some((member) => member === null)) return null;
  return {
    id: value.id,
    departmentId: value.departmentId,
    name: value.name,
    active: value.active,
    members: members as TeamMember[],
  };
}

function parseCandidate(value: unknown): TeamCandidate | null {
  if (!isRecord(value)) return null;
  if (
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.displayName) ||
    !Array.isArray(value.departmentIds) ||
    value.departmentIds.length < 1 ||
    !value.departmentIds.every(isNonEmptyString) ||
    !hasUniqueValues(value.departmentIds)
  ) {
    return null;
  }
  return {
    id: value.id,
    displayName: value.displayName,
    departmentIds: [...value.departmentIds].sort(),
  };
}

function hasUniqueValues(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function parseDepartmentTeamsList(value: unknown): DepartmentTeamsList {
  if (
    !isRecord(value) ||
    !Array.isArray(value.departments) ||
    !Array.isArray(value.teams) ||
    !Array.isArray(value.candidates)
  ) {
    throw new Error("Die Teamliste ist unvollständig.");
  }

  const departments = value.departments.map(parseDepartment);
  const teams = value.teams.map(parseTeam);
  const candidates = value.candidates.map(parseCandidate);
  if (
    departments.some((department) => department === null) ||
    teams.some((team) => team === null) ||
    candidates.some((candidate) => candidate === null)
  ) {
    throw new Error("Die Teamliste enthält ungültige Daten.");
  }

  const parsedDepartments = departments as TeamDepartment[];
  const parsedTeams = teams as DepartmentTeam[];
  const parsedCandidates = candidates as TeamCandidate[];
  const departmentIds = new Set(
    parsedDepartments.map((department) => department.id),
  );
  if (
    !hasUniqueValues(parsedDepartments.map((department) => department.id)) ||
    !hasUniqueValues(parsedTeams.map((team) => team.id)) ||
    !hasUniqueValues(parsedCandidates.map((candidate) => candidate.id)) ||
    parsedTeams.some(
      (team) =>
        !departmentIds.has(team.departmentId) ||
        !hasUniqueValues(team.members.map((member) => member.userId)),
    )
  ) {
    throw new Error("Die Teamliste enthält widersprüchliche Daten.");
  }

  return {
    departments: parsedDepartments,
    teams: parsedTeams,
    candidates: parsedCandidates,
  };
}

export async function listDepartmentTeams(
  tenantId: string,
): Promise<DepartmentTeamsList> {
  return parseDepartmentTeamsList(
    await requestDepartmentTeams({ type: "list", tenantId }),
  );
}

export async function saveDepartmentTeam(input: {
  tenantId: string;
  id?: string;
  departmentId: string;
  name: string;
}): Promise<void> {
  await requestDepartmentTeams({ type: "save", ...input });
}

export async function archiveDepartmentTeam(input: {
  tenantId: string;
  id: string;
}): Promise<void> {
  await requestDepartmentTeams({ type: "archive", ...input });
}

export async function replaceDepartmentTeamMembers(input: {
  tenantId: string;
  teamId: string;
  userIds: string[];
}): Promise<void> {
  await requestDepartmentTeams({ type: "replaceMembers", ...input });
}
