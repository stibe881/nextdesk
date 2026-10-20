export type RolePermissionPresentation = {
  code: string;
  description: string;
  isSensitive: boolean;
};

export type RolePermissionGroup = {
  id: string;
  label: string;
  permissions: RolePermissionPresentation[];
};

const GROUPS: ReadonlyArray<{
  id: string;
  label: string;
  prefixes: readonly string[];
}> = [
  { id: "tickets", label: "Tickets", prefixes: ["ticket"] },
  { id: "knowledge", label: "Wissensdatenbank", prefixes: ["knowledge"] },
  { id: "assets", label: "Assets", prefixes: ["asset"] },
  {
    id: "planning",
    label: "Planung",
    prefixes: ["event", "event_space", "onboarding"],
  },
  {
    id: "workplace",
    label: "Zusammenarbeit",
    prefixes: ["experience", "follow_up", "team"],
  },
  { id: "reports", label: "Auswertungen", prefixes: ["report"] },
  {
    id: "administration",
    label: "Administration",
    prefixes: [
      "tenant",
      "role",
      "user",
      "department",
      "automation",
      "privacy",
      "platform",
    ],
  },
];

function groupForCode(code: string): Pick<RolePermissionGroup, "id" | "label"> {
  const prefix = code.split(".")[0] ?? "";
  return (
    GROUPS.find((group) => group.prefixes.includes(prefix)) ?? {
      id: "other",
      label: "Weitere Berechtigungen",
    }
  );
}

export function groupRolePermissions(
  permissions: RolePermissionPresentation[],
): RolePermissionGroup[] {
  const groups = new Map<string, RolePermissionGroup>();

  for (const permission of permissions) {
    const group = groupForCode(permission.code);
    const current = groups.get(group.id) ?? {
      id: group.id,
      label: group.label,
      permissions: [],
    };
    current.permissions.push(permission);
    groups.set(group.id, current);
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      permissions: [...group.permissions].sort((left, right) =>
        left.description.localeCompare(right.description, "de-CH"),
      ),
    }))
    .sort((left, right) => {
      const leftIndex = GROUPS.findIndex((group) => group.id === left.id);
      const rightIndex = GROUPS.findIndex((group) => group.id === right.id);
      const normalizedLeftIndex = leftIndex === -1 ? GROUPS.length : leftIndex;
      const normalizedRightIndex =
        rightIndex === -1 ? GROUPS.length : rightIndex;
      return normalizedLeftIndex - normalizedRightIndex;
    });
}

export function roleScopeLabel(scope: string): string {
  if (scope === "tenant") return "Für den ganzen Mandanten";
  if (scope === "department") return "Für eine Abteilung";
  if (scope === "team") return "Für ein Team";
  return "Eingeschränkter Geltungsbereich";
}
