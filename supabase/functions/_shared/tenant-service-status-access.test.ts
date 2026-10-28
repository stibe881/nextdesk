import { canManageServiceStatusFromAssignments } from "./tenant-service-status-access.ts";

const NOW = "2026-10-28T12:00:00.000Z";

function assignment(
  permissionCodes: readonly string[],
  overrides: Partial<{
    active: boolean;
    expires_at: string | null;
    scope: string;
    starts_at: string;
  }> = {},
) {
  return {
    starts_at: overrides.starts_at ?? "2026-10-01T00:00:00.000Z",
    expires_at: overrides.expires_at ?? null,
    roles: {
      active: overrides.active ?? true,
      scope: overrides.scope ?? "tenant",
      role_permissions: permissionCodes.map((permission_code) => ({
        permission_code,
      })),
    },
  };
}

Deno.test(
  "ein reiner Asset-Manager darf den Systemstatus ohne Ticketrechte verwalten",
  () => {
    const assetManager = assignment(["asset.manage"]);
    if (!canManageServiceStatusFromAssignments([assetManager], NOW)) {
      throw new Error(
        "Eine aktive Tenant-Rolle mit asset.manage muss den Systemstatus freischalten.",
      );
    }
  },
);

Deno.test(
  "Ticketrechte oder unwirksame Asset-Rollen schalten den Systemstatus nicht frei",
  () => {
    const ticketAgent = assignment(["ticket.update"]);
    const expiredAssetManager = assignment(["asset.manage"], {
      expires_at: "2026-10-28T11:59:59.000Z",
    });
    const departmentalAssetManager = assignment(["asset.manage"], {
      scope: "department",
    });

    if (
      canManageServiceStatusFromAssignments(
        [ticketAgent, expiredAssetManager, departmentalAssetManager],
        NOW,
      )
    ) {
      throw new Error(
        "Nur eine aktive Tenant-Rolle mit asset.manage darf den Systemstatus freischalten.",
      );
    }
  },
);
