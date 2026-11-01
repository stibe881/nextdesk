import { invokeNextDesk, requireNextDesk } from "@/lib/nextdesk-client";

/**
 * Self-service account functions: personal workspace for people without an
 * organisation, team invitations and account deletion.
 */

/** True when the signed-in person has at least one active workspace. */
export async function hasActiveMembership(): Promise<boolean> {
  const { count, error } = await requireNextDesk()
    .from("tenant_memberships")
    .select("tenant_id", { count: "exact", head: true })
    .eq("status", "active");
  if (error) throw error;
  return (count ?? 0) > 0;
}

/** Activates open team invitations for the signed-in e-mail address. */
export async function acceptPendingInvitations(): Promise<number> {
  try {
    const response = await invokeNextDesk<{ data?: { accepted?: unknown } }>(
      "tenant-users",
      { type: "acceptMyInvitations" },
    );
    const accepted = response?.data?.accepted;
    return typeof accepted === "number" ? accepted : 0;
  } catch {
    return 0;
  }
}

export async function createPersonalWorkspace(name: string): Promise<string> {
  const response = await invokeNextDesk<{ data?: { tenantId?: unknown } }>(
    "account",
    { type: "createPersonalWorkspace", name },
  );
  const tenantId = response?.data?.tenantId;
  if (typeof tenantId !== "string") {
    throw new Error("Der Arbeitsbereich konnte nicht erstellt werden.");
  }
  return tenantId;
}

export async function deleteAccount(): Promise<void> {
  await invokeNextDesk("account", {
    type: "deleteAccount",
    confirmation: "LÖSCHEN",
  });
}

export async function isPersonalWorkspace(tenantId: string): Promise<boolean> {
  const { data, error } = await requireNextDesk()
    .from("tenants")
    .select("workspace_kind")
    .eq("id", tenantId)
    .maybeSingle();
  if (error || !data) return false;
  return (data as { workspace_kind?: unknown }).workspace_kind === "personal";
}

export type TeamMember = {
  id: string;
  email: string;
  displayName: string | null;
  isAgent: boolean;
  isTenantAdmin: boolean;
};

export type TeamInvitation = {
  id: string;
  email: string;
  status: string;
};

export type Team = {
  members: TeamMember[];
  invitations: TeamInvitation[];
  defaultDepartmentId: string | null;
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function loadTeam(tenantId: string): Promise<Team> {
  const response = await invokeNextDesk<{ data?: Record<string, unknown> }>(
    "tenant-users",
    { type: "listUsers", tenantId },
  );
  const data = response?.data ?? {};
  const members = (Array.isArray(data.members) ? data.members : [])
    .map((value): TeamMember | null => {
      const member = value as Record<string, unknown>;
      const id = text(member.id);
      if (!id || member.status !== "active") return null;
      return {
        id,
        email: text(member.email) ?? "",
        displayName: text(member.displayName),
        isAgent: member.isAgent === true,
        isTenantAdmin: member.isTenantAdmin === true,
      };
    })
    .filter((member): member is TeamMember => member !== null);
  const invitations = (Array.isArray(data.invitations) ? data.invitations : [])
    .map((value): TeamInvitation | null => {
      const invitation = value as Record<string, unknown>;
      const id = text(invitation.id);
      if (!id || invitation.status !== "sent") return null;
      return {
        id,
        email: text(invitation.email) ?? "",
        status: "sent",
      };
    })
    .filter((invitation): invitation is TeamInvitation => invitation !== null);
  const department = (
    Array.isArray(data.departments) ? data.departments : []
  ).find((value) => (value as { active?: unknown }).active === true) as
    | { id?: unknown }
    | undefined;
  return {
    members,
    invitations,
    defaultDepartmentId: text(department?.id),
  };
}

export async function inviteTeamMember(input: {
  tenantId: string;
  email: string;
  displayName: string | null;
  canWorkTickets: boolean;
  departmentId: string | null;
}): Promise<void> {
  const isAgent = input.canWorkTickets && Boolean(input.departmentId);
  await invokeNextDesk("tenant-users", {
    type: "inviteUser",
    tenantId: input.tenantId,
    email: input.email.trim().toLowerCase(),
    displayName: input.displayName,
    jobTitle: null,
    offer: null,
    departmentId: input.departmentId,
    isAgent,
  });
}

export async function removeTeamMember(
  tenantId: string,
  userId: string,
): Promise<void> {
  await invokeNextDesk("tenant-users", {
    type: "removeUser",
    tenantId,
    userId,
  });
}

export async function revokeTeamInvitation(
  tenantId: string,
  invitationId: string,
): Promise<void> {
  await invokeNextDesk("tenant-users", {
    type: "revokeInvitation",
    tenantId,
    invitationId,
  });
}
