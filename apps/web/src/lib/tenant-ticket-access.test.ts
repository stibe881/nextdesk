import { describe, expect, it } from "vitest";
import {
  isServiceStatusAvailable,
  tenantTicketAccessFromResponse,
} from "./tenant-ticket-access";

function accessResponse(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      canManageContracts: false,
      canManageServiceStatus: false,
      canReadReports: false,
      canWorkTickets: false,
      isTenantAdmin: false,
      ...overrides,
    },
  };
}

describe("Systemstatus-Zugriff", () => {
  it("lässt reine Asset-Manager:innen ohne Ticketarbeit bei aktiviertem Feature zu", () => {
    const access = tenantTicketAccessFromResponse(
      accessResponse({ canManageServiceStatus: true }),
    );

    expect(access).toMatchObject({
      canManageServiceStatus: true,
      canWorkTickets: false,
    });
    expect(
      isServiceStatusAvailable({
        assetManagementEnabled: true,
        canManageServiceStatus: access?.canManageServiceStatus ?? false,
      }),
    ).toBe(true);
  });

  it("sperrt ohne serverseitige Asset-Manager-Bestätigung oder Feature", () => {
    const access = tenantTicketAccessFromResponse(accessResponse());

    expect(
      isServiceStatusAvailable({
        assetManagementEnabled: true,
        canManageServiceStatus: access?.canManageServiceStatus ?? false,
      }),
    ).toBe(false);
    expect(
      isServiceStatusAvailable({
        assetManagementEnabled: false,
        canManageServiceStatus: true,
      }),
    ).toBe(false);
  });

  it("weist unvollständige oder nicht boolesche Access-Antworten fail-closed ab", () => {
    expect(
      tenantTicketAccessFromResponse(
        accessResponse({ canManageServiceStatus: "true" }),
      ),
    ).toBeNull();

    const response = accessResponse() as { data: Record<string, unknown> };
    delete response.data.canManageServiceStatus;
    expect(tenantTicketAccessFromResponse(response)).toBeNull();
  });
});
